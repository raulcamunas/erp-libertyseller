import type { TonoEstado } from '@/lib/estilo/denso'
import { diaMadrid, horaMadrid, indiceDeSemana, mesDe, sumarDias } from '@/lib/rendimiento/dia'
import { duracionCorta, esContestador, estaContestada } from '@/lib/rendimiento/metricas'
import { telefonoLegible } from '@/lib/rendimiento/telefonos'
import type { ColdLeadNote } from '@/lib/types/cold-leads'

/**
 * EL HISTORIAL DE UN LEAD: LLAMADAS DE RINKEL Y APUNTES DEL COMERCIAL, EN UNA SOLA LÍNEA DE TIEMPO.
 * ==================================================================================================
 * PURO. Se comprueba con historial.prueba.ts. Lo pinta components/cold-calling/HistorialDelLead.tsx.
 *
 * Una llamada NO se copia a las notas: vive en `rinkel_llamadas` (migración 234) y aquí se mezcla con las notas por
 * fecha. Así el comercial no apunta nada de lo que ya sabe Rinkel —cuándo se llamó, cuánto duró, si contestaron, la
 * grabación—, y lo que escribe a mano es lo que Rinkel no puede saber: qué se dijo, qué se acordó.
 *
 * «Contestada» es la misma regla que en «Mi rendimiento» (metricas.ts): ANSWERED y diez segundos o más. Por debajo
 * es un contestador automático y se dice con esa palabra, no «contestada».
 */

export interface LlamadaDelHistorial {
  id: string
  user_id: string
  fecha: string
  direccion: string
  duracion_s: number
  estado: string
  numero: string | null
  numero_anonimo: boolean
  grabacion_id: string | null
  grabacion_hasta: string | null
}

export type ElementoDelHistorial =
  | { tipo: 'nota'; id: string; cuando: string; nota: ColdLeadNote }
  | { tipo: 'llamada'; id: string; cuando: string; llamada: LlamadaDelHistorial }

/** De la más reciente a la más antigua. A la misma hora, la llamada antes que el apunte que se escribió sobre ella */
export function fusionarHistorial(notas: readonly ColdLeadNote[], llamadas: readonly LlamadaDelHistorial[]): ElementoDelHistorial[] {
  const elementos: ElementoDelHistorial[] = [
    ...notas.map((nota) => ({ tipo: 'nota' as const, id: nota.id, cuando: nota.occurred_at, nota })),
    ...llamadas.map((llamada) => ({ tipo: 'llamada' as const, id: llamada.id, cuando: llamada.fecha, llamada })),
  ]
  return elementos.sort((a, b) => {
    const dt = Date.parse(b.cuando) - Date.parse(a.cuando)
    if (dt !== 0) return dt
    if (a.tipo !== b.tipo) return a.tipo === 'llamada' ? -1 : 1
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
}

/* ------------------------------------------------------------------ */
/* Cómo se cuenta una llamada                                          */
/* ------------------------------------------------------------------ */

export type IconoDeLlamada = 'saliente' | 'entrante' | 'perdida' | 'contestador' | 'sin_respuesta'

export interface DescripcionDeLlamada {
  icono: IconoDeLlamada
  tono: TonoEstado
  /** «Llamada saliente», «Llamada entrante» */
  titulo: string
  /** «contestada · 3:12», «sin respuesta», «contestador · 0:08», «perdida» */
  resultado: string
  /** El teléfono tal como se lee: «+34 910 21 04 65», o «Número oculto» */
  telefono: string
  contestada: boolean
}

/**
 * Qué pasó en una llamada, con el color y el icono de lo que pasó. El color nunca va solo: siempre lleva su palabra.
 *   verde: la contestó una persona (saliente) · cian: te llamaron y contestaste · gris: nadie o un contestador · rojo: perdida
 */
export function describirLlamada(l: Pick<LlamadaDelHistorial, 'direccion' | 'estado' | 'duracion_s' | 'numero' | 'numero_anonimo'>): DescripcionDeLlamada {
  const entrante = l.direccion === 'inbound'
  const contestada = estaContestada(l)
  const telefono = l.numero ? telefonoLegible(l.numero) : l.numero_anonimo ? 'Número oculto' : 'Sin número'
  const titulo = entrante ? 'Llamada entrante' : 'Llamada saliente'

  if (contestada) {
    return { icono: entrante ? 'entrante' : 'saliente', tono: entrante ? 'cian' : 'verde', titulo, resultado: `contestada · ${duracionCorta(l.duracion_s)}`, telefono, contestada }
  }
  if (esContestador(l)) {
    // Rinkel la dio por contestada pero duró menos de diez segundos: un contestador automático. Si es entrante, para
    // quien llamaba fue una llamada perdida
    return entrante
      ? { icono: 'perdida', tono: 'rojo', titulo, resultado: 'perdida', telefono, contestada }
      : { icono: 'contestador', tono: 'gris', titulo, resultado: `contestador · ${duracionCorta(l.duracion_s)}`, telefono, contestada }
  }
  return entrante
    ? { icono: 'perdida', tono: 'rojo', titulo, resultado: 'perdida', telefono, contestada }
    : { icono: 'sin_respuesta', tono: 'gris', titulo, resultado: 'sin respuesta', telefono, contestada }
}

/** ¿Se puede todavía escuchar? Rinkel guarda las grabaciones 90 días (`grabacion_hasta`) */
export function grabacionDisponible(l: Pick<LlamadaDelHistorial, 'grabacion_id' | 'grabacion_hasta'>, ahora: number = Date.now()): boolean {
  if (l.grabacion_id === null) return false
  return l.grabacion_hasta === null || Date.parse(l.grabacion_hasta) > ahora
}

/* ------------------------------------------------------------------ */
/* Cuándo pasó                                                         */
/* ------------------------------------------------------------------ */

const DIAS_CORTOS = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom']
const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

/**
 * «hoy 11:42», «ayer 17:20», «lun 19 oct · 10:05» y, si es de otro año, «19 oct 2025 · 10:05». Los días son los de
 * MADRID (ver lib/rendimiento/dia.ts): la llamada de las 00:30 del 22 es del 22 aunque en UTC sea la del 21.
 */
export function cuandoEs(instante: string | number | Date, ahora: Date = new Date()): string {
  const dia = diaMadrid(instante)
  const hoy = diaMadrid(ahora)
  const hora = horaMadrid(instante)
  if (dia === hoy) return `hoy ${hora}`
  if (dia === sumarDias(hoy, -1)) return `ayer ${hora}`
  const { anio, mes } = mesDe(dia)
  const numero = Number(dia.slice(8))
  if (anio !== mesDe(hoy).anio) return `${numero} ${MESES_CORTOS[mes - 1]} ${anio} · ${hora}`
  return `${DIAS_CORTOS[indiceDeSemana(dia)]} ${numero} ${MESES_CORTOS[mes - 1]} · ${hora}`
}
