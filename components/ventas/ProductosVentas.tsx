'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Check, Coins, Download, Eye, EyeOff, Loader2, PackageSearch, Save, Upload } from 'lucide-react'
import { CabeceraDeModulo } from '@/components/ui-ls'
import { ImagenDeProducto } from '@/components/productos/ImagenDeProducto'
import { hoyEnMadrid, ivaDeVentas, sumarDias, totalizar, type FilaPanel } from '@/lib/ventas/panel'
import type { CuentaDelPanel, ProductoDelCatalogo } from '@/lib/ventas/panel-servidor'
import { leerCostesCsv } from '@/lib/ventas/costes-csv'
import { SelectorDeCuenta } from './SelectorDeCuenta'
import { bandera, Buscador, euros, pais, ROJO, VERDE } from './piezas'

/**
 * VENTAS · PRODUCTOS (como la página «Productos» de Sellerboard). Cada SKU del catálogo de la cuenta con su foto, su canal (#FBA / #FBM), su COGS EDITABLE,
 * el beneficio por unidad (con lo que se ha vendido en los últimos 30 días y el COGS que se está escribiendo), la velocidad de venta (unidades al día) y el IVA.
 * Los cambios de COGS se acumulan y se guardan con «Guardar» (o al importar un CSV «SKU;COGS»). También se exporta.
 */

type Datos = { filas: FilaPanel[]; productos: { titulos: Record<string, { titulo: string | null; asin: string | null }>; costes: Record<string, number>; catalogo: ProductoDelCatalogo[] } | null }
type FiltroCogs = 'todos' | 'con' | 'sin'
type FiltroCanal = 'todos' | 'fba' | 'fbm'

const DIAS = 30

async function pedir<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { cache: 'no-store', ...init })
  const j = (await r.json().catch(() => null)) as (T & { error?: string }) | null
  if (!r.ok) throw new Error(j?.error ?? `Error ${r.status}`)
  return j as T
}
const aNumero = (t: string | undefined) => {
  const x = (t ?? '').trim().replace(/\s|€/g, '').replace(',', '.')
  if (x === '') return null
  const n = Number(x)
  return Number.isFinite(n) && n >= 0 ? n : NaN
}

export function ProductosVentas() {
  const [cuentas, setCuentas] = useState<CuentaDelPanel[] | null>(null)
  const [cuentaId, setCuentaId] = useState<string | null>(null)
  const [datos, setDatos] = useState<Datos | null>(null)
  const [escrito, setEscrito] = useState<Record<string, string>>({})
  const [guardando, setGuardando] = useState(false)
  const [aviso, setAviso] = useState<{ texto: string; bien: boolean } | null>(null)
  const [buscar, setBuscar] = useState('')
  const [fCogs, setFCogs] = useState<FiltroCogs>('todos')
  const [fCanal, setFCanal] = useState<FiltroCanal>('todos')
  const [verInactivos, setVerInactivos] = useState(false)
  const [iva, setIva] = useState('')
  const fichero = useRef<HTMLInputElement>(null)
  const { hoy } = useMemo(() => hoyEnMadrid(), [])

  useEffect(() => {
    pedir<{ cuentas: CuentaDelPanel[] }>('/api/ventas?que=cuentas').then((r) => {
      setCuentas(r.cuentas)
      setCuentaId(r.cuentas[0]?.id ?? null)
    })
  }, [])
  const cuenta = cuentas?.find((c) => c.id === cuentaId) ?? null
  useEffect(() => setIva(cuenta ? String(cuenta.iva).replace('.', ',') : ''), [cuenta])
  useEffect(() => {
    if (!cuentaId) return
    setDatos(null)
    setEscrito({})
    pedir<Datos>(`/api/ventas?cuenta=${cuentaId}&desde=${sumarDias(hoy, -(DIAS - 1))}&hasta=${hoy}`).then(setDatos)
  }, [cuentaId, hoy])

  const guardados = useMemo(() => datos?.productos?.costes ?? {}, [datos])
  const costeDe = (sku: string): number | null => {
    if (sku in escrito) {
      const n = aNumero(escrito[sku])
      return n == null || Number.isNaN(n) ? null : n
    }
    return guardados[sku] ?? null
  }
  const cambios = Object.keys(escrito).filter((sku) => {
    const n = aNumero(escrito[sku])
    return !Number.isNaN(n) && (n ?? null) !== (guardados[sku] ?? null)
  })
  const ivaNum = cuenta?.iva ?? 21
  const ivaPorPais = cuenta?.ivaPorPais ?? false

  const productos = useMemo(() => {
    if (!datos) return []
    const ventas = new Map<string, FilaPanel[]>()
    for (const f of datos.filas) if (f.sku) ventas.set(f.sku, [...(ventas.get(f.sku) ?? []), f])
    const porSku = new Map<string, ProductoDelCatalogo>()
    for (const c of datos.productos?.catalogo ?? []) if (!porSku.has(c.sku) || (!porSku.get(c.sku)?.activo && c.activo)) porSku.set(c.sku, c)
    // Lo que se ha vendido y no está en el catálogo leído también sale
    for (const [sku, fs] of ventas) if (!porSku.has(sku)) porSku.set(sku, { sku, mkt: fs[0].mkt, asin: fs.find((f) => f.asin)?.asin ?? null, titulo: datos.productos?.titulos[sku]?.titulo ?? null, precio: null, moneda: null, fba: false, activo: true })
    return [...porSku.values()].map((c) => {
      const fs = ventas.get(c.sku) ?? []
      const t = totalizar(fs, { pct: ivaNum, porPais: ivaPorPais }, {})
      return { ...c, t, velocidad: t.unidades / DIAS }
    })
  }, [datos, ivaNum, ivaPorPais])

  const q = buscar.trim().toLowerCase()
  const lista = productos
    .filter((p) => (verInactivos || p.activo || p.t.unidades > 0) && (!q || p.sku.toLowerCase().includes(q) || (p.asin ?? '').toLowerCase().includes(q) || (p.titulo ?? '').toLowerCase().includes(q)))
    .filter((p) => (fCanal === 'todos' ? true : fCanal === 'fba' ? p.fba : !p.fba))
    .filter((p) => (fCogs === 'todos' ? true : fCogs === 'con' ? (costeDe(p.sku) ?? 0) > 0 : !((costeDe(p.sku) ?? 0) > 0)))
    .sort((a, b) => b.velocidad - a.velocidad || a.sku.localeCompare(b.sku))
  const sinCoste = productos.filter((p) => (p.activo || p.t.unidades > 0) && !((costeDe(p.sku) ?? 0) > 0)).length

  /** Beneficio por unidad: con lo vendido (30 días) y el COGS; sin ventas, estimado con el precio, un 15 % de comisión y el IVA */
  const beneficio = (p: (typeof productos)[number]) => {
    const cogs = costeDe(p.sku) ?? 0
    if (p.t.unidades > 0) return { valor: p.t.neto / p.t.unidades - cogs, estimado: false }
    if (p.precio == null) return null
    const r = ivaDeVentas({ pct: ivaNum, porPais: ivaPorPais }, p.mkt)
    const iva = p.precio * (r / (100 + r))
    return { valor: p.precio - 0.15 * p.precio - iva - cogs, estimado: true }
  }

  const guardar = async (lote?: Array<{ sku: string; coste: number }>) => {
    if (!cuentaId) return
    const costes = lote ?? cambios.map((sku) => ({ sku, coste: aNumero(escrito[sku]) ?? 0 }))
    if (costes.length === 0) return
    setGuardando(true)
    setAviso(null)
    try {
      const r = await pedir<{ guardados: number }>('/api/ventas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'costes', cuenta: cuentaId, costes }) })
      setDatos((d) => (d && d.productos ? { ...d, productos: { ...d.productos, costes: { ...d.productos.costes, ...Object.fromEntries(costes.map((c) => [c.sku, c.coste])) } } } : d))
      setEscrito({})
      setAviso({ texto: `${r.guardados} ${r.guardados === 1 ? 'coste guardado' : 'costes guardados'}. El tablero ya los usa.`, bien: true })
    } catch (e) {
      setAviso({ texto: e instanceof Error ? e.message : 'No se ha podido guardar', bien: false })
    } finally {
      setGuardando(false)
    }
  }

  const exportar = () => {
    const filas = [['SKU', 'ASIN', 'Producto', 'Canal', 'COGS', 'Unidades al dia'], ...lista.map((p) => [p.sku, p.asin ?? '', (p.titulo ?? '').replace(/;/g, ','), p.fba ? 'FBA' : 'FBM', (costeDe(p.sku) ?? '').toString().replace('.', ','), p.velocidad.toFixed(2).replace('.', ',')])]
    const blob = new Blob(['﻿' + filas.map((f) => f.join(';')).join('\n')], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `productos-${(cuenta?.cliente ?? cuenta?.nombre ?? 'cuenta').toLowerCase().replace(/\s+/g, '-')}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const importar = async (f: File) => {
    // Lector propio (lib/ventas/costes-csv.ts): respeta las comillas del export de Sellerboard («"SKU";"Cost"») y la coma decimal
    const { costes, error } = leerCostesCsv(await f.text())
    if (error) {
      setAviso({ texto: error, bien: false })
      return
    }
    await guardar(costes)
  }

  return (
    <div className="w-full min-w-0 pb-6 lg:px-1">
      <CabeceraDeModulo
        icono={PackageSearch}
        acento="marca"
        titulo="Productos"
        subtitulo="El COGS de cada producto (lo que cuesta una unidad puesta en Amazon), su beneficio por unidad y lo que vende al día"
        acciones={cuentas && <SelectorDeCuenta cuentas={cuentas} valor={cuentaId} onCambio={setCuentaId} />}
      />

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Buscador valor={buscar} onCambio={setBuscar} />
        <Chips valor={fCogs} onCambio={setFCogs} opciones={[['todos', 'Cualquier COGS'], ['sin', `Sin COGS${sinCoste ? ` · ${sinCoste}` : ''}`], ['con', 'Con COGS']]} />
        <Chips valor={fCanal} onCambio={setFCanal} opciones={[['todos', 'FBA y FBM'], ['fba', '#FBA'], ['fbm', '#FBM']]} />
        <button type="button" onClick={() => setVerInactivos((x) => !x)} className="inline-flex h-8 items-center gap-1 rounded-full border border-[var(--ls-linea)] px-3 text-[12px] text-[var(--ls-t3)] hover:text-[var(--ls-t1)]">
          {verInactivos ? <EyeOff className="h-[13px] w-[13px]" /> : <Eye className="h-[13px] w-[13px]" />}
          {verInactivos ? 'Ocultar inactivos' : 'Mostrar inactivos'}
        </button>
        <span className="ml-auto inline-flex items-center gap-2 rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] px-3 py-[5px] text-[12.5px] text-[var(--ls-t2)]">
          <Coins className="h-[14px] w-[14px] text-[var(--ls-acc)]" /> IVA de la cuenta
          <input
            value={iva}
            onChange={(e) => setIva(e.target.value)}
            onBlur={async () => {
              const v = aNumero(iva)
              if (cuentaId && v != null && !Number.isNaN(v)) {
                await pedir('/api/ventas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'iva', cuenta: cuentaId, iva: v }) })
                setCuentas((cs) => cs?.map((c) => (c.id === cuentaId ? { ...c, iva: v } : c)) ?? cs)
              }
            }}
            className="h-7 w-[52px] rounded-[7px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-2 text-right tabular-nums text-[var(--ls-t1)] outline-none"
            aria-label="IVA"
          />
          %
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={ivaPorPais}
          onClick={async () => {
            if (!cuentaId) return
            try {
              await pedir('/api/ventas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'iva-pais', cuenta: cuentaId, porPais: !ivaPorPais }) })
              setCuentas((cs) => cs?.map((c) => (c.id === cuentaId ? { ...c, ivaPorPais: !ivaPorPais } : c)) ?? cs)
            } catch (e) {
              setAviso({ texto: e instanceof Error ? e.message : 'No se ha podido cambiar', bien: false })
            }
          }}
          title="Encendido: a cada venta se le quita el IVA de su país (España 21, Francia 20, Alemania 19, Italia 22…), como quien declara por OSS. Apagado: el IVA de la cuenta para todo. Las tarifas de Amazon siempre con el IVA de la cuenta."
          className="inline-flex items-center gap-2 rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] px-3 py-[6px] text-[12.5px] text-[var(--ls-t2)]"
        >
          <span className="relative h-[18px] w-[32px] rounded-full transition-colors" style={{ background: ivaPorPais ? '#F26212' : 'var(--ls-sup3)' }}>
            <span className="absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white shadow transition-all" style={{ left: ivaPorPais ? 16 : 2 }} />
          </span>
          IVA de cada país (OSS)
        </button>
      </div>

      <section className="mt-3 overflow-hidden rounded-[16px] border border-[var(--ls-linea)] bg-[var(--ls-sup)]">
        {!datos ? (
          <p className="flex items-center justify-center gap-2 py-16 text-[12.5px] text-[var(--ls-t4)]">
            <Loader2 className="h-[14px] w-[14px] animate-spin" /> Cargando los productos…
          </p>
        ) : lista.length === 0 ? (
          <p className="py-16 text-center text-[12.5px] text-[var(--ls-t4)]">Ningún producto con estos filtros.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1080px] text-[12.5px]">
              <thead className="border-b border-[var(--ls-linea)] text-[11px] uppercase tracking-wide text-[var(--ls-t4)]">
                <tr>
                  <th className="px-3 py-[10px] text-left font-semibold">Producto</th>
                  <th className="px-2 text-left font-semibold">Etiquetas</th>
                  <th className="px-2 text-right font-semibold" title="Lo que cuesta una unidad puesta en Amazon: producto, envío al almacén, embalaje…">COGS</th>
                  <th className="px-2 text-right font-semibold" title={`Ganancia neta por unidad de los últimos ${DIAS} días con este COGS; sin ventas, estimado con el precio`}>Beneficio por unidad</th>
                  <th className="px-2 text-right font-semibold" title={`Unidades vendidas al día (media de ${DIAS} días)`}>Velocidad (uds/día)</th>
                  <th className="px-3 text-right font-semibold">IVA</th>
                </tr>
              </thead>
              <tbody>
                {lista.map((p, i) => {
                  const b = beneficio(p)
                  const sucio = p.sku in escrito && cambios.includes(p.sku)
                  const malo = p.sku in escrito && Number.isNaN(aNumero(escrito[p.sku]))
                  return (
                    <tr key={p.sku} className={`border-b border-[var(--ls-linea)] transition-colors hover:bg-[color-mix(in_srgb,var(--ls-sup2)_70%,transparent)] ${p.activo ? '' : 'opacity-55'}`} style={{ animation: `ventas-entra 380ms ${Math.min(i, 25) * 18}ms both cubic-bezier(.2,.8,.2,1)` }}>
                      <td className="px-3 py-[8px]">
                        <div className="flex items-center gap-3">
                          <span className="shrink-0 rounded-[9px] bg-white p-[2px] ring-1 ring-[var(--ls-linea)]">
                            <ImagenDeProducto asin={p.asin} mkt={p.mkt} lado={42} redondeo={7} titulo={p.titulo ?? p.sku} />
                          </span>
                          <div className="min-w-0 max-w-[620px]">
                            <div className="flex items-center gap-2 text-[11px] text-[var(--ls-t4)]">
                              <span title={pais(p.mkt)}>{bandera(p.mkt)}</span>
                              <span className="tabular-nums">{p.asin ?? '—'}</span>·<span className="truncate">SKU {p.sku}</span>
                            </div>
                            <div className="truncate text-[var(--ls-t1)]" title={p.titulo ?? p.sku}>
                              {p.titulo ?? p.sku}
                            </div>
                            <div className="text-[11px] tabular-nums text-[var(--ls-t4)]">{p.precio != null ? `${p.precio.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${p.moneda === 'EUR' || !p.moneda ? '€' : p.moneda}` : 'sin precio'}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-2">
                        <span className="rounded-[6px] px-[7px] py-[2px] text-[11px] font-semibold" style={p.fba ? { color: '#60A5FA', background: 'color-mix(in srgb, #60A5FA 14%, transparent)' } : { color: 'var(--ls-acc)', background: 'color-mix(in srgb, var(--ls-acc) 12%, transparent)' }}>
                          #{p.fba ? 'FBA' : 'FBM'}
                        </span>
                        {!p.activo && <span className="ml-1 text-[10.5px] text-[var(--ls-t4)]">inactivo</span>}
                      </td>
                      <td className="px-2 text-right">
                        <span className="inline-flex items-center gap-1">
                          <input
                            value={p.sku in escrito ? escrito[p.sku] : guardados[p.sku] != null ? String(guardados[p.sku]).replace('.', ',') : ''}
                            onChange={(e) => setEscrito((x) => ({ ...x, [p.sku]: e.target.value }))}
                            onKeyDown={(e) => e.key === 'Enter' && void guardar()}
                            placeholder="0,00"
                            inputMode="decimal"
                            className="h-8 w-[92px] rounded-[8px] border bg-[var(--ls-sup2)] px-2 text-right text-[13px] tabular-nums text-[var(--ls-t1)] outline-none transition-colors focus:border-[var(--ls-acc)]"
                            style={{ borderColor: malo ? ROJO : sucio ? 'var(--ls-acc)' : 'var(--ls-linea)' }}
                            aria-label={`COGS de ${p.sku}`}
                          />
                          <span className="text-[var(--ls-t4)]">€</span>
                        </span>
                      </td>
                      <td className="px-2 text-right tabular-nums">
                        {b == null ? (
                          <span className="text-[var(--ls-t4)]">—</span>
                        ) : (
                          <span style={{ color: b.valor >= 0 ? VERDE : ROJO }} className="font-semibold" title={b.estimado ? 'Sin ventas en 30 días: estimado con el precio, un 15 % de comisión y el IVA' : undefined}>
                            {euros(b.valor)}
                            {b.estimado && <span className="ml-1 text-[10px] font-normal text-[var(--ls-t4)]">est.</span>}
                          </span>
                        )}
                      </td>
                      <td className="px-2 text-right">
                        <span className="inline-flex items-center gap-2">
                          <span className="h-[5px] w-[56px] overflow-hidden rounded-full bg-[var(--ls-sup2)]">
                            <span className="block h-full rounded-full" style={{ width: `${Math.min(1, p.velocidad / Math.max(0.01, lista[0]?.velocidad ?? 1)) * 100}%`, background: 'linear-gradient(90deg, #F26212, #FF8A3D)' }} />
                          </span>
                          <span className="w-[38px] tabular-nums text-[var(--ls-t1)]">{p.velocidad.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        </span>
                      </td>
                      <td className="px-3 text-right tabular-nums text-[var(--ls-t2)]">{ivaDeVentas({ pct: ivaNum, porPais: ivaPorPais }, p.mkt).toLocaleString('es-ES')} %</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <style>{`@keyframes ventas-entra { from { opacity: 0; transform: translateY(6px) } to { opacity: 1; transform: none } }`}</style>

      {/* La barra de abajo, como en Sellerboard: importar, exportar y guardar */}
      <div className="sticky bottom-0 z-20 mt-3 rounded-[14px] border border-[var(--ls-linea)] bg-[color-mix(in_srgb,var(--ls-sup)_92%,transparent)] shadow-[var(--ls-sombra-2)] backdrop-blur-md">
        <div className="flex flex-wrap items-center gap-2 px-3 py-[8px]">
          <input ref={fichero} type="file" accept=".csv,.txt,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && void importar(e.target.files[0]).finally(() => (e.target.value = ''))} />
          <button type="button" onClick={() => fichero.current?.click()} className="inline-flex h-9 items-center gap-2 rounded-[10px] px-3 text-[12.5px] text-[var(--ls-t2)] hover:bg-[var(--ls-sup2)] hover:text-[var(--ls-t1)]" title="Un CSV con las columnas SKU y COGS (separado por ; o ,)">
            <Upload className="h-[14px] w-[14px]" /> Importar
          </button>
          <button type="button" onClick={exportar} className="inline-flex h-9 items-center gap-2 rounded-[10px] px-3 text-[12.5px] text-[var(--ls-t2)] hover:bg-[var(--ls-sup2)] hover:text-[var(--ls-t1)]">
            <Download className="h-[14px] w-[14px]" /> Exportar
          </button>
          {aviso && (
            <motion.span initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="inline-flex items-center gap-1 text-[12.5px]" style={{ color: aviso.bien ? VERDE : ROJO }}>
              {aviso.bien && <Check className="h-[14px] w-[14px]" />} {aviso.texto}
            </motion.span>
          )}
          <span className="ml-auto text-[12px] text-[var(--ls-t4)]">{cambios.length ? `${cambios.length} ${cambios.length === 1 ? 'cambio' : 'cambios'} sin guardar` : ''}</span>
          <button
            type="button"
            disabled={cambios.length === 0 || guardando}
            onClick={() => void guardar()}
            className="inline-flex h-9 items-center gap-2 rounded-[10px] px-4 text-[13px] font-semibold text-[#141414] transition-opacity disabled:opacity-40"
            style={{ background: 'linear-gradient(135deg, #F26212, #FF8A3D)' }}
          >
            {guardando ? <Loader2 className="h-[14px] w-[14px] animate-spin" /> : <Save className="h-[14px] w-[14px]" />} Guardar
          </button>
        </div>
      </div>
    </div>
  )
}

function Chips<T extends string>({ valor, onCambio, opciones }: { valor: T; onCambio: (v: T) => void; opciones: Array<[T, string]> }) {
  return (
    <div className="inline-flex rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] p-[3px]">
      {opciones.map(([v, t]) => (
        <button key={v} type="button" onClick={() => onCambio(v)} className="relative h-7 rounded-[8px] px-3 text-[12px] transition-colors" style={{ color: valor === v ? 'var(--ls-t1)' : 'var(--ls-t3)' }}>
          {valor === v && <motion.span layoutId={`chip-${opciones.map((o) => o[0]).join('')}`} className="absolute inset-0 rounded-[8px] bg-[var(--ls-sup)] shadow-[var(--ls-sombra-1)]" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
          <span className="relative">{t}</span>
        </button>
      ))}
    </div>
  )
}
