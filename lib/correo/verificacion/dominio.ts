/**
 * ¿EL DOMINIO DE UNA DIRECCIÓN EXISTE Y RECIBE CORREO? — SOLO SERVIDOR (usa el DNS).
 * ==================================================================================
 * Se comprueba con verificar.prueba.ts, con un resolvedor de mentira: no sale a internet.
 *
 * Un dominio recibe correo si tiene registros MX (los servidores a los que hay que entregar). Sin MX, la norma dice que se prueba con la dirección
 * del propio dominio (registro A o AAAA); y un MX «nulo» (un solo punto, RFC 7505) es la forma de decir «aquí no se recibe correo». Si ni siquiera existe
 * el dominio, cualquier correo a él rebota.
 *
 * LO QUE NO SE PUEDE SABER AQUÍ es si EXISTE ESE BUZÓN concreto en un dominio que sí recibe correo: eso solo lo dice el servidor al intentar entregar
 * (y el ERP aprende de ese rebote, ver la memoria de direcciones malas). Tampoco se «llama» al servidor de correo para preguntarle: casi todos
 * contestan lo mismo a todo para no regalar listas de direcciones, y probar desde el servidor del ERP perjudicaría su reputación.
 *
 * UN FALLO DEL DNS NO BLOQUEA NADA. Si el resolvedor no contesta a tiempo, el estado es `sin_comprobar` y la dirección se da por buena en este
 * punto: preferir un correo de más a uno de menos por un cortecito de red. Los resultados se recuerdan un rato para no preguntar mil veces lo mismo.
 */

export type EstadoDeDominio = 'ok' | 'sin_correo' | 'no_existe' | 'sin_comprobar'

export interface ResultadoDeDominio {
  estado: EstadoDeDominio
  /** Los servidores de correo del dominio (vacío si no se sabe) */
  servidores: string[]
  detalle: string
}

export interface ResolvedorDeDominio {
  resolverMx(dominio: string): Promise<Array<{ exchange: string; priority: number }>>
  resolverDirecciones(dominio: string): Promise<string[]>
}

export interface OpcionesDeDominio {
  /** Cuánto se espera a una respuesta del DNS */
  tiempoMs?: number
  ahora?: () => number
  /** Memoria de resultados; por defecto la del proceso */
  memoria?: Map<string, { hasta: number; resultado: ResultadoDeDominio }>
}

const memoriaDelProceso = new Map<string, { hasta: number; resultado: ResultadoDeDominio }>()
const MAXIMO_EN_MEMORIA = 5000
const VIDA_BUENO_MS = 12 * 3_600_000
const VIDA_MALO_MS = 30 * 60_000
const VIDA_DUDOSO_MS = 60_000

const CODIGOS_DE_NO_EXISTE = new Set(['ENOTFOUND', 'NXDOMAIN'])
const CODIGOS_DE_SIN_DATOS = new Set(['ENODATA', 'NODATA'])

function conTiempo<T>(promesa: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolver, rechazar) => {
    const reloj = setTimeout(() => rechazar(Object.assign(new Error('tiempo'), { code: 'ETIMEOUT' })), ms)
    promesa.then(
      (v) => {
        clearTimeout(reloj)
        resolver(v)
      },
      (e) => {
        clearTimeout(reloj)
        rechazar(e)
      }
    )
  })
}

const codigoDe = (e: unknown): string => String((e as { code?: unknown } | null)?.code ?? '').toUpperCase()

export async function comprobarDominio(dominio: string, resolvedor: ResolvedorDeDominio, opciones: OpcionesDeDominio = {}): Promise<ResultadoDeDominio> {
  const ahora = (opciones.ahora ?? Date.now)()
  const memoria = opciones.memoria ?? memoriaDelProceso
  const d = dominio.trim().toLowerCase()
  const recordado = memoria.get(d)
  if (recordado && recordado.hasta > ahora) return recordado.resultado

  const tiempo = opciones.tiempoMs ?? 4000
  const recordar = (resultado: ResultadoDeDominio, vida: number): ResultadoDeDominio => {
    if (memoria.size >= MAXIMO_EN_MEMORIA) memoria.clear()
    memoria.set(d, { hasta: ahora + vida, resultado })
    return resultado
  }

  try {
    const mx = await conTiempo(resolvedor.resolverMx(d), tiempo)
    const utiles = mx.filter((m) => m.exchange && m.exchange !== '.').sort((a, b) => a.priority - b.priority)
    if (utiles.length > 0) return recordar({ estado: 'ok', servidores: utiles.map((m) => m.exchange.toLowerCase()), detalle: 'El dominio recibe correo.' }, VIDA_BUENO_MS)
    // Hay registros MX pero todos «nulos»: el dominio dice expresamente que no recibe correo
    if (mx.length > 0) return recordar({ estado: 'sin_correo', servidores: [], detalle: 'El dominio indica que no recibe correo.' }, VIDA_MALO_MS)
  } catch (e) {
    const codigo = codigoDe(e)
    if (CODIGOS_DE_NO_EXISTE.has(codigo)) return recordar({ estado: 'no_existe', servidores: [], detalle: 'El dominio no existe.' }, VIDA_MALO_MS)
    if (!CODIGOS_DE_SIN_DATOS.has(codigo)) return recordar({ estado: 'sin_comprobar', servidores: [], detalle: 'No se ha podido comprobar el dominio ahora mismo.' }, VIDA_DUDOSO_MS)
  }

  // Sin registros MX: el correo se entregaría a la dirección del propio dominio, si la tiene
  try {
    const direcciones = await conTiempo(resolvedor.resolverDirecciones(d), tiempo)
    if (direcciones.length > 0) return recordar({ estado: 'ok', servidores: [], detalle: 'El dominio no declara servidores de correo, pero existe.' }, VIDA_BUENO_MS)
    return recordar({ estado: 'sin_correo', servidores: [], detalle: 'El dominio existe pero no recibe correo.' }, VIDA_MALO_MS)
  } catch (e) {
    const codigo = codigoDe(e)
    if (CODIGOS_DE_NO_EXISTE.has(codigo) || CODIGOS_DE_SIN_DATOS.has(codigo)) {
      return recordar({ estado: CODIGOS_DE_NO_EXISTE.has(codigo) ? 'no_existe' : 'sin_correo', servidores: [], detalle: CODIGOS_DE_NO_EXISTE.has(codigo) ? 'El dominio no existe.' : 'El dominio existe pero no recibe correo.' }, VIDA_MALO_MS)
    }
    return recordar({ estado: 'sin_comprobar', servidores: [], detalle: 'No se ha podido comprobar el dominio ahora mismo.' }, VIDA_DUDOSO_MS)
  }
}

/** Para las pruebas */
export function olvidarDominios(): void {
  memoriaDelProceso.clear()
}
