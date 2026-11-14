import { PUESTO_CEO } from '@/lib/usuarios/ceo'

/**
 * QUIÉN PUEDE GESTIONAR USUARIOS Y QUÉ NO SE PUEDE HACER NUNCA DESDE GESTIÓN DE USUARIOS — PURO.
 * ==============================================================================================
 * Lo usan la pantalla (app/dashboard/users/page.tsx) y TODAS las rutas de app/api/users. Se comprueba con gestion.prueba.ts.
 *
 * EL CRITERIO ES EL MISMO EN LA PANTALLA Y EN LAS RUTAS. Hasta el 14 nov 2026 la pantalla (y middleware.ts) solo se abría a un administrador con el correo del dueño, pero las
 * rutas de crear, editar y borrar dejaban pasar a CUALQUIER administrador, CEO incluido: con un `fetch` desde la consola, un CEO podía crearse cuentas de administrador, cambiarle
 * la contraseña o el correo al dueño o borrar a cualquiera. Ahora las rutas exigen exactamente lo que exige la pantalla, y además que no sea un CEO.
 *
 * LO QUE NO SE PUEDE HACER NUNCA (aunque se sea el dueño), porque deja el ERP sin nadie que lo administre:
 *   · quitarse a uno mismo el rol de administrador (o pasarse a CEO), desactivarse o borrarse;
 *   · cambiarle el correo al dueño (es el que abre esta pantalla) o quitarle el administrador, desactivarlo o borrarlo;
 *   · dejar sin administrador pleno al ERP (quitar el rol, desactivar o borrar al último).
 */

/** El correo que abre Gestión de Usuarios. El mismo que comprueba middleware.ts */
export const CORREO_DEL_DUENO = 'raulcamunas369@gmail.com'

const normalizar = (correo: string | null | undefined) => (correo ?? '').trim().toLowerCase()

export const esCorreoDelDueno = (correo: string | null | undefined): boolean => normalizar(correo) === CORREO_DEL_DUENO

/** Un administrador que entra a todo: rol admin y NO CEO (un CEO es admin + puesto 'ceo', lib/usuarios/ceo.ts) */
export const esAdminPleno = (rol: string | null | undefined, puesto: string | null | undefined): boolean => rol === 'admin' && puesto !== PUESTO_CEO

export interface PerfilParaGestion {
  id: string
  role: string | null
  puesto?: string | null
  email: string | null
}

/** ¿Puede abrir Gestión de Usuarios y llamar a sus rutas? Administrador pleno (no CEO) con el correo del dueño */
export function puedeGestionarUsuarios(perfil: Pick<PerfilParaGestion, 'role' | 'puesto' | 'email'> | null | undefined): boolean {
  if (!perfil) return false
  return esAdminPleno(perfil.role, perfil.puesto ?? null) && esCorreoDelDueno(perfil.email)
}

export interface EdicionPropuesta {
  /** Quien edita */
  actorId: string
  /** Cómo está hoy la persona editada */
  objetivo: PerfilParaGestion
  /** Cómo quedará: rol y puesto finales */
  rolFinal: string
  puestoFinal: string | null
  /** El correo que llega en la petición (undefined = no se toca) */
  correoNuevo?: string | null
  /** Cuántos administradores plenos hay hoy (contando al editado si lo es) */
  adminsPlenos: number
}

/** null si la edición se puede hacer; si no, el porqué, en una frase para el administrador */
export function errorAlEditar(e: EdicionPropuesta): string | null {
  const { objetivo } = e
  const esElDueno = esCorreoDelDueno(objetivo.email)
  if (esElDueno && e.correoNuevo && normalizar(e.correoNuevo) !== normalizar(objetivo.email)) {
    return 'El correo del dueño no se puede cambiar desde aquí: es el que abre Gestión de Usuarios.'
  }
  const eraPleno = esAdminPleno(objetivo.role, objetivo.puesto ?? null)
  const seraPleno = esAdminPleno(e.rolFinal, e.puestoFinal)
  if (seraPleno) return null
  if (objetivo.id === e.actorId) return 'No puedes quitarte a ti mismo el rol de administrador: te quedarías fuera de esta pantalla.'
  if (esElDueno) return 'Al dueño no se le puede quitar el rol de administrador.'
  if (eraPleno && e.adminsPlenos <= 1) return 'Es el último administrador: dale antes el rol de administrador a otra persona.'
  return null
}

export type AccionDeBaja = 'borrar' | 'desactivar'

/** null si se puede borrar o desactivar a esta persona; si no, el porqué */
export function errorAlDarDeBaja(accion: AccionDeBaja, actorId: string, objetivo: PerfilParaGestion, adminsPlenos: number): string | null {
  const verbo = accion === 'borrar' ? 'borrar' : 'desactivar'
  if (objetivo.id === actorId) return `No puedes ${verbo}te a ti mismo.`
  if (esCorreoDelDueno(objetivo.email)) return `Al dueño no se le puede ${verbo}.`
  if (esAdminPleno(objetivo.role, objetivo.puesto ?? null) && adminsPlenos <= 1) return `Es el último administrador: no se le puede ${verbo}.`
  return null
}

/* ------------------------------------------------------------------ */
/* Las casillas: qué se pone y qué se quita al guardar                  */
/* ------------------------------------------------------------------ */

/**
 * Qué filas de user_app_permissions hay que poner y cuáles quitar al guardar las casillas de alguien.
 *
 * SOLO SE TOCAN LAS CASILLAS QUE LA PANTALLA GESTIONA (`gestionadas`). Antes la ruta de editar BORRABA TODAS las filas de la persona y volvía a meter solo las que la pantalla
 * conocía, así que un permiso sin casilla (el 'briefing', o los antiguos 'leads', 'finances', 'reports'…) desaparecía en silencio al guardar cualquier cosa. Un id que llegue
 * marcado y no esté en `gestionadas` se ignora: desde aquí no se puede conceder un permiso que la pantalla no ofrece.
 */
export function planDeCasillas(marcadas: readonly string[], gestionadas: ReadonlySet<string>): { poner: string[]; quitar: string[] } {
  const si = new Set(marcadas.filter((id) => gestionadas.has(id)))
  const poner = Array.from(si).sort()
  const quitar = Array.from(gestionadas).filter((id) => !si.has(id)).sort()
  return { poner, quitar }
}

/** Las casillas marcadas de lo que manda la pantalla (`[{ app_id, can_access }]`), sin repetir y sin basura */
export function casillasMarcadasDeLaPeticion(permisos: unknown): string[] {
  if (!Array.isArray(permisos)) return []
  const ids = new Set<string>()
  for (const p of permisos) {
    if (p && typeof p === 'object' && typeof (p as { app_id?: unknown }).app_id === 'string' && (p as { can_access?: unknown }).can_access === true) {
      ids.add((p as { app_id: string }).app_id)
    }
  }
  return Array.from(ids)
}

/** ¿Está desactivado? `banned_until` en el futuro (Supabase Auth guarda ahí el bloqueo) */
export function estaDesactivado(bannedUntil: string | null | undefined, ahora: number = Date.now()): boolean {
  if (!bannedUntil) return false
  const t = Date.parse(bannedUntil)
  return Number.isFinite(t) && t > ahora
}

/** Lo que se pide a Supabase Auth para desactivar (unos 100 años) o reactivar */
export const DURACION_DEL_BLOQUEO = '876000h'
