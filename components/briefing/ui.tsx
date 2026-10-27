'use client'

import { Check } from 'lucide-react'
import { createContext, useContext, useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { PANEL, useNumeroAnimado } from '@/components/rendimiento/ui'
import type { MarcaDeResuelto } from '@/lib/briefing/tipos'

/**
 * LAS PIEZAS COMUNES DE LA PANTALLA DEL BRIEFING.
 * ==============================================
 * Se pinta con los tokens de siempre (`--ls-*`), así que se ve igual en el tema oscuro y en el claro. TODO lo que viene del briefing se escribe como TEXTO (React lo
 * escapa): nada de HTML. Los enlaces solo se pintan como enlace si son https, aunque el servidor ya lo haya comprobado dos veces (al guardar y al leer).
 */

export { PANEL }

/** Un enlace https, o el texto sin enlace si no lo es */
export function Enlace({ url, children, className = '' }: { url: string | null; children: ReactNode; className?: string }) {
  if (!url || !/^https:\/\//i.test(url)) return <span className={className}>{children}</span>
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className={`underline decoration-[var(--ls-linea2)] underline-offset-2 transition-colors hover:text-[var(--ls-t1)] hover:decoration-[var(--ls-acc-graf)] ${className}`}>
      {children}
    </a>
  )
}

/** Una sección de la página: título con filo grueso debajo, y su nota a la derecha. `indice` escalona la entrada */
export function Seccion({ id, titulo, meta, indice, children }: { id: string; titulo: string; meta?: ReactNode; indice: number; children: ReactNode }) {
  return (
    <section id={id} className="rend-aparece scroll-mt-28 space-y-2.5 lg:scroll-mt-16" style={{ '--d': indice } as CSSProperties}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 border-b-2 border-[var(--ls-t1)] pb-1.5">
        <h2 className="text-[15px] font-bold tracking-[-0.01em] text-[var(--ls-t1)]">{titulo}</h2>
        {meta ? <span className="text-[12px] text-[var(--ls-t4)]">{meta}</span> : null}
      </div>
      {children}
    </section>
  )
}

/** La etiqueta del área o del cliente: «COMERCIAL», «ENTRAIS» */
export function EtiquetaDeArea({ children }: { children: ReactNode }) {
  return <span className="mr-1.5 inline-block rounded-[3px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] px-1.5 py-px align-[1px] text-[10.5px] font-semibold uppercase tracking-[0.06em] text-[var(--ls-t3)]">{children}</span>
}

/** Una pastilla pequeña («Te pide algo», «Importante») */
export function Pastilla({ children, tono = 'acc' }: { children: ReactNode; tono?: 'acc' | 'neutro' }) {
  return (
    <span className={`ml-1.5 inline-block rounded-full px-1.5 py-px align-[1px] text-[10.5px] font-semibold ${tono === 'acc' ? 'bg-[var(--ls-acc-suave)] text-[var(--ls-acc)]' : 'bg-[var(--ls-sup3)] text-[var(--ls-t3)]'}`}>{children}</span>
  )
}

/** Una cifra grande con su rótulo y su nota. `n` null se pinta «—»: nunca un cero inventado. `destacada` la pinta en la tarjeta oscura con el número naranja */
export function Cifra({ rotulo, n, nota, destacada = false, indice = 0 }: { rotulo: string; n: number | null; nota?: string; destacada?: boolean; indice?: number }) {
  const mostrado = useNumeroAnimado(n ?? 0)
  return (
    <div
      className={`rend-entra min-w-0 rounded-[8px] px-3 py-2 ${destacada ? 'border border-[var(--ls-linea2)] bg-[var(--ls-sup3)]' : 'bg-[var(--ls-sup2)]'}`}
      style={{ '--d': indice } as CSSProperties}
    >
      <div className={`text-[24px] font-bold leading-[1.1] tabular-nums ${destacada ? 'text-[var(--ls-acc)]' : 'text-[var(--ls-t1)]'}`}>{n === null ? '—' : Math.round(mostrado).toLocaleString('es-ES')}</div>
      <div className="mt-0.5 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-[var(--ls-t3)]">{rotulo}</div>
      {nota ? <div className="mt-0.5 text-[11.5px] leading-snug text-[var(--ls-t4)]">{nota}</div> : null}
    </div>
  )
}

/** El botón redondo de «resuelto». Marcado, se pinta en verde con su check */
export function BotonResuelto({ marca, alMarcar, deshabilitado = false, etiqueta }: { marca: MarcaDeResuelto | null; alMarcar: () => void; deshabilitado?: boolean; etiqueta: string }) {
  const ahora = useAhora()
  const hecho = marca !== null
  const quien = hecho ? `${textoDeMarca(marca, ahora)}. Pulsa para quitar la marca` : 'Marcar como resuelto'
  return (
    <button
      type="button"
      onClick={alMarcar}
      disabled={deshabilitado}
      aria-pressed={hecho}
      aria-label={`${hecho ? 'Quitar la marca de resuelto de' : 'Marcar como resuelto'}: ${etiqueta}`}
      title={quien}
      className={`mt-0.5 inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-40 ${
        hecho
          ? 'border-[var(--ls-e-verde)] bg-[color-mix(in_srgb,var(--ls-e-verde)_20%,transparent)] text-[var(--ls-e-verde)]'
          : 'border-[var(--ls-linea2)] text-transparent hover:border-[var(--ls-e-verde)] hover:text-[var(--ls-e-verde)]'
      }`}
    >
      <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden />
    </button>
  )
}

/* ------------------------------------------------------------------ */
/* El reloj de la pantalla                                             */
/* ------------------------------------------------------------------ */

/**
 * EL «HACE CUÁNTO» NO SE CALCULA AL PINTAR EN EL SERVIDOR. El servidor y el navegador no leen el reloj en el mismo segundo, y un «hace 3 min» que en uno es «hace 4 min» en el
 * otro es un aviso de hidratación. Hasta que el navegador monta, el reloj vale null y el «hace cuánto» no se escribe; después se pone al día cada medio minuto.
 */
const ContextoAhora = createContext<number | null>(null)

export function ProveedorDeAhora({ cadaMs = 30_000, children }: { cadaMs?: number; children: ReactNode }) {
  const [ahora, setAhora] = useState<number | null>(null)
  useEffect(() => {
    setAhora(Date.now())
    const id = window.setInterval(() => setAhora(Date.now()), cadaMs)
    return () => window.clearInterval(id)
  }, [cadaMs])
  return <ContextoAhora.Provider value={ahora}>{children}</ContextoAhora.Provider>
}

export const useAhora = (): number | null => useContext(ContextoAhora)

/** «hace 12 min» (nada hasta que el navegador monta) */
export function HaceCuanto({ iso }: { iso: string }) {
  const ahora = useAhora()
  return <>{ahora === null ? '' : haceCuanto(iso, ahora)}</>
}

/** «Resuelto por Marius · hace 3 min» */
export function textoDeMarca(marca: MarcaDeResuelto, ahora: number | null): string {
  const cuando = ahora === null ? '' : haceCuanto(marca.cuando, ahora)
  return ['Resuelto' + (marca.por ? ` por ${marca.por}` : ''), cuando].filter(Boolean).join(' · ')
}

export function TextoDeMarca({ marca }: { marca: MarcaDeResuelto }) {
  return <>{textoDeMarca(marca, useAhora())}</>
}

/* ------------------------------------------------------------------ */
/* Fechas                                                              */
/* ------------------------------------------------------------------ */

/** «hace 12 min», «hace 3 h», «ayer»: para las marcas y el sello de publicación */
export function haceCuanto(iso: string, ahora = Date.now()): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  const min = Math.max(0, Math.round((ahora - t) / 60_000))
  if (min < 1) return 'ahora mismo'
  if (min < 60) return `hace ${min} min`
  const h = Math.round(min / 60)
  if (h < 24) return `hace ${h} h`
  const d = Math.round(h / 24)
  return d === 1 ? 'ayer' : `hace ${d} días`
}

/** «mar 27 oct» para un día AAAA-MM-DD (el mismo que usan las secuencias de correo) */
export { diaCorto } from '@/lib/correo/secuencias/fechas'
