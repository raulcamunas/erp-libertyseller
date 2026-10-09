import {
  cantidadDe,
  extraerLista,
  mensajeDeEstado,
  pareceHtml,
  RECURSOS_NECESARIOS,
  RECURSOS_PERSONALES,
  recursosPermitidos,
  resumenEan,
  veredictoSondas,
} from './respuesta'

/**
 * LLAMAR AL WEBSERVICE DE PRESTASHOP.
 * SOLO SERVIDOR: aquí se usa la clave en claro.
 *
 * SOLO LEE. Todas las peticiones son GET: este fichero no tiene ninguna forma de
 * escribir en la tienda de un cliente, y la clave que se le pida al cliente tiene
 * que ser de permiso GET. Si alguna vez hace falta escribir, será otro fichero,
 * con su propio nombre, y no un parámetro de este.
 *
 *
 * ============ CÓMO SE HABLA CON LA TIENDA ============
 *
 *   dirección   {tienda}/api/{recurso}
 *   clave       como USUARIO de la autenticación básica, con contraseña vacía. Es
 *               lo que dice la propia tienda: «introduce la clave como login, no
 *               hace falta contraseña».
 *   formato     `output_format=JSON`: por defecto PrestaShop contesta en XML.
 *
 * NO SE SIGUEN LAS REDIRECCIONES. Una tienda que redirige `dominio.com` a
 * `www.dominio.com` es lo más normal del mundo, pero seguirla mandaría la clave a
 * donde diga la cabecera `Location`, y la clave solo debe ir a la dirección que
 * se ha configurado. Se avisa y se le pide a la persona la dirección final.
 *
 *
 * LO QUE NO SE HA PROBADO
 * -----------------------
 * Todo esto sale del Webservice de PrestaShop 1.7 y NO se ha ejecutado contra la
 * tienda de ShoesF con una clave: la única comprobación hecha es que
 * `/api/` contesta 401 con el aviso de autenticación, o sea que el Webservice
 * está activado. Lo demás se ve en la primera prueba real.
 */

export interface ConexionPS {
  /** https, sin barra final ni /api. Ver url.ts */
  url: string
  clave: string
}

/** Cuánto se espera a una tienda. Un hosting compartido lento tarda, pero no 25 s */
const ESPERA_MS = 25_000

interface Respuesta {
  status: number
  cuerpo: string
  json: unknown | null
  version: string | null
  /** Solo el destino de una redirección, sin parámetros */
  redireccion: string | null
}

async function peticion(
  c: ConexionPS,
  recurso: string,
  params: Record<string, string> = {}
): Promise<Respuesta> {
  const qs = new URLSearchParams({ ...params, output_format: 'JSON' })
  const url = `${c.url}/api/${recurso}?${qs.toString()}`

  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Basic ${Buffer.from(`${c.clave}:`).toString('base64')}`,
      Accept: 'application/json',
      'Io-Format': 'JSON',
    },
    redirect: 'manual',
    cache: 'no-store',
    signal: AbortSignal.timeout(ESPERA_MS),
  })

  const cuerpo = await res.text()
  let json: unknown | null = null
  if (!pareceHtml(cuerpo)) {
    try {
      json = JSON.parse(cuerpo)
    } catch {
      json = null
    }
  }

  let redireccion: string | null = null
  const loc = res.headers.get('location')
  if (loc) {
    try {
      redireccion = new URL(loc, c.url).origin
    } catch {
      redireccion = null
    }
  }

  return { status: res.status, cuerpo, json, version: res.headers.get('psws-version'), redireccion }
}

/** Convierte un fallo de red en algo que se entienda. Nunca lleva la clave */
export function describirFallo(e: unknown): string {
  const nombre = e instanceof Error ? e.name : ''
  const causa = e instanceof Error && e.cause instanceof Error ? e.cause.message : ''
  const texto = `${e instanceof Error ? e.message : ''} ${causa}`
  if (nombre === 'TimeoutError' || /timeout|timed out/i.test(texto)) {
    return `La tienda no ha contestado en ${ESPERA_MS / 1000} segundos.`
  }
  if (/ENOTFOUND|getaddrinfo/i.test(texto)) {
    return 'No se encuentra esa dirección. Comprueba que el dominio está bien escrito.'
  }
  if (/certificate|CERT_|SSL|TLS/i.test(texto)) {
    return 'El certificado https de la tienda no es válido, así que no se puede conectar con seguridad.'
  }
  if (/ECONNREFUSED|ECONNRESET/i.test(texto)) {
    return 'La tienda ha rechazado la conexión.'
  }
  return 'No se ha podido conectar con la tienda.'
}

export interface PruebaConexion {
  ok: boolean
  /** Una frase, para la cabecera del resultado */
  mensaje: string
  ms: number
  version: string | null
  recursos: { nombre: string; permitido: boolean }[]
  /**
   * Lo que la tienda LISTA en la raíz de /api/ para esta clave. Solo se enseña
   * para diagnosticar: si dice 0, o lo que lista no se parece a recursos, es que
   * la forma de esa respuesta no es la esperada y hay que mirarla.
   */
  listadosEnRaiz: { total: number; ejemplo: string[] }
  /** Recursos con datos personales de clientes a los que esta clave llega */
  personales: string[]
  stock: {
    filas: number | null
    muestra: { id_product: string; id_product_attribute: string; quantity: number | null }[]
  } | null
  ean: { total: number; conEan: number } | null
  avisos: string[]
}

const vacia = (mensaje: string, ms: number, version: string | null = null): PruebaConexion => ({
  ok: false,
  mensaje,
  ms,
  version,
  recursos: RECURSOS_NECESARIOS.map((nombre) => ({ nombre, permitido: false })),
  listadosEnRaiz: { total: 0, ejemplo: [] },
  personales: [],
  stock: null,
  ean: null,
  avisos: [],
})

/**
 * LA PRUEBA DE CONEXIÓN. Cuatro pasos, y se para en el primero que falle con un
 * mensaje que dice qué hacer:
 *
 *   1. La raíz de /api/: ¿contesta, reconoce la clave y qué recursos deja leer?
 *   2. ¿Están los tres que hacen falta?
 *   3. El stock: cuántos registros hay y una muestra.
 *   4. Las tallas: ¿tienen EAN? Es lo que permite cruzar con Amazon.
 */
export async function probarConexion(c: ConexionPS): Promise<PruebaConexion> {
  const inicio = Date.now()
  const ms = () => Date.now() - inicio

  try {
    // ---------- 1. La raíz ----------
    const raiz = await peticion(c, '')
    if (raiz.status !== 200) {
      return vacia(mensajeDeEstado(raiz.status, raiz.cuerpo, raiz.redireccion), ms(), raiz.version)
    }
    if (raiz.json === null) {
      return vacia(
        'La dirección contesta, pero no es la API de PrestaShop (parece una página web). ' +
          'Comprueba que es la dirección pública de la tienda.',
        ms(),
        raiz.version
      )
    }

    // ---------- 2. Los permisos ----------
    //
    // Se PREGUNTA por cada recurso en vez de leer la lista de la raíz. Ver
    // veredictoSondas: leer esa lista fue lo que falló en la primera prueba real.
    const enRaiz = recursosPermitidos(raiz.json)
    const listadosEnRaiz = { total: enRaiz.length, ejemplo: enRaiz.slice(0, 12) }
    const personales = RECURSOS_PERSONALES.filter((r) => enRaiz.includes(r))

    const sondas = await Promise.all(
      RECURSOS_NECESARIOS.map(async (nombre) => {
        const r = await peticion(c, nombre, { display: '[id]', limit: '0,1' })
        return { nombre, status: r.status }
      })
    )
    const v = veredictoSondas(sondas)
    const recursos = RECURSOS_NECESARIOS.map((nombre) => ({
      nombre,
      permitido: v.permitidos.includes(nombre),
    }))

    const avisos: string[] = []
    if (personales.length > 0) {
      avisos.push(
        `Esta clave también puede leer datos personales de clientes (${personales.join(', ')}). ` +
          'Conviene crear otra solo con los tres recursos que hacen falta.'
      )
    }

    const faltan = [...v.sinPermiso, ...v.conError.map((e) => e.nombre)]
    if (faltan.length > 0) {
      const partes: string[] = []
      if (v.sinPermiso.length > 0) {
        partes.push(`la tienda no deja a esta clave leer: ${v.sinPermiso.join(', ')}`)
      }
      for (const e of v.conError) partes.push(`${e.nombre} ha contestado ${e.status}`)
      return {
        ...vacia(
          `La clave se reconoce, pero ${partes.join('; ')}. ` +
            'Hay que marcar «Ver (GET)» en esos recursos de la clave, en Parámetros avanzados → Webservice.',
          ms(),
          raiz.version
        ),
        recursos,
        listadosEnRaiz,
        personales: [...personales],
        avisos,
      }
    }

    // ---------- 3. El stock ----------
    const muestraRes = await peticion(c, 'stock_availables', {
      display: '[id,id_product,id_product_attribute,quantity]',
      limit: '0,5',
    })
    if (muestraRes.status !== 200) {
      return {
        ...vacia(mensajeDeEstado(muestraRes.status, muestraRes.cuerpo, muestraRes.redireccion), ms(), raiz.version),
        recursos,
        listadosEnRaiz,
        personales: [...personales],
        avisos,
      }
    }
    const muestra = extraerLista(muestraRes.json, 'stock_availables').map((f) => ({
      id_product: String(f.id_product ?? ''),
      id_product_attribute: String(f.id_product_attribute ?? ''),
      quantity: cantidadDe(f.quantity),
    }))

    // El total: solo los ids, que es lo más ligero que deja pedir
    let filas: number | null = null
    try {
      const todos = await peticion(c, 'stock_availables', { display: '[id]' })
      if (todos.status === 200) filas = extraerLista(todos.json, 'stock_availables').length
      else avisos.push('No se ha podido contar cuántos registros de stock hay.')
    } catch {
      avisos.push('No se ha podido contar cuántos registros de stock hay.')
    }

    // ---------- 4. Las tallas y su EAN ----------
    let ean: PruebaConexion['ean'] = null
    try {
      const comb = await peticion(c, 'combinations', {
        display: '[id,id_product,ean13,reference]',
        limit: '0,500',
      })
      if (comb.status === 200) {
        ean = resumenEan(extraerLista(comb.json, 'combinations'))
        if (ean.total > 0 && ean.conEan / ean.total < 0.9) {
          avisos.push(
            `Solo el ${Math.round((ean.conEan / ean.total) * 100)} % de las tallas tiene EAN: el cruce con ` +
              'Amazon se perdería en el resto.'
          )
        }
      }
    } catch {
      avisos.push('No se ha podido comprobar el EAN de las tallas.')
    }

    return {
      ok: true,
      mensaje:
        `Conectada${raiz.version ? ` (PrestaShop ${raiz.version})` : ''}` +
        (filas !== null ? `: ${filas.toLocaleString('es-ES')} registros de stock` : '') +
        (ean && ean.total > 0
          ? `, ${Math.round((ean.conEan / ean.total) * 100)} % de las tallas con EAN.`
          : '.'),
      ms: ms(),
      version: raiz.version,
      recursos,
      listadosEnRaiz,
      personales: [...personales],
      stock: { filas, muestra },
      ean,
      avisos,
    }
  } catch (e) {
    return vacia(describirFallo(e), ms())
  }
}
