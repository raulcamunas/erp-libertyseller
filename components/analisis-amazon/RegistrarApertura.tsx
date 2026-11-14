'use client'

import { useEffect } from 'react'

/**
 * Apunta que el lead ha abierto su análisis: una vez por visita (sessionStorage), y a los 2 s, para no contar a quien abre y cierra sin mirar.
 * Si quien lo abre es alguien del equipo con sesión en el ERP, el servidor no lo cuenta (comprobar el enlace antes de mandarlo no avisa a nadie).
 */
export function RegistrarApertura({ token }: { token: string }) {
  useEffect(() => {
    const clave = `analisis-visto:${token}`
    try {
      if (sessionStorage.getItem(clave)) return
    } catch {
      /* sin almacenamiento: se cuenta igual */
    }
    const t = setTimeout(() => {
      const dispositivo = window.matchMedia('(max-width: 767px)').matches ? 'movil' : 'ordenador'
      void fetch('/api/analisis/abierto', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, dispositivo }),
        keepalive: true,
      })
        .then((r) => {
          if (r.ok) {
            try {
              sessionStorage.setItem(clave, '1')
            } catch {
              /* nada */
            }
          }
        })
        .catch(() => {})
    }, 2000)
    return () => clearTimeout(t)
  }, [token])
  return null
}
