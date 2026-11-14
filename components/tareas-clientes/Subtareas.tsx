'use client'

import { useCallback, useEffect, useState } from 'react'
import { ListChecks, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { PersonaTC } from '@/lib/tareas-clientes/tipos'
import { contarSubtareas, type SubtareaTC } from '@/lib/tareas-clientes/subtareas'
import { BASE, pedir } from './api'

/**
 * LAS SUBTAREAS DE UNA TAREA: una lista corta de pasos con su casilla, quién y para cuándo. Se guardan al instante. El contador de la tarjeta lo devuelve el servidor.
 */
export function Subtareas({ tareaId, gente, onContadores }: { tareaId: string; gente: readonly PersonaTC[]; onContadores: (c: { subtareas_total: number; subtareas_hechas: number }) => void }) {
  const [lista, setLista] = useState<SubtareaTC[] | null>(null)
  const [disponible, setDisponible] = useState(true)
  const [nueva, setNueva] = useState('')
  const [ocupado, setOcupado] = useState(false)

  useEffect(() => {
    let vivo = true
    setLista(null)
    pedir<{ subtareas: SubtareaTC[]; disponible: boolean }>(`${BASE}/tareas/${tareaId}/subtareas`)
      .then((r) => {
        if (!vivo) return
        setLista(r.subtareas)
        setDisponible(r.disponible)
      })
      .catch(() => vivo && setLista([]))
    return () => {
      vivo = false
    }
  }, [tareaId])

  const añadir = useCallback(async () => {
    const titulo = nueva.trim()
    if (!titulo || ocupado) return
    setOcupado(true)
    try {
      const r = await pedir<{ subtarea: SubtareaTC; subtareas_total: number; subtareas_hechas: number }>(`${BASE}/tareas/${tareaId}/subtareas`, { metodo: 'POST', cuerpo: { titulo } })
      setLista((l) => [...(l ?? []), r.subtarea])
      setNueva('')
      onContadores(r)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se ha podido crear la subtarea')
    } finally {
      setOcupado(false)
    }
  }, [nueva, ocupado, tareaId, onContadores])

  const cambiar = async (s: SubtareaTC, cambios: Partial<Pick<SubtareaTC, 'titulo' | 'hecha' | 'responsable_id' | 'fecha'>>) => {
    setLista((l) => (l ?? []).map((x) => (x.id === s.id ? { ...x, ...cambios } : x)))
    try {
      const r = await pedir<{ subtarea: SubtareaTC; subtareas_total: number; subtareas_hechas: number }>(`${BASE}/tareas/${tareaId}/subtareas/${s.id}`, { metodo: 'PATCH', cuerpo: cambios })
      onContadores(r)
    } catch (e) {
      setLista((l) => (l ?? []).map((x) => (x.id === s.id ? s : x)))
      toast.error(e instanceof Error ? e.message : 'No se ha podido guardar')
    }
  }

  const borrar = async (s: SubtareaTC) => {
    setLista((l) => (l ?? []).filter((x) => x.id !== s.id))
    try {
      onContadores(await pedir<{ subtareas_total: number; subtareas_hechas: number }>(`${BASE}/tareas/${tareaId}/subtareas/${s.id}`, { metodo: 'DELETE' }))
    } catch (e) {
      setLista((l) => [...(l ?? []), s].sort((a, b) => a.orden - b.orden))
      toast.error(e instanceof Error ? e.message : 'No se ha podido borrar')
    }
  }

  const { total, hechas } = contarSubtareas(lista ?? [])
  const porcentaje = total > 0 ? Math.round((hechas / total) * 100) : 0

  return (
    <section aria-label="Subtareas" className="mt-5">
      <h3 className="tc-seccion-titulo"><ListChecks className="h-3.5 w-3.5" /> Subtareas <span className="tc-contador">{total > 0 ? `${hechas}/${total}` : 0}</span></h3>
      {!disponible && <p className="mb-2 text-[12px] text-[var(--ls-e-ambar)]">Falta lanzar la migración 278 en Supabase para usar subtareas.</p>}
      {total > 0 && <span className="tc-barra mb-2 block" data-completa={porcentaje === 100 ? 'true' : undefined} style={{ '--p': `${porcentaje}%` } as React.CSSProperties} />}
      <ul className="flex flex-col gap-0.5">
        {(lista ?? []).map((s) => (
          <li key={s.id} className="tc-subtarea group/s">
            <input type="checkbox" className="tc-casilla" checked={s.hecha} aria-label={`Hecha: ${s.titulo}`} onChange={(e) => void cambiar(s, { hecha: e.target.checked })} />
            <input
              defaultValue={s.titulo}
              key={`${s.id}-${s.titulo}`}
              aria-label="Título de la subtarea"
              maxLength={300}
              onBlur={(e) => {
                const v = e.target.value.replace(/\s+/g, ' ').trim()
                if (!v) e.target.value = s.titulo
                else if (v !== s.titulo) void cambiar(s, { titulo: v })
              }}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              className={`tc-subtarea-titulo ${s.hecha ? 'tc-hecha' : ''}`}
            />
            <select aria-label="Responsable" value={s.responsable_id ?? ''} onChange={(e) => void cambiar(s, { responsable_id: e.target.value || null })} className="tc-subtarea-campo" data-vacio={s.responsable_id ? undefined : 'true'}>
              <option value="">Nadie</option>
              {gente.map((p) => <option key={p.id} value={p.id}>{p.nombre.split(' ')[0]}</option>)}
            </select>
            <input type="date" aria-label="Fecha" value={s.fecha ?? ''} onChange={(e) => void cambiar(s, { fecha: e.target.value || null })} className="tc-subtarea-campo" data-vacio={s.fecha ? undefined : 'true'} />
            <button type="button" onClick={() => void borrar(s)} aria-label={`Borrar la subtarea ${s.titulo}`} className="tc-icono-boton opacity-0 group-hover/s:opacity-100 focus-visible:opacity-100"><Trash2 className="h-3 w-3" /></button>
          </li>
        ))}
      </ul>
      {disponible && (
        <div className="mt-1 flex items-center gap-2">
          <Plus className="h-3.5 w-3.5 text-[var(--ls-t4)]" />
          <input value={nueva} onChange={(e) => setNueva(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void añadir()} maxLength={300} placeholder="Añadir una subtarea… (Enter)" aria-label="Nueva subtarea" disabled={ocupado} className="tc-subtarea-titulo" />
        </div>
      )}
    </section>
  )
}
