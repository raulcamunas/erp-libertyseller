import { NextResponse, type NextRequest } from 'next/server'
import { UUID, errorResponse, fail, readText, requireAmazonAdmin } from '@/lib/amazon/api'
import { createServiceClient } from '@/lib/supabase/service'
import {
  actualizarBuzon,
  borrarBuzon,
  leerBuzon,
  listarBuzonesAdmin,
  loginDe,
  perfilesQueUsan,
  type AltaBuzon,
  type BuzonFila,
} from '@/lib/stock-sync/buzones'
import { borrarCredencialBuzon } from '@/lib/stock-sync/origenes/credenciales-buzon'

/**
 * GUARDA O BORRA UN BUZÓN DEL CATÁLOGO.
 *
 *
 * ============ EL CUERPO SE LEE CAMPO A CAMPO, NUNCA CON UN SPREAD ==========
 *
 * Solo se mira lo que declara `AltaBuzon`, más `activo`. Un `client_id`, un
 * `ultima_prueba_ok` o un `created_by` colados en el JSON no tienen por dónde
 * entrar: no es que se filtren, es que nadie los lee.
 *
 * Y un campo que NO venga en el cuerpo se queda como está —eso lo sostiene
 * actualizarBuzon(), que también va uno a uno—. Importa porque la pantalla
 * manda solo lo que se ha tocado: con un spread, un `undefined` serializado
 * borraría el servidor de un buzón que funcionaba por editarle las notas.
 *
 *
 * ============ NO SE BORRA UN BUZÓN QUE ESTÁ EN USO ============
 *
 * Se comprueba AQUÍ, antes de tocar la base, y se contesta con los nombres de
 * los perfiles que lo usan. La clave ajena de la 198 no lleva RESTRICT —está
 * explicado largo allí: RESTRICT rompería el borrado en cascada de un cliente—
 * así que este es el sitio donde vive esa regla. Si aun así llega un 23503 a la
 * base, se traduce igual: la regla no puede depender de que nadie se salte la
 * comprobación.
 *
 *
 * ============ MOVER EL DESTINO BORRA LA CONTRASEÑA GUARDADA ============
 *
 * La contraseña que un cliente nos confía es de un servidor, un puerto y un
 * usuario CONCRETOS. En cuanto uno de los tres cambia, esa contraseña ya no
 * vale para el sitio nuevo, y seguir guardándola solo sirve para que un día
 * viaje a un servidor que no es el suyo: bastaría con editar el host y pulsar
 * «Probar», porque esa ruta coge el destino de la fila y la contraseña de la
 * tabla cifrada. credenciales-buzon.ts promete que una contraseña guardada no
 * se puede volver a ver, solo sustituir; esto es lo que impide sortear esa
 * promesa por el camino de la edición.
 *
 * Es la misma regla, y por el mismo motivo, que
 * moverElDestinoBorraLaCredencial() en app/api/amazon/perfiles/[id]/route.ts.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session
    if (!UUID.test(params.id)) return fail(400, 'Ese buzón no existe')

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body || typeof body !== 'object') return fail(400, 'No ha llegado ningún cambio')

    // Se lee ANTES de escribir: hace falta el destino anterior para saber si se
    // ha movido. Ver la cabecera.
    const antes = await leerBuzon(params.id)
    if (!antes) return fail(404, 'Ese buzón ya no existe. Recarga la pantalla.')

    const cambios: Partial<AltaBuzon> & { activo?: boolean } = {}

    if ('nombre' in body) {
      const nombre = readText(body.nombre, 120)
      if (!nombre) return fail(400, 'El buzón necesita un nombre: es como lo reconoces en la lista')
      cambios.nombre = nombre
    }

    if ('direccion' in body) {
      const direccion = (readText(body.direccion, 200) ?? '').toLowerCase()
      if (!direccion) return fail(400, 'Falta la dirección del buzón')
      if (!CORREO.test(direccion)) {
        return fail(
          400,
          `«${direccion}» no es una dirección de correo. Escríbela entera, con la arroba y el dominio.`
        )
      }
      cambios.direccion = direccion
    }

    if ('transporte' in body) {
      if (body.transporte !== 'google' && body.transporte !== 'imap') {
        return fail(400, 'Cómo se entra en el buzón solo puede ser «Gmail» o «IMAP»')
      }
      cambios.transporte = body.transporte
    }

    if ('clientId' in body) {
      const duenyo = await duenyoValido(body.clientId)
      if (duenyo instanceof NextResponse) return duenyo
      cambios.clientId = duenyo
    }

    if ('host' in body) cambios.host = readText(body.host, 200)
    if ('puerto' in body) cambios.puerto = leerPuerto(body.puerto)
    if ('usuario' in body) cambios.usuario = readText(body.usuario, 200)
    if ('carpeta' in body) cambios.carpeta = readText(body.carpeta, 200)
    if ('seguro' in body) cambios.seguro = leerBooleano(body.seguro, antes.seguro)
    if ('notas' in body) cambios.notas = readText(body.notas, 2000)
    if ('activo' in body) cambios.activo = leerBooleano(body.activo, antes.activo)

    if (Object.keys(cambios).length === 0) {
      return fail(400, 'No hay ningún campo que se pueda guardar en lo que ha llegado')
    }

    const despues = await actualizarBuzon(params.id, cambios, session.userId)

    if (seHaMovidoElDestino(antes, despues)) await borrarCredencialBuzon(params.id)

    return NextResponse.json({ buzones: await listarBuzonesAdmin() })
  } catch (error) {
    if (faltaLa198(error)) return fail(503, FALTA_LA_198)
    const traducido = traducirEscritura(error)
    if (traducido) return fail(traducido.status, traducido.mensaje)
    return errorResponse(error, 'Error guardando un buzón')
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session
    if (!UUID.test(params.id)) return fail(400, 'Ese buzón no existe')

    const buzon = await leerBuzon(params.id)
    if (!buzon) return fail(404, 'Ese buzón ya no existe. Recarga la pantalla.')

    // ANTES de borrar nada, y con los nombres: «lo usan 3 perfiles» sin decir
    // cuáles obliga a buscarlos a mano uno por uno.
    const enUsoPor = await perfilesQueUsan(params.id)
    if (enUsoPor.length > 0) {
      return NextResponse.json(
        {
          error:
            `No se puede borrar «${buzon.nombre}»: lo están usando ${enUsoPor.length} ` +
            `${enUsoPor.length === 1 ? 'perfil' : 'perfiles'} (${enUsoPor.join(', ')}). ` +
            'Cámbialos de buzón primero, o apágalo en vez de borrarlo si solo quieres que deje de leerse.',
          enUsoPor,
        },
        { status: 409 }
      )
    }

    // La contraseña primero: si el borrado del buzón fallara después, lo que
    // queda es un buzón sin contraseña —que se vuelve a escribir— y no una
    // contraseña de un cliente sin buzón al que pertenezca, que no se ve desde
    // ninguna pantalla y no la borraría nadie nunca.
    await borrarCredencialBuzon(params.id)
    await borrarBuzon(params.id)

    return NextResponse.json({ buzones: await listarBuzonesAdmin() })
  } catch (error) {
    if (faltaLa198(error)) return fail(503, FALTA_LA_198)
    if ((error as { code?: string })?.code === '23503') {
      // No debería llegar aquí —se comprueba arriba— pero si alguien asigna el
      // buzón a un perfil entre la comprobación y el borrado, la regla se sigue
      // cumpliendo y se sigue explicando.
      const enUsoPor = await perfilesQueUsan(params.id).catch(() => [] as string[])
      return NextResponse.json(
        {
          error:
            'No se puede borrar ese buzón: hay perfiles que lo están usando. Cámbialos de buzón ' +
            'primero, o apágalo en vez de borrarlo.',
          enUsoPor,
        },
        { status: 409 }
      )
    }
    return errorResponse(error, 'Error borrando un buzón')
  }
}

/* ------------------------------------------------------------------ */

/** La misma forma que el CHECK de `direccion` en la 198, para decirlo antes */
const CORREO = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

const FALTA_LA_198 =
  'Falta lanzar la migración 198_buzones_correo.sql en el editor SQL de Supabase: sin ella no ' +
  'existe el catálogo de buzones.'

/** ¿Falta lanzar la 198? Los mismos códigos que mira credenciales-buzon.ts */
function faltaLa198(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code
  return code === 'PGRST205' || code === '42P01' || code === 'PGRST204' || code === '42703'
}

/**
 * ¿APUNTA ESTE BUZÓN A OTRO SITIO QUE ANTES?
 *
 * El destino son tres cosas: el servidor, el puerto y con qué usuario se entra.
 * El login entra por `loginDe()` y no por la columna `usuario` a secas, porque
 * esa columna casi siempre está vacía y el login es entonces la DIRECCIÓN:
 * cambiar la dirección de un buzón es cambiar de cuenta, y la contraseña
 * guardada es la de la cuenta anterior.
 *
 * La carpeta y las notas no entran: no deciden a dónde viaja nada.
 */
function seHaMovidoElDestino(antes: BuzonFila, despues: BuzonFila): boolean {
  if (antes.transporte !== despues.transporte) return true
  if ((antes.host ?? '').trim().toLowerCase() !== (despues.host ?? '').trim().toLowerCase()) return true
  if (antes.puerto !== despues.puerto) return true
  return loginDe(antes).toLowerCase() !== loginDe(despues).toLowerCase()
}

/**
 * Traduce lo que Postgres contesta al escribir en stock_buzones.
 *
 * LOS DOS TRIGGERS DE LA 198 CAEN TAMBIÉN EN EL 23514, Y A PROPÓSITO: lanzan
 * con ERRCODE = 'check_violation' justamente para entrar por aquí. Su mensaje ya
 * está escrito en español y dice qué hacer (el de darle dueño a un buzón que
 * usan perfiles de otros clientes es el que se va a ver de verdad), así que se
 * devuelve tal cual: traducir una frase que ya es la buena solo serviría para
 * que las dos se separaran con el tiempo.
 */
function traducirEscritura(error: unknown): { status: number; mensaje: string } | null {
  const e = error as { code?: string; message?: string } | null
  const mensaje = e?.message ?? ''

  if (e?.code === 'PGRST116') {
    return { status: 404, mensaje: 'Ese buzón ya no existe. Recarga la pantalla.' }
  }

  if (e?.code === '23505') {
    return {
      status: 409,
      mensaje:
        'Ya hay otro buzón dado de alta con esa dirección en ese servidor. La misma cuenta dos veces ' +
        'son dos contraseñas que se pisan, y nadie sabría cuál está usando el ciclo automático.',
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
    mensaje: 'Ese cambio deja el buzón en un estado que no se puede guardar. Repasa los campos.',
  }
}

const CHECKS: Record<string, string> = {
  stock_buzones_imap_ok:
    'Un buzón IMAP necesita servidor: es a dónde se conecta el ERP para leerlo. Lo da el proveedor ' +
    'del correo (en Hostinger, imap.hostinger.com).',
  stock_buzones_google_ok:
    'Un buzón de Gmail no lleva servidor: se entra por la API con la delegación de dominio, no por ' +
    'un host. Borra el servidor y el puerto antes de cambiarlo a Gmail.',
  stock_buzones_puerto_check:
    'El puerto tiene que estar entre 1 y 65535. Déjalo vacío y se usará 993, que es el cifrado.',
  stock_buzones_transporte_check: 'Cómo se entra en el buzón solo puede ser «Gmail» o «IMAP».',
  stock_buzones_direccion_check:
    'Esa dirección de correo no tiene forma de dirección. Escríbela entera, con la arroba y el dominio.',
  stock_buzones_nombre_check: 'El buzón necesita un nombre: es como lo reconoces en la lista.',
}

/**
 * El dueño del buzón, comprobado contra la base.
 *
 * null = de la agencia. Con valor = solo lo ven los perfiles de ese cliente, que
 * es lo que impide que el fichero de stock de uno acabe publicado en la cuenta
 * de Amazon de otro. Quitarle el dueño a un buzón que ya usan varios siempre
 * vale; ponérselo cuando lo usan perfiles de otros clientes lo para el trigger
 * de la 198, y su mensaje sale por traducirEscritura().
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
 * El puerto, del formulario. Vacío es null y no cero: null lo entiende el
 * conector como «usa el de siempre» (993 si cifra, 143 si no), y un cero se lo
 * comería el CHECK con un mensaje peor.
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
