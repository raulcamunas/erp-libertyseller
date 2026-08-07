'use client'

import { useEffect } from 'react'
import { motion } from 'framer-motion'
import { X } from 'lucide-react'

/**
 * El diálogo del módulo.
 *
 * Overlay propio con framer-motion y no el de Radix (components/ui/dialog.tsx),
 * igual que hacen empleados, vacaciones y stock-sync: los módulos nuevos del
 * ERP comparten este patrón y mezclarlos deja dos comportamientos distintos de
 * cierre y de foco en la misma pantalla.
 *
 * Escape cierra. Es lo que la gente prueba primero cuando ha abierto algo por
 * error, y aquí uno de los diálogos desconecta la tienda de un cliente.
 */
export function Dialogo({
  title,
  subtitle,
  onClose,
  children,
  maxWidth = 'max-w-md',
}: {
  title: string
  subtitle?: string
  onClose: () => void
  children: React.ReactNode
  maxWidth?: string
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        onClick={onClose}
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
      />
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.18 }}
        className={`relative w-full ${maxWidth} max-h-[85vh] overflow-y-auto rounded-2xl border border-white/10 bg-[#0d0d0d] p-4 shadow-2xl`}
      >
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="min-w-0">
            <h2 className="text-[14px] font-semibold text-white">{title}</h2>
            {subtitle && <p className="text-[11px] text-white/45 mt-0.5">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="flex-shrink-0 h-7 w-7 rounded-lg border border-white/10 bg-white/[0.03] text-white/50 flex items-center justify-center hover:text-white hover:border-white/20 transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {children}
      </motion.div>
    </div>
  )
}
