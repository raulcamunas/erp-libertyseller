'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { AlertCircle, AtSign, Bell, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Eye, ListChecks, Loader2, Lock, MessageSquare, NotebookPen, Plus, Sparkles, Sun, Trash2, UserPlus, X } from 'lucide-react'
import { toast } from 'sonner'
import { Avatar } from '@/components/rendimiento/ui'
import { hoyEnEspana } from '@/lib/tareas-clientes/filtros'
import { idNuevoDePunto, progresoDelPlan, repartirPorFecha, saludoDeLaHora, sugerirRevision, sumarDiasA, type PuntoDelPlan } from '@/lib/tareas-clientes/mi-dia'
import type { DatosDeMiDia } from '@/lib/tareas-clientes/mi-dia-servidor'
import type { TareaLigera } from '@/lib/tareas-clientes/servidor'
import type { ClienteTC, PersonaTC } from '@/lib/tareas-clientes/tipos'
import { AvisosPush } from '@/components/push/AvisosPush'
import { BASE, pedir } from './api'
import { Calendario } from './Calendario'
import { useBloqueadas } from './contexto'
import { fechaCorta } from './ui'
import { estaHechaLaTarea, type MapaDeClientes } from './vistas'

/**
 * «MI DÍA»: el sitio desde el que se trabaja. Arriba, el briefing de hoy (el plan como checklist y la revisión de final de día, lo que antes eran las páginas «Briefing de …» de
 * Notion); debajo, mis tareas por fecha o en calendario; a la derecha, lo que ha pasado desde la última vez (comentarios y menciones, tareas nuevas, avisos) y mis anotaciones.
 * Un administrador puede mirar el briefing de cualquiera del equipo (solo leer).
 */

const AUTOGUARDADO_MS = 700
const REFRESCO_MS = 60_000

const hace = (iso: string): string => {
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000)
  if (s < 45) return 'ahora'
  if (s < 3600) return `hace ${Math.round(s / 60)} min`
  if (s < 86_400) return `hace ${Math.round(s / 3600)} h`
  if (s < 7 * 86_400) return `hace ${Math.round(s / 86_400)} d`
  return fechaCorta(iso)
}

const diaLegible = (dia: string, hoy: string): string => {
  const f = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${dia}T00:00:00Z`))
  return dia === hoy ? `Hoy · ${f}` : dia === sumarDiasA(hoy, -1) ? `Ayer · ${f}` : dia === sumarDiasA(hoy, 1) ? `Mañana · ${f}` : f
}

export interface PropsDeMiDia {
  miId: string
  esAdmin: boolean
  personas: readonly PersonaTC[]
  tareas: readonly TareaLigera[]
  clientes: readonly ClienteTC[]
  mapa: MapaDeClientes
  abierta: string | null
  onAbrir: (id: string) => void
  onCambiar: (id: string, cambios: Record<string, unknown>) => void
}

function Anillo({ porcentaje, tamano = 54 }: { porcentaje: number; tamano?: number }) {
  const r = (tamano - 6) / 2
  const c = 2 * Math.PI * r
  return (
    <svg width={tamano} height={tamano} viewBox={`0 0 ${tamano} ${tamano}`} role="img" aria-label={`${porcentaje} % del plan hecho`} className="tc-dia-anillo">
      <circle cx={tamano / 2} cy={tamano / 2} r={r} fill="none" stroke="var(--ls-linea2)" strokeWidth="5" />
      <circle cx={tamano / 2} cy={tamano / 2} r={r} fill="none" stroke={porcentaje === 100 ? 'var(--ls-e-verde)' : 'var(--ls-acc-graf)'} strokeWidth="5" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - porcentaje / 100)} transform={`rotate(-90 ${tamano / 2} ${tamano / 2})`} style={{ transition: 'stroke-dashoffset 0.4s ease' }} />
      <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" fontSize="12" fontWeight="600" fill="var(--ls-t1)">{porcentaje}%</text>
    </svg>
  )
}

function FilaDeTarea({ t, mapa, activa, onAbrir, alPlan }: { t: TareaLigera; mapa: MapaDeClientes; activa: boolean; onAbrir: (id: string) => void; alPlan?: () => void }) {
  const cliente = mapa.get(t.cliente_id)
  const bloqueada = useBloqueadas().has(t.id)
  const dia = (t.fecha_fin ?? t.fecha_inicio)?.slice(0, 10)
  return (
    <li className="tc-dia-tarea group/f" data-activa={activa ? 'true' : undefined}>
      <button type="button" className="tc-dia-tarea-cuerpo" onClick={() => onAbrir(t.id)}>
        <span className="text-[14px] leading-none">{t.icono ?? cliente?.icono ?? '•'}</span>
        <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--ls-t1)]">{t.titulo || 'Sin título'}</span>
        {bloqueada && <span className="tc-aviso-bloqueo !mt-0 shrink-0"><Lock className="h-3 w-3" /></span>}
        <span className="hidden shrink-0 truncate text-[11.5px] text-[var(--ls-t4)] sm:block sm:max-w-[120px]">{cliente?.nombre}</span>
        {dia && <span className="shrink-0 text-[11.5px] tabular-nums text-[var(--ls-t3)]">{fechaCorta(t.fecha_fin ?? t.fecha_inicio)}</span>}
      </button>
      {alPlan && <button type="button" onClick={alPlan} className="tc-icono-boton !h-6 !w-6 opacity-0 focus-visible:opacity-100 group-hover/f:opacity-100" aria-label={`Añadir «${t.titulo || 'tarea'}» al plan de hoy`} title="Añadir al plan de hoy"><Plus className="h-3 w-3" /></button>}
    </li>
  )
}

export function MiDia({ miId, esAdmin, personas, tareas, clientes, mapa, abierta, onAbrir, onCambiar }: PropsDeMiDia) {
  const [hoy, setHoy] = useState(hoyEnEspana())
  const [dia, setDia] = useState(hoyEnEspana())
  const [usuario, setUsuario] = useState<string | null>(null)
  const [datos, setDatos] = useState<DatosDeMiDia | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [plan, setPlan] = useState<PuntoDelPlan[]>([])
  const [revision, setRevision] = useState('')
  const [notas, setNotas] = useState('')
  const [nuevo, setNuevo] = useState('')
  const [pestana, setPestana] = useState<'tareas' | 'calendario'>('tareas')
  const [guardado, setGuardado] = useState<'ok' | 'guardando' | 'error'>('ok')
  const [sugiriendo, setSugiriendo] = useState(false)
  const sucioPlan = useRef(false)
  const sucioRevision = useRef(false)
  const sucioNotas = useRef(false)
  const temporizador = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const diaActual = useRef(dia)
  diaActual.current = dia
  const usuarioActual = useRef(usuario)
  usuarioActual.current = usuario

  const de = usuario ?? miId
  const soloLectura = usuario !== null && usuario !== miId
  const nombreDe = useCallback((id: string) => personas.find((p) => p.id === id)?.nombre ?? '', [personas])
  const miNombre = nombreDe(miId).split(' ')[0]

  /* ---- Cargar ---- */
  const cargar = useCallback(
    async (completo: boolean) => {
      try {
        const q = new URLSearchParams({ dia: diaActual.current })
        if (usuarioActual.current) q.set('usuario', usuarioActual.current)
        const d = await pedir<DatosDeMiDia>(`${BASE}/mi-dia?${q}`)
        setError(null)
        setHoy(d.hoy)
        setDatos(d)
        // Lo que se está escribiendo no se pisa con lo que hay guardado
        if (completo || !sucioPlan.current) setPlan(d.briefing.plan)
        if (completo || !sucioRevision.current) setRevision(d.briefing.revision)
        if (completo || !sucioNotas.current) setNotas(d.notas)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'No se ha podido abrir «Mi día»')
      }
    },
    []
  )

  useEffect(() => {
    sucioPlan.current = sucioRevision.current = false
    setDatos((d) => (d ? { ...d, briefing: { ...d.briefing, dia } } : d))
    void cargar(true)
  }, [dia, usuario, cargar])

  useEffect(() => {
    const t = setInterval(() => document.visibilityState === 'visible' && void cargar(false), REFRESCO_MS)
    const alVolver = () => document.visibilityState === 'visible' && void cargar(false)
    document.addEventListener('visibilitychange', alVolver)
    return () => {
      clearInterval(t)
      document.removeEventListener('visibilitychange', alVolver)
    }
  }, [cargar])

  /* ---- Guardar (con espera: no se guarda en cada letra) ---- */
  const programar = useCallback((clave: string, trabajo: () => Promise<void>) => {
    if (temporizador.current[clave]) clearTimeout(temporizador.current[clave])
    setGuardado('guardando')
    temporizador.current[clave] = setTimeout(() => {
      void trabajo()
        .then(() => setGuardado('ok'))
        .catch((e) => {
          setGuardado('error')
          toast.error(e instanceof Error ? e.message : 'No se ha podido guardar')
        })
    }, AUTOGUARDADO_MS)
  }, [])

  const guardarPlan = useCallback(
    (nuevoPlan: PuntoDelPlan[]) => {
      setPlan(nuevoPlan)
      sucioPlan.current = true
      const delDia = diaActual.current
      programar('plan', async () => {
        await pedir(`${BASE}/mi-dia`, { metodo: 'PUT', cuerpo: { dia: delDia, plan: nuevoPlan } })
        sucioPlan.current = false
      })
    },
    [programar]
  )
  const guardarRevision = useCallback(
    (texto: string) => {
      setRevision(texto)
      sucioRevision.current = true
      const delDia = diaActual.current
      programar('revision', async () => {
        await pedir(`${BASE}/mi-dia`, { metodo: 'PUT', cuerpo: { dia: delDia, revision: texto } })
        sucioRevision.current = false
      })
    },
    [programar]
  )
  const guardarNotas = useCallback(
    (texto: string) => {
      setNotas(texto)
      sucioNotas.current = true
      programar('notas', async () => {
        await pedir(`${BASE}/mi-dia/notas`, { metodo: 'PUT', cuerpo: { texto } })
        sucioNotas.current = false
      })
    },
    [programar]
  )

  // Al irse de la pantalla no se pierde lo último escrito
  const ultimo = useRef({ plan, revision, notas })
  ultimo.current = { plan, revision, notas }
  useEffect(
    () => () => {
      for (const t of Object.values(temporizador.current)) clearTimeout(t)
      const enviar = (url: string, cuerpo: unknown) => void fetch(url, { method: 'PUT', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) })
      if (sucioPlan.current && !usuarioActual.current) enviar(`${BASE}/mi-dia`, { dia: diaActual.current, plan: ultimo.current.plan })
      if (sucioRevision.current && !usuarioActual.current) enviar(`${BASE}/mi-dia`, { dia: diaActual.current, revision: ultimo.current.revision })
      if (sucioNotas.current) enviar(`${BASE}/mi-dia/notas`, { texto: ultimo.current.notas })
    },
    []
  )

  /* ---- El plan ---- */
  const añadirPunto = (texto: string, tarea?: TareaLigera) => {
    const limpio = texto.replace(/\s+/g, ' ').trim()
    if (!limpio || soloLectura) return
    if (tarea && plan.some((p) => p.tarea_id === tarea.id)) return toast.message('Esa tarea ya está en el plan')
    guardarPlan([...plan, { id: idNuevoDePunto(), texto: limpio, hecho: false, tarea_id: tarea?.id ?? null, cliente_id: tarea?.cliente_id ?? null }])
  }
  const cambiarPunto = (id: string, cambios: Partial<PuntoDelPlan>) => guardarPlan(plan.map((p) => (p.id === id ? { ...p, ...cambios } : p)))
  const quitarPunto = (id: string) => guardarPlan(plan.filter((p) => p.id !== id))

  const rellenarRevision = async () => {
    setSugiriendo(true)
    try {
      const a = await pedir<{ cerradas: string[]; comentarios: number }>(`${BASE}/mi-dia/actividad?dia=${dia}`)
      const texto = sugerirRevision({ puntosHechos: plan.filter((p) => p.hecho).map((p) => p.texto), puntosPendientes: plan.filter((p) => !p.hecho).map((p) => p.texto), tareasCerradas: a.cerradas, comentarios: a.comentarios })
      if (!texto) return toast.message('Todavía no hay nada que resumir de este día')
      guardarRevision(revision.trim() ? `${revision.trimEnd()}\n\n${texto}` : texto)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se ha podido preparar el resumen')
    } finally {
      setSugiriendo(false)
    }
  }

  /* ---- Mis tareas ---- */
  const lasDe = useMemo(() => tareas.filter((t) => t.responsables.includes(de) && !estaHechaLaTarea(t, mapa)), [tareas, de, mapa])
  const reparto = useMemo(() => repartirPorFecha(lasDe, hoy), [lasDe, hoy])
  const lasTareasDe = useMemo(() => new Map(tareas.map((t) => [t.id, t])), [tareas])
  const progreso = progresoDelPlan(plan)
  const enPlan = new Set(plan.map((p) => p.tarea_id).filter(Boolean))

  const grupo = (titulo: string, lista: TareaLigera[], tono?: string, abiertoPorDefecto = true) =>
    lista.length === 0 ? null : (
      <details open={abiertoPorDefecto} className="tc-dia-grupo" style={{ '--tono': tono } as CSSProperties}>
        <summary><span>{titulo}</span><span className="tc-contador">{lista.length}</span></summary>
        <ul className="flex flex-col gap-0.5">
          {lista.map((t) => <FilaDeTarea key={t.id} t={t} mapa={mapa} activa={abierta === t.id} onAbrir={onAbrir} alPlan={soloLectura || enPlan.has(t.id) ? undefined : () => añadirPunto(`${mapa.get(t.cliente_id)?.nombre ? `${mapa.get(t.cliente_id)?.nombre} ⇒ ` : ''}${t.titulo || 'Tarea sin título'}`, t)} />)}
        </ul>
      </details>
    )

  if (error && !datos) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center" role="alert">
        <AlertCircle className="h-5 w-5 text-[var(--ls-e-rojo)]" />
        <p className="text-[13px] text-[var(--ls-t2)]">{error}</p>
        <button type="button" onClick={() => void cargar(true)} className="tc-boton-primario">Reintentar</button>
      </div>
    )
  }

  const esHoy = dia === hoy
  const nuevas = (datos?.nuevas ?? []).filter((n) => lasTareasDe.has(n.tarea_id))
  const comentarios = datos?.comentarios ?? []
  const avisos = datos?.avisos ?? []

  return (
    <div className="tc-dia">
      <header className="tc-dia-cabecera">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-[12.5px] text-[var(--ls-t3)]"><Sun className="h-3.5 w-3.5 text-[var(--ls-acc)]" />{soloLectura ? `Briefing de ${nombreDe(de) || 'otra persona'}` : `${saludoDeLaHora()}${miNombre ? `, ${miNombre}` : ''}`}</p>
          <h1 className="mt-0.5 text-[24px] font-semibold leading-tight text-[var(--ls-t1)] first-letter:uppercase">{diaLegible(dia, hoy)}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="tc-chip-estado" aria-live="polite">
            {guardado === 'guardando' && <><Loader2 className="h-3 w-3 animate-spin" /> Guardando…</>}
            {guardado === 'ok' && <><CheckCircle2 className="h-3 w-3 text-[var(--ls-e-verde)]" /> Guardado</>}
            {guardado === 'error' && <><AlertCircle className="h-3 w-3 text-[var(--ls-e-rojo)]" /> Sin guardar</>}
          </span>
          <div className="tc-split">
            <button type="button" className="tc-boton-herramienta !rounded-r-none" aria-label="Día anterior" onClick={() => setDia(sumarDiasA(dia, -1))}><ChevronLeft className="h-3.5 w-3.5" /></button>
            <button type="button" className="tc-boton-herramienta !rounded-none" disabled={esHoy} onClick={() => setDia(hoy)}>Hoy</button>
            <button type="button" className="tc-boton-herramienta !rounded-l-none" aria-label="Día siguiente" onClick={() => setDia(sumarDiasA(dia, 1))}><ChevronRight className="h-3.5 w-3.5" /></button>
          </div>
          <input type="date" value={dia} onChange={(e) => e.target.value && setDia(e.target.value)} aria-label="Elegir día" className="tc-fecha" />
          <Anillo porcentaje={progreso.porcentaje} />
        </div>
      </header>

      {soloLectura && (
        <div className="tc-dia-aviso"><Eye className="h-3.5 w-3.5" /> Estás viendo el briefing de {nombreDe(de) || 'otra persona'}; solo se puede leer. <button type="button" onClick={() => setUsuario(null)} className="underline">Volver al mío</button></div>
      )}
      {datos && !datos.disponible && <div className="tc-dia-aviso" data-tono="ambar"><AlertCircle className="h-3.5 w-3.5" /> Falta lanzar la migración 279 en Supabase para guardar el briefing y las anotaciones.</div>}

      {esAdmin && datos?.equipo && datos.equipo.length > 0 && (
        <div className="tc-dia-equipo" aria-label="El equipo hoy">
          {datos.equipo.map((p) => (
            <button key={p.id} type="button" onClick={() => setUsuario(p.id === miId ? null : p.id)} aria-pressed={de === p.id} className="tc-dia-persona" title={p.total === 0 ? 'Sin plan hoy' : `${p.hechos} de ${p.total} puntos hechos`}>
              <Avatar id={p.id} nombre={p.nombre} tamano={20} />
              <span className="truncate">{p.nombre.split(' ')[0]}</span>
              <span className="tabular-nums text-[11px] text-[var(--ls-t4)]">{p.total === 0 ? '—' : `${p.hechos}/${p.total}`}</span>
            </button>
          ))}
        </div>
      )}

      <div className="tc-dia-rejilla">
        <div className="tc-dia-principal">
          <section className="tc-dia-tarjeta" aria-label="Plan del día">
            <h2 className="tc-seccion-titulo"><ListChecks className="h-3.5 w-3.5" /> Plan del día <span className="tc-contador">{progreso.hechos}/{progreso.total}</span></h2>
            {!datos && <div className="tc-esqueleto h-24 w-full" role="status" aria-label="Cargando" />}
            <ul className="flex flex-col gap-0.5">
              {plan.map((p) => {
                const t = p.tarea_id ? lasTareasDe.get(p.tarea_id) : undefined
                const cliente = p.cliente_id ? mapa.get(p.cliente_id) : undefined
                return (
                  <li key={p.id} className="tc-subtarea group/s">
                    <input type="checkbox" className="tc-casilla" checked={p.hecho} disabled={soloLectura} aria-label={`Hecho: ${p.texto}`} onChange={(e) => cambiarPunto(p.id, { hecho: e.target.checked })} />
                    <input
                      defaultValue={p.texto}
                      key={`${p.id}-${p.texto}`}
                      readOnly={soloLectura}
                      aria-label="Punto del plan"
                      maxLength={300}
                      onBlur={(e) => {
                        const v = e.target.value.replace(/\s+/g, ' ').trim()
                        if (!v) e.target.value = p.texto
                        else if (v !== p.texto) cambiarPunto(p.id, { texto: v })
                      }}
                      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                      className={`tc-subtarea-titulo ${p.hecho ? 'tc-hecha' : ''}`}
                    />
                    {t && <button type="button" onClick={() => onAbrir(t.id)} className="tc-dia-enlace" title="Abrir la tarea">{cliente?.icono ?? '↗'} Abrir</button>}
                    {!soloLectura && <button type="button" onClick={() => quitarPunto(p.id)} aria-label={`Quitar «${p.texto}» del plan`} className="tc-icono-boton opacity-0 group-hover/s:opacity-100 focus-visible:opacity-100"><Trash2 className="h-3 w-3" /></button>}
                  </li>
                )
              })}
              {datos && plan.length === 0 && <li className="px-1 py-2 text-[12.5px] text-[var(--ls-t4)]">{soloLectura ? 'No hay plan este día.' : 'Escribe qué vas a hacer hoy, o añade tareas con el «+» de la lista de abajo.'}</li>}
            </ul>
            {!soloLectura && (
              <div className="mt-1 flex items-center gap-2">
                <Plus className="h-3.5 w-3.5 text-[var(--ls-t4)]" />
                <input value={nuevo} onChange={(e) => setNuevo(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { añadirPunto(nuevo); setNuevo('') } }} maxLength={300} placeholder="Añadir al plan… (Enter)" aria-label="Nuevo punto del plan" className="tc-subtarea-titulo" />
              </div>
            )}
          </section>

          <section className="tc-dia-tarjeta" aria-label="Revisión de final de día">
            <h2 className="tc-seccion-titulo"><Sparkles className="h-3.5 w-3.5" /> Revisión de final de día
              {!soloLectura && <button type="button" onClick={() => void rellenarRevision()} disabled={sugiriendo} className="tc-boton-suave tc-discreto ml-auto">{sugiriendo ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />} Rellenar con lo que hice</button>}
            </h2>
            <textarea value={revision} readOnly={soloLectura} onChange={(e) => guardarRevision(e.target.value)} rows={5} maxLength={5000} placeholder={soloLectura ? 'Sin revisión.' : '¿Cómo ha ido el día? Qué se ha hecho, qué se ha atascado, qué queda para mañana…'} aria-label="Revisión de final de día" className="tc-dia-texto" />
          </section>

          <section className="tc-dia-tarjeta" aria-label={soloLectura ? 'Tareas' : 'Mis tareas'}>
            <div className="mb-2 flex items-center gap-1">
              <div className="tc-vistas" role="tablist">
                <button type="button" role="tab" aria-selected={pestana === 'tareas'} onClick={() => setPestana('tareas')} className="tc-vista-boton"><ListChecks className="h-3.5 w-3.5" /> {soloLectura ? 'Sus tareas' : 'Mis tareas'} <span className="tc-contador">{lasDe.length}</span></button>
                <button type="button" role="tab" aria-selected={pestana === 'calendario'} onClick={() => setPestana('calendario')} className="tc-vista-boton"><CalendarDays className="h-3.5 w-3.5" /> Calendario</button>
              </div>
            </div>
            {pestana === 'tareas' ? (
              lasDe.length === 0 ? (
                <p className="px-1 py-3 text-[12.5px] text-[var(--ls-t4)]">Nada pendiente. 🎉</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {grupo('Vencidas', reparto.vencidas, 'var(--tc-red)')}
                  {grupo('Hoy', reparto.hoy, 'var(--tc-orange)')}
                  {grupo('Esta semana', reparto.semana, 'var(--tc-blue)')}
                  {grupo('Más adelante', reparto.despues, undefined, false)}
                  {grupo('Sin fecha', reparto.sinFecha, undefined, reparto.vencidas.length + reparto.hoy.length + reparto.semana.length === 0)}
                </div>
              )
            ) : (
              <div className="tc-dia-calendario"><Calendario tareas={lasDe} clientes={mapa} tareaAbierta={abierta} onAbrir={onAbrir} onCambiar={onCambiar} /></div>
            )}
          </section>
        </div>

        <aside className="tc-dia-lateral">
          <section className="tc-dia-tarjeta" aria-label="Comentarios y menciones">
            <h2 className="tc-seccion-titulo"><MessageSquare className="h-3.5 w-3.5" /> Comentarios <span className="tc-contador">{comentarios.length}</span></h2>
            {comentarios.length === 0 && <p className="text-[12px] text-[var(--ls-t4)]">Nada nuevo en los últimos 14 días.</p>}
            <ul className="flex flex-col gap-2">
              {comentarios.slice(0, 8).map((c) => (
                <li key={c.id}>
                  <button type="button" onClick={() => onAbrir(c.tarea_id)} className="tc-dia-item">
                    <span className="flex items-center gap-1.5 text-[11.5px] text-[var(--ls-t3)]"><Avatar id={c.autor} nombre={c.autor} tamano={16} /><b className="font-medium text-[var(--ls-t2)]">{c.autor}</b>{c.me_menciona && <span className="inline-flex items-center gap-0.5 rounded bg-[var(--ls-acc-suave)] px-1 text-[10.5px] text-[var(--ls-acc)]"><AtSign className="h-2.5 w-2.5" />te menciona</span>}<span className="ml-auto">{hace(c.creado_en)}</span></span>
                    <span className="mt-0.5 block truncate text-[11.5px] text-[var(--ls-t4)]">en {c.tarea}</span>
                    <span className="mt-0.5 line-clamp-2 text-[12.5px] text-[var(--ls-t2)]">{c.cuerpo}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section className="tc-dia-tarjeta" aria-label="Tareas nuevas">
            <h2 className="tc-seccion-titulo"><UserPlus className="h-3.5 w-3.5" /> Nuevas para mí <span className="tc-contador">{nuevas.length}</span></h2>
            {nuevas.length === 0 && <p className="text-[12px] text-[var(--ls-t4)]">Nada nuevo esta semana.</p>}
            <ul className="flex flex-col gap-1">
              {nuevas.slice(0, 8).map((n) => {
                const t = lasTareasDe.get(n.tarea_id)
                return t ? (
                  <li key={n.tarea_id}>
                    <button type="button" onClick={() => onAbrir(t.id)} className="tc-dia-item">
                      <span className="block truncate text-[12.5px] text-[var(--ls-t1)]">{t.icono ?? mapa.get(t.cliente_id)?.icono ?? '•'} {t.titulo || 'Sin título'}</span>
                      <span className="block truncate text-[11px] text-[var(--ls-t4)]">{mapa.get(t.cliente_id)?.nombre} · {n.motivo === 'asignada' ? `te la asignó ${n.quien}` : 'creada'} · {hace(n.cuando)}</span>
                    </button>
                  </li>
                ) : null
              })}
            </ul>
          </section>

          <section className="tc-dia-tarjeta" aria-label="Avisos">
            <h2 className="tc-seccion-titulo"><Bell className="h-3.5 w-3.5" /> Avisos <span className="tc-contador">{avisos.filter((a) => !a.read).length || avisos.length}</span></h2>
            <AvisosPush />
            {avisos.length === 0 && <p className="text-[12px] text-[var(--ls-t4)]">Sin avisos.</p>}
            <ul className="flex flex-col gap-1">
              {avisos.slice(0, 8).map((a) => {
                const tareaId = (a.datos as { tareaId?: string } | null)?.tareaId
                return (
                  <li key={a.id}>
                    <button type="button" disabled={!tareaId} onClick={() => tareaId && onAbrir(tareaId)} className="tc-dia-item" data-sin-leer={a.read ? undefined : 'true'}>
                      <span className="block truncate text-[12.5px] text-[var(--ls-t1)]">{a.title}</span>
                      {a.message && <span className="block truncate text-[11px] text-[var(--ls-t4)]">{a.message}</span>}
                      <span className="block text-[10.5px] text-[var(--ls-t4)]">{hace(a.created_at)}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>

          <section className="tc-dia-tarjeta" aria-label="Anotaciones">
            <h2 className="tc-seccion-titulo"><NotebookPen className="h-3.5 w-3.5" /> Anotaciones</h2>
            <textarea value={notas} onChange={(e) => guardarNotas(e.target.value)} rows={7} maxLength={20000} placeholder="Tu bloc de notas: ideas, números, recordatorios… se guarda solo." aria-label="Anotaciones personales" className="tc-dia-texto" />
          </section>
        </aside>
      </div>
      {error && datos && <button type="button" onClick={() => setError(null)} className="tc-dia-aviso" data-tono="ambar"><X className="h-3 w-3" /> {error}</button>}
    </div>
  )
}
