import type { RolUsuario } from '@/lib/types/users'

/**
 * LOS PUESTOS DEL EQUIPO: COMERCIAL, MANAGER COMERCIAL Y GESTIÓN ADMINISTRATIVA — PURO.
 * =====================================================================================
 * Lo usan Gestión de Usuarios (el desplegable «Rol» y las casillas que se pre-marcan) y las rutas que crean y editan usuarios. Se comprueba con puestos.prueba.ts.
 *
 * UN PUESTO NO ES UN ROL. `profiles.role` sigue siendo uno de admin / employee / partner / cliente: hay muchísimo código con `role === 'employee'` (el layout, el registro
 * de actividad, las apps que se quedan abiertas, la barra lateral…) y un rol nuevo lo rompería sin dar error. El puesto es una columna aparte (`profiles.puesto`, migración
 * 257) que solo existe para NOMBRAR a cada persona y para PRE-MARCAR las casillas al crear o editar a alguien. Lo que da acceso a algo sigue siendo el rol y las casillas.
 * Por eso el desplegable ofrece los tres puestos como si fueran roles, pero al guardar se convierten en `role = 'employee'` + `puesto`.
 *
 * LAS CASILLAS DE CADA PUESTO salen de lo que tiene hoy el equipo de verdad (leído de user_app_permissions el 27 oct 2026): los cuatro comerciales tienen exactamente
 * agenda, cold-calling, correo, horas y rendimiento; el que supervisa suma equipo-comercial y correo-supervision; la persona de administración tiene correo y vacaciones.
 * Son un punto de partida: se pueden quitar y añadir a mano antes de guardar.
 */

export type Puesto = 'comercial' | 'manager_comercial' | 'gestion_administrativa'

export const PUESTOS: readonly Puesto[] = ['comercial', 'manager_comercial', 'gestion_administrativa']

export const esPuesto = (v: unknown): v is Puesto => typeof v === 'string' && (PUESTOS as readonly string[]).includes(v)

export const ETIQUETA_DE_PUESTO: Record<Puesto, string> = {
  comercial: 'Comercial',
  manager_comercial: 'Manager Comercial',
  gestion_administrativa: 'Gestión Administrativa',
}

/** Lo que se elige en el desplegable «Rol»: los roles del ERP y, además, los tres puestos */
export type OpcionDeRol = RolUsuario | Puesto

export interface OpcionDelDesplegable {
  valor: OpcionDeRol
  etiqueta: string
  /** Para agrupar en el desplegable */
  grupo: 'empleado' | 'puesto' | 'direccion' | 'externo'
  /** Qué significa, en una frase */
  ayuda: string
}

export const OPCIONES_DE_ROL: readonly OpcionDelDesplegable[] = [
  { valor: 'employee', etiqueta: 'Empleado', grupo: 'empleado', ayuda: 'Un empleado sin puesto concreto: solo tiene lo que se le marque abajo.' },
  { valor: 'comercial', etiqueta: 'Comercial', grupo: 'puesto', ayuda: 'Llama y agenda citas. Sale en el equipo de Cold Calling y en la Agenda, y se puede asignar leads y listas.' },
  {
    valor: 'manager_comercial',
    etiqueta: 'Manager Comercial',
    grupo: 'puesto',
    ayuda: 'Supervisa al equipo comercial: ve todos los leads, la agenda y los correos del equipo, y reparte listas y leads entre los comerciales.',
  },
  { valor: 'gestion_administrativa', etiqueta: 'Gestión Administrativa', grupo: 'puesto', ayuda: 'Administración: correo y vacaciones. No llama ni entra en Cold Calling.' },
  { valor: 'admin', etiqueta: 'Admin', grupo: 'direccion', ayuda: 'Dirección: accede a todo.' },
  { valor: 'partner', etiqueta: 'Partner', grupo: 'direccion', ayuda: 'Socio: accede a casi todo, incluidas las finanzas.' },
  { valor: 'cliente', etiqueta: 'Cliente (solo Remesas a FBA)', grupo: 'externo', ayuda: 'Fuera de la agencia: solo entra en Remesas a FBA, a las cuentas que se le den.' },
]

const ROLES: readonly string[] = ['admin', 'employee', 'partner', 'cliente']

/** La opción del desplegable que corresponde a un usuario ya guardado */
export function opcionDeRol(role: unknown, puesto: unknown): OpcionDeRol {
  if (typeof role === 'string' && ROLES.includes(role) && role !== 'employee') return role as RolUsuario
  return esPuesto(puesto) ? puesto : 'employee'
}

/** Lo que se guarda para una opción del desplegable: el rol del ERP y, si es un puesto, el puesto */
export function rolYPuestoDe(opcion: OpcionDeRol): { role: RolUsuario; puesto: Puesto | null } {
  return esPuesto(opcion) ? { role: 'employee', puesto: opcion } : { role: opcion, puesto: null }
}

/** Cómo se nombra a alguien en la tabla de usuarios */
export function etiquetaDeRol(role: unknown, puesto: unknown): string {
  const opcion = opcionDeRol(role, puesto)
  if (esPuesto(opcion)) return ETIQUETA_DE_PUESTO[opcion]
  return opcion === 'admin' ? 'Admin' : opcion === 'partner' ? 'Partner' : opcion === 'cliente' ? 'Cliente' : 'Empleado'
}

/* ------------------------------------------------------------------ */
/* Las casillas que se pre-marcan                                      */
/* ------------------------------------------------------------------ */

const BASE_COMERCIAL = ['agenda', 'cold-calling', 'correo', 'horas', 'rendimiento'] as const

/**
 * Los ids tienen que existir en `apps` o en `PERMISOS_SUELTOS` de lib/config/apps.ts, LETRA POR LETRA: uno que no exista no da ningún error, simplemente no se marca nada.
 * puestos.prueba.ts lo comprueba contra esas dos listas.
 */
export const PERMISOS_DEL_PUESTO: Readonly<Record<Puesto, readonly string[]>> = {
  comercial: BASE_COMERCIAL,
  manager_comercial: [...BASE_COMERCIAL, 'equipo-comercial', 'correo-supervision', 'gestion-listas'],
  gestion_administrativa: ['correo', 'vacaciones'],
}

export interface Casilla {
  app_id: string
  can_access: boolean
}

/**
 * Marca las casillas de un puesto sobre la lista de casillas del formulario.
 *   · 'sustituir'  deja marcadas SOLO las del puesto (al crear a alguien: no tiene nada que conservar)
 *   · 'sumar'      añade las del puesto a las que ya tenía (al editar: cambiar de puesto no le quita lo que ya se le dio)
 * Sin puesto (un empleado a secas) no toca nada. Solo cambia las casillas que existen en la lista.
 */
export function aplicarPuesto<T extends Casilla>(casillas: readonly T[], puesto: Puesto | null, modo: 'sustituir' | 'sumar'): T[] {
  if (puesto === null) return casillas.map((c) => ({ ...c }))
  const del = new Set(PERMISOS_DEL_PUESTO[puesto])
  return casillas.map((c) => ({ ...c, can_access: del.has(c.app_id) ? true : modo === 'sustituir' ? false : c.can_access }))
}

/** ¿Es alguien que llama? Un Comercial sí, siempre; una Gestión Administrativa no; un Manager según lo que se marque (por defecto, lo que ya era) */
export function esComercialDelPuesto(puesto: Puesto | null, marcado: boolean | undefined): boolean | undefined {
  if (puesto === 'comercial') return true
  if (puesto === 'gestion_administrativa') return false
  return marcado
}

/** ¿Se le crea una lista de leads propia al darlo de alta? A quien llama (un comercial, o un manager que también llama) */
export function llevaListaPropia(puesto: Puesto | null, esComercial: boolean): boolean {
  return puesto === 'comercial' || (puesto === 'manager_comercial' && esComercial)
}

/* ------------------------------------------------------------------ */
/* Lo que llega a las rutas                                            */
/* ------------------------------------------------------------------ */

export type CambioDePuesto = { ok: true; puesto?: Puesto | null; is_comercial?: boolean } | { ok: false; error: string }

/**
 * Lo que una petición de crear o editar un usuario quiere cambiar de su puesto, ya validado.
 *   · `puesto`       undefined = no se toca · null = se quita · un puesto = se pone. Solo un empleado puede tener puesto; si el rol final no lo es, se quita.
 *   · `is_comercial` undefined = no se toca. Un Comercial siempre es true y una Gestión Administrativa siempre false, diga lo que diga la petición.
 * `rolFinal` es el rol que tendrá la persona al terminar (el de la petición, o el que ya tenía si la petición no lo cambia).
 */
export function cambioDePuestoDeLaPeticion(cuerpo: { puesto?: unknown; is_comercial?: unknown }, rolFinal: string): CambioDePuesto {
  let puesto: Puesto | null | undefined
  if (cuerpo.puesto === undefined) puesto = undefined
  else if (cuerpo.puesto === null || cuerpo.puesto === '') puesto = null
  else if (esPuesto(cuerpo.puesto)) puesto = cuerpo.puesto
  else return { ok: false, error: 'Ese puesto no existe' }

  if (puesto && rolFinal !== 'employee') return { ok: false, error: 'Un puesto solo se le puede dar a un empleado' }
  if (puesto === undefined && rolFinal !== 'employee') puesto = null

  let marcado: boolean | undefined
  if (cuerpo.is_comercial === undefined) marcado = undefined
  else if (typeof cuerpo.is_comercial === 'boolean') marcado = cuerpo.is_comercial
  else return { ok: false, error: 'is_comercial tiene que ser verdadero o falso' }

  const salida: { ok: true; puesto?: Puesto | null; is_comercial?: boolean } = { ok: true }
  if (puesto !== undefined) salida.puesto = puesto
  const comercial = esComercialDelPuesto(puesto ?? null, marcado)
  if (comercial !== undefined) salida.is_comercial = comercial
  return salida
}
