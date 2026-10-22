'use client'

import { useEffect, useState } from 'react'
import { Moon, Sun } from 'lucide-react'
import { cn } from '@/lib/utils'

type Theme = 'dark' | 'light'

const STORAGE_KEY = 'erpTheme'

/**
 * Interruptor de tema. Pone o quita la clase `light` en el <html>, que es
 * donde viven las variables de color, y lo recuerda entre sesiones.
 *
 * El oscuro es el tema por defecto: es como se ha diseñado todo el ERP y
 * como se sirve desde el servidor, así que no hay parpadeo al cargar.
 *
 * VIVE ABAJO A LA IZQUIERDA, EN LA BARRA LATERAL (junto a las notificaciones). Antes era un círculo
 * fijo arriba a la derecha de la pantalla y tapaba lo que hubiera ahí: pestañas, desplegables de orden,
 * botones de cabecera. Con el aspecto de un botón más de la barra no tapa nada y se ve en todas las pantallas.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const [theme, setTheme] = useState<Theme>('dark')

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY)
    const next: Theme = saved === 'light' ? 'light' : 'dark'
    setTheme(next)
    document.documentElement.classList.toggle('light', next === 'light')
  }, [])

  function toggle() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    document.documentElement.classList.toggle('light', next === 'light')
    window.localStorage.setItem(STORAGE_KEY, next)
  }

  const titulo = theme === 'dark' ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'

  return (
    <button
      type="button"
      onClick={toggle}
      title={titulo}
      aria-label={titulo}
      className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white/70 transition-colors hover:bg-white/[0.05] hover:text-white', className)}
    >
      {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
    </button>
  )
}
