/**
 * Lo común de la pestaña «Flujo»: colores por papel de campaña y por estado, nombres cortos y la selección (flecha o campaña) que abre el panel lateral.
 */
import { COLOR_ESTADO, type TonoEstado } from '@/lib/estilo/denso'
import type { EstadoDeTermino, FlechaDeFlujo, Flujo, NodoDeFlujo } from '@/lib/ads/flujo-calculo'
import { rolCorto } from '@/lib/ads/flujo-calculo'

export type Seleccion = { tipo: 'flecha'; id: string } | { tipo: 'nodo'; id: string }

/** Un color por papel, el mismo en el diagrama, el diario y los filtros */
export const TONO_DE_ROL: Record<string, TonoEstado> = {
  'AUTO RADAR': 'cian',
  'MANUAL AMPLIA': 'azul',
  'MANUAL EXACTA / DOMINIO': 'violeta',
  'MANUAL EXACTA / ESTABILIDAD': 'violeta',
  'ATAQUE ASIN': 'magenta',
  NEGATIVIZADAS: 'ambar',
}

export const colorDeRol = (rol: string | null | undefined): string => COLOR_ESTADO[TONO_DE_ROL[rol ?? ''] ?? 'gris']

/** Color de cada tipo de flecha (lo hecho); lo deshecho va en gris y lo fallido en rojo */
export const COLOR_DE_FLECHA = { cosecha: COLOR_ESTADO.verde, negativa: COLOR_ESTADO.ambar, deshecho: COLOR_ESTADO.gris, fallido: COLOR_ESTADO.rojo } as const

export const ESTADO_DE_TERMINO: Record<EstadoDeTermino, { texto: string; tono: TonoEstado }> = {
  hecho: { texto: 'Hecho', tono: 'verde' },
  deshecho: { texto: 'Deshecho', tono: 'gris' },
  fallido: { texto: 'Falló', tono: 'rojo' },
  pendiente: { texto: 'Propuesto', tono: 'azul' },
  caducada: { texto: 'Caducado', tono: 'ambar' },
  descartada: { texto: 'Descartado', tono: 'gris' },
  ensayada: { texto: 'Ensayo', tono: 'cian' },
}

export const VEREDICTO: Record<string, { texto: string; tono: TonoEstado }> = {
  mejoro: { texto: 'Resultado: mejoró', tono: 'verde' },
  empeoro: { texto: 'Resultado: empeoró', tono: 'rojo' },
  neutro: { texto: 'Resultado: sin cambio claro', tono: 'gris' },
  sin_muestra: { texto: 'Resultado: sin muestra suficiente', tono: 'gris' },
  mezclado: { texto: 'Resultado: mezclado', tono: 'ambar' },
}

/** «AUTO RADAR», «EXACTA DOMINIO», «Negativizadas»… */
export function nombreDeNodo(n: NodoDeFlujo | undefined): string {
  if (!n) return '¿?'
  if (n.rol === 'NEGATIVIZADAS') return 'Negativizadas'
  return rolCorto(n.rol)
}

/** «AUTO RADAR → EXACTA DOMINIO» o «AUTO RADAR → Negativizadas» */
export function nombreDeFlecha(f: FlechaDeFlujo, flujo: Flujo): string {
  const de = flujo.nodos.find((n) => n.id === f.desde)
  const a = flujo.nodos.find((n) => n.id === f.hacia)
  return `${nombreDeNodo(de)} → ${nombreDeNodo(a)}`
}

/** «3 hechos · 5 propuestos · 1 deshecho» (solo lo que hay) */
export function cuentasDeFlecha(f: Pick<FlechaDeFlujo, 'hechos' | 'propuestos' | 'deshechos' | 'fallidos'> & { sinAplicar?: number }): string {
  const p: string[] = []
  if (f.hechos) p.push(`${f.hechos} ${f.hechos === 1 ? 'hecho' : 'hechos'}`)
  if (f.propuestos) p.push(`${f.propuestos} ${f.propuestos === 1 ? 'propuesto' : 'propuestos'}`)
  if (f.sinAplicar) p.push(`${f.sinAplicar} sin aplicar (caducados o descartados)`)
  if (f.deshechos) p.push(`${f.deshechos} ${f.deshechos === 1 ? 'deshecho' : 'deshechos'}`)
  if (f.fallidos) p.push(`${f.fallidos} ${f.fallidos === 1 ? 'fallido' : 'fallidos'}`)
  return p.join(' · ')
}

/** La fecha de un término, «18 nov · 13:08» en hora de España */
export function fechaCorta(iso: string): string {
  return new Date(iso).toLocaleString('es-ES', { timeZone: 'Europe/Madrid', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}
