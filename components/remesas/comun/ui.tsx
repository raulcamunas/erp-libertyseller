'use client'

import type { ReactNode } from 'react'
import { COLOR_ESTADO, INSIGNIA, TIPO, type TonoEstado } from '@/lib/estilo/denso'

/**
 * LAS PIEZAS COMUNES DE REMESAS A FBA.
 *
 * Todo sale del contrato de estilo de lib/estilo/denso.ts —superficies opacas
 * escalonadas, cuatro niveles de texto, radios de 4/6/10— y de sus tokens
 * `--ls-*`, así que cada pieza sigue sola al tema claro y al oscuro.
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
    <section className={cx('min-w-0 rounded-[8px] border border-[var(--ls-linea)] bg-[var(--ls-sup)]', className)}>
      {(titulo || derecha) && (
        <header className="flex min-h-[36px] items-center justify-between gap-3 border-b border-[var(--ls-linea)] px-3 py-[6px]">
          <div className="min-w-0">
            {titulo && <h3 className={cx(TIPO.l, 'truncate text-[var(--ls-t1)]')}>{titulo}</h3>}
            {ayuda && <p className="truncate text-[11px] leading-[1.4] text-[var(--ls-t4)]">{ayuda}</p>}
          </div>
          {derecha && <div className="flex shrink-0 items-center gap-2">{derecha}</div>}
        </header>
      )}
      <div className={cuerpo ? 'p-3' : undefined}>{children}</div>
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
      className="inline-flex shrink-0 items-center gap-[2px] rounded-[6px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] p-[2px]"
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
              'inline-flex h-[22px] items-center gap-[5px] whitespace-nowrap rounded-[4px] px-[9px] text-[11.5px] transition-colors',
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
      className={cx('flex w-full gap-[2px] overflow-hidden rounded-[4px] bg-[var(--ls-sup3)]', className)}
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
            className="h-full rounded-[3px] transition-[width] duration-500"
            style={{ width: `${Math.min(100, (p.valor / base) * 100)}%`, background: p.color }}
          />
        ))}
    </div>
  )
}
