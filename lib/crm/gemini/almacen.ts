import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAll, trocear } from '@/lib/supabase/paginacion'
import type { CrmStage } from '@/lib/types/crm'
import type { DatosDelAnalisis } from './analisis'
import type { CandidatoDeCita } from './casar'
import type { AlmacenDeNotas, CambiosDeNota, NotaGuardada, NotaNueva } from './sincronizar'
import type { PasoDeNota, TemaDeNota } from './tipos'

/**
 * LAS NOTAS DE GEMINI EN LA BASE: LA CARA DE SUPABASE DEL ALMACÉN.
 * =================================================================
 * Implementa `AlmacenDeNotas` (sincronizar.ts) sobre `crm_notas_reunion` (migración 258) con la clave de servicio: es lo que usan el cron, el botón «Sincronizar ahora» y las
 * rutas de reanalizar y asignar. Nadie escribe en esa tabla desde el navegador (no tiene políticas de escritura).
 *
 * SI LA MIGRACIÓN NO ESTÁ LANZADA, el error es `FaltaLaMigracion` y no un 500 cualquiera: las migraciones de este ERP se lanzan a mano en el editor de Supabase y el código
 * llega antes. La ruta del cron se salta la pasada sin ruido y la pantalla dice qué SQL falta.
 */

import { esTablaInexistente, FALTA_MIGRACION_258 } from '../migracion'

export { esTablaInexistente }
export const FALTA_MIGRACION_NOTAS = FALTA_MIGRACION_258

export class FaltaLaMigracion extends Error {
  constructor() {
    super(FALTA_MIGRACION_NOTAS)
    this.name = 'FaltaLaMigracion'
  }
}

function fallo(error: unknown): Error {
  if (esTablaInexistente(error)) return new FaltaLaMigracion()
  const e = error as { message?: string }
  return new Error(e?.message ?? 'Error de la base de datos')
}

const COLUMNAS_GUARDADA = 'id, estado, client_id, appointment_id, metodo_cita, gmail_message_id, drive_file_id, google_event_id, titulo, fecha_reunion, invitados, completa, analisis_intentos, error, creada_en'

interface FichaConCita {
  id: string
  appointment_id: string | null
  lead_name: string | null
  lead_email: string | null
  appointment: { id: string | null; google_event_id: string | null; lead_name: string | null; lead_email: string | null; start_time: string | null } | Array<{ id: string | null; google_event_id: string | null; lead_name: string | null; lead_email: string | null; start_time: string | null }> | null
}

export function almacenDeSupabase(db: SupabaseClient): AlmacenDeNotas {
  const tabla = () => db.from('crm_notas_reunion')

  return {
    async conocidos(ids) {
      const vistos = new Set<string>()
      for (const trozo of trocear(ids, 100)) {
        const { data, error } = await tabla().select('gmail_message_id').in('gmail_message_id', trozo)
        if (error) throw fallo(error)
        for (const f of data ?? []) if (f.gmail_message_id) vistos.add(f.gmail_message_id as string)
      }
      return vistos
    },

    async candidatos() {
      let filas: FichaConCita[]
      try {
        filas = await fetchAll<FichaConCita>((desde, hasta) =>
          db
            .from('crm_clients')
            .select('id, appointment_id, lead_name, lead_email, appointment:appointments!crm_clients_appointment_id_fkey(id, google_event_id, lead_name, lead_email, start_time)')
            .order('id', { ascending: true })
            .range(desde, hasta)
        )
      } catch (error) {
        throw fallo(error)
      }
      return filas.map((f): CandidatoDeCita => {
        const cita = Array.isArray(f.appointment) ? (f.appointment[0] ?? null) : f.appointment
        // Los datos buenos son los de la cita si la hay (igual que crmContact en lib/types/crm.ts)
        return {
          clientId: f.id,
          appointmentId: f.appointment_id,
          googleEventId: cita?.google_event_id ?? null,
          email: cita?.lead_email ?? f.lead_email,
          nombre: cita?.lead_name ?? f.lead_name,
          inicio: cita?.start_time ?? null,
        }
      })
    },

    async insertar(nota: NotaNueva) {
      const { error } = await tabla().insert(nota)
      if (!error) return 'creada'
      // El índice único por correo o por documento: ya estaba (otra pasada, o dos a la vez)
      if ((error as { code?: string }).code === '23505') return 'repetida'
      throw fallo(error)
    },

    async incompletas(desdeIso, max) {
      const { data, error } = await tabla()
        .select(COLUMNAS_GUARDADA)
        .eq('completa', false)
        .not('drive_file_id', 'is', null)
        .neq('estado', 'ignorada')
        .gte('creada_en', desdeIso)
        .order('creada_en', { ascending: false })
        .limit(max)
      if (error) throw fallo(error)
      return (data ?? []) as NotaGuardada[]
    },

    async sinCita(desdeIso, max) {
      const { data, error } = await tabla().select(COLUMNAS_GUARDADA).eq('estado', 'sin_cita').gte('creada_en', desdeIso).order('creada_en', { ascending: false }).limit(max)
      if (error) throw fallo(error)
      return (data ?? []) as NotaGuardada[]
    },

    async pendientesDeAnalisis(max, reintentarAntesDeIso) {
      const { data, error } = await tabla()
        .select(COLUMNAS_GUARDADA)
        .eq('estado', 'pendiente')
        .not('client_id', 'is', null)
        .or(`error.is.null,actualizada_en.lt.${reintentarAntesDeIso}`)
        .order('fecha_reunion', { ascending: false, nullsFirst: false })
        .limit(max)
      if (error) throw fallo(error)
      return (data ?? []) as NotaGuardada[]
    },

    async actualizar(id, cambios: CambiosDeNota) {
      const { error } = await tabla().update(cambios).eq('id', id)
      if (error) throw fallo(error)
    },

    async datosParaAnalizar(id) {
      const { data: nota, error } = await tabla().select('titulo, fecha_reunion, resumen, temas, proximos_pasos, detalle, transcripcion, client_id').eq('id', id).maybeSingle()
      if (error) throw fallo(error)
      if (!nota) return null

      let ficha: DatosDelAnalisis['ficha']
      let respuestasDelGuion: Record<string, string> | undefined
      if (nota.client_id) {
        const { data: cliente } = await db
          .from('crm_clients')
          .select('lead_name, lead_company, stage, preguntas, appointment:appointments!crm_clients_appointment_id_fkey(lead_name, lead_company)')
          .eq('id', nota.client_id)
          .maybeSingle()
        if (cliente) {
          const cita = (Array.isArray(cliente.appointment) ? cliente.appointment[0] : cliente.appointment) as { lead_name?: string | null; lead_company?: string | null } | null | undefined
          ficha = { nombre: cita?.lead_name ?? (cliente.lead_name as string | null), empresa: cita?.lead_company ?? (cliente.lead_company as string | null), fase: (cliente.stage as CrmStage | null) ?? null }
          respuestasDelGuion = (cliente.preguntas as Record<string, string> | null) ?? undefined
        }
      }

      return {
        titulo: nota.titulo as string,
        fechaReunion: (nota.fecha_reunion as string | null) ?? null,
        resumen: (nota.resumen as string | null) ?? null,
        temas: ((nota.temas as TemaDeNota[] | null) ?? []),
        proximosPasos: ((nota.proximos_pasos as PasoDeNota[] | null) ?? []),
        detalle: (nota.detalle as string | null) ?? null,
        transcripcion: (nota.transcripcion as string | null) ?? null,
        ficha,
        respuestasDelGuion,
      }
    },
  }
}
