/**
 * LA TEMPORADA DE UN PRODUCTO (VERANO, INVIERNO O TODO EL AÑO) — PURO (24 nov 2026, Raúl). Se comprueba con temporada.prueba.ts.
 * ==============================================================================================================================
 * Para no mandar sandalias en diciembre ni botas en julio. El ritmo de una sandalia agotada en septiembre sale de su verano (0,8 pares al día) y,
 * sin esto, el plan la proponía para llegar en enero.
 *
 * QUIÉN DECIDE LA TEMPORADA (barato):
 *   1. Una persona, si la ha puesto (origen 'manual'): siempre manda.
 *   2. Una REGLA por palabras del nombre: «sandalia», «chancla», «alpargata»… → verano; «bota», «botín», «borreguito», «forro»… → invierno. Gratis.
 *   3. Lo que la regla no sabe, y solo en clientes de calzado (referencias con modelo y talla), la IA más barata de una vez para todos los modelos
 *      que falten (lib/fba/temporada-servidor.ts). Se guarda en `fba_temporadas` y no se vuelve a preguntar.
 *
 * LAS TEMPORADAS DE VENTA (hemisferio norte; las cuentas de hoy son de España, Italia y EE. UU.):
 *   · verano: del 15 de marzo al 31 de agosto
 *   · invierno: del 15 de septiembre al último día de febrero
 * Un envío de un producto de temporada solo se propone si LLEGA (está a la venta) dentro de su temporada, y cubre como mucho hasta que acaba.
 */

export type Temporada = 'verano' | 'invierno' | 'todo'

/** [mes, día] de inicio y fin de cada temporada de venta */
export const TEMPORADAS: Record<'verano' | 'invierno', { inicio: [number, number]; fin: [number, number]; texto: string }> = {
  verano: { inicio: [3, 15], fin: [8, 31], texto: 'del 15 de marzo al 31 de agosto' },
  invierno: { inicio: [9, 15], fin: [2, 28], texto: 'del 15 de septiembre a finales de febrero' },
}

// Las zapatillas de estar por casa NO van aquí: las hay de rejilla para el verano y de paño para el invierno (Cobo tiene de las dos); las decide
// la palabra «verano»/«invierno» del nombre, que Amazon suele llevar, o la IA
const VERANO = /\b(verano|sandali\w*|chancl\w*|alpargat\w*|espart\w*|chinel\w*|player\w*|piscina|flip[\s-]?flops?|sandals?|slides?|espadrilles?|n[aá]utic\w*|cangrejer\w*)\b/i
const INVIERNO = /\b(invierno|bota|botas|bot[ií]n\w*|botines|borreg\w*|forrad\w*|forro|apr[eè]s[\s-]?ski|apreski|nieve|katiusk\w*|katiusca\w*|boots?|ugg|calentit\w*)\b/i

/** La temporada por palabras del nombre, o null si la regla no lo sabe (la decide la IA o se queda en «todo el año») */
export function temporadaPorReglas(nombre: string | null | undefined): { temporada: Temporada; motivo: string } | null {
  const t = (nombre ?? '').normalize('NFC')
  if (!t.trim()) return null
  const v = VERANO.exec(t)
  const i = INVIERNO.exec(t)
  if (v && !i) return { temporada: 'verano', motivo: `el nombre dice «${v[0]}»` }
  if (i && !v) return { temporada: 'invierno', motivo: `el nombre dice «${i[0]}»` }
  return null
}

const mesDia = (fecha: string): number => Number(fecha.slice(5, 7)) * 100 + Number(fecha.slice(8, 10))
const md = ([m, d]: [number, number]) => m * 100 + d

/** ¿Está la fecha dentro de la temporada de venta? «todo» siempre */
export function enTemporada(t: Temporada, fecha: string): boolean {
  if (t === 'todo') return true
  const x = mesDia(fecha)
  const { inicio, fin } = TEMPORADAS[t]
  const a = md(inicio)
  const b = md(fin) === 228 ? 229 : md(fin)
  return a <= b ? x >= a && x <= b : x >= a || x <= b
}

const ultimoDiaDeFebrero = (ano: number) => (new Date(Date.UTC(ano, 2, 0)).getUTCDate())
const fecha = (ano: number, [m, d]: [number, number]) => `${ano}-${String(m).padStart(2, '0')}-${String(m === 2 && d >= 28 ? ultimoDiaDeFebrero(ano) : d).padStart(2, '0')}`

/** El último día de la temporada en la que cae `desde` (si cae dentro) */
export function finDeTemporada(t: 'verano' | 'invierno', desde: string): string {
  const ano = Number(desde.slice(0, 4))
  const { fin } = TEMPORADAS[t]
  const candidato = fecha(ano, fin)
  return candidato >= desde ? candidato : fecha(ano + 1, fin)
}

/** El próximo día en que empieza la temporada, a partir de `desde` */
export function proximoInicio(t: 'verano' | 'invierno', desde: string): string {
  const ano = Number(desde.slice(0, 4))
  const { inicio } = TEMPORADAS[t]
  const candidato = fecha(ano, inicio)
  return candidato >= desde ? candidato : fecha(ano + 1, inicio)
}
