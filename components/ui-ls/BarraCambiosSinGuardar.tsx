'use client'

import { AnimatePresence, motion, MotionConfig } from 'framer-motion'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Save, Undo2 } from 'lucide-react'
import { Boton } from './Boton'

/**
 * BARRA DE CAMBIOS SIN GUARDAR. Sube desde abajo cuando hay cambios, con «Descartar» y «Guardar». Se pinta en un PORTAL en el body: dentro de la página
 * (.pagina-de-ruta, que deja un transform puesto) un `fixed` se colocaría respecto a ese recuadro y no a la ventana.
 *
 * En el ordenador se centra en el hueco del contenido (descontando la barra lateral, --lat-ancho); en el móvil ocupa el ancho con margen y respeta la zona segura.
 * Mientras se ve, avisa al cerrar o recargar la pestaña (`avisarAlSalir`, activo por defecto). Ctrl/Cmd + S guarda.
 *
 *   <BarraCambiosSinGuardar visible={sucio} cuantos={3} guardando={guardando} onGuardar={guardar} onDescartar={descartar} />
 */
export interface BarraCambiosSinGuardarProps {
  visible: boolean
  onGuardar: () => void
  onDescartar?: () => void
  /** Cuántos cambios hay («3 cambios sin guardar») */
  cuantos?: number
  guardando?: boolean
  texto?: string
  avisarAlSalir?: boolean
}

export function BarraCambiosSinGuardar({ visible, onGuardar, onDescartar, cuantos, guardando, texto, avisarAlSalir = true }: BarraCambiosSinGuardarProps) {
  const [montado, setMontado] = useState(false)
  useEffect(() => setMontado(true), [])

  useEffect(() => {
    if (!visible || !avisarAlSalir) return
    const aviso = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', aviso)
    return () => window.removeEventListener('beforeunload', aviso)
  }, [visible, avisarAlSalir])

  useEffect(() => {
    if (!visible) return
    const atajo = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        if (!guardando) onGuardar()
      }
    }
    window.addEventListener('keydown', atajo)
    return () => window.removeEventListener('keydown', atajo)
  }, [visible, guardando, onGuardar])

  if (!montado) return null
  const mensaje = texto ?? (cuantos != null ? `${cuantos.toLocaleString('es-ES')} ${cuantos === 1 ? 'cambio' : 'cambios'} sin guardar` : 'Tienes cambios sin guardar')

  return createPortal(
    <MotionConfig reducedMotion="user">
      <AnimatePresence>
        {visible && (
          <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex justify-center px-3 pb-[max(12px,env(safe-area-inset-bottom))] lg:left-[var(--lat-ancho,16rem)] lg:pb-6">
            <motion.div
              role="region"
              aria-label="Cambios sin guardar"
              initial={{ y: 80, opacity: 0, scale: 0.98 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: 80, opacity: 0, scale: 0.98 }}
              transition={{ type: 'spring', stiffness: 420, damping: 34 }}
              className="pointer-events-auto flex w-full max-w-[560px] flex-wrap items-center gap-x-4 gap-y-2 rounded-[16px] border border-[var(--ls-linea2)] bg-[color-mix(in_srgb,var(--ls-sup2)_92%,transparent)] py-[10px] pl-4 pr-[10px] shadow-[var(--ls-sombra-3)] backdrop-blur-xl"
            >
              <span className="flex min-w-0 flex-1 items-center gap-[10px] text-[13px] font-medium text-[var(--ls-t1)]">
                <span className="relative flex h-2 w-2 shrink-0" aria-hidden>
                  <span className="absolute inline-flex h-full w-full rounded-full bg-[var(--ls-e-ambar)] opacity-60 motion-safe:animate-ping" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--ls-e-ambar)]" />
                </span>
                <span className="truncate" aria-live="polite">
                  {mensaje}
                </span>
              </span>
              <div className="flex shrink-0 items-center gap-2">
                {onDescartar && (
                  <Boton variante="fantasma" tamano="sm" icono={Undo2} onClick={onDescartar} disabled={guardando}>
                    Descartar
                  </Boton>
                )}
                <Boton variante="primario" tamano="sm" icono={Save} onClick={onGuardar} cargando={guardando}>
                  {guardando ? 'Guardando…' : 'Guardar'}
                </Boton>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </MotionConfig>,
    document.body,
  )
}
