import {
  baseDe,
  contacto,
  hayActividad,
  sumarTotales,
  totalesDeRango,
  totalesVacios,
  tramosDeComparacion,
  variacion,
  variacionDePuntos,
  type Comparacion,
  type PorDia,
  type Totales,
  type Variacion,
} from './comparativa'
import { diaMadrid, esDia, etiquetaDeMes, horaMadrid, sumarDias } from './dia'
import { horaDeMinuto, minutoDeLaHora, pausasDe, resumenDeLinea, textoDeMinutos, type EventoDeLinea } from './linea'
import { estaContestada, tiempoHablado } from './metricas'
import { diasDelRango, esLaborable, lunesDe, nombreDelDia } from './periodos'

/**
 * EL INFORME SEMANAL: LA SEMANA ENTERA DE TODO EL EQUIPO, PARA REVISARLA EN LA REUNIÓN DEL LUNES.
 * ==============================================================================================
 * PURO. Se comprueba con informe.prueba.ts. Lo usan el navegador y las pruebas.
 *
 * El informe no calcula nada que el panel no calcule ya: las cifras de cada persona y día salen de las mismas filas
 * de rendimiento_resumen_diario, y la comparación es la misma de siempre (la semana anterior; si esta está en curso,
 * el mismo tramo de la anterior, ver comparativa.ts). Lo que añade este fichero es colocarlas para leerlas de un
 * vistazo: la matriz persona × día, las cifras del equipo con su cambio, los titulares escritos en frases, el mapa
 * de franjas horarias y el horario de cada persona.
 *
 * LA SEMANA VA DE LUNES A DOMINGO y los días son los de Madrid, igual que en el resto del panel.
 */

export interface PersonaDeInforme {
  id: string
  nombre: string
  /** Tiene la clave de Rinkel vinculada: si no, sus llamadas no cuentan y no se le puede exigir nada en ellas */
  vinculado: boolean
}

/* ------------------------------------------------------------------ */
/* La semana                                                           */
/* ------------------------------------------------------------------ */

export interface Semana {
  lunes: string
  domingo: string
  /** Los siete días, de lunes a domingo */
  dias: string[]
  hoy: string
  /** Cuántos de los siete días lleva la semana hasta hoy (0 a 7) */
  transcurridos: number
  /** Ya han pasado los siete días: no se compara con un tramo, sino con la semana anterior entera */
  completa: boolean
  /** Hoy cae dentro de esta semana */
  contieneHoy: boolean
  /** Con qué se compara; null si la semana entera está por venir */
  comparacion: Comparacion | null
}

export function semanaDe(ancla: string, hoy: string): Semana {
  const lunes = lunesDe(ancla)
  const dias = diasDelRango({ desde: lunes, hasta: sumarDias(lunes, 6) })
  const transcurridos = dias.filter((d) => d <= hoy).length
  return {
    lunes,
    domingo: dias[6],
    dias,
    hoy,
    transcurridos,
    completa: transcurridos === 7,
    contieneHoy: dias.includes(hoy),
    comparacion: tramosDeComparacion({ tipo: 'semana', ancla: lunes }, hoy),
  }
}

/** La semana que se revisa en la reunión del lunes: la última que ha acabado del todo */
export const lunesPorDefecto = (hoy: string): string => sumarDias(lunesDe(hoy), -7)

/**
 * El lunes de la semana que pide la dirección (cualquier día de ella vale). Sin pedir nada, o con algo que no es una
 * fecha, la última semana completa; una semana que todavía no ha empezado se queda en la de esta semana.
 */
export function lunesDeTexto(texto: unknown, hoy: string): string {
  if (typeof texto !== 'string' || !esDia(texto)) return lunesPorDefecto(hoy)
  const lunes = lunesDe(texto)
  const estaSemana = lunesDe(hoy)
  return lunes > estaSemana ? estaSemana : lunes
}

const nombreDelMes = (dia: string) => etiquetaDeMes(Number(dia.slice(0, 4)), Number(dia.slice(5, 7))).split(' ')[0]

/** «del 19 al 25 de octubre de 2026»; si cruza de mes, «del 26 de octubre al 1 de noviembre de 2026» */
export function etiquetaLargaDeSemana(s: { lunes: string; domingo: string }): string {
  const d1 = Number(s.lunes.slice(8))
  const d2 = Number(s.domingo.slice(8))
  const m1 = nombreDelMes(s.lunes)
  const m2 = nombreDelMes(s.domingo)
  const a1 = s.lunes.slice(0, 4)
  const a2 = s.domingo.slice(0, 4)
  if (a1 !== a2) return `del ${d1} de ${m1} de ${a1} al ${d2} de ${m2} de ${a2}`
  if (m1 === m2) return `del ${d1} al ${d2} de ${m1} de ${a1}`
  return `del ${d1} de ${m1} al ${d2} de ${m2} de ${a1}`
}

export interface DiaDeSemana {
  dia: string
  /** «lun», «mié» */
  corto: string
  /** El número del día del mes */
  numero: number
  /** «lun 19» */
  etiqueta: string
  /** Todavía no ha llegado */
  futuro: boolean
  esHoy: boolean
  finDeSemana: boolean
}

export function diasDeSemana(s: Semana): DiaDeSemana[] {
  return s.dias.map((dia) => {
    const corto = nombreDelDia(dia).slice(0, 3)
    const numero = Number(dia.slice(8))
    return { dia, corto, numero, etiqueta: `${corto} ${numero}`, futuro: dia > s.hoy, esHoy: dia === s.hoy, finDeSemana: !esLaborable(dia) }
  })
}

/* ------------------------------------------------------------------ */
/* Las cifras                                                          */
/* ------------------------------------------------------------------ */

export type Metrica = 'llamadas' | 'contestadas' | 'conversaciones' | 'tiempo' | 'whatsapp' | 'correos' | 'respuestas' | 'citas'

export const METRICAS: ReadonlyArray<{ id: Metrica; etiqueta: string; corta: string; ayuda: string }> = [
  { id: 'llamadas', etiqueta: 'Llamadas hechas', corta: 'Llamadas', ayuda: 'Llamadas que hizo la persona' },
  { id: 'contestadas', etiqueta: 'Llamadas contestadas', corta: 'Contestadas', ayuda: 'Las que contestó una persona: duran 10 segundos o más; un contestador automático no cuenta' },
  { id: 'conversaciones', etiqueta: 'Conversaciones por teléfono', corta: 'Conversaciones', ayuda: 'Llamadas contestadas que pasan de 1 minuto' },
  { id: 'tiempo', etiqueta: 'Tiempo al teléfono', corta: 'Tiempo', ayuda: 'Suma de lo que duraron las llamadas contestadas' },
  { id: 'whatsapp', etiqueta: 'WhatsApp', corta: 'WhatsApp', ayuda: 'Clientes distintos con los que se habló por WhatsApp cada día, por muchos apuntes que haya' },
  { id: 'correos', etiqueta: 'Correos', corta: 'Correos', ayuda: 'Clientes distintos con los que se habló por correo cada día, por muchos apuntes que haya' },
  { id: 'respuestas', etiqueta: 'Respuestas de clientes', corta: 'Respuestas', ayuda: 'Clientes que contestaron, contados una vez por día' },
  { id: 'citas', etiqueta: 'Citas agendadas', corta: 'Citas', ayuda: 'Las que se agendaron en la Agenda esos días' },
]

export function valorDe(t: Totales, m: Metrica): number {
  switch (m) {
    case 'llamadas':
      return t.llamadas
    case 'contestadas':
      return t.contestadas
    case 'conversaciones':
      return t.conversaciones
    case 'tiempo':
      return t.segundos
    case 'whatsapp':
      return t.whatsapp
    case 'correos':
      return t.correos
    case 'respuestas':
      return t.respuestas
    case 'citas':
      return t.citas
  }
}

/** Un valor tal como se escribe: el tiempo en horas y minutos, lo demás en números enteros */
export function formatoDe(m: Metrica, valor: number): string {
  return m === 'tiempo' ? tiempoHablado(valor) : Math.round(valor).toLocaleString('es-ES')
}

/** Lo de una persona en la semana: el total hasta hoy, con qué se compara y cada uno de los siete días */
export interface ResultadoSemanal {
  persona: PersonaDeInforme
  actual: Totales
  /** La referencia; null si la persona no tenía nada en el tramo con el que se compara */
  base: Totales | null
  /** Siete, de lunes a domingo. Los días que todavía no han llegado, vacíos */
  dias: Totales[]
  /** Siete, los de la semana anterior en el mismo orden */
  anteriores: Totales[]
}

export function resultadoSemanal(persona: PersonaDeInforme, porDia: PorDia | undefined, semana: Semana): ResultadoSemanal {
  const dia = (d: string) => totalesDeRango(porDia, { desde: d, hasta: d })
  return {
    persona,
    actual: semana.comparacion ? totalesDeRango(porDia, semana.comparacion.actual) : totalesVacios(),
    base: semana.comparacion ? baseDe(porDia, semana.comparacion) : null,
    dias: semana.dias.map((d) => (d <= semana.hoy ? dia(d) : totalesVacios())),
    anteriores: semana.dias.map((d) => dia(sumarDias(d, -7))),
  }
}

/** El equipo entero: la suma de todos. La referencia es null solo si NADIE tenía nada con lo que comparar */
export function resultadoDelEquipo(resultados: readonly ResultadoSemanal[]): Omit<ResultadoSemanal, 'persona'> {
  const bases = resultados.map((r) => r.base).filter((b): b is Totales => b !== null)
  return {
    actual: sumarTotales(resultados.map((r) => r.actual)),
    base: bases.length === 0 ? null : sumarTotales(bases),
    dias: Array.from({ length: 7 }, (_, i) => sumarTotales(resultados.map((r) => r.dias[i]))),
    anteriores: Array.from({ length: 7 }, (_, i) => sumarTotales(resultados.map((r) => r.anteriores[i]))),
  }
}

/* ------------------------------------------------------------------ */
/* La matriz persona × día                                             */
/* ------------------------------------------------------------------ */

export interface CeldaDeMatriz {
  dia: string
  /** null: el día todavía no ha llegado */
  valor: number | null
  /** Lo mismo del mismo día de la semana anterior; null si el día todavía no ha llegado */
  anterior: number | null
}

export interface FilaDeMatriz {
  persona: PersonaDeInforme
  celdas: CeldaDeMatriz[]
  total: number
  /** La referencia de esa persona para el total; null si no la hay */
  totalBase: number | null
  cambio: Variacion
}

export interface Matriz {
  metrica: Metrica
  filas: FilaDeMatriz[]
  /** La suma del equipo en cada día */
  porDia: CeldaDeMatriz[]
  total: number
  totalBase: number | null
  cambio: Variacion
  /** El valor mayor de una celda de persona: lo que pinta de más oscuro */
  maximo: number
}

export function matrizDiaria(resultados: readonly ResultadoSemanal[], semana: Semana, metrica: Metrica): Matriz {
  const celdasDe = (dias: readonly Totales[], anteriores: readonly Totales[]): CeldaDeMatriz[] =>
    semana.dias.map((dia, i) => {
      const futuro = dia > semana.hoy
      return { dia, valor: futuro ? null : valorDe(dias[i], metrica), anterior: futuro ? null : valorDe(anteriores[i], metrica) }
    })

  const filas: FilaDeMatriz[] = resultados.map((r) => {
    const celdas = celdasDe(r.dias, r.anteriores)
    const totalBase = r.base ? valorDe(r.base, metrica) : null
    const total = valorDe(r.actual, metrica)
    return { persona: r.persona, celdas, total, totalBase, cambio: variacion(total, totalBase) }
  })

  const equipo = resultadoDelEquipo(resultados)
  const total = valorDe(equipo.actual, metrica)
  const totalBase = equipo.base ? valorDe(equipo.base, metrica) : null
  return {
    metrica,
    filas,
    porDia: celdasDe(equipo.dias, equipo.anteriores),
    total,
    totalBase,
    cambio: variacion(total, totalBase),
    maximo: filas.reduce((m, f) => f.celdas.reduce((mm, c) => Math.max(mm, c.valor ?? 0), m), 0),
  }
}

/* ------------------------------------------------------------------ */
/* Las cifras grandes del equipo                                       */
/* ------------------------------------------------------------------ */

export interface Kpi {
  id: 'llamadas' | 'contacto' | Exclude<Metrica, 'llamadas' | 'contestadas'>
  etiqueta: string
  /** Ya escrito: «412», «31 %», «1 h 37 min» */
  valor: string
  /** El número de detrás, para que la tarjeta cuente hasta él: llamadas, % de contacto o segundos al teléfono */
  bruto: number
  /** Cómo se escribe ese número: enteros, un tanto por ciento o horas y minutos */
  unidad: 'n' | 'pct' | 'tiempo'
  detalle: string
  cambio: Variacion
  /** Lo que enseña la matriz al pulsar esta cifra */
  metrica: Metrica
  /** Siete valores de la semana (null los que no han llegado) y siete de la anterior, de lo que cuenta la cifra */
  diario: Array<number | null>
  diarioAnterior: Array<number | null>
}

const n = (x: number) => Math.round(x).toLocaleString('es-ES')

export function kpisDelEquipo(resultados: readonly ResultadoSemanal[], semana: Semana): Kpi[] {
  const equipo = resultadoDelEquipo(resultados)
  const { actual, base } = equipo
  const diario = (m: Metrica) => semana.dias.map((d, i) => (d > semana.hoy ? null : valorDe(equipo.dias[i], m)))
  const diarioAnterior = (m: Metrica) => semana.dias.map((d, i) => (d > semana.hoy ? null : valorDe(equipo.anteriores[i], m)))
  const tasa = contacto(actual)
  const tasaBase = base ? contacto(base) : null

  const kpi = (id: Kpi['id'], etiqueta: string, valor: string, bruto: number, unidad: Kpi['unidad'], detalle: string, cambio: Variacion, metrica: Metrica): Kpi => ({
    id,
    etiqueta,
    valor,
    bruto,
    unidad,
    detalle,
    cambio,
    metrica,
    diario: diario(metrica),
    diarioAnterior: diarioAnterior(metrica),
  })

  // De media por persona que llamó: quien no tiene Rinkel o estuvo de baja no baja la media de los demás
  const llamaron = resultados.filter((r) => r.actual.llamadas > 0).length
  const porPersona = actual.llamadas === 0 || llamaron === 0 ? '' : `${n(actual.llamadas / llamaron)} por persona`

  return [
    kpi('llamadas', 'Llamadas hechas', n(actual.llamadas), actual.llamadas, 'n', porPersona || 'Ninguna llamada', variacion(actual.llamadas, base?.llamadas ?? null), 'llamadas'),
    kpi(
      'contacto',
      'Tasa de contacto',
      actual.llamadas === 0 ? '—' : `${Math.round(tasa * 100)} %`,
      Math.round(tasa * 100),
      'pct',
      `${n(actual.contestadas)} contestadas de ${n(actual.llamadas)}`,
      actual.llamadas === 0 ? variacionDePuntos(0, null) : variacionDePuntos(tasa, tasaBase),
      'contestadas'
    ),
    kpi('conversaciones', 'Conversaciones', n(actual.conversaciones), actual.conversaciones, 'n', 'Llamadas de más de 1 minuto', variacion(actual.conversaciones, base?.conversaciones ?? null), 'conversaciones'),
    kpi('tiempo', 'Tiempo al teléfono', tiempoHablado(actual.segundos), actual.segundos, 'tiempo', 'Solo llamadas contestadas', variacion(actual.segundos, base?.segundos ?? null), 'tiempo'),
    kpi('whatsapp', 'WhatsApp', n(actual.whatsapp), actual.whatsapp, 'n', `Clientes distintos · ${n(actual.whatsappApuntes)} apuntes`, variacion(actual.whatsapp, base?.whatsapp ?? null), 'whatsapp'),
    kpi('correos', 'Correos', n(actual.correos), actual.correos, 'n', `Clientes distintos · ${n(actual.correosApuntes)} apuntes`, variacion(actual.correos, base?.correos ?? null), 'correos'),
    kpi('respuestas', 'Respuestas', n(actual.respuestas), actual.respuestas, 'n', 'Clientes que contestaron', variacion(actual.respuestas, base?.respuestas ?? null), 'respuestas'),
    kpi('citas', 'Citas agendadas', n(actual.citas), actual.citas, 'n', 'De la Agenda', variacion(actual.citas, base?.citas ?? null), 'citas'),
  ]
}

/* ------------------------------------------------------------------ */
/* Los titulares                                                       */
/* ------------------------------------------------------------------ */

export type TipoDeTitular = 'bien' | 'aviso' | 'info'

export interface Titular {
  tipo: TipoDeTitular
  texto: string
}

/** Con cuántas llamadas se puede decir «tiene la mejor tasa de contacto»: con tres llamadas, el 100 % no significa nada */
export const LLAMADAS_PARA_COMPARAR_CONTACTO = 30
/** Cuánto tiene que cambiar el ritmo de una persona, y desde dónde, para que merezca un titular */
export const CAMBIO_PARA_TITULAR = 25
export const BASE_PARA_TITULAR = 20

const MAS_O_MENOS = (v: Variacion) => (v.diferencia > 0 ? 'más' : 'menos')

/** «5 puntos más que la semana anterior», para un porcentaje (el de contacto) */
export function cambioEnPuntos(v: Variacion, contra: string): string {
  if (v.sentido === 'sinBase') return ''
  if (v.sentido === 'igual') return `igual que ${contra}`
  const p = Math.round(Math.abs(v.diferencia))
  return `${p} ${p === 1 ? 'punto' : 'puntos'} ${MAS_O_MENOS(v)} que ${contra}`
}

/** «un 8 % más que la semana anterior», «3 menos que la semana anterior», «igual que la semana anterior» */
export function cambioEnPalabras(v: Variacion, contra: string): string {
  if (v.sentido === 'sinBase') return ''
  if (v.sentido === 'igual') return `igual que ${contra}`
  if (v.texto.includes('%') && v.pct !== null) return `un ${Math.round(Math.abs(v.pct))} % ${MAS_O_MENOS(v)} que ${contra}`
  return `${Math.round(Math.abs(v.diferencia))} ${MAS_O_MENOS(v)} que ${contra}`
}

const tipoSegun = (v: Variacion): TipoDeTitular => (v.sentido === 'sube' ? 'bien' : v.sentido === 'baja' ? 'aviso' : 'info')

/** «José», «José y Ana», «José, Ana y Eva» */
export function listaEnPalabras(nombres: readonly string[]): string {
  if (nombres.length <= 1) return nombres[0] ?? ''
  return `${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}`
}

/** «el lunes», «el lunes y el miércoles» */
function diasEnPalabras(dias: readonly string[]): string {
  return listaEnPalabras(dias.map((d) => `el ${nombreDelDia(d)}`))
}

const primerNombre = (nombre: string) => nombre.trim().split(/\s+/)[0] || nombre

export function titulares(resultados: readonly ResultadoSemanal[], semana: Semana): Titular[] {
  const salida: Titular[] = []
  // Una semana en curso se compara con el MISMO tramo de la anterior, y las frases lo dicen: «en los mismos días de…»
  const enCurso = semana.comparacion !== null && semana.comparacion.texto !== 'la semana anterior'
  // Hoy todavía no ha acabado: por la mañana cualquier semana en curso «baja» frente a días enteros
  const hoyAMedias = enCurso && semana.contieneHoy && !semana.completa
  const contra = enCurso ? 'en los mismos días de la semana anterior' : 'la semana anterior'
  const equipo = resultadoDelEquipo(resultados)
  const { actual, base } = equipo
  const conActividad = resultados.filter((r) => hayActividad(r.actual))

  // 1. Las llamadas del equipo
  if (semana.transcurridos > 0) {
    const v = variacion(actual.llamadas, base?.llamadas ?? null)
    const cambio = cambioEnPalabras(v, contra)
    if (actual.llamadas === 0) salida.push({ tipo: 'aviso', texto: enCurso ? 'El equipo todavía no ha hecho ninguna llamada.' : 'El equipo no hizo ninguna llamada.' })
    else salida.push({ tipo: tipoSegun(v), texto: `El equipo ${enCurso ? 'lleva' : 'hizo'} ${n(actual.llamadas)} ${actual.llamadas === 1 ? 'llamada' : 'llamadas'}${cambio ? `, ${cambio}` : ''}.${hoyAMedias ? ' Hoy todavía no ha acabado.' : ''}` })
  }

  // 2. Cuántas se contestaron
  if (actual.llamadas >= LLAMADAS_PARA_COMPARAR_CONTACTO) {
    const tasa = contacto(actual)
    const v = base ? variacionDePuntos(tasa, contacto(base)) : null
    const cambio = v ? cambioEnPuntos(v, contra) : ''
    salida.push({ tipo: v ? tipoSegun(v) : 'info', texto: `Se contestó el ${Math.round(tasa * 100)} % de las llamadas${cambio ? `, ${cambio}` : ''}.` })
  }

  // 3. Lo que se habló
  if (actual.conversaciones > 0) {
    salida.push({
      tipo: 'info',
      texto: `Hubo ${n(actual.conversaciones)} ${actual.conversaciones === 1 ? 'conversación' : 'conversaciones'} de más de un minuto y ${tiempoHablado(actual.segundos)} al teléfono.`,
    })
  }

  // 4. Lo que se consiguió: citas y respuestas
  if (semana.transcurridos > 0 && (actual.llamadas > 0 || actual.citas > 0 || actual.respuestas > 0)) {
    const v = variacion(actual.citas, base?.citas ?? null)
    // «Ninguna cita, igual que la semana anterior» no dice nada que no diga ya «ninguna cita»
    const cambio = actual.citas === 0 && v.sentido === 'igual' ? '' : cambioEnPalabras(v, contra)
    const citas = `${actual.citas === 0 ? 'No se agendó ninguna cita' : `Se ${actual.citas === 1 ? 'agendó 1 cita' : `agendaron ${n(actual.citas)} citas`}`}${cambio ? ` (${cambio})` : ''}`
    const respuestas = actual.respuestas === 0 ? 'ningún cliente contestó' : `${n(actual.respuestas)} ${actual.respuestas === 1 ? 'cliente contestó' : 'clientes contestaron'}`
    const tipo: TipoDeTitular = actual.citas === 0 && actual.llamadas >= 50 ? 'aviso' : actual.citas > 0 ? (v.sentido === 'baja' ? 'info' : 'bien') : 'info'
    salida.push({ tipo, texto: `${citas}; ${respuestas}.` })
  }

  // 5. Quién destaca
  const conLlamadas = resultados.filter((r) => r.actual.llamadas > 0)
  if (conLlamadas.length >= 2) {
    const mas = [...conLlamadas].sort((a, b) => b.actual.llamadas - a.actual.llamadas || a.persona.nombre.localeCompare(b.persona.nombre))[0]
    salida.push({ tipo: 'info', texto: `Quien más llamó fue ${mas.persona.nombre}, con ${n(mas.actual.llamadas)} llamadas.` })
    const aptos = conLlamadas.filter((r) => r.actual.llamadas >= LLAMADAS_PARA_COMPARAR_CONTACTO)
    if (aptos.length >= 2) {
      const mejor = [...aptos].sort((a, b) => contacto(b.actual) - contacto(a.actual) || a.persona.nombre.localeCompare(b.persona.nombre))[0]
      salida.push({ tipo: 'info', texto: `La mejor tasa de contacto fue la de ${mejor.persona.nombre}: ${Math.round(contacto(mejor.actual) * 100)} % de ${n(mejor.actual.llamadas)} llamadas.` })
    }
  }

  // 6. Quién ha cambiado mucho de ritmo frente a la referencia
  for (const r of conLlamadas) {
    if (!r.base || r.base.llamadas < BASE_PARA_TITULAR) continue
    const v = variacion(r.actual.llamadas, r.base.llamadas)
    if (v.pct === null || Math.abs(v.pct) < CAMBIO_PARA_TITULAR) continue
    const nombre = primerNombre(r.persona.nombre)
    salida.push({
      tipo: v.sentido === 'sube' ? 'bien' : 'aviso',
      texto: `${nombre} ${v.sentido === 'sube' ? 'subió' : 'bajó'} un ${Math.round(Math.abs(v.pct))} % sus llamadas (de ${n(r.base.llamadas)} a ${n(r.actual.llamadas)}).`,
    })
  }

  // 7. El día más flojo y el mejor del equipo (solo si hay días laborables suficientes para hablar de «un día flojo»).
  // Hoy no entra: el día no ha acabado y por la mañana cualquiera sería «el más flojo»
  const laborables = semana.dias.map((d, i) => ({ dia: d, llamadas: equipo.dias[i].llamadas })).filter((x) => esLaborable(x.dia) && x.dia < semana.hoy)
  if (laborables.length >= 3 && actual.llamadas > 0) {
    const media = laborables.reduce((s, x) => s + x.llamadas, 0) / laborables.length
    const peor = laborables.reduce((m, x) => (x.llamadas < m.llamadas ? x : m))
    const mejor = laborables.reduce((m, x) => (x.llamadas > m.llamadas ? x : m))
    if (media > 0 && peor.llamadas < media * 0.75) {
      salida.push({ tipo: 'aviso', texto: `El día más flojo fue el ${nombreDelDia(peor.dia)}: ${n(peor.llamadas)} llamadas, un ${Math.round((1 - peor.llamadas / media) * 100)} % menos que la media de la semana.` })
    }
    if (media > 0 && mejor.llamadas > media * 1.25) {
      salida.push({ tipo: 'info', texto: `El mejor día fue el ${nombreDelDia(mejor.dia)}: ${n(mejor.llamadas)} llamadas, un ${Math.round((mejor.llamadas / media - 1) * 100)} % más que la media de la semana.` })
    }
  }

  // 8. Quién no tiene Rinkel y quién no ha registrado nada
  const sinRinkel = resultados.filter((r) => !r.persona.vinculado)
  if (sinRinkel.length > 0) {
    const nombres = listaEnPalabras(sinRinkel.map((r) => r.persona.nombre))
    salida.push({ tipo: 'aviso', texto: `${nombres} ${sinRinkel.length === 1 ? 'no tiene' : 'no tienen'} Rinkel vinculado: sus llamadas no se cuentan.` })
  }
  if (semana.transcurridos >= 2) {
    const vacios = resultados.filter((r) => r.persona.vinculado && !hayActividad(r.actual))
    if (vacios.length > 0) {
      const verbo = enCurso ? (vacios.length === 1 ? 'ha registrado' : 'han registrado') : vacios.length === 1 ? 'registró' : 'registraron'
      salida.push({ tipo: 'aviso', texto: `${listaEnPalabras(vacios.map((r) => r.persona.nombre))} no ${verbo} nada ${enCurso ? 'en lo que va de semana' : 'en toda la semana'}.` })
    }
  }

  // 9. Días laborables en blanco de quien sí trabajó el resto de la semana (puede ser una baja o vacaciones: se dice, no se juzga)
  for (const r of conActividad) {
    if (!r.persona.vinculado) continue
    const enBlanco = semana.dias.filter((d, i) => esLaborable(d) && d <= semana.hoy && !hayActividad(r.dias[i]))
    // Un hueco de hoy no es un hueco: el día no ha acabado
    const sinHoy = enBlanco.filter((d) => d !== semana.hoy)
    if (sinHoy.length > 0) {
      salida.push({ tipo: 'info', texto: `${primerNombre(r.persona.nombre)} no registró actividad ${diasEnPalabras(sinHoy)}.` })
    }
  }

  return salida
}

/* ------------------------------------------------------------------ */
/* El mapa de franjas horarias                                         */
/* ------------------------------------------------------------------ */

export interface CeldaHoraria {
  hechas: number
  contestadas: number
}

export interface MapaHorario {
  /** Las horas que se dibujan, de la primera a la última, en horas enteras (9 = de 9:00 a 9:59) */
  horas: number[]
  filas: Array<{ dia: string; celdas: CeldaHoraria[]; total: number }>
  /** Lo más que hay en una celda: lo que pinta de más oscuro */
  maximo: number
  total: number
}

export interface LlamadaParaMapa {
  fecha: string
  direccion: string
  estado: string
  duracion_s: number
}

export const VENTANA_HORARIA = { desde: 9, hasta: 18 }

/**
 * En qué horas se llama: una fila por día y una columna por hora de Madrid, con las llamadas HECHAS en cada una y
 * cuántas se contestaron. Se enseñan de 9 a 18 como mínimo y más si hay llamadas fuera de ese horario.
 */
export function mapaHorario(llamadas: readonly LlamadaParaMapa[], dias: readonly string[], ventana: { desde: number; hasta: number } = VENTANA_HORARIA): MapaHorario {
  const delRango = new Set(dias)
  const porDia = new Map<string, Map<number, CeldaHoraria>>()
  let primera = ventana.desde
  let ultima = ventana.hasta
  for (const l of llamadas) {
    if (l.direccion !== 'outbound') continue
    const dia = diaMadrid(l.fecha)
    if (!delRango.has(dia)) continue
    const hora = Number(horaMadrid(l.fecha).slice(0, 2))
    primera = Math.min(primera, hora)
    ultima = Math.max(ultima, hora)
    let horas = porDia.get(dia)
    if (!horas) {
      horas = new Map()
      porDia.set(dia, horas)
    }
    const celda = horas.get(hora) ?? { hechas: 0, contestadas: 0 }
    celda.hechas += 1
    if (estaContestada(l)) celda.contestadas += 1
    horas.set(hora, celda)
  }
  const horas = Array.from({ length: ultima - primera + 1 }, (_, i) => primera + i)
  let maximo = 0
  let total = 0
  const filas = dias.map((dia) => {
    const mapa = porDia.get(dia)
    const celdas = horas.map((h) => mapa?.get(h) ?? { hechas: 0, contestadas: 0 })
    const suma = celdas.reduce((s, c) => s + c.hechas, 0)
    for (const c of celdas) maximo = Math.max(maximo, c.hechas)
    total += suma
    return { dia, celdas, total: suma }
  })
  return { horas, filas, maximo, total }
}

export interface FranjaDestacada {
  /** La hora entera, 11 = de 11:00 a 11:59 */
  hora: number
  hechas: number
  contestadas: number
  /** Contestadas entre hechas, de 0 a 1 */
  tasa: number
}

/** Con menos llamadas que esto en una franja, su tasa de contacto no dice nada: con 3 llamadas, un 100 % es casualidad */
export const LLAMADAS_PARA_FRANJA = 10

/**
 * En qué horas se llama más y en cuáles se contesta más, sumando todos los días del mapa. La segunda solo entre las
 * franjas con llamadas suficientes. null si no hay nada que decir.
 */
export function franjasDestacadas(mapa: MapaHorario, minimo = LLAMADAS_PARA_FRANJA): { masLlamadas: FranjaDestacada | null; masContacto: FranjaDestacada | null } {
  const franjas: FranjaDestacada[] = mapa.horas.map((hora, i) => {
    const hechas = mapa.filas.reduce((s, f) => s + f.celdas[i].hechas, 0)
    const contestadas = mapa.filas.reduce((s, f) => s + f.celdas[i].contestadas, 0)
    return { hora, hechas, contestadas, tasa: hechas === 0 ? 0 : contestadas / hechas }
  })
  const conLlamadas = franjas.filter((f) => f.hechas > 0)
  const masLlamadas = conLlamadas.reduce<FranjaDestacada | null>((m, f) => (m === null || f.hechas > m.hechas ? f : m), null)
  const masContacto = conLlamadas.filter((f) => f.hechas >= minimo).reduce<FranjaDestacada | null>((m, f) => (m === null || f.tasa > m.tasa ? f : m), null)
  return { masLlamadas, masContacto }
}

/** Qué intensidad de color le toca a una celda, de 0 a 4 (0 = nada) */
export function intensidadDeCelda(valor: number, maximo: number): 0 | 1 | 2 | 3 | 4 {
  if (valor <= 0 || maximo <= 0) return 0
  const p = valor / maximo
  return p > 0.75 ? 4 : p > 0.5 ? 3 : p > 0.25 ? 2 : 1
}

/* ------------------------------------------------------------------ */
/* El horario de cada persona                                          */
/* ------------------------------------------------------------------ */

export interface HorarioDeDia {
  dia: string
  /** «09:12», o null si ese día no hay nada */
  primera: string | null
  ultima: string | null
  eventos: number
  /** El hueco más largo sin actividad, en minutos (0 si no hay ninguno de media hora o más) */
  pausaMasLarga: number
}

export interface HorarioSemanal {
  dias: HorarioDeDia[]
  /** La hora a la que suele empezar y acabar, de media de los días con actividad de verdad; null si no hay ninguno */
  inicioMedio: string | null
  finMedio: string | null
  diasConActividad: number
}

/** Con menos de esto un día no se cuenta para la media de horario: una nota suelta a las diez de la noche no es una jornada */
export const EVENTOS_DE_UNA_JORNADA = 5

export function horarioSemanal(eventosPorDia: ReadonlyMap<string, readonly EventoDeLinea[]>, dias: readonly string[]): HorarioSemanal {
  const horario: HorarioDeDia[] = dias.map((dia) => {
    const eventos = [...(eventosPorDia.get(dia) ?? [])].sort((a, b) => a.minuto - b.minuto)
    const resumen = resumenDeLinea(eventos, pausasDe(eventos))
    return { dia, primera: resumen.primera, ultima: resumen.ultima, eventos: eventos.length, pausaMasLarga: resumen.pausaMasLarga?.minutos ?? 0 }
  })
  const jornadas = horario.filter((h) => h.eventos >= EVENTOS_DE_UNA_JORNADA && h.primera && h.ultima)
  const media = (horas: Array<string | null>) => (jornadas.length === 0 ? null : horaDeMinuto(Math.round(horas.reduce((s, h) => s + minutoDeLaHora(h as string), 0) / jornadas.length)))
  return {
    dias: horario,
    inicioMedio: media(jornadas.map((h) => h.primera)),
    finMedio: media(jornadas.map((h) => h.ultima)),
    diasConActividad: jornadas.length,
  }
}

/** «1 h 05 min», para el hueco más largo; «—» si no hubo ninguno */
export const textoDePausa = (minutos: number): string => (minutos > 0 ? textoDeMinutos(minutos) : '—')

