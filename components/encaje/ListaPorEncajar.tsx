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
  // Si el cliente tiene catálogo con REF, color y talla (ShoesF), la lista va por modelo-color como en su Excel
  const porModelo = lineas.some((l) => l.modelo)
  const visibles = useMemo(() => {
    const t = busca.trim().toLowerCase()
    return lineas.filter((l) => {
      if (soloLoQueFalta && resumen.porSku[l.sku].restantes <= 0) return false
      const m = l.modelo ? `${l.modelo.ref} ${l.modelo.color} ${l.modelo.talla}`.toLowerCase() : ''
      return !t || l.sku.toLowerCase().includes(t) || (l.nombre ?? '').toLowerCase().includes(t) || (l.variante ?? '').toLowerCase().includes(t) || m.includes(t)
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
            placeholder={porModelo ? 'Buscar por REF, color, talla o SKU' : 'Buscar por SKU, nombre o talla'}
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

      {/* El scroll propio solo en el ordenador, donde la lista va fija al lado de las cajas. En el móvil va debajo de las cajas y crece con
          la página: una lista de 560 px con su scroll dentro de la página (tres cuartos de la pantalla) se quedaba con el dedo al bajar */}
      {porModelo ? (
        <ListaPorModelo lineas={visibles} resumen={resumen} editable={editable} cajaActiva={cajaActiva} onMeter={onMeter} onArrastrar={onArrastrar} vacia={busca ? 'Ninguna referencia coincide con lo que buscas.' : 'No queda nada por encajar. ¡Buen trabajo!'} />
      ) : (
      <ul className="space-y-1.5 border-t border-[#EFEBE5] p-2.5 lg:max-h-[calc(100vh-290px)] lg:overflow-y-auto">
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
      )}
    </section>
  )
}

/**
 * LA LISTA POR MODELO-COLOR (clientes con catálogo: ShoesF). Una tarjeta por REF + nombre y color, y dentro sus tallas con lo que falta de cada una: se pulsa una talla para
 * meterla en la caja abierta, o se arrastra a la caja que se quiera. Lo que no está en el catálogo va al final, por su SKU.
 */
function ListaPorModelo({
  lineas,
  resumen,
  editable,
  cajaActiva,
  onMeter,
  onArrastrar,
  vacia,
}: {
  lineas: LineaParaEncajar[]
  resumen: ResumenDeEncaje
  editable: boolean
  cajaActiva: number | null
  onMeter: (sku: string) => void
  onArrastrar: (arrastrando: boolean) => void
  vacia: string
}) {
  const grupos = useMemo(() => {
    const m = new Map<string, { ref: string; color: string; lineas: LineaParaEncajar[] }>()
    for (const l of lineas) {
      const k = l.modelo ? `${l.modelo.ref}|${l.modelo.color}` : `sku|${l.sku}`
      const g = m.get(k) ?? { ref: l.modelo?.ref ?? l.sku, color: l.modelo?.color ?? '', lineas: [] }
      g.lineas.push(l)
      m.set(k, g)
    }
    const tallaNum = (t: string) => (Number.isFinite(Number(t.replace(',', '.'))) ? Number(t.replace(',', '.')) : 999)
    for (const g of m.values()) g.lineas.sort((a, b) => tallaNum(a.modelo?.talla ?? '') - tallaNum(b.modelo?.talla ?? '') || a.sku.localeCompare(b.sku))
    return [...m.values()].sort((a, b) => Number(!a.color) - Number(!b.color) || a.ref.localeCompare(b.ref, 'es', { numeric: true }) || a.color.localeCompare(b.color, 'es'))
  }, [lineas])

  return (
    <ul className="space-y-2 border-t border-[#EFEBE5] p-2.5 lg:max-h-[calc(100vh-290px)] lg:overflow-y-auto">
      {grupos.map((g) => {
        const falta = g.lineas.reduce((s, l) => s + resumen.porSku[l.sku].restantes, 0)
        return (
          <li key={`${g.ref}|${g.color}`} className={cx('rounded-xl border px-3 py-2.5', falta > 0 ? 'border-[#E5E1DB] bg-[#FFFFFF]' : 'border-transparent bg-[#F7F5F2]')}>
            <div className="flex items-baseline justify-between gap-2">
              <div className="min-w-0">
                <span className="text-[13.5px] font-semibold text-[#141414]">{g.ref}</span>
                {g.color && <span className="ml-2 text-[12.5px] font-medium text-[#5E5852]">{g.color}</span>}
              </div>
              {falta > 0 ? (
                <span className="shrink-0 text-[11.5px] text-[#8C857C]">
                  faltan <b className="tabular-nums text-[#F26212]">{n0(falta)}</b>
                </span>
              ) : (
                <span className="flex shrink-0 items-center gap-1 text-[12px] font-medium text-[#2F9657]">
                  <Check className="h-3.5 w-3.5" /> Encajado
                </span>
              )}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {g.lineas.map((l) => {
                const f = resumen.porSku[l.sku].restantes
                const activo = editable && f > 0
                return (
                  <button
                    key={l.sku}
                    type="button"
                    disabled={!activo}
                    draggable={activo}
                    onDragStart={(e) => {
                      e.dataTransfer.setData('text/plain', `ref:${l.sku}`)
                      e.dataTransfer.effectAllowed = 'copyMove'
                      onArrastrar(true)
                    }}
                    onDragEnd={() => onArrastrar(false)}
                    onClick={() => onMeter(l.sku)}
                    title={f > 0 ? `${l.sku} · faltan ${f} de ${l.unidades}. Pulsa para meterlas ${cajaActiva ? `en la caja ${cajaActiva}` : 'en una caja nueva'} o arrástrala a otra caja` : `${l.sku} · encajada`}
                    className={cx(
                      'inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[12.5px] transition',
                      f > 0 ? 'border-[#E5E1DB] bg-[#FFFFFF] text-[#141414] hover:border-[#F26212] hover:bg-[#FBEFE8] active:cursor-grabbing' : 'border-transparent bg-[#EFEBE5] text-[#8C857C]',
                      activo && 'cursor-grab'
                    )}
                  >
                    <span className="font-semibold">{l.modelo?.talla ?? l.sku}</span>
                    {f > 0 ? <span className="rounded-full bg-[#FBEFE8] px-1.5 text-[11.5px] font-semibold tabular-nums text-[#F26212]">{n0(f)}</span> : <Check className="h-3 w-3 text-[#2F9657]" />}
                  </button>
                )
              })}
            </div>
          </li>
        )
      })}
      {grupos.length === 0 && <li className="px-3 py-8 text-center text-[13px] text-[#8C857C]">{vacia}</li>}
    </ul>
  )
}
