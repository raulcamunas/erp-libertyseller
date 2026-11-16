'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, Loader2, Package, RefreshCw, Search, TriangleAlert, X } from 'lucide-react'
import { toast } from 'sonner'
import { Boton } from '@/components/ui-ls'
import { COLOR_ESTADO } from '@/lib/estilo/denso'
import { cx } from './comun/ui'

/**
 * ELEGIR LOS PRODUCTOS DE FBA DEL CLIENTE.
 *
 * Sustituye a pegar una tabla. Pegar sirve para migrar una hoja de cálculo de golpe —y por eso se deja—, pero
 * para montar un envío del día a día obliga a salir a otro sitio a copiar códigos, que es justo lo que este
 * módulo viene a quitar.
 *
 * Solo salen los de FBA: un producto que gestiona el vendedor no se manda a un almacén de Amazon, y ofrecerlo
 * aquí solo sirve para que alguien lo elija por error y el envío nazca mal.
 *
 *
 * ============ EL BOTÓN DE REFRESCAR (solo administradores, D27) ============
 *
 * Existe para un caso concreto: acabas de crear el producto a mano en Seller Central y todavía no ha entrado por
 * el ciclo de quince minutos. Relee el catálogo contra Amazon en ese momento (gasta cupo de Amazon: por eso es
 * de administrador).
 *
 * Y dice cuántas ha leído de cuántas hay. La API de Amazon no pagina más allá de mil referencias por pasada: con
 * un catálogo de cuarenta mil, una pasada ve el 2 %. Si el producto buscado no cae ahí, el botón parecería no
 * hacer nada —y eso es peor que no tener botón.
 */

export interface ProductoFba {
  sku: string
  titulo: string | null
  asin: string | null
  fnsku: string | null
  stock: number | null
  vendible: number | null
}

export interface Elegido extends ProductoFba {
  unidades: number
  /**
   * Los descriptivos de la hoja de ShoesF: talla, REF y EAN. El catálogo de Amazon no los trae; sí la base de
   * datos de referencias y una remesa ya guardada. Viajan de vuelta al guardar para que corregir una cantidad no
   * los borre.
   */
  variante?: string | null
  referencia?: string | null
  ean?: string | null
}

const CAMPO =
  'h-9 rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] text-[13px] text-[var(--ls-t1)] outline-none placeholder:text-[var(--ls-t4)] ' +
  'hover:border-[var(--ls-linea2)] focus:border-[var(--ls-acc-graf)] focus:shadow-[inset_0_0_0_1px_var(--ls-acc-graf)] [@media(pointer:coarse)]:h-11'

export function SelectorProductos({
  clienteId,
  esAdmin,
  elegidos,
  onCambio,
}: {
  clienteId: string
  /** Solo para «Refrescar» el catálogo contra Amazon */
  esAdmin: boolean
  elegidos: Elegido[]
  onCambio: (e: Elegido[]) => void
}) {
  const [busqueda, setBusqueda] = useState('')
  const [productos, setProductos] = useState<ProductoFba[]>([])
  const [total, setTotal] = useState(0)
  const [hayMas, setHayMas] = useState(false)
  const [conectado, setConectado] = useState(true)
  const [cargando, setCargando] = useState(true)
  const [refrescando, setRefrescando] = useState(false)
  const peticion = useRef(0)

  const buscar = useCallback(
    async (q: string) => {
      const mia = ++peticion.current
      setCargando(true)
      try {
        const res = await fetch(`/api/fba/productos?cliente=${clienteId}${q ? `&q=${encodeURIComponent(q)}` : ''}`)
        // Si mientras tanto se ha lanzado otra búsqueda, esta respuesta ya no vale: sin esto, una búsqueda lenta
        // pisa a otra más reciente.
        if (mia !== peticion.current) return
        const p = (await res.json()) as { productos?: ProductoFba[]; total?: number; hayMas?: boolean; conectado?: boolean; error?: string }
        if (!res.ok) {
          toast.error(p.error ?? 'No se han podido leer los productos')
          return
        }
        setProductos(p.productos ?? [])
        setTotal(p.total ?? 0)
        setHayMas(p.hayMas ?? false)
        setConectado(p.conectado !== false)
      } catch {
        if (mia === peticion.current) toast.error('No se han podido leer los productos: revisa la conexión.')
      } finally {
        if (mia === peticion.current) setCargando(false)
      }
    },
    [clienteId]
  )

  // Se espera a que deje de teclear: una consulta por letra sobre 42.000 referencias es trabajo que nadie llega a leer.
  useEffect(() => {
    const t = setTimeout(() => buscar(busqueda), busqueda ? 280 : 0)
    return () => clearTimeout(t)
  }, [busqueda, buscar])

  async function refrescar() {
    setRefrescando(true)
    try {
      const res = await fetch(`/api/fba/productos?cliente=${clienteId}`, { method: 'POST' })
      const p = (await res.json()) as { referencias?: number; declaradas?: number; truncado?: boolean; error?: string }
      if (!res.ok) {
        toast.error(p.error ?? 'No se ha podido refrescar')
        return
      }
      if (p.truncado) {
        toast.warning(`Leídas ${p.referencias} de ${p.declaradas} referencias`, {
          description: 'Amazon no deja leer más de mil por pasada. Si el producto que buscas no aparece, escribe su SKU en el buscador: se busca sobre todo el catálogo guardado.',
          duration: 9000,
        })
      } else {
        toast.success(`Catálogo releído: ${p.referencias} referencias`)
      }
      await buscar(busqueda)
    } catch {
      toast.error('No se ha podido refrescar: revisa la conexión.')
    } finally {
      setRefrescando(false)
    }
  }

  const porSku = useMemo(() => new Map(elegidos.map((e) => [e.sku, e])), [elegidos])

  function alternar(p: ProductoFba) {
    if (porSku.has(p.sku)) onCambio(elegidos.filter((e) => e.sku !== p.sku))
    else onCambio([...elegidos, { ...p, unidades: 1 }])
  }

  function cambiarUnidades(sku: string, unidades: number) {
    onCambio(elegidos.map((e) => (e.sku === sku ? { ...e, unidades: Math.max(1, unidades) } : e)))
  }

  if (!conectado) {
    return (
      <div className="flex items-start gap-2 rounded-[10px] border border-[var(--ls-linea2)] bg-[var(--ls-sup2)] px-3 py-[10px] text-[12.5px] leading-[1.5] text-[var(--ls-t2)]" style={{ borderLeft: `3px solid ${COLOR_ESTADO.ambar}` }}>
        <TriangleAlert className="mt-[2px] h-[14px] w-[14px] shrink-0" style={{ color: COLOR_ESTADO.ambar }} aria-hidden />
        Este cliente no tiene la API de Amazon conectada, así que no hay catálogo del que elegir. Pega las referencias con «Pegar una tabla».
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">Buscar productos</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-[14px] w-[14px] -translate-y-1/2 text-[var(--ls-t4)]" aria-hidden />
          <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar por SKU, nombre o ASIN" className={cx(CAMPO, 'w-full pl-9 pr-8')} />
          {cargando && <Loader2 className="absolute right-3 top-1/2 h-[14px] w-[14px] -translate-y-1/2 animate-spin text-[var(--ls-t4)]" aria-label="Buscando" />}
        </label>
        {esAdmin && (
          <Boton variante="secundario" tamano="sm" icono={RefreshCw} cargando={refrescando} onClick={() => void refrescar()} title="Releer el catálogo contra Amazon. Para cuando acabas de crear un producto a mano">
            <span className="max-sm:hidden">{refrescando ? 'Leyendo…' : 'Refrescar'}</span>
          </Boton>
        )}
      </div>

      {/* Lo elegido, arriba y siempre visible */}
      {elegidos.length > 0 && (
        <div className="rounded-[10px] border p-2" style={{ borderColor: 'color-mix(in srgb, var(--ls-mod-remesas) 35%, var(--ls-linea))', background: 'color-mix(in srgb, var(--ls-mod-remesas) 6%, var(--ls-sup))' }}>
          <p className="mb-[6px] px-1 text-[12px] font-semibold text-[var(--ls-t2)]">
            {elegidos.length} referencia{elegidos.length === 1 ? '' : 's'} · <span className="tabular-nums">{elegidos.reduce((s, e) => s + e.unidades, 0)}</span> unidades
          </p>
          <ul className="max-h-48 space-y-[2px] overflow-y-auto">
            {elegidos.map((e) => (
              <li key={e.sku} className="flex items-center gap-2 rounded-[8px] px-1 py-1">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-[12px] text-[var(--ls-t1)]">{e.sku}</span>
                  <span className="block truncate text-[11.5px] text-[var(--ls-t3)]">
                    {e.titulo ?? ''}
                    {!e.fnsku && (
                      <span className="ml-1 font-medium" style={{ color: COLOR_ESTADO.ambar }} title="Sin FNSKU no se puede imprimir su etiqueta. La pasada de esta noche lo rellena">
                        · sin FNSKU
                      </span>
                    )}
                  </span>
                </span>
                <input
                  type="number"
                  inputMode="numeric"
                  min="1"
                  value={e.unidades}
                  aria-label={`Unidades de ${e.sku}`}
                  onChange={(ev) => cambiarUnidades(e.sku, Math.floor(Number(ev.target.value) || 1))}
                  className={cx(CAMPO, 'w-[68px] shrink-0 px-2 text-right tabular-nums')}
                />
                <Boton variante="fantasma" tamano="sm" soloIcono icono={X} aria-label={`Quitar ${e.sku}`} onClick={() => onCambio(elegidos.filter((x) => x.sku !== e.sku))} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* El catálogo */}
      <div className="max-h-72 overflow-y-auto rounded-[10px] border border-[var(--ls-linea)]" role="listbox" aria-multiselectable="true" aria-label="Productos de FBA">
        {productos.length === 0 && !cargando && (
          <div className="flex flex-col items-center gap-[6px] p-6 text-center">
            <Package className="h-6 w-6 text-[var(--ls-t4)]" aria-hidden />
            <p className="text-[12.5px] text-[var(--ls-t3)]">{busqueda ? 'Nada que coincida' : 'Este cliente no tiene productos de FBA guardados'}</p>
            {!busqueda && esAdmin && <p className="text-[12px] text-[var(--ls-t4)]">Prueba a refrescar el catálogo</p>}
          </div>
        )}
        {productos.map((p) => {
          const elegido = porSku.has(p.sku)
          return (
            <button
              key={p.sku}
              type="button"
              role="option"
              aria-selected={elegido}
              onClick={() => alternar(p)}
              className={cx(
                'flex min-h-[44px] w-full items-center gap-3 border-b border-[var(--ls-linea)] px-3 py-2 text-left transition-colors last:border-0 motion-reduce:transition-none',
                elegido ? 'bg-[color-mix(in_srgb,var(--ls-mod-remesas)_9%,var(--ls-sup))]' : 'hover:bg-[var(--ls-sup2)]'
              )}
            >
              <span
                className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] border"
                style={elegido ? { borderColor: 'var(--ls-mod-remesas)', background: 'var(--ls-mod-remesas)', color: 'var(--ls-fondo)' } : { borderColor: 'var(--ls-linea2)' }}
                aria-hidden
              >
                {elegido && <Check className="h-3 w-3" strokeWidth={3} />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-mono text-[12px] text-[var(--ls-t2)]">{p.sku}</span>
                <span className="block truncate text-[12px] text-[var(--ls-t3)]">{p.titulo ?? '—'}</span>
              </span>
              {p.stock !== null && (
                <span className="shrink-0 text-[11.5px] tabular-nums text-[var(--ls-t4)]" title="Lo que hay hoy en Amazon">
                  {p.stock} en FBA
                </span>
              )}
            </button>
          )
        })}
      </div>

      <p className="text-[11.5px] text-[var(--ls-t4)]">
        {total} producto{total === 1 ? '' : 's'} de FBA
        {hayMas && ' · escribe para afinar, solo se ven los primeros'}
      </p>
    </div>
  )
}
