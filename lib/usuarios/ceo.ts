import { APP_CHAT, APP_TAREAS_CLIENTES } from '@/lib/config/apps'

/**
 * EL CEO: DIRECCIÓN CUYO ACCESO A CADA APLICACIÓN LO DECIDEN LAS CASILLAS, como el de cualquier otro rol — PURO.
 * ===========================================================================================================
 * Un administrador entra a todas las aplicaciones sin casillas. Un CEO NO: entra a las que tenga marcadas en Gestión de Usuarios (como un empleado) y a ninguna más. Se crea con todas
 * marcadas MENOS lo que se desarrolla dentro del ERP —el Chat del equipo y Tareas de clientes—, y se le puede dar o quitar cualquier acceso a mano, también esos dos.
 *
 * NO ES UN ROL NUEVO DE LA BASE, por la misma razón que los puestos (lib/usuarios/puestos.ts): `profiles.role` sigue siendo 'admin' y hay unas cien comparaciones `role === 'admin'`
 * (finanzas, empleados, facturación…) que un cuarto valor rompería sin dar error. Un CEO es `role = 'admin'` + `profiles.puesto = 'ceo'` (migración 290), así que conserva lo que solo hace
 * un administrador (las rutas de API de dirección). Lo que cambia es QUÉ APLICACIONES ABRE:
 *   · el menú y la rejilla de Inicio (AppSidebar, app/dashboard/page.tsx);
 *   · las rutas de API con requireAppAccess (lib/auth/api.ts) y las pantallas con casilla en el middleware;
 *   · el Chat y Tareas de clientes, también en el servidor (lib/chat/acceso.ts, lib/tareas-clientes/acceso.ts) y en la base (las funciones `puede_ver_chat` y `puede_ver_tareas_clientes`).
 * Una pantalla que compruebe «es admin» por su cuenta, sin pasar por ninguna de esas piezas, no distingue al CEO: la casilla la esconde del menú pero no cierra la dirección.
 */

export const PUESTO_CEO = 'ceo'

/** Lo que NO se marca de partida al hacer CEO a alguien: lo que se desarrolla dentro del ERP. Se puede marcar a mano en Gestión de Usuarios */
export const APPS_SIN_MARCAR_AL_HACER_CEO: ReadonlySet<string> = new Set([APP_CHAT, APP_TAREAS_CLIENTES])

/** ¿Es un CEO? Hace falta el rol admin Y el puesto: un puesto 'ceo' suelto, sin ser admin, no cambia nada */
export function esCeo(rol: string | null | undefined, puesto: string | null | undefined): boolean {
  return rol === 'admin' && puesto === PUESTO_CEO
}

/**
 * ¿Abre esta aplicación? Un administrador, siempre; un CEO, solo si tiene su casilla (el Inicio siempre). `permisos` son los ids con la casilla marcada.
 */
export function abreLaApp(rol: string | null | undefined, puesto: string | null | undefined, permisos: ReadonlySet<string>, appId: string): boolean {
  if (rol !== 'admin') return false
  if (!esCeo(rol, puesto)) return true
  return appId === 'home' || permisos.has(appId)
}
