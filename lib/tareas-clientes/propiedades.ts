import type { OpcionSimple } from './tipos'

/**
 * LAS PROPIEDADES PROPIAS DE CADA CLIENTE — PURO.
 *
 * Cada base de Notion puede tener columnas que el ERP no conocía («Prioridad», «Enlace al informe», «Horas», «Revisado»…). Se detectan una vez por base (`esquemaDe`), se leen
 * de cada página y se guardan en `tc_tareas.propiedades` por su nombre. Solo los tipos que se pueden mostrar y escribir sin riesgo; lo demás (fórmulas, relaciones, fechas
 * automáticas, ficheros, personas…) queda fuera.
 *
 * El valor de cada tipo, tal como se guarda: select → texto | null · multi_select → lista de textos · number → número | null · checkbox → true/false · url, email,
 * phone_number y rich_text → texto | null · date → { start, end } | null.
 */

export const TIPOS_DE_PROPIEDAD = ['select', 'multi_select', 'number', 'checkbox', 'url', 'email', 'phone_number', 'rich_text', 'date'] as const
export type TipoDePropiedad = (typeof TIPOS_DE_PROPIEDAD)[number]

export interface PropiedadExtra {
  nombre: string
  tipo: TipoDePropiedad
  /** Las opciones de un select o multi_select */
  opciones?: OpcionSimple[]
}

export interface FechaDePropiedad {
  start: string
  end: string | null
}

export const MAX_EXTRAS = 25
export const MAX_TEXTO = 2000

export const esTipoSoportado = (t: string): t is TipoDePropiedad => (TIPOS_DE_PROPIEDAD as readonly string[]).includes(t)

const DIA_O_HORA = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/

/** El valor de una propiedad, comprobado y limpio para su tipo; `undefined` = no vale */
export function limpiarValor(extra: PropiedadExtra, valor: unknown): unknown | undefined {
  switch (extra.tipo) {
    case 'checkbox':
      return typeof valor === 'boolean' ? valor : undefined
    case 'number': {
      if (valor === null || valor === '') return null
      const n = typeof valor === 'number' ? valor : Number(valor)
      return Number.isFinite(n) ? n : undefined
    }
    case 'select': {
      if (valor === null || valor === '') return null
      return typeof valor === 'string' && valor.trim().length <= 100 ? valor.trim() : undefined
    }
    case 'multi_select': {
      if (!Array.isArray(valor)) return undefined
      const l = [...new Set(valor.filter((x): x is string => typeof x === 'string' && x.trim().length > 0 && x.trim().length <= 100).map((x) => x.trim()))]
      return l.length === valor.length || valor.every((x) => typeof x === 'string') ? l.slice(0, 30) : undefined
    }
    case 'url':
    case 'email':
    case 'phone_number':
    case 'rich_text': {
      if (valor === null) return null
      if (typeof valor !== 'string') return undefined
      const t = valor.trim().slice(0, MAX_TEXTO)
      if (!t) return null
      if (extra.tipo === 'url' && !/^https?:\/\//i.test(t)) return undefined
      if (extra.tipo === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) return undefined
      return t
    }
    case 'date': {
      if (valor === null) return null
      if (typeof valor !== 'object') return undefined
      const f = valor as { start?: unknown; end?: unknown }
      if (typeof f.start !== 'string' || !DIA_O_HORA.test(f.start)) return undefined
      if (f.end !== null && f.end !== undefined && (typeof f.end !== 'string' || !DIA_O_HORA.test(f.end) || f.end < f.start)) return undefined
      return { start: f.start, end: (f.end as string | null | undefined) ?? null } satisfies FechaDePropiedad
    }
  }
}

/**
 * Lo que llega del navegador (un objeto con SOLO las propiedades que se tocan) mezclado con lo que ya había. Una propiedad que el cliente no tiene o un valor que no vale
 * rechaza el cambio entero con el motivo.
 */
export function mezclarPropiedades(entrada: unknown, extras: readonly PropiedadExtra[], previas: Record<string, unknown> | null | undefined): { ok: true; valores: Record<string, unknown>; cambiadas: string[] } | { ok: false; motivo: string } {
  if (!entrada || typeof entrada !== 'object' || Array.isArray(entrada)) return { ok: false, motivo: 'Las propiedades no son un objeto.' }
  const valores: Record<string, unknown> = { ...(previas ?? {}) }
  const cambiadas: string[] = []
  for (const [nombre, valor] of Object.entries(entrada as Record<string, unknown>)) {
    const extra = extras.find((e) => e.nombre === nombre)
    if (!extra) return { ok: false, motivo: `Este cliente no tiene la propiedad «${nombre}».` }
    const limpio = limpiarValor(extra, valor)
    if (limpio === undefined) return { ok: false, motivo: `El valor de «${nombre}» no es válido.` }
    if (JSON.stringify(valores[nombre] ?? null) !== JSON.stringify(limpio)) {
      valores[nombre] = limpio
      cambiadas.push(nombre)
    }
  }
  return { ok: true, valores, cambiadas }
}

/** Un valor listo para pintar como texto (en una tabla o un resumen) */
export function comoTexto(extra: PropiedadExtra, valor: unknown): string {
  if (valor === null || valor === undefined) return ''
  if (extra.tipo === 'checkbox') return valor === true ? 'Sí' : 'No'
  if (extra.tipo === 'multi_select') return Array.isArray(valor) ? valor.join(', ') : ''
  if (extra.tipo === 'date') {
    const f = valor as Partial<FechaDePropiedad>
    return f.start ? `${f.start.slice(0, 10)}${f.end ? ` → ${f.end.slice(0, 10)}` : ''}` : ''
  }
  return String(valor)
}
