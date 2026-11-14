/**
 * CUENTAS DE CLIENTES · LA SALUD DE UNA CUENTA EN UNA MIRADA — PURO (sin base, sin React, se prueba con `npx tsx lib/cuentas/salud.prueba.ts`).
 *
 * Con las cifras que ya trae /api/cuentas saca:
 *   · un SEMÁFORO por área (Ciclo, Marketing, SEO, Cumplimiento, Remesas): verde, ámbar, rojo, o gris cuando no hay con qué juzgar;
 *   · LO QUE HAY QUE HACER HOY: una lista corta y ordenada (lo que bloquea la venta primero), cada cosa con el área a la que lleva.
 *
 * Las reglas son conservadoras a propósito: rojo es «se está perdiendo venta o dinero ahora», ámbar es «míralo esta semana». Nada se pinta en
 * rojo por falta de datos: sin datos es gris y lo dice.
 */

export type AreaDeSalud = 'ciclo' | 'marketing' | 'seo' | 'cumplimiento' | 'remesas'
export type TonoDeSalud = 'verde' | 'ambar' | 'rojo' | 'gris' | 'azul'

export interface Semaforo {
  area: AreaDeSalud
  tono: TonoDeSalud
  /** Dos o tres palabras: «3 bloquean», «ACoS +32 %», «Sin Ads» */
  texto: string
}

export interface EntradaDeSalud {
  /** AAAA-MM-DD */
  hoy: string
  ciclo: null | { total: number; hechos: number; siguiente: string | null }
  ppc: {
    conectado: boolean
    error: boolean
    gasto: number
    ventas: number
    gastoAnt: number
    ventasAnt: number
    pendientes: number
    recuperable: number
    /** Todas sus cuentas con el motor apagado */
    motorApagado: boolean
    /** Moneda de sus cuentas (ISO), para escribir el dinero recuperable. Por defecto EUR */
    moneda?: string | null
  }
  /** null = no se ha mirado (en la lista el SEO no se calcula: es caro) */
  seo: null | { error: boolean; cuentas: number; productos: number; graves: number; atencion: number; sinBrandAnalytics: boolean; titulosCambiados: number; propuestasPendientes: number }
  /** null = sin conexión revisada */
  cumplimiento: null | { atencionConStock: number; ocultos: number; normativa: number }
  /** null = no se ha mirado */
  remesas: null | { acceso: boolean; error: boolean; abiertas: number; criticas: number; altas: number; faltaAlertas: boolean; totalRemesas: number }
}

export const NOMBRE_AREA: Record<AreaDeSalud, string> = {
  ciclo: 'Ciclo',
  marketing: 'Marketing',
  seo: 'SEO',
  cumplimiento: 'Cumplimiento',
  remesas: 'Remesas',
}

/** «34 €», «120 USD»: sin decimales y con el símbolo solo para el euro */
const dineroCorto = (n: number, moneda?: string | null) => `${Math.round(n).toLocaleString('es-ES')} ${!moneda || moneda === 'EUR' ? '€' : moneda}`
const pct = (p: number) => `${p > 0 ? '+' : ''}${Math.round(p * 100)} %`
const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`

/** Día de la semana de una fecha AAAA-MM-DD: 0 = lunes … 6 = domingo */
export const diaDeLaSemana = (fecha: string) => (new Date(`${fecha}T12:00:00Z`).getUTCDay() + 6) % 7

export function semaforoCiclo(e: EntradaDeSalud): Semaforo {
  const c = e.ciclo
  if (!c) return { area: 'ciclo', tono: 'gris', texto: 'Sin ciclo' }
  const faltan = c.total - c.hechos
  if (faltan <= 0) return { area: 'ciclo', tono: 'verde', texto: 'Semana hecha' }
  // De jueves en adelante, lo que queda de la semana ya corre prisa
  if (diaDeLaSemana(e.hoy) >= 3) return { area: 'ciclo', tono: faltan >= 2 ? 'rojo' : 'ambar', texto: `Faltan ${faltan}` }
  return { area: 'ciclo', tono: 'azul', texto: `${c.hechos} de ${c.total}` }
}

export function semaforoMarketing(e: EntradaDeSalud): Semaforo {
  const p = e.ppc
  if (p.error) return { area: 'marketing', tono: 'rojo', texto: 'Sin leer' }
  if (!p.conectado) return { area: 'marketing', tono: 'gris', texto: 'Sin Ads' }
  if (p.gasto === 0 && p.gastoAnt === 0) return { area: 'marketing', tono: 'gris', texto: 'Sin gasto' }
  // Gasta y no vende nada en 7 días: se tira dinero ahora mismo
  if (p.gasto >= 20 && p.ventas === 0) return { area: 'marketing', tono: 'rojo', texto: 'Gasta sin vender' }
  const acos = p.ventas > 0 ? p.gasto / p.ventas : null
  const acosAnt = p.ventasAnt > 0 ? p.gastoAnt / p.ventasAnt : null
  const subida = acos != null && acosAnt != null && acosAnt > 0 ? (acos - acosAnt) / acosAnt : null
  if (subida != null && subida >= 0.5) return { area: 'marketing', tono: 'rojo', texto: `ACoS ${pct(subida)}` }
  if (subida != null && subida >= 0.2) return { area: 'marketing', tono: 'ambar', texto: `ACoS ${pct(subida)}` }
  if (p.recuperable >= 20) return { area: 'marketing', tono: 'ambar', texto: 'Negativas' }
  if (p.pendientes > 0) return { area: 'marketing', tono: 'ambar', texto: plural(p.pendientes, 'propuesta', 'propuestas') }
  if (p.motorApagado) return { area: 'marketing', tono: 'ambar', texto: 'Motor apagado' }
  return { area: 'marketing', tono: 'verde', texto: subida != null && subida < -0.05 ? `ACoS ${pct(subida)}` : 'Al día' }
}

export function semaforoSeo(e: EntradaDeSalud): Semaforo {
  const s = e.seo
  if (!s) return { area: 'seo', tono: 'gris', texto: 'Al abrir' }
  if (s.error) return { area: 'seo', tono: 'rojo', texto: 'Sin leer' }
  if (s.cuentas === 0) return { area: 'seo', tono: 'gris', texto: 'Sin Seller Central' }
  if (s.productos === 0) return { area: 'seo', tono: 'gris', texto: 'Sin productos' }
  if (s.graves > 0) return { area: 'seo', tono: 'rojo', texto: plural(s.graves, 'urgente', 'urgentes') }
  if (s.titulosCambiados > 0) return { area: 'seo', tono: 'ambar', texto: plural(s.titulosCambiados, 'título cambiado', 'títulos cambiados') }
  if (s.atencion > 0) return { area: 'seo', tono: 'ambar', texto: plural(s.atencion, 'a mirar', 'a mirar') }
  if (s.sinBrandAnalytics) return { area: 'seo', tono: 'ambar', texto: 'Sin Brand Analytics' }
  return { area: 'seo', tono: 'verde', texto: 'Al día' }
}

export function semaforoCumplimiento(e: EntradaDeSalud): Semaforo {
  const c = e.cumplimiento
  if (!c) return { area: 'cumplimiento', tono: 'gris', texto: 'Sin revisar' }
  if (c.atencionConStock > 0) return { area: 'cumplimiento', tono: 'rojo', texto: plural(c.atencionConStock, 'bloquea', 'bloquean') }
  if (c.normativa > 0) return { area: 'cumplimiento', tono: 'ambar', texto: 'Normativa' }
  if (c.ocultos > 0) return { area: 'cumplimiento', tono: 'ambar', texto: plural(c.ocultos, 'oculta', 'ocultas') }
  return { area: 'cumplimiento', tono: 'verde', texto: 'Limpio' }
}

export function semaforoRemesas(e: EntradaDeSalud): Semaforo {
  const r = e.remesas
  if (!r) return { area: 'remesas', tono: 'gris', texto: 'Al abrir' }
  if (!r.acceso) return { area: 'remesas', tono: 'gris', texto: 'Sin acceso' }
  if (r.error) return { area: 'remesas', tono: 'rojo', texto: 'Sin leer' }
  if (r.criticas > 0) return { area: 'remesas', tono: 'rojo', texto: plural(r.criticas, 'crítica', 'críticas') }
  if (r.altas > 0) return { area: 'remesas', tono: 'ambar', texto: plural(r.altas, 'alerta', 'alertas') }
  if (r.totalRemesas === 0 && r.abiertas === 0) return { area: 'remesas', tono: 'gris', texto: 'Sin envíos' }
  if (r.abiertas > 0) return { area: 'remesas', tono: 'azul', texto: plural(r.abiertas, 'en curso', 'en curso') }
  return { area: 'remesas', tono: 'verde', texto: r.faltaAlertas ? 'Sin alertas (267)' : 'Al día' }
}

export function semaforos(e: EntradaDeSalud): Semaforo[] {
  return [semaforoCiclo(e), semaforoMarketing(e), semaforoSeo(e), semaforoCumplimiento(e), semaforoRemesas(e)]
}

const PESO_TONO: Record<TonoDeSalud, number> = { rojo: 3, ambar: 2, azul: 1, verde: 0, gris: 0 }

/** Una cifra para ordenar la cartera: lo que más arde, primero (rojo pesa más que muchos ámbar) */
export function urgencia(xs: readonly Semaforo[]): number {
  return xs.reduce((a, s) => a + (s.tono === 'rojo' ? 100 : PESO_TONO[s.tono]), 0)
}

/** El tono de la cuenta entera: el peor de sus semáforos */
export function tonoGeneral(xs: readonly Semaforo[]): TonoDeSalud {
  if (xs.some((s) => s.tono === 'rojo')) return 'rojo'
  if (xs.some((s) => s.tono === 'ambar')) return 'ambar'
  if (xs.some((s) => s.tono === 'verde' || s.tono === 'azul')) return 'verde'
  return 'gris'
}

export interface CosaDeHoy {
  id: string
  area: AreaDeSalud
  /** 0 = lo primero */
  prioridad: number
  titulo: string
  detalle: string
}

/** Lo que hay que hacer hoy en esta cuenta, en orden: primero lo que bloquea la venta, luego el dinero que se tira y, al final, el ciclo */
export function queHacerHoy(e: EntradaDeSalud): CosaDeHoy[] {
  const xs: CosaDeHoy[] = []
  const c = e.cumplimiento
  if (c && c.atencionConStock > 0)
    xs.push({ id: 'cumplimiento-stock', area: 'cumplimiento', prioridad: 0, titulo: `Desbloquear ${plural(c.atencionConStock, 'ficha con stock', 'fichas con stock')}`, detalle: 'Listings con incidencias que tienen unidades para vender: cada día así son ventas perdidas.' })
  const r = e.remesas
  if (r?.acceso && r.criticas > 0)
    xs.push({ id: 'remesas-criticas', area: 'remesas', prioridad: 0, titulo: `${plural(r.criticas, 'alerta crítica', 'alertas críticas')} de FBA`, detalle: 'Rotura de stock o un envío atascado: mira la alerta y decide el envío.' })
  const p = e.ppc
  if (p.conectado && !p.error && p.gasto >= 20 && p.ventas === 0)
    xs.push({ id: 'ppc-sin-ventas', area: 'marketing', prioridad: 1, titulo: 'La publicidad gasta y no vende', detalle: 'Siete días con gasto y ninguna venta atribuida: revisa campañas y negativas.' })
  if (p.recuperable >= 5 || p.pendientes > 0)
    xs.push({
      id: 'ppc-propuestas',
      area: 'marketing',
      prioridad: p.recuperable >= 20 ? 1 : 2,
      titulo: `Revisar ${plural(p.pendientes, 'propuesta', 'propuestas')} del motor`,
      detalle: p.recuperable >= 5 ? `Aprobando negativas y pausas se dejan de gastar ${dineroCorto(p.recuperable, p.moneda)} que no venden.` : 'Negativas, cosecha a exacta y pujas que el motor ha preparado.',
    })
  const s = e.seo
  if (s && s.graves > 0) xs.push({ id: 'seo-graves', area: 'seo', prioridad: 1, titulo: `${plural(s.graves, 'tarea urgente', 'tareas urgentes')} de SEO`, detalle: 'Lo más grave de «Qué hacer hoy» de SEO: fichas que pierden visibilidad o búsquedas que se caen.' })
  if (s && s.titulosCambiados > 0)
    xs.push({ id: 'seo-vigia', area: 'seo', prioridad: 1, titulo: `${plural(s.titulosCambiados, 'título ha cambiado', 'títulos han cambiado')}`, detalle: 'Amazon puede haberlo reescrito: hay 14 días para aceptarlo o rechazarlo en Review Listing Changes.' })
  if (s && s.propuestasPendientes > 0) xs.push({ id: 'seo-propuestas', area: 'seo', prioridad: 2, titulo: `${plural(s.propuestasPendientes, 'propuesta de ficha', 'propuestas de ficha')} por decidir`, detalle: 'Preparadas con IA y sin aplicar ni descartar.' })
  if (c && c.normativa > 0) xs.push({ id: 'cumplimiento-normativa', area: 'cumplimiento', prioridad: 2, titulo: 'Normativa pendiente', detalle: `${plural(c.normativa, 'ficha', 'fichas')} con requisitos legales (GPSR, etiquetado…) que tienen plazo.` })
  if (r?.acceso && r.altas > 0) xs.push({ id: 'remesas-altas', area: 'remesas', prioridad: 2, titulo: `${plural(r.altas, 'alerta', 'alertas')} de FBA a mirar`, detalle: 'Reponer pronto, envíos incompletos o descuadres con Amazon.' })
  if (e.ciclo?.siguiente) xs.push({ id: 'ciclo-siguiente', area: 'ciclo', prioridad: 3, titulo: e.ciclo.siguiente, detalle: `Siguiente paso del ciclo de esta semana (${e.ciclo.hechos} de ${e.ciclo.total} hechos).` })
  return xs.sort((a, b) => a.prioridad - b.prioridad)
}
