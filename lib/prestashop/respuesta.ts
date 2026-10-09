/**
 * LEER LO QUE CONTESTA EL WEBSERVICE DE PRESTASHOP.
 * ================================================
 * PURA: recibe lo que ya ha contestado la tienda, no llama a nadie. Se prueba en
 * lib/prestashop/prestashop.prueba.ts.
 *
 * Existe aparte porque aquí se decide qué quiere decir cada respuesta, y es lo
 * único que se puede comprobar sin una tienda delante.
 *
 * LO QUE SE SABE Y LO QUE NO
 * --------------------------
 * Los nombres de los recursos (`stock_availables`, `combinations`, `products`) y
 * los parámetros (`display`, `limit`, `output_format=JSON`) son los del
 * Webservice de PrestaShop 1.7. NO se han probado contra la tienda de ShoesF. La
 * forma exacta del JSON que devuelve la raíz de `/api/` en cada versión es lo más
 * dudoso, y por eso `recursosPermitidos` es deliberadamente tolerante.
 */

/** Los tres recursos que hacen falta para leer el stock por talla */
export const RECURSOS_NECESARIOS = ['stock_availables', 'combinations', 'products'] as const

/** Recursos que dan acceso a datos personales de los clientes de la tienda */
export const RECURSOS_PERSONALES = [
  'customers',
  'addresses',
  'orders',
  'order_details',
  'order_payments',
  'carts',
  'customer_threads',
  'customer_messages',
  'guests',
] as const

/**
 * Qué recursos puede leer esta clave, según lo que contesta la raíz de /api/.
 *
 * Con `output_format=JSON` la raíz devuelve un objeto cuyas claves son los
 * recursos, a veces dentro de un `api`. La raíz SOLO lista los recursos a los que
 * la clave tiene algún permiso, así que basta con leer los nombres.
 */
export function recursosPermitidos(json: unknown): string[] {
  if (json === null || typeof json !== 'object') return []
  const obj = json as Record<string, unknown>
  const raiz =
    obj.api !== null && typeof obj.api === 'object' ? (obj.api as Record<string, unknown>) : obj
  return Object.keys(raiz).filter((k) => !k.startsWith('@') && !k.startsWith('_'))
}

/**
 * Saca la lista de filas de una respuesta tipo `{ "stock_availables": [ {...} ] }`.
 * Una lista vacía llega a veces como `[]` y a veces como `{}`.
 */
export function extraerLista(json: unknown, recurso: string): Record<string, unknown>[] {
  if (json === null || typeof json !== 'object') return []
  const valor = (json as Record<string, unknown>)[recurso]
  if (Array.isArray(valor)) {
    return valor.filter((f): f is Record<string, unknown> => f !== null && typeof f === 'object')
  }
  return []
}

/** ¿Es un EAN/UPC creíble? Solo dígitos, 8 a 14 */
export function eanValido(valor: unknown): valor is string {
  return typeof valor === 'string' && /^\d{8,14}$/.test(valor.trim())
}

/** Cuántas de estas filas tienen un EAN usable. Para decir «el 93 %» y no «algunas» */
export function resumenEan(filas: Record<string, unknown>[]): { total: number; conEan: number } {
  return { total: filas.length, conEan: filas.filter((f) => eanValido(f.ean13)).length }
}

/** Entero de una cantidad que PrestaShop manda como cadena. null = no es un número */
export function cantidadDe(valor: unknown): number | null {
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null
  if (typeof valor !== 'string' || valor.trim() === '') return null
  const n = Number(valor)
  return Number.isFinite(n) ? n : null
}

/**
 * Qué decirle a una persona cuando la tienda contesta mal.
 *
 * Cada caso es uno que ocurre de verdad al configurar un Webservice de PrestaShop,
 * y el mensaje dice QUÉ HACER, no solo qué pasó.
 */
export function mensajeDeEstado(status: number, cuerpo: string, redireccion?: string | null): string {
  if (status >= 300 && status < 400) {
    return redireccion
      ? `La tienda redirige a ${redireccion}. Usa esa dirección tal cual en lugar de la que has puesto.`
      : 'La tienda redirige a otra dirección. Prueba con la dirección final, con o sin «www».'
  }
  if (status === 401) {
    return 'La tienda no reconoce la clave. Comprueba que está bien copiada y que la clave está habilitada en Webservice.'
  }
  if (status === 403) {
    return 'La clave no tiene permiso para esto. Revisa los permisos de la clave en Webservice.'
  }
  if (status === 404) {
    return (
      'No se encuentra la API en esa dirección. Comprueba que es la dirección pública de la tienda ' +
      '—no la del panel de administración— y que el Webservice está activado.'
    )
  }
  if (status === 503 || /webservice.*disabled|service.*disabled/i.test(cuerpo)) {
    return 'El Webservice de la tienda está desactivado. Se activa en Parámetros avanzados → Webservice.'
  }
  if (status === 429) return 'La tienda está limitando las peticiones. Vuelve a probar en unos minutos.'
  if (status >= 500) return `La tienda ha contestado con un error de servidor (${status}).`
  return `La tienda ha contestado ${status}.`
}

/** ¿Lo que ha vuelto es una página web en vez de la API? Pasa con tiendas que redirigen todo a la portada */
export function pareceHtml(cuerpo: string): boolean {
  return /^\s*<(!doctype|html)/i.test(cuerpo)
}

/**
 * EL VEREDICTO DE LAS SONDAS: ¿puede esta clave leer cada recurso que hace falta?
 *
 * Se mira DIRECTAMENTE, pidiendo una fila de cada recurso, y no leyendo la lista
 * de permisos que devuelve la raíz de /api/. Esa lista es lo que primero se usó
 * y falló en la primera prueba real: la tienda contestó que reconocía la clave,
 * la lectura de la lista no encontró ni un recurso conocido, y la pantalla dijo
 * que faltaban los tres permisos cuando casi seguro no era verdad. La forma
 * exacta de ese JSON es lo único que no se pudo comprobar sin una clave delante.
 *
 * Preguntar por la cosa en sí no depende de ninguna forma de JSON: o contesta 200
 * o no.
 *
 * Con la clave ya reconocida, un 401 o un 403 sobre un recurso concreto significa
 * «esta clave no puede leer esto»: PrestaShop contesta 401 con «Resource of type
 * X is not allowed with this authentication key».
 */
export interface Sonda {
  nombre: string
  status: number
}

export function veredictoSondas(sondas: Sonda[]): {
  permitidos: string[]
  sinPermiso: string[]
  conError: { nombre: string; status: number }[]
} {
  const permitidos: string[] = []
  const sinPermiso: string[] = []
  const conError: { nombre: string; status: number }[] = []
  for (const s of sondas) {
    if (s.status === 200) permitidos.push(s.nombre)
    else if (s.status === 401 || s.status === 403) sinPermiso.push(s.nombre)
    else conError.push({ nombre: s.nombre, status: s.status })
  }
  return { permitidos, sinPermiso, conError }
}
