import { esCeo } from '@/lib/usuarios/ceo'

/**
 * QUIÉN VE QUÉ CLIENTES EN REMESAS A FBA (spec remesas-pro §11 D27).
 * PURA: sin base de datos ni red. Se comprueba con regla-acceso.prueba.ts.
 * La usa `clientesDeSesion` (servidor), que lee el perfil, la casilla y `fba_accesos` y le pasa los datos.
 *
 * Hasta ahora un empleado solo veía los clientes de `fba_accesos` (una tabla con 0 filas), así que los administrativos no veían nada.
 * El acceso de la agencia lo da la CASILLA de la app `remesas` en Gestión de Usuarios (`user_app_permissions`), como en el resto del ERP
 * (migración 257 y lib/cuentas/acceso.ts). El PUESTO no da acceso: un «Gestión Administrativa» sin casilla sigue con sus `fba_accesos`.
 *
 *   admin (no CEO)          → todos los clientes, edita, agencia, esAdmin
 *   CEO con la casilla      → todos los clientes, edita, agencia, esAdmin (conserva lo de administrador, lib/usuarios/ceo.ts)
 *   CEO sin la casilla      → como un empleado sin casilla: sus `fba_accesos` y sin poderes de administrador
 *                             (el middleware ya no le deja entrar; esto es la red por si llega por una ruta de API)
 *   employee con la casilla → todos los clientes, edita, agencia, esAdmin = false
 *   employee sin la casilla → sus `fba_accesos` (edita donde `puede_editar`), agencia
 *   cliente (y cualquier otro rol: partner…) → sus `fba_accesos`, actor cliente. La casilla no le abre nada: es gente de fuera.
 *
 * `null` = todos los clientes. Una lista vacía NO es «todos»: la ruta que la reciba contesta 403.
 */

export interface AccesoFba {
  clienteId: string
  puedeEditar: boolean
}

export interface EntradaReglaAcceso {
  role: string | null
  puesto: string | null
  /** Fila de `user_app_permissions` con app `remesas` y `can_access = true` */
  casillaRemesas: boolean
  /** Filas de `fba_accesos` del usuario */
  accesos: AccesoFba[]
}

export interface ReglaAcceso {
  /** null = todos */
  clientesPermitidos: string[] | null
  /** null = todos los permitidos */
  editables: string[] | null
  esAdmin: boolean
  actor: 'agencia' | 'cliente'
}

/** Los clientes de sus filas de `fba_accesos`, sin repetir; editables los que tienen `puede_editar` en alguna fila */
function porAccesos(accesos: AccesoFba[], actor: 'agencia' | 'cliente'): ReglaAcceso {
  const permitidos: string[] = []
  const editables: string[] = []
  for (const a of accesos) {
    const id = a.clienteId?.trim()
    if (!id) continue
    if (!permitidos.includes(id)) permitidos.push(id)
    if (a.puedeEditar && !editables.includes(id)) editables.push(id)
  }
  return { clientesPermitidos: permitidos, editables, esAdmin: false, actor }
}

export function reglaDeAcceso(p: EntradaReglaAcceso): ReglaAcceso {
  if (p.role === 'admin') {
    if (!esCeo(p.role, p.puesto) || p.casillaRemesas) {
      return { clientesPermitidos: null, editables: null, esAdmin: true, actor: 'agencia' }
    }
    return porAccesos(p.accesos, 'agencia')
  }
  if (p.role === 'employee') {
    if (p.casillaRemesas) return { clientesPermitidos: null, editables: null, esAdmin: false, actor: 'agencia' }
    return porAccesos(p.accesos, 'agencia')
  }
  return porAccesos(p.accesos, 'cliente')
}
