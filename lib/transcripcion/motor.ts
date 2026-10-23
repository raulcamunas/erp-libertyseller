import { ErrorRinkel, MENSAJE_DE_ERROR } from '@/lib/rendimiento/rinkel'
import { ErrorDeAudio, type AudioDescargado } from './audio'
import { costeDeVoz, enDolares } from './precios'
import { esperaTrasFallo, pistasDeLaLlamada, sinContenido, type PistasDeVoz } from './reglas'
import { construirEncargo, type ResultadoDelResumen } from './resumen'
import type { InteresDeLlamada, MomentoDeLaLlamada, TipoDeLlamada } from './tipos'
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
 *
 *
 * ============ CUANDO ALGO FALLA ============
 *
 *   · Lo que no tiene arreglo —Rinkel ya no tiene la grabación, el audio pasa de 24 MB, OpenAI no lo puede leer— se OMITE y no se reintenta.
 *   · Lo que puede arreglarse solo —red, Rinkel o OpenAI caídos— queda FALLIDA y vuelve a probarse a los 3 y a los 20 minutos; a la tercera se da por perdida.
 *   · Lo que es de la CUENTA y no de la llamada —la clave de OpenAI, el saldo— PARA la pasada entera (seguir con las demás es martillear a un proveedor
 *     que dice que no) y no gasta el intento de la llamada en curso.
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
}

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
}

export interface OpcionesDelMotor {
  /** Cuánto tiempo puede estar la pasada empezando llamadas nuevas. Pasado esto se acaban las que van y se para */
  presupuestoMs: number
  /** Cuántas llamadas se piden por pasada (la lista viene ordenada por antigüedad) */
  limite?: number
  concurrencia?: number
}

export type MotivoDeParada = 'tiempo' | 'tope_diario' | 'ia_no_disponible' | 'error'

export interface ResultadoDelMotor {
  candidatas: number
  hechas: number
  sinContenido: number
  omitidas: number
  fallidas: number
  /** Las que tenía otra pasada */
  ajenas: number
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

type Desenlace = 'hecha' | 'sin_contenido' | 'omitida' | 'fallida' | 'ajena'

interface ResultadoDeUna {
  desenlace: Desenlace
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
    const espera = cl.general ? 10 * 60_000 : esperaTrasFallo(fila.intentos)
    await almacen.marcarFallo(c.id, {
      estado: 'fallida',
      motivo: cl.motivo,
      siguienteIntentoAt: espera === null ? null : new Date(deps.ahora() + espera).toISOString(),
      devolverIntento: cl.general === true,
    })
    return { desenlace: 'fallida', segundos: segundosNuevos, costeUsd: costeNuevo, ...(cl.general ? { general: cl.motivo } : {}) }
  }

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
        return await fallar(clasificarFalloDeRinkel(e))
      }
      let audio: AudioDescargado
      try {
        audio = await deps.bajarAudio(url)
      } catch (e) {
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
    return { desenlace: r.resumen.tipo === 'sin_contenido' ? 'sin_contenido' : 'hecha', segundos: segundosNuevos, costeUsd: costeNuevo }
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

/* ------------------------------------------------------------------ */
/* Una pasada                                                          */
/* ------------------------------------------------------------------ */

export async function procesarPendientes(almacen: Almacen, deps: DepsDelMotor, op: OpcionesDelMotor): Promise<ResultadoDelMotor> {
  const inicio = deps.ahora()
  const ajustes = await almacen.leerAjustes()
  const topeS = ajustes.tope_diario_minutos * 60
  await almacen.cerrarAbandonadas()
  const gastadoS = await almacen.segundosDeLasUltimas24Horas()

  const salida: ResultadoDelMotor = {
    candidatas: 0,
    hechas: 0,
    sinContenido: 0,
    omitidas: 0,
    fallidas: 0,
    ajenas: 0,
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
      if (r.desenlace === 'hecha') salida.hechas++
      else if (r.desenlace === 'sin_contenido') salida.sinContenido++
      else if (r.desenlace === 'omitida') salida.omitidas++
      else if (r.desenlace === 'fallida') salida.fallidas++
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
    if (r.omitidas > 0) partes.push(`${r.omitidas} ${r.omitidas === 1 ? 'omitida' : 'omitidas'}`)
    if (r.fallidas > 0) partes.push(`${r.fallidas} ${r.fallidas === 1 ? 'fallida' : 'fallidas'}`)
    if (r.ajenas > 0) partes.push(`${r.ajenas} en manos de otra pasada`)
    if (r.segundos > 0) partes.push(`${minutos(r.segundos)} de audio · ${enDolares(r.costeUsd)}`)
  }
  if (r.parada === 'tope_diario') partes.push(`PARADA: tope de ${r.topeMinutos} min de audio en 24 h alcanzado`)
  if (r.parada === 'tiempo') partes.push('quedan llamadas para la próxima pasada')
  if ((r.parada === 'ia_no_disponible' || r.parada === 'error') && r.aviso) partes.push(`PARADA: ${r.aviso}`)
  partes.push(`24 h: ${Math.round((r.segundos24h + r.segundos) / 60)} de ${r.topeMinutos} min`)
  return partes.join(' · ')
}
