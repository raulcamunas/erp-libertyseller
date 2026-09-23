import { NextResponse, type NextRequest } from 'next/server'
import { UUID, errorResponse, fail, requireAmazonAdmin } from '@/lib/amazon/api'
import { conectorDe, esOrigenElegible } from '@/lib/stock-sync/origenes'
import { buzonElegibleParaPerfil } from '@/lib/stock-sync/buzones'
import { borrarCredencial } from '@/lib/stock-sync/origenes/credenciales'
import {
  actualizarPerfil,
  borrarPerfil,
  filtrarCampos,
  loadPerfil,
  loadPerfiles,
} from '@/lib/stock-sync/perfiles'

/**
 * GUARDA O BORRA UN PERFIL DE LECTURA.
 *
 * EL CUERPO SE FILTRA CONTRA UNA LISTA BLANCA (filtrarCampos), y eso es lo que
 * de verdad protege esta ruta: el JSON llega del navegador, así que sin ese
 * filtro un `client_id` o un `last_ok_at` colados en la petición se escribirían
 * tal cual. Con lista negra, cada columna que se añadiera a la tabla nacería
 * escribible por olvido.
 *
 * Las validaciones de fondo —que un perfil de stock tenga columna de stock, que
 * el precio por margen traiga margen, que encender el envío exija conexión— NO
 * se repiten aquí: viven en los CHECK de la migración 120, que es el único
 * sitio por el que no se puede pasar de largo. Aquí solo se traducen sus
 * códigos de error a algo que se pueda leer.
 */
export const dynamic = 'force-dynamic'

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session

    if (!UUID.test(params.id)) return fail(400, 'Ese perfil no existe')

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body || typeof body !== 'object') return fail(400, 'No ha llegado ningún cambio')

    /**
     * EL BUZÓN SE SACA DEL CUERPO AQUÍ, ANTES DE CONTAR LOS CAMBIOS.
     *
     * `buzon_id` NO está en CAMPOS_EDITABLES y no va a estarlo (el motivo, largo,
     * está escrito al final de esa lista en perfiles.ts). Pero eso, por sí solo,
     * dejaba la pantalla ENTERA sin poder elegir buzón: `filtrarCampos` lo tiraba,
     * el patch se quedaba vacío y la ruta cortaba con «No hay ningún campo que se
     * pueda guardar» sin llegar siquiera a leer el perfil. El desplegable
     * funcionaba, guardaba, contestaba 400 y no cambiaba nada.
     *
     * Así que se lee aparte, se valida aparte y se escribe aparte, después del
     * guardia del dueño. Un PATCH que SOLO trae el buzón es un cambio de verdad.
     */
    const traeBuzon = Object.prototype.hasOwnProperty.call(body, 'buzon_id')
    const buzonPedido = traeBuzon ? normalizarBuzon(body.buzon_id) : undefined
    if (traeBuzon && buzonPedido === INVALIDO) {
      return fail(400, 'El buzón que ha llegado no se entiende. Recarga la pantalla y vuelve a elegirlo')
    }

    const patch = filtrarCampos(body)
    if (Object.keys(patch).length === 0 && !traeBuzon) {
      return fail(400, 'No hay ningún campo que se pueda guardar en lo que ha llegado')
    }

    /**
     * EL ORIGEN SE VALIDA AQUÍ Y NO SE DEJA CAER EN LA BASE.
     *
     * El CHECK de la columna lo para igual, pero contestando un 23514 con el
     * texto de Postgres dentro, que no dice cuáles son los orígenes válidos. Y
     * hay uno que engaña: 'imap' SÍ existe como conector —es quien hace el
     * trabajo cuando el buzón elegido no es de Google— pero NO es una opción que
     * nadie deba elegir, porque desde la 198 el correo es un solo origen y el
     * buzón decide por dentro cómo se entra. Ver el comentario de `conectores()`.
     */
    if (typeof patch.origen === 'string' && !esOrigenElegible(patch.origen)) {
      return fail(
        400,
        `«${patch.origen}» no es un origen que se pueda elegir. Vuelve a elegirlo en la pantalla: ` +
          'el correo es uno solo y es el buzón el que decide cómo se entra en él.'
      )
    }

    /**
     * TOCAR EL PERFIL BORRA LA HUELLA DEL ÚLTIMO FICHERO PROCESADO.
     *
     * El ciclo se salta el fichero cuyo contenido ya procesó. Eso es lo que hace
     * que no repita trabajo, y es también lo que haría que un cambio en el perfil
     * no surtiera efecto hasta que el cliente publicara un fichero nuevo, que
     * puede ser mañana. Los dos casos en los que eso duele de verdad:
     *
     *   - Se ENCIENDE el envío automático. El ciclo ya había leído el fichero de
     *     hoy en modo simulacro y lo daría por hecho: no se mandaría nada, y sin
     *     ninguna pista de por qué.
     *   - Se ARREGLA el nombre de una columna después de un fallo de lectura. La
     *     huella de ese fichero quedó apuntada justamente para no releerlo cada
     *     cuarto de hora, así que la corrección no se probaría nunca.
     *
     * Se borra en CUALQUIER cambio y no solo en esos dos: una regla con
     * excepciones que hay que recordar es una regla que un día no se cumple, y
     * el coste de equivocarse por exceso es un reproceso de más.
     *
     * Va DESPUÉS de filtrarCampos y no dentro de la lista blanca a propósito:
     * esta columna la escribe el servidor cuando toca, nunca el cuerpo de una
     * petición del navegador.
     */
    patch.last_file_fingerprint = null

    // Se lee ANTES de escribir: hace falta el destino anterior para saber si se
    // ha movido. Ver moverElDestinoBorraLaCredencial().
    const antes = await loadPerfil(params.id)
    if (!antes) return fail(404, 'Ese perfil ya no existe')

    /**
     * ¿Está la 198 lanzada? Se mira en la FILA y no con una consulta al catálogo
     * de Postgres, igual que `faltaMigracionNoSincroniza` en perfiles.ts: el
     * `select('*')` trae las columnas que existan, así que si la clave no está es
     * que la migración no se ha pegado todavía en el editor SQL de Supabase.
     *
     * Sin esto, escribir `buzon_id` contra una tabla que no lo tiene contesta
     * «Could not find the 'buzon_id' column of 'stock_read_profiles' in the
     * schema cache», que no le dice a nadie qué fichero hay que lanzar.
     */
    const hayColumnaBuzon = 'buzon_id' in (antes as object)

    /**
     * ============ EL GUARDIA DEL DUEÑO ============
     *
     * Este es el paso que impide que el perfil del cliente B lea del buzón del
     * cliente A. Cruzar datos entre clientes es lo que este proyecto tiene
     * firmado con Amazon que no hace, y aquí NO HAY NINGÚN SÍNTOMA cuando sale
     * mal: el perfil leería el correo del otro, encontraría un fichero de stock
     * con buena pinta y lo publicaría en la cuenta de Amazon equivocada sin un
     * solo error en ninguna pantalla.
     *
     * VA ANTES DE ESCRIBIR NADA, y con el `client_id` DE LA FILA GUARDADA
     * (`antes`) y no con uno que venga en el cuerpo: `client_id` no está en la
     * lista blanca justamente para que no se pueda mover, así que el de la fila
     * es el único que no se puede falsear desde el navegador.
     *
     * El trigger de la 198 comprueba lo mismo desde la base y sigue ahí: es el
     * candado que aguanta cuando alguien escribe desde el editor SQL de
     * Supabase. Este de aquí existe para poder contestar con una frase que se
     * entienda en vez de con un error de Postgres.
     */
    if (traeBuzon) {
      if (!hayColumnaBuzon) {
        return fail(
          400,
          'Falta lanzar 198_buzones_correo.sql en el editor SQL de Supabase: sin esa columna el ' +
            'perfil no tiene dónde apuntar de qué buzón lee.'
        )
      }
      const motivo = await buzonElegibleParaPerfil(buzonPedido as string | null, antes.client_id)
      if (motivo) return fail(400, motivo)
      patch.buzon_id = buzonPedido as string | null
    }

    /**
     * SI EL ORIGEN DEJA DE SER 'correo', EL BUZÓN SE SUELTA.
     *
     * Un perfil que ahora lee de un SFTP no usa ningún buzón, pero el puntero se
     * quedaría escrito, y ese puntero es lo que cuenta `perfilesQueUsan()` para
     * negarse a borrar un buzón. O sea: un buzón que ya no usa nadie no se podría
     * borrar, y la pantalla diría que lo está usando un perfil que lee por SFTP.
     * Imposible de entender, y solo se arregla mirando la tabla a mano.
     *
     * Va DESPUÉS del guardia a propósito: si en el mismo PATCH cambian el origen
     * y eligen buzón, manda el origen. Elegir buzón para un perfil que en ese
     * mismo guardado deja de leer correo no significa nada.
     *
     * Y solo se escribe cuando el correo pinta algo —el perfil venía de correo o
     * el cuerpo trae buzón—, nunca «por si acaso» en cualquier guardado: meter
     * esta columna en TODOS los PATCH rompería el guardado de cualquier perfil
     * mientras la 198 no esté lanzada, que es justo lo contrario de lo que se
     * quiere.
     */
    const origenFinal = typeof patch.origen === 'string' ? patch.origen : antes.origen
    if (origenFinal !== 'correo' && hayColumnaBuzon && (antes.origen === 'correo' || traeBuzon)) {
      patch.buzon_id = null
    }

    const perfil = await actualizarPerfil(params.id, patch)
    if (!perfil) return fail(404, 'Ese perfil ya no existe')

    if (moverElDestinoBorraLaCredencial(antes, perfil)) await borrarCredencial(params.id)

    const data = await loadPerfiles()
    return NextResponse.json(data)
  } catch (error) {
    const traducido = traducirCheck(error)
    if (traducido) return fail(400, traducido)
    if ((error as { code?: string })?.code === '23505') {
      return fail(409, 'Ese cliente ya tiene otro perfil con ese nombre. Ponle otro')
    }
    return errorResponse(error, 'Error guardando un perfil de lectura')
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session

    if (!UUID.test(params.id)) return fail(400, 'Ese perfil no existe')

    const borrado = await borrarPerfil(params.id)
    if (!borrado) return fail(404, 'Ese perfil ya no existe')

    const data = await loadPerfiles()
    return NextResponse.json(data)
  } catch (error) {
    return errorResponse(error, 'Error borrando un perfil de lectura')
  }
}

/** «Ha llegado algo en `buzon_id` que no es ni un buzón ni un vacío» */
const INVALIDO = Symbol('buzón que no se entiende')

/**
 * El buzón que pide el cuerpo, o null si es «ninguno».
 *
 * Vacío, null y ausente son TODOS null y significan lo mismo: volver a la cuenta
 * de siempre del ERP. El desplegable manda cadena vacía cuando se elige la
 * opción «Ninguno», y tratarla como un id haría que el guardia buscara un buzón
 * llamado «» y contestara «ese buzón ya no existe» a algo que es correcto.
 *
 * Lo que NO se deja pasar es cualquier otra cosa. El valor se escribe en una
 * clave ajena, así que un número o un objeto acabarían en un error de Postgres
 * en crudo; y comprobar la forma de UUID aquí evita además gastar una consulta
 * al catálogo de buzones con algo que no puede ser un id.
 */
function normalizarBuzon(v: unknown): string | null | typeof INVALIDO {
  if (v === null || v === undefined) return null
  if (typeof v !== 'string') return INVALIDO
  const t = v.trim()
  if (t === '') return null
  return UUID.test(t) ? t : INVALIDO
}

/**
 * MOVER EL DESTINO DE UN PERFIL BORRA SU CREDENCIAL GUARDADA.
 *
 * La contraseña que un cliente nos confía es de un servidor, un puerto y un
 * usuario CONCRETOS: en cuanto cualquiera de los tres cambia, esa contraseña ya
 * no vale para el sitio nuevo, y seguir guardándola solo sirve para que un día
 * viaje a un servidor que no es el suyo. credenciales.ts promete que una
 * credencial guardada no se puede volver a ver, solo sustituir; esto es lo que
 * impide sortear esa promesa cambiando el servidor del perfil y pulsando
 * «Conectar».
 *
 * Se borra también al cambiar de origen: la contraseña de un SFTP no significa
 * nada en un perfil que ahora lee de Drive.
 *
 * Qué campos son «el destino» lo dice cada conector en `clavesDestino`, no esta
 * ruta: aquí no se sabe —ni hace falta saber— qué es un host.
 */
function moverElDestinoBorraLaCredencial(
  antes: { origen: string; origen_config: unknown },
  despues: { origen: string; origen_config: unknown }
): boolean {
  if (antes.origen !== despues.origen) return true

  const conector = conectorDe(despues.origen as Parameters<typeof conectorDe>[0])
  if (!conector.secreto) return false

  const a = (antes.origen_config ?? {}) as Record<string, unknown>
  const b = (despues.origen_config ?? {}) as Record<string, unknown>
  return (conector.clavesDestino ?? []).some((clave) => texto(a[clave]) !== texto(b[clave]))
}

/** El mismo criterio de comparación que usa la ruta del explorador */
function texto(v: unknown): string {
  if (typeof v === 'string') return v.trim()
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return ''
}

/**
 * Traduce los CHECK de la migración 120 a la frase que explica qué falta.
 *
 * Sin esto, guardar un perfil con «manda precio» encendido y sin decir de dónde
 * sacarlo contesta «new row for relation "stock_read_profiles" violates check
 * constraint "stock_read_profiles_precio_ok"», que obliga a abrir el SQL para
 * saber qué campo hay que rellenar.
 */
const CHECKS: Record<string, string> = {
  stock_read_profiles_columnas_ok:
    'Un perfil de stock necesita al menos un nombre de columna para la referencia y otro para las unidades; uno de códigos de barras, para la referencia y el código.',
  stock_read_profiles_margen_ok:
    'Has elegido calcular el precio por margen y no has puesto el porcentaje de margen.',
  stock_read_profiles_precio_columna_ok:
    'Has elegido sacar el precio de una columna y no has dicho cómo se llama esa columna.',
  stock_read_profiles_coste_ok:
    'Para calcular el precio por margen hace falta la columna del coste, que es de donde sale.',
  stock_read_profiles_precio_ok:
    'Has encendido «mandar precio» sin decir de dónde sale. Elige la columna o el margen: mandar precio sin saber de dónde sacarlo es lo que acaba publicando 0,00 €.',
  stock_read_profiles_rango_precio_ok:
    'El precio mínimo es mayor que el máximo: con ese rango se descartaría el catálogo entero sin decir por qué.',
  stock_read_profiles_destino_ok:
    'Para encender el envío automático hay que decir antes a qué cuenta de Amazon se manda.',
  stock_read_profiles_caida_unidades_ok:
    'El límite de caída de unidades tiene que ser un porcentaje entre 0 y 100.',
  stock_read_profiles_frenos_ok:
    'No se puede encender el envío automático con frenos sin poner. Hacen falta los cinco límites ' +
    '(referencias a cero, variación de precio, caída de líneas, caída de unidades y máximo de cambios) ' +
    'y las líneas que trae el fichero un día normal. Ese último número se rellena con una ejecución ' +
    'en simulacro que hayas dado por buena: sin él, el freno que detecta un volcado a medias está ' +
    'declarado pero no puede saltar.',

  /**
   * ============ Y LOS DOS TRIGGERS DE LA 198, QUE NO SON CHECK ============
   *
   * Lanzan a mano con `USING ERRCODE = 'check_violation'`, o sea el mismo 23514,
   * y eso está hecho a propósito: así caen por este mismo embudo en vez de salir
   * como un 500 sin explicación.
   *
   * La diferencia es que un CHECK trae su nombre en el mensaje y un trigger trae
   * su texto, así que la clave de aquí abajo es un TROZO DE LA FRASE. Va sin
   * tildes porque el SQL de las migraciones se escribe sin ellas —el fichero
   * viaja pegado en el editor de Supabase— y `includes` no normaliza nada: con
   * tilde no encajaría y el usuario vería el genérico.
   *
   * El texto que se enseña sí va con tildes y coincide, palabra por palabra, con
   * el que da `buzonElegibleParaPerfil()` antes de escribir. Que digan lo mismo
   * no es redundante: el guardia de la ruta es el que se ve casi siempre, y este
   * es el que aparece cuando el cambio entra por otro sitio.
   */
  'Ese buzon es de otro cliente':
    'Ese buzón es de otro cliente y este perfil no puede usarlo. Un buzón con dueño solo lo pueden ' +
    'elegir los perfiles de ese cliente; si es compartido, quítale el dueño en Amazon API › Buzones.',
  'No se le puede poner dueno a este buzon':
    'No se le puede poner dueño a ese buzón: lo están usando perfiles de otros clientes. Cámbialos ' +
    'de buzón primero y vuelve a intentarlo.',
}

function traducirCheck(error: unknown): string | null {
  const e = error as { code?: string; message?: string } | null
  if (e?.code !== '23514') return null
  for (const [nombre, frase] of Object.entries(CHECKS)) {
    if (e.message?.includes(nombre)) return frase
  }
  return 'Ese cambio deja el perfil en un estado que no se puede guardar. Repasa los campos obligatorios.'
}
