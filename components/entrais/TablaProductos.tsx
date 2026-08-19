'use client'

import { useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Copy, Download, Loader2, Search } from 'lucide-react'
import type { ProductoEntrais } from '@/lib/entrais/api'

/**
 * LOS PRODUCTOS DEL PROVEEDOR EN TABLA.
 *
 * Cinco columnas y nada más: SKU, descripción, EAN, precio y stock. Son las que
 * hacen falta para mandar stock y precio a Amazon; el resto de lo que devuelve
 * su API sigue estando en la pestaña de JSON para cuando haga falta mirarlo.
 *
 *
 * ============ POR QUÉ ESTO NO ES UN <table> NORMAL ============
 *
 * Son 6.916 filas. Pintarlas todas son ~35.000 nodos en el DOM y deja el
 * navegador pensando un par de segundos cada vez que escribes una letra en el
 * buscador. Así que solo se pintan las que caben en pantalla más un margen, y el
 * hueco de las demás lo ocupa un div de la altura que les tocaría.
 *
 * Eso obliga a que todas las filas midan LO MISMO (`ALTO_FILA`): la posición de
 * cada una se calcula multiplicando, no midiendo. Por eso la descripción se
 * corta con `truncate` en vez de dar de sí — si una fila creciera, todas las de
 * abajo quedarían desplazadas.
 *
 *
 * ============ LO QUE SE MARCA EN ROJO Y POR QUÉ ============
 *
 * Stock negativo, precio a cero y EAN vacío no son rarezas: son 1, 1 y 593 filas
 * del catálogo. Los tres rompen algo distinto río abajo —un stock por debajo de
 * cero mandado a Amazon, un producto regalado, una oferta que no se puede
 * emparejar con ningún ASIN— y los tres pasan desapercibidos en una tabla de
 * miles de líneas si no se pintan distinto.
 */

const ALTO_FILA = 30
/** Filas de más que se pintan arriba y abajo, para que al arrastrar no parpadee */
const MARGEN = 12
const ALTO_CAJA = 560

/** Las columnas, en el mismo orden en la cabecera y en las filas */
const REJILLA = '96px minmax(280px,1fr) 132px 96px 76px'

type Columna = 'code' | 'description' | 'ean' | 'price' | 'stock'

const CABECERAS: { id: Columna; texto: string; pista: string; derecha?: boolean }[] = [
  { id: 'code', texto: 'SKU', pista: 'El código del proveedor. Es el mismo SKU que tiene el listing en Amazon' },
  { id: 'description', texto: 'Descripción', pista: 'Cómo lo llama el proveedor, que no es cómo se llama en Amazon' },
  { id: 'ean', texto: 'EAN', pista: 'Lo que empareja el producto con un ASIN. Vacío en un 8% del catálogo' },
  { id: 'price', texto: 'Precio', pista: 'El coste, SIN IVA. El canon digital va aparte', derecha: true },
  { id: 'stock', texto: 'Stock', pista: 'Unidades en el proveedor. Puede venir negativo', derecha: true },
]

function euros(v: number): string {
  return v.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function TablaProductos({
  productos,
  entorno,
}: {
  productos: ProductoEntrais[]
  /** Solo para el nombre del fichero: que no se confunda un volcado de pruebas con uno real */
  entorno: 'pruebas' | 'real'
}) {
  const [busca, setBusca] = useState('')
  const [orden, setOrden] = useState<{ por: Columna; asc: boolean } | null>(null)
  const [desde, setDesde] = useState(0)
  const [descargando, setDescargando] = useState(false)
  const caja = useRef<HTMLDivElement>(null)

  const filas = useMemo(() => {
    const q = busca.trim().toLowerCase()
    let out = productos
    if (q) {
      out = out.filter(
        (p) =>
          String(p.code).includes(q) ||
          p.description.toLowerCase().includes(q) ||
          (p.ean ?? '').toLowerCase().includes(q)
      )
    }
    if (orden) {
      const signo = orden.asc ? 1 : -1
      // Copia: `productos` es la respuesta de la llamada y ordenarla en el sitio
      // cambiaría también lo que se ve en la pestaña de JSON.
      out = [...out].sort((a, b) => {
        const x = a[orden.por]
        const y = b[orden.por]
        if (typeof x === 'number' && typeof y === 'number') return (x - y) * signo
        return String(x ?? '').localeCompare(String(y ?? ''), 'es') * signo
      })
    }
    return out
  }, [productos, busca, orden])

  const resumen = useMemo(() => {
    let conStock = 0
    let sinEan = 0
    let negativos = 0
    let valor = 0
    for (const p of filas) {
      if (p.stock > 0) conStock++
      else if (p.stock < 0) negativos++
      if (!p.ean) sinEan++
      if (p.stock > 0) valor += p.stock * p.price
    }
    return { conStock, sinEan, negativos, valor }
  }, [filas])

  const cuantasCaben = Math.ceil(ALTO_CAJA / ALTO_FILA)
  const inicio = Math.max(0, desde - MARGEN)
  const visibles = filas.slice(inicio, desde + cuantasCaben + MARGEN)

  function ordenarPor(id: Columna) {
    setOrden((o) => (o?.por === id ? { por: id, asc: !o.asc } : { por: id, asc: true }))
    caja.current?.scrollTo({ top: 0 })
    setDesde(0)
  }

  /**
   * UN .XLSX DE VERDAD, NO UN CSV RENOMBRADO.
   *
   * Con CSV hay que acertar con el separador y con la codificación, y en cuanto
   * el fichero cruza un ordenador con otra configuración regional los precios
   * aparecen como texto o partidos en dos columnas. Aquí los números viajan
   * COMO NÚMEROS: se pueden sumar y ordenar nada más abrirlo.
   *
   * La librería se carga al pulsar y no al abrir la pantalla: son cerca de
   * ochocientos kilobytes que no tiene por qué descargarse quien solo viene a
   * mirar el JSON.
   *
   * Y se exporta LO QUE SE ESTÁ VIENDO —con el filtro y el orden puestos—,
   * porque es lo que se espera de un botón que está debajo de una tabla
   * filtrada. Si se exportara siempre el catálogo entero, buscar «TOOQ» y
   * descargar daría 6.919 filas sin decir por qué.
   */
  async function descargar() {
    if (descargando || filas.length === 0) return
    setDescargando(true)
    try {
      const XLSX = await import('xlsx')
      const hoja = XLSX.utils.json_to_sheet(
        filas.map((p) => ({
          SKU: p.code,
          DESCRIPCION: p.description,
          EAN: p.ean ?? '',
          PRECIO: p.price,
          CANON: p.digitalCanon ?? 0,
          STOCK: p.stock,
        }))
      )
      hoja['!cols'] = [
        { wch: 10 },
        { wch: 52 },
        { wch: 16 },
        { wch: 10 },
        { wch: 9 },
        { wch: 8 },
      ]
      const libro = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(libro, hoja, 'Productos')
      const sello = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '')
      XLSX.writeFile(libro, `entrais-${entorno}-${sello}.xlsx`)
      toast.success(`${filas.length.toLocaleString('es-ES')} filas descargadas`)
    } catch (error) {
      console.error('Error generando el Excel de Entrais:', error)
      toast.error('No se ha podido generar el Excel')
    } finally {
      setDescargando(false)
    }
  }

  /** Lo que hay en pantalla, tal cual, para pegarlo en una hoja de cálculo */
  function copiar() {
    const tsv = [
      ['SKU', 'DESCRIPCION', 'EAN', 'PRECIO', 'STOCK'].join('\t'),
      ...filas.map((p) =>
        [p.code, p.description, p.ean ?? '', String(p.price).replace('.', ','), p.stock].join('\t')
      ),
    ].join('\n')
    navigator.clipboard.writeText(tsv)
    toast.success(`${filas.length.toLocaleString('es-ES')} filas copiadas`)
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-white/30" />
          <input
            value={busca}
            onChange={(e) => {
              setBusca(e.target.value)
              caja.current?.scrollTo({ top: 0 })
              setDesde(0)
            }}
            placeholder="Buscar por SKU, descripción o EAN"
            className="w-full h-7 rounded-lg border border-white/10 bg-white/[0.03] pl-7 pr-2 text-[11px] text-white outline-none focus:border-[#FF6600]"
          />
        </div>
        <button
          type="button"
          onClick={() => void descargar()}
          disabled={descargando || filas.length === 0}
          className="h-7 px-2.5 rounded-lg bg-[#FF6600] text-white text-[11px] font-medium flex items-center gap-1.5 disabled:opacity-50 transition-colors"
          title="Descarga lo que se está viendo, con el filtro y el orden puestos"
        >
          {descargando ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Download className="h-3 w-3" />
          )}
          Descargar Excel
        </button>
        <button
          type="button"
          onClick={copiar}
          className="h-7 px-2.5 rounded-lg border border-white/10 text-[11px] text-white/60 hover:text-white hover:border-white/25 flex items-center gap-1.5 transition-colors"
          title="Copia lo que se ve, con tabuladores: se pega directo en Excel"
        >
          <Copy className="h-3 w-3" />
          Copiar para Excel
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10.5px] text-white/40">
        <span className="text-white/70">{filas.length.toLocaleString('es-ES')} productos</span>
        {filas.length !== productos.length && (
          <span>de {productos.length.toLocaleString('es-ES')}</span>
        )}
        <span>·</span>
        <span>{resumen.conStock.toLocaleString('es-ES')} con stock</span>
        {resumen.negativos > 0 && (
          <span className="text-red-300/80">{resumen.negativos} en negativo</span>
        )}
        {resumen.sinEan > 0 && (
          <span className="text-amber-300/70">{resumen.sinEan.toLocaleString('es-ES')} sin EAN</span>
        )}
        <span>·</span>
        <span title="Suma de stock × precio de los que tienen stock. Sin IVA">
          {euros(resumen.valor)} € en almacén
        </span>
      </div>

      <div className="rounded-lg border border-white/10 overflow-hidden">
        <div
          className="grid bg-white/[0.03] border-b border-white/10"
          style={{ gridTemplateColumns: REJILLA }}
        >
          {CABECERAS.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => ordenarPor(c.id)}
              title={c.pista}
              className={`px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider transition-colors hover:text-white ${
                orden?.por === c.id ? 'text-[#FF6600]' : 'text-white/40'
              } ${c.derecha ? 'text-right' : 'text-left'}`}
            >
              {c.texto}
              {orden?.por === c.id && <span className="ml-1">{orden.asc ? '↑' : '↓'}</span>}
            </button>
          ))}
        </div>

        <div
          ref={caja}
          onScroll={(e) => setDesde(Math.floor(e.currentTarget.scrollTop / ALTO_FILA))}
          className="overflow-y-auto"
          style={{ height: ALTO_CAJA }}
        >
          {filas.length === 0 ? (
            <p className="p-4 text-[11px] text-white/35">Ningún producto encaja con «{busca}».</p>
          ) : (
            <div style={{ height: filas.length * ALTO_FILA, position: 'relative' }}>
              {visibles.map((p, i) => {
                const fila = inicio + i
                return (
                  <div
                    key={p.code}
                    className="grid items-center absolute left-0 right-0 border-b border-white/[0.04] hover:bg-white/[0.03]"
                    style={{
                      gridTemplateColumns: REJILLA,
                      top: fila * ALTO_FILA,
                      height: ALTO_FILA,
                    }}
                  >
                    <span className="px-2 text-[11px] font-mono text-white/80">{p.code}</span>
                    <span className="px-2 text-[11px] text-white/70 truncate" title={p.description}>
                      {p.description}
                      {p.digital && (
                        <span
                          className="ml-1.5 text-[9px] text-sky-300/70 uppercase"
                          title="Licencia o descarga: no tiene stock físico"
                        >
                          digital
                        </span>
                      )}
                    </span>
                    <span
                      className={`px-2 text-[11px] font-mono ${
                        p.ean ? 'text-white/55' : 'text-amber-300/60'
                      }`}
                    >
                      {p.ean || 'sin EAN'}
                    </span>
                    <span
                      className={`px-2 text-[11px] text-right tabular-nums ${
                        p.price > 0 ? 'text-white/80' : 'text-red-300'
                      }`}
                      title={p.digitalCanon > 0 ? `+ ${euros(p.digitalCanon)} € de canon` : undefined}
                    >
                      {euros(p.price)}
                      {p.digitalCanon > 0 && <span className="text-white/30"> +c</span>}
                    </span>
                    <span
                      className={`px-2 text-[11px] text-right tabular-nums ${
                        p.stock < 0
                          ? 'text-red-300'
                          : p.stock === 0
                            ? 'text-white/25'
                            : 'text-green-300/80'
                      }`}
                    >
                      {p.stock}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
