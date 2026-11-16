'use client'

import { useMemo } from 'react'
import { Download, PackageSearch } from 'lucide-react'
import { Chispa, TablaAdaptable, type Columna } from '@/components/ui-ls'
import { BOTON } from '@/lib/estilo/denso'
import { descargarCsv, VIZ } from '../comun/graficos'
import { cx, Tarjeta } from '../comun/ui'
import { decimal, dinero, entero, ritmo } from '../formato'
import { concentracion, csvTop, nombreCsv, textoPeriodo, type RespuestaVentas } from './useVentas'

/**
 * LAS 20 REFERENCIAS QUE MÁS VENDEN EN EL PERIODO (spec remesas-pro §6.3).
 *
 * `TablaAdaptable`: tabla en el escritorio y tarjetas en el móvil. Por referencia: puesto, unidades, € a precio actual,
 * velocidad (ud/día, media del periodo), su parte de las unidades con una barra y la `Chispa` de los últimos 30 días.
 * Arriba, cuánto se concentra la venta en las 3 primeras (dice si el cliente depende de pocas referencias). CSV.
 *
 *   <TopReferencias ventas clienteNombre />
 */

type Fila = RespuestaVentas['top'][number] & { puesto: number; pct: number }

export function TopReferencias({ ventas, clienteNombre }: { ventas: RespuestaVentas; clienteNombre: string }) {
  const total = ventas.totales.unidades
  const moneda = ventas.moneda
  const filas: Fila[] = useMemo(
    () => ventas.top.map((t, i) => ({ ...t, puesto: i + 1, pct: total > 0 ? (t.unidades / total) * 100 : 0 })),
    [ventas.top, total]
  )
  const conc = concentracion(ventas, 3)
  const maxPct = filas.reduce((m, f) => Math.max(m, f.pct), 0) || 1

  const columnas: Columna<Fila>[] = [
    {
      id: 'producto',
      cabecera: 'Referencia',
      movil: 'titulo',
      ordenar: (f) => f.puesto,
      celda: (f) => (
        <span className="flex min-w-0 items-start gap-2">
          <span className="mt-[1px] inline-flex h-5 min-w-[20px] shrink-0 items-center justify-center rounded-[6px] bg-[var(--ls-sup3)] px-1 text-[11px] font-semibold tabular-nums text-[var(--ls-t3)]">
            {f.puesto}
          </span>
          {/* El ancho máximo va en el contenido: en una tabla automática el de la celda no limita y el nombre empujaba las columnas fuera */}
          <span className="min-w-0 lg:max-w-[34ch]">
            <span className="block truncate text-[13px] font-medium text-[var(--ls-t1)]" title={f.nombre ?? f.sku}>
              {f.nombre ?? f.sku}
            </span>
            {f.nombre && <span className="block truncate font-mono text-[11px] text-[var(--ls-t4)]">{f.sku}</span>}
          </span>
        </span>
      ),
      className: 'max-w-[320px]',
    },
    {
      id: 'unidades',
      cabecera: 'Unidades',
      alinear: 'derecha',
      ordenar: (f) => f.unidades,
      celda: (f) => <span className="font-semibold tabular-nums text-[var(--ls-t1)]">{entero(f.unidades)}</span>,
    },
    {
      id: 'euros',
      cabecera: `Ventas (${moneda})`,
      rotuloMovil: 'Ventas',
      alinear: 'derecha',
      ordenar: (f) => f.euros ?? -1,
      celda: (f) => <span className="tabular-nums text-[var(--ls-t2)]">{f.euros === null ? <span title="Sin precio en Amazon">—</span> : dinero(f.euros, moneda)}</span>,
    },
    {
      id: 'velocidad',
      cabecera: 'Velocidad',
      alinear: 'derecha',
      ordenar: (f) => f.udDia,
      celda: (f) => (
        <span className="tabular-nums text-[var(--ls-t2)]" title={`Media del periodo (${textoPeriodo(ventas.dias)}), con y sin stock`}>
          {ritmo(f.udDia)}
        </span>
      ),
    },
    {
      id: 'cuota',
      cabecera: '% de las ud',
      rotuloMovil: '% de las unidades',
      alinear: 'derecha',
      ordenar: (f) => f.pct,
      ancho: '120px',
      celda: (f) => (
        <span className="flex items-center justify-end gap-2">
          <span aria-hidden className="hidden h-[6px] w-[48px] overflow-hidden rounded-full bg-[var(--ls-sup3)] sm:block">
            <span className="block h-full rounded-full" style={{ width: `${Math.max(4, (f.pct / maxPct) * 100)}%`, background: VIZ.vendidas }} />
          </span>
          <span className="tabular-nums text-[var(--ls-t2)]">{decimal(f.pct, 1)} %</span>
        </span>
      ),
    },
    {
      id: 'chispa',
      cabecera: 'Últimos 30 días',
      rotuloMovil: 'Últimos 30 días',
      ancho: '112px',
      celda: (f) => (
        <span className="block w-[96px]" title={`${entero(f.serie30.reduce((s, x) => s + x, 0))} ud en los últimos 30 días`}>
          <Chispa valores={f.serie30} color={VIZ.vendidas} alto={28} />
        </span>
      ),
    },
  ]

  const bajar = () => {
    const { cabecera, filas: f } = csvTop(ventas)
    descargarCsv(nombreCsv(clienteNombre, ventas, 'top'), cabecera, f)
  }

  const ayuda =
    filas.length === 0
      ? `Nada vendido en los ${textoPeriodo(ventas.dias)}`
      : conc !== null && filas.length > 3
        ? `Las 3 primeras son el ${decimal(conc, 1)} % de las unidades${conc >= 60 ? ': la venta depende de pocas referencias' : ''}`
        : `Velocidad = ud/día de media en los ${textoPeriodo(ventas.dias)}`

  return (
    <Tarjeta
      titulo={filas.length >= 20 ? 'Las 20 referencias que más venden' : 'Referencias que más venden'}
      ayuda={ayuda}
      derecha={
        filas.length > 0 ? (
          <button type="button" onClick={bajar} className={cx(BOTON.base, BOTON.secundario)} title="Descargar las referencias en CSV">
            <Download className="h-3 w-3" />
            CSV
          </button>
        ) : undefined
      }
    >
      <TablaAdaptable
        columnas={columnas}
        filas={filas}
        claveDe={(f) => f.sku}
        porPagina={0}
        etiqueta="Referencias que más venden"
        vacio={{ icono: PackageSearch, titulo: 'Sin ventas en este periodo', descripcion: 'Prueba con un periodo más largo' }}
      />
    </Tarjeta>
  )
}
