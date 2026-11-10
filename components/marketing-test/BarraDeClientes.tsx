'use client'

import { useMemo, useState } from 'react'
import { ChevronsLeft, ChevronsRight, FlaskConical, Search } from 'lucide-react'
import { COLOR_ESTADO } from '@/lib/estilo/denso'
import { nombreDePais } from '@/lib/ads/paises'
import { bandera } from './piezas'

export interface CuentaDeBarra {
  id: string
  pais: string
  moneda: string | null
  nombre: string | null
}

export interface ClienteDeBarra {
  slug: string
  nombre: string
  cuentas: CuentaDeBarra[]
}

const PALETA = [COLOR_ESTADO.azul, COLOR_ESTADO.violeta, COLOR_ESTADO.cian, COLOR_ESTADO.magenta, COLOR_ESTADO.naranja, COLOR_ESTADO.verde, COLOR_ESTADO.ambar]

/** Un color estable por cliente (el mismo siempre, sin guardarlo en ningún sitio) */
export function colorDeCliente(slug: string): string {
  let h = 0
  for (const ch of slug) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return PALETA[h % PALETA.length]
}

export const inicialesDe = (nombre: string) => {
  const partes = nombre.trim().split(/\s+/).filter(Boolean)
  return ((partes[0]?.[0] ?? '?') + (partes.length > 1 ? (partes[1]?.[0] ?? '') : '')).toUpperCase()
}

/** El cuadradito con las iniciales y el color del cliente */
export function AvatarDeCliente({ slug, nombre, tamano = 28 }: { slug: string; nombre: string; tamano?: number }) {
  const color = colorDeCliente(slug)
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center font-bold tracking-[-0.02em]"
      style={{ width: tamano, height: tamano, borderRadius: Math.round(tamano * 0.28), fontSize: Math.round(tamano * 0.38), color, background: `color-mix(in srgb, ${color} 16%, transparent)`, boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${color} 28%, transparent)` }}
    >
      {inicialesDe(nombre)}
    </span>
  )
}

/**
 * LA COLUMNA DE LA IZQUIERDA DE MARKETING TEST: todos los clientes con Amazon Ads en uso y, bajo el elegido, sus países. Plegada, se queda en una columna de iniciales. Elegir un cliente o un país no
 * pasa por el servidor: la pantalla ya tiene la lista entera.
 */
export function BarraDeClientes({
  clientes,
  clienteSlug,
  cuentaId,
  colapsada,
  alternar,
  elegir,
}: {
  clientes: readonly ClienteDeBarra[]
  clienteSlug: string
  cuentaId: string | null
  colapsada: boolean
  alternar: () => void
  elegir: (slug: string, cuentaId: string | null) => void
}) {
  const [busqueda, setBusqueda] = useState('')
  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    return q ? clientes.filter((c) => c.nombre.toLowerCase().includes(q)) : clientes
  }, [clientes, busqueda])
  const paises = clientes.reduce((n, c) => n + c.cuentas.length, 0)

  return (
    <aside
      aria-label="Clientes"
      className={`hidden shrink-0 flex-col overflow-hidden rounded-[14px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] transition-[width] duration-200 md:flex ${colapsada ? 'w-[60px]' : 'w-[248px]'}`}
    >
      {/* ---- la marca ---- */}
      <div className={`flex items-center gap-[10px] px-3 pb-3 pt-[14px] ${colapsada ? 'flex-col' : ''}`}>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-[var(--ls-acc-relleno)] text-[var(--ls-acc-tinta)] shadow-[0_2px_8px_color-mix(in_srgb,var(--ls-acc)_35%,transparent)]" aria-hidden>
          <FlaskConical className="h-[17px] w-[17px]" />
        </span>
        {!colapsada && (
          <span className="min-w-0 flex-1 leading-[1.2]">
            <b className="block truncate text-[13.5px] font-semibold tracking-[-0.01em] text-[var(--ls-t1)]">Marketing Test</b>
            <span className="text-[11px] text-[var(--ls-t4)]">
              {clientes.length} clientes · {paises} {paises === 1 ? 'país' : 'países'}
            </span>
          </span>
        )}
        <button type="button" onClick={alternar} aria-label={colapsada ? 'Ampliar la barra' : 'Plegar la barra'} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] text-[var(--ls-t4)] transition-colors hover:bg-[var(--ls-sup2)] hover:text-[var(--ls-t1)]">
          {colapsada ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
        </button>
      </div>

      {!colapsada && (
        <div className="px-3 pb-2">
          <label className="relative block">
            <span className="sr-only">Buscar cliente</span>
            <Search className="pointer-events-none absolute left-[10px] top-[9px] h-[13px] w-[13px] text-[var(--ls-t4)]" />
            <input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar cliente"
              className="h-[32px] w-full rounded-[9px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] pl-[30px] pr-2 text-[12.5px] text-[var(--ls-t1)] outline-none transition-colors placeholder:text-[var(--ls-t4)] hover:border-[var(--ls-linea2)] focus:border-[var(--ls-acc-graf)] focus:bg-[var(--ls-sup)]"
            />
          </label>
        </div>
      )}

      {!colapsada && <div className="px-4 pb-1 pt-2 text-[11px] font-semibold text-[var(--ls-t4)]">Clientes</div>}

      <nav className={`flex min-h-0 flex-1 flex-col gap-[2px] overflow-y-auto pb-3 ${colapsada ? 'items-center px-[10px] pt-1' : 'px-2'}`}>
        {filtrados.length === 0 && <p className="px-2 py-2 text-[12px] text-[var(--ls-t4)]">Ningún cliente con ese nombre.</p>}
        {filtrados.map((c) => {
          const activo = c.slug === clienteSlug
          return (
            <div key={c.slug} className={colapsada ? '' : 'w-full'}>
              <button
                type="button"
                aria-current={activo ? 'page' : undefined}
                title={colapsada ? c.nombre : undefined}
                onClick={() => elegir(c.slug, activo ? cuentaId : (c.cuentas[0]?.id ?? null))}
                className={`group relative flex items-center gap-[10px] rounded-[9px] text-left transition-colors focus-visible:outline-2 focus-visible:outline-[var(--ls-acc-graf)] ${
                  colapsada ? 'h-10 w-10 justify-center' : 'h-[38px] w-full px-2'
                } ${activo ? 'bg-[var(--ls-acc-suave)]' : 'hover:bg-[var(--ls-sup2)]'}`}
              >
                {/* El indicador de «estás aquí»: una barra a la izquierda, como en la navegación del resto del ERP */}
                {activo && !colapsada && <span aria-hidden className="absolute -left-2 top-[9px] h-5 w-[3px] rounded-r-full bg-[var(--ls-acc-graf)]" />}
                <AvatarDeCliente slug={c.slug} nombre={c.nombre} tamano={colapsada ? 30 : 26} />
                {!colapsada && (
                  <>
                    <span className={`min-w-0 flex-1 truncate text-[13px] ${activo ? 'font-semibold text-[var(--ls-t1)]' : 'font-medium text-[var(--ls-t2)] group-hover:text-[var(--ls-t1)]'}`}>{c.nombre}</span>
                    <span
                      className={`inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-[6px] text-[10.5px] font-semibold tabular-nums ${activo ? 'bg-[var(--ls-acc-graf)] text-[var(--ls-acc-tinta)]' : 'bg-[var(--ls-sup3)] text-[var(--ls-t3)]'}`}
                      title={`${c.cuentas.length} ${c.cuentas.length === 1 ? 'país' : 'países'} en uso`}
                    >
                      {c.cuentas.length}
                    </span>
                  </>
                )}
              </button>

              {activo && !colapsada && c.cuentas.length > 0 && (
                <div className="mb-1 ml-[21px] mt-[3px] flex flex-col gap-[1px] border-l border-[var(--ls-linea2)] py-[2px] pl-[10px]">
                  {c.cuentas.map((cu) => {
                    const sel = cu.id === cuentaId
                    return (
                      <button
                        key={cu.id}
                        type="button"
                        aria-current={sel ? 'true' : undefined}
                        onClick={() => elegir(c.slug, cu.id)}
                        title={[cu.nombre, cu.moneda].filter(Boolean).join(' · ')}
                        className={`flex h-[30px] items-center gap-2 rounded-[7px] px-2 text-left text-[12.5px] transition-colors focus-visible:outline-2 focus-visible:outline-[var(--ls-acc-graf)] ${
                          sel ? 'bg-[var(--ls-sup3)] font-semibold text-[var(--ls-t1)]' : 'text-[var(--ls-t3)] hover:bg-[var(--ls-sup2)] hover:text-[var(--ls-t1)]'
                        }`}
                      >
                        <span className="w-[18px] text-center text-[14px] leading-none" aria-hidden>
                          {bandera(cu.pais)}
                        </span>
                        <span className="min-w-0 flex-1 truncate">{nombreDePais(cu.pais)}</span>
                        <span className="text-[10.5px] font-medium text-[var(--ls-t4)]">{cu.moneda}</span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </nav>

      {!colapsada && (
        <div className="border-t border-[var(--ls-linea)] px-4 py-[10px] text-[11px] leading-[1.45] text-[var(--ls-t4)]">
          Solo cuentas en uso. Se encienden en <span className="text-[var(--ls-t3)]">Amazon API · Publicidad</span>.
        </div>
      )}
    </aside>
  )
}
