'use client'

import { ArrowUpDown, Check, ChevronDown, Euro, Layers, X } from 'lucide-react'
import { useState } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { SIN_FILTROS, hayFiltros, type FiltrosDeCartera } from '@/lib/cold-calling/cartera'
import { BOTON, CAMPO, COLOR_ESTADO } from '@/lib/estilo/denso'
import { COLD_NIVEL_LABELS, COLD_SORT_LABELS, COLD_STATUSES, COLD_STATUS_LABELS, type ColdLeadStatus, type ColdSort } from '@/lib/types/cold-leads'
import { ESTADO_VISUAL, GlifoDeEstado, TONO_DE_NIVEL, tinte, tonoDeLista } from './ui'

/**
 * LA FILA DE FILTROS: la lista de origen, el estado, el nivel, la facturación y el orden, en UNA sola fila.
 *
 * Antes eran tres filas de chips (estado, nivel, lista) y otra más de facturación, y ocupaban más que la lista de leads. Ahora:
 *   · la LISTA es un desplegable (una persona trabaja de una a cinco), no cinco botones;
 *   · los ESTADOS son chips de glifo y número, TODOS DEL MISMO ANCHO: el nombre del activo no se escribe dentro del chip (lo ensancharía y
 *     empujaría a los demás cada vez que se pulsa uno) sino en el rótulo fijo de la derecha, junto al recuento;
 *   · el NIVEL solo existe cuando se mira una lista de tiendas, y la FACTURACIÓN solo cuando se mira una de vendedores de Amazon.
 */

const PRESETS_DE_FACTURACION: ReadonlyArray<{ etiqueta: string; min: string; max: string }> = [
  { etiqueta: '+ de 100k', min: '100000', max: '' },
  { etiqueta: '50k – 100k', min: '50000', max: '100000' },
  { etiqueta: '20k – 50k', min: '20000', max: '50000' },
  { etiqueta: '- de 20k', min: '', max: '20000' },
]

const numero = (n: number) => n.toLocaleString('es-ES')

/**
 * EL ANCHO DE LOS CHIPS NO DEPENDE DE LO QUE LLEVEN. Antes cada chip medía lo que midiera su contenido y el activo, además, escribía su
 * nombre: al pulsar uno se ensanchaba y la fila entera se descuadraba. Ahora los chips de estado miden todos lo mismo (caben hasta cuatro
 * cifras con `tabular-nums`; con cinco crecen lo justo) y lo mismo los de nivel. Se miden con `min-w` y no con `w` para que un recuento
 * de cinco cifras no se recorte.
 */
const ANCHO_DE_ESTADO = 'min-w-[64px] justify-center'
const ANCHO_DE_NIVEL = 'min-w-[68px] justify-center'
const ANCHO_DE_TODOS = 'min-w-[88px] justify-center'

interface Props {
  filtros: FiltrosDeCartera
  onCambiar: (cambios: Partial<FiltrosDeCartera>) => void
  /** Cuántos hay de cada estado en la cartera de la persona */
  porEstado: ReadonlyMap<ColdLeadStatus, number>
  /** Cuántos leads tiene la persona en total */
  total: number
  listas: ReadonlyArray<[string, number]>
  niveles: Record<1 | 2 | 3, number>
  /** ¿Hay tiendas con nivel en la lista que se mira? Entonces hay filtro de nivel y NO de facturación */
  hayNiveles: boolean
  /** Cuántos leads salen con lo que está puesto */
  coinciden: number
}

export function FiltrosDeLista({ filtros, onCambiar, porEstado, total, listas, niveles, hayNiveles, coinciden }: Props) {
  const [listaAbierta, setListaAbierta] = useState(false)
  const [rangoAbierto, setRangoAbierto] = useState(false)
  const rangoPuesto = filtros.minRev !== '' || filtros.maxRev !== ''
  const estadoActivo = filtros.estado === 'all' ? null : filtros.estado

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
      {/* La lista de origen */}
      {listas.length > 0 && (
        <Popover open={listaAbierta} onOpenChange={setListaAbierta}>
          <PopoverTrigger asChild>
            <button type="button" className={`${BOTON.chip} ${filtros.lista !== 'all' ? BOTON.chipEncendido : ''}`} aria-label="Lista de origen">
              <Layers className="h-3 w-3" aria-hidden />
              {filtros.lista === 'all' ? 'Todas las listas' : filtros.lista}
              <span className="tabular-nums text-[var(--ls-t4)]">{numero(filtros.lista === 'all' ? total : (listas.find(([n]) => n === filtros.lista)?.[1] ?? 0))}</span>
              <ChevronDown className="h-3 w-3 text-[var(--ls-t4)]" aria-hidden />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" sideOffset={6} className="w-[260px] rounded-[10px] border border-[var(--ls-linea2)] bg-[var(--ls-sup)] p-1 text-[var(--ls-t2)] shadow-xl">
            {[['all', total] as const, ...listas].map(([nombre, cuantos]) => {
              const activa = filtros.lista === nombre
              return (
                <button
                  key={nombre}
                  type="button"
                  onClick={() => {
                    onCambiar({ lista: nombre })
                    setListaAbierta(false)
                  }}
                  className={`flex h-8 w-full items-center gap-2 rounded-[6px] px-2 text-left text-[12.5px] outline-none transition-colors focus-visible:shadow-[inset_0_0_0_1px_var(--ls-acc-graf)] ${activa ? 'bg-[var(--ls-sel)] text-[var(--ls-t1)]' : 'hover:bg-[var(--ls-sup3)]'}`}
                >
                  {nombre === 'all' ? <span aria-hidden className="h-2 w-2 rounded-[2px] border border-[var(--ls-linea2)]" /> : <span aria-hidden className="h-2 w-2 rounded-[2px]" style={{ background: COLOR_ESTADO[tonoDeLista(nombre)] }} />}
                  <span className="min-w-0 flex-1 truncate">{nombre === 'all' ? 'Todas las listas' : nombre}</span>
                  <span className="tabular-nums text-[var(--ls-t4)]">{numero(cuantos)}</span>
                  {activa && <Check className="h-3.5 w-3.5 text-[var(--ls-acc)]" aria-hidden />}
                </button>
              )
            })}
          </PopoverContent>
        </Popover>
      )}

      <span aria-hidden className="hidden h-4 w-px bg-[var(--ls-linea2)] sm:block" />

      {/* El estado: glifo y número; el activo, además, su nombre */}
      <div role="group" aria-label="Estado" className="flex flex-wrap items-center gap-1">
        <button type="button" onClick={() => onCambiar({ estado: 'all' })} aria-pressed={filtros.estado === 'all'} className={`${BOTON.chip} ${ANCHO_DE_TODOS} ${filtros.estado === 'all' ? BOTON.chipEncendido : ''}`}>
          Todos <span className="tabular-nums text-[var(--ls-t4)]">{numero(total)}</span>
        </button>
        {COLD_STATUSES.map((s) => {
          const activo = filtros.estado === s
          const cuantos = porEstado.get(s) ?? 0
          const { tono } = ESTADO_VISUAL[s]
          return (
            <button
              key={s}
              type="button"
              onClick={() => onCambiar({ estado: activo ? 'all' : s })}
              aria-pressed={activo}
              title={`${COLD_STATUS_LABELS[s]}: ${numero(cuantos)}`}
              className={`${BOTON.chip} ${ANCHO_DE_ESTADO} ${activo ? '!text-[var(--ls-t1)] font-medium' : ''}`}
              style={activo ? { background: tinte(tono, 16), borderColor: COLOR_ESTADO[tono] } : undefined}
            >
              <GlifoDeEstado estado={s} tamano={12} />
              <span className={`tabular-nums ${activo ? 'text-[var(--ls-t2)]' : 'text-[var(--ls-t4)]'}`}>{numero(cuantos)}</span>
            </button>
          )
        })}
      </div>

      {/* El nivel: solo en una lista de tiendas. Es su orden de trabajo, y por eso lleva la pista de qué hacer primero */}
      {hayNiveles && (
        <>
          <span aria-hidden className="hidden h-4 w-px bg-[var(--ls-linea2)] sm:block" />
          <div role="group" aria-label="Nivel" className="flex items-center gap-1">
            {([1, 2, 3] as const).map((nivel) => {
              const activo = filtros.nivel === nivel
              const tono = TONO_DE_NIVEL[nivel]
              return (
                <button
                  key={nivel}
                  type="button"
                  disabled={niveles[nivel] === 0}
                  onClick={() => onCambiar({ nivel: activo ? 'all' : nivel })}
                  aria-pressed={activo}
                  title={`Nivel ${nivel} · ${COLD_NIVEL_LABELS[nivel]}: ${numero(niveles[nivel])}`}
                  className={`${BOTON.chip} ${ANCHO_DE_NIVEL} disabled:opacity-35 ${activo ? '!text-[var(--ls-t1)] font-medium' : ''}`}
                  style={activo ? { background: tinte(tono, 16), borderColor: COLOR_ESTADO[tono] } : undefined}
                >
                  <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ background: COLOR_ESTADO[tono] }} />
                  N{nivel}
                  <span className="tabular-nums text-[var(--ls-t4)]">{numero(niveles[nivel])}</span>
                </button>
              )
            })}
          </div>
        </>
      )}

      {/* La facturación: solo en una lista de vendedores de Amazon. Ninguna tienda online tiene facturación observada, así que el rango
          las dejaría todas fuera y la pantalla se quedaría vacía sin explicar por qué */}
      {!hayNiveles && (
        <Popover open={rangoAbierto} onOpenChange={setRangoAbierto}>
          <PopoverTrigger asChild>
            <button type="button" className={`${BOTON.chip} ${rangoPuesto ? BOTON.chipEncendido : ''}`}>
              <Euro className="h-3 w-3" aria-hidden />
              {rangoPuesto ? `${filtros.minRev ? `${numero(Number(filtros.minRev))}` : '0'} – ${filtros.maxRev ? numero(Number(filtros.maxRev)) : '∞'}` : 'Facturación'}
              <ChevronDown className="h-3 w-3 text-[var(--ls-t4)]" aria-hidden />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" sideOffset={6} className="w-[290px] space-y-2.5 rounded-[10px] border border-[var(--ls-linea2)] bg-[var(--ls-sup)] p-3 text-[var(--ls-t2)] shadow-xl">
            <p className="text-[11.5px] leading-snug text-[var(--ls-t3)]">Facturación al mes, en euros. Los vendedores sin importe quedan fuera mientras haya un rango puesto.</p>
            <div className="flex items-center gap-2">
              <input value={filtros.minRev} onChange={(e) => onCambiar({ minRev: e.target.value.replace(/[^\d]/g, '') })} inputMode="numeric" placeholder="desde" aria-label="Facturación desde" className={`${CAMPO.input} ${CAMPO.numero}`} />
              <span className="text-[var(--ls-t4)]">–</span>
              <input value={filtros.maxRev} onChange={(e) => onCambiar({ maxRev: e.target.value.replace(/[^\d]/g, '') })} inputMode="numeric" placeholder="hasta" aria-label="Facturación hasta" className={`${CAMPO.input} ${CAMPO.numero}`} />
            </div>
            <div className="flex flex-wrap gap-1">
              {PRESETS_DE_FACTURACION.map((p) => {
                const activo = filtros.minRev === p.min && filtros.maxRev === p.max
                return (
                  <button key={p.etiqueta} type="button" onClick={() => onCambiar(activo ? { minRev: '', maxRev: '' } : { minRev: p.min, maxRev: p.max })} aria-pressed={activo} className={`${BOTON.chip} ${activo ? BOTON.chipEncendido : ''}`}>
                    {p.etiqueta}
                  </button>
                )
              })}
            </div>
            {rangoPuesto && (
              <button type="button" onClick={() => onCambiar({ minRev: '', maxRev: '' })} className="text-[11.5px] text-[var(--ls-t3)] underline underline-offset-2 hover:text-[var(--ls-t1)]">
                Quitar el rango
              </button>
            )}
          </PopoverContent>
        </Popover>
      )}

      <div className="ml-auto flex items-center gap-1.5">
        {/* El nombre del estado activo vive aquí y no dentro del chip. De ancho fijo y pegado a la derecha: que cambie de «En seguimiento» a
            «Info enviada» no mueve nada de lo que tiene a la izquierda ni hace saltar la fila a otra línea */}
        <span className={`${estadoActivo ? 'inline-flex' : 'hidden md:inline-flex'} w-[210px] max-w-full items-center justify-end gap-1 truncate text-[11.5px] text-[var(--ls-t4)]`}>
          {estadoActivo && (
            <>
              <span className="truncate font-medium text-[var(--ls-t2)]">{COLD_STATUS_LABELS[estadoActivo]}</span>
              <span aria-hidden>·</span>
            </>
          )}
          <span className="shrink-0 tabular-nums">
            {numero(coinciden)} {coinciden === 1 ? 'lead' : 'leads'}
          </span>
        </span>
        {hayFiltros(filtros) && (
          <button type="button" onClick={() => onCambiar({ ...SIN_FILTROS })} className={`${BOTON.chip} rend-entra`}>
            <X className="h-3 w-3" aria-hidden /> Limpiar
          </button>
        )}
        <label className="relative inline-flex items-center" title="Ordenar la lista">
          <ArrowUpDown className="pointer-events-none absolute left-2 h-3 w-3 text-[var(--ls-t4)]" aria-hidden />
          <select value={filtros.orden} onChange={(e) => onCambiar({ orden: e.target.value as ColdSort })} aria-label="Ordenar la lista" className={`${BOTON.chip} cursor-pointer appearance-none !pl-6 !pr-2 outline-none`}>
            {(Object.keys(COLD_SORT_LABELS) as ColdSort[]).map((o) => (
              <option key={o} value={o} className="bg-[var(--ls-sup)]">
                {COLD_SORT_LABELS[o]}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  )
}
