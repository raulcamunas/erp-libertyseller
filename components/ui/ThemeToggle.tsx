'use client'

import { useEffect, useState } from 'react'
import { Moon, Sun } from 'lucide-react'

type Theme = 'dark' | 'light'

const STORAGE_KEY = 'erpTheme'

/**
 * Interruptor de tema. Pone o quita la clase `light` en el <html>, que es
 * donde viven las variables de color, y lo recuerda entre sesiones.
 *
 * El oscuro es el tema por defecto: es como se ha diseñado todo el ERP y
 * como se sirve desde el servidor, así que no hay parpadeo al cargar.
 */
export function ThemeToggle() {
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

  return (
    <button
      type="button"
      onClick={toggle}
      title={theme === 'dark' ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'}
      aria-label={theme === 'dark' ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'}
      className="h-9 w-9 rounded-full border border-[var(--border-color)] bg-[var(--glass-bg)] flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
    >
      {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  )
}
