import { NextResponse, type NextRequest } from 'next/server'
import { fail } from '@/lib/amazon/api'
import { hasTokenKey } from '@/lib/amazon/crypto'
import { almacenSupabase } from '@/lib/correo/almacen'
import { ErrorDeCorreo, probarBuzon } from '@/lib/correo/conexion'
import { MAX_CONTRASENA, guardarContrasena } from '@/lib/correo/credenciales'
import { limpiarNombre } from '@/lib/correo/direcciones'
import { SIN_CACHE, requerirCorreo, respuestaDeFallo } from '@/lib/correo/rutas'
import { autorizarBuzon, buzonesVisibles, desconectarBuzon, estadoHttpDe } from '@/lib/correo/servidor'
import { leerCuerpoConTope } from '@/lib/subidas-limite'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * CAMBIAR O DESCONECTAR UN BUZÓN.
 *
 * PATCH   · { nombre?, firma?, password? }  Solo su dueño. Una contraseña nueva se comprueba contra el servidor antes de
 *           guardarla (y, si vale, el buzón vuelve a leerse aunque estuviera parado por una contraseña mala).
 * DELETE  · Quita la contraseña guardada: el buzón deja de leerse y de poder enviar. Lo ya importado SE QUEDA (es el
 *           seguimiento comercial). Su dueño o un administrador.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

const MAX_BYTES_CUERPO = 8 * 1024
const MAX_FIRMA = 2000

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const sesion = await requerirCorreo()
  if (sesion instanceof NextResponse) return sesion

  const cuerpo = await leerCuerpoConTope(request, MAX_BYTES_CUERPO)
  if (cuerpo instanceof NextResponse) return cuerpo
  let json: { nombre?: unknown; firma?: unknown; password?: unknown }
  try {
    json = JSON.parse(cuerpo.texto) as typeof json
  } catch {
    return fail(400, 'No se ha entendido lo que se ha mandado')
  }

  try {
    const service = createServiceClient()
    const auth = await autorizarBuzon(service, sesion, params.id, 'escribir')
    if (!auth.ok) return fail(auth.estado, auth.mensaje)

    const cambios: { nombre?: string; firma?: string | null } = {}
    if (json.nombre !== undefined) {
      const nombre = limpiarNombre(json.nombre)
      if (!nombre) return fail(400, 'El nombre no puede estar vacío.')
      cambios.nombre = nombre
    }
    if (json.firma !== undefined) {
      if (json.firma !== null && typeof json.firma !== 'string') return fail(400, 'La firma no es válida.')
      const firma = typeof json.firma === 'string' ? json.firma.replace(/\r\n?/g, '\n').slice(0, MAX_FIRMA).trimEnd() : ''
      cambios.firma = firma === '' ? null : firma
    }

    if (json.password !== undefined) {
      if (typeof json.password !== 'string' || json.password === '' || json.password.length > MAX_CONTRASENA) return fail(400, 'Escribe la contraseña del buzón.')
      if (!hasTokenKey()) return fail(503, 'El servidor no tiene configurada la clave de cifrado, así que no puede guardar la contraseña del buzón. Avisa a Liberty Seller.')
      try {
        await probarBuzon(auth.buzon, json.password)
      } catch (error) {
        const e = error instanceof ErrorDeCorreo ? error : new ErrorDeCorreo('otro')
        return fail(estadoHttpDe(e.codigo), e.message)
      }
      const guardada = await guardarContrasena(service, auth.buzon.id, json.password)
      if (!guardada.ok) return fail(500, 'No se ha podido guardar la contraseña. Vuelve a probar en un momento.')
      await almacenSupabase(service).anotarBuzon(auth.buzon.id, { credenciales_invalidas: false, fallos_seguidos: 0, ultimo_error: null })
    }

    if (Object.keys(cambios).length > 0) {
      const { error } = await service.from('correo_buzones').update(cambios).eq('id', auth.buzon.id)
      if (error) throw new Error('No se ha podido guardar el cambio.', { cause: error })
    }

    return NextResponse.json({ ok: true, buzones: await buzonesVisibles(service, sesion) }, { headers: SIN_CACHE })
  } catch (error) {
    return respuestaDeFallo('Correo · cambiar buzón: fallo', error)
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  const sesion = await requerirCorreo()
  if (sesion instanceof NextResponse) return sesion

  try {
    const service = createServiceClient()
    const auth = await autorizarBuzon(service, sesion, params.id, 'administrar')
    if (!auth.ok) return fail(auth.estado, auth.mensaje)

    // Queda constancia de que un administrador ha desconectado el buzón de otra persona: solo ids
    if (auth.porSupervision) console.info('Correo · un administrador desconecta el buzón de otra persona', { administrador: sesion.userId, buzon: auth.buzon.id })

    if (!(await desconectarBuzon(service, auth.buzon.id))) return fail(500, 'No se ha podido desconectar el buzón. Vuelve a intentarlo en un momento.')
    return NextResponse.json({ ok: true, buzones: await buzonesVisibles(service, sesion) }, { headers: SIN_CACHE })
  } catch (error) {
    return respuestaDeFallo('Correo · desconectar buzón: fallo', error)
  }
}
