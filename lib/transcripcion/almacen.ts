import type { createServiceClient } from '@/lib/supabase/service'
import { esDia } from '@/lib/correo/secuencias/fechas'
import { isMissingSchema } from '@/lib/plataforma/eventos'
import { ESTADOS_QUE_SE_PUEDEN_TOCAR } from '@/lib/rellamada/reglas'
import { INTENTOS_MAXIMOS } from './reglas'
import { FALTA_MIGRACION_TURNOS, type Almacen, type AjustesDelMotor, type ContextoDeLaLlamada, type FalloParaGuardar, type FilaReservada, type LlamadaPendiente, type LlamadaSinTurnos, type ResultadoParaGuardar, type TranscripcionParaGuardar, type TurnosParaGuardar } from './motor'
import type { LeadParaRellamada } from './rellamada'
import { INTENTOS_DE_TURNOS } from './turnos'

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

/** Cuánto se espera entre un intento de separar quién habla y el siguiente de la misma llamada */
const MINUTOS_ENTRE_INTENTOS_DE_TURNOS = 10

export function almacenDeSupabase(service: Servicio, ahora: () => number = Date.now): Almacen {
  const iso = () => new Date(ahora()).toISOString()

  /** El nombre de la tienda y el del comercial, para decírselo a la IA. Si no se pueden leer se sigue sin ellos: no es motivo para fallar */
  async function nombresDeLaLlamada(leadId: string | null, userId: string): Promise<ContextoDeLaLlamada> {
    const [lead, perfil] = await Promise.all([
      leadId ? service.from('cold_leads').select('store_name, company').eq('id', leadId).maybeSingle() : Promise.resolve({ data: null }),
      service.from('profiles').select('full_name').eq('id', userId).maybeSingle(),
    ])
    const l = (lead.data as { store_name: string | null; company: string | null } | null) ?? null
    const p = (perfil.data as { full_name: string | null } | null) ?? null
    return { empresa: l?.store_name?.trim() || l?.company?.trim() || null, comercial: p?.full_name?.trim() || null }
  }

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
      // Sin estos nombres se transcribe igual, con peores pistas: no es motivo para fallar
      return nombresDeLaLlamada(llamada.lead_id, llamada.user_id)
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

    /* ---------------- la rellamada que pide el cliente ---------------- */

    async leadParaRellamada(leadId: string): Promise<LeadParaRellamada | null> {
      const { data, error } = await service.from('cold_leads').select('status, assigned_to, next_call_date').eq('id', leadId).maybeSingle()
      if (error) throw new Error('No se ha podido leer el lead de la llamada.', { cause: error })
      if (!data) return null
      const l = data as { status: string; assigned_to: string | null; next_call_date: string | null }
      return { status: l.status, assignedTo: l.assigned_to ?? null, nextCallDate: l.next_call_date ?? null }
    },

    async festivos(): Promise<string[]> {
      const { data, error } = await service.from('correo_secuencia_ajustes').select('festivos').eq('id', true).maybeSingle()
      // Sin la lista (la migración de las secuencias sin lanzar, un fallo): ninguno. Un festivo de más o de menos no merece perder la rellamada
      if (error || !data) return []
      const f = (data as { festivos?: unknown }).festivos
      return Array.isArray(f) ? f.filter((d): d is string => typeof d === 'string' && esDia(d)) : []
    },

    async ponerRellamada(leadId: string, fecha: string, hoy: string, ahora: number): Promise<'programado' | 'solo_fecha' | 'no'> {
      // Sin otra rellamada para más adelante (la habrá puesto el comercial al colgar): sin día, con uno de hoy o anterior, o ya este mismo
      const libre = `next_call_date.is.null,next_call_date.lte.${hoy},next_call_date.eq.${fecha}`
      const cuando = new Date(ahora).toISOString()
      const cambiado = await service
        .from('cold_leads')
        .update({ status: 'programado', next_call_date: fecha, updated_at: cuando })
        .eq('id', leadId)
        .in('status', [...ESTADOS_QUE_SE_PUEDEN_TOCAR])
        .or(libre)
        .select('id')
      if (cambiado.error) throw new Error('No se ha podido poner la rellamada del lead.', { cause: cambiado.error })
      if ((cambiado.data ?? []).length > 0) return 'programado'
      // Si ya lo lleva una persona («En seguimiento») solo se pone la fecha
      const soloFecha = await service.from('cold_leads').update({ next_call_date: fecha, updated_at: cuando }).eq('id', leadId).eq('status', 'seguimiento').or(libre).select('id')
      if (soloFecha.error) throw new Error('No se ha podido poner la rellamada del lead.', { cause: soloFecha.error })
      return (soloFecha.data ?? []).length > 0 ? 'solo_fecha' : 'no'
    },

    async apuntarNota(leadId: string, cuerpo: string, ocurrioAt: number): Promise<void> {
      // Sin autor: es del sistema y no cuenta para nadie en Rendimiento
      const { error } = await service.from('cold_lead_notes').insert({ lead_id: leadId, author_id: null, kind: 'nota', body: cuerpo.slice(0, 8000), occurred_at: new Date(ocurrioAt).toISOString(), es_respuesta: false })
      if (error) console.error('[transcripcion] no se ha podido apuntar una nota en el lead', { codigo: (error as { code?: string }).code ?? null })
    },

    /* ---------------- quién habla en la transcripción entera ---------------- */

    async pendientesDeTurnos(limite: number): Promise<LlamadaSinTurnos[]> {
      const haceUnRato = new Date(ahora() - MINUTOS_ENTRE_INTENTOS_DE_TURNOS * 60_000).toISOString()
      const { data, error } = await service
        .from('rinkel_transcripciones')
        .select('llamada_id, transcripcion, turnos_intentos')
        .eq('estado', 'hecha')
        .eq('tipo', 'conversacion')
        .is('turnos', null)
        .lt('turnos_intentos', INTENTOS_DE_TURNOS)
        .not('transcripcion', 'is', null)
        // Un intento fallado se espera un rato antes del siguiente
        .or(`turnos_intento_at.is.null,turnos_intento_at.lt.${haceUnRato}`)
        .order('hecha_at', { ascending: false })
        .limit(limite)
      if (error) {
        if (isMissingSchema(error)) throw new Error(FALTA_MIGRACION_TURNOS, { cause: error })
        throw new Error('No se ha podido pedir la lista de conversaciones por separar.', { cause: error })
      }
      const filas = (data ?? []) as Array<{ llamada_id: string; transcripcion: string; turnos_intentos: number | null }>
      if (filas.length === 0) return []

      // De qué llamada es cada una: sentido, duración, de quién y a qué lead
      const { data: llamadas, error: errorLlamadas } = await service.from('rinkel_llamadas').select('id, user_id, lead_id, direccion, duracion_s').in('id', filas.map((f) => f.llamada_id))
      if (errorLlamadas) throw new Error('No se han podido leer las llamadas por separar.', { cause: errorLlamadas })
      const porId = new Map(((llamadas ?? []) as Array<{ id: string; user_id: string; lead_id: string | null; direccion: string; duracion_s: number }>).map((l) => [l.id, l]))

      const salida: LlamadaSinTurnos[] = []
      for (const f of filas) {
        const l = porId.get(f.llamada_id)
        if (!l) continue
        const nombres = await nombresDeLaLlamada(l.lead_id, l.user_id)
        salida.push({ llamadaId: f.llamada_id, transcripcion: f.transcripcion, intentos: numero(f.turnos_intentos) ?? 0, direccion: l.direccion, duracionS: l.duracion_s, comercial: nombres.comercial, empresa: nombres.empresa })
      }
      return salida
    },

    async reservarTurnos(p: LlamadaSinTurnos): Promise<boolean> {
      // Compara y cambia en un solo paso: si otra pasada ya sumó su intento, el filtro de `turnos_intentos` no encuentra la fila y esta se queda sin ella
      const { data, error } = await service
        .from('rinkel_transcripciones')
        .update({ turnos_intentos: p.intentos + 1, turnos_intento_at: iso() })
        .eq('llamada_id', p.llamadaId)
        .eq('turnos_intentos', p.intentos)
        .is('turnos', null)
        .select('llamada_id')
      if (error) throw new Error('No se ha podido reservar la conversación para separarla.', { cause: error })
      return (data ?? []).length > 0
    },

    async guardarTurnos(llamadaId: string, t: TurnosParaGuardar): Promise<void> {
      const { error } = await service
        .from('rinkel_transcripciones')
        .update({ turnos: t.turnos, modelo_turnos: t.modelo, coste_turnos_usd: t.costeUsd, turnos_intento_at: iso(), actualizada_at: iso() })
        .eq('llamada_id', llamadaId)
      if (error) throw new Error('No se han podido guardar los turnos de la conversación.', { cause: error })
    },

    async devolverIntentoDeTurnos(llamadaId: string): Promise<void> {
      const { data } = await service.from('rinkel_transcripciones').select('turnos_intentos').eq('llamada_id', llamadaId).maybeSingle()
      const actuales = numero((data as { turnos_intentos?: unknown } | null)?.turnos_intentos)
      if (actuales === null) return
      // Sin hora de intento: la próxima pasada puede volver a probar en cuanto la cuenta de la IA funcione
      const { error } = await service.from('rinkel_transcripciones').update({ turnos_intentos: Math.max(0, actuales - 1), turnos_intento_at: null }).eq('llamada_id', llamadaId)
      // Es una gentileza (el intento solo se gasta de más): si falla no se rompe nada, pero se apunta para que no pase en silencio
      if (error) console.error('[transcripcion] no se ha podido devolver el intento de separar quién habla', { codigo: (error as { code?: string }).code ?? null })
    },

    async abandonarTurnos(llamadaId: string): Promise<void> {
      // Sin tocar `turnos` (sigue en NULL: la transcripción sale corrida) y con los intentos agotados, para que no vuelva a salir en la lista de pendientes
      const { error } = await service.from('rinkel_transcripciones').update({ turnos_intentos: INTENTOS_DE_TURNOS, turnos_intento_at: iso() }).eq('llamada_id', llamadaId).is('turnos', null)
      if (error) throw new Error('No se ha podido dejar la conversación sin separar.', { cause: error })
    },
  }
}
