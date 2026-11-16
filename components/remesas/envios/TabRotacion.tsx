'use client'

import { useMemo } from 'react'
import { Activity, Download } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from 'recharts'
import { Boton, TablaAdaptable, type Columna } from '@/components/ui-ls'
import type { FilaProducto, ResumenRitmo } from '@/lib/fba/analisis'
import type { LineaDePanel } from '@/lib/fba/datos'
import { descargarCsv, EJE, Grafico, TablaDeDatos, TarjetaGrafico, tooltipDe, useAnimarGraficos, VIZ, DURACION_ANIMACION } from '../comun/graficos'
import { Clave, cx } from '../comun/ui'
import { decimal, entero, fecha, ritmo as textoRitmo } from '../formato'
import { ChipRotacion } from './ChipRotacion'
import { ventasPorSku } from './reglas'
import { CeldaProducto } from './TablaReferencias'

/**
 * ROTACIÓN: A QUÉ RITMO SALE CADA PRODUCTO DE ESTE ENVÍO Y CUÁNDO SE AGOTA.
 *
 * El ritmo de aquí es el «ritmo de este envío» (su lote FIFO). Al lado va el de la referencia (planificador): un SKU
 * cuyo envío más antiguo todavía tiene stock no vende de este, aunque la referencia venda mucho (spec §1.1).
 *
 * El gráfico enseña los diez que más se han vendido con lo que les queda a cada uno: mucha venta y poco stock es lo que
 * toca reponer. Barras finas, con 2 px de superficie entre lo vendido y lo que queda.
 */

export function TabRotacion({
  filas,
  ritmo,
  nombreArchivo,
  ritmoReferencia = null,
  lineas = [],
}: {
  filas: FilaProducto[]
  ritmo: ResumenRitmo
  nombreArchivo: string
  ritmoReferencia?: Map<string, number> | null
  lineas?: LineaDePanel[]
}) {
  const ventas = useMemo(() => ventasPorSku(lineas), [lineas])
  const vendidas = (f: FilaProducto) => ventas.get(f.sku)?.ventas ?? f.vendidas
  const refTotal = useMemo(() => {
    if (!ritmoReferencia) return null
    let s = 0
    let hay = false
    for (const f of filas) {
      const r = ritmoReferencia.get(f.sku)
      if (r) {
        s += r
        hay = true
      }
    }
    return hay ? s : null
  }, [filas, ritmoReferencia])

  const top = useMemo(
    () =>
      [...filas]
        .filter((f) => vendidas(f) > 0)
        .sort((a, b) => vendidas(b) - vendidas(a))
        .slice(0, 10)
        .map((f) => ({
          etiqueta: f.variante ? `${f.sku.slice(-9)} · ${f.variante}` : f.sku.slice(-14),
          vendidas: vendidas(f),
          quedan: f.quedan,
        })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filas, ventas]
  )
  const animar = useAnimarGraficos(top.length * 2)

  const Contenido = tooltipDe(
    [
      { key: 'vendidas', nombre: 'Vendidas', color: VIZ.vendidas, formato: (v) => `${entero(v)} ud` },
      { key: 'quedan', nombre: 'Quedan', color: VIZ.quedan, formato: (v) => `${entero(v)} ud` },
    ],
    (l) => String(l)
  )

  const urgencia = (f: FilaProducto) => (f.clase === 'sin_stock' ? 1e9 : (f.cobertura ?? 1e8))
  const columnas: Columna<FilaProducto>[] = [
    { id: 'producto', cabecera: 'Producto', celda: (f) => <CeldaProducto f={f} />, ordenar: (f) => f.sku, movil: 'titulo', ancho: '30%' },
    { id: 'rotacion', cabecera: 'Rotación', celda: (f) => <ChipRotacion clase={f.clase} />, ordenar: urgencia, movil: 'insignia' },
    { id: 'vendidas', cabecera: 'Vendidas', celda: (f) => entero(vendidas(f)), ordenar: vendidas, alinear: 'derecha' },
    {
      id: 'ritmo',
      cabecera: 'Ritmo envío',
      rotuloMovil: 'Ritmo de este envío',
      celda: (f) => <span title="ud/día de este envío en la última semana">{decimal(f.udDia7, 2)}</span>,
      ordenar: (f) => f.udDia7,
      alinear: 'derecha',
    },
    ...(ritmoReferencia
      ? [
          {
            id: 'ritmoRef',
            cabecera: 'Ritmo ref.',
            rotuloMovil: 'Ritmo de la referencia',
            celda: (f: FilaProducto) => {
              const r = ritmoReferencia.get(f.sku)
              return <span className="text-[var(--ls-t3)]">{r ? decimal(r, 2) : '—'}</span>
            },
            ordenar: (f: FilaProducto) => ritmoReferencia.get(f.sku) ?? 0,
            alinear: 'derecha' as const,
          },
        ]
      : []),
    { id: 'quedan', cabecera: 'Quedan', celda: (f) => <b className="font-semibold text-[var(--ls-t1)]">{entero(f.quedan)}</b>, ordenar: (f) => f.quedan, alinear: 'derecha' },
    { id: 'cobertura', cabecera: 'Días de stock', celda: (f) => (f.cobertura === null ? '—' : entero(f.cobertura)), ordenar: urgencia, alinear: 'derecha' },
    {
      id: 'agota',
      cabecera: 'Se agota',
      celda: (f) => <span className="text-[var(--ls-t3)]">{f.quedan === 0 ? 'agotado' : f.seAgotaEl ? fecha(f.seAgotaEl) : '—'}</span>,
      ordenar: (f) => f.seAgotaEl ?? '9999',
    },
    { id: 'total', cabecera: 'Desde la llegada', rotuloMovil: 'Ud/día desde la llegada', celda: (f) => decimal(f.udDiaRemesa, 2), ordenar: (f) => f.udDiaRemesa, alinear: 'derecha', movil: 'oculto' },
  ]

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[14px] border border-[var(--ls-linea)] bg-[var(--ls-linea)] shadow-[var(--ls-sombra-1)] sm:grid-cols-3 xl:grid-cols-6">
        <Dato rotulo="Ritmo de este envío · 7 d" valor={decimal(ritmo.udDia7, 2)} unidad="ud/día" />
        <Dato
          rotulo="Ritmo de la referencia"
          valor={refTotal === null ? '—' : decimal(refTotal, 2)}
          unidad={refTotal === null ? undefined : 'ud/día'}
          sub="planificador, sus referencias"
          pista="Lo que venden en total las referencias de este envío (de todos sus envíos), según el planificador"
        />
        <Dato rotulo="Este envío · 30 d" valor={decimal(ritmo.udDia30, 2)} unidad="ud/día" />
        <Dato rotulo="Desde la llegada" valor={decimal(ritmo.udDiaRemesa, 2)} unidad="ud/día" />
        <Dato rotulo="Días con ventas" valor={entero(ritmo.diasConVentas)} unidad={`de ${entero(ritmo.diasTotales)}`} />
        <Dato rotulo="Se agota" valor={ritmo.seAgotaEl ? fecha(ritmo.seAgotaEl) : '—'} sub="al ritmo de este envío" />
      </div>

      {top.length > 0 && (
        <TarjetaGrafico
          titulo="Los 10 que más se han vendido"
          ayuda="Lo vendido y lo que queda de cada uno: mucha venta y poco stock es lo que toca reponer"
          leyenda={
            <>
              <Clave color={VIZ.vendidas}>Vendidas</Clave>
              <Clave color={VIZ.quedan}>Quedan</Clave>
            </>
          }
          grafico={
            <Grafico etiqueta="Los diez productos más vendidos y lo que queda de cada uno" alto={top.length * 28 + 34}>
              <BarChart data={top} layout="vertical" margin={{ top: 2, right: 14, left: 0, bottom: 0 }} barSize={14} barCategoryGap="30%">
                <CartesianGrid stroke={EJE.rejilla} horizontal={false} />
                <XAxis type="number" tick={EJE.tick} axisLine={{ stroke: EJE.linea }} tickLine={false} allowDecimals={false} />
                <YAxis type="category" dataKey="etiqueta" width={104} tick={EJE.tick} axisLine={false} tickLine={false} />
                <Tooltip content={<Contenido />} cursor={{ fill: 'var(--ls-sup3)', opacity: 0.7 }} isAnimationActive={false} />
                <Bar dataKey="vendidas" stackId="a" fill={VIZ.vendidas} stroke="var(--ls-sup)" strokeWidth={2} isAnimationActive={animar} animationDuration={DURACION_ANIMACION} />
                <Bar dataKey="quedan" stackId="a" fill={VIZ.quedan} stroke="var(--ls-sup)" strokeWidth={2} radius={[0, 4, 4, 0]} isAnimationActive={animar} animationDuration={DURACION_ANIMACION} />
              </BarChart>
            </Grafico>
          }
          tabla={
            <TablaDeDatos
              columnas={[
                { clave: 'etiqueta', titulo: 'Producto' },
                { clave: 'vendidas', titulo: 'Vendidas', numero: true },
                { clave: 'quedan', titulo: 'Quedan', numero: true },
              ]}
              filas={top}
            />
          }
        />
      )}

      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <h3 className="text-[13.5px] font-semibold text-[var(--ls-t1)]">Rotación por producto</h3>
        <Boton
          tamano="sm"
          icono={Download}
          onClick={() =>
            descargarCsv(
              `rotacion-${nombreArchivo}.csv`,
              ['SKU', 'Producto', 'Vendidas', 'Ud/día 7 d (este envío)', 'Ud/día de la referencia', 'Ud/día desde la llegada', 'Quedan', 'Días de stock', 'Se agota', 'Rotación'],
              filas.map((f) => [f.sku, f.nombre, vendidas(f), f.udDia7, ritmoReferencia?.get(f.sku) ?? null, f.udDiaRemesa, f.quedan, f.cobertura, f.seAgotaEl, f.clase])
            )
          }
        >
          CSV
        </Boton>
      </div>
      <TablaAdaptable
        etiqueta="Rotación por producto"
        columnas={columnas}
        filas={filas}
        claveDe={(f) => f.sku}
        ordenInicial={{ id: 'rotacion', sentido: 'asc' }}
        porPagina={50}
        vacio={{ icono: Activity, titulo: 'Este envío no tiene referencias' }}
      />
      <p className="px-1 text-[12px] leading-[1.5] text-[var(--ls-t4)]">
        Los días de stock salen de lo que queda de este envío entre lo que salió por día en la última semana. Rápida: menos de 14 días. Media: hasta 45.
        Lenta: más. Sin ventas: nada en 30 días.{refTotal !== null && ` Las referencias de este envío venden ${textoRitmo(refTotal)} en total.`}
      </p>
    </div>
  )
}

function Dato({ rotulo, valor, unidad, sub, pista }: { rotulo: string; valor: string; unidad?: string; sub?: string; pista?: string }) {
  return (
    <div className={cx('min-w-0 bg-[var(--ls-sup)] px-4 py-3')} title={pista}>
      <div className="truncate text-[11.5px] font-medium text-[var(--ls-t3)]">{rotulo}</div>
      <div className="mt-[3px] flex items-baseline gap-[4px] whitespace-nowrap">
        <span className="text-[20px] font-semibold leading-[1.1] tracking-[-0.02em] text-[var(--ls-t1)] tabular-nums">{valor}</span>
        {unidad && <span className="truncate text-[12px] text-[var(--ls-t3)]">{unidad}</span>}
      </div>
      {sub && <div className="mt-[2px] truncate text-[11.5px] text-[var(--ls-t4)]">{sub}</div>}
    </div>
  )
}
