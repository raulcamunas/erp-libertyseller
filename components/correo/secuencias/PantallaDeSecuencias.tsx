'use client'

import { Activity, ArrowLeft, CalendarRange, FlaskConical, HeartPulse, ListOrdered, OctagonAlert, Power, Presentation, RefreshCw, Settings2, Sparkles, Sun, TriangleAlert, Workflow } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { Avatar, BarraDeCarga, Esqueleto, PANEL } from '@/components/rendimiento/ui'
import { hace } from '@/lib/correo/secuencias/vistas'
import { Aviso, BOTON_SECUNDARIO } from '../ui'
import { AjustesDeSecuencias } from './AjustesDeSecuencias'
import { ColaDeLeads } from './ColaDeLeads'
import { BarraDeLaDemo } from './BarraDeLaDemo'
import { DemoContext, useAhora, useRecien, useTablero, type FiltroDeCola, type Tablero } from './datos'
import { NovedadesDelJueves } from './NovedadesDelJueves'
import { PanelDeSecuencia } from './PanelDeSecuencia'
import { VistaDeFlujo } from './VistaDeFlujo'
import { VistaDeHoy } from './VistaDeHoy'
import { VistaDeProximos } from './VistaDeProximos'
import { VistaDeSalud } from './VistaDeSalud'

/**
 * LA PANTALLA DE SECUENCIAS — DENTRO DE CORREO, DETRÁS DE UN BOTÓN.
 *
 * Una cabecera con el estado del motor, seis pestañas (Hoy · Cola · Próximos días · Flujo · Salud · Ajustes) y, al pulsar cualquier lead, su detalle en un panel
 * lateral. Cada persona ve lo suyo: el servidor decide qué buzones llegan (el comercial, el suyo; un supervisor o un administrador, todos). La pantalla
 * se queda montada aunque se vuelva a la bandeja (así no pierde la pestaña ni el filtro), pero solo pide datos mientras se ve.
 */

type Pestana = 'novedades' | 'hoy' | 'cola' | 'proximos' | 'flujo' | 'salud' | 'ajustes'

/** La primera pestaña de la demostración: lo nuevo desde el jueves (solo existe mientras se enseña la demostración) */
const PESTANA_DE_NOVEDADES = { id: 'novedades' as const, etiqueta: 'Novedades', Icono: Sparkles }

const PESTANAS: ReadonlyArray<{ id: Pestana; etiqueta: string; Icono: typeof Sun }> = [
  { id: 'hoy', etiqueta: 'Hoy', Icono: Sun },
  { id: 'cola', etiqueta: 'Cola', Icono: ListOrdered },
  { id: 'proximos', etiqueta: 'Próximos días', Icono: CalendarRange },
  { id: 'flujo', etiqueta: 'Flujo', Icono: Activity },
  { id: 'salud', etiqueta: 'Salud', Icono: HeartPulse },
  { id: 'ajustes', etiqueta: 'Ajustes', Icono: Settings2 },
]

const PESTANA_GUARDADA = 'correo.secuencias.pestana'

function PildoraDeEstado({ tablero }: { tablero: Tablero }) {
  const { activa, modoEnsayo } = tablero.ajustes
  const modo = !activa ? 'apagado' : modoEnsayo ? 'ensayo' : 'real'
  const color = modo === 'real' ? 'var(--ls-e-verde)' : modo === 'ensayo' ? 'var(--ls-e-ambar)' : 'var(--ls-t4)'
  const texto = modo === 'real' ? 'En marcha' : modo === 'ensayo' ? 'Ensayo · no envía' : 'Apagado'
  return (
    <span
      className="inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 text-[11.5px] font-semibold"
      style={{ color, borderColor: `color-mix(in srgb, ${color} 40%, transparent)`, background: `color-mix(in srgb, ${color} 10%, transparent)` }}
      title={modo === 'real' ? 'Los seguimientos salen de verdad a su hora' : modo === 'ensayo' ? 'El motor reparte horas y decide, pero no envía nada' : 'El motor no hace nada'}
    >
      {modo === 'real' ? <span className="sec-ahora h-1.5 w-1.5 rounded-full" style={{ background: color }} aria-hidden /> : modo === 'ensayo' ? <FlaskConical className="h-3 w-3" aria-hidden /> : <Power className="h-3 w-3" aria-hidden />}
      {texto}
    </span>
  )
}

/** Lo que está mal y conviene ver nada más entrar, sea la pestaña que sea: sale de la salud (lo mismo que enseña la pestaña «Salud») */
function AvisosDeSalud({ tablero, onVerSalud }: { tablero: Tablero; onVerSalud: () => void }) {
  const { alarmas } = tablero.salud
  if (alarmas.length === 0) return null
  return (
    <ul className="space-y-1.5" aria-label="Avisos de la salud">
      {alarmas.slice(0, 3).map((a) => {
        const roja = a.gravedad === 'roja'
        const Icono = roja ? OctagonAlert : TriangleAlert
        const color = roja ? 'var(--ls-e-rojo)' : 'var(--ls-e-ambar)'
        return (
          <li key={a.clave} className="sec-sube flex items-start gap-2 rounded-[8px] border border-l-2 border-[var(--ls-linea)] bg-[var(--ls-sup)] px-3 py-2 text-[12px] leading-snug text-[var(--ls-t2)]" style={{ borderLeftColor: color }}>
            <Icono className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color }} aria-hidden />
            <span className="min-w-0 flex-1">
              <strong className="font-semibold text-[var(--ls-t1)]">{a.titulo}.</strong> {a.detalle}
            </span>
          </li>
        )
      })}
      {alarmas.length > 3 && (
        <li className="px-1 text-[11.5px] text-[var(--ls-t4)]">
          y {alarmas.length - 3} más.{' '}
          <button type="button" onClick={onVerSalud} className="text-[var(--ls-acc)] underline-offset-2 hover:underline">
            Verlas en Salud
          </button>
        </li>
      )}
    </ul>
  )
}

function Cargando() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Cargando las secuencias">
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Esqueleto key={i} className="h-[74px] w-full" />
        ))}
      </div>
      <Esqueleto className="h-52 w-full" />
      <Esqueleto className="h-32 w-full" />
    </div>
  )
}

interface Props {
  /** Volver a la bandeja de Correo */
  onVolver: () => void
  /** La pantalla se está viendo: si no, sigue montada pero no pide nada */
  visible: boolean
}

/**
 * La demostración vive aquí, FUERA de lo que pide los datos: los hooks de datos.ts (useTablero, useCola, useDetalle) leen el contexto, y un componente no ve el contexto que él mismo
 * da, así que quien lo da tiene que ser el de arriba.
 */
export function PantallaDeSecuencias(props: Props) {
  /** null = lo de verdad; un número = la demostración con el reloj avanzado esos días hábiles (ver datos.ts) */
  const [demo, setDemo] = useState<number | null>(null)
  return (
    <DemoContext.Provider value={demo}>
      <ContenidoDeSecuencias {...props} demo={demo} setDemo={setDemo} />
    </DemoContext.Provider>
  )
}

function ContenidoDeSecuencias({ onVolver, visible, demo, setDemo }: Props & { demo: number | null; setDemo: (d: number | null) => void }) {
  // La pestaña en que se estaba (una comodidad de cada persona: si el navegador no la guarda, no pasa nada). Esta pantalla solo se pinta en el navegador
  const [pestana, setPestana] = useState<Pestana>(() => {
    try {
      const g = typeof window === 'undefined' ? null : window.localStorage.getItem(PESTANA_GUARDADA)
      if (g && g !== 'novedades' && PESTANAS.some((p) => p.id === g)) return g as Pestana
    } catch {
      /* sin almacenamiento */
    }
    return 'hoy'
  })
  const [buzonId, setBuzonId] = useState<string | null>(null)
  const [filtroCola, setFiltroCola] = useState<FiltroDeCola>({ grupo: 'vivas', buzonId: null, q: '' })
  const [abierta, setAbierta] = useState<string | null>(null)
  const [opciones, setOpciones] = useState<Tablero['buzones']>([])
  const [ultima, setUltima] = useState<number | null>(null)
  const [recargando, setRecargando] = useState(false)

  const elegir = useCallback((p: Pestana) => {
    setPestana(p)
    // «Novedades» solo existe en la demostración: no se recuerda para la próxima vez
    if (p === 'novedades') return
    try {
      window.localStorage.setItem(PESTANA_GUARDADA, p)
    } catch {
      /* sin almacenamiento */
    }
  }, [])

  // Entrar y salir de la demostración: lo que se tenía abierto (un detalle, un buzón, una búsqueda) es de otro mundo
  const entrarEnLaDemo = useCallback(() => {
    setAbierta(null)
    setBuzonId(null)
    setOpciones([])
    setFiltroCola({ grupo: 'vivas', buzonId: null, q: '' })
    setDemo(0)
    elegir('novedades')
  }, [elegir, setDemo])
  const salirDeLaDemo = useCallback(() => {
    setAbierta(null)
    setBuzonId(null)
    setOpciones([])
    setFiltroCola({ grupo: 'vivas', buzonId: null, q: '' })
    setDemo(null)
    setPestana((p) => (p === 'novedades' ? 'hoy' : p))
  }, [setDemo])

  // En Ajustes y en Salud se ven todos los buzones aunque se esté filtrando por uno
  const todosLosBuzones = pestana === 'ajustes' || pestana === 'salud'
  const { tablero, falta, error, cargando, desfase, recargar } = useTablero(todosLosBuzones ? null : buzonId, visible)
  const ahora = useAhora(15_000) + desfase

  useEffect(() => {
    if (!tablero) return
    setUltima(Date.now())
    if (!buzonId && !todosLosBuzones) setOpciones(tablero.buzones)
  }, [tablero]) // eslint-disable-line react-hooks/exhaustive-deps

  // Lo que acaba de salir mientras se mira: su punto hace un destello
  const vistosHoy = useMemo(() => (tablero ? tablero.hoy.carriles.flatMap((c) => c.puntos.map((p) => ({ id: p.pasoId, enviado: p.estado === 'enviado' }))) : []), [tablero])
  const recien = useRecien(vistosHoy)

  // Escape cierra el detalle
  useEffect(() => {
    if (!abierta) return
    const alTeclear = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && setAbierta(null)
    window.addEventListener('keydown', alTeclear)
    return () => window.removeEventListener('keydown', alTeclear)
  }, [abierta])

  const refrescar = useCallback(async () => {
    setRecargando(true)
    await recargar()
    setRecargando(false)
  }, [recargar])

  const esAdmin = (tablero?.puedeAdministrar ?? false) && demo === null
  const vivas = tablero ? tablero.conteos.activa + tablero.conteos.pausada : 0
  // Solo un administrador puede enseñar la demostración (el servidor lo vuelve a comprobar). Si el tablero no está disponible (falta la migración) también se ofrece: es lo único que se puede ver
  const puedeEnsenarLaDemo = tablero ? tablero.puedeAdministrar : Boolean(falta)
  // Quien no administra también ve los Ajustes (para saber cómo funciona), solo que sin poder cambiarlos
  const pestanasVisibles = demo === null ? PESTANAS : [PESTANA_DE_NOVEDADES, ...PESTANAS]

  // Con las flechas se pasa de una pestaña a otra (el patrón de las pestañas accesibles)
  function alTeclearEnPestanas(e: KeyboardEvent<HTMLElement>, actual: Pestana) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    e.preventDefault()
    const lista = pestanasVisibles
    const i = lista.findIndex((p) => p.id === actual)
    const sig = lista[(i + (e.key === 'ArrowRight' ? 1 : lista.length - 1)) % lista.length]
    document.getElementById(`sec-pestana-${sig.id}`)?.focus()
    elegir(sig.id)
  }


  return (
    <div className="space-y-3">
      <header className={`${PANEL} relative overflow-hidden`}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
          <button type="button" onClick={onVolver} className={BOTON_SECUNDARIO} aria-label="Volver a la bandeja de correo">
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> <span className="hidden sm:inline">Correo</span>
          </button>
          <h1 className="flex items-center gap-2 text-[15px] font-semibold tracking-[-0.01em] text-[var(--ls-t1)]">
            <span className="flex h-[26px] w-[26px] items-center justify-center rounded-[7px] bg-[var(--ls-acc-suave)] text-[var(--ls-acc)]">
              <Workflow className="h-4 w-4" aria-hidden />
            </span>
            Secuencias
          </h1>
          {demo !== null ? (
            <span className="inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full border border-[var(--ls-acc-borde)] bg-[var(--ls-acc-suave)] px-2.5 text-[11.5px] font-semibold text-[var(--ls-acc)]" title="Personas y correos inventados: no sale ni se guarda nada">
              <Presentation className="h-3 w-3" aria-hidden /> Demostración
            </span>
          ) : (
            tablero && <PildoraDeEstado tablero={tablero} />
          )}

          <div className="ml-auto flex flex-wrap items-center gap-2">
            {demo === null && puedeEnsenarLaDemo && (
              <button type="button" onClick={entrarEnLaDemo} className={BOTON_SECUNDARIO} title="Ver las secuencias con personas inventadas y un reloj que se puede avanzar: no toca nada de verdad">
                <Presentation className="h-3.5 w-3.5" aria-hidden /> Ver demostración
              </button>
            )}
            {opciones.length > 1 && !todosLosBuzones && (
              <label className="flex items-center gap-1.5 text-[11.5px] text-[var(--ls-t3)]">
                {buzonId ? <Avatar id={buzonId} nombre={opciones.find((b) => b.id === buzonId)?.propietario.nombre ?? '?'} tamano={18} /> : null}
                <span className="sr-only">Buzón</span>
                <select
                  value={buzonId ?? ''}
                  onChange={(e) => {
                    const v = e.target.value || null
                    setBuzonId(v)
                    setFiltroCola((f) => ({ ...f, buzonId: v }))
                  }}
                  className="h-7 rounded-[6px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-2 text-[12px] text-[var(--ls-t1)] outline-none focus:border-[var(--ls-acc-graf)]"
                  aria-label="Ver los correos de un buzón"
                >
                  <option value="">Todos los buzones</option>
                  {opciones.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.propietario.nombre}
                      {b.esMio ? ' (tú)' : ''}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <span className="hidden text-[11px] text-[var(--ls-t4)] sm:inline" aria-live="off">
              {ultima ? `Actualizado ${hace(Date.now(), ultima)}` : ''}
            </span>
            <button type="button" onClick={() => void refrescar()} disabled={recargando} className="inline-flex h-7 w-7 items-center justify-center rounded-[6px] text-[var(--ls-t4)] transition-colors hover:bg-[var(--ls-sup3)] hover:text-[var(--ls-t1)] disabled:opacity-50" aria-label="Actualizar ahora" title="Actualizar ahora">
              <RefreshCw className={`h-3.5 w-3.5 ${recargando ? 'animate-spin' : ''}`} aria-hidden />
            </button>
          </div>
        </div>

        <div role="tablist" aria-label="Secciones de las secuencias" className="flex gap-0.5 overflow-x-auto border-t border-[var(--ls-linea)] px-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {pestanasVisibles.map((p) => {
            const activa = pestana === p.id
            return (
              <button
                key={p.id}
                id={`sec-pestana-${p.id}`}
                type="button"
                role="tab"
                aria-selected={activa}
                aria-controls="sec-panel"
                tabIndex={activa ? 0 : -1}
                onClick={() => elegir(p.id)}
                onKeyDown={(e) => alTeclearEnPestanas(e, p.id)}
                className={`relative inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap px-3 text-[12.5px] font-medium transition-colors ${activa ? 'text-[var(--ls-t1)]' : 'text-[var(--ls-t3)] hover:text-[var(--ls-t1)]'}`}
              >
                <p.Icono className={`h-3.5 w-3.5 ${activa ? 'text-[var(--ls-acc)]' : ''}`} aria-hidden />
                {p.etiqueta}
                {p.id === 'cola' && vivas > 0 && <span className="rounded-[4px] bg-[var(--ls-sup3)] px-1 text-[10.5px] tabular-nums text-[var(--ls-t3)]">{vivas}</span>}
                {p.id === 'salud' && tablero && tablero.salud.alarmas.length > 0 && (
                  <span
                    className="rounded-[4px] px-1 text-[10.5px] font-semibold tabular-nums"
                    style={{ color: tablero.salud.nivel === 'problema' ? 'var(--ls-e-rojo)' : 'var(--ls-e-ambar)', background: `color-mix(in srgb, ${tablero.salud.nivel === 'problema' ? 'var(--ls-e-rojo)' : 'var(--ls-e-ambar)'} 16%, transparent)` }}
                    title={tablero.salud.resumen}
                  >
                    {tablero.salud.alarmas.length}
                  </span>
                )}
                <span className={`absolute inset-x-2 bottom-0 h-[2px] origin-left rounded-full bg-[var(--ls-acc-graf)] transition-transform duration-300 ${activa ? 'scale-x-100' : 'scale-x-0'}`} aria-hidden />
              </button>
            )
          })}
        </div>
        <BarraDeCarga activa={cargando || recargando} />
      </header>

      {demo !== null && <BarraDeLaDemo dias={demo} maximo={tablero?.demo?.maximo ?? 7} ahora={tablero?.ahora ?? null} onDias={setDemo} onSalir={salirDeLaDemo} />}

      {falta && demo === null && (
        <Aviso titulo="Falta un paso para usar las secuencias">
          <p>{falta}</p>
        </Aviso>
      )}

      {error && (!falta || demo !== null) && (
        <p className="flex items-center gap-2 rounded-[8px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] px-3 py-2 text-[12px] text-[var(--ls-e-ambar)]" role="status">
          <TriangleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1">{tablero ? `No se ha podido actualizar (${error}). Se ve lo último que llegó.` : error}</span>
          <button type="button" onClick={() => void refrescar()} className="shrink-0 text-[var(--ls-t2)] underline-offset-2 hover:underline">
            Reintentar
          </button>
        </p>
      )}

      {tablero && (
        <>
          {!tablero.ajustes.activa && (
            <p className="rounded-[8px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] px-3 py-2 text-[12px] leading-snug text-[var(--ls-t3)]">
              El motor está <strong className="text-[var(--ls-t2)]">apagado</strong>: no programa ni envía ningún seguimiento.
              {esAdmin ? (
                <>
                  {' '}
                  Para empezar, ve a{' '}
                  <button type="button" onClick={() => elegir('ajustes')} className="font-medium text-[var(--ls-acc)] underline-offset-2 hover:underline">
                    Ajustes
                  </button>{' '}
                  y pásalo a Ensayo: durante un día reparte horas y decide sin enviar nada.
                </>
              ) : (
                ' Un administrador lo activará cuando esté listo.'
              )}
            </p>
          )}
          {tablero.ajustes.activa && tablero.ajustes.modoEnsayo && (
            <p className="rounded-[8px] border border-[var(--ls-linea)] border-l-2 border-l-[var(--ls-e-ambar)] bg-[var(--ls-sup)] px-3 py-2 text-[12px] leading-snug text-[var(--ls-t3)]">
              <strong className="text-[var(--ls-t2)]">Modo ensayo.</strong> El motor vigila, reparte las horas y decide qué haría con cada lead, pero no envía nada. Lo que ves es lo que pasaría de verdad.
            </p>
          )}
          {pestana !== 'salud' && <AvisosDeSalud tablero={tablero} onVerSalud={() => elegir('salud')} />}
        </>
      )}

      <div id="sec-panel" role="tabpanel" aria-labelledby={`sec-pestana-${pestana}`} className="min-w-0">
        {!tablero && !falta && (cargando || !error) ? (
          <Cargando />
        ) : tablero ? (
          <div key={pestana} className="rend-aparece" style={{ '--d': 0 } as CSSProperties}>
            {pestana === 'novedades' && demo !== null && <NovedadesDelJueves />}
            {pestana === 'hoy' && <VistaDeHoy tablero={tablero} ahora={ahora} onAbrir={setAbierta} recien={recien} />}
            {pestana === 'cola' && <ColaDeLeads filtro={filtroCola} onFiltro={setFiltroCola} tablero={tablero} ahora={ahora} onAbrir={setAbierta} activa={visible} />}
            {pestana === 'proximos' && <VistaDeProximos tablero={tablero} />}
            {pestana === 'flujo' && <VistaDeFlujo tablero={tablero} ahora={ahora} onAbrir={setAbierta} />}
            {pestana === 'salud' && <VistaDeSalud tablero={tablero} ahora={ahora} />}
            {pestana === 'ajustes' && <AjustesDeSecuencias tablero={tablero} esAdmin={esAdmin} alGuardar={() => void refrescar()} />}
          </div>
        ) : null}
      </div>

      {abierta && (
        <PanelDeSecuencia
          key={abierta}
          id={abierta}
          ahora={ahora}
          onCerrar={() => setAbierta(null)}
          alCambiar={() => {
            void recargar()
          }}
        />
      )}
    </div>
  )
}
