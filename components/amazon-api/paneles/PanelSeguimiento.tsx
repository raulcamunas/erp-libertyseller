'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Eye,
  Play,
  Plug,
  Save,
  Scale,
} from 'lucide-react'
import { toast } from 'sonner'
import { getAmazon, patchAmazon, postAmazon } from '@/lib/amazon/client'
import {
  CAUSA_ACTIVO_LABELS,
  CRITERIO_DE_FABRICA,
  describirCriterio,
  type CausaActivo,
  type CriterioActivos,
} from '@/lib/plataforma/activos'
import type { ReglaRespuesta } from '@/lib/plataforma/cliente'
import type { SimulacroActivos } from '@/lib/plataforma/simulacro-activos'
import type { OrdenTope } from '@/lib/plataforma/tipos'
import {
  BOTON,
  CAMPO,
  CIFRAS,
  COLOR_ESTADO,
  LINEA,
  PANTALLA,
  RADIO,
  SUPERFICIE,
  TEXTO,
  TIPO,
  TITULO,
} from '@/lib/estilo/denso'
import { marketplaceLabel } from '@/lib/types/amazon'
import { Aviso, Cargando, Vacio, cifra } from '@/components/plataforma/comun'
import { ListaInfo, SeccionInfo } from '@/components/ui/BotonInfo'
import type { PropsPanel } from '../tipos'

/**
 * PESTAÑA «SEGUIMIENTO» — DE QUÉ NOS OCUPAMOS CADA NOCHE.
 *
 * A la izquierda EL CRITERIO, a la derecha SU EFECTO sobre el catálogo de verdad
 * antes de guardar. Las dos mitades juntas y no en dos pantallas, porque
 * separadas se configura a ciegas: trece interruptores y tres listas no dicen
 * cuántas de las 13.700 referencias de un cliente van a entrar en la ventana
 * nocturna, y equivocarse cuesta caro en los dos sentidos —revienta el cupo de
 * Amazon de esa cuenta, o deja referencias sin histórico, que no se recupera
 * hacia atrás—.
 *
 *
 * ============ EL SIMULACRO NO ESCRIBE NADA ============
 *
 * Lee el catálogo, decide en memoria y devuelve los números. Ni toca
 * amazon_listings, ni guarda la regla, ni gasta una llamada a Amazon. Se puede
 * pulsar las veces que haga falta mientras se afina el criterio.
 *
 * Y GUARDAR TAMPOCO MUEVE EL CONJUNTO. Cambia el criterio; los SKU se mueven en
 * el próximo «Recalcular SKU en seguimiento», que se lanza desde Ingesta. Es a
 * propósito: recalcular trece mil filas dentro de una petición HTTP la deja
 * colgada dos minutos.
 *
 *
 * ============ QUÉ HAY AQUÍ QUE NO ESTÉ EN INGESTA ============
 *
 * La pestaña Ingesta tiene la TABLA de SKU —fila a fila, con su motivo y la
 * posibilidad de contradecir la regla a mano— y un resumen del criterio. Lo que
 * no tiene, y es lo que se monta aquí, es EDITAR el criterio viendo el efecto
 * antes de guardarlo, y la mitad del BSR: de cuántas referencias se mide el
 * ranking y por qué de las demás no.
 *
 * Ese reparto es el mismo de todo el módulo: aquí se decide, allí se mira SKU a
 * SKU.
 *
 *
 * ============ NINGÚN UMBRAL ESTÁ GRABADO EN EL CÓDIGO ============
 *
 * Los valores de partida son los que siembra la migración 123 y se pueden cambiar
 * todos. Donde el valor honesto por defecto es «no actuar» —el mínimo de
 * unidades— el valor por defecto es no actuar: en blanco, la vía apagada.
 */
export function PanelSeguimiento({ data, conexionId, onConexionId }: PropsPanel) {
  const conexiones = useMemo(
    () => data.connections.filter((c) => c.is_active),
    [data.connections]
  )
  const nombrePorCliente = useMemo(
    () => new Map(data.clients.map((c) => [c.id, c.name])),
    [data.clients]
  )

  const conexion = conexiones.find((c) => c.id === conexionId) ?? null
  const clientId = conexion?.client_id ?? null

  const [marketplaceId, setMarketplaceId] = useState<string>('')

  // Al cambiar de cuenta, el país vuelve al principal de esa cuenta. Sin esto se
  // quedaría el de la anterior y la pantalla enseñaría un país donde el cliente
  // nuevo no vende, con todo a cero.
  useEffect(() => {
    if (!conexion) {
      setMarketplaceId('')
      return
    }
    setMarketplaceId(
      conexion.default_marketplace_id && conexion.marketplace_ids.includes(conexion.default_marketplace_id)
        ? conexion.default_marketplace_id
        : (conexion.marketplace_ids[0] ?? '')
    )
  }, [conexion])

  if (conexiones.length === 0) {
    return (
      <Vacio icono={<Plug />} titulo="Todavía no hay ninguna cuenta conectada">
        El criterio de seguimiento es por cliente, así que primero hay que conectar su cuenta de
        Amazon en la pestaña <span className={TEXTO.t1}>Cuentas</span>.
      </Vacio>
    )
  }

  return (
    <div className={`${PANTALLA.cuerpo} h-full`}>
      {/* Los anchos van con `max-w` y no con `w-auto`: CAMPO.input trae `w-full`
          y cuál de las dos gana lo decide el orden de la hoja compilada de
          Tailwind, no el orden en el atributo. */}
      <div className="flex shrink-0 flex-wrap items-center gap-[6px] min-w-0">
        <select
          value={conexionId ?? ''}
          onChange={(e) => onConexionId(e.target.value || null)}
          className={`${CAMPO.input} max-w-[240px]`}
          aria-label="Cuenta"
        >
          <option value="">Elige una cuenta…</option>
          {conexiones.map((c) => (
            <option key={c.id} value={c.id}>
              {nombrePorCliente.get(c.client_id) ?? c.name}
              {c.name && c.name !== nombrePorCliente.get(c.client_id) ? ` · ${c.name}` : ''}
            </option>
          ))}
        </select>

        {conexion && conexion.marketplace_ids.length > 0 && (
          <select
            value={marketplaceId}
            onChange={(e) => setMarketplaceId(e.target.value)}
            className={`${CAMPO.input} max-w-[170px]`}
            aria-label="País"
          >
            {conexion.marketplace_ids.map((m) => (
              <option key={m} value={m}>
                {marketplaceLabel(m)}
              </option>
            ))}
          </select>
        )}
      </div>

      {clientId && conexionId ? (
        <Editor
          key={`${clientId}·${conexionId}·${marketplaceId}`}
          clientId={clientId}
          connectionId={conexionId}
          marketplaceId={marketplaceId}
          marketplacesDeLaCuenta={conexion?.marketplace_ids ?? []}
        />
      ) : (
        <Vacio icono={<Eye />} titulo="Elige una cuenta">
          El criterio de qué referencias se refrescan cada noche es distinto en cada cliente.
        </Vacio>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* El editor                                                           */
/* ------------------------------------------------------------------ */

/** El formulario. Es el criterio más lo que la tabla guarda alrededor */
interface Formulario extends CriterioActivos {
  name: string
  marketplace_ids: string[]
  notes: string | null
}

const DE_FABRICA: Formulario = {
  ...CRITERIO_DE_FABRICA,
  name: 'Criterio del cliente',
  marketplace_ids: [],
  notes: null,
}

function Editor({
  clientId,
  connectionId,
  marketplaceId,
  marketplacesDeLaCuenta,
}: {
  clientId: string
  connectionId: string
  marketplaceId: string
  marketplacesDeLaCuenta: string[]
}) {
  const [f, setF] = useState<Formulario | null>(null)
  const [guardada, setGuardada] = useState<Formulario | null>(null)
  const [hayRegla, setHayRegla] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [simulacro, setSimulacro] = useState<SimulacroActivos | null>(null)
  const [simulando, setSimulando] = useState(false)
  /** La firma del criterio con el que se hizo el último simulacro */
  const [firmaSimulada, setFirmaSimulada] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)

  /** Para descartar respuestas de una cuenta que ya no es la que se mira */
  const vivo = useRef(true)
  useEffect(() => {
    vivo.current = true
    return () => {
      vivo.current = false
    }
  }, [])

  const firma = f ? JSON.stringify(criterioDe(f)) : ''

  const simular = useCallback(
    async (criterio: Formulario) => {
      setSimulando(true)
      const res = await postAmazon<SimulacroActivos>('/api/plataforma/reglas/simular', {
        clientId,
        connectionId,
        marketplaceId: marketplaceId || null,
        ...criterio,
      })
      if (!vivo.current) return
      setSimulando(false)
      if (!res.ok) {
        setError(res.error)
        return
      }
      setError(null)
      setSimulacro(res.data)
      setFirmaSimulada(JSON.stringify(criterioDe(criterio)))
    },
    [clientId, connectionId, marketplaceId]
  )

  useEffect(() => {
    let cancelado = false
    void (async () => {
      const res = await getAmazon<ReglaRespuesta>(`/api/plataforma/reglas?clientId=${clientId}`)
      if (cancelado || !vivo.current) return
      if (!res.ok) {
        setError(res.error)
        return
      }
      const regla = res.data.regla
      const inicial: Formulario = regla
        ? {
            name: regla.name,
            marketplace_ids: regla.marketplace_ids,
            incluir_fba: regla.incluir_fba,
            incluir_fbm: regla.incluir_fbm,
            incluir_marca_propia: regla.incluir_marca_propia,
            min_unidades: regla.min_unidades,
            ventana_dias: regla.ventana_dias,
            solo_listados_activos: regla.solo_listados_activos,
            excluir_sin_precio: regla.excluir_sin_precio,
            excluir_variacion_padre: regla.excluir_variacion_padre,
            marcas_excluidas: regla.marcas_excluidas,
            skus_excluidos: regla.skus_excluidos,
            skus_incluidos: regla.skus_incluidos,
            tope_skus: regla.tope_skus,
            orden_tope: regla.orden_tope,
            notes: regla.notes,
          }
        : DE_FABRICA
      setHayRegla(regla !== null)
      setF(inicial)
      setGuardada(inicial)
      // El primer simulacro sale solo, con el criterio TAL Y COMO ESTÁ GUARDADO:
      // es la foto de la que se parte, y sin ella los números de «entran» y
      // «salen» del primer cambio no tendrían con qué compararse.
      void simular(inicial)
    })()
    return () => {
      cancelado = true
    }
  }, [clientId, simular])

  async function guardar() {
    if (!f) return
    setGuardando(true)
    const res = await patchAmazon<ReglaRespuesta>('/api/plataforma/reglas', { clientId, ...f })
    setGuardando(false)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    toast.success(res.data.mensaje ?? 'Criterio guardado')
    setGuardada(f)
    setHayRegla(true)
  }

  if (error && !f) {
    return (
      <Aviso tono="rojo" icono={AlertTriangle}>
        {error}
      </Aviso>
    )
  }
  if (!f) return <Cargando texto="Leyendo el criterio…" />

  // Sin regla en vigor, guardar SIEMPRE está disponible aunque no se haya
  // tocado nada: lo que hay en pantalla son los valores de fábrica y el cliente
  // no tiene ninguno, así que «no ha cambiado nada» no puede dejar el botón
  // apagado — es justo el caso en el que hay que guardar.
  const sinGuardar = !hayRegla || (guardada !== null && JSON.stringify(f) !== JSON.stringify(guardada))
  const desactualizado = firmaSimulada !== null && firmaSimulada !== firma

  return (
    <div className="grid min-h-0 flex-1 gap-2 overflow-auto lg:grid-cols-[minmax(0,1fr)_340px] lg:overflow-hidden">
      {/* -------- El criterio -------- */}
      <div className="min-w-0 space-y-2 lg:min-h-0 lg:overflow-auto lg:pr-1">
        {!hayRegla && (
          <Aviso tono="ambar" icono={AlertTriangle}>
            Este cliente no tiene criterio en vigor: hoy no entra ninguna referencia en el refresco
            diario y no da ningún error. Guarda uno.
          </Aviso>
        )}

        <Grupo titulo="Qué entra">
          <Interruptor
            nombre="Todo lo de FBA"
            valor={f.incluir_fba}
            onCambio={(v) => setF({ ...f, incluir_fba: v })}
          />
          <Interruptor
            nombre="Todo lo de FBM"
            valor={f.incluir_fbm}
            onCambio={(v) => setF({ ...f, incluir_fbm: v })}
          />
          <Interruptor
            nombre="La marca propia del cliente"
            valor={f.incluir_marca_propia}
            onCambio={(v) => setF({ ...f, incluir_marca_propia: v })}
          />
          <div className={CAMPO.rejilla}>
            <Numero
              id="min-unidades"
              etiqueta="Mínimo de unidades vendidas"
              valor={f.min_unidades}
              min={0}
              vacio="apagado"
              onCambio={(v) => setF({ ...f, min_unidades: v })}
            />
            <Numero
              id="ventana-dias"
              etiqueta="En los últimos … días"
              valor={f.ventana_dias}
              min={1}
              max={365}
              onCambio={(v) => setF({ ...f, ventana_dias: v ?? 30 })}
            />
          </div>
        </Grupo>

        <Grupo titulo="Qué se cae">
          <Interruptor
            nombre="Solo lo que está a la venta"
            valor={f.solo_listados_activos}
            onCambio={(v) => setF({ ...f, solo_listados_activos: v })}
          />
          <Interruptor
            nombre="Fuera lo que no tiene precio"
            valor={f.excluir_sin_precio}
            onCambio={(v) => setF({ ...f, excluir_sin_precio: v })}
          />
          <Interruptor
            nombre="Fuera las variaciones padre"
            valor={f.excluir_variacion_padre}
            onCambio={(v) => setF({ ...f, excluir_variacion_padre: v })}
          />
        </Grupo>

        <Grupo titulo="El freno">
          <div className={CAMPO.rejilla}>
            <Numero
              id="tope-skus"
              etiqueta="Tope de referencias en seguimiento"
              valor={f.tope_skus}
              min={1}
              max={200000}
              onCambio={(v) => setF({ ...f, tope_skus: v ?? 1 })}
            />
            <div className={CAMPO.contenedor}>
              <label className={CAMPO.etiqueta} htmlFor="orden-tope">
                A quién se corta primero
              </label>
              <select
                id="orden-tope"
                value={f.orden_tope}
                onChange={(e) => setF({ ...f, orden_tope: e.target.value as OrdenTope })}
                className={CAMPO.input}
              >
                {(Object.keys(ETIQUETA_ORDEN) as OrdenTope[]).map((o) => (
                  <option key={o} value={o}>
                    Se ordena por {ETIQUETA_ORDEN[o]}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </Grupo>

        <Grupo titulo="Excepciones">
          <div className={CAMPO.rejilla}>
            <ListaTexto
              id="skus-incluidos"
              etiqueta="Referencias que se siguen siempre"
              valor={f.skus_incluidos}
              onCambio={(v) => setF({ ...f, skus_incluidos: v })}
            />
            <ListaTexto
              id="skus-excluidos"
              etiqueta="Referencias excluidas"
              valor={f.skus_excluidos}
              onCambio={(v) => setF({ ...f, skus_excluidos: v })}
            />
            <ListaTexto
              id="marcas-excluidas"
              etiqueta="Marcas excluidas"
              valor={f.marcas_excluidas}
              onCambio={(v) => setF({ ...f, marcas_excluidas: v })}
            />
          </div>
        </Grupo>

        {marketplacesDeLaCuenta.length > 1 && (
          <Grupo titulo="Países a los que se aplica">
            <div className="flex flex-wrap gap-[6px]">
              {marketplacesDeLaCuenta.map((m) => {
                const puesto = f.marketplace_ids.includes(m)
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() =>
                      setF({
                        ...f,
                        marketplace_ids: puesto
                          ? f.marketplace_ids.filter((x) => x !== m)
                          : [...f.marketplace_ids, m],
                      })
                    }
                    className={`${BOTON.chip} ${puesto ? BOTON.chipEncendido : ''}`}
                  >
                    {marketplaceLabel(m)}
                  </button>
                )
              })}
            </div>
            <p className={`${TIPO.s} ${TEXTO.t4}`}>Ninguno marcado = todos.</p>
          </Grupo>
        )}

        <p className={`${TIPO.s} ${TEXTO.t3}`}>{describirCriterio(f)}</p>
      </div>

      {/* -------- El efecto -------- */}
      <aside className="flex min-w-0 flex-col gap-2 lg:min-h-0">
        <div className={PANTALLA.fila}>
          <h2 className={TITULO.seccion}>El efecto</h2>
          <button
            type="button"
            onClick={() => void simular(f)}
            disabled={simulando}
            className={`${BOTON.base} ${desactualizado ? BOTON.primario : BOTON.secundario} ml-auto`}
          >
            <Play className="h-3 w-3" />
            {simulando ? 'Calculando…' : desactualizado ? 'Ver el efecto' : 'Recalcular'}
          </button>
        </div>

        {error && (
          <Aviso tono="rojo" icono={AlertTriangle}>
            {error}
          </Aviso>
        )}

        {simulacro ? (
          <div className="flex min-h-0 flex-1 flex-col gap-2 lg:overflow-auto">
            {desactualizado && (
              <p className={`${TIPO.s} ${TEXTO.acento}`}>
                Estos números son del criterio anterior.
              </p>
            )}
            <Efecto simulacro={simulacro} />
          </div>
        ) : simulando ? (
          <Cargando texto="Aplicando el criterio al catálogo…" />
        ) : null}

        <div className={`flex shrink-0 items-center gap-[6px] border-t pt-2 ${LINEA.normal}`}>
          <button
            type="button"
            onClick={() => void guardar()}
            disabled={guardando || !sinGuardar}
            className={`${BOTON.base} ${BOTON.primario} ${BOTON.alto}`}
          >
            <Save className="h-3 w-3" />
            {guardando ? 'Guardando…' : 'Guardar el criterio'}
          </button>
          {sinGuardar && <span className={`${TIPO.s} ${TEXTO.acento}`}>sin guardar</span>}
        </div>
      </aside>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* El resultado del simulacro                                          */
/* ------------------------------------------------------------------ */

function Efecto({ simulacro }: { simulacro: SimulacroActivos }) {
  const causas = useMemo(() => {
    const suma = new Map<CausaActivo, number>()
    for (const unidad of simulacro.unidades) {
      for (const c of unidad.causas) suma.set(c.causa, (suma.get(c.causa) ?? 0) + c.cuantos)
    }
    return [...suma.entries()].sort((a, b) => b[1] - a[1])
  }, [simulacro])

  const avisos = useMemo(
    () => [...new Set(simulacro.unidades.flatMap((u) => u.avisos))],
    [simulacro]
  )

  if (simulacro.evaluados === 0) {
    return (
      <Vacio icono={<Eye />} titulo="El espejo del catálogo está vacío">
        No hay ni una referencia traída de Amazon en esta cuenta y país, así que el criterio no
        tiene sobre qué aplicarse. Se configura igual: el censo del catálogo se lanza desde{' '}
        <span className={TEXTO.t1}>Ingesta</span>.
      </Vacio>
    )
  }

  return (
    <>
      {/* DOS TIRAS DE DOS Y NO UNA DE CUATRO: esta columna mide 340 px y
          CIFRAS.tira recorta lo que no cabe (`overflow-hidden`). Con las cuatro
          seguidas, «evaluadas» desaparecía sin dejar rastro — y es la cifra que
          da la escala a las otras tres. */}
      <div className={CIFRAS.tira}>
        <span className={`${CIFRAS.celda} flex-1`}>
          <span className={CIFRAS.valor}>{cifra(simulacro.activos)}</span>
          <span className={CIFRAS.rotulo}>en seguimiento</span>
        </span>
        <span className={`${CIFRAS.celda} flex-1`}>
          <span className={CIFRAS.valor}>{cifra(simulacro.evaluados)}</span>
          <span className={CIFRAS.rotulo}>evaluadas</span>
        </span>
      </div>
      <div className={CIFRAS.tira}>
        <span className={`${CIFRAS.celda} flex-1`}>
          <span className={`${CIFRAS.valor} ${simulacro.entran > 0 ? CIFRAS.urgente : ''}`}>
            {simulacro.entran > 0 ? '+' : ''}
            {cifra(simulacro.entran)}
          </span>
          <span className={CIFRAS.rotulo}>entran</span>
        </span>
        <span className={`${CIFRAS.celda} flex-1`}>
          <span className={`${CIFRAS.valor} ${simulacro.salen > 0 ? CIFRAS.urgente : ''}`}>
            {simulacro.salen > 0 ? '−' : ''}
            {cifra(simulacro.salen)}
          </span>
          <span className={CIFRAS.rotulo}>salen</span>
        </span>
      </div>

      {/* El tope es un freno que recorta cobertura: se dice en pantalla, no
          detrás del botón de información. Es accionable hoy. */}
      {simulacro.topeAlcanzado && (
        <Aviso tono="ambar" icono={Scale}>
          El tope deja fuera <strong>{cifra(simulacro.recortados)}</strong>. Sube el tope o estrecha
          el criterio.
        </Aviso>
      )}

      {simulacro.activos === 0 && (
        <Aviso tono="rojo" icono={AlertTriangle}>
          Ninguna referencia quedaría en seguimiento: el refresco diario no traería nada y no daría
          ningún error.
        </Aviso>
      )}

      {simulacro.truncado && (
        <Aviso tono="azul" icono={AlertTriangle}>
          Faltan {cifra(simulacro.unidadesSinSimular)} países por simular. Elige uno concreto arriba
          para verlo entero.
        </Aviso>
      )}

      <Bloque titulo="Por qué">
        <ul className="space-y-[3px]">
          {causas.map(([causa, cuantos]) => (
            <li key={causa} className="flex items-baseline gap-2">
              <span
                className="h-[7px] w-[7px] shrink-0 rounded-full"
                style={{
                  backgroundColor:
                    causa === 'entra' || causa === 'forzado'
                      ? COLOR_ESTADO.verde
                      : causa === 'tope'
                        ? COLOR_ESTADO.ambar
                        : causa === 'manual'
                          ? COLOR_ESTADO.naranja
                          : COLOR_ESTADO.gris,
                }}
                aria-hidden
              />
              <span className={`${TIPO.s} ${TEXTO.t2} min-w-0 flex-1 truncate`}>
                {CAUSA_ACTIVO_LABELS[causa]}
              </span>
              <span className={`${TIPO.s} ${TEXTO.t1} shrink-0 tabular-nums`}>
                {cifra(cuantos)}
              </span>
            </li>
          ))}
        </ul>
      </Bloque>

      <Bloque titulo="De cuáles se mediría el BSR">
        <ul className="space-y-[3px]">
          <li className="flex items-baseline gap-2">
            <span className={`${TIPO.s} ${TEXTO.t2} min-w-0 flex-1`}>Cada noche</span>
            <span className={`${TIPO.s} ${TEXTO.t1} shrink-0 tabular-nums`}>
              {cifra(simulacro.bsrDiario)}
            </span>
          </li>
          <li className="flex items-baseline gap-2">
            <span className={`${TIPO.s} ${TEXTO.t2} min-w-0 flex-1`}>Solo bajo demanda</span>
            <span className={`${TIPO.s} ${TEXTO.t1} shrink-0 tabular-nums`}>
              {cifra(simulacro.bsrBajoDemanda)}
            </span>
          </li>
        </ul>
        {simulacro.porQueSinBsr && (
          <p className={`${TIPO.s} ${TEXTO.t3} mt-[5px]`}>{simulacro.porQueSinBsr}</p>
        )}
      </Bloque>

      {simulacro.usaRotacion && simulacro.sinDatosDeVenta > 0 && (
        <Bloque titulo="Rotación">
          <p className={`${TIPO.s} ${TEXTO.t3}`}>
            {cifra(simulacro.sinDatosDeVenta)} referencias no tienen ventas importadas en la ventana.
            No se descartan por eso, pero tampoco entran por ahí.
          </p>
        </Bloque>
      )}

      {simulacro.unidades.some((u) => u.muestra.length > 0) && (
        <Bloque titulo="Qué se mueve">
          <ul className="space-y-[3px]">
            {simulacro.unidades.flatMap((u) =>
              u.muestra.map((m) => (
                <li key={`${u.connectionId}·${u.marketplaceId}·${m.sku}`} className="min-w-0">
                  <span className="flex items-baseline gap-[5px]">
                    {m.ahora ? (
                      <ArrowUpRight
                        className="h-3 w-3 shrink-0"
                        style={{ color: COLOR_ESTADO.verde }}
                      />
                    ) : (
                      <ArrowDownRight
                        className="h-3 w-3 shrink-0"
                        style={{ color: COLOR_ESTADO.gris }}
                      />
                    )}
                    <span className={`${TIPO.s} ${TEXTO.t1} truncate`}>{m.sku}</span>
                    <span className={`${TIPO.s} ${TEXTO.t4} ml-auto shrink-0`}>
                      {m.ahora ? 'entra' : 'sale'}
                    </span>
                  </span>
                  <span className={`${TIPO.s} ${TEXTO.t3} block truncate`} title={m.motivo}>
                    {m.motivo}
                  </span>
                </li>
              ))
            )}
          </ul>
        </Bloque>
      )}

      {avisos.map((aviso) => (
        <p key={aviso} className={`${TIPO.s} ${TEXTO.t3}`}>
          {aviso}
        </p>
      ))}
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Piezas                                                              */
/* ------------------------------------------------------------------ */

const ETIQUETA_ORDEN: Record<OrdenTope, string> = {
  ventas: 'unidades vendidas',
  bsr: 'ranking de ventas',
  precio: 'precio',
  sku: 'referencia',
}

/** El criterio a secas, sin el nombre ni las notas: es lo que se simula */
function criterioDe(f: Formulario): CriterioActivos {
  return {
    incluir_fba: f.incluir_fba,
    incluir_fbm: f.incluir_fbm,
    incluir_marca_propia: f.incluir_marca_propia,
    min_unidades: f.min_unidades,
    ventana_dias: f.ventana_dias,
    solo_listados_activos: f.solo_listados_activos,
    excluir_sin_precio: f.excluir_sin_precio,
    excluir_variacion_padre: f.excluir_variacion_padre,
    marcas_excluidas: f.marcas_excluidas,
    skus_excluidos: f.skus_excluidos,
    skus_incluidos: f.skus_incluidos,
    tope_skus: f.tope_skus,
    orden_tope: f.orden_tope,
  }
}

function Grupo({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <fieldset className={`${RADIO.r2} border ${LINEA.normal} ${SUPERFICIE.sup} px-[10px] py-[8px]`}>
      <legend className={`${TITULO.rotulo} px-[4px]`}>{titulo}</legend>
      <div className="space-y-[7px]">{children}</div>
    </fieldset>
  )
}

function Bloque({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section
      className={`${RADIO.r2} border ${LINEA.normal} ${SUPERFICIE.sup} px-[10px] py-[8px] min-w-0`}
    >
      <h3 className={`${TITULO.rotulo} mb-[5px]`}>{titulo}</h3>
      {children}
    </section>
  )
}

function Interruptor({
  nombre,
  valor,
  onCambio,
}: {
  nombre: string
  valor: boolean
  onCambio: (v: boolean) => void
}) {
  return (
    <label className="flex items-center gap-[7px]">
      <input
        type="checkbox"
        checked={valor}
        onChange={(e) => onCambio(e.target.checked)}
        className="h-[13px] w-[13px] shrink-0 accent-[var(--ls-acc-relleno)]"
      />
      <span className={`${TIPO.m} ${TEXTO.t1}`}>{nombre}</span>
    </label>
  )
}

function Numero({
  id,
  etiqueta,
  valor,
  min,
  max,
  vacio,
  onCambio,
}: {
  id: string
  etiqueta: string
  valor: number | null
  min?: number
  max?: number
  /** Qué se lee en el campo cuando está vacío. Es la única nota que se queda en
      pantalla: sin ella, «en blanco» y «cero» parecen lo mismo y no lo son */
  vacio?: string
  onCambio: (v: number | null) => void
}) {
  return (
    <div className={CAMPO.contenedor}>
      <label className={CAMPO.etiqueta} htmlFor={id}>
        {etiqueta}
      </label>
      <input
        id={id}
        type="number"
        min={min}
        max={max}
        value={valor ?? ''}
        onChange={(e) => onCambio(e.target.value === '' ? null : Number(e.target.value))}
        className={`${CAMPO.input} ${CAMPO.numero}`}
        placeholder={vacio}
      />
    </div>
  )
}

function ListaTexto({
  id,
  etiqueta,
  valor,
  onCambio,
}: {
  id: string
  etiqueta: string
  valor: string[]
  onCambio: (v: string[]) => void
}) {
  const [texto, setTexto] = useState(valor.join('\n'))

  return (
    <div className={CAMPO.contenedor}>
      <label className={CAMPO.etiqueta} htmlFor={id}>
        {etiqueta} {valor.length > 0 && <span className={TEXTO.acento}>· {valor.length}</span>}
      </label>
      <textarea
        id={id}
        value={texto}
        onChange={(e) => {
          setTexto(e.target.value)
          onCambio(enLineas(e.target.value))
        }}
        rows={2}
        className={`${CAMPO.input} h-auto resize-y py-[5px] leading-[1.5]`}
        placeholder="Una por línea"
      />
    </div>
  )
}

/** Una lista escrita a mano, admitiendo saltos de línea, comas y punto y coma */
function enLineas(texto: string): string[] {
  return [
    ...new Set(
      texto
        .split(/[\n,;\t]+/)
        .map((s) => s.trim())
        .filter((s) => s !== '')
    ),
  ]
}

/* ------------------------------------------------------------------ */
/* La información, detrás del botón                                    */
/* ------------------------------------------------------------------ */

export function InfoSeguimiento() {
  return (
    <>
      <SeccionInfo titulo="Son dos decisiones, no una">
        <ListaInfo>
          <li>
            <strong>Refresco diario</strong> — de qué referencias volvemos a leer precio, stock y
            estado cada noche. Es lo que se edita en esta pantalla.
          </li>
          <li>
            <strong>Medición de BSR</strong> — de cuáles, además, pedimos el ranking. Es un
            subconjunto mucho más pequeño y mucho más caro, y lo decide la política del cliente en la
            pestaña <strong>Cuentas</strong>. Aquí se ve a cuántas referencias acaba afectando.
          </li>
        </ListaInfo>
      </SeccionInfo>

      {/* El porqué de cada interruptor de «Qué entra». Estaba como nota debajo
          de cada uno en el editor duplicado que vivía en la sub-pestaña de
          Ingesta; al quitar aquel editor, el motivo se mueve aquí y no se
          pierde, que es la regla: el texto va detrás del botón, no a la basura. */}
      <SeccionInfo titulo="Por qué entra cada cosa">
        <ListaInfo>
          <li>
            <strong>Todo lo de FBA</strong> — si está en un almacén de Amazon cuesta dinero cada
            día, así que hay que mirarlo aunque venda poco.
          </li>
          <li>
            <strong>Todo lo de FBM</strong> — con catálogos grandes esto lo mete casi todo. Para FBM
            la puerta suele ser la rotación, no el canal.
          </li>
          <li>
            <strong>La marca propia del cliente</strong> — si es suya, se mira aunque venda poco:
            son las referencias sobre las que se hace marketing y sobre las que su ranking dice algo
            de su cuenta.
          </li>
        </ListaInfo>
      </SeccionInfo>

      <SeccionInfo titulo="El efecto se calcula sobre el catálogo de verdad, y no escribe nada">
        <p>
          «Ver el efecto» aplica el criterio que hay en pantalla sobre las referencias reales del
          cliente y cuenta cuántas entrarían, cuántas saldrían y por qué. <strong>No guarda</strong>{' '}
          la regla, no toca el catálogo y no gasta ni una llamada a Amazon: se puede pulsar las veces
          que haga falta.
        </p>
        <p>
          Sin esto, un criterio se configura a ciegas: trece interruptores no dicen cuántas de las
          trece mil referencias de un cliente van a acabar en la ventana nocturna.
        </p>
      </SeccionInfo>

      <SeccionInfo titulo="Guardar no mueve ninguna referencia">
        <p>
          Cambia el criterio; el conjunto se mueve en el próximo{' '}
          <strong>«Recalcular SKU en seguimiento»</strong>, que se lanza desde la pestaña Ingesta y
          no gasta cupo de Amazon. Es a propósito: recalcular trece mil filas dentro de una petición
          la dejaría colgada dos minutos sin saber si guardó.
        </p>
      </SeccionInfo>

      <SeccionInfo titulo="Lo que dijo una persona gana siempre">
        <p>
          Una referencia marcada a mano —en la tabla de SKU de la pestaña Ingesta— no la mueve ningún
          recálculo, ni para dentro ni para fuera. Por eso los movimientos que cuenta el simulacro
          nunca las incluyen: sería contar cambios que no van a ocurrir.
        </p>
      </SeccionInfo>

      <SeccionInfo titulo="El tope es el freno, y hace ruido a propósito">
        <p>
          Cuando el criterio selecciona más referencias que el tope, se ordenan y se corta. El corte
          se avisa siempre: un freno silencioso es una pérdida de cobertura que nadie ve. Y el
          desempate final va por referencia, para que dos recálculos seguidos den exactamente la
          misma lista — sin eso, una referencia entraría y saldría cada noche y su histórico quedaría
          lleno de huecos inexplicables.
        </p>
      </SeccionInfo>

      <SeccionInfo titulo="Los umbrales los pones tú">
        <p>
          Ningún criterio viene grabado en el código. Y donde el valor honesto por defecto es{' '}
          <strong>no actuar</strong>, lo es: el mínimo de unidades vendidas en blanco significa que
          esa vía está apagada, no que el mínimo sea cero.
        </p>
        <p>
          Una referencia sin datos de ventas <strong>no se descarta</strong> por rotación: no se le
          castiga por un dato que nos falta a nosotros.
        </p>
      </SeccionInfo>

      <SeccionInfo titulo="Ancho y estrecho cuestan caro los dos">
        <ListaInfo>
          <li>
            Demasiado ancho revienta el cupo de Amazon de esa cuenta —se cuenta por vendedor— y la
            ventana nocturna deja de caber.
          </li>
          <li>
            Demasiado estrecho deja referencias sin histórico, y el histórico{' '}
            <strong>no se recupera hacia atrás</strong>: el ranking de un día que no se guardó se
            perdió.
          </li>
        </ListaInfo>
      </SeccionInfo>
    </>
  )
}
