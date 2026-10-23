import type { createServiceClient } from '@/lib/supabase/service'
import { pedirUrlDeGrabacion } from '@/lib/rendimiento/rinkel'
import { leerClaveDe } from '@/lib/rendimiento/servidor'
import { almacenDeSupabase } from './almacen'
import { descargarAudio } from './audio'
import { procesarPendientes, type DepsDelMotor, type ResultadoDelMotor } from './motor'
import { MODELO_DE_VOZ_POR_DEFECTO } from './reglas'
import { resumirLlamada } from './resumen'
import { transcribirAudio } from './voz'

/**
 * UNA PASADA DEL PROCESO QUE TRANSCRIBE LAS LLAMADAS, CON LOS SERVICIOS DE VERDAD.
 * ================================================================================
 * SOLO SERVIDOR. Junta el motor (motor.ts, que decide) con Supabase (almacen.ts), la clave de Rinkel de cada comercial, la descarga del
 * audio, la voz y el resumen. Lo llama la ruta de cron /api/rendimiento/transcribir.
 *
 * Las claves no salen de aquí: la de OpenAI es OPENAI_API_KEY del servidor (la misma de «Redactar con IA»), y la de Rinkel de cada persona
 * se descifra para pedir UNA dirección temporal de grabación y no se guarda ni se escribe en ningún registro.
 */

type Servicio = ReturnType<typeof createServiceClient>

export function modeloDeVoz(): string {
  return process.env.TRANSCRIPCION_MODELO_VOZ?.trim() || MODELO_DE_VOZ_POR_DEFECTO
}

export function depsDeVerdad(service: Servicio): DepsDelMotor {
  const modelo = modeloDeVoz()
  const claveOpenAi = process.env.OPENAI_API_KEY?.trim() ?? ''
  return {
    ahora: () => Date.now(),
    modeloDeVoz: modelo,
    claveDeRinkel: (userId) => leerClaveDe(service, userId),
    urlDeGrabacion: (clave, grabacionId) => pedirUrlDeGrabacion(clave, grabacionId),
    bajarAudio: (url) => descargarAudio(url),
    transcribir: (audio, pistas) => transcribirAudio({ audio, modelo, clave: claveOpenAi, pistas }),
    resumir: (encargo) => resumirLlamada(encargo),
  }
}

export interface OpcionesDeLaPasada {
  presupuestoMs: number
}

export async function ejecutarPasada(service: Servicio, opciones: OpcionesDeLaPasada): Promise<ResultadoDelMotor> {
  return procesarPendientes(almacenDeSupabase(service), depsDeVerdad(service), { presupuestoMs: opciones.presupuestoMs })
}
