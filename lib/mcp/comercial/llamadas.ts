import { isMissingSchema } from '@/lib/plataforma/eventos'
import { hoyMadrid } from '@/lib/rendimiento/dia'
import { esContestador, estaContestada, SEGUNDOS_DE_CONVERSACION } from '@/lib/rendimiento/metricas'
import { telefonoLegible } from '@/lib/rendimiento/telefonos'
import { ETIQUETA_DE_INTERES, ETIQUETA_DE_QUIEN, SEGUNDOS_MINIMOS_DE_CONVERSACION as SEGUNDOS_MINIMOS_PARA_TRANSCRIBIR } from '@/lib/transcripcion/tipos'
import { aTexto, booleano, entero, opcion, texto } from '../argumentos'
import type { ContextoMcp, Servicio } from '../contexto'
import { ErrorDeHerramienta, type Herramienta } from '../protocolo'
import { ajustarAlTamano, aMinutos, comprobar, datosDePagina, fallo, fechaHora, fetchAll, instantesDe, nombresDeLeads, paginaArg, personasPorId, rangoOUltimosDias, recortar, recortarLargo, servicioDe } from './comun'
import { comercialArg, leadsDeFiltro, llamadaParaClaude, type LlamadaDeFicha } from './leads'
import { leerTranscripciones, resultadoDeLlamada, type TranscripcionResumida } from './rendimiento'

/**
 * COLD CALLING PARA CLAUDE, SEGUNDA PARTE: LAS LLAMADAS DE RINKEL Y LO QUE SE DIJO EN ELLAS.
 * SOLO SERVIDOR; lo puro se prueba en llamadas.prueba.ts con una base en memoria.
 *
 * Las llamadas se leen de `rinkel_llamadas` (lo que sincroniza cada comercial con su cuenta de Rinkel) y se clasifican con las MISMAS reglas que Mi rendimiento
 * (lib/rendimiento/metricas.ts): «contestada» = el cliente descolgó y duró 10 s o más, «conversación» = contestada de 60 s o más, un contestador es una
 * llamada contestada de menos de 10 s. El AUDIO no se devuelve (hace falta una dirección temporal de Rinkel con la clave de cada comercial): se dice si hay
 * grabación y hasta cuándo, y lo que se dijo se lee en la transcripción, que es lo que el ERP ya guarda de cada llamada hablada.
 */

/* ------------------------------------------------------------------ */
/* cold_llamadas                                                       */
/* ------------------------------------------------------------------ */

const SENTIDOS = ['todas', 'salientes', 'recibidas'] as const
const RESULTADOS = ['todas', 'conversaciones', 'contestadas', 'sin_contestar', 'contestador', 'perdidas'] as const

export type LlamadaLeida = LlamadaDeFicha

const CAMPOS_DE_LLAMADA = 'id, user_id, fecha, direccion, estado, duracion_s, lead_id, numero, numero_anonimo, grabacion_id, grabacion_hasta'

/** ¿La llamada es del resultado pedido? Las reglas de Mi rendimiento, aplicadas al leer */
export function cumpleResultado(l: Pick<LlamadaLeida, 'direccion' | 'estado' | 'duracion_s'>, r: (typeof RESULTADOS)[number]): boolean {
  switch (r) {
    case 'todas':
      return true
    case 'conversaciones':
      return estaContestada(l) && l.duracion_s >= SEGUNDOS_DE_CONVERSACION
    case 'contestadas':
      return estaContestada(l)
    case 'contestador':
      return esContestador(l)
    case 'sin_contestar':
      return l.direccion === 'outbound' && !estaContestada(l) && !esContestador(l)
    case 'perdidas':
      return l.direccion === 'inbound' && !estaContestada(l)
  }
}

export function resumenDeLlamadas(lista: readonly LlamadaLeida[], conTranscripcion: ReadonlySet<string>): Record<string, unknown> {
  const salientes = lista.filter((l) => l.direccion === 'outbound')
  const habladas = lista.filter((l) => estaContestada(l))
  return {
    llamadas: lista.length,
    salientes: salientes.length,
    recibidas: lista.length - salientes.length,
    contestadas: habladas.length,
    conversaciones_de_un_minuto_o_mas: lista.filter((l) => cumpleResultado(l, 'conversaciones')).length,
    contestador: lista.filter((l) => esContestador(l)).length,
    salientes_sin_contestar: salientes.filter((l) => !estaContestada(l) && !esContestador(l)).length,
    perdidas_recibidas: lista.filter((l) => cumpleResultado(l, 'perdidas')).length,
    minutos_al_telefono: aMinutos(habladas.reduce((s, l) => s + l.duracion_s, 0)),
    con_grabacion: lista.filter((l) => l.grabacion_id).length,
    transcritas: lista.filter((l) => conTranscripcion.has(l.id)).length,
  }
}

/** Los dígitos de un teléfono sin el prefijo del país, para buscarlo dentro de un número internacional («+34600112233») */
export function digitosParaBuscar(t: string): string {
  const d = t.replace(/\D/g, '')
  return d.length > 9 ? d.slice(-9) : d
}

export const coldLlamadas: Herramienta<ContextoMcp> = {
  nombre: 'cold_llamadas',
  titulo: 'Cold Calling: las llamadas de Rinkel',
  descripcion:
    'Las llamadas del equipo comercial (salientes y recibidas, leídas de Rinkel): cuándo, quién llamó, a qué lead, cuántos minutos, cómo acabó (conversación, contestada corta, contestador, sin contestar, perdida), si ' +
    'tiene grabación y hasta cuándo, y si está transcrita con su resumen, interés y siguiente paso. Filtra por comercial, por lead (nombre o id), por teléfono, por días, por sentido y por resultado, y por tener ' +
    'grabación o transcripción. Incluye los totales de todo lo que cumple el filtro. El audio no se devuelve; lo que se dijo se lee con cold_transcripcion usando el `llamada_id`. Sin fechas, los últimos 7 días.',
  esquema: {
    type: 'object',
    properties: {
      comercial: { type: 'string', description: 'El comercial que hizo o recibió la llamada: su nombre (o parte), correo o id.' },
      lead: { type: 'string', description: 'El lead al que se llamó: su id, o parte de su nombre, empresa, correo o teléfono.' },
      telefono: { type: 'string', description: 'Parte del número de teléfono del otro lado (los últimos 9 dígitos bastan).' },
      desde: { type: 'string', description: 'Primer día (AAAA-MM-DD, «hoy» o «ayer»).' },
      hasta: { type: 'string', description: 'Último día, incluido. Máximo 31 días de rango (92 si se filtra por comercial o lead).' },
      sentido: { type: 'string', enum: [...SENTIDOS], description: 'salientes · recibidas · todas (por defecto).' },
      resultado: {
        type: 'string',
        enum: [...RESULTADOS],
        description: 'conversaciones (contestadas de 60 s o más) · contestadas (10 s o más) · sin_contestar (salientes) · contestador (contestadas de menos de 10 s) · perdidas (recibidas que no se cogieron) · todas (por defecto).',
      },
      con_grabacion: { type: 'boolean', description: 'true = solo las que tienen grabación.' },
      con_transcripcion: { type: 'boolean', description: 'true = solo las que ya están transcritas.' },
      limite: { type: 'integer', description: 'Llamadas por página. Por defecto 25, hasta 60.' },
      pagina: { type: 'integer', description: 'Empieza en 0.' },
    },
    additionalProperties: false,
  },
  soloLectura: true,
  async ejecutar(args, ctx) {
    const s = servicioDe(ctx)
    const hoy = hoyMadrid()
    const persona = await comercialArg(s, args)
    const leadTexto = texto(args, 'lead', { max: 120 })
    const leadIds = leadTexto ? await leadsDeFiltro(s, leadTexto) : null
    const telefono = texto(args, 'telefono', { max: 30 })
    const digitos = telefono ? digitosParaBuscar(telefono) : null
    if (telefono && (!digitos || digitos.length < 4)) throw new ErrorDeHerramienta('«telefono» necesita al menos 4 dígitos.')
    const sentido = opcion<(typeof SENTIDOS)[number]>(args, 'sentido', SENTIDOS, 'todas')
    const resultado = opcion<(typeof RESULTADOS)[number]>(args, 'resultado', RESULTADOS, 'todas')
    const soloGrabadas = booleano(args, 'con_grabacion', false)
    const soloTranscritas = booleano(args, 'con_transcripcion', false)
    const rango = rangoOUltimosDias(args, { porDefecto: 7, maxDias: persona || leadIds ? 92 : 31, hoy })
    const { desde, hasta } = instantesDe(rango)
    const p = paginaArg(args, { limite: 25, max: 60 })

    const llamadas = await fetchAll<LlamadaLeida>((de, a) => {
      let q = s.from('rinkel_llamadas').select(CAMPOS_DE_LLAMADA).gte('fecha', desde).lt('fecha', hasta)
      if (persona) q = q.eq('user_id', persona.id)
      if (leadIds) q = q.in('lead_id', leadIds)
      if (digitos) q = q.ilike('numero', `%${digitos}%`)
      if (sentido === 'salientes') q = q.eq('direccion', 'outbound')
      else if (sentido === 'recibidas') q = q.eq('direccion', 'inbound')
      return q.order('fecha', { ascending: false }).order('id', { ascending: true }).range(de, a)
    }).catch((e) => fallo(e, 'rinkel_llamadas (migración 234)'))

    // Las ya transcritas: una sola lectura de los ids (son pocas) sirve para el filtro y para los totales
    const transcritas = await idsTranscritos(s, persona?.id ?? null)
    const lista = llamadas.filter((l) => cumpleResultado(l, resultado) && (!soloGrabadas || !!l.grabacion_id) && (!soloTranscritas || transcritas.has(l.id)))
    const pagina = lista.slice(p.desde, p.hasta + 1)

    const [personas, nombres, resumenes] = await Promise.all([
      personasPorId(s, pagina.map((l) => l.user_id)),
      nombresDeLeads(s, pagina.map((l) => l.lead_id)),
      leerTranscripciones(s, pagina.map((l) => l.id)),
    ])
    const ahora = Date.now()
    return {
      texto: aTexto(
        ajustarAlTamano(
        {
          periodo: { desde: rango.desde, hasta: rango.hasta },
          filtro: { comercial: persona?.nombre ?? null, lead: leadTexto ?? null, telefono: telefono ?? null, sentido, resultado, con_grabacion: soloGrabadas || null, con_transcripcion: soloTranscritas || null },
          resumen: resumenDeLlamadas(lista, transcritas),
          ...datosDePagina(p, lista.length, pagina.length),
          llamadas: pagina.map((l) => {
            const n = l.lead_id ? nombres.get(l.lead_id) : undefined
            return {
              ...llamadaParaClaude(l, { comercial: personas.get(l.user_id)?.nombre ?? 'Alguien que ya no está', cliente: n ? (n.empresa && n.empresa !== n.nombre ? `${n.nombre} (${n.empresa})` : n.nombre) : null, transcripcion: resumenes.get(l.id), ahora }),
              lead_id: l.lead_id,
              telefono: l.numero ? telefonoLegible(l.numero) : null,
            }
          }),
        },
        'llamadas',
        27_000
        ),
        30_000
      ),
    }
  },
}

/** Los ids de las llamadas con transcripción hecha (de una persona o de todas). Sin la migración 244 no hay ninguna */
export async function idsTranscritos(s: Servicio, userId: string | null): Promise<Set<string>> {
  try {
    const filas = await fetchAll<{ llamada_id: string }>((de, a) => {
      let q = s.from('rinkel_transcripciones').select('llamada_id').eq('estado', 'hecha')
      if (userId) q = q.eq('user_id', userId)
      return q.order('llamada_id', { ascending: true }).range(de, a)
    })
    return new Set(filas.map((f) => f.llamada_id))
  } catch (e) {
    if (isMissingSchema(e)) return new Set()
    throw e
  }
}

/* ------------------------------------------------------------------ */
/* cold_transcripcion                                                  */
/* ------------------------------------------------------------------ */

export interface TranscripcionEntera extends TranscripcionResumida {
  motivo: string | null
  linea: unknown
  transcripcion: string | null
  idioma: string | null
  segundos_audio: number | null
  turnos: unknown
}

interface Momento {
  quien?: string
  texto?: string
}

const COLUMNAS_COMPLETAS = 'llamada_id, estado, motivo, tipo, resumen, siguiente_paso, interes, linea, transcripcion, idioma, segundos_audio, turnos'
const COLUMNAS_SIN_TURNOS = 'llamada_id, estado, motivo, tipo, resumen, siguiente_paso, interes, linea, transcripcion, idioma, segundos_audio'

/** La transcripción de una llamada. Sin la migración 253 no hay «quién habla» y se lee igual; sin la 244 no hay nada */
export async function leerTranscripcionEntera(s: Servicio, llamadaId: string): Promise<TranscripcionEntera | null> {
  for (const columnas of [COLUMNAS_COMPLETAS, COLUMNAS_SIN_TURNOS]) {
    const { data, error } = await s.from('rinkel_transcripciones').select(columnas).eq('llamada_id', llamadaId).maybeSingle()
    if (!error) {
      const f = data as (Omit<TranscripcionEntera, 'turnos'> & { turnos?: unknown }) | null
      return f ? { ...f, turnos: f.turnos ?? null } : null
    }
    // Una columna que no existe (253 sin lanzar) se prueba de nuevo sin ella; una tabla que no existe (244) es «no hay»
    if ((error as { code?: string }).code === '42703' || (error as { code?: string }).code === 'PGRST204') continue
    if (isMissingSchema(error)) return null
    throw error
  }
  return null
}

/** Por qué una llamada no tiene transcripción (lo que dirían las reglas del proceso que transcribe) */
export function motivoSinTranscripcion(l: Pick<LlamadaLeida, 'grabacion_id' | 'grabacion_hasta' | 'estado' | 'duracion_s' | 'lead_id'>, ahora: number): string {
  if (!l.grabacion_id) return 'La llamada no tiene grabación.'
  if (l.grabacion_hasta && Date.parse(l.grabacion_hasta) < ahora) return 'La grabación ya caducó (Rinkel las guarda 90 días) y no llegó a transcribirse.'
  if (!estaContestada(l) || l.duracion_s < SEGUNDOS_MINIMOS_PARA_TRANSCRIBIR) return `Solo se transcriben las llamadas contestadas de ${SEGUNDOS_MINIMOS_PARA_TRANSCRIBIR} segundos o más.`
  if (!l.lead_id) return 'La llamada no está enlazada con ningún lead de Cold Calling, y solo se transcriben las que sí lo están.'
  return 'Todavía no está transcrita: el proceso recoge las llamadas cada pocos minutos desde que cuelgan. Vuelve a mirar en un rato.'
}

/** La transcripción entera repartida en turnos, recortada a `max` caracteres en total */
export function armarTexto(t: Pick<TranscripcionEntera, 'turnos' | 'transcripcion'>, max: number): Record<string, unknown> {
  const turnos = Array.isArray(t.turnos) ? (t.turnos as Momento[]).filter((x) => x && typeof x.texto === 'string' && x.texto.trim() !== '') : []
  if (turnos.length > 0) {
    const salida: Array<{ quien: string; texto: string }> = []
    let usados = 0
    let recortado = false
    for (const x of turnos) {
      const quien = ETIQUETA_DE_QUIEN[x.quien as keyof typeof ETIQUETA_DE_QUIEN] ?? x.quien ?? '¿?'
      const resto = max - usados
      if (resto <= 0) {
        recortado = true
        break
      }
      const cuerpo = (x.texto as string).trim()
      salida.push({ quien, texto: cuerpo.length > resto ? `${cuerpo.slice(0, Math.max(resto - 1, 1)).trimEnd()}…` : cuerpo })
      usados += cuerpo.length
      if (cuerpo.length > resto) {
        recortado = true
        break
      }
    }
    const total = turnos.reduce((n, x) => n + (x.texto as string).trim().length, 0)
    return {
      forma: 'conversación por turnos (quién habla lo deduce la IA y puede equivocarse, sobre todo en llamadas cortas)',
      caracteres: total,
      recortada: recortado ? `se enseñan ${usados} de ${total} caracteres` : null,
      turnos: salida,
    }
  }
  const corrida = recortarLargo(t.transcripcion, max)
  return {
    forma: 'texto corrido (sin separar quién habla)',
    caracteres: corrida.caracteres,
    recortada: corrida.recortado ? `se enseñan ${max} de ${corrida.caracteres} caracteres` : null,
    texto: corrida.texto,
  }
}

export const coldTranscripcion: Herramienta<ContextoMcp> = {
  nombre: 'cold_transcripcion',
  titulo: 'Cold Calling: lo que se dijo en una llamada',
  descripcion:
    'La transcripción de UNA llamada de Rinkel: el resumen, el tipo (conversación, buzón de voz…), el interés que mostró el cliente, lo acordado como siguiente paso, los momentos clave y la conversación entera repartida ' +
    'en turnos «Comercial» / «Cliente» (o texto corrido si no se pudo separar). Se pide con el `llamada_id` que dan cold_llamadas y cold_ficha_lead. Si la llamada no está transcrita, dice por qué. Es lo que ' +
    'dijo una persona de verdad por teléfono: resume y cita lo necesario, no copies la conversación entera sin motivo.',
  esquema: {
    type: 'object',
    properties: {
      llamada_id: { type: 'string', description: 'El id de la llamada (el `llamada_id` de cold_llamadas o de cold_ficha_lead).' },
      max_caracteres: { type: 'integer', description: 'Cuántos caracteres de la conversación devolver. Por defecto 12000, hasta 40000.' },
    },
    required: ['llamada_id'],
    additionalProperties: false,
  },
  soloLectura: true,
  async ejecutar(args, ctx) {
    const s = servicioDe(ctx)
    const id = texto(args, 'llamada_id', { requerido: true, max: 60 })!.toLowerCase()
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) throw new ErrorDeHerramienta('«llamada_id» tiene que ser el id de una llamada, con el formato 00000000-0000-0000-0000-000000000000 (lo dan cold_llamadas y cold_ficha_lead).')
    const max = entero(args, 'max_caracteres', { min: 500, max: 40_000, defecto: 12_000 })
    const { data } = comprobar(await s.from('rinkel_llamadas').select(CAMPOS_DE_LLAMADA).eq('id', id).maybeSingle(), 'rinkel_llamadas (migración 234)')
    const llamada = data as LlamadaLeida | null
    if (!llamada) throw new ErrorDeHerramienta('No existe ninguna llamada con ese id.')

    const [personas, nombres, t] = await Promise.all([personasPorId(s, [llamada.user_id]), nombresDeLeads(s, [llamada.lead_id]), leerTranscripcionEntera(s, id)])
    const ahora = Date.now()
    const n = llamada.lead_id ? nombres.get(llamada.lead_id) : undefined
    const cabecera = {
      llamada_id: id,
      cuando: fechaHora(llamada.fecha),
      comercial: personas.get(llamada.user_id)?.nombre ?? 'Alguien que ya no está',
      sentido: llamada.direccion === 'inbound' ? 'recibida' : 'saliente',
      cliente: n ? (n.empresa && n.empresa !== n.nombre ? `${n.nombre} (${n.empresa})` : n.nombre) : llamada.numero ? telefonoLegible(llamada.numero) : 'número oculto',
      lead_id: llamada.lead_id,
      minutos: aMinutos(llamada.duracion_s),
      resultado: resultadoDeLlamada(llamada),
    }
    if (!t || t.estado !== 'hecha') {
      const porQue = !t ? motivoSinTranscripcion(llamada, ahora) : t.estado === 'procesando' ? 'Se está transcribiendo ahora mismo. Vuelve a mirar en unos minutos.' : t.estado === 'fallida' ? `La transcripción falló y se reintentará: ${recortar(t.motivo, 200) ?? 'sin detalle'}.` : `No se transcribe: ${recortar(t.motivo, 200) ?? 'sin detalle'}.`
      return { texto: aTexto({ ...cabecera, transcripcion: null, estado: t?.estado ?? 'sin transcribir', por_que: porQue }) }
    }
    const momentos = Array.isArray(t.linea) ? (t.linea as Momento[]).filter((m) => m && typeof m.texto === 'string').map((m) => ({ quien: ETIQUETA_DE_QUIEN[m.quien as keyof typeof ETIQUETA_DE_QUIEN] ?? m.quien, texto: recortar(m.texto, 300) })) : []
    return {
      texto: aTexto(
        {
          ...cabecera,
          estado: 'hecha',
          tipo: t.tipo,
          interes: t.interes ? (ETIQUETA_DE_INTERES[t.interes as keyof typeof ETIQUETA_DE_INTERES] ?? t.interes) : null,
          resumen: t.resumen,
          siguiente_paso: t.siguiente_paso,
          momentos_clave: momentos,
          idioma: t.idioma,
          segundos_de_audio: t.segundos_audio,
          conversacion: armarTexto(t, max),
        },
        36_000
      ),
    }
  },
}

export const HERRAMIENTAS_DE_LLAMADAS: readonly Herramienta<ContextoMcp>[] = [coldLlamadas, coldTranscripcion]
