'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { AlertTriangle, ArrowRight, BadgeCheck, Banknote, CircleDollarSign, Clock3, HandCoins, Landmark, Receipt, Upload, Wallet } from 'lucide-react'
import { COLOR_ESTADO, type TonoEstado } from '@/lib/estilo/denso'
import type { CuentaDelPanel } from '@/lib/facturacion/extracto-servidor'
import { dinero, fechaCorta } from '@/components/facturacion/comun'
import { BarraReparto, CabeceraTarjeta, Iniciales, Kpi, Pastilla, Tarjeta, velo } from './ui'

interface Resumen {
  hoy: string
  cuentas: Array<CuentaDelPanel & { ultimoExtracto: string | null }>
  porCobrar: { facturas: number; total: Record<string, number> }
  vencidas: { facturas: number; total: Record<string, number>; lista: Array<{ numero: string; cliente: string; saldo: number; moneda: string; dias: number }> }
  cobradoMes: { cobros: number; total: Record<string, number> }
  gastadoMes: { total: number; porCuenta: Array<{ cuenta: string; total: number }> }
}

interface CosteEquipo {
  totals?: Array<{ period: string; eur: number; usd: number; headcount: number }>
}

const DIAS_AVISO = 8
const importes = (t: Record<string, number>) => {
  const filas = Object.entries(t).filter(([, v]) => v !== 0)
  return filas.length ? filas.map(([m, v]) => dinero(v, m)).join(' + ') : dinero(0, 'EUR')
}
const TONOS_GASTO: TonoEstado[] = ['naranja', 'violeta', 'cian', 'azul', 'magenta', 'ambar', 'verde']

/** El nombre corto de una cuenta: «Wio AED», «Payset EUR» */
const nombreCorto = (c: CuentaDelPanel) => (c.esPayset ? c.nombre.replace(/\s*\(.*\)\s*/, '') : `Wio ${c.moneda}`)

/**
 * CONTABILIDAD · EL RESUMEN.
 *
 * Una mirada para saber si todo está al día: cada banco con su saldo y lo que le falta por casar, lo que hay por cobrar (y lo vencido), lo cobrado y lo
 * gastado este mes, y lo que cuesta el equipo. Cada bloque lleva al apartado donde se arregla.
 */
export function PanelContabilidad({ esAdmin }: { esAdmin: boolean }) {
  const [r, setR] = useState<Resumen | null>(null)
  const [equipo, setEquipo] = useState<CosteEquipo | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/contabilidad/resumen', { cache: 'no-store' })
      .then(async (res) => {
        const j = await res.json()
        if (!res.ok) throw new Error(j.error ?? 'No se ha podido leer Zoho')
        setR(j)
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
    fetch('/api/employees/monthly-cost', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then(setEquipo)
      .catch(() => setEquipo(null))
  }, [])

  if (error)
    return (
      <Tarjeta acento="rojo" className="flex items-center gap-2 px-4 py-3 text-[13px]">
        <AlertTriangle className="h-4 w-4" style={{ color: COLOR_ESTADO.rojo }} /> {error}
      </Tarjeta>
    )
  if (!r) return <Esqueleto />

  const sinCasar = r.cuentas.reduce((a, c) => a + c.sinCasar, 0)
  const dias = (iso: string | null) => (iso ? Math.round((Date.parse(r.hoy) - Date.parse(iso)) / 86_400_000) : null)
  const extractoViejo = r.cuentas.filter((c) => c.esPayset).some((c) => (dias(c.ultimoExtracto) ?? 99) > DIAS_AVISO)
  const alDia = sinCasar === 0 && !extractoViejo
  const coste = equipo?.totals?.[0]
  const maxGasto = r.gastadoMes.porCuenta[0]?.total || 1

  return (
    <div className="flex max-w-[1280px] flex-col gap-3 pb-8">
      {/* Estado general */}
      <Tarjeta acento={alDia ? 'verde' : 'ambar'} className="flex flex-wrap items-center gap-3 px-4 py-3" style={{ borderColor: velo(alDia ? 'verde' : 'ambar', 35) }}>
        <span className="grid h-9 w-9 place-items-center rounded-xl" style={{ background: velo(alDia ? 'verde' : 'ambar', 16), color: COLOR_ESTADO[alDia ? 'verde' : 'ambar'] }}>
          {alDia ? <BadgeCheck className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold text-[var(--ls-t1)]">{alDia ? 'La contabilidad está al día' : 'Hay cosas por cuadrar'}</p>
          <p className="text-[12px] text-[var(--ls-t3)]">
            {alDia
              ? `Todos los bancos casados en Zoho · último extracto de Payset hace ${dias(r.cuentas.find((c) => c.esPayset)?.ultimoExtracto ?? null) ?? '—'} días`
              : [sinCasar > 0 ? `${sinCasar} movimientos de banco sin casar` : null, extractoViejo ? `más de ${DIAS_AVISO} días sin subir el extracto de Payset` : null].filter(Boolean).join(' · ')}
          </p>
        </div>
        {!alDia && (
          <Link href="/dashboard/facturacion?pestana=extractos" className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[var(--ls-acc-relleno)] px-3 text-[12px] font-semibold text-[var(--ls-acc-tinta)]">
            Ir a Bancos <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        )}
      </Tarjeta>

      {/* Las cuatro cifras */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi icono={Wallet} titulo="Por cobrar" valor={importes(r.porCobrar.total)} nota={`${r.porCobrar.facturas} facturas abiertas`} tono="azul" href="/dashboard/facturacion?pestana=cobros" />
        <Kpi icono={Clock3} titulo="Vencido" valor={importes(r.vencidas.total)} nota={`${r.vencidas.facturas} facturas pasadas de fecha`} tono={r.vencidas.facturas ? 'ambar' : 'gris'} href="/dashboard/facturacion?pestana=cobros" />
        <Kpi icono={Banknote} titulo="Cobrado este mes" valor={importes(r.cobradoMes.total)} nota={`${r.cobradoMes.cobros} cobros`} tono="verde" href="/dashboard/facturacion?pestana=cobros" />
        {coste ? (
          <Kpi icono={HandCoins} titulo="Equipo este mes" valor={dinero(coste.eur, 'EUR')} nota={`${coste.headcount} personas · ${dinero(coste.usd, 'USD')}`} tono="violeta" href={esAdmin ? '/dashboard/empleados' : '/dashboard/tesoreria'} />
        ) : (
          <Kpi icono={Receipt} titulo="Gastado este mes" valor={dinero(r.gastadoMes.total, 'AED')} nota="en Zoho, en dirhams" tono="violeta" href="/dashboard/tesoreria" />
        )}
      </div>

      <div className="grid gap-3 lg:grid-cols-[1fr_1.25fr]">
        {/* Bancos */}
        <Tarjeta>
          <CabeceraTarjeta
            icono={Landmark}
            titulo="Bancos"
            sub="Saldo en Zoho y lo que falta por casar"
            tonoIcono="cian"
            accion={
              <Link href="/dashboard/facturacion?pestana=extractos" className="inline-flex h-7 items-center gap-1 rounded-lg border border-[var(--ls-linea)] px-2.5 text-[11.5px] font-medium text-[var(--ls-t2)] hover:border-[var(--ls-linea2)]">
                <Upload className="h-3.5 w-3.5" /> Subir extracto
              </Link>
            }
          />
          <div className="grid gap-2 px-4 pb-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
            {r.cuentas.map((c) => {
              const d = dias(c.ultimoExtracto)
              const viejo = c.esPayset && (d ?? 99) > DIAS_AVISO
              const t: TonoEstado = c.sinCasar || viejo ? 'ambar' : 'verde'
              return (
                <div key={c.id} className="rounded-xl border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-3.5 py-3">
                  <div className="flex items-center gap-2">
                    <span className="grid h-6 w-6 place-items-center rounded-md text-[10px] font-bold" style={{ background: velo(c.esPayset ? 'violeta' : 'cian', 18), color: COLOR_ESTADO[c.esPayset ? 'violeta' : 'cian'] }}>
                      {c.esPayset ? 'P' : 'W'}
                    </span>
                    <span className="truncate text-[12.5px] font-medium text-[var(--ls-t2)]">{nombreCorto(c)}</span>
                    <span className="ml-auto">
                      <Pastilla tono={t}>{c.sinCasar ? `${c.sinCasar} sin casar` : viejo ? 'extracto viejo' : 'al día'}</Pastilla>
                    </span>
                  </div>
                  <div className="mt-2 text-[20px] font-semibold tabular-nums text-[var(--ls-t1)]">{dinero(c.saldo, c.moneda)}</div>
                  <div className="text-[11px] text-[var(--ls-t3)]">{c.esPayset ? `Extracto ${c.ultimoExtracto ? `del ${fechaCorta(c.ultimoExtracto)}` : 'sin subir'}` : 'Llega sola desde Wio'}</div>
                </div>
              )
            })}
          </div>
        </Tarjeta>

        {/* Facturas vencidas */}
        <Tarjeta>
          <CabeceraTarjeta
            icono={CircleDollarSign}
            titulo="Facturas vencidas"
            sub={r.vencidas.facturas ? `${importes(r.vencidas.total)} pendientes de cobro` : 'Ninguna'}
            tonoIcono="ambar"
            accion={
              <Link href="/dashboard/facturacion?pestana=cobros" className="text-[12px] font-medium text-[var(--ls-acc)]">
                Ir a cobros
              </Link>
            }
          />
          <ul className="px-2 pb-3">
            {r.vencidas.lista.length === 0 && <li className="px-2 py-4 text-[12.5px] text-[var(--ls-t3)]">Ninguna factura vencida.</li>}
            {r.vencidas.lista.map((f) => {
              const t: TonoEstado = f.dias > 30 ? 'rojo' : f.dias > 15 ? 'naranja' : 'ambar'
              return (
                <li key={f.numero} className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-[var(--ls-sup2)]">
                  <Iniciales nombre={f.cliente} tono={t} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium text-[var(--ls-t1)]">{f.cliente}</div>
                    <div className="truncate text-[11.5px] text-[var(--ls-t3)]">{f.numero}</div>
                  </div>
                  <span className="text-[13px] font-semibold tabular-nums text-[var(--ls-t1)]">{dinero(f.saldo, f.moneda)}</span>
                  <Pastilla tono={t}>{f.dias} d</Pastilla>
                </li>
              )
            })}
          </ul>
        </Tarjeta>
      </div>

      {/* Gastos del mes */}
      <Tarjeta>
        <CabeceraTarjeta icono={Receipt} titulo="Gastos de este mes en Zoho" sub={`${dinero(r.gastadoMes.total, 'AED')} en total`} tonoIcono="violeta" />
        <div className="px-4 pb-4">
          {r.gastadoMes.porCuenta.length > 0 && (
            <div className="mb-3">
              <BarraReparto alto={10} partes={r.gastadoMes.porCuenta.map((g, i) => ({ valor: g.total, tono: TONOS_GASTO[i % TONOS_GASTO.length], titulo: `${g.cuenta}: ${dinero(g.total, 'AED')}` }))} />
            </div>
          )}
          {r.gastadoMes.porCuenta.length === 0 && <p className="text-[12.5px] text-[var(--ls-t3)]">Sin gastos apuntados este mes.</p>}
          <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
            {r.gastadoMes.porCuenta.map((g, i) => {
              const t = TONOS_GASTO[i % TONOS_GASTO.length]
              return (
                <div key={g.cuenta} className="flex items-center gap-2.5">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: COLOR_ESTADO[t] }} />
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-[var(--ls-t2)]">{g.cuenta}</span>
                  <div className="hidden h-1.5 w-24 overflow-hidden rounded-full bg-[var(--ls-sup3)] sm:block">
                    <div className="h-full rounded-full" style={{ width: `${Math.max(4, (g.total / maxGasto) * 100)}%`, background: COLOR_ESTADO[t] }} />
                  </div>
                  <span className="w-[92px] text-right text-[12.5px] font-semibold tabular-nums text-[var(--ls-t1)]">{dinero(g.total, 'AED')}</span>
                </div>
              )
            })}
          </div>
        </div>
      </Tarjeta>
    </div>
  )
}

function Esqueleto() {
  return (
    <div className="flex max-w-[1280px] flex-col gap-3">
      <div className="h-[62px] animate-pulse rounded-2xl bg-[var(--ls-sup)]" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-[112px] animate-pulse rounded-2xl bg-[var(--ls-sup)]" />
        ))}
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="h-[240px] animate-pulse rounded-2xl bg-[var(--ls-sup)]" />
        <div className="h-[240px] animate-pulse rounded-2xl bg-[var(--ls-sup)]" />
      </div>
    </div>
  )
}
