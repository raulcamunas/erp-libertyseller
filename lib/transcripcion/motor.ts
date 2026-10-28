import { diaDeMadrid } from '@/lib/correo/secuencias/fechas'
import { ErrorRinkel, MENSAJE_DE_ERROR } from '@/lib/rendimiento/rinkel'
import { ErrorDeAudio, type AudioDescargado } from './audio'
import { costeDeVoz, enDolares } from './precios'
import { ESPERA_SI_EL_AUDIO_ESTABA_A_MEDIAS_MS, ESPERA_SI_LA_GRABACION_NO_ESTA_MS, audioAMedias, esLlamadaReciente, esperaTrasFallo, pistasDeLaLlamada, sinContenido, type PistasDeVoz } from './reglas'
import { decidirCierreDeLlamada } from './rechazo'
import { decidirRellamadaDeLlamada, type LeadParaRellamada } from './rellamada'
import { construirEncargo, type ResultadoDelResumen } from './resumen'
import type { InteresDeLlamada, MomentoDeLaLlamada, PeticionDeRellamada, ResumenGenerado, TipoDeLlamada, TurnoDeLaLlamada } from './tipos'
import { INTENTOS_DE_TURNOS, MAX_FRASES_PARA_TURNOS, MIN_FRASES_PARA_TURNOS, armarTurnos, construirEncargoDeTurnos, partirEnFrases, type ResultadoDeTurnos } from './turnos'
import { ErrorDeVoz, esFalloGeneralDeLaIa, type ResultadoDeVoz } from './voz'

/**
 * EL MOTOR QUE TRANSCRIBE LAS LLAMADAS: QUÉ LLAMADAS, EN QUÉ ORDEN, Y QUÉ HACER CUANDO ALGO FALLA.
 * ===============================================================================================
 * NO TOCA LA BASE NI LA RED: recibe un `Almacen` (lo que lee y escribe) y unas `DepsDelMotor` (Rinkel, el audio, la voz, el resumen), y las
 * dos tienen versión de verdad (almacen.ts, deps.ts) y versión de pruebas. Se comprueba con motor.prueba.ts con un almacén en memoria y
 * proveedores falsos que fallan a propósito.
 *
 *
 * ============ POR LLAMADA ============
 *
 *   1. RESERVAR la llamada (el SQL lo hace atómico: si otra pasada la tiene, se salta). Cuenta un intento.
 *   2. Si todavía no está transcrita: la clave de Rinkel de su dueño -> la dirección temporal de la grabación -> el audio -> la voz.
 *      LA TRANSCRIPCIÓN SE GUARDA EN CUANTO SALE. Si el resumen falla después, el siguiente intento la encuentra hecha y NO vuelve a pagar el audio.
 *   3. Si lo transcrito es casi nada (silencio, un «¿diga?»), se cierra sin llamar a la IA de texto.
 *   4. El resumen (una llamada a la IA que saca resumen, línea de la conversación, siguiente paso e interés) y se guarda todo.
 *   5. Si el cliente pidió que se le llame un día («llámame el jueves»), ese día queda como la rellamada del lead (rellamada.ts decide). Es lo último y
 *      NO puede estropear nada de lo anterior: la llamada ya está transcrita y resumida, y si esto falla solo se apunta.
 *   6. Si en cambio dijo CLARAMENTE que no le interesa («no necesitamos nada»), su lead pasa a «No le interesa» (rechazo.ts decide: sus palabras tienen que estar
 *      en la llamada, nadie puede estar llevando el lead y no puede haber una rellamada por delante) y la ficha lo cuenta en una nota. Mismo trato que el paso 5.
 *
 * Y AL ACABAR LAS LLAMADAS, UN SEGUNDO TRABAJO APARTE: separar QUIÉN HABLA en la transcripción entera de las conversaciones ya resumidas («Comercial» y
 * «Cliente», deducido por la IA; turnos.ts). Va aparte para que el resumen no dependa de ello: sirve también para las llamadas que ya estaban hechas, se
 * reintenta solo y, si no sale, la transcripción se queda corrida como hasta ahora. Solo corre si queda tiempo en la pasada y la IA está disponible.
 *
 *
 * ============ CUANDO ALGO FALLA ============
 *
 *   · Lo que no tiene arreglo —Rinkel ya no tiene la grabación, el audio pasa de 24 MB, OpenAI no lo puede leer— se OMITE y no se reintenta.
 *   · Lo que puede arreglarse solo —red, Rinkel o OpenAI caídos— queda FALLIDA y vuelve a probarse a los 3 y a los 20 minutos; a la tercera se da por perdida.
 *   · Lo que es de la CUENTA y no de la llamada —la clave de OpenAI, el saldo— PARA la pasada entera (seguir con las demás es martillear a un proveedor
 *     que dice que no) y no gasta el intento de la llamada en curso.
 *   · LAS QUE ACABAN DE COLGAR (menos de MINUTOS_DE_LLAMADA_RECIENTE) son distintas: la transcripción empieza a los 45 s (migración 259), y Rinkel puede no tener
 *     aún la grabación («no encontrada» NO es «ya no la tiene»), servirla vacía o a medias. Eso se APLAZA —se vuelve a probar en 60–75 s y no gasta intentos—,
 *     y un audio que dura claramente menos que la llamada NO se guarda: se tira y se baja otra vez (se paga el trozo, una vez como mucho).
 *
 *
 * ============ EL GASTO ============
 *
 * Las 24 horas anteriores no pueden pasar del tope de minutos de audio de los ajustes (400 por defecto, unos 1,8 $). Antes de empezar cada llamada se
 * mira que quepa. Es la red de seguridad contra un bucle o una avalancha; el gasto normal son 45 minutos al día.
 */

export interface LlamadaPendiente {
  id: string
  user_id: string
  lead_id: string
  fecha: string
  direccion: string
  duracion_s: number
  grabacion_id: string
  intentos: number
}

export interface AjustesDelMotor {
  desde: string
  minimo_segundos: number
  tope_diario_minutos: number
}

/** La fila de la llamada tras reservarla: lo que una pasada anterior ya dejó hecho */
export interface FilaReservada {
  intentos: number
  transcripcion: string | null
  segundos_audio: number | null
  idioma: string | null
  modelo_voz: string | null
  coste_voz_usd: number | null
}

export interface ContextoDeLaLlamada {
  /** Nombre de la tienda a la que se llamó */
  empresa: string | null
  /** Nombre del comercial */
  comercial: string | null
}

export interface TranscripcionParaGuardar {
  texto: string
  idioma: string | null
  segundos: number
  modelo: string
  costeUsd: number
}

export interface ResultadoParaGuardar {
  tipo: TipoDeLlamada
  resumen: string | null
  linea: MomentoDeLaLlamada[]
  siguiente_paso: string | null
  interes: InteresDeLlamada
  modeloTexto: string | null
  costeTextoUsd: number
  /** Se vuelve a escribir la transcripción por si la primera vez no se pudo guardar */
  transcripcion: TranscripcionParaGuardar
}

export interface FalloParaGuardar {
  estado: 'fallida' | 'omitida'
  motivo: string
  /** Cuándo se puede volver a intentar. null = no se reintenta */
  siguienteIntentoAt: string | null
  /** Un fallo de la cuenta de la IA no es culpa de esta llamada: no gasta el intento */
  devolverIntento: boolean
}

export interface Almacen {
  leerAjustes(): Promise<AjustesDelMotor>
  /** Segundos de audio transcritos en las últimas 24 horas */
  segundosDeLasUltimas24Horas(): Promise<number>
  /** Reservas «procesando» muertas que ya no tienen intentos: se cierran como fallidas para que la ficha no diga «transcribiendo» para siempre */
  cerrarAbandonadas(): Promise<void>
  pendientes(ajustes: AjustesDelMotor, limite: number): Promise<LlamadaPendiente[]>
  /** null = la tiene otra pasada, o ya no toca */
  reservar(llamada: LlamadaPendiente): Promise<FilaReservada | null>
  contexto(llamada: LlamadaPendiente): Promise<ContextoDeLaLlamada>
  guardarTranscripcion(llamadaId: string, t: TranscripcionParaGuardar): Promise<void>
  guardarResultado(llamadaId: string, r: ResultadoParaGuardar): Promise<void>
  marcarFallo(llamadaId: string, f: FalloParaGuardar): Promise<void>
  /** El lead al que se llamó, con lo que hace falta para decidir su rellamada. null = ya no existe */
  leadParaRellamada(leadId: string): Promise<LeadParaRellamada | null>
  /** Los festivos de los ajustes de las secuencias, para no dejar una rellamada en uno. Sin ellos, ninguno */
  festivos(): Promise<string[]>
  /**
   * Pone el día de «Rellamar el» del lead, y lo deja en «Rellamada programada» si nadie lo lleva. Condicionado a que NO tenga ya otra rellamada para más
   * adelante (la habrá puesto el comercial al colgar): en ese caso, o si el estado cambió mientras tanto, devuelve 'no' y no toca nada. «En seguimiento»
   * solo recibe la fecha
   */
  ponerRellamada(leadId: string, fecha: string, hoy: string, ahora: number): Promise<'programado' | 'solo_fecha' | 'no'>
  /**
   * Pasa el lead a «No le interesa» si nadie lo lleva («Sin contactar», «No contesta», «Info enviada», y «Rellamada programada» solo si su día ya llegó o no tiene).
   * Condicionado en la base a eso: si el estado cambió mientras tanto, devuelve false y no toca nada. NO toca el día de «Rellamar el»
   */
  cerrarLead(leadId: string, hoy: string, ahora: number): Promise<boolean>
  /** Una nota del sistema (sin autor) en la línea de tiempo del lead. Si no se puede escribir, se apunta y se sigue */
  apuntarNota(leadId: string, cuerpo: string, ocurrioAt: number): Promise<void>

  /* ---- quién habla en la transcripción entera ---- */

  /** Conversaciones ya resumidas a las que les faltan los turnos, las más nuevas primero. Lanza FALTA_MIGRACION_TURNOS si no está la migración 253 */
  pendientesDeTurnos(limite: number): Promise<LlamadaSinTurnos[]>
  /** Reserva una para trabajar en ella (cuenta un intento). false = otra pasada se la ha adelantado */
  reservarTurnos(p: LlamadaSinTurnos): Promise<boolean>
  guardarTurnos(llamadaId: string, t: TurnosParaGuardar): Promise<void>
  /** El fallo es de la cuenta de la IA y no de la llamada: el intento no cuenta */
  devolverIntentoDeTurnos(llamadaId: string): Promise<void>
  /** Da la conversación por no separable (la IA se ha negado): agota sus intentos sin tocar `turnos`, así que la transcripción sale corrida y no se vuelve a pedir */
  abandonarTurnos(llamadaId: string): Promise<void>
}

/** Una conversación ya resumida que espera que se separe quién habla, con lo que hace falta para pedírselo a la IA */
export interface LlamadaSinTurnos {
  llamadaId: string
  transcripcion: string
  /** Intentos que lleva (el que se reserva es el siguiente) */
  intentos: number
  direccion: string
  duracionS: number
  comercial: string | null
  empresa: string | null
}

export interface TurnosParaGuardar {
  /** [] = no hay nada que separar y no se vuelve a intentar */
  turnos: TurnoDeLaLlamada[]
  modelo: string | null
  costeUsd: number
}

/** Lo que dice el proceso cuando falta la migración 253 (lo escribe el almacén y lo reconoce el motor) */
export const FALTA_MIGRACION_TURNOS =
  'Falta lanzar la migración 253_transcripcion_quien_habla.sql en el editor SQL de Supabase: hasta entonces la transcripción entera sale corrida, sin separar quién habla.'

export type ClaveDeRinkel = { clave: string } | { sinClave: true } | { ilegible: true }

export interface DepsDelMotor {
  ahora(): number
  /** El modelo de voz con el que se transcribe (para apuntarlo y para el coste) */
  modeloDeVoz: string
  claveDeRinkel(userId: string): Promise<ClaveDeRinkel>
  urlDeGrabacion(clave: string, grabacionId: string): Promise<string>
  bajarAudio(url: string): Promise<AudioDescargado>
  transcribir(audio: AudioDescargado, pistas: PistasDeVoz): Promise<ResultadoDeVoz>
  resumir(encargo: { system: string; usuario: string }): Promise<ResultadoDelResumen>
  /** Pide a la IA que reparta las frases en turnos. `frases` es cuántas se le mandan numeradas */
  separar(encargo: { system: string; usuario: string }, frases: number): Promise<ResultadoDeTurnos>
}

export interface OpcionesDelMotor {
  /** Cuánto tiempo puede estar la pasada empezando llamadas nuevas. Pasado esto se acaban las que van y se para */
  presupuestoMs: number
  /** Cuántas llamadas se piden por pasada (la lista viene ordenada por antigüedad) */
  limite?: number
  concurrencia?: number
  /** Solo transcribir, sin separar quién habla: para cuando hay alguien esperando la respuesta y lo de los turnos puede esperar al proceso automático */
  sinTurnos?: boolean
}

export type MotivoDeParada = 'tiempo' | 'tope_diario' | 'ia_no_disponible' | 'error'

export interface ResultadoDelMotor {
  candidatas: number
  hechas: number
  /** Llamadas en las que el cliente pidió un día y ha quedado puesto como la rellamada de su lead */
  rellamadas: number
  /** Leads que han pasado a «No le interesa» porque el cliente lo dijo claro en la llamada */
  cerrados: number
  /** Conversaciones a las que se les ha separado quién habla en esta pasada (incluye las que ya estaban transcritas de antes) */
  turnos: number
  /** Qué ha pasado con el trabajo de los turnos si algo falta (la migración 253) o falla del todo. null = bien */
  avisoDeTurnos: string | null
  sinContenido: number
  omitidas: number
  fallidas: number
  /** Las que tenía otra pasada */
  ajenas: number
  /** Llamadas recién colgadas cuya grabación aún no estaba lista o entera: se vuelven a probar en un minuto y no cuentan como fallo */
  aplazadas: number
  /** Segundos de audio transcritos en esta pasada */
  segundos: number
  costeUsd: number
  parada: MotivoDeParada | null
  /** Qué ha pasado si la pasada se ha parado por la IA o por un fallo de la base */
  aviso: string | null
  /** Lo transcrito en las 24 horas anteriores a esta pasada, y el tope */
  segundos24h: number
  topeMinutos: number
}

/* ------------------------------------------------------------------ */
/* Cómo se clasifica un fallo                                          */
/* ------------------------------------------------------------------ */

interface Clasificacion {
  /** true = no tiene arreglo: se omite y no se reintenta */
  terminal: boolean
  motivo: string
  /** true = es de la cuenta de la IA: para la pasada */
  general?: boolean
  /** Si viene, se vuelve a probar dentro de tantos ms en vez de con el escalonado de siempre (3 y 20 minutos) */
  esperaMs?: number
  /** true = este intento no cuenta: la llamada no tiene la culpa (aún no está lista la grabación) */
  devolverIntento?: boolean
  /** true = no es un fallo sino un «todavía no»: la pasada lo cuenta aparte */
  aplazada?: boolean
}

export function clasificarFalloDeRinkel(e: unknown): Clasificacion {
  if (e instanceof ErrorRinkel) {
    if (e.codigo === 'no_encontrada') return { terminal: true, motivo: 'Rinkel ya no tiene la grabación.' }
    if (e.codigo === 'clave_invalida' || e.codigo === 'sin_permiso') return { terminal: false, motivo: 'La clave de Rinkel de esta persona ya no vale.' }
    return { terminal: false, motivo: MENSAJE_DE_ERROR[e.codigo] }
  }
  return { terminal: false, motivo: 'No se ha podido pedir la grabación a Rinkel.' }
}

export function clasificarFalloDeAudio(e: unknown): Clasificacion {
  if (e instanceof ErrorDeAudio) {
    // Demasiado larga, formato raro o una dirección que no es de Rinkel: volver a bajarla da lo mismo
    if (e.codigo === 'demasiado_grande' || e.codigo === 'formato' || e.codigo === 'host') return { terminal: true, motivo: e.message }
    return { terminal: false, motivo: e.message }
  }
  return { terminal: false, motivo: 'No se ha podido bajar la grabación.' }
}

export function clasificarFalloDeVoz(e: unknown): Clasificacion {
  if (e instanceof ErrorDeVoz) {
    if (e.codigo === 'audio') return { terminal: true, motivo: e.message }
    return { terminal: false, motivo: e.message, general: esFalloGeneralDeLaIa(e.codigo) }
  }
  return { terminal: false, motivo: 'No se ha podido transcribir el audio.' }
}

/* ------------------------------------------------------------------ */
/* Una llamada                                                         */
/* ------------------------------------------------------------------ */

type Desenlace = 'hecha' | 'sin_contenido' | 'omitida' | 'fallida' | 'aplazada' | 'ajena'

interface ResultadoDeUna {
  desenlace: Desenlace
  /** true = el cliente pidió un día y ha quedado puesto como la rellamada de su lead */
  rellamada?: boolean
  /** true = el cliente dijo claramente que no y su lead ha pasado a «No le interesa» */
  cerrado?: boolean
  /** Audio transcrito AHORA (0 si ya estaba transcrita o no se llegó) */
  segundos: number
  costeUsd: number
  /** Si el fallo es de la cuenta de la IA: la frase para decirlo */
  general?: string
}

async function procesarUna(almacen: Almacen, deps: DepsDelMotor, claves: Map<string, Promise<ClaveDeRinkel>>, c: LlamadaPendiente): Promise<ResultadoDeUna> {
  const fila = await almacen.reservar(c)
  if (!fila) return { desenlace: 'ajena', segundos: 0, costeUsd: 0 }

  let segundosNuevos = 0
  let costeNuevo = 0

  const fallar = async (cl: Clasificacion): Promise<ResultadoDeUna> => {
    if (cl.terminal) {
      await almacen.marcarFallo(c.id, { estado: 'omitida', motivo: cl.motivo, siguienteIntentoAt: null, devolverIntento: false })
      return { desenlace: 'omitida', segundos: segundosNuevos, costeUsd: costeNuevo }
    }
    const espera = cl.esperaMs ?? (cl.general ? 10 * 60_000 : esperaTrasFallo(fila.intentos))
    await almacen.marcarFallo(c.id, {
      estado: 'fallida',
      motivo: cl.motivo,
      siguienteIntentoAt: espera === null ? null : new Date(deps.ahora() + espera).toISOString(),
      devolverIntento: cl.general === true || cl.devolverIntento === true,
    })
    return { desenlace: cl.aplazada ? 'aplazada' : 'fallida', segundos: segundosNuevos, costeUsd: costeNuevo, ...(cl.general ? { general: cl.motivo } : {}) }
  }
  // Una llamada que acaba de colgar puede no tener todavía la grabación lista (o entera): no es un fallo, es un «todavía no»
  const reciente = esLlamadaReciente(c.fecha, c.duracion_s, deps.ahora())
  const todaviaNo = (motivo: string, esperaMs = ESPERA_SI_LA_GRABACION_NO_ESTA_MS): Clasificacion => ({ terminal: false, motivo, esperaMs, devolverIntento: true, aplazada: true })

  try {
    const contexto = await almacen.contexto(c)
    let transcripcion: TranscripcionParaGuardar
    if (fila.transcripcion !== null) {
      // Una pasada anterior ya pagó el audio y el resumen falló después: no se paga otra vez
      transcripcion = {
        texto: fila.transcripcion,
        idioma: fila.idioma,
        segundos: fila.segundos_audio ?? c.duracion_s,
        modelo: fila.modelo_voz ?? deps.modeloDeVoz,
        costeUsd: fila.coste_voz_usd ?? 0,
      }
    } else {
      let ya = claves.get(c.user_id)
      if (!ya) {
        ya = deps.claveDeRinkel(c.user_id)
        claves.set(c.user_id, ya)
      }
      const clave = await ya
      if (!('clave' in clave)) {
        return await fallar({ terminal: false, motivo: 'sinClave' in clave ? 'La cuenta de Rinkel de esta persona ya no está vinculada.' : 'No se ha podido leer la clave de Rinkel guardada.' })
      }

      let url: string
      try {
        url = await deps.urlDeGrabacion(clave.clave, c.grabacion_id)
      } catch (e) {
        // Recién colgada, «no encontrada» (o una respuesta sin dirección) es que Rinkel aún no la tiene; pasados unos minutos vuelve a ser «ya no la tiene»
        if (reciente && e instanceof ErrorRinkel && (e.codigo === 'no_encontrada' || e.codigo === 'respuesta')) return await fallar(todaviaNo('La grabación aún no está lista en Rinkel.'))
        return await fallar(clasificarFalloDeRinkel(e))
      }
      let audio: AudioDescargado
      try {
        audio = await deps.bajarAudio(url)
      } catch (e) {
        // Vacío, o tan corto que no se reconoce el formato: un archivo que Rinkel todavía está escribiendo
        if (reciente && e instanceof ErrorDeAudio && (e.codigo === 'vacio' || e.codigo === 'formato')) return await fallar(todaviaNo('La grabación aún se está preparando en Rinkel.'))
        return await fallar(clasificarFalloDeAudio(e))
      }
      let voz: ResultadoDeVoz
      try {
        voz = await deps.transcribir(audio, pistasDeLaLlamada(contexto))
      } catch (e) {
        return await fallar(clasificarFalloDeVoz(e))
      }

      const segundos = voz.segundos ?? c.duracion_s
      transcripcion = { texto: voz.texto, idioma: voz.idiomas[0] ?? null, segundos, modelo: deps.modeloDeVoz, costeUsd: costeDeVoz(deps.modeloDeVoz, segundos) }
      segundosNuevos = segundos
      costeNuevo = transcripcion.costeUsd
      // Recién colgada y el audio dura claramente menos que la llamada: la grabación estaba a medias. Lo transcrito NO se guarda (un resumen con el final cortado
      // sería peor que esperar un minuto) y se baja otra vez. Solo en el primer intento: si a la segunda sigue más corto, es que Rinkel lo sirve así y se da por bueno
      if (reciente && fila.intentos < 2 && audioAMedias(voz.segundos, c.duracion_s)) {
        return await fallar({ ...todaviaNo(`La grabación estaba a medias (${segundos} s de ${c.duracion_s} s).`, ESPERA_SI_EL_AUDIO_ESTABA_A_MEDIAS_MS), devolverIntento: false })
      }
      // En cuanto sale se guarda: si el resumen falla, este audio no se vuelve a pagar. Si ni siquiera esto se puede guardar, se sigue y
      // se vuelve a intentar al guardar el resultado
      await almacen.guardarTranscripcion(c.id, transcripcion).catch(() => undefined)
    }

    if (sinContenido(transcripcion.texto)) {
      await almacen.guardarResultado(c.id, { tipo: 'sin_contenido', resumen: null, linea: [], siguiente_paso: null, interes: 'no_claro', modeloTexto: null, costeTextoUsd: 0, transcripcion })
      return { desenlace: 'sin_contenido', segundos: segundosNuevos, costeUsd: costeNuevo }
    }

    const encargo = construirEncargo({ transcripcion: transcripcion.texto, direccion: c.direccion, duracionS: transcripcion.segundos, fecha: c.fecha, comercial: contexto.comercial, empresa: contexto.empresa })
    const r = await deps.resumir(encargo)
    costeNuevo += r.costeUsd
    if (!r.resumen) return await fallar({ terminal: false, motivo: r.aviso ?? 'No se ha podido resumir la llamada.', general: r.general })

    await almacen.guardarResultado(c.id, {
      tipo: r.resumen.tipo,
      resumen: r.resumen.resumen,
      linea: r.resumen.linea,
      siguiente_paso: r.resumen.siguiente_paso,
      interes: r.resumen.interes,
      modeloTexto: r.modelo,
      costeTextoUsd: r.costeUsd,
      transcripcion,
    })
    // Lo entendido ya está guardado: ahora, y solo ahora, se toca la ficha del lead. Que no salga de aquí ningún error (no se debe marcar fallida una llamada hecha)
    const rellamada = r.resumen.rellamada ? await ponerLaRellamada(almacen, deps, c, transcripcion.texto, r.resumen.rellamada) : false
    // Un «no» claro cierra el lead; si el cliente pidió que le llamen otro día, manda esa rellamada y no se cierra nada
    const cerrado = r.resumen.rellamada ? false : await cerrarSiDijoQueNo(almacen, deps, c, transcripcion.texto, r.resumen)
    return { desenlace: r.resumen.tipo === 'sin_contenido' ? 'sin_contenido' : 'hecha', segundos: segundosNuevos, costeUsd: costeNuevo, rellamada, cerrado }
  } catch (e) {
    // Un fallo de la base o algo imprevisto: la llamada queda fallida (si ni siquiera eso se puede escribir, la reserva caduca sola a los 10 minutos)
    console.error('[transcripcion] fallo inesperado en una llamada', { nombre: e instanceof Error ? e.name : 'desconocido', mensaje: e instanceof Error ? e.message.slice(0, 160) : '' })
    try {
      return await fallar({ terminal: false, motivo: 'Ha fallado algo al procesar la llamada.' })
    } catch {
      return { desenlace: 'fallida', segundos: segundosNuevos, costeUsd: costeNuevo }
    }
  }
}

/**
 * Si el cliente dijo claramente que NO le interesa, pasa su lead a «No le interesa» (rechazo.ts decide: palabras comprobadas, nadie lo lleva, sin rellamada
 * por delante) y deja una nota en la ficha con qué dijo y cómo deshacerlo. Si dice que no pero el lead no se puede tocar, deja una nota para que lo mire una
 * persona. Devuelve si lo ha cerrado. NUNCA lanza, por lo mismo que la rellamada: la llamada ya está transcrita y resumida.
 */
async function cerrarSiDijoQueNo(almacen: Almacen, deps: DepsDelMotor, c: LlamadaPendiente, transcripcion: string, resumen: ResumenGenerado): Promise<boolean> {
  // Lo normal: nadie rechazó nada. Ni se lee el lead
  if (resumen.tipo !== 'conversacion' || resumen.interes !== 'ninguno') return false
  try {
    const ahora = deps.ahora()
    const hoy = diaDeMadrid(ahora)
    const lead = await almacen.leadParaRellamada(c.lead_id)
    const d = decidirCierreDeLlamada({ resumen, transcripcion, fechaDeLaLlamada: c.fecha, hoy, lead, comercialId: c.user_id })
    if (!d.cerrar) {
      if (d.nota) await almacen.apuntarNota(c.lead_id, d.nota, ahora)
      return false
    }
    if (!(await almacen.cerrarLead(c.lead_id, hoy, ahora))) {
      // Entre leer el lead y escribirle, alguien lo ha movido: gana la persona
      await almacen.apuntarNota(c.lead_id, 'En una llamada el cliente dijo que no le interesa, pero la ficha ha cambiado mientras tanto y no se ha cambiado el estado. Revísala.', ahora)
      return false
    }
    await almacen.apuntarNota(c.lead_id, d.nota, ahora)
    return true
  } catch (e) {
    // Solo qué ha pasado, nunca lo que se dijo en la llamada
    console.error('[transcripcion] no se ha podido pasar el lead a «No le interesa»', { nombre: e instanceof Error ? e.name : 'desconocido', mensaje: e instanceof Error ? e.message.slice(0, 160) : '' })
    return false
  }
}

/**
 * Si el cliente pidió que le llamen un día, lo deja como la rellamada de su lead. Devuelve si la ha puesto. NUNCA lanza: la llamada ya está transcrita y
 * resumida, y una rellamada que no se puede poner (la base no contesta) cuesta menos que marcar como fallida una llamada hecha y pagar otra vez su resumen
 */
async function ponerLaRellamada(almacen: Almacen, deps: DepsDelMotor, c: LlamadaPendiente, transcripcion: string, peticion: PeticionDeRellamada): Promise<boolean> {
  try {
    const ahora = deps.ahora()
    const hoy = diaDeMadrid(ahora)
    const [lead, festivos] = await Promise.all([almacen.leadParaRellamada(c.lead_id), almacen.festivos().catch(() => [] as string[])])
    const d = decidirRellamadaDeLlamada({ peticion, transcripcion, fechaDeLaLlamada: c.fecha, hoy, festivos, lead, comercialId: c.user_id })
    if (!d.poner) {
      if (d.nota) await almacen.apuntarNota(c.lead_id, d.nota, ahora)
      return false
    }
    const puesta = await almacen.ponerRellamada(c.lead_id, d.fecha, hoy, ahora)
    if (puesta === 'no') {
      // Entre leer el lead y escribirle, alguien lo ha movido o le ha puesto otra rellamada: gana la persona
      await almacen.apuntarNota(c.lead_id, 'En una llamada el cliente pidió que le llamen otro día, pero la ficha ha cambiado mientras tanto y no se ha puesto la rellamada. Revísala.', ahora)
      return false
    }
    await almacen.apuntarNota(c.lead_id, d.nota, ahora)
    return true
  } catch (e) {
    // Solo qué ha pasado, nunca lo que se dijo en la llamada
    console.error('[transcripcion] no se ha podido poner la rellamada', { nombre: e instanceof Error ? e.name : 'desconocido', mensaje: e instanceof Error ? e.message.slice(0, 160) : '' })
    return false
  }
}

/* ------------------------------------------------------------------ */
/* Una pasada                                                          */
/* ------------------------------------------------------------------ */

export async function procesarPendientes(almacen: Almacen, deps: DepsDelMotor, op: OpcionesDelMotor): Promise<ResultadoDelMotor> {
  const inicio = deps.ahora()
  const salida = await transcribirLasPendientes(almacen, deps, op, inicio)
  // Lo de los turnos va DESPUÉS y aparte: sin la IA (parada por su cuenta) o sin la base no se intenta, y un fallo aquí nunca estropea lo ya hecho
  if (!op.sinTurnos && salida.parada !== 'ia_no_disponible' && salida.parada !== 'error') await separarQuienHabla(almacen, deps, op, inicio, salida)
  return salida
}

async function transcribirLasPendientes(almacen: Almacen, deps: DepsDelMotor, op: OpcionesDelMotor, inicio: number): Promise<ResultadoDelMotor> {
  const ajustes = await almacen.leerAjustes()
  const topeS = ajustes.tope_diario_minutos * 60
  await almacen.cerrarAbandonadas()
  const gastadoS = await almacen.segundosDeLasUltimas24Horas()

  const salida: ResultadoDelMotor = {
    candidatas: 0,
    hechas: 0,
    rellamadas: 0,
    cerrados: 0,
    turnos: 0,
    avisoDeTurnos: null,
    sinContenido: 0,
    omitidas: 0,
    fallidas: 0,
    ajenas: 0,
    aplazadas: 0,
    segundos: 0,
    costeUsd: 0,
    parada: null,
    aviso: null,
    segundos24h: gastadoS,
    topeMinutos: ajustes.tope_diario_minutos,
  }

  if (gastadoS >= topeS) {
    salida.parada = 'tope_diario'
    return salida
  }

  const pendientes = await almacen.pendientes(ajustes, op.limite ?? 12)
  salida.candidatas = pendientes.length
  if (pendientes.length === 0) return salida

  const claves = new Map<string, Promise<ClaveDeRinkel>>()
  let siguiente = 0
  let parada: MotivoDeParada | null = null

  const trabajador = async () => {
    for (;;) {
      if (parada) return
      if (deps.ahora() - inicio >= op.presupuestoMs) {
        parada ??= 'tiempo'
        return
      }
      const c = pendientes[siguiente++]
      if (!c) return
      // Antes de empezar una llamada se mira que quepa en el tope de 24 horas
      if (gastadoS + salida.segundos + c.duracion_s > topeS) {
        parada ??= 'tope_diario'
        return
      }

      let r: ResultadoDeUna
      try {
        r = await procesarUna(almacen, deps, claves, c)
      } catch (e) {
        // Ni siquiera se ha podido reservar la llamada (la base no contesta): seguir con las demás es lo mismo. La pasada falla a la vista
        console.error('[transcripcion] no se ha podido reservar una llamada', { nombre: e instanceof Error ? e.name : 'desconocido' })
        salida.aviso = 'No se ha podido hablar con la base de datos.'
        parada = 'error'
        return
      }
      salida.segundos += r.segundos
      salida.costeUsd += r.costeUsd
      if (r.rellamada) salida.rellamadas++
      if (r.cerrado) salida.cerrados++
      if (r.desenlace === 'hecha') salida.hechas++
      else if (r.desenlace === 'sin_contenido') salida.sinContenido++
      else if (r.desenlace === 'omitida') salida.omitidas++
      else if (r.desenlace === 'fallida') salida.fallidas++
      else if (r.desenlace === 'aplazada') salida.aplazadas++
      else salida.ajenas++
      if (r.general) {
        salida.aviso = r.general
        parada = 'ia_no_disponible'
        return
      }
    }
  }

  const n = Math.max(1, Math.min(op.concurrencia ?? 2, pendientes.length))
  await Promise.all(Array.from({ length: n }, () => trabajador()))

  salida.parada = parada
  return salida
}

/* ------------------------------------------------------------------ */
/* Quién habla en la transcripción entera                              */
/* ------------------------------------------------------------------ */

/** Cuántas conversaciones se separan como mucho en una pasada: cada una es una llamada a la IA de unos 3–5 s, y las que quedan entran en la siguiente (cada 2 min) */
export const TURNOS_POR_PASADA = 6

/**
 * Reparte en turnos («Comercial» y «Cliente») la transcripción de las conversaciones ya resumidas a las que les falta. NUNCA lanza ni cambia el resultado de lo ya
 * hecho: lo que no sale se reintenta más tarde (hasta INTENTOS_DE_TURNOS, con diez minutos entre uno y otro: aguanta una caída de la IA de más de una hora) y, si
 * nunca sale, la transcripción se enseña corrida como siempre y la pasada lo dice con un AVISO. Si la IA se NIEGA a una llamada, no se insiste: se deja a la primera.
 */
async function separarQuienHabla(almacen: Almacen, deps: DepsDelMotor, op: OpcionesDelMotor, inicio: number, salida: ResultadoDelMotor): Promise<void> {
  try {
    const pendientes = await almacen.pendientesDeTurnos(TURNOS_POR_PASADA)
    for (const p of pendientes) {
      // La pasada tiene un presupuesto de tiempo: lo que no cabe entra en la siguiente
      if (deps.ahora() - inicio >= op.presupuestoMs) return
      if (!(await almacen.reservarTurnos(p))) continue

      const frases = partirEnFrases(p.transcripcion)
      if (frases.length < MIN_FRASES_PARA_TURNOS || frases.length > MAX_FRASES_PARA_TURNOS) {
        // Nada que separar (una sola frase) o demasiado larga: se deja marcado para no volver a mirarla y la transcripción sale corrida
        await almacen.guardarTurnos(p.llamadaId, { turnos: [], modelo: null, costeUsd: 0 })
        continue
      }

      const r = await deps.separar(
        construirEncargoDeTurnos({ frases, direccion: p.direccion, duracionS: p.duracionS, comercial: p.comercial, empresa: p.empresa }),
        frases.length
      )
      salida.costeUsd += r.costeUsd
      // Si este era el ÚLTIMO intento y no ha salido, la transcripción se queda corrida para siempre: eso no puede pasar en silencio
      const ultimoIntento = p.intentos + 1 >= INTENTOS_DE_TURNOS
      const avisoDeAgotada = `Una conversación no se ha podido separar por quién habla tras ${INTENTOS_DE_TURNOS} intentos y se enseña como texto corrido.`
      if (!r.marcas) {
        if (r.general) {
          // La cuenta de la IA no deja trabajar (clave, saldo): no es culpa de la llamada y seguir con las demás es martillear
          await almacen.devolverIntentoDeTurnos(p.llamadaId)
          salida.avisoDeTurnos = r.aviso
          return
        }
        if (!r.reintentable) {
          // La IA se ha negado a esta llamada: pedirlo otra vez no cambia nada. Se deja ya, sin gastar los intentos que quedan
          await almacen.abandonarTurnos(p.llamadaId)
          salida.avisoDeTurnos ??= `${r.aviso} Se enseña como texto corrido.`
          continue
        }
        if (ultimoIntento) salida.avisoDeTurnos ??= avisoDeAgotada
        continue
      }
      const turnos = armarTurnos(frases, r.marcas)
      if (turnos.length === 0) {
        if (ultimoIntento) salida.avisoDeTurnos ??= avisoDeAgotada
        continue
      }
      await almacen.guardarTurnos(p.llamadaId, { turnos, modelo: r.modelo, costeUsd: r.costeUsd })
      salida.turnos++
    }
  } catch (e) {
    if (e instanceof Error && e.message === FALTA_MIGRACION_TURNOS) {
      salida.avisoDeTurnos = FALTA_MIGRACION_TURNOS
      return
    }
    // Un fallo de la base o algo imprevisto: se apunta qué ha pasado, nunca lo que se dijo en la llamada, y se sigue
    console.error('[transcripcion] fallo al separar quién habla', { nombre: e instanceof Error ? e.name : 'desconocido', mensaje: e instanceof Error ? e.message.slice(0, 160) : '' })
    salida.avisoDeTurnos = 'Ha fallado algo al separar quién habla en las transcripciones.'
  }
}

/* ------------------------------------------------------------------ */
/* Lo que se cuenta en Sistema                                         */
/* ------------------------------------------------------------------ */

const minutos = (segundos: number) => `${(segundos / 60).toFixed(1).replace('.', ',')} min`

/** Una línea para el registro de procesos: qué se ha hecho, cuánto ha costado y cuánto queda de tope */
export function resumenDeLaPasada(r: ResultadoDelMotor): string {
  const partes: string[] = []
  if (r.candidatas === 0 && r.parada !== 'tope_diario') {
    partes.push('Nada que transcribir')
  } else {
    const hechas = r.hechas + r.sinContenido
    partes.push(`${hechas} ${hechas === 1 ? 'transcrita' : 'transcritas'}${r.sinContenido > 0 ? ` (${r.sinContenido} sin contenido)` : ''}`)
    if (r.rellamadas > 0) partes.push(`${r.rellamadas} ${r.rellamadas === 1 ? 'rellamada puesta' : 'rellamadas puestas'}`)
    if (r.cerrados > 0) partes.push(`${r.cerrados} ${r.cerrados === 1 ? 'lead pasado' : 'leads pasados'} a «No le interesa»`)
    if (r.omitidas > 0) partes.push(`${r.omitidas} ${r.omitidas === 1 ? 'omitida' : 'omitidas'}`)
    if (r.fallidas > 0) partes.push(`${r.fallidas} ${r.fallidas === 1 ? 'fallida' : 'fallidas'}`)
    if (r.aplazadas > 0) partes.push(`${r.aplazadas} ${r.aplazadas === 1 ? 'espera' : 'esperan'} a que Rinkel termine la grabación`)
    if (r.ajenas > 0) partes.push(`${r.ajenas} en manos de otra pasada`)
    if (r.segundos > 0) partes.push(`${minutos(r.segundos)} de audio · ${enDolares(r.costeUsd)}`)
  }
  if (r.parada === 'tope_diario') partes.push(`PARADA: tope de ${r.topeMinutos} min de audio en 24 h alcanzado`)
  if (r.parada === 'tiempo') partes.push('quedan llamadas para la próxima pasada')
  if ((r.parada === 'ia_no_disponible' || r.parada === 'error') && r.aviso) partes.push(`PARADA: ${r.aviso}`)
  if (r.turnos > 0) partes.push(`${r.turnos} ${r.turnos === 1 ? 'conversación separada' : 'conversaciones separadas'} por quién habla`)
  if (r.avisoDeTurnos) partes.push(`AVISO: ${r.avisoDeTurnos}`)
  partes.push(`24 h: ${Math.round((r.segundos24h + r.segundos) / 60)} de ${r.topeMinutos} min`)
  return partes.join(' · ')
}
