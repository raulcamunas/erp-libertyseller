import { promises as dns } from 'node:dns'
import { isIP } from 'node:net'

/**
 * COMPROBACIONES DE RED ANTES DE ABRIR UNA CONEXIÓN — SOLO SERVIDOR.
 * ==================================================================
 * El ERP abre conexiones de correo POR CUENTA DE QUIEN LAS PIDE, a un servidor que esa persona ha escogido. Sin
 * esta comprobación, «mi servidor de correo» podría ser `localhost:5432`, la base de datos de al lado o el servicio
 * de metadatos de la nube (169.254.169.254), y el mensaje de error o el simple hecho de que conteste o no servirían
 * para explorar la red interna (SSRF).
 *
 * Qué se hace:
 *   1. El nombre se resuelve AQUÍ, y se rechaza si CUALQUIERA de sus direcciones es interna, privada, de bucle,
 *      de enlace local, multicast o reservada.
 *   2. La conexión se abre contra la dirección ya resuelta (con el nombre original para el certificado), de modo que
 *      un DNS que conteste una cosa ahora y otra después no puede colar una dirección interna entre la comprobación
 *      y el uso.
 *
 * Se comprueba con red.prueba.ts.
 */

/** Convierte «a.b.c.d» en un número de 32 bits, o null */
function ipv4ANumero(ip: string): number | null {
  const partes = ip.split('.')
  if (partes.length !== 4) return null
  let n = 0
  for (const p of partes) {
    if (!/^\d{1,3}$/.test(p)) return null
    const v = Number(p)
    if (v > 255) return null
    n = n * 256 + v
  }
  return n
}

/** [dirección, bits] de los bloques IPv4 que nunca son un servidor de correo público */
const BLOQUES_V4: Array<[string, number]> = [
  ['0.0.0.0', 8], // «esta red»
  ['10.0.0.0', 8], // privada
  ['100.64.0.0', 10], // CGNAT
  ['127.0.0.0', 8], // bucle
  ['169.254.0.0', 16], // enlace local (incluye el servicio de metadatos de la nube)
  ['172.16.0.0', 12], // privada
  ['192.0.0.0', 24], // reservada para protocolos
  ['192.0.2.0', 24], // documentación
  ['192.88.99.0', 24], // 6to4 relay (obsoleto)
  ['192.168.0.0', 16], // privada
  ['198.18.0.0', 15], // pruebas de rendimiento
  ['198.51.100.0', 24], // documentación
  ['203.0.113.0', 24], // documentación
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reservada (incluye el broadcast)
]

function ipv4EsInterna(ip: string): boolean {
  const n = ipv4ANumero(ip)
  if (n === null) return true // lo que no se entiende, no se usa
  return BLOQUES_V4.some(([base, bits]) => {
    const b = ipv4ANumero(base)!
    const mascara = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0
    return ((n & mascara) >>> 0) === ((b & mascara) >>> 0)
  })
}

/** Las 8 partes de 16 bits de una dirección IPv6, o null si no es válida */
function ipv6ANumeros(ip: string): number[] | null {
  let texto = ip.toLowerCase()
  const zona = texto.indexOf('%')
  if (zona >= 0) texto = texto.slice(0, zona)

  // «::ffff:1.2.3.4» -> el final en IPv4 pasa a dos partes de 16 bits
  const v4 = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(texto)
  if (v4) {
    const n = ipv4ANumero(v4[1])
    if (n === null) return null
    texto = `${texto.slice(0, texto.length - v4[1].length)}${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`
  }

  const dobles = texto.split('::')
  if (dobles.length > 2) return null
  const analizar = (t: string): number[] | null => {
    if (t === '') return []
    const partes = t.split(':')
    const salida: number[] = []
    for (const p of partes) {
      if (!/^[0-9a-f]{1,4}$/.test(p)) return null
      salida.push(parseInt(p, 16))
    }
    return salida
  }
  const izquierda = analizar(dobles[0])
  const derecha = dobles.length === 2 ? analizar(dobles[1]) : []
  if (!izquierda || !derecha) return null
  if (dobles.length === 1) return izquierda.length === 8 ? izquierda : null
  const faltan = 8 - izquierda.length - derecha.length
  if (faltan < 1) return null
  return [...izquierda, ...new Array<number>(faltan).fill(0), ...derecha]
}

function ipv6EsInterna(ip: string): boolean {
  const g = ipv6ANumeros(ip)
  if (!g) return true
  const todoCeroHasta = (n: number) => g.slice(0, n).every((x) => x === 0)

  if (todoCeroHasta(7) && (g[7] === 0 || g[7] === 1)) return true // :: y ::1
  // IPv4 dentro de IPv6: se juzga por la IPv4 de dentro
  const v4Dentro = (a: number, b: number) => `${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`
  if (todoCeroHasta(5) && g[5] === 0xffff) return ipv4EsInterna(v4Dentro(g[6], g[7])) // ::ffff:a.b.c.d
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return ipv4EsInterna(v4Dentro(g[6], g[7])) // 64:ff9b::/96 (NAT64)
  if (g[0] === 0x2002) return ipv4EsInterna(v4Dentro(g[1], g[2])) // 6to4
  if ((g[0] & 0xfe00) === 0xfc00) return true // fc00::/7 privadas
  if ((g[0] & 0xffc0) === 0xfe80) return true // fe80::/10 enlace local
  if ((g[0] & 0xffc0) === 0xfec0) return true // fec0::/10 (obsoleta)
  if ((g[0] & 0xff00) === 0xff00) return true // ff00::/8 multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true // documentación
  if (g[0] === 0x2001 && g[1] === 0x0000) return true // Teredo
  if (g[0] === 0x0100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return true // 100::/64 descarte
  return false
}

/** ¿Es una dirección que no se debe usar como servidor de correo de un tercero? Lo que no se reconoce cuenta como interna */
export function esIpInterna(ip: string): boolean {
  const v = isIP(ip)
  if (v === 4) return ipv4EsInterna(ip)
  if (v === 6) return ipv6EsInterna(ip)
  return true
}

export type ResolucionDeServidor = { ok: true; ip: string } | { ok: false; motivo: 'no_resuelve' | 'interna' }

const CADUCA_DNS_MS = 6_000

function conTope<T>(promesa: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolver, rechazar) => {
    const reloj = setTimeout(() => rechazar(new Error('tiempo agotado')), ms)
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

/**
 * Resuelve el nombre de un servidor y comprueba que TODAS sus direcciones son públicas. Devuelve una (la IPv4 si
 * hay, que es con la que mejor se conectan los servidores de correo) para abrir la conexión contra ella.
 */
export async function resolverPublico(host: string, resolver: typeof dns.lookup = dns.lookup): Promise<ResolucionDeServidor> {
  let direcciones: Array<{ address: string; family: number }>
  try {
    direcciones = (await conTope(resolver(host, { all: true, verbatim: true }), CADUCA_DNS_MS)) as Array<{ address: string; family: number }>
  } catch {
    return { ok: false, motivo: 'no_resuelve' }
  }
  if (!direcciones || direcciones.length === 0) return { ok: false, motivo: 'no_resuelve' }
  if (direcciones.some((d) => esIpInterna(d.address))) return { ok: false, motivo: 'interna' }
  const elegida = direcciones.find((d) => d.family === 4) ?? direcciones[0]
  return { ok: true, ip: elegida.address }
}

/** Los servidores de correo (MX) de un dominio, por prioridad. Vacío si no hay o no contesta a tiempo */
export async function servidoresMx(dominio: string): Promise<string[]> {
  try {
    const registros = await conTope(dns.resolveMx(dominio), CADUCA_DNS_MS)
    return registros.sort((a, b) => a.priority - b.priority).map((r) => r.exchange)
  } catch {
    return []
  }
}
