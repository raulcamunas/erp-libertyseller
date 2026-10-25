import { isMissingSchema } from '@/lib/plataforma/eventos'
import type { createServiceClient } from '@/lib/supabase/service'
import { COLUMNAS_A_LEER, type DatosDeLead } from '../ia-contexto'
import { direccionesDeLead } from '../ia-servidor'
import type { SalientesPorHora } from './capacidad'
import type { AccionConUnaRespuesta, ClaseDeRespuesta, Confianza } from './clases'
import { ESTADOS_QUE_SE_PUEDEN_TOCAR } from './clasificar'
import { diaDeMadrid, instanteDeMadrid } from './fechas'
import { leerAjustes as leerAjustesDeFila, leerPasos, type AjustesDelMotor } from './reglas'
import type { EntranteParaControl } from './respuestas'
import type {
  BuzonDelMotor,
  DecisionGuardada,
  EstadoDeInscripcion,
  EstadoDePaso,
  FilaDeEvento,
  FilaDeInscripcion,
  FilaDePaso,
  InscripcionDelMotor,
  PasoDelMotor,
  TipoDeEvento,
} from './tipos'

/**
 * LO QUE EL MOTOR DE SECUENCIAS LEE Y ESCRIBE EN LA BASE — SOLO SERVIDOR.
 * =======================================================================
 * Todas las consultas del motor están aquí, cada una haciendo UNA cosa, y el resto de ficheros (motor.ts, servidor.ts…) no hablan con
 * Supabase. Así el motor se comprueba entero con un cliente falso en memoria (cliente-falso.ts) y contra Postgres de verdad con el mismo
 * recorrido, y las consultas están en un solo sitio para revisarlas.
 *
 * Las TABLAS `correo_secuencia_*` están cerradas al navegador (migración 245): solo se llega a ellas con la clave de servicio. Quién ve y toca
 * qué lo decide servidor.ts antes de llamar aquí.
 *
 * Reglas que se cumplen en todas las consultas:
 *   · Las fechas entran y salen como MILISEGUNDOS (aquí se pasa a texto ISO y de vuelta). El reloj lo pone quien llama (`ahora`) y no la base: así
 *     el motor se prueba con un reloj inventado y todo lo que escribe lleva la misma hora que usó para decidir.
 *   · Una lista larga se lee por páginas de 1.000 (el máximo de la API) y un `in` largo se parte en trozos de 100 ids (el largo de una URL).
 *   · Los errores de la base llegan como objetos sueltos, no como `Error`: se envuelven con `cause` para no perder el código, y NINGÚN mensaje de
 *     aquí lleva datos de un lead.
 *   · Una transición de un paso que sale de «enviando» solo se aplica si el paso SIGUE en «enviando»: si una persona lo cancela mientras el motor
 *     lo procesaba, el motor no lo resucita. La única que se aplica siempre es la de «enviado»: el correo ya salió y eso es lo que ha pasado.
 */

type Servicio = ReturnType<typeof createServiceClient>

const fallo = (mensaje: string, causa: unknown): Error => new Error(mensaje, { cause: causa })

export const aMs = (valor: string | null | undefined): number | null => {
  if (!valor) return null
  const t = Date.parse(valor)
  return Number.isFinite(t) ? t : null
}
const aIso = (ms: number): string => new Date(ms).toISOString()

const PAGINA = 1000
const TROZO = 100

function trozos<T>(lista: readonly T[], n = TROZO): T[][] {
  const partes: T[][] = []
  for (let i = 0; i < lista.length; i += n) partes.push(lista.slice(i, i + n))
  return partes
}

/** Lee todas las páginas de una consulta (hasta `maximo` filas) */
async function leerPaginas<T>(pedir: (desde: number, hasta: number) => PromiseLike<{ data: unknown; error: unknown }>, quePasa: string, maximo = 20_000): Promise<T[]> {
  const todo: T[] = []
  for (let desde = 0; desde < maximo; desde += PAGINA) {
    const { data, error } = await pedir(desde, desde + PAGINA - 1)
    if (error) throw fallo(quePasa, error)
    const pagina = (data ?? []) as T[]
    todo.push(...pagina)
    if (pagina.length < PAGINA) break
  }
  return todo
}

/* ------------------------------------------------------------------ */
/* Traducciones de fila a objeto del motor                             */
/* ------------------------------------------------------------------ */

export function pasoDelMotor(f: FilaDePaso): PasoDelMotor {
  return {
    id: f.id,
    inscripcionId: f.inscripcion_id,
    buzonId: f.buzon_id,
    dominio: f.dominio ?? '',
    orden: f.orden,
    estado: f.estado,
    motivo: f.motivo,
    asunto: f.asunto,
    texto: f.texto,
    textoEnviado: f.texto_enviado,
    diasHabiles: f.dias_habiles,
    objetivoDia: f.objetivo_dia,
    programadoAt: aMs(f.programado_at),
    enviadoAt: aMs(f.enviado_at),
    messageId: f.message_id,
    intentos: f.intentos,
    siguienteIntentoAt: aMs(f.siguiente_intento_at),
    reclamadoAt: aMs(f.reclamado_at),
    decision: f.decision ?? null,
  }
}

export function inscripcionDelMotor(f: FilaDeInscripcion): InscripcionDelMotor {
  return {
    id: f.id,
    secuenciaId: f.secuencia_id,
    leadId: f.lead_id,
    buzonId: f.buzon_id,
    userId: f.user_id,
    hiloId: f.hilo_id,
    messageIdInicial: f.message_id_inicial,
    destinatario: f.destinatario,
    asuntoBase: f.asunto_base,
    estado: f.estado,
    motivo: f.motivo,
    codigo: f.codigo,
    primerEnvioAt: aMs(f.primer_envio_at) ?? 0,
    noInteresaEn: aMs(f.no_interesa_en),
    paradaAt: aMs(f.parada_at),
    iaModelo: f.ia_modelo,
    creadaAt: aMs(f.creada_at) ?? 0,
  }
}

/* ------------------------------------------------------------------ */
/* Lo que devuelve el almacén                                          */
/* ------------------------------------------------------------------ */

export interface LecturaDeAjustes {
  ajustes: AjustesDelMotor
  vigilanciaAt: number | null
  purgadoAt: number | null
  /** Hasta cuándo se han mirado los correos que entraban en busca de respuestas de leads */
  respuestasAt: number | null
}

export interface CambiosDeBuzonDelMotor {
  participa?: boolean
  pausadoHasta?: number | null
  motivoPausa?: string | null
  rampaInicio?: string | null
  topeDiario?: number | null
  llamadasDesdeMin?: number
  llamadasHastaMin?: number
}

/** Una pareja «mensaje que acaba de entrar / secuencia viva» que puede tener que ver (el filtro grueso de la base; la aplicación remata) */
export interface ParejaVigilada {
  inscripcionId: string
  buzonId: string
  destinatario: string
  hiloId: string | null
  primerEnvioAt: number
  mensaje: EntranteParaControl
}

export interface DatosDeInscripcion {
  secuenciaId: string
  leadId: string
  buzonId: string
  userId: string
  hiloId: string | null
  messageIdInicial: string | null
  destinatario: string
  asuntoBase: string
  primerEnvioAt: number
  iaModelo: string | null
  dominio: string
  primerCorreo: { asunto: string; texto: string }
  seguimientos: Array<{ orden: number; diasHabiles: number; objetivoDia: string; asunto: string; texto: string }>
}

export type ResultadoDeCrear = { ok: true; inscripcion: InscripcionDelMotor; pasos: PasoDelMotor[]; sustituida: string | null } | { ok: false; motivo: 'ya_hay_una' | 'error' }

export interface PasoParaPlanificar {
  pasoId: string
  inscripcionId: string
  buzonId: string
  dominio: string
  orden: number
  /** El primer día en que puede salir, si se sabe */
  desde: string | null
}

export interface OcupacionDePaso {
  en: number
  buzonId: string
  dominio: string
  /** true = ya salió; false = está programado y todavía no */
  enviado: boolean
}

export interface LeadDelMotor extends DatosDeLead {
  id: string
  status: string
  assigned_to: string | null
  email: string | null
  emails_extra: string | null
}

export interface NotaLeida {
  kind: string
  body: string
  occurred_at: string
  created_at: string
  es_respuesta: boolean
}

export interface LlamadaLeida {
  id: string
  fecha: string
  direccion: string
  duracion_s: number
  estado: string
  /** De qué fue, según la transcripción: conversacion · buzon_de_voz · sin_contenido. null = aún sin transcribir */
  tipo: string | null
  /** Lo que entendió la transcripción (migración 244). null si no hay: sin transcribir, o el lead no llegó a hablar */
  resumen: string | null
  siguientePaso: string | null
  /** alto · medio · bajo · ninguno · no_claro */
  interes: string | null
}

export interface EventoLeido {
  id: number
  inscripcionId: string | null
  pasoId: string | null
  buzonId: string | null
  tipo: string
  detalle: string | null
  en: number
}

export interface RebotePrevio {
  motivo: string | null
  veces: number
}

export interface AvisoDeRebote {
  id: string
  buzonId: string
  asunto: string
  texto: string
  fecha: number
  creadoAt: number
}

export interface DatosBasicosDeLead {
  id: string
  nombre: string
  empresa: string | null
  status: string
  asignadoA: string | null
}

export interface FiltroDeCola {
  /** null = todos los buzones (quien supervisa); una lista vacía no devuelve nada */
  buzonIds: readonly string[] | null
  estados: readonly EstadoDeInscripcion[] | null
  /** Solo las secuencias de estos leads (resultado de buscar por nombre) */
  leadIds?: readonly string[]
  /** Solo las de este destinatario (contiene) */
  destinatario?: string
  /** Solo las que se crearon desde este instante */
  creadasDesde?: number
}

export interface SaludDeBuzon {
  buzonId: string
  enviados: number
  rebotes: number
}

/** Cómo va la conexión de un buzón con su servidor de correo (lo anota la sincronización de Correo) */
export interface ConexionLeida {
  ultimoError: string | null
  fallosSeguidos: number
  ultimoIntentoAt: number | null
}

/** Lo que dice el registro de procesos (migración 137) del motor: la última pasada automática y cómo ha ido la última hora */
export interface PasadasLeidas {
  ultima: { en: number; ok: boolean | null; error: string | null; duracionMs: number | null } | null
  enLaUltimaHora: number
  fallosEnLaUltimaHora: number
  /** El error de la pasada de la última hora que acabó mal más recientemente (la última puede haber ido bien) */
  ultimoErrorDeLaHora: string | null
}

export interface ResumenDelFlujo {
  total: number
  porEstado: Record<string, number>
  porCodigo: Record<string, number>
  enviados: Record<string, number>
  respuestas: Record<string, number>
}

const CAMPOS_DE_PASO = '*'

/** Un correo entrante que parece la respuesta de un lead y toca leer (lo reserva `reclamarRespuestas`) */
export interface RespuestaPorLeer {
  mensajeId: string
  leadId: string
  buzonId: string
  inscripcionId: string | null
  /** Cuántas veces se ha cogido ya (con esta, ya contada) */
  intentos: number
  deDireccion: string
  asunto: string
  /** Sin recortar la parte citada: quien lee la limpia (clasificar.ts) */
  texto: string
  fecha: number
  hiloId: string | null
  /** Cuándo entró el correo en el ERP */
  recibidaAt: number
}

/** Lo que se guarda de una respuesta ya leída */
export interface LecturaDeRespuesta {
  clase: ClaseDeRespuesta
  confianza: Confianza
  resumen: string
  evidencia: string
  /** El día de la rellamada pedida (AAAA-MM-DD) */
  fechaPedida: string | null
  modelo: string
  modo: 'ensayo' | 'real'
  accion: AccionConUnaRespuesta
  nota: string | null
}

/** Una respuesta leída, como la enseña la pantalla */
export interface RespuestaLeida {
  mensajeId: string
  leadId: string
  buzonId: string
  inscripcionId: string | null
  clase: ClaseDeRespuesta
  confianza: Confianza
  resumen: string
  evidencia: string
  fechaPedida: string | null
  modo: 'ensayo' | 'real'
  accion: AccionConUnaRespuesta
  aplicada: boolean
  nota: string | null
  recibidaAt: number
}

/** Un lead que tiene esta dirección entre las suyas */
export interface LeadConDireccion {
  id: string
  status: string
  assigned_to: string | null
}

type FilaDeRespuesta = {
  mensaje_id: string
  lead_id: string
  buzon_id: string
  inscripcion_id: string | null
  clase: ClaseDeRespuesta | null
  confianza: Confianza | null
  resumen: string | null
  evidencia: string | null
  fecha_pedida: string | null
  modo: 'ensayo' | 'real' | null
  accion: AccionConUnaRespuesta | null
  aplicada: boolean
  nota: string | null
  recibida_at: string
}

const CAMPOS_DE_RESPUESTA = 'mensaje_id, lead_id, buzon_id, inscripcion_id, clase, confianza, resumen, evidencia, fecha_pedida, modo, accion, aplicada, nota, recibida_at'

function respuestaLeida(f: FilaDeRespuesta): RespuestaLeida {
  return {
    mensajeId: f.mensaje_id,
    leadId: f.lead_id,
    buzonId: f.buzon_id,
    inscripcionId: f.inscripcion_id,
    clase: f.clase ?? 'otro',
    confianza: f.confianza ?? 'baja',
    resumen: f.resumen ?? '',
    evidencia: f.evidencia ?? '',
    fechaPedida: f.fecha_pedida,
    modo: f.modo ?? 'ensayo',
    accion: f.accion ?? 'ninguna',
    aplicada: f.aplicada === true,
    nota: f.nota,
    recibidaAt: aMs(f.recibida_at) ?? 0,
  }
}

export function almacenDeSecuencias(service: Servicio) {
  /* ---------------- ajustes y buzones ---------------- */

  async function leerAjustes(): Promise<LecturaDeAjustes | null> {
    const { data, error } = await service.from('correo_secuencia_ajustes').select('*').eq('id', true).maybeSingle()
    if (error) {
      if (isMissingSchema(error)) return null
      throw fallo('No se han podido leer los ajustes de las secuencias.', error)
    }
    const fila = (data ?? null) as Record<string, unknown> | null
    return {
      ajustes: leerAjustesDeFila(fila),
      vigilanciaAt: aMs(fila?.vigilancia_at as string | null | undefined),
      purgadoAt: aMs(fila?.purgado_at as string | null | undefined),
      respuestasAt: aMs(fila?.respuestas_at as string | null | undefined),
    }
  }

  async function guardarAjustes(cambios: Record<string, unknown>, userId: string | null, ahora: number): Promise<void> {
    const { error } = await service
      .from('correo_secuencia_ajustes')
      .update({ ...cambios, actualizada_at: aIso(ahora), ...(userId ? { actualizada_por: userId } : {}) })
      .eq('id', true)
    if (error) throw fallo('No se han podido guardar los ajustes de las secuencias.', error)
  }

  async function buzones(): Promise<BuzonDelMotor[]> {
    const [base, credenciales, propios] = await Promise.all([
      service.from('correo_buzones').select('id, user_id, direccion, nombre, firma, credenciales_invalidas, ultimo_sync_at').order('direccion', { ascending: true }),
      service.from('correo_credenciales').select('buzon_id'),
      service.from('correo_secuencia_buzones').select('buzon_id, participa, pausado_hasta, motivo_pausa, rampa_inicio, tope_diario, llamadas_desde_min, llamadas_hasta_min'),
    ])
    if (base.error) throw fallo('No se han podido leer los buzones.', base.error)
    if (credenciales.error) throw fallo('No se han podido leer las conexiones de los buzones.', credenciales.error)
    if (propios.error) throw fallo('No se han podido leer los ajustes de los buzones.', propios.error)

    const conectados = new Set(((credenciales.data ?? []) as Array<{ buzon_id: string }>).map((c) => c.buzon_id))
    const ajustes = new Map(((propios.data ?? []) as Array<Record<string, unknown>>).map((p) => [p.buzon_id as string, p]))
    return ((base.data ?? []) as Array<{ id: string; user_id: string; direccion: string; nombre: string | null; firma: string | null; credenciales_invalidas: boolean; ultimo_sync_at: string | null }>).map((b) => {
      const p = ajustes.get(b.id)
      return {
        id: b.id,
        userId: b.user_id,
        direccion: b.direccion,
        nombre: b.nombre,
        firma: b.firma,
        conectado: conectados.has(b.id),
        credencialesInvalidas: b.credenciales_invalidas === true,
        ultimoSyncAt: aMs(b.ultimo_sync_at),
        // Un buzón sin fila propia (conectado después de lanzar la migración) participa y llama de 10:00 a 14:00, como los demás
        participa: p ? p.participa !== false : true,
        pausadoHasta: aMs(p?.pausado_hasta as string | null | undefined),
        motivoPausa: (p?.motivo_pausa as string | null | undefined) ?? null,
        rampaInicio: (p?.rampa_inicio as string | null | undefined) ?? null,
        topeDiario: typeof p?.tope_diario === 'number' ? p.tope_diario : null,
        llamadasDesdeMin: typeof p?.llamadas_desde_min === 'number' ? p.llamadas_desde_min : 600,
        llamadasHastaMin: typeof p?.llamadas_hasta_min === 'number' ? p.llamadas_hasta_min : 840,
      }
    })
  }

  async function buzonPorId(buzonId: string): Promise<BuzonDelMotor | null> {
    return (await buzones()).find((b) => b.id === buzonId) ?? null
  }

  async function ajustarBuzon(buzonId: string, cambios: CambiosDeBuzonDelMotor, ahora: number): Promise<void> {
    const fila: Record<string, unknown> = { buzon_id: buzonId, actualizado_at: aIso(ahora) }
    if (cambios.participa !== undefined) fila.participa = cambios.participa
    if (cambios.pausadoHasta !== undefined) fila.pausado_hasta = cambios.pausadoHasta === null ? null : aIso(cambios.pausadoHasta)
    if (cambios.motivoPausa !== undefined) fila.motivo_pausa = cambios.motivoPausa
    if (cambios.rampaInicio !== undefined) fila.rampa_inicio = cambios.rampaInicio
    if (cambios.topeDiario !== undefined) fila.tope_diario = cambios.topeDiario
    if (cambios.llamadasDesdeMin !== undefined) fila.llamadas_desde_min = cambios.llamadasDesdeMin
    if (cambios.llamadasHastaMin !== undefined) fila.llamadas_hasta_min = cambios.llamadasHastaMin
    const { error } = await service.from('correo_secuencia_buzones').upsert(fila, { onConflict: 'buzon_id' })
    if (error) throw fallo('No se han podido guardar los ajustes del buzón.', error)
  }

  async function secuenciaBase(): Promise<{ id: string; nombre: string; pasos: Array<{ orden: number; dias: number }> } | null> {
    const { data, error } = await service.from('correo_secuencias').select('id, nombre, pasos').eq('es_base', true).eq('activa', true).maybeSingle()
    if (error) throw fallo('No se ha podido leer la secuencia base.', error)
    const f = data as { id: string; nombre: string; pasos: unknown } | null
    return f ? { id: f.id, nombre: f.nombre, pasos: leerPasos(f.pasos) } : null
  }

  /* ---------------- lo que entra ---------------- */

  const entrante = (f: Record<string, unknown>): EntranteParaControl => ({
    id: f.id as string,
    hiloId: (f.hilo_id as string | null) ?? null,
    deDireccion: (f.de_direccion as string) ?? '',
    asunto: (f.asunto as string) ?? '',
    texto: (f.texto as string) ?? '',
    fecha: aMs(f.fecha as string) ?? 0,
    automatico: f.automatico === true,
  })

  /**
   * Lo que ha entrado en el ERP desde `desde` y puede tener que ver con una secuencia viva de ese mismo buzón. `libres` son los proveedores de correo
   * que usa cualquiera (gmail…): un mensaje de otro gmail no cuenta como «su empresa».
   */
  async function vigilar(desde: number, libres: readonly string[]): Promise<ParejaVigilada[]> {
    const { data, error } = await service.rpc('correo_secuencia_vigilar', { p_desde: aIso(desde), p_libres: [...libres] })
    if (error) throw fallo('No se han podido leer los correos que han entrado.', error)
    return ((data ?? []) as Array<Record<string, unknown>>).map((f) => ({
      inscripcionId: f.inscripcion_id as string,
      buzonId: f.buzon_id as string,
      destinatario: f.destinatario as string,
      hiloId: (f.hilo_id as string | null) ?? null,
      primerEnvioAt: aMs(f.primer_envio_at as string) ?? 0,
      mensaje: entrante({ id: f.mensaje_id, hilo_id: f.mensaje_hilo_id, de_direccion: f.de_direccion, asunto: f.asunto, texto: f.texto, fecha: f.fecha, automatico: f.automatico }),
    }))
  }

  /** Lo que puede tener que ver con un destinatario de un buzón (su hilo, su empresa, los avisos que nombran su dirección) desde `desde` */
  async function entrantesDe(i: { buzonId: string; desde: number; hiloId: string | null; direccion: string; dominio: string }): Promise<EntranteParaControl[]> {
    const { data, error } = await service.rpc('correo_secuencia_entrantes_de', {
      p_buzon: i.buzonId,
      p_desde: aIso(i.desde),
      p_hilo: i.hiloId,
      p_direccion: i.direccion,
      p_dominio: i.dominio,
    })
    if (error) throw fallo('No se han podido leer las respuestas del lead.', error)
    return ((data ?? []) as Array<Record<string, unknown>>).map(entrante)
  }

  /* ---------------- inscripciones ---------------- */

  async function inscripcion(id: string): Promise<InscripcionDelMotor | null> {
    const { data, error } = await service.from('correo_secuencia_inscripciones').select('*').eq('id', id).maybeSingle()
    if (error) throw fallo('No se ha podido leer la secuencia.', error)
    return data ? inscripcionDelMotor(data as FilaDeInscripcion) : null
  }

  async function inscripcionesVivas(): Promise<InscripcionDelMotor[]> {
    const filas = await leerPaginas<FilaDeInscripcion>(
      (desde, hasta) => service.from('correo_secuencia_inscripciones').select('*').in('estado', ['activa', 'pausada']).order('creada_at', { ascending: true }).range(desde, hasta),
      'No se han podido leer las secuencias en marcha.'
    )
    return filas.map(inscripcionDelMotor)
  }

  async function inscripcionVivaDeLead(leadId: string): Promise<InscripcionDelMotor | null> {
    const { data, error } = await service.from('correo_secuencia_inscripciones').select('*').eq('lead_id', leadId).in('estado', ['activa', 'pausada']).maybeSingle()
    if (error) throw fallo('No se ha podido comprobar si el lead ya está en una secuencia.', error)
    return data ? inscripcionDelMotor(data as FilaDeInscripcion) : null
  }

  async function pasosDe(inscripcionId: string): Promise<PasoDelMotor[]> {
    const { data, error } = await service.from('correo_secuencia_pasos').select(CAMPOS_DE_PASO).eq('inscripcion_id', inscripcionId).order('orden', { ascending: true })
    if (error) throw fallo('No se han podido leer los correos de la secuencia.', error)
    return ((data ?? []) as FilaDePaso[]).map(pasoDelMotor)
  }

  async function pasoPorId(id: string): Promise<PasoDelMotor | null> {
    const { data, error } = await service.from('correo_secuencia_pasos').select(CAMPOS_DE_PASO).eq('id', id).maybeSingle()
    if (error) throw fallo('No se ha podido leer el correo de la secuencia.', error)
    return data ? pasoDelMotor(data as FilaDePaso) : null
  }

  async function cambiarInscripcion(
    id: string,
    cambios: { estado?: EstadoDeInscripcion; motivo?: string | null; codigo?: string | null; paradaAt?: number | null; noInteresaEn?: number | null },
    ahora: number
  ): Promise<void> {
    const fila: Record<string, unknown> = { actualizada_at: aIso(ahora) }
    if (cambios.estado !== undefined) fila.estado = cambios.estado
    if (cambios.motivo !== undefined) fila.motivo = cambios.motivo === null ? null : cambios.motivo.slice(0, 400)
    if (cambios.codigo !== undefined) fila.codigo = cambios.codigo
    if (cambios.paradaAt !== undefined) fila.parada_at = cambios.paradaAt === null ? null : aIso(cambios.paradaAt)
    if (cambios.noInteresaEn !== undefined) fila.no_interesa_en = cambios.noInteresaEn === null ? null : aIso(cambios.noInteresaEn)
    const { error } = await service.from('correo_secuencia_inscripciones').update(fila).eq('id', id)
    if (error) throw fallo('No se ha podido actualizar la secuencia.', error)
  }

  /** Cancela (o pasa al estado que se diga) los correos de una secuencia que todavía podían salir. Devuelve cuántos */
  async function cerrarPasosAbiertos(inscripcionId: string, estado: 'cancelado' | 'saltado', motivo: string | null, ahora: number): Promise<number> {
    const { data, error } = await service
      .from('correo_secuencia_pasos')
      .update({ estado, motivo: motivo === null ? null : motivo.slice(0, 400), reclamado_at: null, actualizado_at: aIso(ahora) })
      .eq('inscripcion_id', inscripcionId)
      .gt('orden', 0)
      .in('estado', ['pendiente', 'enviando', 'pausado'])
      .select('id')
    if (error) throw fallo('No se han podido cancelar los correos de la secuencia.', error)
    return (data ?? []).length
  }

  async function crearInscripcion(d: DatosDeInscripcion, ahora: number): Promise<ResultadoDeCrear> {
    // Un lead no puede estar en dos secuencias vivas: la nueva sustituye a la anterior (el comercial ha vuelto a escribirle)
    let sustituida: string | null = null
    const previa = await inscripcionVivaDeLead(d.leadId)
    if (previa) {
      await cambiarInscripcion(previa.id, { estado: 'cancelada', motivo: 'Sustituida por una secuencia nueva.', codigo: 'sustituida', paradaAt: ahora }, ahora)
      await cerrarPasosAbiertos(previa.id, 'cancelado', 'Sustituida por una secuencia nueva.', ahora)
      sustituida = previa.id
    }

    const { data, error } = await service
      .from('correo_secuencia_inscripciones')
      .insert({
        secuencia_id: d.secuenciaId,
        lead_id: d.leadId,
        buzon_id: d.buzonId,
        user_id: d.userId,
        hilo_id: d.hiloId,
        message_id_inicial: d.messageIdInicial,
        destinatario: d.destinatario,
        asunto_base: d.asuntoBase.slice(0, 500),
        estado: 'activa',
        primer_envio_at: aIso(d.primerEnvioAt),
        ia_modelo: d.iaModelo,
        creada_at: aIso(ahora),
        actualizada_at: aIso(ahora),
      })
      .select('*')
      .single()
    if (error) {
      // 23505: otro envío del mismo lead se ha colado entre la comprobación y el alta
      if ((error as { code?: string }).code === '23505') return { ok: false, motivo: 'ya_hay_una' }
      throw fallo('No se ha podido crear la secuencia.', error)
    }
    const fila = data as FilaDeInscripcion

    const pasos = [
      {
        inscripcion_id: fila.id,
        buzon_id: d.buzonId,
        dominio: d.dominio,
        orden: 0,
        estado: 'enviado',
        asunto: d.primerCorreo.asunto.slice(0, 500),
        texto: d.primerCorreo.texto.slice(0, 20000),
        dias_habiles: 0,
        enviado_at: aIso(d.primerEnvioAt),
        message_id: d.messageIdInicial,
        creado_at: aIso(ahora),
        actualizado_at: aIso(ahora),
      },
      ...d.seguimientos.map((s) => ({
        inscripcion_id: fila.id,
        buzon_id: d.buzonId,
        dominio: d.dominio,
        orden: s.orden,
        estado: 'pendiente',
        asunto: s.asunto.slice(0, 500),
        texto: s.texto.slice(0, 20000),
        dias_habiles: s.diasHabiles,
        objetivo_dia: s.objetivoDia,
        creado_at: aIso(ahora),
        actualizado_at: aIso(ahora),
      })),
    ]
    const { data: creados, error: errorPasos } = await service.from('correo_secuencia_pasos').insert(pasos).select(CAMPOS_DE_PASO)
    if (errorPasos) {
      // Sin sus correos la secuencia no sirve de nada: se deshace
      await service.from('correo_secuencia_inscripciones').delete().eq('id', fila.id)
      throw fallo('No se han podido crear los correos de la secuencia.', errorPasos)
    }
    return {
      ok: true,
      inscripcion: inscripcionDelMotor(fila),
      pasos: ((creados ?? []) as FilaDePaso[]).map(pasoDelMotor).sort((a, b) => a.orden - b.orden),
      sustituida,
    }
  }

  /* ---------------- pasos: ejecución ---------------- */

  /** Reserva los pasos que ya tocan (función SQL con SKIP LOCKED): dos pasadas nunca cogen el mismo */
  async function reclamarPasos(ahora: number, limite: number, bloqueoMin = 10): Promise<PasoDelMotor[]> {
    const { data, error } = await service.rpc('correo_secuencia_reclamar_pasos', { p_ahora: aIso(ahora), p_limite: limite, p_bloqueo_min: bloqueoMin })
    if (error) throw fallo('No se han podido reservar los correos que tocan.', error)
    return ((data ?? []) as FilaDePaso[]).map(pasoDelMotor)
  }

  /** Devuelve un paso reservado a «pendiente» (con otra hora, o para reintentar). false = ya no estaba reservado */
  async function soltarPaso(
    id: string,
    cambios: { programadoAt?: number | null; siguienteIntentoAt?: number | null; intentos?: number; messageId?: string | null; motivo?: string | null; decision?: DecisionGuardada | null; objetivoDia?: string | null },
    ahora: number
  ): Promise<boolean> {
    const fila: Record<string, unknown> = { estado: 'pendiente', reclamado_at: null, actualizado_at: aIso(ahora) }
    if (cambios.programadoAt !== undefined) fila.programado_at = cambios.programadoAt === null ? null : aIso(cambios.programadoAt)
    if (cambios.siguienteIntentoAt !== undefined) fila.siguiente_intento_at = cambios.siguienteIntentoAt === null ? null : aIso(cambios.siguienteIntentoAt)
    if (cambios.intentos !== undefined) fila.intentos = cambios.intentos
    if (cambios.messageId !== undefined) fila.message_id = cambios.messageId
    if (cambios.motivo !== undefined) fila.motivo = cambios.motivo === null ? null : cambios.motivo.slice(0, 400)
    if (cambios.decision !== undefined) fila.decision = cambios.decision
    if (cambios.objetivoDia !== undefined) fila.objetivo_dia = cambios.objetivoDia
    const { data, error } = await service.from('correo_secuencia_pasos').update(fila).eq('id', id).eq('estado', 'enviando').select('id')
    if (error) throw fallo('No se ha podido devolver el correo a la cola.', error)
    return (data ?? []).length > 0
  }

  /**
   * Pone un paso en un estado final o de espera. `enviado` se aplica SIEMPRE (el correo ya salió); los demás solo si el paso sigue «enviando».
   * Devuelve si se aplicó.
   */
  async function marcarPaso(
    id: string,
    estado: Exclude<EstadoDePaso, 'pendiente' | 'enviando'>,
    cambios: { motivo?: string | null; decision?: DecisionGuardada | null; enviadoAt?: number; messageId?: string | null; textoEnviado?: string | null },
    ahora: number
  ): Promise<boolean> {
    const fila: Record<string, unknown> = { estado, reclamado_at: null, actualizado_at: aIso(ahora) }
    if (cambios.motivo !== undefined) fila.motivo = cambios.motivo === null ? null : cambios.motivo.slice(0, 400)
    if (cambios.decision !== undefined) fila.decision = cambios.decision
    if (cambios.enviadoAt !== undefined) fila.enviado_at = aIso(cambios.enviadoAt)
    if (cambios.messageId !== undefined) fila.message_id = cambios.messageId
    if (cambios.textoEnviado !== undefined) fila.texto_enviado = cambios.textoEnviado === null ? null : cambios.textoEnviado.slice(0, 20000)
    if (estado === 'enviado') {
      fila.siguiente_intento_at = null
      const { data, error } = await service.from('correo_secuencia_pasos').update(fila).eq('id', id).select('id')
      if (error) throw fallo('No se ha podido marcar el correo como enviado.', error)
      return (data ?? []).length > 0
    }
    const { data, error } = await service.from('correo_secuencia_pasos').update(fila).eq('id', id).eq('estado', 'enviando').select('id')
    if (error) throw fallo('No se ha podido actualizar el correo de la secuencia.', error)
    return (data ?? []).length > 0
  }

  /** Apunta el Message-ID con el que va a salir un paso ANTES de enviarlo, para poder comprobar después si un envío que se cortó llegó a salir */
  async function guardarMessageId(id: string, messageId: string, ahora: number): Promise<boolean> {
    const { data, error } = await service.from('correo_secuencia_pasos').update({ message_id: messageId, actualizado_at: aIso(ahora) }).eq('id', id).eq('estado', 'enviando').select('id')
    if (error) throw fallo('No se ha podido apuntar el envío.', error)
    return (data ?? []).length > 0
  }

  /** Cambia el texto o el asunto de un correo que todavía no ha salido */
  async function editarPaso(id: string, cambios: { asunto?: string; texto?: string }, ahora: number): Promise<boolean> {
    const fila: Record<string, unknown> = { actualizado_at: aIso(ahora) }
    if (cambios.asunto !== undefined) fila.asunto = cambios.asunto.slice(0, 500)
    if (cambios.texto !== undefined) fila.texto = cambios.texto.slice(0, 20000)
    const { data, error } = await service.from('correo_secuencia_pasos').update(fila).eq('id', id).in('estado', ['pendiente', 'pausado']).select('id')
    if (error) throw fallo('No se ha podido guardar el cambio.', error)
    return (data ?? []).length > 0
  }

  /** Cambia el estado de un paso por una acción de una persona (saltar, reintentar, pausar…). Solo desde los estados que se indican */
  async function moverPaso(id: string, desde: readonly EstadoDePaso[], cambios: { estado: EstadoDePaso; motivo?: string | null; programadoAt?: number | null; siguienteIntentoAt?: number | null; intentos?: number; messageId?: string | null; objetivoDia?: string | null }, ahora: number): Promise<boolean> {
    const fila: Record<string, unknown> = { estado: cambios.estado, reclamado_at: null, actualizado_at: aIso(ahora) }
    if (cambios.motivo !== undefined) fila.motivo = cambios.motivo === null ? null : cambios.motivo.slice(0, 400)
    if (cambios.programadoAt !== undefined) fila.programado_at = cambios.programadoAt === null ? null : aIso(cambios.programadoAt)
    if (cambios.siguienteIntentoAt !== undefined) fila.siguiente_intento_at = cambios.siguienteIntentoAt === null ? null : aIso(cambios.siguienteIntentoAt)
    if (cambios.intentos !== undefined) fila.intentos = cambios.intentos
    if (cambios.messageId !== undefined) fila.message_id = cambios.messageId
    if (cambios.objetivoDia !== undefined) fila.objetivo_dia = cambios.objetivoDia
    const { data, error } = await service.from('correo_secuencia_pasos').update(fila).eq('id', id).in('estado', [...desde]).select('id')
    if (error) throw fallo('No se ha podido cambiar el correo de la secuencia.', error)
    return (data ?? []).length > 0
  }

  /* ---------------- planificación ---------------- */

  /** Los correos pendientes de secuencias activas que todavía no tienen hora */
  async function pasosSinHora(limite = 400): Promise<PasoParaPlanificar[]> {
    const { data, error } = await service
      .from('correo_secuencia_pasos')
      .select('id, inscripcion_id, buzon_id, dominio, orden, objetivo_dia')
      .eq('estado', 'pendiente')
      .is('programado_at', null)
      .gt('orden', 0)
      .order('creado_at', { ascending: true })
      .limit(limite)
    if (error) throw fallo('No se han podido leer los correos sin hora.', error)
    const filas = (data ?? []) as Array<{ id: string; inscripcion_id: string; buzon_id: string; dominio: string; orden: number; objetivo_dia: string | null }>
    const activas = await inscripcionesConEstado(filas.map((f) => f.inscripcion_id), ['activa'])
    return filas.filter((f) => activas.has(f.inscripcion_id)).map((f) => ({ pasoId: f.id, inscripcionId: f.inscripcion_id, buzonId: f.buzon_id, dominio: f.dominio ?? '', orden: f.orden, desde: f.objetivo_dia }))
  }

  /** Cuáles de estas secuencias están en alguno de estos estados */
  async function inscripcionesConEstado(ids: readonly string[], estados: readonly EstadoDeInscripcion[]): Promise<Set<string>> {
    const bien = new Set<string>()
    for (const grupo of trozos([...new Set(ids)])) {
      const { data, error } = await service.from('correo_secuencia_inscripciones').select('id').in('id', grupo).in('estado', [...estados])
      if (error) throw fallo('No se han podido comprobar las secuencias.', error)
      for (const f of (data ?? []) as Array<{ id: string }>) bien.add(f.id)
    }
    return bien
  }

  /** Los correos de secuencias activas que se les pasó la hora hace más de `margenMs` y nadie ha cogido: se les quita la hora para que se vuelvan a repartir */
  async function pasosAtrasados(ahora: number, margenMs: number, limite = 400): Promise<Array<{ id: string; inscripcionId: string }>> {
    const { data, error } = await service
      .from('correo_secuencia_pasos')
      .select('id, inscripcion_id')
      .eq('estado', 'pendiente')
      .is('siguiente_intento_at', null)
      .gt('orden', 0)
      .lt('programado_at', aIso(ahora - margenMs))
      .order('programado_at', { ascending: true })
      .limit(limite)
    if (error) throw fallo('No se han podido leer los correos atrasados.', error)
    const filas = (data ?? []) as Array<{ id: string; inscripcion_id: string }>
    const activas = await inscripcionesConEstado(filas.map((f) => f.inscripcion_id), ['activa'])
    return filas.filter((f) => activas.has(f.inscripcion_id)).map((f) => ({ id: f.id, inscripcionId: f.inscripcion_id }))
  }

  /** Quita la hora a estos pasos (siguen pendientes): el planificador les dará otra */
  async function quitarHoras(ids: readonly string[], ahora: number): Promise<void> {
    for (const grupo of trozos([...ids])) {
      const { error } = await service
        .from('correo_secuencia_pasos')
        .update({ programado_at: null, siguiente_intento_at: null, actualizado_at: aIso(ahora) })
        .in('id', grupo)
        .eq('estado', 'pendiente')
      if (error) throw fallo('No se han podido quitar las horas atrasadas.', error)
    }
  }

  /** Lo que ya ocupa el calendario desde `desde`: los pendientes con hora y los enviados */
  async function ocupacion(desde: number): Promise<OcupacionDePaso[]> {
    const pendientes = await leerPaginas<{ programado_at: string; buzon_id: string; dominio: string }>(
      (a, b) => service.from('correo_secuencia_pasos').select('programado_at, buzon_id, dominio').in('estado', ['pendiente', 'enviando']).gt('orden', 0).gte('programado_at', aIso(desde)).order('programado_at', { ascending: true }).range(a, b),
      'No se han podido leer los correos programados.'
    )
    const enviados = await leerPaginas<{ enviado_at: string; buzon_id: string; dominio: string }>(
      (a, b) => service.from('correo_secuencia_pasos').select('enviado_at, buzon_id, dominio').eq('estado', 'enviado').gt('orden', 0).gte('enviado_at', aIso(desde)).order('enviado_at', { ascending: true }).range(a, b),
      'No se han podido leer los correos enviados.'
    )
    return [
      ...pendientes.map((p) => ({ en: aMs(p.programado_at) ?? 0, buzonId: p.buzon_id, dominio: p.dominio ?? '', enviado: false })),
      ...enviados.map((p) => ({ en: aMs(p.enviado_at) ?? 0, buzonId: p.buzon_id, dominio: p.dominio ?? '', enviado: true })),
    ].filter((o) => o.en > 0)
  }

  /** Pone la hora a cada paso. Solo si sigue pendiente y sin hora: otra pasada (o una persona) pudo habérsela puesto ya */
  async function fijarHoras(asignaciones: ReadonlyArray<{ pasoId: string; programadoAt: number; dia: string }>, ahora: number): Promise<number> {
    let hechas = 0
    for (const a of asignaciones) {
      const { data, error } = await service
        .from('correo_secuencia_pasos')
        .update({ programado_at: aIso(a.programadoAt), objetivo_dia: a.dia, actualizado_at: aIso(ahora) })
        .eq('id', a.pasoId)
        .eq('estado', 'pendiente')
        .is('programado_at', null)
        .select('id')
      if (error) throw fallo('No se ha podido guardar la hora de un correo.', error)
      if ((data ?? []).length > 0) hechas++
    }
    return hechas
  }

  /** Los pasos aparcados por el ensayo (con un siguiente intento muy lejano) vuelven a la cola sin hora, para repartirse de nuevo */
  async function liberarEnsayados(ahora: number, aparcadosDesde: number): Promise<number> {
    const { data, error } = await service
      .from('correo_secuencia_pasos')
      .update({ programado_at: null, siguiente_intento_at: null, actualizado_at: aIso(ahora) })
      .eq('estado', 'pendiente')
      .gt('siguiente_intento_at', aIso(aparcadosDesde))
      .select('id')
    if (error) throw fallo('No se han podido liberar los correos del ensayo.', error)
    return (data ?? []).length
  }

  /* ---------------- el lead ---------------- */

  async function leadParaMotor(leadId: string): Promise<LeadDelMotor | null> {
    const { data, error } = await service.from('cold_leads').select(`${COLUMNAS_A_LEER}, assigned_to`).eq('id', leadId).maybeSingle()
    if (error) throw fallo('No se ha podido leer el lead.', error)
    return (data as unknown as LeadDelMotor | null) ?? null
  }

  async function notasDelLead(leadId: string, limite = 30): Promise<NotaLeida[]> {
    const { data, error } = await service
      .from('cold_lead_notes')
      .select('kind, body, occurred_at, created_at, es_respuesta')
      .eq('lead_id', leadId)
      .order('created_at', { ascending: false })
      .limit(limite)
    if (error) throw fallo('No se ha podido leer el historial del lead.', error)
    return ((data ?? []) as NotaLeida[]).map((n) => ({ ...n, es_respuesta: n.es_respuesta === true }))
  }

  /** Las llamadas del lead con lo que entendió la transcripción. Si las tablas de Rinkel no están, no hay llamadas: no es un error */
  async function llamadasDelLead(leadId: string, limite = 30): Promise<LlamadaLeida[]> {
    const { data, error } = await service.from('rinkel_llamadas').select('id, fecha, direccion, duracion_s, estado').eq('lead_id', leadId).order('fecha', { ascending: false }).limit(limite)
    if (error) {
      if (isMissingSchema(error)) return []
      throw fallo('No se han podido leer las llamadas del lead.', error)
    }
    const llamadas = (data ?? []) as Array<Omit<LlamadaLeida, 'tipo' | 'resumen' | 'siguientePaso' | 'interes'>>
    if (llamadas.length === 0) return []
    const entendido = new Map<string, { tipo: string | null; resumen: string | null; siguientePaso: string | null; interes: string | null }>()
    const { data: transcripciones, error: errorT } = await service
      .from('rinkel_transcripciones')
      .select('llamada_id, tipo, resumen, siguiente_paso, interes')
      .in('llamada_id', llamadas.map((l) => l.id))
      .eq('estado', 'hecha')
    // Sin la tabla de transcripciones (migración 244) las llamadas valen igual, solo que sin saber de qué fueron ni qué se habló
    if (!errorT) {
      for (const t of (transcripciones ?? []) as Array<{ llamada_id: string; tipo: string | null; resumen: string | null; siguiente_paso: string | null; interes: string | null }>) {
        entendido.set(t.llamada_id, { tipo: t.tipo, resumen: t.resumen, siguientePaso: t.siguiente_paso, interes: t.interes })
      }
    }
    return llamadas.map((l) => ({ ...l, tipo: entendido.get(l.id)?.tipo ?? null, resumen: entendido.get(l.id)?.resumen ?? null, siguientePaso: entendido.get(l.id)?.siguientePaso ?? null, interes: entendido.get(l.id)?.interes ?? null }))
  }

  /** Cuándo ha escrito el comercial a este destinatario, desde este buzón, después de `desde` (sin contar los correos de la propia secuencia, que se pasan en `propios`) */
  async function correosManualesA(i: { buzonId: string; destinatario: string; desde: number; propios: readonly string[] }): Promise<number[]> {
    const buscado = i.destinatario.trim().toLowerCase().replace(/[%_\\]/g, (c) => `\\${c}`)
    const { data, error } = await service
      .from('correo_mensajes')
      .select('message_id, fecha')
      .eq('buzon_id', i.buzonId)
      .eq('direccion', 'saliente')
      .gt('fecha', aIso(i.desde))
      .ilike('destinatarios', `%${buscado}%`)
      .order('fecha', { ascending: true })
      .limit(50)
    if (error) throw fallo('No se han podido leer los correos que has enviado a este lead.', error)
    const propios = new Set(i.propios.map((p) => p.toLowerCase()))
    return ((data ?? []) as Array<{ message_id: string | null; fecha: string }>)
      .filter((m) => !m.message_id || !propios.has(m.message_id.toLowerCase()))
      .map((m) => aMs(m.fecha) ?? 0)
      .filter((f) => f > 0)
  }

  /** Cambia el estado del lead solo si está en alguno de los estados esperados. Devuelve si lo cambió */
  async function cambiarEstadoDelLead(leadId: string, nuevo: string, soloSiEsta: readonly string[], ahora: number): Promise<boolean> {
    const { data, error } = await service.from('cold_leads').update({ status: nuevo, updated_at: aIso(ahora) }).eq('id', leadId).in('status', [...soloSiEsta]).select('id')
    if (error) throw fallo('No se ha podido cambiar el estado del lead.', error)
    return (data ?? []).length > 0
  }

  /** Deja una nota del sistema en la línea de tiempo del lead (sin autor: no cuenta para nadie en Rendimiento). Devuelve si quedó */
  async function apuntarNotaEnLead(i: { leadId: string; cuerpo: string; clase: 'email' | 'nota'; ocurrioAt: number }): Promise<boolean> {
    const { error } = await service.from('cold_lead_notes').insert({ lead_id: i.leadId, author_id: null, kind: i.clase, body: i.cuerpo.slice(0, 8000), occurred_at: aIso(i.ocurrioAt), es_respuesta: false })
    if (error) {
      console.error('[secuencias] no se ha podido apuntar una nota en el lead', { codigo: (error as { code?: string }).code ?? null })
      return false
    }
    return true
  }

  /** Pone el día de «Rellamar el» del lead. Si nadie lo trabaja pasa a «Rellamada programada»; si ya lo lleva una persona («En seguimiento») solo se pone la fecha. `no` = no se ha tocado nada */
  async function ponerRellamada(leadId: string, fecha: string, ahora: number): Promise<'programado' | 'solo_fecha' | 'no'> {
    const cambiado = await service.from('cold_leads').update({ status: 'programado', next_call_date: fecha, updated_at: aIso(ahora) }).eq('id', leadId).in('status', [...ESTADOS_QUE_SE_PUEDEN_TOCAR]).select('id')
    if (cambiado.error) throw fallo('No se ha podido poner la rellamada del lead.', cambiado.error)
    if ((cambiado.data ?? []).length > 0) return 'programado'
    const soloFecha = await service.from('cold_leads').update({ next_call_date: fecha, updated_at: aIso(ahora) }).eq('id', leadId).eq('status', 'seguimiento').select('id')
    if (soloFecha.error) throw fallo('No se ha podido poner la rellamada del lead.', soloFecha.error)
    return (soloFecha.data ?? []).length > 0 ? 'solo_fecha' : 'no'
  }

  /** Los leads que tienen esta dirección entre las suyas (`email` o `emails_extra`) */
  async function leadsPorDireccion(direccion: string, limite = 20): Promise<LeadConDireccion[]> {
    const d = direccion.trim().toLowerCase()
    if (!d.includes('@') || d.length > 320) return []
    const patron = `%${d.replace(/[%_\\]/g, (c) => `\\${c}`)}%`
    const leer = async (columna: 'email' | 'emails_extra') => {
      const { data, error } = await service.from('cold_leads').select('id, status, assigned_to, email, emails_extra').ilike(columna, patron).limit(limite)
      if (error) throw fallo('No se han podido buscar los leads de esa dirección.', error)
      return (data ?? []) as Array<LeadConDireccion & { email: string | null; emails_extra: string | null }>
    }
    const [porCorreo, porExtra] = await Promise.all([leer('email'), leer('emails_extra')])
    const vistos = new Map<string, LeadConDireccion>()
    // La base filtra por texto («ana@x.es» está dentro de «joana@x.es»): aquí se remata con la lista exacta de direcciones del lead
    for (const l of [...porCorreo, ...porExtra]) if (direccionesDeLead(l as unknown as Record<string, unknown>).includes(d)) vistos.set(l.id, { id: l.id, status: l.status, assigned_to: l.assigned_to })
    return [...vistos.values()]
  }

  /** ¿Tiene el lead una nota del sistema (sin autor) que empiece así y trate de algo ocurrido desde `desde`? Para no repetir el mismo aviso cada vez que se vuelve a mirar el mismo correo. Se mira CUÁNDO OCURRIÓ lo que cuenta (`occurred_at`, que se escribe siempre) y no cuándo se apuntó */
  async function hayNotaDelSistema(leadId: string, comienzo: string, desde: number): Promise<boolean> {
    const escapado = comienzo.replace(/[%_\\]/g, (c) => `\\${c}`)
    const { data, error } = await service.from('cold_lead_notes').select('id').eq('lead_id', leadId).is('author_id', null).ilike('body', `${escapado}%`).gte('occurred_at', aIso(desde)).limit(1)
    if (error) throw fallo('No se ha podido leer el historial del lead.', error)
    return (data ?? []).length > 0
  }

  /* ---------------- las respuestas de los leads ---------------- */

  /** Apunta los correos nuevos que parecen respuestas de leads y reserva hasta `limite` para leerlos (ver la función SQL: dos pasadas no cogen el mismo). Sin la migración 246, no hay ninguno */
  async function reclamarRespuestas(desde: number, ahora: number, limite: number, bloqueoMin = 10): Promise<RespuestaPorLeer[]> {
    const { data, error } = await service.rpc('correo_respuestas_reclamar', { p_desde: aIso(desde), p_ahora: aIso(ahora), p_limite: limite, p_bloqueo_min: bloqueoMin })
    if (error) {
      if (isMissingSchema(error)) return []
      throw fallo('No se han podido reservar las respuestas de los leads.', error)
    }
    return ((data ?? []) as Array<Record<string, unknown>>).map((f) => ({
      mensajeId: String(f.mensaje_id),
      leadId: String(f.lead_id),
      buzonId: String(f.buzon_id),
      inscripcionId: (f.inscripcion_id as string | null) ?? null,
      intentos: Number(f.intentos) || 1,
      deDireccion: String(f.de_direccion ?? ''),
      asunto: String(f.asunto ?? ''),
      texto: String(f.texto ?? ''),
      fecha: aMs(f.fecha as string | null) ?? 0,
      hiloId: (f.hilo_id as string | null) ?? null,
      recibidaAt: aMs(f.recibida_at as string | null) ?? 0,
    }))
  }

  /** Guarda lo que se ha entendido de una respuesta. Solo si sigue reservada (otra pasada no la pisa). Devuelve si quedó guardada */
  async function guardarLecturaDeRespuesta(mensajeId: string, l: LecturaDeRespuesta, ahora: number): Promise<boolean> {
    const { data, error } = await service
      .from('correo_respuestas_ia')
      .update({
        estado: 'hecha',
        clase: l.clase,
        confianza: l.confianza,
        resumen: l.resumen.slice(0, 300),
        evidencia: l.evidencia.slice(0, 400),
        fecha_pedida: l.fechaPedida,
        modelo: l.modelo.slice(0, 60),
        modo: l.modo,
        accion: l.accion,
        aplicada: false,
        nota: l.nota ? l.nota.slice(0, 1000) : null,
        proximo_intento_at: null,
        actualizada_at: aIso(ahora),
      })
      .eq('mensaje_id', mensajeId)
      .eq('estado', 'procesando')
      .select('mensaje_id')
    if (error) throw fallo('No se ha podido guardar lo que dice la respuesta.', error)
    return (data ?? []).length > 0
  }

  /** Apunta lo que de verdad se hizo con la respuesta (si se aplicó, y la acción y la nota finales si cambiaron al intentarlo) */
  async function anotarAplicacion(mensajeId: string, cambios: { aplicada: boolean; accion?: AccionConUnaRespuesta; nota?: string | null }, ahora: number): Promise<void> {
    const { error } = await service
      .from('correo_respuestas_ia')
      .update({ aplicada: cambios.aplicada, ...(cambios.accion ? { accion: cambios.accion } : {}), ...(cambios.nota !== undefined ? { nota: cambios.nota ? cambios.nota.slice(0, 1000) : null } : {}), actualizada_at: aIso(ahora) })
      .eq('mensaje_id', mensajeId)
    if (error) throw fallo('No se ha podido apuntar lo que se hizo con la respuesta.', error)
  }

  /** La IA no ha podido: la respuesta vuelve a la cola para otro intento, o se da por fallida */
  async function soltarRespuesta(mensajeId: string, como: { estado: 'pendiente' | 'fallida'; proximoIntentoAt: number | null }, ahora: number): Promise<void> {
    const { error } = await service
      .from('correo_respuestas_ia')
      .update({ estado: como.estado, proximo_intento_at: como.proximoIntentoAt === null ? null : aIso(como.proximoIntentoAt), actualizada_at: aIso(ahora) })
      .eq('mensaje_id', mensajeId)
      .eq('estado', 'procesando')
    if (error) throw fallo('No se ha podido devolver la respuesta a la cola.', error)
  }

  /** Las últimas respuestas leídas de estos buzones (null = todos), de la más reciente a la más antigua */
  async function respuestasRecientes(buzonIds: readonly string[] | null, desde: number, limite = 12): Promise<RespuestaLeida[]> {
    if (buzonIds !== null && buzonIds.length === 0) return []
    let q = service.from('correo_respuestas_ia').select(CAMPOS_DE_RESPUESTA).eq('estado', 'hecha').gte('recibida_at', aIso(desde))
    if (buzonIds !== null) q = q.in('buzon_id', [...buzonIds])
    const { data, error } = await q.order('recibida_at', { ascending: false }).limit(limite)
    if (error) {
      if (isMissingSchema(error)) return []
      throw fallo('No se han podido leer las respuestas de los leads.', error)
    }
    return ((data ?? []) as unknown as FilaDeRespuesta[]).map(respuestaLeida)
  }

  /** Cuántas respuestas hay de cada clase desde `desde`, y cuántas esperan o han fallado */
  async function contarRespuestas(buzonIds: readonly string[] | null, desde: number): Promise<{ porClase: Record<string, number>; pendientes: number; fallidas: number }> {
    const cuenta = { porClase: {} as Record<string, number>, pendientes: 0, fallidas: 0 }
    if (buzonIds !== null && buzonIds.length === 0) return cuenta
    const filas = await leerPaginas<{ clase: string | null; estado: string }>(
      (a, b) => {
        let q = service.from('correo_respuestas_ia').select('clase, estado').gte('recibida_at', aIso(desde))
        if (buzonIds !== null) q = q.in('buzon_id', [...buzonIds])
        return q.order('recibida_at', { ascending: false }).range(a, b)
      },
      'No se han podido contar las respuestas de los leads.',
      5000
    ).catch((e) => {
      if (isMissingSchema((e as { cause?: unknown }).cause)) return null
      throw e
    })
    if (filas === null) return cuenta
    for (const f of filas) {
      if (f.estado === 'hecha' && f.clase) cuenta.porClase[f.clase] = (cuenta.porClase[f.clase] ?? 0) + 1
      else if (f.estado === 'fallida') cuenta.fallidas++
      else if (f.estado === 'pendiente' || f.estado === 'procesando') cuenta.pendientes++
    }
    return cuenta
  }

  /** La respuesta leída de la secuencia de un lead (la más reciente), para enseñarla en su detalle */
  async function respuestaDeInscripcion(inscripcionId: string): Promise<RespuestaLeida | null> {
    const { data, error } = await service.from('correo_respuestas_ia').select(CAMPOS_DE_RESPUESTA).eq('inscripcion_id', inscripcionId).eq('estado', 'hecha').order('recibida_at', { ascending: false }).limit(1)
    if (error) {
      if (isMissingSchema(error)) return null
      throw fallo('No se ha podido leer la respuesta del lead.', error)
    }
    const fila = ((data ?? []) as unknown as FilaDeRespuesta[])[0]
    return fila ? respuestaLeida(fila) : null
  }

  /* ---------------- carga y salud de los buzones ---------------- */

  async function salientesPorHora(desde: number, buzonIds: readonly string[] | null = null): Promise<SalientesPorHora[]> {
    const { data, error } = await service.rpc('correo_secuencia_salientes_por_hora', { p_desde: aIso(desde), p_buzones: buzonIds && buzonIds.length > 0 ? [...buzonIds] : null })
    if (error) throw fallo('No se han podido contar los correos enviados.', error)
    return ((data ?? []) as Array<{ buzon_id: string; dia: string; hora: number; total: number; automaticos: number }>).map((f) => ({ buzonId: f.buzon_id, dia: f.dia, hora: Number(f.hora), total: Number(f.total), automaticos: Number(f.automaticos) }))
  }

  /** Cuánto ha enviado un buzón hoy y en la última hora, y cuándo salió su último correo (a mano o de una secuencia) */
  async function cargaDelBuzon(buzonId: string, ahora: number): Promise<{ enviadosHoy: number; enviadosUltimaHora: number; ultimoEnvioAt: number | null }> {
    const inicioDeHoy = instanteDeMadrid(diaDeMadrid(ahora), 0)
    const contar = async (desde: number): Promise<number> => {
      const { count, error } = await service
        .from('correo_mensajes')
        .select('id', { count: 'exact', head: true })
        .eq('buzon_id', buzonId)
        .eq('direccion', 'saliente')
        .gte('fecha', aIso(desde))
        .lte('fecha', aIso(ahora))
      if (error) throw fallo('No se han podido contar los envíos del buzón.', error)
      return count ?? 0
    }
    const [enviadosHoy, enviadosUltimaHora, ultimo] = await Promise.all([
      contar(inicioDeHoy),
      contar(ahora - 3_600_000),
      service.from('correo_mensajes').select('fecha').eq('buzon_id', buzonId).eq('direccion', 'saliente').lte('fecha', aIso(ahora)).order('fecha', { ascending: false }).limit(1),
    ])
    if (ultimo.error) throw fallo('No se ha podido leer el último envío del buzón.', ultimo.error)
    return { enviadosHoy, enviadosUltimaHora, ultimoEnvioAt: aMs(((ultimo.data ?? []) as Array<{ fecha: string }>)[0]?.fecha) }
  }

  /** Cuándo salió el último correo de cualquier secuencia */
  async function ultimoEnvioDelSistema(ahora: number): Promise<number | null> {
    const { data, error } = await service.from('correo_secuencia_pasos').select('enviado_at').eq('estado', 'enviado').gt('orden', 0).lte('enviado_at', aIso(ahora)).order('enviado_at', { ascending: false }).limit(1)
    if (error) throw fallo('No se ha podido leer el último envío del sistema.', error)
    return aMs(((data ?? []) as Array<{ enviado_at: string }>)[0]?.enviado_at)
  }

  async function saludDeBuzones(desde: number): Promise<SaludDeBuzon[]> {
    const { data, error } = await service.rpc('correo_secuencia_salud_buzones', { p_desde: aIso(desde) })
    if (error) throw fallo('No se ha podido medir la salud de los buzones.', error)
    return ((data ?? []) as Array<{ buzon_id: string; enviados: number; rebotes: number }>).map((f) => ({ buzonId: f.buzon_id, enviados: Number(f.enviados), rebotes: Number(f.rebotes) }))
  }

  /** Cómo va la conexión de estos buzones (null = todos): el último error al leerlos y cuántos fallos seguidos llevan */
  async function conexionDeBuzones(ids: readonly string[] | null): Promise<Map<string, ConexionLeida>> {
    const salida = new Map<string, ConexionLeida>()
    if (ids !== null && ids.length === 0) return salida
    for (const grupo of ids === null ? [null] : trozos([...ids])) {
      let q = service.from('correo_buzones').select('id, ultimo_error, fallos_seguidos, ultimo_intento_at')
      if (grupo !== null) q = q.in('id', grupo)
      const { data, error } = await q
      if (error) throw fallo('No se ha podido leer cómo van las conexiones de los buzones.', error)
      for (const f of (data ?? []) as Array<{ id: string; ultimo_error: string | null; fallos_seguidos: number | null; ultimo_intento_at: string | null }>) {
        salida.set(f.id, { ultimoError: f.ultimo_error, fallosSeguidos: Number(f.fallos_seguidos ?? 0), ultimoIntentoAt: aMs(f.ultimo_intento_at) })
      }
    }
    return salida
  }

  /**
   * Las pasadas AUTOMÁTICAS del motor que apuntó el registro de procesos: la última (sea de cuando sea) y cuántas hubo en la última hora y cuántas
   * acabaron mal. null = el registro no existe todavía (migración 137): entonces no se puede saber si el motor corre.
   */
  async function pasadasDelMotor(ahora: number): Promise<PasadasLeidas | null> {
    const base = () => service.from('cron_ejecuciones').select('iniciado_at, ok, error, duracion_ms').eq('tarea', 'correo-secuencias').is('lanzado_por', null)
    const [ultima, hora] = await Promise.all([base().order('iniciado_at', { ascending: false }).limit(1), base().gte('iniciado_at', aIso(ahora - 3_600_000)).order('iniciado_at', { ascending: false }).limit(500)])
    if (ultima.error) {
      if (isMissingSchema(ultima.error)) return null
      throw fallo('No se han podido leer las pasadas del motor.', ultima.error)
    }
    if (hora.error) throw fallo('No se han podido contar las pasadas del motor.', hora.error)
    const f = ((ultima.data ?? []) as Array<{ iniciado_at: string; ok: boolean | null; error: string | null; duracion_ms: number | null }>)[0]
    const recientes = (hora.data ?? []) as Array<{ ok: boolean | null; error: string | null }>
    return {
      ultima: f ? { en: aMs(f.iniciado_at) ?? 0, ok: f.ok, error: f.error, duracionMs: f.duracion_ms } : null,
      enLaUltimaHora: recientes.length,
      fallosEnLaUltimaHora: recientes.filter((x) => x.ok === false).length,
      ultimoErrorDeLaHora: recientes.find((x) => x.ok === false && x.error)?.error ?? null,
    }
  }

  /** Cuántos correos de secuencias que siguen vivas (en marcha o en pausa) han fallado al enviarse y esperan a una persona */
  async function enviosFallidos(limite = 200): Promise<number> {
    const { data, error } = await service.from('correo_secuencia_pasos').select('id, inscripcion_id').eq('estado', 'fallido').limit(limite)
    if (error) throw fallo('No se han podido contar los envíos fallidos.', error)
    const filas = (data ?? []) as Array<{ id: string; inscripcion_id: string }>
    if (filas.length === 0) return 0
    const vivas = await inscripcionesConEstado(filas.map((f) => f.inscripcion_id), ['activa', 'pausada'])
    return filas.filter((f) => vivas.has(f.inscripcion_id)).length
  }

  /** Quiénes administran el ERP: a ellos llegan los avisos de lo que se estropea */
  async function administradores(): Promise<string[]> {
    const { data, error } = await service.from('profiles').select('id').eq('role', 'admin')
    if (error) throw fallo('No se han podido leer los administradores.', error)
    return ((data ?? []) as Array<{ id: string }>).map((f) => f.id)
  }

  /** ¿Está en el ERP un correo enviado con este Message-ID? (para saber si un envío que se cortó a medias llegó a salir) */
  async function mensajeEnviado(buzonId: string, messageId: string): Promise<{ fecha: number } | null> {
    const { data, error } = await service.from('correo_mensajes').select('fecha').eq('buzon_id', buzonId).eq('direccion', 'saliente').eq('message_id', messageId.toLowerCase()).limit(1)
    if (error) throw fallo('No se ha podido comprobar si el correo salió.', error)
    const f = ((data ?? []) as Array<{ fecha: string }>)[0]
    return f ? { fecha: aMs(f.fecha) ?? 0 } : null
  }

  /* ---------------- cierre ---------------- */

  /** Las secuencias completadas a las que ya les toca pasar el lead a «No interesa» */
  async function inscripcionesParaNoInteresa(ahora: number, limite = 100): Promise<InscripcionDelMotor[]> {
    const { data, error } = await service
      .from('correo_secuencia_inscripciones')
      .select('*')
      .eq('estado', 'completada')
      .not('no_interesa_en', 'is', null)
      .lte('no_interesa_en', aIso(ahora))
      .order('no_interesa_en', { ascending: true })
      .limit(limite)
    if (error) throw fallo('No se han podido leer las secuencias por cerrar.', error)
    return ((data ?? []) as FilaDeInscripcion[]).map(inscripcionDelMotor)
  }

  /* ---------------- la memoria de direcciones que han rebotado ---------------- */

  /** Cuáles de estas direcciones ya rebotaron antes. Sin la tabla (migración sin lanzar) ninguna: no es un error */
  async function direccionesMalas(direcciones: readonly string[]): Promise<Map<string, RebotePrevio>> {
    const salida = new Map<string, RebotePrevio>()
    const unicas = [...new Set(direcciones.map((d) => d.trim().toLowerCase()).filter(Boolean))]
    for (const grupo of trozos(unicas)) {
      const { data, error } = await service.from('correo_direcciones_malas').select('direccion, motivo, veces').in('direccion', grupo).eq('estado', 'mala')
      if (error) {
        if (isMissingSchema(error)) return salida
        throw fallo('No se ha podido consultar la memoria de direcciones.', error)
      }
      for (const f of (data ?? []) as Array<{ direccion: string; motivo: string | null; veces: number }>) salida.set(f.direccion, { motivo: f.motivo, veces: f.veces })
    }
    return salida
  }

  /**
   * Apunta que una dirección ha rebotado. `cuando` es cuándo ocurrió el rebote: si ya se había apuntado uno igual o más reciente no se cuenta otra vez
   * (la vigilancia mira cada tramo dos veces). NUNCA lanza: aprender de un rebote no puede tumbar lo que se estaba haciendo.
   */
  async function marcarDireccionMala(direccion: string, motivo: string, origen: 'rebote' | 'rechazo_smtp' | 'manual', cuando: number, ahora: number): Promise<void> {
    const d = direccion.trim().toLowerCase()
    if (d.length < 3 || d.length > 320) return
    try {
      const { data, error } = await service.from('correo_direcciones_malas').select('direccion, veces, ultima_vez, estado').eq('direccion', d).maybeSingle()
      if (error) {
        if (!isMissingSchema(error)) console.error('[secuencias] no se ha podido leer la memoria de direcciones', { codigo: (error as { code?: string }).code ?? null })
        return
      }
      const previa = data as { veces: number; ultima_vez: string; estado: string } | null
      if (previa) {
        // Una dirección que una persona liberó vuelve a ser mala si rebota de nuevo DESPUÉS de liberarla
        if ((aMs(previa.ultima_vez) ?? 0) >= cuando) return
        const { error: e } = await service.from('correo_direcciones_malas').update({ estado: 'mala', motivo: motivo.slice(0, 300), origen, veces: previa.veces + 1, ultima_vez: aIso(cuando) }).eq('direccion', d)
        if (e) console.error('[secuencias] no se ha podido actualizar la memoria de direcciones', { codigo: (e as { code?: string }).code ?? null })
        return
      }
      const { error: e } = await service.from('correo_direcciones_malas').insert({ direccion: d, estado: 'mala', motivo: motivo.slice(0, 300), origen, veces: 1, primera_vez: aIso(cuando), ultima_vez: aIso(cuando) })
      if (e && (e as { code?: string }).code !== '23505') console.error('[secuencias] no se ha podido apuntar la dirección', { codigo: (e as { code?: string }).code ?? null })
    } catch (e) {
      console.error('[secuencias] fallo al apuntar una dirección mala', { mensaje: e instanceof Error ? e.message : 'desconocido' })
    }
    void ahora
  }

  /** Una persona dice que esa dirección en realidad funciona: deja de estar marcada como mala */
  async function liberarDireccion(direccion: string, ahora: number): Promise<boolean> {
    const { data, error } = await service.from('correo_direcciones_malas').update({ estado: 'liberada', ultima_vez: aIso(ahora) }).eq('direccion', direccion.trim().toLowerCase()).select('direccion')
    if (error) throw fallo('No se ha podido liberar la dirección.', error)
    return (data ?? []).length > 0
  }

  /** Los avisos de rebote duro que han entrado desde `desde`, de todos los buzones (aunque el correo no fuera de una secuencia) */
  async function rebotesRecientes(desde: number, limite = 500): Promise<AvisoDeRebote[]> {
    const { data, error } = await service.rpc('correo_secuencia_rebotes', { p_desde: aIso(desde), p_limite: limite })
    if (error) throw fallo('No se han podido leer los avisos de rebote.', error)
    return ((data ?? []) as Array<{ id: string; buzon_id: string; asunto: string; texto: string; fecha: string; creado_at: string }>).map((f) => ({ id: f.id, buzonId: f.buzon_id, asunto: f.asunto ?? '', texto: f.texto ?? '', fecha: aMs(f.fecha) ?? 0, creadoAt: aMs(f.creado_at) ?? 0 }))
  }

  /* ---------------- lo que lee la pantalla ---------------- */

  /** Los correos de secuencias con hora (o enviados) dentro del rango [desde, hasta) en los buzones que se indican (null = todos) */
  async function pasosEnElRango(buzonIds: readonly string[] | null, desde: number, hasta: number): Promise<PasoDelMotor[]> {
    if (buzonIds !== null && buzonIds.length === 0) return []
    const leer = async (columna: 'programado_at' | 'enviado_at'): Promise<FilaDePaso[]> =>
      leerPaginas<FilaDePaso>(
        (a, b) => {
          let q = service.from('correo_secuencia_pasos').select(CAMPOS_DE_PASO).gt('orden', 0).gte(columna, aIso(desde)).lt(columna, aIso(hasta))
          if (buzonIds !== null) q = q.in('buzon_id', [...buzonIds])
          return q.order(columna, { ascending: true }).range(a, b)
        },
        'No se han podido leer los correos del día.',
        5000
      )
    const [programados, enviados] = await Promise.all([leer('programado_at'), leer('enviado_at')])
    const porId = new Map<string, FilaDePaso>()
    for (const f of [...programados, ...enviados]) porId.set(f.id, f)
    return [...porId.values()].map(pasoDelMotor)
  }

  async function inscripcionesPorIds(ids: readonly string[]): Promise<InscripcionDelMotor[]> {
    const salida: InscripcionDelMotor[] = []
    for (const grupo of trozos([...new Set(ids)])) {
      const { data, error } = await service.from('correo_secuencia_inscripciones').select('*').in('id', grupo)
      if (error) throw fallo('No se han podido leer las secuencias.', error)
      salida.push(...((data ?? []) as FilaDeInscripcion[]).map(inscripcionDelMotor))
    }
    return salida
  }

  async function pasosDeInscripciones(ids: readonly string[]): Promise<PasoDelMotor[]> {
    const salida: PasoDelMotor[] = []
    for (const grupo of trozos([...new Set(ids)])) {
      const { data, error } = await service.from('correo_secuencia_pasos').select(CAMPOS_DE_PASO).in('inscripcion_id', grupo).order('orden', { ascending: true })
      if (error) throw fallo('No se han podido leer los correos de las secuencias.', error)
      salida.push(...((data ?? []) as FilaDePaso[]).map(pasoDelMotor))
    }
    return salida
  }

  /** Una página de secuencias, las más nuevas primero */
  async function listarInscripciones(filtro: FiltroDeCola, pagina: { desde: number; limite: number }): Promise<{ filas: InscripcionDelMotor[]; total: number }> {
    if (filtro.buzonIds !== null && filtro.buzonIds.length === 0) return { filas: [], total: 0 }
    if (filtro.leadIds !== undefined && filtro.leadIds.length === 0) return { filas: [], total: 0 }
    let q = service.from('correo_secuencia_inscripciones').select('*', { count: 'exact' })
    if (filtro.buzonIds !== null) q = q.in('buzon_id', [...filtro.buzonIds])
    if (filtro.estados !== null) q = q.in('estado', [...filtro.estados])
    if (filtro.leadIds !== undefined) q = q.in('lead_id', [...filtro.leadIds.slice(0, 100)])
    if (filtro.destinatario) q = q.ilike('destinatario', `%${filtro.destinatario.replace(/[%_\\]/g, (c) => `\\${c}`)}%`)
    if (filtro.creadasDesde !== undefined) q = q.gte('creada_at', aIso(filtro.creadasDesde))
    const { data, error, count } = await q.order('creada_at', { ascending: false }).range(pagina.desde, pagina.desde + pagina.limite - 1)
    if (error) throw fallo('No se han podido leer las secuencias.', error)
    return { filas: ((data ?? []) as FilaDeInscripcion[]).map(inscripcionDelMotor), total: count ?? 0 }
  }

  /** Cuántas secuencias hay de cada estado en esos buzones (null = todos) */
  async function contarPorEstado(buzonIds: readonly string[] | null): Promise<Record<EstadoDeInscripcion, number>> {
    const estados: EstadoDeInscripcion[] = ['activa', 'pausada', 'respondida', 'parada', 'completada', 'sin_respuesta', 'cancelada']
    const salida = Object.fromEntries(estados.map((e) => [e, 0])) as Record<EstadoDeInscripcion, number>
    if (buzonIds !== null && buzonIds.length === 0) return salida
    await Promise.all(
      estados.map(async (estado) => {
        let q = service.from('correo_secuencia_inscripciones').select('id', { count: 'exact', head: true }).eq('estado', estado)
        if (buzonIds !== null) q = q.in('buzon_id', [...buzonIds])
        const { count, error } = await q
        if (error) throw fallo('No se han podido contar las secuencias.', error)
        salida[estado] = count ?? 0
      })
    )
    return salida
  }

  async function leadsBasicos(ids: readonly string[]): Promise<Map<string, DatosBasicosDeLead>> {
    const salida = new Map<string, DatosBasicosDeLead>()
    for (const grupo of trozos([...new Set(ids)])) {
      const { data, error } = await service.from('cold_leads').select('id, store_name, company, status, assigned_to').in('id', grupo)
      if (error) throw fallo('No se han podido leer los leads.', error)
      for (const f of (data ?? []) as Array<{ id: string; store_name: string | null; company: string | null; status: string; assigned_to: string | null }>) {
        salida.set(f.id, { id: f.id, nombre: f.store_name?.trim() || f.company?.trim() || 'Sin nombre', empresa: f.company?.trim() || null, status: f.status, asignadoA: f.assigned_to })
      }
    }
    return salida
  }

  /** Los leads cuyo nombre contiene el texto (para buscar en la cola). Pocos: es una búsqueda, no un listado */
  async function buscarLeadsPorNombre(texto: string, limite = 60): Promise<string[]> {
    const t = texto.trim().replace(/[%_\\]/g, (c) => `\\${c}`)
    if (t.length < 2) return []
    const [a, b] = await Promise.all([
      service.from('cold_leads').select('id').ilike('store_name', `%${t}%`).limit(limite),
      service.from('cold_leads').select('id').ilike('company', `%${t}%`).limit(limite),
    ])
    if (a.error) throw fallo('No se ha podido buscar el lead.', a.error)
    if (b.error) throw fallo('No se ha podido buscar el lead.', b.error)
    return [...new Set([...(a.data ?? []), ...(b.data ?? [])].map((f: { id: string }) => f.id))]
  }

  /** Nombre, rol y si es comercial de estas personas (lo que hace falta para decidir quién puede ver el buzón de quién) */
  async function perfilesDe(ids: readonly string[]): Promise<Map<string, { nombre: string; role: string | null; isComercial: boolean | null }>> {
    const salida = new Map<string, { nombre: string; role: string | null; isComercial: boolean | null }>()
    for (const grupo of trozos([...new Set(ids)])) {
      const { data, error } = await service.from('profiles').select('id, full_name, email, role, is_comercial').in('id', grupo)
      if (error) throw fallo('No se han podido leer los perfiles.', error)
      for (const f of (data ?? []) as Array<{ id: string; full_name: string | null; email: string | null; role: string | null; is_comercial: boolean | null }>) {
        salida.set(f.id, { nombre: f.full_name?.trim() || f.email || 'Sin nombre', role: f.role, isComercial: f.is_comercial })
      }
    }
    return salida
  }

  async function nombresDePersonas(ids: readonly string[]): Promise<Map<string, string>> {
    const salida = new Map<string, string>()
    for (const grupo of trozos([...new Set(ids)])) {
      const { data, error } = await service.from('profiles').select('id, full_name, email').in('id', grupo)
      if (error) throw fallo('No se han podido leer los nombres.', error)
      for (const f of (data ?? []) as Array<{ id: string; full_name: string | null; email: string | null }>) salida.set(f.id, f.full_name?.trim() || f.email || 'Sin nombre')
    }
    return salida
  }

  /** Cuántas secuencias vivas tiene cada buzón */
  async function vivasPorBuzon(buzonIds: readonly string[] | null): Promise<Map<string, number>> {
    const salida = new Map<string, number>()
    const filas = await leerPaginas<{ buzon_id: string }>(
      (a, b) => {
        let q = service.from('correo_secuencia_inscripciones').select('buzon_id').in('estado', ['activa', 'pausada'])
        if (buzonIds !== null) q = q.in('buzon_id', [...buzonIds])
        return q.range(a, b)
      },
      'No se han podido contar las secuencias vivas.'
    )
    for (const f of filas) salida.set(f.buzon_id, (salida.get(f.buzon_id) ?? 0) + 1)
    return salida
  }

  /** Todas las direcciones marcadas como malas (para que un administrador las revise y libere) */
  async function listaDeDireccionesMalas(limite = 200): Promise<Array<{ direccion: string; estado: string; motivo: string | null; origen: string; veces: number; ultimaVez: number }>> {
    const { data, error } = await service.from('correo_direcciones_malas').select('direccion, estado, motivo, origen, veces, ultima_vez').order('ultima_vez', { ascending: false }).limit(limite)
    if (error) {
      if (isMissingSchema(error)) return []
      throw fallo('No se han podido leer las direcciones malas.', error)
    }
    return ((data ?? []) as Array<{ direccion: string; estado: string; motivo: string | null; origen: string; veces: number; ultima_vez: string }>).map((f) => ({ direccion: f.direccion, estado: f.estado, motivo: f.motivo, origen: f.origen, veces: f.veces, ultimaVez: aMs(f.ultima_vez) ?? 0 }))
  }

  /* ---------------- eventos ---------------- */

  const eventoLeido = (f: FilaDeEvento): EventoLeido => ({ id: f.id, inscripcionId: f.inscripcion_id, pasoId: f.paso_id, buzonId: f.buzon_id, tipo: f.tipo, detalle: f.detalle, en: aMs(f.creado_at) ?? 0 })

  /** NUNCA lanza: apuntar lo que pasó no puede tumbar lo que acaba de pasar */
  async function apuntarEvento(e: { inscripcionId?: string | null; pasoId?: string | null; buzonId?: string | null; tipo: TipoDeEvento; detalle?: string | null }, ahora: number): Promise<void> {
    try {
      const { error } = await service.from('correo_secuencia_eventos').insert({
        inscripcion_id: e.inscripcionId ?? null,
        paso_id: e.pasoId ?? null,
        buzon_id: e.buzonId ?? null,
        tipo: e.tipo,
        detalle: e.detalle ? e.detalle.slice(0, 600) : null,
        creado_at: aIso(ahora),
      })
      if (error) console.error('[secuencias] no se ha podido apuntar un evento', { tipo: e.tipo, codigo: (error as { code?: string }).code ?? null })
    } catch (error) {
      console.error('[secuencias] fallo al apuntar un evento', { tipo: e.tipo, mensaje: error instanceof Error ? error.message : 'desconocido' })
    }
  }

  async function eventosDe(inscripcionId: string, limite = 80): Promise<EventoLeido[]> {
    const { data, error } = await service.from('correo_secuencia_eventos').select('*').eq('inscripcion_id', inscripcionId).order('creado_at', { ascending: true }).order('id', { ascending: true }).limit(limite)
    if (error) throw fallo('No se ha podido leer el historial de la secuencia.', error)
    return ((data ?? []) as FilaDeEvento[]).map(eventoLeido)
  }

  /** Lo último que ha pasado en los buzones que se indican (null = todos), el más reciente primero */
  async function eventosRecientes(buzonIds: readonly string[] | null, limite = 40): Promise<EventoLeido[]> {
    if (buzonIds !== null && buzonIds.length === 0) return []
    // «programado» (la hora que se le da a cada correo) es ruido en una lista de lo último que ha pasado: tres por cada secuencia que se da de alta
    let consulta = service.from('correo_secuencia_eventos').select('*').neq('tipo', 'programado')
    if (buzonIds !== null) consulta = consulta.in('buzon_id', [...buzonIds])
    const { data, error } = await consulta.order('creado_at', { ascending: false }).order('id', { ascending: false }).limit(limite)
    if (error) throw fallo('No se ha podido leer lo último que ha pasado.', error)
    return ((data ?? []) as FilaDeEvento[]).map(eventoLeido)
  }

  /* ---------------- mantenimiento ---------------- */

  async function purgar(dias: number): Promise<number> {
    const { data, error } = await service.rpc('correo_secuencia_purgar', { p_dias: dias })
    if (error) throw fallo('No se han podido limpiar las secuencias antiguas.', error)
    return typeof data === 'number' ? data : 0
  }

  async function resumen(desde: number, buzonIds: readonly string[] | null): Promise<ResumenDelFlujo> {
    const { data, error } = await service.rpc('correo_secuencia_resumen', { p_desde: aIso(desde), p_buzones: buzonIds && buzonIds.length > 0 ? [...buzonIds] : null })
    if (error) throw fallo('No se ha podido calcular el resumen del flujo.', error)
    const r = (data ?? {}) as Record<string, unknown>
    const mapa = (v: unknown): Record<string, number> => Object.fromEntries(Object.entries((v ?? {}) as Record<string, unknown>).map(([k, n]) => [k, Number(n) || 0]))
    return { total: Number(r.total) || 0, porEstado: mapa(r.por_estado), porCodigo: mapa(r.por_codigo), enviados: mapa(r.enviados), respuestas: mapa(r.respuestas) }
  }

  return {
    leerAjustes,
    guardarAjustes,
    buzones,
    buzonPorId,
    ajustarBuzon,
    secuenciaBase,
    vigilar,
    pasosEnElRango,
    inscripcionesPorIds,
    pasosDeInscripciones,
    listarInscripciones,
    contarPorEstado,
    leadsBasicos,
    buscarLeadsPorNombre,
    nombresDePersonas,
    perfilesDe,
    vivasPorBuzon,
    listaDeDireccionesMalas,
    direccionesMalas,
    marcarDireccionMala,
    liberarDireccion,
    rebotesRecientes,
    entrantesDe,
    inscripcion,
    inscripcionesVivas,
    inscripcionVivaDeLead,
    pasosDe,
    pasoPorId,
    cambiarInscripcion,
    cerrarPasosAbiertos,
    crearInscripcion,
    reclamarPasos,
    soltarPaso,
    marcarPaso,
    guardarMessageId,
    editarPaso,
    moverPaso,
    pasosSinHora,
    pasosAtrasados,
    quitarHoras,
    ocupacion,
    fijarHoras,
    liberarEnsayados,
    leadParaMotor,
    notasDelLead,
    llamadasDelLead,
    correosManualesA,
    cambiarEstadoDelLead,
    apuntarNotaEnLead,
    ponerRellamada,
    leadsPorDireccion,
    hayNotaDelSistema,
    reclamarRespuestas,
    guardarLecturaDeRespuesta,
    anotarAplicacion,
    soltarRespuesta,
    respuestasRecientes,
    contarRespuestas,
    respuestaDeInscripcion,
    salientesPorHora,
    cargaDelBuzon,
    ultimoEnvioDelSistema,
    saludDeBuzones,
    conexionDeBuzones,
    pasadasDelMotor,
    enviosFallidos,
    administradores,
    mensajeEnviado,
    inscripcionesParaNoInteresa,
    apuntarEvento,
    eventosDe,
    eventosRecientes,
    purgar,
    resumen,
  }
}

export type AlmacenDeSecuencias = ReturnType<typeof almacenDeSecuencias>
