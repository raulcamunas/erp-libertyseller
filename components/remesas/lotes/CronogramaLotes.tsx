'use client'

import { useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, Tooltip, XAxis, YAxis } from 'recharts'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Boton, Insignia } from '@/components/ui-ls'
import type { TonoEstado } from '@/lib/estilo/denso'
import type { LoteEnvio } from '@/lib/fba/plan-tipos'
import { DURACION_ANIMACION, EJE, Grafico, useAnimarGraficos } from '../comun/graficos'
import { Clave, cx } from '../comun/ui'
import { entero, fechaCorta, sumarDias } from '../formato'
import { EmbudoLote } from './EmbudoLote'
import { filasDeCronograma, textoDuracion, type EstadoLote, type FilaCronograma } from './useLotes'

/**
 * EL CRONOGRAMA DE LOTES (spec remesas-pro §5.3).
 *
 * ESCRITORIO (lg+): una fila por envío (los 20 más recientes; «Ver más» enseña el resto) sobre un eje de fechas. Tramo de
 * tránsito (gris rayado, envío → llegada), tramo de venta (azul --viz-1, más opaco cuanto más vendido) hasta el agotado o
 * hasta hoy, y la prolongación estimada (contorno discontinuo) hasta `agotaraElEstimado`. Marcas en d50 y d80. Es un
 * BarChart horizontal apilado de recharts: los rangos son barras invisibles (el hueco) + visibles, dentro de `Grafico`.
 *
 * MÓVIL: una tarjeta por envío con su minibarra de embudo y «Duró 38 días» o «Durará ~22 días más». Sin gráfico.
 *
 *   <CronogramaLotes lotes hoy seleccionado? onElegir? />
 */

const MAX = 20
const ALTO_FILA = 30

const ESTADO: Record<EstadoLote, { texto: string; tono: TonoEstado }> = {
  camino: { texto: 'De camino', tono: 'azul' },
  vivo: { texto: 'Vendiendo', tono: 'cian' },
  agotado: { texto: 'Agotado', tono: 'gris' },
  sin_empezar: { texto: 'Sin ventas', tono: 'ambar' },
}

export function CronogramaLotes({
  lotes,
  hoy,
  seleccionado = null,
  onElegir,
}: {
  lotes: ReadonlyArray<LoteEnvio>
  hoy: string
  seleccionado?: string | null
  onElegir?: (remesaId: string) => void
}) {
  const [todos, setTodos] = useState(false)
  const crono = useMemo(() => filasDeCronograma(lotes, hoy, todos ? lotes.length : MAX), [lotes, hoy, todos])
  const porId = useMemo(() => new Map(lotes.map((l) => [l.remesaId, l])), [lotes])
  const quedanFuera = crono.total - crono.filas.length

  return (
    <div className="min-w-0">
      <div className="hidden lg:block">
        <GraficoCronograma crono={crono} seleccionado={seleccionado} onElegir={onElegir} />
      </div>

      <ul className="flex flex-col gap-2 lg:hidden" aria-label="Envíos y cuánto duran">
        {crono.filas.map((f, i) => {
          const l = porId.get(f.remesaId)
          if (!l) return null
          const e = ESTADO[f.estado]
          const activo = seleccionado === f.remesaId
          return (
            <li key={f.remesaId} className="ls-aparecer" style={{ ['--ls-i' as string]: Math.min(i, 12) }}>
              <button
                type="button"
                onClick={onElegir ? () => onElegir(f.remesaId) : undefined}
                aria-current={activo || undefined}
                className={cx(
                  'block w-full rounded-[14px] border bg-[var(--ls-sup)] p-[14px] text-left shadow-[var(--ls-sombra-1)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--ls-acc-graf)]',
                  activo ? 'border-[color-mix(in_srgb,var(--ls-mod-remesas)_55%,var(--ls-linea))] bg-[var(--ls-sel)]' : 'border-[var(--ls-linea)] active:bg-[var(--ls-sup2)]'
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-[14px] font-semibold text-[var(--ls-t1)]">{f.nombre}</p>
                    <p className="mt-[2px] truncate text-[12px] text-[var(--ls-t4)]">
                      {f.fechaEnvio ? `Salió el ${fechaCorta(f.fechaEnvio, hoy)}` : ''}
                      {f.fechaLlegada ? ` · llegó el ${fechaCorta(f.fechaLlegada, hoy)}` : ''}
                    </p>
                  </div>
                  <Insignia tono={e.tono} tamano="sm" vivo={f.estado === 'vivo'}>
                    {e.texto}
                  </Insignia>
                </div>
                <EmbudoLote embudo={l.embudo} compacto className="mt-3" />
                <div className="mt-2 flex items-center justify-between gap-2 text-[12.5px]">
                  <span className="font-medium text-[var(--ls-t1)]">{textoDuracion(l, hoy)}</span>
                  <span className="tabular-nums text-[var(--ls-t3)]">{entero(f.pctVendido)} % vendido</span>
                </div>
              </button>
            </li>
          )
        })}
      </ul>

      {(quedanFuera > 0 || todos) && crono.total > MAX && (
        <div className="mt-3 flex justify-center">
          <Boton tamano="sm" variante="fantasma" icono={todos ? ChevronDown : ChevronRight} onClick={() => setTodos((t) => !t)}>
            {todos ? `Ver solo los ${MAX} más recientes` : `Ver más (${entero(quedanFuera)} envíos más antiguos)`}
          </Boton>
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* El gráfico (escritorio)                                             */
/* ------------------------------------------------------------------ */

interface PropsBarra {
  x?: number
  y?: number
  width?: number
  height?: number
  payload?: FilaCronograma & { etiqueta: string }
}

function GraficoCronograma({
  crono,
  seleccionado,
  onElegir,
}: {
  crono: ReturnType<typeof filasDeCronograma>
  seleccionado: string | null
  onElegir?: (remesaId: string) => void
}) {
  const animar = useAnimarGraficos(crono.filas.length * 4)
  const datos = crono.filas.map((f) => ({ ...f, etiqueta: f.nombre.length > 26 ? `${f.nombre.slice(0, 25)}…` : f.nombre }))
  const origen = crono.origen
  const fechaDe = (d: number) => (origen ? fechaCorta(sumarDias(origen, d), sumarDias(origen, crono.hoy ?? 0)) : String(d))
  const dominio: [number, number] = [0, Math.max(1, Math.ceil(crono.fin * 1.02))]
  const pulsar = onElegir ? (d: unknown) => {
    const id = (d as { remesaId?: string } | undefined)?.remesaId ?? (d as { payload?: { remesaId?: string } } | undefined)?.payload?.remesaId
    if (id) onElegir(id)
  } : undefined

  /** El tramo de venta con las marcas d50 y d80 (rayitas verticales), dibujado a mano */
  function TramoVenta({ x = 0, y = 0, width = 0, height = 0, payload }: PropsBarra) {
    if (!payload || width <= 0) return <g />
    const alfa = 0.35 + 0.65 * Math.min(1, Math.max(0, payload.pctVendido / 100))
    const inicioVenta = payload.inicio + payload.transito
    const posicion = (marca: number | null) => (marca === null || payload.venta <= 0 ? null : x + ((marca - inicioVenta) / payload.venta) * width)
    const m50 = posicion(payload.marca50)
    const m80 = posicion(payload.marca80)
    const activo = payload.remesaId === seleccionado
    return (
      <g style={{ cursor: onElegir ? 'pointer' : undefined }}>
        <rect x={x} y={y} width={width} height={height} rx={3} fill="var(--viz-1)" fillOpacity={alfa} stroke={activo ? 'var(--ls-mod-remesas)' : 'none'} strokeWidth={activo ? 2 : 0} />
        {m50 !== null && <line x1={m50} x2={m50} y1={y - 2} y2={y + height + 2} stroke="var(--ls-t1)" strokeWidth={1.5} strokeOpacity={0.85} />}
        {m80 !== null && <line x1={m80} x2={m80} y1={y - 2} y2={y + height + 2} stroke="var(--ls-t1)" strokeWidth={1.5} strokeOpacity={0.85} strokeDasharray="2 2" />}
      </g>
    )
  }

  function Contenido({ active, payload }: { active?: boolean; payload?: Array<{ payload?: FilaCronograma }> }) {
    const f = active ? payload?.[0]?.payload : undefined
    if (!f) return null
    return (
      <div className="pointer-events-none min-w-[210px] max-w-[280px] rounded-[10px] border border-[var(--ls-linea2)] bg-[var(--ls-sup2)] px-3 py-2 text-[12.5px] shadow-[var(--ls-sombra-2)]">
        <p className="font-semibold text-[var(--ls-t1)]">{f.nombre}</p>
        {f.referenciaEnvio && <p className="font-mono text-[11.5px] text-[var(--ls-t4)]">{f.referenciaEnvio}</p>}
        <dl className="mt-1 space-y-[2px] text-[var(--ls-t3)]">
          {f.fechaEnvio && <Linea k="Salió">{fechaCorta(f.fechaEnvio)}</Linea>}
          {f.fechaLlegada && <Linea k="Llegó">{`${fechaCorta(f.fechaLlegada)} (${f.transito} d de tránsito)`}</Linea>}
          {f.estado === 'camino' && <Linea k="De camino">{`${f.transito} días`}</Linea>}
          {f.venta > 0 && <Linea k={f.estado === 'agotado' ? 'Se vendió en' : 'Lleva vendiendo'}>{`${f.venta} días · ${entero(f.pctVendido)} %`}</Linea>}
          {f.marca50 !== null && <Linea k="Mitad vendida">{`día ${f.marca50 - f.inicio - f.transito}`}</Linea>}
          {f.marca80 !== null && <Linea k="80 % vendido">{`día ${f.marca80 - f.inicio - f.transito}`}</Linea>}
          {f.estimado > 0 && f.agotaraElEstimado && <Linea k="Se agotará">{`~${fechaCorta(f.agotaraElEstimado)} (estimado)`}</Linea>}
        </dl>
      </div>
    )
  }

  return (
    <div className="min-w-0">
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="inline-flex items-center gap-[6px] text-[11.5px] text-[var(--ls-t3)]">
          <span className="h-[8px] w-[14px] rounded-[2px]" style={{ background: RAYADO_GRIS }} aria-hidden />
          De camino
        </span>
        <Clave color="var(--viz-1)">Vendiendo (más intenso, más vendido)</Clave>
        <span className="inline-flex items-center gap-[6px] text-[11.5px] text-[var(--ls-t3)]">
          <span className="h-[8px] w-[14px] rounded-[2px] border border-dashed border-[var(--viz-1)]" aria-hidden />
          Lo que le queda (estimado)
        </span>
        <span className="inline-flex items-center gap-[6px] text-[11.5px] text-[var(--ls-t3)]">
          <span className="h-[10px] w-[2px] bg-[var(--ls-t1)]" aria-hidden />
          50 % y 80 % vendido
        </span>
      </div>
      <Grafico etiqueta="Cronograma de los envíos: tránsito, venta y lo que les queda" alto={Math.max(140, datos.length * ALTO_FILA + 46)} vacio={datos.length === 0} textoVacio="Todavía no hay envíos que colocar en el tiempo">
        <BarChart data={datos} layout="vertical" margin={{ top: 16, right: 18, left: 0, bottom: 0 }} barCategoryGap={8}>
          <defs>
            <pattern id="crono-rayado" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="6" height="6" fill="var(--ls-sup3)" />
              <line x1="0" y1="0" x2="0" y2="6" stroke="var(--ls-t4)" strokeWidth="2" strokeOpacity="0.55" />
            </pattern>
          </defs>
          <CartesianGrid stroke={EJE.rejilla} horizontal={false} />
          <XAxis type="number" domain={dominio} tick={EJE.tick} axisLine={{ stroke: EJE.linea }} tickLine={false} tickFormatter={(d) => fechaDe(Number(d))} minTickGap={24} />
          <YAxis type="category" dataKey="etiqueta" width={170} tick={EJE.tick} axisLine={false} tickLine={false} interval={0} />
          <Tooltip content={<Contenido />} cursor={{ fill: 'var(--ls-sup3)', opacity: 0.5 }} isAnimationActive={false} />
          <Bar dataKey="hueco" stackId="l" fill="transparent" isAnimationActive={false} />
          <Bar dataKey="transito" stackId="l" fill="url(#crono-rayado)" isAnimationActive={animar} animationDuration={DURACION_ANIMACION} onClick={pulsar} style={{ cursor: onElegir ? 'pointer' : undefined }} />
          <Bar dataKey="venta" stackId="l" shape={<TramoVenta />} isAnimationActive={animar} animationDuration={DURACION_ANIMACION} onClick={pulsar} />
          <Bar dataKey="estimado" stackId="l" fill="transparent" stroke="var(--viz-1)" strokeWidth={1.5} strokeDasharray="4 3" isAnimationActive={false} onClick={pulsar}>
            {datos.map((f) => (
              <Cell key={f.remesaId} strokeOpacity={f.estimado > 0 ? 0.9 : 0} />
            ))}
          </Bar>
          {crono.hoy !== null && <ReferenceLine x={crono.hoy} stroke="var(--ls-mod-remesas)" strokeDasharray="3 3" label={{ value: 'hoy', position: 'top', fill: 'var(--ls-t3)', fontSize: 11 }} />}
        </BarChart>
      </Grafico>
    </div>
  )
}

const RAYADO_GRIS = 'repeating-linear-gradient(135deg, var(--ls-t4) 0 2px, var(--ls-sup3) 2px 5px)'

function Linea({ k, children }: { k: string; children: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt>{k}</dt>
      <dd className="text-right tabular-nums text-[var(--ls-t1)]">{children}</dd>
    </div>
  )
}
