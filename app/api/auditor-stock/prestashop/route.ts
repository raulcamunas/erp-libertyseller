import { NextResponse, type NextRequest } from 'next/server'
import { errorResponse, fail, requireAmazonAdmin } from '@/lib/amazon/api'
import { cuentaAuditada } from '@/lib/auditor-stock/auditar'
import { isMissingSchema } from '@/lib/plataforma/eventos'
import { probarConexion } from '@/lib/prestashop/cliente'
import {
  anotarPrueba,
  claveDe,
  estadoConexion,
  guardarConexion,
  quitarConexion,
} from '@/lib/prestashop/conexion'
import { claveValida, normalizarUrlTienda } from '@/lib/prestashop/url'

/**
 * CONEXIÓN CON LA TIENDA PRESTASHOP · LO QUE USA LA PANTALLA.
 *
 *   estado    si hay conexión guardada y cómo salió la última prueba.
 *   guardar   la dirección y, si viene, la clave (cifrada).
 *   probar    llama a la tienda con lo guardado y dice qué ha encontrado.
 *   quitar    borra la conexión.
 *
 * LA CLAVE ENTRA Y NO SALE. Se lee del cuerpo de `guardar`, se cifra y se guarda;
 * ninguna respuesta de esta ruta la lleva, ni siquiera en un error. Por eso se
 * escribe en esta pantalla y no se pega en un chat ni en una captura.
 *
 * El cliente no llega de fuera: el auditor es de una sola cuenta y se resuelve
 * aquí. Solo admin, como todo lo de Amazon API y Growth Partner.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
/** La prueba hace cuatro llamadas a una tienda que puede ir lenta */
export const maxDuration = 120

const MIGRACION =
  'Falta lanzar la migración 221_prestashop_conexiones.sql en el editor SQL de Supabase.'

export async function POST(request: NextRequest) {
  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session

    const body = (await request.json().catch(() => ({}))) as {
      accion?: string
      url?: string
      clave?: string
    }

    const cuenta = await cuentaAuditada()
    if ('error' in cuenta) return fail(404, cuenta.error)
    const clientId = cuenta.clientId

    try {
      if (body.accion === 'estado') {
        return NextResponse.json({ ok: true, estado: await estadoConexion(clientId) })
      }

      if (body.accion === 'guardar') {
        const u = normalizarUrlTienda(body.url ?? '')
        if (!u.ok) return fail(400, u.motivo)

        const claveTexto = (body.clave ?? '').trim()
        if (claveTexto !== '' && !claveValida(claveTexto)) {
          return fail(
            400,
            'La clave no tiene el formato de una clave de Webservice (letras y números, unos 32 caracteres).'
          )
        }
        const r = await guardarConexion(clientId, u.url, claveTexto === '' ? null : claveTexto)
        if (!r.ok) return fail(400, r.error)
        return NextResponse.json({ ok: true, estado: await estadoConexion(clientId) })
      }

      if (body.accion === 'probar') {
        const conexion = await claveDe(clientId)
        if (!conexion) return fail(404, 'Primero hay que guardar la dirección y la clave.')

        const prueba = await probarConexion(conexion)
        await anotarPrueba(clientId, prueba.ok, prueba.mensaje, prueba.version)
        return NextResponse.json({ ok: true, prueba, estado: await estadoConexion(clientId) })
      }

      if (body.accion === 'quitar') {
        await quitarConexion(clientId)
        return NextResponse.json({ ok: true, estado: await estadoConexion(clientId) })
      }
    } catch (e) {
      if (isMissingSchema(e)) return fail(503, MIGRACION)
      throw e
    }

    return fail(400, 'Acción desconocida.')
  } catch (error) {
    return errorResponse(error, 'Error en la conexión con la tienda')
  }
}
