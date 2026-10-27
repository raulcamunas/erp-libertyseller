import type { createServiceClient } from '@/lib/supabase/service'
import { almacenDeSecuencias } from './almacen'
import { avisadorDeLaCampana, avisarDeAlarmas, type Avisador } from './alarmas'
import { alarmasDe, alarmasDeLaVerificacion, type BuzonParaLaSalud } from './salud'
import { medirLaSalud } from './salud-datos'

/**
 * EL VIGÍA DE LAS SECUENCIAS — SOLO SERVIDOR.
 * ===========================================
 * Mira cómo van los buzones y el motor (lib/correo/secuencias/salud.ts) y avisa por la campana de lo que haya que atender. Lo llama el proceso de
 * sincronización del correo (`/api/correo/cron`, cada pocos minutos) y NO el motor de seguimientos, a propósito: si el motor se para o falla
 * antes de arrancar, él no puede avisar de que se ha parado; otro proceso, sí.
 *
 *   · Solo vigila con el motor ENCENDIDO (ensayo o envío real). Con las secuencias apagadas no hay nada que vigilar y los avisos serían ruido. La ÚNICA excepción
 *     es la verificación de direcciones (MillionVerifier): comprueba los primeros correos que se envían a mano, con o sin motor, así que si se queda sin clave o
 *     sin créditos se avisa igualmente.
 *   · Nunca tumba a quien lo llama: el que llama lo envuelve en try/catch y aquí no se toca nada más que la campana.
 *   · Cada aviso se repite como mucho dos veces al día mientras el problema siga (alarmas.ts).
 */

type Servicio = ReturnType<typeof createServiceClient>

export interface ResultadoDelVigia {
  /** Por qué no se ha mirado nada, si es el caso */
  omitido?: string
  alarmas: number
  avisos: number
  faltaMigracion?: boolean
}

export async function vigilarLaSalud(service: Servicio, opciones: { ahora?: number; avisador?: Avisador } = {}): Promise<ResultadoDelVigia> {
  const ahora = opciones.ahora ?? Date.now()
  const almacen = almacenDeSecuencias(service)
  const lectura = await almacen.leerAjustes()
  if (!lectura) return { omitido: 'Falta la migración 245', alarmas: 0, avisos: 0 }
  if (!lectura.ajustes.activa) {
    const verificacion = await almacen.estadoDeLaVerificacion().catch(() => null)
    const deLaVerificacion = alarmasDeLaVerificacion({ ahora, verificacion })
    if (!deLaVerificacion.some((a) => a.avisar)) return { omitido: 'El motor está apagado', alarmas: 0, avisos: 0 }
    const r = await avisarDeAlarmas(opciones.avisador ?? avisadorDeLaCampana(service), deLaVerificacion, { administradores: await almacen.administradores(), ahora })
    return { omitido: 'El motor está apagado: solo se ha mirado la verificación de direcciones', alarmas: deLaVerificacion.length, avisos: r.avisos, ...(r.faltaMigracion ? { faltaMigracion: true } : {}) }
  }

  const todos = await almacen.buzones()
  const nombres = await almacen.nombresDePersonas(todos.map((b) => b.userId))
  const buzones: BuzonParaLaSalud[] = todos.map((b) => ({
    id: b.id,
    direccion: b.direccion,
    propietario: { id: b.userId, nombre: nombres.get(b.userId) ?? 'Sin nombre' },
    esMio: false,
    participa: b.participa,
    conectado: b.conectado,
    credencialesInvalidas: b.credencialesInvalidas,
    ultimoSyncAt: b.ultimoSyncAt,
    pausadoHasta: b.pausadoHasta,
    motivoPausa: b.motivoPausa,
    topeDiario: b.topeDiario,
    rampaInicio: b.rampaInicio,
    hoy: null,
    vivas: 0,
  }))

  const entrada = await medirLaSalud(almacen, { ahora, ajustes: lectura.ajustes, buzones, conMotor: true })
  const alarmas = alarmasDe(entrada)
  if (!alarmas.some((a) => a.avisar)) return { alarmas: alarmas.length, avisos: 0 }

  const administradores = await almacen.administradores()
  const r = await avisarDeAlarmas(opciones.avisador ?? avisadorDeLaCampana(service), alarmas, { administradores, ahora })
  return { alarmas: alarmas.length, avisos: r.avisos, ...(r.faltaMigracion ? { faltaMigracion: true } : {}) }
}
