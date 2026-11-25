'use client'

import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { toast } from 'sonner'
import { Plus, RefreshCw, Tag, X } from 'lucide-react'
import { COLOR_ESTADO } from '@/lib/estilo/denso'
import type { MarcaGuardada, OrigenDeMarca } from '@/lib/seo/marcas'
import { llamar } from '@/components/marketing-test/llamar'
import { useDelProducto } from './useDelProducto'

/**
 * LAS MARCAS DE LA COMPETENCIA de la cuenta y país (pestaña Competencia). Las búsquedas que llevan una no se trabajan en la ficha (lib/seo/marcas.ts). Se llenan solas cada pocas horas;
 * aquí se ven de dónde salió cada una, se añaden a mano y se quitan («no es una marca»: no vuelve sola). «Buscar ahora» lanza la búsqueda al momento.
 */

const ORIGEN: Record<OrigenDeMarca, { texto: string; pista: string }> = {
  rival: { texto: 'competidor', pista: 'Marca de un competidor que sigues' },
  clics: { texto: 'se lleva clics', pista: 'Marca de uno de los 3 productos que se llevan los clics en alguna búsqueda' },
  ia: { texto: 'IA', pista: 'La IA la ha visto en las búsquedas de Brand Analytics' },
  manual: { texto: 'a mano', pista: 'Añadida por alguien del equipo' },
}

export function MarcasDeLaCompetencia({ cuentaId, alCambiar }: { cuentaId: string; alCambiar?: () => void }) {
  const d = useDelProducto<{ disponible: boolean; marcas: MarcaGuardada[]; propias: string[] }>(`/api/seo/marcas?cuenta=${encodeURIComponent(cuentaId)}`)
  const [texto, setTexto] = useState('')
  const [buscando, setBuscando] = useState(false)
  const [verTodas, setVerTodas] = useState(false)

  const activas = (d.datos?.marcas ?? []).filter((m) => m.activa)
  const quitadas = (d.datos?.marcas ?? []).filter((m) => !m.activa)
  const visibles = verTodas ? activas : activas.slice(0, 40)

  async function enviar(cuerpo: Record<string, unknown>, ok: string) {
    try {
      const r = await llamar<{ nuevas?: number; revisadasIa?: number; pendientesIa?: number }>('/api/seo/marcas', { metodo: 'POST', cuerpo: { cuenta: cuentaId, ...cuerpo } })
      toast.success(cuerpo.accion === 'actualizar' ? `${r.nuevas ?? 0} marcas nuevas · ${r.revisadasIa ?? 0} búsquedas repasadas${r.pendientesIa ? ` (quedan ${r.pendientesIa}: siguen solas)` : ''}` : ok)
      await d.recargar()
      alCambiar?.()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se ha podido.')
    }
  }

  if (d.datos && !d.datos.disponible)
    return <p className="rounded-[14px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] px-4 py-3 text-[12.5px] text-[var(--ls-t3)]">Las marcas de la competencia llegan al lanzar la migración 338 en Supabase.</p>

  return (
    <section className="rounded-[16px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Tag className="h-[15px] w-[15px]" style={{ color: COLOR_ESTADO.magenta }} />
        <h3 className="text-[13.5px] font-semibold text-[var(--ls-t1)]">Marcas de la competencia</h3>
        <span className="text-[11.5px] text-[var(--ls-t4)]">{activas.length} · las búsquedas que las llevan no se trabajan en la ficha</span>
        <button
          type="button"
          disabled={buscando}
          onClick={async () => {
            setBuscando(true)
            await enviar({ accion: 'actualizar' }, '')
            setBuscando(false)
          }}
          className="ml-auto inline-flex h-[30px] items-center gap-[6px] rounded-[9px] border border-[var(--ls-linea)] px-[10px] text-[12px] font-medium text-[var(--ls-t2)] transition-colors hover:bg-[var(--ls-sup2)] disabled:opacity-60"
        >
          <RefreshCw className={`h-[13px] w-[13px] ${buscando ? 'animate-spin' : ''}`} /> {buscando ? 'Buscando…' : 'Buscar ahora'}
        </button>
      </div>
      {d.datos && d.datos.propias.length > 0 && <p className="mt-1 text-[11.5px] text-[var(--ls-t4)]">Tu marca ({d.datos.propias.join(', ')}) nunca cuenta como ajena.</p>}

      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (!texto.trim()) return
          void enviar({ accion: 'anadir', texto }, `«${texto.trim()}» añadida.`)
          setTexto('')
        }}
      >
        <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Añadir una marca a mano (p. ej. skechers)" className="h-[32px] min-w-0 flex-1 rounded-[9px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-3 text-[12.5px] text-[var(--ls-t1)] outline-none focus:border-[var(--ls-acc)]" />
        <button type="submit" className="inline-flex h-[32px] items-center gap-1 rounded-[9px] bg-[var(--ls-acc-relleno)] px-3 text-[12.5px] font-semibold text-[var(--ls-acc-tinta)]">
          <Plus className="h-[14px] w-[14px]" /> Añadir
        </button>
      </form>

      {d.cargando && !d.datos ? (
        <p className="mt-3 text-[12px] text-[var(--ls-t4)]">Cargando…</p>
      ) : activas.length === 0 ? (
        <p className="mt-3 text-[12.5px] text-[var(--ls-t3)]">Todavía no hay ninguna. Pulsa «Buscar ahora» o espera a la próxima pasada (cada pocas horas).</p>
      ) : (
        <div className="mt-3 flex flex-wrap gap-[6px]">
          <AnimatePresence initial={false}>
            {visibles.map((m) => (
              <motion.span key={m.clave} layout initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} className="group inline-flex items-center gap-[6px] rounded-full border border-[var(--ls-linea)] bg-[var(--ls-sup2)] py-[3px] pl-[10px] pr-[4px] text-[12px] text-[var(--ls-t1)]" title={ORIGEN[m.origen].pista}>
                {m.texto}
                <span className="text-[10px] text-[var(--ls-t4)]">{ORIGEN[m.origen].texto}</span>
                <button type="button" onClick={() => void enviar({ accion: 'quitar', clave: m.clave }, `«${m.texto}» ya no cuenta como marca de la competencia.`)} className="flex h-[18px] w-[18px] items-center justify-center rounded-full text-[var(--ls-t4)] transition-colors hover:bg-[var(--ls-sup3)] hover:text-[var(--ls-t1)]" title="No es una marca de la competencia">
                  <X className="h-[11px] w-[11px]" />
                </button>
              </motion.span>
            ))}
          </AnimatePresence>
          {activas.length > 40 && (
            <button type="button" onClick={() => setVerTodas((v) => !v)} className="text-[12px] font-medium text-[var(--ls-acc)] hover:underline">
              {verTodas ? 'Ver menos' : `Ver las ${activas.length}`}
            </button>
          )}
        </div>
      )}
      {quitadas.length > 0 && <p className="mt-3 text-[11.5px] text-[var(--ls-t4)]">Quitadas por el equipo (no vuelven solas): {quitadas.map((m) => m.texto).join(', ')}. Para recuperar una, añádela a mano.</p>}
    </section>
  )
}
