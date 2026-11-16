'use client'

import { animate, useInView, useReducedMotion } from 'framer-motion'
import { Children, useEffect, useId, useRef, type ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'
import { Area, AreaChart, ResponsiveContainer, YAxis } from 'recharts'
import { COLOR_ESTADO } from '@/lib/estilo/denso'
import { cn } from '@/lib/utils'
import { Esqueleto } from './Esqueleto'
import { colorDeAcento, formatoEntero, leerVariacion, mezcla, porcentajeCorto, type Mejor, type Modulo } from './utilidades'

/**
 * KPI. Rótulo, cifra grande que CUENTA hasta su valor la primera vez que entra en pantalla, variación frente al periodo anterior (flecha + color según `mejor`) y una
 * sparkline opcional abajo, a sangre.
 *
 *   <Kpi etiqueta="Ventas" valor={48210} formato={(n) => formatoEuros(n)} anterior={41000} mejor="sube" serie={[…]} acento="marketing" icono={Euro} />
 *   <Kpi etiqueta="ACoS" valor={0.231} formato={(n) => formatoPorcentaje(n)} anterior={0.25} mejor="baja" />
 *   <Kpi etiqueta="…" valor={null} cargando />
 *
 *   <FilaDeKpis>…</FilaDeKpis>   ← rejilla que se reparte sola en el ordenador y carrusel con imán en el móvil
 */

/** Una cifra que sube hasta su valor al entrar en pantalla. Escribe el texto directamente en el nodo: ni un render de React por fotograma. */
export function CifraAnimada({ valor, formato = formatoEntero, duracion = 1.1, className }: { valor: number; formato?: (n: number) => string; duracion?: number; className?: string }) {
  const nodo = useRef<HTMLSpanElement>(null)
  const visto = useInView(nodo, { once: true, margin: '0px 0px -10% 0px' })
  const quieto = useReducedMotion()
  const ultimo = useRef<number | null>(null)
  const formatoRef = useRef(formato)
  formatoRef.current = formato

  useEffect(() => {
    const el = nodo.current
    if (!el) return
    if (quieto || !visto) {
      // Sin movimiento, o aún fuera de la vista: el valor final tal cual (también lo que lee un lector de pantalla)
      if (quieto) {
        el.textContent = formatoRef.current(valor)
        ultimo.current = valor
      }
      return
    }
    const desde = ultimo.current ?? 0
    ultimo.current = valor
    const control = animate(desde, valor, {
      duration: desde === 0 ? duracion : duracion * 0.6,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => {
        el.textContent = formatoRef.current(v)
      },
    })
    return () => control.stop()
  }, [valor, visto, quieto, duracion])

  return (
    <span ref={nodo} className={className} aria-label={formato(valor)}>
      {/* Siempre 0 en el HTML (igual en servidor y cliente, sin aviso de hidratación); el efecto escribe el valor */}
      {formato(0)}
    </span>
  )
}

/** La variación frente al periodo anterior, como chip. */
export function Variacion({ actual, anterior, mejor = 'sube', className }: { actual: number | null | undefined; anterior: number | null | undefined; mejor?: Mejor; className?: string }) {
  const l = leerVariacion(actual, anterior, mejor)
  if (l.proporcion === null) return <span className={cn('text-[11.5px] text-[var(--ls-t4)]', className)}>sin comparar</span>
  const color = COLOR_ESTADO[l.tono]
  const Icono = l.direccion === 'sube' ? ArrowUpRight : l.direccion === 'baja' ? ArrowDownRight : Minus
  return (
    <span
      className={cn('inline-flex h-[20px] shrink-0 items-center gap-[2px] whitespace-nowrap rounded-full px-[6px] text-[11.5px] font-semibold tabular-nums', className)}
      style={{ color, background: mezcla(color, 13) }}
      title="Frente al periodo anterior de la misma duración"
    >
      <Icono className="h-3 w-3" strokeWidth={2.4} aria-hidden />
      {porcentajeCorto(l.proporcion)}
    </span>
  )
}

/** Sparkline con recharts: área con degradado del color y línea fina. Sin ejes ni rejilla. */
export function Chispa({ valores, color, alto = 40 }: { valores: readonly number[]; color: string; alto?: number }) {
  const id = `chispa-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const quieto = useReducedMotion()
  if (valores.length < 2) return <div style={{ height: alto }} />
  const datos = valores.map((v, i) => ({ i, v }))
  return (
    <div style={{ height: alto }} aria-hidden>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={datos} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.32} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          {/* Suelo por debajo del mínimo: la línea ocupa la mitad de arriba y no parece un sismógrafo */}
          <YAxis hide domain={[(min: number) => min - (Math.max(...valores) - min) * 0.9, 'dataMax']} />
          <Area type="monotone" dataKey="v" stroke={color} strokeWidth={1.75} fill={`url(#${id})`} isAnimationActive={!quieto} animationDuration={900} dot={false} activeDot={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

export interface KpiProps {
  etiqueta: string
  valor: number | null
  formato?: (n: number) => string
  anterior?: number | null
  mejor?: Mejor
  serie?: readonly number[]
  acento?: Modulo | string
  icono?: LucideIcon
  /** Línea pequeña de debajo («vs 7 días anteriores», «de 40 objetivo») */
  nota?: ReactNode
  cargando?: boolean
  onClick?: () => void
  className?: string
  /** Posición en la fila, para la entrada escalonada */
  indice?: number
}

export function Kpi({ etiqueta, valor, formato = formatoEntero, anterior, mejor = 'sube', serie, acento, icono: Icono, nota, cargando, onClick, className, indice }: KpiProps) {
  const color = colorDeAcento(acento)
  const Etiqueta = onClick ? 'button' : 'div'
  return (
    <Etiqueta
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cn(
        'group relative flex min-w-0 flex-col overflow-hidden rounded-[14px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] text-left shadow-[var(--ls-sombra-1)]',
        'before:pointer-events-none before:absolute before:inset-0 before:bg-[image:var(--ls-velo)]',
        onClick && 'ls-elevar cursor-pointer hover:border-[var(--ls-linea2)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ls-acc-graf)]',
        indice != null && 'ls-aparecer',
        className,
      )}
      style={{ ['--ls-acento' as string]: color, ...(indice != null ? { ['--ls-i' as string]: indice } : null) }}
    >
      {/* Filo de color arriba a la izquierda: dice de qué módulo es la cifra sin teñir el texto */}
      <span aria-hidden className="absolute left-4 top-0 h-[2px] w-8 rounded-b-full" style={{ background: color, boxShadow: `0 0 10px ${mezcla(color, 60)}` }} />
      <div className="relative flex items-center justify-between gap-2 px-4 pt-[14px]">
        <span className="flex min-w-0 items-center gap-2 text-[12.5px] font-medium text-[var(--ls-t3)]">
          {Icono && (
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[7px]" style={{ background: mezcla(color, 14), color }}>
              <Icono className="h-[13px] w-[13px]" aria-hidden />
            </span>
          )}
          <span className="truncate">{etiqueta}</span>
        </span>
        {!cargando && anterior !== undefined && <Variacion actual={valor} anterior={anterior} mejor={mejor} />}
      </div>
      <div className={cn('relative px-4', serie ? 'pb-1' : 'pb-[14px]')}>
        {cargando ? (
          <div className="pt-2">
            <Esqueleto className="h-[28px] w-28" />
            <Esqueleto className="mt-2 h-[9px] w-20" />
          </div>
        ) : (
          <>
            <div className="mt-[6px] text-[26px] font-semibold leading-[1.1] tracking-[-0.03em] text-[var(--ls-t1)] tabular-nums">
              {valor == null ? <span className="text-[var(--ls-t4)]">—</span> : <CifraAnimada valor={valor} formato={formato} />}
            </div>
            {nota && <div className="mt-1 truncate text-[12px] text-[var(--ls-t4)]">{nota}</div>}
          </>
        )}
      </div>
      {serie && (
        <div className="relative mt-auto">
          {cargando ? <Esqueleto className="mx-4 mb-3 h-[30px] rounded-[8px]" /> : <Chispa valores={serie} color={color} />}
        </div>
      )}
    </Etiqueta>
  )
}

/** Fila de KPIs: rejilla que se reparte sola desde sm; en el móvil, carrusel horizontal con imán y un trozo del siguiente a la vista. */
export function FilaDeKpis({ children, className, minimo = 190, columnas }: { children: ReactNode; className?: string; minimo?: number; columnas?: string }) {
  return (
    <div
      className={cn(
        'ls-sin-barra -mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:overflow-visible sm:px-0 sm:pb-0',
        '[&>*]:w-[76%] [&>*]:shrink-0 [&>*]:snap-start sm:[&>*]:w-auto',
        columnas,
        className,
      )}
      style={columnas ? undefined : { gridTemplateColumns: `repeat(auto-fit, minmax(${minimo}px, 1fr))` }}
    >
      {Children.toArray(children)}
    </div>
  )
}
