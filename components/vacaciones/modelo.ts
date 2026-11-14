import type { VacationsServerData } from '@/lib/employees/vacations'
import type { VacationBalance, VacationEmployee, VacationStatus } from '@/lib/types/vacations'
import type { TonoEstado } from '@/lib/estilo/denso'
import type { AusenciaDeEquipo, PersonaDeEquipo } from '@/lib/vacations/calendario'

/**
 * Lo que comparten las piezas de la pantalla ÚNICA de vacaciones (/dashboard/vacaciones). Sin 'use client': solo tipos
 * y constantes, para que el Server Component de la página pueda importarlos.
 */

/** El calendario de la empresa de un año, tal y como lo sirve /api/vacations/equipo */
export interface EquipoDelAnio {
  ausencias: AusenciaDeEquipo[]
  personas: PersonaDeEquipo[]
  maxALaVez: number
}

export interface DatosDePantalla {
  esAdmin: boolean
  userId: string
  /** La ficha de quien mira, o null (los admins no suelen tenerla; algún usuario puede no estar enlazado) */
  yo: VacationEmployee | null
  /** Su saldo del año, si tiene ficha */
  saldo: VacationBalance | null
  /** Admin: todo el equipo. Empleado: lo suyo */
  datos: VacationsServerData
  /** El año que se abre y su calendario de empresa, cargado en el servidor para que no parpadee */
  anio: number
  equipo: EquipoDelAnio
}

export const SELECCION_VACIA = null

export interface Seleccion {
  /** 'yyyy-MM-dd' */
  start: string
  /** 'yyyy-MM-dd', incluido */
  end: string
}

/** El color de cada estado, de la paleta común (lib/estilo/denso): nunca colores sueltos */
export const TONO_DE_ESTADO_VAC: Record<VacationStatus, TonoEstado> = {
  pendiente: 'ambar',
  aprobada: 'verde',
  rechazada: 'rojo',
  cancelada: 'gris',
}

export const TEXTO_DE_ESTADO_VAC: Record<VacationStatus, string> = {
  pendiente: 'Pendiente',
  aprobada: 'Aprobada',
  rechazada: 'Denegada',
  cancelada: 'Anulada',
}

/** Rayado de «día ocupado por otro»: se ve en oscuro y en claro porque sale de un token de texto */
export const RAYADO = 'repeating-linear-gradient(135deg, color-mix(in srgb, var(--ls-t4) 22%, transparent) 0 5px, transparent 5px 11px)'

/** Unidades de días con coma española, sin la palabra («1,83») */
export const numeroDeDias = (n: number): string =>
  (Math.round(n * 100) / 100).toLocaleString('es-ES', { maximumFractionDigits: 2, minimumFractionDigits: Number.isInteger(Math.round(n * 100) / 100) ? 0 : 2 })
