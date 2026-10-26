import { avisoDeRespuestaDeLead, type LoHechoConLaRespuesta } from '../campana'
import type { RespuestaPorLeer } from './almacen'
import { ETIQUETA_DE_CLASE } from './clases'
import { ESTADOS_QUE_SE_PUEDEN_TOCAR, construirEncargoDeClasificacion, decidir, textoDeLaRespuesta, validarClasificacion } from './clasificar'
import { diaDeMadrid } from './fechas'
import { avisarAlDueno } from './avisar'
import type { DependenciasDelMotor, ResumenDePasada } from './motor'
import type { AjustesDelMotor } from './reglas'

/**
 * LEER LAS RESPUESTAS DE LOS LEADS CON LA IA Y ACTUAR EN SU FICHA — SOLO SERVIDOR.
 * ================================================================================
 * Una fase más de la pasada del motor (después de «vigilar», que ya ha cortado las secuencias de quien contestó). Se comprueba con motor.prueba.ts
 * (los escenarios de «respuestas de los leads») y la parte de decidir, con clasificar.prueba.ts.
 *
 * Qué hace, por cada correo entrante de una persona que es de un lead (su dirección, o el hilo de su secuencia):
 *
 *   1. LA BASE LO RESERVA (`correo_respuestas_reclamar`, migración 246): ninguna otra pasada lo coge a la vez, y el mismo correo no se lee dos veces.
 *   2. LA IA LO CLASIFICA (interesado, no le interesa, escríbeme en enero…). Si la IA no puede, se espera 5, 15 y 45 minutos y se vuelve a intentar;
 *      tras cuatro fallos se da por fallida y no se insiste.
 *   3. EL CÓDIGO COMPRUEBA lo que dijo la IA (la frase en que se apoya tiene que estar en el correo…) y decide qué se hace (clasificar.ts).
 *   4. SE GUARDA LO QUE SE HA ENTENDIDO ANTES DE TOCAR NINGUNA FICHA. Si algo falla justo después, la lectura no se repite y la acción no se duplica:
 *      una acción perdida cuesta menos que dos notas o un lead movido dos veces.
 *   5. SOLO EN ENVÍO REAL se toca la ficha: «No le interesa», la rellamada, y una nota que cuenta qué ha entendido la IA. Con el motor en ensayo
 *      solo se apunta lo que se habría hecho (pantalla Secuencias → Flujo): ninguna ficha cambia.
 *
 * Ningún cambio de estado pisa el trabajo de una persona: se hace con una actualización CONDICIONADA al estado que tenía el lead al decidir, de modo que
 * si el comercial lo movió mientras tanto, no se toca y se deja una nota para que lo mire.
 */

export const RESPUESTAS_POR_PASADA = 6
/** Las esperas entre intentos cuando la IA no puede */
export const ESPERAS_DE_LECTURA_MS = [5, 15, 45].map((m) => m * 60_000)
export const MAX_INTENTOS_DE_LECTURA = 4

const iso = (ms: number): string => new Date(ms).toISOString()

export async function leerRespuestasDeLosLeads(deps: DependenciasDelMotor, ajustes: AjustesDelMotor, respuestasAt: number | null, r: ResumenDePasada, alFallar: (error: unknown) => void): Promise<void> {
  // Sin IA enchufada, con el interruptor apagado o sin la migración 246: no hay nada que hacer (y no se avanza ninguna marca)
  if (!deps.clasificar || !ajustes.respuestasIa || !ajustes.respuestasDisponible) return
  const { almacen } = deps
  const ahora = (deps.ahora ?? Date.now)()
  // Como la vigilancia: se solapa un poco con la vez anterior (la clave es el correo, así que repetir no cuesta nada); la primera vez, un cuarto de hora
  // atrás; y nunca más de tres días
  const desde = respuestasAt === null ? ahora - 15 * 60_000 : Math.max(respuestasAt - 2 * 60_000, ahora - 3 * 86_400_000)
  const filas = await almacen.reclamarRespuestas(desde, ahora, RESPUESTAS_POR_PASADA)
  for (const f of filas) {
    try {
      await leerUna(deps, ajustes, f, r)
    } catch (error) {
      // Se queda «procesando»: a los 10 minutos la reserva caduca y otra pasada la retoma
      alFallar(error)
    }
  }
  await almacen.guardarAjustes({ respuestas_at: iso(ahora) }, null, ahora)
}

async function leerUna(deps: DependenciasDelMotor, ajustes: AjustesDelMotor, f: RespuestaPorLeer, r: ResumenDePasada): Promise<void> {
  const { almacen } = deps
  const ahora = (deps.ahora ?? Date.now)()
  const modo = ajustes.modoEnsayo ? 'ensayo' : 'real'
  const hoy = diaDeMadrid(ahora)

  const lead = await almacen.leadParaMotor(f.leadId)
  if (!lead) {
    // El lead se ha borrado entre medias: no hay nada que leer
    await almacen.guardarLecturaDeRespuesta(f.mensajeId, { clase: 'otro', confianza: 'baja', resumen: 'El lead ya no existe.', evidencia: '', fechaPedida: null, modelo: '', modo, accion: 'ninguna', nota: null }, ahora)
    return
  }
  const nombre = String(lead.store_name ?? lead.company ?? 'el lead')

  const texto = textoDeLaRespuesta(f.texto)
  // Un correo que solo cita (o está vacío) no dice nada: no se gasta una llamada a la IA
  if (texto.length < 3) {
    await almacen.guardarLecturaDeRespuesta(f.mensajeId, { clase: 'otro', confianza: 'alta', resumen: 'El correo no trae texto nuevo.', evidencia: '', fechaPedida: null, modelo: '', modo, accion: 'ninguna', nota: null }, ahora)
    return
  }

  const lectura = await deps.clasificar!(construirEncargoDeClasificacion({ lead: nombre, asunto: f.asunto, texto, hoy }))
  if (!lectura.clasificacion) {
    if (f.intentos >= MAX_INTENTOS_DE_LECTURA) {
      await almacen.soltarRespuesta(f.mensajeId, { estado: 'fallida', proximoIntentoAt: null }, ahora)
      await almacen.apuntarEvento({ inscripcionId: f.inscripcionId, buzonId: f.buzonId, tipo: 'error', detalle: 'La IA no ha podido leer una respuesta de un lead tras varios intentos: la tiene que mirar una persona.' }, ahora)
      r.respuestasFallidas++
    } else {
      await almacen.soltarRespuesta(f.mensajeId, { estado: 'pendiente', proximoIntentoAt: ahora + ESPERAS_DE_LECTURA_MS[Math.min(f.intentos - 1, ESPERAS_DE_LECTURA_MS.length - 1)] }, ahora)
    }
    return
  }

  // Lo que dice la IA no se da por bueno: se comprueba y, con eso, se decide qué hacer
  const validada = validarClasificacion(lectura.clasificacion, texto, hoy, ajustes.festivos)
  const buzon = await almacen.buzonPorId(f.buzonId)
  const decision = decidir(validada, { status: lead.status, assignedTo: lead.assigned_to }, { modo, cerrarNo: ajustes.respuestasCerrarNo, rellamada: ajustes.respuestasRellamada, duenoDelBuzon: buzon?.userId ?? '', hoy })

  // Se guarda lo entendido ANTES de tocar la ficha
  const guardada = await almacen.guardarLecturaDeRespuesta(
    f.mensajeId,
    { clase: validada.clase, confianza: validada.confianza, resumen: validada.resumen, evidencia: validada.evidencia, fechaPedida: validada.fecha, modelo: lectura.modelo, modo, accion: decision.accion, nota: decision.nota },
    ahora
  )
  if (!guardada) return
  r.respuestasLeidas++

  const etiqueta = ETIQUETA_DE_CLASE[validada.clase].toLowerCase()
  const quien = f.inscripcionId ? '' : `${nombre}: `
  const detalle = `${quien}${etiqueta}${validada.resumen ? ` — ${validada.resumen}` : ''}${decision.aplicar ? '' : ' (ensayo: no se ha tocado la ficha)'}`
  await almacen.apuntarEvento({ inscripcionId: f.inscripcionId, buzonId: f.buzonId, tipo: 'respuesta_ia', detalle: detalle.slice(0, 590) }, ahora)

  // La secuencia que cortó esta respuesta cuenta, en su motivo, qué dijo
  if (f.inscripcionId) {
    const ins = await almacen.inscripcion(f.inscripcionId)
    if (ins && ins.estado === 'respondida') await almacen.cambiarInscripcion(ins.id, { motivo: `El lead ha contestado: ${(validada.resumen || etiqueta).replace(/[.\s]+$/, '')}.` }, ahora)
  }

  // Lo que ha contestado un lead que pide algo se lo dice la campana a su dueño: el aviso del correo nuevo (que escribió la lectura del buzón) pasa a decir qué
  // ha entendido la IA y qué ha pasado en la ficha. Solo cuenta lo que de verdad se ha hecho: en ensayo no se ha tocado nada
  const avisarDeLaLectura = (hecho: LoHechoConLaRespuesta) =>
    avisarAlDueno(deps, async () =>
      buzon
        ? avisoDeRespuestaDeLead({ userId: buzon.userId, buzonId: f.buzonId, inscripcionId: f.inscripcionId, leadId: f.leadId, lead: nombre, mensajeId: f.mensajeId, hiloId: f.hiloId, clase: validada.clase, resumen: validada.resumen, hecho })
        : null
    )

  // Con el motor en ensayo no se toca ninguna ficha
  if (!decision.aplicar) {
    await avisarDeLaLectura(null)
    return
  }

  let accion = decision.accion
  let nota = decision.nota
  let aplicada = true
  if (decision.accion === 'cerrar') {
    const cerrado = await almacen.cambiarEstadoDelLead(f.leadId, 'no_interesa', ESTADOS_QUE_SE_PUEDEN_TOCAR, ahora)
    if (cerrado) r.respuestasCerradas++
    else {
      accion = 'revisar'
      aplicada = false
      nota = `Dice que no le interesa${validada.evidencia ? ` («${validada.evidencia.slice(0, 120)}»)` : ''}, pero el lead ha cambiado de estado mientras tanto: no se ha tocado. Revísalo.`
    }
  } else if (decision.accion === 'rellamar' && decision.fecha) {
    const puesta = await almacen.ponerRellamada(f.leadId, decision.fecha, ahora)
    if (puesta !== 'no') r.respuestasConRellamada++
    else {
      accion = 'revisar'
      aplicada = false
      nota = `Pide que se le escriba más adelante${validada.evidencia ? ` («${validada.evidencia.slice(0, 120)}»)` : ''}, pero el lead ha cambiado de estado mientras tanto: no se ha puesto la rellamada. Revísalo.`
    }
  }
  if (nota) await almacen.apuntarNotaEnLead({ leadId: f.leadId, cuerpo: nota, clase: 'nota', ocurrioAt: f.recibidaAt > 0 ? f.recibidaAt : ahora })
  await almacen.anotarAplicacion(f.mensajeId, { aplicada, accion, nota }, ahora)
  await avisarDeLaLectura(!aplicada || accion === 'revisar' ? { tipo: 'revisar' } : accion === 'cerrar' ? { tipo: 'cerrado' } : accion === 'rellamar' && decision.fecha ? { tipo: 'rellamada', fecha: decision.fecha } : null)
}
