import { ambitoDeRuta } from './ambito'

/**
 * QUIÉN ESTÁ DÓNDE EN TAREAS DE CLIENTES — PURO.
 *
 * Cada persona que tiene el módulo abierto cuenta, por un canal privado de tiempo real (Presence de Supabase: viaja por memoria, no toca el disco de la base), en qué cliente está y qué
 * tarea tiene abierta, y si está escribiendo en ella. Aquí viven las cuentas que no dependen de la red: unir los dispositivos de una persona, decir si está activa o quieta, y buscar
 * quién está en un cliente o en una tarea.
 */

/** Lo que cuenta cada persona de sí misma */
export interface EstadoDePresencia {
  id: string
  nombre: string
  /** En qué pantalla está: `inicio`, `dia`, `todas`, `mias` o `cliente` */
  pantalla: 'inicio' | 'dia' | 'todas' | 'mias' | 'cliente'
  clienteId: string | null
  tareaId: string | null
  /** La tarea en cuyo cuerpo está escribiendo y hasta cuándo vale ese «escribiendo» (ms): si deja de escribir caduca solo */
  escribiendoEn: string | null
  escribiendoHasta: number
  /** Cuándo vio ESTE navegador por última vez que se movía (ms, de su propio reloj: ver `normalizarActividad`) */
  actividad: number
  /** La propia persona avisa de que se ha quedado quieta (pestaña oculta o sin tocar nada) */
  quieto: boolean
}

/** Lo que manda cada persona por el canal. `pulso` sube cada vez que hace algo: así quien mira sabe si sigue ahí sin fiarse de que los relojes de los dos ordenadores coincidan */
export type PayloadDePresencia = Omit<EstadoDePresencia, 'actividad'> & { pulso: number }

export type EstadoDeConexion = 'activo' | 'quieto'

export interface Conectado extends EstadoDePresencia {
  estado: EstadoDeConexion
}

/** Sin tocar nada durante este rato, una persona pasa de «activa» a «quieta» */
export const QUIETA_TRAS_MS = 2 * 60_000
/** Cuánto dura un «está escribiendo» desde la última letra */
export const ESCRIBIENDO_MS = 8_000

export const estadoDeActividad = (actividad: number, ahora: number, pestanaVisible = true): EstadoDeConexion => (pestanaVisible && ahora - actividad < QUIETA_TRAS_MS ? 'activo' : 'quieto')

export type Observados = ReadonlyMap<string, { pulso: number; visto: number }>

/**
 * De lo que entrega Presence (con `pulso`, del reloj de cada cual) a estados con `actividad` en el reloj de ESTE navegador: la última vez que se vio cambiar el pulso de ese dispositivo. Un
 * dispositivo nuevo cuenta como visto ahora. Devuelve también lo observado, para la vez siguiente.
 */
export function normalizarActividad(bruto: Record<string, ReadonlyArray<Partial<PayloadDePresencia> & { presence_ref?: string }>>, previo: Observados, ahora: number): { estados: Record<string, EstadoDePresencia[]>; observados: Map<string, { pulso: number; visto: number }> } {
  const observados = new Map<string, { pulso: number; visto: number }>()
  const estados: Record<string, EstadoDePresencia[]> = {}
  for (const [clave, lista] of Object.entries(bruto)) {
    estados[clave] = []
    lista.forEach((e, i) => {
      if (typeof e.id !== 'string' || typeof e.pulso !== 'number') return
      const k = `${clave}:${e.presence_ref ?? i}`
      const antes = previo.get(k)
      const visto = antes && antes.pulso === e.pulso ? antes.visto : ahora
      observados.set(k, { pulso: e.pulso, visto })
      const { pulso: _p, ...resto } = e as PayloadDePresencia
      void _p
      estados[clave].push({ ...resto, quieto: e.quieto === true, actividad: visto })
    })
  }
  return { estados, observados }
}

/**
 * Lo que entrega Presence (`{ <clave>: [estado, estado…] }`, un estado por dispositivo o pestaña) como UNA persona por id: la pestaña con lo último hecho manda, y una persona con una pestaña
 * activa nunca sale «quieta» por otra que dejó abierta.
 */
export function unirDispositivos(bruto: Record<string, ReadonlyArray<Partial<EstadoDePresencia>>>, ahora: number): Conectado[] {
  const salida: Conectado[] = []
  for (const [clave, estados] of Object.entries(bruto)) {
    const validos = estados.filter((e): e is EstadoDePresencia => typeof e.id === 'string' && typeof e.actividad === 'number')
    if (validos.length === 0) continue
    const ultimo = validos.reduce((a, b) => (b.actividad > a.actividad ? b : a))
    salida.push({ ...ultimo, id: ultimo.id || clave, nombre: ultimo.nombre || 'Alguien', estado: estadoDeActividad(ultimo.actividad, ahora, !ultimo.quieto) })
  }
  return ordenar(salida)
}

/** Primero las activas, luego las quietas, y por nombre dentro de cada grupo */
export const ordenar = (lista: readonly Conectado[]): Conectado[] => [...lista].sort((a, b) => (a.estado === b.estado ? a.nombre.localeCompare(b.nombre, 'es') : a.estado === 'activo' ? -1 : 1))

/** Quién más (no yo) está viendo ese cliente */
export const enCliente = (conectados: readonly Conectado[], clienteId: string, yo: string): Conectado[] => conectados.filter((c) => c.id !== yo && c.clienteId === clienteId)

/** Quién más (no yo) tiene abierta esa tarea */
export const enTarea = (conectados: readonly Conectado[], tareaId: string, yo: string): Conectado[] => conectados.filter((c) => c.id !== yo && c.tareaId === tareaId)

/** Quién más está escribiendo ahora mismo en esa tarea */
export const escribiendoEnTarea = (conectados: readonly Conectado[], tareaId: string, ahora: number, yo: string): Conectado[] =>
  conectados.filter((c) => c.id !== yo && c.escribiendoEn === tareaId && c.escribiendoHasta > ahora)

/** Los cuentan por tarea, para pintar las marcas en las tarjetas de un tablero de una vez: tarea → personas que la tienen abierta */
export function porTarea(conectados: readonly Conectado[], yo: string): Map<string, Conectado[]> {
  const m = new Map<string, Conectado[]>()
  for (const c of conectados) {
    if (c.id === yo || !c.tareaId) continue
    m.set(c.tareaId, [...(m.get(c.tareaId) ?? []), c])
  }
  return m
}

/** Y por cliente (para las tarjetas del inicio y la barra lateral) */
export function porCliente(conectados: readonly Conectado[], yo: string): Map<string, Conectado[]> {
  const m = new Map<string, Conectado[]>()
  for (const c of conectados) {
    if (c.id === yo || !c.clienteId) continue
    m.set(c.clienteId, [...(m.get(c.clienteId) ?? []), c])
  }
  return m
}

/** La pantalla y el cliente de una dirección del módulo; la tarea la pone quien la tiene abierta */
export function lugarDeRuta(ruta: string): { pantalla: EstadoDePresencia['pantalla']; clienteId: string | null } {
  const a = ambitoDeRuta(ruta)
  if (!a) return { pantalla: 'inicio', clienteId: null }
  if (a.tipo === 'cliente') return { pantalla: 'cliente', clienteId: a.id }
  return { pantalla: a.tipo === 'dia' ? 'dia' : a.tipo === 'mias' ? 'mias' : 'todas', clienteId: null }
}

/** En una frase dónde está alguien: «Mi día», «ShoesF», «ShoesF · Revisar errores de precio» */
export function describirLugar(c: Pick<EstadoDePresencia, 'pantalla' | 'clienteId' | 'tareaId'>, nombreDeCliente: (id: string) => string | undefined, tituloDeTarea: (id: string) => string | undefined): string {
  if (c.pantalla === 'cliente' && c.clienteId) {
    const cliente = nombreDeCliente(c.clienteId) ?? 'un cliente'
    const tarea = c.tareaId ? tituloDeTarea(c.tareaId) : undefined
    return tarea !== undefined ? `${cliente} · ${tarea || 'Tarea sin título'}` : cliente
  }
  if (c.tareaId) return tituloDeTarea(c.tareaId) || 'Una tarea'
  return { inicio: 'El inicio', dia: 'Mi día', todas: 'Todas las tareas', mias: 'Sus tareas', cliente: 'Un cliente' }[c.pantalla]
}

/** El equipo que NO está conectado: los de la lista que no salen entre los conectados */
export const desconectados = <T extends { id: string }>(equipo: readonly T[], conectados: readonly Conectado[]): T[] => {
  const ids = new Set(conectados.map((c) => c.id))
  return equipo.filter((p) => !ids.has(p.id))
}

/** «Daniella», «Daniella y Patricia», «Daniella, Patricia y 2 más» */
export function nombresEnFrase(nombres: readonly string[]): string {
  const n = nombres.map((x) => x.split(' ')[0])
  if (n.length <= 1) return n[0] ?? ''
  if (n.length === 2) return `${n[0]} y ${n[1]}`
  if (n.length === 3) return `${n[0]}, ${n[1]} y ${n[2]}`
  return `${n[0]}, ${n[1]} y ${n.length - 2} más`
}
