'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { CalendarRange, Loader2, Package, Pencil, Plus, Receipt, Trash2, Truck, Upload } from 'lucide-react'
import { PanelLateral } from '@/components/ui-ls'
import type { CuentaDelPanel, PerfilEnvio } from '@/lib/ventas/panel-servidor'
import { aNumeroCoste, partirLinea } from '@/lib/ventas/costes-csv'
import { Marco, TARJETA } from './TableroVentas'
import { SelectorDeCuenta } from './SelectorDeCuenta'
import { entero, euros, fechaCorta } from './piezas'

/**
 * VENTAS · COSTO DE ENVÍO (como la página de Sellerboard). Lo que cuesta mandar los pedidos FBM (los que envía el vendedor), por perfiles: a qué
 * productos y fechas se aplica cada uno y cómo se calcula (lo cobrado al comprador, un importe por pedido o por unidad). Sin perfiles, el coste es lo
 * que pagó el comprador por el envío. El coste real de pedidos concretos se puede importar (CSV «pedido;coste») y manda sobre los perfiles.
 */

async function pedir<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { cache: 'no-store', ...init })
  const j = (await r.json().catch(() => null)) as (T & { error?: string }) | null
  if (!r.ok) throw new Error(j?.error ?? `Error ${r.status}`)
  return j as T
}
const enviar = <T,>(cuerpo: Record<string, unknown>) => pedir<T>('/api/ventas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) })

const REGLA: Record<PerfilEnvio['regla'], string> = {
  cobrado: 'Los gastos de envío equivalen al importe cobrado al cliente',
  pedido: 'Un importe fijo por pedido',
  unidad: 'Un importe fijo por unidad',
}
const textoRegla = (p: Pick<PerfilEnvio, 'regla' | 'importe'>) => (p.regla === 'cobrado' ? REGLA.cobrado : p.regla === 'pedido' ? `${euros(p.importe)} por pedido` : `${euros(p.importe)} por unidad`)
const textoProductos = (p: Pick<PerfilEnvio, 'productos_modo' | 'skus'>) => (p.productos_modo === 'todos' ? 'Todos los productos' : p.productos_modo === 'solo' ? `Solo ${p.skus.length} productos` : `Todos menos ${p.skus.length}`)
const textoPeriodo = (p: Pick<PerfilEnvio, 'desde' | 'hasta'>) => (!p.desde && !p.hasta ? 'Sin límite' : `${p.desde ? fechaCorta(p.desde) : 'Siempre'} – ${p.hasta ? fechaCorta(p.hasta) : 'sin fin'}`)

export function CostoDeEnvio() {
  const [cuentas, setCuentas] = useState<CuentaDelPanel[] | null>(null)
  const [cuentaId, setCuentaId] = useState<string | null>(null)
  const [d, setD] = useState<{ hayTabla: boolean; perfiles: PerfilEnvio[]; importados: number; ultimoImportado: string | null } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [editando, setEditando] = useState<Partial<PerfilEnvio> | null>(null)
  const [subiendo, setSubiendo] = useState(false)
  const fichero = useRef<HTMLInputElement>(null)

  useEffect(() => {
    pedir<{ cuentas: CuentaDelPanel[] }>('/api/ventas?que=cuentas')
      .then((r) => {
        setCuentas(r.cuentas)
        const enUrl = new URLSearchParams(window.location.search).get('cuenta')
        setCuentaId(r.cuentas.find((c) => c.id === enUrl)?.id ?? r.cuentas[0]?.id ?? null)
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [])
  const cargar = useCallback(() => {
    if (!cuentaId) return
    pedir<NonNullable<typeof d>>(`/api/ventas?que=envio&cuenta=${cuentaId}`)
      .then((x) => (setD(x), setError(null)))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [cuentaId])
  useEffect(() => {
    setD(null)
    cargar()
  }, [cargar])

  const importar = async (f: File) => {
    if (!cuentaId) return
    setSubiendo(true)
    setAviso(null)
    try {
      const texto = await f.text()
      const lineas = texto.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim())
      const sep = [';', '\t', ','].find((x) => (lineas[0] ?? '').includes(x)) ?? ';'
      const filas = lineas
        .map((l) => partirLinea(l, sep))
        .map((c) => ({ pedido: (c[0] ?? '').trim(), coste: aNumeroCoste(c[1]) }))
        .filter((x): x is { pedido: string; coste: number } => /^[0-9A-Za-z-]{5,40}$/.test(x.pedido) && x.coste != null)
      if (!filas.length) throw new Error('No he encontrado ninguna fila «pedido;coste» en el fichero.')
      const r = await enviar<{ guardados: number; sinCasar: number }>({ accion: 'envio-csv', cuenta: cuentaId, filas })
      setAviso(`Importados ${entero(r.guardados)} pedidos${r.sinCasar ? ` (${entero(r.sinCasar)} no están entre los pedidos de los últimos 62 días y no cuentan)` : ''}.`)
      cargar()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSubiendo(false)
      if (fichero.current) fichero.current.value = ''
    }
  }

  const perfiles = d?.perfiles ?? []
  return (
    <Marco
      titulo="Costo de envío"
      subtitulo="Lo que cuesta mandar los pedidos FBM (los que envía el cliente), para que la ganancia neta lo descuente"
      icono={Truck}
      acciones={cuentas && <SelectorDeCuenta cuentas={cuentas} valor={cuentaId} onCambio={(id) => (setCuentaId(id), window.history.replaceState(null, '', `?cuenta=${id}`))} />}
    >
      {error && <p className="mb-4 rounded-[12px] border border-[color-mix(in_srgb,#F87171_40%,transparent)] px-4 py-3 text-[12.5px] text-[#F87171]">{error}</p>}
      {aviso && <p className="mb-4 rounded-[12px] border border-[color-mix(in_srgb,#34D399_40%,transparent)] px-4 py-3 text-[12.5px] text-[#34D399]">{aviso}</p>}
      {d && !d.hayTabla && <p className="mb-4 rounded-[12px] border border-[color-mix(in_srgb,#F5B942_40%,transparent)] px-4 py-3 text-[12.5px] text-[#F5B942]">Falta lanzar la migración 349. Hasta entonces el panel no descuenta ningún coste de envío.</p>}

      <div className={`${TARJETA} overflow-hidden`}>
        <div className="flex flex-col gap-3 border-b border-[var(--ls-linea)] px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div>
            <div className="text-[15px] font-semibold text-[var(--ls-t1)]">Perfiles de expedición</div>
            <div className="text-[12px] text-[var(--ls-t4)]">Si un pedido encaja en varios, se aplica el de prioridad más alta (1 = el primero)</div>
          </div>
          <button type="button" disabled={!d?.hayTabla} onClick={() => setEditando({ nombre: perfiles.length ? 'Nuevo perfil' : 'Por defecto', prioridad: perfiles.length + 1, productos_modo: 'todos', skus: [], regla: 'pedido', importe: 0 })} className="inline-flex h-10 items-center justify-center gap-2 rounded-[12px] px-4 text-[12.5px] font-semibold text-[#141414] disabled:opacity-50" style={{ background: 'linear-gradient(135deg,#F26212,#FF8A3D)' }}>
            <Plus className="h-[14px] w-[14px]" /> Añadir perfil
          </button>
        </div>

        {!d ? (
          <div className="m-4 h-[120px] animate-pulse rounded-[14px] bg-[var(--ls-sup2)]" />
        ) : (
          <div className="flex flex-col">
            {perfiles.length === 0 && <Fila perfil={{ nombre: 'Por defecto', desde: null, hasta: null, productos_modo: 'todos', skus: [], regla: 'cobrado', importe: 0 }} nota="Mientras no haya perfiles, se usa este" />}
            {perfiles.map((p, i) => (
              <motion.div key={p.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
                <Fila
                  perfil={p}
                  onEditar={() => setEditando(p)}
                  onBorrar={async () => {
                    if (!cuentaId || !window.confirm(`¿Borrar el perfil «${p.nombre}»?`)) return
                    await enviar({ accion: 'envio-borrar', cuenta: cuentaId, id: p.id }).catch((e) => setError(e instanceof Error ? e.message : String(e)))
                    cargar()
                  }}
                />
              </motion.div>
            ))}
          </div>
        )}

        <div className="flex flex-col gap-3 border-t border-[var(--ls-linea)] px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <button type="button" disabled={!d?.hayTabla || subiendo} onClick={() => fichero.current?.click()} className="inline-flex items-center gap-2 text-[13px] font-medium text-[var(--ls-t2)] hover:text-[var(--ls-t1)] disabled:opacity-50">
            {subiendo ? <Loader2 className="h-[15px] w-[15px] animate-spin" /> : <Upload className="h-[15px] w-[15px]" />}
            Gastos de envío de importación por pedido
          </button>
          <span className="text-[12px] text-[var(--ls-t4)]">
            CSV «pedido;coste» · {d?.importados ? `${entero(d.importados)} pedidos con el coste importado` : 'ninguno importado aún'}
          </span>
          <input ref={fichero} type="file" accept=".csv,.txt,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && importar(e.target.files[0])} />
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
        <Nota icono={Package} titulo="Solo pedidos FBM" texto="Los pedidos FBA los envía Amazon y su coste ya va en las tarifas. Esto es para lo que manda el cliente desde su almacén." />
        <Nota icono={Receipt} titulo="Por defecto, lo cobrado" texto="Sin perfiles, el coste del envío es lo que pagó el comprador por él: no gana ni pierde con el envío, como en Sellerboard." />
        <Nota icono={CalendarRange} titulo="El importado manda" texto="Si importas el coste real de un pedido, ese pedido usa su coste y no el del perfil." />
      </div>

      <EditarPerfil
        perfil={editando}
        onCerrar={() => setEditando(null)}
        onGuardar={async (p) => {
          if (!cuentaId) return
          await enviar({ accion: 'envio-perfil', cuenta: cuentaId, perfil: p })
          setEditando(null)
          cargar()
        }}
      />
    </Marco>
  )
}

function Fila({ perfil: p, nota, onEditar, onBorrar }: { perfil: Pick<PerfilEnvio, 'nombre' | 'desde' | 'hasta' | 'productos_modo' | 'skus' | 'regla' | 'importe'> & { prioridad?: number }; nota?: string; onEditar?: () => void; onBorrar?: () => void }) {
  return (
    <div className="grid grid-cols-1 gap-2 border-b border-[var(--ls-linea)] px-4 py-4 last:border-0 sm:px-5 md:grid-cols-[1.2fr_1fr_1.1fr_2fr_auto] md:items-center md:gap-4">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[color-mix(in_srgb,#F26212_14%,transparent)] text-[#FF8A3D]">
          <Truck className="h-[16px] w-[16px]" />
        </span>
        <div className="min-w-0">
          <div className="truncate text-[13.5px] font-semibold text-[var(--ls-t1)]">{p.nombre}</div>
          {nota ? <div className="text-[11px] text-[var(--ls-t4)]">{nota}</div> : p.prioridad != null && <div className="text-[11px] text-[var(--ls-t4)]">Prioridad {p.prioridad}</div>}
        </div>
      </div>
      <Dato etiqueta="Periodo" valor={textoPeriodo(p)} />
      <Dato etiqueta="Productos" valor={textoProductos(p)} />
      <Dato etiqueta="Regla de cálculo" valor={textoRegla(p)} fuerte />
      <div className="flex justify-end gap-1">
        {onEditar && (
          <button type="button" onClick={onEditar} className="rounded-[8px] p-2 text-[var(--ls-t3)] hover:bg-[var(--ls-sup2)] hover:text-[var(--ls-t1)]" aria-label="Editar" title="Editar">
            <Pencil className="h-[15px] w-[15px]" />
          </button>
        )}
        {onBorrar && (
          <button type="button" onClick={onBorrar} className="rounded-[8px] p-2 text-[var(--ls-t3)] hover:bg-[var(--ls-sup2)] hover:text-[#F87171]" aria-label="Borrar" title="Borrar">
            <Trash2 className="h-[15px] w-[15px]" />
          </button>
        )}
      </div>
    </div>
  )
}

function Dato({ etiqueta, valor, fuerte }: { etiqueta: string; valor: string; fuerte?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 md:block">
      <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--ls-t4)] md:mb-[2px]">{etiqueta}</div>
      <div className={`text-right text-[13px] md:text-left ${fuerte ? 'font-medium text-[var(--ls-t1)]' : 'text-[var(--ls-t2)]'}`}>{valor}</div>
    </div>
  )
}

function Nota({ icono: Icono, titulo, texto }: { icono: typeof Truck; titulo: string; texto: string }) {
  return (
    <div className={`${TARJETA} p-4`}>
      <div className="flex items-center gap-2 text-[13px] font-semibold text-[var(--ls-t1)]">
        <Icono className="h-[15px] w-[15px] text-[#FF8A3D]" />
        {titulo}
      </div>
      <p className="mt-1 text-[12px] leading-[1.5] text-[var(--ls-t3)]">{texto}</p>
    </div>
  )
}

function EditarPerfil({ perfil, onCerrar, onGuardar }: { perfil: Partial<PerfilEnvio> | null; onCerrar: () => void; onGuardar: (p: Partial<PerfilEnvio>) => Promise<void> }) {
  const [p, setP] = useState<Partial<PerfilEnvio>>({})
  const [skus, setSkus] = useState('')
  const [importe, setImporte] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (perfil) {
      setP(perfil)
      setSkus((perfil.skus ?? []).join('\n'))
      setImporte(perfil.importe ? String(perfil.importe).replace('.', ',') : '')
      setError(null)
    }
  }, [perfil])
  const campo = 'h-11 w-full rounded-[11px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-3 text-[14px] text-[var(--ls-t1)] outline-none focus:border-[var(--ls-acc)]'
  const etiqueta = 'mb-[6px] block text-[11.5px] font-semibold text-[var(--ls-t3)]'
  return (
    <PanelLateral
      abierto={Boolean(perfil)}
      onCambio={(a) => !a && onCerrar()}
      titulo={p.id ? 'Editar perfil' : 'Añadir perfil'}
      descripcion="Cómo se calcula lo que cuesta enviar los pedidos FBM de estos productos y fechas."
      icono={Truck}
      acento="marca"
      ancho={500}
      pie={
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCerrar} className="h-11 rounded-[11px] border border-[var(--ls-linea)] px-4 text-[13px] text-[var(--ls-t2)]">
            Cancelar
          </button>
          <button
            type="button"
            disabled={guardando}
            onClick={async () => {
              const n = aNumeroCoste(importe)
              if (p.regla !== 'cobrado' && (n == null || n < 0)) return setError('Pon el importe en euros (por ejemplo 4,95).')
              setGuardando(true)
              try {
                await onGuardar({ ...p, importe: p.regla === 'cobrado' ? 0 : (n ?? 0), skus: skus.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean) })
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e))
              } finally {
                setGuardando(false)
              }
            }}
            className="inline-flex h-11 items-center gap-2 rounded-[11px] px-5 text-[13px] font-semibold text-[#141414] disabled:opacity-60"
            style={{ background: 'linear-gradient(135deg,#F26212,#FF8A3D)' }}
          >
            {guardando && <Loader2 className="h-[14px] w-[14px] animate-spin" />}
            Guardar
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        {error && <p className="text-[12.5px] text-[#F87171]">{error}</p>}
        <div className="grid grid-cols-[1fr_96px] gap-3">
          <div>
            <label className={etiqueta}>Nombre</label>
            <input value={p.nombre ?? ''} onChange={(e) => setP({ ...p, nombre: e.target.value })} className={campo} />
          </div>
          <div>
            <label className={etiqueta}>Prioridad</label>
            <input type="number" min={1} max={99} value={p.prioridad ?? 1} onChange={(e) => setP({ ...p, prioridad: Number(e.target.value) })} className={campo} />
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className={etiqueta}>Desde (vacío = siempre)</label>
            <input type="date" value={p.desde ?? ''} onChange={(e) => setP({ ...p, desde: e.target.value || null })} className={`${campo} [color-scheme:dark]`} />
          </div>
          <div>
            <label className={etiqueta}>Hasta (vacío = sin fin)</label>
            <input type="date" value={p.hasta ?? ''} onChange={(e) => setP({ ...p, hasta: e.target.value || null })} className={`${campo} [color-scheme:dark]`} />
          </div>
        </div>
        <div>
          <label className={etiqueta}>Regla de cálculo</label>
          <div className="flex flex-col gap-2">
            {(['cobrado', 'pedido', 'unidad'] as const).map((r) => (
              <label key={r} className="flex cursor-pointer items-center gap-2 rounded-[11px] border px-3 py-[10px] text-[13px] text-[var(--ls-t2)]" style={{ borderColor: p.regla === r ? '#F26212' : 'var(--ls-linea)', background: p.regla === r ? 'color-mix(in srgb,#F26212 10%,transparent)' : 'transparent' }}>
                <input type="radio" checked={p.regla === r} onChange={() => setP({ ...p, regla: r })} className="accent-[#F26212]" />
                {REGLA[r]}
              </label>
            ))}
          </div>
          {p.regla && p.regla !== 'cobrado' && (
            <div className="mt-3 flex items-center gap-2">
              <input inputMode="decimal" value={importe} onChange={(e) => setImporte(e.target.value)} placeholder="4,95" className={`${campo} !w-[120px] text-right`} />
              <span className="text-[13px] text-[var(--ls-t3)]">€ {p.regla === 'pedido' ? 'por pedido' : 'por unidad'}</span>
            </div>
          )}
        </div>
        <div>
          <label className={etiqueta}>Productos</label>
          <div className="flex flex-col gap-2">
            {(
              [
                ['todos', 'Todos los productos'],
                ['solo', 'Solo los elegidos'],
                ['excepto', 'Todos menos los elegidos'],
              ] as const
            ).map(([id, texto]) => (
              <label key={id} className="flex cursor-pointer items-center gap-2 text-[13px] text-[var(--ls-t2)]">
                <input type="radio" checked={(p.productos_modo ?? 'todos') === id} onChange={() => setP({ ...p, productos_modo: id })} className="accent-[#F26212]" />
                {texto}
              </label>
            ))}
          </div>
          {p.productos_modo && p.productos_modo !== 'todos' && <textarea value={skus} onChange={(e) => setSkus(e.target.value)} rows={5} placeholder="Los SKU, uno por línea" className={`${campo} mt-3 !h-auto py-2 font-mono text-[12px]`} />}
        </div>
      </div>
    </PanelLateral>
  )
}
