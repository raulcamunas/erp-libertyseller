'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { postAmazon } from '@/lib/amazon/client'
import type { Campana, EstadoCampana } from '@/lib/ads/campanas'
import type { FilaInforme } from '@/lib/ads/informes'

/**
 * LA TABLA DE CAMPAÑAS CON SU RENDIMIENTO.
 *
 * Junta dos fuentes que Amazon devuelve por separado y que NO se pueden pedir a
 * la vez:
 *
 *   la campaña  -> nombre, estado, presupuesto, ajuste del top. Al instante.
 *   el informe  -> impresiones, clics, gasto, ventas. Asíncrono, tarda.
 *
 * Por eso la tabla se pinta ENTERA con lo primero y las cifras van entrando
 * después. Esperar a tener las dos cosas dejaría la pantalla en blanco durante
 * minutos por unas columnas que no todo el mundo mira.
 *
 *
 * ============ LAS MÉTRICAS DERIVADAS SE CALCULAN AQUÍ ============
 *
 * CTR, CVR, CPC, ACOS y ROAS NO vienen en el informe: salen de dividir las que
 * sí vienen. Se calculan en el navegador a propósito, para que sea imposible que
 * la tabla enseñe un ACOS que no cuadre con el gasto y las ventas que tiene al
 * lado — que es lo que pasa en cuanto dos sitios distintos calculan lo mismo.
 *
 * Y todas devuelven null cuando el denominador es cero. Un ACOS de «0 %» con
 * cero ventas se lee como una campaña perfecta, y es justo la contraria.
 */

const ESTADOS: Record<EstadoCampana, { texto: string; clase: string }> = {
  ENABLED: { texto: 'Mostrando', clase: 'bg-green-500/15 text-green-300 border-green-500/25' },
  PAUSED: { texto: 'En pausa', clase: 'bg-zinc-600/25 text-zinc-300 border-zinc-500/25' },
  ARCHIVED: { texto: 'Archivada', clase: 'bg-white/[0.04] text-white/30 border-white/10' },
}

/** null si no se puede dividir. Ver la nota de arriba */
function ratio(a: number, b: number): number | null {
  return b > 0 ? a / b : null
}

function pct(v: number | null, decimales = 2): string {
  return v === null ? '—' : `${(v * 100).toLocaleString('es-ES', { maximumFractionDigits: decimales })} %`
}

function dinero(v: number | null, moneda: string, decimales = 2): string {
  return v === null
    ? '—'
    : `${v.toLocaleString('es-ES', { minimumFractionDigits: decimales, maximumFractionDigits: decimales })} ${moneda}`
}

function entero(v: number | null): string {
  return v === null ? '—' : v.toLocaleString('es-ES')
}

const TH =
  'text-[10px] font-semibold text-white/40 uppercase tracking-wider border-b border-white/10 py-1.5 px-2 whitespace-nowrap'

export function TablaCampanas({
  campanas,
  metricas,
  perfilId,
  moneda,
  cargandoMetricas,
}: {
  campanas: Campana[]
  /** Por campaignId. Vacío mientras el informe se genera */
  metricas: Record<string, FilaInforme>
  perfilId: string
  moneda: string
  cargandoMetricas: boolean
}) {
  return (
    <div className="overflow-x-auto min-w-0 rounded-2xl border border-white/10">
      <table className="w-full min-w-[1500px] text-[12px] border-collapse">
        <thead className="bg-white/[0.03]">
          <tr>
            <th className={`${TH} text-left sticky left-0 bg-[#0d0d0d] z-10 min-w-[260px]`}>
              Campaña
            </th>
            <th className={`${TH} text-left`}>Estado</th>
            <th className={`${TH} text-left`}>Segmentación</th>
            <th className={`${TH} text-right`}>Presupuesto</th>
            <th className={`${TH} text-right`} title="Cuánto más se puja por salir arriba del todo">
              Top búsq.
            </th>
            <th className={`${TH} text-right`}>Impresiones</th>
            <th className={`${TH} text-right`}>Clics</th>
            <th className={`${TH} text-right`} title="Clics entre impresiones">
              CTR
            </th>
            <th className={`${TH} text-right`} title="Compras entre clics">
              CVR
            </th>
            <th className={`${TH} text-right`}>Coste</th>
            <th className={`${TH} text-right`} title="Coste por clic">
              CPC
            </th>
            <th className={`${TH} text-right`}>Compras</th>
            <th className={`${TH} text-right`}>Ventas</th>
            <th className={`${TH} text-right`} title="Coste entre ventas: cuánto cuesta vender un euro">
              ACOS
            </th>
            <th className={`${TH} text-right`} title="Ventas entre coste: cuánto vuelve por cada euro">
              ROAS
            </th>
          </tr>
        </thead>
        <tbody>
          {campanas.map((c) => {
            const m = metricas[c.campaignId]
            const impresiones = m?.impressions ?? null
            const clics = m?.clicks ?? null
            const coste = m?.cost ?? null
            const compras = m?.purchases ?? null
            const ventas = m?.sales ?? null

            const ctr = m ? ratio(m.clicks, m.impressions) : null
            const cvr = m ? ratio(m.purchases, m.clicks) : null
            const cpc = m ? ratio(m.cost, m.clicks) : null
            const acos = m ? ratio(m.cost, m.sales) : null
            const roas = m ? ratio(m.sales, m.cost) : null

            return (
              <tr
                key={c.campaignId}
                className={`border-b border-white/[0.04] hover:bg-white/[0.03] transition-colors ${
                  c.estado === 'ARCHIVED' ? 'opacity-45' : ''
                }`}
              >
                <td className="px-2 py-1.5 sticky left-0 bg-[#0d0d0d] z-10 max-w-[320px]">
                  <span className="block truncate text-white/85" title={c.nombre}>
                    {c.nombre}
                  </span>
                  <span className="block text-[10px] text-white/25 tabular-nums select-all">
                    {c.campaignId}
                  </span>
                </td>

                <td className="px-2 py-1.5">
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded border leading-none whitespace-nowrap ${ESTADOS[c.estado]?.clase ?? ''}`}
                  >
                    {ESTADOS[c.estado]?.texto ?? c.estado}
                  </span>
                </td>

                <td className="px-2 py-1.5 text-white/50 whitespace-nowrap">
                  {c.segmentacion === 'AUTO'
                    ? 'Automática'
                    : c.segmentacion === 'MANUAL'
                      ? 'Manual'
                      : '—'}
                </td>

                <td className="px-2 py-1.5 text-right tabular-nums text-white/80 whitespace-nowrap">
                  {dinero(c.presupuesto, moneda)}
                  {c.presupuestoTipo === 'DAILY' && (
                    <span className="text-white/25 text-[10px]"> /día</span>
                  )}
                </td>

                <td className="px-2 py-1.5 text-right">
                  <AjusteTop campana={c} perfilId={perfilId} />
                </td>

                <td className="px-2 py-1.5 text-right tabular-nums text-white/70">
                  {cargandoMetricas && !m ? '·' : entero(impresiones)}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums text-white/70">
                  {cargandoMetricas && !m ? '·' : entero(clics)}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums text-white/50">{pct(ctr)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-white/50">{pct(cvr)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-white/80">
                  {dinero(coste, moneda)}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums text-white/50">
                  {dinero(cpc, moneda)}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums text-white/70">
                  {entero(compras)}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums text-white/85">
                  {dinero(ventas, moneda)}
                </td>

                {/* ACOS Y ROAS CON COLOR, que son las dos que se leen de un
                    vistazo. Por encima del 100 % de ACOS se está vendiendo a
                    pérdida en publicidad, y eso tiene que saltar a la vista sin
                    tener que comparar dos números. */}
                <td
                  className={`px-2 py-1.5 text-right tabular-nums font-semibold ${
                    acos === null
                      ? 'text-white/25'
                      : acos > 1
                        ? 'text-red-300'
                        : acos > 0.35
                          ? 'text-yellow-300'
                          : 'text-green-300'
                  }`}
                >
                  {pct(acos)}
                </td>
                <td
                  className={`px-2 py-1.5 text-right tabular-nums ${
                    roas === null ? 'text-white/25' : roas < 1 ? 'text-red-300' : 'text-white/80'
                  }`}
                >
                  {roas === null ? '—' : roas.toLocaleString('es-ES', { maximumFractionDigits: 2 })}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/**
 * EL AJUSTE DEL TOP, EDITABLE. Y ES LA ÚNICA CASILLA DE ESTA PANTALLA QUE
 * ESCRIBE EN LA CUENTA DEL CLIENTE.
 *
 * Guarda al salir del foco y no en cada tecla: escribiendo «150» pasaría por 1 y
 * por 15, y cada paso intermedio sería una llamada de verdad a Amazon cambiando
 * la puja. Con Enter también, que es como lo va a usar todo el mundo.
 *
 * Y pide confirmación por encima del 100 %: ahí cada clic desde la primera
 * posición ya cuesta el doble, y la diferencia entre teclear 50 y 500 son dos
 * caracteres.
 */
function AjusteTop({ campana, perfilId }: { campana: Campana; perfilId: string }) {
  const [valor, setValor] = useState(String(campana.topDeBusquedas ?? 0))
  const [guardando, setGuardando] = useState(false)

  async function guardar() {
    const pct = Number(valor)
    const actual = campana.topDeBusquedas ?? 0

    if (!Number.isFinite(pct) || pct < 0 || pct > 900) {
      toast.error('Tiene que ser un número entre 0 y 900')
      setValor(String(actual))
      return
    }
    if (Math.round(pct) === actual) return

    if (
      pct > 100 &&
      !confirm(
        `¿Poner el ajuste del top de búsquedas de «${campana.nombre}» en ${Math.round(pct)} %?\n\n` +
          `Cada clic desde la primera posición pasará a costar un ${Math.round(pct)} % más. ` +
          'Es dinero del cliente y se nota en la factura del mismo día.'
      )
    ) {
      setValor(String(actual))
      return
    }

    setGuardando(true)
    const res = await postAmazon<{ ok: true; porcentaje: number }>('/api/ads/campanas/top', {
      perfilId,
      campaignId: campana.campaignId,
      porcentaje: pct,
    })
    setGuardando(false)

    if (!res.ok) {
      toast.error(res.error)
      setValor(String(actual))
      return
    }
    // La campaña de la lista se queda con el valor viejo hasta que se recargue,
    // así que se dice con el número para que no haya duda de qué quedó puesto.
    toast.success(`«${campana.nombre}» → ${res.data.porcentaje} %`)
  }

  return (
    <span className="inline-flex items-center gap-1">
      {guardando && <Loader2 className="h-3 w-3 animate-spin text-[#FF6600]" />}
      <input
        value={valor}
        onChange={(e) => setValor(e.target.value.replace(/[^\d]/g, ''))}
        onBlur={guardar}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') {
            setValor(String(campana.topDeBusquedas ?? 0))
            e.currentTarget.blur()
          }
        }}
        inputMode="numeric"
        disabled={guardando}
        title="Ajuste de puja para el top de búsquedas. Escribe y pulsa Enter"
        className="w-[52px] h-6 rounded-md border border-white/10 bg-white/[0.03] px-1 text-right text-[11px] text-white tabular-nums outline-none focus:border-[#FF6600] transition-colors disabled:opacity-50"
      />
      <span className="text-white/25 text-[10px]">%</span>
    </span>
  )
}
