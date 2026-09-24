import { NextResponse, type NextRequest } from 'next/server'
import { requireAppAccess } from '@/lib/auth/api'
import { errorResponse, fail, readText } from '@/lib/amazon/api'
import {
  MENSAJE_FALTA_LA_200,
  anioValido,
  crearCliente,
  faltaLa200,
  leerVista,
} from '@/lib/tax-reports/datos'
import type { TipoFichero } from '@/lib/tax-reports/tipos'

/**
 * DAR DE ALTA UN CLIENTE EN LA REJILLA, A MANO.
 *
 * Era una de las dos cosas que pedia el encargo: poder anadir un cliente ahi y
 * ponerle nombre, sin que tenga que existir en comisiones. Por eso esta tabla
 * es propia y no una columna de public.clients, donde una fila inventada
 * exigiria una tasa de comision y apareceria en facturacion y en tarifas.
 *
 * El cliente nace con `client_id` a NULL —sin vinculo con comisiones— y con el
 * nombre de fichero que se le diga, TAL CUAL SE ESCRIBA. Que Lenobotics y
 * Creative Toys vayan con Sellerboard es un DATO, no un `if`, y desde que Raul
 * pidio poder denominarlo el tampoco es una lista de dos: aqui se acepta
 * cualquier texto. Ver lib/tax-reports/tipos.ts.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  try {
    const sesion = await requireAppAccess(
      'tax-reports',
      'No tienes acceso a Tax Reports. Pideselo a un administrador: se concede por usuario desde Usuarios.'
    )
    if (sesion instanceof NextResponse) return sesion

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>

    const nombre = readText(body.nombre, 120)
    if (!nombre) {
      return fail(400, 'Ponle nombre al cliente: es lo que se lee en la primera columna de la rejilla')
    }

    /**
     * EL TIPO DE FICHERO NO SE VALIDA CONTRA NINGUNA LISTA, y ese es el cambio.
     *
     * Antes aqui habia un `!== 'tax_report' && !== 'sellerboard'`. Raul ha
     * pedido poder denominarlo el, asi que lo unico que se le exige es caber en
     * 60 caracteres —es una etiqueta de una columna, no un parrafo— y no venir
     * en blanco, que lo resuelve el DEFAULT: `null` aqui significa «no me han
     * dicho nada», y crearCliente pone «Tax report», que es el caso de casi
     * todos. Un 400 por no rellenar un campo que casi siempre vale lo mismo es
     * friccion en el unico sitio donde se dan de alta clientes.
     */
    const tipoFichero: TipoFichero | null = readText(body.tipoFichero, 60)

    await crearCliente({ nombre, tipoFichero, notas: readText(body.notas, 2000) })

    // La vista ENTERA y no el cliente creado: la pantalla se repinta con esto y
    // no tiene que adivinar donde va la fila nueva. Mismo criterio que las
    // rutas de buzones.
    return NextResponse.json(await leerVista(anioDe(request)))
  } catch (error) {
    if (faltaLa200(error)) return fail(503, MENSAJE_FALTA_LA_200)

    if ((error as { code?: string })?.code === '23505') {
      return fail(
        409,
        'Ya hay un cliente con ese nombre en Tax Reports. Dos filas iguales son dos sitios donde ' +
          'colgar el informe de agosto, y el dia 3 nadie sabria cual es el bueno.'
      )
    }

    return errorResponse(error, 'Error dando de alta un cliente en Tax Reports')
  }
}

/**
 * De que ano se devuelve la rejilla despues de escribir.
 *
 * Se lee de la URL para que la pantalla siga viendo el ano que tenia abierto:
 * devolver siempre el ano en curso la haria saltar a 2026 mientras alguien
 * repasa lo que se mando en 2025.
 */
function anioDe(request: NextRequest): number {
  return anioValido(request.nextUrl.searchParams.get('anio')) ?? new Date().getFullYear()
}
