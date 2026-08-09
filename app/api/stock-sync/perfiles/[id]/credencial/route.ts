import { NextResponse, type NextRequest } from 'next/server'
import { UUID, errorResponse, fail, requireAmazonAdmin } from '@/lib/amazon/api'
import {
  borrarCredencial,
  estadoCredencial,
  guardarCredencial,
} from '@/lib/stock-sync/origenes/credenciales'
import { conectorDe, OrigenError } from '@/lib/stock-sync/origenes'
import { loadPerfil } from '@/lib/stock-sync/perfiles'

/**
 * LA CONTRASEÑA DEL ORIGEN DE UN CLIENTE.
 *
 * Tres verbos y ninguno devuelve nunca el valor:
 *
 *   GET    → ¿hay una guardada? de qué tipo y de cuándo. Nada más.
 *   POST   → guardar o sustituir. Entra en claro, se cifra y se acabó.
 *   DELETE → quitarla.
 *
 * POST y no PUT aunque sea un reemplazo: es lo que habla el resto del módulo
 * (postAmazon en lib/amazon/client.ts), y una ruta que necesita su propia
 * función de red para un verbo distinto es una función de red más donde
 * equivocarse con el manejo de errores.
 *
 *
 * ============ POR QUÉ ESTA RUTA EXISTE Y NO VALE EL PATCH DEL FORMULARIO ======
 *
 * Porque el PATCH del formulario escribe `origen_config`, que es un JSONB de
 * texto plano que la pantalla lee y escribe entero, y que vuelve al navegador en
 * cada carga de la vista. Una contraseña ahí es una contraseña publicada.
 *
 * Por eso hay una ruta aparte que cifra, y por eso la columna no está en
 * CAMPOS_EDITABLES de lib/stock-sync/perfiles.ts: no es que no se deba escribir
 * por el PATCH, es que no se puede. El secreto ni siquiera vive en esa tabla
 * (migración 124).
 *
 *
 * ============ LO QUE NO SE HACE, Y ES DELIBERADO ============
 *
 * No se comprueba que la contraseña funcione antes de guardarla. Podría hacerse
 * —conectar y ver— pero entonces una contraseña BUENA con el servidor del
 * cliente caído no se podría guardar, y ese es el momento en que menos ganas hay
 * de pelearse con el ERP. Se guarda, y el botón de al lado prueba.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session
    if (!UUID.test(params.id)) return fail(400, 'Ese perfil no existe')

    return NextResponse.json({ credencial: await estadoCredencial(params.id) })
  } catch (error) {
    return errorResponse(error, 'Error leyendo el estado de una credencial de origen')
  }
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session
    if (!UUID.test(params.id)) return fail(400, 'Ese perfil no existe')

    const perfil = await loadPerfil(params.id)
    if (!perfil) return fail(404, 'Ese perfil ya no existe')

    // El conector es quien declara si necesita credencial. Guardar una
    // contraseña en un perfil que lee de una carpeta de Drive no es un error
    // grave, pero es una contraseña de un cliente guardada sin ninguna razón —y
    // lo que no existe no se puede filtrar.
    const conector = conectorDe(perfil.origen)
    if (!conector.secreto) {
      return fail(
        400,
        `El origen «${conector.etiqueta}» no usa contraseña, así que no hay dónde guardarla.`
      )
    }

    const body = (await request.json().catch(() => null)) as {
      tipo?: unknown
      valor?: unknown
      passphrase?: unknown
    } | null

    if (!body || typeof body.valor !== 'string' || body.valor === '') {
      return fail(400, 'No ha llegado ninguna contraseña que guardar')
    }

    const tipo = body.tipo === 'clave_privada' ? 'clave_privada' : 'password'
    if (!conector.secreto.tipos.some((t) => t.valor === tipo)) {
      return fail(400, `El origen «${conector.etiqueta}» no admite ese tipo de credencial.`)
    }

    const credencial = await guardarCredencial({
      profileId: params.id,
      tipo,
      valor: body.valor,
      passphrase: typeof body.passphrase === 'string' ? body.passphrase : null,
      userId: session.userId,
    })

    return NextResponse.json({ credencial })
  } catch (error) {
    if (error instanceof OrigenError) return fail(400, error.message)
    /**
     * El error genérico NO lleva el mensaje original, y aquí importa más que en
     * ninguna otra ruta: el cuerpo de esta petición es una contraseña, y un
     * error de la librería de cifrado o de Postgres puede llevar dentro un trozo
     * del valor que no ha podido procesar.
     *
     * Y por eso NO se usa errorResponse: ese ayudante reenvía `error.message`
     * de cualquier Error tal cual (lib/amazon/api.ts), que es justo lo que aquí
     * no puede pasar. Se registra en el servidor y a la pantalla va una frase.
     */
    console.error('Error guardando la credencial de un origen:', error)
    return fail(500, 'No se ha podido guardar la credencial. Vuelve a intentarlo y avisa si sigue fallando')
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session
    if (!UUID.test(params.id)) return fail(400, 'Ese perfil no existe')

    await borrarCredencial(params.id)
    return NextResponse.json({ credencial: await estadoCredencial(params.id) })
  } catch (error) {
    return errorResponse(error, 'Error borrando la credencial de un origen')
  }
}
