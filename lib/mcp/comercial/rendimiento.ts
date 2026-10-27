import { isMissingSchema } from '@/lib/plataforma/eventos'
import { agruparConversaciones, ETIQUETA_DE_CANAL, etiquetaDeEstadoDeCita, type CitaDeActividad, type NotaDeActividad } from '@/lib/rendimiento/actividad'
import {
  baseDe,
  hayActividad,
  indexar,
  llamadasPorDiaLaborable,
  sumarTotales,
  totalesDeRango,
  tramosDeComparacion,
  variacion,
  ventanaDeDatos,
  type Comparacion,
  type FilaDiaria,
  type Totales,
} from '@/lib/rendimiento/comparativa'
import { diaMadrid, horaMadrid, hoyMadrid } from '@/lib/rendimiento/dia'
import { resultadoSemanal, semanaDe, titulares } from '@/lib/rendimiento/informe'
import { desgloseDeLlamadas, eventosDeLinea, horaDeMinuto, minutoDeLaHora, pausasDe, resumenDeLinea, type LlamadaParaLinea } from '@/lib/rendimiento/linea'
import { SEGUNDOS_DE_CONVERSACION, esContestador, estaContestada } from '@/lib/rendimiento/metricas'
import { diasDelRango, empiezaEnElFuturo, etiquetaDePeriodo, laborablesTranscurridos, nombreDelDia, rangoDe, type Periodo, type TipoDePeriodo } from '@/lib/rendimiento/periodos'
import { telefonoLegible } from '@/lib/rendimiento/telefonos'
import { urlBaseApp } from '@/lib/url-app'
import { aTexto, booleano, entero, opcion, texto } from '../argumentos'
import { ErrorDeHerramienta, type Herramienta } from '../protocolo'
import type { ContextoMcp, Servicio } from '../contexto'
import {
  aMinutos,
  diaArg,
  elegirPersona,
  equipoComercial,
  fechaHora,
  fetchAll,
  instantesDe,
  nombresDeLeads,
  recortar,
  servicioDe,
  trocear,
  type NombreDeLead,
  type Persona,
} from './comun'

/**
 * MI RENDIMIENTO, PARA CLAUDE: LAS MISMAS CIFRAS QUE LA PANTALLA, Y TODO LO QUE HAY DETRÁS DE CADA UNA.
 * SOLO SERVIDOR. Los cálculos puros (`armar…`) se prueban en rendimiento.prueba.ts; esto solo lee y los llama.
 *
 * Las cifras NO se recalculan aquí: salen de la función de la base `rendimiento_resumen_diario` (migraciones 235 y 252) y de las funciones de lib/rendimiento
 * que ya usa la pantalla (comparativa, informe, línea del día, actividad). Así lo que dice Claude y lo que ve Raúl en Mi rendimiento no se pueden contradecir.
 *
 * Las reglas de cada cifra (las repite el campo `reglas` de la respuesta, para que quien lee no las adivine):
 *   · LLAMADAS HECHAS = clientes distintos a los que se llamó ese día (llamar tres veces al mismo cliente el mismo día es UNA); `intentos` son las salientes sin agrupar.
 *   · CONTESTADA = el cliente descolgó y la llamada duró 10 segundos o más (un contestador no cuenta). CONVERSACIÓN = contestada de 60 segundos o más.
 *   · WHATSAPP y CORREOS = clientes distintos con los que se habló por ese canal ese día (los apuntes de Cold Calling); `…_apuntes` son los apuntes sueltos.
 *   · RESPUESTAS = clientes que contestaron (nota marcada «es una respuesta del cliente»). CITAS = las que ese comercial AGENDÓ ese día (no las que tienen la reunión ese día).
 *   · Las llamadas solo se leen de quien tiene su Rinkel vinculado: sin él, sus llamadas no cuentan.
 */

export const REGLAS_DE_LAS_CIFRAS = [
  'llamadas_hechas = clientes distintos a los que se llamó ese día (varios intentos al mismo cliente el mismo día cuentan una vez); intentos = las llamadas salientes sin agrupar.',
  'contestada = el cliente descolgó y duró 10 s o más; conversación = contestada de 60 s o más; tiempo_al_telefono = solo llamadas contestadas.',
  'whatsapp y correos = clientes distintos con los que se habló por ese canal ese día según lo apuntado en Cold Calling; respuestas = clientes que contestaron.',
  'citas_agendadas = las que ese comercial creó ese día en la Agenda (no las que tienen la reunión ese día).',
  'Los días son los de Madrid. Un comercial sin Rinkel vinculado no tiene llamadas en estas cifras.',
]

/* ------------------------------------------------------------------ */
/* Los tipos                                                           */
/* ------------------------------------------------------------------ */

export interface VinculoDeRinkel {
  user_id: string
  rinkel_usuario: string | null
  ultimo_sync_at: string | null
  ultimo_intento_at: string | null
  ultimo_error: string | null
  historico_completo: boolean | null
}

const redondear = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d

/** Las cifras de un periodo, con los nombres de la pantalla */
export function cifrasDe(t: Totales): Record<string, number | null> {
  return {
    llamadas_hechas: t.llamadas,
    intentos: t.intentos,
    recibidas: t.recibidas,
    contestadas: t.contestadas,
    tasa_de_contacto_pct: t.llamadas > 0 ? Math.round((t.contestadas / t.llamadas) * 100) : null,
    conversaciones: t.conversaciones,
    tiempo_al_telefono_min: aMinutos(t.segundos),
    whatsapp: t.whatsapp,
    whatsapp_apuntes: t.whatsappApuntes,
    correos: t.correos,
    correos_apuntes: t.correosApuntes,
    respuestas: t.respuestas,
    citas_agendadas: t.citas,
  }
}

/** Cuánto ha cambiado cada cifra frente a la referencia («+12 %», «−3», «igual», «sin referencia»). Sin referencia, todo «sin referencia» */
export function cambiosDe(actual: Totales, base: Totales | null): Record<string, string> {
  const v = (a: number, b: number | null) => variacion(a, b).texto
  const b = base
  return {
    llamadas_hechas: v(actual.llamadas, b?.llamadas ?? null),
    contestadas: v(actual.contestadas, b?.contestadas ?? null),
    conversaciones: v(actual.conversaciones, b?.conversaciones ?? null),
    tiempo_al_telefono: v(actual.segundos, b?.segundos ?? null),
    whatsapp: v(actual.whatsapp, b?.whatsapp ?? null),
    correos: v(actual.correos, b?.correos ?? null),
    respuestas: v(actual.respuestas, b?.respuestas ?? null),
    citas_agendadas: v(actual.citas, b?.citas ?? null),
  }
}

/* ------------------------------------------------------------------ */
/* El periodo pedido                                                   */
/* ------------------------------------------------------------------ */

export interface PeriodoPedido {
  periodo: Periodo
  comparacion: Comparacion
  /** «Hoy · martes 27 de octubre», «Semana pasada · 19–25 oct» */
  etiqueta: string
  /** Los días que cubre (sin pasar de hoy) */
  desde: string
  hasta: string
  laborables: number
}

/** El periodo de los argumentos. Uno que todavía no ha empezado es un error: no hay nada que contar */
export function periodoDe(args: Record<string, unknown>, hoy: string): PeriodoPedido {
  const tipo = opcion<TipoDePeriodo>(args, 'periodo', ['dia', 'semana', 'mes'], 'dia')
  const ancla = diaArg(args, 'fecha', { hoy }) ?? hoy
  const periodo: Periodo = { tipo, ancla }
  if (empiezaEnElFuturo(periodo, hoy)) throw new ErrorDeHerramienta(`Ese ${tipo === 'dia' ? 'día' : tipo} todavía no ha empezado (hoy es ${hoy}): no hay nada que contar.`)
  const comparacion = tramosDeComparacion(periodo, hoy)
  if (!comparacion) throw new ErrorDeHerramienta('Ese periodo todavía no ha empezado: no hay nada que contar.')
  return {
    periodo,
    comparacion,
    etiqueta: etiquetaDePeriodo(periodo, hoy),
    desde: comparacion.actual.desde,
    hasta: comparacion.actual.hasta,
    laborables: laborablesTranscurridos(rangoDe(periodo), hoy),
  }
}

/* ------------------------------------------------------------------ */
/* El resumen del equipo                                               */
/* ------------------------------------------------------------------ */

/** Más de este tiempo sin leer su Rinkel y las cifras de hoy pueden estar incompletas */
export const HORAS_SIN_LEER_PARA_AVISAR = 3

export interface EntradaDelEquipo {
  periodo: PeriodoPedido
  hoy: string
  ahora: number
  equipo: readonly Persona[]
  vinculos: ReadonlyMap<string, VinculoDeRinkel>
  filas: readonly FilaDiaria[]
  desglose: boolean
  /** La base de las direcciones del ERP, sin barra final */
  base: string
}

export function estadoDeRinkel(v: VinculoDeRinkel | undefined, ahora: number): { vinculado: boolean; ultima_lectura: string | null; error: string | null; aviso: string | null } {
  if (!v) return { vinculado: false, ultima_lectura: null, error: null, aviso: 'No tiene el Rinkel vinculado: sus llamadas no cuentan.' }
  const lectura = v.ultimo_sync_at ? Date.parse(v.ultimo_sync_at) : null
  const horas = lectura === null ? null : (ahora - lectura) / 3_600_000
  let aviso: string | null = null
  if (v.ultimo_error) aviso = 'La última lectura de su Rinkel falló: las llamadas más recientes pueden faltar.'
  else if (lectura === null) aviso = 'Todavía no se ha leído su Rinkel.'
  else if (horas !== null && horas >= HORAS_SIN_LEER_PARA_AVISAR) aviso = `Su Rinkel no se lee desde hace ${Math.floor(horas)} h: las llamadas más recientes pueden faltar.`
  return { vinculado: true, ultima_lectura: fechaHora(v.ultimo_sync_at), error: v.ultimo_error ? v.ultimo_error.slice(0, 200) : null, aviso }
}

export function armarEquipo(e: EntradaDelEquipo): Record<string, unknown> {
  const { periodo, hoy, ahora } = e
  const porPersona = indexar(e.filas)
  const personas = e.equipo.map((p) => {
    const porDia = porPersona.get(p.id)
    const actual = totalesDeRango(porDia, periodo.comparacion.actual)
    const base = baseDe(porDia, periodo.comparacion)
    return { p, porDia, actual, base, rinkel: estadoDeRinkel(e.vinculos.get(p.id), ahora) }
  })

  const total = sumarTotales(personas.map((x) => x.actual))
  const bases = personas.map((x) => x.base).filter((b): b is Totales => b !== null)
  const totalBase = bases.length === 0 ? null : sumarTotales(bases)

  const comerciales = personas.map((x) => ({
    comercial: x.p.nombre,
    id: x.p.id,
    ...cifrasDe(x.actual),
    llamadas_por_dia_laborable: periodo.laborables > 0 ? redondear(llamadasPorDiaLaborable(x.actual.llamadas, periodo.comparacion.actual, hoy)) : null,
    sin_actividad: !hayActividad(x.actual),
    cambio_frente_a_la_referencia: cambiosDe(x.actual, x.base),
    rinkel: x.rinkel,
    enlace: enlaceDeRendimiento(e.base, x.p.id, periodo.periodo),
  }))

  const alertas: string[] = []
  for (const x of personas) if (x.rinkel.aviso) alertas.push(`${x.p.nombre}: ${x.rinkel.aviso}`)
  const sinActividad = personas.filter((x) => x.rinkel.vinculado && !hayActividad(x.actual)).map((x) => x.p.nombre)
  if (sinActividad.length > 0 && periodo.laborables > 0) alertas.push(`Sin actividad registrada en el periodo: ${sinActividad.join(', ')}.`)

  const salida: Record<string, unknown> = {
    periodo: {
      tipo: periodo.periodo.tipo,
      etiqueta: periodo.etiqueta,
      desde: periodo.desde,
      hasta: periodo.hasta,
      dias_laborables_transcurridos: periodo.laborables,
      en_curso: periodo.periodo.tipo !== 'dia' ? periodo.hasta === hoy && rangoDe(periodo.periodo).hasta > hoy : periodo.hasta === hoy,
    },
    con_que_se_compara: periodo.comparacion.texto,
    equipo: {
      ...cifrasDe(total),
      llamadas_por_dia_laborable: periodo.laborables > 0 ? redondear(llamadasPorDiaLaborable(total.llamadas, periodo.comparacion.actual, hoy)) : null,
      cambio_frente_a_la_referencia: cambiosDe(total, totalBase),
    },
    comerciales,
    alertas,
    reglas: REGLAS_DE_LAS_CIFRAS,
  }

  if (periodo.periodo.tipo === 'semana') {
    const semana = semanaDe(periodo.periodo.ancla, hoy)
    const resultados = personas.map((x) => resultadoSemanal({ id: x.p.id, nombre: x.p.nombre, vinculado: x.rinkel.vinculado }, x.porDia, semana))
    salida.titulares = titulares(resultados, semana).map((t) => ({ tipo: t.tipo, texto: t.texto }))
  }

  if (e.desglose) {
    const dias = diasDelRango(periodo.comparacion.actual)
    salida.por_dia = dias
      .map((dia) => {
        const celdas = personas.map((x) => ({ x, t: totalesDeRango(x.porDia, { desde: dia, hasta: dia }) }))
        const activos = celdas.filter((c) => hayActividad(c.t))
        if (activos.length === 0) return null
        const suma = sumarTotales(celdas.map((c) => c.t))
        return {
          dia,
          dia_de_la_semana: nombreDelDia(dia),
          equipo: resumenCorto(suma),
          comerciales: Object.fromEntries(activos.map((c) => [c.x.p.nombre, resumenCorto(c.t)])),
        }
      })
      .filter((d) => d !== null)
  }

  return salida
}

/** Las cifras de un día en una línea corta de objeto: solo lo que no es cero */
export function resumenCorto(t: Totales): Record<string, number> {
  const campos: Array<[string, number]> = [
    ['llamadas_hechas', t.llamadas],
    ['intentos', t.intentos],
    ['recibidas', t.recibidas],
    ['contestadas', t.contestadas],
    ['conversaciones', t.conversaciones],
    ['tiempo_al_telefono_min', aMinutos(t.segundos)],
    ['whatsapp', t.whatsapp],
    ['correos', t.correos],
    ['respuestas', t.respuestas],
    ['citas_agendadas', t.citas],
  ]
  return Object.fromEntries(campos.filter(([, v]) => v > 0))
}

/** La pantalla de Mi rendimiento de esa persona y ese periodo */
export function enlaceDeRendimiento(base: string, comercialId: string, p: Periodo): string {
  return `${base.replace(/\/+$/, '')}/dashboard/rendimiento?comercial=${comercialId}&p=${p.tipo}&f=${p.ancla}`
}

/* ------------------------------------------------------------------ */
/* El detalle de una persona                                           */
/* ------------------------------------------------------------------ */

export interface LlamadaLeida extends LlamadaParaLinea {
  numero_anonimo: boolean
  grabacion_id: string | null
}

export interface NotaLeida extends NotaDeActividad {
  author_id: string | null
}

export interface CitaLeida extends CitaDeActividad {
  comercial_id: string | null
}

export interface TranscripcionResumida {
  llamada_id: string
  estado: string
  tipo: string | null
  resumen: string | null
  siguiente_paso: string | null
  interes: string | null
}

export interface EntradaDelComercial {
  periodo: PeriodoPedido
  hoy: string
  ahora: number
  persona: Persona
  vinculo: VinculoDeRinkel | undefined
  filas: readonly FilaDiaria[]
  llamadas: readonly LlamadaLeida[]
  notas: readonly NotaLeida[]
  citas: readonly CitaLeida[]
  nombres: ReadonlyMap<string, NombreDeLead>
  transcripciones: ReadonlyMap<string, TranscripcionResumida>
  maxConversaciones: number
  maxLlamadas: number
  base: string
}

const MAX_INTERACCIONES_POR_CONVERSACION = 6

function nombreDelCliente(nombres: ReadonlyMap<string, NombreDeLead>, id: string | null): string | null {
  if (!id) return null
  const n = nombres.get(id)
  return n ? (n.empresa && n.empresa !== n.nombre ? `${n.nombre} (${n.empresa})` : n.nombre) : null
}

export function resultadoDeLlamada(l: LlamadaParaLinea): string {
  const entrante = l.direccion === 'inbound'
  if (estaContestada(l)) return l.duracion_s >= SEGUNDOS_DE_CONVERSACION ? (entrante ? 'conversación (recibida)' : 'conversación') : entrante ? 'recibida y contestada' : 'contestada (corta)'
  if (esContestador(l)) return entrante ? 'perdida' : 'contestador'
  return entrante ? 'perdida' : 'sin contestar'
}

export function armarComercial(e: EntradaDelComercial): Record<string, unknown> {
  const { periodo, hoy, ahora, persona } = e
  const porDia = indexar(e.filas).get(persona.id)
  const actual = totalesDeRango(porDia, periodo.comparacion.actual)
  const base = baseDe(porDia, periodo.comparacion)
  const rinkel = estadoDeRinkel(e.vinculo, ahora)
  const cliente = (id: string): string | null => nombreDelCliente(e.nombres, id)

  // Lo de cada día, para la línea de la jornada: cuándo empezó, cuándo acabó y dónde hubo huecos
  const dias = diasDelRango(periodo.comparacion.actual)
  const ahoraMin = minutoDeLaHora(horaMadrid(ahora))
  const porDiaDeLlamada = agrupar(e.llamadas, (l) => diaMadrid(l.fecha))
  const porDiaDeNota = agrupar(e.notas, (n) => diaMadrid(n.occurred_at))
  const porDiaDeCita = agrupar(e.citas, (c) => diaMadrid(c.created_at))

  const jornadas = dias
    .map((dia) => {
      const t = totalesDeRango(porDia, { desde: dia, hasta: dia })
      const eventos = eventosDeLinea({ llamadas: porDiaDeLlamada.get(dia) ?? [], notas: porDiaDeNota.get(dia) ?? [], citas: porDiaDeCita.get(dia) ?? [], cliente })
      if (!hayActividad(t) && eventos.length === 0) return null
      const pausas = pausasDe(eventos, { ahora: dia === hoy ? ahoraMin : null })
      const r = resumenDeLinea(eventos, pausas)
      return {
        dia,
        dia_de_la_semana: nombreDelDia(dia),
        ...resumenCorto(t),
        primera_actividad: r.primera,
        ultima_actividad: r.ultima,
        minutos_entre_la_primera_y_la_ultima: r.tramoActivo,
        pausas_de_30_min_o_mas: pausas.map((p) => ({ de: horaDeMinuto(p.desde), a: p.enCurso ? 'ahora' : horaDeMinuto(p.hasta), minutos: p.minutos })),
        desglose_de_llamadas: desgloseDeLlamadas(r.llamadas) || null,
      }
    })
    .filter((j) => j !== null)

  // Cómo han ido las llamadas, una por una (las salientes y las recibidas)
  const salientes = e.llamadas.filter((l) => l.direccion === 'outbound')
  const resumenLlamadas = {
    salientes: salientes.length,
    contestadas: salientes.filter(estaContestada).length,
    contestador: salientes.filter(esContestador).length,
    sin_contestar: salientes.filter((l) => !estaContestada(l) && !esContestador(l)).length,
    recibidas: e.llamadas.filter((l) => l.direccion === 'inbound').length,
    conversaciones_de_un_minuto_o_mas: e.llamadas.filter((l) => estaContestada(l) && l.duracion_s >= SEGUNDOS_DE_CONVERSACION).length,
    con_grabacion: e.llamadas.filter((l) => l.grabacion_id).length,
  }

  // Las llamadas en las que se habló de verdad (las más recientes primero), con lo que se entendió de ellas si ya está transcrita
  const habladas = e.llamadas.filter((l) => estaContestada(l) && l.duracion_s >= SEGUNDOS_DE_CONVERSACION).sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0))
  const llamadasConversadas = habladas.slice(0, e.maxLlamadas).map((l) => {
    const t = e.transcripciones.get(l.id)
    return {
      llamada_id: l.id,
      cuando: fechaHora(l.fecha),
      sentido: l.direccion === 'inbound' ? 'recibida' : 'saliente',
      cliente: nombreDelCliente(e.nombres, l.lead_id) ?? (l.numero ? telefonoLegible(l.numero) : 'número oculto'),
      minutos: aMinutos(l.duracion_s),
      grabacion: l.grabacion_id ? 'sí' : 'no',
      lo_que_se_entendio: t && t.estado === 'hecha' ? { resumen: recortar(t.resumen, 320), interes: t.interes, siguiente_paso: recortar(t.siguiente_paso, 200) } : null,
    }
  })

  // Lo que se apuntó en Cold Calling, cliente a cliente (WhatsApp, correos, LinkedIn, notas), con lo que dijo cada uno
  const conversaciones = agruparConversaciones(e.notas).sort((a, b) => (a.dia === b.dia ? (a.desde < b.desde ? 1 : -1) : a.dia < b.dia ? 1 : -1))
  const actividad = conversaciones.slice(0, e.maxConversaciones).map((c) => ({
    dia: c.dia,
    canal: ETIQUETA_DE_CANAL[c.canal],
    cliente: nombreDelCliente(e.nombres, c.leadId) ?? 'un cliente que ya no está',
    de: c.desde,
    a: c.hasta,
    apuntes: c.interacciones.length,
    el_cliente_contesto: c.hayRespuesta,
    comentarios: c.interacciones.slice(0, MAX_INTERACCIONES_POR_CONVERSACION).map((i) => `${i.hora}${i.esRespuesta ? ' (respuesta del cliente)' : ''}: ${recortar(i.texto, 220) ?? '(sin texto)'}`),
    hay_mas_comentarios: c.interacciones.length > MAX_INTERACCIONES_POR_CONVERSACION,
  }))

  const citas = [...e.citas]
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    .map((c) => ({
      cliente: c.lead_name,
      empresa: c.lead_company,
      agendada: fechaHora(c.created_at),
      reunion: fechaHora(c.start_time),
      estado: etiquetaDeEstadoDeCita(c.status),
    }))

  return {
    comercial: persona.nombre,
    id: persona.id,
    periodo: { tipo: periodo.periodo.tipo, etiqueta: periodo.etiqueta, desde: periodo.desde, hasta: periodo.hasta, dias_laborables_transcurridos: periodo.laborables },
    con_que_se_compara: periodo.comparacion.texto,
    cifras: cifrasDe(actual),
    cambio_frente_a_la_referencia: cambiosDe(actual, base),
    rinkel,
    jornadas,
    llamadas: resumenLlamadas,
    llamadas_con_conversacion: llamadasConversadas,
    llamadas_con_conversacion_total: habladas.length,
    actividad_por_cliente: actividad,
    actividad_por_cliente_total: conversaciones.length,
    citas_agendadas: citas,
    enlace: enlaceDeRendimiento(e.base, persona.id, periodo.periodo),
    nota:
      habladas.length > e.maxLlamadas || conversaciones.length > e.maxConversaciones
        ? 'Hay más de lo que cabe aquí: para ver todas las llamadas usa cold_llamadas y para todos los apuntes cold_notas, con el mismo comercial y las mismas fechas.'
        : null,
    reglas: REGLAS_DE_LAS_CIFRAS,
  }
}

function agrupar<T>(lista: readonly T[], clave: (x: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>()
  for (const x of lista) {
    const k = clave(x)
    const a = m.get(k)
    if (a) a.push(x)
    else m.set(k, [x])
  }
  return m
}

/* ------------------------------------------------------------------ */
/* Las lecturas                                                        */
/* ------------------------------------------------------------------ */

const QUE_FALTA_EL_RESUMEN = 'faltan las migraciones 235 y 252 (rendimiento_resumen_diario)'

/** Una fila por persona y día de la ventana: de aquí salen las cifras y la comparación */
export async function leerFilasDiarias(s: Servicio, desde: string, hasta: string): Promise<FilaDiaria[]> {
  try {
    return await fetchAll<FilaDiaria>((de, a) => s.rpc('rendimiento_resumen_diario', { p_desde: desde, p_hasta: hasta }).range(de, a))
  } catch (error) {
    if (isMissingSchema(error)) {
      throw new ErrorDeHerramienta(`Mi rendimiento todavía no está activado en la base de datos (${QUE_FALTA_EL_RESUMEN}). Hay que lanzar esas migraciones en el editor SQL de Supabase.`)
    }
    throw error
  }
}

export async function leerVinculos(s: Servicio): Promise<Map<string, VinculoDeRinkel>> {
  const { data, error } = await s.from('rinkel_vinculos').select('user_id, rinkel_usuario, ultimo_sync_at, ultimo_intento_at, ultimo_error, historico_completo')
  // Sin la tabla (migración 234) nadie tiene Rinkel: se dice en los avisos, no se falla
  if (error) {
    if (isMissingSchema(error)) return new Map()
    throw error
  }
  return new Map(((data ?? []) as VinculoDeRinkel[]).map((v) => [v.user_id, v]))
}

/* ------------------------------------------------------------------ */
/* rendimiento_equipo                                                  */
/* ------------------------------------------------------------------ */

const ESQUEMA_PERIODO = {
  type: 'string',
  enum: ['dia', 'semana', 'mes'],
  description: 'Qué se mira: un día, una semana (de lunes a domingo) o un mes natural. Por defecto, «dia».',
}
const ESQUEMA_FECHA = {
  type: 'string',
  description: 'Cualquier día del periodo, como AAAA-MM-DD, «hoy» o «ayer». Por defecto, hoy (en Madrid). Para «la semana pasada» pasa un día de esa semana.',
}

export const rendimientoEquipo: Herramienta<ContextoMcp> = {
  nombre: 'rendimiento_equipo',
  titulo: 'Mi rendimiento: cifras del equipo comercial',
  descripcion:
    'Lo que ve el equipo en «Mi rendimiento»: por cada comercial y para todo el equipo, en un día, una semana o un mes, las llamadas hechas (clientes distintos), los intentos, las contestadas, ' +
    'las conversaciones (llamadas de un minuto o más), el tiempo al teléfono, los WhatsApp y correos (clientes distintos), las respuestas de clientes y las citas agendadas, cada cifra comparada con el ' +
    'periodo anterior. Incluye avisos (alguien sin Rinkel, sin actividad o con la lectura atrasada) y, en una semana, los titulares escritos en frases. Es la herramienta para «cómo va el equipo» y ' +
    'para el recap diario de los comerciales: no hace falta pedir cada cifra aparte. Para ver con qué clientes habló una persona, qué escribió y cuándo, usa rendimiento_comercial.',
  esquema: {
    type: 'object',
    properties: {
      periodo: ESQUEMA_PERIODO,
      fecha: ESQUEMA_FECHA,
      desglose_diario: { type: 'boolean', description: 'true = añade el día a día de cada comercial (solo los días con actividad). Útil en una semana o un mes. Por defecto, false.' },
    },
    additionalProperties: false,
  },
  soloLectura: true,
  async ejecutar(args, ctx) {
    const hoy = hoyMadrid()
    const periodo = periodoDe(args, hoy)
    const desglose = booleano(args, 'desglose_diario', false)
    const s = servicioDe(ctx)
    const ventana = ventanaDeDatos(periodo.periodo)
    const [equipo, vinculos, filas] = await Promise.all([equipoComercial(s), leerVinculos(s), leerFilasDiarias(s, ventana.desde, ventana.hasta)])
    return {
      texto: aTexto(armarEquipo({ periodo, hoy, ahora: Date.now(), equipo, vinculos, filas, desglose, base: urlBaseApp() }), 30_000),
    }
  },
}

/* ------------------------------------------------------------------ */
/* rendimiento_comercial                                               */
/* ------------------------------------------------------------------ */

const CAMPOS_LLAMADA = 'id, fecha, direccion, estado, duracion_s, lead_id, numero, numero_anonimo, grabacion_id'
const CAMPOS_NOTA = 'id, author_id, kind, es_respuesta, body, occurred_at, lead_id'
const CAMPOS_CITA = 'id, comercial_id, lead_name, lead_company, start_time, status, created_at'

export async function leerDetalleDe(s: Servicio, persona: Persona, desde: string, hasta: string) {
  const { desde: d, hasta: h } = instantesDe({ desde, hasta })
  const [llamadas, notas, citas] = await Promise.all([
    fetchAll<LlamadaLeida>((de, a) => s.from('rinkel_llamadas').select(CAMPOS_LLAMADA).eq('user_id', persona.id).gte('fecha', d).lt('fecha', h).order('fecha', { ascending: true }).order('id', { ascending: true }).range(de, a)),
    fetchAll<NotaLeida>((de, a) => s.from('cold_lead_notes').select(CAMPOS_NOTA).eq('author_id', persona.id).gte('occurred_at', d).lt('occurred_at', h).order('occurred_at', { ascending: true }).order('id', { ascending: true }).range(de, a)),
    fetchAll<CitaLeida>((de, a) => s.from('appointments').select(CAMPOS_CITA).eq('comercial_id', persona.id).eq('is_external', false).gte('created_at', d).lt('created_at', h).order('created_at', { ascending: true }).order('id', { ascending: true }).range(de, a)),
  ])
  return { llamadas, notas, citas }
}

/** Lo que se entendió de las llamadas pedidas (las transcritas), por id de llamada. Sin la migración 244 no hay nada */
export async function leerTranscripciones(s: Servicio, llamadaIds: readonly string[]): Promise<Map<string, TranscripcionResumida>> {
  const salida = new Map<string, TranscripcionResumida>()
  for (const trozo of trocear([...new Set(llamadaIds)], 100)) {
    const { data, error } = await s.from('rinkel_transcripciones').select('llamada_id, estado, tipo, resumen, siguiente_paso, interes').in('llamada_id', trozo)
    if (error) {
      if (isMissingSchema(error)) return salida
      throw error
    }
    for (const t of (data ?? []) as TranscripcionResumida[]) salida.set(t.llamada_id, t)
  }
  return salida
}

export const rendimientoComercial: Herramienta<ContextoMcp> = {
  nombre: 'rendimiento_comercial',
  titulo: 'Mi rendimiento: el detalle de un comercial',
  descripcion:
    'Todo lo que hizo UN comercial en un día, una semana o un mes: sus cifras (con el cambio frente al periodo anterior), cómo fue cada jornada (a qué hora empezó y acabó, pausas de media hora o más, ' +
    'intentos y clientes), las llamadas en las que habló de verdad (con lo que se entendió de ellas si están transcritas), lo que apuntó en Cold Calling cliente a cliente (WhatsApp, correos, respuestas ' +
    'del cliente, notas) con el comentario de cada apunte, y las citas que agendó. Es el detalle que hay detrás de rendimiento_equipo. Para recorrer TODAS sus llamadas o apuntes con filtros usa cold_llamadas ' +
    'y cold_notas.',
  esquema: {
    type: 'object',
    properties: {
      comercial: { type: 'string', description: 'El comercial: su nombre (o parte, «maoli»), su correo o su id. rendimiento_equipo los lista.' },
      periodo: ESQUEMA_PERIODO,
      fecha: ESQUEMA_FECHA,
      max_apuntes: { type: 'integer', description: 'Cuántos clientes con apuntes (WhatsApp, correos…) devolver como máximo, los más recientes. Por defecto 30, hasta 80.' },
      max_llamadas: { type: 'integer', description: 'Cuántas llamadas con conversación devolver como máximo, las más recientes. Por defecto 20, hasta 60.' },
    },
    required: ['comercial'],
    additionalProperties: false,
  },
  soloLectura: true,
  async ejecutar(args, ctx) {
    const consulta = texto(args, 'comercial', { requerido: true, max: 120 })!
    const hoy = hoyMadrid()
    const periodo = periodoDe(args, hoy)
    const maxConversaciones = entero(args, 'max_apuntes', { min: 1, max: 80, defecto: 30 })
    const maxLlamadas = entero(args, 'max_llamadas', { min: 1, max: 60, defecto: 20 })
    const s = servicioDe(ctx)
    const equipo = await equipoComercial(s)
    const persona = elegirPersona(equipo, consulta)
    const ventana = ventanaDeDatos(periodo.periodo)
    const [vinculos, filas, detalle] = await Promise.all([leerVinculos(s), leerFilasDiarias(s, ventana.desde, ventana.hasta), leerDetalleDe(s, persona, periodo.desde, periodo.hasta)])

    const habladas = detalle.llamadas.filter((l) => estaContestada(l) && l.duracion_s >= SEGUNDOS_DE_CONVERSACION)
    const recientes = [...habladas].sort((a, b) => (a.fecha < b.fecha ? 1 : -1)).slice(0, maxLlamadas)
    const [nombres, transcripciones] = await Promise.all([
      nombresDeLeads(s, [...detalle.llamadas.map((l) => l.lead_id), ...detalle.notas.map((n) => n.lead_id)]),
      leerTranscripciones(s, recientes.map((l) => l.id)),
    ])

    return {
      texto: aTexto(
        armarComercial({
          periodo,
          hoy,
          ahora: Date.now(),
          persona,
          vinculo: vinculos.get(persona.id),
          filas,
          llamadas: detalle.llamadas,
          notas: detalle.notas,
          citas: detalle.citas,
          nombres,
          transcripciones,
          maxConversaciones,
          maxLlamadas,
          base: urlBaseApp(),
        }),
        32_000
      ),
    }
  },
}

export const HERRAMIENTAS_DE_RENDIMIENTO: readonly Herramienta<ContextoMcp>[] = [rendimientoEquipo, rendimientoComercial]
