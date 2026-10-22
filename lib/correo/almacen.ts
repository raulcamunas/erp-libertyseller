import type { createServiceClient } from '@/lib/supabase/service'
import type { Persona } from './direcciones'
import type { AdjuntoFicha } from './analizar'

/**
 * LO QUE LA LECTURA DEL CORREO NECESITA DE LA BASE DE DATOS — SOLO SERVIDOR.
 * ==========================================================================
 * `sincronizar.ts` y `enviar.ts` no hablan con Supabase: hablan con esta interfaz. Así su lógica (qué se pide al
 * servidor de correo, cómo se reparten los mensajes en hilos, qué pasa si algo falla a medias) se comprueba con una
 * base falsa en memoria, y aquí queda la única traducción a consultas de verdad.
 *
 * Cada método hace UNA cosa y lanza una excepción con el error original en `cause` si la base falla; nadie debe
 * enseñar ese error: lleva nombres de tablas y de columnas.
 */

type Servicio = ReturnType<typeof createServiceClient>

export type RolDeCarpeta = 'entrada' | 'enviados'

export interface FilaDeBuzon {
  id: string
  user_id: string
  direccion: string
  nombre: string | null
  usuario: string
  proveedor: string
  imap_host: string
  imap_puerto: number
  imap_seguro: boolean
  smtp_host: string
  smtp_puerto: number
  smtp_seguro: boolean
  desde_fecha: string
  firma: string | null
  vinculado_at: string
  ultimo_sync_at: string | null
  ultimo_intento_at: string | null
  ultimo_error: string | null
  fallos_seguidos: number
  credenciales_invalidas: boolean
  historico_completo: boolean
  lectura_hasta: string | null
}

export interface FilaDeCarpeta {
  id: string
  buzon_id: string
  ruta: string
  rol: RolDeCarpeta
  uidvalidity: number | null
  ultimo_sync_at: string | null
}

export interface HiloBasico {
  id: string
  participantes: string[]
  primerMensajeAt: string
  ultimoMensajeAt: string
}

/** Un mensaje tal y como entra en `correo_mensajes` */
export interface FilaDeMensaje {
  buzon_id: string
  hilo_id: string
  carpeta_id: string
  uid: number | null
  message_id: string | null
  en_respuesta_a: string | null
  referencias: string[]
  direccion: 'entrante' | 'saliente'
  de_nombre: string
  de_direccion: string
  para: Persona[]
  cc: Persona[]
  destinatarios: string
  responder_a: Persona[]
  automatico: boolean
  asunto: string
  fecha: string
  texto: string
  html: string | null
  vista_previa: string
  leido: boolean
  adjuntos: AdjuntoFicha[]
  tamano: number | null
}

export type CambiosDeBuzon = Partial<Pick<FilaDeBuzon, 'ultimo_sync_at' | 'ultimo_intento_at' | 'ultimo_error' | 'fallos_seguidos' | 'credenciales_invalidas' | 'historico_completo'>>

export interface Almacen {
  /** Reserva el buzón para esta lectura. false = ya lo está leyendo otra */
  tomarTurno(buzonId: string, hastaMs: number): Promise<boolean>
  soltarTurno(buzonId: string): Promise<void>
  anotarBuzon(buzonId: string, cambios: CambiosDeBuzon): Promise<void>

  /** La carpeta de ese rol, creándola si no existe y poniéndole la ruta que tiene ahora en el servidor */
  asegurarCarpeta(buzonId: string, rol: RolDeCarpeta, ruta: string): Promise<FilaDeCarpeta>
  anotarCarpeta(carpetaId: string, cambios: { uidvalidity?: number; ultimo_sync_at?: string }): Promise<void>
  /** El servidor ha cambiado su UIDVALIDITY: los UID guardados ya no valen. Se conservan los mensajes y se les quita el UID */
  despegarUids(carpetaId: string): Promise<void>
  uidsGuardados(carpetaId: string): Promise<number[]>

  hilosDeIds(buzonId: string, ids: string[]): Promise<HiloBasico[]>
  hilosPorAsunto(buzonId: string, clave: string): Promise<HiloBasico[]>
  crearHilo(buzonId: string, asunto: string, claveAsunto: string, fecha: Date): Promise<string>
  fusionarHilos(destino: string, origenes: string[]): Promise<void>
  actualizarHilo(hiloId: string): Promise<void>

  /** Cuántos mensajes de la carpeta no tienen UID: los enviados desde el ERP que el servidor no confirmó, o todos si cambió el UIDVALIDITY */
  contarSinUid(carpetaId: string): Promise<number>
  /**
   * Le pone su UID a un mensaje que ya teníamos sin él (mismo Message-ID y misma dirección) en vez de guardarlo otra
   * vez. Devuelve el hilo al que pertenece, o null si no había ninguno.
   */
  adoptarSinUid(buzonId: string, carpetaId: string, direccion: 'entrante' | 'saliente', messageId: string, uid: number): Promise<{ hiloId: string } | null>
  /** false = ya estaba (misma carpeta y mismo UID) */
  insertarMensaje(fila: FilaDeMensaje): Promise<boolean>

  noLeidosDeCarpeta(carpetaId: string, limite: number): Promise<Array<{ id: string; uid: number; hiloId: string }>>
  marcarLeidos(ids: string[]): Promise<void>
}

const fallo = (mensaje: string, causa: unknown): Error => new Error(mensaje, { cause: causa })

const POR_BLOQUE = 100

const CAMPOS_DE_HILO = 'id, participantes, primer_mensaje_at, ultimo_mensaje_at'
type FilaDeHilo = { id: string; participantes: string[] | null; primer_mensaje_at: string; ultimo_mensaje_at: string }
const hiloBasico = (f: FilaDeHilo): HiloBasico => ({
  id: f.id,
  participantes: f.participantes ?? [],
  primerMensajeAt: f.primer_mensaje_at,
  ultimoMensajeAt: f.ultimo_mensaje_at,
})

/** El UID se guarda como BIGINT: la API lo devuelve como número (nunca pasa de 2^32) */
const numero = (v: unknown): number => (typeof v === 'number' ? v : Number(v))

export function almacenSupabase(service: Servicio): Almacen {
  return {
    async tomarTurno(buzonId, hastaMs) {
      const ahora = new Date().toISOString()
      const { data, error } = await service
        .from('correo_buzones')
        .update({ lectura_hasta: new Date(hastaMs).toISOString() })
        .eq('id', buzonId)
        .or(`lectura_hasta.is.null,lectura_hasta.lt.${ahora}`)
        .select('id')
      if (error) throw fallo('No se ha podido reservar el buzón.', error)
      return (data ?? []).length > 0
    },

    async soltarTurno(buzonId) {
      const { error } = await service.from('correo_buzones').update({ lectura_hasta: null }).eq('id', buzonId)
      if (error) throw fallo('No se ha podido soltar el buzón.', error)
    },

    async anotarBuzon(buzonId, cambios) {
      const { error } = await service.from('correo_buzones').update(cambios).eq('id', buzonId)
      if (error) throw fallo('No se ha podido anotar el estado del buzón.', error)
    },

    async asegurarCarpeta(buzonId, rol, ruta) {
      const { data, error } = await service
        .from('correo_carpetas')
        .upsert({ buzon_id: buzonId, rol, ruta }, { onConflict: 'buzon_id,rol' })
        .select('id, buzon_id, ruta, rol, uidvalidity, ultimo_sync_at')
        .single()
      if (error || !data) throw fallo('No se ha podido guardar la carpeta.', error)
      const f = data as FilaDeCarpeta & { uidvalidity: number | string | null }
      return { ...f, uidvalidity: f.uidvalidity === null ? null : numero(f.uidvalidity) }
    },

    async anotarCarpeta(carpetaId, cambios) {
      const { error } = await service.from('correo_carpetas').update(cambios).eq('id', carpetaId)
      if (error) throw fallo('No se ha podido anotar la carpeta.', error)
    },

    async despegarUids(carpetaId) {
      const { error } = await service.from('correo_mensajes').update({ uid: null }).eq('carpeta_id', carpetaId)
      if (error) throw fallo('No se han podido despegar los UID de la carpeta.', error)
    },

    async uidsGuardados(carpetaId) {
      const { data, error } = await service.rpc('correo_uids', { p_carpeta: carpetaId })
      if (error) throw fallo('No se han podido leer los UID guardados.', error)
      return ((data ?? []) as Array<number | string>).map(numero)
    },

    async hilosDeIds(buzonId, ids) {
      if (ids.length === 0) return []
      const { data, error } = await service.rpc('correo_buscar_hilos', { p_buzon: buzonId, p_ids: ids })
      if (error) throw fallo('No se han podido buscar los hilos.', error)
      const encontrados = [...new Set(((data ?? []) as Array<{ hilo_id: string }>).map((f) => f.hilo_id))]
      if (encontrados.length === 0) return []
      const { data: hilos, error: errorHilos } = await service.from('correo_hilos').select(CAMPOS_DE_HILO).in('id', encontrados)
      if (errorHilos) throw fallo('No se han podido leer los hilos.', errorHilos)
      return ((hilos ?? []) as FilaDeHilo[]).map(hiloBasico)
    },

    async hilosPorAsunto(buzonId, clave) {
      const { data, error } = await service
        .from('correo_hilos')
        .select(CAMPOS_DE_HILO)
        .eq('buzon_id', buzonId)
        .eq('clave_asunto', clave)
        .order('ultimo_mensaje_at', { ascending: false })
        .limit(25)
      if (error) throw fallo('No se han podido buscar hilos por asunto.', error)
      return ((data ?? []) as FilaDeHilo[]).map(hiloBasico)
    },

    async crearHilo(buzonId, asunto, claveAsunto, fecha) {
      const iso = fecha.toISOString()
      const { data, error } = await service
        .from('correo_hilos')
        .insert({ buzon_id: buzonId, asunto, clave_asunto: claveAsunto, primer_mensaje_at: iso, ultimo_mensaje_at: iso })
        .select('id')
        .single()
      if (error || !data) throw fallo('No se ha podido crear el hilo.', error)
      return (data as { id: string }).id
    },

    async fusionarHilos(destino, origenes) {
      const { error } = await service.rpc('correo_fusionar_hilos', { p_destino: destino, p_origenes: origenes })
      if (error) throw fallo('No se han podido fusionar los hilos.', error)
    },

    async actualizarHilo(hiloId) {
      const { error } = await service.rpc('correo_actualizar_hilo', { p_hilo: hiloId })
      if (error) throw fallo('No se ha podido recalcular el hilo.', error)
    },

    async contarSinUid(carpetaId) {
      const { count, error } = await service
        .from('correo_mensajes')
        .select('id', { count: 'exact', head: true })
        .eq('carpeta_id', carpetaId)
        .is('uid', null)
      if (error) throw fallo('No se han podido contar los mensajes sin UID.', error)
      return count ?? 0
    },

    async adoptarSinUid(buzonId, carpetaId, direccion, messageId, uid) {
      // Uno solo: dos filas con el mismo Message-ID y sin UID no deberían existir, pero si existen se adopta una y la otra espera
      const { data: candidatos, error: errorBusqueda } = await service
        .from('correo_mensajes')
        .select('id, hilo_id')
        .eq('buzon_id', buzonId)
        .eq('carpeta_id', carpetaId)
        .eq('message_id', messageId)
        .eq('direccion', direccion)
        .is('uid', null)
        .limit(1)
      if (errorBusqueda) throw fallo('No se ha podido buscar el mensaje sin UID.', errorBusqueda)
      const fila = ((candidatos ?? []) as Array<{ id: string; hilo_id: string }>)[0]
      if (!fila) return null

      const { error } = await service.from('correo_mensajes').update({ uid }).eq('id', fila.id)
      if (error) {
        // Otro mensaje ya ocupa ese UID en la carpeta: no hay nada que adoptar
        if ((error as { code?: string }).code === '23505') return null
        throw fallo('No se ha podido emparejar el mensaje con su UID.', error)
      }
      return { hiloId: fila.hilo_id }
    },

    async insertarMensaje(fila) {
      const { data, error } = await service
        .from('correo_mensajes')
        .upsert(fila, { onConflict: 'carpeta_id,uid', ignoreDuplicates: true })
        .select('id')
      if (error) throw fallo('No se ha podido guardar el mensaje.', error)
      return (data ?? []).length > 0
    },

    async noLeidosDeCarpeta(carpetaId, limite) {
      const { data, error } = await service
        .from('correo_mensajes')
        .select('id, uid, hilo_id')
        .eq('carpeta_id', carpetaId)
        .eq('leido', false)
        .not('uid', 'is', null)
        .order('uid', { ascending: false })
        .limit(limite)
      if (error) throw fallo('No se han podido leer los mensajes sin leer.', error)
      return ((data ?? []) as Array<{ id: string; uid: number | string; hilo_id: string }>).map((f) => ({ id: f.id, uid: numero(f.uid), hiloId: f.hilo_id }))
    },

    async marcarLeidos(ids) {
      for (let i = 0; i < ids.length; i += POR_BLOQUE) {
        const { error } = await service.from('correo_mensajes').update({ leido: true }).in('id', ids.slice(i, i + POR_BLOQUE))
        if (error) throw fallo('No se han podido marcar como leídos.', error)
      }
    },
  }
}
