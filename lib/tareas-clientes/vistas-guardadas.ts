import { FILTROS_VACIOS, type FiltrosDeTareas, type TipoDeVista } from './tipos'

/**
 * LAS VISTAS GUARDADAS — PURO.
 *
 * Una vista es un nombre + los filtros que se aplican (+ el modo en que se mira: tablero, tabla…). Hay dos clases:
 *
 *   · las PREDEFINIDAS («Mis vencidas», «Esta semana»…): salen del código, no se guardan en ninguna parte y cualquiera las tiene;
 *   · las GUARDADAS por el equipo (tabla `tc_vistas`): personales (`usuario_id` = quien la creó) o compartidas (`usuario_id` vacío; solo las crea un administrador).
 *
 * Lo que se guarda son SOLO los filtros que se apartan de los de por defecto: así una vista vieja sigue valiendo el día que se añada un filtro nuevo.
 * Los filtros recordados solos se descartaron a propósito (en Cold Calling escondieron listas enteras sin que nadie lo notase): aquí se elige una vista y se ve que se ha elegido.
 */

export interface ConfigDeVista {
  filtros: Partial<FiltrosDeTareas>
  vista?: TipoDeVista
}

export interface VistaGuardada {
  id: string
  nombre: string
  /** true = la ve todo el equipo */
  compartida: boolean
  /** true = es mía (la puedo borrar); una compartida solo la borra un administrador */
  propia: boolean
  config: ConfigDeVista
}

export interface VistaPredefinida {
  id: string
  nombre: string
  filtros: Partial<FiltrosDeTareas>
}

export const VISTAS_PREDEFINIDAS: readonly VistaPredefinida[] = [
  { id: 'mis-vencidas', nombre: 'Mis vencidas', filtros: { soloMias: true, fecha: 'vencidas' } },
  { id: 'mis-hoy', nombre: 'Mis tareas de hoy', filtros: { soloMias: true, fecha: 'hoy', ocultarHechas: true } },
  { id: 'mi-semana', nombre: 'Mi semana', filtros: { soloMias: true, fecha: 'semana', ocultarHechas: true } },
  { id: 'esta-semana', nombre: 'Esta semana (todo el equipo)', filtros: { fecha: 'semana', ocultarHechas: true } },
  { id: 'vencidas', nombre: 'Vencidas (todo el equipo)', filtros: { fecha: 'vencidas' } },
  { id: 'sin-responsable', nombre: 'Sin responsable', filtros: { sinResponsable: true, ocultarHechas: true } },
  { id: 'sin-fecha', nombre: 'Sin fecha', filtros: { fecha: 'sin_fecha', ocultarHechas: true } },
]

const FECHAS = ['todas', 'vencidas', 'hoy', 'semana', 'sin_fecha'] as const
const AGRUPAR = ['estado', 'departamento', 'responsable', 'cliente'] as const
const VISTAS = ['tablero', 'tabla', 'cronograma', 'calendario'] as const

const textos = (x: unknown, max: number): string[] => (Array.isArray(x) ? [...new Set(x.filter((v): v is string => typeof v === 'string' && v.length > 0 && v.length <= 120))].slice(0, max) : [])

/** Los filtros de una vista guardada, completos y saneados: lo que venga raro se ignora (la base de datos guarda JSON libre) */
export function filtrosDeConfig(raw: unknown): FiltrosDeTareas {
  const c = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const f = c.filtros && typeof c.filtros === 'object' ? (c.filtros as Record<string, unknown>) : {}
  return {
    busqueda: typeof f.busqueda === 'string' ? f.busqueda.slice(0, 200) : '',
    responsables: textos(f.responsables, 50),
    departamentos: textos(f.departamentos, 50),
    ocultarHechas: f.ocultarHechas === true,
    soloMias: f.soloMias === true,
    fecha: (FECHAS as readonly unknown[]).includes(f.fecha) ? (f.fecha as FiltrosDeTareas['fecha']) : 'todas',
    sinResponsable: f.sinResponsable === true,
    agruparPor: (AGRUPAR as readonly unknown[]).includes(f.agruparPor) ? (f.agruparPor as FiltrosDeTareas['agruparPor']) : FILTROS_VACIOS.agruparPor,
  }
}

export const vistaDeConfig = (raw: unknown): TipoDeVista | undefined => {
  const v = raw && typeof raw === 'object' ? (raw as { vista?: unknown }).vista : undefined
  return (VISTAS as readonly unknown[]).includes(v) ? (v as TipoDeVista) : undefined
}

/** Lo que se guarda de unos filtros: solo lo que no es el valor de por defecto */
export function configDeFiltros(f: FiltrosDeTareas, vista?: TipoDeVista): ConfigDeVista {
  const sal: Partial<FiltrosDeTareas> = {}
  if (f.busqueda.trim()) sal.busqueda = f.busqueda.trim()
  if (f.responsables.length) sal.responsables = f.responsables
  if (f.departamentos.length) sal.departamentos = f.departamentos
  if (f.ocultarHechas) sal.ocultarHechas = true
  if (f.soloMias) sal.soloMias = true
  if (f.fecha !== 'todas') sal.fecha = f.fecha
  if (f.sinResponsable) sal.sinResponsable = true
  if (f.agruparPor !== FILTROS_VACIOS.agruparPor) sal.agruparPor = f.agruparPor
  return vista ? { filtros: sal, vista } : { filtros: sal }
}

/** Los filtros que pone una vista predefinida (sobre los de por defecto, no sobre los que hubiera puestos) */
export const filtrosDePredefinida = (v: VistaPredefinida): FiltrosDeTareas => ({ ...FILTROS_VACIOS, ...v.filtros })

/** El nombre de una vista: sin espacios de más y de 1 a 60 letras; null = no vale */
export function nombreDeVista(entrada: unknown): string | null {
  if (typeof entrada !== 'string') return null
  const n = entrada.replace(/\s+/g, ' ').trim()
  return n.length >= 1 && n.length <= 60 ? n : null
}

/** ¿Estos filtros son EXACTAMENTE los de esa vista? Para marcar cuál es la que está puesta */
export function mismosFiltros(a: FiltrosDeTareas, b: FiltrosDeTareas): boolean {
  return JSON.stringify(configDeFiltros(a)) === JSON.stringify(configDeFiltros(b))
}
