import type { AvisoParaLaCampana } from '../campana'
import type { DependenciasDelMotor } from './motor'

/**
 * AVISAR EN LA CAMPANA DESDE EL MOTOR — SOLO SERVIDOR.
 * ====================================================
 * Dos ayudas pequeñas que usan el motor (motor.ts) y la lectura de respuestas (leer-respuestas.ts). Van en su propio fichero para que esos dos no se
 * importen entre sí (el motor ya llama a la lectura de respuestas). Se comprueban con los escenarios de avisos de motor.escenarios.ts.
 */

/**
 * Avisa en la campana de su dueño de algo que tiene que atender. El aviso se COMPONE solo si hay a quién escribirlo (sin `avisar` ni se buscan nombres) y
 * nada de esto puede estropear la pasada: lo que falle se apunta en el registro y la pasada sigue.
 */
export async function avisarAlDueno(deps: Pick<DependenciasDelMotor, 'avisar'>, componer: () => Promise<AvisoParaLaCampana | null>): Promise<void> {
  if (!deps.avisar) return
  try {
    const aviso = await componer()
    if (aviso) await deps.avisar(aviso)
  } catch (e) {
    console.error('[secuencias] no se ha podido avisar por la campana', { mensaje: e instanceof Error ? e.message : 'sin mensaje' })
  }
}

/** Cómo se llama un lead en un aviso: la tienda o la empresa; si ya no existe, la dirección a la que se escribía */
export async function nombreEnElAviso(deps: Pick<DependenciasDelMotor, 'almacen'>, leadId: string, respaldo: string): Promise<string> {
  const lead = (await deps.almacen.leadsBasicos([leadId])).get(leadId)
  return lead?.nombre && lead.nombre !== 'Sin nombre' ? lead.nombre : respaldo
}

