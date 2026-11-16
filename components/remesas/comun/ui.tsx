'use client'

import type { ReactNode } from 'react'
import { COLOR_ESTADO, INSIGNIA, TIPO, type TonoEstado } from '@/lib/estilo/denso'
import { TACTIL } from '@/components/ui-ls/Boton'

/**
 * LAS PIEZAS COMUNES DE REMESAS A FBA.
 *
 * API (la de siempre; solo ha cambiado el aspecto, a los tokens del kit components/ui-ls)
 *   cx(...clases)                                   une clases y quita las vacías
 *   <Insignia tono icono titulo>                    insignia densa, para tablas (el color en el glifo)
 *   <Clave color>                                   punto de color + palabra, para leyendas
 *   <Tarjeta titulo ayuda derecha cuerpo>           caja con cabecera: radio 14, velo de luz y sombra del kit
 *   <Vacio icono titulo accion>                     qué pasa + qué hacer
 *   <Segmentado valor onCambio opciones etiqueta>   opciones excluyentes, compacto (44 px con el dedo)
 *   <Medidor partes total alto>                     barra partida en trozos
 *
 * Todo sale del contrato de estilo de lib/estilo/denso.ts y de los tokens
 * `--ls-*` del kit, así que cada pieza sigue sola al tema claro y al oscuro.
 * Lo nuevo del módulo usa directamente el kit (`@/components/ui-ls`); esto queda
 * para las pantallas densas que siguen con esta API.
 *
 * El color de estado va en el GLIFO y no en la palabra: tapa el color con la mano
 * y la pantalla sigue diciendo lo mismo.
 */

export const cx = (...xs: Array<string | false | null | undefined>): string => xs.filter(Boolean).join(' ')

/* ------------------------------------------------------------------ */
/* Estado                                                              */
/* ------------------------------------------------------------------ */

export function Insignia({
  tono = 'gris',
  icono,
  children,
  titulo,
  className,
}: {
  tono?: TonoEstado
  icono?: ReactNode
  children: ReactNode
  titulo?: string
  className?: string
}) {
  return (
    <span className={cx(INSIGNIA.base, className)} title={titulo}>
      {icono && (
        <span className="inline-flex shrink-0" style={{ color: COLOR_ESTADO[tono] }}>
          {icono}
        </span>
      )}
      {children}
    </span>
  )
}

/** Un punto de color con su palabra: para leyendas y para rotular una serie */
export function Clave({ color, children, className }: { color: string; children: ReactNode; className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-[6px] text-[11.5px] text-[var(--ls-t3)]', className)}>
      <span className="h-[8px] w-[8px] shrink-0 rounded-[2px]" style={{ background: color }} />
      {children}
    </span>
  )
}

/* ------------------------------------------------------------------ */
/* Contenedores                                                        */
/* ------------------------------------------------------------------ */

export function Tarjeta({
  titulo,
  ayuda,
  derecha,
  children,
  className,
  cuerpo = true,
}: {
  titulo?: ReactNode
  ayuda?: ReactNode
  derecha?: ReactNode
  children: ReactNode
  className?: string
  /** false = sin relleno: para tablas que llegan hasta el borde */
  cuerpo?: boolean
}) {
  return (
    <section
      className={cx(
        'relative min-w-0 rounded-[14px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] shadow-[var(--ls-sombra-1)]',
        'before:pointer-events-none before:absolute before:inset-0 before:rounded-[inherit] before:bg-[image:var(--ls-velo)]',
        className
      )}
    >
      {(titulo || derecha) && (
        <header className="relative flex min-h-[40px] flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-[var(--ls-linea)] px-4 py-[7px]">
          <div className="min-w-0">
            {titulo && <h3 className={cx(TIPO.l, 'truncate text-[var(--ls-t1)]')}>{titulo}</h3>}
            {ayuda && <p className="truncate text-[11px] leading-[1.4] text-[var(--ls-t4)]">{ayuda}</p>}
          </div>
          {derecha && <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-2">{derecha}</div>}
        </header>
      )}
      <div className={cx('relative', cuerpo && 'p-3 sm:p-4')}>{children}</div>
    </section>
  )
}

export function Vacio({
  icono,
  titulo,
  children,
  accion,
  className,
}: {
  icono?: ReactNode
  titulo: string
  children?: ReactNode
  accion?: ReactNode
  className?: string
}) {
  return (
    <div className={cx('flex flex-col items-center justify-center gap-2 px-6 py-10 text-center', className)}>
      {icono && <span className="text-[var(--ls-t4)] [&>svg]:h-7 [&>svg]:w-7">{icono}</span>}
      <p className={cx(TIPO.l, 'text-[var(--ls-t2)]')}>{titulo}</p>
      {children && <p className="max-w-[420px] text-[12px] leading-[1.55] text-[var(--ls-t3)]">{children}</p>}
      {accion && <div className="mt-1">{accion}</div>}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Controles                                                           */
/* ------------------------------------------------------------------ */

export function Segmentado<T extends string | number>({
  valor,
  onCambio,
  opciones,
  etiqueta,
}: {
  valor: T
  onCambio: (v: T) => void
  opciones: Array<{ id: T; texto: ReactNode; titulo?: string }>
  etiqueta?: string
}) {
  return (
    <div
      role="tablist"
      aria-label={etiqueta}
      className="inline-flex max-w-full shrink-0 items-center gap-[2px] overflow-x-auto rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] p-[2px] [scrollbar-width:none]"
    >
      {opciones.map((o) => {
        const activa = o.id === valor
        return (
          <button
            key={String(o.id)}
            type="button"
            role="tab"
            aria-selected={activa}
            title={o.titulo}
            onClick={() => onCambio(o.id)}
            className={cx(
              'inline-flex h-[24px] items-center justify-center gap-[5px] whitespace-nowrap rounded-[8px] px-[9px] text-[11.5px] transition-colors',
              TACTIL,
              activa
                ? 'bg-[var(--ls-sup3)] font-medium text-[var(--ls-t1)] shadow-[inset_0_0_0_1px_var(--ls-linea2)]'
                : 'text-[var(--ls-t3)] hover:text-[var(--ls-t1)]'
            )}
          >
            {o.texto}
          </button>
        )
      })}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Medidor                                                             */
/* ------------------------------------------------------------------ */

export interface ParteMedidor {
  valor: number
  color: string
  titulo?: string
}

/**
 * Una barra horizontal partida en trozos, con 2 px de superficie entre ellos.
 * Lo que falta hasta `total` se pinta como pista, un escalón por encima de la
 * tarjeta: así se lee cuánto queda por llenar.
 */
export function Medidor({
  partes,
  total,
  alto = 8,
  className,
}: {
  partes: ParteMedidor[]
  total?: number
  alto?: number
  className?: string
}) {
  const suma = partes.reduce((s, p) => s + Math.max(0, p.valor), 0)
  const base = Math.max(total ?? suma, 1)
  return (
    <div
      className={cx('flex w-full gap-[2px] overflow-hidden rounded-full bg-[var(--ls-sup3)]', className)}
      style={{ height: alto }}
      role="img"
      aria-label={partes.map((p) => `${p.titulo ?? ''} ${p.valor}`).join(', ')}
    >
      {partes
        .filter((p) => p.valor > 0)
        .map((p, i) => (
          <span
            key={i}
            title={p.titulo ? `${p.titulo}: ${p.valor}` : undefined}
            className="h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none"
            style={{ width: `${Math.min(100, (p.valor / base) * 100)}%`, background: p.color }}
          />
        ))}
    </div>
  )
}
