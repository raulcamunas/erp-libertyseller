'use client'

import { useMemo, useState } from 'react'
import { ChevronsLeft, ChevronsRight, FlaskConical, Search } from 'lucide-react'
import { COLOR_ESTADO, TEXTO, TIPO } from '@/lib/estilo/denso'
import { nombreDePais } from '@/lib/ads/paises'

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
function colorDe(slug: string): string {
  let h = 0
  for (const ch of slug) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return PALETA[h % PALETA.length]
}

const iniciales = (nombre: string) => {
  const partes = nombre.trim().split(/\s+/).filter(Boolean)
  return ((partes[0]?.[0] ?? '?') + (partes.length > 1 ? (partes[1]?.[0] ?? '') : '')).toUpperCase()
}

/**
 * LA COLUMNA DE LA IZQUIERDA DE MARKETING TEST: todos los clientes con Amazon Ads en uso y, bajo el elegido, sus países. Plegada, se queda en una fila de iniciales. Elegir un cliente o un país no pasa por
 * el servidor: la pantalla ya tiene la lista entera.
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

  return (
    <aside
      aria-label="Clientes"
      className={`hidden shrink-0 flex-col overflow-hidden rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] transition-[width] md:flex ${colapsada ? 'w-[52px]' : 'w-[240px]'}`}
    >
      <div className="flex items-center gap-2 border-b border-[var(--ls-linea)] px-[10px] py-[9px]">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] bg-[var(--ls-acc-relleno)] text-[var(--ls-acc-tinta)]" aria-hidden>
          <FlaskConical className="h-4 w-4" />
        </span>
        {!colapsada && (
          <span className="min-w-0 flex-1 leading-[1.25]">
            <b className="block truncate text-[13px] font-semibold text-[var(--ls-t1)]">Marketing Test</b>
            <span className={`${TIPO.xs} ${TEXTO.t4}`}>{clientes.length} {clientes.length === 1 ? 'cliente' : 'clientes'}</span>
          </span>
        )}
        <button type="button" onClick={alternar} aria-label={colapsada ? 'Ampliar la barra' : 'Plegar la barra'} className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[5px] text-[var(--ls-t3)] hover:bg-[var(--ls-sup2)] hover:text-[var(--ls-t1)]">
          {colapsada ? <ChevronsRight className="h-3.5 w-3.5" /> : <ChevronsLeft className="h-3.5 w-3.5" />}
        </button>
      </div>

      {!colapsada && (
        <div className="px-[10px] pb-1 pt-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-[7px] h-3 w-3 text-[var(--ls-t4)]" />
            <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar cliente…" className="h-[26px] w-full rounded-[6px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] pl-6 pr-2 text-[12px] text-[var(--ls-t1)] outline-none placeholder:text-[var(--ls-t4)] focus:border-[var(--ls-acc-graf)]" />
          </div>
        </div>
      )}

      <nav className="flex min-h-0 flex-1 flex-col gap-[2px] overflow-y-auto px-[6px] py-2">
        {filtrados.length === 0 && <p className={`px-2 py-2 ${TIPO.s} ${TEXTO.t4}`}>Ningún cliente con ese nombre.</p>}
        {filtrados.map((c) => {
          const activo = c.slug === clienteSlug
          const color = colorDe(c.slug)
          return (
            <div key={c.slug}>
              <button
                type="button"
                aria-current={activo ? 'page' : undefined}
                title={colapsada ? c.nombre : undefined}
                onClick={() => elegir(c.slug, activo ? cuentaId : (c.cuentas[0]?.id ?? null))}
                className={`flex w-full items-center gap-2 rounded-[7px] px-[6px] py-[5px] text-left transition-colors ${activo ? 'bg-[var(--ls-sel)] text-[var(--ls-t1)]' : 'text-[var(--ls-t2)] hover:bg-[var(--ls-sup2)] hover:text-[var(--ls-t1)]'}`}
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] text-[10.5px] font-bold" style={{ background: `color-mix(in srgb, ${color} 22%, transparent)`, color }}>
                  {iniciales(c.nombre)}
                </span>
                {!colapsada && (
                  <>
                    <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">{c.nombre}</span>
                    <span className={`${TIPO.xs} ${TEXTO.t4} tabular-nums`} title={`${c.cuentas.length} ${c.cuentas.length === 1 ? 'país' : 'países'} en uso`}>{c.cuentas.length}</span>
                  </>
                )}
              </button>

              {activo && !colapsada && c.cuentas.length > 0 && (
                <div className="ml-[18px] mt-[2px] flex flex-col gap-[1px] border-l border-[var(--ls-linea2)] pb-1 pl-[6px]">
                  {c.cuentas.map((cu) => {
                    const sel = cu.id === cuentaId
                    return (
                      <button
                        key={cu.id}
                        type="button"
                        aria-current={sel ? 'true' : undefined}
                        onClick={() => elegir(c.slug, cu.id)}
                        title={[cu.nombre, cu.moneda].filter(Boolean).join(' · ')}
                        className={`flex items-center gap-2 rounded-[6px] px-[6px] py-[3px] text-left text-[12px] transition-colors ${sel ? 'font-medium text-[var(--ls-t1)]' : 'text-[var(--ls-t3)] hover:bg-[var(--ls-sup2)] hover:text-[var(--ls-t1)]'}`}
                      >
                        <span className="inline-flex h-[16px] w-[22px] items-center justify-center rounded-[4px] text-[9.5px] font-bold" style={sel ? { background: 'var(--ls-acc-relleno)', color: 'var(--ls-acc-tinta)' } : { background: 'var(--ls-sup3)', color: 'var(--ls-t3)' }}>
                          {cu.pais}
                        </span>
                        <span className="min-w-0 flex-1 truncate">{nombreDePais(cu.pais)}</span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </nav>
    </aside>
  )
}
