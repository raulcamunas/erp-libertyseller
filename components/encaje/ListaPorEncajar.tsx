'use client'

import { useMemo, useState } from 'react'
import { Check, GripVertical, Plus, Search } from 'lucide-react'
import type { LineaParaEncajar, ResumenDeEncaje } from '@/lib/fba/encaje-resumen'
import { FUENTE_TITULO, cx, n0 } from './marca'

/**
 * LO QUE FALTA POR METER EN ALGUNA CAJA.
 *
 * Una fila por referencia con cuántas unidades quedan. Se puede pulsar el «+» para meterla en la caja
 * que está abierta o arrastrarla encima de la caja que se quiera. Las que ya están del todo en alguna
 * caja se quedan en gris con su «encajada»: no desaparecen, para que se vea que no se ha olvidado nada.
 */
export function ListaPorEncajar({
  lineas,
  resumen,
  editable,
  cajaActiva,
  onMeter,
  onArrastrar,
}: {
  lineas: LineaParaEncajar[]
  resumen: ResumenDeEncaje
  editable: boolean
  /** El número de la caja que está abierta, para decir a dónde va el «+» */
  cajaActiva: number | null
  onMeter: (sku: string) => void
  onArrastrar: (arrastrando: boolean) => void
}) {
  const [busca, setBusca] = useState('')
  const [soloLoQueFalta, setSoloLoQueFalta] = useState(true)

  const pendientesEnTotal = lineas.filter((l) => resumen.porSku[l.sku].restantes > 0).length
  const visibles = useMemo(() => {
    const t = busca.trim().toLowerCase()
    return lineas.filter((l) => {
      if (soloLoQueFalta && resumen.porSku[l.sku].restantes <= 0) return false
      return !t || l.sku.toLowerCase().includes(t) || (l.nombre ?? '').toLowerCase().includes(t) || (l.variante ?? '').toLowerCase().includes(t)
    })
  }, [lineas, resumen, busca, soloLoQueFalta])

  return (
    <section className="rounded-2xl border border-[#E5E1DB] bg-[#FFFFFF]">
      <div className="px-4 pb-3 pt-4">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-[15px] text-[#141414]" style={{ fontFamily: FUENTE_TITULO, fontWeight: 600 }}>
            Por encajar
          </h2>
          <span className="text-[12px] text-[#5E5852]">
            {pendientesEnTotal === 0 ? 'Todo repartido' : `${n0(pendientesEnTotal)} de ${n0(lineas.length)} referencias`}
          </span>
        </div>

        <label className="mt-3 flex items-center gap-2 rounded-lg border border-[#E5E1DB] bg-[#F7F5F2] px-2.5 focus-within:border-[#F26212]">
          <Search className="h-4 w-4 shrink-0 text-[#8C857C]" />
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por SKU, nombre o talla"
            className="h-9 w-full bg-transparent text-[13px] text-[#141414] outline-none placeholder:text-[#B8AE9F]"
            aria-label="Buscar entre las referencias"
          />
        </label>

        <div className="mt-2.5 flex gap-1.5">
          {(
            [
              [true, `Lo que falta (${pendientesEnTotal})`],
              [false, `Todas (${lineas.length})`],
            ] as const
          ).map(([valor, texto]) => (
            <button
              key={String(valor)}
              type="button"
              onClick={() => setSoloLoQueFalta(valor)}
              className={cx(
                'rounded-full px-3 py-1 text-[12px] font-medium transition',
                soloLoQueFalta === valor ? 'bg-[#141414] text-[#FFFFFF]' : 'bg-[#F7F5F2] text-[#5E5852] hover:bg-[#EDE6DC]'
              )}
            >
              {texto}
            </button>
          ))}
        </div>
      </div>

      <ul className="max-h-[560px] space-y-1.5 overflow-y-auto border-t border-[#EFEBE5] p-2.5 lg:max-h-[calc(100vh-290px)]">
        {visibles.map((l) => {
          const falta = resumen.porSku[l.sku].restantes
          const arrastrable = editable && falta > 0
          return (
            <li
              key={l.sku}
              draggable={arrastrable}
              onDragStart={(e) => {
                e.dataTransfer.setData('text/plain', `ref:${l.sku}`)
                e.dataTransfer.effectAllowed = 'copyMove'
                onArrastrar(true)
              }}
              onDragEnd={() => onArrastrar(false)}
              className={cx(
                'flex items-center gap-2 rounded-xl border px-2 py-2 transition',
                falta > 0 ? 'border-[#E5E1DB] bg-[#FFFFFF] hover:border-[#F26212]/60' : 'border-transparent bg-[#F7F5F2]',
                arrastrable && 'cursor-grab active:cursor-grabbing'
              )}
            >
              <GripVertical className={cx('h-4 w-4 shrink-0 text-[#B8AE9F]', !arrastrable && 'opacity-0')} aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-[13px] font-semibold text-[#141414]">{l.sku}</span>
                  {l.variante && <span className="text-[11.5px] text-[#5E5852]">{l.variante}</span>}
                </div>
                {l.nombre && (
                  <div className="truncate text-[11.5px] text-[#8C857C]" title={l.nombre}>
                    {l.nombre}
                  </div>
                )}
              </div>
              {falta > 0 ? (
                <>
                  <span className="shrink-0 rounded-full bg-[#FBEFE8] px-2 py-0.5 text-[12px] font-semibold tabular-nums text-[#F26212]" title={`Faltan ${falta} de las ${l.unidades}`}>
                    {n0(falta)}
                    {falta !== l.unidades && <span className="font-normal text-[#8C857C]"> de {n0(l.unidades)}</span>}
                  </span>
                  {editable && (
                    <button
                      type="button"
                      onClick={() => onMeter(l.sku)}
                      title={cajaActiva ? `Meter ${falta} en la caja ${cajaActiva}` : 'Meter en una caja nueva'}
                      aria-label={`Meter ${l.sku} en ${cajaActiva ? `la caja ${cajaActiva}` : 'una caja nueva'}`}
                      className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-[#141414] text-[#FFFFFF] transition hover:bg-[#F26212]"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  )}
                </>
              ) : (
                <span className="flex shrink-0 items-center gap-1 text-[12px] font-medium text-[#2F9657]">
                  <Check className="h-3.5 w-3.5" /> Encajada
                </span>
              )}
            </li>
          )
        })}
        {visibles.length === 0 && (
          <li className="px-3 py-8 text-center text-[13px] text-[#8C857C]">{busca ? 'Ninguna referencia coincide con lo que buscas.' : 'No queda nada por encajar. ¡Buen trabajo!'}</li>
        )}
      </ul>
    </section>
  )
}
