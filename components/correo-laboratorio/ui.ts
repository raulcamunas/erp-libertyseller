/**
 * LO QUE COMPARTEN LAS PIEZAS DE «CONFIGURACIÓN DE CORREOS»: estilos de los campos y formato de cifras.
 * Los tokens (`--ls-*`) son los del resto del ERP (lib/estilo/denso.ts), así que se ve igual en el tema claro y en el oscuro.
 */

/** Un cuadro de texto largo (instrucciones, correos de ejemplo) */
export const CAJA =
  'w-full rounded-[6px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-2.5 py-2 text-[12.5px] leading-relaxed text-[var(--ls-t1)] outline-none transition-colors ' +
  'placeholder:text-[var(--ls-t4)] hover:border-[var(--ls-linea2)] focus:border-[var(--ls-acc-graf)] disabled:cursor-not-allowed disabled:opacity-60'

/** Un campo de una línea */
export const LINEA =
  'h-8 w-full rounded-[6px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-2.5 text-[12.5px] text-[var(--ls-t1)] outline-none transition-colors ' +
  'placeholder:text-[var(--ls-t4)] hover:border-[var(--ls-linea2)] focus:border-[var(--ls-acc-graf)] disabled:cursor-not-allowed disabled:opacity-60'

export const ETIQUETA = 'mb-1 block text-[11.5px] font-semibold text-[var(--ls-t3)]'
export const AYUDA = 'mt-1 text-[11.5px] leading-snug text-[var(--ls-t4)]'

/** Un botón de la pantalla. `primario` es el que guarda; solo uno por zona */
export const BOTON_PRIMARIO =
  'inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-[6px] border border-[var(--ls-acc-borde)] bg-[var(--ls-acc-relleno)] px-3 text-[12.5px] font-semibold text-[var(--ls-acc-tinta)] hover:brightness-110 disabled:cursor-default disabled:opacity-45'
export const BOTON_SECUNDARIO =
  'inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-[6px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] px-3 text-[12.5px] text-[var(--ls-t2)] transition-colors hover:border-[var(--ls-linea2)] hover:bg-[var(--ls-sup3)] hover:text-[var(--ls-t1)] disabled:cursor-default disabled:opacity-45'

/** 0,026 -> «2,6 %». null -> «—» */
export function pct(n: number | null | undefined, decimales = 1): string {
  if (n === null || n === undefined) return '—'
  return `${(n * 100).toLocaleString('es-ES', { minimumFractionDigits: decimales, maximumFractionDigits: decimales })} %`
}

/** «1,4–4,7 %» a partir de un intervalo [0,014, 0,047] */
export function rangoPct(intervalo: [number, number] | null | undefined): string {
  if (!intervalo) return ''
  const f = (n: number) => (n * 100).toLocaleString('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
  return `${f(intervalo[0])}–${f(intervalo[1])} %`
}

/** «23 oct» */
export function fechaCorta(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })
}

/** 0,0087 dólares -> «0,9 céntimos» */
export function centimos(dolares: number | null | undefined): string {
  if (dolares === null || dolares === undefined) return 'coste desconocido'
  const c = dolares * 100
  return `${c.toLocaleString('es-ES', { minimumFractionDigits: c < 10 ? 1 : 0, maximumFractionDigits: c < 10 ? 1 : 0 })} céntimos`
}
