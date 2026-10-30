import { ArrowRight } from 'lucide-react'
import type { ParteDeTraduccion } from '@/lib/rendimiento/linea'

/**
 * «12 intentos → 10 llamadas hechas · 6 intentos contestados → 5 contestadas»: lo que une la lista de llamadas (y las rayas de la línea del día), que enseñan cada
 * llamada, con las cifras de las tarjetas, que cuentan un cliente una sola vez al día. A la derecha de cada flecha, con los nombres de las tarjetas, la cifra que
 * se va a encontrar arriba.
 *
 * Sin partes (todo cuadra) no pinta nada. Es un `span` para poder ir dentro de un párrafo; la flecha es solo dibujo, y para quien lee en voz alta se dice «son».
 */
export function TraduccionDeLlamadas({ partes, className = '' }: { partes: readonly ParteDeTraduccion[]; className?: string }) {
  if (partes.length === 0) return null
  return (
    <span className={`inline-flex flex-wrap items-center gap-x-3.5 gap-y-0.5 tabular-nums ${className}`}>
      {partes.map((p) => (
        <span key={p.de} className="inline-flex items-center gap-1 whitespace-nowrap">
          <span className="text-[var(--ls-t3)]">{p.de}</span>
          <span className="sr-only">son</span>
          <ArrowRight className="h-3 w-3 shrink-0 text-[var(--ls-t4)]" aria-hidden />
          <span className="font-medium text-[var(--ls-t1)]">{p.a}</span>
        </span>
      ))}
    </span>
  )
}
