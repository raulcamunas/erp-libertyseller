'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import { BOTON, COLOR_ESTADO, TABLA } from '@/lib/estilo/denso'
import type { DiaVentas, LineaVenta, ResumenVentas } from '@/lib/pccomponentes/ventas'
import { cx } from '@/components/remesas/comun/ui'

const eur = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`)
const pct = (n: number) => `${(n * 100).toLocaleString('es-ES', { maximumFractionDigits: 1 })} %`
const iso = (d: Date) => d.toISOString().slice(0, 10)
const dia = (s: string) => new Date(`${s.slice(0, 10)}T12:00:00`).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' })

const ESTADO: Record<string, string> = {
  SHIPPING: 'Por enviar',
  SHIPPED: 'Enviado',
  TO_COLLECT: 'Para recoger',
  RECEIVED: 'Recibido',
  CLOSED: 'Cerrado',
  REFUSED: 'Rechazado',
  CANCELED: 'Cancelado',
  REFUNDED: 'Devuelto',
  INCIDENT_OPEN: 'Incidencia',
  WAITING_ACCEPTANCE: 'Por aceptar',
  WAITING_DEBIT: 'Esperando pago',
  WAITING_DEBIT_PAYMENT: 'Esperando pago',
}

type Rango = 'hoy' | '7' | '30' | 'mes' | 'mes_ant'
function fechas(r: Rango): [string, string] {
  const hoy = new Date()
  if (r === 'hoy') return [iso(hoy), iso(hoy)]
  if (r === '7' || r === '30') return [iso(new Date(Date.now() - (Number(r) - 1) * 86_400_000)), iso(hoy)]
  if (r === 'mes') return [iso(new Date(hoy.getFullYear(), hoy.getMonth(), 1, 12)), iso(hoy)]
  return [iso(new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1, 12)), iso(new Date(hoy.getFullYear(), hoy.getMonth(), 0, 12))]
}

/**
 * LAS VENTAS DE ENTRAIS EN PCCOMPONENTES (lib/pccomponentes/ventas.ts): pedidos, lo vendido, la comisión de cada venta y lo que se ha ganado o perdido,
 * por día y pedido a pedido. Todo sin IVA. El coste es el de hoy de cada producto (aproximación: el del día de la venta no se guarda).
 */
export function VentasPcc() {
  const [rango, setRango] = useState<Rango>('30')
  const [datos, setDatos] = useState<{ resumen: ResumenVentas; dias: DiaVentas[]; lineas: LineaVenta[] } | null>(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [desde, hasta] = useMemo(() => fechas(rango), [rango])

  const cargar = useCallback(async () => {
    setCargando(true)
    try {
      const res = await fetch(`/api/pccomponentes/ventas?desde=${desde}&hasta=${hasta}`, { cache: 'no-store' })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error ?? 'No se han podido leer los pedidos')
      setDatos(j)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setCargando(false)
    }
  }, [desde, hasta])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const r = datos?.resumen
  const maxDia = Math.max(1, ...(datos?.dias ?? []).map((d) => d.venta))

  return (
    <div className="flex max-w-[1300px] flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-[8px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] p-[3px]">
          {(
            [
              ['hoy', 'Hoy'],
              ['7', '7 días'],
              ['30', '30 días'],
              ['mes', 'Este mes'],
              ['mes_ant', 'Mes anterior'],
            ] as const
          ).map(([id, t]) => (
            <button key={id} type="button" onClick={() => setRango(id)} className={cx('h-7 rounded-[6px] px-3 text-[12px] font-medium', rango === id ? 'bg-[var(--ls-sup)] text-[var(--ls-t1)] shadow-sm' : 'text-[var(--ls-t3)] hover:text-[var(--ls-t1)]')}>
              {t}
            </button>
          ))}
        </div>
        <span className="text-[12px] text-[var(--ls-t3)]">
          {dia(desde)} – {dia(hasta)} · todo sin IVA
        </span>
        <button type="button" onClick={() => void cargar()} disabled={cargando} className={cx(BOTON.base, BOTON.alto, BOTON.secundario, 'ml-auto')}>
          {cargando ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} Actualizar
        </button>
      </div>

      {error && <div className="rounded-[8px] border px-3 py-2 text-[12.5px]" style={{ borderColor: COLOR_ESTADO.ambar, color: COLOR_ESTADO.ambar }}>{error}</div>}
      {!datos && !error && (
        <div className="flex items-center gap-2 text-[12px] text-[var(--ls-t3)]">
          <Loader2 className="h-3 w-3 animate-spin" /> Leyendo los pedidos de PcComponentes…
        </div>
      )}

      {r && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {(
              [
                ['Pedidos', String(r.pedidos), `${r.unidades} unidades`, null],
                ['Vendido', eur(r.venta), r.devuelto ? `${eur(r.devuelto)} devueltos` : 'sin IVA', null],
                ['Comisión PcComponentes', eur(r.comision), r.venta ? `${pct(r.comision / r.venta)} de lo vendido` : '', COLOR_ESTADO.naranja],
                ['Coste de producto', eur(r.coste), r.sinCoste ? `${r.sinCoste} líneas sin coste` : 'proveedor + canon + porte', null],
                ['Beneficio', eur(r.beneficio), `${pct(r.margen)} de lo vendido`, r.beneficio >= 0 ? COLOR_ESTADO.verde : COLOR_ESTADO.rojo],
                ['Ventas con pérdida', String(r.conPerdida), r.noCuentan ? `${r.noCuentan} rechazadas o canceladas (no cuentan)` : '', r.conPerdida ? COLOR_ESTADO.rojo : null],
              ] as const
            ).map(([t, v, n, c]) => (
              <div key={t} className="rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] px-3 py-2.5">
                <div className="text-[11.5px] text-[var(--ls-t3)]">{t}</div>
                <div className="mt-0.5 text-[20px] font-semibold tabular-nums" style={{ color: c ?? 'var(--ls-t1)' }}>
                  {v}
                </div>
                <div className="truncate text-[11px] text-[var(--ls-t4)]">{n}</div>
              </div>
            ))}
          </div>

          <div className="rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup)]">
            <div className="px-3 py-2 text-[13px] font-semibold text-[var(--ls-t1)]">Día a día</div>
            {datos.dias.length === 0 ? (
              <p className="px-3 pb-3 text-[12.5px] text-[var(--ls-t3)]">Ninguna venta en estas fechas.</p>
            ) : (
              <table className={TABLA.tabla}>
                <thead>
                  <tr>
                    {['Día', 'Pedidos', 'Vendido', '', 'Comisión', 'Coste', 'Beneficio'].map((t, i) => (
                      <th key={i} className={cx(TABLA.cabecera, i > 0 && i !== 3 ? TABLA.derecha : '')}>
                        {t}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {datos.dias.map((d) => (
                    <tr key={d.dia} className={TABLA.fila}>
                      <td className={cx(TABLA.celda, 'capitalize')}>{dia(d.dia)}</td>
                      <td className={cx(TABLA.celda, TABLA.numero)}>{d.pedidos}</td>
                      <td className={cx(TABLA.celda, TABLA.numero)}>{eur(d.venta)}</td>
                      <td className={cx(TABLA.celda, 'w-[160px]')}>
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--ls-sup3)]">
                          <div className="h-full rounded-full bg-[var(--ls-acc-graf)]" style={{ width: `${Math.max(2, (d.venta / maxDia) * 100)}%` }} />
                        </div>
                      </td>
                      <td className={cx(TABLA.celda, TABLA.numero)} style={{ color: COLOR_ESTADO.naranja }}>
                        {eur(d.comision)}
                      </td>
                      <td className={cx(TABLA.celda, TABLA.numero)}>{eur(d.coste)}</td>
                      <td className={cx(TABLA.celda, TABLA.numero, 'font-semibold')} style={{ color: d.beneficio >= 0 ? COLOR_ESTADO.verde : COLOR_ESTADO.rojo }}>
                        {eur(d.beneficio)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="overflow-hidden rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup)]">
            <div className="px-3 py-2 text-[13px] font-semibold text-[var(--ls-t1)]">Venta a venta</div>
            <div className="max-h-[560px] overflow-auto">
              <table className={TABLA.tabla}>
                <thead>
                  <tr>
                    {['Fecha', 'Pedido', 'Producto', 'Uds', 'Vendido', 'Comisión', '% com.', 'Coste', 'Beneficio', 'Estado'].map((t, i) => (
                      <th key={t} className={cx(TABLA.cabecera, i >= 3 && i <= 8 ? TABLA.derecha : '')}>
                        {t}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {datos.lineas.map((l, i) => (
                    <tr key={`${l.pedido}-${i}`} className={TABLA.fila} style={l.cuenta ? undefined : { opacity: 0.5 }}>
                      <td className={TABLA.celda}>{dia(l.fecha)}</td>
                      <td className={cx(TABLA.celda, 'text-[var(--ls-t3)]')}>{l.pedido}</td>
                      <td className={cx(TABLA.celda, 'max-w-[320px]')}>
                        <span className={TABLA.corta} title={l.titulo}>
                          <span className="text-[var(--ls-t4)]">{l.sku}</span> · {l.titulo}
                        </span>
                      </td>
                      <td className={cx(TABLA.celda, TABLA.numero)}>{l.unidades}</td>
                      <td className={cx(TABLA.celda, TABLA.numero)}>{eur(l.venta)}</td>
                      <td className={cx(TABLA.celda, TABLA.numero)} style={{ color: COLOR_ESTADO.naranja }}>
                        {eur(l.comision)}
                      </td>
                      <td className={cx(TABLA.celda, TABLA.numero)}>{l.venta ? pct(l.comisionPct) : '—'}</td>
                      <td className={cx(TABLA.celda, TABLA.numero)}>{l.coste === null ? <span style={{ color: COLOR_ESTADO.ambar }}>sin coste</span> : eur(l.coste)}</td>
                      <td className={cx(TABLA.celda, TABLA.numero, 'font-semibold')} style={{ color: l.beneficio === null ? undefined : l.beneficio >= 0 ? COLOR_ESTADO.verde : COLOR_ESTADO.rojo }}>
                        {eur(l.beneficio)}
                      </td>
                      <td className={TABLA.celda}>
                        {ESTADO[l.estado] ?? l.estado}
                        {l.devuelto ? <span className="text-[var(--ls-t4)]"> · devuelto {eur(l.devuelto)}</span> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <p className="text-[11.5px] text-[var(--ls-t3)]">
            Sin IVA. Comisión = la que cobra PcComponentes en cada pedido (en una devolución, descontada la que devuelve). Coste = el de hoy de cada producto (proveedor + canon + porte); en una devolución solo cuenta el porte, porque el producto vuelve. Las líneas rechazadas o canceladas salen en gris y no suman.
          </p>
        </>
      )}
    </div>
  )
}
