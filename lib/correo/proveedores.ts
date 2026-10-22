/**
 * A QUÉ SERVIDORES SE CONECTA CADA BUZÓN.
 * =======================================
 * PURO: no toca la base ni la red. Se comprueba con proveedores.prueba.ts.
 *
 * Los comerciales usan buzones de Hostinger, que hoy son de dos clases según el plan del dominio:
 *
 *   · «Hostinger Email»  ->  imap.hostinger.com:993  y  smtp.hostinger.com:465
 *   · «Titan» (el webmail que Hostinger revende)  ->  imap.titan.email:993  y  smtp.titan.email:465
 *
 * La clase se sabe mirando a dónde apuntan los MX del dominio de la dirección (mx1.hostinger.com o
 * mx1.titan.email), así que la persona solo escribe su correo y su contraseña. Se puede escoger a mano.
 *
 * LA LISTA DE SERVIDORES NO ES UN DETALLE: la contraseña de cada buzón viaja a ese servidor y el nuestro abre
 * la conexión por cuenta de quien la pide. Por eso solo se aceptan los dos de arriba y, para un administrador,
 * un servidor «personalizado» que además pasa por la comprobación de red (lib/correo/red.ts: nada que resuelva
 * a una dirección interna) y por un puerto de correo de verdad.
 */

export type IdProveedor = 'hostinger' | 'titan' | 'personalizado'

export interface Servidor {
  host: string
  puerto: number
  /** true = TLS directo (993, 465); false = STARTTLS obligatorio (143, 587). Nunca sin cifrar */
  seguro: boolean
}

export interface Preajuste {
  id: Exclude<IdProveedor, 'personalizado'>
  nombre: string
  imap: Servidor
  smtp: Servidor
}

export const PREAJUSTES: Record<Preajuste['id'], Preajuste> = {
  hostinger: {
    id: 'hostinger',
    nombre: 'Hostinger',
    imap: { host: 'imap.hostinger.com', puerto: 993, seguro: true },
    smtp: { host: 'smtp.hostinger.com', puerto: 465, seguro: true },
  },
  titan: {
    id: 'titan',
    nombre: 'Titan (Hostinger)',
    imap: { host: 'imap.titan.email', puerto: 993, seguro: true },
    smtp: { host: 'smtp.titan.email', puerto: 465, seguro: true },
  },
}

export const NOMBRE_DE_PROVEEDOR: Record<IdProveedor, string> = {
  hostinger: 'Hostinger',
  titan: 'Titan (Hostinger)',
  personalizado: 'Otro servidor',
}

/** Cuántos días atrás se puede pedir que se importe un buzón, y cuántos por defecto */
export const DIAS_DE_HISTORICO = [30, 60, 90, 180, 365] as const
export const DIAS_POR_DEFECTO = 60

export function diasDeHistoricoValidos(valor: unknown): number {
  const n = typeof valor === 'number' ? valor : Number(valor)
  return (DIAS_DE_HISTORICO as readonly number[]).includes(n) ? n : DIAS_POR_DEFECTO
}

/**
 * A qué proveedor apuntan los MX de un dominio. 'google' y 'microsoft' se reconocen solo para decirle a la persona
 * por qué no se puede conectar así (necesitan otro tipo de acceso), no para conectarlos.
 */
export function proveedorPorMx(servidoresMx: string[]): 'hostinger' | 'titan' | 'google' | 'microsoft' | null {
  const hosts = servidoresMx.map((h) => h.trim().toLowerCase().replace(/\.$/, ''))
  if (hosts.some((h) => /(^|\.)titan\.email$/.test(h))) return 'titan'
  if (hosts.some((h) => /(^|\.)hostinger\.[a-z]{2,}$/.test(h))) return 'hostinger'
  if (hosts.some((h) => /(^|\.)(google|googlemail)\.com$/.test(h))) return 'google'
  if (hosts.some((h) => /(^|\.)(outlook|protection\.outlook)\.com$/.test(h) || /(^|\.)mail\.protection\.outlook\.com$/.test(h))) return 'microsoft'
  return null
}

const PUERTOS_IMAP = new Set([993, 143])
const PUERTOS_SMTP = new Set([465, 587])
const ETIQUETA = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

/** ¿Es un nombre de servidor aceptable? Un nombre con puntos, nunca una dirección IP escrita a mano ni «localhost» */
export function esNombreDeServidor(host: unknown): host is string {
  if (typeof host !== 'string') return false
  const h = host.trim().toLowerCase()
  if (h.length < 4 || h.length > 253) return false
  const etiquetas = h.split('.')
  if (etiquetas.length < 2) return false
  if (!etiquetas.every((e) => ETIQUETA.test(e))) return false
  // «192.168.1.1» y «10.0.0.1» tienen la forma de un nombre: la última etiqueta tiene que tener letras
  if (!/[a-z]/.test(etiquetas[etiquetas.length - 1])) return false
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return false
  return true
}

/**
 * Valida un servidor escrito por una persona (el caso «personalizado»): un nombre de servidor de verdad y un puerto
 * de correo. El puerto decide el cifrado: 993 y 465 van con TLS directo, 143 y 587 con STARTTLS obligatorio.
 */
export function validarServidor(entrada: unknown, tipo: 'imap' | 'smtp'): Servidor | null {
  if (!entrada || typeof entrada !== 'object') return null
  const { host, puerto } = entrada as { host?: unknown; puerto?: unknown }
  if (!esNombreDeServidor(host)) return null
  const p = typeof puerto === 'number' ? puerto : Number(puerto)
  if (!Number.isInteger(p) || !(tipo === 'imap' ? PUERTOS_IMAP : PUERTOS_SMTP).has(p)) return null
  return { host: host.trim().toLowerCase(), puerto: p, seguro: p === 993 || p === 465 }
}
