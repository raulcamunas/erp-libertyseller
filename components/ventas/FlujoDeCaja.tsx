'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Download, Landmark, Loader2, Pencil, Plus, RefreshCw, Settings2, Trash2, Undo2, Upload, Wallet } from 'lucide-react'
import { PanelLateral } from '@/components/ui-ls'
import type { CuentaDelPanel } from '@/lib/ventas/panel-servidor'
import { construirFlujo, leerApuntesCsv, NOMBRE_TIPO, SIGNO_TIPO, TIPOS_FLUJO, type ApunteFlujo, type PagoAmazon, type PeriodoFlujo, type TipoFlujo } from '@/lib/ventas/flujo'
import { Marco, TARJETA } from './TableroVentas'
import { SelectorDeCuenta } from './SelectorDeCuenta'
import { euros, fechaCorta } from './piezas'

/**
 * VENTAS · FLUJO DE CAJA (como la página de Sellerboard). Por cada liquidación de Amazon (~14 días): el pago que llega al banco y los apuntes a
 * mano (inversiones, gastos, compra de bienes, dividendos, IVA). Arriba el gráfico (barras por tipo, la diferencia y el efectivo en mano
 * acumulado), debajo cada periodo con sus movimientos. La liquidación abierta y las siguientes son pronóstico (línea discontinua).
 */

interface Datos {
  hayTabla: boolean
  leidoAt: string | null
  pagos: PagoAmazon[]
  apuntes: ApunteFlujo[]
}

async function pedir<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { cache: 'no-store', ...init })
  const j = (await r.json().catch(() => null)) as (T & { error?: string }) | null
  if (!r.ok) throw new Error(j?.error ?? `Error ${r.status}`)
  return j as T
}
const enviar = <T,>(cuerpo: Record<string, unknown>) => pedir<T>('/api/ventas/flujo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) })

const COLOR: Record<TipoFlujo, string> = { pago: '#34D399', inversion: '#2DD4BF', gasto: '#F87171', compra: '#FB923C', dividendo: '#F472B6', iva: '#FBBF24' }
const COLOR_EFECTIVO = '#FF8A3D'
const COLOR_DIFERENCIA = '#9CA3AF'
type Serie = TipoFlujo | 'diferencia' | 'efectivo'
const SERIES: Array<[Serie, string]> = [...TIPOS_FLUJO.map((t) => [t, NOMBRE_TIPO[t]] as [Serie, string]), ['diferencia', 'Diferencia'], ['efectivo', 'Efectivo en mano']]
const RANGOS: Array<[string, string, number | null]> = [
  ['3m', 'Últimos 3 meses', 92],
  ['6m', 'Últimos 6 meses', 183],
  ['12m', 'Últimos 12 meses', 366],
  ['todo', 'Todo', null],
]
const PREFS = 'ventas-flujo-prefs'
const hoyIso = () => new Date().toISOString().slice(0, 10)
const corta = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}`

export function FlujoDeCaja() {
  const [cuentas, setCuentas] = useState<CuentaDelPanel[] | null>(null)
  const [cuentaId, setCuentaId] = useState<string | null>(null)
  const [d, setD] = useState<Datos | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [leyendo, setLeyendo] = useState(false)
  const [editando, setEditando] = useState<Partial<ApunteFlujo> | null>(null)
  const [rango, setRango] = useState('12m')
  const [ocultas, setOcultas] = useState<Serie[]>([])
  const [sinPronostico, setSinPronostico] = useState(false)
  const [config, setConfig] = useState(false)
  const fichero = useRef<HTMLInputElement>(null)

  useEffect(() => {
    try {
      const p = JSON.parse(localStorage.getItem(PREFS) ?? 'null') as { rango?: string; ocultas?: Serie[]; sinPronostico?: boolean } | null
      if (p?.rango) setRango(p.rango)
      if (Array.isArray(p?.ocultas)) setOcultas(p.ocultas)
      if (typeof p?.sinPronostico === 'boolean') setSinPronostico(p.sinPronostico)
    } catch {
      /* sin preferencias guardadas */
    }
  }, [])
  const guardarPrefs = (x: { rango?: string; ocultas?: Serie[]; sinPronostico?: boolean }) => {
    try {
      localStorage.setItem(PREFS, JSON.stringify({ rango, ocultas, sinPronostico, ...x }))
    } catch {
      /* da igual */
    }
  }

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
    pedir<Datos>(`/api/ventas/flujo?cuenta=${cuentaId}`)
      .then((x) => (setD(x), setError(null)))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [cuentaId])
  useEffect(() => {
    setD(null)
    setAviso(null)
    cargar()
  }, [cargar])

  const leerAhora = useCallback(async () => {
    if (!cuentaId) return
    setLeyendo(true)
    setAviso(null)
    try {
      const r = await enviar<{ liquidaciones: number }>({ accion: 'leer', cuenta: cuentaId })
      setAviso(`${r.liquidaciones} liquidaciones leídas de Amazon.`)
      cargar()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLeyendo(false)
    }
  }, [cuentaId, cargar])
  // La primera vez que se abre una cuenta sin pagos leídos, se leen solos
  const yaPedido = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (!cuentaId || !d?.hayTabla || d.leidoAt || leyendo || yaPedido.current.has(cuentaId)) return
    yaPedido.current.add(cuentaId)
    void leerAhora()
  }, [cuentaId, d, leyendo, leerAhora])

  const todos = useMemo(() => (d ? construirFlujo(d.pagos, d.apuntes, hoyIso(), sinPronostico ? 0 : 2) : []), [d, sinPronostico])
  const periodos = useMemo(() => {
    const dias = RANGOS.find((r) => r[0] === rango)?.[2]
    if (!dias) return todos
    const desde = new Date(Date.now() - dias * 86_400_000).toISOString().slice(0, 10)
    return todos.filter((p) => p.hasta >= desde)
  }, [todos, rango])
  const ocultosDeAmazon = d?.pagos.filter((p) => p.oculto) ?? []

  const exportar = () => {
    const filas = [['Fecha', 'Descripción', 'Tipo', 'Importe', 'Efectivo en mano', 'Previsto']]
    for (const p of todos) for (const e of p.entradas) filas.push([fechaCorta(e.fecha), e.descripcion.replace(/;/g, ','), NOMBRE_TIPO[e.tipo], e.importe.toFixed(2).replace('.', ','), e.efectivo.toFixed(2).replace('.', ','), e.previsto ? 'sí' : ''])
    const blob = new Blob(['﻿' + filas.map((f) => f.join(';')).join('\n')], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    const c = cuentas?.find((x) => x.id === cuentaId)
    a.download = `flujo-de-caja-${(c?.cliente ?? c?.nombre ?? 'cuenta').toLowerCase().replace(/\s+/g, '-')}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }
  const importar = async (f: File) => {
    if (!cuentaId) return
    const { apuntes, errores } = leerApuntesCsv(await f.text())
    if (fichero.current) fichero.current.value = ''
    if (apuntes.length === 0) {
      setError('El fichero no trae ningún apunte válido. Columnas: fecha;descripción;tipo;importe (tipo: Inversiones, Gastos, Compra de bienes, Dividendos, IVA o Pagos).')
      return
    }
    try {
      const r = await enviar<{ guardados: number }>({ accion: 'importar', cuenta: cuentaId, apuntes })
      setAviso(`${r.guardados} apuntes importados${errores ? ` · ${errores} filas no se entendieron` : ''}.`)
      cargar()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const efectivoHoy = todos.filter((p) => !p.previsto).at(-1)?.efectivo ?? 0
  const pendiente = todos.find((p) => p.previsto)?.porTipo.pago ?? 0

  return (
    <Marco
      titulo="Flujo de caja"
      subtitulo="Lo que Amazon paga en cada liquidación y lo que entra y sale a mano: el efectivo que tiene el cliente en cada momento"
      icono={Wallet}
      acciones={cuentas && <SelectorDeCuenta cuentas={cuentas} valor={cuentaId} onCambio={(id) => (setCuentaId(id), window.history.replaceState(null, '', `?cuenta=${id}`))} />}
    >
      {error && <p className="mb-4 rounded-[12px] border border-[color-mix(in_srgb,#F87171_40%,transparent)] px-4 py-3 text-[12.5px] text-[#F87171]">{error}</p>}
      {aviso && <p className="mb-4 rounded-[12px] border border-[color-mix(in_srgb,#34D399_40%,transparent)] px-4 py-3 text-[12.5px] text-[#34D399]">{aviso}</p>}
      {d && !d.hayTabla && <p className="mb-4 rounded-[12px] border border-[color-mix(in_srgb,#F5B942_40%,transparent)] px-4 py-3 text-[12.5px] text-[#F5B942]">Falta lanzar la migración 352. Hasta entonces no se pueden leer los pagos ni guardar apuntes.</p>}

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Cifra titulo="Efectivo en mano" valor={euros(efectivoHoy)} nota="Al cierre de la última liquidación pagada" color={COLOR_EFECTIVO} />
        <Cifra titulo="Amazon aún no ha pagado" valor={euros(pendiente)} nota="Lo acumulado en la liquidación abierta" color={COLOR.pago} />
        <Cifra titulo="Pagos de Amazon" valor={String(d?.pagos.filter((p) => !p.abierto && !p.oculto).length ?? '—')} nota={d?.leidoAt ? `Leídos el ${new Date(d.leidoAt).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })}` : 'Aún sin leer'} color="#A78BFA" />
      </div>

      <div className={`${TARJETA} overflow-visible`}>
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--ls-linea)] px-4 py-3 sm:px-5">
          <select value={rango} onChange={(e) => (setRango(e.target.value), guardarPrefs({ rango: e.target.value }))} className="h-9 rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-3 text-[12.5px] text-[var(--ls-t1)]">
            {RANGOS.map(([k, t]) => (
              <option key={k} value={k}>
                {t} por pago
              </option>
            ))}
          </select>
          <button type="button" disabled={leyendo || !d?.hayTabla} onClick={leerAhora} className="inline-flex h-9 items-center gap-2 rounded-[10px] border border-[var(--ls-linea)] px-3 text-[12.5px] text-[var(--ls-t2)] hover:text-[var(--ls-t1)] disabled:opacity-50">
            {leyendo ? <Loader2 className="h-[14px] w-[14px] animate-spin" /> : <RefreshCw className="h-[14px] w-[14px]" />} Leer pagos de Amazon
          </button>
          <div className="relative ml-auto">
            <button type="button" onClick={() => setConfig((x) => !x)} className="inline-flex h-9 items-center gap-2 rounded-[10px] px-3 text-[12.5px] text-[var(--ls-acc)] hover:bg-[var(--ls-sup2)]">
              <Settings2 className="h-[14px] w-[14px]" /> Configuración
            </button>
            {config && (
              <>
                <button type="button" aria-label="Cerrar" className="fixed inset-0 z-20 cursor-default" onClick={() => setConfig(false)} />
                <div className="absolute right-0 top-10 z-30 w-[230px] rounded-[14px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] p-2 shadow-[var(--ls-sombra-3)]">
                  {SERIES.map(([k, t]) => (
                    <label key={k} className="flex cursor-pointer items-center gap-2 rounded-[8px] px-2 py-[7px] text-[12.5px] text-[var(--ls-t2)] hover:bg-[var(--ls-sup2)]">
                      <input
                        type="checkbox"
                        checked={!ocultas.includes(k)}
                        onChange={() => {
                          const n = ocultas.includes(k) ? ocultas.filter((x) => x !== k) : [...ocultas, k]
                          setOcultas(n)
                          guardarPrefs({ ocultas: n })
                        }}
                        className="accent-[#F26212]"
                      />
                      <span className="h-[9px] w-[9px] rounded-[3px]" style={{ background: k === 'efectivo' ? COLOR_EFECTIVO : k === 'diferencia' ? COLOR_DIFERENCIA : COLOR[k] }} />
                      {t}
                    </label>
                  ))}
                  <div className="my-1 border-t border-[var(--ls-linea)]" />
                  <label className="flex cursor-pointer items-center gap-2 rounded-[8px] px-2 py-[7px] text-[12.5px] text-[var(--ls-t2)] hover:bg-[var(--ls-sup2)]">
                    <input type="checkbox" checked={sinPronostico} onChange={() => (setSinPronostico(!sinPronostico), guardarPrefs({ sinPronostico: !sinPronostico }))} className="accent-[#F26212]" />
                    Ocultar pronóstico
                  </label>
                </div>
              </>
            )}
          </div>
        </div>
        {!d ? <div className="m-4 h-[300px] animate-pulse rounded-[14px] bg-[var(--ls-sup2)]" /> : periodos.length === 0 ? <p className="px-5 py-12 text-center text-[13px] text-[var(--ls-t4)]">Aún no hay pagos ni apuntes.</p> : <Grafico periodos={periodos} ocultas={ocultas} />}
      </div>

      <div className={`${TARJETA} mt-4 overflow-hidden`}>
        {[...periodos].reverse().map((p) => (
          <Periodo
            key={p.desde}
            p={p}
            onEditar={(id) => {
              const a = d?.apuntes.find((x) => x.id === id)
              if (a) setEditando(a)
            }}
            onBorrar={async (e) => {
              if (!cuentaId || !e.ref) return
              if (e.origen === 'amazon') {
                if (!window.confirm('¿Quitar este pago de Amazon del flujo de caja? Se puede recuperar abajo.')) return
                await enviar({ accion: 'ocultar-pago', cuenta: cuentaId, grupo: e.ref, oculto: true }).catch((x) => setError(String(x)))
              } else {
                if (!window.confirm(`¿Borrar «${e.descripcion || NOMBRE_TIPO[e.tipo]}»?`)) return
                await enviar({ accion: 'borrar', cuenta: cuentaId, id: e.ref }).catch((x) => setError(String(x)))
              }
              cargar()
            }}
          />
        ))}
        {ocultosDeAmazon.length > 0 && (
          <div className="border-t border-[var(--ls-linea)] px-4 py-3 text-[12px] text-[var(--ls-t4)] sm:px-5">
            {ocultosDeAmazon.length} pagos de Amazon quitados ·{' '}
            {ocultosDeAmazon.slice(0, 6).map((p) => (
              <button
                key={p.grupo}
                type="button"
                onClick={async () => {
                  if (!cuentaId) return
                  await enviar({ accion: 'ocultar-pago', cuenta: cuentaId, grupo: p.grupo, oculto: false }).catch((x) => setError(String(x)))
                  cargar()
                }}
                className="mr-2 inline-flex items-center gap-1 text-[var(--ls-acc)] hover:underline"
              >
                <Undo2 className="h-[12px] w-[12px]" /> {p.fin ? fechaCorta(p.fin) : 'abierta'} ({euros(p.importe)})
              </button>
            ))}
          </div>
        )}
        <div className="sticky bottom-0 flex flex-wrap items-center gap-4 border-t border-[var(--ls-linea)] bg-[var(--ls-sup)] px-4 py-3 sm:px-5">
          <button type="button" disabled={!d?.hayTabla} onClick={() => fichero.current?.click()} className="inline-flex items-center gap-2 text-[13px] text-[var(--ls-t2)] hover:text-[var(--ls-t1)] disabled:opacity-50">
            <Upload className="h-[15px] w-[15px]" /> Importar
          </button>
          <button type="button" onClick={exportar} className="inline-flex items-center gap-2 text-[13px] text-[var(--ls-t2)] hover:text-[var(--ls-t1)]">
            <Download className="h-[15px] w-[15px]" /> Exportar
          </button>
          <span className="hidden text-[11.5px] text-[var(--ls-t4)] md:inline">CSV «fecha;descripción;tipo;importe»</span>
          <button type="button" disabled={!d?.hayTabla} onClick={() => setEditando({ fecha: hoyIso(), tipo: 'gasto', descripcion: '', importe: undefined })} className="ml-auto inline-flex h-10 items-center gap-2 rounded-[12px] px-4 text-[12.5px] font-semibold text-[#141414] disabled:opacity-50" style={{ background: 'linear-gradient(135deg,#F26212,#FF8A3D)' }}>
            <Plus className="h-[14px] w-[14px]" /> Agregar
          </button>
          <input ref={fichero} type="file" accept=".csv,.txt,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && importar(e.target.files[0])} />
        </div>
      </div>

      <EditarApunte
        apunte={editando}
        onCerrar={() => setEditando(null)}
        onGuardar={async (a) => {
          if (!cuentaId) return
          await enviar(a.id ? { accion: 'editar', cuenta: cuentaId, id: a.id, apunte: a } : { accion: 'apunte', cuenta: cuentaId, apunte: a })
          setEditando(null)
          cargar()
        }}
      />
    </Marco>
  )
}

function Cifra({ titulo, valor, nota, color }: { titulo: string; valor: string; nota: string; color: string }) {
  return (
    <div className={`${TARJETA} px-5 py-4`}>
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--ls-t4)]">
        <span className="h-[8px] w-[8px] rounded-full" style={{ background: color }} />
        {titulo}
      </div>
      <div className="mt-1 text-[24px] font-semibold tabular-nums text-[var(--ls-t1)]">{valor}</div>
      <div className="text-[11.5px] text-[var(--ls-t4)]">{nota}</div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* El gráfico: barras por tipo, diferencia y efectivo en mano          */
/* ------------------------------------------------------------------ */

function Grafico({ periodos, ocultas }: { periodos: PeriodoFlujo[]; ocultas: Serie[] }) {
  const [sel, setSel] = useState<number | null>(null)
  const tipos = TIPOS_FLUJO.filter((t) => !ocultas.includes(t))
  const verDif = !ocultas.includes('diferencia')
  const verEfe = !ocultas.includes('efectivo')
  const W = Math.max(640, periodos.length * 64)
  const H = 300
  const M = { t: 16, r: 16, b: 44, l: 78 }
  const valores: number[] = [0]
  for (const p of periodos) {
    let mas = 0
    let menos = 0
    for (const t of tipos) {
      if (p.porTipo[t] >= 0) mas += p.porTipo[t]
      else menos += p.porTipo[t]
    }
    valores.push(mas, menos)
    if (verDif) valores.push(p.diferencia)
    if (verEfe) valores.push(p.efectivo)
  }
  const max = Math.max(...valores)
  const min = Math.min(...valores)
  const pad = (max - min || 1) * 0.08
  const top = max + pad
  const bot = min - (min < 0 ? pad : 0)
  const y = (v: number) => M.t + ((top - v) / (top - bot)) * (H - M.t - M.b)
  const paso = (W - M.l - M.r) / periodos.length
  const x = (i: number) => M.l + paso * i + paso / 2
  const ancho = Math.min(30, paso * 0.5)
  const marcas = Array.from({ length: 5 }, (_, i) => bot + ((top - bot) * i) / 4)
  const iPrevisto = periodos.findIndex((p) => p.previsto)
  const linea = (vals: number[], desde: number, hasta: number) => vals.slice(desde, hasta + 1).map((v, k) => `${k ? 'L' : 'M'}${x(desde + k)},${y(v)}`).join(' ')
  const efe = periodos.map((p) => p.efectivo)
  const dif = periodos.map((p) => p.diferencia)
  const corte = iPrevisto < 0 ? periodos.length - 1 : Math.max(0, iPrevisto - 1)
  const p = sel != null ? periodos[sel] : null

  return (
    <div className="relative px-2 pb-3 pt-2 sm:px-3" onMouseLeave={() => setSel(null)}>
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', minWidth: W * 0.75, height: H }} preserveAspectRatio="none" role="img" aria-label="Flujo de caja por liquidación">
          {marcas.map((m) => (
            <g key={m}>
              <line x1={M.l} x2={W - M.r} y1={y(m)} y2={y(m)} stroke="var(--ls-linea)" strokeWidth={1} />
              <text x={M.l - 8} y={y(m) + 4} textAnchor="end" fontSize={10.5} fill="var(--ls-t4)">
                {Math.round(m).toLocaleString('es-ES')} €
              </text>
            </g>
          ))}
          <line x1={M.l} x2={W - M.r} y1={y(0)} y2={y(0)} stroke="var(--ls-t4)" strokeOpacity={0.5} strokeWidth={1} />
          {iPrevisto > 0 && <line x1={x(iPrevisto) - paso / 2} x2={x(iPrevisto) - paso / 2} y1={M.t} y2={H - M.b} stroke="var(--ls-t4)" strokeDasharray="4 4" />}
          {periodos.map((pe, i) => {
            let arriba = 0
            let abajo = 0
            return (
              <g key={pe.desde} opacity={pe.previsto ? 0.55 : 1}>
                <rect x={x(i) - paso / 2} y={M.t} width={paso} height={H - M.t - M.b} fill={sel === i ? 'color-mix(in srgb, var(--ls-t1) 5%, transparent)' : 'transparent'} onMouseEnter={() => setSel(i)} onClick={() => setSel(i)} />
                {tipos.map((t) => {
                  const v = pe.porTipo[t]
                  if (!v) return null
                  const desde = v >= 0 ? arriba : abajo
                  const hasta = desde + v
                  if (v >= 0) arriba = hasta
                  else abajo = hasta
                  return <rect key={t} x={x(i) - ancho / 2} y={y(Math.max(desde, hasta))} width={ancho} height={Math.max(1, Math.abs(y(desde) - y(hasta)))} rx={3} fill={COLOR[t]} pointerEvents="none" />
                })}
                <text x={x(i)} y={H - M.b + 16} textAnchor="middle" fontSize={10} fill="var(--ls-t4)">
                  {corta(pe.desde)}–{corta(pe.hasta)}
                </text>
                <text x={x(i)} y={H - M.b + 29} textAnchor="middle" fontSize={9.5} fill="var(--ls-t4)" opacity={0.7}>
                  {pe.hasta.slice(0, 4)}
                </text>
              </g>
            )
          })}
          {verDif && (
            <>
              <path d={linea(dif, 0, corte)} fill="none" stroke={COLOR_DIFERENCIA} strokeWidth={1.5} pointerEvents="none" />
              {corte < periodos.length - 1 && <path d={linea(dif, corte, periodos.length - 1)} fill="none" stroke={COLOR_DIFERENCIA} strokeWidth={1.5} strokeDasharray="5 4" pointerEvents="none" />}
              {dif.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r={3.5} fill="var(--ls-sup)" stroke={COLOR_DIFERENCIA} strokeWidth={1.5} pointerEvents="none" />)}
            </>
          )}
          {verEfe && (
            <>
              <path d={linea(efe, 0, corte)} fill="none" stroke={COLOR_EFECTIVO} strokeWidth={2.2} pointerEvents="none" />
              {corte < periodos.length - 1 && <path d={linea(efe, corte, periodos.length - 1)} fill="none" stroke={COLOR_EFECTIVO} strokeWidth={2.2} strokeDasharray="6 5" pointerEvents="none" />}
              {efe.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r={sel === i ? 5 : 3.8} fill={COLOR_EFECTIVO} pointerEvents="none" />)}
            </>
          )}
        </svg>
      </div>
      {p && (
        <div className="pointer-events-none absolute right-4 top-4 z-10 w-[250px] rounded-[14px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] p-3 text-[12px] shadow-[var(--ls-sombra-3)]">
          <div className="mb-2 font-semibold text-[var(--ls-t1)]">
            {fechaCorta(p.desde)} – {fechaCorta(p.hasta)}
            {p.previsto && <span className="ml-1 font-normal text-[var(--ls-t4)]">(pronóstico)</span>}
          </div>
          <Linea color={COLOR_EFECTIVO} texto="Efectivo en mano" valor={p.efectivo} redondo />
          <Linea color={COLOR_DIFERENCIA} texto="Diferencia" valor={p.diferencia} redondo />
          {[...TIPOS_FLUJO].reverse().map((t) => (
            <Linea key={t} color={COLOR[t]} texto={NOMBRE_TIPO[t]} valor={p.porTipo[t]} />
          ))}
        </div>
      )}
    </div>
  )
}

function Linea({ color, texto, valor, redondo }: { color: string; texto: string; valor: number; redondo?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-[2px]">
      <span className="flex items-center gap-2 text-[var(--ls-t3)]">
        <span className={`h-[9px] w-[9px] ${redondo ? 'rounded-full border-2 bg-transparent' : 'rounded-[2px]'}`} style={redondo ? { borderColor: color } : { background: color }} />
        {texto}
      </span>
      <span className="tabular-nums text-[var(--ls-t1)]">{euros(valor)}</span>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Cada periodo con sus movimientos                                    */
/* ------------------------------------------------------------------ */

function Periodo({ p, onEditar, onBorrar }: { p: PeriodoFlujo; onEditar: (id: string) => void; onBorrar: (e: PeriodoFlujo['entradas'][number]) => void }) {
  if (p.entradas.length === 0) return null
  return (
    <div className="border-b border-[var(--ls-linea)] last:border-0">
      <div className="flex items-baseline justify-between gap-3 px-4 pb-2 pt-5 sm:px-5">
        <div className="text-[15px] font-medium text-[var(--ls-t1)]">
          {fechaCorta(p.desde)} – {fechaCorta(p.hasta)}
          {p.previsto && <span className="ml-2 rounded-full bg-[color-mix(in_srgb,#A78BFA_16%,transparent)] px-2 py-[2px] text-[10.5px] font-semibold text-[#C4B5FD]">Pronóstico</span>}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-[12.5px]">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-[0.08em] text-[var(--ls-t4)]">
              <th className="px-4 py-2 font-medium sm:px-5">Fecha</th>
              <th className="px-2 py-2 font-medium">Descripción</th>
              <th className="px-2 py-2 font-medium">Tipo</th>
              <th className="px-2 py-2 text-right font-medium">Suma</th>
              <th className="px-2 py-2 text-right font-medium">Efectivo en mano</th>
              <th className="w-[72px] px-4 py-2 sm:px-5" />
            </tr>
          </thead>
          <tbody>
            {p.entradas.map((e) => (
              <tr key={e.clave} className={`border-t border-[var(--ls-linea)] ${e.previsto ? 'text-[var(--ls-t3)]' : 'text-[var(--ls-t2)]'}`}>
                <td className="whitespace-nowrap px-4 py-[9px] tabular-nums sm:px-5">{fechaCorta(e.fecha)}</td>
                <td className="px-2 py-[9px]">
                  <span className="inline-flex items-center gap-2">
                    {e.origen === 'amazon' && <Landmark className="h-[13px] w-[13px] shrink-0 text-[var(--ls-t4)]" />}
                    {e.descripcion || '—'}
                  </span>
                </td>
                <td className="px-2 py-[9px]">
                  <span className="inline-flex items-center gap-[6px]">
                    <span className="h-[8px] w-[8px] rounded-[2px]" style={{ background: COLOR[e.tipo] }} />
                    {NOMBRE_TIPO[e.tipo]}
                  </span>
                </td>
                <td className={`px-2 py-[9px] text-right tabular-nums ${e.importe < 0 ? 'text-[#F87171]' : 'text-[var(--ls-t1)]'}`}>{euros(e.importe)}</td>
                <td className="px-2 py-[9px] text-right tabular-nums text-[var(--ls-t1)]">{euros(e.efectivo)}</td>
                <td className="px-4 py-[9px] text-right sm:px-5">
                  {e.origen === 'manual' && (
                    <button type="button" onClick={() => e.ref && onEditar(e.ref)} aria-label="Editar" className="mr-1 rounded-[7px] p-[5px] text-[var(--ls-t4)] hover:bg-[var(--ls-sup2)] hover:text-[var(--ls-t1)]">
                      <Pencil className="h-[13px] w-[13px]" />
                    </button>
                  )}
                  {e.origen !== 'estimado' && (
                    <button type="button" onClick={() => onBorrar(e)} aria-label="Borrar" className="rounded-[7px] p-[5px] text-[var(--ls-t4)] hover:bg-[var(--ls-sup2)] hover:text-[#F87171]">
                      <Trash2 className="h-[13px] w-[13px]" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
            <tr className="border-t border-[var(--ls-linea)] text-[var(--ls-t4)]">
              <td className="px-4 py-[9px] sm:px-5" colSpan={3}>
                Diferencia
              </td>
              <td className={`px-2 py-[9px] text-right tabular-nums ${p.diferencia < 0 ? 'text-[#F87171]' : ''}`}>{euros(p.diferencia)}</td>
              <td colSpan={2} />
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Añadir o editar un apunte                                           */
/* ------------------------------------------------------------------ */

function EditarApunte({ apunte, onCerrar, onGuardar }: { apunte: Partial<ApunteFlujo> | null; onCerrar: () => void; onGuardar: (a: Omit<ApunteFlujo, 'id'> & { id?: string }) => Promise<void> }) {
  const [fecha, setFecha] = useState('')
  const [tipo, setTipo] = useState<TipoFlujo>('gasto')
  const [desc, setDesc] = useState('')
  const [importe, setImporte] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!apunte) return
    setFecha(apunte.fecha ?? hoyIso())
    setTipo(apunte.tipo ?? 'gasto')
    setDesc(apunte.descripcion ?? '')
    // Se escribe en positivo; el tipo pone el signo (los pagos llevan el suyo)
    setImporte(apunte.importe == null ? '' : String(SIGNO_TIPO[apunte.tipo ?? 'gasto'] === 0 ? apunte.importe : Math.abs(apunte.importe)).replace('.', ','))
    setError(null)
  }, [apunte])
  const signo = SIGNO_TIPO[tipo]
  const guardar = async () => {
    const bruto = importe.replace(/\s|€/g, '')
    const n = Number(bruto.includes(',') ? bruto.replace(/\./g, '').replace(',', '.') : bruto)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !Number.isFinite(n) || bruto === '') {
      setError('Pon la fecha y el importe.')
      return
    }
    setGuardando(true)
    try {
      await onGuardar({ id: apunte?.id, fecha, tipo, descripcion: desc.trim(), importe: signo === 0 ? n : signo * Math.abs(n) })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setGuardando(false)
    }
  }
  const campo = 'h-11 w-full rounded-[11px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-3 text-[13.5px] text-[var(--ls-t1)] outline-none focus:border-[#F26212]'
  return (
    <PanelLateral
      abierto={Boolean(apunte)}
      onCambio={(a) => !a && onCerrar()}
      titulo={apunte?.id ? 'Editar apunte' : 'Agregar al flujo de caja'}
      descripcion="Dinero que entra o sale fuera de Amazon: lo que se invierte, los gastos, la mercancía, los dividendos o el IVA."
      icono={Wallet}
      acento="marca"
      pie={
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCerrar} className="h-11 rounded-[11px] border border-[var(--ls-linea)] px-4 text-[13px] text-[var(--ls-t2)]">
            Cancelar
          </button>
          <button type="button" disabled={guardando} onClick={guardar} className="inline-flex h-11 items-center gap-2 rounded-[11px] px-5 text-[13px] font-semibold text-[#141414] disabled:opacity-60" style={{ background: 'linear-gradient(135deg,#F26212,#FF8A3D)' }}>
            {guardando && <Loader2 className="h-[14px] w-[14px] animate-spin" />} Guardar
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <div>
          <div className="mb-2 text-[12px] text-[var(--ls-t3)]">Tipo</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {TIPOS_FLUJO.map((t) => (
              <button key={t} type="button" onClick={() => setTipo(t)} className={`flex h-10 items-center gap-2 rounded-[11px] border px-3 text-[12.5px] ${tipo === t ? 'border-[#F26212] bg-[color-mix(in_srgb,#F26212_10%,transparent)] text-[var(--ls-t1)]' : 'border-[var(--ls-linea)] text-[var(--ls-t3)]'}`}>
                <span className="h-[9px] w-[9px] rounded-[2px]" style={{ background: COLOR[t] }} />
                {NOMBRE_TIPO[t]}
              </button>
            ))}
          </div>
        </div>
        <label className="flex flex-col gap-2 text-[12px] text-[var(--ls-t3)]">
          Fecha
          <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className={campo} />
        </label>
        <label className="flex flex-col gap-2 text-[12px] text-[var(--ls-t3)]">
          Descripción
          <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Ej.: IVA del 3T, compra a proveedor, préstamo…" className={campo} />
        </label>
        <label className="flex flex-col gap-2 text-[12px] text-[var(--ls-t3)]">
          Importe (€)
          <input inputMode="decimal" value={importe} onChange={(e) => setImporte(e.target.value)} placeholder="0,00" className={campo} />
          <span className="text-[11.5px] text-[var(--ls-t4)]">{signo === 1 ? 'Entra dinero: suma al efectivo.' : signo === -1 ? 'Sale dinero: se resta del efectivo (escríbelo en positivo).' : 'Con su signo: en negativo si es un cargo.'}</span>
        </label>
        {error && <p className="text-[12.5px] text-[#F87171]">{error}</p>}
      </div>
    </PanelLateral>
  )
}
