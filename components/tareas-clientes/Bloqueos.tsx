'use client'

import { useMemo, useState } from 'react'
import { Lock, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { TareaLigera } from '@/lib/tareas-clientes/servidor'
import { sinAcentos } from '@/lib/tareas-clientes/busqueda'
import { BASE, pedir } from './api'

/**
 * «DEPENDE DE»: las tareas del mismo cliente que tienen que estar hechas antes de ésta. Mientras alguna siga sin hacer, la tarea se ve con un candado en el tablero.
 * El servidor rechaza lo que cree un círculo.
 */
export function Bloqueos({ tarea, candidatas, hecha, onCambio }: { tarea: TareaLigera; candidatas: readonly TareaLigera[]; hecha: (t: TareaLigera) => boolean; onCambio: (ids: string[]) => void }) {
  const [abierto, setAbierto] = useState(false)
  const [filtro, setFiltro] = useState('')
  const ids = tarea.bloqueada_por ?? []
  const porId = useMemo(() => new Map(candidatas.map((t) => [t.id, t])), [candidatas])
  const elegidas = ids.map((id) => porId.get(id)).filter((t): t is TareaLigera => Boolean(t))
  const posibles = useMemo(() => {
    const q = sinAcentos(filtro.trim())
    return candidatas.filter((t) => t.id !== tarea.id && !ids.includes(t.id) && (!q || sinAcentos(t.titulo).includes(q))).slice(0, 30)
  }, [candidatas, tarea.id, ids, filtro])

  const guardar = async (nuevos: string[]) => {
    const antes = ids
    onCambio(nuevos)
    try {
      await pedir(`${BASE}/tareas/${tarea.id}/bloqueos`, { metodo: 'PUT', cuerpo: { ids: nuevos } })
    } catch (e) {
      onCambio(antes)
      toast.error(e instanceof Error ? e.message : 'No se ha podido guardar')
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1 px-1">
      {elegidas.map((t) => (
        <span key={t.id} className="tc-chip-bloqueo" data-hecha={hecha(t) ? 'true' : undefined} title={hecha(t) ? 'Ya está hecha' : 'Sin hacer todavía'}>
          {!hecha(t) && <Lock className="h-2.5 w-2.5" />}
          <span className="max-w-[170px] truncate">{t.titulo || 'Sin título'}</span>
          <button type="button" aria-label={`Quitar la dependencia de ${t.titulo || 'esa tarea'}`} onClick={() => void guardar(ids.filter((x) => x !== t.id))}><X className="h-2.5 w-2.5" /></button>
        </span>
      ))}
      <Popover open={abierto} onOpenChange={(o) => { setAbierto(o); if (!o) setFiltro('') }}>
        <PopoverTrigger asChild>
          <button type="button" className="tc-boton-suave tc-discreto"><Plus className="h-3 w-3" /> {ids.length === 0 ? 'Ninguna' : 'Añadir'}</button>
        </PopoverTrigger>
        <PopoverContent align="start" className="!w-[300px] !rounded-[12px] !border-[var(--ls-linea2)] !bg-[var(--ls-sup)] !p-2 !text-[var(--ls-t1)] shadow-[0_18px_50px_rgba(0,0,0,0.4)]">
          <input autoFocus value={filtro} onChange={(e) => setFiltro(e.target.value)} placeholder="Buscar una tarea de este cliente…" aria-label="Buscar tarea" className="mb-1.5 h-8 w-full rounded-[8px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-2 text-[12.5px] outline-none focus:border-[var(--ls-acc-graf)]" />
          <div className="flex max-h-[240px] flex-col gap-px overflow-auto">
            {posibles.length === 0 && <p className="px-2 py-2 text-[12px] text-[var(--ls-t4)]">No hay otras tareas que coincidan.</p>}
            {posibles.map((t) => (
              <button key={t.id} type="button" className="tc-opcion" onClick={() => { setAbierto(false); setFiltro(''); void guardar([...ids, t.id]) }}>
                <span className="min-w-0 flex-1 truncate text-left">{t.icono ? `${t.icono} ` : ''}{t.titulo || 'Sin título'}</span>
                <span className="flex-shrink-0 text-[11px] text-[var(--ls-t4)]">{t.estado}</span>
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
