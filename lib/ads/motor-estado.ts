/**
 * AMAZON ADS · EL ESTADO DEL MOTOR DE UNA CUENTA, PARA LA PANTALLA. SOLO SERVIDOR. Solo lee la base (nunca Amazon).
 *
 * Modo, cuándo se recogió el último informe de términos y cuándo se generaron las propuestas, qué va a pasar a continuación y cómo va el proceso de fondo
 * (`ads-rendimiento` en cron_ejecuciones). La frase del próximo paso sale de `proximoPasoDelMotor` (puro, con pruebas).
 */

import { createServiceClient } from '@/lib/supabase/service'
import { INTERVALO_TERMINOS_MS } from './terminos'
import { proximoPasoDelMotor } from './motor-calculo'

export interface SaludDelProceso {
  /** La última pasada que dejó fila (las que no hacen nada no la dejan) */
  ultimaAt: string | null
  ok: boolean | null
  resumen: string | null
  error: string | null
  /** El proceso está apagado desde Sistema */
  apagado: boolean
}

export interface EstadoDelMotor {
  modo: string
  terminosAt: string | null
  /** null = sin la migración 311 (no se sabe) o nunca */
  generadoAt: string | null
  esperandoInforme: boolean
  errorTerminos: string | null
  proximoPaso: string
  proximoAt: string | null
  proceso: SaludDelProceso
}

export async function estadoDelMotor(perfilId: string, modo: string): Promise<EstadoDelMotor> {
  const service = createServiceClient()
  const [sync, ejec, config] = await Promise.all([
    service.from('ads_terminos_sync').select('*').eq('perfil_id', perfilId).maybeSingle(),
    service.from('cron_ejecuciones').select('iniciado_at, ok, resumen, error').eq('tarea', 'ads-rendimiento').order('iniciado_at', { ascending: false }).limit(1),
    service.from('cron_config').select('activo').eq('tarea', 'ads-rendimiento').maybeSingle(),
  ])
  const s = (sync.data ?? null) as { estado?: string; ultimo_ok_at?: string | null; generado_at?: string | null; error?: string | null; pedido_at?: string | null } | null
  const e = ((ejec.data ?? []) as Array<{ iniciado_at: string; ok: boolean | null; resumen: string | null; error: string | null }>)[0]
  const terminosAt = s?.ultimo_ok_at ?? null
  const generadoAt = s?.generado_at ?? null
  const esperando = s?.estado === 'esperando'
  const paso = proximoPasoDelMotor({ modo, terminosAt, generadoAt, esperandoInforme: esperando, hayGeneradoAt: s ? 'generado_at' in s : false, intervaloMs: INTERVALO_TERMINOS_MS, ahora: Date.now() })
  return {
    modo,
    terminosAt,
    generadoAt,
    esperandoInforme: esperando,
    errorTerminos: s?.error ?? null,
    proximoPaso: paso.texto,
    proximoAt: paso.cuando,
    proceso: {
      ultimaAt: e?.iniciado_at ?? null,
      ok: e?.ok ?? null,
      resumen: e?.resumen ?? null,
      error: e?.error ?? null,
      apagado: (config.data as { activo?: boolean } | null)?.activo === false,
    },
  }
}
