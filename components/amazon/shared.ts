import {
  AMAZON_CONNECTION_STATUS_COLORS,
  AMAZON_SUBMISSION_STATUS_COLORS,
  type AmazonConnectionStatus,
  type AmazonSubmissionStatus,
} from '@/lib/types/amazon'

/**
 * Piezas de interfaz compartidas del módulo de Amazon API.
 *
 * SIN 'use client' A PROPÓSITO, igual que components/vacaciones/shared.ts y
 * components/empleados/shared.ts: el Server Component de la pantalla importa de
 * aquí las clases de la cabecera y de los avisos, y bastaría con ponerle la
 * directiva a este fichero para romper esa importación.
 *
 * Se repiten los tokens en vez de importarlos del módulo de al lado por lo
 * mismo que allí: una pantalla no debe depender de un fichero de otro módulo ni
 * para una cadena de CSS. Lo que sí está prohibido duplicar es la LÓGICA, que
 * vive entera en lib/types/amazon.ts y de ahí no se copia ni una línea.
 *
 * Solo se usan opacidades que la capa de traducción de globals.css sabe
 * reinterpretar en tema claro (white/10, white/[0.02], white/45…). Una opacidad
 * inventada se queda blanca sobre fondo blanco. Y amarillo para los avisos,
 * nunca ámbar: `text-amber-*` no está en esa tabla.
 *
 * Y ESO HAY QUE COMPROBARLO CONTRA app/globals.css, no darlo por hecho: este
 * mismo comentario era falso en cuatro clases del módulo. `hover:text-white/80`
 * no está traducido y dejaba la etiqueta del chip apagado en blanco sobre
 * blanco al pasar por encima; `hover:bg-white/[0.02]` tampoco, así que en tema
 * claro la tabla no realzaba la fila bajo el ratón —en siete columnas y miles
 * de líneas, seguir la fila con la vista es la mitad del trabajo—; y
 * `text-white/15` dejaba invisibles los iconos de los estados vacíos. Las
 * traducidas equivalentes son `hover:text-white`, `hover:bg-white/[0.03]` y
 * `text-white/20`.
 */

export const primaryButton =
  'h-8 px-3.5 rounded-full bg-gradient-to-b from-[#FF7A1F] to-[#FF6600] text-white text-[12px] font-semibold flex items-center justify-center gap-1.5 disabled:opacity-40 transition-opacity'

export const ghostButton =
  'h-8 px-3.5 rounded-full border border-white/10 bg-white/[0.03] text-white/75 text-[12px] font-medium flex items-center justify-center gap-1.5 hover:bg-white/[0.06] hover:border-white/20 transition-colors disabled:opacity-50'

/** Desconectar: rojo, porque destruye la llave de acceso a una tienda */
export const dangerButton =
  'h-8 px-3.5 rounded-full border border-red-500/30 bg-red-500/[0.08] text-red-300 text-[12px] font-medium flex items-center justify-center gap-1.5 hover:bg-red-500/[0.14] hover:border-red-500/50 transition-colors disabled:opacity-50'

export const fieldInput =
  'w-full bg-white/[0.04] border border-white/10 rounded-lg px-2.5 py-1.5 text-[12px] text-white outline-none focus:border-[#FF6600] transition-colors placeholder:text-white/25'

export const cardShell = 'rounded-2xl border border-white/10 bg-white/[0.02]'

/** Aviso amarillo: el código de «ojo con esto» de todo el ERP */
export const warnBox =
  'rounded-lg border border-yellow-500/25 bg-yellow-400/[0.06] px-2.5 py-2 text-[11px] text-yellow-300 leading-relaxed'

export const errorBox =
  'rounded-lg border border-red-500/30 bg-red-500/[0.08] px-2.5 py-2 text-[11px] text-red-300 leading-relaxed'

export const infoBox =
  'rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-2 text-[11px] text-white/55 leading-relaxed'

/** La insignia de estado, con las clases completas del dominio */
export function statusPill(status: AmazonConnectionStatus): string {
  const colores =
    AMAZON_CONNECTION_STATUS_COLORS[status] ?? 'bg-zinc-600/25 text-zinc-300 border-zinc-500/30'
  return `inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap ${colores}`
}

/** La del estado de un cambio enviado, para la tabla y el historial */
export function submissionPill(status: string): string {
  const colores =
    AMAZON_SUBMISSION_STATUS_COLORS[status as AmazonSubmissionStatus] ??
    'bg-zinc-600/25 text-zinc-300 border-zinc-500/30'
  return `inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded-full border whitespace-nowrap ${colores}`
}

/* ------------------------------------------------------------------ */
/* La tabla del catálogo                                               */
/* ------------------------------------------------------------------ */

/**
 * La caja de la tabla.
 *
 * `min-w-0` y `overflow-auto` juntos son lo que mantiene el scroll horizontal
 * DENTRO de la caja. Sin ellos, una tabla de nueve columnas estira el `main`,
 * arrastra la página entera en horizontal y se lleva la barra lateral por
 * delante. Es la misma cadena que documentan app/dashboard/layout.tsx y la
 * tabla de Cold Calling, y hay que respetar los tres eslabones: aquí, en el
 * contenedor de la página y en el `min-w-0` del envoltorio.
 */
export const tableShell =
  'h-full w-full min-w-0 overflow-auto rounded-2xl border border-white/10 bg-white/[0.02]'

export const TH =
  'px-2 py-1.5 text-left text-[10px] font-semibold text-white/40 uppercase tracking-wider whitespace-nowrap border-b border-white/10'

/**
 * El fondo opaco de las celdas congeladas.
 *
 * Tiene que ser un color OPACO, no un `bg-white/[0.02]`: una celda translúcida
 * que se queda quieta mientras la fila pasa por debajo deja ver el texto de las
 * otras columnas cruzándola. Se usa el mismo tono en la cabecera y en la
 * primera columna para que la esquina no cante.
 *
 * Va como CLASE y no como color en línea: el tema claro del ERP funciona
 * reinterpretando estas clases —`bg-[#0d0d0d]` pasa a blanco bajo `html.light`—
 * y a un `style` en línea esa traducción no llega. Donde haga falta ponerlo en
 * línea, la variable equivalente es `var(--surface)`.
 */
export const STICKY_BG = 'bg-[#0d0d0d]'

/**
 * Escalonado de z-index de la tabla, que es siempre el mismo en el ERP:
 * esquina 30 · cabecera 20 · primera columna del cuerpo 10 · resto 0.
 * Cambiar uno sin los otros hace que la primera columna se pinte encima de la
 * cabecera al hacer scroll.
 */
export const TH_STICKY_LEFT = `${TH} sticky left-0 z-30 ${STICKY_BG} border-r border-white/[0.07]`

/** Celda editable: no parece un campo hasta que se pasa por encima */
const cellShell =
  'bg-transparent hover:bg-white/[0.05] focus:bg-white/[0.08] border border-transparent focus:border-[#FF6600] rounded px-1.5 py-1 outline-none transition-colors placeholder:text-white/20'

export const numInput = `w-full ${cellShell} text-[12px] text-white text-right tabular-nums`

/** Chip de filtro, encendido o apagado */
export function filterChip(active: boolean): string {
  return `h-7 px-2.5 rounded-full border text-[11px] font-medium whitespace-nowrap transition-colors ${
    active
      ? 'border-[#FF6600]/50 bg-[#FF6600]/[0.12] text-white'
      : 'border-white/10 bg-white/[0.03] text-white/50 hover:text-white hover:border-white/20'
  }`
}

/** Día y hora cortos, para el historial: «7 ago, 14:32» */
export function formatDayTime(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('es-ES', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * «hace 4 minutos», «ayer», «12 mar»…
 *
 * Con hora hasta el día anterior y sin ella a partir de ahí: lo que interesa de
 * un refresco de hace tres semanas es que hace tres semanas que no se refresca,
 * no a qué hora fue.
 */
export function formatWhen(iso: string | null): string {
  if (!iso) return 'nunca'
  const fecha = new Date(iso)
  const minutos = Math.floor((Date.now() - fecha.getTime()) / 60_000)

  if (minutos < 1) return 'hace un momento'
  if (minutos < 60) return `hace ${minutos} min`
  if (minutos < 24 * 60) {
    const horas = Math.floor(minutos / 60)
    return `hace ${horas} ${horas === 1 ? 'hora' : 'horas'}`
  }
  return fecha.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })
}

/** Fecha y hora completas, para el `title` de lo de arriba */
export function formatExact(iso: string | null): string {
  if (!iso) return 'Todavía no ha pasado'
  return new Date(iso).toLocaleString('es-ES', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatInt(n: number): string {
  return n.toLocaleString('es-ES')
}
