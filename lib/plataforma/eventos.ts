/**
 * EVENTOS: FALLOS RUIDOSOS, NUNCA SILENCIOSOS
 * ===========================================
 * SOLO SERVIDOR: importa el cliente de service_role.
 *
 * La regla general de la plataforma, literal en la especificación: «un error
 * silencioso cuesta ventas reales de clientes que nos pagan». Esta es la puerta
 * por la que un fallo pasa de ser un `console.error` que nadie lee a ser una
 * fila con severidad, cliente, SKU y una frase en español, y —si hace falta— un
 * aviso en la campana.
 *
 *
 * TRES DECISIONES QUE PARECEN DETALLES Y NO LO SON
 * -----------------------------------------------
 *
 * 1. registrarEvento() NUNCA LANZA. Se llama desde dentro de manejadores de
 *    error, y un fallo al registrar el fallo taparía el fallo original, que es
 *    el que explica lo que pasó de verdad. Devuelve el id o null.
 *
 * 2. LA HUELLA ES OBLIGATORIA EN LA PRÁCTICA aunque la columna admita null. Es
 *    lo que distingue «acaba de pasar algo» de «sigue pasando lo mismo», y sin
 *    ella un trabajo que falla cada cinco minutos durante una noche deja 96
 *    avisos idénticos en la campana. Noventa y seis avisos idénticos son cero
 *    avisos: se deja de mirar. El filtro lo hace el trigger de la migración 123,
 *    no este fichero, para que valga también para quien inserte por otra vía.
 *
 * 3. NADA DE CREDENCIALES EN `detalle` NI EN `mensaje`. Estas filas se leen en
 *    la pantalla y salen en respuestas de API. Los mensajes de error de Amazon
 *    ya vienen limpios de lib/amazon/errors.ts; lo que se añada a mano aquí hay
 *    que mirarlo dos veces.
 */

import { createServiceClient } from '@/lib/supabase/service'
import type { AmazonEvento, EventoSeveridad, ResolucionEvento } from './tipos'

/** Distingue «la migración 123 no está lanzada» de cualquier otro error */
export function isMissingSchema(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code
  return (
    code === 'PGRST205' || // PostgREST: la tabla no está en su caché de esquema
    code === '42P01' || //    Postgres: undefined_table
    code === 'PGRST204' || // PostgREST: la columna no está en su caché
    code === '42703' //       Postgres: undefined_column
  )
}

export interface EventoNuevo {
  /** Código estable en minúsculas: 'cupo_agotado', 'tope_activos_alcanzado' */
  tipo: string
  severidad?: EventoSeveridad
  clientId?: string | null
  connectionId?: string | null
  marketplaceId?: string | null
  sku?: string | null
  asin?: string | null
  jobId?: string | null
  /** En español, redactado y con sus números. Es lo que va a leer una persona */
  mensaje: string
  detalle?: unknown
  /** x-amzn-RequestId. Lo único que acepta el soporte de Amazon */
  requestId?: string | null
  /**
   * Identifica la SITUACIÓN, no el suceso. Si no se pasa, se construye con
   * tipo + conexión + marketplace + sku, que es lo correcto casi siempre.
   */
  huella?: string | null
  /** Quién lo provocó. null = un proceso automático. Cuando hay persona, la
      campana no suena: está mirando la pantalla */
  createdBy?: string | null
}

/**
 * Construye una huella a partir de trozos.
 *
 * Los nulos se saltan en vez de convertirse en 'null': si no, dos eventos del
 * mismo problema —uno con SKU y otro sin— tendrían huellas distintas y los dos
 * sonarían.
 */
export function huellaDe(...partes: Array<string | null | undefined>): string {
  return partes
    .map((p) => (p ?? '').trim())
    .filter((p) => p !== '')
    .join('·')
}

/**
 * Deja constancia de algo que ha pasado.
 *
 * NUNCA LANZA. Ver la nota 1 de la cabecera.
 */
export async function registrarEvento(evento: EventoNuevo): Promise<string | null> {
  try {
    const service = createServiceClient()
    const huella =
      evento.huella ??
      huellaDe(evento.tipo, evento.connectionId, evento.marketplaceId, evento.sku)

    const { data, error } = await service
      .from('amazon_eventos')
      .insert({
        tipo: evento.tipo,
        severidad: evento.severidad ?? 'aviso',
        client_id: evento.clientId ?? null,
        connection_id: evento.connectionId ?? null,
        marketplace_id: evento.marketplaceId ?? null,
        sku: evento.sku ?? null,
        asin: evento.asin ?? null,
        job_id: evento.jobId ?? null,
        // Recortado: la columna es TEXT y aguanta lo que sea, pero un mensaje de
        // cuatro mil caracteres en una cola de incidencias no lo lee nadie. El
        // detalle largo va en `detalle`, que es JSONB y no se pinta en la lista.
        mensaje: evento.mensaje.slice(0, 2000),
        detalle: evento.detalle ?? null,
        request_id: evento.requestId ?? null,
        huella,
        created_by: evento.createdBy ?? null,
      })
      .select('id')
      .single()

    if (error) throw error
    return (data as { id: string }).id
  } catch (error) {
    if (isMissingSchema(error)) {
      console.error(
        '[plataforma] no se ha podido registrar un evento: falta lanzar ' +
          '123_plataforma_a1.sql en el editor SQL de Supabase. El evento era: ' +
          evento.mensaje
      )
      return null
    }
    console.error('[plataforma] no se ha podido registrar el evento:', error)
    return null
  }
}

/** Varios de golpe. Mismo contrato: nunca lanza, devuelve cuántos entraron */
export async function registrarEventos(eventos: EventoNuevo[]): Promise<number> {
  if (eventos.length === 0) return 0
  let entraron = 0
  for (const evento of eventos) {
    const id = await registrarEvento(evento)
    if (id !== null) entraron += 1
  }
  return entraron
}

export interface FiltroEventos {
  clientId?: string
  connectionId?: string
  sku?: string
  jobId?: string
  severidades?: EventoSeveridad[]
  soloAbiertos?: boolean
  limite?: number
}

/**
 * La cola de incidencias.
 *
 * Se filtra EN LA BASE y con un límite, no trayéndoselo todo al navegador: esta
 * tabla crece para siempre y traérsela entera funciona el primer mes y deja de
 * funcionar justo cuando empieza a servir para algo. Es la misma lección que ya
 * está escrita en loadSubmissions() de lib/amazon/data.ts.
 */
export async function cargarEventos(filtro: FiltroEventos = {}): Promise<AmazonEvento[]> {
  const service = createServiceClient()
  let consulta = service.from('amazon_eventos').select('*')

  if (filtro.clientId) consulta = consulta.eq('client_id', filtro.clientId)
  if (filtro.connectionId) consulta = consulta.eq('connection_id', filtro.connectionId)
  if (filtro.sku) consulta = consulta.eq('sku', filtro.sku)
  if (filtro.jobId) consulta = consulta.eq('job_id', filtro.jobId)
  if (filtro.severidades && filtro.severidades.length > 0) {
    consulta = consulta.in('severidad', filtro.severidades)
  }
  if (filtro.soloAbiertos) consulta = consulta.eq('resuelto', false)

  const { data, error } = await consulta
    .order('created_at', { ascending: false })
    // El desempate por id no es cosmético: dos eventos del mismo instante
    // —pasa cuando un lote entero falla— saldrían en un orden distinto en cada
    // recarga de la pantalla.
    .order('id', { ascending: false })
    .limit(filtro.limite ?? 200)

  if (error) throw error
  return (data ?? []) as AmazonEvento[]
}

/**
 * Cierra un evento.
 *
 * El motivo es OBLIGATORIO —lo exige también el CHECK de la migración— porque
 * cerrar sin motivo convierte la cola en un botón de «vale». Y 'ignorado' es una
 * resolución legítima: lo que no puede pasar es que no se distinga de
 * 'arreglado', porque entonces el histórico de incidencias miente.
 */
export async function resolverEvento(
  eventoId: string,
  params: { userId: string | null; resolucion: ResolucionEvento; motivo: string }
): Promise<boolean> {
  const motivo = params.motivo.trim()
  if (motivo === '') {
    throw new Error('Hay que decir por qué se cierra el evento')
  }

  const service = createServiceClient()
  const { data, error } = await service
    .from('amazon_eventos')
    .update({
      resuelto: true,
      resuelto_at: new Date().toISOString(),
      resuelto_por: params.userId,
      resolucion: params.resolucion,
      resuelto_motivo: motivo,
    })
    .eq('id', eventoId)
    // Solo si sigue abierto: reabrir y volver a cerrar borraría quién lo cerró
    // la primera vez.
    .eq('resuelto', false)
    .select('id')

  if (error) throw error
  return (data ?? []).length > 0
}
