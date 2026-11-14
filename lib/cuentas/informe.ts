/**
 * EL INFORME AL CLIENTE (semanal, quincenal y mensual) — PURO: tipos, vocabulario de cliente y textos.
 *
 * Sustituye a las skills «informes-cliente-amazon» y «reporte-amazon-ads-liberty-seller» que usaba la persona de marketing: el ERP prepara el BORRADOR
 * con las cifras que ya tiene guardadas, la IA propone la lectura y el administrativo la revisa, añade lo que haya hecho fuera del ERP y lo envía.
 *
 * Las reglas de un documento que ve el cliente (skill «identidad-documentos-liberty-seller») mandan aquí:
 *   · nada de promesas ni de fechas futuras: se cuenta lo que ha pasado y lo que dicen los datos;
 *   · nada de vocabulario interno (S1, SOP, Log, bulk, negativizar, ficha de cuenta…): se traduce;
 *   · cada afirmación con su cifra.
 */

export type TipoDeInforme = 'semanal' | 'quincenal' | 'mensual'
export const DIAS_DEL_INFORME: Record<TipoDeInforme, number> = { semanal: 7, quincenal: 14, mensual: 30 }
export const NOMBRE_DEL_INFORME: Record<TipoDeInforme, string> = { semanal: 'Informe semanal', quincenal: 'Informe quincenal', mensual: 'Informe mensual' }
export const tipoDeSemana = (s: 1 | 2 | 3 | 4): TipoDeInforme => (s === 4 ? 'mensual' : s === 2 ? 'quincenal' : 'semanal')

export interface Ventana {
  gasto: number
  ventas: number
  pedidos: number
  clics: number
  impresiones: number
}

export interface PaisDelInforme {
  pais: string
  moneda: string | null
  actual: Ventana
  anterior: Ventana
  /** Ventas totales (orgánico + publicidad) del periodo, si hay cuenta de vendedor y el periodo es el que Amazon da */
  ventasTotales: number | null
}

export interface ProductoDelInforme {
  asin: string
  nombre: string | null
  gasto: number
  ventas: number
  pedidos: number
  clics: number
}

export interface LineaEjecutada {
  /** Ya en lenguaje de cliente */
  accion: string
  cantidad: number
  criterio: string
}

export type EtiquetaDeBusqueda = 'Consulta ganada' | 'No nos eligen' | 'Entran y no compran' | 'Poca presencia' | 'Convierte bien, sale poco'

export interface BusquedaDelInforme {
  consulta: string
  volumen: number | null
  cuotaImpresiones: number | null
  cuotaClics: number | null
  cuotaCompras: number | null
  cuotaComprasAntes: number | null
  etiqueta: EtiquetaDeBusqueda | null
}

export interface DatosDelInforme {
  version: 1
  cliente: string
  tipo: TipoDeInforme
  desde: string
  hasta: string
  dias: number
  anterior: { desde: string; hasta: string }
  /** La moneda de los totales (la del país principal); los países con otra moneda solo salen en su tabla */
  moneda: string
  total: Ventana
  totalAnterior: Ventana
  ventasTotales: number | null
  ventasTotalesNota: string | null
  paises: PaisDelInforme[]
  productos: ProductoDelInforme[]
  diario: Array<{ fecha: string; gasto: number; ventas: number }>
  ejecutado: LineaEjecutada[]
  /** Solo quincenal y mensual, y solo si hay Brand Analytics */
  visibilidad: { periodo: string; busquedas: BusquedaDelInforme[] } | null
  visibilidadNota: string | null
  /** Solo mensual: fichas que Amazon tiene con problemas, al principio y al final del periodo */
  salud: { revisadas: number; conProblemasInicio: number | null; conProblemasFin: number; ocultasFin: number } | null
  generadoAt: string
}

/* ------------------------------------------------------------------ */
/* Cifras                                                              */
/* ------------------------------------------------------------------ */

export const VENTANA_VACIA: Ventana = { gasto: 0, ventas: 0, pedidos: 0, clics: 0, impresiones: 0 }
export const acos = (v: Pick<Ventana, 'gasto' | 'ventas'>) => (v.ventas > 0 ? v.gasto / v.ventas : null)
export const roas = (v: Pick<Ventana, 'gasto' | 'ventas'>) => (v.gasto > 0 ? v.ventas / v.gasto : null)
export const cpc = (v: Pick<Ventana, 'gasto' | 'clics'>) => (v.clics > 0 ? v.gasto / v.clics : null)
export const cvr = (v: Pick<Ventana, 'pedidos' | 'clics'>) => (v.clics > 0 ? v.pedidos / v.clics : null)
export const variacion = (a: number | null, b: number | null) => (a == null || b == null || b === 0 ? null : (a - b) / Math.abs(b))

export const dinero = (n: number | null | undefined, moneda: string | null, decimales = 0) =>
  n == null || Number.isNaN(n) ? '—' : n.toLocaleString('es-ES', { style: 'currency', currency: moneda || 'EUR', minimumFractionDigits: decimales, maximumFractionDigits: decimales })
export const pct = (n: number | null | undefined, decimales = 1) =>
  n == null || Number.isNaN(n) ? '—' : n > 0 && n * 100 < 0.1 ** decimales / 2 ? `<${(0.1 ** decimales).toLocaleString('es-ES', { maximumFractionDigits: decimales })} %` : `${(n * 100).toLocaleString('es-ES', { minimumFractionDigits: decimales, maximumFractionDigits: decimales })} %`
export const decimal = (n: number | null | undefined, decimales = 2) => (n == null || Number.isNaN(n) ? '—' : n.toLocaleString('es-ES', { minimumFractionDigits: decimales, maximumFractionDigits: decimales }))
/** Los países con inversión en alguno de los dos periodos (los que solo tienen ventas totales no hacen falta en la tabla de publicidad) */
export const paisesConInversion = (d: Pick<DatosDelInforme, 'paises'>) => d.paises.filter((p) => p.actual.gasto > 0 || p.anterior.gasto > 0)
export const entero = (n: number | null | undefined) => (n == null || Number.isNaN(n) ? '—' : Math.round(n).toLocaleString('es-ES'))
export const fechaLarga = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', timeZone: 'UTC' })
export const periodoEnTexto = (desde: string, hasta: string) => `del ${fechaLarga(desde)} al ${fechaLarga(hasta)} de ${hasta.slice(0, 4)}`

/** Sumar ventanas */
export function sumar(xs: readonly Ventana[]): Ventana {
  return xs.reduce((a, v) => ({ gasto: a.gasto + v.gasto, ventas: a.ventas + v.ventas, pedidos: a.pedidos + v.pedidos, clics: a.clics + v.clics, impresiones: a.impresiones + v.impresiones }), { ...VENTANA_VACIA })
}

/** El periodo del informe y el anterior de la misma longitud. `hasta` incluido */
export function periodos(hasta: string, dias: number): { desde: string; hasta: string; anterior: { desde: string; hasta: string } } {
  const DIA = 86_400_000
  const h = Date.parse(`${hasta}T12:00:00Z`)
  const f = (ms: number) => new Date(ms).toISOString().slice(0, 10)
  return { desde: f(h - (dias - 1) * DIA), hasta, anterior: { desde: f(h - (2 * dias - 1) * DIA), hasta: f(h - dias * DIA) } }
}

/* ------------------------------------------------------------------ */
/* Lo ejecutado, en lenguaje de cliente                                */
/* ------------------------------------------------------------------ */

/** Una fila del log de cambios de Amazon Ads o una propuesta aplicada del motor, reducida a lo que hace falta para contarla */
export interface CambioHecho {
  /** negativizar | promover | puja-sube | puja-baja | presupuesto-sube | presupuesto-baja | pausar | activar | crear | otro */
  clase: string
}

const TEXTO_DE_CLASE: Record<string, { accion: string; criterio: string }> = {
  negativizar: { accion: 'Búsquedas excluidas', criterio: 'Gastaban en clics sin llegar a vender' },
  promover: { accion: 'Búsquedas que venden, con campaña propia', criterio: 'Han vendido varias veces: se controlan aparte con su propia puja' },
  'puja-baja': { accion: 'Pujas bajadas', criterio: 'Coste por venta por encima del objetivo' },
  'puja-sube': { accion: 'Pujas subidas', criterio: 'Venden por debajo del coste objetivo: margen para ganar más visibilidad' },
  'presupuesto-sube': { accion: 'Presupuestos ampliados', criterio: 'Campañas rentables que se quedaban sin presupuesto antes de acabar el día' },
  'presupuesto-baja': { accion: 'Presupuestos reducidos', criterio: 'Gasto que no se convertía en ventas' },
  pausar: { accion: 'Segmentaciones o campañas pausadas', criterio: 'Gasto acumulado sin ventas' },
  activar: { accion: 'Campañas reactivadas', criterio: 'Vuelven a tener stock o motivo para anunciarse' },
  crear: { accion: 'Campañas nuevas', criterio: 'Estructura para un producto o una búsqueda que lo necesitaba' },
}

/** Agrupa lo hecho por clase, en el orden en que más pesa para el cliente */
export function resumirEjecutado(cambios: readonly CambioHecho[]): LineaEjecutada[] {
  const cuenta = new Map<string, number>()
  for (const c of cambios) cuenta.set(c.clase, (cuenta.get(c.clase) ?? 0) + 1)
  const orden = ['negativizar', 'pausar', 'puja-baja', 'puja-sube', 'promover', 'presupuesto-sube', 'presupuesto-baja', 'crear', 'activar']
  const salida: LineaEjecutada[] = []
  for (const k of orden) {
    const n = cuenta.get(k)
    if (n) salida.push({ accion: TEXTO_DE_CLASE[k].accion, cantidad: n, criterio: TEXTO_DE_CLASE[k].criterio })
  }
  const otros = [...cuenta].filter(([k]) => !orden.includes(k)).reduce((a, [, n]) => a + n, 0)
  if (otros) salida.push({ accion: 'Otros ajustes de las campañas', cantidad: otros, criterio: 'Mantenimiento de la cuenta' })
  return salida
}

/** De una propuesta del motor aplicada a su clase */
export function claseDePropuesta(p: { tipo: string; valorActual: number | null; valorNuevo: number | null }): string {
  if (p.tipo === 'puja') return (p.valorNuevo ?? 0) >= (p.valorActual ?? 0) ? 'puja-sube' : 'puja-baja'
  if (p.tipo === 'presupuesto') return (p.valorNuevo ?? 0) >= (p.valorActual ?? 0) ? 'presupuesto-sube' : 'presupuesto-baja'
  return p.tipo === 'negativizar' || p.tipo === 'promover' || p.tipo === 'pausar' ? p.tipo : 'otro'
}

/** De una fila del log de cambios hecho a mano en el ERP a su clase */
export function claseDeLog(f: { accion: string; campo: string | null; valorAnterior: string | null; valorNuevo: string | null }): string | null {
  const campo = (f.campo ?? '').toLowerCase()
  if (campo.includes('modo del motor')) return null // es configuración nuestra, no un cambio en la cuenta
  if (f.accion === 'negativizar') return 'negativizar'
  if (f.accion === 'promover') return 'promover'
  if (f.accion === 'pausar' || f.accion === 'archivar') return 'pausar'
  if (f.accion === 'activar') return 'activar'
  if (f.accion === 'crear') return 'crear'
  if (f.accion === 'cambiar') {
    const a = Number(String(f.valorAnterior ?? '').replace(',', '.'))
    const b = Number(String(f.valorNuevo ?? '').replace(',', '.'))
    const sube = Number.isFinite(a) && Number.isFinite(b) ? b >= a : true
    if (campo.includes('puja') || campo.includes('bid')) return sube ? 'puja-sube' : 'puja-baja'
    if (campo.includes('presupuesto') || campo.includes('budget')) return sube ? 'presupuesto-sube' : 'presupuesto-baja'
    if (campo.includes('estado')) return String(f.valorNuevo ?? '').toUpperCase().includes('PAUS') ? 'pausar' : 'activar'
  }
  return 'otro'
}

/* ------------------------------------------------------------------ */
/* Búsquedas, en lenguaje de cliente                                   */
/* ------------------------------------------------------------------ */

/** Del veredicto del embudo de SEO (lib/seo/embudo.ts) a una etiqueta que entiende el cliente; null = no se enseña (otro producto o sin compras) */
export function etiquetaDeVeredicto(v: { tipo: string; etapa?: string } | null): EtiquetaDeBusqueda | null {
  if (!v) return null
  if (v.tipo === 'lider') return 'Consulta ganada'
  if (v.tipo === 'infraexpuesta') return 'Convierte bien, sale poco'
  if (v.tipo === 'visibilidad') return 'Poca presencia'
  if (v.tipo === 'fuga') return v.etapa === 'clics' ? 'No nos eligen' : 'Entran y no compran'
  return null
}

/* ------------------------------------------------------------------ */
/* Para la IA y para el correo                                         */
/* ------------------------------------------------------------------ */

/** El resumen de las cifras que se le pasa a la IA para que escriba la lectura */
export function resumenParaLaIa(d: DatosDelInforme): string {
  const m = d.moneda
  const l: string[] = []
  l.push(`Cliente: ${d.cliente}. ${NOMBRE_DEL_INFORME[d.tipo]} ${periodoEnTexto(d.desde, d.hasta)} (${d.dias} días), comparado con los ${d.dias} días anteriores.`)
  const t = d.total
  const a = d.totalAnterior
  l.push(`Publicidad: inversión ${dinero(t.gasto, m)} (antes ${dinero(a.gasto, m)}), ventas atribuidas ${dinero(t.ventas, m)} (antes ${dinero(a.ventas, m)}), ACoS ${pct(acos(t))} (antes ${pct(acos(a))}), ROAS ${decimal(roas(t))} (antes ${decimal(roas(a))}), pedidos ${t.pedidos} (antes ${a.pedidos}), clics ${t.clics} (antes ${a.clics}), CPC ${dinero(cpc(t), m, 2)} (antes ${dinero(cpc(a), m, 2)}), conversión ${pct(cvr(t))} (antes ${pct(cvr(a))}).`)
  if (d.ventasTotales) l.push(`Ventas totales de la cuenta (orgánico + publicidad): ${dinero(d.ventasTotales, m)}; TACoS ${pct(t.gasto / d.ventasTotales)}.`)
  if (paisesConInversion(d).length > 1) l.push(`Por país: ${paisesConInversion(d).map((p) => `${p.pais} ${dinero(p.actual.gasto, p.moneda)} invertidos, ${dinero(p.actual.ventas, p.moneda)} vendidos, ACoS ${pct(acos(p.actual))}`).join('; ')}.`)
  if (d.productos.length) l.push(`Productos con más inversión: ${d.productos.filter((p) => p.gasto > 0).slice(0, 5).map((p) => `${p.nombre ?? p.asin}: ${dinero(p.gasto, m)} invertidos, ${dinero(p.ventas, m)} vendidos, ACoS ${pct(acos(p))}`).join('; ')}.`)
  if (d.ejecutado.length) l.push(`Hecho en el periodo: ${d.ejecutado.map((e) => `${e.accion} (${e.cantidad}) — ${e.criterio}`).join('; ')}.`)
  else l.push('Hecho en el periodo: no hay cambios registrados en el ERP (puede que se hayan hecho fuera; no los menciones).')
  if (d.visibilidad?.busquedas.length) l.push(`Búsquedas principales (Brand Analytics, ${d.visibilidad.periodo}): ${d.visibilidad.busquedas.slice(0, 6).map((b) => `«${b.consulta}»: cuota de compras ${pct(b.cuotaCompras)}${b.cuotaComprasAntes != null ? ` (antes ${pct(b.cuotaComprasAntes)})` : ''}${b.etiqueta ? `, ${b.etiqueta}` : ''}`).join('; ')}.`)
  if (d.salud) l.push(`Fichas con problemas ante Amazon: ${d.salud.conProblemasFin} de ${d.salud.revisadas} revisadas al final del periodo${d.salud.conProblemasInicio != null ? ` (al principio, ${d.salud.conProblemasInicio})` : ''}; ocultas: ${d.salud.ocultasFin}.`)
  return l.join('\n')
}

/** La lectura de respaldo si la IA no contesta: cifras en frases, sin interpretar */
export function lecturaDeRespaldo(d: DatosDelInforme): string {
  const t = d.total
  const a = d.totalAnterior
  const va = variacion(t.ventas, a.ventas)
  const frases = [
    `En estos ${d.dias} días la publicidad ha generado ${dinero(t.ventas, d.moneda)} en ventas con una inversión de ${dinero(t.gasto, d.moneda)} (ACoS ${pct(acos(t))}).`,
    va != null ? `Las ventas de publicidad ${va >= 0 ? 'suben' : 'bajan'} un ${pct(Math.abs(va), 0)} respecto a los ${d.dias} días anteriores, y el ACoS pasa del ${pct(acos(a))} al ${pct(acos(t))}.` : '',
    d.ventasTotales ? `Sobre las ventas totales de la cuenta (${dinero(d.ventasTotales, d.moneda)}), la publicidad supone un ${pct(t.gasto / d.ventasTotales)} de inversión.` : '',
  ]
  return frases.filter(Boolean).join(' ')
}

const escapar = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** El correo que acompaña al informe: el saludo, la lectura y el botón al informe. HTML sencillo que se ve bien en cualquier cliente de correo */
export function correoDelInformeHtml(e: { cliente: string; tipo: TipoDeInforme; desde: string; hasta: string; saludo: string; lectura: string; url: string; firma: string }): string {
  const parrafos = e.lectura
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#141414">${escapar(p.trim()).replace(/\n/g, '<br>')}</p>`)
    .join('')
  return `<!doctype html><html><body style="margin:0;padding:0;background:#F7F5F2"><div style="max-width:600px;margin:0 auto;padding:28px 20px;font-family:Inter,Arial,sans-serif">
<p style="margin:0 0 14px;font-size:15px;color:#141414">${escapar(e.saludo)}</p>
${parrafos}
<p style="margin:22px 0"><a href="${escapar(e.url)}" style="display:inline-block;background:#F26212;color:#FFFFFF;text-decoration:none;font-weight:600;font-size:15px;padding:12px 20px;border-radius:8px">Ver el ${NOMBRE_DEL_INFORME[e.tipo].toLowerCase()}</a></p>
<p style="margin:0 0 4px;font-size:13px;color:#5E5852">${escapar(NOMBRE_DEL_INFORME[e.tipo])} de ${escapar(e.cliente)}, ${escapar(periodoEnTexto(e.desde, e.hasta))}. Desde la página lo puedes guardar en PDF.</p>
<p style="margin:18px 0 0;font-size:15px;color:#141414">${escapar(e.firma)}</p>
</div></body></html>`
}

export function correoDelInformeTexto(e: { cliente: string; tipo: TipoDeInforme; desde: string; hasta: string; saludo: string; lectura: string; url: string; firma: string }): string {
  return `${e.saludo}\n\n${e.lectura.trim()}\n\nVer el ${NOMBRE_DEL_INFORME[e.tipo].toLowerCase()}: ${e.url}\n\n${e.firma}`
}

/** Lo que no puede aparecer en un texto para el cliente (skill de identidad, sección 5). Devuelve las palabras encontradas */
export function vocabularioInterno(texto: string): string[] {
  const prohibidas = [/\bS[1-4]\b/, /\bSOP\b/i, /\bbulk\b/i, /\blog\b/i, /negativiz/i, /ficha de cuenta/i, /\bfirm(a|ado|ada)\b/i, /\baprob(ado|ada|ación)\b/i, /\bmotor\b/i, /\bpropuestas? del motor\b/i]
  return prohibidas.filter((r) => r.test(texto)).map((r) => texto.match(r)?.[0] ?? '')
}
