'use client'

import { useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Boton, FOCO } from './Boton'
import { EsqueletoTabla, Esqueleto } from './Esqueleto'
import { EstadoVacio, type EstadoVacioProps } from './EstadoVacio'
import { ordenarFilas, paginar, type Sentido, type ValorOrdenable } from './utilidades'

/**
 * TABLA ADAPTABLE. Tabla densa en el ordenador (≥ lg) y lista de tarjetas en el móvil. Lo decide CSS (`hidden lg:block` / `lg:hidden`), no un hook: no hay salto al
 * hidratar. Las columnas se declaran una vez y sirven para las dos vistas.
 *
 *   const columnas: Columna<Envio>[] = [
 *     { id: 'nombre', cabecera: 'Envío', celda: (e) => e.nombre, ordenar: (e) => e.nombre, movil: 'titulo' },
 *     { id: 'estado', cabecera: 'Estado', celda: (e) => <InsigniaDeEstado estado={e.estado} />, movil: 'insignia' },
 *     { id: 'uds', cabecera: 'Unidades', celda: (e) => e.uds, ordenar: (e) => e.uds, alinear: 'derecha' },
 *     { id: 'nota', cabecera: 'Nota', celda: (e) => e.nota, movil: 'oculto' },
 *   ]
 *   <TablaAdaptable columnas={columnas} filas={envios} claveDe={(e) => e.id} alPulsarFila={abrir} ordenInicial={{ id: 'uds', sentido: 'desc' }} porPagina={25}
 *     vacio={{ icono: Package, titulo: 'Sin envíos', accion: { texto: 'Nuevo envío', onClick } }} cargando={cargando} />
 *
 * En el móvil: `titulo` va arriba en grande, `subtitulo` debajo, `insignia` arriba a la derecha y el resto (`dato`, por defecto) en una rejilla de dos columnas con su
 * rótulo. `oculto` no sale en el móvil. Las filas se paginan (no se anima fila a fila: con muchas filas sería lento).
 */
export interface Columna<T> {
  id: string
  cabecera: ReactNode
  celda: (fila: T) => ReactNode
  /** Si la columna se puede ordenar, de dónde sale el valor */
  ordenar?: (fila: T) => ValorOrdenable
  alinear?: 'izquierda' | 'derecha' | 'centro'
  /** Ancho en el ordenador (CSS: '120px', '20%') */
  ancho?: string
  /** Papel en la vista de tarjetas del móvil */
  movil?: 'titulo' | 'subtitulo' | 'insignia' | 'dato' | 'oculto'
  /** Rótulo en el móvil si la cabecera no es texto */
  rotuloMovil?: string
  /** Clases extra para las celdas de esta columna */
  className?: string
}

export interface TablaAdaptableProps<T> {
  columnas: Columna<T>[]
  filas: readonly T[]
  claveDe: (fila: T) => string
  alPulsarFila?: (fila: T) => void
  /** La fila resaltada (la que está abierta en el panel lateral, por ejemplo) */
  filaActiva?: string | null
  ordenInicial?: { id: string; sentido: Sentido }
  /** 0 = sin paginar. Por defecto 25. */
  porPagina?: number
  cargando?: boolean
  vacio?: EstadoVacioProps
  /** Acciones al final de cada fila (botones pequeños). Se paran los clics para no abrir la fila. */
  acciones?: (fila: T) => ReactNode
  /** Nombre accesible de la tabla */
  etiqueta?: string
  className?: string
}

const ALINEAR = { izquierda: 'text-left', derecha: 'text-right', centro: 'text-center' } as const
const JUSTIFICAR = { izquierda: 'justify-start', derecha: 'justify-end', centro: 'justify-center' } as const

export function TablaAdaptable<T>({ columnas, filas, claveDe, alPulsarFila, filaActiva, ordenInicial, porPagina = 25, cargando, vacio, acciones, etiqueta, className }: TablaAdaptableProps<T>) {
  const [orden, setOrden] = useState<{ id: string; sentido: Sentido } | null>(ordenInicial ?? null)
  const [pagina, setPagina] = useState(1)

  const ordenadas = useMemo(() => {
    const col = orden ? columnas.find((c) => c.id === orden.id) : undefined
    return ordenarFilas(filas, col?.ordenar, orden?.sentido ?? 'asc')
  }, [filas, columnas, orden])

  const vista = useMemo(() => (porPagina > 0 ? paginar(ordenadas, pagina, porPagina) : paginar(ordenadas, 1, Math.max(1, ordenadas.length))), [ordenadas, pagina, porPagina])

  // Si cambian los filtros y la página ya no existe, vuelve a una que sí
  useEffect(() => {
    if (vista.pagina !== pagina) setPagina(vista.pagina)
  }, [vista.pagina, pagina])

  const cambiarOrden = (id: string) => {
    setPagina(1)
    setOrden((o) => (o?.id !== id ? { id, sentido: 'asc' } : o.sentido === 'asc' ? { id, sentido: 'desc' } : null))
  }

  const teclaFila = (fila: T) => (e: KeyboardEvent<HTMLElement>) => {
    if (!alPulsarFila) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      alPulsarFila(fila)
    }
  }

  if (cargando && filas.length === 0) {
    return (
      <div className={className}>
        <EsqueletoTabla className="hidden lg:block" columnas={Math.min(columnas.length, 6)} filas={6} />
        <div className="flex flex-col gap-2 lg:hidden">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="rounded-[14px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] p-4">
              <Esqueleto className="h-[12px] w-1/2" />
              <Esqueleto className="mt-3 h-[9px] w-3/4" />
              <Esqueleto className="mt-2 h-[9px] w-2/5" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (filas.length === 0) {
    return (
      <div className={cn('rounded-[14px] border border-dashed border-[var(--ls-linea2)] bg-[var(--ls-sup)]', className)}>
        <EstadoVacio compacto titulo="No hay nada que enseñar" {...vacio} />
      </div>
    )
  }

  const titulo = columnas.find((c) => c.movil === 'titulo') ?? columnas[0]
  const subtitulo = columnas.find((c) => c.movil === 'subtitulo')
  const insignias = columnas.filter((c) => c.movil === 'insignia')
  const datos = columnas.filter((c) => c !== titulo && c !== subtitulo && (c.movil ?? 'dato') === 'dato')

  return (
    <div className={cn('min-w-0', cargando && 'opacity-60 transition-opacity', className)} aria-busy={cargando || undefined}>
      {/* ORDENADOR: tabla densa con cabecera pegajosa */}
      <div className="hidden overflow-hidden rounded-[14px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] shadow-[var(--ls-sombra-1)] lg:block">
        <div className="max-h-[70vh] overflow-auto">
          <table className="w-full border-collapse text-[13px]" aria-label={etiqueta}>
            <thead className="sticky top-0 z-[1] bg-[var(--ls-sup2)]">
              <tr className="border-b border-[var(--ls-linea)]">
                {columnas.map((c) => {
                  const activa = orden?.id === c.id
                  const alinear = c.alinear ?? 'izquierda'
                  return (
                    <th
                      key={c.id}
                      scope="col"
                      style={c.ancho ? { width: c.ancho } : undefined}
                      aria-sort={activa ? (orden?.sentido === 'asc' ? 'ascending' : 'descending') : undefined}
                      className={cn('h-10 whitespace-nowrap px-3 text-[11.5px] font-semibold uppercase tracking-[0.04em] text-[var(--ls-t4)] first:pl-4 last:pr-4', ALINEAR[alinear])}
                    >
                      {c.ordenar ? (
                        <button
                          type="button"
                          onClick={() => cambiarOrden(c.id)}
                          className={cn('-mx-1 inline-flex items-center gap-1 rounded-[6px] px-1 py-[2px] uppercase transition-colors hover:text-[var(--ls-t1)]', FOCO, JUSTIFICAR[alinear], activa && 'text-[var(--ls-t1)]')}
                        >
                          {c.cabecera}
                          {activa ? orden?.sentido === 'asc' ? <ArrowUp className="h-3 w-3 text-[var(--ls-acc)]" /> : <ArrowDown className="h-3 w-3 text-[var(--ls-acc)]" /> : <ChevronsUpDown className="h-3 w-3 opacity-50" />}
                        </button>
                      ) : (
                        c.cabecera
                      )}
                    </th>
                  )
                })}
                {acciones && <th className="w-px px-3 pr-4" aria-label="Acciones" />}
              </tr>
            </thead>
            <tbody>
              {vista.filas.map((fila) => {
                const clave = claveDe(fila)
                const activa = filaActiva === clave
                return (
                  <tr
                    key={clave}
                    onClick={alPulsarFila ? () => alPulsarFila(fila) : undefined}
                    onKeyDown={alPulsarFila ? teclaFila(fila) : undefined}
                    tabIndex={alPulsarFila ? 0 : undefined}
                    aria-current={activa || undefined}
                    className={cn(
                      'group border-b border-[var(--ls-linea)] transition-colors last:border-b-0',
                      alPulsarFila && 'cursor-pointer outline-none hover:bg-[var(--ls-sup3)] focus-visible:bg-[var(--ls-sup3)] focus-visible:shadow-[inset_2px_0_0_var(--ls-acc-graf)]',
                      activa && 'bg-[var(--ls-sel)] shadow-[inset_2px_0_0_var(--ls-acc-graf)] hover:bg-[var(--ls-sel)]',
                    )}
                  >
                    {columnas.map((c) => (
                      <td key={c.id} className={cn('h-11 px-3 align-middle text-[var(--ls-t2)] first:pl-4 first:font-medium first:text-[var(--ls-t1)] last:pr-4', ALINEAR[c.alinear ?? 'izquierda'], c.alinear === 'derecha' && 'tabular-nums', c.className)}>
                        {c.celda(fila)}
                      </td>
                    ))}
                    {acciones && (
                      <td className="whitespace-nowrap px-3 pr-4 text-right" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                        <div className="inline-flex items-center gap-1 opacity-70 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">{acciones(fila)}</div>
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* MÓVIL: una tarjeta por fila */}
      <ul className="flex flex-col gap-2 lg:hidden" aria-label={etiqueta}>
        {vista.filas.map((fila) => {
          const clave = claveDe(fila)
          const activa = filaActiva === clave
          return (
            <li key={clave}>
              <div
                onClick={alPulsarFila ? () => alPulsarFila(fila) : undefined}
                onKeyDown={alPulsarFila ? teclaFila(fila) : undefined}
                role={alPulsarFila ? 'button' : undefined}
                tabIndex={alPulsarFila ? 0 : undefined}
                className={cn(
                  'relative rounded-[14px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] p-[14px] shadow-[var(--ls-sombra-1)] transition-colors',
                  alPulsarFila && cn('cursor-pointer active:bg-[var(--ls-sup3)]', FOCO),
                  activa && 'border-[color-mix(in_srgb,var(--ls-acc-graf)_45%,var(--ls-linea))] bg-[var(--ls-sel)]',
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px] font-semibold text-[var(--ls-t1)]">{titulo.celda(fila)}</div>
                    {subtitulo && <div className="mt-[2px] truncate text-[12.5px] text-[var(--ls-t3)]">{subtitulo.celda(fila)}</div>}
                  </div>
                  {insignias.length > 0 && <div className="flex shrink-0 flex-col items-end gap-1">{insignias.map((c) => <span key={c.id}>{c.celda(fila)}</span>)}</div>}
                  {alPulsarFila && insignias.length === 0 && <ChevronRight className="mt-[2px] h-4 w-4 shrink-0 text-[var(--ls-t4)]" aria-hidden />}
                </div>
                {datos.length > 0 && (
                  <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-[var(--ls-linea)] pt-3">
                    {datos.map((c) => (
                      <div key={c.id} className="min-w-0">
                        <dt className="truncate text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--ls-t4)]">{c.rotuloMovil ?? (typeof c.cabecera === 'string' ? c.cabecera : c.id)}</dt>
                        <dd className={cn('mt-[2px] truncate text-[13px] text-[var(--ls-t1)]', c.alinear === 'derecha' && 'tabular-nums')}>{c.celda(fila)}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                {acciones && (
                  <div className="mt-3 flex flex-wrap justify-end gap-2" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                    {acciones(fila)}
                  </div>
                )}
              </div>
            </li>
          )
        })}
      </ul>

      {/* Paginación sencilla */}
      {porPagina > 0 && vista.paginas > 1 && (
        <nav aria-label="Páginas" className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[12.5px] text-[var(--ls-t3)]">
          <span className="tabular-nums">
            {vista.desde.toLocaleString('es-ES')}–{vista.hasta.toLocaleString('es-ES')} de {vista.total.toLocaleString('es-ES')}
          </span>
          <div className="flex items-center gap-2">
            <Boton tamano="sm" variante="secundario" soloIcono icono={ChevronLeft} aria-label="Página anterior" disabled={vista.pagina <= 1} onClick={() => setPagina(vista.pagina - 1)} />
            <span className="min-w-[64px] text-center tabular-nums text-[var(--ls-t2)]">
              {vista.pagina} / {vista.paginas}
            </span>
            <Boton tamano="sm" variante="secundario" soloIcono icono={ChevronRight} aria-label="Página siguiente" disabled={vista.pagina >= vista.paginas} onClick={() => setPagina(vista.pagina + 1)} />
          </div>
        </nav>
      )}
    </div>
  )
}
