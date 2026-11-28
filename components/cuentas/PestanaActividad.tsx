'use client'

import { useEffect, useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'

/**
 * LA ACTIVIDAD DE LA CUENTA: todo lo que ha pasado en PPC (personas y agente), SEO, Cumplimiento, el ciclo y sus tareas, en una sola línea de tiempo
 * (/api/cuentas/actividad). Filtro por módulo y por periodo.
 */

interface Entrada {
  at: string
  modulo: 'ppc' | 'seo' | 'cumplimiento' | 'ciclo' | 'tareas'
  quien: string
  texto: string
  ok: boolean
}

const MODULOS: Array<{ id: Entrada['modulo'] | 'todo'; texto: string; color: string }> = [
  { id: 'todo', texto: 'Todo', color: 'var(--ls-t2)' },
  { id: 'ppc', texto: 'PPC', color: '#FF8A3D' },
  { id: 'seo', texto: 'SEO', color: '#38BDF8' },
  { id: 'cumplimiento', texto: 'Cumplimiento', color: '#A78BFA' },
  { id: 'ciclo', texto: 'Ciclo', color: '#34D399' },
  { id: 'tareas', texto: 'Tareas', color: '#F5B942' },
]
const colorDe = (m: string) => MODULOS.find((x) => x.id === m)?.color ?? 'var(--ls-t3)'

export function PestanaActividad({ amazonClientId }: { amazonClientId: string }) {
  const [entradas, setEntradas] = useState<Entrada[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [modulo, setModulo] = useState<Entrada['modulo'] | 'todo'>('todo')
  const [dias, setDias] = useState(30)
  const [q, setQ] = useState('')
  useEffect(() => {
    let vivo = true
    setEntradas(null)
    setError(null)
    fetch(`/api/cuentas/actividad?c=${encodeURIComponent(amazonClientId)}&dias=${dias}`)
      .then(async (r) => {
        const d = (await r.json().catch(() => ({}))) as { entradas?: Entrada[]; error?: string }
        if (!vivo) return
        if (!r.ok) setError(d.error ?? 'No se ha podido leer la actividad.')
        else setEntradas(d.entradas ?? [])
      })
      .catch(() => vivo && setError('No se ha podido leer la actividad.'))
    return () => {
      vivo = false
    }
  }, [amazonClientId, dias])
  const visibles = useMemo(() => {
    const t = q.trim().toLowerCase()
    return (entradas ?? []).filter((e) => (modulo === 'todo' || e.modulo === modulo) && (!t || e.texto.toLowerCase().includes(t) || e.quien.toLowerCase().includes(t)))
  }, [entradas, modulo, q])

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1">
          {MODULOS.map((m) => (
            <button key={m.id} type="button" onClick={() => setModulo(m.id)} aria-pressed={modulo === m.id} className={`h-8 rounded-full border px-3 text-[12px] font-medium transition-colors ${modulo === m.id ? 'border-transparent bg-[var(--ls-sup3)] text-[var(--ls-t1)]' : 'border-[var(--ls-linea)] text-[var(--ls-t3)] hover:text-[var(--ls-t1)]'}`}>
              {m.texto}
            </button>
          ))}
        </div>
        <select value={dias} onChange={(e) => setDias(Number(e.target.value))} aria-label="Periodo" className="h-8 rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] px-2 text-[16px] text-[var(--ls-t2)] sm:text-[12.5px]">
          <option value={7}>7 días</option>
          <option value={30}>30 días</option>
          <option value={90}>90 días</option>
        </select>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar…" aria-label="Buscar en la actividad" className="h-8 min-w-0 flex-1 rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] px-3 text-[16px] text-[var(--ls-t1)] outline-none sm:max-w-[240px] sm:text-[12.5px]" />
      </div>
      {error && <p className="text-[12.5px] text-[#F87171]">{error}</p>}
      {!entradas && !error && (
        <p className="flex items-center gap-2 py-6 text-[12.5px] text-[var(--ls-t3)]">
          <Loader2 className="h-4 w-4 animate-spin" /> Juntando la actividad de todos los módulos…
        </p>
      )}
      {entradas && visibles.length === 0 && <p className="py-6 text-[12.5px] text-[var(--ls-t4)]">Nada en este periodo.</p>}
      {visibles.length > 0 && (
        <ol className="divide-y divide-[var(--ls-linea)] rounded-[14px] border border-[var(--ls-linea)] bg-[var(--ls-sup)]">
          {visibles.map((e, i) => (
            <li key={`${e.at}-${i}`} className="flex gap-3 px-3 py-2.5">
              <span className="mt-[5px] h-2 w-2 shrink-0 rounded-full" style={{ background: e.ok ? colorDe(e.modulo) : '#F87171' }} aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2 text-[11.5px] text-[var(--ls-t4)]">
                  <span className="font-semibold" style={{ color: colorDe(e.modulo) }}>
                    {MODULOS.find((m) => m.id === e.modulo)?.texto}
                  </span>
                  <span>{e.quien}</span>
                  <span className="tabular-nums">{new Date(e.at).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                <p className={`mt-0.5 break-words text-[12.5px] leading-snug ${e.ok ? 'text-[var(--ls-t2)]' : 'text-[#F87171]'}`}>{e.texto}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
