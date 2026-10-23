import { createServiceClient } from '@/lib/supabase/service'

/**
 * EL ÚLTIMO MOVIMIENTO REAL DE UNA PERSONA, TAL Y COMO LO APUNTA EL REGISTRO DE ACTIVIDAD. SOLO SERVIDOR.
 *
 * Lo usa app/dashboard/layout.tsx al abrir el ERP para decidir si la sesión de un empleado ha caducado por inactividad
 * (lib/actividad/inactividad.ts). Cuenta lo que hace la persona —abrir el ERP, iniciar sesión, cambiar de pantalla, pulsar,
 * el «sigo aquí»— y no lo que hace el navegador solo (salir de la pestaña o volver a ella).
 *
 * NUNCA LANZA Y NUNCA SE ESPERA MÁS DE LA CUENTA: devuelve null si la tabla no existe todavía, si la base falla o si tarda
 * más de dos segundos. Quien lo llama entiende null como «no sé»: y con un «no sé» no se echa a nadie. Un fallo del registro
 * no puede dejar a todo el equipo fuera ni frenar cada pantalla que abren.
 */
const TIEMPO_MAXIMO_MS = 2_000

export async function ultimoEventoDe(userId: string): Promise<number | null> {
  try {
    const lectura = Promise.resolve(
      createServiceClient()
        .from('actividad_registro')
        .select('ocurrio_at')
        .eq('user_id', userId)
        .in('tipo', ['sesion', 'login', 'pagina', 'clic', 'latido'])
        .order('ocurrio_at', { ascending: false })
        .limit(1)
    )
    const plazo = new Promise<null>((resolve) => setTimeout(() => resolve(null), TIEMPO_MAXIMO_MS))
    const respuesta = await Promise.race([lectura, plazo])
    if (respuesta === null || respuesta.error) return null
    const iso = (respuesta.data as Array<{ ocurrio_at: string }> | null)?.[0]?.ocurrio_at
    const t = iso ? Date.parse(iso) : Number.NaN
    return Number.isFinite(t) ? t : null
  } catch {
    return null
  }
}
