'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, ArrowRight, ChevronDown, ChevronRight, Download, Loader2, LogOut, Search } from 'lucide-react'
import type { AuditoriaResumen, ListaAuditorias } from '@/lib/auditor-stock/consulta'
import type { Cambios, FilaDetalle } from '@/lib/auditor-stock/clasificar'
import type { ContrasteGuardado, EstadoCruce, TuplaCruce } from '@/lib/prestashop/informe'
import { Cabecera, EntrarConClave } from './PanelTrafico'

/**
 * EL STOCK DE AMAZON FRENTE A LA TIENDA, PARA EL CLIENTE (enlace con clave). Una tabla con «Stock Amazon» y «Stock PrestaShop» de cada producto y su estado (cuadra,
 * venta perdida, sobreventa, distinta cantidad), las cifras de la última revisión arriba y, al lado, cada pasada del auditor con lo que tenía stock antes y lo tiene
 * ahora. SOLO LO QUE ENVÍA EL VENDEDOR (FBM): lo de FBA no sale (decisión de Raúl, 19 nov 2026). Solo lee lo que guarda el auditor cada 20 minutos; se actualiza
 * sola cada minuto. Colores sueltos de la marca, como la página de tráfico.
 */

const ETIQUETA = 'Stock Amazon y tienda'
const n = (v: number | null | undefined) => (v == null ? '—' : v.toLocaleString('es-ES', { useGrouping: 'always' } as Intl.NumberFormatOptions))
const hora = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit' })
const dia = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', day: 'numeric', month: 'short' })
const haceCuanto = (iso: string, ahora: number) => {
  const min = Math.max(0, Math.round((ahora - Date.parse(iso)) / 60_000))
  return min < 1 ? 'hace un momento' : min < 60 ? `hace ${min} min` : `hace ${Math.floor(min / 60)} h ${min % 60} min`
}
/** En ShoesF los SKU de FBA empiezan por «FBA»: sirve para quitar de «antes → ahora» los que ya no están en el detalle (se han quedado sin stock) */
const pareceFba = (sku: string) => /^FBA/i.test(sku)

const ESTADOS: Record<EstadoCruce, { texto: string; color: string; fondo: string; ayuda: string; orden: number }> = {
  s: { texto: 'Sobreventa', color: '#C0432E', fondo: '#FBEAE7', ayuda: 'Amazon tiene stock y la tienda no: se puede vender lo que no hay', orden: 0 },
  v: { texto: 'Venta perdida', color: '#C2410C', fondo: '#FEF3EC', ayuda: 'La tienda tiene stock y Amazon no: se está dejando de vender', orden: 1 },
  d: { texto: 'Distinta cantidad', color: '#8A6100', fondo: '#FDF6E3', ayuda: 'Los dos tienen stock, pero no el mismo número', orden: 2 },
  c: { texto: 'Cuadra', color: '#2F7D4F', fondo: '#EAF5EE', ayuda: 'El mismo stock en Amazon y en la tienda', orden: 3 },
  n: { texto: 'Sin dato en la tienda', color: '#5E5852', fondo: '#F1EEE9', ayuda: 'La tienda no da cantidad para esta talla', orden: 4 },
  p: { texto: 'Sin pareja en la tienda', color: '#5E5852', fondo: '#F1EEE9', ayuda: 'No se ha encontrado en la tienda por EAN ni por referencia', orden: 5 },
}

interface Fila {
  sku: string
  asin: string | null
  amazon: number
  tienda: number | null
  estado: EstadoCruce
}

interface Detalle {
  resumen: AuditoriaResumen
  detalle: FilaDetalle[]
  cambios: Cambios | null
  contraste: ContrasteGuardado | null
}

export function PanelStock({ token, titulo, autenticado }: { token: string; titulo: string; autenticado: boolean }) {
  const [dentro, setDentro] = useState(autenticado)
  const alSalir = useCallback(() => setDentro(false), [])
  if (!dentro) return <EntrarConClave token={token} titulo={titulo} etiqueta={ETIQUETA} alEntrar={() => setDentro(true)} />
  return <Panel token={token} titulo={titulo} alSalir={alSalir} />
}

function Panel({ token, titulo, alSalir }: { token: string; titulo: string; alSalir: () => void }) {
  const base = `/api/stock-cliente/${token}`
  const [lista, setLista] = useState<AuditoriaResumen[] | null>(null)
  const [detalle, setDetalle] = useState<Detalle | null>(null)
  const [cruceUltimo, setCruce] = useState<{ creada_at: string; filas: TuplaCruce[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ahora, setAhora] = useState(() => Date.now())
  const [filtro, setFiltro] = useState<EstadoCruce | 'todos'>('todos')
  const [busca, setBusca] = useState('')
  const [cuantas, setCuantas] = useState(200)
  const [pasadaAbierta, setPasadaAbierta] = useState<string | null>(null)
  // La revisión que se está mirando (null = la última): la tabla y las cifras pasan a ser las de ese momento
  const [seleccion, setSeleccion] = useState<{ id: string; detalle: Detalle | null; cruce: { creada_at: string; filas: TuplaCruce[] } | null; cargando: boolean } | null>(null)
  const ultimaVista = useRef<string | null>(null)

  const pedir = useCallback(
    async <T,>(cuerpo: Record<string, unknown>): Promise<T | null> => {
      const r = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo), cache: 'no-store' })
      if (r.status === 401) {
        alSalir()
        return null
      }
      const j = await r.json()
      if (!r.ok) throw new Error(j.error ?? 'No se han podido leer los datos.')
      return j as T
    },
    [base, alSalir]
  )

  const cargar = useCallback(async () => {
    try {
      const l = await pedir<{ lista: ListaAuditorias }>({ accion: 'lista' })
      if (!l) return
      const filas = l.lista.ok ? l.lista.filas : []
      setLista(filas)
      setAhora(Date.now())
      const ultima = filas.find((f) => f.estado === 'completa')
      // El detalle y la foto del cruce solo se vuelven a pedir cuando hay una revisión nueva
      if (ultima && ultima.id !== ultimaVista.current) {
        const [d, c] = await Promise.all([pedir<Detalle>({ accion: 'detalle', id: ultima.id }), pedir<{ cruce: { creada_at: string; filas: TuplaCruce[] } | null }>({ accion: 'cruce' })])
        if (d) setDetalle(d)
        if (c) setCruce(c.cruce)
        ultimaVista.current = ultima.id
      }
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se han podido leer los datos.')
    }
  }, [pedir])
  useEffect(() => {
    void cargar()
    const t = setInterval(() => void cargar(), 60_000)
    return () => clearInterval(t)
  }, [cargar])

  const salir = async () => {
    await fetch(`/api/trafico/${token}/entrar`, { method: 'DELETE' }).catch(() => undefined)
    alSalir()
  }

  const elegir = useCallback(
    async (id: string, esLaUltima: boolean) => {
      if (esLaUltima) return setSeleccion(null)
      setSeleccion({ id, detalle: null, cruce: null, cargando: true })
      try {
        const [d, c] = await Promise.all([pedir<Detalle>({ accion: 'detalle', id }), pedir<{ cruce: { creada_at: string; filas: TuplaCruce[] } | null }>({ accion: 'cruce', id })])
        setSeleccion((s) => (s && s.id === id ? { id, detalle: d, cruce: c?.cruce ?? null, cargando: false } : s))
      } catch (e) {
        setError(e instanceof Error ? e.message : 'No se ha podido abrir esa revisión.')
        setSeleccion(null)
      }
    },
    [pedir]
  )
  const vDetalle = seleccion ? seleccion.detalle : detalle
  const vCruce = seleccion ? seleccion.cruce : cruceUltimo

  /* ---- las filas: la foto del cruce (solo FBM) ---- */
  const filas: Fila[] = useMemo(() => {
    const detalle = vDetalle
    const cruce = vCruce
    if (!detalle) return []
    const salida: Fila[] = []
    if (cruce) {
      for (const [sku, asin, amazon, tienda, estado] of cruce.filas) salida.push({ sku, asin, amazon, tienda, estado })
      return salida
    }
    // Sin la foto completa (aún no ha pasado el auditor con la versión nueva): lo que no cuadra, y lo demás con stock sin el dato de la tienda
    const vistos = new Set<string>()
    const c = detalle.contraste
    for (const [lista, estado] of [[c?.sobreventa, 's'], [c?.ventaPerdida, 'v'], [c?.distinta, 'd']] as const) {
      for (const t of lista ?? []) {
        salida.push({ sku: t[0], asin: t[1], amazon: t[2], tienda: t[3], estado })
        vistos.add(t[0])
      }
    }
    for (const [sku, asin, cantidad, canal] of detalle.detalle) if (canal === 'M' && !vistos.has(sku)) salida.push({ sku, asin, amazon: cantidad, tienda: null, estado: 'n' })
    return salida
  }, [vDetalle, vCruce])

  const cuenta = useMemo(() => {
    const c: Record<EstadoCruce, { skus: number; amazon: number; tienda: number }> = { s: z(), v: z(), d: z(), c: z(), n: z(), p: z() }
    let amazonConStock = 0
    let amazonUnidades = 0
    let tiendaConStock = 0
    let tiendaUnidades = 0
    for (const f of filas) {
      c[f.estado].skus += 1
      c[f.estado].amazon += f.amazon
      c[f.estado].tienda += f.tienda ?? 0
      if (f.amazon > 0) {
        amazonConStock += 1
        amazonUnidades += f.amazon
      }
      if ((f.tienda ?? 0) > 0) {
        tiendaConStock += 1
        tiendaUnidades += f.tienda ?? 0
      }
    }
    return { ...c, amazonConStock, amazonUnidades, tiendaConStock, tiendaUnidades }
  }, [filas])

  const visibles = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return filas
      .filter((f) => (filtro === 'todos' || f.estado === filtro) && (!q || f.sku.toLowerCase().includes(q) || (f.asin ?? '').toLowerCase().includes(q)))
      .sort((a, b) => ESTADOS[a.estado].orden - ESTADOS[b.estado].orden || Math.abs((b.tienda ?? 0) - b.amazon) - Math.abs((a.tienda ?? 0) - a.amazon) || a.sku.localeCompare(b.sku))
  }, [filas, filtro, busca])

  const descargar = () => {
    const celda = (v: string | number | null) => {
      const t = v == null ? '' : String(v)
      return /[;"\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t
    }
    const lineas = [['SKU', 'ASIN', 'Stock Amazon', 'Stock PrestaShop', 'Diferencia', 'Estado'].join(';'), ...visibles.map((f) => [f.sku, f.asin, f.amazon, f.tienda, f.tienda == null ? '' : f.tienda - f.amazon, ESTADOS[f.estado].texto].map(celda).join(';'))]
    const url = URL.createObjectURL(new Blob(['﻿' + lineas.join('\r\n')], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `stock-amazon-y-tienda-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const ultimaReal = lista?.find((f) => f.estado === 'completa') ?? null
  const ultima = seleccion ? (lista?.find((f) => f.id === seleccion.id) ?? ultimaReal) : ultimaReal
  const cruce = vCruce
  const pasadas = (lista ?? []).filter((f) => f.estado === 'completa').slice(0, 36)

  return (
    <div className="min-h-screen bg-[#F7F5F2] text-[#141414]">
      <Cabecera
        titulo={titulo}
        etiqueta={ETIQUETA}
        subtitulo={ultimaReal ? `Última revisión a las ${hora.format(new Date(ultimaReal.creada_at))} (${haceCuanto(ultimaReal.creada_at, ahora)}) · se revisa cada 20 minutos y esta página se actualiza sola` : 'Se revisa cada 20 minutos y esta página se actualiza sola'}
        derecha={<button type="button" onClick={() => void salir()} title="Salir" className="rounded-lg p-1.5 text-[#B8AE9F] hover:text-white"><LogOut className="h-4 w-4" /></button>}
      />
      <main className="mx-auto max-w-[1400px] px-4 pb-16 sm:px-8">
        {error && <p className="mt-6 flex items-center gap-2 text-[13px] text-[#C0432E]" role="alert"><AlertCircle className="h-4 w-4" /> {error}</p>}
        {seleccion && ultima && (
          <div className="mt-5 flex flex-wrap items-center gap-3 rounded-xl border border-[#F26212]/40 bg-[#FEF3EC] px-4 py-2.5 text-[13.5px]">
            <span>Estás viendo la revisión de las <b>{hora.format(new Date(ultima.creada_at))}</b> del {dia.format(new Date(ultima.creada_at))}: la tabla y las cifras son las de ese momento.</span>
            {seleccion.cargando && <Loader2 className="h-4 w-4 animate-spin text-[#F26212]" />}
            <button type="button" onClick={() => setSeleccion(null)} className="ml-auto rounded-lg bg-[#141414] px-3 py-1.5 text-[12.5px] font-semibold text-white">Volver a la última</button>
          </div>
        )}
        {!vDetalle || !ultima ? (
          <div className="mt-16 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-[#F26212]" /></div>
        ) : (
          <>
            {/* ---- las cifras ---- */}
            <section className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
              <Tarjeta destacada titulo="Con stock en Amazon" valor={n(cruce ? cuenta.amazonConStock : ultima.con_stock_fbm)} nota={cruce ? `${n(cuenta.amazonUnidades)} unidades` : undefined} />
              <Tarjeta titulo="Con stock en la tienda" valor={n(cruce ? cuenta.tiendaConStock : (ultima.ps_con_stock ?? null))} nota={cruce ? `${n(cuenta.tiendaUnidades)} unidades` : undefined} />
              {(['v', 's', 'd', 'c'] as const).map((e) => (
                <Tarjeta key={e} titulo={ESTADOS[e].texto} valor={n(cuenta[e].skus)} color={ESTADOS[e].color} nota={e === 'v' ? `${n(cuenta.v.tienda)} u. en la tienda sin vender en Amazon` : e === 's' ? `${n(cuenta.s.amazon)} u. en Amazon que la tienda no tiene` : e === 'd' ? 'el mismo producto, distinto número' : 'Amazon y la tienda iguales'} activa={filtro === e} alPulsar={() => setFiltro(filtro === e ? 'todos' : e)} />
              ))}
            </section>

            <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
              {/* ---- la tabla ---- */}
              <section className="min-w-0 rounded-2xl border border-[#E5E1DB] bg-white">
                <div className="flex flex-wrap items-center gap-2 border-b border-[#E5E1DB] p-3">
                  <h2 className="mr-2 text-[16px] font-semibold" style={{ fontFamily: 'var(--font-sora), system-ui' }}>Stock por producto</h2>
                  <div className="flex flex-wrap gap-1.5">
                    {(['todos', 'v', 's', 'd', 'c', 'n', 'p'] as const).map((e) => {
                      const total = e === 'todos' ? filas.length : cuenta[e].skus
                      if (e !== 'todos' && total === 0) return null
                      const activo = filtro === e
                      return (
                        <button key={e} type="button" onClick={() => setFiltro(e)} title={e === 'todos' ? undefined : ESTADOS[e].ayuda} className={`h-7 rounded-full border px-2.5 text-[12px] font-medium ${activo ? 'border-[#141414] bg-[#141414] text-white' : 'border-[#E5E1DB] text-[#5E5852] hover:text-[#141414]'}`}>
                          {e === 'todos' ? 'Todos' : ESTADOS[e].texto} <span className="tabular-nums opacity-70">{n(total)}</span>
                        </button>
                      )
                    })}
                  </div>
                  <label className="relative ml-auto">
                    <Search className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-[#8C857C]" />
                    <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="SKU o ASIN" aria-label="Buscar SKU o ASIN" className="h-8 w-[180px] rounded-lg border border-[#E5E1DB] bg-[#F7F5F2] pl-8 pr-2 text-[13px] outline-none focus:border-[#F26212]" />
                  </label>
                  <button type="button" onClick={descargar} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#F26212] px-3 text-[12.5px] font-semibold text-white"><Download className="h-3.5 w-3.5" /> CSV</button>
                </div>
                {!cruce && <p className="border-b border-[#E5E1DB] bg-[#FEF3EC] px-3 py-2 text-[12.5px] text-[#5E5852]">{seleccion ? 'De esta revisión solo se guardó el stock de la tienda de los productos que no cuadraban: los demás salen sin ese dato.' : 'El stock de la tienda de todos los productos estará en la próxima revisión (como mucho 20 minutos). De momento salen con dato solo los que no cuadran.'}</p>}
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-[13px]">
                    <thead>
                      <tr className="text-[11px] uppercase tracking-[0.06em] text-[#5E5852]">
                        <th className="border-b border-[#E5E1DB] bg-[#F7F5F2] px-3 py-2 text-left font-semibold">SKU</th>
                        <th className="border-b border-[#E5E1DB] bg-[#F7F5F2] px-3 py-2 text-left font-semibold">ASIN</th>
                        <th className="border-b border-[#E5E1DB] bg-[#F7F5F2] px-3 py-2 text-right font-semibold">Stock Amazon</th>
                        <th className="border-b border-[#E5E1DB] bg-[#F7F5F2] px-3 py-2 text-right font-semibold">Stock PrestaShop</th>
                        <th className="border-b border-[#E5E1DB] bg-[#F7F5F2] px-3 py-2 text-left font-semibold">Estado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibles.slice(0, cuantas).map((f) => {
                        const e = ESTADOS[f.estado]
                        const max = Math.max(f.amazon, f.tienda ?? 0, 1)
                        return (
                          <tr key={f.sku} className="hover:bg-[#FBFAF8]">
                            <td className="border-b border-[#EFEBE5] px-3 py-2 font-mono text-[12.5px]">{f.sku}</td>
                            <td className="border-b border-[#EFEBE5] px-3 py-2 font-mono text-[12px] text-[#5E5852]">{f.asin ?? '—'}</td>
                            <td className="border-b border-[#EFEBE5] px-3 py-2"><Barra valor={f.amazon} max={max} color="#141414" /></td>
                            <td className="border-b border-[#EFEBE5] px-3 py-2">{f.tienda == null ? <span className="block text-right text-[#B8AE9F]">—</span> : <Barra valor={f.tienda} max={max} color="#F26212" />}</td>
                            <td className="border-b border-[#EFEBE5] px-3 py-2"><span title={e.ayuda} className="inline-flex rounded-full px-2 py-0.5 text-[11.5px] font-semibold" style={{ color: e.color, background: e.fondo }}>{e.texto}</span></td>
                          </tr>
                        )
                      })}
                      {visibles.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-[13px] text-[#8C857C]">Nada con ese filtro.</td></tr>}
                    </tbody>
                  </table>
                </div>
                {visibles.length > cuantas && (
                  <button type="button" onClick={() => setCuantas((c) => c + 300)} className="m-3 h-9 rounded-lg border border-[#E5E1DB] px-4 text-[13px] text-[#5E5852] hover:text-[#141414]">Ver {n(Math.min(300, visibles.length - cuantas))} más de {n(visibles.length)}</button>
                )}
              </section>

              {/* ---- las pasadas ---- */}
              <aside className="flex min-w-0 flex-col gap-2">
                <h2 className="text-[16px] font-semibold" style={{ fontFamily: 'var(--font-sora), system-ui' }}>Cada revisión</h2>
                <p className="-mt-1 text-[12px] text-[#8C857C]">Pulsa una para ver la tabla de ese momento y qué tenía stock antes y qué lo tiene ahora.</p>
                {pasadas.map((p, i) => (
                  <Pasada
                    key={p.id}
                    p={p}
                    anterior={pasadas[i + 1] ?? null}
                    abierta={pasadaAbierta === p.id}
                    elegida={(seleccion?.id ?? ultimaReal?.id) === p.id}
                    alternar={() => {
                      const abrir = pasadaAbierta !== p.id
                      setPasadaAbierta(abrir ? p.id : null)
                      if (abrir) void elegir(p.id, p.id === ultimaReal?.id)
                    }}
                    pedir={pedir}
                  />
                ))}
              </aside>
            </div>
          </>
        )}
      </main>
    </div>
  )
}

const z = () => ({ skus: 0, amazon: 0, tienda: 0 })

function Tarjeta({ titulo, valor, nota, color, destacada, activa, alPulsar }: { titulo: string; valor: string; nota?: string; color?: string; destacada?: boolean; activa?: boolean; alPulsar?: () => void }) {
  const clase = `rounded-2xl px-4 py-3.5 text-left ${destacada ? 'bg-[#0E0E0E]' : 'border bg-white'} ${activa ? 'border-[#141414] ring-1 ring-[#141414]' : 'border-[#E5E1DB]'} ${alPulsar ? 'hover:border-[#B8AE9F]' : ''}`
  const dentro = (
    <>
      <p className={`text-[10.5px] font-semibold uppercase tracking-[0.12em] ${destacada ? 'text-[#B8AE9F]' : 'text-[#8C857C]'}`}>{titulo}</p>
      <p className="mt-1 text-[26px] font-semibold leading-tight tabular-nums" style={{ fontFamily: 'var(--font-sora), system-ui', color: destacada ? '#F26212' : (color ?? '#141414') }}>{valor}</p>
      {nota && <p className={`mt-0.5 text-[11.5px] ${destacada ? 'text-[#EDE6DC]' : 'text-[#5E5852]'}`}>{nota}</p>}
    </>
  )
  return alPulsar ? <button type="button" onClick={alPulsar} aria-pressed={activa} className={clase}>{dentro}</button> : <div className={clase}>{dentro}</div>
}

function Barra({ valor, max, color }: { valor: number; max: number; color: string }) {
  return (
    <div className="ml-auto flex w-[150px] items-center justify-end gap-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#F1EEE9]">
        <div className="ml-auto h-full rounded-full" style={{ width: `${Math.round((valor / max) * 100)}%`, background: valor > 0 ? color : 'transparent' }} />
      </div>
      <span className={`w-9 text-right font-semibold tabular-nums ${valor === 0 ? 'text-[#B8AE9F]' : ''}`}>{valor}</span>
    </div>
  )
}

function Pasada({ p, anterior, abierta, elegida, alternar, pedir }: { p: AuditoriaResumen; anterior: AuditoriaResumen | null; abierta: boolean; elegida: boolean; alternar: () => void; pedir: <T>(c: Record<string, unknown>) => Promise<T | null> }) {
  const [d, setD] = useState<Detalle | null>(null)
  const [cargando, setCargando] = useState(false)
  useEffect(() => {
    if (!abierta || d) return
    setCargando(true)
    pedir<Detalle>({ accion: 'detalle', id: p.id })
      .then((r) => r && setD(r))
      .catch(() => undefined)
      .finally(() => setCargando(false))
  }, [abierta, d, p.id, pedir])
  // Solo FBM: fuera lo que el detalle dice que es FBA y, de lo que ya no está en el detalle (salen), lo que por su SKU es de FBA
  const fba = useMemo(() => new Set((d?.detalle ?? []).filter((x) => x[3] === 'A').map((x) => x[0])), [d])
  const salen = (d?.cambios?.salen ?? []).filter(([sku]) => !fba.has(sku) && !pareceFba(sku))
  const entran = (d?.cambios?.entran ?? []).filter(([sku]) => !fba.has(sku) && !pareceFba(sku))
  const delta = anterior ? p.con_stock_fbm - anterior.con_stock_fbm : null
  return (
    <div className={`rounded-xl border bg-white ${elegida ? 'border-[#F26212] ring-1 ring-[#F26212]' : 'border-[#E5E1DB]'}`}>
      <button type="button" onClick={alternar} aria-expanded={abierta} className="flex w-full items-center gap-2 px-3 py-2.5 text-left">
        {abierta ? <ChevronDown className="h-4 w-4 text-[#8C857C]" /> : <ChevronRight className="h-4 w-4 text-[#8C857C]" />}
        <span className="text-[13.5px] font-semibold tabular-nums">{hora.format(new Date(p.creada_at))}</span>
        <span className="text-[11.5px] text-[#8C857C]">{dia.format(new Date(p.creada_at))}</span>
        <span className="ml-auto flex items-center gap-2 text-[12px] tabular-nums">
          <span className="text-[#141414]" title="Con stock en Amazon (FBM)">{n(p.con_stock_fbm)}</span>
          {delta != null && delta !== 0 && <span className={`font-semibold ${delta > 0 ? 'text-[#2F7D4F]' : 'text-[#C0432E]'}`}>{delta > 0 ? '+' : '−'}{Math.abs(delta)}</span>}
        </span>
      </button>
      {abierta && (
        <div className="border-t border-[#EFEBE5] px-3 py-2">
          <p className="mb-1.5 text-[11.5px] text-[#5E5852]">{n(p.con_stock_fbm)} con stock en Amazon{p.div_venta_perdida != null ? ` · ${n(p.div_venta_perdida)} venta perdida · ${n(p.div_sobreventa ?? 0)} sobreventa` : ''}</p>
          {cargando && <Loader2 className="my-2 h-4 w-4 animate-spin text-[#F26212]" />}
          {d && salen.length === 0 && entran.length === 0 && <p className="py-1 text-[12px] text-[#8C857C]">Nada cambió respecto a la revisión anterior.</p>}
          {d && (salen.length > 0 || entran.length > 0) && (
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-[10.5px] uppercase tracking-[0.06em] text-[#8C857C]">
                  <th className="py-1 text-left font-semibold">SKU</th>
                  <th className="py-1 text-right font-semibold">Antes</th>
                  <th className="w-5" />
                  <th className="py-1 text-left font-semibold">Ahora</th>
                </tr>
              </thead>
              <tbody>
                {salen.map(([sku, antes]) => (
                  <tr key={`s-${sku}`}>
                    <td className="py-1 font-mono">{sku}</td>
                    <td className="py-1 text-right font-semibold tabular-nums">{antes}</td>
                    <td className="text-center text-[#B8AE9F]"><ArrowRight className="inline h-3 w-3" /></td>
                    <td className="py-1 font-semibold text-[#C0432E]">0 · se queda sin stock</td>
                  </tr>
                ))}
                {entran.map(([sku, ahora]) => (
                  <tr key={`e-${sku}`}>
                    <td className="py-1 font-mono">{sku}</td>
                    <td className="py-1 text-right tabular-nums text-[#B8AE9F]">0</td>
                    <td className="text-center text-[#B8AE9F]"><ArrowRight className="inline h-3 w-3" /></td>
                    <td className="py-1 font-semibold text-[#2F7D4F]">{ahora} · vuelve a tener stock</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}
