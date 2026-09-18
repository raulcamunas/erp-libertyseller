'use client'

import { useMemo, useState } from 'react'
import { AlertTriangle, Boxes, Package, Plus, TrendingDown } from 'lucide-react'
import type { PanelRemesas as Panel, RemesaDePanel, SkuDePanel } from '@/lib/fba/datos'
import { NuevaRemesaDialog } from './NuevaRemesaDialog'

/**
 * EL TABLERO DE REMESAS.
 *
 * Dos vistas del mismo reparto, y las dos hacen falta:
 *
 *   · Por ENVÍO, que es como se trabajaba en el Excel: «del pedido del 4 de mayo
 *     queda un 30 %». Sirve para decidir si ya toca reponer.
 *   · Por REFERENCIA, que el Excel no tenía y es la que contesta la pregunta de
 *     verdad: «esta talla se agota el viernes».
 *
 * No calcula nada: el reparto llega hecho del servidor. Aquí solo se pinta y se
 * ordena, para que no haya dos sitios donde pueda salir un número distinto.
 */

const CARD = 'glass-card p-4'
const TH =
  'px-2 py-1.5 text-left text-[10px] font-semibold text-white/40 uppercase tracking-wider whitespace-nowrap border-b border-white/10'
const TD = 'px-2 py-1.5 text-[12px] text-white/80 whitespace-nowrap'

/** Verde tranquilo, ámbar cuando aprieta, rojo cuando ya no da tiempo */
function colorDeCobertura(dias: number | null): string {
  if (dias === null) return 'text-white/30'
  if (dias <= 14) return 'text-red-400'
  if (dias <= 30) return 'text-amber-400'
  return 'text-emerald-400'
}

function barra(pct: number): string {
  if (pct >= 90) return 'bg-red-400/70'
  if (pct >= 60) return 'bg-amber-400/70'
  return 'bg-[#FF6600]/70'
}

function fecha(iso: string | null): string {
  if (!iso) return '—'
  const [a, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${a.slice(2)}`
}

export function TableroRemesas({
  clienteId,
  clienteNombre,
  panel,
}: {
  clienteId: string
  clienteNombre: string
  panel: Panel
}) {
  const [vista, setVista] = useState<'envios' | 'referencias'>('envios')
  const [nueva, setNueva] = useState(false)
  const [soloAbiertas, setSoloAbiertas] = useState(true)

  const remesas = useMemo(
    () => (soloAbiertas ? panel.remesas.filter((r) => r.quedan > 0) : panel.remesas),
    [panel.remesas, soloAbiertas]
  )

  const totales = useMemo(() => {
    const enviadas = panel.remesas.reduce((s, r) => s + r.enviadas, 0)
    const quedan = panel.remesas.reduce((s, r) => s + r.quedan, 0)
    const urgentes = panel.skus.filter(
      (s) => s.diasDeCobertura !== null && s.diasDeCobertura <= 14 && s.quedan > 0
    ).length
    const descuadre = panel.skus.reduce((s, k) => s + Math.abs(k.descuadre ?? 0), 0)
    return { enviadas, quedan, urgentes, descuadre }
  }, [panel])

  if (panel.remesas.length === 0) {
    return (
      <>
        <div className="glass-card flex h-full flex-col items-center justify-center gap-4 p-10 text-center">
          <Boxes className="h-8 w-8 text-white/20" />
          <div>
            <p className="text-sm text-white/70">Todavía no hay ninguna remesa de {clienteNombre}.</p>
            <p className="mt-1 text-[12px] text-white/40">
              Da de alta el primer envío con lo que le mandaste a Amazon y la fecha. Desde ese día
              empiezan a descontarse las ventas.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setNueva(true)}
            className="flex items-center gap-1.5 rounded-lg bg-[#FF6600] px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-[#FF6600]/85"
          >
            <Plus className="h-3.5 w-3.5" />
            Nueva remesa
          </button>
        </div>
        {nueva && (
          <NuevaRemesaDialog
            clienteId={clienteId}
            clienteNombre={clienteNombre}
            onClose={() => setNueva(false)}
          />
        )}
      </>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {/* ---------- La cabecera: cuatro números y los botones ---------- */}
      <div className="flex flex-wrap items-center gap-3">
        <Cifra etiqueta="Enviadas" valor={totales.enviadas} />
        <Cifra etiqueta="Vivas" valor={totales.quedan} destacada />
        <Cifra
          etiqueta="Se agotan en 14 días"
          valor={totales.urgentes}
          tono={totales.urgentes > 0 ? 'alerta' : undefined}
        />
        {totales.descuadre > 0 && (
          <Cifra etiqueta="Descuadre" valor={totales.descuadre} tono="aviso" />
        )}

        <div className="ml-auto flex items-center gap-2">
          {panel.leidoHasta && (
            <span className="text-[10px] text-white/30">
              Movimientos leídos hasta el {fecha(panel.leidoHasta)}
            </span>
          )}
          <button
            type="button"
            onClick={() => setNueva(true)}
            className="flex items-center gap-1.5 rounded-lg bg-[#FF6600] px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-[#FF6600]/85"
          >
            <Plus className="h-3.5 w-3.5" />
            Nueva remesa
          </button>
        </div>
      </div>

      {!panel.conectado && (
        <Aviso icono={<AlertTriangle className="h-3.5 w-3.5 shrink-0" />}>
          {clienteNombre} no tiene autorizada la API de Amazon, así que las ventas no se descuentan
          solas. Las remesas se llevan igual, pero el consumo hay que meterlo a mano hasta que
          conecte su cuenta.
        </Aviso>
      )}

      {panel.ultimoError && (
        <Aviso icono={<AlertTriangle className="h-3.5 w-3.5 shrink-0" />} tono="error">
          La última lectura del libro mayor falló: {panel.ultimoError}
        </Aviso>
      )}

      {/* ---------- Las dos vistas ---------- */}
      <div className="flex items-center gap-1">
        <Pestana activa={vista === 'envios'} onClick={() => setVista('envios')}>
          <Package className="h-3.5 w-3.5" />
          Por envío
        </Pestana>
        <Pestana activa={vista === 'referencias'} onClick={() => setVista('referencias')}>
          <TrendingDown className="h-3.5 w-3.5" />
          Por referencia
        </Pestana>

        {vista === 'envios' && (
          <label className="ml-3 flex cursor-pointer items-center gap-1.5 text-[11px] text-white/45">
            <input
              type="checkbox"
              checked={soloAbiertas}
              onChange={(e) => setSoloAbiertas(e.target.checked)}
              className="h-3 w-3 accent-[#FF6600]"
            />
            Esconder las agotadas
          </label>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {vista === 'envios' ? (
          <VistaEnvios remesas={remesas} />
        ) : (
          <VistaReferencias skus={panel.skus} />
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Por envío: la vista del Excel, una fila por remesa                  */
/* ------------------------------------------------------------------ */

function VistaEnvios({ remesas }: { remesas: RemesaDePanel[] }) {
  const [abierta, setAbierta] = useState<string | null>(null)

  if (remesas.length === 0) {
    return (
      <p className="p-6 text-center text-[12px] text-white/35">
        Todas las remesas están agotadas. Quita el filtro para verlas.
      </p>
    )
  }

  return (
    <div className="space-y-2">
      {remesas.map((r) => (
        <div key={r.id} className={CARD}>
          <button
            type="button"
            onClick={() => setAbierta(abierta === r.id ? null : r.id)}
            className="flex w-full items-center gap-4 text-left"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="truncate text-[13px] font-semibold text-white">
                  {r.nombre ?? `Envío del ${fecha(r.fechaEnvio)}`}
                </span>
                <span className="text-[10px] text-white/35">{fecha(r.fechaEnvio)}</span>
                {r.llegadaAt && (
                  <span className="rounded bg-emerald-400/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-emerald-400">
                    llegó el {fecha(r.llegadaAt)}
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-[11px] text-white/40">
                {r.lineas.length} referencia{r.lineas.length === 1 ? '' : 's'} · {r.enviadas}{' '}
                unidades
              </p>
            </div>

            <div className="w-40 shrink-0">
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
                <div
                  className={`h-full rounded-full ${barra(r.consumidoPct)}`}
                  style={{ width: `${Math.min(100, r.consumidoPct)}%` }}
                />
              </div>
              <p className="mt-1 text-right text-[10px] text-white/35">
                {r.consumidoPct}% consumido
              </p>
            </div>

            <div className="w-20 shrink-0 text-right">
              <p className="text-[16px] font-semibold text-white">{r.quedan}</p>
              <p className="text-[9px] uppercase tracking-wide text-white/30">quedan</p>
            </div>
          </button>

          {abierta === r.id && (
            <div className="mt-3 overflow-x-auto border-t border-white/[0.06] pt-2">
              <table className="w-full">
                <thead>
                  <tr>
                    <th className={TH}>SKU</th>
                    <th className={TH}>Producto</th>
                    <th className={TH}>Variante</th>
                    <th className={`${TH} text-right`}>Enviadas</th>
                    <th className={`${TH} text-right`}>Vendidas</th>
                    <th className={`${TH} text-right`}>Devueltas</th>
                    <th className={`${TH} text-right`}>Quedan</th>
                    <th className={TH}>Agotada</th>
                  </tr>
                </thead>
                <tbody>
                  {r.lineas.map((l) => (
                    <tr key={l.sku} className="border-b border-white/[0.04] last:border-0">
                      <td className={`${TD} font-mono text-[11px] text-white/60`}>{l.sku}</td>
                      <td className={`${TD} max-w-[240px] truncate`} title={l.nombre ?? ''}>
                        {l.nombre ?? '—'}
                      </td>
                      <td className={TD}>{l.variante ?? '—'}</td>
                      <td className={`${TD} text-right`}>{l.enviadas}</td>
                      <td className={`${TD} text-right`}>{l.consumidas}</td>
                      <td className={`${TD} text-right ${l.devueltas > 0 ? 'text-amber-400' : 'text-white/25'}`}>
                        {l.devueltas || '—'}
                      </td>
                      <td className={`${TD} text-right font-semibold ${l.quedan === 0 ? 'text-white/25' : 'text-white'}`}>
                        {l.quedan}
                        {l.quedanVendibles !== l.quedan && (
                          <span
                            className="ml-1 text-[10px] text-amber-400"
                            title="De estas, algunas volvieron inservibles"
                          >
                            ({l.quedanVendibles} ok)
                          </span>
                        )}
                      </td>
                      <td className={`${TD} text-white/35`}>{fecha(l.agotadaEl)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Por referencia: la que dice cuándo hay que reponer                  */
/* ------------------------------------------------------------------ */

function VistaReferencias({ skus }: { skus: SkuDePanel[] }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-white/10 bg-white/[0.02]">
      <table className="w-full">
        <thead className="sticky top-0 z-10 bg-[#0d0d0d]">
          <tr>
            <th className={TH}>SKU</th>
            <th className={TH}>Producto</th>
            <th className={`${TH} text-right`}>Enviadas</th>
            <th className={`${TH} text-right`}>Quedan</th>
            <th className={`${TH} text-right`}>Ventas/día</th>
            <th className={`${TH} text-right`}>Cobertura</th>
            <th className={TH}>Se agota</th>
            <th className={`${TH} text-right`}>En Amazon</th>
            <th className={`${TH} text-right`}>Descuadre</th>
          </tr>
        </thead>
        <tbody>
          {skus.map((s) => (
            <tr key={s.sku} className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02]">
              <td className={`${TD} font-mono text-[11px] text-white/60`}>{s.sku}</td>
              <td className={`${TD} max-w-[260px] truncate`} title={s.nombre ?? ''}>
                {s.nombre ?? '—'}
              </td>
              <td className={`${TD} text-right text-white/45`}>{s.enviadas}</td>
              <td className={`${TD} text-right font-semibold`}>{s.quedan}</td>
              <td className={`${TD} text-right text-white/45`}>{s.velocidad || '—'}</td>
              <td className={`${TD} text-right font-semibold ${colorDeCobertura(s.diasDeCobertura)}`}>
                {s.diasDeCobertura === null ? 'sin ventas' : `${s.diasDeCobertura} d`}
              </td>
              <td className={`${TD} ${colorDeCobertura(s.diasDeCobertura)}`}>
                {s.quedan === 0 ? 'agotada' : fecha(s.seAgotaEl)}
              </td>
              <td className={`${TD} text-right text-white/45`}>
                {s.stockReal === null ? '—' : s.stockReal}
              </td>
              <td
                className={`${TD} text-right ${
                  s.descuadre === null || s.descuadre === 0 ? 'text-white/20' : 'text-amber-400'
                }`}
                title={
                  s.descuadre === null
                    ? ''
                    : 'Lo que Amazon dice que hay menos lo que explican las remesas. Positivo = había stock de antes'
                }
              >
                {s.descuadre === null ? '—' : s.descuadre > 0 ? `+${s.descuadre}` : s.descuadre}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Piezas sueltas                                                      */
/* ------------------------------------------------------------------ */

function Cifra({
  etiqueta,
  valor,
  destacada,
  tono,
}: {
  etiqueta: string
  valor: number
  destacada?: boolean
  tono?: 'alerta' | 'aviso'
}) {
  const color =
    tono === 'alerta'
      ? 'text-red-400'
      : tono === 'aviso'
        ? 'text-amber-400'
        : destacada
          ? 'text-[#FF6600]'
          : 'text-white'
  return (
    <div className="glass-card px-3 py-2">
      <p className={`text-[18px] font-semibold leading-none ${color}`}>{valor}</p>
      <p className="mt-1 text-[9px] uppercase tracking-wide text-white/35">{etiqueta}</p>
    </div>
  )
}

function Pestana({
  activa,
  onClick,
  children,
}: {
  activa: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors ${
        activa ? 'bg-[#FF6600]/15 text-[#FF6600]' : 'text-white/45 hover:bg-white/[0.04] hover:text-white/70'
      }`}
    >
      {children}
    </button>
  )
}

function Aviso({
  icono,
  tono,
  children,
}: {
  icono: React.ReactNode
  tono?: 'error'
  children: React.ReactNode
}) {
  return (
    <div
      className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-[11px] leading-relaxed ${
        tono === 'error'
          ? 'border-red-400/20 bg-red-400/[0.06] text-red-300'
          : 'border-amber-400/20 bg-amber-400/[0.06] text-amber-200/90'
      }`}
    >
      {icono}
      <span>{children}</span>
    </div>
  )
}
