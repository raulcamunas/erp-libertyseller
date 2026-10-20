/**
 * UN FRENO PARA LAS RUTAS QUE NO PIDEN SESIÓN.
 * ===========================================
 * Cuenta las peticiones de cada clave —aquí, la IP y el enlace— en una ventana de tiempo y dice cuándo
 * se pasan. En memoria y por proceso: no es un cortafuegos, es lo que frena a un bucle descontrolado
 * (una pestaña que reintenta sin parar, un script) sin montar nada más. El enlace del encaje tiene 256
 * bits de azar, así que adivinarlo no es un riesgo; lo que se vigila es el abuso de uno que ya existe.
 *
 * NO ES COMPARTIDO ENTRE INSTANCIAS: si algún día hay dos contenedores, cada uno cuenta lo suyo y el
 * tope real es el doble. Para lo que se pide aquí —que un cliente que teclea no vea un 429 y que un
 * bucle sí— da igual.
 */

const ventanas = new Map<string, number[]>()
const MAX_CLAVES = 10_000

export interface ResultadoDeLimite {
  ok: boolean
  /** Cuántos segundos hay que esperar para volver a probar. 0 si ok */
  reintentarEnS: number
}

export function limitar(clave: string, max: number, ventanaMs = 60_000, ahora = Date.now()): ResultadoDeLimite {
  const desde = ahora - ventanaMs
  const marcas = (ventanas.get(clave) ?? []).filter((t) => t > desde)
  if (marcas.length >= max) {
    ventanas.set(clave, marcas)
    return { ok: false, reintentarEnS: Math.max(1, Math.ceil((marcas[0] + ventanaMs - ahora) / 1000)) }
  }
  marcas.push(ahora)
  ventanas.set(clave, marcas)
  // Que el mapa no crezca sin fin con IPs que no vuelven
  if (ventanas.size > MAX_CLAVES) {
    for (const [k, v] of ventanas) if (v.length === 0 || v[v.length - 1] <= desde) ventanas.delete(k)
  }
  return { ok: true, reintentarEnS: 0 }
}

/** Para las pruebas */
export function reiniciarLimites(): void {
  ventanas.clear()
}

/** La IP de quien llama: la que pone el proxy, o «desconocida». Solo sirve de clave para contar, no para decidir nada */
export function ipDe(request: Request): string {
  const primera = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return primera || request.headers.get('x-real-ip')?.trim() || 'desconocida'
}
