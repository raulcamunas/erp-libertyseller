'use client'

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { AlarmClock, Boxes, CalendarClock, ClipboardCheck, Hourglass, KanbanSquare, Package, RefreshCw, Search, UserRound, Users } from 'lucide-react'
import { Boton, EsqueletoTarjeta, EstadoVacio, FilaDeKpis, Insignia, Kpi, Segmentado, Tarjeta } from '@/components/ui-ls'
import type { TonoEstado } from '@/lib/estilo/denso'
import type { Actor } from '@/lib/fba/flujo'
import { COLUMNAS_DEL_TABLERO, agruparPorColumna, filtrarTablero, textoDelPlazo, type ColumnaDelTablero, type Semaforo, type TarjetaDeTablero } from '@/lib/fba/tablero-propuestas'
import { cx } from '../comun/ui'

/**
 * EL TABLERO DE REMESAS: TODAS LAS PROPUESTAS EN MARCHA, POR FASES («Propuestas por fases» de la vista `tablero`,
 * `?vista=tablero&modo=fases`; lo monta TableroClientes con su Segmentado, spec remesas-pro §8).
 *
 * Para llevar el control sin abrir una a una: arriba las cifras (en marcha, te tocan, vencidas, unidades),
 * filtros (todas / te tocan / vencidas, por cliente y por texto) y una columna por fase con una tarjeta por
 * remesa: cliente, unidades, cajas, el plazo con semáforo y quién la tiene. Al pulsar una se abre su
 * espacio de trabajo.
 *
 * Se lee una vez al abrir (y con «Actualizar»): nada de sondeos. Cada columna enseña 30 tarjetas y un «ver
 * más»: no se anima fila a fila más allá de las primeras.
 */

const TONO_PLAZO: Record<Semaforo, TonoEstado> = { vencido: 'rojo', cerca: 'ambar', ok: 'verde', sin_fecha: 'gris' }
const POR_COLUMNA = 30

type Filtro = 'todas' | 'mias' | 'vencidas'

/**
 * ¿PANTALLA DE ORDENADOR (lg o más)?
 *
 * El punto que late de «te toca» va en CADA tarjeta: con siete u ocho a la vista, en un móvil medio (CPU x4) esas animaciones infinitas
 * costaban 0,65 s de hilo principal por cada 3 s de scroll (600 recálculos de estilo frente a 20 sin ellas) y el scroll daba tirones. En
 * el móvil el punto se queda fijo —sigue diciendo de quién es el turno—; en el ordenador late como siempre. Vale también para el «Revisar»
 * de la columna: con UNA sola animación de estas ya se recalculan los estilos en cada fotograma (medido: 600 recálculos en 3 s).
 */
const CONSULTA_ANCHO = '(min-width: 1024px)'
function suscribirAncho(avisar: () => void) {
  const m = window.matchMedia(CONSULTA_ANCHO)
  m.addEventListener('change', avisar)
  return () => m.removeEventListener('change', avisar)
}
function useEsAncho(): boolean {
  return useSyncExternalStore(suscribirAncho, () => window.matchMedia(CONSULTA_ANCHO).matches, () => true)
}

export function TableroRemesas({
  verComo,
  clientes,
  onAbrir,
}: {
  verComo: Actor
  clientes: Array<{ id: string; nombre: string }>
  onAbrir: (t: TarjetaDeTablero) => void
}) {
  const [tarjetas, setTarjetas] = useState<TarjetaDeTablero[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(false)
  const [filtro, setFiltro] = useState<Filtro>('todas')
  const [cliente, setCliente] = useState<string>('')
  const [texto, setTexto] = useState('')
  const [abiertas, setAbiertas] = useState<Set<ColumnaDelTablero>>(new Set())
  const ancho = useEsAncho()

  const cargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    try {
      const res = await fetch('/api/fba/tablero-propuestas', { cache: 'no-store' })
      const p = (await res.json().catch(() => null)) as { tarjetas?: TarjetaDeTablero[]; error?: string } | null
      if (!res.ok || !p?.tarjetas) throw new Error(p?.error ?? `No se ha podido leer el tablero (código ${res.status})`)
      setTarjetas(p.tarjetas)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const visibles = useMemo(
    () => filtrarTablero(tarjetas ?? [], { texto, clienteId: cliente || null, soloMias: filtro === 'mias' ? verComo : null, soloVencidas: filtro === 'vencidas' }),
    [tarjetas, texto, cliente, filtro, verComo]
  )
  const columnas = useMemo(() => agruparPorColumna(visibles), [visibles])
  const cifras = useMemo(() => {
    const todas = tarjetas ?? []
    return {
      enMarcha: todas.length,
      mias: todas.filter((t) => t.quien === verComo).length,
      vencidas: todas.filter((t) => t.semaforo === 'vencido').length,
      revisar: todas.filter((t) => t.columna === 'revision').length,
      unidades: todas.reduce((s, t) => s + t.unidades, 0),
    }
  }, [tarjetas, verComo])

  return (
    // Sin cabina de altura fija (spec §6.5): la página hace scroll normal. Sin título propio: lo nombra el Segmentado
    // «Envíos · Propuestas por fases» de TableroClientes, que es quien lo monta
    <div className="flex min-w-0 flex-col gap-4 pb-6">
      <FilaDeKpis minimo={170}>
        <Kpi indice={0} etiqueta="En marcha" valor={tarjetas ? cifras.enMarcha : null} cargando={!tarjetas && !error} icono={KanbanSquare} acento="remesas" nota="propuestas sin enviar a Amazon" />
        <Kpi indice={1} etiqueta="Te tocan" valor={tarjetas ? cifras.mias : null} cargando={!tarjetas && !error} icono={UserRound} acento="remesas" nota={verComo === 'agencia' ? 'esperan a la agencia' : 'esperan a que muevas tú'} onClick={() => setFiltro('mias')} />
        {verComo === 'agencia' && <Kpi indice={2} etiqueta="Por revisar" valor={tarjetas ? cifras.revisar : null} cargando={!tarjetas && !error} icono={ClipboardCheck} acento="remesas" nota="el cliente ha aceptado" />}
        <Kpi indice={3} etiqueta="Plazo vencido" valor={tarjetas ? cifras.vencidas : null} cargando={!tarjetas && !error} icono={AlarmClock} acento={cifras.vencidas > 0 ? 'var(--ls-e-rojo)' : 'remesas'} nota="ya pasó la fecha prevista" onClick={() => setFiltro('vencidas')} />
        <Kpi indice={4} etiqueta="Unidades" valor={tarjetas ? cifras.unidades : null} cargando={!tarjetas && !error} icono={Package} acento="remesas" nota="en todas las propuestas" />
      </FilaDeKpis>

      <div className="flex flex-wrap items-center gap-2">
        <Segmentado
          etiqueta="Qué remesas"
          opciones={[
            { id: 'todas', texto: 'Todas', cuenta: cifras.enMarcha },
            { id: 'mias', texto: 'Te tocan', cuenta: cifras.mias },
            { id: 'vencidas', texto: 'Vencidas', cuenta: cifras.vencidas },
          ]}
          valor={filtro}
          onCambio={setFiltro}
        />
        {clientes.length > 1 && (
          <label className="flex h-9 items-center gap-2 rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] px-3 text-[13px] text-[var(--ls-t2)]">
            <Users className="h-3.5 w-3.5 text-[var(--ls-t4)]" />
            <select value={cliente} onChange={(e) => setCliente(e.target.value)} className="h-full min-w-0 max-w-[180px] bg-transparent focus:outline-none" aria-label="Filtrar por cliente">
              <option value="">Todos los clientes</option>
              {clientes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] px-3 max-sm:order-last max-sm:basis-full sm:max-w-[260px]">
          <Search className="h-3.5 w-3.5 shrink-0 text-[var(--ls-t4)]" />
          <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Buscar remesa o cliente" aria-label="Buscar remesa o cliente" className="h-full w-full min-w-0 bg-transparent text-[13px] text-[var(--ls-t1)] placeholder:text-[var(--ls-t4)] focus:outline-none" />
        </label>
        <Boton variante="fantasma" icono={RefreshCw} cargando={cargando} onClick={() => void cargar()} className="ml-auto">
          Actualizar
        </Boton>
      </div>

      {error ? (
        <EstadoVacio icono={KanbanSquare} acento="remesas" titulo="No se ha podido leer el tablero" descripcion={error} accion={{ texto: 'Reintentar', onClick: () => void cargar() }} />
      ) : !tarjetas ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {COLUMNAS_DEL_TABLERO.map((c) => (
            <div key={c.id} className="space-y-3">
              <div className="h-5 w-24 animate-pulse rounded bg-[var(--ls-sup2)]" />
              <EsqueletoTarjeta alto={118} />
              <EsqueletoTarjeta alto={118} />
            </div>
          ))}
        </div>
      ) : tarjetas.length === 0 ? (
        <EstadoVacio icono={KanbanSquare} acento="remesas" titulo="No hay ninguna propuesta en marcha" descripcion="Cuando prepares una propuesta para un cliente aparecerá aquí, en su fase, hasta que salga hacia Amazon." />
      ) : (
        // En el PC, seis columnas con desplazamiento lateral si no caben; en el móvil, una debajo de otra
        <div className="-mx-1 flex flex-col gap-4 px-1 md:flex-row md:overflow-x-auto md:pb-2">
          {COLUMNAS_DEL_TABLERO.map((c) => {
            const lista = columnas[c.id]
            const todas = abiertas.has(c.id)
            const enseñadas = todas ? lista : lista.slice(0, POR_COLUMNA)
            return (
              <section key={c.id} aria-label={c.texto} className="flex min-w-0 flex-col gap-2.5 md:w-[272px] md:shrink-0">
                <header className="flex items-center justify-between gap-2 px-1" title={c.pista}>
                  <h3 className="text-[13px] font-semibold text-[var(--ls-t1)]">
                    {c.texto}
                    <span className="ml-2 tabular-nums text-[var(--ls-t4)]">{lista.length}</span>
                  </h3>
                  {c.id === 'revision' && lista.length > 0 && <Insignia tono="naranja" vivo={ancho} tamano="sm">Revisar</Insignia>}
                </header>
                {lista.length === 0 ? (
                  <p className="rounded-[14px] border border-dashed border-[var(--ls-linea2)] px-3 py-5 text-center text-[12.5px] text-[var(--ls-t4)]">Nada aquí</p>
                ) : (
                  enseñadas.map((t, i) => <TarjetaRemesa key={t.id} t={t} indice={i < 8 ? i : undefined} verComo={verComo} latido={ancho} onClick={() => onAbrir(t)} />)
                )}
                {lista.length > POR_COLUMNA && (
                  <Boton variante="fantasma" tamano="sm" onClick={() => setAbiertas((s) => new Set(s).add(c.id))} disabled={todas}>
                    {todas ? 'Todas a la vista' : `Ver ${lista.length - POR_COLUMNA} más`}
                  </Boton>
                )}
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}

function TarjetaRemesa({ t, indice, verComo, latido, onClick }: { t: TarjetaDeTablero; indice?: number; verComo: Actor; latido: boolean; onClick: () => void }) {
  const mia = t.quien === verComo
  return (
    <Tarjeta variante="interactiva" acento="remesas" indice={indice} onClick={onClick} aria-label={`Abrir ${t.nombre ?? 'la remesa'} de ${t.clienteNombre}`} cuerpoClassName="!p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[11.5px] font-semibold uppercase tracking-wide text-[var(--ls-mod-remesas)]">{t.clienteNombre}</p>
          <p className="mt-0.5 line-clamp-2 text-[13.5px] font-medium leading-snug text-[var(--ls-t1)]">{t.nombre ?? 'Propuesta sin nombre'}</p>
        </div>
        <Insignia tono={mia ? 'naranja' : 'gris'} tamano="sm" vivo={mia && latido} title={verComo === 'agencia' ? t.turno.paraAgencia : t.turno.paraCliente}>
          {t.quien === 'agencia' ? 'Agencia' : 'Cliente'}
        </Insignia>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-[var(--ls-t3)]">
        <span className="inline-flex items-center gap-1">
          <Package className="h-3.5 w-3.5 text-[var(--ls-t4)]" />
          <span className="tabular-nums">{t.unidades.toLocaleString('es-ES')}</span> uds · {t.referencias} ref
        </span>
        {t.cajas > 0 && (
          <span className="inline-flex items-center gap-1">
            <Boxes className="h-3.5 w-3.5 text-[var(--ls-t4)]" />
            <span className="tabular-nums">{t.cajas}</span> cajas
          </span>
        )}
      </div>
      <div className="mt-2.5 flex items-center justify-between gap-2">
        <Insignia tono={TONO_PLAZO[t.semaforo]} tamano="sm" icono={CalendarClock}>
          {textoDelPlazo(t.diasAlPlazo)}
        </Insignia>
        {t.diasParada !== null && t.diasParada >= 3 && (
          <span className={cx('inline-flex items-center gap-1 text-[11.5px] tabular-nums', t.diasParada >= 7 ? 'text-[var(--ls-e-ambar)]' : 'text-[var(--ls-t4)]')} title="Días desde el último cambio">
            <Hourglass className="h-3 w-3" />
            {t.diasParada} d parada
          </span>
        )}
      </div>
    </Tarjeta>
  )
}
