import { MODULOS, type ModuloId } from '@/components/growth/modulos'

/**
 * QUIÉN ENTRA EN GROWTH PARTNER, Y A QUÉ.
 *
 * ============ EL PROBLEMA QUE RESUELVE ============
 *
 * El sincronismo de stock vivía en /dashboard/stock-sync y lo usaba la persona
 * de OPERACIONES, cuyo rol es 'employee' y que tiene el permiso suelto
 * 'stock-sync' en user_app_permissions. Al mudarse el módulo dentro de Growth
 * Partner —que es solo admin— esa persona se quedó SIN NINGUNA PUERTA: pasaba
 * el filtro de la ruta vieja, la página la reenviaba a Growth Partner y el gate
 * de admin la rebotaba al escritorio. Sin mensaje, y con el permiso todavía
 * puesto en la pantalla de usuarios, que es lo peor: parece que lo tiene.
 *
 * Quien sube el stock a Amazon lo hace dos veces por semana. Una reorganización
 * de pantallas no puede quitarle la herramienta.
 *
 *
 * ============ POR QUÉ ESTO NO ABRE NADA NUEVO ============
 *
 * Esta persona YA VEÍA el sincronismo de stock de los clientes antes de la
 * mudanza: el mapeo, el volcado y el historial de procesos son exactamente las
 * mismas pantallas y los mismos datos. Aquí NO se le da Buy Box, ni FBM→FBA, ni
 * el catálogo, ni los precios, ni Amazon API. Se le devuelve lo que tenía y solo
 * eso: `modulosPermitidos` le entrega UN submódulo, no el módulo entero.
 *
 * El compromiso ante Amazon sigue intacto: se sigue trabajando sobre UN cliente
 * elegido arriba, y no hay ninguna vista que mezcle, agregue o compare varios.
 *
 * Y esto NO es el filtro de verdad, igual que el resto de listas de permisos del
 * ERP: quien manda son las políticas RLS de stock_mappings y stock_runs (la
 * migración 106) y las comprobaciones de cada ruta de API. Esto evita el viaje y
 * la pantalla vacía.
 */

/** El id del permiso suelto, tal y como está en user_app_permissions */
export const PERMISO_STOCK_SYNC = 'stock-sync'

/** Lo que ve quien entra con el permiso suelto y no es admin */
const MODULOS_DE_STOCK: readonly ModuloId[] = ['stock-sync']

/**
 * Los IDs de los submódulos que puede ver esta persona, EN EL ORDEN DE MODULOS.
 *
 * Lista vacía = no entra en el módulo. Quien llama tiene que tratarlo como un
 * redirect, no como una pantalla vacía.
 *
 * Devuelve IDs y no objetos `Modulo` a propósito: esto se calcula en el servidor
 * y se le pasa a una carcasa de cliente, y cada `Modulo` lleva dentro su icono de
 * lucide —un forwardRef con una función—, que no cruza esa frontera. Con cadenas
 * no hay nada que serializar mal.
 */
export function modulosPermitidos(
  rol: string | null | undefined,
  tienePermisoStockSync: boolean
): readonly ModuloId[] {
  if (rol === 'admin') return MODULOS.map((m) => m.id)
  if (tienePermisoStockSync) return MODULOS_DE_STOCK
  return []
}

/** ¿Puede esta persona ver la entrada «Growth Partner» en el menú? */
export function puedeVerGrowth(
  rol: string | null | undefined,
  permisos: ReadonlySet<string>
): boolean {
  return rol === 'admin' || permisos.has(PERMISO_STOCK_SYNC)
}
