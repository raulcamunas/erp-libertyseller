import 'server-only'
import {
  cuentaDeRespuesta,
  cuerpoDeOF24,
  importacionDeRespuesta,
  ofertaDeRespuesta,
  productoDeRespuesta,
  type CuentaPcc,
  type ImportacionPcc,
  type OfertaParaSubir,
  type OfertaPcc,
  type ProductoPcc,
} from './datos'
import { FRASE_DE_CONFIRMACION } from './frase'

/**
 * PCCOMPONENTES · LA API DE MIRAKL — SOLO SERVIDOR.
 * =================================================
 * PcComponentes vende sobre Mirakl: cada vendedor tiene una clave de API en su cuenta (Ajustes personales → pestaña «API key») que se manda tal cual en la
 * cabecera `Authorization` (sin «Bearer»). La clave de Entrais está en la variable ENTRAIS_PCCOMPONENTES y NO sale de aquí: ni en un mensaje de error, ni
 * en un registro, ni hacia el navegador.
 *
 *   LEE       cuenta (A01), ofertas propias (OF21), ofertas de un producto por EAN (P11), estado y errores de una importación (OF02, OF03).
 *   ESCRIBE   solo `subirOfertas` (OF24). Es lo único que cambia algo en la tienda, y por eso es la única función que pide una frase de confirmación a
 *             quien la llama (ver `FRASE_DE_CONFIRMACION`): una oferta publicada es de cara al público y la tienda tiene pedidos reales.
 *
 * Límites de Mirakl (su documentación): OF24 y OF01 como mucho UNA vez por minuto (recomendado cada 5). Aquí se respeta con una espera mínima entre subidas
 * del mismo proceso; el resto de llamadas de lectura no tienen un límite publicado, pero se hacen de una en una.
 *
 * LA RESPUESTA DE LA CUENTA TRAE EL IBAN Y LOS DATOS DE CONTACTO del vendedor. `cuentaDeRespuesta` (datos.ts) se queda solo con lo que se enseña.
 */

const BASE_POR_DEFECTO = 'https://pccomponentes-prod.mirakl.net'
const TIEMPO_MAXIMO_MS = 30_000
/** Entre dos subidas de ofertas: el máximo que permite Mirakl es una por minuto */
const ESPERA_ENTRE_SUBIDAS_MS = 61_000

export class MiraklError extends Error {
  constructor(
    mensaje: string,
    readonly estado: number,
    /** Un recorte del cuerpo de la respuesta, ya sin la clave (nunca la lleva) */
    readonly cuerpo: string | null = null
  ) {
    super(mensaje)
    this.name = 'MiraklError'
  }
}

export const baseDePcc = (): string => (process.env.PCCOMPONENTES_BASE_URL ?? BASE_POR_DEFECTO).replace(/\/+$/, '')

/** Si falta la clave, el mensaje de qué hacer. null = está configurada */
export function faltaConfigurarPcc(): string | null {
  return process.env.ENTRAIS_PCCOMPONENTES?.trim() ? null : 'Falta la variable ENTRAIS_PCCOMPONENTES (la clave de API de la tienda de Entrais en PcComponentes) en el servidor.'
}

async function llamar(ruta: string, opciones: { metodo?: 'GET' | 'POST'; query?: Record<string, string | number | undefined>; json?: unknown; aceptar?: string } = {}): Promise<{ estado: number; texto: string; cabeceras: Headers }> {
  const clave = process.env.ENTRAIS_PCCOMPONENTES?.trim()
  if (!clave) throw new MiraklError(faltaConfigurarPcc()!, 0)
  const url = new URL(`${baseDePcc()}${ruta}`)
  for (const [k, v] of Object.entries(opciones.query ?? {})) if (v !== undefined && v !== '') url.searchParams.set(k, String(v))

  // Una lectura que topa con el límite de llamadas se repite UNA vez si PcComponentes pide esperar poco (`Retry-After` de hasta 8 s). Las escrituras no se repiten solas (una subida de ofertas ya tiene su propio control de una por minuto).
  let res: Response
  let texto = ''
  for (let intento = 0; ; intento++) {
    try {
      res = await fetch(url, {
        method: opciones.metodo ?? 'GET',
        headers: {
          Authorization: clave,
          Accept: opciones.aceptar ?? 'application/json',
          ...(opciones.json !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: opciones.json !== undefined ? JSON.stringify(opciones.json) : undefined,
        signal: AbortSignal.timeout(TIEMPO_MAXIMO_MS),
        cache: 'no-store',
      })
    } catch (e) {
      throw new MiraklError(`No se ha podido conectar con PcComponentes (${e instanceof Error ? e.name : 'error de red'})`, 0)
    }
    texto = await res.text()
    if (res.status === 429 && intento === 0 && (opciones.metodo ?? 'GET') === 'GET') {
      const pedida = Number(res.headers.get('retry-after'))
      const espera = Number.isFinite(pedida) && pedida > 0 ? pedida : 3
      // Solo si la espera es corta. Una de 30-60 s no se puede aguantar dentro de una petición: la pantalla se quedaría cargando sin decir nada.
      // Se falla enseguida con los segundos que hay que esperar y es la pantalla la que cuenta atrás y vuelve a pedirlo
      if (espera <= 8) {
        await new Promise((r) => setTimeout(r, espera * 1000))
        continue
      }
    }
    break
  }
  if (!res.ok) {
    const recorte = texto.replace(clave, '***').slice(0, 400)
    const motivo =
      res.status === 401 || res.status === 403
        ? 'PcComponentes ha rechazado la clave de API (¿caducada o sin permiso de escritura de ofertas?)'
        : res.status === 429
          ? `PcComponentes ha cortado por exceso de llamadas: espera ${Math.min(120, Math.max(5, Math.round(Number(res.headers.get('retry-after')) || 30)))} s y vuelve a intentarlo.`
          : `PcComponentes ha contestado ${res.status} a ${ruta}`
    throw new MiraklError(motivo, res.status, recorte || null)
  }
  return { estado: res.status, texto, cabeceras: res.headers }
}

const json = (texto: string): unknown => (texto ? JSON.parse(texto) : null)

/* ------------------------------------------------------------------ */
/* Leer                                                                */
/* ------------------------------------------------------------------ */

export async function leerCuenta(): Promise<CuentaPcc> {
  return cuentaDeRespuesta(json((await llamar('/api/account')).texto))
}

/** Una página de las ofertas de Entrais (OF21). `max` hasta 100 */
export async function leerOfertas(desde = 0, max = 100): Promise<{ ofertas: OfertaPcc[]; total: number }> {
  const r = json((await llamar('/api/offers', { query: { max: Math.min(100, Math.max(1, max)), offset: Math.max(0, desde) } })).texto) as { offers?: unknown[]; total_count?: number } | null
  return { ofertas: (r?.offers ?? []).map(ofertaDeRespuesta), total: typeof r?.total_count === 'number' ? r.total_count : (r?.offers ?? []).length }
}

/**
 * LA LISTA DE OFERTAS TIENE UN LÍMITE MUY BAJO Y LA PANTALLA LA PIDE EN CADA CARGA.
 * `GET /api/offers` admite muy pocas llamadas por minuto: contesta 429 con `Retry-After: 20-25` y alcanza con unas recargas seguidas, o con comprobar
 * un par de productos, para quedarse sin ellas. La cuenta (`/api/account`) no tiene ese problema.
 *
 * Así que la lista se guarda un minuto en memoria, se tira cuando se sube una oferta (para ver lo recién subido) y, si PcComponentes corta, se sirve la última
 * que hubiera aunque sea más vieja: es mejor enseñar lo de hace tres minutos, y decirlo, que dejar la pantalla en rojo.
 */
const FRESCURA_OFERTAS_MS = 60_000
let cacheDeOfertas: { guardadoEn: number; valor: { ofertas: OfertaPcc[]; total: number } } | null = null

export function olvidarLasOfertas(): void {
  cacheDeOfertas = null
}

export interface LecturaDeOfertas {
  ofertas: OfertaPcc[]
  total: number
  /** true = no se ha llamado a PcComponentes: sale de la memoria */
  deCache?: boolean
  /** Si sale de la memoria, cuánto hace que se leyó */
  edadSegundos?: number
}

/** TODAS las ofertas, página a página. Con un tope: una tienda con decenas de miles no cabe en una petición */
export async function leerTodasLasOfertas(tope = 5000, opciones: { forzar?: boolean } = {}): Promise<LecturaDeOfertas> {
  if (cacheDeOfertas && !opciones.forzar && Date.now() - cacheDeOfertas.guardadoEn < FRESCURA_OFERTAS_MS) {
    return { ...cacheDeOfertas.valor, deCache: true, edadSegundos: Math.round((Date.now() - cacheDeOfertas.guardadoEn) / 1000) }
  }
  try {
    const salida: OfertaPcc[] = []
    let total = 0
    for (let desde = 0; salida.length < tope; desde += 100) {
      const p = await leerOfertas(desde, 100)
      total = p.total
      salida.push(...p.ofertas)
      if (p.ofertas.length < 100 || salida.length >= total) break
    }
    const valor = { ofertas: salida.slice(0, tope), total }
    cacheDeOfertas = { guardadoEn: Date.now(), valor }
    return valor
  } catch (error) {
    if (error instanceof MiraklError && error.estado === 429 && cacheDeOfertas) {
      return { ...cacheDeOfertas.valor, deCache: true, edadSegundos: Math.round((Date.now() - cacheDeOfertas.guardadoEn) / 1000) }
    }
    throw error
  }
}

/**
 * ¿Están estos EAN en el catálogo de PcComponentes? (P11: ofertas por producto). Un EAN que no devuelve producto NO existe allí: Entrais solo puede ofertar
 * sobre productos que ya tiene el catálogo. Máximo 100 por llamada.
 */
export async function buscarProductosPorEan(eans: readonly string[]): Promise<Map<string, ProductoPcc>> {
  const encontrados = new Map<string, ProductoPcc>()
  for (let i = 0; i < eans.length; i += 100) {
    const trozo = eans.slice(i, i + 100)
    const r = json((await llamar('/api/products/offers', { query: { product_references: trozo.map((e) => `EAN|${e}`).join(',') } })).texto) as { products?: unknown[] } | null
    for (const p of r?.products ?? []) {
      const prod = productoDeRespuesta(p)
      if (prod.ean) encontrados.set(prod.ean, prod)
    }
  }
  return encontrados
}

export async function leerImportacion(id: string): Promise<ImportacionPcc> {
  if (!/^\d+$/.test(id)) throw new MiraklError('El identificador de la importación no es válido', 400)
  return importacionDeRespuesta(json((await llamar(`/api/offers/imports/${id}`)).texto))
}

/** El informe de errores de una importación (CSV), recortado. Vacío si no hay */
export async function leerErroresDeImportacion(id: string): Promise<string> {
  if (!/^\d+$/.test(id)) throw new MiraklError('El identificador de la importación no es válido', 400)
  try {
    return (await llamar(`/api/offers/imports/${id}/error_report`, { aceptar: 'text/csv' })).texto.slice(0, 20_000)
  } catch (e) {
    if (e instanceof MiraklError && e.estado === 404) return ''
    throw e
  }
}

/* ------------------------------------------------------------------ */
/* Escribir                                                            */
/* ------------------------------------------------------------------ */

export { FRASE_DE_CONFIRMACION }

let ultimaSubida = 0

/**
 * Manda ofertas (OF24). Es asíncrono: Mirakl devuelve un número de importación y hay que consultarlo después (`leerImportacion`). Sin la frase de confirmación
 * exacta, no hace NADA. Respeta el máximo de una subida por minuto.
 */
export async function subirOfertas(ofertas: readonly OfertaParaSubir[], confirmacion: string): Promise<{ importacionId: string }> {
  if (confirmacion !== FRASE_DE_CONFIRMACION) throw new MiraklError('Falta la confirmación: no se ha subido nada', 400)
  const cuerpo = cuerpoDeOF24(ofertas) // valida cada oferta antes de tocar la red
  const espera = ultimaSubida + ESPERA_ENTRE_SUBIDAS_MS - Date.now()
  if (espera > 0) throw new MiraklError(`PcComponentes admite una subida de ofertas por minuto: espera ${Math.ceil(espera / 1000)} s`, 429)
  const r = await llamar('/api/offers', { metodo: 'POST', json: cuerpo })
  ultimaSubida = Date.now()
  olvidarLasOfertas()
  const id = (json(r.texto) as { import_id?: number | string } | null)?.import_id
  if (id === undefined || id === null) throw new MiraklError('PcComponentes no ha devuelto el número de la importación', r.estado, r.texto.slice(0, 300))
  return { importacionId: String(id) }
}
