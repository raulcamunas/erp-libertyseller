import type { LucideIcon } from 'lucide-react'
import {
  BarChart3,
  BookOpenText,
  BriefcaseBusiness,
  KeyRound,
  Layers,
  Megaphone,
  Newspaper,
  PhoneCall,
  Sparkles,
  Store,
  UsersRound,
  Wrench,
} from 'lucide-react'
import { APPS_SIN_EFECTO, GRUPOS_DEL_MENU, PERMISOS_SUELTOS, apps } from '@/lib/config/apps'
import { APPS_SIN_MARCAR_AL_HACER_CEO, PUESTO_CEO } from '@/lib/usuarios/ceo'
import { PERMISOS_DEL_PUESTO, esPuesto } from '@/lib/usuarios/puestos'

/**
 * LAS CASILLAS DE GESTIÓN DE USUARIOS, ORDENADAS COMO EL MENÚ.
 * ============================================================
 * Una sola lista para la pantalla (pestaña «Accesos» de la ficha) y para la ruta de editar (qué filas de user_app_permissions puede tocar). Se comprueba con casillas.prueba.ts.
 *
 *   · Los grupos que ya existen en el menú lateral (GRUPOS_DEL_MENU: Contabilidad, Herramientas Agencia, Gestión de cuentas, Herramientas Entrais) salen igual aquí, con su
 *     nombre y su icono, para que quien da acceso vea lo mismo que verá la persona. El resto de apps se reparte en Comercial, Equipo, Marca y contenido y Otras.
 *   · Los permisos que no son una app (PERMISOS_SUELTOS: mapeo de stock, supervisiones, listas, IA, briefing) van juntos en «Permisos especiales».
 *   · Las casillas que no hacen nada (APPS_SIN_EFECTO, más el Inicio, que siempre está, y Gestión de Usuarios, que solo abre el dueño) se enseñan apagadas con su motivo y NO se
 *     tocan al guardar: una fila que ya exista se queda como está.
 */

export interface GrupoDeCasillas {
  id: string
  nombre: string
  icono: LucideIcon
}

export interface CasillaDePermiso {
  id: string
  nombre: string
  descripcion: string
  icono: LucideIcon
  grupo: string
  /** Si no hace nada, el porqué (se enseña apagada) */
  sinEfecto?: string
  /** Es un permiso suelto, no una app */
  especial?: boolean
}

const OTROS_GRUPOS: readonly GrupoDeCasillas[] = [
  { id: 'comercial', nombre: 'Comercial', icono: PhoneCall },
  { id: 'equipo', nombre: 'Equipo', icono: UsersRound },
  { id: 'marca', nombre: 'Marca y contenido', icono: Megaphone },
]

/** El orden de los grupos en la pantalla */
export const GRUPOS_DE_CASILLAS: readonly GrupoDeCasillas[] = [
  OTROS_GRUPOS[0],
  OTROS_GRUPOS[1],
  ...GRUPOS_DEL_MENU.map((g) => ({ id: g.id, nombre: g.name, icono: g.icon })),
  OTROS_GRUPOS[2],
  { id: 'otras', nombre: 'Otras', icono: Layers },
  { id: 'especiales', nombre: 'Permisos especiales', icono: KeyRound },
]

/** Dónde va cada app que no está en un grupo del menú */
const GRUPO_DE_APP: Readonly<Record<string, string>> = {
  'web-leads': 'comercial',
  agenda: 'comercial',
  crm: 'comercial',
  'cold-calling': 'comercial',
  rendimiento: 'comercial',
  correo: 'comercial',
  actividad: 'comercial',
  horas: 'equipo',
  vacaciones: 'equipo',
  chat: 'equipo',
  'tareas-clientes': 'equipo',
  'usos-horarios': 'equipo',
  tracker: 'equipo',
  'commissions-shoes-f': 'contabilidad',
  'limpieza-ofertas': 'herramientas-agencia',
  linkedin: 'marca',
  contenido: 'marca',
  disenos: 'marca',
}

/** Casillas que existen en `apps` pero no abren nada por sí solas (además de APPS_SIN_EFECTO) */
const SIN_EFECTO_EN_LA_PANTALLA: ReadonlyMap<string, string> = new Map([
  ['home', 'El Inicio lo ve siempre todo el mundo: no hace falta casilla.'],
  ['users', 'Gestión de Usuarios solo la abre el dueño del ERP: esta casilla no da acceso.'],
])

/** Iconos de los permisos sueltos, que no tienen tarjeta */
const ICONO_DE_ESPECIAL: Readonly<Record<string, LucideIcon>> = {
  'stock-sync': Store,
  'equipo-comercial': BriefcaseBusiness,
  'crm-propios': BookOpenText,
  'gestion-listas': BarChart3,
  'correo-supervision': Wrench,
  'config-correos': Sparkles,
  briefing: Newspaper,
}

const grupoDelMenuDe = new Map<string, string>(GRUPOS_DEL_MENU.flatMap((g) => g.apps.map((a) => [a, g.id] as const)))

export const CASILLAS: readonly CasillaDePermiso[] = [
  ...apps.map<CasillaDePermiso>((a) => ({
    id: a.id,
    nombre: a.name,
    descripcion: a.description,
    icono: a.icon,
    grupo: grupoDelMenuDe.get(a.id) ?? GRUPO_DE_APP[a.id] ?? 'otras',
    sinEfecto: APPS_SIN_EFECTO.get(a.id) ?? SIN_EFECTO_EN_LA_PANTALLA.get(a.id),
  })),
  ...PERMISOS_SUELTOS.map<CasillaDePermiso>((p) => ({
    id: p.id,
    nombre: p.name,
    descripcion: p.description,
    icono: ICONO_DE_ESPECIAL[p.id] ?? KeyRound,
    grupo: 'especiales',
    especial: true,
  })),
]

export const CASILLA_POR_ID: ReadonlyMap<string, CasillaDePermiso> = new Map(CASILLAS.map((c) => [c.id, c]))

/** Lo que la ruta de editar puede poner y quitar: todas las casillas que hacen algo */
export const CASILLAS_GESTIONADAS: ReadonlySet<string> = new Set(CASILLAS.filter((c) => !c.sinEfecto).map((c) => c.id))

/** Las casillas de un grupo, en el orden de `apps` */
export const casillasDelGrupo = (grupo: string): CasillaDePermiso[] => CASILLAS.filter((c) => c.grupo === grupo)

/**
 * Las casillas que pone un puesto (o el CEO). Sirve para enseñar «viene del puesto» frente a «añadido a mano». Sin puesto, ninguna.
 */
export function casillasDelPuesto(puesto: string | null | undefined): ReadonlySet<string> {
  if (!puesto) return new Set()
  if (puesto === PUESTO_CEO) {
    const sueltos = new Set(PERMISOS_SUELTOS.map((p) => p.id))
    return new Set(apps.map((a) => a.id).filter((id) => !APPS_SIN_MARCAR_AL_HACER_CEO.has(id) && !sueltos.has(id)))
  }
  return esPuesto(puesto) ? new Set(PERMISOS_DEL_PUESTO[puesto]) : new Set()
}

export type OrigenDeCasilla = 'puesto' | 'mano' | null

/** De dónde sale una casilla marcada: del puesto o puesta a mano. null si no está marcada */
export function origenDeCasilla(id: string, marcada: boolean, puesto: string | null | undefined): OrigenDeCasilla {
  if (!marcada) return null
  return casillasDelPuesto(puesto).has(id) ? 'puesto' : 'mano'
}

/** ¿Coincide con la búsqueda? Por nombre, id o descripción, sin acentos ni mayúsculas */
export function casillaCoincide(c: CasillaDePermiso, texto: string): boolean {
  const q = sinAcentos(texto.trim())
  if (!q) return true
  return sinAcentos(c.nombre).includes(q) || c.id.includes(q) || sinAcentos(c.descripcion).includes(q)
}

export const sinAcentos = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
