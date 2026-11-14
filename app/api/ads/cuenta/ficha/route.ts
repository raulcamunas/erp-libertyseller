import { NextResponse, type NextRequest } from 'next/server'
import { fail } from '@/lib/amazon/api'
import { firmarFicha, guardarFicha, leerFicha, quitarFirma } from '@/lib/ads/cuenta'
import { fichaDesdeCuerpo } from '@/lib/ads/validar'
import { abrirCuenta, errorDeRuta, esAdministrador, soloAdministradores } from '@/lib/ads/ruta'
import { anotarCambio } from '@/lib/ads/log'

/**
 * LA FICHA DE CUENTA (SOP, sección 05). La lee quien lleva la cuenta; guardarla (son los umbrales del motor), firmarla y quitarle la firma, SOLO un administrador.
 * Cada cambio queda en el log de la cuenta (entidad «ficha»).
 *
 *   GET  ?perfilId=   → la ficha (con los valores de arranque del SOP si todavía no se ha guardado)
 *   PUT  {perfilId, …campos}      → guarda. Si estaba firmada y cambia algún valor, pierde la firma
 *   POST {perfilId, accion: 'firmar' | 'quitar-firma'}
 */
/** Los campos que han cambiado entre dos fichas (sin las marcas de firma ni de quién la tocó) */
function cambiosDeFicha(antes: Record<string, unknown>, despues: Record<string, unknown>): Array<{ campo: string; antes: string; despues: string }> {
  const fuera = new Set(['firmadaAt', 'firmadaPor', 'firmadaPorNombre', 'guardada'])
  const salida: Array<{ campo: string; antes: string; despues: string }> = []
  for (const campo of Object.keys(despues)) {
    if (fuera.has(campo)) continue
    const a = JSON.stringify(antes[campo] ?? null)
    const d = JSON.stringify(despues[campo] ?? null)
    if (a !== d) salida.push({ campo, antes: a.slice(0, 120), despues: d.slice(0, 120) })
  }
  return salida
}

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  try {
    const a = await abrirCuenta(request.nextUrl.searchParams.get('perfilId'))
    if (a instanceof NextResponse) return a
    return NextResponse.json({ ficha: await leerFicha(a.cuenta.id), esAdmin: esAdministrador(a.sesion) })
  } catch (error) {
    return errorDeRuta(error, 'Ads: leer la ficha de cuenta')
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const a = await abrirCuenta(body.perfilId)
    if (a instanceof NextResponse) return a
    const prohibido = soloAdministradores(a.sesion, 'Cambiar la ficha de cuenta (los umbrales del motor)')
    if (prohibido) return prohibido
    const campos = fichaDesdeCuerpo(body)
    if (!campos.ok) return fail(400, campos.error)
    const antes = await leerFicha(a.cuenta.id)
    const ficha = await guardarFicha(a.cuenta.id, campos.campos, a.sesion.userId)
    const cambiados = cambiosDeFicha(antes as unknown as Record<string, unknown>, ficha as unknown as Record<string, unknown>)
    if (cambiados.length > 0) {
      await anotarCambio({
        perfilId: a.cuenta.id,
        entidad: 'ficha',
        accion: 'cambiar',
        campo: cambiados.map((c) => c.campo).join(', ').slice(0, 300),
        valorAnterior: cambiados.map((c) => `${c.campo}: ${c.antes}`).join(' · ').slice(0, 1000),
        valorNuevo: cambiados.map((c) => `${c.campo}: ${c.despues}`).join(' · ').slice(0, 1000),
        motivo: antes.firmadaAt && !ficha.firmadaAt ? 'Edición a mano; la ficha pierde la firma' : 'Edición a mano',
        origen: 'manual',
        userId: a.sesion.userId,
      })
    }
    return NextResponse.json({ ficha })
  } catch (error) {
    return errorDeRuta(error, 'Ads: guardar la ficha de cuenta')
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { perfilId?: unknown; accion?: unknown }
    const a = await abrirCuenta(body.perfilId)
    if (a instanceof NextResponse) return a
    const prohibido = soloAdministradores(a.sesion, 'Firmar la ficha de cuenta o quitarle la firma')
    if (prohibido) return prohibido
    if (body.accion === 'firmar') {
      const ficha = await firmarFicha(a.cuenta.id, a.sesion.userId)
      await anotarCambio({ perfilId: a.cuenta.id, entidad: 'ficha', accion: 'firmar', campo: 'firma de la ficha', valorNuevo: 'firmada', motivo: 'Los umbrales pasan a ser doctrina para el motor', origen: 'manual', userId: a.sesion.userId })
      return NextResponse.json({ ficha })
    }
    if (body.accion === 'quitar-firma') {
      const ficha = await quitarFirma(a.cuenta.id)
      await anotarCambio({ perfilId: a.cuenta.id, entidad: 'ficha', accion: 'quitar-firma', campo: 'firma de la ficha', valorAnterior: 'firmada', valorNuevo: 'sin firmar', motivo: 'El motor deja de poder aplicar hasta que se vuelva a firmar', origen: 'manual', userId: a.sesion.userId })
      return NextResponse.json({ ficha })
    }
    return fail(400, 'Acción desconocida.')
  } catch (error) {
    return errorDeRuta(error, 'Ads: firmar la ficha de cuenta')
  }
}
