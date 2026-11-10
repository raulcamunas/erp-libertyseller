'use client'

import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { ChevronDown, ChevronRight, CircleAlert, ExternalLink, Loader2, Plug, RefreshCw } from 'lucide-react'
import { AMAZON_MARKETPLACES } from '@/lib/types/amazon'
import { BOTON, CAMPO, COLOR_ESTADO, INSIGNIA, TABLA, TARJETA, TEXTO, TIPO, TITULO } from '@/lib/estilo/denso'
import { postAmazon } from '@/lib/amazon/client'
import type { ClienteMarketing, ConexionAds, PerfilAds } from '@/lib/ads/datos'
import { Laboratorio } from './Laboratorio'

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

  // Las cuentas apagadas se esconden detrás de un «Mostrar»: de un cliente con 10 países suelen trabajarse 1 a 5, y las otras solo estorban. Si no hay ninguna encendida se enseñan todas.
  const [verApagadas, setVerApagadas] = useState<ReadonlySet<string>>(new Set())
  const alternarApagadas = (id: string) =>
    setVerApagadas((prev) => {
      const sig = new Set(prev)
      if (sig.has(id)) sig.delete(id)
      else sig.add(id)
      return sig
    })

  return (
    <div className="flex flex-col gap-3 pb-6">
      <div>
        <h1 className={TITULO.pantalla}>Publicidad</h1>
        <p className={`${TITULO.entradilla} mt-[2px] max-w-[78ch]`}>
          La conexión con Amazon Ads de cada cliente y qué cuentas de anunciante se trabajan. Cada región es una autorización aparte; dentro de ella, cada país es una cuenta que se enciende y se asigna a su
          cliente. Amazon devuelve todas las cuentas a las que llega el correo que autorizó, incluidas las de encargos antiguos: enciende solo las que se trabajan, porque de las apagadas o sin asignar no se
          pide ni se guarda nada.
        </p>
      </div>

      {aviso && (
        <div className="flex gap-[7px] rounded-[6px] border border-l-2 border-[var(--ls-linea2)] bg-[var(--ls-sup2)] px-[9px] py-[7px] text-[11.5px] text-[var(--ls-t2)]" style={{ borderLeftColor: COLOR_ESTADO.ambar }}>
          <CircleAlert className="mt-[2px] h-[13px] w-[13px] shrink-0" style={{ color: COLOR_ESTADO.ambar }} />
          <span>{aviso}</span>
        </div>
      )}

      {/* La URL de vuelta se enseña porque es el fallo número uno de este OAuth: tiene que estar registrada TAL CUAL en Login with Amazon, y cuando no lo está el error de Amazon no la menciona. */}
      <details className={`${TARJETA.base} group`}>
        <summary className={`flex cursor-pointer list-none items-center gap-[6px] px-[10px] py-[6px] ${TIPO.s} ${TEXTO.t3} hover:text-[var(--ls-t1)]`}>
          <ChevronRight className="h-3 w-3 transition-transform group-open:rotate-90" />
          Detalle técnico: la URL de vuelta del OAuth
        </summary>
        <p className={`border-t border-[var(--ls-linea)] px-[10px] py-[8px] ${TIPO.s} ${TEXTO.t3}`}>
          Tiene que estar registrada tal cual en «Allowed Return URLs» de la aplicación en Login with Amazon: <code className={`${TEXTO.t1} select-all`}>{urlDeVuelta}</code>
        </p>
      </details>

      <div className="grid grid-cols-1 items-start gap-3 2xl:grid-cols-2">
        {clientes.map((c) => {
          const ocupado = trabajando === c.id
          const perfiles = c.conexiones.flatMap((conn) => conn.perfiles)
          const total = perfiles.length
          const enUso = perfiles.filter((p) => p.en_uso)
          const apagadas = perfiles.filter((p) => !p.en_uso)
          const mostrarTodas = verApagadas.has(c.id) || enUso.length === 0
          const visibles = mostrarTodas ? perfiles : enUso

          return (
            <section key={c.id} className={TARJETA.base}>
              <header className="flex items-center gap-2 border-b border-[var(--ls-linea)] px-[10px] py-[8px]">
                <span className={`h-2 w-2 shrink-0 rounded-full`} style={{ background: c.conexiones.length > 0 ? COLOR_ESTADO.verde : COLOR_ESTADO.gris }} />
                <h2 className={`${TITULO.seccion} min-w-0 flex-1 truncate`}>{c.nombre}</h2>
                {total > 0 && (
                  <span className={INSIGNIA.base} title="Cuentas que se trabajan de las que Amazon devuelve">
                    {enUso.length} de {total} en uso
                  </span>
                )}
                {c.conexiones.length > 0 && (
                  <button type="button" onClick={() => refrescarPerfiles(c)} disabled={ocupado} title="Volver a preguntarle a Amazon qué cuentas tiene" className={BOTON.icono}>
                    {ocupado ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                  </button>
                )}
              </header>

              <div className="flex flex-col gap-3 px-[10px] py-[9px]">
                {/* UNA LÍNEA POR REGIÓN, TAMBIÉN LAS QUE FALTAN. Un cliente con tres cuentas europeas parecía completo cuando tenía siete americanas sin conectar: lo que falta solo se ve si se nombra. */}
                <div className="flex flex-wrap gap-2">
                  {REGIONES.map((r) => {
                    const conn = c.conexiones.find((x) => x.region === r.id)
                    // Extremo Oriente solo se ofrece si ya se usa: tres botones a quien solo vende en Europa es ruido.
                    if (!conn && r.id === 'fe') return null
                    return (
                      <div key={r.id} className="flex min-w-[220px] flex-1 items-center gap-2 rounded-[6px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-2 py-[5px]">
                        <span className="h-[7px] w-[7px] shrink-0 rounded-full" style={{ background: conn ? COLOR_ESTADO.verde : COLOR_ESTADO.gris }} />
                        <div className="min-w-0 flex-1">
                          <div className={`${TIPO.s} ${conn ? TEXTO.t1 : TEXTO.t3} font-medium`}>
                            {r.nombre}
                            {conn && <span className={`${TEXTO.t4} font-normal`}> · {conn.perfiles.length} {conn.perfiles.length === 1 ? 'cuenta' : 'cuentas'}</span>}
                          </div>
                          {!conn && <div className={`${TIPO.xs} ${TEXTO.t4} truncate`}>{r.paises}</div>}
                        </div>
                        <button type="button" onClick={() => conectar(c, r.id)} disabled={ocupado} className={`${BOTON.base} ${BOTON.secundario} shrink-0`}>
                          {ocupado ? <Loader2 className="h-3 w-3 animate-spin" /> : <ExternalLink className="h-3 w-3" />}
                          {conn ? 'Reconectar' : 'Conectar'}
                        </button>
                      </div>
                    )
                  })}
                </div>

                {c.conexiones.map((conn) =>
                  conn.ultimoError ? (
                    <p key={conn.id} className={`${TIPO.s}`} style={{ color: COLOR_ESTADO.ambar }}>
                      {REGIONES.find((r) => r.id === conn.region)?.nombre}: {conn.ultimoError}
                    </p>
                  ) : null
                )}

                {total === 0 ? (
                  <p className={`${TIPO.s} ${TEXTO.t3}`}>
                    Sin cuentas de anunciante. Conecta la región donde este cliente anuncie: cada una es una autorización aparte y un token de una NO lee las cuentas de la otra.
                  </p>
                ) : (
                  <div className="flex flex-col gap-[6px]">
                    <div className="min-w-0 overflow-x-auto rounded-[6px] border border-[var(--ls-linea)]">
                      <table className={TABLA.tabla}>
                        <thead>
                          <tr>
                            <th className={`${TABLA.cabecera} w-[64px]`}>Se usa</th>
                            <th className={TABLA.cabecera}>País</th>
                            <th className={TABLA.cabecera}>Cuenta</th>
                            <th className={TABLA.cabecera}>Cliente</th>
                            <th className={`${TABLA.cabecera} ${TABLA.derecha}`}>profileId</th>
                          </tr>
                        </thead>
                        <tbody>
                          {visibles.map((p) => (
                            <tr key={p.id} className={`${TABLA.fila} ${p.en_uso ? '' : 'opacity-55'}`}>
                              <td className={TABLA.celda}>
                                <Interruptor
                                  encendido={p.en_uso}
                                  onClick={() => cambiarUso(p)}
                                  titulo={p.en_uso ? 'Se le piden informes y se guardan sus datos. Pulsa para dejar de trabajarla' : 'No se toca. Pulsa para empezar a trabajar esta cuenta'}
                                />
                              </td>
                              <td className={TABLA.celda}>
                                <span className={`${TEXTO.t1} font-medium`}>{nombreDePais(p.pais)}</span>
                                <span className={`${TEXTO.t4}`}> {p.pais ?? ''}{p.moneda ? ` · ${p.moneda}` : ''}</span>
                              </td>
                              <td className={TABLA.celda}>
                                <span className={`${TABLA.corta} max-w-[200px]`}>{p.nombre || p.id_externo || '—'}</span>
                              </td>
                              <td className={TABLA.celda}>
                                <select
                                  value={p.cliente_id ?? ''}
                                  onChange={(e) => asignar(p, e.target.value)}
                                  className={`${CAMPO.input} max-w-[170px] cursor-pointer`}
                                  style={p.cliente_id ? undefined : { borderColor: COLOR_ESTADO.ambar, color: COLOR_ESTADO.ambar }}
                                >
                                  <option value="">Sin asignar</option>
                                  {clientesMarketing.map((cm) => (
                                    <option key={cm.id} value={cm.id}>
                                      {cm.name}
                                    </option>
                                  ))}
                                </select>
                              </td>
                              <td className={`${TABLA.celda} ${TABLA.numero} ${TEXTO.t4} select-all`}>{p.profile_id}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {apagadas.length > 0 && enUso.length > 0 && (
                      <button type="button" onClick={() => alternarApagadas(c.id)} className={`flex items-center gap-1 self-start ${TIPO.s} ${TEXTO.t3} hover:text-[var(--ls-t1)]`}>
                        {mostrarTodas ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                        {mostrarTodas ? 'Ocultar las apagadas' : `Mostrar las ${apagadas.length} apagadas`}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </section>
          )
        })}

        {clientes.length === 0 && <p className={`${TIPO.s} ${TEXTO.t3}`}>No hay clientes dados de alta en Amazon API.</p>}
      </div>

      {/* MARKETING V2 · el banco de pruebas. Va debajo y no en otra pestaña porque solo tiene sentido con las cuentas encendidas delante: lo primero que hay que mirar cuando algo no sale es si esa cuenta está en uso. */}
      <Laboratorio clientes={clientes} />
    </div>
  )
}

/** El nombre del país a partir del código de Ads («UK» en Ads es «GB» en SP-API) */
function nombreDePais(codigo: string | null): string {
  if (!codigo) return '—'
  const c = codigo === 'UK' ? 'GB' : codigo
  // Irlanda no está en la lista de mercados de SP-API del ERP (ahí no se vende), pero sí tiene cuenta de anunciante
  return AMAZON_MARKETPLACES.find((m) => m.countryCode === c)?.label ?? (c === 'IE' ? 'Irlanda' : codigo)
}

/** El interruptor de «Se usa». Accesible (role=switch) y con el naranja de marca solo cuando está encendido */
function Interruptor({ encendido, onClick, titulo }: { encendido: boolean; onClick: () => void; titulo: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={encendido}
      title={titulo}
      onClick={onClick}
      className={`relative h-[16px] w-[30px] shrink-0 rounded-full border transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ls-acc-graf)] ${
        encendido ? 'border-[var(--ls-acc-borde)] bg-[var(--ls-acc-graf)]' : 'border-[var(--ls-linea2)] bg-[var(--ls-sup3)]'
      }`}
    >
      <span className={`absolute top-[1px] h-[12px] w-[12px] rounded-full bg-white shadow transition-all ${encendido ? 'left-[15px]' : 'left-[1px]'}`} />
    </button>
  )
}
