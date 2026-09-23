import { NextResponse, type NextRequest } from 'next/server'
import { UUID, errorResponse, fail, readText, requireAmazonAdmin } from '@/lib/amazon/api'
import { createServiceClient } from '@/lib/supabase/service'
import {
  crearBuzon,
  listarBuzonesAdmin,
  listarBuzonesElegibles,
  type AltaBuzon,
  type TransporteBuzon,
} from '@/lib/stock-sync/buzones'

/**
 * EL CATÁLOGO DE BUZONES: LISTAR Y DAR DE ALTA.
 *
 * Solo admin, como todo /api/stock-sync: de un buzón cuelga la contraseña de un
 * cliente y de qué correo sale el fichero que acaba publicado en su tienda.
 *
 *
 * ============ DOS VISTAS Y NO UNA, Y LA DIFERENCIA NO ES COSMÉTICA ==========
 *
 *   GET                  → BuzonAdmin[]: lo que ve la pestaña Buzones, que sí
 *                          necesita el host y el usuario para poder editarlos.
 *   GET ?vista=elegibles → BuzonElegible[]: ocho campos, para el desplegable
 *                          del perfil. Sin host, sin usuario, sin notas.
 *
 * Por qué existe la segunda pudiendo recortar en la pantalla: porque lo que
 * viaja en la respuesta ya ha salido del servidor. Recortar en el navegador es
 * recortar DESPUÉS de haberlo entregado, y el host y el usuario de un buzón son
 * media credencial. El desplegable del perfil se pinta con nombre, dirección y
 * si está activo; no necesita saber a qué servidor se conecta el ERP, así que
 * no se le cuenta. Está explicado largo en lib/stock-sync/buzones.ts.
 *
 * La contraseña no está en NINGUNA de las dos, ni cifrada ni con huella: vive
 * en otra tabla y no hay ninguna función que la devuelva.
 *
 *
 * ============ QUÉ SE VALIDA AQUÍ Y QUÉ SE DEJA A LA BASE ============
 *
 * Aquí se valida lo que la base NO puede: que el cliente exista de verdad y que
 * lo que llega tenga la forma que espera `AltaBuzon`. Lo demás —que un buzón
 * IMAP traiga servidor, que uno de Gmail no lo traiga, que el puerto esté en
 * rango, que no se dé de alta dos veces el mismo— lo dicen los CHECK y el
 * índice único de la migración 198, y aquí solo se TRADUCEN sus códigos.
 *
 * Duplicar esas reglas en TypeScript sería tener dos sitios donde cambiarlas, y
 * el día que se cambie uno solo la pantalla dirá una cosa y la base hará otra.
 * La base es el único camino por el que no se puede pasar de largo: el editor
 * SQL de Supabase también escribe en esta tabla.
 */
export const dynamic = 'force-dynamic'
// nodejs y no edge: aquí no hace falta, pero las rutas hermanas de «probar»
// abren sockets IMAP y conviene que todo el árbol corra en el mismo sitio.
export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session

    if (request.nextUrl.searchParams.get('vista') === 'elegibles') {
      return NextResponse.json({ buzones: await listarBuzonesElegibles() })
    }

    return NextResponse.json({ buzones: await listarBuzonesAdmin() })
  } catch (error) {
    if (faltaLa198(error)) return fail(503, FALTA_LA_198)
    return errorResponse(error, 'Error leyendo el catálogo de buzones')
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>

    const nombre = readText(body.nombre, 120)
    if (!nombre) return fail(400, 'Ponle un nombre al buzón: es como lo vas a reconocer en la lista')

    const direccion = (readText(body.direccion, 200) ?? '').toLowerCase()
    if (!direccion) return fail(400, 'Falta la dirección del buzón')
    if (!CORREO.test(direccion)) {
      return fail(400, `«${direccion}» no es una dirección de correo. Escríbela entera, con la arroba y el dominio.`)
    }

    if (body.transporte !== 'google' && body.transporte !== 'imap') {
      return fail(
        400,
        'Falta decir cómo se entra en el buzón: por la API de Gmail (solo para direcciones de ' +
          'nuestro Workspace) o por IMAP con servidor y contraseña propios.'
      )
    }
    const transporte = body.transporte as TransporteBuzon

    const clientId = await duenyoValido(body.clientId)
    if (clientId instanceof NextResponse) return clientId

    const datos: AltaBuzon = {
      nombre,
      direccion,
      transporte,
      clientId,
      host: readText(body.host, 200),
      puerto: leerPuerto(body.puerto),
      usuario: readText(body.usuario, 200),
      carpeta: readText(body.carpeta, 200),
      seguro: leerBooleano(body.seguro, true),
      notas: readText(body.notas, 2000),
    }

    await crearBuzon(datos, session.userId)

    // La lista ENTERA y no el buzón creado: la pantalla se repinta con esto y no
    // tiene que adivinar dónde va la fila nueva ni recalcular «en uso por». Es
    // lo mismo que hacen las rutas de perfiles, por el mismo motivo.
    return NextResponse.json({ buzones: await listarBuzonesAdmin() })
  } catch (error) {
    if (faltaLa198(error)) return fail(503, FALTA_LA_198)
    const traducido = traducirEscritura(error)
    if (traducido) return fail(traducido.status, traducido.mensaje)
    return errorResponse(error, 'Error dando de alta un buzón')
  }
}

/* ------------------------------------------------------------------ */

/** La misma forma que el CHECK de `direccion` en la 198, para decirlo antes */
const CORREO = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

const FALTA_LA_198 =
  'Falta lanzar la migración 198_buzones_correo.sql en el editor SQL de Supabase: sin ella no ' +
  'existe el catálogo de buzones.'

/**
 * ¿Es que falta lanzar la 198?
 *
 * Los mismos códigos que mira credenciales-buzon.ts, y por el mismo motivo: la
 * migración se lanza A MANO en el editor SQL, así que el código puede llegar
 * desplegado antes que ella. Sin esto, abrir la pestaña Buzones daría un 500
 * genérico y nadie relacionaría «no se ha podido completar la operación» con un
 * fichero .sql sin lanzar.
 */
function faltaLa198(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code
  return code === 'PGRST205' || code === '42P01' || code === 'PGRST204' || code === '42703'
}

/**
 * Traduce lo que Postgres contesta al escribir en stock_buzones.
 *
 * Sin esto, dar de alta un buzón IMAP sin servidor contesta «new row for
 * relation "stock_buzones" violates check constraint
 * "stock_buzones_imap_ok"», que obliga a abrir el SQL para saber qué campo
 * falta.
 *
 * LOS DOS TRIGGERS DE LA 198 CAEN TAMBIÉN EN EL 23514, Y A PROPÓSITO: lanzan
 * con ERRCODE = 'check_violation' justamente para entrar por aquí. Su mensaje
 * YA está escrito en español y dice qué hacer, así que se devuelve tal cual —
 * traducir una frase que ya es la buena solo serviría para que se separaran.
 * Un RAISE EXCEPTION pelado habría salido como P0001 y se habría ido al cajón
 * genérico del final.
 */
function traducirEscritura(error: unknown): { status: number; mensaje: string } | null {
  const e = error as { code?: string; message?: string } | null
  const mensaje = e?.message ?? ''

  if (e?.code === '23505') {
    return {
      status: 409,
      mensaje:
        'Ese buzón ya está dado de alta. La misma dirección en el mismo servidor dos veces son dos ' +
        'contraseñas que se pisan, y nadie sabría cuál está usando el ciclo automático.',
    }
  }

  if (e?.code === '23503') {
    return { status: 404, mensaje: 'Ese cliente ya no existe. Recarga la pantalla y vuelve a elegirlo.' }
  }

  if (e?.code !== '23514') return null

  for (const [nombre, frase] of Object.entries(CHECKS)) {
    if (mensaje.includes(nombre)) return { status: 400, mensaje: frase }
  }

  // Un 23514 sin nombre de constraint es uno de los dos triggers. Ver arriba.
  if (mensaje.trim()) return { status: 409, mensaje: mensaje.trim() }

  return {
    status: 400,
    mensaje: 'Esos datos dejan el buzón en un estado que no se puede guardar. Repasa los campos.',
  }
}

const CHECKS: Record<string, string> = {
  stock_buzones_imap_ok:
    'Un buzón IMAP necesita servidor: es a dónde se conecta el ERP para leerlo. Lo da el proveedor ' +
    'del correo (en Hostinger, imap.hostinger.com).',
  stock_buzones_google_ok:
    'Un buzón de Gmail no lleva servidor: se entra por la API con la delegación de dominio, no por ' +
    'un host. Deja el servidor y el puerto vacíos, o cámbialo a IMAP si el buzón no es de nuestro ' +
    'Workspace.',
  stock_buzones_puerto_check:
    'El puerto tiene que estar entre 1 y 65535. Déjalo vacío y se usará 993, que es el cifrado.',
  stock_buzones_transporte_check:
    'Cómo se entra en el buzón solo puede ser «Gmail» o «IMAP».',
  stock_buzones_direccion_check:
    'Esa dirección de correo no tiene forma de dirección. Escríbela entera, con la arroba y el dominio.',
  stock_buzones_nombre_check: 'Ponle un nombre al buzón: es como lo vas a reconocer en la lista.',
}

/**
 * EL DUEÑO DEL BUZÓN, COMPROBADO CONTRA LA BASE.
 *
 * null = de la agencia, elegible por el perfil de cualquier cliente. Con valor =
 * solo lo ven los perfiles de ese cliente, que es lo que impide que el fichero
 * de stock de uno acabe publicado en la cuenta de Amazon de otro.
 *
 * Se comprueba que el cliente EXISTA aunque la clave ajena diría lo mismo,
 * porque lo diría con un error de Postgres que no le sirve a nadie.
 */
async function duenyoValido(raw: unknown): Promise<string | null | NextResponse> {
  if (raw === null || raw === undefined || raw === '') return null

  const clientId = typeof raw === 'string' ? raw.trim() : ''
  if (!UUID.test(clientId)) {
    return fail(400, 'Ese cliente no vale. Elige uno de la lista o deja el buzón como de la agencia.')
  }

  const service = createServiceClient()
  const { data, error } = await service
    .from('stock_clients')
    .select('id')
    .eq('id', clientId)
    .maybeSingle()
  if (error) throw error
  if (!data) return fail(404, 'Ese cliente no existe en la sincronización de stock')

  return clientId
}

/**
 * El puerto, del formulario.
 *
 * Llega como texto porque un `<input>` siempre da texto. Vacío es null y no
 * cero: null lo entiende el conector como «usa el de siempre» (993 si cifra,
 * 143 si no), y un cero se lo comería el CHECK con un mensaje peor.
 *
 * Se lanza un Error normal a propósito: errorResponse lo saca con su mensaje en
 * un 400, que es como el resto del módulo escribe las validaciones de negocio.
 */
function leerPuerto(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null

  const n = Number(raw)
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    throw new Error(
      'El puerto tiene que ser un número entre 1 y 65535. Déjalo vacío y se usará 993, que es el cifrado.'
    )
  }
  return n
}

/** Acepta el true de JSON y el 'true' de un formulario. Igual que booleanoConfig */
function leerBooleano(raw: unknown, porOmision: boolean): boolean {
  if (typeof raw === 'boolean') return raw
  if (typeof raw === 'string') return ['true', '1', 'si', 'sí', 'on'].includes(raw.trim().toLowerCase())
  return porOmision
}
