import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { fail } from '@/lib/amazon/api'

/**
 * QUIÉN PUEDE VER Y TOCAR QUÉ EN REMESAS A FBA.
 * ============================================
 * SOLO SERVIDOR.
 *
 * Es la primera app del ERP en la que entra gente de FUERA de la agencia, y
 * eso obliga a que el filtro por cliente sea de verdad, no de pantalla.
 *
 *
 * ============ POR QUÉ NO BASTA CON LAS RLS ============
 *
 * Las rutas de /api/fba usan la clave de servicio, que SE SALTA las RLS. Es lo
 * correcto —las escrituras están revocadas desde el navegador a propósito—,
 * pero significa que la base no va a parar una consulta mal filtrada: si una
 * ruta olvida el `.eq('client_id', …)`, devuelve las remesas de todos.
 *
 * Así que la regla es una y no tiene excepciones: TODA ruta de /api/fba pasa
 * por aquí, recibe la lista de clientes permitidos, y filtra por ella. Un admin
 * recibe `null` (= sin filtro). Cualquier otro recibe su lista, y una lista
 * vacía es un 403, no una consulta sin filtro.
 *
 *
 * ============ LOS TRES NIVELES ============
 *
 *   ver      -> admin, o cualquier usuario con fila en fba_accesos.
 *   editar   -> admin, o fila con puede_editar = true. Crear y corregir.
 *   borrar   -> SOLO admin. Borrar una remesa es tirar la contabilidad de un
 *               envío, y eso no sale de la agencia.
 */

export interface SesionFba {
  userId: string
  role: string
  esAdmin: boolean
  /** null = todos (admin). Lista = solo estos. Nunca vacía: eso ya es un 403 */
  clientesPermitidos: string[] | null
  /** De los permitidos, en cuáles puede crear y corregir */
  clientesEditables: string[] | null
}

export type NivelFba = 'ver' | 'editar' | 'borrar'

/**
 * Comprueba la sesión y devuelve qué puede ver. O la respuesta de error, lista.
 *
 * `cliente` es opcional: si se pasa, además se comprueba que ESE cliente esté
 * entre los permitidos al nivel pedido, y así la ruta no tiene que repetirlo.
 */
export async function requireFbaAccess(
  nivel: NivelFba = 'ver',
  cliente?: string | null
): Promise<SesionFba | NextResponse> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return fail(401, 'Hay que iniciar sesión')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  const role = (profile as { role: string } | null)?.role ?? 'employee'

  if (role === 'admin') {
    return {
      userId: user.id,
      role,
      esAdmin: true,
      clientesPermitidos: null,
      clientesEditables: null,
    }
  }

  // Borrar es de admin y de nadie más. Se corta antes de mirar nada.
  if (nivel === 'borrar') {
    return fail(403, 'Borrar una remesa solo lo puede hacer un administrador de la agencia')
  }

  // Los accesos se leen con la clave de servicio: la política de fba_accesos
  // deja a cada uno ver los suyos, pero aquí no queremos depender de eso.
  const service = createServiceClient()
  const { data: accesos, error } = await service
    .from('fba_accesos')
    .select('client_id, puede_editar')
    .eq('user_id', user.id)
  if (error) throw error

  const filas = (accesos ?? []) as Array<{ client_id: string; puede_editar: boolean }>
  const permitidos = filas.map((a) => a.client_id)
  const editables = filas.filter((a) => a.puede_editar).map((a) => a.client_id)

  if (permitidos.length === 0) {
    return fail(403, 'No tienes acceso a ninguna cuenta en Remesas a FBA. Pídeselo a la agencia.')
  }

  if (cliente) {
    if (!permitidos.includes(cliente)) {
      // El mismo mensaje que si no existiera: no se confirma que exista.
      return fail(404, 'Ese cliente no existe')
    }
    if (nivel === 'editar' && !editables.includes(cliente)) {
      return fail(403, 'Tu acceso a esta cuenta es solo de lectura')
    }
  } else if (nivel === 'editar' && editables.length === 0) {
    return fail(403, 'Tu acceso es solo de lectura')
  }

  return {
    userId: user.id,
    role,
    esAdmin: false,
    clientesPermitidos: permitidos,
    clientesEditables: editables,
  }
}

/** ¿Puede esta sesión ver este cliente? Para las rutas que reciben el id tarde */
export function puedeVer(sesion: SesionFba, cliente: string): boolean {
  return sesion.clientesPermitidos === null || sesion.clientesPermitidos.includes(cliente)
}

export function puedeEditar(sesion: SesionFba, cliente: string): boolean {
  return sesion.clientesEditables === null || sesion.clientesEditables.includes(cliente)
}
