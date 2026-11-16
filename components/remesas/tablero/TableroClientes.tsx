'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CalendarClock, ChevronDown, Columns3, KanbanSquare, PackagePlus, RefreshCw, Send, Truck } from 'lucide-react'
import { MotionConfig } from 'framer-motion'
import { BarraDeProgreso, Boton, Chispa, EstadoVacio, EsqueletoTarjeta, Insignia, Segmentado, TACTIL } from '@/components/ui-ls'
import { COLOR_ESTADO, type TonoEstado } from '@/lib/estilo/denso'
import type { TarjetaDeTablero } from '@/lib/fba/tablero-propuestas'
import { ESTADO_INBOUND_TEXTO } from '@/lib/fba/inbound-estados'
import { esEnvioDudoso } from '@/lib/fba/llegadas'
import type { EnCamino, ResumenGlobal, SaludCliente, TonoSalud } from '@/lib/fba/plan-tipos'
import { estaVivo, ordenarColumnas, ordenarTarjetas, type ColumnaTablero, type TarjetaTablero } from '@/lib/fba/tablero'
import { ESTADOS_AMAZON_MALOS } from '@/lib/fba/vista'
import { diasEntre, fecha, fechaCorta, unidades } from '../formato'
import { SALUD } from '../comun/estilo-plan'
import type { SesionRemesas } from '../comun/tipos-ui'
import { cx } from '../comun/ui'
import { useAgencia } from '../comun/useAgencia'
import { TableroRemesas } from './TableroRemesas'

/**
 * EL TABLERO DE REMESAS (vista `tablero`, spec remesas-pro §8, D39 y D42): una columna por cliente con sus envíos vivos.
 *
 * Dos modos, con un `Segmentado` arriba (solo agencia):
 *   Envíos                 una columna por cliente. La cabecera lleva la MINI-SALUD (de GET /api/fba/resumen): el punto de
 *                          cuatro tonos (rojo · ámbar · verde · gris «sin datos»), vendible, de camino, 1.ª rotura y el próximo
 *                          envío propuesto (abre su panel con `onAbrirEnvioPropuesto`). Debajo, una tarjeta por envío: filo
 *                          del color del estado en Amazon, barra de lo vendido, chispa de 14 días y los avisos «se agota en
 *                          N d», «N no llegaron» y «envío dudoso». Los agotados, detrás de «Ver N agotados». El «+N» ámbar
 *                          son los envíos que Amazon tiene y el ERP no: abre Importar pedidos (`onImportarPedidos`).
 *   Propuestas por fases   el kanban de siempre (`TableroRemesas`), entero.
 *
 * El cliente externo con varias cuentas ve un tablero REDUCIDO de las suyas: solo envíos, sin salud ni € (D39).
 *
 * Datos: /api/fba/tablero (el servidor lo guarda 3 min) y, para la agencia, /api/fba/resumen (memoria de 5 min de
 * `useAgencia`). Lo último del tablero se queda en la memoria del módulo: al volver se ve al instante y se actualiza detrás.
 * En el móvil las columnas se pasan de lado con imán (scroll-snap) y cada una mide lo suyo; la página hace scroll normal
 * (sin cabina de altura fija).
 */

export type ModoTablero = 'envios' | 'fases'

export interface TableroClientesProps {
  sesion: SesionRemesas
  /** Envíos nuevos de Amazon por cliente (insignia ámbar). Falta mientras se está preguntando a Amazon */
  nuevosPorCliente: Record<string, number>
  /** Sube cuando algo ha cambiado fuera (se ha importado un envío): vuelve a leer */
  version?: number
  /** Abre el cliente (remesaId null) o un envío suyo */
  onAbrir: (clienteId: string, remesaId: string | null) => void
  /** El «+N»: abre Importar pedidos de ese cliente */
  onImportarPedidos: (clienteId: string) => void
  /** El próximo envío propuesto de la cabecera (agencia) */
  onAbrirEnvioPropuesto?: (id: string) => void
  /** Modo (`?modo=fases`). Sin `onCambiarModo`, el tablero lo lleva por su cuenta */
  modo?: ModoTablero
  onCambiarModo?: (modo: ModoTablero) => void
  /** Para «Propuestas por fases»: la lista de clientes (filtro) y qué hacer al pulsar una propuesta */
  clientes?: Array<{ id: string; nombre: string }>
  onAbrirPropuesta?: (t: TarjetaDeTablero) => void
}

interface Cargado {
  hoy: string
  columnas: ColumnaTablero[]
  en: number
}

/** Lo último que llegó, para no empezar en blanco al volver a la pestaña (memoria del módulo) */
let ultimo: Cargado | null = null

const ORDEN_SALUD: Record<TonoSalud, number> = { rojo: 0, ambar: 1, verde: 2, gris: 3 }

export function TableroClientes({
  sesion,
  nuevosPorCliente,
  version = 0,
  onAbrir,
  onImportarPedidos,
  onAbrirEnvioPropuesto,
  modo: modoFuera,
  onCambiarModo,
  clientes,
  onAbrirPropuesta,
}: TableroClientesProps) {
  const esAgencia = sesion.actor === 'agencia'
  const [modoPropio, setModoPropio] = useState<ModoTablero>(modoFuera ?? 'envios')
  // El cliente externo solo tiene el modo envíos (D39)
  const modo: ModoTablero = !esAgencia ? 'envios' : onCambiarModo ? (modoFuera ?? 'envios') : modoPropio
  const cambiarModo = (m: ModoTablero) => (onCambiarModo ? onCambiarModo(m) : setModoPropio(m))

  return (
    <MotionConfig reducedMotion="user">
      <div className="flex min-w-0 flex-col gap-3">
        {esAgencia && (
          <Segmentado<ModoTablero>
            etiqueta="Qué tablero"
            opciones={[
              { id: 'envios', texto: 'Envíos', icono: Columns3 },
              { id: 'fases', texto: 'Propuestas por fases', icono: KanbanSquare },
            ]}
            valor={modo}
            onCambio={cambiarModo}
            className="self-start"
          />
        )}
        {modo === 'fases' && esAgencia ? (
          <TableroRemesas
            verComo={sesion.actor}
            clientes={clientes ?? []}
            onAbrir={(t) => (onAbrirPropuesta ? onAbrirPropuesta(t) : onAbrir(t.clienteId, t.id))}
          />
        ) : (
          <TableroDeEnvios
            esAgencia={esAgencia}
            nuevosPorCliente={nuevosPorCliente}
            version={version}
            onAbrir={onAbrir}
            onImportarPedidos={onImportarPedidos}
            onAbrirEnvioPropuesto={onAbrirEnvioPropuesto}
          />
        )}
      </div>
    </MotionConfig>
  )
}

/* ------------------------------------------------------------------ */
/* Modo envíos                                                         */
/* ------------------------------------------------------------------ */

function TableroDeEnvios({
  esAgencia,
  nuevosPorCliente,
  version,
  onAbrir,
  onImportarPedidos,
  onAbrirEnvioPropuesto,
}: {
  esAgencia: boolean
  nuevosPorCliente: Record<string, number>
  version: number
  onAbrir: (clienteId: string, remesaId: string | null) => void
  onImportarPedidos: (clienteId: string) => void
  onAbrirEnvioPropuesto?: (id: string) => void
}) {
  const [datos, setDatos] = useState<Cargado | null>(ultimo)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // La mini-salud: solo agencia (el cliente externo recibiría 403 y no debe verla)
  const resumen = useAgencia<ResumenGlobal>(esAgencia ? '/api/fba/resumen' : null, { que: 'No se ha podido leer la salud de los clientes' })

  const leer = useCallback(async () => {
    setCargando(true)
    setError(null)
    try {
      const res = await fetch('/api/fba/tablero', { cache: 'no-store' })
      const p = (await res.json().catch(() => null)) as { error?: string; hoy?: string; columnas?: ColumnaTablero[] } | null
      if (!res.ok || !p?.columnas || !p.hoy) {
        setError(p?.error ?? 'No se ha podido leer el tablero')
        return
      }
      ultimo = { hoy: p.hoy, columnas: p.columnas, en: Date.now() }
      setDatos(ultimo)
    } catch {
      setError('No se ha podido leer el tablero')
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    void leer()
  }, [leer, version])

  const actualizar = () => {
    void leer()
    if (esAgencia) void resumen.recargar()
  }

  const saludDe = useMemo(() => {
    const m = new Map<string, ResumenGlobal['clientes'][number]>()
    for (const c of resumen.datos?.clientes ?? []) m.set(c.clienteId, c)
    return m
  }, [resumen.datos])

  const dudosos = useMemo(() => {
    const m = new Map<string, EnCamino>()
    for (const e of resumen.datos?.enCamino ?? []) m.set(e.remesaId, e)
    return m
  }, [resumen.datos])

  // Las vivas y en marcha primero (ordenarColumnas); dentro de ellas, la agencia ve lo más grave antes (rojo, ámbar, verde, gris)
  const columnas = useMemo(() => {
    if (!datos) return []
    const base = ordenarColumnas(datos.columnas)
    if (!esAgencia || saludDe.size === 0) return base
    const vacia = (c: ColumnaTablero) => (c.tarjetas.some(estaVivo) || c.propuestas > 0 ? 0 : 1)
    const tono = (c: ColumnaTablero) => ORDEN_SALUD[saludDe.get(c.clienteId)?.salud.tono ?? 'gris']
    return base
      .map((c, i) => ({ c, i }))
      .sort((a, b) => vacia(a.c) - vacia(b.c) || tono(a.c) - tono(b.c) || a.i - b.i)
      .map((x) => x.c)
  }, [datos, esAgencia, saludDe])

  const hora = datos ? new Date(datos.en).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) : null

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-[var(--ls-t3)]">
        <span className="min-w-0">
          Los envíos vivos de cada cliente.{hora && <> Actualizado a las {hora}.</>}
        </span>
        <Boton variante="fantasma" tamano="sm" icono={RefreshCw} cargando={cargando} onClick={actualizar}>
          Actualizar
        </Boton>
        {error && (
          <span className="inline-flex items-center gap-1" style={{ color: COLOR_ESTADO.rojo }} role="alert">
            <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden /> {error}
          </span>
        )}
        {esAgencia && resumen.error && !resumen.datos && (
          <span className="inline-flex items-center gap-1 text-[var(--ls-t4)]" title={resumen.error}>
            <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden /> Sin la salud de los clientes
          </span>
        )}
      </div>

      {!datos && cargando && (
        <div className="flex gap-3 overflow-hidden" aria-busy="true" aria-label="Leyendo los envíos de todos los clientes">
          {[0, 1, 2].map((i) => (
            <div key={i} className="w-[min(85vw,300px)] shrink-0 space-y-2">
              <EsqueletoTarjeta alto={92} />
              <EsqueletoTarjeta alto={118} />
            </div>
          ))}
        </div>
      )}

      {datos && columnas.length === 0 && (
        <EstadoVacio icono={Columns3} acento="remesas" titulo="No hay clientes que enseñar" descripcion="Cuando tengas acceso a algún cliente con Amazon conectado, sus envíos saldrán aquí en columnas." />
      )}

      {datos && columnas.length > 0 && (
        // Móvil: las columnas se pasan de lado de una en una (imán) y cada una mide lo suyo. Desde lg, sin imán
        <div className="-mx-4 flex snap-x snap-mandatory scroll-px-4 items-start gap-3 overflow-x-auto px-4 pb-2 lg:mx-0 lg:snap-none lg:px-0">
          {columnas.map((c) => (
            <Columna
              key={c.clienteId}
              columna={c}
              hoy={datos.hoy}
              nuevos={nuevosPorCliente[c.clienteId] ?? 0}
              salud={esAgencia ? (saludDe.get(c.clienteId) ?? null) : null}
              saludCargando={esAgencia && resumen.cargando && !resumen.datos}
              dudosos={dudosos}
              onAbrir={onAbrir}
              onImportarPedidos={onImportarPedidos}
              onAbrirEnvioPropuesto={onAbrirEnvioPropuesto}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Columna                                                             */
/* ------------------------------------------------------------------ */

function Columna({
  columna,
  hoy,
  nuevos,
  salud,
  saludCargando,
  dudosos,
  onAbrir,
  onImportarPedidos,
  onAbrirEnvioPropuesto,
}: {
  columna: ColumnaTablero
  hoy: string
  nuevos: number
  salud: ResumenGlobal['clientes'][number] | null
  saludCargando: boolean
  dudosos: Map<string, EnCamino>
  onAbrir: (clienteId: string, remesaId: string | null) => void
  onImportarPedidos: (clienteId: string) => void
  onAbrirEnvioPropuesto?: (id: string) => void
}) {
  const [verAgotados, setVerAgotados] = useState(false)
  const ordenadas = ordenarTarjetas(columna.tarjetas)
  const vivas = ordenadas.filter(estaVivo)
  const agotadas = ordenadas.filter((t) => !estaVivo(t))
  const seAgota = vivas.filter((t) => t.cobertura !== null && t.cobertura < 7).length
  const sinNada = vivas.length === 0 && columna.propuestas === 0 && agotadas.length === 0
  // Sin la salud (cliente externo o sin resumen), el punto de siempre: rojo si algo se agota en < 7 d, ámbar si hay unidades que no llegaron
  const avisoLocal: TonoEstado | null = seAgota > 0 ? 'rojo' : vivas.some((t) => t.noLlegaron > 0) ? 'ambar' : null

  return (
    <section
      className={cx(
        'flex w-[min(85vw,320px)] shrink-0 snap-start flex-col overflow-hidden rounded-[14px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] sm:w-[300px]',
        sinNada && 'opacity-60'
      )}
      aria-label={`Envíos de ${columna.nombre}`}
    >
      <header className="border-b border-[var(--ls-linea)] px-3 py-[10px]">
        <div className="flex items-center gap-2">
          {salud ? (
            <PuntoSalud salud={salud.salud} />
          ) : (
            avisoLocal && (
              <span
                className="h-[8px] w-[8px] shrink-0 rounded-full"
                style={{ background: COLOR_ESTADO[avisoLocal] }}
                title={seAgota > 0 ? `${seAgota} envío${seAgota === 1 ? '' : 's'} se agota${seAgota === 1 ? '' : 'n'} en menos de 7 días` : 'Hay unidades que Amazon no ha dado por recibidas'}
              />
            )
          )}
          <button
            type="button"
            onClick={() => onAbrir(columna.clienteId, null)}
            className="min-w-0 flex-1 truncate text-left text-[13.5px] font-semibold text-[var(--ls-t1)] hover:underline"
            title={`Abrir ${columna.nombre}`}
          >
            {columna.nombre}
          </button>
          {nuevos > 0 && columna.puedeEditar && (
            <button
              type="button"
              onClick={() => onImportarPedidos(columna.clienteId)}
              className="inline-flex h-[24px] shrink-0 items-center gap-1 rounded-full px-2 text-[11.5px] font-semibold"
              style={{ background: `color-mix(in srgb, ${COLOR_ESTADO.ambar} 18%, transparent)`, color: COLOR_ESTADO.ambar }}
              title={`${nuevos} envío${nuevos === 1 ? '' : 's'} en Amazon que todavía no está${nuevos === 1 ? '' : 'n'} en el ERP: importar`}
            >
              <PackagePlus className="h-3 w-3" aria-hidden />+{nuevos}
            </button>
          )}
        </div>
        <p className="mt-[3px] text-[11px] text-[var(--ls-t4)]">
          {vivas.length} {vivas.length === 1 ? 'vivo' : 'vivos'}
          {columna.propuestas > 0 && ` · ${columna.propuestas} ${columna.propuestas === 1 ? 'propuesta' : 'propuestas'}`}
          {agotadas.length > 0 && ` · ${agotadas.length} ${agotadas.length === 1 ? 'agotado' : 'agotados'}`}
        </p>
        {salud ? (
          <MiniSalud salud={salud} hoy={hoy} onAbrirEnvioPropuesto={onAbrirEnvioPropuesto} />
        ) : saludCargando ? (
          <div className="mt-2 h-[38px] animate-pulse rounded-[8px] bg-[var(--ls-sup3)] motion-reduce:animate-none" aria-hidden />
        ) : null}
      </header>

      <div className="space-y-[6px] p-[7px]">
        {vivas.length === 0 && (
          <p className="px-2 py-6 text-center text-[11.5px] text-[var(--ls-t4)]">
            {sinNada ? 'Todavía sin envíos' : agotadas.length > 0 ? 'Nada vivo: todos agotados' : 'Sin envíos vivos'}
          </p>
        )}
        {vivas.map((t) => (
          <TarjetaEnvio key={t.id} t={t} hoy={hoy} enCamino={dudosos.get(t.id) ?? null} onClick={() => onAbrir(columna.clienteId, t.id)} />
        ))}
        {agotadas.length > 0 && (
          <>
            <button
              type="button"
              onClick={() => setVerAgotados((v) => !v)}
              className={cx('flex w-full items-center justify-center gap-1 rounded-[10px] text-[11.5px] text-[var(--ls-t3)] hover:bg-[var(--ls-sup3)] hover:text-[var(--ls-t1)]', TACTIL)}
              aria-expanded={verAgotados}
            >
              <ChevronDown className={cx('h-3 w-3 transition-transform motion-reduce:transition-none', verAgotados && 'rotate-180')} aria-hidden />
              {verAgotados ? 'Ocultar agotados' : `Ver ${agotadas.length} ${agotadas.length === 1 ? 'agotado' : 'agotados'}`}
            </button>
            {verAgotados && agotadas.map((t) => <TarjetaEnvio key={t.id} t={t} hoy={hoy} enCamino={dudosos.get(t.id) ?? null} onClick={() => onAbrir(columna.clienteId, t.id)} />)}
          </>
        )}
      </div>
    </section>
  )
}

function PuntoSalud({ salud }: { salud: SaludCliente }) {
  const e = SALUD[salud.tono]
  const color = COLOR_ESTADO[e.tono]
  return (
    <span className="relative inline-flex h-[9px] w-[9px] shrink-0" title={`${e.texto}: ${salud.motivo}`} aria-label={`${e.texto}: ${salud.motivo}`} role="img">
      <span
        className="h-full w-full rounded-full"
        style={salud.tono === 'gris' ? { border: `1.5px solid ${color}` } : { background: color, boxShadow: `0 0 0 3px color-mix(in srgb, ${color} 18%, transparent)` }}
      />
    </span>
  )
}

/** Vendible, de camino, 1.ª rotura y el próximo envío propuesto, con el motivo de la salud debajo */
function MiniSalud({ salud, hoy, onAbrirEnvioPropuesto }: { salud: ResumenGlobal['clientes'][number]; hoy: string; onAbrirEnvioPropuesto?: (id: string) => void }) {
  const r = salud.resumen
  const e = SALUD[salud.salud.tono]
  const prox = salud.proximoEnvio
  const rotura = r?.primeraRotura ?? null
  const roturaCerca = rotura !== null && diasEntre(hoy, rotura) <= 14
  return (
    <div className="mt-2 space-y-[6px]">
      <dl className="grid grid-cols-3 gap-1 rounded-[10px] bg-[var(--ls-sup)] px-2 py-[6px]">
        <Dato titulo="Vendible" valor={r ? unidades(r.vendibles) : '—'} nota="unidades vendibles en Amazon ahora" />
        <Dato titulo="De camino" valor={r ? unidades(r.deCamino) : '—'} nota="unidades de camino (ERP o entrantes en Amazon)" />
        <Dato titulo="1.ª rotura" valor={rotura ? fechaCorta(rotura, hoy) : '—'} nota="primer día sin stock según el plan" tono={roturaCerca ? 'rojo' : undefined} />
      </dl>
      <div className="flex min-w-0 items-center gap-2">
        <Insignia tono={e.tono} variante={e.variante} tamano="sm" title={salud.salud.motivo}>
          {e.corto}
        </Insignia>
        <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--ls-t3)]" title={salud.salud.motivo}>
          {salud.salud.motivo}
        </span>
      </div>
      {prox && (
        <button
          type="button"
          onClick={() => onAbrirEnvioPropuesto?.(prox.id)}
          disabled={!onAbrirEnvioPropuesto}
          className={cx(
            'flex w-full min-w-0 items-center gap-2 rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] px-2 text-left text-[11.5px] text-[var(--ls-t2)] enabled:hover:border-[var(--ls-linea2)] enabled:hover:bg-[var(--ls-sup3)]',
            TACTIL
          )}
          title="El próximo envío que propone el planificador"
        >
          <Send className="h-3.5 w-3.5 shrink-0 text-[var(--ls-mod-remesas)]" aria-hidden />
          <span className="min-w-0 flex-1 truncate">
            Próximo envío, antes del <b className="font-semibold text-[var(--ls-t1)]">{fechaCorta(prox.salirAntesDe, hoy)}</b>
          </span>
          <span className="shrink-0 tabular-nums text-[var(--ls-t3)]">{unidades(prox.unidades)} ud</span>
        </button>
      )}
    </div>
  )
}

function Dato({ titulo, valor, nota, tono }: { titulo: string; valor: string; nota: string; tono?: TonoEstado }) {
  return (
    <div className="min-w-0" title={nota}>
      <dt className="truncate text-[10px] uppercase tracking-wide text-[var(--ls-t4)]">{titulo}</dt>
      <dd className="truncate text-[12.5px] font-semibold tabular-nums" style={{ color: tono ? COLOR_ESTADO[tono] : 'var(--ls-t1)' }}>
        {valor}
      </dd>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Tarjeta de un envío                                                 */
/* ------------------------------------------------------------------ */

/** El estado en Amazon, en palabras y con su tono (lo mismo que `envios/estadoAmazon`, sin depender de esa pantalla) */
function estadoAmazon(t: TarjetaTablero): { texto: string; tono: TonoEstado; titulo?: string } {
  if (!t.referenciaEnvio) return { texto: 'Sin enlazar', tono: 'gris', titulo: 'No tiene número de envío FBA: no se puede seguir en Amazon' }
  if (t.seguimientoError) return { texto: 'Amazon no lo reconoce', tono: 'rojo', titulo: t.seguimientoError }
  const e = t.estadoAmazon
  if (!e) return { texto: 'Sin consultar', tono: 'gris', titulo: 'Todavía no se ha preguntado a Amazon por este envío' }
  if (ESTADOS_AMAZON_MALOS.includes(e)) return { texto: ESTADO_INBOUND_TEXTO[e]?.texto ?? e, tono: 'rojo' }
  switch (e) {
    case 'CLOSED':
      return { texto: 'Cerrado', tono: 'verde', titulo: 'Amazon ha terminado de recibirlo' }
    case 'RECEIVING':
      return { texto: 'Recibiendo', tono: 'cian', titulo: 'Amazon está contando y colocando las unidades' }
    case 'CHECKED_IN':
      return { texto: 'Registrado', tono: 'cian' }
    case 'DELIVERED':
      return { texto: 'Entregado', tono: 'azul', titulo: 'Ha llegado al centro de Amazon; falta registrarlo' }
    case 'SHIPPED':
    case 'IN_TRANSIT':
      return { texto: 'En tránsito', tono: 'azul' }
    default:
      return { texto: ESTADO_INBOUND_TEXTO[e]?.texto ?? e, tono: 'ambar' }
  }
}

/**
 * ¿Envío dudoso? (D3). La agencia lo sabe por el resumen (`enCamino.dudoso`, con el transporte medido del cliente). Sin
 * resumen (cliente externo), la misma regla con lo que hay: en tránsito, nada vendido aún (nada recibido) y más de 30 días.
 */
function esDudoso(t: TarjetaTablero, hoy: string, enCamino: EnCamino | null): boolean {
  if (enCamino) return enCamino.dudoso
  if (t.estadoAmazon !== 'SHIPPED' && t.estadoAmazon !== 'IN_TRANSIT') return false
  if (!t.fechaEnvio) return false
  return esEnvioDudoso(diasEntre(t.fechaEnvio, hoy), t.vendidas > 0 ? 1 : 0, null)
}

function TarjetaEnvio({ t, hoy, enCamino, onClick }: { t: TarjetaTablero; hoy: string; enCamino: EnCamino | null; onClick: () => void }) {
  const base = Math.max(1, t.quedan + t.vendidas)
  const agotado = t.quedan === 0
  const seAgota = !agotado && t.cobertura !== null && t.cobertura < 7
  const dudoso = esDudoso(t, hoy, enCamino)
  const estado = estadoAmazon(t)
  const filo = COLOR_ESTADO[dudoso ? 'rojo' : estado.tono]
  const pct = Math.round((t.vendidas / base) * 100)
  const vendeAlgo = t.chispa.some((v) => v > 0)

  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        // ls-elevar ya solo levanta con ratón (hover: hover) y se queda quieta con menos movimiento
        'ls-elevar relative block w-full min-w-0 overflow-hidden rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] py-[9px] pl-[13px] pr-[11px] text-left',
        'hover:border-[var(--ls-linea2)]'
      )}
      aria-label={`Abrir ${t.nombre ?? `el envío del ${fecha(t.fechaEnvio)}`}: ${estado.texto}, quedan ${t.quedan}`}
    >
      {/* el filo: el color del estado en Amazon (rojo si es dudoso) */}
      <span className="absolute inset-y-0 left-0 w-[3px]" style={{ background: filo }} aria-hidden />

      <div className="flex items-center justify-between gap-2">
        <Insignia tono={estado.tono} tamano="sm" title={estado.titulo} icono={estado.tono === 'azul' && !agotado ? Truck : undefined}>
          {estado.texto}
        </Insignia>
        <div className="flex shrink-0 items-baseline gap-[4px]">
          <span className={cx('text-[16px] font-semibold leading-none tabular-nums tracking-[-0.02em]', agotado ? 'text-[var(--ls-t4)]' : 'text-[var(--ls-t1)]')}>
            {t.quedan.toLocaleString('es-ES')}
          </span>
          <span className="text-[11px] text-[var(--ls-t4)]">quedan</span>
        </div>
      </div>

      <div className="mt-[7px] flex min-w-0 items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className={cx('truncate text-[13px] font-medium', agotado ? 'text-[var(--ls-t3)]' : 'text-[var(--ls-t1)]')}>{t.nombre ?? `Envío del ${fecha(t.fechaEnvio)}`}</p>
          <p className="mt-[1px] truncate text-[11px] text-[var(--ls-t4)]">
            <span className="font-mono">{t.referenciaEnvio || 'sin número'}</span> · {fecha(t.fechaEnvio)} · {t.referencias} ref · {t.enviadas} ud
          </p>
        </div>
        {vendeAlgo && (
          <div className="w-[64px] shrink-0" title={`${t.chispa.reduce((s, v) => s + v, 0)} unidades vendidas en los últimos ${t.chispa.length} días`}>
            <Chispa valores={t.chispa} color="var(--viz-1, var(--ls-mod-remesas))" alto={22} />
          </div>
        )}
      </div>

      <BarraDeProgreso valor={t.vendidas} maximo={base} acento="remesas" tamano="sm" className="mt-[8px]" etiqueta="Vendido" detalle={`${pct} %`} />

      {(t.noLlegaron > 0 || seAgota || dudoso) && (
        <div className="mt-[7px] flex flex-wrap items-center gap-x-3 gap-y-[2px] text-[11px] text-[var(--ls-t3)]">
          {seAgota && (
            <span className="inline-flex items-center gap-1" title="Al ritmo de la última semana">
              <AlertTriangle className="h-3 w-3" style={{ color: COLOR_ESTADO.rojo }} aria-hidden />
              se agota en {Math.max(0, Math.round(t.cobertura ?? 0))} d
            </span>
          )}
          {t.noLlegaron > 0 && (
            <span className="inline-flex items-center gap-1" title="Unidades enviadas que Amazon no ha dado por recibidas">
              <AlertTriangle className="h-3 w-3" style={{ color: COLOR_ESTADO.ambar }} aria-hidden />
              {t.noLlegaron} no llegaron
            </span>
          )}
          {dudoso && (
            <span className="inline-flex items-center gap-1" title="Lleva demasiado tiempo en tránsito sin que Amazon reciba nada: no cuenta para la cobertura. Pregunta a Amazon o confirma el envío">
              <CalendarClock className="h-3 w-3" style={{ color: COLOR_ESTADO.rojo }} aria-hidden />
              envío dudoso
            </span>
          )}
        </div>
      )}
    </button>
  )
}
