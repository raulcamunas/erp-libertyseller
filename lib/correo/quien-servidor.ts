import type { createServiceClient } from '@/lib/supabase/service'
import { PERMISO_CORREO_SUPERVISION, PERMISO_EQUIPO_COMERCIAL } from '@/lib/config/apps'
import { isMissingSchema } from '@/lib/plataforma/eventos'
import type { DatosDelDueno, QuienPide } from './acceso'
import type { FilaDeBuzon } from './almacen'
import { buzonesBloqueadosA, buzonesConcedidosA } from './lectores-servidor'

/**
 * QUIÉN PIDE, DE QUIÉN ES CADA BUZÓN Y EL RASTRO — SOLO SERVIDOR, SIN IMAP.
 * =========================================================================
 * Lo que necesita la regla de acceso (acceso.ts) para decidir, y el rastro de quien mira o envía desde un buzón que no es suyo.
 * Vive aparte de servidor.ts para que la campana, las preferencias y las asignaciones lo usen SIN cargar mailparser ni IMAP:
 * este fichero solo importa acceso, lectores-servidor, los tipos de almacen, la configuración de apps y isMissingSchema.
 * servidor.ts lo reexporta, así que quien hoy importa quienPide o registrarAcceso de servidor.ts no cambia.
 *
 * SIN LA MIGRACIÓN 318 NADA SE ROMPE: sin la tabla correo_buzon_asignaciones nadie tiene buzones asignados. Cualquier otro fallo al
 * leerla se propaga (como con los bloqueos): no se decide sobre lo que no se ha podido comprobar.
 */

type Servicio = ReturnType<typeof createServiceClient>

const nombreDe = (p: { full_name: string | null; email: string | null }): string => p.full_name?.trim() || p.email || 'Sin nombre'

export const CAMPOS_DE_BUZON =
  'id, user_id, direccion, nombre, usuario, proveedor, imap_host, imap_puerto, imap_seguro, smtp_host, smtp_puerto, smtp_seguro, desde_fecha, firma, vinculado_at, ultimo_sync_at, ultimo_intento_at, ultimo_error, fallos_seguidos, credenciales_invalidas, historico_completo, lectura_hasta'

/* ------------------------------------------------------------------ */
/* El buzón y sus dueños                                               */
/* ------------------------------------------------------------------ */

export async function cargarBuzon(service: Servicio, buzonId: string): Promise<FilaDeBuzon | null> {
  const { data, error } = await service.from('correo_buzones').select(CAMPOS_DE_BUZON).eq('id', buzonId).maybeSingle()
  if (error) throw new Error('No se ha podido leer el buzón.', { cause: error })
  return (data as FilaDeBuzon | null) ?? null
}

/** Lo que se sabe del dueño de un buzón: lo que pide la regla de acceso y, de paso, su nombre para la pantalla */
export interface DuenoLeido extends DatosDelDueno {
  nombre: string
}

/** Los dueños (perfiles) de estos ids, en una consulta. Quien no tenga perfil no sale en el mapa: la regla lo trata como dueño desconocido */
export async function leerDuenos(service: Servicio, userIds: string[]): Promise<Map<string, DuenoLeido>> {
  const ids = [...new Set(userIds)]
  if (ids.length === 0) return new Map()
  const { data, error } = await service.from('profiles').select('id, full_name, email, is_comercial, role').in('id', ids)
  if (error) throw new Error('No se han podido leer los dueños de los buzones.', { cause: error })
  const filas = (data ?? []) as Array<{ id: string; full_name: string | null; email: string | null; is_comercial: boolean | null; role: string | null }>
  return new Map(filas.map((p) => [p.id, { is_comercial: p.is_comercial ?? null, role: p.role ?? null, nombre: nombreDe(p) }]))
}

/* ------------------------------------------------------------------ */
/* Quién pide                                                          */
/* ------------------------------------------------------------------ */

/**
 * Los buzones que un administrador le ha ASIGNADO a esta persona (migración 318) y, de esos, en los que puede responder.
 * Sin la tabla, ninguno. Cualquier otro error se lanza.
 */
export async function buzonesAsignadosA(service: Servicio, userId: string): Promise<{ asignados: Set<string>; conRespuesta: Set<string> }> {
  const { data, error } = await service.from('correo_buzon_asignaciones').select('buzon_id, puede_responder').eq('persona_id', userId)
  if (error) {
    if (isMissingSchema(error)) return { asignados: new Set(), conRespuesta: new Set() }
    throw new Error('No se han podido comprobar los buzones asignados.', { cause: error })
  }
  const filas = (data ?? []) as Array<{ buzon_id: string; puede_responder: boolean | null }>
  return {
    asignados: new Set(filas.map((f) => f.buzon_id)),
    conRespuesta: new Set(filas.filter((f) => f.puede_responder === true).map((f) => f.buzon_id)),
  }
}

export async function quienPide(service: Servicio, sesion: { userId: string; role: string }): Promise<QuienPide> {
  // Un administrador lee sin pasar por ningún permiso, pero RESPONDER desde un buzón ajeno solo puede si se lo ha asignado: por eso se le cargan las asignaciones
  if (sesion.role === 'admin') {
    const { asignados, conRespuesta } = await buzonesAsignadosA(service, sesion.userId)
    return { ...sesion, tienePermisoEquipo: false, tienePermisoCorreo: false, buzonesAsignados: asignados, buzonesConRespuesta: conRespuesta }
  }
  // Un partner nunca tiene buzones asignados (la regla tampoco los contaría): ni se leen
  const esPartner = sesion.role === 'partner'
  const [permisos, concedidos, bloqueados, asignaciones] = await Promise.all([
    service.from('user_app_permissions').select('app_id, can_access').eq('user_id', sesion.userId).in('app_id', [PERMISO_EQUIPO_COMERCIAL, PERMISO_CORREO_SUPERVISION]),
    // Los buzones que un administrador le ha abierto a mano (migración 255). Sin la migración, ninguno
    buzonesConcedidosA(service, sesion.userId),
    // Y los que le ha BLOQUEADO (migración 260): no los lee por ningún permiso. Sin la migración, ninguno
    buzonesBloqueadosA(service, sesion.userId),
    // Y los que le ha ASIGNADO (migración 318). Sin la migración, ninguno
    esPartner ? Promise.resolve({ asignados: new Set<string>(), conRespuesta: new Set<string>() }) : buzonesAsignadosA(service, sesion.userId),
  ])
  if (permisos.error) throw new Error('No se ha podido comprobar el permiso.', { cause: permisos.error })
  const filas = (permisos.data ?? []) as Array<{ app_id: string; can_access: boolean | null }>
  const tiene = (id: string) => filas.some((f) => f.app_id === id && f.can_access === true)
  return {
    ...sesion,
    tienePermisoEquipo: tiene(PERMISO_EQUIPO_COMERCIAL),
    tienePermisoCorreo: tiene(PERMISO_CORREO_SUPERVISION),
    buzonesConcedidos: concedidos,
    buzonesBloqueados: bloqueados,
    buzonesAsignados: asignaciones.asignados,
    buzonesConRespuesta: asignaciones.conRespuesta,
  }
}

/* ------------------------------------------------------------------ */
/* El rastro de quien mira (o envía desde) buzones ajenos              */
/* ------------------------------------------------------------------ */

export const ACCESOS_RECIENTES = new Map<string, number>()
/** Mirar el mismo hilo (o la misma lista) varias veces seguidas deja UNA fila, no veinte */
const SIN_REPETIR_MS = 30 * 60_000

/** La columna `accion` de correo_accesos es texto libre (236): 'aviso' y 'envio' no necesitan migración */
export type AccionDeAcceso = 'lista' | 'hilo' | 'busqueda' | 'adjunto' | 'aviso' | 'envio'

/**
 * Apunta que alguien ha mirado un buzón que no es suyo, o ha enviado desde él. SI NO SE PUEDE APUNTAR, LANZA: la ruta no enseña el
 * buzón ni envía sin dejar rastro (cierra en vez de abrir). Solo hace falta cuando `porSupervision` es true.
 *
 *   · 'envio' nunca usa la caché: cada correo enviado deja su fila (y va ANTES de enviar).
 *   · 'aviso' deja una fila por persona y buzón cada 30 minutos, sea cual sea el hilo.
 *   · El resto, una por persona, buzón, acción e hilo cada 30 minutos.
 *   · `sinCache` fuerza la escritura (y no la apunta en la caché).
 */
export async function registrarAcceso(
  service: Servicio,
  quien: { userId: string; nombre: string },
  buzonId: string,
  accion: AccionDeAcceso,
  hilo?: { id: string | null; asunto: string } | null,
  opciones: { ahora?: number; sinCache?: boolean } = {}
): Promise<void> {
  const ahora = opciones.ahora ?? Date.now()
  const usaCache = accion !== 'envio' && opciones.sinCache !== true
  const clave = `${quien.userId}|${buzonId}|${accion}|${accion === 'aviso' ? '' : hilo?.id ?? ''}`
  if (usaCache) {
    const ultima = ACCESOS_RECIENTES.get(clave)
    if (ultima !== undefined && ahora - ultima < SIN_REPETIR_MS) return
  }

  const { error } = await service.from('correo_accesos').insert({
    buzon_id: buzonId,
    usuario_id: quien.userId,
    usuario_nombre: quien.nombre.slice(0, 200),
    accion,
    hilo_id: hilo?.id ?? null,
    asunto: hilo ? hilo.asunto.slice(0, 300) : null,
  })
  if (error) throw new Error('No se ha podido dejar constancia del acceso.', { cause: error })

  if (!usaCache) return
  ACCESOS_RECIENTES.set(clave, ahora)
  if (ACCESOS_RECIENTES.size > 5000) {
    for (const [k, t] of ACCESOS_RECIENTES) if (ahora - t >= SIN_REPETIR_MS) ACCESOS_RECIENTES.delete(k)
  }
}
