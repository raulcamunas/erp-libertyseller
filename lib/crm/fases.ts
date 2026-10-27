/**
 * LA LÍNEA DE FASES DE UN CLIENTE.
 * =================================
 * El CRM ya tenía las fases (`crm_clients.stage`: nuevo → seguimiento → propuesta enviada → revisión → negociación → cerrado, y «perdido» fuera del camino), pero solo la de
 * HOY: cada cambio pisaba el anterior y no se podía decir «lleva 9 días en Propuesta enviada» ni «entró en Negociación el 14 de octubre». Desde la migración 258 un disparador
 * anota cada cambio en `crm_etapas_historial`, y de aquí sale lo que pinta la línea visual del hub: qué fases se han recorrido, cuál es la actual y cuánto lleva en ella.
 *
 * TRES COSAS QUE LA LÍNEA TIENE QUE DECIR CON HONESTIDAD:
 *
 *   · UNA FASE SALTADA ES SALTADA. Si alguien pasó un cliente de «Nuevo» a «Negociación» (pasa: llegó negociando), «Seguimiento» y «Propuesta enviada» no se pintan como
 *     hechas, porque nadie las vivió. Quedan como `saltado`. PERO SOLO DONDE EL HISTORIAL ES DE FIAR: de lo anterior a la 258 no consta nada, y ahí se pinta como recorrido
 *     (sin fecha) en vez de afirmar un salto que nadie ha comprobado.
 *   · UNA FECHA RECUPERADA ES APROXIMADA. De las fichas que ya existían al lanzar la 258 solo se sabía la fase de hoy; su fila de historial está marcada `recuperado` y la
 *     pantalla lo dice («desde ~14 oct»), en vez de enseñar una fecha exacta que no lo es.
 *   · «PERDIDO» NO ES UNA FASE MÁS DEL CAMINO. Es una salida: la línea se queda hasta donde llegó y marca el abandono aparte, en rojo.
 *
 * Sin historial (la migración todavía no está lanzada, o la ficha es de hoy y el disparador no existía) la línea funciona igual con la fase actual y sin fechas.
 *
 * Es puro: no toca la base ni el navegador.
 */

import type { CrmStage } from '@/lib/types/crm'

/** El camino de un cliente, en orden. «perdido» no está: es una salida */
export const FASES_DEL_CAMINO: readonly CrmStage[] = ['nuevo', 'seguimiento', 'propuesta_enviada', 'revision_propuesta', 'negociacion', 'ganado']

export type OrigenDeFase = 'alta' | 'manual' | 'recuperado'

export interface EntradaDeFase {
  etapa: CrmStage
  /** ISO: desde cuándo está (o estuvo) en esa fase */
  desde: string
  origen: OrigenDeFase
}

export type EstadoDelPaso = 'hecho' | 'actual' | 'pendiente' | 'saltado'

export interface PasoDeLaLinea {
  etapa: CrmStage
  estado: EstadoDelPaso
  /** ISO de cuándo se entró en esa fase por primera vez; null si no consta (pendiente, saltada o sin historial) */
  desde: string | null
  /** Cuántos días estuvo en ella: hasta que entró la siguiente; en la actual, hasta hoy. null si no se sabe */
  dias: number | null
  /** La fecha viene de una ficha anterior a la 258 y es una estimación */
  aproximada: boolean
}

export interface LineaDeFases {
  pasos: PasoDeLaLinea[]
  /** Si la ficha está perdida: cuándo se perdió y cuánto hace. Si no, null */
  perdido: { desde: string | null; dias: number | null; aproximada: boolean } | null
  actual: CrmStage
  /** Posición de la fase actual en el camino (0-5), o de la última alcanzada si está perdida */
  indice: number
  /** Cuántos días lleva en la fase actual (o desde que se perdió); null si no se sabe */
  diasEnLaActual: number | null
  /** 0 a 1: cuánto del camino lleva hecho. Para la barrita de cada ficha en la lista */
  avance: number
}

const DIA_MS = 86_400_000

/** Días enteros entre dos instantes (nunca negativos). null si alguno no es una fecha */
export function diasEntre(desde: string | null | undefined, hasta: string | Date): number | null {
  if (!desde) return null
  const a = new Date(desde).getTime()
  const b = (hasta instanceof Date ? hasta : new Date(hasta)).getTime()
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null
  return Math.max(0, Math.floor((b - a) / DIA_MS))
}

const indiceEnElCamino = (etapa: CrmStage): number => FASES_DEL_CAMINO.indexOf(etapa)

/**
 * La línea de fases de un cliente.
 *
 * `historial` puede venir en cualquier orden y estar vacío. `ahora` es el instante de referencia (se pasa para poder probarlo).
 */
export function lineaDeFases(stage: CrmStage, historial: readonly EntradaDeFase[], ahora: Date): LineaDeFases {
  const ordenado = [...historial].sort((a, b) => new Date(a.desde).getTime() - new Date(b.desde).getTime())

  // La entrada más reciente de cada fase y la primera: la primera dice «desde cuándo»; los días se miden contra lo que vino después
  const primera = new Map<CrmStage, EntradaDeFase>()
  ordenado.forEach((e) => {
    if (!primera.has(e.etapa)) primera.set(e.etapa, e)
  })

  const perdida = stage === 'perdido'
  // Hasta dónde llegó: la actual si está en el camino; si está perdida, la última fase del camino que pisó (o la primera, si no consta ninguna)
  let indice = indiceEnElCamino(stage)
  if (perdida) {
    const alcanzadas = ordenado.filter((e) => e.etapa !== 'perdido').map((e) => indiceEnElCamino(e.etapa))
    indice = alcanzadas.length > 0 ? alcanzadas[alcanzadas.length - 1] : 0
  }

  // Cuándo acaba cada fase: cuando empieza la fase siguiente en el historial (de cualquier tipo)
  const finDe = (entrada: EntradaDeFase): string | null => {
    const pos = ordenado.indexOf(entrada)
    for (let i = pos + 1; i < ordenado.length; i++) {
      if (ordenado[i].etapa !== entrada.etapa) return ordenado[i].desde
    }
    return null
  }

  // La entrada de la fase en la que está AHORA: la última vez que se entró en ella. Si un cliente se devolvió a «Nuevo» tras pasar por «Seguimiento», «lleva X días en
  // Nuevo» se cuenta desde que VOLVIÓ, no desde la primera vez que nació
  const entradasDeLaActual = ordenado.filter((e) => e.etapa === stage)
  const entradaActual = entradasDeLaActual.length > 0 ? entradasDeLaActual[entradasDeLaActual.length - 1] : null

  // HASTA DÓNDE LLEGA LO QUE SE SABE. Una fase anterior sin fila en el historial solo se puede llamar «saltada» si el historial es de fiar en ese tramo: el de una ficha que
  // nació con la 258 lo es desde el primer día (origen «alta»); el de una ficha anterior empieza en la fila «recuperado» y de lo de antes no consta nada. Sin historial no consta
  // nada de nada. Lo que no consta no se afirma: se pinta como recorrido (sin fecha), que es lo normal, y no como saltado.
  const primeraFila = ordenado[0]
  const hastaDondeNoConsta = ordenado.length === 0 ? indice : primeraFila.origen === 'recuperado' ? Math.max(0, indiceEnElCamino(primeraFila.etapa)) : 0

  const pasos: PasoDeLaLinea[] = FASES_DEL_CAMINO.map((etapa, i) => {
    const entrada = primera.get(etapa) ?? null
    let estado: EstadoDelPaso
    if (i === indice && !perdida) estado = 'actual'
    else if (i === indice && perdida) estado = 'hecho'
    else if (i < indice) estado = entrada || i < hastaDondeNoConsta ? 'hecho' : 'saltado'
    else estado = 'pendiente'

    // Una fase futura que consta en el historial (se volvió atrás) sigue siendo pendiente y sin fecha: la línea cuenta el camino de hoy
    const consta = estado === 'hecho' || estado === 'actual'
    // La actual enseña cuándo se entró en ella esta vez; las ya recorridas, cuándo se entró la primera vez
    const origenDeLaFecha = estado === 'actual' ? entradaActual : entrada
    const desde = consta && origenDeLaFecha ? origenDeLaFecha.desde : null
    let dias: number | null = null
    if (desde && origenDeLaFecha) {
      const fin = estado === 'actual' ? ahora : finDe(origenDeLaFecha)
      dias = diasEntre(desde, fin ?? ahora)
    }
    return { etapa, estado, desde, dias, aproximada: !!desde && origenDeLaFecha!.origen === 'recuperado' }
  })

  const entradasPerdido = ordenado.filter((e) => e.etapa === 'perdido')
  const entradaPerdido = entradasPerdido.length > 0 ? entradasPerdido[entradasPerdido.length - 1] : null
  const perdido = perdida
    ? { desde: entradaPerdido?.desde ?? null, dias: entradaPerdido ? diasEntre(entradaPerdido.desde, ahora) : null, aproximada: entradaPerdido?.origen === 'recuperado' }
    : null

  const entradaDeHoy = perdida ? entradaPerdido : entradaActual
  const diasEnLaActual = entradaDeHoy ? diasEntre(entradaDeHoy.desde, ahora) : null

  return {
    pasos,
    perdido,
    actual: stage,
    indice,
    diasEnLaActual,
    avance: FASES_DEL_CAMINO.length > 1 ? indice / (FASES_DEL_CAMINO.length - 1) : 0,
  }
}

/** «hoy», «ayer», «hace 9 días»… para la línea y la lista. null si no se sabe */
export function textoDeDias(dias: number | null): string | null {
  if (dias === null) return null
  if (dias === 0) return 'hoy'
  if (dias === 1) return 'ayer'
  if (dias < 60) return `hace ${dias} días`
  const meses = Math.floor(dias / 30)
  return `hace ${meses} ${meses === 1 ? 'mes' : 'meses'}`
}

/** «lleva 9 días», «lleva menos de un día»: lo que dice la etiqueta de la fase actual */
export function textoDeDuracion(dias: number | null): string | null {
  if (dias === null) return null
  if (dias === 0) return 'menos de un día'
  return dias === 1 ? '1 día' : `${dias} días`
}

/** Cuánto tardó en cerrarse desde que nació la ficha, si ya está cerrada y se sabe: el ciclo de venta */
export function cicloDeVenta(historial: readonly EntradaDeFase[]): number | null {
  const ordenado = [...historial].sort((a, b) => new Date(a.desde).getTime() - new Date(b.desde).getTime())
  const inicio = ordenado[0]
  const cierre = ordenado.find((e) => e.etapa === 'ganado')
  if (!inicio || !cierre || inicio.origen === 'recuperado' || cierre.origen === 'recuperado') return null
  return diasEntre(inicio.desde, cierre.desde)
}
