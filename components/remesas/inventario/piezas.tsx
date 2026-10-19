'use client'

import { useState, type ReactNode } from 'react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Check, Pencil, X } from 'lucide-react'
import { BOTON, CAMPO, COLOR_ESTADO, ESTADO, type TonoEstado } from '@/lib/estilo/denso'
import { SUPUESTOS_POR_DEFECTO, type SupuestosAlmacenaje } from '@/lib/fba/almacenaje'
import { TRAMOS_EDAD, sumarDiasInv, type DiaVentas, type EstadoSku, type PorTramo } from '@/lib/fba/inventario'
import { EJE, VIZ, dm, dmy, tooltipDe } from '../comun/graficos'
import { cx, Medidor } from '../comun/ui'
import type { ResumenEdadAmazon } from '@/lib/fba/planificacion'
import { COLOR_TRAMO, COLOR_TRAMO_AMAZON, ESTADO_SKU, eur, eurFino, n0 } from './formato'

/**
 * LAS PIEZAS DEL PANEL DE INVENTARIO: tarjetas de cifras, estado, gráficos y el ajuste
 * del almacenaje.
 */

/* ------------------------------------------------------------------ */
/* Tarjeta de cifra                                                    */
/* ------------------------------------------------------------------ */

export function Kpi({
  rotulo,
  valor,
  sub,
  tono,
  ayuda,
  derecha,
}: {
  rotulo: string
  valor: ReactNode
  sub?: ReactNode
  tono?: TonoEstado
  ayuda?: string
  derecha?: ReactNode
}) {
  return (
    <div title={ayuda} className="relative min-w-0 rounded-[8px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] px-3 py-[9px]">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[11px] font-semibold text-[var(--ls-t4)]">{rotulo}</span>
        {derecha}
      </div>
      <div
        className="mt-[3px] text-[20px] font-semibold leading-[1.15] tracking-[-0.01em] tabular-nums text-[var(--ls-t1)]"
        style={tono ? { color: COLOR_ESTADO[tono] } : undefined}
      >
        {valor}
      </div>
      {sub && <div className="mt-[2px] text-[11.5px] leading-[1.4] text-[var(--ls-t3)]">{sub}</div>}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Estado de un SKU                                                    */
/* ------------------------------------------------------------------ */

/** El glifo con su palabra: tapa el color y sigue diciendo lo mismo */
export function ChipEstado({ estado }: { estado: EstadoSku }) {
  const e = ESTADO_SKU[estado]
  return (
    <span className={ESTADO.linea} title={e.ayuda}>
      <span className="h-[7px] w-[7px] shrink-0 rounded-full" style={{ background: COLOR_ESTADO[e.tono] }} aria-hidden />
      <span className={ESTADO.palabra}>{e.texto}</span>
    </span>
  )
}

/* ------------------------------------------------------------------ */
/* Ventas y devoluciones, día a día                                    */
/* ------------------------------------------------------------------ */

const COLOR_DEVUELTAS = COLOR_ESTADO.magenta

export function GraficoVentas({ datos, alto = 170 }: { datos: DiaVentas[]; alto?: number }) {
  const Contenido = tooltipDe(
    [
      { key: 'vendidas', nombre: 'vendidas', color: VIZ.vendidas },
      { key: 'devueltas', nombre: 'devueltas', color: COLOR_DEVUELTAS },
    ],
    (l) => dmy(String(l))
  )
  return (
    <div style={{ height: alto }} className="w-full" role="img" aria-label="Unidades vendidas y devueltas por día">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={datos} margin={{ top: 8, right: 6, left: 0, bottom: 0 }} barCategoryGap="18%">
          <CartesianGrid stroke={EJE.rejilla} vertical={false} />
          <XAxis dataKey="fecha" tickFormatter={dm} tick={EJE.tick} axisLine={{ stroke: EJE.linea }} tickLine={false} minTickGap={26} height={22} />
          <YAxis tick={EJE.tick} axisLine={false} tickLine={false} allowDecimals={false} width={30} tickMargin={4} />
          <Tooltip content={<Contenido />} cursor={{ fill: 'var(--ls-sup3)', opacity: 0.7 }} isAnimationActive={false} />
          <Bar dataKey="vendidas" fill={VIZ.vendidas} fillOpacity={0.9} radius={[3, 3, 0, 0]} maxBarSize={14} isAnimationActive={false} />
          <Bar dataKey="devueltas" fill={COLOR_DEVUELTAS} fillOpacity={0.9} radius={[3, 3, 0, 0]} maxBarSize={14} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

/** La serie de 90 días de UN producto. `fin` es el último día leído: el último valor es ese día */
export function GraficoSerie({ serie, fin, alto = 130 }: { serie: number[]; fin: string; alto?: number }) {
  const datos = serie.map((v, i) => ({ fecha: sumarDiasInv(fin, i - (serie.length - 1)), vendidas: v }))
  const Contenido = tooltipDe([{ key: 'vendidas', nombre: 'vendidas', color: VIZ.vendidas }], (l) => dmy(String(l)))
  return (
    <div style={{ height: alto }} className="w-full" role="img" aria-label="Unidades vendidas por día de este producto">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={datos} margin={{ top: 6, right: 6, left: 0, bottom: 0 }} barCategoryGap="12%">
          <CartesianGrid stroke={EJE.rejilla} vertical={false} />
          <XAxis dataKey="fecha" tickFormatter={dm} tick={EJE.tick} axisLine={{ stroke: EJE.linea }} tickLine={false} minTickGap={30} height={20} />
          <YAxis tick={EJE.tick} axisLine={false} tickLine={false} allowDecimals={false} width={26} tickMargin={4} />
          <Tooltip content={<Contenido />} cursor={{ fill: 'var(--ls-sup3)', opacity: 0.7 }} isAnimationActive={false} />
          <Bar dataKey="vendidas" fill={VIZ.vendidas} fillOpacity={0.9} radius={[3, 3, 0, 0]} maxBarSize={10} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* La edad del stock                                                   */
/* ------------------------------------------------------------------ */

export function EdadDelStock({
  porTramo,
  valorPorTramo,
  anterior,
  diasDeLibro,
  sinLibro,
  costeDe,
  sinClasificar = 0,
  seleccion = null,
  onSeleccion,
}: {
  /** El tramo pulsado: sus productos son los que se enseñan debajo */
  seleccion?: string | null
  onSeleccion?: (id: string) => void
  porTramo: PorTramo
  valorPorTramo: PorTramo
  /** Unidades vendibles anteriores al libro: sin tramo */
  anterior: number
  diasDeLibro: number | null
  /** No hay libro mayor leído: de nada se sabe la edad */
  sinLibro: boolean
  /** Euros al mes de guardar tantas unidades, o null si no se calcula */
  costeDe: ((unidades: number) => number) | null
  /** Unidades que Amazon cuenta en sus almacenes y que no están en ninguna fila: no vendibles sin fecha de entrada */
  sinClasificar?: number
}) {
  // El 100 % es TODO lo que enseña la tarjeta, las de «anterior al libro» incluidas. Con las unidades
  // sin edad fuera, un cliente con 16 unidades fechadas y 8 sin fecha salía con «100 % de 0 a 90 días»
  // al lado de una barra que no era toda verde: parecía que nada llevaba más de 90 días
  const total = Object.values(porTramo).reduce((s, v) => s + v, 0) + anterior
  return (
    <div className="space-y-2">
      <Medidor
        alto={10}
        total={Math.max(1, total)}
        partes={[
          ...TRAMOS_EDAD.map((t) => ({ valor: porTramo[t.id], color: COLOR_TRAMO[t.id], titulo: t.texto })),
          { valor: anterior, color: 'var(--ls-t4)', titulo: 'Anterior al libro' },
        ]}
      />
      <table className="w-full border-separate border-spacing-0 text-[12px]">
        <thead>
          <tr className="text-left text-[11px] font-semibold text-[var(--ls-t4)]">
            <th className="h-[22px] pr-2 font-semibold">Lleva en Amazon</th>
            <th className="h-[22px] px-2 text-right font-semibold">Unidades</th>
            <th className="h-[22px] px-2 text-right font-semibold">%</th>
            <th className="h-[22px] px-2 text-right font-semibold">Valor</th>
            {costeDe && <th className="h-[22px] pl-2 text-right font-semibold" title="Estimación: ver los supuestos">Almacenaje/mes</th>}
          </tr>
        </thead>
        <tbody>
          {TRAMOS_EDAD.map((t) => (
            <FilaDeTramo
              key={t.id}
              texto={t.texto}
              color={COLOR_TRAMO[t.id]}
              unidades={porTramo[t.id]}
              activa={seleccion === t.id}
              onPulsar={onSeleccion ? () => onSeleccion(t.id) : undefined}
              celdas={
                <>
                  <td className="h-[24px] border-t border-[var(--ls-linea)] px-2 text-right tabular-nums text-[var(--ls-t3)]">{total > 0 ? n0((porTramo[t.id] / total) * 100) : '—'}</td>
                  <td className="h-[24px] border-t border-[var(--ls-linea)] px-2 text-right tabular-nums text-[var(--ls-t3)]">{eur(valorPorTramo[t.id])}</td>
                  {costeDe && <td className="h-[24px] border-t border-[var(--ls-linea)] pl-2 text-right tabular-nums text-[var(--ls-t3)]">{eur(costeDe(porTramo[t.id]))}</td>}
                </>
              }
            />
          ))}
          {anterior > 0 && (
            <FilaDeTramo
              texto={sinLibro ? 'Edad desconocida (sin libro mayor)' : `Anterior al libro${diasDeLibro !== null ? ` (más de ${diasDeLibro} d)` : ''}`}
              titulo={sinLibro ? 'Todavía no se ha leído el libro mayor de este cliente: no se sabe cuándo llegó nada' : 'Estaba en Amazon antes de que empezara el libro mayor: su edad es esa o más, y no se puede repartir por tramos'}
              color="var(--ls-t4)"
              unidades={anterior}
              activa={seleccion === 'anterior'}
              onPulsar={onSeleccion ? () => onSeleccion('anterior') : undefined}
              celdas={
                <>
                  <td className="h-[24px] border-t border-[var(--ls-linea)] px-2 text-right tabular-nums text-[var(--ls-t3)]">{total > 0 ? n0((anterior / total) * 100) : '—'}</td>
                  <td className="h-[24px] border-t border-[var(--ls-linea)] px-2 text-right text-[var(--ls-t4)]">—</td>
                  {costeDe && <td className="h-[24px] border-t border-[var(--ls-linea)] pl-2 text-right tabular-nums text-[var(--ls-t3)]">{eur(costeDe(anterior))}</td>}
                </>
              }
            />
          )}
        </tbody>
      </table>
      {sinClasificar > 0 && (
        <p className="text-[11px] leading-[1.5] text-[var(--ls-t4)]">
          {sinClasificar === 1
            ? '1 unidad más que Amazon tiene en sus almacenes no sale aquí: no se puede vender y no tiene fecha de entrada en el libro.'
            : `${n0(sinClasificar)} unidades más que Amazon tiene en sus almacenes no salen aquí: no se pueden vender y no tienen fecha de entrada en el libro.`}
        </p>
      )}
    </div>
  )
}

/**
 * UNA FILA DE LA TARJETA DE ANTIGÜEDAD, QUE SE PUEDE PULSAR.
 *
 * Pulsarla es decir «enséñame qué productos forman este tramo»: la pantalla los lista debajo. Una
 * fila sin unidades no se puede pulsar —no hay nada que enseñar—. La fila entera responde al clic,
 * pero lo que recibe el teclado es el botón de la primera celda, así que Tab y Enter también
 * sirven y un lector de pantalla oye «pulsado» en la que está elegida.
 */
function FilaDeTramo({
  texto,
  titulo,
  color,
  unidades,
  activa,
  onPulsar,
  celdas,
}: {
  texto: string
  titulo?: string
  color: string
  unidades: number
  activa: boolean
  onPulsar?: () => void
  celdas: ReactNode
}) {
  const pulsable = !!onPulsar && unidades > 0
  return (
    <tr
      onClick={pulsable ? onPulsar : undefined}
      className={cx(pulsable && 'cursor-pointer', activa ? '[&>td]:bg-[var(--ls-acc-suave)]' : pulsable && 'hover:[&>td]:bg-[var(--ls-sup3)]')}
    >
      <td className={cx('h-[24px] border-t border-[var(--ls-linea)] pr-2', activa && 'shadow-[inset_2px_0_0_var(--ls-acc-graf)] pl-[6px]')} title={titulo}>
        <button
          type="button"
          disabled={!pulsable}
          aria-pressed={activa}
          title={pulsable ? (activa ? 'Quitar el filtro y volver a ver todos los productos' : 'Ver debajo los productos de este tramo') : titulo}
          className={cx('inline-flex items-center gap-[7px] text-left disabled:cursor-default', activa ? 'font-medium text-[var(--ls-t1)]' : 'text-[var(--ls-t2)]', pulsable && 'hover:text-[var(--ls-t1)]')}
        >
          <span className="h-[8px] w-[8px] shrink-0 rounded-[2px]" style={{ background: color }} />
          {texto}
        </button>
      </td>
      <td className="h-[24px] border-t border-[var(--ls-linea)] px-2 text-right tabular-nums text-[var(--ls-t1)]">{n0(unidades)}</td>
      {celdas}
    </tr>
  )
}

/**
 * LA ANTIGÜEDAD DEL STOCK TAL Y COMO LA CUENTA AMAZON.
 *
 * Los siete tramos de Seller Central, con las unidades, el valor y lo que Amazon calcula que
 * cuesta guardarlas. Viene de su informe de planificación (lib/fba/planificacion.ts), no de una
 * estimación: es la edad con la que Amazon cobra.
 */
export function EdadDelStockAmazon({
  resumen,
  sinClasificar = 0,
  seleccion = null,
  onSeleccion,
}: {
  resumen: ResumenEdadAmazon
  sinClasificar?: number
  /** El tramo pulsado: sus productos son los que se enseñan debajo */
  seleccion?: string | null
  onSeleccion?: (id: string) => void
}) {
  const total = Math.max(1, resumen.unidades)
  const conCoste = resumen.costeMes !== null
  return (
    <div className="space-y-2">
      <Medidor alto={10} total={total} partes={resumen.tramos.map((t) => ({ valor: t.unidades, color: COLOR_TRAMO_AMAZON[t.id], titulo: t.texto }))} />
      <table className="w-full border-separate border-spacing-0 text-[12px]">
        <thead>
          <tr className="text-left text-[11px] font-semibold text-[var(--ls-t4)]">
            <th className="h-[22px] pr-2 font-semibold">Lleva en Amazon</th>
            <th className="h-[22px] px-2 text-right font-semibold">Unidades</th>
            <th className="h-[22px] px-2 text-right font-semibold">%</th>
            <th className="h-[22px] px-2 text-right font-semibold">Valor</th>
            {conCoste && (
              <th className="h-[22px] pl-2 text-right font-semibold" title="Lo que Amazon calcula que cuesta guardar el stock de cada tramo el mes que viene. El recargo por antigüedad va al tramo que lo causa">
                Almacenaje/mes
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {resumen.tramos.map((t) => (
            <FilaDeTramo
              key={t.id}
              texto={t.texto}
              color={COLOR_TRAMO_AMAZON[t.id]}
              unidades={t.unidades}
              activa={seleccion === t.id}
              onPulsar={onSeleccion ? () => onSeleccion(t.id) : undefined}
              celdas={
                <>
                  <td className="h-[24px] border-t border-[var(--ls-linea)] px-2 text-right tabular-nums text-[var(--ls-t3)]">{resumen.unidades > 0 ? n0((t.unidades / resumen.unidades) * 100) : '—'}</td>
                  <td className="h-[24px] border-t border-[var(--ls-linea)] px-2 text-right tabular-nums text-[var(--ls-t3)]">{eur(t.valor)}</td>
                  {conCoste && <td className="h-[24px] border-t border-[var(--ls-linea)] pl-2 text-right tabular-nums text-[var(--ls-t3)]">{eurFino(t.coste)}</td>}
                </>
              }
            />
          ))}
        </tbody>
      </table>
      {resumen.aproximada && <p className="text-[11px] leading-[1.5] text-[var(--ls-t4)]">Amazon ha devuelto los tramos de otro mercado: el reparto es aproximado.</p>}
      {sinClasificar > 0 && (
        <p className="text-[11px] leading-[1.5] text-[var(--ls-t4)]">
          {sinClasificar === 1
            ? '1 unidad más que Amazon tiene en sus almacenes no sale aquí: no se puede vender y no tiene edad en su informe.'
            : `${n0(sinClasificar)} unidades más que Amazon tiene en sus almacenes no salen aquí: no se pueden vender y no tienen edad en su informe.`}
        </p>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* El ajuste de los supuestos de almacenaje                            */
/* ------------------------------------------------------------------ */

export function AjusteAlmacenaje({ supuestos, onGuardar }: { supuestos: SupuestosAlmacenaje; onGuardar: (s: SupuestosAlmacenaje) => void }) {
  const [abierto, setAbierto] = useState(false)
  const [borrador, setBorrador] = useState({
    litros: String(supuestos.litrosPorUnidad),
    baja: String(supuestos.tarifaBaja),
    alta: String(supuestos.tarifaAlta),
    recargo: supuestos.recargoAntiguedad === null ? '' : String(supuestos.recargoAntiguedad),
  })

  const num = (t: string): number | null => {
    const v = Number(t.replace(',', '.'))
    return t.trim() !== '' && Number.isFinite(v) && v >= 0 ? v : null
  }

  function abrir() {
    setBorrador({
      litros: String(supuestos.litrosPorUnidad),
      baja: String(supuestos.tarifaBaja),
      alta: String(supuestos.tarifaAlta),
      recargo: supuestos.recargoAntiguedad === null ? '' : String(supuestos.recargoAntiguedad),
    })
    setAbierto(true)
  }

  function guardar() {
    const litros = num(borrador.litros)
    const baja = num(borrador.baja)
    const alta = num(borrador.alta)
    if (litros === null || baja === null || alta === null) return
    onGuardar({ litrosPorUnidad: litros, tarifaBaja: baja, tarifaAlta: alta, recargoAntiguedad: num(borrador.recargo) })
    setAbierto(false)
  }

  const valido = num(borrador.litros) !== null && num(borrador.baja) !== null && num(borrador.alta) !== null

  if (!abierto) {
    return (
      <button type="button" onClick={abrir} className={cx(BOTON.icono, '!h-[18px] !w-[18px]')} title="Ajustar el volumen por unidad y las tarifas con las que se estima el almacenaje">
        <Pencil className="h-3 w-3" />
      </button>
    )
  }

  return (
    <div className="absolute right-0 top-full z-40 mt-1 w-[280px] rounded-[8px] border border-[var(--ls-linea2)] bg-[var(--ls-sup2)] p-3 shadow-xl">
      <p className="mb-2 text-[11.5px] leading-[1.5] text-[var(--ls-t3)]">
        Es una <b className="font-semibold text-[var(--ls-t2)]">estimación</b>: Amazon cobra por volumen y en el catálogo no hay medidas. Ajusta estos valores a este cliente; la cifra exacta está en Seller Central.
      </p>
      <div className="space-y-2">
        <Campo etiqueta="Volumen medio por unidad (litros)" valor={borrador.litros} onCambio={(v) => setBorrador({ ...borrador, litros: v })} />
        <Campo etiqueta="€/m³ al mes, de enero a septiembre" valor={borrador.baja} onCambio={(v) => setBorrador({ ...borrador, baja: v })} />
        <Campo etiqueta="€/m³ al mes, de octubre a diciembre" valor={borrador.alta} onCambio={(v) => setBorrador({ ...borrador, alta: v })} />
        <Campo
          etiqueta="Recargo por antigüedad, €/m³ al mes (opcional)"
          valor={borrador.recargo}
          onCambio={(v) => setBorrador({ ...borrador, recargo: v })}
          nota="Para lo que lleva más de 270 días. Sin tarifa no se calcula."
        />
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <button
          type="button"
          className="text-[11.5px] text-[var(--ls-t3)] hover:text-[var(--ls-t1)]"
          onClick={() => setBorrador({ litros: String(SUPUESTOS_POR_DEFECTO.litrosPorUnidad), baja: String(SUPUESTOS_POR_DEFECTO.tarifaBaja), alta: String(SUPUESTOS_POR_DEFECTO.tarifaAlta), recargo: '' })}
        >
          Valores de partida
        </button>
        <div className="flex gap-2">
          <button type="button" onClick={() => setAbierto(false)} className={cx(BOTON.base, BOTON.secundario)}>
            <X className="h-3 w-3" />
            Cancelar
          </button>
          <button type="button" onClick={guardar} disabled={!valido} className={cx(BOTON.base, BOTON.primario)}>
            <Check className="h-3 w-3" />
            Guardar
          </button>
        </div>
      </div>
    </div>
  )
}

function Campo({ etiqueta, valor, onCambio, nota }: { etiqueta: string; valor: string; onCambio: (v: string) => void; nota?: string }) {
  return (
    <label className="block">
      <span className={CAMPO.etiqueta}>{etiqueta}</span>
      <input value={valor} onChange={(e) => onCambio(e.target.value)} inputMode="decimal" className={cx(CAMPO.input, CAMPO.numero)} />
      {nota && <span className={CAMPO.nota}>{nota}</span>}
    </label>
  )
}

/* ------------------------------------------------------------------ */
/* Un dato con su rótulo, para la ficha de un producto                  */
/* ------------------------------------------------------------------ */

export function Dato({ rotulo, valor, sub, tono }: { rotulo: string; valor: ReactNode; sub?: ReactNode; tono?: TonoEstado }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold text-[var(--ls-t4)]">{rotulo}</dt>
      <dd className="mt-[1px] text-[14px] font-semibold tabular-nums text-[var(--ls-t1)]" style={tono ? { color: COLOR_ESTADO[tono] } : undefined}>
        {valor}
      </dd>
      {sub && <dd className="text-[11.5px] leading-[1.4] text-[var(--ls-t3)]">{sub}</dd>}
    </div>
  )
}

