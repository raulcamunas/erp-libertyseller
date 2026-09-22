'use client'

import { motion } from 'framer-motion'
import { Check } from 'lucide-react'
import { ESTADOS, PASOS_VISIBLES, indiceDePaso, type EstadoRemesa } from '@/lib/fba/flujo'

/**
 * LOS PASOS DEL ENVÍO, EN HORIZONTAL.
 *
 * No es decoración: es lo que contesta «¿y ahora qué toca, y a quién?» sin
 * tener que preguntarlo. Los pasos pasados van en verde con su marca, el actual
 * en naranja y con un halo que respira, y los que faltan apagados.
 *
 * La línea de progreso se anima de un paso a otro con `layoutId`, así que al
 * aprobar se ve AVANZAR en vez de aparecer ya avanzada. Es medio segundo de
 * animación, pero es lo que hace que se entienda que algo ha pasado.
 */
export function Pasarela({ estado }: { estado: EstadoRemesa }) {
  const actual = indiceDePaso(estado)
  const cerrada = estado === 'cerrada'

  return (
    <div className="glass-card px-4 py-3">
      <div className="flex items-center">
        {PASOS_VISIBLES.map((paso, i) => {
          const info = ESTADOS[paso]
          const pasado = cerrada || i < actual
          const esActual = !cerrada && i === actual
          return (
            <div key={paso} className="flex flex-1 items-center last:flex-none">
              <div className="flex flex-col items-center gap-1.5" title={info.pista}>
                <div className="relative">
                  {esActual && (
                    <motion.span
                      className="absolute -inset-1.5 rounded-full bg-[#FF6600]/20"
                      animate={{ scale: [1, 1.25, 1], opacity: [0.5, 0.15, 0.5] }}
                      transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
                    />
                  )}
                  <motion.div
                    initial={false}
                    animate={{
                      backgroundColor: pasado ? 'rgba(52,211,153,0.15)' : esActual ? '#FF6600' : 'rgba(255,255,255,0.04)',
                      borderColor: pasado ? 'rgba(52,211,153,0.4)' : esActual ? '#FF6600' : 'rgba(255,255,255,0.1)',
                    }}
                    transition={{ duration: 0.35 }}
                    className="relative flex h-6 w-6 items-center justify-center rounded-full border"
                  >
                    {pasado ? (
                      <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 400, damping: 20 }}>
                        <Check className="h-3 w-3 text-emerald-400" />
                      </motion.span>
                    ) : (
                      <span className={`text-[10px] font-semibold ${esActual ? 'text-white' : 'text-white/30'}`}>
                        {i + 1}
                      </span>
                    )}
                  </motion.div>
                </div>
                <span
                  className={`whitespace-nowrap text-[10px] font-medium ${
                    esActual ? 'text-white' : pasado ? 'text-emerald-400/70' : 'text-white/25'
                  }`}
                >
                  {info.texto}
                </span>
              </div>

              {i < PASOS_VISIBLES.length - 1 && (
                <div className="mx-2 h-px flex-1 overflow-hidden rounded bg-white/[0.07]">
                  <motion.div
                    initial={{ scaleX: 0 }}
                    animate={{ scaleX: pasado ? 1 : 0 }}
                    transition={{ duration: 0.45, ease: 'easeOut', delay: pasado ? i * 0.06 : 0 }}
                    style={{ originX: 0 }}
                    className="h-full bg-emerald-400/40"
                  />
                </div>
              )}
            </div>
          )
        })}
      </div>

      <p className="mt-2 text-center text-[11px] text-white/45">{ESTADOS[estado].pista}</p>
    </div>
  )
}
