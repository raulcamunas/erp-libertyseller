'use client'

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Area, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { AlertTriangle, Check, ChevronDown, Columns3, Pencil, Truck, X } from 'lucide-react'
import { BOTON, CAMPO, COLOR_ESTADO, ESTADO, type TonoEstado } from '@/lib/estilo/denso'
import { SUPUESTOS_POR_DEFECTO, type SupuestosAlmacenaje } from '@/lib/fba/almacenaje'
import { TRAMOS_EDAD, sumarDiasInv, type DiaVentas, type EstadoSku, type PorTramo } from '@/lib/fba/inventario'
import type { EnCamino, MotivoFuera, Prioridad } from '@/lib/fba/plan-tipos'
import { BarraDeProgreso, colorDeAcento, Insignia as InsigniaKit, mezcla, TACTIL } from '@/components/ui-ls'
import { DURACION_ANIMACION, EJE, Grafico, mediaMovil, useAnimarGraficos, VIZ, dm, dmy, tooltipDe } from '../comun/graficos'
import { ESTADO_STOCK, PRIORIDAD, type EstadoStock } from '../comun/estilo-plan'
import { Clave, cx, Medidor } from '../comun/ui'
import { decimal, diasEntre, entero, fechaCorta } from '../formato'
import type { ResumenEdadAmazon } from '@/lib/fba/planificacion'
import { AYUDA_ESTADO_STOCK, COLOR_TRAMO, COLOR_TRAMO_AMAZON, ESTADO_SKU, eur, eurFino, n0, type BarraDeStock } from './formato'

/**
 * LAS PIEZAS DEL PANEL DE INVENTARIO: tarjetas de cifras, estado, gráficos y el ajuste
 * del almacenaje.
 */

/* ------------------------------------------------------------------ */
/* Tarjeta de cifra                                                    */
/* ------------------------------------------------------------------ */

/**
 * La cifra densa de la sección Stock: rótulo, valor (texto: «412 uds», «34 días») y su línea gris debajo. Con el aspecto
 * del kit (radio 14, velo, filo de color del módulo) pero con valor libre y un hueco a la derecha (el lápiz del
 * almacenaje abre un panel que sale por debajo: por eso NO lleva `overflow-hidden`).
 */
export function Kpi({
  rotulo,
  valor,
  sub,
  tono,
  ayuda,
  derecha,
  indice,
}: {
  rotulo: string
  valor: ReactNode
  sub?: ReactNode
  tono?: TonoEstado
  ayuda?: string
  derecha?: ReactNode
  /** Posición en la fila, para la entrada escalonada */
  indice?: number
}) {
  return (
    <div
      title={ayuda}
      className={cx(
        'relative min-w-0 rounded-[14px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] px-4 py-3 shadow-[var(--ls-sombra-1)]',
        'before:pointer-events-none before:absolute before:inset-0 before:rounded-[inherit] before:bg-[image:var(--ls-velo)]',
        indice != null && 'ls-aparecer',
      )}
      style={indice != null ? ({ ['--ls-i' as string]: indice } as CSSProperties) : undefined}
    >
      <span aria-hidden className="absolute left-4 top-0 h-[2px] w-8 rounded-b-full" style={{ background: tono ? COLOR_ESTADO[tono] : colorDeAcento('remesas') }} />
      <div className="relative flex items-center justify-between gap-2">
        <span className="truncate text-[12px] font-medium text-[var(--ls-t3)]">{rotulo}</span>
        {derecha}
      </div>
      <div
        className="relative mt-[4px] text-[22px] font-semibold leading-[1.15] tracking-[-0.02em] tabular-nums text-[var(--ls-t1)]"
        style={tono ? { color: COLOR_ESTADO[tono] } : undefined}
      >
        {valor}
      </div>
      {sub && <div className="relative mt-[3px] text-[11.5px] leading-[1.4] text-[var(--ls-t3)]">{sub}</div>}
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
    <div className="absolute right-0 top-full z-40 mt-1 w-[min(280px,calc(100vw-32px))] rounded-[10px] border border-[var(--ls-linea2)] bg-[var(--ls-sup2)] p-3 shadow-xl">
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


/* ------------------------------------------------------------------ */
/* Estado de stock (tabla nueva)                                       */
/* ------------------------------------------------------------------ */

/** La insignia del kit con el estado de stock de estilo-plan (agotado · rompe pronto · bajo · bien · de sobra · parado…) */
export function InsigniaEstadoStock({ estado, corto = false }: { estado: EstadoStock; corto?: boolean }) {
  const e = ESTADO_STOCK[estado]
  return (
    <InsigniaKit tono={e.tono} variante={e.variante} tamano="sm" title={AYUDA_ESTADO_STOCK[estado]}>
      {corto ? e.corto : e.texto}
    </InsigniaKit>
  )
}

/* ------------------------------------------------------------------ */
/* Stock en FBA ahora: barra apilada                                   */
/* ------------------------------------------------------------------ */

const COLOR_CAMINO = 'var(--viz-3)'
const COLOR_RESERVADO = 'var(--ls-t4)'

/** Vendible (naranja, «quedan»), de camino, reservado y no apto, en una barra y con sus cifras en la leyenda. Sin donuts */
export function BarraStock({ barra }: { barra: BarraDeStock }) {
  const partes = [
    { id: 'vendible', texto: 'Vendible', valor: barra.vendible, color: VIZ.quedan, ayuda: 'Se puede vender ahora mismo' },
    { id: 'camino', texto: 'De camino', valor: barra.camino, color: COLOR_CAMINO, ayuda: 'Enviado a Amazon y todavía sin recibir' },
    ...(barra.conDesglose ? [{ id: 'reservado', texto: 'Reservado', valor: barra.reservado, color: COLOR_RESERVADO, ayuda: 'Pedidos de clientes y traslados entre centros de Amazon' }] : []),
    {
      id: 'no_apto',
      texto: barra.conDesglose ? 'No apto' : 'No vendible',
      valor: barra.noApto,
      color: COLOR_ESTADO.rojo,
      ayuda: barra.conDesglose ? 'Dañado o defectuoso en los almacenes de Amazon' : 'En Amazon y no vendible ahora: reservado, en tránsito sin registrar o dañado (Amazon no ha dado el desglose)',
    },
  ]
  const total = Math.max(1, barra.total)
  return (
    <div className="min-w-0 space-y-3">
      <Medidor alto={14} total={total} partes={partes.map((p) => ({ valor: p.valor, color: p.color, titulo: p.texto }))} />
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        {partes.map((p) => (
          <div key={p.id} className="min-w-0" title={p.ayuda}>
            <dt className="flex items-center gap-[6px] text-[11.5px] text-[var(--ls-t3)]">
              <span className="h-[8px] w-[8px] shrink-0 rounded-[2px]" style={{ background: p.color }} aria-hidden />
              <span className="truncate">{p.texto}</span>
            </dt>
            <dd className="mt-[2px] text-[17px] font-semibold tabular-nums tracking-[-0.01em] text-[var(--ls-t1)]">
              {entero(p.valor)} <span className="text-[11.5px] font-normal text-[var(--ls-t4)]">ud · {barra.total > 0 ? `${decimal((p.valor / barra.total) * 100, 0)} %` : '—'}</span>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Ventas de 90 días con el periodo anterior                           */
/* ------------------------------------------------------------------ */

export interface PuntoVenta {
  fecha: string
  unidades: number
  euros: number | null
}

/**
 * Área de unidades por día (media de 7 días, para que 90 puntos se lean) y línea discontinua del periodo anterior de la
 * misma duración, alineada por posición. Un solo eje (unidades). Sin anterior completo, solo el área.
 */
export function GraficoVentas90({ datos, anterior, etiqueta, alto }: { datos: readonly PuntoVenta[]; anterior: readonly PuntoVenta[] | null; etiqueta: string; alto?: number }) {
  const orden = [...datos].sort((a, b) => a.fecha.localeCompare(b.fecha))
  const previo = anterior ? [...anterior].sort((a, b) => a.fecha.localeCompare(b.fecha)) : null
  const media = mediaMovil(orden.map((d) => d.unidades), 7)
  const mediaPrevia = previo ? mediaMovil(previo.map((d) => d.unidades), 7) : null
  const desfase = previo ? previo.length - orden.length : 0
  const filas = orden.map((d, i) => ({
    fecha: d.fecha,
    dia: d.unidades,
    media: media[i] === null ? null : Math.round((media[i] as number) * 10) / 10,
    anterior: mediaPrevia ? (mediaPrevia[i + desfase] ?? null) === null ? null : Math.round((mediaPrevia[i + desfase] as number) * 10) / 10 : null,
  }))
  const animar = useAnimarGraficos(filas.length * 2)
  const hayAnterior = filas.some((f) => f.anterior !== null)
  const vacio = filas.length === 0 || filas.every((f) => f.dia === 0)
  const Contenido = tooltipDe(
    [
      { key: 'media', nombre: 'ud/día (media 7 días)', color: VIZ.vendidas, formato: (v) => decimal(v, 1) },
      { key: 'dia', nombre: 'ud ese día', color: 'var(--ls-t3)', formato: (v) => entero(v) },
      ...(hayAnterior ? [{ key: 'anterior', nombre: 'ud/día, periodo anterior', color: 'var(--ls-t4)', formato: (v: number) => decimal(v, 1) }] : []),
    ],
    (l) => dmy(String(l))
  )
  return (
    <div className="min-w-0 w-full">
      {!vacio && (
        <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1">
          <Clave color={VIZ.vendidas}>Unidades al día (media de 7 días)</Clave>
          {hayAnterior && <Clave color="var(--ls-t4)">Los 90 días anteriores</Clave>}
        </div>
      )}
      <Grafico etiqueta={etiqueta} vacio={vacio} alto={alto} textoVacio="Sin ventas en estos 90 días">
        <ComposedChart data={filas} margin={{ top: 8, right: 6, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="c3-ventas-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={VIZ.vendidas} stopOpacity={0.28} />
              <stop offset="100%" stopColor={VIZ.vendidas} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={EJE.rejilla} vertical={false} />
          <XAxis dataKey="fecha" tickFormatter={(v: string) => fechaCorta(v)} tick={EJE.tick} axisLine={{ stroke: EJE.linea }} tickLine={false} minTickGap={28} />
          <YAxis tick={EJE.tick} axisLine={false} tickLine={false} width={32} tickMargin={4} domain={[0, 'auto']} />
          <Tooltip content={<Contenido />} cursor={{ stroke: 'var(--ls-linea2)', strokeWidth: 1 }} isAnimationActive={false} />
          {hayAnterior && <Line type="monotone" dataKey="anterior" stroke="var(--ls-t4)" strokeWidth={1.5} strokeDasharray="4 4" dot={false} isAnimationActive={false} connectNulls />}
          <Area
            type="monotone"
            dataKey="media"
            stroke={VIZ.vendidas}
            strokeWidth={2}
            fill="url(#c3-ventas-area)"
            isAnimationActive={animar}
            animationDuration={DURACION_ANIMACION}
            activeDot={{ r: 4, fill: VIZ.vendidas, stroke: 'var(--ls-sup)', strokeWidth: 2 }}
            connectNulls
          />
          <Line type="monotone" dataKey="dia" stroke="transparent" dot={false} activeDot={false} isAnimationActive={false} legendType="none" />
        </ComposedChart>
      </Grafico>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Mapa de cobertura                                                   */
/* ------------------------------------------------------------------ */

export interface BarraMapa {
  sku: string
  nombre: string | null
  /** Días que dura con lo que viene */
  dias: number
  /** Lo que se dibuja (topado para que una referencia de 400 días no aplaste el resto) */
  barra: number
  topada: boolean
  fechaRotura: string | null
  prioridad: Prioridad | null
  fuera: MotivoFuera | null
}

const FUERA_GRIS = new Set<MotivoFuera>(['sin_ventas', 'descatalogada', 'no_comprable', 'sin_datos', 'parado', 'antiguo', 'agotado_largo', 'talla_sin_ventas'])

/** Agencia: color por prioridad (gris si el plan la deja fuera). Cliente externo: por días (≤ 14 rojo, ≤ 30 ámbar, verde) */
function colorDeBarra(b: BarraMapa): string {
  if (b.prioridad) return b.fuera && FUERA_GRIS.has(b.fuera) ? COLOR_ESTADO.gris : COLOR_ESTADO[PRIORIDAD[b.prioridad].tono]
  return b.dias <= 14 ? COLOR_ESTADO.rojo : b.dias <= 30 ? COLOR_ESTADO.ambar : COLOR_ESTADO.verde
}

const recorta = (t: string) => (t.length > 13 ? `${t.slice(0, 12)}…` : t)

function TooltipMapa({ active, payload, hoy }: { active?: boolean; payload?: Array<{ payload?: BarraMapa }>; hoy: string }) {
  const b = active ? payload?.[0]?.payload : undefined
  if (!b) return null
  return (
    <div className="pointer-events-none max-w-[260px] rounded-[10px] border border-[var(--ls-linea2)] bg-[var(--ls-sup2)] px-[10px] py-[8px] shadow-lg">
      <p className="truncate text-[12px] font-semibold text-[var(--ls-t1)]">{b.sku}</p>
      {b.nombre && <p className="truncate text-[11px] text-[var(--ls-t4)]">{b.nombre}</p>}
      <p className="mt-1 text-[13px] font-semibold tabular-nums text-[var(--ls-t1)]">
        {entero(b.dias)} días <span className="text-[11.5px] font-normal text-[var(--ls-t3)]">con lo que viene</span>
      </p>
      <p className="text-[11.5px] text-[var(--ls-t3)]">{b.fechaRotura ? `Se queda sin stock el ${fechaCorta(b.fechaRotura, hoy)}` : 'Sin rotura a la vista'}</p>
      {b.prioridad && (
        <p className="mt-1 text-[11px]" style={{ color: colorDeBarra(b) }}>
          {PRIORIDAD[b.prioridad].texto}
        </p>
      )}
    </div>
  )
}

/**
 * Barras horizontales: los días que dura cada referencia con lo que viene, las 15 que antes rompen. Con el plazo (solo
 * agencia) dos rayas: `L` («a la venta») y `L + M` (con el margen). Debajo, la leyenda en texto.
 */
export function MapaCobertura({
  barras,
  hoy,
  plazo,
  onElegir,
}: {
  barras: readonly BarraMapa[]
  hoy: string
  plazo?: { hastaLaVenta: number; margen: number } | null
  onElegir?: (sku: string) => void
}) {
  const animar = useAnimarGraficos(barras.length)
  const tope = Math.max(60, Math.min(180, plazo ? (plazo.hastaLaVenta + plazo.margen) * 2 : 90))
  const datos = barras.map((b) => ({ ...b, barra: Math.max(0.5, Math.min(b.dias, tope)), topada: b.dias > tope }))
  const alto = Math.max(160, 40 + datos.length * 24)
  const L = plazo?.hastaLaVenta ?? null
  const LM = plazo ? plazo.hastaLaVenta + plazo.margen : null
  return (
    <div className="min-w-0">
      <Grafico
        alto={alto}
        etiqueta={`Días que dura el stock de las ${datos.length} referencias que antes se quedan sin él${L !== null ? `, con el plazo hasta la venta (${L} días)` : ''}`}
        vacio={datos.length === 0}
        textoVacio="Ninguna referencia con ritmo de venta"
        descripcionVacio="Sin ventas no hay rotura que pintar."
      >
        <BarChart data={datos} layout="vertical" margin={{ top: L !== null ? 18 : 6, right: 14, bottom: 4, left: 2 }} barCategoryGap={5}>
          <CartesianGrid horizontal={false} stroke={EJE.rejilla} />
          <XAxis type="number" domain={[0, tope]} allowDataOverflow tick={EJE.tick} tickLine={false} axisLine={{ stroke: EJE.linea }} unit=" d" />
          <YAxis type="category" dataKey="sku" width={116} tick={EJE.tick} tickLine={false} axisLine={false} tickFormatter={recorta} interval={0} />
          <Tooltip cursor={{ fill: 'var(--ls-sup2)' }} content={<TooltipMapa hoy={hoy} />} isAnimationActive={false} />
          {L !== null && <ReferenceLine x={L} stroke={COLOR_ESTADO.rojo} strokeDasharray="4 3" label={{ value: `a la venta: ${L} d`, position: 'top', fill: COLOR_ESTADO.rojo, fontSize: 10.5 }} />}
          {LM !== null && <ReferenceLine x={LM} stroke={COLOR_ESTADO.ambar} strokeDasharray="2 3" />}
          <Bar
            dataKey="barra"
            radius={[0, 4, 4, 0]}
            maxBarSize={16}
            isAnimationActive={animar}
            animationDuration={DURACION_ANIMACION}
            onClick={onElegir ? (d: { payload?: BarraMapa }) => d?.payload && onElegir(d.payload.sku) : undefined}
            className={onElegir ? 'cursor-pointer' : undefined}
          >
            {datos.map((b) => (
              <Cell key={b.sku} fill={colorDeBarra(b)} fillOpacity={b.topada ? 0.5 : 0.9} />
            ))}
          </Bar>
        </BarChart>
      </Grafico>
      {datos.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 px-1">
          {L !== null && LM !== null ? (
            <>
              <Clave color={COLOR_ESTADO.rojo}>Plazo hasta la venta ({entero(L)} d): a su izquierda la rotura ya no se evita</Clave>
              <Clave color={COLOR_ESTADO.ambar}>Con el margen ({entero(LM)} d): entre las dos, hay que decidir ya</Clave>
            </>
          ) : (
            <>
              <Clave color={COLOR_ESTADO.rojo}>14 días o menos</Clave>
              <Clave color={COLOR_ESTADO.ambar}>Hasta 30 días</Clave>
              <Clave color={COLOR_ESTADO.verde}>Más de 30 días</Clave>
            </>
          )}
          {datos.some((b) => b.topada) && <span className="text-[11.5px] text-[var(--ls-t4)]">Barra apagada = dura más de {entero(tope)} días</span>}
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Un envío de camino                                                  */
/* ------------------------------------------------------------------ */

/** Tarjeta de un envío de camino: nombre, nº FBA, recibido de lo enviado y llegada prevista. Lo dudoso se marca y no cuenta */
export function TarjetaEnCamino({ envio, hoy, onAbrir, indice }: { envio: EnCamino; hoy: string; onAbrir?: () => void; indice?: number }) {
  const faltan = envio.llegadaPrevista ? diasEntre(hoy, envio.llegadaPrevista) : null
  const Etiqueta = onAbrir ? 'button' : 'div'
  return (
    <Etiqueta
      type={onAbrir ? 'button' : undefined}
      onClick={onAbrir}
      className={cx(
        'relative flex min-w-0 flex-col gap-2 rounded-[12px] border bg-[var(--ls-sup2)] p-3 text-left',
        envio.dudoso ? 'border-[color-mix(in_srgb,var(--ls-e-rojo)_35%,var(--ls-linea))]' : 'border-[var(--ls-linea)]',
        onAbrir && 'ls-elevar cursor-pointer hover:border-[var(--ls-linea2)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ls-acc-graf)]',
        indice != null && 'ls-aparecer',
      )}
      style={indice != null ? ({ ['--ls-i' as string]: indice } as CSSProperties) : undefined}
    >
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-[6px] truncate text-[13px] font-semibold text-[var(--ls-t1)]">
            <Truck className="h-[14px] w-[14px] shrink-0 text-[var(--ls-t4)]" aria-hidden />
            <span className="truncate">{envio.nombre}</span>
          </p>
          <p className="truncate font-mono text-[11px] text-[var(--ls-t4)]">{envio.referenciaEnvio ?? 'sin número FBA'}</p>
        </div>
        {envio.dudoso ? (
          <InsigniaKit tono="rojo" variante="contorno" tamano="sm" icono={AlertTriangle} title="Lleva mucho más de lo normal sin recibirse nada: el plan no cuenta con él. Pregunta a Amazon">
            Dudoso
          </InsigniaKit>
        ) : envio.estadoAmazon ? (
          <InsigniaKit tono="cian" tamano="sm">
            {envio.estadoAmazon.replace(/_/g, ' ').toLowerCase()}
          </InsigniaKit>
        ) : null}
      </div>
      <BarraDeProgreso
        valor={envio.recibidas}
        maximo={Math.max(1, envio.unidades)}
        tamano="sm"
        tono={envio.dudoso ? 'rojo' : envio.recibidas >= envio.unidades ? 'verde' : 'cian'}
        etiqueta={<span className="text-[var(--ls-t3)]">Recibido</span>}
        detalle={<span className="tabular-nums text-[var(--ls-t2)]">{entero(envio.recibidas)} de {entero(envio.unidades)} ud</span>}
      />
      <p className="text-[11.5px] text-[var(--ls-t3)]">
        {envio.fechaEnvio ? `Salió el ${fechaCorta(envio.fechaEnvio, hoy)}` : 'Sin fecha de salida'}
        {envio.dudoso
          ? ' · no cuenta para la cobertura'
          : envio.llegadaPrevista
            ? ` · ${faltan !== null && faltan <= 0 ? 'llegando' : `llega hacia el ${fechaCorta(envio.llegadaPrevista, hoy)}`}`
            : ''}
      </p>
    </Etiqueta>
  )
}

/* ------------------------------------------------------------------ */
/* Columnas ▾                                                           */
/* ------------------------------------------------------------------ */

/** El menú «Columnas ▾» de la tabla de stock (solo escritorio): casillas para enseñar las columnas que no son las 7 de siempre */
export function MenuColumnas({
  opciones,
  visibles,
  onCambio,
}: {
  opciones: ReadonlyArray<{ id: string; texto: string }>
  visibles: ReadonlySet<string>
  onCambio: (id: string, visible: boolean) => void
}) {
  const [abierto, setAbierto] = useState(false)
  const caja = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!abierto) return
    const fuera = (e: MouseEvent) => {
      if (caja.current && !caja.current.contains(e.target as Node)) setAbierto(false)
    }
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAbierto(false)
    }
    document.addEventListener('mousedown', fuera)
    document.addEventListener('keydown', tecla)
    return () => {
      document.removeEventListener('mousedown', fuera)
      document.removeEventListener('keydown', tecla)
    }
  }, [abierto])
  const n = opciones.filter((o) => visibles.has(o.id)).length
  return (
    <div ref={caja} className="relative">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        aria-haspopup="true"
        className={cx(BOTON.base, BOTON.alto, BOTON.secundario, TACTIL)}
        title="Elegir qué columnas más se ven en la tabla"
      >
        <Columns3 className="h-3 w-3" />
        Columnas{n > 0 ? ` (+${n})` : ''}
        <ChevronDown className={cx('h-3 w-3 transition-transform motion-reduce:transition-none', abierto && 'rotate-180')} />
      </button>
      {abierto && (
        <div
          role="menu"
          className="absolute right-0 top-full z-40 mt-1 max-h-[60vh] w-[240px] overflow-y-auto rounded-[12px] border border-[var(--ls-linea2)] bg-[var(--ls-sup2)] p-[6px] shadow-[var(--ls-sombra-3)]"
        >
          <p className="px-2 pb-1 pt-[2px] text-[11px] font-semibold text-[var(--ls-t4)]">Más columnas</p>
          {opciones.map((o) => {
            const activa = visibles.has(o.id)
            return (
              <label key={o.id} role="menuitemcheckbox" aria-checked={activa} className="flex cursor-pointer items-center gap-2 rounded-[8px] px-2 py-[6px] text-[12.5px] text-[var(--ls-t2)] hover:bg-[var(--ls-sup3)]">
                <input type="checkbox" checked={activa} onChange={(e) => onCambio(o.id, e.target.checked)} className="h-[14px] w-[14px] accent-[var(--ls-acc)]" />
                {o.texto}
              </label>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** Una nota pequeña con tono, para el origen de las cifras («del plan del 15 nov · stock de hace 2 días») */
export function NotaDeOrigen({ children, tono }: { children: ReactNode; tono?: TonoEstado }) {
  const color = tono ? COLOR_ESTADO[tono] : 'var(--ls-t4)'
  return (
    <span className="inline-flex max-w-full items-center gap-[6px] rounded-full border px-[9px] py-[3px] text-[11.5px] leading-[1.35]" style={{ color: tono ? color : 'var(--ls-t3)', borderColor: mezcla(color, 30), background: mezcla(color, 8) }}>
      {children}
    </span>
  )
}
