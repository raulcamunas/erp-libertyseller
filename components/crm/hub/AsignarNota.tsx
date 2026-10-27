'use client'

import { useMemo, useState } from 'react'
import { Search, X } from 'lucide-react'
import { INPUT_FANTASMA } from './piezas'

/**
 * EL SELECTOR DE CLIENTE PARA ASIGNAR UNA NOTA DE REUNIÓN: un cuadro de búsqueda y la lista corta de coincidencias. Se usa dentro de la ficha (cambiar de cliente una nota mal
 * enlazada) y en la bandeja de notas sin cliente.
 */
export function AsignarNota({ clientes, excluir, trabajando, onElegir, onCerrar }: { clientes: ReadonlyArray<{ id: string; nombre: string; empresa: string | null }>; excluir?: string | null; trabajando: boolean; onElegir: (clientId: string) => void; onCerrar: () => void }) {
  const [q, setQ] = useState('')
  const sinTildes = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  const resultados = useMemo(() => {
    const t = sinTildes(q.trim())
    return clientes
      .filter((c) => c.id !== excluir)
      .filter((c) => !t || sinTildes(`${c.nombre} ${c.empresa ?? ''}`).includes(t))
      .slice(0, 8)
  }, [clientes, excluir, q])

  return (
    <div className="rounded-[6px] border border-[var(--ls-linea2)] bg-[var(--ls-sup)] p-2 shadow-[0_4px_16px_-8px_rgba(0,0,0,0.35)]">
      <div className="mb-1.5 flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-[var(--ls-t4)]" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar cliente o empresa…" className={`${INPUT_FANTASMA} border-[var(--ls-linea)] bg-[var(--ls-sup2)] pl-7`} />
        </div>
        <button type="button" onClick={onCerrar} className="inline-flex h-5 w-5 items-center justify-center rounded-[4px] text-[var(--ls-t4)] hover:bg-[var(--ls-sup2)] hover:text-[var(--ls-t1)]" aria-label="Cerrar">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {resultados.length === 0 ? (
        <p className="px-1 py-2 text-[11.5px] text-[var(--ls-t3)]">Ningún cliente coincide.</p>
      ) : (
        <ul className="max-h-[220px] overflow-y-auto">
          {resultados.map((c) => (
            <li key={c.id}>
              <button type="button" disabled={trabajando} onClick={() => onElegir(c.id)} className="flex w-full min-w-0 items-baseline gap-2 rounded-[4px] px-2 py-[5px] text-left hover:bg-[var(--ls-sup3)] disabled:opacity-50">
                <span className="min-w-0 truncate text-[12.5px] text-[var(--ls-t1)]">{c.nombre}</span>
                {c.empresa && <span className="min-w-0 truncate text-[11px] text-[var(--ls-t4)]">{c.empresa}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
