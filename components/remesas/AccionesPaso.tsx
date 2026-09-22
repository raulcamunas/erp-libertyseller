'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowRight, Loader2, Printer, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import {
  puedeAvanzar,
  puedeImprimirEtiquetas,
  siguientesPasos,
  type Actor,
  type Cuadre,
  type EstadoDeCajas,
  type EstadoRemesa,
} from '@/lib/fba/flujo'
import { FORMATOS } from '@/lib/fba/etiquetas'

/**
 * LOS BOTONES DE «¿Y AHORA QUÉ?».
 *
 * Solo salen los pasos que ESTE actor puede dar desde ESTE estado, y cada uno
 * dice antes de pulsarse qué va a pasar después. Los irreversibles piden
 * confirmación escrita, no un «¿seguro?» que se pulsa sin leer.
 *
 * Si un paso no se puede dar todavía, el botón NO desaparece: sale apagado con
 * la lista de lo que falta. Esconderlo obliga a adivinar por qué no está.
 */
export function AccionesPaso({
  remesaId,
  estado,
  actor,
  lineas,
  cuadre,
  cajas,
}: {
  remesaId: string
  estado: EstadoRemesa
  actor: Actor
  lineas: number
  cuadre?: Cuadre
  cajas?: EstadoDeCajas
}) {
  const router = useRouter()
  const [moviendo, setMoviendo] = useState<string | null>(null)
  const [confirmando, setConfirmando] = useState<string | null>(null)
  const [imprimiendo, setImprimiendo] = useState(false)
  const [formato, setFormato] = useState(FORMATOS[0].id)

  const pasos = siguientesPasos(estado, actor)

  async function mover(hasta: EstadoRemesa) {
    setMoviendo(hasta)
    try {
      const res = await fetch(`/api/fba/remesas/${remesaId}/estado`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hasta }),
      })
      const p = (await res.json().catch(() => null)) as { error?: string; motivos?: string[] } | null
      if (!res.ok) {
        // Se enseñan TODOS los motivos, uno por línea: arreglar de uno en uno
        // obliga a reintentar tantas veces como cosas falten.
        toast.error(p?.motivos?.join('\n') ?? p?.error ?? 'No se ha podido mover')
        return
      }
      toast.success('Hecho')
      setConfirmando(null)
      router.refresh()
    } finally {
      setMoviendo(null)
    }
  }

  async function imprimir() {
    setImprimiendo(true)
    try {
      const res = await fetch(`/api/fba/remesas/${remesaId}/etiquetas?formato=${formato}`)
      if (!res.ok) {
        const p = (await res.json().catch(() => null)) as { error?: string } | null
        toast.error(p?.error ?? 'No se han podido generar las etiquetas')
        return
      }

      const descartadas = Number(res.headers.get('X-Descartadas') ?? 0)
      const impresas = res.headers.get('X-Etiquetas')
      const paginas = res.headers.get('X-Paginas')

      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      // Se abre en una pestaña en vez de descargar: casi siempre se mira antes
      // de mandarlo a la impresora, y así no se llena la carpeta de descargas.
      window.open(url, '_blank')
      setTimeout(() => URL.revokeObjectURL(url), 60_000)

      if (descartadas > 0) {
        const motivos = decodeURIComponent(res.headers.get('X-Motivos') ?? '')
        toast.warning(`${impresas} etiquetas en ${paginas} páginas, pero ${descartadas} sin imprimir`, {
          description: motivos.slice(0, 200),
          duration: 10_000,
        })
      } else {
        toast.success(`${impresas} etiquetas en ${paginas} página${paginas === '1' ? '' : 's'}`)
      }
    } finally {
      setImprimiendo(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {puedeImprimirEtiquetas(estado) && (
        <div className="flex items-center gap-1.5">
          <motion.button
            type="button"
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            onClick={imprimir}
            disabled={imprimiendo}
            className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-[12px] font-medium text-white/80 hover:border-white/25 hover:text-white disabled:opacity-40"
          >
            {imprimiendo ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Printer className="h-3.5 w-3.5" />}
            Etiquetas de producto
          </motion.button>
          <select
            value={formato}
            onChange={(e) => setFormato(e.target.value)}
            title="En qué hoja se van a imprimir"
            className="rounded-lg border border-white/10 bg-white/[0.03] px-1.5 py-1.5 text-[11px] text-white/60 focus:outline-none"
          >
            {FORMATOS.map((f) => (
              <option key={f.id} value={f.id} className="bg-[#0d0d0d]">
                {f.nombre}
              </option>
            ))}
          </select>
        </div>
      )}

      {pasos.map((paso) => {
        const permiso = puedeAvanzar(estado, paso.hasta, actor, { lineas, cuadre, cajas })
        const enConfirmacion = confirmando === paso.hasta
        return (
          <div key={paso.hasta} className="relative">
            <motion.button
              type="button"
              whileHover={permiso.puede ? { scale: 1.03 } : undefined}
              whileTap={permiso.puede ? { scale: 0.97 } : undefined}
              onClick={() => {
                if (!permiso.puede) return
                if (paso.irreversible) setConfirmando(enConfirmacion ? null : paso.hasta)
                else mover(paso.hasta)
              }}
              disabled={!permiso.puede || moviendo !== null}
              title={permiso.puede ? paso.consecuencia : permiso.motivos.map((m) => m.texto).join('. ')}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-colors ${
                !permiso.puede
                  ? 'cursor-not-allowed border border-white/[0.06] text-white/25'
                  : paso.irreversible
                    ? 'bg-amber-500/90 text-white hover:bg-amber-500'
                    : 'bg-[#FF6600] text-white hover:bg-[#FF6600]/85'
              }`}
            >
              {moviendo === paso.hasta ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : paso.irreversible ? (
                <TriangleAlert className="h-3.5 w-3.5" />
              ) : (
                <ArrowRight className="h-3.5 w-3.5" />
              )}
              {paso.boton}
            </motion.button>

            {/* Lo que falta, debajo del botón apagado */}
            {!permiso.puede && permiso.motivos.length > 0 && (
              <div className="absolute left-0 top-full z-20 mt-1 hidden w-64 rounded-lg border border-white/10 bg-[#0d0d0d] p-2 shadow-xl group-hover:block">
                {permiso.motivos.map((m) => (
                  <p key={m.texto} className="text-[11px] text-white/60">
                    · {m.texto}
                  </p>
                ))}
              </div>
            )}

            <AnimatePresence>
              {enConfirmacion && (
                <motion.div
                  initial={{ opacity: 0, y: -6, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -6, scale: 0.97 }}
                  className="absolute right-0 top-full z-30 mt-2 w-80 rounded-xl border border-amber-400/30 bg-[#0d0d0d] p-3 shadow-2xl"
                >
                  <p className="text-[12px] font-semibold text-amber-400">Esto no se deshace</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-white/60">{paso.consecuencia}</p>
                  <div className="mt-3 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setConfirmando(null)}
                      className="rounded-lg px-2.5 py-1 text-[11px] text-white/50 hover:text-white"
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      onClick={() => mover(paso.hasta)}
                      disabled={moviendo !== null}
                      className="rounded-lg bg-amber-500 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-amber-400 disabled:opacity-40"
                    >
                      Sí, adelante
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )
      })}

      {pasos.length === 0 && estado === 'cerrada' && (
        <span className="text-[11px] text-white/30">Esta remesa está cerrada</span>
      )}
      {pasos.length === 0 && estado !== 'cerrada' && (
        <span className="text-[11px] text-white/40">
          {actor === 'cliente' ? 'Le toca a Liberty Seller' : 'Le toca al cliente'}
        </span>
      )}
    </div>
  )
}
