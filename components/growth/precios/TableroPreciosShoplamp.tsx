'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Check, Loader2, RefreshCw, Search, TriangleAlert, X } from 'lucide-react'
import {
  AVISO,
  BOTON,
  CAMPO,
  CIFRAS,
  COLOR_ESTADO,
  LINEA,
  PANTALLA,
  RADIO,
  TABLA,
  TEXTO,
  TIPO,
} from '@/lib/estilo/denso'
import { Panel } from '@/components/plataforma/comun'
import { resumir, type EstadoFila, type FilaPlan, type PlanPrecios } from '@/lib/precios-shoplamp/plan'
import { MAX_POR_TRAMO } from '@/lib/precios-shoplamp/reglas'

/**
 * PRECIOS DE SHOPLAMP — LA PANTALLA.
 *
 * Una tabla con TODAS las referencias de Francia, Italia y Alemania, lo que
 * valen hoy, lo que valdrían con la regla, y cuánto sube eso en tanto por
 * ciento. Se marca lo que se quiera, se simula contra Amazon, y entonces —y
 * solo entonces— se puede aplicar.
 *
 *
 * ============ POR QUÉ LA COLUMNA DEL PORCENTAJE ============
 *
 * Porque «+7 €» suena a poco y no lo es en todo el catálogo. Sobre una
 * referencia de 200 € son un 3,5 %; sobre una de 1,07 € son un 654 %, y en este
 * catálogo hay referencias por debajo de 7 € — o sea, productos que MÁS QUE
 * DUPLICAN su precio. Eso no se puede descubrir después de publicarlo.
 *
 * La regla es la que se pidió y se aplica tal cual. Lo que hace esta pantalla
 * es que la subida se VEA antes de pulsar, ordenarla de mayor a menor, y dejar
 * desmarcar lo que no se quiera. El aviso de arriba dice cuántas pasan del
 * 100 % y el chip las filtra de un clic.
 *
 *
 * ============ NADA SE PUBLICA SIN SIMULAR ANTES ============
 *
 * «Simular» manda `validateOnly` a Amazon: contesta si lo aceptaría y no toca
 * nada. El botón de aplicar está apagado hasta que la simulación de ESA MISMA
 * selección ha pasado, y se vuelve a apagar en cuanto se marca o desmarca una
 * fila —porque entonces ya no es la misma selección—.
 *
 * La firma que lo controla incluye el PRECIO de cada fila, no solo el SKU: si
 * el plan se recarga y el precio base de España ha cambiado, la simulación
 * anterior deja de valer, que es justo lo que tiene que pasar.
 *
 *
 * ============ EL ENVÍO VA EN TRAMOS Y EN SERIE ============
 *
 * El cupo de Amazon es de cinco por segundo, así que 400 referencias son 80
 * segundos: una sola petición HTTP de ese tamaño la corta cualquier proxy por
 * el camino y nos quedaríamos sin saber cuáles llegaron. Se parte en tramos de
 * 200 y todos van con el MISMO `batchId`, que es lo que mantiene el lote
 * reconocible —y revertible— en el registro de cambios.
 */

/** A partir de aquí la subida deja de ser un ajuste y es otro producto */
const SUBIDA_FUERTE = 100

const ESTADOS: { id: EstadoFila | 'todas'; rotulo: string }[] = [
  { id: 'todas', rotulo: 'Todas' },
  { id: 'cambia', rotulo: 'Cambian' },
  { id: 'ya_correcto', rotulo: 'Ya correctas' },
  { id: 'sin_base', rotulo: 'Sin precio en España' },
  { id: 'base_invalida', rotulo: 'Base no válida' },
]

/**
 * Lo que devuelve la ruta POR FILA.
 *
 * Es la forma que ELLA traduce, no la de `SentChange` de lib/amazon/data.ts, que
 * habla en inglés (`status`, `message`). Declarar aquí los nombres de este
 * módulo sobre el objeto crudo COMPILA IGUAL —TypeScript nunca ve los dos
 * juntos— y en ejecución `estado` y `mensaje` salen `undefined`: el recuento de
 * aceptados da 0 SIEMPRE y todas las filas se listan como fallidas y sin
 * motivo. Pasó, y solo se vio ejecutándolo.
 */
type Envio = {
  sku: string
  marketplaceId: string
  estado: 'aceptado' | 'invalido' | 'error'
  mensaje: string | null
  anterior?: number | null
  nuevo?: number | null
}

const clave = (f: { sku: string; marketplaceId: string }) => `${f.marketplaceId}|${f.sku}`

const euros = (v: number | null) =>
  v === null ? '—' : v.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function TableroPreciosShoplamp({ plan }: { plan: PlanPrecios }) {
  const router = useRouter()

  const [pais, setPais] = useState<string>('todos')
  const [estado, setEstado] = useState<EstadoFila | 'todas'>('cambia')
  const [soloFuertes, setSoloFuertes] = useState(false)
  const [busca, setBusca] = useState('')
  const [marcadas, setMarcadas] = useState<ReadonlySet<string>>(new Set())

  const [trabajando, setTrabajando] = useState<null | 'simulando' | 'aplicando'>(null)
  const [hechos, setHechos] = useState(0)
  const [error, setError] = useState<string | null>(null)
  /** La selección que ya pasó la simulación. Ver la cabecera */
  const [firmaSimulada, setFirmaSimulada] = useState<string | null>(null)
  const [resultados, setResultados] = useState<Envio[] | null>(null)
  const [aplicado, setAplicado] = useState(false)
  /**
   * CUÁNTAS SE PIDIERON Y CUÁNTAS LLEGARON A SALIR.
   *
   * Sin esto, el panel de resultados da un número absoluto sin denominador:
   * «200 aceptadas» de un lote de 421 se lee como si hubieran ido las 421 y 221
   * hubieran desaparecido sin dejar rastro. Con el lote cortado eso es
   * exactamente lo que pasaba.
   */
  const [cobertura, setCobertura] = useState<{ total: number; intentadas: number } | null>(null)

  // El mismo recuento que usa el script de comprobación, no un segundo contador
  // escrito aquí: dos formas de contar lo mismo acaban discrepando.
  const porPais = useMemo(() => resumir(plan.filas), [plan.filas])

  const fuertes = useMemo(
    () => plan.filas.filter((f) => f.estado === 'cambia' && (f.subida ?? 0) >= SUBIDA_FUERTE),
    [plan.filas]
  )

  /**
   * Lo visible, ORDENADO POR SUBIDA DE MAYOR A MENOR.
   *
   * No es una preferencia estética: lo que más sube es lo que hay que mirar, y
   * con 1.200 filas ordenadas por SKU una subida del 1.000 % está en la fila
   * 847 y no la ve nadie. Las que no tienen subida calculable van al final.
   */
  const visibles = useMemo(() => {
    const t = busca.trim().toLowerCase()
    const filtradas = plan.filas.filter((f) => {
      if (pais !== 'todos' && f.marketplaceId !== pais) return false
      if (estado !== 'todas' && f.estado !== estado) return false
      if (soloFuertes && !(f.estado === 'cambia' && (f.subida ?? 0) >= SUBIDA_FUERTE)) return false
      if (t && !f.sku.toLowerCase().includes(t) && !(f.titulo ?? '').toLowerCase().includes(t))
        return false
      return true
    })
    return filtradas.sort(
      (a, b) =>
        (b.subida ?? -1) - (a.subida ?? -1) ||
        a.pais.localeCompare(b.pais) ||
        a.sku.localeCompare(b.sku)
    )
  }, [plan.filas, pais, estado, soloFuertes, busca])

  /** Solo lo que de verdad se puede enviar: hay precio nuevo y hay tipo de producto */
  const enviables = useMemo(
    () => plan.filas.filter((f) => f.estado === 'cambia' && f.productType !== null),
    [plan.filas]
  )
  const enviablesVisibles = useMemo(
    () => visibles.filter((f) => f.estado === 'cambia' && f.productType !== null),
    [visibles]
  )

  const seleccion = useMemo(() => enviables.filter((f) => marcadas.has(clave(f))), [enviables, marcadas])

  /**
   * LA FIRMA. Incluye el precio, no solo el SKU: si el plan se recarga y la base
   * de España ha cambiado, la simulación anterior ya no vale para esta selección.
   */
  const firma = useMemo(
    () =>
      seleccion
        .map((f) => `${clave(f)}@${Math.round((f.destino ?? 0) * 100)}`)
        .sort()
        .join(','),
    [seleccion]
  )

  const simulacionVale = firmaSimulada !== null && firmaSimulada === firma && firma !== ''
  const fuertesMarcadas = seleccion.filter((f) => (f.subida ?? 0) >= SUBIDA_FUERTE).length

  const alternar = (k: string) => {
    setFirmaSimulada(null)
    setMarcadas((prev) => {
      const s = new Set(prev)
      if (s.has(k)) s.delete(k)
      else s.add(k)
      return s
    })
  }

  const marcarVisibles = (si: boolean) => {
    setFirmaSimulada(null)
    setMarcadas((prev) => {
      const s = new Set(prev)
      for (const f of enviablesVisibles) {
        if (si) s.add(clave(f))
        else s.delete(clave(f))
      }
      return s
    })
  }

  async function lanzar(simular: boolean) {
    if (seleccion.length === 0) return
    setTrabajando(simular ? 'simulando' : 'aplicando')
    setError(null)
    setResultados(null)
    setHechos(0)

    /**
     * ESTO VA AQUÍ, ANTES DEL BUCLE, Y NO AL FINAL. ES EL FALLO CARO.
     *
     * Estaba después del bucle y dentro del `try`. Con 421 filas eso son tres
     * peticiones, y si la segunda fallaba —un 504 del proxy, un corte de red, un
     * 400 de la ruta porque la conexión dejó de estar activa— el `throw` saltaba
     * al `catch` y estas dos líneas NO se ejecutaban. Resultado: las 200 del
     * primer tramo estaban publicadas de verdad en la tienda del cliente y el
     * panel las rotulaba «Simulación: 200 las aceptaría. Ya se puede aplicar».
     * Y como `firmaSimulada` tampoco se limpiaba, «Aplicar» seguía armado con
     * las 421 y un segundo clic reempezaba desde el tramo 1.
     *
     * El momento en que esto es cierto es el momento en que se DECIDE enviar,
     * no el momento en que termina: a partir de aquí hay precios en la calle
     * pase lo que pase después.
     */
    setAplicado(!simular)
    if (!simular) setFirmaSimulada(null)

    const total = seleccion.length
    let intentadas = 0
    setCobertura({ total, intentadas: 0 })

    const acumulado: Envio[] = []
    /** Si Amazon corta el lote, lo simulado NO cubre la selección entera */
    let cortado = false
    // El lote entero comparte identificador, incluso al simular: así la
    // simulación y el envío de verdad del mismo lote se reconocen juntos.
    let batchId: string | null = null

    try {
      for (let i = 0; i < seleccion.length; i += MAX_POR_TRAMO) {
        const tramo = seleccion.slice(i, i + MAX_POR_TRAMO)
        // Se cuentan ANTES de salir: una petición que revienta deja sus filas en
        // «salieron y no sabemos qué pasó», que es la verdad. Contarlas después
        // las pondría en «ni se intentaron», que no lo es.
        intentadas += tramo.length
        setCobertura({ total, intentadas })
        const res = await fetch('/api/precios-shoplamp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            simular,
            batchId,
            filas: tramo.map((f) => ({
              sku: f.sku,
              marketplaceId: f.marketplaceId,
              esperado: f.destino,
            })),
          }),
        })
        const json = (await res.json().catch(() => ({}))) as {
          error?: string
          batchId?: string | null
          resultados?: Envio[]
          rechazadas?: { sku: string; marketplaceId: string; pais: string; motivo: string }[]
          /** Los que `sendChanges` aparta porque Amazon ya los rechazó cinco veces */
          retirados?: { sku: string; motivo: string }[]
          abortReason?: string | null
        }
        if (!res.ok) throw new Error(json.error ?? `Amazon ha contestado ${res.status}`)

        batchId = json.batchId ?? batchId
        acumulado.push(...(json.resultados ?? []))
        for (const r of json.rechazadas ?? []) {
          acumulado.push({
            sku: r.sku,
            marketplaceId: r.marketplaceId,
            estado: 'error',
            mensaje: r.motivo,
          })
        }
        // LOS APARTADOS TAMBIÉN SE CUENTAN. `sendChanges` saca del lote los SKU
        // que Amazon ya ha rechazado cinco veces con el mismo motivo, y no
        // devuelve resultado por ellos. Sin esta vuelta se marcaban 400 filas,
        // volvían 390 y las diez que faltan no aparecían en ningún sitio.
        for (const r of json.retirados ?? []) {
          acumulado.push({ sku: r.sku, marketplaceId: '', estado: 'error', mensaje: r.motivo })
        }
        setHechos(Math.min(i + MAX_POR_TRAMO, seleccion.length))
        setResultados([...acumulado])

        // Si la conexión se ha caído o nos han revocado el permiso, el resto del
        // lote son cuatrocientos errores idénticos. Se para y se dice por qué.
        if (json.abortReason) {
          setError(json.abortReason)
          cortado = true
          break
        }
      }

      if (simular) {
        // Solo si se simuló LA SELECCIÓN ENTERA. Con el lote cortado, los tramos
        // que no salieron no los ha mirado nadie, y habilitar «Aplicar» después
        // publicaría precios sin simular — que es justo lo que este botón
        // impide.
        if (!cortado) setFirmaSimulada(firma)
      } else {
        // Se desmarca lo enviado. El espejo tarda unos minutos en reflejar el
        // precio nuevo, así que esas filas seguirían saliendo como «cambia» y
        // marcadas: sin esto, el botón invitaría a mandar otra vez lo mismo.
        //
        // Si el lote se cortó, la selección SE QUEDA: lo que no salió sigue
        // marcado y se puede volver a simular y mandar sin rehacerla a mano.
        if (!cortado) setMarcadas(new Set())
        router.refresh()
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ha fallado el envío')
      // Un envío real que revienta a mitad NO vuelve a quedar certificado por la
      // simulación anterior: lo que salió ya no se puede deshacer pulsando otra
      // vez, y lo que falta hay que volver a simularlo.
      if (!simular) setFirmaSimulada(null)
    } finally {
      setTrabajando(null)
    }
  }

  if (!plan.connectionId) {
    return (
      <div className={`${AVISO.base} ${AVISO.conTono}`} style={{ borderLeftColor: COLOR_ESTADO.ambar }}>
        <AlertTriangle className={AVISO.icono} style={{ color: COLOR_ESTADO.ambar }} />
        <div className={`${TIPO.s} ${TEXTO.t2}`}>
          Shoplamp no tiene ninguna cuenta de Amazon conectada y activa, así que no hay catálogo
          del que leer el precio de España ni tienda a la que escribir. Se conecta desde{' '}
          <strong>Amazon API · Cuentas</strong>.
        </div>
      </div>
    )
  }

  const aceptados = resultados?.filter((r) => r.estado === 'aceptado').length ?? 0
  const fallidos = resultados?.filter((r) => r.estado !== 'aceptado') ?? []

  /**
   * LAS QUE NO ESTÁN EN NINGÚN RECUENTO, que son las que importan.
   *
   * `aceptados` y `fallidos` solo cubren las filas de las que ha vuelto una
   * respuesta. Con el lote cortado —o con una petición que revienta— hay filas
   * que no salieron nunca y filas que salieron sin que sepamos qué contestó
   * Amazon, y antes no aparecían en ninguna parte: el panel decía «200
   * aceptadas» de un lote de 421 y las otras 221 se evaporaban.
   */
  const resueltas = resultados?.length ?? 0
  const sinIntentar = cobertura ? Math.max(0, cobertura.total - cobertura.intentadas) : 0
  const enDuda = cobertura ? Math.max(0, cobertura.intentadas - resueltas) : 0

  return (
    // `h-full` Y NO `flex-1`. La carcasa de Growth mete a los paneles en un
    // `<div class="flex-1 min-h-0">` que NO es un contenedor flex, así que un
    // `flex-1` aquí no lo lee nadie y esta columna crece con su contenido.
    // Medido con las 1.255 filas: la caja de la tabla medía 35.166 px, no
    // scrolleaba por dentro, y la barra de «Simular» y «Aplicar» quedaba a
    // treinta y cinco mil píxeles del principio — o sea, inalcanzable.
    //
    // Con la altura acotada aquí, el `flex-1 min-h-0 overflow-auto` de
    // TABLA.caja vuelve a significar algo y la barra se queda siempre a la
    // vista. Por eso todo lo que no es la tabla lleva `shrink-0`.
    <div className={`${PANTALLA.cuerpo} h-full`}>
      {/* ---------- La tira de cifras ---------- */}
      <div className={CIFRAS.tira}>
        <div className={CIFRAS.celda}>
          <span className={CIFRAS.valor}>{plan.referenciasBase.toLocaleString('es-ES')}</span>
          <span className={CIFRAS.rotulo}>con precio en España</span>
        </div>
        {porPais.map((r) => (
          <div key={r.marketplaceId} className={CIFRAS.celda}>
            <span className={`${CIFRAS.valor} ${r.cambia > 0 ? CIFRAS.urgente : ''}`}>
              {r.cambia.toLocaleString('es-ES')}
            </span>
            <span className={CIFRAS.rotulo}>
              cambian en {r.pais} · +{r.recargo.toFixed(2)} €
            </span>
          </div>
        ))}
      </div>

      {/* ---------- Lo que hay que ver antes de pulsar ---------- */}
      {fuertes.length > 0 && (
        <div
          className={`${AVISO.base} ${AVISO.conTono} shrink-0`}
          style={{ borderLeftColor: COLOR_ESTADO.ambar }}
        >
          <TriangleAlert className={AVISO.icono} style={{ color: COLOR_ESTADO.ambar }} />
          <div className={`${TIPO.s} ${TEXTO.t2}`}>
            <strong>
              {fuertes.length.toLocaleString('es-ES')} referencias más que duplican su precio
            </strong>{' '}
            con esta regla. Un recargo fijo pesa lo mismo en una referencia de 200 € que en una de
            1 €, y abajo no es un ajuste: es otro producto. La más extrema sube un{' '}
            {Math.round(Math.max(...fuertes.map((f) => f.subida ?? 0))).toLocaleString('es-ES')} %.
            Están ordenadas de mayor subida a menor y se pueden desmarcar una a una.{' '}
            <button type="button" className="underline" onClick={() => setSoloFuertes((v) => !v)}>
              {soloFuertes ? 'Ver todas' : 'Ver solo esas'}
            </button>
          </div>
        </div>
      )}

      {/* ---------- Filtros ---------- */}
      <div className="flex shrink-0 flex-wrap items-center gap-[6px]">
        <button
          type="button"
          className={`${BOTON.chip} ${pais === 'todos' ? BOTON.chipEncendido : ''}`}
          onClick={() => setPais('todos')}
        >
          Los tres países
        </button>
        {porPais.map((r) => (
          <button
            key={r.marketplaceId}
            type="button"
            className={`${BOTON.chip} ${pais === r.marketplaceId ? BOTON.chipEncendido : ''}`}
            onClick={() => setPais(r.marketplaceId)}
          >
            {r.pais}
          </button>
        ))}

        <span className="mx-1 h-4 w-px bg-[var(--ls-linea)]" />

        {ESTADOS.map((e) => (
          <button
            key={e.id}
            type="button"
            className={`${BOTON.chip} ${estado === e.id ? BOTON.chipEncendido : ''}`}
            onClick={() => setEstado(e.id)}
          >
            {e.rotulo}
          </button>
        ))}

        <label className="relative ml-auto w-[220px]">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-[var(--ls-t4)]" />
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="SKU o título"
            className={`${CAMPO.input} pl-[26px]`}
          />
        </label>
        <button
          type="button"
          className={`${BOTON.base} ${BOTON.secundario}`}
          // APAGADO MIENTRAS SE ENVÍA. `router.refresh()` trae un plan nuevo, y a
          // mitad del bucle eso descuadra dos cosas a la vez: la barra de
          // progreso divide por la selección del render NUEVO mientras el bucle
          // recorre la del cierre, y la firma que se guardaría al terminar sería
          // la de una selección que ya no es la que se mandó.
          disabled={trabajando !== null}
          onClick={() => router.refresh()}
          title={
            trabajando === null
              ? 'Volver a leer el catálogo'
              : 'No se puede recargar mientras hay un envío en marcha'
          }
        >
          <RefreshCw className="h-3 w-3" />
          Recargar
        </button>
      </div>

      {/* ---------- La tabla ---------- */}
      <div className={TABLA.caja}>
        <table className={TABLA.tabla}>
          <thead>
            <tr>
              <th className={`${TABLA.cabecera} w-7`}>
                <input
                  type="checkbox"
                  aria-label="Marcar todo lo visible"
                  className="h-3 w-3 align-middle"
                  disabled={enviablesVisibles.length === 0 || trabajando !== null}
                  checked={
                    enviablesVisibles.length > 0 &&
                    enviablesVisibles.every((f) => marcadas.has(clave(f)))
                  }
                  onChange={(e) => marcarVisibles(e.target.checked)}
                />
              </th>
              <th className={TABLA.cabecera}>SKU</th>
              <th className={TABLA.cabecera}>País</th>
              <th className={`${TABLA.cabecera} ${TABLA.derecha}`}>España</th>
              <th className={`${TABLA.cabecera} ${TABLA.derecha}`}>Hoy allí</th>
              <th className={`${TABLA.cabecera} ${TABLA.derecha}`}>Quedaría</th>
              <th className={`${TABLA.cabecera} ${TABLA.derecha}`}>Sube</th>
              <th className={TABLA.cabecera}>Título</th>
              <th className={TABLA.cabecera}>Estado</th>
            </tr>
          </thead>
          <tbody>
            {visibles.length === 0 && (
              <tr>
                <td colSpan={9} className={`${TABLA.celda} ${TEXTO.t4} text-center`}>
                  Nada que enseñar con estos filtros.
                </td>
              </tr>
            )}
            {visibles.map((f) => (
              <Fila
                key={clave(f)}
                fila={f}
                marcada={marcadas.has(clave(f))}
                bloqueada={trabajando !== null}
                onToggle={() => alternar(clave(f))}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* ---------- La barra de acción ---------- */}
      <div
        className={`flex shrink-0 flex-wrap items-center gap-[9px] ${RADIO.r2} border ${LINEA.normal} bg-[var(--ls-sup2)] px-[10px] py-[7px]`}
      >
        <span className={`${TIPO.m} ${TEXTO.t1} tabular-nums`}>
          <strong>{seleccion.length.toLocaleString('es-ES')}</strong> marcadas
        </span>
        <span className={`${TIPO.s} ${TEXTO.t3}`}>
          de {enviables.length.toLocaleString('es-ES')} que cambian
          {fuertesMarcadas > 0 && (
            <>
              {' · '}
              <span style={{ color: COLOR_ESTADO.ambar }}>
                {fuertesMarcadas.toLocaleString('es-ES')} de ellas más que duplican su precio
              </span>
            </>
          )}
        </span>

        {trabajando && (
          <span className={`${TIPO.s} ${TEXTO.t3} flex items-center gap-[5px]`}>
            <Loader2 className="h-3 w-3 animate-spin" />
            {trabajando === 'simulando' ? 'Simulando' : 'Aplicando'} {hechos.toLocaleString('es-ES')}
            {' / '}
            {seleccion.length.toLocaleString('es-ES')}
          </span>
        )}

        {/*
          EL BOTÓN NARANJA ES SIEMPRE EL QUE SE PUEDE PULSAR.

          Antes «Aplicar» era el primario desde el principio: naranja, grande y
          a la derecha, o sea el sitio donde se mira para enviar algo. Estaba
          apagado hasta simular, pero `disabled:opacity-45` sobre un naranja de
          marca sigue leyéndose como un botón vivo — y con 421 filas marcadas,
          lo que se ve es un botón de enviar que no hace nada al pulsarlo. Pasó.

          Así que el acento se MUEVE: mientras no haya simulación es «Simular»
          quien lo lleva, y solo cuando esa simulación vale pasa a «Aplicar». El
          color deja de ser decoración y dice cuál es el paso siguiente.
        */}
        <div className="ml-auto flex items-center gap-[9px]">
          {seleccion.length > 0 && !simulacionVale && trabajando === null && (
            <span className={`${TIPO.s} ${TEXTO.t3}`}>
              Paso 1 de 2: Amazon tiene que decir antes si lo aceptaría
            </span>
          )}
          <div className="flex items-center gap-[6px]">
            <button
              type="button"
              className={`${BOTON.base} ${BOTON.alto} ${
                simulacionVale ? BOTON.secundario : BOTON.primario
              }`}
              disabled={seleccion.length === 0 || trabajando !== null}
              title="Pregunta a Amazon si aceptaría estos precios. No cambia nada ni deja registro."
              onClick={() => lanzar(true)}
            >
              {simulacionVale ? 'Volver a simular' : 'Simular en Amazon'}
            </button>
            <button
              type="button"
              className={`${BOTON.base} ${BOTON.alto} ${
                simulacionVale ? BOTON.primario : BOTON.secundario
              }`}
              disabled={!simulacionVale || trabajando !== null}
              title={
                simulacionVale
                  ? `Publica ${seleccion.length.toLocaleString('es-ES')} precios en la tienda de Shoplamp`
                  : 'Primero hay que simular esta misma selección: Amazon dice si la aceptaría sin cambiar nada'
              }
              onClick={() => lanzar(false)}
            >
              Aplicar los precios
            </button>
          </div>
        </div>
      </div>

      {/* ---------- Qué ha pasado ---------- */}
      {error && (
        <div
          className={`${AVISO.base} ${AVISO.conTono} shrink-0`}
          style={{ borderLeftColor: COLOR_ESTADO.rojo }}
        >
          <X className={AVISO.icono} style={{ color: COLOR_ESTADO.rojo }} />
          <div className={`${TIPO.s} ${TEXTO.t2}`}>{error}</div>
        </div>
      )}

      {resultados && resultados.length > 0 && (
        <div className="shrink-0">
        <Panel
          titulo={
            aplicado
              ? `Aplicado: ${aceptados.toLocaleString('es-ES')} de ${(cobertura?.total ?? resueltas).toLocaleString('es-ES')} aceptadas por Amazon`
              : `Simulación: ${aceptados.toLocaleString('es-ES')} de ${(cobertura?.total ?? resueltas).toLocaleString('es-ES')} las aceptaría`
          }
          derecha={
            fallidos.length > 0 ? (
              <span className={`${TIPO.xs}`} style={{ color: COLOR_ESTADO.rojo }}>
                {fallidos.length.toLocaleString('es-ES')} no
              </span>
            ) : (
              <Check className="h-3 w-3" style={{ color: COLOR_ESTADO.verde }} />
            )
          }
        >
          {(sinIntentar > 0 || enDuda > 0) && (
            <p
              className={`${TIPO.s} mb-[6px]`}
              style={{ color: COLOR_ESTADO.ambar }}
            >
              De las <strong>{(cobertura?.total ?? 0).toLocaleString('es-ES')}</strong> marcadas,{' '}
              {resueltas.toLocaleString('es-ES')} tienen respuesta
              {enDuda > 0 && (
                <>
                  , <strong>{enDuda.toLocaleString('es-ES')}</strong> salieron y no sabemos qué
                  contestó Amazon
                </>
              )}
              {sinIntentar > 0 && (
                <>
                  {' y '}
                  <strong>{sinIntentar.toLocaleString('es-ES')}</strong> no se llegaron a enviar
                </>
              )}
              . {aplicado ? 'Vuelve a cargar y simula lo que quede.' : 'La simulación no cubre el lote entero.'}
            </p>
          )}
          {fallidos.length === 0 ? (
            <p className={`${TIPO.s} ${TEXTO.t3}`}>
              {aplicado
                ? 'Amazon ha aceptado todas las que contestó. El precio tarda unos minutos en verse ' +
                  'en la ficha, y cada cambio queda en el registro de Amazon API con su valor anterior.'
                : 'Amazon aceptaría todas las que ha mirado.'}
            </p>
          ) : (
            <div className="max-h-[180px] overflow-auto">
              <table className={TABLA.tabla}>
                <tbody>
                  {fallidos.slice(0, 200).map((r, i) => (
                    <tr key={`${r.marketplaceId}|${r.sku}|${i}`} className={TABLA.fila}>
                      <td className={`${TABLA.celda} font-mono text-[11.5px]`}>{r.sku}</td>
                      <td className={`${TABLA.celda} ${TABLA.numero} ${TEXTO.t3}`}>
                        {r.nuevo == null ? '' : `${euros(r.nuevo)} €`}
                      </td>
                      {/* Un rechazo sin motivo no sirve de nada: si Amazon no
                          manda texto, se enseña al menos su veredicto. */}
                      <td className={`${TABLA.celda} ${TEXTO.t3} whitespace-normal`}>
                        {r.mensaje?.trim() ? r.mensaje : `Amazon lo ha marcado como «${r.estado}»`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {fallidos.length > 200 && (
                <p className={`${TIPO.s} ${TEXTO.t4} px-2 py-1`}>
                  y {(fallidos.length - 200).toLocaleString('es-ES')} más
                </p>
              )}
            </div>
          )}
        </Panel>
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */

const TONO_ESTADO: Record<EstadoFila, { tono: keyof typeof COLOR_ESTADO; rotulo: string }> = {
  cambia: { tono: 'azul', rotulo: 'Cambia' },
  ya_correcto: { tono: 'verde', rotulo: 'Ya correcto' },
  sin_base: { tono: 'gris', rotulo: 'No está en España' },
  base_invalida: { tono: 'ambar', rotulo: 'Base sin precio' },
}

function Fila({
  fila,
  marcada,
  bloqueada,
  onToggle,
}: {
  fila: FilaPlan
  marcada: boolean
  bloqueada: boolean
  onToggle: () => void
}) {
  const e = TONO_ESTADO[fila.estado]
  const seleccionable = fila.estado === 'cambia' && fila.productType !== null
  const fuerte = fila.estado === 'cambia' && (fila.subida ?? 0) >= SUBIDA_FUERTE

  return (
    <tr className={`${TABLA.fila} ${marcada ? TABLA.filaSel : ''}`}>
      <td className={TABLA.celda}>
        <input
          type="checkbox"
          aria-label={`Marcar ${fila.sku}`}
          className="h-3 w-3 align-middle"
          checked={marcada}
          disabled={!seleccionable || bloqueada}
          title={
            fila.estado !== 'cambia'
              ? 'Esta fila no cambia de precio'
              : fila.productType === null
                ? 'No tenemos su tipo de producto, y Amazon lo exige en cada cambio'
                : undefined
          }
          onChange={onToggle}
        />
      </td>
      <td className={`${TABLA.celda} font-mono text-[11.5px]`}>{fila.sku}</td>
      <td className={`${TABLA.celda} ${TEXTO.t3}`}>{fila.pais}</td>
      <td className={`${TABLA.celda} ${TABLA.numero}`}>{euros(fila.base)}</td>
      <td className={`${TABLA.celda} ${TABLA.numero} ${TEXTO.t3}`}>{euros(fila.actual)}</td>
      <td className={`${TABLA.celda} ${TABLA.numero} ${TEXTO.t1} font-semibold`}>
        {euros(fila.destino)}
      </td>
      <td
        className={`${TABLA.celda} ${TABLA.numero}`}
        style={fuerte ? { color: COLOR_ESTADO.ambar, fontWeight: 600 } : undefined}
      >
        {fila.subida === null ? '—' : `+${fila.subida.toLocaleString('es-ES')} %`}
      </td>
      <td className={`${TABLA.celda} ${TEXTO.t3} max-w-[340px]`}>
        <span className={TABLA.corta} title={fila.titulo ?? undefined}>
          {fila.titulo ?? '—'}
        </span>
      </td>
      <td className={TABLA.celda}>
        <span className={`${TIPO.xs}`} style={{ color: COLOR_ESTADO[e.tono] }}>
          {e.rotulo}
        </span>
      </td>
    </tr>
  )
}
