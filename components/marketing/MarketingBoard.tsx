'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Megaphone, RefreshCw, Search } from 'lucide-react'
import { patchAmazon, postAmazon } from '@/lib/amazon/client'
import type { CuentaDeTrabajo } from '@/lib/ads/datos'
import type { Campana, EstadoCampana } from '@/lib/ads/campanas'
import type { FilaInforme } from '@/lib/ads/informes'
import { TablaCampanas } from './TablaCampanas'

/**
 * MARKETING · LAS CAMPAÑAS DE UN CLIENTE, CON SU RENDIMIENTO.
 *
 * Arriba las cuentas conectadas; debajo, todas las campañas de la elegida con
 * sus cifras.
 *
 *
 * ============ SON DOS VIAJES A AMAZON Y NO SE PUEDEN JUNTAR ============
 *
 *   la campaña  -> nombre, estado, presupuesto, ajuste del top. Al instante.
 *   el informe  -> impresiones, clics, gasto, ventas. Asíncrono: se pide, se
 *                  pregunta cada pocos segundos y se descarga comprimido.
 *
 * El endpoint de campañas NO devuelve métricas: no es una limitación que se
 * pueda rodear, es cómo está partida la API. Por eso la tabla se pinta entera
 * con lo primero y las cifras van entrando después. Esperar a tenerlo todo
 * dejaría la pantalla en blanco durante minutos.
 *
 * CTR, CVR, CPC, ACOS y ROAS tampoco vienen: se calculan dividiendo las que sí,
 * y se calculan en UN solo sitio (TablaCampanas) para que sea imposible que la
 * tabla enseñe un ACOS que no cuadre con el gasto y las ventas de al lado.
 */

/* Las etiquetas de estado, segmentación y estrategia viven en TablaCampanas.tsx,
   que es quien las pinta. Tenerlas aquí también era la vía rápida a que un día
   dijeran cosas distintas en dos sitios de la misma pantalla. */

/**
 * CADA CUÁNTO SE REFRESCA SOLO.
 *
 * No hay botón de actualizar a propósito: en una herramienta de trabajo, un
 * botón así es admitir que lo que hay en pantalla puede estar viejo y que el
 * problema es tuyo. Se refresca solo y se dice cuándo fue la última vez.
 *
 * Quince minutos porque es lo que tardan en importar los cambios de una campaña
 * —una puja o un presupuesto que se toca ahora no mueve las cifras hasta dentro
 * de un rato— y porque el cupo de la API de Amazon es por cuenta de anunciante y
 * lo comparte todo lo demás.
 */
const CADA_MS = 15 * 60_000

/** «hace 3 min». null si nunca */
function hace(t: number | null): string | null {
  if (!t) return null
  const min = Math.floor((Date.now() - t) / 60_000)
  if (min < 1) return 'hace menos de un minuto'
  if (min === 1) return 'hace 1 minuto'
  if (min < 60) return `hace ${min} minutos`
  const h = Math.floor(min / 60)
  return h === 1 ? 'hace 1 hora' : `hace ${h} horas`
}

export function MarketingBoard({ cuentas }: { cuentas: CuentaDeTrabajo[] }) {
  const [cuenta, setCuenta] = useState<CuentaDeTrabajo | null>(cuentas[0] ?? null)
  const [campanas, setCampanas] = useState<Campana[]>([])
  const [truncado, setTruncado] = useState(false)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busqueda, setBusqueda] = useState('')
  const [verArchivadas, setVerArchivadas] = useState(false)

  /** Las métricas, por campaignId. Llegan DESPUÉS que las campañas */
  const [metricas, setMetricas] = useState<Record<string, FilaInforme>>({})
  const [cargandoMetricas, setCargandoMetricas] = useState(false)
  const [periodo, setPeriodo] = useState<string>('')

  /** Cuándo se trajo lo último. Es lo que sustituye al botón de actualizar */
  const [actualizado, setActualizado] = useState<number | null>(null)
  /** Para repintar el «hace X minutos» sin volver a pedir nada */
  const [, setTic] = useState(0)

  /**
   * Una pasada a la vez.
   *
   * El refresco automático, el cambio de cuenta y la vuelta a la pestaña pueden
   * coincidir, y dos pasadas solapadas gastarían el doble de cupo de Amazon para
   * pintar lo mismo — y la que terminara segunda pisaría a la primera aunque
   * fuera más vieja.
   */
  const enMarcha = useRef(false)

  /**
   * EL INFORME, QUE ES OTRO VIAJE Y MÁS LARGO.
   *
   * Amazon lo genera en segundo plano: se pide, se pregunta cada pocos segundos
   * y cuando está se descarga. De diez segundos a varios minutos según el rango.
   *
   * Por eso la tabla se pinta ya con las campañas y estas cifras van entrando
   * después. Esperar a tenerlas todas dejaría la pantalla en blanco durante
   * minutos por unas columnas que no siempre se miran.
   */
  async function traerMetricas(c: CuentaDeTrabajo) {
    setCargandoMetricas(true)
    setMetricas({})

    const pedido = await postAmazon<{ reportId: string; desde: string; hasta: string }>(
      '/api/ads/informe',
      { perfilId: c.perfilId }
    )
    if (!pedido.ok) {
      setCargandoMetricas(false)
      toast.error(pedido.error)
      return
    }
    setPeriodo(`${pedido.data.desde} → ${pedido.data.hasta}`)

    // Hasta dos minutos preguntando. Pasado eso se deja: el informe seguirá
    // generándose en Amazon y volver a pulsar «Actualizar» lo pedirá de nuevo,
    // que es más honesto que un reloj girando para siempre.
    const hasta = Date.now() + 120_000
    while (Date.now() < hasta) {
      await new Promise((r) => setTimeout(r, 5000))

      const res = await patchAmazon<{ listo: boolean; filas?: FilaInforme[] }>(
        '/api/ads/informe',
        { perfilId: c.perfilId, reportId: pedido.data.reportId }
      )
      if (!res.ok) {
        setCargandoMetricas(false)
        toast.error(res.error)
        return
      }
      if (res.data.listo && res.data.filas) {
        const mapa: Record<string, FilaInforme> = {}
        for (const f of res.data.filas) mapa[f.campaignId] = f
        setMetricas(mapa)
        setCargandoMetricas(false)
        return
      }
    }

    setCargandoMetricas(false)
    toast.error('Amazon está tardando más de dos minutos con el informe. Vuelve a darle a Actualizar.')
  }

  /**
   * Trae todo. `primeraVez` decide si se vacía la tabla mientras llega.
   *
   * En un refresco automático NO se vacía: la pantalla parpadearía cada quince
   * minutos delante de alguien que está trabajando, y peor aún, si la llamada
   * falla se quedaría en blanco habiendo tenido datos buenos. Se sustituye lo
   * viejo cuando lo nuevo ha llegado, y si no llega se conserva lo que había con
   * su «actualizado hace X» diciendo la verdad.
   */
  const traer = useCallback(
    async (c: CuentaDeTrabajo, primeraVez: boolean) => {
      if (enMarcha.current) return
      enMarcha.current = true

      if (primeraVez) {
        setCargando(true)
        setCampanas([])
      }
      setError(null)

      const res = await postAmazon<{ campanas: Campana[]; total: number; truncado: boolean }>(
        '/api/ads/campanas',
        { perfilId: c.perfilId }
      )
      setCargando(false)

      if (!res.ok) {
        enMarcha.current = false
        // En un refresco de fondo el error NO borra la tabla: se avisa y se deja
        // lo que había, que sigue siendo lo último bueno que se supo.
        if (primeraVez) setError(res.error)
        else toast.error(`No se ha podido refrescar: ${res.error}`)
        return
      }

      setCampanas(res.data.campanas)
      setTruncado(res.data.truncado)
      setActualizado(Date.now())

      await traerMetricas(c)
      enMarcha.current = false
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  // Al entrar y al cambiar de cuenta. `cuenta.perfilId` y no el objeto: una
  // referencia nueva con los mismos datos volvería a pedir todo a Amazon.
  useEffect(() => {
    if (cuenta) void traer(cuenta, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cuenta?.perfilId])

  /**
   * EL REFRESCO SOLO, Y LA VUELTA A LA PESTAÑA.
   *
   * Las dos cosas hacen falta y no se solapan. El reloj mantiene al día a quien
   * tiene la pantalla delante; el `visibilitychange` cubre el caso de verdad —la
   * pestaña abierta desde ayer, que sin esto enseñaría las cifras de anoche
   * durante los quince minutos siguientes a volver a ella—.
   */
  useEffect(() => {
    if (!cuenta) return

    const reloj = setInterval(() => void traer(cuenta, false), CADA_MS)
    // Un tic por minuto solo para que el «hace X minutos» no se quede clavado.
    const tic = setInterval(() => setTic((n) => n + 1), 60_000)

    const alVolver = () => {
      if (document.visibilityState !== 'visible') return
      // Solo si lo que hay ya se ha quedado viejo: volver a la pestaña cada dos
      // minutos no puede convertirse en una llamada a Amazon cada dos minutos.
      if (!actualizado || Date.now() - actualizado > CADA_MS) void traer(cuenta, false)
    }
    document.addEventListener('visibilitychange', alVolver)

    return () => {
      clearInterval(reloj)
      clearInterval(tic)
      document.removeEventListener('visibilitychange', alVolver)
    }
  }, [cuenta, actualizado, traer])

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

            {/* NO HAY BOTÓN DE ACTUALIZAR, y es la decisión de esta pantalla.
                Un botón así es admitir que lo que se ve puede estar viejo y que
                arreglarlo es cosa tuya. Se refresca solo cada quince minutos y
                al volver a la pestaña; lo que se enseña es CUÁNDO fue la última
                vez, que es la pregunta que el botón intentaba tapar. */}
            <span className="ml-auto text-[11px] text-white/35 flex items-center gap-1.5">
              {cargando || cargandoMetricas ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin text-[#FF6600]" />
                  Trayendo de Amazon…
                </>
              ) : (
                <>
                  <span className="h-1.5 w-1.5 rounded-full bg-green-400/70" />
                  Al día · {hace(actualizado) ?? 'ahora'}
                </>
              )}
            </span>
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

          {cargando ? (
            <div className="rounded-2xl border border-white/10 py-12 text-center text-white/35">
              <Loader2 className="h-4 w-4 animate-spin text-[#FF6600] inline mr-2" />
              Pidiéndoselas a Amazon…
            </div>
          ) : visibles.length === 0 ? (
            <div className="rounded-2xl border border-white/10 py-12 text-center text-[12px] text-white/30">
              {campanas.length === 0
                ? 'Esta cuenta no tiene ninguna campaña de Sponsored Products.'
                : 'Ninguna campaña con ese filtro.'}
            </div>
          ) : (
            <TablaCampanas
              campanas={visibles}
              metricas={metricas}
              perfilId={cuenta.perfilId}
              moneda={moneda}
              cargandoMetricas={cargandoMetricas}
            />
          )}

          {/* DE QUÉ FECHAS SON LAS CIFRAS. Sin esto, un ACOS es un número
              sin contexto: no es lo mismo el de los últimos treinta días que el
              de ayer, y la tabla no lo dice por ningún otro sitio. */}
          <p className="text-[10px] text-white/30">
            {cargandoMetricas ? (
              <>
                <Loader2 className="h-2.5 w-2.5 animate-spin inline mr-1" />
                Amazon está generando el informe de rendimiento. Las campañas ya están; las cifras
                entran en cuanto esté listo.
              </>
            ) : periodo ? (
              <>
                Rendimiento de {periodo}, hoy incluido. El día de hoy va incompleto —Amazon no lo
                cierra hasta pasadas unas horas, así que el gasto ya está contado y parte de las
                ventas no—, por eso el ACOS de una campaña que solo tenga datos de hoy sale más
                alto de lo que acabará siendo. Las campañas, el presupuesto y el ajuste del top sí
                son de este momento.
              </>
            ) : null}
          </p>

        </>
      )}
    </div>
  )
}
