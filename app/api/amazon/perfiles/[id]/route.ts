import { NextResponse, type NextRequest } from 'next/server'
import { UUID, errorResponse, fail, requireAmazonAdmin } from '@/lib/amazon/api'
import { actualizarPerfil, borrarPerfil, filtrarCampos, loadPerfiles } from '@/lib/stock-sync/perfiles'

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

    const patch = filtrarCampos(body)
    if (Object.keys(patch).length === 0) {
      return fail(400, 'No hay ningún campo que se pueda guardar en lo que ha llegado')
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

    const perfil = await actualizarPerfil(params.id, patch)
    if (!perfil) return fail(404, 'Ese perfil ya no existe')

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
}

function traducirCheck(error: unknown): string | null {
  const e = error as { code?: string; message?: string } | null
  if (e?.code !== '23514') return null
  for (const [nombre, frase] of Object.entries(CHECKS)) {
    if (e.message?.includes(nombre)) return frase
  }
  return 'Ese cambio deja el perfil en un estado que no se puede guardar. Repasa los campos obligatorios.'
}
