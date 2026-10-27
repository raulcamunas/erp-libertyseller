import { NextResponse, type NextRequest } from 'next/server'
import { fail } from '@/lib/amazon/api'
import { FALLO_GENERICO, SIN_CACHE, registrar, requerirCorreo } from '@/lib/correo/rutas'
import { dentroDelLimite } from '@/lib/correo/secuencias/rutas'
import { ETIQUETA_DE_POLITICA } from '@/lib/correo/verificacion/pago'
import { FALTA_LA_MIGRACION_256, comprobarUna, contarComprobadas, guardarAjustes, guardarClave, leerConfiguracion, probarClave, quitarClave, type ResultadoDeCambiar } from '@/lib/correo/verificacion/pago-servidor'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * LA VERIFICACIÓN DE DIRECCIONES CON MILLIONVERIFIER — SOLO ADMINISTRADORES.
 *
 * GET   los ajustes (encendida o no, qué hacer con las dudosas, si hay clave y cómo termina, créditos, el último fallo del servicio) y cuántas direcciones hay
 *       comprobadas. La clave NUNCA viaja: solo sus últimos caracteres.
 * POST application/json  { accion: 'ajustes', activa?, dudosas? }      enciende o apaga, o elige qué hacer con las dudosas
 *                        { accion: 'clave', clave }                      guarda la clave SI el servicio dice que vale (le pregunta por los créditos, que no gasta ninguno)
 *                                                                        y, si era la primera, enciende la verificación
 *                        { accion: 'quitar_clave' }                      borra la clave y apaga
 *                        { accion: 'probar_clave' }                      pregunta los créditos con la clave guardada y los apunta
 *                        { accion: 'comprobar', direccion }              comprueba UNA dirección ahora (gasta un crédito); sirve para ver que funciona
 *
 * Las frases que contesta son fijas: nada de lo que dice el servicio de verificación se reenvía tal cual, y la clave no aparece en ningún mensaje.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30

const respuesta = <T extends object>(r: ResultadoDeCambiar<T>, formar?: (datos: Omit<Extract<ResultadoDeCambiar<T>, { ok: true }>, 'ok'>) => object): NextResponse => {
  if (!r.ok) return NextResponse.json({ ok: false, error: r.mensaje }, { status: r.estado, headers: SIN_CACHE })
  const { ok: _ok, ...datos } = r
  return NextResponse.json({ ok: true, ...(formar ? formar(datos) : datos) }, { headers: SIN_CACHE })
}

export async function GET() {
  const sesion = await requerirCorreo()
  if (sesion instanceof NextResponse) return sesion
  if (sesion.role !== 'admin') return fail(403, 'Solo un administrador puede ver esto.')
  try {
    const service = createServiceClient()
    const config = await leerConfiguracion(service)
    if (!config) return NextResponse.json({ ok: true, disponible: false, aviso: FALTA_LA_MIGRACION_256 }, { headers: SIN_CACHE })
    const conteos = await contarComprobadas(service)
    return NextResponse.json({ ok: true, disponible: true, ajustes: config.ajustes, conteos, politicas: ETIQUETA_DE_POLITICA, ahora: Date.now() }, { headers: SIN_CACHE })
  } catch (error) {
    registrar('Correo · verificación: leer', error)
    return fail(500, FALLO_GENERICO)
  }
}

export async function POST(request: NextRequest) {
  const sesion = await requerirCorreo()
  if (sesion instanceof NextResponse) return sesion
  if (sesion.role !== 'admin') return fail(403, 'Solo un administrador puede cambiar esto.')
  if (!dentroDelLimite(`verificacion:${sesion.userId}`, 30)) return fail(429, 'Demasiados cambios seguidos. Espera un momento.')

  let cuerpo: Record<string, unknown>
  try {
    cuerpo = ((await request.json()) ?? {}) as Record<string, unknown>
  } catch {
    return fail(400, 'No se ha entendido lo que se ha mandado')
  }

  try {
    const service = createServiceClient()
    const quien = { id: sesion.userId }
    switch (cuerpo.accion) {
      case 'ajustes':
        return respuesta(await guardarAjustes(service, quien, { activa: cuerpo.activa, dudosas: cuerpo.dudosas }))
      case 'clave':
        return respuesta(await guardarClave(service, quien, cuerpo.clave))
      case 'quitar_clave':
        return respuesta(await quitarClave(service, quien))
      case 'probar_clave':
        return respuesta(await probarClave(service))
      case 'comprobar':
        return respuesta(await comprobarUna(service, quien, cuerpo.direccion), (d) => {
          const r = d.resultado
          if (r.tipo === 'sin_comprobar') return { direccion: d.direccion, tipo: 'sin_comprobar', motivo: r.motivo, causa: r.causa }
          const v = r.veredicto
          return { direccion: d.direccion, tipo: 'veredicto', nivel: v.nivel, motivo: v.motivo, sugerencia: v.sugerencia, origen: v.origen, gastoUnCredito: v.origen === 'servicio' && v.nivel !== 'dudosa' }
        })
      default:
        return fail(400, 'No se entiende qué hacer.')
    }
  } catch (error) {
    registrar('Correo · verificación: cambio', error)
    return fail(500, FALLO_GENERICO)
  }
}
