'use client'

import { Copy, Pencil } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import type { ContenidoPieza } from '@/lib/types/contenido'

/**
 * LO QUE LLEVA UNA HISTORIA EN VEZ DE LOS TEXTOS POR RED: su idea o el texto que sale en pantalla, para copiarlo, y el botón de cambiarla.
 * Una historia no se pega en cuatro redes con su límite de caracteres: se graba o se monta en el móvil con esto delante.
 */
export function BloqueHistoria({ pieza, onEditar }: { pieza: ContenidoPieza; onEditar: () => void }) {
  const texto = pieza.texto_post.trim()

  async function copiar() {
    try {
      await navigator.clipboard.writeText(texto)
      toast.success('Texto copiado')
    } catch {
      toast.error('No se pudo copiar')
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">Idea o texto en pantalla</span>
        <div className="flex gap-1">
          {texto !== '' && (
            <Button variant="ghost" size="sm" className="h-7 px-2 text-muted-foreground" onClick={copiar}>
              <Copy className="h-3.5 w-3.5 mr-1" />
              Copiar
            </Button>
          )}
          <Button variant="ghost" size="sm" className="h-7 px-2 text-muted-foreground" onClick={onEditar}>
            <Pencil className="h-3.5 w-3.5 mr-1" />
            Cambiar
          </Button>
        </div>
      </div>
      {texto !== '' ? (
        <p className="whitespace-pre-wrap text-sm leading-relaxed rounded-lg border border-white/10 bg-white/[0.03] p-3">{texto}</p>
      ) : (
        <p className="text-sm text-muted-foreground rounded-lg border border-dashed border-white/10 p-3">
          Sin texto todavía. Pulsa «Cambiar» para apuntar la idea o lo que sale en pantalla.
        </p>
      )}
    </div>
  )
}
