import { NextResponse, type NextRequest } from 'next/server'
import { fail } from '@/lib/amazon/api'
import { hasTokenKey } from '@/lib/amazon/crypto'
import { validarPeticionDePreferencias } from '@/lib/correo/preferencias'
import { FALTA_MIGRACION_318, FaltaMigracion318, guardarPreferencias, listarSilenciados } from '@/lib/correo/preferencias-servidor'
import { SIN_CACHE, requerirCorreo, respuestaDeFallo } from '@/lib/correo/rutas'
import { autorizarBuzon, buzonesVisibles } from '@/lib/correo/servidor'
import type { BuzonVisible, RespuestaDeBuzones } from '@/lib/correo/tipos'
import { leerCuerpoConTope } from '@/lib/subidas-limite'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * MIS PREFERENCIAS DE CORREO: «MIS CORREOS» Y LO QUE HE SILENCIADO (migración 318).
 *
 * TODO ES PERSONAL: lo que se elige o se silencia aquí solo cambia lo que ve y lo que le avisa a quien llama. No da acceso a nada: un buzón solo se puede
 * elegir o silenciar si ya se puede LEER (lib/correo/acceso.ts, modo 'leer').
 *
 * GET   { preferencias: Preferencia[], remitentes: [{ direccion, hasta }], hilos: [{ hiloId, asunto, hasta }], disponible }
 *       Para «Elige tus correos» (con su sección «Silenciados»). Solo de buzones que quien llama puede leer HOY: una preferencia o un hilo silenciado de un
 *       buzón que ya no lee no se enseña (ni su asunto ni su id). `disponible: false` = falta la migración 318 (todo vacío).
 * POST  { cambios: CambioDePreferencia[] } (máximo 50; ver validarPeticionDePreferencias en lib/correo/preferencias.ts):
 *         · { buzonId, enMisCorreos?, orden?, silencio?: '8h' | 'manana' | 'semana' | 'siempre' | 'quitar' }
 *         · { remitente, silencio }  (la dirección, en todos los buzones que lee)
 *       Cada buzonId se autoriza con 'leer': uno que no se puede leer, 404 («no existe») y no se guarda NADA de la petición.
 *       Devuelve RespuestaDeBuzones (los buzones ya al día, para pintar la barra sin otra petición). Sin la 318, 503 con FALTA_MIGRACION_318.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30

const MAX_BYTES_CUERPO = 32 * 1024
/** Cuántos buzones se autorizan a la vez (cada autorización son 2-3 lecturas) */
const AUTORIZAR_A_LA_VEZ = 6

/** El número del menú: sin leer de «Mis correos» que avisan (sin buzones silenciados; hilosSinLeerMios ya descuenta los hilos y remitentes silenciados) */
const sumarSinLeerMios = (buzones: BuzonVisible[]): number => buzones.reduce((suma, b) => suma + (b.enMisCorreos && !b.silenciado ? b.hilosSinLeerMios : 0), 0)

export async function GET() {
  const sesion = await requerirCorreo()
  if (sesion instanceof NextResponse) return sesion

  try {
    const service = createServiceClient()
    const legibles = new Set((await buzonesVisibles(service, sesion)).map((b) => b.id))
    // Preferencias, remitentes y conversaciones silenciadas, ya filtradas a lo que todavía lee (y `disponible: false` sin la 318)
    return NextResponse.json(await listarSilenciados(service, sesion.userId, (buzonId) => legibles.has(buzonId)), { headers: SIN_CACHE })
  } catch (error) {
    return respuestaDeFallo('Correo · preferencias: fallo al leer', error)
  }
}

export async function POST(request: NextRequest) {
  const sesion = await requerirCorreo()
  if (sesion instanceof NextResponse) return sesion

  const cuerpo = await leerCuerpoConTope(request, MAX_BYTES_CUERPO)
  if (cuerpo instanceof NextResponse) return cuerpo
  let json: unknown
  try {
    json = JSON.parse(cuerpo.texto)
  } catch {
    return fail(400, 'No se ha entendido lo que se ha mandado')
  }
  const valida = validarPeticionDePreferencias(json)
  if (!valida.ok) return fail(400, valida.error)

  try {
    const service = createServiceClient()

    // Cada buzón, autorizado para LEER antes de guardar nada: lo que no se puede leer «no existe», y entonces no se guarda ningún cambio de la petición
    const ids = [...new Set(valida.cambios.flatMap((c) => ('buzonId' in c ? [c.buzonId] : [])))]
    for (let i = 0; i < ids.length; i += AUTORIZAR_A_LA_VEZ) {
      const autorizaciones = await Promise.all(ids.slice(i, i + AUTORIZAR_A_LA_VEZ).map((id) => autorizarBuzon(service, sesion, id, 'leer')))
      const negada = autorizaciones.find((a) => !a.ok)
      if (negada && !negada.ok) return fail(negada.estado, negada.mensaje)
    }

    try {
      await guardarPreferencias(service, sesion.userId, valida.cambios)
    } catch (error) {
      if (error instanceof FaltaMigracion318) return fail(503, FALTA_MIGRACION_318)
      throw error
    }

    // Guardado: la 318 está lanzada, así que preferenciasDisponibles es true sin preguntar otra vez
    const buzones = await buzonesVisibles(service, sesion)
    const respuesta: RespuestaDeBuzones = { buzones, cifradoConfigurado: hasTokenKey(), sinLeerMios: sumarSinLeerMios(buzones), preferenciasDisponibles: true }
    return NextResponse.json(respuesta, { headers: SIN_CACHE })
  } catch (error) {
    return respuestaDeFallo('Correo · preferencias: fallo al guardar', error)
  }
}
