'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { AlertTriangle, ArrowRight, CheckCircle2 } from 'lucide-react'
import { COLOR_ESTADO, TABLA, TARJETA, TEXTO, TIPO } from '@/lib/estilo/denso'
import type { CuentaDelPanel } from '@/lib/facturacion/extracto-servidor'
import { Aviso, dinero, fechaCorta } from '@/components/facturacion/comun'

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
  return filas.length ? filas.map(([m, v]) => dinero(v, m)).join(' + ') : '0'
}

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

  if (error) return <Aviso tono="rojo" icono={AlertTriangle}>{error}</Aviso>
  if (!r) return <p className={`${TIPO.s} ${TEXTO.t3}`}>Leyendo Zoho…</p>

  const sinCasar = r.cuentas.reduce((a, c) => a + c.sinCasar, 0)
  const extractoViejo = r.cuentas.filter((c) => c.esPayset).some((c) => !c.ultimoExtracto || (Date.parse(r.hoy) - Date.parse(c.ultimoExtracto)) / 86_400_000 > DIAS_AVISO)
  const alDia = sinCasar === 0 && !extractoViejo
  const coste = equipo?.totals?.[0]

  return (
    <div className="flex max-w-[1200px] flex-col gap-2 pb-6">
      <div className="flex items-center gap-2 rounded-[6px] border px-3 py-2" style={{ borderColor: alDia ? COLOR_ESTADO.verde : COLOR_ESTADO.ambar }}>
        {alDia ? <CheckCircle2 className="h-4 w-4" style={{ color: COLOR_ESTADO.verde }} /> : <AlertTriangle className="h-4 w-4" style={{ color: COLOR_ESTADO.ambar }} />}
        <span className={`${TIPO.m} ${TEXTO.t1}`}>
          {alDia
            ? 'La contabilidad está al día: todos los bancos casados en Zoho.'
            : [sinCasar > 0 ? `${sinCasar} movimientos de banco sin casar` : null, extractoViejo ? `hace más de ${DIAS_AVISO} días que no se sube el extracto de Payset` : null].filter(Boolean).join(' · ')}
        </span>
        {!alDia && (
          <Link href="/dashboard/facturacion?pestana=extractos" className={`ml-auto inline-flex items-center gap-1 ${TIPO.s} ${TEXTO.acento}`}>
            Ir a Bancos <ArrowRight className="h-3 w-3" />
          </Link>
        )}
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Cifra titulo="Por cobrar" valor={importes(r.porCobrar.total)} nota={`${r.porCobrar.facturas} facturas abiertas`} href="/dashboard/facturacion?pestana=cobros" />
        <Cifra titulo="Vencido" valor={importes(r.vencidas.total)} nota={`${r.vencidas.facturas} facturas`} tono={r.vencidas.facturas > 0 ? COLOR_ESTADO.ambar : undefined} href="/dashboard/facturacion?pestana=cobros" />
        <Cifra titulo="Cobrado este mes" valor={importes(r.cobradoMes.total)} nota={`${r.cobradoMes.cobros} cobros`} tono={COLOR_ESTADO.verde} href="/dashboard/facturacion?pestana=cobros" />
        {coste ? (
          <Cifra titulo="Equipo este mes" valor={dinero(coste.eur, 'EUR')} nota={`${coste.headcount} personas${coste.usd ? ` · ${dinero(coste.usd, 'USD')}` : ''}`} href={esAdmin ? '/dashboard/empleados' : '/dashboard/tesoreria'} />
        ) : (
          <Cifra titulo="Gastado este mes" valor={dinero(r.gastadoMes.total, 'AED')} nota="en Zoho, en dirhams" href="/dashboard/tesoreria" />
        )}
      </div>

      <div className="grid gap-2 lg:grid-cols-2">
        <section className={TARJETA.base}>
          <header className={TARJETA.cabecera}>
            <h2 className={`${TIPO.l} ${TEXTO.t1}`}>Bancos</h2>
            <Link href="/dashboard/facturacion?pestana=extractos" className={`ml-auto ${TIPO.s} ${TEXTO.acento}`}>
              Subir extracto
            </Link>
          </header>
          <div className={TARJETA.cuerpo}>
            <table className={TABLA.tabla}>
              <tbody>
                {r.cuentas.map((c) => (
                  <tr key={c.id} className={TABLA.fila}>
                    <td className={TABLA.celda}>
                      <span className={TEXTO.t1}>{c.esPayset ? c.nombre : `Wio ${c.moneda}`}</span>
                      {c.esPayset && <span className={TEXTO.t3}> · extracto {c.ultimoExtracto ? fechaCorta(c.ultimoExtracto) : 'nunca'}</span>}
                    </td>
                    <td className={`${TABLA.celda} ${TABLA.numero}`}>{dinero(c.saldo, c.moneda)}</td>
                    <td className={`${TABLA.celda} ${TABLA.numero}`} style={{ color: c.sinCasar ? COLOR_ESTADO.ambar : COLOR_ESTADO.verde }}>
                      {c.sinCasar ? `${c.sinCasar} sin casar` : 'al día'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className={TARJETA.base}>
          <header className={TARJETA.cabecera}>
            <h2 className={`${TIPO.l} ${TEXTO.t1}`}>Facturas vencidas</h2>
            <Link href="/dashboard/facturacion?pestana=cobros" className={`ml-auto ${TIPO.s} ${TEXTO.acento}`}>
              Cobros
            </Link>
          </header>
          <div className={TARJETA.cuerpo}>
            {r.vencidas.lista.length === 0 ? (
              <p className={`${TIPO.s} ${TEXTO.t3}`}>Ninguna.</p>
            ) : (
              <table className={TABLA.tabla}>
                <tbody>
                  {r.vencidas.lista.map((f) => (
                    <tr key={f.numero} className={TABLA.fila}>
                      <td className={TABLA.celda}>
                        <span className={TEXTO.t1}>{f.cliente}</span> <span className={TEXTO.t3}>· {f.numero}</span>
                      </td>
                      <td className={`${TABLA.celda} ${TABLA.numero}`}>{dinero(f.saldo, f.moneda)}</td>
                      <td className={`${TABLA.celda} ${TABLA.numero}`} style={{ color: f.dias > 15 ? COLOR_ESTADO.rojo : COLOR_ESTADO.ambar }}>
                        {f.dias} d
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </div>

      <section className={TARJETA.base}>
        <header className={TARJETA.cabecera}>
          <h2 className={`${TIPO.l} ${TEXTO.t1}`}>Gastos de este mes en Zoho</h2>
          <span className={`${TIPO.s} ${TEXTO.t3}`}>· {dinero(r.gastadoMes.total, 'AED')} en total</span>
        </header>
        <div className={`${TARJETA.cuerpo} flex flex-col gap-[6px]`}>
          {r.gastadoMes.porCuenta.length === 0 && <p className={`${TIPO.s} ${TEXTO.t3}`}>Sin gastos apuntados este mes.</p>}
          {r.gastadoMes.porCuenta.map((g) => (
            <div key={g.cuenta} className="flex items-center gap-2">
              <span className={`${TIPO.s} ${TEXTO.t2} w-[200px] shrink-0 truncate`}>{g.cuenta}</span>
              <div className="h-[8px] flex-1 overflow-hidden rounded-full bg-[var(--ls-sup3)]">
                <div className="h-full rounded-full bg-[var(--ls-acc-graf)]" style={{ width: `${Math.max(2, (g.total / (r.gastadoMes.porCuenta[0]?.total || 1)) * 100)}%` }} />
              </div>
              <span className={`${TIPO.s} ${TEXTO.t2} w-[110px] shrink-0 text-right tabular-nums`}>{dinero(g.total, 'AED')}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

function Cifra({ titulo, valor, nota, tono, href }: { titulo: string; valor: string; nota: string; tono?: string; href: string }) {
  return (
    <Link href={href} className={`${TARJETA.base} block px-3 py-2 transition-colors hover:border-[var(--ls-linea2)]`}>
      <div className={`${TIPO.xs} ${TEXTO.t4}`}>{titulo}</div>
      <div className="mt-[2px] text-[17px] font-semibold tabular-nums" style={{ color: tono ?? 'var(--ls-t1)' }}>
        {valor}
      </div>
      <div className={`${TIPO.s} ${TEXTO.t3}`}>{nota}</div>
    </Link>
  )
}
