'use client'

import { useMemo, useRef, useState } from 'react'
import { Check, Loader2, Search, Square, TriangleAlert, X } from 'lucide-react'
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
import {
  ALCANCES,
  DESVIO_SOSPECHOSO,
  ESTADO_LABELS,
  MAX_CORREGIR,
  MAX_LEER,
  type Alcance,
  type EstadoLimites,
} from '@/lib/precios-limites/diagnostico'
import type { FilaConError, ResultadoFila } from '@/lib/precios-limites/servidor'

/**
 * SINCRONIZAR PRECIO MÍNIMO Y MÁXIMO — LA PANTALLA.
 *
 * Se elige el país y hasta dónde mirar, se pulsa «Buscar» y sale la lista de los
 * listings con el precio fuera de su rango, con lo que se haría en cada uno. Se
 * revisa, se desmarca lo que no se quiera y se corrige todo de un clic.
 *
 * El cliente se elige arriba, en el selector de Growth Partner, igual que en el
 * resto de submódulos.
 *
 *
 * ============ QUÉ ENSEÑA Y POR QUÉ ASÍ ============
 *
 * Cada fila dice el precio, el mínimo y el máximo de HOY y lo que quedaría. Lo
 * que se hace es siempre lo mismo —el límite roto pasa a valer el precio— y por
 * eso no hay nada que calcular a ojo: lo que hay que mirar es EL DESVÍO. Un
 * mínimo que está un 2 % por encima del precio es un mínimo viejo. Uno que está
 * un 80 % por encima suele ser un precio mal puesto, y «arreglarlo» bajando el
 * suelo dejaría vender a un precio que nadie quería. Va ordenado de mayor
 * desvío a menor para que lo raro salga arriba, y avisa de cuántas pasan del
 * 25 %.
 *
 *
 * ============ LO QUE SE APRENDIÓ EN PRECIOS SHOPLAMP ============
 *
 * Aquí se repiten las precauciones que allí costaron un fallo:
 *
 *   · «Corregido» se fija ANTES de empezar a mandar, no al terminar. Si una
 *     petición del medio revienta, las anteriores YA están en la tienda, y el
 *     panel no puede llamarlas simulación.
 *   · Se cuenta cuántas se pidieron y cuántas llegaron a salir: «200 de 630» no
 *     se lee como «las 630».
 *   · Se quita de la lista lo que ya se corrigió, para que un segundo clic no
 *     vuelva a mandar lo mismo.
 *   · Mientras se trabaja no se puede cambiar de país ni volver a buscar.
 */

const euros = (v: number | null) =>
  v === null ? '—' : v.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const pct = (v: number) => `${Math.round(v * 100).toLocaleString('es-ES')} %`

interface Mercado {
  id: string
  label: string
}

interface Candidato {
  sku: string
  titulo: string | null
}

interface Resumen {
  leidas: number
  correctas: number
  sinPrecio: number
  noVinieron: number
  total: number
}

const RESUMEN_VACIO: Resumen = { leidas: 0, correctas: 0, sinPrecio: 0, noVinieron: 0, total: 0 }

async function llamar<T>(cuerpo: Record<string, unknown>): Promise<T> {
  const res = await fetch('/api/precios-limites', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpo),
  })
  const json = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new Error(json.error ?? `El servidor ha contestado ${res.status}`)
  return json
}

export function TableroLimitesPrecio({
  clientId,
  mercados,
  mercadoInicial,
}: {
  clientId: string
  mercados: Mercado[]
  mercadoInicial: string
}) {
  const [mercado, setMercado] = useState(mercadoInicial)
  const [alcance, setAlcance] = useState<Alcance>('sin_comprar')

  const [buscando, setBuscando] = useState(false)
  const [haBuscado, setHaBuscado] = useState(false)
  const [progreso, setProgreso] = useState<{ hechas: number; total: number } | null>(null)
  const [resumen, setResumen] = useState<Resumen>(RESUMEN_VACIO)
  const [filas, setFilas] = useState<FilaConError[]>([])
  const [titulos, setTitulos] = useState<ReadonlyMap<string, string | null>>(new Map())
  const [marcadas, setMarcadas] = useState<ReadonlySet<string>>(new Set())
  const [busca, setBusca] = useState('')
  const [soloSospechosas, setSoloSospechosas] = useState(false)
  const parar = useRef(false)

  const [trabajando, setTrabajando] = useState<null | 'simulando' | 'corrigiendo'>(null)
  const [confirmando, setConfirmando] = useState(false)
  const [hechos, setHechos] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [resultados, setResultados] = useState<ResultadoFila[] | null>(null)
  const [aplicado, setAplicado] = useState(false)
  const [cobertura, setCobertura] = useState<{ total: number; intentadas: number } | null>(null)

  const ocupado = buscando || trabajando !== null

  function limpiar() {
    setHaBuscado(false)
    setProgreso(null)
    setResumen(RESUMEN_VACIO)
    setFilas([])
    setMarcadas(new Set())
    setBusca('')
    setSoloSospechosas(false)
    setConfirmando(false)
    setError(null)
    setResultados(null)
    setAplicado(false)
    setCobertura(null)
  }

  /* ---------------- Buscar ---------------- */
  async function buscar() {
    limpiar()
    parar.current = false
    setBuscando(true)
    setHaBuscado(true)

    const acumuladas: FilaConError[] = []
    const r: Resumen = { ...RESUMEN_VACIO }

    try {
      setProgreso({ hechas: 0, total: 0 })
      const c = await llamar<{ candidatos: Candidato[] }>({
        accion: 'candidatos',
        clientId,
        marketplaceId: mercado,
        alcance,
      })
      const lista = c.candidatos
      r.total = lista.length
      setResumen({ ...r })
      setTitulos(new Map(lista.map((x) => [x.sku, x.titulo])))

      if (lista.length === 0) {
        setProgreso(null)
        return
      }

      for (let i = 0; i < lista.length; i += MAX_LEER) {
        if (parar.current) break
        const tramo = lista.slice(i, i + MAX_LEER).map((x) => x.sku)
        const l = await llamar<{
          leidas: number
          correctas: number
          sinPrecio: number
          noVinieron: number
          errores: FilaConError[]
        }>({ accion: 'leer', clientId, marketplaceId: mercado, skus: tramo })

        r.leidas += l.leidas
        r.correctas += l.correctas
        r.sinPrecio += l.sinPrecio
        r.noVinieron += l.noVinieron
        acumuladas.push(...l.errores)

        setResumen({ ...r })
        setProgreso({ hechas: Math.min(i + MAX_LEER, lista.length), total: lista.length })
        // Ordenadas de mayor desvío a menor: lo raro, arriba. Ver la cabecera.
        setFilas([...acumuladas].sort((a, b) => b.desvio - a.desvio || a.sku.localeCompare(b.sku)))
        // Se marcan las nuevas, no todo: si alguien desmarca una mientras se
        // sigue leyendo, el siguiente tramo no se la vuelve a marcar.
        setMarcadas((prev) => {
          const s = new Set(prev)
          for (const f of l.errores) s.add(f.sku)
          return s
        })
      }
    } catch (e) {
      // Lo ya leído se queda en pantalla: perder cuarenta tramos por el último
      // no tiene sentido, y se dice que se quedó a medias.
      setError(
        (e instanceof Error ? e.message : 'Ha fallado la lectura') +
          (acumuladas.length > 0 ? ' Lo leído hasta aquí se queda en pantalla.' : '')
      )
    } finally {
      setBuscando(false)
    }
  }

  /* ---------------- Corregir ---------------- */
  async function lanzar(simular: boolean) {
    const seleccion = filas.filter((f) => marcadas.has(f.sku))
    if (seleccion.length === 0) return

    setTrabajando(simular ? 'simulando' : 'corrigiendo')
    setConfirmando(false)
    setError(null)
    setResultados(null)
    setHechos(0)

    // ANTES DEL BUCLE. Si una petición del medio revienta, las anteriores ya
    // están en la tienda del cliente y el panel no puede llamarlas simulación.
    setAplicado(!simular)

    const total = seleccion.length
    let intentadas = 0
    setCobertura({ total, intentadas: 0 })
    const acumulado: ResultadoFila[] = []

    try {
      for (let i = 0; i < seleccion.length; i += MAX_CORREGIR) {
        const tramo = seleccion.slice(i, i + MAX_CORREGIR)
        // Se cuentan ANTES de salir: una petición que revienta deja sus filas en
        // «salieron y no sabemos qué pasó», que es la verdad.
        intentadas += tramo.length
        setCobertura({ total, intentadas })

        const json = await llamar<{ resultados: ResultadoFila[]; abortReason: string | null }>({
          accion: 'corregir',
          clientId,
          marketplaceId: mercado,
          skus: tramo.map((f) => f.sku),
          simular,
        })

        acumulado.push(...json.resultados)
        setResultados([...acumulado])
        setHechos(Math.min(i + MAX_CORREGIR, total))

        if (!simular) {
          // Fuera de la lista lo que ya está corregido y lo que ya estaba bien.
          // Lo rechazado se queda para poder reintentarlo.
          const resueltos = new Set(
            json.resultados
              .filter((r) => r.estado === 'aceptado' || r.estado === 'omitido')
              .map((r) => r.sku)
          )
          setFilas((prev) => prev.filter((f) => !resueltos.has(f.sku)))
          setMarcadas((prev) => {
            const s = new Set(prev)
            for (const sku of resueltos) s.delete(sku)
            return s
          })
        }

        if (json.abortReason) {
          setError(json.abortReason)
          break
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ha fallado el envío')
    } finally {
      setTrabajando(null)
    }
  }

  /* ---------------- Derivados ---------------- */
  const sospechosas = useMemo(() => filas.filter((f) => f.desvio >= DESVIO_SOSPECHOSO), [filas])

  const visibles = useMemo(() => {
    const t = busca.trim().toLowerCase()
    return filas.filter((f) => {
      if (soloSospechosas && f.desvio < DESVIO_SOSPECHOSO) return false
      if (!t) return true
      return f.sku.toLowerCase().includes(t) || (titulos.get(f.sku) ?? '').toLowerCase().includes(t)
    })
  }, [filas, busca, soloSospechosas, titulos])

  const nMarcadas = useMemo(() => filas.filter((f) => marcadas.has(f.sku)).length, [filas, marcadas])
  const sospechosasMarcadas = useMemo(
    () => sospechosas.filter((f) => marcadas.has(f.sku)).length,
    [sospechosas, marcadas]
  )

  const alternar = (sku: string) =>
    setMarcadas((prev) => {
      const s = new Set(prev)
      if (s.has(sku)) s.delete(sku)
      else s.add(sku)
      return s
    })

  const marcarVisibles = (si: boolean) =>
    setMarcadas((prev) => {
      const s = new Set(prev)
      for (const f of visibles) {
        if (si) s.add(f.sku)
        else s.delete(f.sku)
      }
      return s
    })

  const aceptados = resultados?.filter((r) => r.estado === 'aceptado').length ?? 0
  const omitidos = resultados?.filter((r) => r.estado === 'omitido').length ?? 0
  const fallidos = resultados?.filter((r) => r.estado === 'invalido' || r.estado === 'error') ?? []
  const noAceptados = resultados?.filter((r) => r.estado !== 'aceptado') ?? []

  const resueltas = resultados?.length ?? 0
  const sinIntentar = cobertura ? Math.max(0, cobertura.total - cobertura.intentadas) : 0
  const enDuda = cobertura ? Math.max(0, cobertura.intentadas - resueltas) : 0

  const alcanceActual = ALCANCES.find((a) => a.id === alcance)

  return (
    // `h-full` Y NO `flex-1`: la carcasa de Growth mete los paneles en un div que
    // no es contenedor flex, y con `flex-1` la columna crece con su contenido y
    // la tabla deja de scrollear por dentro. Medido en Precios Shoplamp: la barra
    // de acciones se iba a 35.000 px. Todo lo que no es la tabla lleva `shrink-0`.
    <div className={`${PANTALLA.cuerpo} h-full`}>
      {/* ---------- Qué se busca ---------- */}
      <div className="flex shrink-0 flex-wrap items-end gap-[9px]">
        <label className={CAMPO.contenedor}>
          <span className={CAMPO.etiqueta}>País</span>
          <select
            value={mercado}
            disabled={ocupado}
            onChange={(e) => {
              setMercado(e.target.value)
              limpiar()
            }}
            className={`${CAMPO.input} w-[170px]`}
          >
            {mercados.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>

        <label className={CAMPO.contenedor}>
          <span className={CAMPO.etiqueta}>Qué mirar</span>
          <select
            value={alcance}
            disabled={ocupado}
            onChange={(e) => {
              setAlcance(e.target.value as Alcance)
              limpiar()
            }}
            className={`${CAMPO.input} w-[260px]`}
            title={alcanceActual?.pista}
          >
            {ALCANCES.map((a) => (
              <option key={a.id} value={a.id}>
                {a.rotulo}
              </option>
            ))}
          </select>
        </label>

        {buscando ? (
          <button
            type="button"
            className={`${BOTON.base} ${BOTON.alto} ${BOTON.secundario}`}
            onClick={() => {
              parar.current = true
            }}
          >
            <Square className="h-3 w-3" />
            Parar
          </button>
        ) : (
          <button
            type="button"
            className={`${BOTON.base} ${BOTON.alto} ${haBuscado ? BOTON.secundario : BOTON.primario}`}
            disabled={trabajando !== null}
            onClick={buscar}
          >
            <Search className="h-3 w-3" />
            {haBuscado ? 'Volver a buscar' : 'Buscar errores de precio'}
          </button>
        )}

        {buscando && progreso && (
          <span className={`${TIPO.s} ${TEXTO.t3} flex items-center gap-[5px] pb-[5px]`}>
            <Loader2 className="h-3 w-3 animate-spin" />
            {progreso.total === 0
              ? 'Preparando la lista…'
              : `Leyendo de Amazon · ${progreso.hechas.toLocaleString('es-ES')} de ${progreso.total.toLocaleString('es-ES')}`}
          </span>
        )}
      </div>

      <p className={`${TIPO.s} ${TEXTO.t4} shrink-0`}>{alcanceActual?.pista}</p>

      {/* ---------- Cifras ---------- */}
      {haBuscado && (
        <div className={`${CIFRAS.tira} shrink-0`}>
          <div className={CIFRAS.celda}>
            <span className={CIFRAS.valor}>{resumen.leidas.toLocaleString('es-ES')}</span>
            <span className={CIFRAS.rotulo}>
              revisadas{resumen.total > 0 ? ` de ${resumen.total.toLocaleString('es-ES')}` : ''}
            </span>
          </div>
          <div className={CIFRAS.celda}>
            <span className={`${CIFRAS.valor} ${filas.length > 0 ? CIFRAS.urgente : ''}`}>
              {filas.length.toLocaleString('es-ES')}
            </span>
            <span className={CIFRAS.rotulo}>con el precio fuera de rango</span>
          </div>
          <div className={CIFRAS.celda}>
            <span className={CIFRAS.valor}>{resumen.correctas.toLocaleString('es-ES')}</span>
            <span className={CIFRAS.rotulo}>bien</span>
          </div>
          {resumen.sinPrecio > 0 && (
            <div className={CIFRAS.celda}>
              <span className={CIFRAS.valor}>{resumen.sinPrecio.toLocaleString('es-ES')}</span>
              <span className={CIFRAS.rotulo}>sin precio</span>
            </div>
          )}
          {resumen.noVinieron > 0 && (
            <div className={CIFRAS.celda}>
              <span className={CIFRAS.valor}>{resumen.noVinieron.toLocaleString('es-ES')}</span>
              <span className={CIFRAS.rotulo}>que Amazon ya no devuelve</span>
            </div>
          )}
        </div>
      )}

      {/* ---------- Lo sospechoso ---------- */}
      {sospechosas.length > 0 && (
        <div
          className={`${AVISO.base} ${AVISO.conTono} shrink-0`}
          style={{ borderLeftColor: COLOR_ESTADO.ambar }}
        >
          <TriangleAlert className={AVISO.icono} style={{ color: COLOR_ESTADO.ambar }} />
          <div className={`${TIPO.s} ${TEXTO.t2}`}>
            <strong>
              {sospechosas.length.toLocaleString('es-ES')} tienen el precio más de un{' '}
              {Math.round(DESVIO_SOSPECHOSO * 100)} % fuera de su límite.
            </strong>{' '}
            Aquí lo raro puede ser el <strong>precio</strong> y no el límite: bajar el mínimo dejaría
            vender a un precio que quizá nadie quería. Salen arriba, ordenadas de mayor a menor
            desvío, y se pueden desmarcar.{' '}
            <button type="button" className="underline" onClick={() => setSoloSospechosas((v) => !v)}>
              {soloSospechosas ? 'Ver todas' : 'Ver solo esas'}
            </button>
          </div>
        </div>
      )}

      {/* ---------- Tabla ---------- */}
      {haBuscado && (
        <>
          <div className="flex shrink-0 items-center gap-[6px]">
            <label className="relative w-[240px]">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-[var(--ls-t4)]" />
              <input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="SKU o título"
                className={`${CAMPO.input} pl-[26px]`}
              />
            </label>
            <span className={`${TIPO.s} ${TEXTO.t4}`}>
              {visibles.length.toLocaleString('es-ES')} visibles
            </span>
          </div>

          <div className={TABLA.caja}>
            <table className={TABLA.tabla}>
              <thead>
                <tr>
                  <th className={`${TABLA.cabecera} w-7`}>
                    <input
                      type="checkbox"
                      aria-label="Marcar todo lo visible"
                      className="h-3 w-3 align-middle"
                      disabled={visibles.length === 0 || ocupado}
                      checked={visibles.length > 0 && visibles.every((f) => marcadas.has(f.sku))}
                      onChange={(e) => marcarVisibles(e.target.checked)}
                    />
                  </th>
                  <th className={TABLA.cabecera}>SKU</th>
                  <th className={TABLA.cabecera}>Título</th>
                  <th className={`${TABLA.cabecera} ${TABLA.derecha}`}>Precio</th>
                  <th className={`${TABLA.cabecera} ${TABLA.derecha}`}>Mínimo</th>
                  <th className={`${TABLA.cabecera} ${TABLA.derecha}`}>Máximo</th>
                  <th className={TABLA.cabecera}>Se corrige</th>
                  <th className={`${TABLA.cabecera} ${TABLA.derecha}`}>Desvío</th>
                </tr>
              </thead>
              <tbody>
                {visibles.length === 0 && (
                  <tr>
                    <td colSpan={8} className={`${TABLA.celda} ${TEXTO.t4} text-center`}>
                      {buscando
                        ? 'Buscando…'
                        : resumen.total === 0
                          ? 'No hay ninguna referencia que mirar con este alcance. Si es un país que no está activado para la ingesta, no tenemos su catálogo: se activa en Amazon API · Cuentas.'
                          : filas.length === 0
                            ? 'Ninguna tiene el precio fuera de su rango.'
                            : 'Nada que enseñar con estos filtros.'}
                    </td>
                  </tr>
                )}
                {visibles.map((f) => (
                  <Fila
                    key={f.sku}
                    fila={f}
                    titulo={titulos.get(f.sku) ?? null}
                    marcada={marcadas.has(f.sku)}
                    bloqueada={ocupado}
                    onToggle={() => alternar(f.sku)}
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
              <strong>{nMarcadas.toLocaleString('es-ES')}</strong> marcadas
            </span>
            <span className={`${TIPO.s} ${TEXTO.t3}`}>
              de {filas.length.toLocaleString('es-ES')} con error
              {sospechosasMarcadas > 0 && (
                <>
                  {' · '}
                  <span style={{ color: COLOR_ESTADO.ambar }}>
                    {sospechosasMarcadas.toLocaleString('es-ES')} con desvío alto
                  </span>
                </>
              )}
            </span>

            {trabajando && (
              <span className={`${TIPO.s} ${TEXTO.t3} flex items-center gap-[5px]`}>
                <Loader2 className="h-3 w-3 animate-spin" />
                {trabajando === 'simulando' ? 'Simulando' : 'Corrigiendo'}{' '}
                {hechos.toLocaleString('es-ES')} / {nMarcadas.toLocaleString('es-ES')}
              </span>
            )}

            <div className="ml-auto flex items-center gap-[9px]">
              {confirmando ? (
                <>
                  <span className={`${TIPO.s} ${TEXTO.t2}`}>
                    Se va a escribir en <strong>{nMarcadas.toLocaleString('es-ES')}</strong> listings de
                    Amazon.
                  </span>
                  <button
                    type="button"
                    className={`${BOTON.base} ${BOTON.alto} ${BOTON.secundario}`}
                    onClick={() => setConfirmando(false)}
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    className={`${BOTON.base} ${BOTON.alto} ${BOTON.primario}`}
                    onClick={() => lanzar(false)}
                  >
                    Sí, corregir
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className={`${BOTON.base} ${BOTON.alto} ${BOTON.secundario}`}
                    disabled={nMarcadas === 0 || ocupado}
                    title="Pregunta a Amazon si aceptaría los cambios. No cambia nada ni deja registro."
                    onClick={() => lanzar(true)}
                  >
                    Simular en Amazon
                  </button>
                  <button
                    type="button"
                    className={`${BOTON.base} ${BOTON.alto} ${BOTON.primario}`}
                    disabled={nMarcadas === 0 || ocupado}
                    onClick={() => setConfirmando(true)}
                  >
                    Corregir {nMarcadas.toLocaleString('es-ES')}
                  </button>
                </>
              )}
            </div>
          </div>
        </>
      )}

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
                ? `Corregido: ${aceptados.toLocaleString('es-ES')} de ${(cobertura?.total ?? resueltas).toLocaleString('es-ES')}`
                : `Simulación: ${aceptados.toLocaleString('es-ES')} de ${(cobertura?.total ?? resueltas).toLocaleString('es-ES')} las aceptaría`
            }
            derecha={
              fallidos.length > 0 ? (
                <span className={TIPO.xs} style={{ color: COLOR_ESTADO.rojo }}>
                  {fallidos.length.toLocaleString('es-ES')} rechazados
                </span>
              ) : (
                <Check className="h-3 w-3" style={{ color: COLOR_ESTADO.verde }} />
              )
            }
          >
            {(sinIntentar > 0 || enDuda > 0) && (
              <p className={`${TIPO.s} mb-[6px]`} style={{ color: COLOR_ESTADO.ambar }}>
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
                .{' '}
                {aplicado
                  ? 'Vuelve a buscar para ver lo que queda.'
                  : 'La simulación no cubre todo lo marcado.'}
              </p>
            )}

            {omitidos > 0 && (
              <p className={`${TIPO.s} ${TEXTO.t3} mb-[6px]`}>
                {omitidos.toLocaleString('es-ES')} ya no tenían error cuando se fue a corregir —se
                vuelve a leer su precio justo antes—, así que no se han tocado.
              </p>
            )}

            {noAceptados.length === 0 ? (
              <p className={`${TIPO.s} ${TEXTO.t3}`}>
                {aplicado
                  ? 'Amazon ha aceptado todos. El estado del listing tarda unos minutos en pasar de «Error de precio» a activo.'
                  : 'Amazon aceptaría todos. Ya se pueden corregir.'}
              </p>
            ) : (
              <div className="max-h-[180px] overflow-auto">
                <table className={TABLA.tabla}>
                  <tbody>
                    {noAceptados.slice(0, 200).map((r, i) => (
                      <tr key={`${r.sku}|${i}`} className={TABLA.fila}>
                        <td className={`${TABLA.celda} font-mono text-[11.5px]`}>{r.sku}</td>
                        <td className={`${TABLA.celda} ${TEXTO.t3} whitespace-normal`}>
                          {r.mensaje?.trim() ? r.mensaje : `Amazon lo ha marcado como «${r.estado}»`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {noAceptados.length > 200 && (
                  <p className={`${TIPO.s} ${TEXTO.t4} px-2 py-1`}>
                    y {(noAceptados.length - 200).toLocaleString('es-ES')} más
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

function Fila({
  fila,
  titulo,
  marcada,
  bloqueada,
  onToggle,
}: {
  fila: FilaConError
  titulo: string | null
  marcada: boolean
  bloqueada: boolean
  onToggle: () => void
}) {
  const sospechosa = fila.desvio >= DESVIO_SOSPECHOSO
  const rotas = fila.minimoNuevo !== null && fila.maximoNuevo !== null ? 'ambos' : null
  const que =
    rotas ??
    (fila.minimoNuevo !== null ? 'Mínimo' : 'Máximo')

  return (
    <tr className={`${TABLA.fila} ${marcada ? TABLA.filaSel : ''}`}>
      <td className={TABLA.celda}>
        <input
          type="checkbox"
          aria-label={`Marcar ${fila.sku}`}
          className="h-3 w-3 align-middle"
          checked={marcada}
          disabled={bloqueada}
          onChange={onToggle}
        />
      </td>
      <td className={`${TABLA.celda} font-mono text-[11.5px]`}>{fila.sku}</td>
      <td className={`${TABLA.celda} ${TEXTO.t3} max-w-[300px]`}>
        <span className={TABLA.corta} title={titulo ?? undefined}>
          {titulo ?? '—'}
        </span>
      </td>
      <td className={`${TABLA.celda} ${TABLA.numero} ${TEXTO.t1} font-semibold`}>{euros(fila.precio)}</td>
      <td
        className={`${TABLA.celda} ${TABLA.numero}`}
        style={fila.minimoNuevo !== null ? { color: COLOR_ESTADO.rojo } : undefined}
      >
        {euros(fila.minimo)}
      </td>
      <td
        className={`${TABLA.celda} ${TABLA.numero}`}
        style={fila.maximoNuevo !== null ? { color: COLOR_ESTADO.rojo } : undefined}
      >
        {euros(fila.maximo)}
      </td>
      <td className={TABLA.celda}>
        <span className={TIPO.xs} style={{ color: COLOR_ESTADO.azul }}>
          {que === 'ambos'
            ? `Mín. y máx. → ${euros(fila.precio)}`
            : `${que} → ${euros(fila.precio)}`}
        </span>
      </td>
      <td
        className={`${TABLA.celda} ${TABLA.numero}`}
        title={ESTADO_LABELS[fila.estado as EstadoLimites] ?? undefined}
        style={sospechosa ? { color: COLOR_ESTADO.ambar, fontWeight: 600 } : undefined}
      >
        {pct(fila.desvio)}
      </td>
    </tr>
  )
}
