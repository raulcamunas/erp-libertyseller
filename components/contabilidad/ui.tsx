'use client'

import Link from 'next/link'
import type { CSSProperties, ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { COLOR_ESTADO, type TonoEstado } from '@/lib/estilo/denso'

/**
 * LAS PIEZAS VISUALES DEL PANEL DE CONTABILIDAD (Resumen, Bancos, Pagos a empleados).
 *
 * Una sola gramática para todo el panel: tarjetas de 16 px de radio con un brillo muy suave del color de su dato, cifras grandes y tabulares,
 * un icono en un cuadrado del mismo tono. Los colores son los de estado del ERP (`--ls-e-*`), así funcionan en claro y en oscuro.
 */

const tono = (t: TonoEstado) => COLOR_ESTADO[t]

/** Mezcla un color CSS con transparencia (sirve con variables) */
export const velo = (t: TonoEstado, pct: number) => `color-mix(in srgb, ${tono(t)} ${pct}%, transparent)`

export function Tarjeta({ children, className = '', acento, style }: { children: ReactNode; className?: string; acento?: TonoEstado; style?: CSSProperties }) {
  return (
    <section
      className={`relative min-w-0 overflow-hidden rounded-2xl border border-[var(--ls-linea)] bg-[var(--ls-sup)] ${className}`}
      style={{ ...(acento ? { backgroundImage: `radial-gradient(120% 90% at 0% 0%, ${velo(acento, 9)}, transparent 60%)` } : {}), ...style }}
    >
      {children}
    </section>
  )
}

export function CabeceraTarjeta({ icono: Icono, titulo, sub, tonoIcono = 'gris', accion }: { icono: LucideIcon; titulo: string; sub?: ReactNode; tonoIcono?: TonoEstado; accion?: ReactNode }) {
  return (
    <header className="flex items-center gap-2.5 px-4 pb-2 pt-3.5">
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg" style={{ background: velo(tonoIcono, 14), color: tono(tonoIcono) }}>
        <Icono className="h-[15px] w-[15px]" />
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-[13.5px] font-semibold text-[var(--ls-t1)]">{titulo}</h2>
        {sub && <p className="truncate text-[11.5px] text-[var(--ls-t3)]">{sub}</p>}
      </div>
      {accion}
    </header>
  )
}

export function Kpi({
  icono: Icono,
  titulo,
  valor,
  nota,
  tono: t = 'gris',
  href,
  destacado,
  children,
}: {
  icono: LucideIcon
  titulo: string
  valor: string
  nota?: ReactNode
  tono?: TonoEstado
  href?: string
  destacado?: boolean
  children?: ReactNode
}) {
  const cuerpo = (
    <Tarjeta acento={t} className={`h-full px-3 py-3 transition-colors sm:px-4 sm:py-3.5 ${href ? 'hover:border-[var(--ls-linea2)]' : ''}`} style={destacado ? { borderColor: velo(t, 45) } : undefined}>
      <div className="flex items-center gap-2">
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg sm:h-7 sm:w-7" style={{ background: velo(t, 15), color: tono(t) }}>
          <Icono className="h-[15px] w-[15px]" />
        </span>
        <span className="min-w-0 truncate text-[11.5px] font-medium text-[var(--ls-t3)] sm:text-[12px]">{titulo}</span>
      </div>
      <div className="mt-2 truncate text-[19px] font-semibold leading-none tracking-[-0.02em] tabular-nums sm:mt-2.5 sm:text-[26px]" style={{ color: t === 'gris' ? 'var(--ls-t1)' : tono(t) }}>
        {valor}
      </div>
      {nota && <div className="mt-1.5 line-clamp-2 text-[10.5px] leading-snug text-[var(--ls-t3)] sm:text-[11.5px]">{nota}</div>}
      {children}
    </Tarjeta>
  )
  return href ? (
    <Link href={href} className="block min-w-0">
      {cuerpo}
    </Link>
  ) : (
    cuerpo
  )
}

/** Una pastilla de estado: «al día», «3 sin casar», «41 d»… */
export function Pastilla({ tono: t, children, title }: { tono: TonoEstado; children: ReactNode; title?: string }) {
  return (
    <span title={title} className="inline-flex h-[22px] items-center gap-1 whitespace-nowrap rounded-full px-2 text-[11px] font-semibold tabular-nums" style={{ background: velo(t, 14), color: tono(t) }}>
      {children}
    </span>
  )
}

/** Un círculo con las iniciales, del color que toque */
export function Iniciales({ nombre, tono: t = 'gris', tam = 28 }: { nombre: string; tono?: TonoEstado; tam?: number }) {
  const ini = nombre
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('')
  return (
    <span className="grid shrink-0 place-items-center rounded-full text-[11px] font-semibold" style={{ width: tam, height: tam, background: velo(t, 16), color: tono(t) }}>
      {ini || '·'}
    </span>
  )
}

/** Barra horizontal de reparto (segmentos con su color) */
export function BarraReparto({ partes, alto = 8 }: { partes: Array<{ valor: number; tono: TonoEstado; titulo?: string }>; alto?: number }) {
  const total = partes.reduce((a, p) => a + Math.max(0, p.valor), 0) || 1
  return (
    <div className="flex w-full gap-[3px] overflow-hidden rounded-full" style={{ height: alto }}>
      {partes
        .filter((p) => p.valor > 0)
        .map((p, i) => (
          <div key={i} title={p.titulo} className="h-full rounded-full" style={{ width: `${(p.valor / total) * 100}%`, background: tono(p.tono) }} />
        ))}
    </div>
  )
}
