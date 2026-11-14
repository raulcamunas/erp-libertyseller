import { cn } from '@/lib/utils'

/**
 * ESQUELETOS DE CARGA. Se pinta la FORMA de lo que va a llegar (no un spinner): así la pantalla no salta cuando llegan los datos. El brillo que los recorre solo se mueve si
 * el sistema permite movimiento (.ls-esqueleto en globals.css).
 *
 *   <Esqueleto className="h-4 w-32" />
 *   <EsqueletoTexto lineas={3} />
 *   <EsqueletoTarjeta />  <EsqueletoTabla filas={6} columnas={5} />
 */
export function Esqueleto({ className, redondo }: { className?: string; redondo?: boolean }) {
  return <div aria-hidden className={cn('ls-esqueleto', redondo ? 'rounded-full' : 'rounded-[6px]', className)} />
}

export function EsqueletoTexto({ lineas = 3, className }: { lineas?: number; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-2', className)} aria-hidden>
      {Array.from({ length: lineas }, (_, i) => (
        <Esqueleto key={i} className={cn('h-[10px]', i === lineas - 1 && lineas > 1 ? 'w-3/5' : 'w-full')} />
      ))}
    </div>
  )
}

export function EsqueletoTarjeta({ className, alto = 132 }: { className?: string; alto?: number }) {
  return (
    <div role="status" aria-label="Cargando" className={cn('rounded-[14px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] p-4', className)} style={{ minHeight: alto }}>
      <div className="flex items-center gap-3">
        <Esqueleto className="h-9 w-9 rounded-[10px]" />
        <div className="flex-1">
          <Esqueleto className="h-[11px] w-2/5" />
          <Esqueleto className="mt-2 h-[9px] w-1/4" />
        </div>
      </div>
      <EsqueletoTexto lineas={2} className="mt-5" />
    </div>
  )
}

export function EsqueletoTabla({ filas = 6, columnas = 4, className }: { filas?: number; columnas?: number; className?: string }) {
  return (
    <div role="status" aria-label="Cargando" className={cn('overflow-hidden rounded-[14px] border border-[var(--ls-linea)] bg-[var(--ls-sup)]', className)}>
      <div className="flex gap-4 border-b border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-4 py-3">
        {Array.from({ length: columnas }, (_, i) => (
          <Esqueleto key={i} className="h-[9px] flex-1" />
        ))}
      </div>
      {Array.from({ length: filas }, (_, f) => (
        <div key={f} className="flex items-center gap-4 border-b border-[var(--ls-linea)] px-4 py-3 last:border-b-0">
          {Array.from({ length: columnas }, (_, c) => (
            <Esqueleto key={c} className={cn('h-[10px] flex-1', c === 0 && 'max-w-[40%]')} />
          ))}
        </div>
      ))}
    </div>
  )
}
