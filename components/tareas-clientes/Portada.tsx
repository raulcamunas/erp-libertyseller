'use client'

import { useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { ImagePlus, Loader2, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { COLORES_DE_PORTADA, DEGRADADOS, fondoCss } from '@/lib/tareas-clientes/colores'
import type { Portada as PortadaGuardada } from '@/lib/tareas-clientes/tipos'
import { BASE, pedir } from './api'

/**
 * LA PORTADA Y EL FONDO: un color, un degradado de la lista o una imagen que se sube. Lo mismo vale para el encabezado de un cliente, para su fondo y para la pantalla de
 * inicio de cada persona. `estiloDePortada` convierte lo guardado en el estilo que se pinta; lo que no se reconoce no pinta nada (nunca una dirección cualquiera).
 */

export function estiloDePortada(p: PortadaGuardada | null | undefined, comoFondo = false): CSSProperties | undefined {
  const css = fondoCss(p)
  if (!css) return undefined
  if (p?.tipo === 'imagen') return { backgroundImage: css, backgroundSize: 'cover', backgroundPosition: `center ${p.y ?? 50}%`, backgroundRepeat: 'no-repeat' }
  // Un color liso como FONDO de toda la pantalla (un naranja vivo a pantalla completa cansa y aplana todo): se pinta como una luz del color arriba a la izquierda
  // sobre una versión oscura de ese mismo color (clara en el tema claro). Como portada se queda tal cual.
  if (comoFondo && p?.tipo === 'color') {
    return { background: `radial-gradient(1100px 560px at 8% -14%, color-mix(in srgb, ${css} 62%, transparent), transparent 72%), linear-gradient(165deg, color-mix(in srgb, ${css} 40%, var(--tc-base)), color-mix(in srgb, ${css} 14%, var(--tc-base)))` }
  }
  return { background: css }
}

/** ¿Hay un fondo de imagen o degradado que necesite la cortina para que el texto se lea? (el color liso ya se pinta oscurecido) */
export const fondoNecesitaCortina = (p: PortadaGuardada | null | undefined): boolean => Boolean(fondoCss(p)) && p?.tipo !== 'color'

const PESTANAS = [
  { id: 'degradado', nombre: 'Degradados' },
  { id: 'color', nombre: 'Colores' },
  { id: 'imagen', nombre: 'Imagen' },
] as const

export function SelectorDePortada({ valor, onElegir, titulo, children }: { valor: PortadaGuardada | null | undefined; onElegir: (p: PortadaGuardada) => void; titulo: string; children: ReactNode }) {
  const [pestana, setPestana] = useState<(typeof PESTANAS)[number]['id']>(valor?.tipo === 'color' ? 'color' : valor?.tipo === 'imagen' ? 'imagen' : 'degradado')
  const [subiendo, setSubiendo] = useState(false)
  const [enlace, setEnlace] = useState('')
  const entrada = useRef<HTMLInputElement>(null)

  async function subir(fichero: File) {
    setSubiendo(true)
    try {
      const f = new FormData()
      f.set('fichero', fichero)
      const { url } = await pedir<{ url: string }>(`${BASE}/subir`, { metodo: 'POST', formulario: f })
      onElegir({ tipo: 'imagen', valor: url, y: 50 })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se ha podido subir la imagen')
    } finally {
      setSubiendo(false)
    }
  }

  return (
    <Popover>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="end" className="!w-[340px] !rounded-[12px] !border-[var(--ls-linea2)] !bg-[var(--ls-sup)] !p-2.5 !text-[var(--ls-t1)] shadow-[0_18px_50px_rgba(0,0,0,0.4)]">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-[12.5px] font-semibold">{titulo}</p>
          {valor?.tipo && (
            <button type="button" onClick={() => onElegir({})} className="inline-flex items-center gap-1 rounded-[6px] px-1.5 py-1 text-[11.5px] text-[var(--ls-t3)] hover:bg-[var(--ls-sup3)] hover:text-[var(--ls-e-rojo)]">
              <Trash2 className="h-3 w-3" /> Quitar
            </button>
          )}
        </div>
        <div className="mb-2 flex gap-1 rounded-[8px] bg-[var(--ls-sup2)] p-0.5" role="tablist">
          {PESTANAS.map((p) => (
            <button key={p.id} type="button" role="tab" aria-selected={pestana === p.id} onClick={() => setPestana(p.id)} className={`flex-1 rounded-[6px] py-1 text-[11.5px] font-medium ${pestana === p.id ? 'bg-[var(--ls-sup3)] text-[var(--ls-t1)]' : 'text-[var(--ls-t3)] hover:text-[var(--ls-t1)]'}`}>
              {p.nombre}
            </button>
          ))}
        </div>

        {pestana === 'degradado' && (
          <div className="grid grid-cols-3 gap-1.5">
            {DEGRADADOS.map((d) => (
              <button key={d.id} type="button" title={d.nombre} aria-label={d.nombre} aria-pressed={valor?.tipo === 'degradado' && valor.valor === d.id} onClick={() => onElegir({ tipo: 'degradado', valor: d.id })} className="tc-muestra-portada" style={{ background: d.css }}>
                <span>{d.nombre}</span>
              </button>
            ))}
          </div>
        )}
        {pestana === 'color' && (
          <div className="grid grid-cols-4 gap-1.5">
            {COLORES_DE_PORTADA.map((c) => (
              <button key={c.id} type="button" title={c.nombre} aria-label={c.nombre} aria-pressed={valor?.tipo === 'color' && valor.valor === c.valor} onClick={() => onElegir({ tipo: 'color', valor: c.valor })} className="tc-muestra-portada" style={{ background: c.valor }}>
                <span>{c.nombre}</span>
              </button>
            ))}
          </div>
        )}
        {pestana === 'imagen' && (
          <div className="flex flex-col gap-2">
            <input ref={entrada} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="sr-only" onChange={(e) => e.target.files?.[0] && void subir(e.target.files[0])} />
            <button type="button" disabled={subiendo} onClick={() => entrada.current?.click()} className="tc-subir">
              {subiendo ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
              {subiendo ? 'Subiendo…' : 'Subir una imagen'}
              <span className="text-[11px] text-[var(--ls-t4)]">JPG, PNG, WebP o GIF · hasta 10 MB</span>
            </button>
            <div className="flex gap-1.5">
              <input value={enlace} onChange={(e) => setEnlace(e.target.value)} placeholder="…o pega la dirección de una imagen" className="h-7 min-w-0 flex-1 rounded-[6px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-2 text-[12px] outline-none placeholder:text-[var(--ls-t4)] focus:border-[var(--ls-acc-graf)]" />
              <button type="button" disabled={!/^https:\/\//.test(enlace.trim())} onClick={() => { onElegir({ tipo: 'imagen', valor: enlace.trim(), y: 50 }); setEnlace('') }} className="rounded-[6px] border border-[var(--ls-linea)] px-2.5 text-[12px] hover:bg-[var(--ls-sup3)] disabled:opacity-40">
                Usar
              </button>
            </div>
            {valor?.tipo === 'imagen' && (
              <label className="flex items-center gap-2 text-[11.5px] text-[var(--ls-t3)]">
                Encuadre
                <input type="range" min={0} max={100} value={valor.y ?? 50} onChange={(e) => onElegir({ ...valor, y: Number(e.target.value) })} className="flex-1 accent-[var(--ls-acc-graf)]" />
              </label>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
