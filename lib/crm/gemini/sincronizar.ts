import { analizarReunion, construirEncargoDeAnalisis, hayAlgoQueAnalizar, type DatosDelAnalisis, type OpcionesDelAnalisis, type ResultadoDelAnalisis } from './analisis'
import { casarNota, type CandidatoDeCita, type ResultadoDeCasar } from './casar'
import { esReunionConCliente, esReunionSinTitulo, leerCorreoDeGemini, tituloDeLaReunion } from './correo'
import { fusionarNotas, leerDocumento } from './documento'
import { ErrorDeGoogle } from './errores-google'
import type { FuenteDeGoogle } from './google'
import type { AnalisisDeReunion, EstadoDeNota, MetodoDeCita, NotaLeida, PasoDeNota, TemaDeNota } from './tipos'

/**
 * LA SINCRONIZACIÓN DE LAS NOTAS DE GEMINI: DE GMAIL Y DRIVE A LA FICHA DE CADA CLIENTE.
 * ======================================================================================
 * Una pasada (la lanza el cron cada pocos minutos, o el botón «Sincronizar ahora» de la pantalla) hace, por este orden y sin pasarse de un presupuesto de tiempo:
 *
 *   1. CORREOS NUEVOS  los correos de gemini-notes@ de los últimos 30 días que todavía no están guardados, de MÁS ANTIGUO a más nuevo, hasta `maxNuevos`. Cada uno:
 *        · reunión INTERNA (por el título: «Reunión Semanal | Comerciales»…) -> se apunta como `ignorada` (solo el id y el título) y NO se abre su documento: ese texto
 *          no tiene nada que hacer en el CRM, y no sale de Gmail.
 *        · reunión con un CLIENTE (el título de las citas del ERP) -> se abre el documento «Notas de Gemini» (detalle, transcripción, invitado y evento), se casa con una
 *          cita (casar.ts) y se guarda: `pendiente` si hay cliente, `sin_cita` si no.
 *        · reunión SIN TÍTULO («Reunión del 23 oct a las 12:03») -> se abre el documento para ver si enlaza una cita o trae el correo de un lead; si casa se guarda, si no
 *          se apunta como ignorada.
 *   2. COMPLETAR      las notas guardadas solo con el correo (porque el documento no se pudo abrir en su momento) se completan en cuanto se puede, y si estaban sin cita se
 *                     vuelven a casar con lo nuevo (invitado y evento).
 *   3. RECASAR        las `sin_cita` recientes se vuelven a probar: la cita puede haber llegado de Google Calendar después que la nota.
 *   4. ANALIZAR       las `pendiente` (con cliente) pasan por la IA, de la más reciente a la más antigua, un par por pasada. Un fallo de la IA reintenta unas veces y luego
 *                     la deja en `error`: no se gasta dinero para siempre.
 *
 * LOS FALLOS DE GOOGLE SE LEEN: si faltan los permisos o la API está apagada, la pasada NO sigue con Google (cada intento fallaría igual), lo dice en `detenida` con la frase
 * de qué hay que hacer, y aun así analiza lo que ya está guardado (eso no necesita a Google). Un documento concreto que no se puede abrir no para nada: esa nota se guarda con
 * lo del correo y se completará después.
 *
 * ES IDEMPOTENTE: lo ya guardado se salta por el id del correo (índice único), así que repetir una pasada, solaparse dos o relanzarla a mano no duplica nada.
 *
 * El acceso a Google y a la base entran como parámetros (FuenteDeGoogle y AlmacenDeNotas): la lógica se prueba entera con un Google y una base de mentira
 * (sincronizar.prueba.ts), y la versión de verdad vive en google.ts y almacen.ts.
 */

/* ------------------------------------------------------------------ */
/* Lo que se necesita de la base                                       */
/* ------------------------------------------------------------------ */

/** Lo que la sincronización lee de una nota ya guardada (sin el contenido, que pesa decenas de miles de caracteres) */
export interface NotaGuardada {
  id: string
  estado: EstadoDeNota
  client_id: string | null
  appointment_id: string | null
  metodo_cita: MetodoDeCita | null
  gmail_message_id: string | null
  drive_file_id: string | null
  google_event_id: string | null
  titulo: string
  fecha_reunion: string | null
  invitados: string[]
  completa: boolean
  analisis_intentos: number
  error: string | null
}

/** Una nota nueva, lista para insertar */
export interface NotaNueva {
  estado: EstadoDeNota
  client_id: string | null
  appointment_id: string | null
  metodo_cita: MetodoDeCita | null
  gmail_message_id: string | null
  drive_file_id: string | null
  google_event_id: string | null
  titulo: string
  fecha_reunion: string | null
  invitados: string[]
  resumen: string | null
  temas: TemaDeNota[]
  proximos_pasos: PasoDeNota[]
  detalle: string | null
  transcripcion: string | null
  completa: boolean
}

export type CambiosDeNota = Partial<NotaNueva> & {
  analisis?: AnalisisDeReunion | null
  analisis_modelo?: string | null
  analisis_en?: string | null
  analisis_intentos?: number
  error?: string | null
}

export interface AlmacenDeNotas {
  /** De estos ids de correo, los que ya están guardados (en cualquier estado) */
  conocidos(idsDeCorreo: string[]): Promise<Set<string>>
  /** Todas las fichas del CRM con los datos de contacto buenos (los de la cita si la hay) */
  candidatos(): Promise<CandidatoDeCita[]>
  /** 'repetida' si ese correo o ese documento ya estaban (índice único): no es un fallo */
  insertar(nota: NotaNueva): Promise<'creada' | 'repetida'>
  /** Notas con el correo leído pero no el documento (y con documento al que ir), creadas desde esa fecha, las más recientes primero */
  incompletas(desdeIso: string, max: number): Promise<NotaGuardada[]>
  /** Notas sin cita ya completas, creadas desde esa fecha */
  sinCita(desdeIso: string, max: number): Promise<NotaGuardada[]>
  /** Notas con cliente que esperan análisis: sin error o con el último intento anterior a `reintentarAntesDeIso`; las de reunión más reciente primero */
  pendientesDeAnalisis(max: number, reintentarAntesDeIso: string): Promise<NotaGuardada[]>
  actualizar(id: string, cambios: CambiosDeNota): Promise<void>
  /** El contenido de una nota y la ficha de su cliente, listo para el encargo de la IA. null si la nota ya no existe */
  datosParaAnalizar(id: string): Promise<DatosDelAnalisis | null>
}

/* ------------------------------------------------------------------ */
/* Opciones y resultado                                                */
/* ------------------------------------------------------------------ */

export interface OpcionesDeSincronizacion {
  ahora?: () => Date
  /** Reloj en milisegundos para medir el presupuesto (se sustituye en las pruebas) */
  reloj?: () => number
  /** Hasta cuántos días atrás se buscan correos. 30 */
  diasAtras?: number
  /** Cuántos ids de correo se piden a Gmail por pasada. 150 */
  maxLista?: number
  /** Cuántos correos nuevos se procesan por pasada. 20 */
  maxNuevos?: number
  /** Cuántas notas incompletas se intentan completar por pasada. 5 */
  maxIncompletas?: number
  /** Cuántas notas se analizan por pasada. 2 */
  maxAnalisis?: number
  /** Cuántos intentos de análisis antes de dejar la nota en `error`. 4 */
  maxIntentosDeAnalisis?: number
  /** Minutos que se espera tras un análisis fallido antes de reintentarlo. 10 */
  minutosEntreIntentos?: number
  /** Tiempo total de la pasada. 240.000 ms: la ruta aguanta 300 s */
  presupuestoMs?: number
  /** Solo para las pruebas: la IA de mentira */
  analizar?: (encargo: { system: string; usuario: string }, opciones?: OpcionesDelAnalisis) => Promise<ResultadoDelAnalisis>
}

export interface ResultadoDeSincronizacion {
  /** Correos nuevos que se han mirado */
  revisados: number
  /** Notas de clientes guardadas */
  nuevas: number
  /** Reuniones internas apuntadas para no volver a mirarlas */
  ignoradas: number
  /** Notas que han recibido su documento */
  completadas: number
  /** Notas que han encontrado cliente después de guardarse */
  recasadas: number
  analizadas: number
  costeUsd: number
  /** Cosas que quien administra debería ver: permisos que faltan, documentos que no se abren… */
  avisos: string[]
  /** Por qué se paró lo de Google (null si no se paró) */
  detenida: string | null
}

const DIA_MS = 86_400_000

/** La nota que se guarda de un correo que no es de un cliente: solo para no volver a leerlo */
function notaIgnorada(id: string, titulo: string, fecha: string | null): NotaNueva {
  return {
    estado: 'ignorada',
    client_id: null,
    appointment_id: null,
    metodo_cita: null,
    gmail_message_id: id,
    drive_file_id: null,
    google_event_id: null,
    titulo: titulo.slice(0, 200) || '(sin título)',
    fecha_reunion: fecha,
    invitados: [],
    resumen: null,
    temas: [],
    proximos_pasos: [],
    detalle: null,
    transcripcion: null,
    completa: false,
  }
}

function notaNuevaDe(nota: NotaLeida, veredicto: ResultadoDeCasar): NotaNueva {
  return {
    estado: veredicto.casada ? 'pendiente' : 'sin_cita',
    client_id: veredicto.casada ? veredicto.clientId : null,
    appointment_id: veredicto.casada ? veredicto.appointmentId : null,
    metodo_cita: veredicto.casada ? veredicto.metodo : null,
    gmail_message_id: nota.gmailMessageId,
    drive_file_id: nota.driveFileId,
    google_event_id: nota.googleEventId,
    titulo: nota.titulo,
    fecha_reunion: nota.fechaReunion,
    invitados: nota.invitados,
    resumen: nota.resumen,
    temas: nota.temas,
    proximos_pasos: nota.proximosPasos,
    detalle: nota.detalle,
    transcripcion: nota.transcripcion,
    completa: nota.completa,
  }
}

/* ------------------------------------------------------------------ */
/* Analizar una nota ya guardada (lo usan la pasada y el botón «Volver a analizar») */
/* ------------------------------------------------------------------ */

export interface ResultadoDeAnalizarNota {
  ok: boolean
  /** Una frase para enseñar si no ha ido bien */
  aviso: string | null
  costeUsd: number
  /** El fallo es de la cuenta de la IA y no de esta nota */
  general: boolean
}

/**
 * Pasa una nota por la IA y guarda el resultado. Un fallo suma un intento (salvo si es de la cuenta de la IA) y, si ya no merece la pena reintentar, la deja en `error`.
 * `manual` es el botón de una persona: no cuenta intentos ni se queda en `error`, solo dice lo que pasó. Si la nota está `sin_cita` conserva ese estado al analizarse.
 */
export async function analizarNotaGuardada(
  almacen: AlmacenDeNotas,
  nota: Pick<NotaGuardada, 'id' | 'analisis_intentos'> & Partial<Pick<NotaGuardada, 'estado'>>,
  opciones: Pick<OpcionesDeSincronizacion, 'ahora' | 'analizar' | 'maxIntentosDeAnalisis'> & { tiempoMaximoMs?: number; manual?: boolean } = {}
): Promise<ResultadoDeAnalizarNota> {
  const ahora = opciones.ahora ?? (() => new Date())
  const analizar = opciones.analizar ?? analizarReunion
  const datos = await almacen.datosParaAnalizar(nota.id)
  if (!datos) return { ok: false, aviso: 'La nota ya no existe.', costeUsd: 0, general: false }
  if (!hayAlgoQueAnalizar(datos)) {
    const aviso = 'La nota no trae nada que analizar (ni resumen ni transcripción).'
    if (!opciones.manual) await almacen.actualizar(nota.id, { estado: 'error', error: aviso })
    return { ok: false, aviso, costeUsd: 0, general: false }
  }

  const resultado = await analizar(construirEncargoDeAnalisis(datos), opciones.tiempoMaximoMs ? { tiempoMaximoMs: opciones.tiempoMaximoMs } : {})
  if (resultado.analisis) {
    const cambios: CambiosDeNota = { analisis: resultado.analisis, analisis_modelo: resultado.modelo, analisis_en: ahora().toISOString(), analisis_intentos: 0, error: null }
    // Una nota que todavía no tiene cliente se queda «sin_cita» aunque ya tenga análisis: lo que le falta es que alguien la asigne
    if (nota.estado !== 'sin_cita') cambios.estado = 'procesada'
    await almacen.actualizar(nota.id, cambios)
    return { ok: true, aviso: null, costeUsd: resultado.costeUsd, general: false }
  }

  // Un fallo de la cuenta de la IA (clave, saldo) no es culpa de esta nota: no se le cuenta ni se le apunta
  if (!resultado.general && !opciones.manual) {
    const intentos = nota.analisis_intentos + 1
    const sinMas = !resultado.reintentable || intentos >= (opciones.maxIntentosDeAnalisis ?? 4)
    await almacen.actualizar(nota.id, { analisis_intentos: intentos, error: resultado.aviso, ...(sinMas ? { estado: 'error' as const } : {}) })
  } else if (opciones.manual && !resultado.general) {
    await almacen.actualizar(nota.id, { error: resultado.aviso })
  }
  return { ok: false, aviso: resultado.aviso, costeUsd: resultado.costeUsd, general: resultado.general }
}

/* ------------------------------------------------------------------ */
/* La pasada                                                           */
/* ------------------------------------------------------------------ */

export async function sincronizarNotasDeGemini(google: FuenteDeGoogle, almacen: AlmacenDeNotas, opciones: OpcionesDeSincronizacion = {}): Promise<ResultadoDeSincronizacion> {
  const ahora = opciones.ahora ?? (() => new Date())
  const reloj = opciones.reloj ?? (() => Date.now())
  const inicio = reloj()
  const presupuesto = opciones.presupuestoMs ?? 240_000
  const queda = () => presupuesto - (reloj() - inicio)

  const r: ResultadoDeSincronizacion = { revisados: 0, nuevas: 0, ignoradas: 0, completadas: 0, recasadas: 0, analizadas: 0, costeUsd: 0, avisos: [], detenida: null }
  const avisar = (frase: string) => {
    if (!r.avisos.includes(frase)) r.avisos.push(frase)
  }

  let candidatos: CandidatoDeCita[] | null = null
  const cargarCandidatos = async () => (candidatos ??= await almacen.candidatos())

  // Si Drive/Docs falla por algo general (API apagada), no se vuelve a intentar abrir documentos en esta pasada
  let documentosBloqueados = false

  /** Un fallo al hablar con Google: si es general se para lo de Google; si es de un elemento, se apunta y se sigue. Lo que no es de Google se relanza */
  const alFallarGoogle = (error: unknown, contexto: string): void => {
    if (!(error instanceof ErrorDeGoogle)) throw error
    if (error.esGeneral) {
      r.detenida = error.message
    } else {
      avisar(`${contexto}: ${error.message}`)
    }
  }

  /** Abre el documento de una nota. null si no se pudo (y por qué queda avisado) */
  const abrirDocumento = async (driveFileId: string, titulo: string): Promise<NotaLeida | null> => {
    if (documentosBloqueados) return null
    try {
      return leerDocumento(await google.leerDocumento(driveFileId), driveFileId)
    } catch (error) {
      if (!(error instanceof ErrorDeGoogle)) throw error
      if (error.api === 'token') {
        r.detenida = error.message
        documentosBloqueados = true
      } else if (error.esGeneral) {
        documentosBloqueados = true
        avisar(error.message)
      } else avisar(`No se pudo abrir el documento de «${titulo.slice(0, 80)}»: ${error.message}`)
      return null
    }
  }

  /* ---------- 1. correos nuevos ---------- */
  try {
    const ids = await google.listarCorreos(ahora().getTime() - (opciones.diasAtras ?? 30) * DIA_MS, opciones.maxLista ?? 150)
    const conocidos = await almacen.conocidos(ids)
    const nuevos = ids.filter((id) => !conocidos.has(id))
    let tratados = 0

    for (const id of nuevos) {
      if (tratados >= (opciones.maxNuevos ?? 20) || queda() < 20_000 || r.detenida) break
      r.revisados++

      let correo
      try {
        correo = await google.leerCorreo(id)
      } catch (error) {
        alFallarGoogle(error, `No se pudo leer un correo de Gemini`)
        if (r.detenida) break
        continue
      }
      const nota = correo ? leerCorreoDeGemini(correo) : null
      if (!correo || !nota) {
        const titulo = correo ? tituloDeLaReunion(correo.asunto) : '(correo ilegible)'
        if ((await almacen.insertar(notaIgnorada(id, titulo, null))) === 'creada') r.ignoradas++
        tratados++
        continue
      }

      const conCliente = esReunionConCliente(nota.titulo)
      const sinTitulo = esReunionSinTitulo(nota.titulo)
      // Una reunión interna con título: se apunta y NO se abre su documento
      if (!conCliente && !sinTitulo) {
        if ((await almacen.insertar(notaIgnorada(id, nota.titulo, nota.fechaReunion))) === 'creada') r.ignoradas++
        tratados++
        continue
      }

      let final = nota
      if (nota.driveFileId) {
        const delDocumento = await abrirDocumento(nota.driveFileId, nota.titulo)
        if (delDocumento) final = fusionarNotas(nota, delDocumento)
        else if (r.detenida) break
      }

      // Sin título y sin poder abrir el documento: no se sabe qué es. Se deja para otra pasada (sin gastar el cupo de esta) en vez de apuntarla como ignorada
      if (sinTitulo && !conCliente && !final.completa) {
        if (nota.driveFileId) continue
      }

      const veredicto = casarNota(final, await cargarCandidatos())
      if (!conCliente && !veredicto.casada) {
        if ((await almacen.insertar(notaIgnorada(id, final.titulo, final.fechaReunion))) === 'creada') r.ignoradas++
        tratados++
        continue
      }
      if ((await almacen.insertar(notaNuevaDe(final, veredicto))) === 'creada') r.nuevas++
      tratados++
    }
  } catch (error) {
    alFallarGoogle(error, 'Gmail')
  }

  /* ---------- 2. completar las notas que solo tienen el correo ---------- */
  if (!r.detenida && !documentosBloqueados) {
    try {
      const pendientes = await almacen.incompletas(new Date(ahora().getTime() - 14 * DIA_MS).toISOString(), opciones.maxIncompletas ?? 5)
      for (const fila of pendientes) {
        if (queda() < 20_000 || r.detenida || documentosBloqueados) break
        if (!fila.drive_file_id) continue
        const delDocumento = await abrirDocumento(fila.drive_file_id, fila.titulo)
        if (!delDocumento) continue

        const cambios: CambiosDeNota = {
          completa: true,
          google_event_id: delDocumento.googleEventId ?? fila.google_event_id,
          invitados: delDocumento.invitados.length > 0 ? delDocumento.invitados : fila.invitados,
          fecha_reunion: delDocumento.fechaReunion ?? fila.fecha_reunion,
          detalle: delDocumento.detalle,
          transcripcion: delDocumento.transcripcion,
        }
        // Lo que el documento trae mejor que el correo lo sustituye; lo que no trae no borra lo del correo
        if (delDocumento.resumen) cambios.resumen = delDocumento.resumen
        if (delDocumento.temas.length > 0) cambios.temas = delDocumento.temas
        if (delDocumento.proximosPasos.length > 0) cambios.proximos_pasos = delDocumento.proximosPasos

        // Con el invitado y el evento, quizá ahora sí se sabe de quién es. Un casado manual o por evento no se toca
        if (fila.estado === 'sin_cita' || fila.metodo_cita === 'nombre') {
          const v = casarNota({ googleEventId: cambios.google_event_id ?? null, invitados: cambios.invitados ?? [], titulo: fila.titulo, fechaReunion: cambios.fecha_reunion ?? null }, await cargarCandidatos())
          if (v.casada && (fila.estado === 'sin_cita' || v.clientId !== fila.client_id)) {
            Object.assign(cambios, { client_id: v.clientId, appointment_id: v.appointmentId, metodo_cita: v.metodo, estado: 'pendiente' as const, analisis_intentos: 0 })
            r.recasadas++
          }
        }
        // Una nota que ya se analizó (o falló) con solo el correo vuelve a la cola: con la transcripción el análisis es otro
        if (fila.estado === 'procesada' || fila.estado === 'error') Object.assign(cambios, { estado: 'pendiente' as const, analisis_intentos: 0 })

        await almacen.actualizar(fila.id, cambios)
        r.completadas++
      }
    } catch (error) {
      alFallarGoogle(error, 'Documentos de Gemini')
    }
  }

  /* ---------- 3. volver a casar las que siguen sin cita ---------- */
  try {
    const sinCita = await almacen.sinCita(new Date(ahora().getTime() - 7 * DIA_MS).toISOString(), 20)
    if (sinCita.length > 0) {
      const todos = await cargarCandidatos()
      for (const fila of sinCita) {
        const v = casarNota({ googleEventId: fila.google_event_id, invitados: fila.invitados, titulo: fila.titulo, fechaReunion: fila.fecha_reunion }, todos)
        if (!v.casada) continue
        await almacen.actualizar(fila.id, { client_id: v.clientId, appointment_id: v.appointmentId, metodo_cita: v.metodo, estado: 'pendiente', analisis_intentos: 0 })
        r.recasadas++
      }
    }
  } catch (error) {
    avisar(`No se pudo volver a casar las notas sin cita: ${(error as Error).message}`)
  }

  /* ---------- 4. analizar las que esperan ---------- */
  try {
    const cola = await almacen.pendientesDeAnalisis(opciones.maxAnalisis ?? 2, new Date(ahora().getTime() - (opciones.minutosEntreIntentos ?? 10) * 60_000).toISOString())
    for (const fila of cola) {
      // Una análisis puede tardar hasta dos minutos y medio: no se empieza si no cabe
      if (queda() < 60_000) break
      const hecho = await analizarNotaGuardada(almacen, fila, { ahora, analizar: opciones.analizar, maxIntentosDeAnalisis: opciones.maxIntentosDeAnalisis, tiempoMaximoMs: Math.min(150_000, queda() - 10_000) })
      r.costeUsd += hecho.costeUsd
      if (hecho.ok) r.analizadas++
      else if (hecho.general) {
        avisar(hecho.aviso ?? 'La IA no está disponible.')
        break
      }
    }
  } catch (error) {
    avisar(`No se pudo analizar las notas pendientes: ${(error as Error).message}`)
  }

  return r
}
