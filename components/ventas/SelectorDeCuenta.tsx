'use client'

import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Check, ChevronDown, Plus, Search } from 'lucide-react'
import type { CuentaDelPanel } from '@/lib/ventas/panel-servidor'
import { bandera } from './piezas'

/**
 * VENTAS · EL CLIENTE QUE SE MIRA: un desplegable propio (no el del navegador) con los clientes vinculados al panel, sus países y cómo va su lectura
 * (al día, cargando o con avisos). Abajo, «Añadir cuenta».
 */
export function SelectorDeCuenta({ cuentas, valor, onCambio, onAnadir }: { cuentas: CuentaDelPanel[]; valor: string | null; onCambio: (id: string) => void; onAnadir?: () => void }) {
  const [abierto, setAbierto] = useState(false)
  const [q, setQ] = useState('')
  const caja = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!abierto) return
    const fuera = (e: MouseEvent) => !caja.current?.contains(e.target as Node) && setAbierto(false)
    document.addEventListener('mousedown', fuera)
    return () => document.removeEventListener('mousedown', fuera)
  }, [abierto])
  const actual = cuentas.find((c) => c.id === valor) ?? null
  const lista = cuentas.filter((c) => !q.trim() || `${c.cliente ?? ''} ${c.nombre}`.toLowerCase().includes(q.trim().toLowerCase()))
  const nombre = (c: CuentaDelPanel) => c.cliente ?? c.nombre

  return (
    <div ref={caja} className="relative">
      <button type="button" onClick={() => setAbierto((x) => !x)} className="flex h-11 min-w-[260px] items-center gap-3 rounded-[13px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] pl-[6px] pr-3 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.035)] transition-colors hover:border-[color-mix(in_srgb,var(--ls-t1)_18%,var(--ls-linea))]" aria-expanded={abierto}>
        {actual && <Inicial texto={nombre(actual)} />}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] font-semibold text-[var(--ls-t1)]">{actual ? nombre(actual) : 'Elegir cliente'}</span>
          {actual && actual.cliente && actual.cliente !== actual.nombre && <span className="block truncate text-[11px] text-[var(--ls-t4)]">{actual.nombre}</span>}
        </span>
        {actual && <Estado c={actual} />}
        <ChevronDown className={`h-[15px] w-[15px] text-[var(--ls-t4)] transition-transform ${abierto ? 'rotate-180' : ''}`} />
      </button>
      {abierto && (
        <motion.div initial={{ opacity: 0, y: -4, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.15 }} className="absolute right-0 top-[50px] z-40 w-[340px] overflow-hidden rounded-[16px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] shadow-[var(--ls-sombra-3)]">
          {cuentas.length > 6 && (
            <label className="flex items-center gap-2 border-b border-[var(--ls-linea)] px-3 py-2">
              <Search className="h-[14px] w-[14px] text-[var(--ls-t4)]" />
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar cliente" className="flex-1 bg-transparent text-[13px] text-[var(--ls-t1)] outline-none placeholder:text-[var(--ls-t4)]" />
            </label>
          )}
          <div className="max-h-[360px] overflow-y-auto p-1">
            <div className="px-3 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-[var(--ls-t4)]">Clientes vinculados</div>
            {lista.map((c) => (
              <button key={c.id} type="button" onClick={() => (onCambio(c.id), setAbierto(false), setQ(''))} className="flex w-full items-center gap-3 rounded-[11px] px-2 py-[7px] text-left transition-colors hover:bg-[var(--ls-sup2)]" style={c.id === valor ? { background: 'color-mix(in srgb, #F26212 9%, transparent)' } : undefined}>
                <Inicial texto={nombre(c)} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-[var(--ls-t1)]">{nombre(c)}</span>
                  <span className="block truncate text-[11px] text-[var(--ls-t4)]">
                    {c.mercados.slice(0, 8).map((m) => bandera(m)).join(' ')}
                    {c.cliente && c.cliente !== c.nombre ? ` · ${c.nombre}` : ''}
                  </span>
                </span>
                <Estado c={c} />
                <span className="w-[14px]">{c.id === valor && <Check className="h-[14px] w-[14px] text-[#FF8A3D]" />}</span>
              </button>
            ))}
          </div>
          {onAnadir && (
            <button type="button" onClick={() => (setAbierto(false), onAnadir())} className="flex w-full items-center gap-2 border-t border-[var(--ls-linea)] px-4 py-3 text-[12.5px] font-medium text-[var(--ls-t2)] transition-colors hover:bg-[var(--ls-sup2)] hover:text-[var(--ls-t1)]">
              <Plus className="h-[14px] w-[14px] text-[#FF8A3D]" /> Añadir otra cuenta al panel
            </button>
          )}
        </motion.div>
      )}
    </div>
  )
}

function Inicial({ texto }: { texto: string }) {
  const letras = texto.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('')
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] text-[12px] font-bold text-[#141414]" style={{ background: 'linear-gradient(135deg, #F26212, #FFB27A)' }}>
      {letras}
    </span>
  )
}

function Estado({ c }: { c: CuentaDelPanel }) {
  const [color, texto] = c.estado.primeraLectura ? ['#F5B942', 'Cargando datos'] : c.estado.error ? ['#F0544F', `Avisos: ${c.estado.error}`] : ['#4ADE80', 'Al día']
  return (
    <span className="relative flex h-[8px] w-[8px] shrink-0" title={texto}>
      {!c.estado.error && <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-40" style={{ background: color }} />}
      <span className="relative inline-flex h-[8px] w-[8px] rounded-full" style={{ background: color }} />
    </span>
  )
}
