/**
 * EL PLAN DE PROPUESTA DE UN CLIENTE: LO QUE SE LE VA A PROPONER, ANTES DE QUE SEA UN PDF.
 * =========================================================================================
 * Vive en `crm_clients.propuesta_plan` (JSONB, migración 258) y sigue las páginas de la propuesta comercial de Liberty Seller (guía `propuesta-amazon-liberty-seller`):
 *
 *   portada            los servicios que se ofrecen (3 o 4) y el enfoque
 *   01 diagnóstico     los dolores del cliente (salen del análisis de la reunión) y tres datos clave
 *   02 plan            FASE 1 · SETUP, meses 1–3 (4 pasos) y FASE 2 · CRECIMIENTO, mes 4 en adelante (4 pasos)
 *   04 económica       setup, cuota base y % variable sobre el excedente
 *   05 siguiente paso  los riesgos a vigilar y los próximos pasos
 *
 * LOS IMPORTES NO VIVEN AQUÍ, salvo el %: el coste del setup y la cuota base ya tienen sus columnas en la ficha (`setup_budget`, `maintenance_budget`) y la pantalla de
 * presupuestos las usa. Duplicarlas en el JSON sería tener dos verdades. Aquí solo va el % variable (3 % por defecto, negociable), que no tiene columna.
 *
 * Esto es la BASE de lo que vendrá: generar la propuesta sola desde este plan y un editor visual para sacarla en PDF. Por eso la forma es la de las páginas y no la de una
 * pantalla.
 *
 * Es puro y lo usa también el navegador (la ficha edita el plan directamente; RLS decide quién puede). No importa nada del servidor.
 */

import type { AnalisisDeReunion } from './gemini/tipos'

export interface PasoDelPlan {
  titulo: string
  detalle: string
}

export interface ServicioDelPlan {
  nombre: string
  motivo: string
  prioridad: 'alta' | 'media' | 'baja'
}

export interface DatoClave {
  valor: string
  etiqueta: string
}

export interface PropuestaPlan {
  version: 1
  /** 'ia': se copió de un análisis de reunión · 'manual': se escribió a mano · null: aún no hay plan */
  origen: 'ia' | 'manual' | null
  /** De qué nota de reunión sale la sugerencia (para volver a ella) */
  nota_id: string | null
  enfoque: string
  servicios: ServicioDelPlan[]
  datos_clave: DatoClave[]
  fase_setup: PasoDelPlan[]
  fase_crecimiento: PasoDelPlan[]
  riesgos: string[]
  /** % variable sobre el excedente de facturación; la guía lo deja en 3 % salvo que se negocie. null = sin decidir */
  variable_pct: number | null
  /** Lo que haga falta recordar de esta propuesta que no cabe en lo de arriba */
  notas: string
  /** Última vez que una persona tocó el plan (ISO); null si nunca */
  editado_en: string | null
}

export const VARIABLE_POR_DEFECTO = 3

export const LIMITES_DEL_PLAN = { servicios: 6, pasos: 6, datos: 3, riesgos: 6, enfoque: 900, texto: 400, notas: 3000 } as const

export function planVacio(): PropuestaPlan {
  return { version: 1, origen: null, nota_id: null, enfoque: '', servicios: [], datos_clave: [], fase_setup: [], fase_crecimiento: [], riesgos: [], variable_pct: null, notas: '', editado_en: null }
}

const limpio = (s: unknown, tope: number): string => {
  if (typeof s !== 'string') return ''
  const t = s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/[ \t]{2,}/g, ' ').trim()
  return t.length > tope ? `${t.slice(0, tope - 1).trimEnd()}…` : t
}
const objetos = (x: unknown, max: number): Array<Record<string, unknown>> =>
  Array.isArray(x) ? x.filter((e): e is Record<string, unknown> => !!e && typeof e === 'object' && !Array.isArray(e)).slice(0, max) : []

const PRIORIDADES = ['alta', 'media', 'baja'] as const

/**
 * Lo guardado (o lo que manda el navegador) -> un plan válido. Tolera cualquier cosa: `{}` (el valor por defecto de la columna), un plan de una versión futura, campos que
 * faltan o con otro tipo. Nunca lanza y siempre acota, porque lo que llega del navegador no es de fiar.
 */
export function leerPlan(x: unknown): PropuestaPlan {
  const base = planVacio()
  if (!x || typeof x !== 'object' || Array.isArray(x)) return base
  const r = x as Record<string, unknown>

  const pasos = (v: unknown): PasoDelPlan[] =>
    objetos(v, LIMITES_DEL_PLAN.pasos)
      .map((e) => ({ titulo: limpio(e.titulo, 120), detalle: limpio(e.detalle, LIMITES_DEL_PLAN.texto) }))
      // Un paso se puede dejar a medias mientras se escribe: vale con que tenga título o detalle
      .filter((p) => p.titulo !== '' || p.detalle !== '')

  const variable = typeof r.variable_pct === 'number' && Number.isFinite(r.variable_pct) && r.variable_pct >= 0 && r.variable_pct <= 100 ? Math.round(r.variable_pct * 100) / 100 : null
  const editado = typeof r.editado_en === 'string' && Number.isFinite(Date.parse(r.editado_en)) ? r.editado_en : null

  return {
    version: 1,
    origen: r.origen === 'ia' || r.origen === 'manual' ? r.origen : null,
    nota_id: typeof r.nota_id === 'string' && r.nota_id.length <= 64 ? r.nota_id : null,
    enfoque: limpio(r.enfoque, LIMITES_DEL_PLAN.enfoque),
    servicios: objetos(r.servicios, LIMITES_DEL_PLAN.servicios)
      .map((e) => ({ nombre: limpio(e.nombre, 120), motivo: limpio(e.motivo, LIMITES_DEL_PLAN.texto), prioridad: PRIORIDADES.find((p) => p === e.prioridad) ?? 'media' }))
      .filter((s) => s.nombre !== ''),
    datos_clave: objetos(r.datos_clave, LIMITES_DEL_PLAN.datos)
      .map((e) => ({ valor: limpio(e.valor, 60), etiqueta: limpio(e.etiqueta, 100) }))
      .filter((d) => d.valor !== '' || d.etiqueta !== ''),
    fase_setup: pasos(r.fase_setup),
    fase_crecimiento: pasos(r.fase_crecimiento),
    riesgos: Array.isArray(r.riesgos) ? r.riesgos.map((t) => limpio(t, LIMITES_DEL_PLAN.texto)).filter(Boolean).slice(0, LIMITES_DEL_PLAN.riesgos) : [],
    variable_pct: variable,
    notas: limpio(r.notas, LIMITES_DEL_PLAN.notas),
    editado_en: editado,
  }
}

/** El plan que sugiere el análisis de una reunión: las páginas de la propuesta rellenadas con lo hablado. Sin importes y sin % (los pone una persona) */
export function planDesdeAnalisis(analisis: AnalisisDeReunion, notaId: string | null): PropuestaPlan {
  return leerPlan({
    origen: 'ia',
    nota_id: notaId,
    enfoque: analisis.propuesta.enfoque,
    servicios: analisis.propuesta.servicios,
    datos_clave: analisis.propuesta.datos_clave,
    fase_setup: analisis.propuesta.fase_setup,
    fase_crecimiento: analisis.propuesta.fase_crecimiento,
    riesgos: analisis.propuesta.riesgos,
  })
}

export function planEstaVacio(plan: PropuestaPlan): boolean {
  return (
    plan.enfoque === '' &&
    plan.servicios.length === 0 &&
    plan.datos_clave.length === 0 &&
    plan.fase_setup.length === 0 &&
    plan.fase_crecimiento.length === 0 &&
    plan.riesgos.length === 0 &&
    plan.notas === '' &&
    plan.variable_pct === null
  )
}

export interface AvanceDeLaPropuesta {
  hechas: string[]
  faltan: string[]
  /** De 0 a 1 */
  avance: number
}

/**
 * Qué le falta a la propuesta para poder generarse: las seis cosas que pide la guía. El coste del setup y la cuota base vienen de las columnas de la ficha; el % variable, del
 * plan (o el 3 % de siempre si nadie lo tocó: no se pide, es el valor de partida).
 */
export function avanceDeLaPropuesta(plan: PropuestaPlan, presupuestos: { setup: number | null; cuota: number | null }): AvanceDeLaPropuesta {
  const piezas: Array<[string, boolean]> = [
    ['Enfoque', plan.enfoque !== ''],
    ['Servicios', plan.servicios.length > 0],
    ['Datos clave', plan.datos_clave.length > 0],
    ['Fase 1 · Setup', plan.fase_setup.length > 0],
    ['Fase 2 · Crecimiento', plan.fase_crecimiento.length > 0],
    ['Importes', (presupuestos.setup ?? 0) > 0 && (presupuestos.cuota ?? 0) > 0],
  ]
  const hechas = piezas.filter(([, ok]) => ok).map(([n]) => n)
  const faltan = piezas.filter(([, ok]) => !ok).map(([n]) => n)
  return { hechas, faltan, avance: hechas.length / piezas.length }
}
