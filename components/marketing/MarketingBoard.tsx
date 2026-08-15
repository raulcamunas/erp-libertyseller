'use client'

import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Megaphone, RefreshCw, Search } from 'lucide-react'
import { postAmazon } from '@/lib/amazon/client'
import type { CuentaDeTrabajo } from '@/lib/ads/datos'
import type { Campana, EstadoCampana } from '@/lib/ads/campanas'

/**
 * MARKETING · LAS CAMPAÑAS DE UN CLIENTE.
 *
 * Arriba las cuentas conectadas; debajo, todas las campañas de la elegida.
 *
 *
 * ============ LO QUE ESTA PANTALLA TODAVÍA NO PUEDE ENSEÑAR ============
 *
 * Impresiones, clics, gasto, ACOS. Y no es que falten por hacer: el endpoint de
 * campañas de Amazon NO DEVUELVE MÉTRICAS. Las métricas salen de los informes,
 * que son asíncronos —se piden, Amazon tarda de segundos a minutos en
 * generarlos, y se descargan de una URL firmada— y por eso son un paso aparte.
 *
 * Se dice aquí arriba y se dice en la pantalla, en vez de dejar unas columnas
 * vacías que parezcan un fallo.
 */

const ESTADOS: Record<EstadoCampana, { texto: string; clase: string }> = {
  ENABLED: { texto: 'Mostrando', clase: 'bg-green-500/15 text-green-300 border-green-500/25' },
  PAUSED: { texto: 'En pausa', clase: 'bg-zinc-600/25 text-zinc-300 border-zinc-500/25' },
  ARCHIVED: { texto: 'Archivada', clase: 'bg-white/[0.04] text-white/30 border-white/10' },
}

const SEGMENTACION: Record<string, string> = {
  AUTO: 'Automática',
  MANUAL: 'Manual',
}

/** LEGACY_FOR_SALES es «bajar solo», que es el que casi nadie sabe que tiene puesto */
const ESTRATEGIA: Record<string, string> = {
  LEGACY_FOR_SALES: 'Bajar solo',
  AUTO_FOR_SALES: 'Subir y bajar',
  MANUAL: 'Fija',
  RULE_BASED: 'Por reglas',
}

export function MarketingBoard({ cuentas }: { cuentas: CuentaDeTrabajo[] }) {
  const [cuenta, setCuenta] = useState<CuentaDeTrabajo | null>(cuentas[0] ?? null)
  const [campanas, setCampanas] = useState<Campana[]>([])
  const [truncado, setTruncado] = useState(false)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busqueda, setBusqueda] = useState('')
  const [verArchivadas, setVerArchivadas] = useState(false)

  async function traer(c: CuentaDeTrabajo) {
    setCargando(true)
    setError(null)
    setCampanas([])

    const res = await postAmazon<{ campanas: Campana[]; total: number; truncado: boolean }>(
      '/api/ads/campanas',
      { perfilId: c.perfilId }
    )
    setCargando(false)

    if (!res.ok) {
      setError(res.error)
      return
    }
    setCampanas(res.data.campanas)
    setTruncado(res.data.truncado)
  }

  // Al entrar y al cambiar de cuenta. `cuenta.perfilId` y no el objeto: una
  // referencia nueva con los mismos datos volvería a pedir todo a Amazon.
  useEffect(() => {
    if (cuenta) void traer(cuenta)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cuenta?.perfilId])

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    return campanas
      .filter((c) => (verArchivadas ? true : c.estado !== 'ARCHIVED'))
      .filter((c) => (q ? c.nombre.toLowerCase().includes(q) : true))
      // Mostrando primero, después las pausadas, y dentro de cada grupo por
      // presupuesto: donde hay más dinero en juego, arriba.
      .sort((a, b) => {
        const peso = (e: EstadoCampana) => (e === 'ENABLED' ? 0 : e === 'PAUSED' ? 1 : 2)
        return peso(a.estado) - peso(b.estado) || (b.presupuesto ?? 0) - (a.presupuesto ?? 0)
      })
  }, [campanas, busqueda, verArchivadas])

  const resumen = useMemo(() => {
    const activas = campanas.filter((c) => c.estado === 'ENABLED')
    return {
      activas: activas.length,
      pausadas: campanas.filter((c) => c.estado === 'PAUSED').length,
      diario: activas.reduce((s, c) => s + (c.presupuesto ?? 0), 0),
    }
  }, [campanas])

  const moneda = cuenta?.moneda ?? 'EUR'

  if (cuentas.length === 0) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
        <Megaphone className="h-6 w-6 text-white/20" />
        <p className="text-[13px] text-white/40">No hay ninguna cuenta lista para trabajar.</p>
        <p className="text-[11px] text-white/25 max-w-[440px]">
          En Amazon API · Publicidad, enciende las cuentas que se trabajen y dile de qué cliente es
          cada una. Hacen falta las dos cosas: sin cliente asignado no se puede saber de quién es
          el gasto.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3 pb-6">
      <div className="flex items-baseline gap-3 flex-wrap">
        <h1 className="text-[22px] font-semibold text-white">Marketing</h1>
        <p className="text-[12px] text-white/40">Las campañas de Amazon Ads, en vivo</p>
      </div>

      {/* Las cuentas. Una por país, con su cliente delante: el mismo cliente
          puede tener cuenta en cinco países y son cinco cuentas distintas. */}
      <div className="flex flex-wrap gap-1.5">
        {cuentas.map((c) => {
          const activa = cuenta?.perfilId === c.perfilId
          return (
            <button
              key={c.perfilId}
              type="button"
              onClick={() => setCuenta(c)}
              className={`px-3 py-1.5 rounded-full border text-[12px] font-medium transition-colors flex items-center gap-2 ${
                activa
                  ? 'border-[#FF6600]/60 bg-[#FF6600]/15 text-white'
                  : 'border-white/10 text-white/45 hover:text-white/80'
              }`}
            >
              {c.clienteNombre}
              <span className={activa ? 'text-white/60' : 'text-white/30'}>
                {c.pais ?? '—'}
                {c.moneda ? ` · ${c.moneda}` : ''}
              </span>
            </button>
          )
        })}
      </div>

      {cuenta && (
        <>
          {/* De un vistazo */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            {[
              { etiqueta: 'Campañas', valor: String(campanas.length) },
              { etiqueta: 'Mostrando', valor: String(resumen.activas) },
              { etiqueta: 'En pausa', valor: String(resumen.pausadas) },
              {
                etiqueta: 'Presupuesto diario',
                valor: `${resumen.diario.toLocaleString('es-ES', { maximumFractionDigits: 2 })} ${moneda}`,
                pista: 'Suma de las que están mostrando. Es el tope, no el gasto real',
              },
            ].map((m) => (
              <div
                key={m.etiqueta}
                className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2"
                title={m.pista}
              >
                <p className="text-[10px] uppercase tracking-wider text-white/35">{m.etiqueta}</p>
                <p className="text-white font-semibold text-[15px] mt-0.5 tabular-nums">
                  {cargando ? '—' : m.valor}
                </p>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-white/30" />
              <input
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder="Buscar una campaña"
                className="h-7 w-[240px] rounded-full border border-white/10 bg-white/[0.03] pl-7 pr-2 text-[11px] text-white outline-none focus:border-[#FF6600] transition-colors placeholder:text-white/25"
              />
            </div>

            <button
              type="button"
              onClick={() => setVerArchivadas((v) => !v)}
              className={`px-2.5 py-1 rounded-full border text-[11px] font-medium transition-colors ${
                verArchivadas
                  ? 'border-white/25 bg-white/10 text-white'
                  : 'border-white/10 text-white/40 hover:text-white/80'
              }`}
            >
              Ver archivadas
            </button>

            <button
              type="button"
              onClick={() => cuenta && traer(cuenta)}
              disabled={cargando}
              className="ml-auto px-2.5 py-1 rounded-full border border-white/10 text-[11px] text-white/45 hover:text-white transition-colors flex items-center gap-1.5 disabled:opacity-50"
            >
              {cargando ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3" />
              )}
              Actualizar
            </button>
          </div>

          {error && (
            <div className="rounded-xl border border-red-500/25 bg-red-500/[0.06] px-3 py-2 text-[12px] text-red-300/90">
              {error}
            </div>
          )}

          {truncado && (
            <div className="rounded-xl border border-yellow-500/25 bg-yellow-400/[0.06] px-3 py-2 text-[11px] text-yellow-200/85">
              Esta cuenta tiene más campañas de las que se han traído. Se ha cortado para no colgar
              la pantalla: si hace falta verlas todas, hay que paginar de verdad.
            </div>
          )}

          <div className="overflow-x-auto min-w-0 rounded-2xl border border-white/10">
            <table className="w-full min-w-[860px] text-[12px] border-collapse">
              <thead className="bg-white/[0.03]">
                <tr>
                  {['Campaña', 'Estado', 'Segmentación', 'Pujas', 'Presupuesto', 'Desde'].map(
                    (t, i) => (
                      <th
                        key={t}
                        className={`text-[10px] font-semibold text-white/40 uppercase tracking-wider border-b border-white/10 py-1.5 px-2.5 whitespace-nowrap ${
                          i === 4 ? 'text-right' : 'text-left'
                        }`}
                      >
                        {t}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {cargando ? (
                  <tr>
                    <td colSpan={6} className="py-10 text-center text-white/35">
                      <Loader2 className="h-4 w-4 animate-spin text-[#FF6600] inline mr-2" />
                      Pidiéndoselas a Amazon…
                    </td>
                  </tr>
                ) : visibles.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-10 text-center text-[12px] text-white/30">
                      {campanas.length === 0
                        ? 'Esta cuenta no tiene ninguna campaña de Sponsored Products.'
                        : 'Ninguna campaña con ese filtro.'}
                    </td>
                  </tr>
                ) : (
                  visibles.map((c) => (
                    <tr
                      key={c.campaignId}
                      className={`border-b border-white/[0.04] hover:bg-white/[0.03] transition-colors ${
                        c.estado === 'ARCHIVED' ? 'opacity-45' : ''
                      }`}
                    >
                      <td className="px-2.5 py-1.5 text-white/85 max-w-[380px]">
                        <span className="block truncate" title={c.nombre}>
                          {c.nombre}
                        </span>
                        <span className="block text-[10px] text-white/25 tabular-nums select-all">
                          {c.campaignId}
                        </span>
                      </td>
                      <td className="px-2.5 py-1.5">
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded border leading-none whitespace-nowrap ${ESTADOS[c.estado]?.clase ?? ''}`}
                        >
                          {ESTADOS[c.estado]?.texto ?? c.estado}
                        </span>
                      </td>
                      <td className="px-2.5 py-1.5 text-white/50 whitespace-nowrap">
                        {c.segmentacion ? (SEGMENTACION[c.segmentacion] ?? c.segmentacion) : '—'}
                      </td>
                      <td className="px-2.5 py-1.5 text-white/50 whitespace-nowrap">
                        {c.estrategiaPuja
                          ? (ESTRATEGIA[c.estrategiaPuja] ?? c.estrategiaPuja)
                          : '—'}
                      </td>
                      <td className="px-2.5 py-1.5 text-right tabular-nums text-white/80 whitespace-nowrap">
                        {c.presupuesto == null
                          ? '—'
                          : `${c.presupuesto.toLocaleString('es-ES', { maximumFractionDigits: 2 })} ${moneda}`}
                        {c.presupuestoTipo === 'DAILY' && (
                          <span className="text-white/30 text-[10px]"> /día</span>
                        )}
                      </td>
                      <td className="px-2.5 py-1.5 text-white/40 tabular-nums whitespace-nowrap">
                        {c.inicio ?? '—'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* SE DICE LO QUE FALTA. Unas columnas de gasto vacías se leerían como
              un fallo; escribirlo lo convierte en el paso siguiente. */}
          <p className="text-[10px] text-white/30">
            Todavía no salen impresiones, clics, gasto ni ACOS: el endpoint de campañas de Amazon no
            los devuelve. Esas cifras vienen de los informes, que son asíncronos y son el paso
            siguiente.
          </p>
        </>
      )}
    </div>
  )
}
