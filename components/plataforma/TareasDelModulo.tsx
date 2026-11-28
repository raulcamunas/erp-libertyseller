'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { CalendarDays, ListPlus, Loader2, MessageSquare, SquareCheckBig } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

/**
 * EL TRABAJO DE UN MÓDULO COMO TAREAS DE CLIENTES (lib/trabajo/servidor.ts, /api/trabajo).
 *
 * `ProveedorDeTareas` pide UNA vez las tareas ya enlazadas a los elementos que se ven (una propuesta de PPC, una tarea de SEO, un listing) y quién puede
 * llevarlas. `BotonDeTarea` va en cada elemento: si ya tiene tarea, una pastilla con su estado, responsable y comentarios que lleva a ella; si no, «Tarea»
 * abre un cuadro para crearla con responsable, fecha y una nota (con @nombre se menciona y se avisa). Los comentarios, avisos, «Mi día» e historial son los
 * de Tareas de clientes. Sin permiso de Tareas, o con el cliente sin pareja en Tareas, no se pinta nada (o un botón apagado que dice por qué).
 */

export type ModuloDeTrabajo = 'ppc' | 'seo' | 'cumplimiento' | 'remesas' | 'resenas'

interface TareaEnlazada {
  ref: string
  tareaId: string
  titulo: string
  estado: string
  responsables: Array<{ id: string; nombre: string }>
  fechaFin: string | null
  comentarios: number
  href: string
}

interface Contexto {
  disponible: boolean
  sinPareja: boolean
  tareas: Map<string, TareaEnlazada>
  personas: Array<{ id: string; nombre: string }>
  crear: (e: { ref: string; titulo: string; enlace: string; responsables: string[]; fechaFin: string | null; nota: string }) => Promise<string | null>
}

const Ctx = createContext<Contexto | null>(null)

export function ProveedorDeTareas({ cliente, modulo, refs, children }: { cliente: string | null; modulo: ModuloDeTrabajo; refs: readonly string[]; children: ReactNode }) {
  const [estado, setEstado] = useState<{ disponible: boolean; sinPareja: boolean; tareas: Map<string, TareaEnlazada>; personas: Array<{ id: string; nombre: string }> }>({ disponible: false, sinPareja: false, tareas: new Map(), personas: [] })
  const clave = useMemo(() => [...new Set(refs)].sort().join('|'), [refs])

  useEffect(() => {
    if (!cliente) return
    let vivo = true
    fetch('/api/trabajo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'leer', cliente, modulo, refs: clave ? clave.split('|') : [] }) })
      .then(async (r) => (r.ok ? ((await r.json()) as { tcClienteId: string | null; tareas: TareaEnlazada[]; personas: Array<{ id: string; nombre: string }> }) : null))
      .then((d) => {
        if (!vivo) return
        if (!d) return setEstado((e) => ({ ...e, disponible: false }))
        setEstado({ disponible: true, sinPareja: !d.tcClienteId, tareas: new Map(d.tareas.map((t) => [t.ref, t])), personas: d.personas })
      })
      .catch(() => vivo && setEstado((e) => ({ ...e, disponible: false })))
    return () => {
      vivo = false
    }
  }, [cliente, modulo, clave])

  const crear = useCallback<Contexto['crear']>(
    async (e) => {
      if (!cliente) return 'Falta el cliente.'
      const r = await fetch('/api/trabajo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'crear', cliente, modulo, ...e }) })
      const d = (await r.json().catch(() => ({}))) as { tarea?: TareaEnlazada; error?: string }
      if (!r.ok || !d.tarea) return d.error ?? 'No se ha podido crear la tarea.'
      setEstado((s) => ({ ...s, tareas: new Map(s.tareas).set(e.ref, d.tarea as TareaEnlazada) }))
      return null
    },
    [cliente, modulo],
  )

  return <Ctx.Provider value={{ ...estado, crear }}>{children}</Ctx.Provider>
}

const fechaCorta = (iso: string) => new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })

export function BotonDeTarea({ refId, titulo, enlace, compacto = false }: { refId: string; titulo: string; enlace?: string; compacto?: boolean }) {
  const c = useContext(Ctx)
  const [abierto, setAbierto] = useState(false)
  const [responsable, setResponsable] = useState('')
  const [fecha, setFecha] = useState('')
  const [nota, setNota] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!c || !c.disponible) return null
  const t = c.tareas.get(refId)
  if (t) {
    const vencida = t.fechaFin && Date.parse(t.fechaFin) < Date.now()
    return (
      <Link
        href={t.href}
        onClick={(e) => e.stopPropagation()}
        title={`Tarea: ${t.titulo}`}
        className="inline-flex h-7 max-w-full shrink-0 items-center gap-1.5 rounded-full border border-[color-mix(in_srgb,#A78BFA_40%,var(--ls-linea))] bg-[color-mix(in_srgb,#A78BFA_10%,transparent)] px-2.5 text-[11.5px] font-medium text-[#C4B5FD] transition-colors hover:bg-[color-mix(in_srgb,#A78BFA_18%,transparent)]"
      >
        <SquareCheckBig className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="truncate">{t.estado || 'Tarea'}</span>
        {!compacto && t.responsables[0] && <span className="truncate text-[var(--ls-t3)]">· {t.responsables.map((r) => r.nombre).join(', ')}</span>}
        {t.fechaFin && (
          <span className={`inline-flex items-center gap-0.5 ${vencida ? 'text-[#F87171]' : 'text-[var(--ls-t3)]'}`}>
            <CalendarDays className="h-3 w-3" aria-hidden />
            {fechaCorta(t.fechaFin)}
          </span>
        )}
        {t.comentarios > 0 && (
          <span className="inline-flex items-center gap-0.5 text-[var(--ls-t3)]">
            <MessageSquare className="h-3 w-3" aria-hidden />
            {t.comentarios}
          </span>
        )}
      </Link>
    )
  }
  if (c.sinPareja) {
    return (
      <span title="Este cliente no está en Tareas de clientes (o tiene otro nombre): créalo o enlázalo allí para poder asignar trabajo." className="inline-flex h-7 shrink-0 cursor-not-allowed items-center gap-1 rounded-full border border-dashed border-[var(--ls-linea)] px-2.5 text-[11.5px] text-[var(--ls-t4)]">
        <ListPlus className="h-3.5 w-3.5" aria-hidden /> Tarea
      </span>
    )
  }
  const enviar = async () => {
    setEnviando(true)
    setError(null)
    const e = await c.crear({ ref: refId, titulo, enlace: enlace ?? `${window.location.pathname}${window.location.search}`, responsables: responsable ? [responsable] : [], fechaFin: fecha || null, nota })
    setEnviando(false)
    if (e) setError(e)
    else setAbierto(false)
  }
  return (
    <Popover open={abierto} onOpenChange={setAbierto}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full border border-[var(--ls-linea)] px-2.5 text-[11.5px] font-medium text-[var(--ls-t3)] transition-colors hover:border-[color-mix(in_srgb,#A78BFA_50%,var(--ls-linea))] hover:text-[var(--ls-t1)]"
          title="Crear una tarea con responsable, fecha y comentarios"
        >
          <ListPlus className="h-3.5 w-3.5" aria-hidden /> {compacto ? '' : 'Tarea'}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(340px,calc(100vw-24px))] space-y-2.5 p-3" onClick={(e) => e.stopPropagation()}>
        <div className="text-[12px] font-semibold text-[var(--ls-t1)]">Nueva tarea</div>
        <div className="line-clamp-2 text-[12px] text-[var(--ls-t3)]">{titulo}</div>
        <label className="block text-[11px] text-[var(--ls-t4)]">
          Responsable
          <select value={responsable} onChange={(e) => setResponsable(e.target.value)} className="mt-1 h-9 w-full rounded-[9px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-2 text-[13px] text-[var(--ls-t1)]">
            <option value="">Sin asignar</option>
            {c.personas.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-[11px] text-[var(--ls-t4)]">
          Para cuándo
          <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className="mt-1 h-9 w-full rounded-[9px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-2 text-[13px] text-[var(--ls-t1)]" />
        </label>
        <label className="block text-[11px] text-[var(--ls-t4)]">
          Nota (con @nombre se avisa a esa persona)
          <textarea value={nota} onChange={(e) => setNota(e.target.value)} rows={3} className="mt-1 w-full resize-none rounded-[9px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-2 py-1.5 text-[13px] text-[var(--ls-t1)]" />
        </label>
        {error && <p className="text-[12px] text-[#F87171]">{error}</p>}
        <button type="button" disabled={enviando} onClick={enviar} className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-[10px] bg-[#F26212] text-[13px] font-semibold text-white disabled:opacity-60">
          {enviando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <ListPlus className="h-4 w-4" aria-hidden />} Crear tarea
        </button>
      </PopoverContent>
    </Popover>
  )
}
