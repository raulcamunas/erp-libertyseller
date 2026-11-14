/**
 * EL CICLO DE CUATRO SEMANAS DE UNA CUENTA — PURO.
 *
 * Es el ciclo de la skill «bulk-optimizacion-amazon-ads» que hasta el 14 nov 2026 llevaba a mano la persona de marketing, pasado a pasos que el
 * administrativo marca como hechos en «Cuentas de clientes»:
 *
 *   | Semana | Ventana | Pujas | Auditoría | Ficha                              | Informe al cliente |
 *   | S1     | 7 días  | No    | No        | No                                 | Semanal            |
 *   | S2     | 14 días | Sí    | Sí        | No                                 | Quincenal          |
 *   | S3     | 7 días  | No    | No        | Sí, si hay una propuesta aprobada  | Semanal            |
 *   | S4     | 30 días | Sí    | Sí        | No                                 | Mensual            |
 *
 * La regla de separación: la ficha y las pujas NUNCA la misma semana (si no, no se sabe qué movió las ventas). Por eso las pujas van en S2 y S4 y
 * la ficha en S3. Todas las semanas se mira lo que bloquea la venta (cumplimiento y stock) y se revisan las negativas y la cosecha del motor.
 *
 * La semana de hoy sale del lunes en que empezó la S1 de ese cliente (`ciclo_inicio`): cada cliente lleva su propio ciclo, para que no caigan
 * todos los informes mensuales la misma semana.
 */

export type Semana = 1 | 2 | 3 | 4
export type AreaDelPaso = 'ppc' | 'seo' | 'cumplimiento' | 'informe' | 'cuenta'

export interface PasoDelCiclo {
  id: string
  area: AreaDelPaso
  titulo: string
  /** Qué hacer, en una o dos frases, para quien lo hace por primera vez */
  detalle: string
  /** La herramienta donde se hace */
  herramienta: 'ppc-hoy' | 'ppc-propuestas' | 'ppc-ficha' | 'seo-hoy' | 'seo-busquedas' | 'cumplimiento-hoy' | 'informe' | 'tareas'
}

export const VENTANA_DIAS: Record<Semana, number> = { 1: 7, 2: 14, 3: 7, 4: 30 }
export const NOMBRE_SEMANA: Record<Semana, string> = { 1: 'S1 · semanal', 2: 'S2 · quincenal', 3: 'S3 · semanal + ficha', 4: 'S4 · mensual' }

const CUMPLIMIENTO: PasoDelCiclo = {
  id: 'cumplimiento',
  area: 'cumplimiento',
  titulo: 'Resolver lo que bloquea la venta',
  detalle: 'Cumplimiento → «Hoy»: primero los listings ocultos con stock y la normativa con plazo. Lo demás puede esperar.',
  herramienta: 'cumplimiento-hoy',
}
const NEGATIVAS: PasoDelCiclo = {
  id: 'propuestas',
  area: 'ppc',
  titulo: 'Negativas y cosecha del motor',
  detalle: 'PPC → «Qué hacer hoy»: aprueba las negativas (gasto sin ventas) y lo que pasa a EXACTA. Esta semana no se tocan pujas.',
  herramienta: 'ppc-hoy',
}
const PUJAS: PasoDelCiclo = {
  id: 'propuestas',
  area: 'ppc',
  titulo: 'Negativas, cosecha, pujas y presupuestos',
  detalle: 'PPC → «Qué hacer hoy»: aprueba negativas y cosecha, y esta semana también las pujas (máximo ±25 % por vez) y los presupuestos que se quedan cortos.',
  herramienta: 'ppc-hoy',
}
const AUDITORIA: PasoDelCiclo = {
  id: 'auditoria',
  area: 'seo',
  titulo: 'Auditoría de visibilidad',
  detalle: 'SEO → «Qué hacer hoy»: dónde se cae cada búsqueda (impresiones, clics, carrito, compra). Lo que es de PPC se ataca con publicidad; lo que es de ficha se prepara para la S3.',
  herramienta: 'seo-hoy',
}
const FICHA: PasoDelCiclo = {
  id: 'ficha',
  area: 'seo',
  titulo: 'Cambiar la ficha, si hay una propuesta lista',
  detalle: 'SEO → Ficha: aplica la propuesta (máximo un cambio de título cada 30 días por producto, y se juzga a los 21). Si no hay ninguna, márcalo hecho y no inventes palabras.',
  herramienta: 'seo-hoy',
}
const informe = (s: Semana): PasoDelCiclo => ({
  id: s === 4 ? 'informe-mensual' : s === 2 ? 'informe-quincenal' : 'informe-semanal',
  area: 'informe',
  titulo: s === 4 ? 'Informe mensual al cliente' : s === 2 ? 'Informe quincenal al cliente' : 'Informe semanal al cliente',
  detalle:
    s === 4
      ? 'Revisa el borrador del mes (negocio, publicidad, mercado y fichas), añade tu lectura y envíalo.'
      : s === 2
        ? 'Revisa el borrador de los 14 días con la auditoría de visibilidad, añade tu lectura y envíalo.'
        : 'Revisa el borrador de la semana (cifras y lo que se ha hecho), añade tu lectura y envíalo.',
  herramienta: 'informe',
})
const FICHA_DE_CUENTA: PasoDelCiclo = {
  id: 'ficha-de-cuenta',
  area: 'cuenta',
  titulo: 'Repasar los objetivos de la cuenta',
  detalle: 'PPC → Ficha de cuenta y Productos: ¿sigue bien el ACoS objetivo de cada producto, la fase y el presupuesto del mes? Cámbialo si el cliente ha cambiado de prioridad.',
  herramienta: 'ppc-ficha',
}

/** Los pasos de una semana del ciclo, en el orden en que se hacen */
export function pasosDeSemana(s: Semana): PasoDelCiclo[] {
  if (s === 1) return [CUMPLIMIENTO, NEGATIVAS, informe(1)]
  if (s === 2) return [CUMPLIMIENTO, AUDITORIA, PUJAS, informe(2)]
  if (s === 3) return [CUMPLIMIENTO, FICHA, NEGATIVAS, informe(3)]
  return [CUMPLIMIENTO, AUDITORIA, PUJAS, FICHA_DE_CUENTA, informe(4)]
}

const DIA = 86_400_000

/** El lunes (AAAA-MM-DD) de la semana de una fecha AAAA-MM-DD */
export function lunesDe(fecha: string): string {
  const d = new Date(`${fecha}T12:00:00Z`)
  const dow = (d.getUTCDay() + 6) % 7 // 0 = lunes
  return new Date(d.getTime() - dow * DIA).toISOString().slice(0, 10)
}

export interface SemanaDelCiclo {
  semana: Semana
  /** El lunes de esta semana */
  lunes: string
  /** El lunes de la S1 del ciclo en curso */
  inicioDelCiclo: string
  /** Número de ciclo desde el primero (1 = el primero) */
  ciclo: number
}

/**
 * En qué semana del ciclo está un cliente hoy. null si todavía no tiene ciclo (no se sabe cuándo empezó) o si su ciclo empieza en el futuro.
 * `inicio` se normaliza a su lunes: guardar un miércoles no descoloca nada.
 */
export function semanaDelCiclo(inicio: string | null | undefined, hoy: string): SemanaDelCiclo | null {
  if (!inicio || !/^\d{4}-\d{2}-\d{2}$/.test(inicio)) return null
  const l0 = lunesDe(inicio)
  const lh = lunesDe(hoy)
  const semanas = Math.round((Date.parse(`${lh}T12:00:00Z`) - Date.parse(`${l0}T12:00:00Z`)) / (7 * DIA))
  if (semanas < 0) return null
  const semana = ((semanas % 4) + 1) as Semana
  const ciclo = Math.floor(semanas / 4) + 1
  const inicioDelCiclo = new Date(Date.parse(`${lh}T12:00:00Z`) - (semana - 1) * 7 * DIA).toISOString().slice(0, 10)
  return { semana, lunes: lh, inicioDelCiclo, ciclo }
}

/** El periodo que mira el informe de esta semana: los N días que acaban el domingo anterior (lo que Amazon ya ha cerrado) */
export function ventanaDelInforme(s: SemanaDelCiclo): { desde: string; hasta: string; dias: number } {
  const dias = VENTANA_DIAS[s.semana]
  const hasta = new Date(Date.parse(`${s.lunes}T12:00:00Z`) - DIA).toISOString().slice(0, 10)
  const desde = new Date(Date.parse(`${hasta}T12:00:00Z`) - (dias - 1) * DIA).toISOString().slice(0, 10)
  return { desde, hasta, dias }
}

/** Qué falta de esta semana, con lo hecho (ids de paso marcados para ESTE lunes) */
export function progresoDeSemana(s: Semana, hechos: ReadonlySet<string>): { total: number; hechos: number; siguiente: PasoDelCiclo | null } {
  const pasos = pasosDeSemana(s)
  const n = pasos.filter((p) => hechos.has(p.id)).length
  return { total: pasos.length, hechos: n, siguiente: pasos.find((p) => !hechos.has(p.id)) ?? null }
}

/** Un lunes que sirve de inicio para un cliente que empieza hoy: el lunes de esta semana */
export const inicioParaHoy = (hoy: string) => lunesDe(hoy)
