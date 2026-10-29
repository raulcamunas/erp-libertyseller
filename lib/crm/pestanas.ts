/**
 * LAS TRES PESTAÑAS DEL CRM: CITA AGENDADA, EN SEGUIMIENTO Y CERRADO — PURO.
 * ==========================================================================
 * El CRM tenía una sola lista con los siete estados mezclados y unos botones con el nombre de cada fase. Ahora una barra de tres pestañas separa lo que hay que hacer en cada
 * momento con un lead, y cada pestaña enseña lo que importa de él en ESE momento:
 *
 *   · CITA AGENDADA  (fase `nuevo`)      el lead tiene cita en la agenda o ya la ha tenido. Lo que se decide aquí es una cosa: SEGUIR con él (pasa a «En seguimiento») o DESCARTARLO
 *                                        (se da por perdido, con un motivo). Se ve cómo salió la cita (cualificada, no cualificada, no asistió…) y se sugiere lo más probable, sin imponerlo.
 *   · EN SEGUIMIENTO (`seguimiento`, `propuesta_enviada`, `revision_propuesta`, `negociacion`)
 *                                        el proceso de cada lead hasta decidirse: en qué paso está, desde cuándo, cuándo fue el último contacto y qué toca hacer.
 *   · CERRADO        (`ganado`, `perdido`)    lo decidido: los ganados (ya son clientes) y los perdidos (descartados o que no siguieron), con un selector para verlos por separado.
 *
 * NO SE TOCA LA BASE: las pestañas son una forma de ver y mover los MISMOS siete valores de `crm_clients.stage` de siempre (lib/types/crm.ts). Por eso una ficha que se mueve aquí
 * se ve igual en la línea de fases de su ficha, en el historial y en los informes. Descartar es pasar a `perdido` y apuntar el motivo como una toma de contacto de tipo nota
 * («Descartado: …»): queda en la Actividad del cliente sin columnas nuevas.
 *
 * Es puro: no toca la base ni el navegador.
 */

import { diaDeMadrid } from '@/lib/correo/secuencias/fechas'
import type { CrmClientWithDetails, CrmStage } from '@/lib/types/crm'

/* ------------------------------------------------------------------ */
/* Las pestañas                                                        */
/* ------------------------------------------------------------------ */

export type PestanaDelCrm = 'cita' | 'seguimiento' | 'cerrado'

export interface DefinicionDePestana {
  id: PestanaDelCrm
  nombre: string
  /** Las fases (`crm_clients.stage`) que caen en ella */
  fases: readonly CrmStage[]
  /** Una frase para el título al pasar el ratón */
  ayuda: string
}

export const PESTANAS_DEL_CRM: readonly DefinicionDePestana[] = [
  { id: 'cita', nombre: 'Cita agendada', fases: ['nuevo'], ayuda: 'Leads con la cita en la agenda o recién celebrada: aquí se decide si se sigue con ellos o se descartan' },
  {
    id: 'seguimiento',
    nombre: 'En seguimiento',
    fases: ['seguimiento', 'propuesta_enviada', 'revision_propuesta', 'negociacion'],
    ayuda: 'Leads con los que se sigue trabajando: el proceso de cada uno, paso a paso, hasta cerrarlo o perderlo',
  },
  { id: 'cerrado', nombre: 'Cerrado', fases: ['ganado', 'perdido'], ayuda: 'Los que ya se han decidido: los ganados (ya son clientes) y los perdidos o descartados' },
]

export const pestanaDe = (stage: CrmStage): PestanaDelCrm => PESTANAS_DEL_CRM.find((p) => p.fases.includes(stage))?.id ?? 'cita'

export const FASES_DEL_SEGUIMIENTO: readonly CrmStage[] = ['seguimiento', 'propuesta_enviada', 'revision_propuesta', 'negociacion']

export function contarPorPestana(clientes: readonly { stage: CrmStage }[]): Record<PestanaDelCrm, number> {
  const salida: Record<PestanaDelCrm, number> = { cita: 0, seguimiento: 0, cerrado: 0 }
  for (const c of clientes) salida[pestanaDe(c.stage)]++
  return salida
}

/* ------------------------------------------------------------------ */
/* Qué se puede hacer con un lead y a dónde va                         */
/* ------------------------------------------------------------------ */

export type AccionDeFase = 'seguir' | 'descartar' | 'avanzar' | 'cerrar' | 'perder' | 'reabrir'

/** La fase siguiente del proceso (sin contar cerrar ni perder), o null si ya no hay más pasos antes de cerrar */
export function siguientePaso(stage: CrmStage): CrmStage | null {
  const i = FASES_DEL_SEGUIMIENTO.indexOf(stage)
  return i >= 0 && i < FASES_DEL_SEGUIMIENTO.length - 1 ? FASES_DEL_SEGUIMIENTO[i + 1] : null
}

/** Lo que se puede hacer con un lead en esta fase. Sin permiso para mover, nada */
export function accionesDisponibles(stage: CrmStage, puedeMover: boolean): AccionDeFase[] {
  if (!puedeMover) return []
  if (stage === 'nuevo') return ['seguir', 'descartar']
  if (stage === 'ganado' || stage === 'perdido') return ['reabrir']
  const acciones: AccionDeFase[] = []
  if (siguientePaso(stage)) acciones.push('avanzar')
  acciones.push('cerrar', 'perder')
  return acciones
}

/** La fase a la que lleva una acción desde la fase en la que está; null si esa acción no existe desde ahí */
export function destinoDe(accion: AccionDeFase, stage: CrmStage): CrmStage | null {
  if (!accionesDisponibles(stage, true).includes(accion)) return null
  switch (accion) {
    case 'seguir':
    case 'reabrir':
      return 'seguimiento'
    case 'avanzar':
      return siguientePaso(stage)
    case 'cerrar':
      return 'ganado'
    case 'descartar':
    case 'perder':
      return 'perdido'
  }
}

/** Descartar y perder piden un motivo (opcional): son las dos salidas hacia «perdido» */
export const esAccionDeDescarte = (a: AccionDeFase): boolean => a === 'descartar' || a === 'perder'

/* ------------------------------------------------------------------ */
/* El motivo de descartar                                              */
/* ------------------------------------------------------------------ */

export const MOTIVOS_DE_DESCARTE: readonly string[] = ['No cualificado', 'No asistió a la cita', 'No le interesa', 'Sin presupuesto', 'Ya trabaja con otra agencia', 'No contesta', 'Otro']

export const PREFIJO_DE_DESCARTE = 'Descartado: '

/** La nota que se apunta en la Actividad del cliente al descartarlo. Sin motivo no hay nota */
export function notaDeDescarte(motivo: string | null | undefined, detalle?: string | null): string | null {
  const m = (motivo ?? '').trim()
  if (!m) return null
  const d = (detalle ?? '').trim()
  return `${PREFIJO_DE_DESCARTE}${m}${d ? ` — ${d}` : ''}`.slice(0, 500)
}

/** El motivo de una nota de descarte («Descartado: No le interesa — dice que ya tiene gestor» → «No le interesa — dice que ya tiene gestor»); null si la nota no es de un descarte */
export function motivoDeDescarte(cuerpo: string | null | undefined): string | null {
  const t = (cuerpo ?? '').trim()
  return t.startsWith(PREFIJO_DE_DESCARTE) ? t.slice(PREFIJO_DE_DESCARTE.length).trim() || null : null
}

/** Lo que dice el aviso al hacer una acción, con la fase a la que se pasa */
export function avisoDeAccion(accion: AccionDeFase, destino: CrmStage, etiquetaDeDestino: string): string {
  if (accion === 'descartar' || accion === 'perder') return 'Lead descartado'
  if (accion === 'cerrar') return 'Cliente cerrado'
  if (accion === 'reabrir') return `Reabierto: pasa a «${etiquetaDeDestino}»`
  return destino === 'seguimiento' ? 'Pasa a «En seguimiento»' : `Pasa a «${etiquetaDeDestino}»`
}

/* ------------------------------------------------------------------ */
/* CITA AGENDADA: cómo salió la cita                                   */
/* ------------------------------------------------------------------ */

export type SituacionDeLaCita = 'por_celebrar' | 'sin_resultado' | 'cualificada' | 'no_cualificada' | 'no_asistio' | 'cancelada' | 'sin_cita'

export const ETIQUETA_DE_SITUACION: Record<SituacionDeLaCita, string> = {
  por_celebrar: 'Por celebrar',
  sin_resultado: 'Sin resultado',
  cualificada: 'Cualificada',
  no_cualificada: 'No cualificada',
  no_asistio: 'No asistió',
  cancelada: 'Cancelada',
  sin_cita: 'Sin cita',
}

/** Una cita dura una hora (la impone el servidor al agendar): hasta que acaba cuenta como «por celebrar» */
const DURACION_DE_LA_CITA_MS = 3_600_000

export function situacionDeLaCita(c: Pick<CrmClientWithDetails, 'appointment'>, ahora: number): SituacionDeLaCita {
  const a = c.appointment
  if (!a) return 'sin_cita'
  switch (a.status) {
    case 'qualified':
      return 'cualificada'
    case 'not_qualified':
      return 'no_cualificada'
    case 'no_show':
      return 'no_asistio'
    case 'cancelled':
      return 'cancelada'
    default: {
      // agendada, confirmada o reagendada: depende de si ya pasó la hora
      const inicio = Date.parse(a.start_time)
      return Number.isFinite(inicio) && inicio + DURACION_DE_LA_CITA_MS > ahora ? 'por_celebrar' : 'sin_resultado'
    }
  }
}

/** Lo más probable según cómo salió la cita. Es una SUGERENCIA para destacar un botón: la decisión es de la persona. null = todavía no se puede saber */
export function sugerenciaDeLaCita(situacion: SituacionDeLaCita): 'seguir' | 'descartar' | null {
  if (situacion === 'cualificada') return 'seguir'
  if (situacion === 'no_cualificada' || situacion === 'no_asistio' || situacion === 'cancelada') return 'descartar'
  return null
}

export type FiltroDeCita = 'todas' | SituacionDeLaCita

/** Las fichas de los chips de la pestaña, en este orden. «Sin cita» y «Cancelada» se juntan en «Otras» para no llenar la barra */
export const FILTROS_DE_CITA: ReadonlyArray<{ id: FiltroDeCita | 'otras'; nombre: string }> = [
  { id: 'todas', nombre: 'Todas' },
  { id: 'por_celebrar', nombre: 'Por celebrar' },
  { id: 'sin_resultado', nombre: 'Sin resultado' },
  { id: 'cualificada', nombre: 'Cualificadas' },
  { id: 'no_cualificada', nombre: 'No cualificadas' },
  { id: 'no_asistio', nombre: 'No asistieron' },
  { id: 'otras', nombre: 'Otras' },
]

export function cuentaDeCitas(clientes: readonly CrmClientWithDetails[], ahora: number): Record<FiltroDeCita | 'otras', number> {
  const n: Record<FiltroDeCita | 'otras', number> = { todas: 0, por_celebrar: 0, sin_resultado: 0, cualificada: 0, no_cualificada: 0, no_asistio: 0, cancelada: 0, sin_cita: 0, otras: 0 }
  for (const c of clientes) {
    if (c.stage !== 'nuevo') continue
    const s = situacionDeLaCita(c, ahora)
    n.todas++
    n[s]++
    if (s === 'cancelada' || s === 'sin_cita') n.otras++
  }
  return n
}

export function coincideConElFiltroDeCita(c: CrmClientWithDetails, filtro: FiltroDeCita | 'otras', ahora: number): boolean {
  if (filtro === 'todas') return true
  const s = situacionDeLaCita(c, ahora)
  return filtro === 'otras' ? s === 'cancelada' || s === 'sin_cita' : s === filtro
}

const instanteDeLaCita = (c: CrmClientWithDetails): number => {
  const t = Date.parse(c.appointment?.start_time ?? c.created_at)
  return Number.isFinite(t) ? t : 0
}

/** Lo que está por celebrar primero (la más próxima arriba); detrás, lo ya celebrado con la más reciente arriba */
export function ordenarCitas(clientes: readonly CrmClientWithDetails[], ahora: number): CrmClientWithDetails[] {
  const por = (c: CrmClientWithDetails) => situacionDeLaCita(c, ahora) === 'por_celebrar'
  return [...clientes].sort((a, b) => {
    const pa = por(a)
    const pb = por(b)
    if (pa !== pb) return pa ? -1 : 1
    return pa ? instanteDeLaCita(a) - instanteDeLaCita(b) : instanteDeLaCita(b) - instanteDeLaCita(a)
  })
}

/* ------------------------------------------------------------------ */
/* EN SEGUIMIENTO: el proceso de cada lead                              */
/* ------------------------------------------------------------------ */

/** Lo justo de una toma de contacto para la lista (el cuerpo no viaja: solo la fecha y el tipo) */
export interface ContactoLigero {
  client_id: string
  kind: string
  occurred_at: string
}

export interface ResumenDeContactos {
  total: number
  /** El más reciente: tipo y fecha */
  ultimo: { kind: string; en: string } | null
}

/** Cuántos contactos tiene cada cliente y cuál fue el último. Los de tipo `nota` no cuentan como contacto con el lead: son notas internas (y las de descartar) */
export function resumenDeContactos(contactos: readonly ContactoLigero[]): Map<string, ResumenDeContactos> {
  const salida = new Map<string, ResumenDeContactos>()
  for (const c of contactos) {
    if (c.kind === 'nota') continue
    const t = Date.parse(c.occurred_at)
    if (!Number.isFinite(t)) continue
    const actual = salida.get(c.client_id) ?? { total: 0, ultimo: null }
    actual.total++
    if (!actual.ultimo || t > Date.parse(actual.ultimo.en)) actual.ultimo = { kind: c.kind, en: c.occurred_at }
    salida.set(c.client_id, actual)
  }
  return salida
}

/** Días enteros desde una fecha hasta ahora (nunca negativos); null si no hay fecha */
export function diasDesde(iso: string | null | undefined, ahora: number): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return null
  return Math.max(0, Math.floor((ahora - t) / 86_400_000))
}

export type OrdenDeSeguimiento = 'accion' | 'avance' | 'contacto' | 'reunion'

export const ORDENES_DE_SEGUIMIENTO: ReadonlyArray<{ id: OrdenDeSeguimiento; nombre: string }> = [
  { id: 'accion', nombre: 'Próxima acción' },
  { id: 'avance', nombre: 'Más avanzados' },
  { id: 'contacto', nombre: 'Sin contactar hace más' },
  { id: 'reunion', nombre: 'Reunión más reciente' },
]

/**
 * Ordena los leads en seguimiento.
 *   · accion    lo vencido arriba, luego lo que vence antes, y los que no tienen acción apuntada al final
 *   · avance    los más cerca de cerrar primero (negociación, revisión, propuesta, seguimiento)
 *   · contacto  los que llevan más tiempo sin contactar primero; los que nunca se han contactado, los primeros de todos
 *   · reunion   la reunión más reciente arriba (como siempre)
 */
export function ordenarSeguimiento(clientes: readonly CrmClientWithDetails[], orden: OrdenDeSeguimiento, contactos: ReadonlyMap<string, ResumenDeContactos>, ahora: number): CrmClientWithDetails[] {
  const copia = [...clientes]
  const reunion = (c: CrmClientWithDetails) => instanteDeLaCita(c)
  if (orden === 'avance') return copia.sort((a, b) => FASES_DEL_SEGUIMIENTO.indexOf(b.stage) - FASES_DEL_SEGUIMIENTO.indexOf(a.stage) || reunion(b) - reunion(a))
  if (orden === 'contacto') {
    const clave = (c: CrmClientWithDetails) => {
      const u = contactos.get(c.id)?.ultimo?.en
      return u ? Date.parse(u) : Number.NEGATIVE_INFINITY
    }
    return copia.sort((a, b) => clave(a) - clave(b) || reunion(b) - reunion(a))
  }
  if (orden === 'accion') {
    const hoy = diaDeMadrid(ahora)
    const clave = (c: CrmClientWithDetails) => (c.next_action_date && /^\d{4}-\d{2}-\d{2}/.test(c.next_action_date) ? c.next_action_date.slice(0, 10) : '9999-12-31')
    return copia.sort((a, b) => {
      const ka = clave(a)
      const kb = clave(b)
      // lo vencido (antes de hoy) va primero, de la más antigua a la más reciente; después, de hoy en adelante
      const va = ka < hoy ? 0 : 1
      const vb = kb < hoy ? 0 : 1
      return va - vb || ka.localeCompare(kb) || reunion(b) - reunion(a)
    })
  }
  return copia.sort((a, b) => reunion(b) - reunion(a))
}

/* ------------------------------------------------------------------ */
/* CERRADO: ganados y perdidos                                         */
/* ------------------------------------------------------------------ */

export type FiltroDeCerrado = 'ganados' | 'perdidos'

export function cuentaDeCerrados(clientes: readonly { stage: CrmStage }[]): Record<FiltroDeCerrado, number> {
  return { ganados: clientes.filter((c) => c.stage === 'ganado').length, perdidos: clientes.filter((c) => c.stage === 'perdido').length }
}

/** Los ganados por fecha de cierre (el más reciente arriba); los perdidos por la última vez que se tocó la ficha */
export function ordenarCerrados(clientes: readonly CrmClientWithDetails[], filtro: FiltroDeCerrado): CrmClientWithDetails[] {
  const stage: CrmStage = filtro === 'ganados' ? 'ganado' : 'perdido'
  const instante = (c: CrmClientWithDetails) => {
    const t = Date.parse((filtro === 'ganados' ? c.closed_at : null) ?? c.updated_at ?? c.created_at)
    return Number.isFinite(t) ? t : 0
  }
  return clientes.filter((c) => c.stage === stage).sort((a, b) => instante(b) - instante(a))
}
