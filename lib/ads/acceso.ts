import { esCeo } from '@/lib/usuarios/ceo'

/**
 * MARKETING TEST · ¿ES UN CEO SIN LA CASILLA?
 *
 * La app escribe en las cuentas de publicidad de los clientes. Es de administrador, y un CEO es un administrador (`role = 'admin'` + puesto 'ceo') cuyo acceso a cada aplicación lo deciden las casillas
 * de Gestión de Usuarios (lib/usuarios/ceo.ts). Sin esta comprobación, un CEO sin la casilla de Marketing Test no la vería en el menú pero podría abrir la dirección o llamar a la API.
 */
export const APP_MARKETING_TEST = 'marketing-test'

/** true = hay que cerrarle: es un CEO y no tiene la casilla. Un administrador a secas nunca está cerrado */
export function ceoSinCasilla(rol: string | null | undefined, puesto: string | null | undefined, permisos: ReadonlySet<string>): boolean {
  return esCeo(rol, puesto) && !permisos.has(APP_MARKETING_TEST)
}
