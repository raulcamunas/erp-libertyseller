import { NextResponse, type NextRequest } from 'next/server'
import { fail } from '@/lib/amazon/api'
import { NO_EXISTE, SOLO_ASIGNADO_RESPONDE } from '@/lib/correo/acceso'
import { NADIE_LA_LLEVA, asignarHilo, marcarHiloHecho } from '@/lib/correo/asignaciones-servidor'
import { apagarAvisosAlAbrirHilo } from '@/lib/correo/campana-servidor'
import { modoDePeticionDeHilo, validarPeticionDeHilo, type CamposDePeticionDeHilo } from '@/lib/correo/peticion-hilo'
import { hastaDeDuracion, normalizarRemitente } from '@/lib/correo/preferencias'
import { FALTA_MIGRACION_318, FaltaMigracion318, guardarPreferencias } from '@/lib/correo/preferencias-servidor'
import { SIN_CACHE, requerirCorreo, respuestaDeFallo } from '@/lib/correo/rutas'
import {
  abrirHilo,
  autorizarBuzon,
  buzonDeHilo,
  destacarHilo,
  marcarEnElServidor,
  marcarHiloLeido,
  marcarHiloNoLeido,
  nombreDeLaSesion,
  registrarAcceso,
} from '@/lib/correo/servidor'
import { isMissingSchema } from '@/lib/plataforma/eventos'
import { leerCuerpoConTope } from '@/lib/subidas-limite'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * UN HILO: ABRIRLO, MARCARLO, SILENCIARLO Y ENCARGÁRSELO A ALGUIEN.
 *
 * GET    · { hilo: HiloAbierto, esMio } — el hilo con sus mensajes (los más recientes si son muchos), si quien mira puede responder, lo que tiene
 *          silenciado y quién lo lleva. Mirar un hilo NO lo marca como leído: eso lo pide la pantalla con el PATCH de abajo. Sin la migración 318
 *          se abre igual (nada silenciado, nadie encargado). A quien NO puede responder, abrirlo le apaga SUS avisos de la campana de esos mensajes
 *          (apagarAvisosAlAbrirHilo): el estado del buzón no cambia.
 * PATCH  · { destacado?, leido?, silenciado?: Duracion | 'quitar', silenciarRemitente?: Duracion | 'quitar',
 *            asignar?: { personaId: string | null, nota? }, hecho?: boolean }
 *
 *   Cada campo pide su modo (lib/correo/peticion-hilo.ts) y la petición se autoriza UNA vez con el más exigente:
 *     · silenciado, silenciarRemitente   leer (son SOLO para quien pide). No se pueden mezclar con un campo del buzón: 400, sin tocar nada.
 *     · leido, destacado                 responder (el dueño, o quien lo tiene asignado con respuesta). Marcar leído también lo marca en el
 *                                        servidor de correo (mejor esfuerzo).
 *     · asignar                          responder, o ser administrador con lectura. La persona tiene que poder LEER el buzón (y tener la app
 *                                        Correo, estar activa y no ser partner); si quien pide no es administrador, además ser el dueño o tenerlo
 *                                        asignado (la misma regla que /encargables, con el mismo 400 para no delatar la vía). Le llega un aviso
 *                                        'correo_asignado' salvo que se lo asigne a sí misma. Sin `nota`, a quien ya la lleva se le conserva la suya.
 *     · hecho                            la persona encargada (leer), o quien puede responder. Reabrirla vuelve a avisar a la encargada.
 *   Lo nuevo (silenciar, asignar, hecho) necesita la migración 318: sin ella, 503 con FALTA_MIGRACION_318.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30

/** Cabe una nota de 280 caracteres aunque sean todos de varios bytes */
const MAX_BYTES_CUERPO = 2048
const NO_SE_ENTIENDE = 'No se ha entendido lo que se ha mandado'

type Servicio = ReturnType<typeof createServiceClient>

/** Si es que falta la 318, lo convierte en FaltaMigracion318; si no, en un fallo con frase fija */
function lanzar(error: unknown, que: string): never {
  if (isMissingSchema(error)) throw new FaltaMigracion318()
  throw new Error(`No se ha podido guardar ${que}.`, { cause: error })
}

/** La persona encargada del hilo ahora (sin «hecho»), o null. Sin la 318, lanza FaltaMigracion318 */
async function encargadaDe(service: Servicio, hiloId: string): Promise<{ personaId: string; hecho: boolean } | null> {
  const { data, error } = await service.from('correo_hilo_asignaciones').select('persona_id, hecho_at').eq('hilo_id', hiloId).maybeSingle()
  if (error) lanzar(error, 'la persona encargada')
  const f = data as { persona_id: string; hecho_at: string | null } | null
  return f ? { personaId: f.persona_id, hecho: f.hecho_at !== null } : null
}

/** Silencia (o deja de silenciar) un hilo para esta persona. Es personal: no cambia nada a nadie más */
async function silenciarHilo(service: Servicio, userId: string, hiloId: string, silencio: NonNullable<CamposDePeticionDeHilo['silenciado']>): Promise<void> {
  if (silencio === 'quitar') {
    const { error } = await service.from('correo_hilo_silencios').delete().eq('user_id', userId).eq('hilo_id', hiloId)
    if (error) lanzar(error, 'el silencio de la conversación')
    return
  }
  const ahora = new Date()
  const { error } = await service
    .from('correo_hilo_silencios')
    .upsert({ user_id: userId, hilo_id: hiloId, hasta: hastaDeDuracion(silencio, ahora), creado_at: ahora.toISOString() }, { onConflict: 'user_id,hilo_id' })
  if (error) lanzar(error, 'el silencio de la conversación')
}

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  const sesion = await requerirCorreo()
  if (sesion instanceof NextResponse) return sesion

  try {
    const service = createServiceClient()
    const info = await buzonDeHilo(service, params.id)
    if (!info) return fail(404, NO_EXISTE)

    const auth = await autorizarBuzon(service, sesion, info.buzonId, 'leer')
    if (!auth.ok) return fail(auth.estado, auth.mensaje)
    const hiloId = params.id.toLowerCase()

    if (auth.porSupervision) {
      await registrarAcceso(service, { userId: sesion.userId, nombre: await nombreDeLaSesion(service, sesion.userId) }, auth.buzon.id, 'hilo', { id: hiloId, asunto: info.asunto })
    }

    const hilo = await abrirHilo(service, auth.buzon.id, hiloId, { userId: sesion.userId, puedeResponder: auth.puedeResponder, duenoId: auth.buzon.user_id })
    if (!hilo) return fail(404, NO_EXISTE)
    // Quien solo lee (seguidor, «solo avisos», supervisión) no puede marcarlo leído: verlo apaga SUS avisos de la campana, nada más
    await apagarAvisosAlAbrirHilo(service, sesion.userId, hilo)
    return NextResponse.json({ hilo, esMio: auth.esDueno }, { headers: SIN_CACHE })
  } catch (error) {
    return respuestaDeFallo('Correo · abrir hilo: fallo', error)
  }
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const sesion = await requerirCorreo()
  if (sesion instanceof NextResponse) return sesion

  const cuerpo = await leerCuerpoConTope(request, MAX_BYTES_CUERPO)
  if (cuerpo instanceof NextResponse) return cuerpo
  let json: unknown
  try {
    json = JSON.parse(cuerpo.texto)
  } catch {
    return fail(400, NO_SE_ENTIENDE)
  }
  const validada = validarPeticionDeHilo(json)
  if (!validada.ok) return fail(400, validada.error)
  const campos = validada.campos
  // Antes de tocar la base: una mezcla de lo personal con lo del buzón (o una petición vacía) es un 400 para cualquiera
  const previo = modoDePeticionDeHilo(campos, { esEncargada: false })
  if (!previo.ok) return fail(400, previo.error)

  try {
    const service = createServiceClient()
    const info = await buzonDeHilo(service, params.id)
    if (!info) return fail(404, NO_EXISTE)
    const hiloId = params.id.toLowerCase()

    // «Hecho» lo puede marcar la persona encargada aunque no pueda responder: hay que saber si lo es antes de decidir el modo
    const encargada = campos.hecho !== undefined || campos.asignar !== undefined ? await encargadaDe(service, hiloId) : null
    const decidido = modoDePeticionDeHilo(campos, { esEncargada: encargada !== null && !encargada.hecho && encargada.personaId === sesion.userId })
    if (!decidido.ok) return fail(400, decidido.error)

    // UNA autorización, con el modo más exigente de la petición
    const auth = await autorizarBuzon(service, sesion, info.buzonId, decidido.modo === 'responder' ? 'responder' : 'leer')
    if (!auth.ok) return fail(auth.estado, auth.mensaje)
    if (decidido.modo === 'admin-o-responder' && !auth.puedeResponder && sesion.role !== 'admin') return fail(403, SOLO_ASIGNADO_RESPONDE)

    /* ---------- Lo personal: silencios (nunca va junto a lo del buzón) ---------- */
    if (campos.silenciado !== undefined) await silenciarHilo(service, sesion.userId, hiloId, campos.silenciado)
    if (campos.silenciarRemitente !== undefined) {
      const { data, error } = await service.from('correo_hilos').select('contraparte_direccion').eq('id', hiloId).maybeSingle()
      if (error) throw new Error('No se ha podido leer el hilo.', { cause: error })
      const remitente = normalizarRemitente((data as { contraparte_direccion: string | null } | null)?.contraparte_direccion)
      if (!remitente) return fail(400, 'Esta conversación no tiene un remitente que se pueda silenciar.')
      await guardarPreferencias(service, sesion.userId, [{ remitente, silencio: campos.silenciarRemitente }])
    }

    /* ---------- Encargar la conversación (lib/correo/asignaciones-servidor.ts: la única versión) ---------- */
    let asignacion: { personaId: string; nombre: string; nota: string | null } | null | undefined
    const hilo = { id: hiloId, buzonId: auth.buzon.id, asunto: info.asunto, duenoId: auth.buzon.user_id }
    if (campos.asignar !== undefined) {
      const quien = { id: sesion.userId, nombre: await nombreDeLaSesion(service, sesion.userId), role: sesion.role }
      const r = await asignarHilo(service, quien, hilo, campos.asignar)
      if (!r.ok) return fail(r.estado, r.faltaMigracion ? FALTA_MIGRACION_318 : r.error)
      asignacion = r.asignacion ? { personaId: r.asignacion.personaId, nombre: r.asignacion.nombre, nota: r.asignacion.nota } : null
    }

    /* ---------- «Hecho»: cierra (o reabre) el encargo ---------- */
    if (campos.hecho !== undefined) {
      if (!encargada) return fail(404, NADIE_LA_LLEVA)
      const r = await marcarHiloHecho(service, { id: sesion.userId, nombre: await nombreDeLaSesion(service, sesion.userId) }, hilo, campos.hecho)
      if (!r.ok) return fail(r.estado, r.faltaMigracion ? FALTA_MIGRACION_318 : r.error)
    }

    /* ---------- Lo del buzón: destacar y leído ---------- */
    if (campos.destacado !== undefined) await destacarHilo(service, hiloId, campos.destacado)
    if (campos.leido !== undefined) {
      const afectados = campos.leido ? await marcarHiloLeido(service, hiloId, sesion.userId) : await marcarHiloNoLeido(service, hiloId)
      // En el servidor de correo, sin esperar: la respuesta no depende de que el proveedor conteste
      void marcarEnElServidor(service, auth.buzon, afectados, campos.leido).catch(() => undefined)
    }

    return NextResponse.json(asignacion === undefined ? { ok: true } : { ok: true, asignacion }, { headers: SIN_CACHE })
  } catch (error) {
    if (error instanceof FaltaMigracion318) return fail(503, FALTA_MIGRACION_318)
    return respuestaDeFallo('Correo · cambiar hilo: fallo', error)
  }
}
