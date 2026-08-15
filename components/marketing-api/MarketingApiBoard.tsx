'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, Plug, RefreshCw } from 'lucide-react'
import { postAmazon } from '@/lib/amazon/client'
import type { ClienteMarketing, ConexionAds, PerfilAds } from '@/lib/ads/datos'

export interface ClienteAds {
  id: string
  nombre: string
  /** UNA POR REGIÓN: Europa y Norteamérica son autorizaciones distintas */
  conexiones: Array<ConexionAds & { perfiles: PerfilAds[] }>
}

/**
 * LAS REGIONES, Y POR QUÉ SE CONECTAN POR SEPARADO.
 *
 * Las cuentas de anunciante de Europa y las de Norteamérica viven en servidores
 * distintos de Amazon, y cada uno exige su propia autorización: un token europeo
 * NO lee las cuentas de Estados Unidos.
 *
 * Se vio con el primer cliente real — en la consola de Amazon tenía diez cuentas
 * y aquí salían tres. No faltaba ninguna: las otras siete eran americanas y esa
 * región no se había conectado. Por eso ahora la pantalla enseña las tres y dice
 * cuáles faltan, en vez de dar una por «la» conexión.
 */
const REGIONES = [
  { id: 'eu' as const, nombre: 'Europa', paises: 'España, Francia, Italia, Alemania, Reino Unido…' },
  { id: 'na' as const, nombre: 'Norteamérica', paises: 'Estados Unidos, Canadá, México, Brasil' },
  { id: 'fe' as const, nombre: 'Extremo Oriente', paises: 'Japón, Australia, Singapur' },
]

/**
 * MARKETING API — CONECTAR Y VER, NADA MÁS.
 *
 * La pantalla del primer paso: qué clientes tienen autorizada su cuenta de
 * Amazon Ads y qué cuentas de anunciante hemos encontrado en cada una.
 *
 * NO SE PINTA NINGUNA MÉTRICA todavía, y no es que falte tiempo: sin datos
 * reales delante, cualquier tabla que se monte ahora es una suposición sobre qué
 * campos trae Amazon y cómo se agregan. La estructura se decide cuando el dato
 * esté aquí, que es exactamente lo que se pidió — «no construyas a fondo, solo
 * empezar a traer datos en crudo».
 */
export function MarketingApiBoard({
  clientes,
  clientesMarketing,
  urlDeVuelta,
  aviso,
}: {
  clientes: ClienteAds[]
  /** Los clientes de PUBLICIDAD, que no son los de SP-API. Ver la migración 150 */
  clientesMarketing: ClienteMarketing[]
  urlDeVuelta: string
  aviso: string | null
}) {
  const params = useSearchParams()
  const [trabajando, setTrabajando] = useState<string | null>(null)

  /**
   * El resultado de la vuelta de Amazon llega por la URL, no por estado.
   *
   * Quien redirige aquí es el callback, que no comparte nada con esta pantalla:
   * la única forma de contar cómo fue es un parámetro. Se enseña una vez y se
   * limpia de la barra, para que recargar no repita el mensaje.
   */
  useEffect(() => {
    const ok = params.get('ads_ok')
    const error = params.get('ads_error')
    if (!ok && !error) return
    if (ok) toast.success(ok, { duration: 8000 })
    if (error) toast.error(error, { duration: 12000 })
    window.history.replaceState({}, '', window.location.pathname)
  }, [params])

  async function conectar(cliente: ClienteAds, region: string) {
    setTrabajando(cliente.id)
    const res = await postAmazon<{ url: string }>('/api/ads/conectar', {
      clienteId: cliente.id,
      region,
    })
    setTrabajando(null)

    if (!res.ok) {
      toast.error(res.error)
      return
    }
    // Se va en ESTA pestaña y no en una nueva: al volver, Amazon redirige al
    // callback y este a la pantalla. Con una pestaña aparte, el resultado
    // aparecería en la ventana equivocada.
    window.location.href = res.data.url
  }

  /**
   * Encender o apagar una cuenta.
   *
   * Se recarga la página en vez de mover el estado a mano: es una lista corta y
   * que lo que se ve venga siempre del servidor evita el caso peor —la pantalla
   * diciendo que una cuenta está encendida cuando el guardado falló—. Con datos
   * que deciden qué se le pide a Amazon, eso importa más que el parpadeo.
   */
  async function cambiarUso(perfil: PerfilAds) {
    const res = await postAmazon<{ ok: true }>('/api/ads/perfiles/uso', {
      perfilId: perfil.id,
      enUso: !perfil.en_uso,
    })
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    window.location.reload()
  }

  /**
   * A qué cliente de publicidad pertenece esta cuenta.
   *
   * Es lo que impide que el gasto de un anunciante acabe contabilizado en otro:
   * la autorización es de NUESTRA cuenta de agencia y bajo ella aparecen los
   * perfiles de todos los clientes que nos dan acceso.
   */
  async function asignar(perfil: PerfilAds, clienteId: string) {
    const res = await postAmazon<{ ok: true }>('/api/ads/perfiles/cliente', {
      perfilId: perfil.id,
      clienteId: clienteId || null,
    })
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    window.location.reload()
  }

  async function refrescarPerfiles(cliente: ClienteAds) {
    setTrabajando(cliente.id)
    const res = await postAmazon<{ perfiles: PerfilAds[] }>('/api/ads/perfiles', {
      clienteId: cliente.id,
    })
    setTrabajando(null)

    if (!res.ok) {
      toast.error(res.error)
      return
    }
    toast.success(
      `${res.data.perfiles.length} ${res.data.perfiles.length === 1 ? 'perfil' : 'perfiles'} de anunciante`
    )
    window.location.reload()
  }

  return (
    <div className="space-y-3 pb-6">
      <div>
        <h1 className="text-[22px] font-semibold text-white">Marketing API</h1>
        <p className="text-[12px] text-white/45 mt-0.5">
          La conexión con Amazon Ads. De momento solo conecta la cuenta y trae sus perfiles de
          anunciante: sobre eso se montará después lo que haga falta.
        </p>
      </div>

      {aviso && (
        <div className="rounded-xl border border-yellow-500/25 bg-yellow-400/[0.06] px-3 py-2 text-[12px] text-yellow-200/90">
          {aviso}
        </div>
      )}

      {/* La URL de vuelta se enseña porque es el fallo número uno de este OAuth:
          tiene que estar registrada TAL CUAL en Login with Amazon, y cuando no
          lo está el error de Amazon no la menciona. Tenerla a la vista convierte
          media hora de búsqueda en una comparación de dos líneas. */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2 text-[11px] text-white/45">
        La URL de vuelta tiene que estar registrada tal cual en «Allowed Return URLs» de la
        aplicación en Login with Amazon:{' '}
        <code className="text-white/75 select-all">{urlDeVuelta}</code>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-2.5 items-start">
        {clientes.map((c) => {
          const ocupado = trabajando === c.id
          const conectadas = new Set(c.conexiones.map((x) => x.region))
          const total = c.conexiones.reduce((n, x) => n + x.perfiles.length, 0)

          return (
            <div
              key={c.id}
              className="rounded-2xl border border-white/10 bg-white/[0.02] px-3 py-2.5 space-y-2"
            >
              <div className="flex items-center gap-2 min-w-0">
                {c.conexiones.length > 0 ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-400 flex-shrink-0" />
                ) : (
                  <Plug className="h-3.5 w-3.5 text-white/25 flex-shrink-0" />
                )}
                <span className="text-[13px] font-semibold text-white truncate flex-1 min-w-0">
                  {c.nombre}
                </span>
                {total > 0 && (
                  <span className="text-[11px] text-white/35">
                    {total} {total === 1 ? 'cuenta' : 'cuentas'}
                  </span>
                )}
                {c.conexiones.length > 0 && (
                  <button
                    type="button"
                    onClick={() => refrescarPerfiles(c)}
                    disabled={ocupado}
                    title="Volver a preguntarle a Amazon qué cuentas tiene"
                    className="px-2 py-1 rounded-full border border-white/10 text-[11px] text-white/45 hover:text-white transition-colors disabled:opacity-50"
                  >
                    <RefreshCw className="h-3 w-3" />
                  </button>
                )}
              </div>

              {/* UNA LÍNEA POR REGIÓN, TAMBIÉN LAS QUE FALTAN.
                  Es la corrección de fondo: antes se enseñaba «la» conexión y un
                  cliente con tres cuentas europeas parecía completo cuando tenía
                  siete americanas sin conectar. Lo que falta solo se ve si se
                  nombra. */}
              <div className="space-y-1">
                {REGIONES.map((r) => {
                  const conn = c.conexiones.find((x) => x.region === r.id)
                  if (!conn && r.id === 'fe' && !conectadas.has('fe')) {
                    // Extremo Oriente solo se ofrece si ya se usa: ofrecer tres
                    // botones a quien solo vende en Europa es ruido.
                    return null
                  }
                  return (
                    <div
                      key={r.id}
                      className="flex items-center gap-2 text-[11px] rounded-lg border border-white/[0.06] px-2 py-1"
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${
                          conn ? 'bg-green-400' : 'bg-white/20'
                        }`}
                      />
                      <span className={conn ? 'text-white/75' : 'text-white/40'}>{r.nombre}</span>
                      {conn ? (
                        <span className="text-white/35">
                          {conn.perfiles.length}{' '}
                          {conn.perfiles.length === 1 ? 'cuenta' : 'cuentas'}
                        </span>
                      ) : (
                        <span className="text-white/25 truncate hidden sm:inline">{r.paises}</span>
                      )}
                      <button
                        type="button"
                        onClick={() => conectar(c, r.id)}
                        disabled={ocupado}
                        className="ml-auto px-2 py-0.5 rounded-full border border-white/10 text-[10px] font-medium text-white/55 hover:text-white hover:border-white/25 transition-colors flex items-center gap-1 disabled:opacity-50 flex-shrink-0"
                      >
                        {ocupado ? (
                          <Loader2 className="h-2.5 w-2.5 animate-spin" />
                        ) : (
                          <ExternalLink className="h-2.5 w-2.5" />
                        )}
                        {conn ? 'Reconectar' : 'Conectar'}
                      </button>
                    </div>
                  )
                })}
              </div>

              {c.conexiones.map((conn) =>
                conn.ultimoError ? (
                  <p key={conn.id} className="text-[11px] text-yellow-200/80">
                    {REGIONES.find((r) => r.id === conn.region)?.nombre}: {conn.ultimoError}
                  </p>
                ) : null
              )}

              {total === 0 ? (
                <p className="text-[11px] text-white/30">
                  Sin cuentas de anunciante. Conecta la región donde este cliente anuncie: cada una
                  es una autorización aparte y un token de una NO lee las cuentas de la otra.
                </p>
              ) : (
                <div className="overflow-x-auto min-w-0">
                  <table className="w-full text-[11px] border-collapse">
                    <thead>
                      <tr className="text-white/35">
                        <th className="text-left font-medium py-1 w-[70px]">Se usa</th>
                        <th className="text-left font-medium py-1">Cuenta</th>
                        <th className="text-left font-medium py-1">País</th>
                        <th className="text-left font-medium py-1">Cliente</th>
                        <th className="text-right font-medium py-1">profileId</th>
                      </tr>
                    </thead>
                    <tbody>
                      {c.conexiones.flatMap((conn) =>
                        conn.perfiles.map((p) => (
                          <tr
                            key={p.id}
                            className={`border-t border-white/[0.05] ${p.en_uso ? '' : 'opacity-45'}`}
                          >
                            <td className="py-1">
                              <button
                                type="button"
                                onClick={() => cambiarUso(p)}
                                title={
                                  p.en_uso
                                    ? 'Se le piden informes y se guardan sus datos. Pulsa para dejar de trabajarla'
                                    : 'No se toca. Pulsa para empezar a trabajar esta cuenta'
                                }
                                className={`h-4 w-8 rounded-full transition-colors relative ${
                                  p.en_uso ? 'bg-[#FF6600]' : 'bg-white/15'
                                }`}
                              >
                                <span
                                  className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${
                                    p.en_uso ? 'left-[18px]' : 'left-0.5'
                                  }`}
                                />
                              </button>
                            </td>
                            <td className="py-1 text-white/80 truncate max-w-[180px]">
                              {p.nombre || p.id_externo || '—'}
                            </td>
                            <td className="py-1 text-white/50 whitespace-nowrap">
                              {p.pais || '—'}
                              {p.moneda ? ` · ${p.moneda}` : ''}
                            </td>
                            <td className="py-1">
                              <select
                                value={p.cliente_id ?? ''}
                                onChange={(e) => asignar(p, e.target.value)}
                                className={`h-6 rounded-md border bg-white/[0.03] px-1.5 text-[11px] outline-none focus:border-[#FF6600] transition-colors cursor-pointer max-w-[140px] ${
                                  p.cliente_id
                                    ? 'border-white/10 text-white/80'
                                    : 'border-yellow-500/40 text-yellow-300/80'
                                }`}
                              >
                                <option value="" className="bg-[#1a1a1a]">
                                  Sin asignar
                                </option>
                                {clientesMarketing.map((cm) => (
                                  <option key={cm.id} value={cm.id} className="bg-[#1a1a1a]">
                                    {cm.name}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="py-1 text-right text-white/40 tabular-nums select-all">
                              {p.profile_id}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                  <p className="text-[10px] text-white/30 mt-1.5">
                    Amazon devuelve todas las cuentas a las que llega el correo que autorizó,
                    incluidas las de encargos antiguos. Enciende solo las que se trabajan y dile de
                    qué cliente es cada una: de las apagadas o sin asignar no se pide ni se guarda
                    nada.
                  </p>
                </div>
              )}
            </div>
          )
        })}

        {clientes.length === 0 && (
          <p className="text-[12px] text-white/35">
            No hay clientes dados de alta en Amazon API.
          </p>
        )}
      </div>
    </div>
  )
}
