import type { createServiceClient } from '@/lib/supabase/service'
import type { UsuarioMcp } from './auth'

/**
 * LO QUE RECIBE CADA HERRAMIENTA DEL CONECTOR DE CONSULTAS (/api/mcp).
 * Vive aquí y no en herramientas.ts para que las herramientas del equipo comercial (lib/mcp/comercial/) lo importen sin que herramientas.ts, que las
 * reúne a todas, y ellas se importen la una a la otra.
 */

export type Servicio = ReturnType<typeof createServiceClient>

export interface ContextoMcp {
  usuario: UsuarioMcp
  /**
   * La base con la que se lee. Solo la ponen las pruebas (una base en memoria) y el script que las prueba contra la real en solo lectura: en producción no
   * viene y cada herramienta crea su cliente de servicio.
   */
  servicio?: Servicio
  /** El instante «ahora» en milisegundos. Solo lo ponen las pruebas (un reloj que se mueve a mano): en producción no viene y se usa el de verdad */
  ahora?: number
}
