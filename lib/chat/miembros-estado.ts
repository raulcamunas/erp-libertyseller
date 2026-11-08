import { useSyncExternalStore } from 'react'

/**
 * Si la barra de miembros del canal (la de la derecha, como en Discord) está abierta. Se recuerda en el navegador; por defecto abierta.
 * Módulo sin React salvo el gancho de abajo, para que lo lean a la vez el marco del chat (la columna), el panel y el botón de la cabecera.
 */
const CLAVE = 'chat:miembros'
const oyentes = new Set<() => void>()
let visible = true
let leido = false

function leer(): boolean {
  if (!leido && typeof window !== 'undefined') {
    leido = true
    try {
      visible = window.localStorage.getItem(CLAVE) !== '0'
    } catch {
      /* sin almacenamiento: abierta */
    }
  }
  return visible
}

export function ponerMiembrosVisibles(v: boolean): void {
  leer()
  visible = v
  try {
    window.localStorage.setItem(CLAVE, v ? '1' : '0')
  } catch {
    /* la preferencia no se guarda, pero el cambio vale para esta sesión */
  }
  oyentes.forEach((o) => o())
}

export const alternarMiembros = (): void => ponerMiembrosVisibles(!leer())

export function useMiembrosVisibles(): boolean {
  return useSyncExternalStore(
    (o) => {
      oyentes.add(o)
      return () => oyentes.delete(o)
    },
    leer,
    () => true
  )
}

/** La ventana de ajustes del canal (añadir y quitar gente) se abre desde la barra de miembros con este evento */
export const EVENTO_AJUSTES_DEL_CANAL = 'chat:ajustes-del-canal'
