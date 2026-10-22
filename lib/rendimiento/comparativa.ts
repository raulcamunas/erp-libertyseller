import { mesDe, sumarDias, sumarMeses } from './dia'
import {
  diasDelRango,
  esLaborable,
  laborablesTranscurridos,
  lunesDe,
  moverPeriodo,
  nombreDelDia,
  nombreDelDiaEnPlural,
  rangoDe,
  recortarA,
  sumarLaborables,
  ultimoDiaDelMes,
  type Periodo,
  type Rango,
} from './periodos'

/**
 * COMPARAR PERIODOS: LAS CIFRAS DE UN PERIODO, CONTRA LAS DE ANTES.
 * ================================================================
 * PURO. Se comprueba con comparativa.prueba.ts. Lo usa el panel en el navegador.
 *
 * El panel recibe de la base UNA FILA POR PERSONA Y DÍA (función rendimiento_resumen_diario, migración 235) y de
 * aquí salen las sumas, la referencia con la que se compara y la tendencia. Las reglas de cada cifra —qué es una
 * llamada contestada, qué es una conversación— están en metricas.ts y en esa función SQL; aquí solo se suma.
 *
 *
 * ============ CON QUÉ SE COMPARA ============
 *
 *   · UN DÍA, con la media de ese mismo día de la semana en las cuatro semanas anteriores («los jueves
 *     anteriores»), contando solo los que tuvieron actividad: un jueves de vacaciones no tiene que arrastrar a la
 *     baja lo que es normal para esa persona. Comparar un jueves con el miércoles sería comparar días distintos.
 *   · UNA SEMANA, con la anterior. Y MISMO TRAMO: si es jueves, la semana en curso lleva cuatro días y se compara
 *     con los cuatro primeros de la anterior, no con la anterior entera, que saldría siempre «a la baja» hasta el
 *     domingo.
 *   · UN MES, con el anterior, igual: hasta el mismo día.
 *
 * Una variación sin referencia (la persona no tenía nada en el periodo de comparación) se dice como tal y no se
 * inventa un «+∞ %».
 */

/** Una fila de rendimiento_resumen_diario: lo de UNA persona en UN día */
export interface FilaDiaria {
  user_id: string
  /** 'AAAA-MM-DD', día de Madrid */
  dia: string
  realizadas: number
  recibidas: number
  contestadas: number
  segundos: number
  conversaciones: number
  whatsapp: number
  whatsapp_apuntes: number
  correos: number
  correos_apuntes: number
  respuestas: number
  citas: number
}

export interface Totales {
  llamadas: number
  recibidas: number
  contestadas: number
  segundos: number
  conversaciones: number
  whatsapp: number
  whatsappApuntes: number
  correos: number
  correosApuntes: number
  respuestas: number
  citas: number
}

export const totalesVacios = (): Totales => ({
  llamadas: 0,
  recibidas: 0,
  contestadas: 0,
  segundos: 0,
  conversaciones: 0,
  whatsapp: 0,
  whatsappApuntes: 0,
  correos: 0,
  correosApuntes: 0,
  respuestas: 0,
  citas: 0,
})

function sumarFila(t: Totales, f: FilaDiaria) {
  t.llamadas += f.realizadas
  t.recibidas += f.recibidas
  t.contestadas += f.contestadas
  t.segundos += f.segundos
  t.conversaciones += f.conversaciones
  t.whatsapp += f.whatsapp
  t.whatsappApuntes += f.whatsapp_apuntes
  t.correos += f.correos
  t.correosApuntes += f.correos_apuntes
  t.respuestas += f.respuestas
  t.citas += f.citas
}

/** Suma de totales: para el «Total» del equipo */
export function sumarTotales(lista: readonly Totales[]): Totales {
  const t = totalesVacios()
  for (const x of lista) for (const k of Object.keys(t) as Array<keyof Totales>) t[k] += x[k]
  return t
}

/** Media de totales, campo a campo: la referencia de un día es la media de varios */
export function promediar(lista: readonly Totales[]): Totales {
  const t = sumarTotales(lista)
  if (lista.length === 0) return t
  for (const k of Object.keys(t) as Array<keyof Totales>) t[k] /= lista.length
  return t
}

/** ¿Hubo algo? Sirve para no contar como «día normal» uno de vacaciones */
export function hayActividad(t: Totales): boolean {
  return t.llamadas + t.recibidas + t.whatsapp + t.correos + t.respuestas + t.citas > 0
}

/** Contestadas entre hechas, de 0 a 1 */
export function contacto(t: Totales): number {
  return t.llamadas === 0 ? 0 : t.contestadas / t.llamadas
}

/** Los días de una persona, por fecha */
export type PorDia = Map<string, FilaDiaria>

/** Las filas agrupadas por persona y por día */
export function indexar(filas: readonly FilaDiaria[]): Map<string, PorDia> {
  const porPersona = new Map<string, PorDia>()
  for (const f of filas) {
    let dias = porPersona.get(f.user_id)
    if (!dias) {
      dias = new Map()
      porPersona.set(f.user_id, dias)
    }
    dias.set(f.dia, f)
  }
  return porPersona
}

/** La suma de los días de un rango de una persona. Un día sin fila es un día sin nada */
export function totalesDeRango(porDia: PorDia | undefined, r: Rango): Totales {
  const t = totalesVacios()
  if (!porDia) return t
  for (const dia of diasDelRango(r)) {
    const f = porDia.get(dia)
    if (f) sumarFila(t, f)
  }
  return t
}

/* ------------------------------------------------------------------ */
/* Con qué se compara                                                  */
/* ------------------------------------------------------------------ */

export interface Comparacion {
  /** Lo que se mide, sin pasar de hoy */
  actual: Rango
  /** Con qué se compara. Una sola para semanas y meses; las cuatro de ese día de la semana para un día */
  bases: Rango[]
  /** «la media de los jueves anteriores», «la semana anterior, hasta el jueves» */
  texto: string
}

/** null si el periodo entero está en el futuro: no hay nada que medir */
export function tramosDeComparacion(p: Periodo, hoy: string): Comparacion | null {
  const completo = rangoDe(p)
  const actual = recortarA(completo, hoy)
  if (!actual) return null

  if (p.tipo === 'dia') {
    const bases = [7, 14, 21, 28].map((k) => {
      const d = sumarDias(p.ancla, -k)
      return { desde: d, hasta: d }
    })
    // Hoy todavía no ha acabado: se dice, porque por la mañana cualquiera «baja» frente a un día entero
    const aMedias = p.ancla === hoy ? ' (hoy todavía no ha acabado)' : ''
    return { actual, bases, texto: `la media de los ${nombreDelDiaEnPlural(p.ancla)} anteriores${aMedias}` }
  }

  const dias = diasDelRango(actual).length
  // Un periodo ya cerrado se compara con el anterior ENTERO; uno en curso, con el mismo tramo del anterior
  const entero = actual.hasta === completo.hasta

  if (p.tipo === 'semana') {
    const desde = sumarDias(completo.desde, -7)
    if (entero) return { actual, bases: [{ desde, hasta: sumarDias(desde, 6) }], texto: 'la semana anterior' }
    return { actual, bases: [{ desde, hasta: sumarDias(desde, dias - 1) }], texto: `la semana anterior, hasta el ${nombreDelDia(actual.hasta)}` }
  }

  const { anio, mes } = mesDe(completo.desde)
  const previo = sumarMeses(anio, mes, -1)
  const inicioPrevio = `${previo.anio}-${String(previo.mes).padStart(2, '0')}-01`
  const finPrevio = ultimoDiaDelMes(inicioPrevio)
  if (entero) return { actual, bases: [{ desde: inicioPrevio, hasta: finPrevio }], texto: 'el mes anterior' }
  const hastaPrevio = sumarDias(inicioPrevio, dias - 1)
  // Si el mes anterior tuvo menos días que los que lleva este, se compara con todo él
  if (hastaPrevio >= finPrevio) return { actual, bases: [{ desde: inicioPrevio, hasta: finPrevio }], texto: 'el mes anterior' }
  return { actual, bases: [{ desde: inicioPrevio, hasta: hastaPrevio }], texto: `el mes anterior, hasta el día ${dias}` }
}

/**
 * La referencia de una persona: los totales con los que comparar.
 * Para un día, la media de los días de la base que tuvieron actividad (null si ninguno). Para una semana o un
 * mes, los totales del tramo anterior (null si no hubo nada).
 */
export function baseDe(porDia: PorDia | undefined, c: Comparacion): Totales | null {
  const tramos = c.bases.map((b) => totalesDeRango(porDia, b))
  const conActividad = tramos.filter(hayActividad)
  if (conActividad.length === 0) return null
  return c.bases.length > 1 ? promediar(conActividad) : conActividad[0]
}

/* ------------------------------------------------------------------ */
/* Cuánto ha cambiado                                                  */
/* ------------------------------------------------------------------ */

export type Sentido = 'sube' | 'baja' | 'igual' | 'sinBase'

export interface Variacion {
  sentido: Sentido
  /** «+12 %», «−8 %», «+3», «igual», «sin referencia» */
  texto: string
  /** El cambio en porcentaje, o null si no hay base */
  pct: number | null
  diferencia: number
}

const MENOS = '−'

/**
 * Lo que ha cambiado un número frente a su referencia.
 *
 * Menos de un 3 % es «igual»: el ruido de un día no es una tendencia. Con referencias pequeñas (menos de 10) un
 * porcentaje engaña —de 2 a 3 es «+50 %»—, así que se dice la diferencia en unidades.
 */
export function variacion(actual: number, base: number | null): Variacion {
  if (base === null || base <= 0) {
    // Sin nada con lo que comparar: si ahora hay algo se dice «sin referencia»; si tampoco hay nada, no ha cambiado
    if (actual > 0) return { sentido: 'sinBase', texto: 'sin referencia', pct: null, diferencia: actual }
    return { sentido: 'igual', texto: 'igual', pct: null, diferencia: 0 }
  }
  const diferencia = actual - base
  const pct = (diferencia / base) * 100
  if (Math.abs(pct) < 3) return { sentido: 'igual', texto: 'igual', pct, diferencia }
  const signo = diferencia > 0 ? '+' : MENOS
  if (base < 10) {
    const unidades = Math.round(Math.abs(diferencia))
    if (unidades === 0) return { sentido: 'igual', texto: 'igual', pct, diferencia }
    return { sentido: diferencia > 0 ? 'sube' : 'baja', texto: `${signo}${unidades}`, pct, diferencia }
  }
  return { sentido: diferencia > 0 ? 'sube' : 'baja', texto: `${signo}${Math.round(Math.abs(pct))} %`, pct, diferencia }
}

/** Lo mismo para un porcentaje (el de contacto): la diferencia se dice en PUNTOS, no en tanto por ciento del tanto por ciento */
export function variacionDePuntos(actual: number, base: number | null): Variacion {
  if (base === null) return { sentido: 'sinBase', texto: 'sin referencia', pct: null, diferencia: 0 }
  const puntos = (actual - base) * 100
  if (Math.abs(puntos) < 1) return { sentido: 'igual', texto: 'igual', pct: puntos, diferencia: puntos }
  return {
    sentido: puntos > 0 ? 'sube' : 'baja',
    texto: `${puntos > 0 ? '+' : MENOS}${Math.round(Math.abs(puntos))} pts`,
    pct: puntos,
    diferencia: puntos,
  }
}

/* ------------------------------------------------------------------ */
/* Lo que hay que pedir a la base y la tendencia                       */
/* ------------------------------------------------------------------ */

/**
 * Los días que hay que pedir a la base para poder comparar y pintar la tendencia de un periodo.
 * Un día: él y las cuatro semanas anteriores. Una semana: ella y las tres anteriores. Un mes: él y los tres anteriores.
 */
export function ventanaDeDatos(p: Periodo): Rango {
  switch (p.tipo) {
    case 'dia':
      return { desde: sumarDias(p.ancla, -28), hasta: p.ancla }
    case 'semana': {
      const lunes = lunesDe(p.ancla)
      return { desde: sumarDias(lunes, -21), hasta: sumarDias(lunes, 6) }
    }
    case 'mes': {
      const { anio, mes } = mesDe(p.ancla)
      const antes = sumarMeses(anio, mes, -3)
      return { desde: `${antes.anio}-${String(antes.mes).padStart(2, '0')}-01`, hasta: ultimoDiaDelMes(p.ancla) }
    }
  }
}

/** Llamadas hechas por día laborable. Un periodo a medias se divide por los días laborables que lleva, no por los que tendrá */
export function llamadasPorDiaLaborable(llamadas: number, r: Rango, hoy: string): number {
  const dias = laborablesTranscurridos(r, hoy)
  return dias === 0 ? 0 : llamadas / dias
}

export interface PuntoDeTendencia {
  etiqueta: string
  valor: number
  /** El tramo es el periodo que se está mirando */
  actual: boolean
}

/**
 * La tendencia de llamadas de una persona: un punto por periodo, del más antiguo al actual.
 *   · un día     -> sus últimos 7 días laborables, llamadas de cada uno
 *   · una semana -> las 4 últimas semanas, llamadas POR DÍA LABORABLE
 *   · un mes     -> los 4 últimos meses, llamadas POR DÍA LABORABLE
 * Por día laborable y no totales, para que una semana o un mes a medias no parezca una caída.
 */
export function tendenciaDe(porDia: PorDia | undefined, p: Periodo, hoy: string, etiquetar: (r: Rango) => string): PuntoDeTendencia[] {
  if (p.tipo === 'dia') {
    let d = esLaborable(p.ancla) ? p.ancla : sumarLaborables(p.ancla, -1)
    const dias: string[] = []
    for (let i = 0; i < 7; i += 1) {
      dias.unshift(d)
      d = sumarLaborables(d, -1)
    }
    return dias.map((dia) => ({ etiqueta: etiquetar({ desde: dia, hasta: dia }), valor: porDia?.get(dia)?.realizadas ?? 0, actual: dia === p.ancla }))
  }

  const puntos: PuntoDeTendencia[] = []
  for (let k = 3; k >= 0; k -= 1) {
    const periodo = moverPeriodo(p, -k)
    const completo = rangoDe(periodo)
    const r = recortarA(completo, hoy)
    const llamadas = r ? totalesDeRango(porDia, r).llamadas : 0
    puntos.push({ etiqueta: etiquetar(completo), valor: r ? llamadasPorDiaLaborable(llamadas, completo, hoy) : 0, actual: k === 0 })
  }
  return puntos
}

/* ------------------------------------------------------------------ */
/* Los últimos días de cada cifra, para las barritas                   */
/* ------------------------------------------------------------------ */

export type ClaveDeSerie = 'llamadas' | 'whatsapp' | 'correos' | 'respuestas' | 'citas'

export interface SerieDeCifra {
  /** Siete valores, del día más antiguo al más reciente */
  valores: number[]
  /** «lun 19» */
  etiquetas: string[]
}

/**
 * Los últimos 7 días LABORABLES de cada cifra de una persona, hasta el final del periodo que se mira (o hasta hoy, si
 * el periodo no ha acabado): lo que dibujan las barritas de cada tarjeta, para ver de un vistazo si la cifra sube o
 * baja sin tener que comparar números. Un día sin fila es un día sin nada (cero). Los fines de semana no cuentan: una
 * barra de cero cada sábado y domingo no diría nada.
 */
export function seriesDeCifras(porDia: PorDia | undefined, p: Periodo, hoy: string): Record<ClaveDeSerie, SerieDeCifra> {
  const completo = rangoDe(p)
  const hasta = recortarA(completo, hoy)?.hasta ?? completo.hasta
  let d = esLaborable(hasta) ? hasta : sumarLaborables(hasta, -1)
  const dias: string[] = []
  for (let i = 0; i < 7; i += 1) {
    dias.unshift(d)
    d = sumarLaborables(d, -1)
  }
  const etiquetas = dias.map((dia) => `${nombreDelDia(dia).slice(0, 3)} ${Number(dia.slice(8))}`)
  const de = (campo: (f: FilaDiaria) => number) => dias.map((dia) => {
    const f = porDia?.get(dia)
    return f ? campo(f) : 0
  })
  return {
    llamadas: { valores: de((f) => f.realizadas), etiquetas },
    whatsapp: { valores: de((f) => f.whatsapp), etiquetas },
    correos: { valores: de((f) => f.correos), etiquetas },
    respuestas: { valores: de((f) => f.respuestas), etiquetas },
    citas: { valores: de((f) => f.citas), etiquetas },
  }
}

/* ------------------------------------------------------------------ */
/* La fila de una persona, ya lista para pintar                        */
/* ------------------------------------------------------------------ */

export interface ResultadoDePersona {
  actual: Totales
  /** La referencia, o null si no la hay */
  base: Totales | null
  tendencia: PuntoDeTendencia[]
}

export function resultadoDePersona(porDia: PorDia | undefined, p: Periodo, hoy: string, c: Comparacion | null, etiquetar: (r: Rango) => string): ResultadoDePersona {
  return {
    actual: c ? totalesDeRango(porDia, c.actual) : totalesVacios(),
    base: c ? baseDe(porDia, c) : null,
    tendencia: tendenciaDe(porDia, p, hoy, etiquetar),
  }
}
