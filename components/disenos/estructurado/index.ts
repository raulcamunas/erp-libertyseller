/**
 * Propuesta de diseño «ESTRUCTURADA POR CONTEXTO».
 *
 * Se monta sola y no depende de nada del ERP salvo lib/types/cold-leads.ts, de donde
 * saca los estados y sus etiquetas para no duplicar el dominio.
 *
 *   import PropuestaEstructurada from '@/components/disenos/estructurado'
 *   <PropuestaEstructurada />
 */

export { default } from './PropuestaEstructurada'
export { default as PropuestaEstructurada } from './PropuestaEstructurada'
export * from './MEMORIA'
export * from './metricas'
export { NEUTROS, MARCA, SEMANTICO, ESTADO_COLOR, TIPOGRAFIA, DENSIDAD } from './tokens'
export type { Tema, Densidad } from './tokens'
export { ESPACIOS, MODULOS, ORDEN_GRUPOS } from './navegacion'
export type { EspacioId, Espacio, Modulo } from './navegacion'
