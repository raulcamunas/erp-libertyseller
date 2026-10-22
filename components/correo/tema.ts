'use client'

import { useEffect, useState } from 'react'

/**
 * ¿ESTÁ EL ERP EN TEMA OSCURO?
 *
 * El interruptor de tema (components/ui/ThemeToggle.tsx) pone o quita la clase `light` en el <html>. Aquí se lee esa
 * clase y se vigila, para que un correo ya abierto cambie de fondo en cuanto la persona cambia de tema. El oscuro es el
 * tema por defecto del ERP, así que es el valor de partida.
 */
export function useTemaOscuro(): boolean {
  const [oscuro, setOscuro] = useState(true)

  useEffect(() => {
    const raiz = document.documentElement
    const leer = () => setOscuro(!raiz.classList.contains('light'))
    leer()
    const observador = new MutationObserver(leer)
    observador.observe(raiz, { attributes: true, attributeFilter: ['class'] })
    return () => observador.disconnect()
  }, [])

  return oscuro
}
