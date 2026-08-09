'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Hand,
  Loader2,
  Play,
  RotateCcw,
  Save,
  Search,
  Tags,
} from 'lucide-react'
import { getAmazon, patchAmazon, postAmazon } from '@/lib/amazon/client'
import type { JobRespuesta } from '@/lib/plataforma/cliente'
import type {
  FiltroReferencias,
  GuardarMarcasRespuesta,
  MarcasRespuesta,
  ReferenciaMarca,
  ReferenciaRespuesta,
  ReferenciasRespuesta,
  UltimoBarrido,
} from '@/lib/plataforma/marcas-cliente'
import {
  BOTON,
  CAMPO,
  CELDA,
  CIFRAS,
  PANTALLA,
  TABLA,
  TEXTO,
  TEXTO_ESTADO,
  TIPO,
} from '@/lib/estilo/denso'
import { Aviso, Cargando, Dialogo, Vacio, cifra, hace } from '@/components/plataforma/comun'
import { ListaInfo, SeccionInfo } from '@/components/ui/BotonInfo'
import type { PropsPanel } from '../tipos'

/**
 * PESTAÑA «MARCAS» — CUÁLES SON SUYAS Y CUÁLES REVENDE.
 *
 * EL MOTOR ESTÁ EN lib/plataforma/marcas.ts: la normalización de grafías, el
 * recálculo del indicador de cada referencia y la excepción de una suelta. Aquí
 * no se decide nada de eso, solo se enseña y se pide.
 *
 * Se marca POR MARCA y no por referencia porque es lo único que se puede
 * mantener: un cliente con 5.000 SKU no va a marcar 5.000 casillas, pero marcas
 * propias tiene dos o tres. Y LA LISTA MANDA, el indicador de cada referencia es
 * el resultado: así las que lleguen en el censo de la semana que viene entran ya
 * clasificadas en vez de quedarse fuera sin que nadie se entere.
 *
 *
 * ============ LAS TRES COSAS QUE ESTA PANTALLA TIENE QUE DECIR ============
 *
 * 1. POR QUÉ LA LISTA ESTÁ VACÍA. La marca no la trae el censo: la rellena el
 *    enriquecido de catálogo, que corre UNA VEZ POR SEMANA. Un cliente recién
 *    conectado tiene esto vacío durante días y no es una avería. Se distingue
 *    además el catálogo SIN CENSAR —no sabemos ni qué referencias tiene— del
 *    censado y sin enriquecer, porque el trabajo que hay que lanzar es distinto.
 * 2. CUÁNTAS REFERENCIAS ESTÁN PUESTAS A MANO, por marca y en total: son las que
 *    el recálculo no toca, y explican por qué una marca marcada como propia
 *    puede tener referencias que no lo son.
 * 3. CUÁNTAS NO TIENEN MARCA NINGUNA.
 *
 * NINGÚN CERO SIGNIFICA «NO LO SABEMOS». Un catálogo sin censar no enseña «0
 * referencias»: enseña que no se ha censado. Una marca guardada que ya no
 * aparece en el catálogo no enseña «0 referencias»: dice que no está.
 */
export function PanelMarcas({ data, conexionId, onConexionId }: PropsPanel) {
  /* ---------------- Qué cliente se está mirando ---------------- */

  const clientesPorId = useMemo(
    () => new Map(data.clients.map((c) => [c.id, c])),
    [data.clients]
  )

  /**
   * Los clientes que tienen alguna conexión, con la conexión por la que se les
   * entra. Un cliente sin conexión no tiene catálogo y por tanto no tiene marcas
   * que mirar; enseñarlo sería ofrecer una pantalla que solo puede salir vacía.
   */
  const clientes = useMemo(() => {
    const porCliente = new Map<string, { id: string; nombre: string; conexiones: string[] }>()
    for (const conn of data.connections) {
      const entrada = porCliente.get(conn.client_id) ?? {
        id: conn.client_id,
        nombre: clientesPorId.get(conn.client_id)?.name ?? conn.name,
        conexiones: [],
      }
      entrada.conexiones.push(conn.id)
      porCliente.set(conn.client_id, entrada)
    }
    return [...porCliente.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
  }, [data.connections, clientesPorId])

  const conexion = useMemo(
    () => data.connections.find((c) => c.id === conexionId) ?? null,
    [data.connections, conexionId]
  )
  const clienteId = conexion?.client_id ?? null
  const clienteNombre = clienteId
    ? (clientesPorId.get(clienteId)?.name ?? conexion?.name ?? '')
    : ''

  /* ---------------- Lo que se está viendo ---------------- */

  const [resumen, setResumen] = useState<MarcasRespuesta | null>(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /** Las marcas marcadas AHORA MISMO en pantalla, por su forma normalizada */
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set())
  const [busqueda, setBusqueda] = useState('')
  const [soloMarcadas, setSoloMarcadas] = useState(false)

  const [guardando, setGuardando] = useState(false)
  const [mensaje, setMensaje] = useState<string | null>(null)

  const [lanzando, setLanzando] = useState(false)
  const [refsAbierto, setRefsAbierto] = useState<FiltroReferencias | null>(null)

  const cargar = useCallback(async (id: string) => {
    setCargando(true)
    setError(null)
    const res = await getAmazon<MarcasRespuesta>(
      `/api/plataforma/marcas?clientId=${encodeURIComponent(id)}`
    )
    setCargando(false)
    if (!res.ok) {
      setError(res.error)
      setResumen(null)
      return
    }
    setResumen(res.data)
    setSeleccion(new Set(res.data.marcas.filter((m) => m.esPropia).map((m) => m.marcaNorm)))
  }, [])

  useEffect(() => {
    if (!clienteId) {
      setResumen(null)
      setSeleccion(new Set())
      return
    }
    setMensaje(null)
    setBusqueda('')
    setSoloMarcadas(false)
    void cargar(clienteId)
  }, [clienteId, cargar])

  /* ---------------- Lo que ha cambiado sin guardar ---------------- */

  /**
   * Cuántas casillas se han movido desde lo que hay guardado.
   *
   * Se compara con lo que dijo el servidor y no se lleva una bandera «tocado»:
   * marcar una marca y volver a desmarcarla no es un cambio, y con una bandera
   * el botón se quedaría encendido pidiendo guardar lo mismo que ya hay.
   */
  const guardadas = useMemo(
    () => new Set((resumen?.marcas ?? []).filter((m) => m.esPropia).map((m) => m.marcaNorm)),
    [resumen]
  )
  const cambios = useMemo(() => {
    let n = 0
    for (const norm of seleccion) if (!guardadas.has(norm)) n += 1
    for (const norm of guardadas) if (!seleccion.has(norm)) n += 1
    return n
  }, [seleccion, guardadas])

  /**
   * Cambiar de cliente con casillas sin guardar.
   *
   * El guardián de la carcasa (`alSalir`) no se usa aquí a propósito: su diálogo
   * habla de cambios que no han salido «hacia Amazon», y de esta pantalla no
   * sale nada hacia Amazon. Decirlo mal es peor que no decirlo.
   */
  const [salidaBloqueada, setSalidaBloqueada] = useState<null | { accion: () => void }>(null)

  function irACliente(id: string) {
    const destino = clientes.find((c) => c.id === id)
    if (!destino || destino.id === clienteId) return
    // Si la conexión que ya está elegida es de ese cliente se respeta; si no, la
    // primera. Así el resto de pestañas siguen mirando lo mismo que esta.
    const nueva = destino.conexiones.includes(conexionId ?? '')
      ? (conexionId as string)
      : destino.conexiones[0]
    const accion = () => onConexionId(nueva)
    if (cambios > 0) {
      setSalidaBloqueada({ accion })
      return
    }
    accion()
  }

  /* ---------------- Guardar ---------------- */

  const nombrePorNorm = useMemo(
    () => new Map((resumen?.marcas ?? []).map((m) => [m.marcaNorm, m.marca])),
    [resumen]
  )

  async function guardar() {
    if (!clienteId || guardando) return
    setGuardando(true)
    setMensaje(null)
    const marcas = [...seleccion].map((norm) => nombrePorNorm.get(norm) ?? norm)
    const res = await patchAmazon<GuardarMarcasRespuesta>('/api/plataforma/marcas', {
      clientId: clienteId,
      marcas,
    })
    setGuardando(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setError(null)
    setResumen(res.data)
    setSeleccion(new Set(res.data.marcas.filter((m) => m.esPropia).map((m) => m.marcaNorm)))
    setMensaje(res.data.mensaje)
  }

  /* ---------------- Lanzar el barrido que falta ---------------- */

  async function lanzar(tipo: 'censo_catalogo' | 'enriquecer_catalogo') {
    if (!clienteId || !conexion || lanzando) return
    const marketplaceId = conexion.default_marketplace_id ?? conexion.marketplace_ids[0] ?? null
    if (!marketplaceId) {
      setError('Esa cuenta no tiene ningún país asociado, así que no se le puede pedir el catálogo.')
      return
    }
    setLanzando(true)
    setMensaje(null)
    const res = await postAmazon<JobRespuesta>('/api/plataforma/jobs', {
      tipo,
      clientId: clienteId,
      connectionId: conexion.id,
      marketplaceId,
    })
    setLanzando(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setError(null)
    setMensaje(res.data.mensaje ?? 'Trabajo encolado.')
    void cargar(clienteId)
  }

  /* ---------------- La lista que se pinta ---------------- */

  const visibles = useMemo(() => {
    const marcas = resumen?.marcas ?? []
    const q = busqueda.trim().toLowerCase()
    return marcas.filter((m) => {
      if (soloMarcadas && !seleccion.has(m.marcaNorm)) return false
      if (q === '') return true
      return m.marcaNorm.includes(q) || m.marca.toLowerCase().includes(q)
    })
  }, [resumen, busqueda, soloMarcadas, seleccion])

  function alternar(norm: string) {
    setSeleccion((prev) => {
      const siguiente = new Set(prev)
      if (siguiente.has(norm)) siguiente.delete(norm)
      else siguiente.add(norm)
      return siguiente
    })
    setMensaje(null)
  }

  /* ---------------- Los estados en los que no hay tabla ---------------- */

  if (data.connections.length === 0) {
    return (
      <Vacio icono={<Tags />} titulo="Todavía no hay ninguna cuenta conectada">
        Las marcas salen del catálogo de una cuenta. Conecta un cliente en la pestaña «Cuentas».
      </Vacio>
    )
  }

  const sinCatalogo = resumen !== null && resumen.total === 0
  const sinMarcas = resumen !== null && resumen.total > 0 && !resumen.enriquecido

  return (
    <div className={`${PANTALLA.cuerpo} h-full`}>
      {/* -------- La barra: cliente, buscador y las dos acciones -------- */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-[6px] min-w-0">
        <nav className="flex flex-wrap items-center gap-[4px] min-w-0" aria-label="Clientes">
          {clientes.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => irACliente(c.id)}
              aria-pressed={c.id === clienteId}
              className={`${BOTON.chip} ${c.id === clienteId ? BOTON.chipEncendido : ''}`}
            >
              {c.nombre}
            </button>
          ))}
        </nav>

        {clienteId && (
          <>
            <span className={PANTALLA.separador} />

            <label className="relative flex h-[26px] w-[190px] shrink-0 items-center">
              <Search
                className={`pointer-events-none absolute left-[7px] h-[13px] w-[13px] ${TEXTO.t4}`}
                aria-hidden="true"
              />
              <input
                type="search"
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder="Buscar marca"
                aria-label="Buscar una marca del catálogo"
                className={`${CAMPO.input} pl-[24px]`}
              />
            </label>

            <button
              type="button"
              onClick={() => setSoloMarcadas((v) => !v)}
              aria-pressed={soloMarcadas}
              className={`${BOTON.chip} ${soloMarcadas ? BOTON.chipEncendido : ''}`}
            >
              Solo las suyas
            </button>

            <button
              type="button"
              onClick={() => setRefsAbierto('manuales')}
              className={`${BOTON.chip}`}
              title="Marcar una referencia suelta, por encima de lo que diga su marca"
            >
              <Hand className="h-[13px] w-[13px]" />
              Referencias
            </button>

            <div className="ml-auto flex shrink-0 items-center gap-[6px]">
              {cambios > 0 && (
                <span className={`${TIPO.xs} ${TEXTO.acento} tabular-nums`}>
                  {cambios} sin guardar
                </span>
              )}
              <button
                type="button"
                onClick={() => void guardar()}
                disabled={cambios === 0 || guardando}
                className={`${BOTON.base} ${BOTON.primario}`}
              >
                {guardando ? (
                  <Loader2 className="h-[13px] w-[13px] animate-spin" />
                ) : (
                  <Save className="h-[13px] w-[13px]" />
                )}
                Guardar
              </button>
            </div>
          </>
        )}
      </div>

      {/* Un fallo se dice en pantalla: es accionable hoy y esconderlo detrás del
          botón de información sería no darlo. */}
      {error && (
        <div className="shrink-0">
          <Aviso tono="rojo" icono={AlertTriangle}>
            {error}
          </Aviso>
        </div>
      )}

      {!clienteId ? (
        <Vacio icono={<Tags />} titulo="Elige un cliente">
          Las marcas se deciden cliente a cliente: son su catálogo.
        </Vacio>
      ) : cargando && resumen === null ? (
        <Cargando texto={`Leyendo las marcas de ${clienteNombre}…`} />
      ) : resumen === null ? null : (
        <>
          {/* -------- Las cifras. Solo cuando hay catálogo del que contarlas -------- */}
          {resumen.total > 0 && (
            <div className={`${CIFRAS.tira} shrink-0 self-start`}>
              <span className={CIFRAS.celda}>
                <span className={CIFRAS.valor}>{cifra(resumen.total)}</span>
                <span className={CIFRAS.rotulo}>referencias</span>
              </span>
              <span className={CIFRAS.celda}>
                <span className={CIFRAS.valor}>
                  {resumen.enriquecido ? cifra(resumen.marcas.filter((m) => m.enCatalogo).length) : '—'}
                </span>
                <span className={CIFRAS.rotulo}>marcas</span>
              </span>
              <span className={CIFRAS.celda}>
                <span className={CIFRAS.valor}>{cifra(resumen.propias)}</span>
                <span className={CIFRAS.rotulo}>de marca propia</span>
              </span>
              <span className={CIFRAS.celda}>
                <span className={CIFRAS.valor}>{cifra(resumen.sinMarca)}</span>
                <span className={CIFRAS.rotulo}>sin marca</span>
              </span>
              <span className={CIFRAS.celda}>
                <span className={CIFRAS.valor}>{cifra(resumen.manuales)}</span>
                <span className={CIFRAS.rotulo}>a mano</span>
              </span>
            </div>
          )}

          {mensaje && (
            <div className="shrink-0">
              <Aviso tono="verde" icono={Save}>
                {mensaje}
              </Aviso>
            </div>
          )}

          {sinCatalogo ? (
            <Vacio
              icono={<Tags />}
              titulo={`De ${clienteNombre} todavía no se ha leído ninguna referencia`}
              accion={
                <BotonBarrido
                  etiqueta="Leer su catálogo"
                  cuenta={conexion?.name ?? ''}
                  ultimo={resumen.barridos.censo}
                  lanzando={lanzando}
                  onLanzar={() => void lanzar('censo_catalogo')}
                />
              }
            >
              {textoBarrido(resumen.barridos.censo, 'el censo del catálogo')}
            </Vacio>
          ) : sinMarcas ? (
            <Vacio
              icono={<Tags />}
              titulo="El catálogo está, pero ninguna referencia tiene marca todavía"
              accion={
                <BotonBarrido
                  etiqueta="Traer las marcas ahora"
                  cuenta={conexion?.name ?? ''}
                  ultimo={resumen.barridos.enriquecido}
                  lanzando={lanzando}
                  onLanzar={() => void lanzar('enriquecer_catalogo')}
                />
              }
            >
              La marca la rellena el barrido semanal de catálogo.{' '}
              {textoBarrido(resumen.barridos.enriquecido, 'ese barrido')}
            </Vacio>
          ) : (
            <div className={TABLA.caja}>
              <table className={TABLA.tabla}>
                <thead>
                  <tr>
                    <th scope="col" className={`${TABLA.cabecera} w-[34px]`}>
                      <span className="sr-only">Es marca propia</span>
                    </th>
                    <th scope="col" className={TABLA.cabecera}>
                      Marca
                    </th>
                    <th scope="col" className={`${TABLA.cabecera} ${TABLA.derecha}`}>
                      Referencias
                    </th>
                    <th scope="col" className={`${TABLA.cabecera} ${TABLA.derecha}`}>
                      A la venta
                    </th>
                    <th scope="col" className={`${TABLA.cabecera} ${TABLA.derecha}`}>
                      A mano
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visibles.map((m) => {
                    const marcada = seleccion.has(m.marcaNorm)
                    return (
                      <tr
                        key={m.marcaNorm}
                        className={`${TABLA.fila} ${marcada ? TABLA.filaSel : ''}`}
                      >
                        <td className={`${TABLA.celda} text-center`}>
                          <input
                            type="checkbox"
                            checked={marcada}
                            onChange={() => alternar(m.marcaNorm)}
                            aria-label={`${m.marca} es marca propia del cliente`}
                            className="h-[13px] w-[13px] cursor-pointer accent-[var(--ls-acc-relleno)]"
                          />
                        </td>
                        <td className={TABLA.celda}>
                          <span className={marcada ? 'font-medium text-[var(--ls-t1)]' : ''}>
                            {m.marca}
                          </span>
                          {!m.enCatalogo && (
                            <span className={`ml-[6px] ${TIPO.s} ${TEXTO.t4}`}>
                              ya no está en el catálogo
                            </span>
                          )}
                        </td>
                        <td className={`${TABLA.celda} ${TABLA.numero}`}>
                          {m.enCatalogo ? (
                            cifra(m.skus)
                          ) : (
                            <span className={CELDA.vacia}>—</span>
                          )}
                        </td>
                        <td className={`${TABLA.celda} ${TABLA.numero}`}>
                          {m.enCatalogo ? cifra(m.activos) : <span className={CELDA.vacia}>—</span>}
                        </td>
                        <td className={`${TABLA.celda} ${TABLA.numero}`}>
                          {!m.enCatalogo ? (
                            <span className={CELDA.vacia}>—</span>
                          ) : m.manuales > 0 ? (
                            <button
                              type="button"
                              onClick={() => setRefsAbierto('manuales')}
                              className={`${TEXTO_ESTADO.ambar} underline decoration-dotted underline-offset-2 tabular-nums`}
                              title="Estas referencias las decidió una persona y el recálculo no las toca"
                            >
                              {cifra(m.manuales)}
                            </button>
                          ) : (
                            <span className={CELDA.vacia}>—</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                  {visibles.length === 0 && (
                    <tr>
                      <td colSpan={5} className={`${TABLA.celda} ${TEXTO.t3} text-center`}>
                        {busqueda.trim() !== '' || soloMarcadas
                          ? 'Ninguna marca coincide con lo que buscas.'
                          : 'No hay marcas.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {refsAbierto !== null && clienteId && (
        <DialogoReferencias
          clientId={clienteId}
          clienteNombre={clienteNombre}
          filtroInicial={refsAbierto}
          onCerrar={() => {
            setRefsAbierto(null)
            // El marcado a mano cambia los recuentos de la tabla de marcas, así
            // que al cerrar se vuelve a leer. Sin esto, la columna «a mano»
            // seguiría diciendo lo de antes y parecería que no ha hecho nada.
            void cargar(clienteId)
          }}
        />
      )}

      {salidaBloqueada && (
        <Dialogo
          titulo="Tienes marcas sin guardar"
          entradilla={`${cambios} ${cambios === 1 ? 'casilla movida' : 'casillas movidas'}`}
          onCerrar={() => setSalidaBloqueada(null)}
          pie={
            <>
              <button
                type="button"
                onClick={() => setSalidaBloqueada(null)}
                className={`${BOTON.base} ${BOTON.primario}`}
              >
                Quedarme y guardarlas
              </button>
              <button
                type="button"
                onClick={() => {
                  const accion = salidaBloqueada.accion
                  setSalidaBloqueada(null)
                  accion()
                }}
                className={`${BOTON.base} ${BOTON.secundario}`}
              >
                Cambiar de cliente y perderlas
              </button>
            </>
          }
        >
          <p className={`${TIPO.s} ${TEXTO.t2}`}>
            Si cambias de cliente se pierden: todavía no se han guardado y el catálogo sigue
            clasificado como estaba.
          </p>
        </Dialogo>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* El botón de lanzar un barrido                                       */
/* ------------------------------------------------------------------ */

function BotonBarrido({
  etiqueta,
  cuenta,
  ultimo,
  lanzando,
  onLanzar,
}: {
  etiqueta: string
  cuenta: string
  ultimo: UltimoBarrido | null
  lanzando: boolean
  onLanzar: () => void
}) {
  // Con uno en cola o en marcha no se ofrece lanzar otro: la ruta lo devolvería
  // igual —no duplica— pero pulsar un botón que no hace nada se lee como que la
  // pantalla no responde.
  const enMarcha = ultimo?.estado === 'pendiente' || ultimo?.estado === 'en_curso'
  if (enMarcha) {
    return (
      <span className={`${TIPO.s} ${TEXTO.t3} inline-flex items-center gap-[5px]`}>
        <Loader2 className="h-3 w-3 animate-spin" />
        Ya está en marcha.
      </span>
    )
  }
  return (
    <button
      type="button"
      onClick={onLanzar}
      disabled={lanzando}
      title={cuenta ? `Se lanza sobre la cuenta «${cuenta}»` : undefined}
      className={`${BOTON.base} ${BOTON.alto} ${BOTON.primario}`}
    >
      {lanzando ? (
        <Loader2 className="h-[13px] w-[13px] animate-spin" />
      ) : (
        <Play className="h-[13px] w-[13px]" />
      )}
      {etiqueta}
    </button>
  )
}

/**
 * Una línea, la mínima, que distingue «no ha corrido nunca» de «corrió y aun así
 * no trajo nada». Sin ella las dos pantallas son idénticas y la segunda es un
 * problema que hay que mirar.
 */
function textoBarrido(ultimo: UltimoBarrido | null, nombre: string): string {
  if (!ultimo) return `Todavía no se ha lanzado ${nombre}.`
  if (ultimo.estado === 'error') return `El último intento falló ${hace(ultimo.creadoAt)}.`
  if (ultimo.estado === 'pendiente' || ultimo.estado === 'en_curso') {
    return `Hay uno en marcha desde ${hace(ultimo.creadoAt)}.`
  }
  return `El último terminó ${hace(ultimo.terminadoAt ?? ultimo.creadoAt)}.`
}

/* ------------------------------------------------------------------ */
/* La excepción: una referencia suelta                                 */
/* ------------------------------------------------------------------ */

const FILTROS_REF: Array<{ id: FiltroReferencias; nombre: string }> = [
  { id: 'manuales', nombre: 'A mano' },
  { id: 'propias', nombre: 'De marca propia' },
  { id: 'sin_marca', nombre: 'Sin marca' },
  { id: 'todas', nombre: 'Todas' },
]

function DialogoReferencias({
  clientId,
  clienteNombre,
  filtroInicial,
  onCerrar,
}: {
  clientId: string
  clienteNombre: string
  filtroInicial: FiltroReferencias
  onCerrar: () => void
}) {
  const [filtro, setFiltro] = useState<FiltroReferencias>(filtroInicial)
  const [q, setQ] = useState('')
  const [filas, setFilas] = useState<ReferenciaMarca[]>([])
  const [hayMas, setHayMas] = useState(false)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tocando, setTocando] = useState<string | null>(null)

  /** El texto que se está buscando, ya reposado. Sin esto sale una petición por
      tecla y las respuestas llegan desordenadas */
  const [qReposado, setQReposado] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setQReposado(q), 300)
    return () => clearTimeout(t)
  }, [q])

  /** Cada carga lleva su número: si vuelve una vieja después de una nueva, se
      tira. Es lo que impide que la lista parpadee al resultado anterior */
  const vuelta = useRef(0)

  useEffect(() => {
    const mia = ++vuelta.current
    setCargando(true)
    const params = new URLSearchParams({ clientId, filtro })
    if (qReposado.trim() !== '') params.set('q', qReposado.trim())
    void getAmazon<ReferenciasRespuesta>(
      `/api/plataforma/marcas/referencias?${params.toString()}`
    ).then((res) => {
      if (mia !== vuelta.current) return
      setCargando(false)
      if (!res.ok) {
        setError(res.error)
        return
      }
      setError(null)
      setFilas(res.data.filas)
      setHayMas(res.data.hayMas)
    })
  }, [clientId, filtro, qReposado])

  async function marcar(fila: ReferenciaMarca, valor: boolean | null) {
    if (tocando) return
    setTocando(fila.id)
    const res = await patchAmazon<ReferenciaRespuesta>('/api/plataforma/marcas/referencias', {
      clientId,
      listingId: fila.id,
      esMarcaPropia: valor,
    })
    setTocando(null)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setError(null)
    // Se corrige la fila en su sitio en vez de recargar la lista: recargarla con
    // el filtro «a mano» haría desaparecer justo la fila que se acaba de
    // devolver a la regla, y quien la ha tocado se queda sin ver el resultado.
    setFilas((prev) =>
      prev.map((f) =>
        f.id === fila.id
          ? { ...f, esMarcaPropia: res.data.esMarcaPropia, origen: res.data.origen }
          : f
      )
    )
  }

  return (
    <Dialogo
      titulo={`Referencias de ${clienteNombre}`}
      onCerrar={onCerrar}
      ancho="max-w-[900px]"
    >
      <div className={PANTALLA.filtros}>
        <label className="relative flex h-[26px] w-[220px] shrink-0 items-center">
          <Search
            className={`pointer-events-none absolute left-[7px] h-[13px] w-[13px] ${TEXTO.t4}`}
            aria-hidden="true"
          />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="SKU, ASIN, título o marca"
            aria-label="Buscar una referencia"
            className={`${CAMPO.input} pl-[24px]`}
          />
        </label>
        <span className={PANTALLA.separador} />
        {FILTROS_REF.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFiltro(f.id)}
            aria-pressed={filtro === f.id}
            className={`${BOTON.chip} ${filtro === f.id ? BOTON.chipEncendido : ''}`}
          >
            {f.nombre}
          </button>
        ))}
        {cargando && <Loader2 className={`h-3 w-3 animate-spin ${TEXTO.t4}`} />}
      </div>

      {error && (
        <Aviso tono="rojo" icono={AlertTriangle}>
          {error}
        </Aviso>
      )}

      <div className={`${TABLA.caja} max-h-[52vh]`}>
        <table className={TABLA.tabla}>
          <thead>
            <tr>
              <th scope="col" className={TABLA.cabecera}>
                SKU
              </th>
              <th scope="col" className={TABLA.cabecera}>
                Marca
              </th>
              <th scope="col" className={TABLA.cabecera}>
                Hoy
              </th>
              <th scope="col" className={`${TABLA.cabecera} ${TABLA.derecha}`}>
                Decidir
              </th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => (
              <tr key={f.id} className={TABLA.fila}>
                <td className={TABLA.celda}>
                  <span className={`${TABLA.corta} max-w-[240px]`} title={f.title ?? undefined}>
                    {f.sku}
                  </span>
                  {!f.aLaVenta && (
                    <span className={`${TIPO.s} ${TEXTO.t4}`}>no está a la venta</span>
                  )}
                </td>
                <td className={TABLA.celda}>
                  {f.marca ? (
                    <span className={`${TABLA.corta} max-w-[160px]`}>{f.marca}</span>
                  ) : (
                    <span className={CELDA.vacia}>sin marca</span>
                  )}
                </td>
                <td className={TABLA.celda}>
                  <span className={f.esMarcaPropia ? TEXTO_ESTADO.verde : TEXTO.t3}>
                    {f.esMarcaPropia ? 'Propia' : 'Ajena'}
                  </span>
                  {f.origen === 'manual' && (
                    <span className={`ml-[5px] ${TIPO.s} ${TEXTO_ESTADO.ambar}`}>a mano</span>
                  )}
                </td>
                <td className={`${TABLA.celda} ${TABLA.derecha}`}>
                  <span className="inline-flex items-center gap-[4px]">
                    <button
                      type="button"
                      disabled={tocando === f.id}
                      onClick={() => void marcar(f, true)}
                      className={`${BOTON.chip} ${f.origen === 'manual' && f.esMarcaPropia ? BOTON.chipEncendido : ''}`}
                    >
                      Propia
                    </button>
                    <button
                      type="button"
                      disabled={tocando === f.id}
                      onClick={() => void marcar(f, false)}
                      className={`${BOTON.chip} ${f.origen === 'manual' && !f.esMarcaPropia ? BOTON.chipEncendido : ''}`}
                    >
                      Ajena
                    </button>
                    <button
                      type="button"
                      disabled={tocando === f.id || f.origen !== 'manual'}
                      onClick={() => void marcar(f, null)}
                      title="Que vuelva a decidirlo su marca"
                      className={`${BOTON.icono} disabled:opacity-40`}
                    >
                      <RotateCcw className="h-[13px] w-[13px]" />
                    </button>
                  </span>
                </td>
              </tr>
            ))}
            {filas.length === 0 && !cargando && (
              <tr>
                <td colSpan={4} className={`${TABLA.celda} ${TEXTO.t3} text-center`}>
                  {filtro === 'manuales'
                    ? 'No hay ninguna referencia decidida a mano.'
                    : 'Ninguna referencia coincide.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {hayMas && (
        <p className={`${TIPO.s} ${TEXTO.t3}`}>
          Hay más de las que caben aquí. Afina la búsqueda.
        </p>
      )}
    </Dialogo>
  )
}

/* ------------------------------------------------------------------ */
/* La explicación, detrás del botón de información                     */
/* ------------------------------------------------------------------ */

export function InfoMarcas() {
  return (
    <>
      <SeccionInfo titulo="Para qué sirve marcar una marca como propia">
        <ListaInfo>
          <li>
            Su <strong>ranking se mide a diario</strong>. En un producto ajeno el ranking mide el
            producto, no la cuenta del cliente.
          </li>
          <li>Es sobre esos productos sobre los que tiene sentido hacer marketing.</li>
          <li>
            En un cliente <strong>mixto</strong> es lo que resuelve, referencia a referencia, lo que
            el modelo de negocio deja abierto.
          </li>
        </ListaInfo>
      </SeccionInfo>

      <SeccionInfo titulo="Se marca por marca, no por producto">
        <p>
          Un cliente con 5.000 referencias no va a marcar 5.000 casillas; marcas propias tiene dos o
          tres. Marcando la marca queda clasificado su catálogo entero de una vez.
        </p>
        <p>
          La lista sale <strong>ordenada por peso</strong>: arriba lo que más ocupa. En un
          revendedor, la marca propia suele ser pequeña al lado de las que distribuye, y lo primero
          que hay que hacer es descartar las grandes.
        </p>
      </SeccionInfo>

      <SeccionInfo titulo="La lista manda; la marca de cada producto es el resultado">
        <p>
          El indicador de cada referencia se recalcula desde esta lista, nunca al revés. Es lo que
          hace que las referencias nuevas que lleguen en el censo de la semana que viene entren ya
          clasificadas, en vez de quedarse fuera sin que nadie se entere.
        </p>
        <p>
          Guardar reclasifica el catálogo <strong>en el momento</strong>, y se dice cuántas
          referencias han cambiado. Que no cambie ninguna es un resultado normal: puede que el
          catálogo aún no tenga marcas, o que las afectadas estén puestas a mano.
        </p>
      </SeccionInfo>

      <SeccionInfo titulo="Las referencias puestas a mano no se tocan">
        <p>
          Con el botón <strong>«Referencias»</strong> se decide una suelta, por encima de lo que
          diga su marca. Es la válvula de escape para las excepciones que ninguna regla cubre: una
          marca del cliente salvo cuatro referencias que revende, o un producto suyo listado bajo la
          marca del fabricante.
        </p>
        <p>
          Esas quedan marcadas <strong>a mano</strong> y ningún recálculo las pisa, ni el de guardar
          esta pantalla ni el barrido nocturno. Por eso una marca marcada como propia puede tener
          referencias que no lo son: la columna «a mano» dice cuántas, y desde ahí se ven.
        </p>
        <p>
          Se puede deshacer: el botón de volver atrás le devuelve la decisión a la lista de marcas.
        </p>
      </SeccionInfo>

      <SeccionInfo titulo="Si la lista sale vacía, no está rota">
        <p>
          La marca no la trae el censo del catálogo: la rellena el barrido de atributos, que corre{' '}
          <strong>una vez por semana</strong>. Un cliente recién conectado tiene esta pantalla vacía
          durante días.
        </p>
        <p>
          Por eso se distinguen dos vacíos que no significan lo mismo: si no se ha leído el catálogo
          todavía no sabemos ni qué referencias tiene, y si está leído pero sin marcas lo que falta
          es el barrido de atributos. En los dos casos se puede lanzar el trabajo desde aquí, y se
          dice cuándo corrió el último.
        </p>
        <p>
          <strong>«Sin marca»</strong> cuenta las referencias para las que Amazon no da marca. No es
          un cero: es que ese dato no existe para ellas.
        </p>
      </SeccionInfo>

      <SeccionInfo titulo="«PIKOLINOS», «Pikolinos» y «Pikolinos » son la misma marca">
        <p>
          Amazon devuelve la marca tal y como la escribió quien creó el listing, así que las tres
          grafías conviven en el mismo catálogo. Se comparan sin acentos, sin mayúsculas y sin
          espacios de más: si no, marcar una dejaría las otras dos fuera y el cliente vería la mitad
          de sus productos sin clasificar sin entender por qué. En la lista se enseña la grafía más
          frecuente.
        </p>
      </SeccionInfo>

      <SeccionInfo titulo="Una marca guardada que ya no está en el catálogo">
        <p>
          Sigue apareciendo al final de la lista, marcada y con un aviso. No se borra sola: si
          desapareciera de la pantalla, el siguiente guardado la quitaría de la lista sin que nadie
          lo hubiera pedido, y el día que el cliente vuelva a listar esos productos entrarían sin
          clasificar.
        </p>
      </SeccionInfo>
    </>
  )
}
