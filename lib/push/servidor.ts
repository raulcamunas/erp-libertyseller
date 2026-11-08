import webpush from 'web-push'
import { createServiceClient } from '@/lib/supabase/service'
import { cargaDePush, categoriaValida, esDispositivoMuerto, esReciente, FALLOS_MAXIMOS, leToca, nombreDeDispositivo, suscripcionValida, type AvisoParaPush, type CategoriaDePush } from './aviso'

/**
 * LOS AVISOS PUSH EN EL SERVIDOR (tablas `push_config`, `push_suscripciones` y `push_enviados`, migración 280). SOLO SERVIDOR.
 *
 * La pareja de claves se genera sola la primera vez y vive en la base (cerrada al navegador): no hay nada que poner en Easypanel. Si falta la migración, todo dice qué lanzar y
 * nada más se rompe. `pasadaDePush` la lanza el cron cada minuto: manda los avisos NUEVOS de la campana (de los últimos diez minutos, sin leer y no mandados antes) a los
 * dispositivos de cada persona, según lo que ella haya elegido recibir.
 */

const ASUNTO_VAPID = 'mailto:business@libertyseller.com'
const faltaLaTabla = (e: { message?: string; code?: string } | null | undefined): boolean => Boolean(e && (e.code === '42P01' || /push_config|push_suscripciones|push_enviados/.test(e.message ?? '')))
export const SIN_MIGRACION_PUSH = 'Falta lanzar la migración 280 en Supabase para activar los avisos push.'

let claves: { publica: string; privada: string } | null = null

/** La pareja de claves del servidor: la lee de la base o, la primera vez, la genera y la guarda. null si falta la migración */
export async function clavesDelServidor(): Promise<{ publica: string; privada: string } | null> {
  if (claves) return claves
  const service = createServiceClient()
  const leer = () => service.from('push_config').select('clave_publica, clave_privada').eq('id', 1).maybeSingle()
  const { data, error } = await leer()
  if (error) return faltaLaTabla(error) ? null : Promise.reject(new Error(error.message))
  let fila = data as { clave_publica: string; clave_privada: string } | null
  if (!fila) {
    const nuevas = webpush.generateVAPIDKeys()
    // Si dos peticiones lo intentan a la vez gana la primera (id fijo = 1) y la otra lee la que quedó
    await service.from('push_config').upsert({ id: 1, clave_publica: nuevas.publicKey, clave_privada: nuevas.privateKey }, { onConflict: 'id', ignoreDuplicates: true })
    fila = ((await leer()).data as { clave_publica: string; clave_privada: string } | null) ?? { clave_publica: nuevas.publicKey, clave_privada: nuevas.privateKey }
  }
  claves = { publica: fila.clave_publica, privada: fila.clave_privada }
  return claves
}

export interface DispositivoDePush {
  id: string
  /** La dirección de entrega de ese dispositivo (es de esta misma persona): el navegador la compara con la suya para saber cuál es */
  endpoint: string
  dispositivo: string
  categoria: CategoriaDePush
  creada_en: string
  ultimo_envio: string | null
}

export async function misDispositivos(usuarioId: string): Promise<DispositivoDePush[]> {
  const { data } = await createServiceClient().from('push_suscripciones').select('id, endpoint, dispositivo, categoria, creada_en, ultimo_envio').eq('usuario_id', usuarioId).order('creada_en')
  return (data ?? []) as DispositivoDePush[]
}

/** Guarda (o actualiza) el dispositivo de esta persona. Un dispositivo que ya estaba con otra persona pasa a esta: es quien tiene la sesión abierta ahora */
export async function guardarSuscripcion(usuarioId: string, entrada: unknown, categoria: unknown, agente: string | null): Promise<void> {
  const s = suscripcionValida(entrada)
  if (!s) throw new Error('La suscripción no es válida.')
  const { error } = await createServiceClient().from('push_suscripciones').upsert({ usuario_id: usuarioId, endpoint: s.endpoint, p256dh: s.keys.p256dh, auth: s.keys.auth, categoria: categoriaValida(categoria), dispositivo: nombreDeDispositivo(agente), fallos: 0 }, { onConflict: 'endpoint' })
  if (error) throw new Error(faltaLaTabla(error) ? SIN_MIGRACION_PUSH : error.message)
}

export async function cambiarCategoria(usuarioId: string, endpoint: string, categoria: unknown): Promise<void> {
  await createServiceClient().from('push_suscripciones').update({ categoria: categoriaValida(categoria) }).eq('usuario_id', usuarioId).eq('endpoint', endpoint)
}

export async function borrarSuscripcion(usuarioId: string, endpoint: string): Promise<void> {
  await createServiceClient().from('push_suscripciones').delete().eq('usuario_id', usuarioId).eq('endpoint', endpoint)
}

interface FilaDeSuscripcion {
  id: string
  usuario_id: string
  endpoint: string
  p256dh: string
  auth: string
  categoria: CategoriaDePush
  fallos: number
}

/** Manda una carga a un dispositivo y apunta cómo fue: un dispositivo muerto se borra y uno que falla mucho se deja de intentar */
async function enviarA(s: FilaDeSuscripcion, carga: unknown, privada: { publica: string; privada: string }): Promise<'ok' | 'muerto' | 'fallo'> {
  const service = createServiceClient()
  try {
    await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(carga), { vapidDetails: { subject: ASUNTO_VAPID, publicKey: privada.publica, privateKey: privada.privada }, TTL: 3600, urgency: 'normal' })
    await service.from('push_suscripciones').update({ fallos: 0, ultimo_envio: new Date().toISOString() }).eq('id', s.id)
    return 'ok'
  } catch (e) {
    const estado = (e as { statusCode?: number }).statusCode
    if (esDispositivoMuerto(estado)) {
      await service.from('push_suscripciones').delete().eq('id', s.id)
      return 'muerto'
    }
    await service.from('push_suscripciones').update({ fallos: s.fallos + 1 }).eq('id', s.id)
    return 'fallo'
  }
}

/** Un aviso de prueba a los dispositivos de esta persona: para comprobar que llega */
export async function enviarPrueba(usuarioId: string): Promise<{ enviados: number; fallidos: number }> {
  const k = await clavesDelServidor()
  if (!k) throw new Error(SIN_MIGRACION_PUSH)
  const { data } = await createServiceClient().from('push_suscripciones').select('id, usuario_id, endpoint, p256dh, auth, categoria, fallos').eq('usuario_id', usuarioId)
  let enviados = 0
  let fallidos = 0
  for (const s of (data ?? []) as FilaDeSuscripcion[]) {
    const r = await enviarA(s, { titulo: 'Avisos activados ✓', cuerpo: 'Así te llegarán los avisos del ERP a este dispositivo.', url: '/dashboard/tareas-clientes/mi-dia', etiqueta: 'prueba' }, k)
    if (r === 'ok') enviados += 1
    else fallidos += 1
  }
  return { enviados, fallidos }
}

export interface ResumenDePush {
  resumen: string
  avisos: number
  enviados: number
  muertos: number
}

export async function pasadaDePush(): Promise<ResumenDePush> {
  const vacio = (resumen: string): ResumenDePush => ({ resumen, avisos: 0, enviados: 0, muertos: 0 })
  const service = createServiceClient()
  const { data: suscripciones, error } = await service.from('push_suscripciones').select('id, usuario_id, endpoint, p256dh, auth, categoria, fallos').lt('fallos', FALLOS_MAXIMOS).limit(2000)
  if (error) return vacio(faltaLaTabla(error) ? 'falta la migración 280' : `error: ${error.message}`)
  const lista = (suscripciones ?? []) as FilaDeSuscripcion[]
  if (lista.length === 0) return vacio('nadie con avisos activados')
  const k = await clavesDelServidor()
  if (!k) return vacio('falta la migración 280')

  const ahora = Date.now()
  const usuarios = [...new Set(lista.map((s) => s.usuario_id))]
  const desde = new Date(ahora - 10 * 60_000).toISOString()
  const { data: avisos } = await service.from('notifications').select('id, user_id, type, title, message, datos, read, created_at, related_client_id').in('user_id', usuarios).eq('read', false).gte('created_at', desde).order('created_at').limit(300)
  const candidatos = ((avisos ?? []) as Array<AvisoParaPush & { user_id: string }>).filter((a) => esReciente(a, ahora))
  if (candidatos.length === 0) return vacio('nada nuevo')
  const { data: yaEnviados } = await service.from('push_enviados').select('aviso_id').in('aviso_id', candidatos.map((a) => a.id))
  const enviadosAntes = new Set(((yaEnviados ?? []) as Array<{ aviso_id: string }>).map((e) => e.aviso_id))
  const nuevos = candidatos.filter((a) => !enviadosAntes.has(a.id))
  if (nuevos.length === 0) return vacio('nada nuevo')

  // Se reservan ANTES de mandar: si la pasada se solapa con otra, el aviso sale una sola vez
  const { data: reservados } = await service.from('push_enviados').upsert(nuevos.map((a) => ({ aviso_id: a.id })), { onConflict: 'aviso_id', ignoreDuplicates: true }).select('aviso_id')
  const mios = new Set(((reservados ?? []) as Array<{ aviso_id: string }>).map((r) => r.aviso_id))
  const r: ResumenDePush = { resumen: '', avisos: 0, enviados: 0, muertos: 0 }
  for (const a of nuevos.filter((x) => mios.has(x.id))) {
    r.avisos += 1
    const carga = cargaDePush(a)
    for (const s of lista.filter((x) => x.usuario_id === a.user_id && leToca(x.categoria, a))) {
      const res = await enviarA(s, carga, k)
      if (res === 'ok') r.enviados += 1
      else if (res === 'muerto') r.muertos += 1
    }
  }
  // Lo ya enviado hace más de un día no hace falta guardarlo
  await service.from('push_enviados').delete().lt('enviado_en', new Date(ahora - 86_400_000).toISOString())
  r.resumen = `${r.avisos} avisos · ${r.enviados} entregas${r.muertos ? ` · ${r.muertos} dispositivos dados de baja` : ''}`
  return r
}
