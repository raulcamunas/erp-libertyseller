import { NextResponse, type NextRequest } from 'next/server'
import { fail } from '@/lib/amazon/api'
import { MARGEN_DE_RELOJ_MS, VENTANA_DE_NOVEDAD_MS, avisosDeCorreo, type MensajeParaAviso } from '@/lib/correo/avisos'
import { SIN_CACHE, requerirCorreo, respuestaDeFallo } from '@/lib/correo/rutas'
import { esperaTrasFallos, sincronizarBuzonPorId } from '@/lib/correo/servidor'
import { leerCuerpoConTope } from '@/lib/subidas-limite'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * LOS CORREOS QUE HAN LLEGADO A MI BUZÓN DESDE LA ÚLTIMA VEZ — el aviso de «correo nuevo» de abajo a la derecha.
 *
 * POST { desde }  Solo mira los buzones DE QUIEN LLAMA (nunca uno del equipo que supervise: un aviso es para su dueño). La pantalla lo
 * pregunta cada minuto mientras el ERP está abierto y a la vista, esté en la aplicación que esté, y esto:
 *
 *   1. Si el buzón no se ha leído en los últimos 55 segundos, lo lee ahora (el mismo `sincronizarBuzonPorId` que la pantalla de Correo, con
 *      su turno: si otra lectura va en marcha, no hace nada). Así el aviso llega en un minuto y no en los tres del proceso automático.
 *   2. Devuelve los correos de PERSONAS (y los rebotes) que han entrado desde `desde`, sin leer y con fecha reciente, y cuántos hilos
 *      sin leer tiene en total. Lo antiguo que entra de golpe al conectar un buzón no avisa (ver lib/correo/avisos.ts).
 *
 * `ahora` es la hora del servidor al EMPEZAR: la pantalla lo usa como `desde` de la siguiente vez. Lo que se importe durante esta lectura
 * tiene una fecha de entrada posterior y volverá a salir en la siguiente consulta: la pantalla descarta los repetidos por su id.
 *
 * Sin la app «Correo» (o con un partner) contesta 403, y la pantalla deja de preguntar. Sin la migración 236, 503.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30

const MAX_BYTES_CUERPO = 1024
const PRESUPUESTO_MS = 8_000
const ENTRE_LECTURAS_MS = 55_000
/** Una consulta con un `desde` más antiguo que esto se trata como la primera: no se avisa de lo que llegó mientras no se estaba mirando */
const MAX_ANTIGUEDAD_DEL_DESDE_MS = 10 * 60_000

interface FilaDeBuzon {
  id: string
  ultimo_intento_at: string | null
  credenciales_invalidas: boolean
  fallos_seguidos: number
}

export async function POST(request: NextRequest) {
  const sesion = await requerirCorreo()
  if (sesion instanceof NextResponse) return sesion
  const corte = Date.now()

  const cuerpo = await leerCuerpoConTope(request, MAX_BYTES_CUERPO)
  if (cuerpo instanceof NextResponse) return cuerpo
  let json: { desde?: unknown } = {}
  try {
    json = cuerpo.texto.trim() === '' ? {} : (JSON.parse(cuerpo.texto) as typeof json)
  } catch {
    return fail(400, 'No se ha entendido lo que se ha mandado')
  }
  const desdeCrudo = typeof json.desde === 'string' ? Date.parse(json.desde) : NaN
  const desde = Number.isFinite(desdeCrudo) && corte - desdeCrudo <= MAX_ANTIGUEDAD_DEL_DESDE_MS ? desdeCrudo : null

  try {
    const service = createServiceClient()
    const { data: filas, error } = await service.from('correo_buzones').select('id, ultimo_intento_at, credenciales_invalidas, fallos_seguidos').eq('user_id', sesion.userId)
    if (error) throw new Error('No se han podido leer los buzones.', { cause: error })
    const buzones = (filas ?? []) as FilaDeBuzon[]
    const ahora = new Date(corte).toISOString()
    if (buzones.length === 0) return NextResponse.json({ ahora, hayBuzon: false, nuevos: [], sinLeer: 0 }, { headers: SIN_CACHE })

    const ids = buzones.map((b) => b.id)

    // Solo se lee el que está conectado (tiene contraseña guardada), no ha sido rechazado y toca por su espera tras fallos
    const { data: conClave, error: errorClaves } = await service.from('correo_credenciales').select('buzon_id').in('buzon_id', ids)
    if (errorClaves) throw new Error('No se han podido comprobar las conexiones.', { cause: errorClaves })
    const conectados = new Set(((conClave ?? []) as Array<{ buzon_id: string }>).map((c) => c.buzon_id))
    const alDia = (b: FilaDeBuzon) => {
      const ultimo = b.ultimo_intento_at ? Date.parse(b.ultimo_intento_at) : 0
      const espera = Math.max(ENTRE_LECTURAS_MS, esperaTrasFallos(b.fallos_seguidos))
      return corte - ultimo < espera
    }
    const aLeer = buzones.filter((b) => conectados.has(b.id) && !b.credenciales_invalidas && !alDia(b))
    // Lo que falle al leer lo deja apuntado la propia lectura en el buzón; aquí no hace falta nada más
    await Promise.allSettled(aLeer.map((b) => sincronizarBuzonPorId(service, b.id, { presupuestoMs: PRESUPUESTO_MS })))

    let nuevos: ReturnType<typeof avisosDeCorreo> = []
    if (desde !== null) {
      const { data, error: errorMensajes } = await service
        .from('correo_mensajes')
        .select('id, buzon_id, hilo_id, de_nombre, de_direccion, asunto, vista_previa, fecha, automatico')
        .in('buzon_id', ids)
        .eq('direccion', 'entrante')
        .eq('leido', false)
        .gt('creado_at', new Date(desde - MARGEN_DE_RELOJ_MS).toISOString())
        .gte('fecha', new Date(corte - VENTANA_DE_NOVEDAD_MS).toISOString())
        .order('fecha', { ascending: false })
        .limit(25)
      if (errorMensajes) throw new Error('No se han podido leer los correos nuevos.', { cause: errorMensajes })
      nuevos = avisosDeCorreo((data ?? []) as MensajeParaAviso[], 5)
    }

    // Cuántas conversaciones tienen algo sin leer en total (para el número junto a «Correo» en el menú)
    let sinLeer = 0
    const { data: resumen } = await service.rpc('correo_resumen_buzones', { p_buzones: ids })
    for (const f of (resumen ?? []) as Array<{ hilos_sin_leer: number | string | null }>) sinLeer += Number(f.hilos_sin_leer ?? 0)

    return NextResponse.json({ ahora, hayBuzon: true, nuevos, sinLeer }, { headers: SIN_CACHE })
  } catch (error) {
    return respuestaDeFallo('Correo · avisos: fallo', error)
  }
}
