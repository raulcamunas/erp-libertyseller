/**
 * EL CLIENTE DE GROWTH PARTNER — UNA SOLA IDENTIDAD PARA TODOS LOS SUBMÓDULOS.
 * SOLO SERVIDOR: importa el cliente de service_role.
 *
 *
 * ============ EL PROBLEMA QUE RESUELVE ESTE FICHERO ============
 *
 * En la base de datos hay DOS tablas de clientes, y no es un despiste: nacieron
 * con seis meses de diferencia y con dueños distintos.
 *
 *   · `stock_clients`  (migración 106) — los que mandan volcado de stock.
 *   · `amazon_clients` (migración 118) — los que han autorizado su cuenta de
 *                                        Amazon.
 *
 * No hay ninguna clave ajena entre ellas. Lo único que comparten es la forma del
 * `slug`, y eso ES a propósito: la 118 dice literalmente «misma forma que
 * stock_clients.slug». Ese slug es el puente y es lo que se usa aquí.
 *
 * Growth Partner tiene UN selector de cliente arriba, común a todos sus
 * submódulos, porque es lo que se pidió: «lo dividimos dentro de cada módulo qué
 * cliente manejamos». Sin este cruce, ese selector sería mentira: elegirías un
 * cliente arriba y el submódulo de sincronismo estaría enseñando otro.
 *
 *
 * ============ TRES CASOS, Y LOS TRES SON NORMALES ============
 *
 *   1. Está en las dos → el caso completo. Todos los submódulos funcionan.
 *   2. Solo en Amazon → tiene cuenta conectada pero no manda volcado. Es lo
 *      normal en un cliente de marca propia, y no es un error: Buy Box y FBM→FBA
 *      funcionan; sincronismo de stock, no.
 *   3. Solo en sincronismo → nos manda su stock pero todavía no ha autorizado su
 *      cuenta. Es el estado de las primeras semanas de un cliente nuevo.
 *
 * NO SE INVENTA NINGUNA FILA. Este fichero solo LEE y cruza; si a un cliente le
 * falta un lado, se dice y se sigue. Crear la fila que falta es una decisión de
 * negocio con consecuencias —a quién se le pide el fichero, a quién se le manda
 * el enlace de autorización— y no la toma un cruce de slugs.
 *
 *
 * ============ CUMPLIMIENTO ANTE AMAZON ============
 *
 * Esto devuelve una LISTA DE NOMBRES para poder elegir uno. No devuelve ni un
 * dato de negocio de ningún cliente: ni precios, ni catálogo, ni métricas. Los
 * datos de un vendedor se usan exclusivamente para operar SU cuenta, así que todo
 * lo que cuelgue del cliente elegido se pide después, ya filtrado por él.
 */

import { createServiceClient } from '@/lib/supabase/service'
import { isMissingSchema } from '@/lib/plataforma/eventos'
import { MODULOS, type ModuloId } from '@/components/growth/modulos'

/** El cliente tal y como lo ve Growth Partner: un nombre y las dos llaves */
export interface ClienteGrowth {
  /** El identificador de la URL. Es el slug, que es lo único común a las dos tablas */
  slug: string
  nombre: string
  /** Su fila en `amazon_clients`. null = todavía no ha autorizado su cuenta */
  amazonClientId: string | null
  /** Su fila en `stock_clients`. null = no manda volcado de stock */
  stockClientId: string | null
  /** Activo en alguno de los dos lados. Los inactivos se enseñan al final */
  activo: boolean
}

interface FilaCliente {
  id: string
  name: string
  slug: string
  is_active: boolean
  position: number | null
}

/**
 * Lee una de las dos tablas de clientes.
 *
 * Que la tabla no exista NO es un error que pare la pantalla: las migraciones se
 * lanzan a mano en el editor SQL de Supabase, así que el código puede llegar
 * desplegado antes que ellas. Un submódulo sin sus tablas se queda sin su mitad
 * de la lista y lo dice; los otros siguen funcionando.
 */
async function leerTabla(tabla: 'amazon_clients' | 'stock_clients'): Promise<FilaCliente[]> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from(tabla)
    .select('id, name, slug, is_active, position')
    .order('position', { ascending: true, nullsFirst: false })
    .order('name')

  if (error) {
    if (isMissingSchema(error)) return []
    console.error(`Growth Partner: no se ha podido leer ${tabla}:`, error)
    return []
  }
  return (data ?? []) as FilaCliente[]
}

/**
 * LA LISTA DE CLIENTES DEL MÓDULO, ya cruzada.
 *
 * Orden: primero los activos y después los que no, y dentro de cada grupo por
 * nombre. Alfabético y no por ninguna métrica: un orden por facturación o por
 * incidencias sería un ranking entre clientes, y eso es justo lo que el
 * compromiso con Amazon no permite hacer con sus datos.
 */
export async function clientesGrowth(): Promise<ClienteGrowth[]> {
  const [amazon, stock] = await Promise.all([
    leerTabla('amazon_clients'),
    leerTabla('stock_clients'),
  ])

  const porSlug = new Map<string, ClienteGrowth>()

  const juntar = (fila: FilaCliente, lado: 'amazon' | 'stock') => {
    const previo = porSlug.get(fila.slug)
    if (!previo) {
      porSlug.set(fila.slug, {
        slug: fila.slug,
        nombre: fila.name,
        amazonClientId: lado === 'amazon' ? fila.id : null,
        stockClientId: lado === 'stock' ? fila.id : null,
        activo: fila.is_active,
      })
      return
    }
    if (lado === 'amazon') previo.amazonClientId = fila.id
    else previo.stockClientId = fila.id
    // Activo en cualquiera de los dos lados cuenta como activo: un cliente que
    // ya no manda volcado pero sigue con su cuenta conectada no está de baja.
    previo.activo = previo.activo || fila.is_active
  }

  // Amazon primero, para que su forma de escribir el nombre sea la que se enseña
  // cuando las dos tablas discrepan: es la que se corresponde con la cuenta real.
  amazon.forEach((f) => juntar(f, 'amazon'))
  stock.forEach((f) => juntar(f, 'stock'))

  return [...porSlug.values()].sort(
    (a, b) => Number(b.activo) - Number(a.activo) || a.nombre.localeCompare(b.nombre, 'es')
  )
}

/**
 * Traduce lo que venga en la URL a un cliente real.
 *
 * Devuelve `null` cuando no hay ni un cliente dado de alta, que es un estado de
 * verdad —el ERP recién instalado— y no un error. Un slug que ya no existe
 * —porque se dio de baja, o porque el enlace es viejo— cae en un cliente de la
 * lista en vez de dejar la pantalla en blanco.
 *
 * CUANDO NO SE PIDE CLIENTE, se prefiere uno que TENGA el lado que el submódulo
 * necesita. El caso real: quien sube el stock los martes tiene en marcadores
 * /dashboard/stock-sync, que redirige aquí SIN cliente; cogiendo el primero
 * alfabético caía en «Liberty Seller (cuenta propia)», que no manda volcado, y
 * lo primero que veía era «este cliente no manda volcado de stock» en vez de su
 * tablero. Con 16 cuentas y dos tablas sin clave ajena, que el primero de la
 * lista no tenga el lado que hace falta es lo normal, no lo raro.
 *
 * Si NINGUNO lo tiene, se devuelve el primero igual: la pantalla de ese submódulo
 * ya sabe explicar que a este cliente le falta ese lado, y es mejor eso que una
 * lista vacía.
 */
export function elegirCliente(
  clientes: ClienteGrowth[],
  slug: string | null | undefined,
  modulo?: ModuloId
): ClienteGrowth | null {
  if (clientes.length === 0) return null
  if (slug) {
    const encontrado = clientes.find((c) => c.slug === slug)
    if (encontrado) return encontrado
  }

  if (modulo) {
    const necesita = MODULOS.find((m) => m.id === modulo)?.necesita
    const compatible = clientes.find((c) =>
      necesita === 'stock' ? c.stockClientId !== null : c.amazonClientId !== null
    )
    if (compatible) return compatible
  }

  return clientes[0]
}
