'use client'

import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, Tooltip, XAxis, YAxis } from 'recharts'
import { COLOR_ESTADO } from '@/lib/estilo/denso'
import type { LineaPlan, PlazoEtapas } from '@/lib/fba/plan-tipos'
import { entero, fechaCorta, unidades } from '../formato'
import { DURACION_ANIMACION, EJE, Grafico, useAnimarGraficos } from '../comun/graficos'
import { PRIORIDAD } from '../comun/estilo-plan'
import { Clave, cx } from '../comun/ui'
import { datosMapaCobertura, type BarraCobertura } from './calculos'

/**
 * MAPA DE COBERTURA (spec remesas-pro §1.5 y §6.3; paquete C5).
 *
 * Barras horizontales con las 15 referencias que antes se quedan sin stock: la barra son los días que dura con lo que
 * viene (de camino y comprometido; lo dudoso no cuenta), coloreada por la prioridad del plan (gris si está fuera del
 * plan). Dos rayas verticales: `L` («plazo hasta la venta: 17 d») y `L + M` (con el margen). Lo que queda a la izquierda
 * de la primera ya no se salva con un envío nuevo; lo que está entre las dos hay que decidirlo ya.
 *
 * Debajo, la misma información en texto (el gráfico no es la única forma de leerla).
 *
 * API
 *   <MapaDeCobertura lineas plazo hoy n? onElegir? />   onElegir(sku): al pulsar una barra (abre la referencia en la tabla)
 */

export interface MapaDeCoberturaProps {
  lineas: readonly LineaPlan[]
  plazo: Pick<PlazoEtapas, 'hastaLaVenta' | 'margen'>
  hoy: string
  n?: number
  onElegir?: (sku: string) => void
  className?: string
}

const colorDe = (b: BarraCobertura): string =>
  b.fuera && b.fuera !== 'aun_no_toca' && b.fuera !== 'cantidad_ridicula' && b.fuera !== 'en_cuarentena' && b.fuera !== 'stock_de_sobra'
    ? COLOR_ESTADO.gris
    : COLOR_ESTADO[PRIORIDAD[b.prioridad].tono]

const corto = (s: string) => (s.length > 16 ? `${s.slice(0, 15)}…` : s)

interface PropsTooltip {
  active?: boolean
  payload?: Array<{ payload?: BarraCobertura }>
}

function TooltipCobertura({ active, payload, hoy }: PropsTooltip & { hoy: string }) {
  const b = active ? payload?.[0]?.payload : undefined
  if (!b) return null
  return (
    <div className="pointer-events-none max-w-[260px] rounded-[10px] border border-[var(--ls-linea2)] bg-[var(--ls-sup2)] px-[10px] py-[8px] shadow-lg">
      <p className="truncate text-[12px] font-semibold text-[var(--ls-t1)]">{b.sku}</p>
      {b.nombre && <p className="truncate text-[11px] text-[var(--ls-t4)]">{b.nombre}</p>}
      <p className="mt-1 text-[13px] font-semibold tabular-nums text-[var(--ls-t1)]">
        {entero(b.dias)} días <span className="text-[11.5px] font-normal text-[var(--ls-t3)]">con lo que viene</span>
      </p>
      <p className="text-[11.5px] text-[var(--ls-t3)]">
        {b.fechaRotura ? `Se queda sin stock el ${fechaCorta(b.fechaRotura, hoy)}` : 'Sin rotura a la vista'}
        {b.cantidad > 0 ? ` · propone ${unidades(b.cantidad)}` : ''}
      </p>
      <p className="mt-1 text-[11px]" style={{ color: colorDe(b) }}>
        {PRIORIDAD[b.prioridad].texto}
      </p>
    </div>
  )
}

export function MapaDeCobertura({ lineas, plazo, hoy, n = 15, onElegir, className }: MapaDeCoberturaProps) {
  const { barras, tope } = datosMapaCobertura(lineas, plazo, hoy, n)
  const animar = useAnimarGraficos(barras.length)
  const L = plazo.hastaLaVenta
  const LM = L + plazo.margen
  const alto = Math.max(160, 44 + barras.length * 24)

  return (
    <div className={cx('min-w-0', className)}>
      <Grafico
        alto={alto}
        etiqueta={`Días que dura el stock de las ${barras.length} referencias que antes se quedan sin él, con el plazo hasta la venta (${L} días) marcado`}
        vacio={barras.length === 0}
        textoVacio="Ninguna referencia con ritmo de venta"
        descripcionVacio="Sin ventas no hay rotura que pintar."
      >
        <BarChart data={barras} layout="vertical" margin={{ top: 18, right: 16, bottom: 4, left: 4 }} barCategoryGap={5}>
          <CartesianGrid horizontal={false} stroke={EJE.rejilla} strokeWidth={1} />
          <XAxis type="number" domain={[0, tope]} allowDataOverflow tick={EJE.tick} tickLine={false} axisLine={{ stroke: EJE.linea }} unit=" d" />
          <YAxis type="category" dataKey="sku" width={112} tick={EJE.tick} tickLine={false} axisLine={false} tickFormatter={corto} interval={0} />
          <Tooltip cursor={{ fill: 'var(--ls-sup2)' }} content={<TooltipCobertura hoy={hoy} />} />
          <ReferenceLine
            x={L}
            stroke={COLOR_ESTADO.rojo}
            strokeDasharray="4 3"
            label={{ value: `a la venta: ${L} d`, position: 'top', fill: COLOR_ESTADO.rojo, fontSize: 10.5 }}
          />
          <ReferenceLine
            x={LM}
            stroke={COLOR_ESTADO.ambar}
            strokeDasharray="2 3"
            label={{ value: `+ margen: ${LM} d`, position: 'insideTopRight', fill: COLOR_ESTADO.ambar, fontSize: 10.5 }}
          />
          <Bar
            dataKey="barra"
            radius={[0, 4, 4, 0]}
            maxBarSize={16}
            isAnimationActive={animar}
            animationDuration={DURACION_ANIMACION}
            onClick={onElegir ? (d: { payload?: BarraCobertura }) => d?.payload && onElegir(d.payload.sku) : undefined}
            className={onElegir ? 'cursor-pointer' : undefined}
          >
            {barras.map((b) => (
              <Cell key={b.sku} fill={colorDe(b)} fillOpacity={b.topada ? 0.55 : 0.9} />
            ))}
          </Bar>
        </BarChart>
      </Grafico>

      {barras.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 px-1">
          <Clave color={COLOR_ESTADO.rojo}>Plazo hasta la venta ({entero(L)} d): a su izquierda la rotura ya no se evita</Clave>
          <Clave color={COLOR_ESTADO.ambar}>Con el margen ({entero(LM)} d): entre las dos, hay que decidir ya</Clave>
          {barras.some((b) => b.topada) && <span className="text-[11.5px] text-[var(--ls-t4)]">Barra apagada = dura más de {entero(tope)} días</span>}
        </div>
      )}
    </div>
  )
}
