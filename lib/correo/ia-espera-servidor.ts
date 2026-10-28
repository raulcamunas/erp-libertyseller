import { hasTokenKey } from '@/lib/amazon/crypto'
import { leerConfigCron } from '@/lib/sistema/cron'
import type { createServiceClient } from '@/lib/supabase/service'
import { ejecutarPasada } from '@/lib/transcripcion/servidor'
import type { LlamadaParaIa } from './ia-contexto'
import { AVISO_TRANSCRIPCION_PENDIENTE, esperarLaTranscripcion, hayTranscripcionPendiente } from './ia-espera'

/**
 * ESPERAR A LA TRANSCRIPCIÓN DE LA LLAMADA QUE ACABA DE TERMINAR, CON LOS SERVICIOS DE VERDAD. SOLO SERVIDOR.
 * ===========================================================================================================
 * Junta la espera (ia-espera.ts, que decide cuánto y cuándo) con el proceso que transcribe las llamadas (lib/transcripcion/servidor.ts). Lo llama
 * «Redactar con IA» cuando el comercial pide el borrador justo después de colgar.
 *
 * LO QUE NO SE SALTA: es el MISMO trabajo que haría el proceso automático dos minutos después, no uno nuevo, así que no cambia lo que se gasta.
 *   · Si en Sistema está APAGADO «rinkel-transcribir» (es el interruptor del gasto) no se espera ni se adelanta nada, y tampoco se avisa de que «se
 *     está transcribiendo»: no va a llegar.
 *   · Se respetan los topes de siempre (el diario de minutos de audio, los intentos por llamada): es la misma pasada del motor.
 *   · Una llamada se transcribe UNA vez aunque este adelanto y el cron coincidan (el SQL reserva cada llamada).
 *   · Solo se transcribe: separar quién habla espera al proceso automático (nadie lo está esperando).
 */

type Servicio = ReturnType<typeof createServiceClient>

/** Lo que cuesta como mucho transcribir una llamada empezada (la descarga, la voz y el resumen): no se empieza otra si no cabe */
const MARGEN_DE_UNA_LLAMADA_MS = 6_000
/** Pocas: lo normal es que haya una o dos esperando, y las más antiguas van primero */
const LLAMADAS_POR_ADELANTO = 4

export interface ResultadoDeLaEsperaDeVerdad {
  llamadas: LlamadaParaIa[]
  /** Lo que ve el comercial junto al borrador, o null si no hay nada que decir */
  aviso: string | null
  esperadoMs: number
}

export async function esperarLaTranscripcionDelLead(service: Servicio, cargar: () => Promise<LlamadaParaIa[]>, llamadas: LlamadaParaIa[]): Promise<ResultadoDeLaEsperaDeVerdad> {
  if (!hayTranscripcionPendiente(llamadas, Date.now())) return { llamadas, aviso: null, esperadoMs: 0 }

  // Apagada en Sistema, o sin lo que necesita para transcribir: la transcripción no va a llegar, así que ni se espera ni se promete
  const tarea = (await leerConfigCron()).find((c) => c.tarea === 'rinkel-transcribir')
  if (tarea && !tarea.activo) return { llamadas, aviso: null, esperadoMs: 0 }
  if (!hasTokenKey() || !process.env.OPENAI_API_KEY?.trim()) return { llamadas, aviso: null, esperadoMs: 0 }

  // Si la cuenta de la IA o la base fallan, adelantar una y otra vez no sirve: se deja de intentar y se sigue mirando por si el proceso automático la trae
  let rendido = false
  const r = await esperarLaTranscripcion(
    {
      ahora: () => Date.now(),
      dormir: (ms) => new Promise((resolver) => setTimeout(resolver, ms)),
      cargar,
      adelantar: async (restanteMs) => {
        const presupuestoMs = restanteMs - MARGEN_DE_UNA_LLAMADA_MS
        if (rendido || presupuestoMs < 1_000) return
        try {
          const pasada = await ejecutarPasada(service, { presupuestoMs, limite: LLAMADAS_POR_ADELANTO, concurrencia: 2, sinTurnos: true })
          if (pasada.parada === 'ia_no_disponible' || pasada.parada === 'error') rendido = true
          // Solo cuando ha pasado algo: sin esto saldría una línea por vuelta
          if (pasada.candidatas > 0) console.log('[correo-ia] adelanto de la transcripción', { candidatas: pasada.candidatas, hechas: pasada.hechas, ajenas: pasada.ajenas, fallidas: pasada.fallidas, parada: pasada.parada })
        } catch (error) {
          rendido = true
          console.error('[correo-ia] no se ha podido adelantar la transcripción', { nombre: error instanceof Error ? error.name : 'desconocido' })
        }
      },
    },
    llamadas
  )
  console.log('[correo-ia] espera de la transcripción', { esperadoMs: r.esperadoMs, vueltas: r.vueltas, pendiente: r.pendiente })
  return { llamadas: r.llamadas, aviso: r.pendiente ? AVISO_TRANSCRIPCION_PENDIENTE : null, esperadoMs: r.esperadoMs }
}
