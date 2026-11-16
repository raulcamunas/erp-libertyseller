import { haceCuanto } from '@/components/ui-ls/utilidades'

/**
 * LAS FECHAS DE CORREO, EN UN SOLO SITIO.
 * =======================================
 * PURO (sin React ni el navegador). Es la ÚNICA fuente de fechas de la pantalla de Correo: la fila de la lista, la fecha completa de un mensaje
 * y el «hace cuánto» de la barra, del resumen del equipo, de los permisos y de los ajustes (sustituye a las cuatro copias de `hace()` que
 * había, cada una con date-fns). Se comprueba con fechas.prueba.ts.
 *
 *   fechaDeLista  «10:42», «ayer», «lun», «21 oct», «21/10/25» (en hora de Madrid; vive en formato.ts)
 *   fechaCompleta «21 oct 2026, 10:15» (en hora de Madrid; vive en formato.ts)
 *   hace          «ahora mismo», «hace 5 min», «hace 3 h», «ayer», «hace 4 días», «21 oct» (el `haceCuanto` del kit)
 */

export { fechaCompleta, fechaDeLista } from './formato'

/**
 * Hace cuánto pasó algo. Una fecha que viene un poco del futuro (el reloj del servidor de correo o el de quien mira van adelantados) cuenta
 * como «ahora mismo», igual que hacían las copias de antes, y no como una fecha. Lo que no es una fecha devuelve '' (no «—»): así se puede
 * escribir `Actualizado ${hace(x)}` solo cuando hay algo.
 */
export function hace(iso: string | null | undefined, ahora: number = Date.now()): string {
  if (!iso) return ''
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  return haceCuanto(Math.min(t, ahora), ahora)
}
