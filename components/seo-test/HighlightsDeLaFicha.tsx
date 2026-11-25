'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Info, Pencil } from 'lucide-react'
import { COLOR_ESTADO } from '@/lib/estilo/denso'
import { LIMITE_HIGHLIGHTS_CARACTERES } from '@/lib/seo/cobertura'
import type { FichaGuardada } from '@/lib/seo/datos'
import { llamar } from '@/components/marketing-test/llamar'

/**
 * LOS ITEM HIGHLIGHTS DE LA FICHA. Si Amazon los da por la API, se enseñan tal cual. Si no (Opinas: tipo SIGNAGE), un administrativo los copia de Seller Central y
 * los pega aquí (migración 334): el ERP los usa como parte de la ficha en las recomendaciones (qué palabras faltan, Helium 10, la propuesta con IA). Si un día
 * Amazon los devuelve, mandan los de Amazon.
 */
export function HighlightsDeLaFicha({ cuentaId, asin, ficha, recargar, abrir }: { cuentaId: string; asin: string; ficha: FichaGuardada; recargar?: () => void | Promise<unknown>; /** Cada número nuevo abre el cuadro para pegarlos (el aviso de arriba de la pestaña Ficha) */ abrir?: number }) {
  const manual = ficha.highlightsManual ?? null
  const deAmazon = ficha.origenHighlights === 'amazon'
  const [editando, setEditando] = useState(false)
  const [texto, setTexto] = useState(manual?.texto ?? '')
  const [guardando, setGuardando] = useState(false)
  const largo = [...texto.trim()].length
  useEffect(() => {
    if (abrir) setEditando(true)
  }, [abrir])

  async function guardar(valor: string) {
    setGuardando(true)
    try {
      await llamar('/api/seo/highlights', { metodo: 'POST', cuerpo: { cuenta: cuentaId, asin, texto: valor } })
      toast.success(valor.trim() ? 'Item Highlights guardados: ya cuentan como parte de la ficha.' : 'Item Highlights a mano borrados.')
      setEditando(false)
      if (recargar) await recargar()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se han podido guardar.')
    } finally {
      setGuardando(false)
    }
  }

  if (editando) {
    return (
      <div className="flex flex-col gap-2">
        <textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          rows={3}
          autoFocus
          placeholder="Pega aquí los Item Highlights tal cual están en Seller Central"
          className="w-full resize-y rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-3 py-2 text-[13px] text-[var(--ls-t1)] outline-none focus:border-[var(--ls-acc-graf)] [@media(pointer:coarse)]:text-[16px]"
        />
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12px] tabular-nums" style={{ color: largo > LIMITE_HIGHLIGHTS_CARACTERES ? COLOR_ESTADO.rojo : 'var(--ls-t4)' }}>
            {largo} / {LIMITE_HIGHLIGHTS_CARACTERES} caracteres
          </span>
          <span className="ml-auto flex gap-2">
            {manual && (
              <button type="button" disabled={guardando} onClick={() => void guardar('')} className="rounded-[8px] px-3 py-1.5 text-[12.5px] text-[var(--ls-t3)] hover:bg-[var(--ls-sup2)] disabled:opacity-50">
                Borrar
              </button>
            )}
            <button type="button" disabled={guardando} onClick={() => setEditando(false)} className="rounded-[8px] px-3 py-1.5 text-[12.5px] text-[var(--ls-t3)] hover:bg-[var(--ls-sup2)] disabled:opacity-50">
              Cancelar
            </button>
            <button type="button" disabled={guardando || !texto.trim()} onClick={() => void guardar(texto)} className="rounded-[8px] bg-[var(--ls-acc)] px-3 py-1.5 text-[12.5px] font-semibold text-[var(--ls-acc-tinta)] disabled:opacity-50">
              {guardando ? 'Guardando…' : 'Guardar'}
            </button>
          </span>
        </div>
      </div>
    )
  }

  if (ficha.highlights && ficha.highlights.trim()) {
    return (
      <div className="flex flex-col gap-1.5">
        <p className="text-[13px] leading-[1.5] text-[var(--ls-t1)]">{ficha.highlights}</p>
        {deAmazon ? (
          <p className="text-[11.5px] text-[var(--ls-t4)]">Leídos de Amazon.</p>
        ) : (
          <p className="flex flex-wrap items-center gap-x-2 text-[11.5px] text-[var(--ls-t4)]">
            Puestos a mano{manual?.at ? ` el ${new Date(manual.at).toLocaleDateString('es-ES', { day: 'numeric', month: 'long' })}` : ''}: Amazon no los da por la API. Si cambian en Seller Central, actualízalos aquí.
            <button type="button" onClick={() => { setTexto(manual?.texto ?? ''); setEditando(true) }} className="inline-flex items-center gap-1 rounded-[6px] px-1.5 py-0.5 text-[var(--ls-t2)] hover:bg-[var(--ls-sup2)]">
              <Pencil className="h-3 w-3" aria-hidden /> Editar
            </button>
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="flex items-start gap-2 text-[12px] leading-[1.5] text-[var(--ls-t3)]">
        <Info className="mt-[3px] h-3 w-3 shrink-0" />
        {ficha.highlights === ''
          ? 'Vacíos: este tipo de producto los tiene en Amazon pero la ficha no los lleva. Se indexan igual que el título; ahí va lo que no cabe en los 75 caracteres. La propuesta con IA los escribe.'
          : 'Amazon no los da por la API para este tipo de producto. Cópialos de Seller Central y pégalos aquí: así el ERP sabe qué palabras ya están en la ficha al recomendar.'}
      </p>
      {ficha.highlights !== '' && (
        <button type="button" onClick={() => { setTexto(''); setEditando(true) }} className="inline-flex w-fit items-center gap-1.5 rounded-[8px] border border-[var(--ls-linea)] px-3 py-1.5 text-[12.5px] text-[var(--ls-t2)] hover:bg-[var(--ls-sup2)] [@media(pointer:coarse)]:min-h-[44px]">
          <Pencil className="h-3.5 w-3.5" aria-hidden /> Poner los Item Highlights a mano
        </button>
      )}
    </div>
  )
}
