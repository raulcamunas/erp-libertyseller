'use client'

import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { MessageSquare, SendHorizontal, Trash2 } from 'lucide-react'
import { Avatar, cuandoFue } from '@/components/ui-ls'
import { llamar } from '@/components/marketing-test/llamar'
import type { ComentarioSeo } from '@/lib/seo/comentarios-servidor'

/**
 * SEO TEST · LOS COMENTARIOS DE LA PESTAÑA «CAMBIOS» (migración 342). Un hilo por cambio de ficha o por acción del registro: quién lo dijo (avatar y nombre del ERP), cuándo, y una caja
 * para escribir (Intro envía, Mayúsculas + Intro hace salto de línea). Cada uno borra solo los suyos. Los comentarios de toda la cuenta llegan con /api/seo/cambios y se reparten por hilo.
 */

interface Comentarios {
  cuentaId: string
  yo: string | null
  sinTabla: boolean
  porHilo: Map<string, ComentarioSeo[]>
  anadir: (c: ComentarioSeo) => void
  quitar: (id: string) => void
}

const Contexto = createContext<Comentarios | null>(null)

export function ProveedorDeComentarios({ cuentaId, yo, sinTabla, comentarios, setComentarios, children }: { cuentaId: string; yo: string | null; sinTabla: boolean; comentarios: ComentarioSeo[]; setComentarios: (f: (x: ComentarioSeo[]) => ComentarioSeo[]) => void; children: ReactNode }) {
  const valor = useMemo<Comentarios>(() => {
    const porHilo = new Map<string, ComentarioSeo[]>()
    for (const c of comentarios) porHilo.set(c.hilo, [...(porHilo.get(c.hilo) ?? []), c])
    return {
      cuentaId,
      yo,
      sinTabla,
      porHilo,
      anadir: (c) => setComentarios((x) => [...x, c]),
      quitar: (id) => setComentarios((x) => x.filter((c) => c.id !== id)),
    }
  }, [cuentaId, yo, sinTabla, comentarios, setComentarios])
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>
}

export function useComentariosDe(hilo: string): ComentarioSeo[] {
  return useContext(Contexto)?.porHilo.get(hilo) ?? []
}

/** Cuántos comentarios tiene cada hilo (para el filtro «Con comentarios») */
export function useComentadosPorHilo(): Map<string, number> {
  const ctx = useContext(Contexto)
  return useMemo(() => new Map([...(ctx?.porHilo ?? new Map<string, ComentarioSeo[]>()).entries()].map(([h, l]) => [h, l.length])), [ctx?.porHilo])
}

/** El botón que abre el hilo, con cuántos comentarios tiene y las caras de quién ha comentado */
export function BotonDeComentarios({ hilo, abierto, onClick }: { hilo: string; abierto: boolean; onClick: () => void }) {
  const lista = useComentariosDe(hilo)
  const caras = [...new Set(lista.map((c) => c.autor))].slice(0, 3)
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={abierto}
      className="inline-flex h-7 items-center gap-[6px] rounded-full border px-[10px] text-[11.5px] font-medium transition-colors"
      style={{
        borderColor: abierto || lista.length ? 'color-mix(in srgb, var(--ls-acento, var(--ls-acc)) 40%, var(--ls-linea))' : 'var(--ls-linea)',
        color: lista.length ? 'var(--ls-t1)' : 'var(--ls-t3)',
        background: abierto ? 'color-mix(in srgb, var(--ls-acento, var(--ls-acc)) 10%, transparent)' : 'transparent',
      }}
    >
      {caras.length > 0 && (
        <span className="flex gap-[2px]">
          {caras.map((n) => (
            <Avatar key={n} nombre={n} tamano={18} />
          ))}
        </span>
      )}
      <MessageSquare className="h-[12px] w-[12px]" />
      {lista.length === 0 ? 'Comentar' : `${lista.length} ${lista.length === 1 ? 'comentario' : 'comentarios'}`}
    </button>
  )
}

/** El hilo abierto: los comentarios con su autor y la caja para escribir */
export function Hilo({ hilo, asin, autoFoco = false }: { hilo: string; asin: string | null; autoFoco?: boolean }) {
  const ctx = useContext(Contexto)
  const lista = useComentariosDe(hilo)
  const [texto, setTexto] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const caja = useRef<HTMLTextAreaElement>(null)
  if (!ctx) return null

  const enviar = async () => {
    const t = texto.trim()
    if (!t || enviando) return
    setEnviando(true)
    setError(null)
    try {
      const r = await llamar<{ comentario: ComentarioSeo }>('/api/seo/cambios/comentarios', { metodo: 'POST', cuerpo: { cuenta: ctx.cuentaId, hilo, asin, texto: t } })
      ctx.anadir(r.comentario)
      setTexto('')
      caja.current?.focus()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se ha podido guardar el comentario.')
    } finally {
      setEnviando(false)
    }
  }

  const borrar = async (id: string) => {
    setError(null)
    try {
      await llamar('/api/seo/cambios/comentarios', { metodo: 'DELETE', cuerpo: { cuenta: ctx.cuentaId, id } })
      ctx.quitar(id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se ha podido borrar.')
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-[12px] bg-[var(--ls-sup2)] p-3">
      {lista.length === 0 && !ctx.sinTabla && <p className="text-[12px] text-[var(--ls-t4)]">Nadie ha comentado todavía. ¿Por qué se hizo, qué se espera, qué se ha visto?</p>}
      {lista.map((c) => (
        <div key={c.id} className="group flex items-start gap-[10px]">
          <Avatar nombre={c.autor} tamano={28} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-[12.5px] font-semibold text-[var(--ls-t1)]">{c.autor}</span>
              <span className="text-[11px] text-[var(--ls-t4)]" title={new Date(c.at).toLocaleString('es-ES')}>
                {cuandoFue(c.at)}
              </span>
              {c.autorId === ctx.yo && (
                <button type="button" onClick={() => void borrar(c.id)} className="ml-auto opacity-0 transition-opacity focus:opacity-100 group-hover:opacity-100" aria-label="Borrar mi comentario" title="Borrar mi comentario">
                  <Trash2 className="h-[12px] w-[12px] text-[var(--ls-t4)] hover:text-[var(--ls-t2)]" />
                </button>
              )}
            </div>
            <p className="mt-[2px] whitespace-pre-wrap break-words rounded-[10px] rounded-tl-[3px] bg-[var(--ls-sup)] px-3 py-2 text-[12.5px] leading-[1.5] text-[var(--ls-t2)]">{c.texto}</p>
          </div>
        </div>
      ))}
      {ctx.sinTabla ? (
        <p className="text-[12px] text-[var(--ls-t4)]">Los comentarios estarán disponibles en cuanto se lance la migración 342.</p>
      ) : (
        <div className="flex items-end gap-2">
          <textarea
            ref={caja}
            value={texto}
            autoFocus={autoFoco}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                void enviar()
              }
            }}
            rows={Math.min(5, Math.max(1, texto.split('\n').length))}
            maxLength={2000}
            placeholder="Escribe un comentario…  (Intro para enviar)"
            className="min-h-[36px] flex-1 resize-none rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] px-3 py-2 text-[12.5px] text-[var(--ls-t1)] outline-none placeholder:text-[var(--ls-t4)] focus:border-[color-mix(in_srgb,var(--ls-acento,var(--ls-acc))_55%,var(--ls-linea))]"
          />
          <button
            type="button"
            onClick={() => void enviar()}
            disabled={!texto.trim() || enviando}
            aria-label="Enviar comentario"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] text-[#141414] transition-opacity disabled:opacity-40"
            style={{ background: 'var(--ls-acento, var(--ls-acc))' }}
          >
            <SendHorizontal className="h-[15px] w-[15px]" />
          </button>
        </div>
      )}
      {error && <p className="text-[12px] text-[var(--ls-e-rojo)]">{error}</p>}
    </div>
  )
}
