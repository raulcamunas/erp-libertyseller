/**
 * LOS AVISOS PUSH AL MÓVIL — PURO.
 *
 * Cada aviso que ya sale en la campana del ERP puede llegar además como notificación al móvil o al ordenador, aunque la app esté cerrada. Aquí viven las reglas que no dependen
 * de la red: a dónde lleva cada aviso, a quién le toca según lo que haya elegido, cómo se recorta el texto y si una suscripción que llega del navegador es de fiar.
 */

export type CategoriaDePush = 'tareas' | 'todo'

export interface AvisoParaPush {
  id: string
  type: string
  title: string
  message: string | null
  datos: unknown
  read: boolean
  created_at: string
  related_client_id?: string | null
}

const TIPOS_DE_TAREAS = new Set(['comment', 'mention', 'task_assigned', 'task_updated'])

/** ¿Es un aviso del módulo de tareas de clientes? */
export function esAvisoDeTareas(a: Pick<AvisoParaPush, 'type' | 'datos'>): boolean {
  const d = a.datos as { app?: string } | null | undefined
  // Los mensajes del chat (directos y menciones) cuentan como trabajo: llegan a quien eligió «solo tareas»
  return d?.app === 'tareas-clientes' || d?.app === 'chat' || TIPOS_DE_TAREAS.has(a.type)
}

/** ¿Le llega a quien eligió esta categoría? «tareas» = solo lo de tareas de clientes; «todo» = todo lo que sale en la campana */
export const leToca = (categoria: CategoriaDePush, a: Pick<AvisoParaPush, 'type' | 'datos'>): boolean => categoria === 'todo' || esAvisoDeTareas(a)

/** A dónde lleva un aviso al pulsarlo: la misma regla que la campana del ERP (components/layout/NotificationsBell.tsx) */
export function urlDeAviso(a: Pick<AvisoParaPush, 'type' | 'datos' | 'related_client_id'>): string {
  const d = (a.datos ?? null) as { app?: string; clienteId?: string; tareaId?: string } | null
  if (a.type === 'web_lead') return '/dashboard/web-leads'
  if (a.type === 'freno_stock' || a.type === 'fallo_stock') return '/dashboard/amazon-api'
  if (a.type === 'alarma_correo' || a.type === 'correo_nuevo' || a.type === 'respuesta_lead') return '/dashboard/correo'
  if (a.type === 'fba_alerta' || a.type === 'fba_resumen') return '/dashboard/remesas/alertas'
  if (a.type === 'factura_impagada') {
    const id = (d as { facturaId?: unknown } | null)?.facturaId
    return typeof id === 'string' && /^\d+$/.test(id) ? `/dashboard/facturacion?recordar=${id}` : '/dashboard/facturacion?pestana=cobros'
  }
  if ((d as { app?: string; canalId?: string } | null)?.app === 'chat') {
    const canalId = (d as { canalId?: string }).canalId
    return typeof canalId === 'string' && /^[0-9a-f-]{36}$/i.test(canalId) ? `/dashboard/chat?canal=${canalId}` : '/dashboard/chat'
  }
  if (d?.app === 'tareas-clientes' && d.clienteId && /^[0-9a-f-]{36}$/i.test(d.clienteId)) {
    return `/dashboard/tareas-clientes/${d.clienteId}${d.tareaId && /^[0-9a-f-]{36}$/i.test(d.tareaId) ? `?tarea=${d.tareaId}` : ''}`
  }
  if (d?.app === 'tareas-clientes') return '/dashboard/tareas-clientes/mi-dia'
  if (a.related_client_id) return `/dashboard/clients/${a.related_client_id}`
  return '/dashboard'
}

export interface CargaDePush {
  titulo: string
  cuerpo: string
  url: string
  /** Un aviso con la misma etiqueta sustituye al anterior en vez de apilarse. Es la dirección a la que lleva: así coincide con la del aviso que el navegador ya enseña por su cuenta cuando la pestaña está oculta (lib/avisos/sonido-tareas.ts) y no salen dos */
  etiqueta: string
}

export function cargaDePush(a: AvisoParaPush): CargaDePush {
  const recorta = (t: string, max: number) => (t.length > max ? `${t.slice(0, max - 1)}…` : t)
  return { titulo: recorta(a.title.trim() || 'Liberty Seller Hub', 80), cuerpo: recorta((a.message ?? '').trim(), 160), url: urlDeAviso(a), etiqueta: urlDeAviso(a) }
}

/** Solo se mandan los avisos recientes: al activar los push por primera vez no llegan cientos de avisos viejos */
export const VENTANA_DE_ENVIO_MS = 10 * 60_000

export const esReciente = (a: Pick<AvisoParaPush, 'created_at'>, ahora: number): boolean => ahora - Date.parse(a.created_at) <= VENTANA_DE_ENVIO_MS

export interface SuscripcionDePush {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

/** Una suscripción tal como la entrega el navegador, comprobada: https, claves en base64url y topes. null = no vale */
export function suscripcionValida(entrada: unknown): SuscripcionDePush | null {
  if (!entrada || typeof entrada !== 'object') return null
  const e = entrada as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } }
  if (typeof e.endpoint !== 'string' || e.endpoint.length > 1000 || !/^https:\/\//i.test(e.endpoint)) return null
  const b64 = /^[A-Za-z0-9_-]{8,200}={0,2}$/
  const p256dh = e.keys?.p256dh
  const auth = e.keys?.auth
  if (typeof p256dh !== 'string' || typeof auth !== 'string' || !b64.test(p256dh) || !b64.test(auth)) return null
  return { endpoint: e.endpoint, keys: { p256dh, auth } }
}

export const categoriaValida = (c: unknown): CategoriaDePush => (c === 'todo' ? 'todo' : 'tareas')

/** Un servicio de push que contesta 404 o 410 está diciendo que ese dispositivo ya no existe (se desinstaló la app o se quitó el permiso): se borra */
export const esDispositivoMuerto = (estado: number | undefined): boolean => estado === 404 || estado === 410

/** Tras tantos fallos seguidos (no «muerto», sino error del servicio) se deja de intentar con ese dispositivo */
export const FALLOS_MAXIMOS = 8

/** Un nombre corto del dispositivo a partir del agente del navegador, para que cada persona reconozca el suyo en la lista */
export function nombreDeDispositivo(agente: string | null | undefined): string {
  const a = agente ?? ''
  const so = /iPhone|iPad/.test(a) ? 'iPhone' : /Android/.test(a) ? 'Android' : /Macintosh/.test(a) ? 'Mac' : /Windows/.test(a) ? 'Windows' : /Linux/.test(a) ? 'Linux' : 'Dispositivo'
  const nav = /Edg\//.test(a) ? 'Edge' : /Chrome\//.test(a) ? 'Chrome' : /Firefox\//.test(a) ? 'Firefox' : /Safari\//.test(a) ? 'Safari' : ''
  return nav ? `${so} · ${nav}` : so
}
