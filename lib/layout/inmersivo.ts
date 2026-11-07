/**
 * LAS PANTALLAS QUE SE ABREN «COMO OTRA APLICACIÓN».
 *
 * Tareas de clientes ocupa toda la ventana: sin la barra lateral del ERP ni el margen de la página. Para volver se pulsa el botón de arriba a la derecha, que abre el menú
 * del ERP como un cajón por encima (el mismo que en el móvil). La barra sigue montada, solo escondida: así el cajón sale al instante y con los permisos ya cargados.
 */

/** Lo que cuelga de estas rutas se abre a pantalla completa */
const RUTAS_INMERSIVAS: readonly string[] = ['/dashboard/tareas-clientes']

/** Aviso (en `window`) que pide abrir el menú del ERP; lo escucha AppSidebar */
export const EVENTO_ABRIR_MENU = 'ls:abrir-menu'

export function esRutaInmersiva(pathname: string | null | undefined): boolean {
  if (!pathname) return false
  return RUTAS_INMERSIVAS.some((r) => pathname === r || pathname.startsWith(`${r}/`))
}
