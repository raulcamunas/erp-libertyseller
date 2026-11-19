'use client'

import { useSyncExternalStore } from 'react'

/**
 * EL TELÉFONO DE ZADARMA EN EL NAVEGADOR — el estado que comparten el teléfono (components/zadarma/TelefonoZadarma.tsx) y quien quiere llamar (la ficha del lead).
 *
 * El teléfono es el widget WebRTC v9 de Zadarma: habla por el micrófono y los altavoces del ordenador, sin la web de Zadarma ni la app. Para marcar desde un botón
 * propio se usa su motor (`window.zdrmWPhI.apiWidget.call(numero)`), que Zadarma no documenta: si un día cambia, `llamar` devuelve false y la ficha lo dice.
 */

export type EstadoDelTelefono = 'apagado' | 'cargando' | 'listo' | 'error'

let estado: { fase: EstadoDelTelefono; mensaje: string | null; numero: string | null } = { fase: 'apagado', mensaje: null, numero: null }
const oyentes = new Set<() => void>()

export function ponerEstado(fase: EstadoDelTelefono, mensaje: string | null = null, numero: string | null = estado.numero) {
  estado = { fase, mensaje, numero }
  for (const o of oyentes) o()
}

const suscribir = (o: () => void) => {
  oyentes.add(o)
  return () => oyentes.delete(o)
}

export function useTelefonoZadarma() {
  return useSyncExternalStore(suscribir, () => estado, () => estado)
}

interface MotorDeZadarma {
  call?: (n: string) => void
  reg?: (sip: string) => void
  unreg?: () => void
}
declare global {
  interface Window {
    zdrmWPhI?: { apiWidget?: MotorDeZadarma; callNum?: () => void }
    zadarmaWidgetFn?: (key: string, sip: string, forma: string, idioma: string, fijo: boolean, posicion: Record<string, string>) => void
  }
}

/** Llama a un número (internacional, «+52…») con el teléfono de Zadarma. false = el teléfono no está listo */
export function llamarConZadarma(numero: string): boolean {
  if (estado.fase !== 'listo') return false
  const motor = typeof window !== 'undefined' ? window.zdrmWPhI?.apiWidget : undefined
  if (!motor?.call) return false
  try {
    motor.call(numero.replace(/[^\d+]/g, ''))
    return true
  } catch {
    return false
  }
}
