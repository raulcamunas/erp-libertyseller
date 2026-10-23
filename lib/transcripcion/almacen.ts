import type { createServiceClient } from '@/lib/supabase/service'
import { isMissingSchema } from '@/lib/plataforma/eventos'
import { INTENTOS_MAXIMOS } from './reglas'
import type { Almacen, AjustesDelMotor, ContextoDeLaLlamada, FalloParaGuardar, FilaReservada, LlamadaPendiente, ResultadoParaGuardar, TranscripcionParaGuardar } from './motor'

/**
 * LO QUE EL MOTOR LEE Y ESCRIBE EN SUPABASE.
 * ==========================================
 * SOLO SERVIDOR. Con la clave de servicio: las tablas de la migración 244 están cerradas al navegador y estas lecturas y escrituras
 * saltan sus políticas (el motor trabaja con las llamadas de TODOS los comerciales). La lógica de qué hacer con cada llamada está en
 * motor.ts; aquí no se decide nada, solo se habla con la base.
 *
 * Los errores salen como frases nuestras: una migración sin lanzar se dice con el nombre del fichero (la pantalla de Sistema lo enseña) y el
 * resto, sin el cuerpo de la respuesta.
 */

type Servicio = ReturnType<typeof createServiceClient>

export const FALTA_MIGRACION_TRANSCRIPCION =
  'Falta lanzar la migración 244_rinkel_transcripciones.sql en el editor SQL de Supabase: hasta entonces no se transcribe ninguna llamada.'

/** Una reserva «procesando» de más de estos minutos se da por muerta (coincide con el SQL de la migración 244) */
const MINUTOS_DE_RESERVA = 10

function fallo(frase: string, error: unknown): never {
  if (isMissingSchema(error)) throw new Error(FALTA_MIGRACION_TRANSCRIPCION, { cause: error })
  throw new Error(frase, { cause: error })
}

const numero = (x: unknown): number | null => {
  const n = typeof x === 'number' ? x : typeof x === 'string' && x.trim() !== '' ? Number(x) : NaN
  return Number.isFinite(n) ? n : null
}

export function almacenDeSupabase(service: Servicio, ahora: () => number = Date.now): Almacen {
  const iso = () => new Date(ahora()).toISOString()

  return {
    async leerAjustes(): Promise<AjustesDelMotor> {
      const { data, error } = await service.from('rinkel_transcripcion_ajustes').select('desde, minimo_segundos, tope_diario_minutos').eq('id', true).maybeSingle()
      if (error) fallo('No se han podido leer los ajustes de la transcripción.', error)
      if (!data) throw new Error('Falta la fila de ajustes de la transcripción: vuelve a lanzar la migración 244_rinkel_transcripciones.sql.')
      const a = data as { desde: string; minimo_segundos: number; tope_diario_minutos: number }
      return { desde: a.desde, minimo_segundos: a.minimo_segundos, tope_diario_minutos: a.tope_diario_minutos }
    },

    async segundosDeLasUltimas24Horas(): Promise<number> {
      const desde = new Date(ahora() - 24 * 3_600_000).toISOString()
      const { data, error } = await service.from('rinkel_transcripciones').select('segundos_audio').gte('transcrita_at', desde).limit(1000)
      if (error) fallo('No se ha podido sumar lo transcrito hoy.', error)
      return ((data ?? []) as Array<{ segundos_audio: number | null }>).reduce((suma, f) => suma + (f.segundos_audio ?? 0), 0)
    },

    async cerrarAbandonadas(): Promise<void> {
      const { error } = await service
        .from('rinkel_transcripciones')
        .update({ estado: 'fallida', motivo: 'Se interrumpió varias veces y no se pudo terminar.', siguiente_intento_at: null, bloqueada_at: null, actualizada_at: iso() })
        .eq('estado', 'procesando')
        .gte('intentos', INTENTOS_MAXIMOS)
        .lt('bloqueada_at', new Date(ahora() - MINUTOS_DE_RESERVA * 60_000).toISOString())
      // No es crítico: si no se puede cerrar ahora, se cerrará en la próxima pasada
      if (error && !isMissingSchema(error)) console.error('[transcripcion] no se han podido cerrar las reservas abandonadas', { codigo: (error as { code?: string }).code ?? null })
    },

    async pendientes(ajustes: AjustesDelMotor, limite: number): Promise<LlamadaPendiente[]> {
      const { data, error } = await service.rpc('rinkel_transcripciones_pendientes', {
        p_desde: ajustes.desde,
        p_minimo: ajustes.minimo_segundos,
        p_limite: limite,
        p_bloqueo_min: MINUTOS_DE_RESERVA,
        p_max_intentos: INTENTOS_MAXIMOS,
      })
      if (error) fallo('No se ha podido pedir la lista de llamadas por transcribir.', error)
      return ((data ?? []) as LlamadaPendiente[]).map((f) => ({
        id: f.id,
        user_id: f.user_id,
        lead_id: f.lead_id,
        fecha: f.fecha,
        direccion: f.direccion,
        duracion_s: f.duracion_s,
        grabacion_id: f.grabacion_id,
        intentos: f.intentos,
      }))
    },

    async reservar(llamada: LlamadaPendiente): Promise<FilaReservada | null> {
      const { data, error } = await service.rpc('rinkel_transcripcion_reclamar', {
        p_llamada: llamada.id,
        p_user: llamada.user_id,
        p_bloqueo_min: MINUTOS_DE_RESERVA,
        p_max_intentos: INTENTOS_MAXIMOS,
      })
      if (error) fallo('No se ha podido reservar la llamada.', error)
      const fila = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null | undefined
      if (!fila) return null
      return {
        intentos: numero(fila.intentos) ?? 1,
        transcripcion: typeof fila.transcripcion === 'string' ? fila.transcripcion : null,
        segundos_audio: numero(fila.segundos_audio),
        idioma: typeof fila.idioma === 'string' ? fila.idioma : null,
        modelo_voz: typeof fila.modelo_voz === 'string' ? fila.modelo_voz : null,
        coste_voz_usd: numero(fila.coste_voz_usd),
      }
    },

    async contexto(llamada: LlamadaPendiente): Promise<ContextoDeLaLlamada> {
      const [lead, perfil] = await Promise.all([
        service.from('cold_leads').select('store_name, company').eq('id', llamada.lead_id).maybeSingle(),
        service.from('profiles').select('full_name').eq('id', llamada.user_id).maybeSingle(),
      ])
      // Sin estos nombres se transcribe igual, con peores pistas: no es motivo para fallar
      const l = (lead.data as { store_name: string | null; company: string | null } | null) ?? null
      const p = (perfil.data as { full_name: string | null } | null) ?? null
      return { empresa: l?.store_name?.trim() || l?.company?.trim() || null, comercial: p?.full_name?.trim() || null }
    },

    async guardarTranscripcion(llamadaId: string, t: TranscripcionParaGuardar): Promise<void> {
      const { error } = await service
        .from('rinkel_transcripciones')
        .update({ transcripcion: t.texto, idioma: t.idioma, segundos_audio: t.segundos, transcrita_at: iso(), modelo_voz: t.modelo, coste_voz_usd: t.costeUsd, actualizada_at: iso() })
        .eq('llamada_id', llamadaId)
      if (error) fallo('No se ha podido guardar la transcripción.', error)
    },

    async guardarResultado(llamadaId: string, r: ResultadoParaGuardar): Promise<void> {
      const { error } = await service
        .from('rinkel_transcripciones')
        .update({
          estado: 'hecha',
          motivo: null,
          bloqueada_at: null,
          siguiente_intento_at: null,
          hecha_at: iso(),
          actualizada_at: iso(),
          // Por si la primera vez no se pudo guardar: se escribe otra vez junto con el resultado
          transcripcion: r.transcripcion.texto,
          idioma: r.transcripcion.idioma,
          segundos_audio: r.transcripcion.segundos,
          transcrita_at: iso(),
          modelo_voz: r.transcripcion.modelo,
          coste_voz_usd: r.transcripcion.costeUsd,
          tipo: r.tipo,
          resumen: r.resumen,
          linea: r.linea,
          siguiente_paso: r.siguiente_paso,
          interes: r.interes,
          modelo_texto: r.modeloTexto,
          coste_texto_usd: r.costeTextoUsd,
        })
        .eq('llamada_id', llamadaId)
      if (error) fallo('No se ha podido guardar el resumen de la llamada.', error)
    },

    async marcarFallo(llamadaId: string, f: FalloParaGuardar): Promise<void> {
      const cambios: Record<string, unknown> = { estado: f.estado, motivo: f.motivo.slice(0, 300), siguiente_intento_at: f.siguienteIntentoAt, bloqueada_at: null, actualizada_at: iso() }
      if (f.devolverIntento) {
        // La llamada no tiene la culpa (la cuenta de la IA falla): el intento no cuenta
        const { data } = await service.from('rinkel_transcripciones').select('intentos').eq('llamada_id', llamadaId).maybeSingle()
        const actuales = numero((data as { intentos?: unknown } | null)?.intentos)
        if (actuales !== null) cambios.intentos = Math.max(0, actuales - 1)
      }
      const { error } = await service.from('rinkel_transcripciones').update(cambios).eq('llamada_id', llamadaId)
      if (error) fallo('No se ha podido apuntar el fallo de la llamada.', error)
    },
  }
}
