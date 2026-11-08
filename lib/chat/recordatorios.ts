import { describirInstante, diasHastaElLunes, horaDeMadridEnDias, partesEnMadrid } from './tiempo'

/**
 * RECORDATORIOS Y MENSAJES PROGRAMADOS — PURO. Las opciones rápidas («en 1 hora», «mañana a las 9»…) y las reglas de qué fechas valen.
 */

export type OpcionDeAviso = '20min' | '1h' | '3h' | 'manana' | 'lunes'

export interface OpcionRapida {
  id: OpcionDeAviso
  nombre: string
}

export const OPCIONES_RAPIDAS: readonly OpcionRapida[] = [
  { id: '20min', nombre: 'En 20 minutos' },
  { id: '1h', nombre: 'En 1 hora' },
  { id: '3h', nombre: 'En 3 horas' },
  { id: 'manana', nombre: 'Mañana a las 9:00' },
  { id: 'lunes', nombre: 'El lunes a las 9:00' },
]

/** El instante de una opción rápida. Las de «mañana» y «lunes» son a las 9 de Madrid */
export function instanteDeOpcion(id: OpcionDeAviso, ahora: number): number {
  switch (id) {
    case '20min':
      return ahora + 20 * 60_000
    case '1h':
      return ahora + 3_600_000
    case '3h':
      return ahora + 3 * 3_600_000
    case 'manana':
      return horaDeMadridEnDias(ahora, 1, 9)
    case 'lunes':
      return horaDeMadridEnDias(ahora, diasHastaElLunes(partesEnMadrid(ahora).diaDeSemana), 9)
  }
}

/** Lo que se puede programar: al menos dentro de un minuto y como mucho dentro de un año */
export const MINIMO_MS = 60_000
export const MAXIMO_MS = 366 * 86_400_000

export type ResultadoDeFecha = { ok: true; en: number } | { ok: false; motivo: string }

export function fechaValida(entrada: unknown, ahora: number): ResultadoDeFecha {
  const ms = typeof entrada === 'string' ? Date.parse(entrada) : typeof entrada === 'number' ? entrada : NaN
  if (!Number.isFinite(ms)) return { ok: false, motivo: 'Elige una fecha y una hora.' }
  if (ms < ahora + MINIMO_MS) return { ok: false, motivo: 'Esa hora ya ha pasado: elige una que esté por llegar.' }
  if (ms > ahora + MAXIMO_MS) return { ok: false, motivo: 'No se puede programar a más de un año.' }
  return { ok: true, en: ms }
}

/** Para los avisos y las listas: «hoy a las 17:30» */
export const cuando = describirInstante
