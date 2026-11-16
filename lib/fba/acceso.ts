import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { fail } from '@/lib/amazon/api'
import type { Actor } from './flujo'
import type { SesionRemesas } from '@/components/remesas/comun/tipos-ui'
import { sesionDeRemesas, sesionFbaDe } from './clientes-de-sesion'

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
 *   ver      -> admin, empleado con la casilla `remesas`, o fila en fba_accesos.
 *   editar   -> admin, empleado con la casilla, o fila con puede_editar = true.
 *   borrar   -> SOLO admin. Borrar una remesa es tirar la contabilidad de un
 *               envío, y eso no sale de la agencia.
 *
 * ============ CAMBIO DE COMPORTAMIENTO (spec remesas-pro §1.4 y D27) ============
 *
 * La regla es la de `reglaDeAcceso` (regla-acceso.ts), leída en `sesionDeRemesas` (clientes-de-sesion.ts), la misma que la
 * página. Antes un empleado solo veía sus fba_accesos (0 filas: los administrativos no veían nada); ahora un empleado con la
 * casilla `remesas` de Gestión de Usuarios ve y edita todos los clientes como agencia, con `esAdmin = false`. `esAdmin` es SOLO
 * para los administradores de verdad (un CEO sin la casilla ya no lo es aquí), así que las barreras de solo admin siguen
 * cerradas para él: Leer ventas, Leer de Amazon, Enviar a Amazon, borrar remesas y filas del catálogo, accesos externos y
 * refrescar el catálogo contra Amazon (POST /api/fba/productos). Lo que pasa a la agencia con editar usa `agenciaQueEdita`.
 *
 * `clientesPermitidos = null` ya NO quiere decir «es admin»: quiere decir «todos los clientes». Para lo de admin, `esAdmin`.
 */

export interface SesionFba {
  userId: string
  /** 'admin' | 'employee' | 'cliente' (un partner u otro rol de fuera cuenta como cliente) */
  role: string
  /** Solo los administradores de verdad (no un empleado con la casilla, ni un CEO sin ella) */
  esAdmin: boolean
  /**
   * QUIÉN ES EN EL FLUJO: la agencia (admin o empleado) o el cliente.
   *
   * Antes se decidía con `esAdmin`, y un empleado de la agencia que no fuera admin contaba como CLIENTE:
   * no podía marcar enviada ni volver a borrador, y lo que hacía quedaba como si lo hubiera hecho el
   * cliente. Ahora decide el rol: admin y employee son agencia; el resto, cliente.
   */
  actor: Actor
  /** null = todos (admin o empleado con la casilla). Lista = solo estos. Nunca vacía: eso ya es un 403 */
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

  // La misma regla que la página (clientesDeSesion → reglaDeAcceso): rol, puesto, casilla `remesas` y fba_accesos (D27)
  const s = await sesionDeRemesas(user.id, createServiceClient())
  const d = decidirAcceso(s, nivel, cliente)
  return 'estado' in d ? fail(d.estado, d.mensaje) : d
}

/**
 * La decisión de `requireFbaAccess` con la sesión ya leída (pura: sin cookies ni base). Se prueba en clientes-de-sesion.prueba.ts
 * con datos falsos; devuelve la sesión o el error que contestaría la ruta.
 */
export function decidirAcceso(s: SesionRemesas, nivel: NivelFba = 'ver', cliente?: string | null): SesionFba | { estado: number; mensaje: string } {
  // Borrar es de admin y de nadie más (tampoco de un empleado con la casilla). Se corta antes de mirar nada.
  if (nivel === 'borrar' && !s.esAdmin) {
    return { estado: 403, mensaje: 'Borrar una remesa solo lo puede hacer un administrador de la agencia' }
  }

  const permitidos = s.clientesPermitidos
  const editables = s.editables
  if (permitidos !== null && permitidos.length === 0) {
    return {
      estado: 403,
      mensaje: s.actor === 'cliente' ? 'No tienes acceso a ninguna cuenta en Remesas a FBA. Pídeselo a la agencia.' : 'Pide a un administrador que te dé acceso a Remesas.',
    }
  }

  if (cliente) {
    if (permitidos !== null && !permitidos.includes(cliente)) {
      // El mismo mensaje que si no existiera: no se confirma que exista.
      return { estado: 404, mensaje: 'Ese cliente no existe' }
    }
    if (nivel === 'editar' && editables !== null && !editables.includes(cliente)) {
      return { estado: 403, mensaje: 'Tu acceso a esta cuenta es solo de lectura' }
    }
  } else if (nivel === 'editar' && editables !== null && editables.length === 0) {
    return { estado: 403, mensaje: 'Tu acceso es solo de lectura' }
  }

  return sesionFbaDe(s)
}

/** ¿Es la agencia (admin o empleado)? Lo que antes se decidía con `esAdmin` y ahora pasa a la agencia con editar (§1.4) */
export function esAgencia(sesion: Pick<SesionFba, 'actor'>): boolean {
  return sesion.actor === 'agencia'
}

/** Agencia y con permiso de editar ese cliente: la barrera nueva de §1.4 (planificador, plazos, propuesta a medida, análisis IA…) */
export function agenciaQueEdita(sesion: SesionFba, cliente: string): boolean {
  return esAgencia(sesion) && puedeVer(sesion, cliente) && puedeEditar(sesion, cliente)
}

/** ¿Puede esta sesión ver este cliente? Para las rutas que reciben el id tarde */
export function puedeVer(sesion: SesionFba, cliente: string): boolean {
  return sesion.clientesPermitidos === null || sesion.clientesPermitidos.includes(cliente)
}

export function puedeEditar(sesion: SesionFba, cliente: string): boolean {
  return sesion.clientesEditables === null || sesion.clientesEditables.includes(cliente)
}

/** Los roles que son la agencia. El resto (cliente, socio…) cuenta como cliente */
export const ROLES_DE_AGENCIA = ['admin', 'employee'] as const

export function actorDeRol(role: string | null | undefined): Actor {
  return (ROLES_DE_AGENCIA as readonly string[]).includes(role ?? '') ? 'agencia' : 'cliente'
}
