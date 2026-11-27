'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { CalendarRange, Loader2, Package, Pencil, Plus, Receipt, Trash2, Truck, Upload, X } from 'lucide-react'
import { PanelLateral } from '@/components/ui-ls'
import type { CuentaDelPanel, PerfilEnvio } from '@/lib/ventas/panel-servidor'
import { aNumeroCoste, partirLinea } from '@/lib/ventas/costes-csv'
import { REGLAS_CON_TABLA, TABLA_INICIAL, type ReglaEnvio, type TablaEnvio } from '@/lib/ventas/envio'
import { Marco, TARJETA } from './TableroVentas'
import { SelectorDeCuenta } from './SelectorDeCuenta'
import { entero, fechaCorta } from './piezas'

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

const REGLA: Record<ReglaEnvio, string> = {
  ninguno: 'Sin gastos de envío',
  cobrado: 'Los gastos de envío equivalen al importe cobrado al cliente',
  precio: 'Los gastos de envío se basan en el precio del pedido',
  unidades: 'Los gastos de envío dependen del número de unidades',
  peso: 'Los gastos de envío se basan en el peso del paquete',
  pedido: 'Un importe fijo por pedido',
  unidad: 'Un importe fijo por unidad',
}
/** Las que se ofrecen (las de Sellerboard y el importe fijo por pedido). «Por unidad» solo sale si un perfil ya la tiene */
const REGLAS_OFRECIDAS: ReglaEnvio[] = ['ninguno', 'cobrado', 'precio', 'unidades', 'peso', 'pedido']
const simbolo = (m?: string) => (m === 'USD' ? '$' : '€')
const textoRegla = (p: Pick<PerfilEnvio, 'regla' | 'importe' | 'moneda'>) =>
  p.regla === 'pedido' ? `${p.importe.toLocaleString('es-ES', { minimumFractionDigits: 2 })} ${simbolo(p.moneda)} por pedido` : p.regla === 'unidad' ? `${p.importe.toLocaleString('es-ES', { minimumFractionDigits: 2 })} ${simbolo(p.moneda)} por unidad` : REGLA[p.regla]

/** Los países de la tabla (los mercados de Amazon en Europa y EE. UU.) */
const ZONAS: Array<[string, string]> = [
  ['ES', 'España'], ['FR', 'Francia'], ['IT', 'Italia'], ['DE', 'Alemania'], ['NL', 'Países Bajos'], ['BE', 'Bélgica'], ['PT', 'Portugal'], ['PL', 'Polonia'], ['SE', 'Suecia'], ['IE', 'Irlanda'], ['GB', 'Reino Unido'], ['US', 'Estados Unidos'], ['resto', 'Resto del mundo'],
]
const TOPE: Record<string, string> = { precio: 'Precio máximo del pedido', unidades: 'Unidades máximas del pedido', peso: 'Peso máximo del paquete (kg)' }
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
          <button type="button" disabled={!d?.hayTabla} onClick={() => setEditando({ nombre: perfiles.length ? 'Nuevo perfil' : 'Por defecto', prioridad: perfiles.length + 1, productos_modo: 'todos', skus: [], regla: 'precio', importe: 0, tabla: TABLA_INICIAL, moneda: 'EUR' })} className="inline-flex h-10 items-center justify-center gap-2 rounded-[12px] px-4 text-[12.5px] font-semibold text-[#141414] disabled:opacity-50" style={{ background: 'linear-gradient(135deg,#F26212,#FF8A3D)' }}>
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
      ancho={680}
      pie={
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCerrar} className="h-11 rounded-[11px] border border-[var(--ls-linea)] px-4 text-[13px] text-[var(--ls-t2)]">
            Cancelar
          </button>
          <button
            type="button"
            disabled={guardando}
            onClick={async () => {
              const fijo = p.regla === 'pedido' || p.regla === 'unidad'
              const n = aNumeroCoste(importe)
              if (fijo && (n == null || n < 0)) return setError('Pon el importe (por ejemplo 4,95).')
              const conTabla = REGLAS_CON_TABLA.includes(p.regla as ReglaEnvio)
              if (conTabla) {
                const t = p.tabla ?? TABLA_INICIAL
                if (!t.filas.some((f) => f.importes.some((v) => v != null))) return setError('Rellena al menos un importe en la tabla.')
                const topes = t.topes.filter((x): x is number => x != null)
                if (topes.some((x, i) => i > 0 && x <= topes[i - 1])) return setError('Los topes de las columnas tienen que ir de menor a mayor.')
              }
              setGuardando(true)
              try {
                await onGuardar({ ...p, importe: fijo ? (n ?? 0) : 0, tabla: conTabla ? (p.tabla ?? TABLA_INICIAL) : null, moneda: p.moneda ?? 'EUR', skus: skus.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean) })
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
          <label className={etiqueta}>Regla de cálculo de los gastos de envío</label>
          <select value={p.regla ?? 'cobrado'} onChange={(e) => setP({ ...p, regla: e.target.value as ReglaEnvio, tabla: REGLAS_CON_TABLA.includes(e.target.value as ReglaEnvio) ? (p.tabla ?? TABLA_INICIAL) : p.tabla })} className={campo}>
            {[...REGLAS_OFRECIDAS, ...(p.regla === 'unidad' ? (['unidad'] as ReglaEnvio[]) : [])].map((r) => (
              <option key={r} value={r}>
                {REGLA[r]}
              </option>
            ))}
          </select>
          {(p.regla === 'pedido' || p.regla === 'unidad' || REGLAS_CON_TABLA.includes(p.regla as ReglaEnvio)) && (
            <div className="mt-3 flex items-center gap-2">
              <label className="text-[12px] text-[var(--ls-t3)]">Moneda</label>
              <select value={p.moneda ?? 'EUR'} onChange={(e) => setP({ ...p, moneda: e.target.value === 'USD' ? 'USD' : 'EUR' })} className={`${campo} !h-9 !w-[90px]`}>
                <option value="EUR">€</option>
                <option value="USD">$</option>
              </select>
            </div>
          )}
          {(p.regla === 'pedido' || p.regla === 'unidad') && (
            <div className="mt-3 flex items-center gap-2">
              <input inputMode="decimal" value={importe} onChange={(e) => setImporte(e.target.value)} placeholder="4,95" className={`${campo} !w-[120px] text-right`} />
              <span className="text-[13px] text-[var(--ls-t3)]">
                {simbolo(p.moneda)} {p.regla === 'pedido' ? 'por pedido' : 'por unidad'}
              </span>
            </div>
          )}
          {REGLAS_CON_TABLA.includes(p.regla as ReglaEnvio) && <EditorTabla tabla={p.tabla ?? TABLA_INICIAL} regla={p.regla as ReglaEnvio} moneda={p.moneda} onCambio={(tabla) => setP({ ...p, tabla })} />}
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

/**
 * LA TABLA DE SELLERBOARD: un país por fila («resto del mundo» para los demás) y un tope por columna (precio, unidades o peso máximo; la última
 * puede ser sin límite, ∞). Cada pedido FBM paga el importe de su país y del primer tope que no supera.
 */
function EditorTabla({ tabla, regla, moneda, onCambio }: { tabla: TablaEnvio; regla: ReglaEnvio; moneda?: string; onCambio: (t: TablaEnvio) => void }) {
  const texto = (v: number | null) => (v == null ? '' : String(v).replace('.', ','))
  const num = (t: string) => {
    const x = t.trim().replace(',', '.')
    if (x === '') return null
    const n = Number(x)
    return Number.isFinite(n) && n >= 0 ? n : null
  }
  const usadas = new Set(tabla.filas.map((f) => f.zona))
  const celda = 'h-9 w-full rounded-[8px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-2 text-right text-[13px] tabular-nums text-[var(--ls-t1)] outline-none focus:border-[var(--ls-acc)]'
  const unidadTope = regla === 'precio' ? simbolo(moneda) : regla === 'peso' ? 'kg' : 'uds.'
  return (
    <div className="mt-4">
      <div className="overflow-x-auto rounded-[12px] border border-[var(--ls-linea)]">
        <table className="w-full text-[12.5px]">
          <thead className="bg-[var(--ls-sup2)]">
            <tr>
              <th rowSpan={2} className="min-w-[150px] px-3 py-2 text-left font-semibold text-[var(--ls-t2)]">Zona de expedición</th>
              <th colSpan={tabla.topes.length} className="px-3 pt-2 text-center text-[11.5px] font-semibold text-[var(--ls-t2)]">
                {TOPE[regla]}
              </th>
              <th rowSpan={2} className="w-[34px]" />
            </tr>
            <tr>
              {tabla.topes.map((t, i) => (
                <th key={i} className="min-w-[96px] px-[6px] pb-2 pt-1">
                  <div className="flex items-center gap-1">
                    <input value={texto(t)} placeholder="∞" onChange={(e) => onCambio({ ...tabla, topes: tabla.topes.map((x, j) => (j === i ? num(e.target.value) : x)) })} className={celda} aria-label={`Tope de la columna ${i + 1}`} title="Hasta este valor (vacío = sin límite)" />
                    <span className="text-[11px] font-normal text-[var(--ls-t4)]">{unidadTope}</span>
                    {tabla.topes.length > 1 && (
                      <button type="button" onClick={() => onCambio({ topes: tabla.topes.filter((_, j) => j !== i), filas: tabla.filas.map((f) => ({ ...f, importes: f.importes.filter((_, j) => j !== i) })) })} className="text-[var(--ls-t4)] hover:text-[#F87171]" title="Quitar la columna">
                        <X className="h-[13px] w-[13px]" />
                      </button>
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tabla.filas.map((f, i) => (
              <tr key={i} className="border-t border-[var(--ls-linea)]">
                <td className="px-2 py-[6px]">
                  <select value={f.zona} onChange={(e) => onCambio({ ...tabla, filas: tabla.filas.map((x, j) => (j === i ? { ...x, zona: e.target.value } : x)) })} className="h-9 w-full rounded-[8px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-2 text-[13px] text-[var(--ls-t1)] outline-none">
                    {ZONAS.filter(([z]) => z === f.zona || !usadas.has(z)).map(([z, nombre]) => (
                      <option key={z} value={z}>
                        {z === 'ES' ? 'Envíos nacionales (España)' : nombre}
                      </option>
                    ))}
                  </select>
                </td>
                {tabla.topes.map((_, j) => (
                  <td key={j} className="px-[6px] py-[6px]">
                    <div className="flex items-center gap-1">
                      <input
                        inputMode="decimal"
                        value={texto(f.importes[j] ?? null)}
                        placeholder="—"
                        onChange={(e) => onCambio({ ...tabla, filas: tabla.filas.map((x, k) => (k === i ? { ...x, importes: tabla.topes.map((__, m) => (m === j ? num(e.target.value) : (x.importes[m] ?? null))) } : x)) })}
                        className={celda}
                        aria-label={`Importe de ${f.zona}, columna ${j + 1}`}
                      />
                      <span className="text-[11px] text-[var(--ls-t4)]">{simbolo(moneda)}</span>
                    </div>
                  </td>
                ))}
                <td className="pr-2 text-center">
                  {tabla.filas.length > 1 && (
                    <button type="button" onClick={() => onCambio({ ...tabla, filas: tabla.filas.filter((_, j) => j !== i) })} className="text-[var(--ls-t4)] hover:text-[#F87171]" title="Quitar la fila">
                      <Trash2 className="h-[13px] w-[13px]" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={usadas.size >= ZONAS.length}
          onClick={() => {
            const libre = ZONAS.find(([z]) => !usadas.has(z))?.[0]
            if (!libre) return
            // «Resto del mundo» siempre la última
            const filas = [...tabla.filas.filter((x) => x.zona !== 'resto'), { zona: libre, importes: tabla.topes.map(() => null) }, ...tabla.filas.filter((x) => x.zona === 'resto')]
            onCambio({ ...tabla, filas })
          }}
          className="inline-flex h-9 items-center gap-1 rounded-[10px] border border-[var(--ls-linea)] px-3 text-[12.5px] text-[var(--ls-t2)] hover:text-[var(--ls-t1)] disabled:opacity-40"
        >
          <Plus className="h-[13px] w-[13px]" /> Añadir fila
        </button>
        <button
          type="button"
          disabled={tabla.topes.length >= 8}
          onClick={() => {
            // La nueva va antes de la de «sin límite»
            const fin = tabla.topes[tabla.topes.length - 1] === null
            const pos = fin ? tabla.topes.length - 1 : tabla.topes.length
            const meter = <T,>(xs: T[], v: T) => [...xs.slice(0, pos), v, ...xs.slice(pos)]
            onCambio({ topes: meter(tabla.topes, null as number | null), filas: tabla.filas.map((f) => ({ ...f, importes: meter(tabla.topes.map((_, m) => f.importes[m] ?? null), null as number | null) })) })
          }}
          className="inline-flex h-9 items-center gap-1 rounded-[10px] border border-[var(--ls-linea)] px-3 text-[12.5px] text-[var(--ls-t2)] hover:text-[var(--ls-t1)] disabled:opacity-40"
        >
          <Plus className="h-[13px] w-[13px]" /> Añadir columna
        </button>
      </div>
      <p className="mt-2 text-[11.5px] leading-[1.5] text-[var(--ls-t4)]">
        Cada pedido FBM paga el importe de su país (el del mercado de Amazon) y de la primera columna que no supera. Vacío en la cabecera = sin límite. Un hueco vacío = lo cobrado al cliente.
        {regla === 'peso' && ' El peso sale del de cada producto en Amazon.'}
      </p>
    </div>
  )
}
