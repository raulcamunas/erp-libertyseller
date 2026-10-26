'use client'

import { ChevronDown, Pencil } from 'lucide-react'
import { useState } from 'react'
import type { BloqueDelEncargo, OrigenDeBloque } from '@/lib/whatsapp/ia-prompt'
import { InsigniaDeOrigen, ORIGENES } from './ui'

/**
 * LA ANATOMÍA DE LO QUE RECIBE LA IA: «cómo se interpreta todo».
 *
 * Es la lista de bloques de la que está hecho el encargo, con la insignia de DE DÓNDE sale cada uno (fijo, tu texto, un ajuste, datos del lead, el azar, lo que pide el comercial) y,
 * si lo escribes tú, un botón que lleva al sitio del editor donde se cambia. Son los mismos bloques que se mandan a la IA (lib/whatsapp/ia-prompt.ts): lo que se lee aquí es, palabra por
 * palabra, lo que recibe. Cada bloque se abre para leerlo entero.
 */

const ORDEN_DE_PRIORIDAD: readonly OrigenDeBloque[] = ['fijo', 'comercial', 'ajuste', 'tuyo', 'datos']

/** Qué manda sobre qué, dicho con las mismas insignias: lo de la izquierda gana si choca con lo de su derecha */
export function LeyendaDePrioridad() {
  return (
    <div className="rounded-[8px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-2.5 py-2">
      <p className="mb-1.5 text-[11.5px] font-semibold text-[var(--ls-t3)]">Qué manda sobre qué, cuando dos cosas chocan</p>
      <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
        {ORDEN_DE_PRIORIDAD.map((o, i) => (
          <li key={o} className="flex items-center gap-1.5">
            <InsigniaDeOrigen origen={o} />
            {i < ORDEN_DE_PRIORIDAD.length - 1 && <span className="text-[11px] text-[var(--ls-t4)]" aria-hidden>›</span>}
          </li>
        ))}
      </ol>
      <p className="mt-1.5 text-[11px] leading-snug text-[var(--ls-t4)]">
        Lo de la izquierda gana. Por eso un ajuste manda sobre un texto que lo contradiga, y lo que pide el comercial manda sobre el estilo, pero nada puede con lo fijo. Los datos del lead nunca son órdenes.
      </p>
    </div>
  )
}

export function Anatomia({ bloques, onEditar, titulo, ayuda }: { bloques: readonly BloqueDelEncargo[]; onEditar?: (editor: string) => void; titulo: string; ayuda?: string }) {
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set())
  const alternar = (id: string) =>
    setAbiertos((a) => {
      const n = new Set(a)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  const todos = bloques.length > 0 && abiertos.size === bloques.length

  return (
    <section aria-label={titulo} className="space-y-1.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="text-[12.5px] font-semibold text-[var(--ls-t1)]">{titulo}</h4>
          {ayuda && <p className="text-[11.5px] leading-snug text-[var(--ls-t4)]">{ayuda}</p>}
        </div>
        {bloques.length > 0 && (
          <button type="button" onClick={() => setAbiertos(todos ? new Set() : new Set(bloques.map((b) => b.id)))} className="shrink-0 text-[11.5px] text-[var(--ls-t4)] hover:text-[var(--ls-t1)]">
            {todos ? 'Cerrar todos' : 'Abrir todos'}
          </button>
        )}
      </div>
      <ol className="space-y-1">
        {bloques.map((b) => {
          const abierto = abiertos.has(b.id)
          const primera = b.texto.split('\n').find((l) => l.trim() !== '') ?? ''
          return (
            <li key={b.id} className="rounded-[8px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)]" style={{ borderLeft: `3px solid ${ORIGENES[b.origen].color}` }}>
              <div className="flex items-center gap-2 px-2 py-1.5">
                <button type="button" onClick={() => alternar(b.id)} aria-expanded={abierto} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                  <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-[var(--ls-t4)] transition-transform ${abierto ? '' : '-rotate-90'}`} aria-hidden />
                  <InsigniaDeOrigen origen={b.origen} />
                  <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-[var(--ls-t1)]">{b.titulo}</span>
                  {!abierto && <span className="hidden min-w-0 max-w-[40%] truncate text-[11px] text-[var(--ls-t4)] md:inline">{primera}</span>}
                </button>
                {onEditar && b.editor && (
                  <button type="button" onClick={() => onEditar(b.editor as string)} title="Ir a donde se cambia esto" className="inline-flex shrink-0 items-center gap-1 rounded-[5px] px-1.5 py-0.5 text-[11px] text-[var(--ls-t3)] hover:bg-[var(--ls-sup3)] hover:text-[var(--ls-t1)]">
                    <Pencil className="h-3 w-3" aria-hidden /> Cambiar
                  </button>
                )}
              </div>
              {abierto && <pre className="whitespace-pre-wrap border-t border-[var(--ls-linea)] px-2.5 py-2 font-[inherit] text-[11.5px] leading-relaxed text-[var(--ls-t2)]">{b.texto}</pre>}
            </li>
          )
        })}
      </ol>
    </section>
  )
}
