'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertCircle, Loader2, LogOut, RefreshCw, Search } from 'lucide-react'
import type { CambioEnTienda, DatosPanelPcc } from '@/lib/pccomponentes/panel-cliente'
import type { LineaVenta } from '@/lib/pccomponentes/ventas'
import { Cabecera, EntrarConClave } from './PanelTrafico'
import { dinero, entero, pct } from './formato'

/**
 * EL PANEL DE PCCOMPONENTES PARA ENTRAIS (enlace con clave, migración 329). Cuatro pestañas: el resumen (cifras de la tienda e ingresos y gastos), los pedidos,
 * los cambios de precio y los de stock que la sincronización ha enviado. SOLO LEE. Se refresca solo cada 5 minutos. Colores sueltos de la marca, como las otras
 * páginas de cliente.
 */

const ETIQUETA = 'PcComponentes'
const SORA = { fontFamily: 'var(--font-sora), system-ui' }
const hoyEnEspana = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date())
const sumarDias = (d: string, n: number) => {
  const x = new Date(`${d}T12:00:00Z`)
  x.setUTCDate(x.getUTCDate() + n)
  return x.toISOString().slice(0, 10)
}
const fechaHora = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const fechaCorta = (s: string) => new Date(`${s.slice(0, 10)}T12:00:00Z`).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
const cuando = (iso: string) => fechaHora.format(new Date(iso))

type Rango = 'hoy' | '7' | '30' | 'mes' | 'mes_ant'
const RANGOS: Array<[Rango, string]> = [['hoy', 'Hoy'], ['7', '7 días'], ['30', '30 días'], ['mes', 'Este mes'], ['mes_ant', 'Mes anterior']]
function fechas(r: Rango): { desde: string; hasta: string } {
  const hoy = hoyEnEspana()
  if (r === 'hoy') return { desde: hoy, hasta: hoy }
  if (r === '7') return { desde: sumarDias(hoy, -6), hasta: hoy }
  if (r === '30') return { desde: sumarDias(hoy, -29), hasta: hoy }
  const inicioMes = `${hoy.slice(0, 7)}-01`
  if (r === 'mes') return { desde: inicioMes, hasta: hoy }
  const finAnt = sumarDias(inicioMes, -1)
  return { desde: `${finAnt.slice(0, 7)}-01`, hasta: finAnt }
}

const ESTADO: Record<string, string> = {
  STAGING: 'Comprobando pago',
  WAITING_ACCEPTANCE: 'Por aceptar',
  WAITING_DEBIT: 'Esperando pago',
  WAITING_DEBIT_PAYMENT: 'Esperando pago',
  SHIPPING: 'Por enviar',
  SHIPPED: 'Enviado',
  TO_COLLECT: 'Para recoger',
  RECEIVED: 'Entregado',
  CLOSED: 'Cerrado',
  REFUSED: 'Rechazado',
  CANCELED: 'Cancelado',
  CLOSED_CANCELED: 'Cancelado',
  REFUNDED: 'Devuelto',
  INCIDENT_OPEN: 'Incidencia abierta',
}

const MOTIVO: Record<string, string> = {
  nueva: 'Publicado en la tienda',
  bajar_bajo_rival: 'Baja para quedar por debajo de la oferta más barata',
  subir_bajo_siguiente: 'Sube: ya era la más barata y había hueco hasta la siguiente',
  al_minimo_rival_mas_barato: 'Al precio mínimo: otra tienda vende por debajo de tu margen mínimo',
  subir_al_minimo: 'Sube al precio mínimo: estaba por debajo de tu margen mínimo',
  sin_rivales: 'Nadie más lo vende',
  ya_esta: 'Precio sin cambios',
  sin_coste: 'Sin coste conocido',
  stock: 'Cambio de stock',
}

type Pestana = 'resumen' | 'pedidos' | 'precios' | 'stock'

export function PanelPcc({ token, titulo, autenticado }: { token: string; titulo: string; autenticado: boolean }) {
  const [dentro, setDentro] = useState(autenticado)
  const alSalir = useCallback(() => setDentro(false), [])
  if (!dentro) return <EntrarConClave token={token} titulo={titulo} etiqueta={ETIQUETA} alEntrar={() => setDentro(true)} />
  return <Panel token={token} titulo={titulo} alSalir={alSalir} />
}

function Panel({ token, titulo, alSalir }: { token: string; titulo: string; alSalir: () => void }) {
  const [rango, setRango] = useState<Rango>('7')
  const [pestana, setPestana] = useState<Pestana>('resumen')
  const [datos, setDatos] = useState<DatosPanelPcc | null>(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    const { desde, hasta } = fechas(rango)
    setCargando(true)
    setError(null)
    try {
      const r = await fetch(`/api/pcc-cliente/${token}?desde=${desde}&hasta=${hasta}`, { cache: 'no-store' })
      if (r.status === 401) return alSalir()
      const j = (await r.json().catch(() => ({}))) as DatosPanelPcc & { error?: string }
      if (!r.ok) throw new Error(j.error ?? 'No se han podido leer los datos.')
      setDatos(j)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se han podido leer los datos.')
    } finally {
      setCargando(false)
    }
  }, [rango, token, alSalir])

  useEffect(() => {
    void cargar()
    const t = setInterval(() => void cargar(), 5 * 60_000)
    return () => clearInterval(t)
  }, [cargar])

  const salir = async () => {
    await fetch(`/api/trafico/${token}/entrar`, { method: 'DELETE' }).catch(() => null)
    alSalir()
  }

  const sinc = datos?.sincronizacion
  const subtitulo = sinc?.ultima ? `Última actualización de precios y stock: ${cuando(sinc.ultima)}${sinc.cadaMinutos ? ` · se repasa cada ${sinc.cadaMinutos} minutos` : ''}` : 'Ventas, pedidos, precios y stock de tu tienda en PcComponentes'
  const pedidos = useMemo(() => datos?.ventas?.lineas ?? [], [datos])

  return (
    <div className="min-h-screen bg-[#F7F5F2] text-[#141414]">
      <Cabecera titulo={titulo} etiqueta={ETIQUETA} subtitulo={subtitulo} derecha={<button type="button" onClick={() => void salir()} title="Salir" className="rounded-lg p-1.5 text-[#B8AE9F] hover:text-white"><LogOut className="h-4 w-4" /></button>} />

      <div className="z-20 border-b border-[#E5E1DB] bg-[#FFFFFF]/95 backdrop-blur sm:sticky sm:top-0">
        <div className="mx-auto flex max-w-[1240px] flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3 sm:px-8">
          <div className="inline-flex flex-wrap rounded-xl border border-[#E5E1DB] bg-[#F7F5F2] p-0.5" role="radiogroup" aria-label="Periodo">
            {RANGOS.map(([r, t]) => (
              <button key={r} type="button" role="radio" aria-checked={rango === r} onClick={() => setRango(r)} className={`rounded-[10px] px-3 py-1.5 text-[13px] font-medium ${rango === r ? 'bg-[#141414] text-white' : 'text-[#5E5852] hover:text-[#141414]'}`}>{t}</button>
            ))}
          </div>
          <div className="inline-flex flex-wrap gap-1" role="tablist">
            {([['resumen', 'Resumen'], ['pedidos', `Pedidos${datos?.ventas ? ` (${datos.ventas.resumen.pedidos})` : ''}`], ['precios', `Cambios de precio${datos ? ` (${entero(datos.precios.length)})` : ''}`], ['stock', `Cambios de stock${datos ? ` (${entero(datos.stock.length)})` : ''}`]] as Array<[Pestana, string]>).map(([p, t]) => (
              <button key={p} type="button" role="tab" aria-selected={pestana === p} onClick={() => setPestana(p)} className={`rounded-lg px-3 py-1.5 text-[13px] font-medium ${pestana === p ? 'bg-[#FEF3EC] text-[#C2410C]' : 'text-[#5E5852] hover:text-[#141414]'}`}>{t}</button>
            ))}
          </div>
          <button type="button" onClick={() => void cargar()} disabled={cargando} className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[12.5px] text-[#5E5852] hover:text-[#141414] disabled:opacity-50">
            {cargando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Actualizar
          </button>
        </div>
      </div>

      <main className="mx-auto max-w-[1240px] space-y-5 px-5 py-6 sm:px-8">
        {error && <Aviso texto={error} />}
        {!datos && !error && <div className="flex items-center gap-2 py-16 text-[14px] text-[#5E5852]"><Loader2 className="h-4 w-4 animate-spin" /> Leyendo tu tienda…</div>}
        {datos && pestana === 'resumen' && <Resumen datos={datos} />}
        {datos && pestana === 'pedidos' && <Pedidos lineas={pedidos} error={datos.ventasError} />}
        {datos && pestana === 'precios' && <Cambios filas={datos.precios} tipo="precio" recortado={datos.recortado} />}
        {datos && pestana === 'stock' && <Cambios filas={datos.stock} tipo="stock" recortado={datos.recortado} />}
      </main>
    </div>
  )
}

function Aviso({ texto }: { texto: string }) {
  return <p className="flex items-center gap-2 rounded-xl border border-[#F3C9AE] bg-[#FEF3EC] px-4 py-3 text-[13.5px] text-[#9A3412]" role="alert"><AlertCircle className="h-4 w-4 shrink-0" /> {texto}</p>
}

function Tarjeta({ titulo, valor, detalle, destacada }: { titulo: string; valor: string; detalle?: string; destacada?: boolean }) {
  return (
    <div className={`rounded-2xl border p-4 ${destacada ? 'border-[#0E0E0E] bg-[#0E0E0E]' : 'border-[#E5E1DB] bg-[#FFFFFF]'}`}>
      <p className={`text-[11px] font-semibold uppercase tracking-[0.12em] ${destacada ? 'text-[#B8AE9F]' : 'text-[#5E5852]'}`}>{titulo}</p>
      <p className={`mt-2 text-[24px] tabular-nums ${destacada ? 'text-[#F26212]' : 'text-[#141414]'}`} style={{ ...SORA, fontWeight: 600 }}>{valor}</p>
      {detalle && <p className={`mt-1 text-[12.5px] ${destacada ? 'text-[#EDE6DC]' : 'text-[#5E5852]'}`}>{detalle}</p>}
    </div>
  )
}

function Resumen({ datos }: { datos: DatosPanelPcc }) {
  const s = datos.sincronizacion
  const r = datos.ventas?.resumen ?? null
  const resultado = r ? Math.round((r.beneficio - datos.cuota) * 100) / 100 : null
  const filas: Array<[string, number | null, string, boolean?]> = r
    ? [
        ['Vendido (sin IVA)', r.venta, `${r.pedidos} pedidos · ${r.unidades} unidades${r.devuelto ? ` · ya descontados ${dinero(r.devuelto)} devueltos` : ''}`],
        ['Comisión de PcComponentes', -r.comision, r.venta ? `${pct(r.comision / r.venta, 1)} de lo vendido` : ''],
        ['Coste del producto', -r.coste, 'Proveedor, canon y porte'],
        ['Cuota de PcComponentes', -datos.cuota, '39,99 € al mes, la parte de estos días'],
        ['Beneficio', resultado, r.venta && resultado !== null ? `${pct(resultado / r.venta, 1)} de lo vendido` : '', true],
      ]
    : []
  return (
    <>
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tarjeta titulo="Vendido sin IVA" valor={r ? dinero(r.venta) : '—'} detalle={r ? `${entero(r.pedidos)} pedidos` : datos.ventasError ?? undefined} destacada />
        <Tarjeta titulo="Beneficio" valor={dinero(resultado)} detalle={r && r.venta ? `${pct((resultado ?? 0) / r.venta, 1)} de lo vendido` : undefined} />
        <Tarjeta titulo="Ofertas publicadas" valor={entero(s.publicadas)} detalle={s.conStock !== null ? `${entero(s.conStock)} con stock` : undefined} />
        <Tarjeta titulo="La más barata" valor={entero(s.primeros)} detalle={s.conStock ? `de ${entero(s.conStock)} con stock (${pct((s.primeros ?? 0) / s.conStock, 0)})` : 'ofertas con stock en las que nadie vende más barato'} />
      </section>

      {datos.ventasError && <Aviso texto={datos.ventasError} />}

      {r && (
        <section className="rounded-2xl border border-[#E5E1DB] bg-[#FFFFFF] p-5">
          <h2 className="text-[16px] text-[#141414]" style={{ ...SORA, fontWeight: 600 }}>Ingresos y gastos</h2>
          <div className="mt-3 divide-y divide-[#E5E1DB]">
            {filas.map(([t, v, d, total]) => (
              <div key={t} className={`flex items-baseline justify-between gap-4 py-2.5 ${total ? 'font-semibold' : ''}`}>
                <div>
                  <p className="text-[14px] text-[#141414]">{t}</p>
                  {d && <p className="text-[12px] text-[#5E5852]">{d}</p>}
                </div>
                <p className={`shrink-0 text-[15px] tabular-nums ${total ? (v !== null && v < 0 ? 'text-[#C0432E]' : 'text-[#F26212]') : v !== null && v < 0 ? 'text-[#5E5852]' : 'text-[#141414]'}`}>{dinero(v)}</p>
              </div>
            ))}
          </div>
          {(r.conPerdida > 0 || r.sinCoste > 0) && (
            <p className="mt-3 text-[12.5px] text-[#5E5852]">
              {r.conPerdida > 0 && <>{r.conPerdida} {r.conPerdida === 1 ? 'línea ha dejado' : 'líneas han dejado'} pérdida. </>}
              {r.sinCoste > 0 && <>{r.sinCoste} sin coste conocido (cuentan como coste cero).</>}
            </p>
          )}
          <p className="mt-2 text-[12px] text-[#9C9289]">El coste es el de hoy de cada producto. No cuentan los pedidos rechazados, cancelados ni los que esperan pago.</p>
        </section>
      )}

      {datos.ventas && datos.ventas.dias.length > 0 && (
        <section className="overflow-hidden rounded-2xl border border-[#E5E1DB] bg-[#FFFFFF]">
          <h2 className="px-5 pt-5 text-[16px] text-[#141414]" style={{ ...SORA, fontWeight: 600 }}>Por día</h2>
          <div className="overflow-x-auto p-2">
            <table className="w-full min-w-[560px] text-[13px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-[0.08em] text-[#5E5852]">
                  <th className="px-3 py-2 font-semibold">Día</th>
                  <th className="px-3 py-2 text-right font-semibold">Pedidos</th>
                  <th className="px-3 py-2 text-right font-semibold">Unidades</th>
                  <th className="px-3 py-2 text-right font-semibold">Vendido</th>
                  <th className="px-3 py-2 text-right font-semibold">Comisión</th>
                  <th className="px-3 py-2 text-right font-semibold">Coste</th>
                  <th className="px-3 py-2 text-right font-semibold">Beneficio</th>
                </tr>
              </thead>
              <tbody>
                {datos.ventas.dias.map((d) => (
                  <tr key={d.dia} className="border-t border-[#E5E1DB]">
                    <td className="px-3 py-2 capitalize">{fechaCorta(d.dia)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{d.pedidos}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{d.unidades}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{dinero(d.venta)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-[#5E5852]">{dinero(d.comision)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-[#5E5852]">{dinero(d.coste)}</td>
                    <td className={`px-3 py-2 text-right font-semibold tabular-nums ${d.beneficio < 0 ? 'text-[#C0432E]' : 'text-[#141414]'}`}>{dinero(d.beneficio)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  )
}

function Buscador({ valor, cambiar, placeholder }: { valor: string; cambiar: (v: string) => void; placeholder: string }) {
  return (
    <label className="flex h-10 max-w-[420px] items-center gap-2 rounded-xl border border-[#E5E1DB] bg-[#FFFFFF] px-3">
      <Search className="h-4 w-4 text-[#9C9289]" />
      <input value={valor} onChange={(e) => cambiar(e.target.value)} placeholder={placeholder} className="w-full bg-transparent text-[14px] outline-none" />
    </label>
  )
}

function Pedidos({ lineas, error }: { lineas: LineaVenta[]; error: string | null }) {
  const [busca, setBusca] = useState('')
  const q = busca.trim().toLowerCase()
  const vistas = q ? lineas.filter((l) => l.pedido.toLowerCase().includes(q) || l.sku.toLowerCase().includes(q) || l.titulo.toLowerCase().includes(q)) : lineas
  if (error) return <Aviso texto={error} />
  return (
    <section className="space-y-3">
      <Buscador valor={busca} cambiar={setBusca} placeholder="Buscar por pedido, SKU o producto" />
      {vistas.length === 0 ? (
        <p className="py-10 text-center text-[14px] text-[#5E5852]">No hay pedidos en este periodo.</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-[#E5E1DB] bg-[#FFFFFF] p-2">
          <table className="w-full min-w-[900px] text-[13px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-[0.08em] text-[#5E5852]">
                <th className="px-3 py-2 font-semibold">Fecha</th>
                <th className="px-3 py-2 font-semibold">Pedido</th>
                <th className="px-3 py-2 font-semibold">Producto</th>
                <th className="px-3 py-2 text-right font-semibold">Uds.</th>
                <th className="px-3 py-2 text-right font-semibold">Vendido</th>
                <th className="px-3 py-2 text-right font-semibold">Comisión</th>
                <th className="px-3 py-2 text-right font-semibold">Coste</th>
                <th className="px-3 py-2 text-right font-semibold">Beneficio</th>
                <th className="px-3 py-2 font-semibold">Estado</th>
              </tr>
            </thead>
            <tbody>
              {vistas.map((l, i) => (
                <tr key={`${l.pedido}-${l.sku}-${i}`} className={`border-t border-[#E5E1DB] ${l.cuenta ? '' : 'text-[#9C9289]'}`}>
                  <td className="whitespace-nowrap px-3 py-2">{l.fecha ? cuando(l.fecha) : '—'}</td>
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-[12px]">{l.pedido}</td>
                  <td className="max-w-[320px] px-3 py-2"><p className="truncate" title={l.titulo}>{l.titulo || '—'}</p><p className="text-[11.5px] text-[#9C9289]">SKU {l.sku}</p></td>
                  <td className="px-3 py-2 text-right tabular-nums">{l.unidades}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{dinero(l.venta)}{l.devuelto > 0 && <span className="block text-[11px] text-[#C0432E]">−{dinero(l.devuelto)} devuelto</span>}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-[#5E5852]">{dinero(l.comision)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-[#5E5852]">{dinero(l.coste)}</td>
                  <td className={`px-3 py-2 text-right font-semibold tabular-nums ${l.beneficio !== null && l.beneficio < 0 ? 'text-[#C0432E]' : ''}`}>{l.cuenta ? dinero(l.beneficio) : '—'}</td>
                  <td className="whitespace-nowrap px-3 py-2">{ESTADO[l.estado] ?? l.estado}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function Cambios({ filas, tipo, recortado }: { filas: CambioEnTienda[]; tipo: 'precio' | 'stock'; recortado: boolean }) {
  const [busca, setBusca] = useState('')
  const [cuantas, setCuantas] = useState(200)
  const q = busca.trim().toLowerCase()
  const vistas = q ? filas.filter((f) => f.sku.toLowerCase().includes(q) || (f.titulo ?? '').toLowerCase().includes(q) || (f.ean ?? '').includes(q)) : filas
  const flecha = (a: string, b: string) => <><span className="text-[#9C9289]">{a}</span> <span className="text-[#9C9289]">→</span> <b className="font-semibold">{b}</b></>
  return (
    <section className="space-y-3">
      <Buscador valor={busca} cambiar={setBusca} placeholder="Buscar por SKU, EAN o producto" />
      {recortado && <p className="text-[12.5px] text-[#5E5852]">Este periodo tiene muchísimos cambios: se enseñan los más recientes. Elige un periodo más corto para verlos todos.</p>}
      {vistas.length === 0 ? (
        <p className="py-10 text-center text-[14px] text-[#5E5852]">No hay cambios de {tipo} en este periodo.</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-[#E5E1DB] bg-[#FFFFFF] p-2">
          <table className="w-full min-w-[860px] text-[13px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-[0.08em] text-[#5E5852]">
                <th className="px-3 py-2 font-semibold">Cuándo</th>
                <th className="px-3 py-2 font-semibold">Producto</th>
                <th className="px-3 py-2 text-right font-semibold">{tipo === 'precio' ? 'Precio (con IVA)' : 'Stock'}</th>
                {tipo === 'precio' && <th className="px-3 py-2 text-right font-semibold">Más barata de otra tienda</th>}
                {tipo === 'precio' && <th className="px-3 py-2 text-right font-semibold">Precio mínimo</th>}
                <th className="px-3 py-2 font-semibold">Por qué</th>
              </tr>
            </thead>
            <tbody>
              {vistas.slice(0, cuantas).map((f, i) => (
                <tr key={`${f.at}-${f.sku}-${i}`} className="border-t border-[#E5E1DB]">
                  <td className="whitespace-nowrap px-3 py-2">{cuando(f.at)}</td>
                  <td className="max-w-[340px] px-3 py-2"><p className="truncate" title={f.titulo ?? ''}>{f.titulo || '—'}</p><p className="text-[11.5px] text-[#9C9289]">SKU {f.sku}{f.ean ? ` · EAN ${f.ean}` : ''}</p></td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                    {tipo === 'precio'
                      ? f.precioAntes === null ? <b className="font-semibold">{dinero(f.precioNuevo)}</b> : flecha(dinero(f.precioAntes), dinero(f.precioNuevo))
                      : f.stockNuevo === null ? <span className="text-[#5E5852]">actualizado</span> : f.stockAntes === null ? <b className="font-semibold">{entero(f.stockNuevo)} uds.</b> : flecha(entero(f.stockAntes), `${entero(f.stockNuevo)} uds.`)}
                  </td>
                  {tipo === 'precio' && <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-[#5E5852]">{f.rivalPrecio === null ? '—' : <>{dinero(f.rivalPrecio)}{f.rivalTienda && <span className="block text-[11px]">{f.rivalTienda}</span>}</>}</td>}
                  {tipo === 'precio' && <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-[#5E5852]">{dinero(f.minimo)}</td>}
                  <td className="px-3 py-2 text-[#5E5852]">
                    {tipo === 'stock' && f.motivo !== 'nueva' ? (f.stockNuevo === 0 ? 'Sin stock en el proveedor' : f.stockAntes === 0 ? 'Vuelve a haber stock' : 'Stock del proveedor') : MOTIVO[f.motivo] ?? f.motivo}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {vistas.length > cuantas && (
            <div className="p-3 text-center">
              <button type="button" onClick={() => setCuantas((c) => c + 500)} className="rounded-xl border border-[#E5E1DB] px-4 py-2 text-[13px] font-medium text-[#141414] hover:border-[#F26212]">Ver más ({entero(vistas.length - cuantas)} más)</button>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
