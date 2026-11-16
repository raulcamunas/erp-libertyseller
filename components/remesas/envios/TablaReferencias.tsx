'use client'

import { useMemo, useState } from 'react'
import { Download, Search, Table2 } from 'lucide-react'
import { Boton, TablaAdaptable, TACTIL, type Columna } from '@/components/ui-ls'
import { COLOR_ESTADO } from '@/lib/estilo/denso'
import type { FilaProducto } from '@/lib/fba/analisis'
import type { LineaDePanel } from '@/lib/fba/datos'
import { descargarCsv } from '../comun/graficos'
import { cx } from '../comun/ui'
import { decimal, entero, fecha } from '../formato'
import { ChipRotacion } from './ChipRotacion'
import { ventasPorSku } from './reglas'

/**
 * REFERENCIAS: TODAS LAS LÍNEAS DEL ENVÍO CON TODAS SUS COLUMNAS.
 *
 * Es la tabla de siempre, la que sirve para cuadrar con el Excel o con Amazon: enviadas, recibidas, VENDIDAS (solo
 * ventas), retiradas y mermas (aparte), devueltas y lo que queda de cada referencia; con conexión, el ritmo de este envío
 * y el de la referencia (planificador) al lado. El resto de pestañas la miran desde un ángulo; esta es el dato crudo.
 * Se ordena pulsando la cabecera (TablaAdaptable); en el móvil cada referencia es una tarjeta.
 *
 * Exporta también dos piezas que usan Almacén y Rotación: <Buscador> y <CeldaProducto>.
 */

export function TablaReferencias({
  filas,
  lineas = [],
  conectado,
  nombreArchivo,
  ritmoReferencia = null,
}: {
  filas: FilaProducto[]
  lineas?: LineaDePanel[]
  conectado: boolean
  nombreArchivo: string
  ritmoReferencia?: Map<string, number> | null
}) {
  const [busca, setBusca] = useState('')
  const ventas = useMemo(() => ventasPorSku(lineas), [lineas])
  const vendidas = (f: FilaProducto) => ventas.get(f.sku)?.ventas ?? f.vendidas
  const retiradas = (f: FilaProducto) => ventas.get(f.sku)?.retiradasYMermas ?? 0

  const visibles = useMemo(() => {
    const t = busca.trim().toLowerCase()
    return filas.filter((f) => !t || f.sku.toLowerCase().includes(t) || (f.nombre ?? '').toLowerCase().includes(t) || (f.asin ?? '').toLowerCase().includes(t))
  }, [filas, busca])

  // Primero lo que se agota antes; los agotados y los que no se venden, al final
  const urgencia = (f: FilaProducto) => (f.clase === 'sin_stock' ? 1e9 : (f.cobertura ?? 1e8))

  const columnas: Columna<FilaProducto>[] = [
    { id: 'producto', cabecera: 'Producto', celda: (f) => <CeldaProducto f={f} />, ordenar: (f) => f.sku, movil: 'titulo', ancho: '28%' },
    { id: 'rotacion', cabecera: 'Rotación', celda: (f) => <ChipRotacion clase={f.clase} />, ordenar: urgencia, movil: 'insignia' },
    { id: 'asin', cabecera: 'ASIN', celda: (f) => <span className="font-mono text-[12px] text-[var(--ls-t4)]">{f.asin ?? '—'}</span>, movil: 'oculto' },
    { id: 'enviadas', cabecera: 'Env.', rotuloMovil: 'Enviadas', celda: (f) => <span className="text-[var(--ls-t3)]">{entero(f.enviadas)}</span>, ordenar: (f) => f.enviadas, alinear: 'derecha' },
    {
      id: 'recibidas',
      cabecera: 'Recib.',
      rotuloMovil: 'Recibidas',
      celda: (f) => {
        const faltan = f.recibidas !== null && f.recibidas < f.enviadas
        return (
          <span
            className={faltan ? 'font-semibold' : undefined}
            style={faltan ? { color: COLOR_ESTADO.ambar } : undefined}
            title={f.recibidas === null ? 'Todavía sin preguntar a Amazon' : faltan ? `Faltan ${f.enviadas - (f.recibidas ?? 0)} unidades por registrar` : undefined}
          >
            {f.recibidas === null ? '—' : entero(f.recibidas)}
          </span>
        )
      },
      ordenar: (f) => f.recibidas ?? -1,
      alinear: 'derecha',
    },
    { id: 'vendidas', cabecera: 'Vend.', rotuloMovil: 'Vendidas', celda: (f) => entero(vendidas(f)), ordenar: vendidas, alinear: 'derecha' },
    {
      id: 'retiradas',
      cabecera: 'Retir./merm.',
      rotuloMovil: 'Retiradas y mermas',
      celda: (f) => (retiradas(f) > 0 ? <span className="text-[var(--ls-e-magenta)]">{entero(retiradas(f))}</span> : <span className="text-[var(--ls-t4)]">—</span>),
      ordenar: retiradas,
      alinear: 'derecha',
    },
    {
      id: 'devueltas',
      cabecera: 'Dev.',
      rotuloMovil: 'Devueltas',
      celda: (f) => (f.devueltas > 0 ? <span className="text-[var(--ls-e-ambar)]">{entero(f.devueltas)}</span> : <span className="text-[var(--ls-t4)]">—</span>),
      ordenar: (f) => f.devueltas,
      alinear: 'derecha',
    },
    { id: 'quedan', cabecera: 'Quedan', celda: (f) => <b className="font-semibold text-[var(--ls-t1)]">{entero(f.quedan)}</b>, ordenar: (f) => f.quedan, alinear: 'derecha' },
    ...(conectado
      ? [
          {
            id: 'ritmo',
            cabecera: 'Ritmo envío',
            rotuloMovil: 'Ritmo de este envío',
            celda: (f: FilaProducto) => (
              <span title="Lo que ha salido de este envío por día en la última semana">{f.udDia7 > 0 ? decimal(f.udDia7, 2) : '—'}</span>
            ),
            ordenar: (f: FilaProducto) => f.udDia7,
            alinear: 'derecha' as const,
          },
          ...(ritmoReferencia
            ? [
                {
                  id: 'ritmoRef',
                  cabecera: 'Ritmo ref.',
                  rotuloMovil: 'Ritmo de la referencia',
                  celda: (f: FilaProducto) => {
                    const r = ritmoReferencia.get(f.sku)
                    return (
                      <span className="text-[var(--ls-t3)]" title="El ritmo de la referencia (planificador): lo que vende ese SKU por día, de todos sus envíos">
                        {r ? decimal(r, 2) : '—'}
                      </span>
                    )
                  },
                  ordenar: (f: FilaProducto) => ritmoReferencia.get(f.sku) ?? 0,
                  alinear: 'derecha' as const,
                },
              ]
            : []),
          {
            id: 'cobertura',
            cabecera: 'Stock para',
            celda: (f: FilaProducto) => (f.cobertura === null ? '—' : `${entero(f.cobertura)} d`),
            ordenar: urgencia,
            alinear: 'derecha' as const,
          },
        ]
      : []),
    { id: 'agotada', cabecera: 'Agotada', celda: (f) => <span className="text-[var(--ls-t4)]">{fecha(f.agotadaEl)}</span>, ordenar: (f) => f.agotadaEl ?? '', movil: 'oculto' },
  ]

  return (
    <div className="space-y-3">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Buscador valor={busca} onCambio={setBusca} placeholder="SKU, ASIN o nombre" />
        <Boton
          tamano="sm"
          icono={Download}
          className="sm:ml-auto"
          disabled={visibles.length === 0}
          onClick={() =>
            descargarCsv(
              `referencias-${nombreArchivo}.csv`,
              ['SKU', 'Producto', 'Variante', 'ASIN', 'Enviadas', 'Recibidas', 'Vendidas', 'Retiradas y mermas', 'Devueltas', 'Quedan', 'Ud/día 7 d (este envío)', 'Ud/día de la referencia', 'Días de stock', 'Se agota'],
              visibles.map((f) => [f.sku, f.nombre, f.variante, f.asin, f.enviadas, f.recibidas, vendidas(f), retiradas(f), f.devueltas, f.quedan, f.udDia7, ritmoReferencia?.get(f.sku) ?? null, f.cobertura, f.seAgotaEl])
            )
          }
        >
          CSV
        </Boton>
      </div>

      <TablaAdaptable
        etiqueta="Referencias del envío"
        columnas={columnas}
        filas={visibles}
        claveDe={(f) => f.sku}
        ordenInicial={{ id: 'rotacion', sentido: 'asc' }}
        porPagina={50}
        vacio={{ icono: Table2, titulo: 'Nada que coincida con la búsqueda', descripcion: 'Prueba con otro SKU, ASIN o nombre.' }}
      />
      {conectado && ritmoReferencia && (
        <p className="px-1 text-[12px] leading-[1.5] text-[var(--ls-t4)]">
          «Ritmo envío» es lo que sale de este envío (FIFO: primero se vende lo que llegó antes); «Ritmo ref.» es lo que vende la referencia en total, en ud/día, según el planificador (o la media de 30 días si no hay plan).
        </p>
      )}
    </div>
  )
}

/** La celda del producto: SKU en mono, nombre y variante. En el móvil, título de la tarjeta */
export function CeldaProducto({ f }: { f: Pick<FilaProducto, 'sku' | 'nombre' | 'variante'> }) {
  return (
    <span className="flex min-w-0 flex-col lg:flex-row lg:items-baseline lg:gap-2">
      <span className="shrink-0 whitespace-nowrap font-mono text-[12px] text-[var(--ls-t3)]">{f.sku}</span>
      <span className="min-w-0 truncate font-normal text-[var(--ls-t1)]" title={f.nombre ?? ''}>
        {f.nombre ?? '—'}
        {f.variante && <span className="ml-2 text-[var(--ls-t4)]">{f.variante}</span>}
      </span>
    </span>
  )
}

export function Buscador({ valor, onCambio, placeholder, className }: { valor: string; onCambio: (v: string) => void; placeholder: string; className?: string }) {
  return (
    <label className={cx('relative block w-full sm:w-[230px]', className)}>
      <span className="sr-only">Buscar</span>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-[14px] w-[14px] -translate-y-1/2 text-[var(--ls-t4)]" aria-hidden />
      <input
        value={valor}
        onChange={(e) => onCambio(e.target.value)}
        placeholder={placeholder}
        className={cx(
          'h-8 w-full rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] pl-9 pr-3 text-[13px] text-[var(--ls-t1)] outline-none placeholder:text-[var(--ls-t4)] hover:border-[var(--ls-linea2)] focus:border-[var(--ls-acc-graf)]',
          TACTIL
        )}
      />
    </label>
  )
}
