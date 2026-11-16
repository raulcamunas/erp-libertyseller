'use client'

import { useMemo, useState } from 'react'
import { Boxes, Download } from 'lucide-react'
import { Boton, Segmentado, TablaAdaptable, type Columna } from '@/components/ui-ls'
import type { FilaProducto } from '@/lib/fba/analisis'
import type { LineaDePanel } from '@/lib/fba/datos'
import { descargarCsv } from '../comun/graficos'
import { entero } from '../formato'
import { ChipRotacion } from './ChipRotacion'
import { ventasPorSku } from './reglas'
import { Buscador, CeldaProducto } from './TablaReferencias'

/**
 * ALMACÉN: LO QUE HAY AHORA DE ESTE ENVÍO, PRODUCTO A PRODUCTO.
 *
 * «Quedan» es lo recibido menos lo que ha salido de ESTE envío. «En Amazon» es el stock real de ese SKU sumando todos sus
 * envíos, y la diferencia es el descuadre: si no coincide, el número bueno es el de Amazon. «Vendidas» son solo ventas;
 * lo retirado o perdido va en su columna. Tabla en el ordenador y tarjetas en el móvil (TablaAdaptable).
 */

type Filtro = 'con_stock' | 'agotadas' | 'descuadre' | 'todas'

export function TabAlmacen({ filas, lineas = [], nombreArchivo }: { filas: FilaProducto[]; lineas?: LineaDePanel[]; nombreArchivo: string }) {
  const [filtro, setFiltro] = useState<Filtro>('con_stock')
  const [busca, setBusca] = useState('')
  const ventas = useMemo(() => ventasPorSku(lineas), [lineas])
  const conRetiradas = [...ventas.values()].some((v) => v.retiradasYMermas > 0)

  const cuenta = useMemo(
    () => ({
      con_stock: filas.filter((f) => f.quedan > 0).length,
      agotadas: filas.filter((f) => f.quedan === 0).length,
      descuadre: filas.filter((f) => f.descuadre !== null && f.descuadre !== 0).length,
      todas: filas.length,
    }),
    [filas]
  )

  const visibles = useMemo(() => {
    const t = busca.trim().toLowerCase()
    return filas
      .filter((f) => (filtro === 'con_stock' ? f.quedan > 0 : filtro === 'agotadas' ? f.quedan === 0 : filtro === 'descuadre' ? f.descuadre !== null && f.descuadre !== 0 : true))
      .filter((f) => !t || f.sku.toLowerCase().includes(t) || (f.nombre ?? '').toLowerCase().includes(t))
  }, [filas, filtro, busca])

  const maxQuedan = Math.max(1, ...filas.map((f) => f.quedan))
  const vendidas = (f: FilaProducto) => ventas.get(f.sku)?.ventas ?? f.vendidas

  const columnas: Columna<FilaProducto>[] = [
    { id: 'producto', cabecera: 'Producto', celda: (f) => <CeldaProducto f={f} />, ordenar: (f) => f.sku, movil: 'titulo', ancho: '34%' },
    { id: 'rotacion', cabecera: 'Rotación', celda: (f) => <ChipRotacion clase={f.clase} />, movil: 'insignia' },
    { id: 'recibidas', cabecera: 'Recibidas', celda: (f) => entero(f.recibidas ?? f.enviadas), ordenar: (f) => f.recibidas ?? f.enviadas, alinear: 'derecha' },
    { id: 'vendidas', cabecera: 'Vendidas', celda: (f) => entero(vendidas(f)), ordenar: vendidas, alinear: 'derecha' },
    ...(conRetiradas
      ? [
          {
            id: 'retiradas',
            cabecera: 'Retir. y mermas',
            rotuloMovil: 'Retiradas y mermas',
            celda: (f: FilaProducto) => {
              const n = ventas.get(f.sku)?.retiradasYMermas ?? 0
              return n > 0 ? <span className="text-[var(--ls-e-magenta)]">{entero(n)}</span> : <span className="text-[var(--ls-t4)]">—</span>
            },
            ordenar: (f: FilaProducto) => ventas.get(f.sku)?.retiradasYMermas ?? 0,
            alinear: 'derecha' as const,
          },
        ]
      : []),
    {
      id: 'quedan',
      cabecera: 'Quedan',
      celda: (f) => (
        <span className="inline-flex items-center justify-end gap-2">
          <span className="hidden h-[6px] w-[56px] overflow-hidden rounded-full bg-[var(--ls-sup3)] lg:inline-block" aria-hidden>
            <span className="block h-full rounded-full" style={{ width: `${(f.quedan / maxQuedan) * 100}%`, background: 'var(--viz-2)' }} />
          </span>
          <b className="font-semibold text-[var(--ls-t1)]">{entero(f.quedan)}</b>
        </span>
      ),
      ordenar: (f) => f.quedan,
      alinear: 'derecha',
    },
    {
      id: 'amazon',
      cabecera: 'En Amazon',
      celda: (f) => (f.stockReal === null ? '—' : entero(f.stockReal)),
      ordenar: (f) => f.stockReal ?? -1,
      alinear: 'derecha',
    },
    {
      id: 'descuadre',
      cabecera: 'Descuadre',
      celda: (f) =>
        f.descuadre === null ? (
          <span className="text-[var(--ls-t4)]">—</span>
        ) : (
          <span className={f.descuadre ? 'font-semibold text-[var(--ls-e-ambar)]' : 'text-[var(--ls-t4)]'} title="Stock real de Amazon menos lo que explican los envíos. Positivo: hay más de lo que los envíos explican">
            {f.descuadre > 0 ? `+${entero(f.descuadre)}` : entero(f.descuadre)}
          </span>
        ),
      ordenar: (f) => Math.abs(f.descuadre ?? 0),
      alinear: 'derecha',
    },
  ]

  return (
    <div className="space-y-3">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Segmentado
          etiqueta="Qué referencias"
          tamano="sm"
          valor={filtro}
          onCambio={setFiltro}
          opciones={[
            { id: 'con_stock', texto: 'Con stock', cuenta: cuenta.con_stock },
            { id: 'agotadas', texto: 'Agotadas', cuenta: cuenta.agotadas },
            { id: 'descuadre', texto: 'Con descuadre', cuenta: cuenta.descuadre },
            { id: 'todas', texto: 'Todas', cuenta: cuenta.todas },
          ]}
        />
        <Buscador valor={busca} onCambio={setBusca} placeholder="SKU o nombre" className="sm:ml-auto" />
        <Boton
          tamano="sm"
          icono={Download}
          disabled={visibles.length === 0}
          onClick={() =>
            descargarCsv(
              `almacen-${nombreArchivo}.csv`,
              ['SKU', 'Producto', 'Variante', 'Recibidas', 'Vendidas', 'Retiradas y mermas', 'Quedan', 'En Amazon', 'Descuadre'],
              visibles.map((f) => [f.sku, f.nombre, f.variante, f.recibidas ?? f.enviadas, vendidas(f), ventas.get(f.sku)?.retiradasYMermas ?? 0, f.quedan, f.stockReal, f.descuadre])
            )
          }
        >
          CSV
        </Boton>
      </div>

      <TablaAdaptable
        etiqueta="Lo que queda de cada referencia"
        columnas={columnas}
        filas={visibles}
        claveDe={(f) => f.sku}
        ordenInicial={{ id: 'quedan', sentido: 'desc' }}
        vacio={{ icono: Boxes, titulo: 'Nada que enseñar con este filtro', descripcion: 'Prueba con otro filtro o quita la búsqueda.' }}
      />
      <p className="px-1 text-[12px] leading-[1.5] text-[var(--ls-t4)]">
        El stock real de Amazon se refresca una vez al día. El reparto entre envíos del mismo producto es una convención contable: Amazon mezcla los lotes
        físicamente.
      </p>
    </div>
  )
}
