'use client'

import { BotonDeTarea, ProveedorDeTareas } from '@/components/plataforma/TareasDelModulo'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { toast } from 'sonner'
import { ArrowUpRight, Ban, BadgeEuro, Check, ChevronDown, Clock, FileWarning, Loader2, PauseCircle, RefreshCw, ShieldAlert, Wand2 } from 'lucide-react'
import { COLOR_ESTADO } from '@/lib/estilo/denso'
import { GRUPOS, type GrupoDeBloqueo, type ListingBloqueado, type ResumenDeBloqueos } from '@/lib/cumplimiento/bloqueos'
import { ACCIONES } from '@/lib/cumplimiento/acciones'
import { urlInventario } from '@/lib/cumplimiento/enlaces'
import { nombreDePais } from '@/lib/ads/paises'
import { AMAZON_MARKETPLACES } from '@/lib/types/amazon'
import { ImagenDeProducto } from '@/components/productos/ImagenDeProducto'
import { haceTiempo, cuentaAtras } from './comun'

/**
 * «NO SE VENDEN»: lo que deja un listing sin vender (o a punto), agrupado por lo que hay que hacer (lib/cumplimiento/bloqueos.ts), con stock delante. Arriba, cuántos de los
 * listings con stock se pueden comprar de verdad. Los errores de precio se arreglan aquí mismo: se lee de Amazon el precio, el mínimo y el máximo de AHORA y se puede
 * ajustar el límite roto al precio (la regla de siempre) o poner otro precio. Lo demás lleva el paso a dar y el enlace a Seller Central.
 */

type Respuesta = ResumenDeBloqueos & { ok: true; revisadoAt: string | null }
type Oferta = { sku: string; precio: number; moneda: string | null; minimo: number | null; maximo: number | null; minimoNuevo: number | null; maximoNuevo: number | null; desvio: number; estado: string }

const ICONO: Record<GrupoDeBloqueo, typeof BadgeEuro> = { precio: BadgeEuro, seguridad: ShieldAlert, politica: Ban, pausa: PauseCircle, ficha: FileWarning }
const COLOR: Record<GrupoDeBloqueo, string> = { precio: COLOR_ESTADO.ambar, seguridad: COLOR_ESTADO.rojo, politica: COLOR_ESTADO.magenta, pausa: COLOR_ESTADO.azul, ficha: 'var(--ls-t3)' }
const POR_PAGINA = 25

async function pedir<T>(cuerpo: Record<string, unknown>): Promise<T> {
  const r = await fetch('/api/cumplimiento', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) })
  const j = (await r.json().catch(() => ({}))) as T & { error?: string }
  if (!r.ok) throw new Error(j.error ?? `Error ${r.status}`)
  return j
}

const dinero = (n: number | null | undefined, moneda: string | null | undefined) => (n == null ? '—' : n.toLocaleString('es-ES', { style: 'currency', currency: moneda || 'EUR' }))

export function PestanaBloqueos({ cliente, amazonClientId = null, mercado, todos }: { cliente: string; amazonClientId?: string | null; mercado: string; todos: boolean }) {
  const [datos, setDatos] = useState<Respuesta | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(false)
  const [abierto, setAbierto] = useState<GrupoDeBloqueo | null>(null)
  const [soloStock, setSoloStock] = useState(true)

  const cargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    try {
      setDatos(await pedir<Respuesta>({ accion: 'bloqueos', cliente, mercado }))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se ha podido cargar.')
    } finally {
      setCargando(false)
    }
  }, [cliente, mercado])
  useEffect(() => {
    setDatos(null)
    void cargar()
  }, [cargar])

  const grupos = useMemo(() => {
    const listas = new Map<GrupoDeBloqueo, ListingBloqueado[]>()
    for (const l of datos?.listings ?? []) if (!soloStock || l.conStock) listas.set(l.grupo, [...(listas.get(l.grupo) ?? []), l])
    return GRUPOS.map((g) => ({ ...g, listings: listas.get(g.id) ?? [] }))
  }, [datos, soloStock])
  useEffect(() => {
    if (abierto === null && datos) setAbierto(grupos.find((g) => g.listings.length > 0)?.id ?? null)
  }, [datos, grupos, abierto])

  if (error) return <p className="rounded-[14px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] px-4 py-3 text-[12.5px]" style={{ color: COLOR_ESTADO.rojo }}>{error}</p>
  if (!datos) return <p className="flex items-center gap-2 px-1 py-6 text-[12.5px] text-[var(--ls-t3)]"><Loader2 className="h-4 w-4 animate-spin" /> Mirando qué listings no se pueden vender…</p>

  const parte = datos.conStock > 0 ? datos.conStockVendibles / datos.conStock : 1
  const bloqueadosConStock = datos.conStock - datos.conStockVendibles
  const color = parte >= 0.97 ? COLOR_ESTADO.verde : parte >= 0.9 ? COLOR_ESTADO.ambar : COLOR_ESTADO.rojo

  return (
    // Cada listing bloqueado se puede convertir en una tarea (responsable, fecha, comentarios)
    <ProveedorDeTareas cliente={amazonClientId} modulo="cumplimiento" refs={(datos.listings ?? []).map((l) => `${l.mercado}|${l.sku}`)}>
    <div className="flex flex-col gap-3 pb-8">
      {/* La cifra que importa: de lo que tiene stock, cuánto se puede comprar */}
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="relative overflow-hidden rounded-[18px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] p-5">
        <span aria-hidden className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full opacity-20 blur-3xl" style={{ background: color }} />
        <div className="relative flex flex-wrap items-end gap-x-8 gap-y-3">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--ls-t4)]">Listings con stock que se pueden comprar</div>
            <div className="mt-1 flex items-baseline gap-3">
              <span className="text-[40px] font-bold leading-none tabular-nums tracking-[-0.03em]" style={{ color }}>
                {(parte * 100).toLocaleString('es-ES', { maximumFractionDigits: 1 })} %
              </span>
              <span className="text-[13px] text-[var(--ls-t3)]">
                {datos.conStockVendibles.toLocaleString('es-ES')} de {datos.conStock.toLocaleString('es-ES')}
              </span>
            </div>
          </div>
          <div className="text-[13px] text-[var(--ls-t2)]">
            <b className="text-[20px] tabular-nums" style={{ color: bloqueadosConStock > 0 ? COLOR_ESTADO.rojo : COLOR_ESTADO.verde }}>{bloqueadosConStock.toLocaleString('es-ES')}</b> con stock y sin poder venderse
          </div>
          <div className="ml-auto flex items-center gap-3 text-[11.5px] text-[var(--ls-t4)]">
            {datos.revisadoAt && <span>Revisado {haceTiempo(datos.revisadoAt)}</span>}
            <button type="button" onClick={() => void cargar()} className="inline-flex items-center gap-1 rounded-[8px] px-2 py-1 transition-colors hover:bg-[var(--ls-sup2)] hover:text-[var(--ls-t1)]">
              <RefreshCw className={`h-3 w-3 ${cargando ? 'animate-spin' : ''}`} /> Volver a mirar
            </button>
          </div>
        </div>
        <div className="relative mt-4 h-[8px] overflow-hidden rounded-full bg-[var(--ls-sup2)]">
          <motion.div className="h-full rounded-full" style={{ background: color }} initial={{ width: 0 }} animate={{ width: `${parte * 100}%` }} transition={{ type: 'spring', stiffness: 90, damping: 20 }} />
        </div>
      </motion.div>

      <div className="flex items-center gap-2">
        <label className="inline-flex cursor-pointer items-center gap-2 text-[12.5px] text-[var(--ls-t2)]">
          <input type="checkbox" checked={soloStock} onChange={(e) => setSoloStock(e.target.checked)} className="accent-[var(--ls-acc)]" /> Solo los que tienen stock
        </label>
      </div>

      {grupos.map((g, i) => {
        const Icono = ICONO[g.id]
        const c = datos.porGrupo[g.id]
        const abiertoAqui = abierto === g.id
        return (
          <motion.section key={g.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }} className="overflow-hidden rounded-[16px] border border-[var(--ls-linea)] bg-[var(--ls-sup)]">
            <button type="button" onClick={() => setAbierto(abiertoAqui ? null : g.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--ls-sup2)]" aria-expanded={abiertoAqui}>
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px]" style={{ background: `color-mix(in srgb, ${COLOR[g.id]} 14%, transparent)`, color: COLOR[g.id] }}>
                <Icono className="h-[18px] w-[18px]" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-semibold text-[var(--ls-t1)]">{g.titulo}</span>
                <span className="block truncate text-[12px] text-[var(--ls-t4)]">{g.porque}</span>
              </span>
              <span className="flex shrink-0 items-center gap-3 text-[12px] tabular-nums">
                {c.conStock > 0 && <span style={{ color: COLOR_ESTADO.rojo }}>{c.conStock} con stock</span>}
                {c.enRiesgo > 0 && <span style={{ color: COLOR_ESTADO.ambar }}>{c.enRiesgo} en riesgo</span>}
                <span className="text-[18px] font-bold text-[var(--ls-t1)]">{g.listings.length}</span>
                <ChevronDown className="h-4 w-4 text-[var(--ls-t4)] transition-transform" style={{ transform: abiertoAqui ? 'rotate(180deg)' : undefined }} />
              </span>
            </button>
            <AnimatePresence initial={false}>
              {abiertoAqui && (
                <motion.div key="c" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25 }} className="overflow-hidden border-t border-[var(--ls-linea)]">
                  {g.listings.length === 0 ? (
                    <p className="px-4 py-4 text-[12.5px]" style={{ color: COLOR_ESTADO.verde }}>Nada aquí{soloStock ? ' con stock' : ''}. </p>
                  ) : g.id === 'precio' ? (
                    <ListaDePrecios cliente={cliente} listings={g.listings} todos={todos} alArreglar={() => void cargar()} />
                  ) : (
                    <ListaDeBloqueos listings={g.listings} todos={todos} />
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </motion.section>
        )
      })}
    </div>
    </ProveedorDeTareas>
  )
}

function Producto({ l, todos }: { l: ListingBloqueado; todos: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <ImagenDeProducto asin={l.asin} mkt={l.mercado} lado={40} redondeo={9} />
      <div className="min-w-0">
        <div className="truncate text-[12.5px] font-medium text-[var(--ls-t1)]" title={l.titulo ?? ''}>{l.titulo ?? l.sku}</div>
        <div className="flex flex-wrap items-center gap-x-2 text-[11px] text-[var(--ls-t4)]">
          <span className="font-mono">{l.sku}</span>
          {todos && <span>· {nombreDePais(AMAZON_MARKETPLACES.find((m) => m.id === l.mercado)?.countryCode ?? '')}</span>}
          <span style={{ color: l.conStock ? COLOR_ESTADO.verde : undefined }}>· {l.conStock ? 'con stock' : 'sin stock'}</span>
          {l.desde && <span>· {haceTiempo(l.desde)}</span>}
        </div>
      </div>
    </div>
  )
}

function ListaDeBloqueos({ listings, todos }: { listings: ListingBloqueado[]; todos: boolean }) {
  const [cuantos, setCuantos] = useState(POR_PAGINA)
  const [ver, setVer] = useState<string | null>(null)
  return (
    <div className="flex flex-col divide-y divide-[var(--ls-linea)]">
      {listings.slice(0, cuantos).map((l) => {
        const clave = `${l.mercado}|${l.sku}`
        const accion = ACCIONES[l.accion]
        const plazo = l.plazo ? cuentaAtras(l.plazo.slice(0, 10)) : null
        const url = urlInventario(l.mercado, l.sku)
        return (
          <div key={clave} className="px-4 py-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1">
                <Producto l={l} todos={todos} />
              </div>
              <span className="rounded-[6px] px-[7px] py-[2px] text-[11px] font-semibold" style={{ color: l.bloquea ? COLOR_ESTADO.rojo : COLOR_ESTADO.ambar, background: `color-mix(in srgb, ${l.bloquea ? COLOR_ESTADO.rojo : COLOR_ESTADO.ambar} 13%, transparent)` }}>
                {l.bloquea ? 'No se vende' : 'En riesgo'}
              </span>
              {plazo && (
                <span className="inline-flex items-center gap-1 text-[11.5px]" style={{ color: plazo.tono === 'rojo' ? COLOR_ESTADO.rojo : plazo.tono === 'ambar' ? COLOR_ESTADO.ambar : 'var(--ls-t3)' }}>
                  <Clock className="h-3 w-3" /> {plazo.texto}
                </span>
              )}
              <span className="text-[12px] font-medium text-[var(--ls-t2)]">{l.queHacer}</span>
              {url && (
                <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] font-medium text-[var(--ls-acc)] hover:underline">
                  Seller Central <ArrowUpRight className="h-3 w-3" />
                </a>
              )}
              <button type="button" onClick={() => setVer(ver === clave ? null : clave)} className="text-[12px] text-[var(--ls-t3)] hover:text-[var(--ls-t1)]">
                {ver === clave ? 'Ocultar' : 'Qué dice Amazon'}
              </button>
              <BotonDeTarea refId={clave} titulo={`Cumplimiento · ${l.titulo ?? l.sku} (${l.sku}): ${l.queHacer}`} />
            </div>
            {ver === clave && (
              <div className="mt-2 rounded-[10px] bg-[var(--ls-sup2)] p-3 text-[12px] leading-[1.5] text-[var(--ls-t2)]">
                <p>{l.mensaje}</p>
                <p className="mt-1 text-[11px] text-[var(--ls-t4)]">Código {l.codigo}</p>
                {accion && (
                  <ol className="mt-2 list-decimal pl-4 text-[var(--ls-t2)]">
                    {accion.pasos.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ol>
                )}
              </div>
            )}
          </div>
        )
      })}
      {listings.length > cuantos && (
        <button type="button" onClick={() => setCuantos((n) => n + POR_PAGINA * 2)} className="px-4 py-3 text-left text-[12.5px] font-medium text-[var(--ls-acc)] hover:underline">
          Ver {Math.min(POR_PAGINA * 2, listings.length - cuantos)} más de {listings.length - cuantos}
        </button>
      )}
    </div>
  )
}

/** Los errores de precio, por país (cada país es su oferta): se lee la oferta de ahora y se arregla aquí */
function ListaDePrecios({ cliente, listings, todos, alArreglar }: { cliente: string; listings: ListingBloqueado[]; todos: boolean; alArreglar: () => void }) {
  const [cuantos, setCuantos] = useState(POR_PAGINA)
  const visibles = listings.slice(0, cuantos)
  const [ofertas, setOfertas] = useState<Record<string, Oferta | 'ok' | 'error'>>({})
  const [leyendo, setLeyendo] = useState(false)
  const [ajustando, setAjustando] = useState(false)
  const [precios, setPrecios] = useState<Record<string, string>>({})
  const [enviando, setEnviando] = useState<string | null>(null)
  const clave = (l: ListingBloqueado) => `${l.mercado}|${l.sku}`

  const leer = useCallback(async (ls: ListingBloqueado[]) => {
    setLeyendo(true)
    try {
      const porMercado = new Map<string, string[]>()
      for (const l of ls) porMercado.set(l.mercado, [...(porMercado.get(l.mercado) ?? []), l.sku])
      const nuevo: Record<string, Oferta | 'ok' | 'error'> = {}
      for (const [mercado, skus] of porMercado) {
        try {
          const r = await pedir<{ errores: Oferta[] }>({ accion: 'precios-leer', cliente, mercado, skus })
          const conError = new Map(r.errores.map((o) => [o.sku, o]))
          for (const s of skus) nuevo[`${mercado}|${s}`] = conError.get(s) ?? 'ok'
        } catch {
          for (const s of skus) nuevo[`${mercado}|${s}`] = 'error'
        }
      }
      setOfertas((x) => ({ ...x, ...nuevo }))
    } finally {
      setLeyendo(false)
    }
  }, [cliente])
  useEffect(() => {
    const sinLeer = visibles.filter((l) => !(clave(l) in ofertas))
    if (sinLeer.length > 0 && !leyendo) void leer(sinLeer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cuantos, listings])

  const ajustables = visibles.filter((l) => {
    const o = ofertas[clave(l)]
    return o && typeof o === 'object' && o.desvio < 0.25
  })

  async function ajustar(ls: ListingBloqueado[]) {
    if (!window.confirm(`Se ajustará el límite roto al precio actual en ${ls.length} ${ls.length === 1 ? 'listing' : 'listings'}. Esto escribe en Amazon. ¿Seguir?`)) return
    setAjustando(true)
    try {
      const porMercado = new Map<string, string[]>()
      for (const l of ls) porMercado.set(l.mercado, [...(porMercado.get(l.mercado) ?? []), l.sku])
      let hechos = 0
      let fallidos = 0
      for (const [mercado, skus] of porMercado) {
        const r = await pedir<{ resultados: Array<{ estado: string }> }>({ accion: 'precio-ajustar', cliente, mercado, skus })
        hechos += r.resultados.filter((x) => x.estado === 'aceptado').length
        fallidos += r.resultados.filter((x) => x.estado === 'error' || x.estado === 'invalido').length
      }
      toast.success(`${hechos} ${hechos === 1 ? 'límite ajustado' : 'límites ajustados'}${fallidos ? ` · ${fallidos} con error` : ''}. Amazon tarda unos minutos en reactivar la oferta.`)
      setOfertas((x) => Object.fromEntries(Object.entries(x).filter(([k]) => !ls.some((l) => clave(l) === k))))
      void leer(ls)
      alArreglar()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se ha podido.')
    } finally {
      setAjustando(false)
    }
  }

  async function cambiar(l: ListingBloqueado) {
    const k = clave(l)
    const precio = Number((precios[k] ?? '').replace(',', '.'))
    if (!(precio > 0)) return toast.error('Escribe un precio válido.')
    const o = ofertas[k]
    const antes = o && typeof o === 'object' ? o.precio : null
    if (!window.confirm(`Cambiar el precio de ${l.sku} de ${antes ?? '—'} a ${precio}. Si se sale del mínimo o del máximo, el límite se moverá con él. Esto escribe en Amazon. ¿Seguir?`)) return
    setEnviando(k)
    try {
      const r = await pedir<{ estado: string; mensaje: string | null }>({ accion: 'precio-cambiar', cliente, mercado: l.mercado, sku: l.sku, precio })
      if (r.estado === 'aceptado') toast.success(`Precio enviado a Amazon (${precio}). Tarda unos minutos en verse.`)
      else toast.error(r.mensaje ?? 'Amazon no lo ha aceptado.')
      void leer([l])
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se ha podido.')
    } finally {
      setEnviando(null)
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--ls-linea)] bg-[color-mix(in_srgb,var(--ls-sup2)_50%,transparent)] px-4 py-2 text-[12px] text-[var(--ls-t3)]">
        {leyendo ? (
          <span className="inline-flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Leyendo el precio, el mínimo y el máximo de ahora en Amazon…</span>
        ) : (
          <span>Precio, mínimo y máximo leídos ahora de Amazon. Un desvío de más del 25 % se marca: puede que lo raro sea el precio y no el límite.</span>
        )}
        {ajustables.length > 1 && (
          <button type="button" disabled={ajustando} onClick={() => void ajustar(ajustables)} className="ml-auto inline-flex h-[28px] items-center gap-1 rounded-[8px] bg-[var(--ls-acc-relleno)] px-3 text-[12px] font-semibold text-[var(--ls-acc-tinta)] disabled:opacity-60">
            <Wand2 className="h-3 w-3" /> Ajustar los {ajustables.length} límites (desvío &lt; 25 %)
          </button>
        )}
      </div>
      <div className="flex flex-col divide-y divide-[var(--ls-linea)]">
        {visibles.map((l) => {
          const k = clave(l)
          const o = ofertas[k]
          const fuera = o && typeof o === 'object'
          return (
            <div key={k} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-[240px] flex-1">
                <Producto l={l} todos={todos} />
              </div>
              {o === undefined ? (
                <span className="text-[12px] text-[var(--ls-t4)]">leyendo…</span>
              ) : o === 'ok' ? (
                <span className="inline-flex items-center gap-1 text-[12px]" style={{ color: COLOR_ESTADO.verde }}><Check className="h-3 w-3" /> El precio ya está dentro de los límites (se reactivará en la próxima revisión)</span>
              ) : o === 'error' ? (
                <span className="text-[12px]" style={{ color: COLOR_ESTADO.rojo }}>No se ha podido leer la oferta</span>
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-3 text-[12px] tabular-nums">
                    <Cifra etiqueta="Precio" valor={dinero(o.precio, o.moneda)} fuerte />
                    <Cifra etiqueta="Mínimo" valor={dinero(o.minimo, o.moneda)} rojo={o.minimoNuevo != null} />
                    <Cifra etiqueta="Máximo" valor={dinero(o.maximo, o.moneda)} rojo={o.maximoNuevo != null} />
                  </div>
                  <span className="text-[11.5px] font-semibold" style={{ color: o.desvio >= 0.25 ? COLOR_ESTADO.rojo : 'var(--ls-t3)' }} title="Cuánto se sale el precio de su límite">
                    {Math.round(o.desvio * 100)} % fuera
                  </span>
                  <button type="button" disabled={ajustando} onClick={() => void ajustar([l])} className="inline-flex h-[30px] items-center gap-1 rounded-[9px] border border-[var(--ls-linea)] px-[10px] text-[12px] font-medium text-[var(--ls-t2)] transition-colors hover:bg-[var(--ls-sup2)]" title={o.minimoNuevo != null ? `El mínimo pasa a ${o.minimoNuevo}` : `El máximo pasa a ${o.maximoNuevo}`}>
                    Ajustar el {o.minimoNuevo != null ? 'mínimo' : 'máximo'} al precio
                  </button>
                  <span className="flex items-center gap-1">
                    <input value={precios[k] ?? ''} onChange={(e) => setPrecios((x) => ({ ...x, [k]: e.target.value }))} inputMode="decimal" placeholder="Otro precio" className="h-[30px] w-[96px] rounded-[9px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-2 text-[12px] text-[var(--ls-t1)] outline-none focus:border-[var(--ls-acc)]" />
                    <button type="button" disabled={enviando === k || !(precios[k] ?? '').trim()} onClick={() => void cambiar(l)} className="inline-flex h-[30px] items-center rounded-[9px] bg-[var(--ls-acc-relleno)] px-[10px] text-[12px] font-semibold text-[var(--ls-acc-tinta)] disabled:opacity-50">
                      {enviando === k ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Cambiar'}
                    </button>
                  </span>
                </>
              )}
              {!fuera && null}
            </div>
          )
        })}
        {listings.length > cuantos && (
          <button type="button" onClick={() => setCuantos((n) => n + POR_PAGINA)} className="px-4 py-3 text-left text-[12.5px] font-medium text-[var(--ls-acc)] hover:underline">
            Ver {Math.min(POR_PAGINA, listings.length - cuantos)} más de {listings.length - cuantos}
          </button>
        )}
      </div>
    </div>
  )
}

function Cifra({ etiqueta, valor, fuerte, rojo }: { etiqueta: string; valor: string; fuerte?: boolean; rojo?: boolean }) {
  return (
    <span className="flex flex-col">
      <span className="text-[10.5px] text-[var(--ls-t4)]">{etiqueta}</span>
      <span className={fuerte ? 'font-semibold text-[var(--ls-t1)]' : ''} style={{ color: rojo ? COLOR_ESTADO.rojo : fuerte ? undefined : 'var(--ls-t2)' }}>
        {valor}
      </span>
    </span>
  )
}
