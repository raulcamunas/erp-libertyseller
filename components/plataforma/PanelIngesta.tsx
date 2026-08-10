'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  CalendarClock,
  CircleAlert,
  CirclePause,
  CirclePlay,
  Play,
  Moon,
  Square,
  Sun,
  Timer,
  Zap,
} from 'lucide-react'
import { toast } from 'sonner'
import { getAmazon, patchAmazon, postAmazon } from '@/lib/amazon/client'
import type {
  AmazonJob,
  ClienteConIngesta,
  IngestaRespuesta,
  JobRespuesta,
  PlanRespuesta,
} from '@/lib/plataforma/cliente'
import {
  jobEstaVivo,
  jobNecesitaConexion,
  progresoDeJob,
  type AmazonJobTipo,
} from '@/lib/plataforma/tipos'
import { mercadosDeConexion } from '@/lib/types/amazon'
import type { ConfigRefresco } from '@/lib/plataforma/refresco-config'

/** El reloj del FOEP ya resuelto, tal como lo devuelve la configuración de Buy Box */
interface RelojFoep {
  foepMinutos: number
  foepAutomatico: boolean
  foepPorQue: string
}
import {
  UNIDADES,
  aMinutos,
  descomponer,
  textoIntervalo,
  avisoDeVentana,
  salidaReal,
  type Unidad as UnidadTiempo,
} from '@/lib/sistema/intervalo'
import {
  BOTON,
  CAMPO,
  CIFRAS,
  COLOR_ESTADO,
  ESTADO,
  RADIO,
  TABLA,
  TEXTO,
  TIPO,
  type TonoEstado,
} from '@/lib/estilo/denso'
import {
  Aviso,
  Cargando,
  Dialogo,
  Panel,
  cifra,
  duracion,
  fechaHora,
  hace,
  nombreMarketplace,
  proxima,
} from './comun'

/**
 * ESTADO DE LA INGESTA DE UN CLIENTE.
 *
 * Contesta cuatro preguntas, en este orden, que es el orden en el que se hacen:
 *
 *   1. ¿ESTÁ AL DÍA? — la rejilla de refrescos: por cada cosa que se refresca y
 *      cada cuenta, cuándo terminó bien la última vez. Un «nunca» ahí es la
 *      respuesta a por qué una pantalla está vacía.
 *   2. ¿SE ESTÁ MOVIENDO? — la cola, con su progreso.
 *   3. ¿QUÉ SE HA ROTO Y POR QUÉ? — las incidencias abiertas, con el mensaje en
 *      español que escribió quien falló.
 *   4. ¿PUEDO PROBAR ALGO? — lanzar a mano, y sobre UN SUBCONJUNTO de SKU, que
 *      es como lo pide la especificación: «todo debe poder ejecutarse sobre un
 *      subconjunto de SKUs, no solo sobre el catálogo entero».
 *
 *
 * ============ LO QUE ESTA PANTALLA NO HACE ============
 *
 * No ejecuta nada. Encola. El motor recoge la cola en su pasada, cada cinco
 * minutos, con su propio presupuesto de tiempo. Es a propósito y está explicado
 * en la ruta de API: un barrido de 13.700 referencias tarda horas y ninguna
 * petición HTTP aguanta eso. Lo que sí hace la prioridad es adelantarlo — un
 * trabajo que pide una persona va por delante del barrido semanal.
 */

/** Cada cuánto se relee mientras hay algo vivo. Los trabajos avanzan por lotes:
    con más espacio la barra parece parada, con menos se pide por pedir */
const REFRESCO_MS = 15000

export function PanelIngesta({
  cliente,
  clientes,
  onElegirCliente,
  onCambio,
}: {
  cliente: ClienteConIngesta
  clientes: ClienteConIngesta[]
  onElegirCliente: (id: string) => void
  onCambio: () => void
}) {
  const [datos, setDatos] = useState<IngestaRespuesta | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)
  const [lanzando, setLanzando] = useState(false)
  const [procesando, setProcesando] = useState(false)
  /** Cada cuánto le toca a cada refresco. Vive aparte de `datos` porque no
      depende del cliente elegido: el horario es del ERP entero */
  const [horarios, setHorarios] = useState<ConfigRefresco[]>([])

  useEffect(() => {
    void (async () => {
      const res = await getAmazon<{ config: ConfigRefresco[] }>('/api/plataforma/refrescos')
      if (res.ok) setHorarios(res.data.config)
    })()
  }, [])
  const [cancelando, setCancelando] = useState<AmazonJob | null>(null)

  // El id vive en una referencia además de en las props porque el temporizador
  // se monta una vez: sin esto, al cambiar de cliente el intervalo seguiría
  // pidiendo los datos del anterior y pisando la pantalla con ellos.
  const clienteRef = useRef(cliente.id)
  clienteRef.current = cliente.id

  const cargar = useCallback(async (clientId: string, silencioso = false) => {
    if (!silencioso) setCargando(true)
    const res = await getAmazon<IngestaRespuesta>(`/api/plataforma/ingesta?clientId=${clientId}`)
    // Si mientras tanto se ha cambiado de cliente, esta respuesta ya no vale.
    if (clienteRef.current !== clientId) return
    setCargando(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setError(null)
    setDatos(res.data)
  }, [])

  useEffect(() => {
    void cargar(cliente.id)
  }, [cargar, cliente.id])

  const hayVivos = useMemo(
    () => (datos?.jobs ?? []).some((j) => jobEstaVivo(j.estado)),
    [datos]
  )

  useEffect(() => {
    if (!hayVivos) return
    const id = setInterval(() => {
      void cargar(clienteRef.current, true)
    }, REFRESCO_MS)
    return () => clearInterval(id)
  }, [hayVivos, cargar])

  const recargar = useCallback(() => {
    void cargar(cliente.id, true)
    onCambio()
  }, [cargar, cliente.id, onCambio])

  /**
   * Las unidades de trabajo: una por conexión y país. Es el grano de los datos.
   *
   * Pasa por mercadosDeConexion() y NO por `marketplace_ids` a pelo. Esa columna
   * es lo que dice Amazon, y dice de más: en la cuenta de Shoplamp devuelve once
   * mercados y uno es de sandbox. Listarlo aquí con un «nunca ha corrido» al lado
   * no es informar — no es que no haya corrido todavía, es que no se le va a
   * programar un trabajo jamás. Y de paso respeta la elección de países hecha en
   * Amazon API · Cuentas.
   */
  const unidades = useMemo(
    () =>
      cliente.conexiones.flatMap((c) =>
        mercadosDeConexion(c).map((m) => ({
          connectionId: c.id,
          conexion: c.name,
          marketplaceId: m,
        }))
      ),
    [cliente]
  )

  async function planificar(forzar: boolean) {
    const res = await postAmazon<PlanRespuesta>('/api/plataforma/planificar', {
      clientId: cliente.id,
      forzar,
    })
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    toast.success(res.data.mensaje)
    recargar()
  }

  /**
   * PROCESA LA COLA AHORA MISMO, sin esperar al cron.
   *
   * «Planificar» y «Forzar todos» solo ENCOLAN: dejan trabajos en «pendiente» y
   * quien los trabaja es el motor, que entra cada pocos minutos. Eso hacía que
   * pulsar «Forzar todos» pareciera no hacer nada durante minutos, que es lo
   * contrario de lo que promete un botón que dice «forzar».
   *
   * Llama a la MISMA ruta que llama el cron —la de Sistema, que reenvía a
   * /api/amazon/cron-jobs con el secreto y con `?forzar=1`—, no a una copia. Si
   * el camino del cron está roto, este botón tiene que romperse igual: un atajo
   * que funcionara aquí y no en el cron taparía justo el fallo que se busca.
   */
  async function procesarAhora() {
    setProcesando(true)
    try {
      const res = await fetch('/api/sistema/cron', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tarea: 'amazon-jobs' }),
      })
      const datos = await res.json()
      if (!res.ok) throw new Error(datos?.error ?? 'No se ha podido procesar la cola')
      if (datos.ok) toast.success(datos.mensaje ?? 'La cola ha avanzado')
      else toast.error(datos.mensaje, { duration: 12_000 })
      recargar()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se ha podido procesar la cola')
    } finally {
      setProcesando(false)
    }
  }

  async function accionSobreJob(job: AmazonJob, accion: 'pausar' | 'reanudar') {
    const res = await patchAmazon<JobRespuesta>(`/api/plataforma/jobs/${job.id}`, { accion })
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    toast.success(res.data.mensaje ?? 'Hecho')
    recargar()
  }

  if (cargando && !datos) return <Cargando texto="Leyendo el estado de la ingesta…" />

  if (error) {
    return (
      <Aviso tono="rojo" icono={AlertTriangle}>
        {error}
      </Aviso>
    )
  }
  if (!datos) return null

  const enCola = datos.jobs.filter((j) => j.estado === 'pendiente').length
  const enMarcha = datos.jobs.filter((j) => j.estado === 'en_curso').length

  return (
    <div className="flex flex-col gap-2 pb-4">
      {/* -------- La tira de cifras --------
          El envoltorio con scroll y el `min-w-max` son para el móvil: la tira
          lleva `overflow-hidden` por contrato y sin esto las últimas celdas se
          recortan sin forma de alcanzarlas. En pantalla ancha no cambia nada. */}
      <div className="overflow-x-auto shrink-0">
      <div className={`${CIFRAS.tira} min-w-max`}>
        <span className={CIFRAS.celda}>
          <span className={CIFRAS.valor}>{cifra(enMarcha)}</span>
          <span className={CIFRAS.rotulo}>en marcha</span>
        </span>
        <span className={CIFRAS.celda}>
          <span className={CIFRAS.valor}>{cifra(enCola)}</span>
          <span className={CIFRAS.rotulo}>en cola</span>
        </span>
        <span className={CIFRAS.celda}>
          <span className={`${CIFRAS.valor} ${cliente.errores_24h > 0 ? CIFRAS.urgente : ''}`}>
            {cifra(cliente.errores_24h)}
          </span>
          <span className={CIFRAS.rotulo}>fallos en 24 h</span>
        </span>
        <span className={CIFRAS.celda}>
          <span
            className={`${CIFRAS.valor} ${datos.eventos.length > 0 ? CIFRAS.urgente : ''}`}
          >
            {cifra(datos.eventos.length)}
          </span>
          <span className={CIFRAS.rotulo}>incidencias abiertas</span>
        </span>
      </div>
      </div>

      {/* -------- Acciones -------- */}
      <div className="flex flex-wrap items-center gap-[6px]">
        <button
          type="button"
          onClick={() => setLanzando(true)}
          className={`${BOTON.base} ${BOTON.primario} ${BOTON.alto}`}
        >
          <Play className="h-3 w-3" />
          Lanzar un trabajo
        </button>
        <button
          type="button"
          onClick={() => void planificar(false)}
          className={`${BOTON.base} ${BOTON.secundario}`}
          title="Encola lo que le toque según su cadencia y su ventana horaria"
        >
          <CalendarClock className="h-3 w-3" />
          Planificar lo que toque
        </button>
        <button
          type="button"
          onClick={() => void planificar(true)}
          className={`${BOTON.base} ${BOTON.secundario}`}
          title="Ignora el reloj y encola todos los refrescos de este cliente. No lanza dos barridos del mismo catálogo: eso lo impide un índice único de la base"
        >
          <Timer className="h-3 w-3" />
          Forzar todos
        </button>
        {/* Los dos de arriba ENCOLAN; este EJECUTA. Sin él había que esperar al
            motor, y «Forzar todos» parecía no hacer nada durante minutos. */}
        <button
          type="button"
          onClick={() => void procesarAhora()}
          disabled={procesando}
          className={`${BOTON.base} ${BOTON.secundario}`}
          title="Hace correr el motor de trabajos ahora mismo en vez de esperar a su próxima pasada. Es la misma llamada que hace el cron"
        >
          <Zap className="h-3 w-3" />
          {procesando ? 'Procesando…' : 'Procesar la cola ahora'}
        </button>
      </div>

      {/* -------- 1. ¿Está al día? -------- */}
      {/* Los horarios van ANTES de la rejilla: es lo que explica lo que se ve
          debajo. Con la rejilla sola, «semanal» no dice si eso son seis días o
          quince minutos, y esa duda ya costó una tarde. */}
      <PanelHorarios
        horarios={horarios}
        etiquetas={datos.etiquetas.tipos}
        clienteId={cliente.id}
        clienteNombre={cliente.name}
        onGuardado={setHorarios}
      />

      <RejillaRefrescos
        datos={datos}
        unidades={unidades}
        tieneConexiones={cliente.conexiones.length > 0}
        horarios={horarios}
      />

      {/* -------- 2. ¿Se está moviendo? -------- */}
      <Panel
        titulo="Trabajos"
        derecha={
          <span className={`${TIPO.s} ${TEXTO.t4}`}>
            leído {hace(datos.leidoAt)}
            {hayVivos ? ' · se refresca solo' : ''}
          </span>
        }
        sinCuerpo
      >
        {datos.jobs.length === 0 ? (
          <div className="p-[10px]">
            <p className={`${TIPO.s} ${TEXTO.t3}`}>
              Este cliente no tiene ningún trabajo todavía, ni terminado ni en cola. El primero
              tiene que ser el censo del catálogo: es el que descubre los SKU y los ASIN de los que
              cuelga todo lo demás. Lánzalo con «Lanzar un trabajo» o deja que lo encole el
              planificador esta noche.
            </p>
          </div>
        ) : (
          <TablaJobs
            jobs={datos.jobs}
            etiquetas={datos.etiquetas.tipos}
            estados={datos.etiquetas.estados}
            onCancelar={setCancelando}
            onPausar={(j) => void accionSobreJob(j, 'pausar')}
            onReanudar={(j) => void accionSobreJob(j, 'reanudar')}
          />
        )}
      </Panel>

      {/* -------- 3. ¿Qué se ha roto? -------- */}
      <Panel titulo="Incidencias abiertas" sinCuerpo>
        {datos.eventos.length === 0 ? (
          <div className="p-[10px]">
            <p className={`${TIPO.s} ${TEXTO.t3}`}>
              Nada abierto. Aquí aparece lo que la ingesta no puede resolver sola: un cupo agotado,
              un informe que Amazon no entrega, un tope de seguimiento alcanzado. Lo grave además
              avisa por la campana.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-[var(--ls-linea)]">
            {datos.eventos.map((e) => (
              <li key={e.id} className="flex items-start gap-[7px] px-[10px] py-[6px]">
                <CircleAlert
                  className="mt-[2px] h-[13px] w-[13px] shrink-0"
                  style={{ color: COLOR_ESTADO[tonoSeveridad(e.severidad)] }}
                />
                <div className="min-w-0 flex-1">
                  <p className={`${TIPO.m} ${TEXTO.t2}`}>{e.mensaje}</p>
                  <p className={`${TIPO.s} ${TEXTO.t4}`}>
                    {datos.etiquetas.severidades[e.severidad]} · {e.tipo}
                    {e.sku ? ` · ${e.sku}` : ''} · {fechaHora(e.created_at)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {/* -------- La ingesta de los demás clientes, cada uno por separado -------- */}
      <ListaClientes clientes={clientes} elegido={cliente.id} onElegir={onElegirCliente} />

      {lanzando && (
        <DialogoLanzar
          cliente={cliente}
          unidades={unidades}
          tiposEjecutables={datos.tiposEjecutables}
          etiquetas={datos.etiquetas.tipos}
          onCerrar={() => setLanzando(false)}
          onLanzado={() => {
            setLanzando(false)
            recargar()
          }}
        />
      )}

      {cancelando && (
        <DialogoCancelar
          job={cancelando}
          etiqueta={datos.etiquetas.tipos[cancelando.tipo]}
          onCerrar={() => setCancelando(null)}
          onCancelado={() => {
            setCancelando(null)
            recargar()
          }}
        />
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 1 · ¿Está al día?                                                    */
/* ------------------------------------------------------------------ */

interface Unidad {
  connectionId: string
  conexion: string
  marketplaceId: string
}

/**
 * CUÁNDO TERMINÓ BIEN CADA REFRESCO, cuenta por cuenta.
 *
 * Se pintan TODAS las combinaciones esperadas, también las que no han corrido
 * nunca. Es lo importante de esta rejilla: una lista de lo que sí ha pasado
 * nunca contesta «¿por qué la ficha de SKU no tiene ranking?», y un «nunca» en
 * su casilla sí.
 *
 * El barrido semanal y el diario están separados a la vista porque tienen
 * cadencias distintas: un censo de hace seis días está al día y un inventario de
 * hace seis días no lo está.
 */
function RejillaRefrescos({
  datos,
  unidades,
  tieneConexiones,
  horarios,
}: {
  datos: IngestaRespuesta
  unidades: Unidad[]
  tieneConexiones: boolean
  horarios: ConfigRefresco[]
}) {
  /**
   * La cadencia sale del SERVIDOR, no de una copia escrita aquí.
   *
   * Aquí había un mapa con «diario: 20 h» y «semanal: 144 h» a mano. Dos
   * problemas: era una segunda fuente de la verdad que se desincronizaba en
   * cuanto alguien cambiaba el planificador, y ponía «diario»/«semanal» sin
   * número — con lo que era imposible saber si «diario» quería decir cada 20
   * horas o cada 15 minutos, que es lo que se acabó creyendo.
   */
  const cadenciaDe = (tipo: AmazonJobTipo) =>
    horarios.find((h) => h.tipo === tipo) ?? null

  const porClave = new Map(
    datos.refrescos.map((r) => [`${r.tipo}|${r.connection_id ?? ''}|${r.marketplace_id ?? ''}`, r])
  )

  const filas: Array<{
    clave: string
    tipo: AmazonJobTipo
    destino: string
    velocidad: string
    horas: number
    apagado: boolean
  }> = []

  for (const horario of horarios) {
    const tipo = horario.tipo
    if (!datos.tiposEjecutables.includes(tipo)) continue
    const velocidad = horario.activo ? textoIntervalo(horario.cada_minutos) : 'apagado'
    const horas = horario.cada_minutos / 60
    const apagado = !horario.activo
    if (jobNecesitaConexion(tipo)) {
      for (const u of unidades) {
        filas.push({
          clave: `${tipo}|${u.connectionId}|${u.marketplaceId}`,
          tipo,
          destino: `${u.conexion} · ${nombreMarketplace(u.marketplaceId)}`,
          velocidad,
          horas,
          apagado,
        })
      }
    } else {
      filas.push({
        clave: `${tipo}||`,
        tipo,
        destino: 'Todo el cliente',
        velocidad,
        horas,
        apagado,
      })
    }
  }

  if (!tieneConexiones || filas.length === 0) return null

  return (
    <Panel titulo="Al día" sinCuerpo>
      <div className="overflow-x-auto">
        <table className={TABLA.tabla}>
          <thead>
            <tr>
              <th className={`${TABLA.cabecera} ${TABLA.cabeceraFija}`}>Refresco</th>
              <th className={TABLA.cabecera}>Cuenta y país</th>
              <th className={TABLA.cabecera}>Cadencia</th>
              <th className={TABLA.cabecera}>Última vez que terminó bien</th>
              <th className={TABLA.cabecera}>Le toca</th>
              <th className={`${TABLA.cabecera} ${TABLA.derecha}`}>Procesados</th>
              <th className={TABLA.cabecera}>Resumen</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => {
              const ultimo = porClave.get(f.clave) ?? null
              const horas = ultimo
                ? (Date.now() - new Date(ultimo.terminado_at).getTime()) / 3600000
                : null
              const tono: TonoEstado =
                horas === null ? 'gris' : horas <= f.horas ? 'verde' : 'ambar'
              return (
                <tr key={f.clave} className={TABLA.fila}>
                  <td className={`${TABLA.celda} ${TABLA.celdaFija} ${TEXTO.t1}`}>
                    {datos.etiquetas.tipos[f.tipo]}
                  </td>
                  <td className={TABLA.celda}>{f.destino}</td>
                  <td className={TABLA.celda}>{f.velocidad}</td>
                  <td className={TABLA.celda}>
                    <span className={ESTADO.linea}>
                      <span style={{ color: COLOR_ESTADO[tono] }} aria-hidden>
                        {horas === null ? '○' : horas <= f.horas ? '●' : '◐'}
                      </span>
                      {ultimo ? (
                        <>
                          {hace(ultimo.terminado_at)}
                          <span className={TEXTO.t4}>· {fechaHora(ultimo.terminado_at)}</span>
                        </>
                      ) : (
                        <span className={TEXTO.t4}>nunca ha corrido</span>
                      )}
                    </span>
                  </td>
                  {/* CUÁNDO LE TOCA OTRA VEZ, que es la mitad que faltaba: la
                      columna de al lado dice cuándo fue la última y la cadencia
                      dice cada cuánto, pero juntar las dos de cabeza para saber
                      si algo está pendiente no lo hace nadie. Si está apagado se
                      dice, porque entonces no le toca nunca. */}
                  <td className={`${TABLA.celda} ${TEXTO.t3} whitespace-nowrap`}>
                    {f.apagado ? (
                      <span className={TEXTO.t4}>apagado</span>
                    ) : (
                      proxima(ultimo?.terminado_at ?? null, f.horas * 60)
                    )}
                  </td>
                  <td className={`${TABLA.celda} ${TABLA.numero}`}>
                    {ultimo ? cifra(ultimo.procesados) : '—'}
                  </td>
                  <td className={`${TABLA.celda} ${TEXTO.t3} max-w-[380px]`}>
                    <span className={TABLA.corta}>{ultimo?.resumen ?? '—'}</span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}

/* ------------------------------------------------------------------ */
/* 2 · La cola                                                          */
/* ------------------------------------------------------------------ */

function TablaJobs({
  jobs,
  etiquetas,
  estados,
  onCancelar,
  onPausar,
  onReanudar,
}: {
  jobs: AmazonJob[]
  etiquetas: Record<AmazonJobTipo, string>
  estados: Record<string, string>
  onCancelar: (job: AmazonJob) => void
  onPausar: (job: AmazonJob) => void
  onReanudar: (job: AmazonJob) => void
}) {
  return (
    <div className="overflow-x-auto">
      <table className={TABLA.tabla}>
        <thead>
          <tr>
            <th className={`${TABLA.cabecera} ${TABLA.cabeceraFija}`}>Trabajo</th>
            <th className={TABLA.cabecera}>Destino</th>
            <th className={TABLA.cabecera}>Estado</th>
            <th className={TABLA.cabecera}>Progreso</th>
            <th className={`${TABLA.cabecera} ${TABLA.derecha}`}>Errores</th>
            <th className={`${TABLA.cabecera} ${TABLA.derecha}`}>Pasadas</th>
            <th className={TABLA.cabecera}>Empezó</th>
            <th className={TABLA.cabecera}>Terminó</th>
            <th className={TABLA.cabecera}>Duró</th>
            <th className={TABLA.cabecera}>Qué pasó</th>
            <th className={TABLA.cabecera} />
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => {
            const progreso = progresoDeJob(job)
            const vivo = jobEstaVivo(job.estado)
            return (
              <tr key={job.id} className={TABLA.fila}>
                <td className={`${TABLA.celda} ${TABLA.celdaFija} ${TEXTO.t1}`}>
                  {etiquetas[job.tipo] ?? job.tipo}
                  {job.skus_filtro && (
                    <span
                      className={`${TEXTO.acento} ml-[5px] text-[11px]`}
                      title={`Solo sobre estas ${job.skus_filtro.length} referencias: ${job.skus_filtro.slice(0, 20).join(', ')}`}
                    >
                      · {job.skus_filtro.length} SKU
                    </span>
                  )}
                </td>
                <td className={TABLA.celda}>
                  {job.marketplace_id ? nombreMarketplace(job.marketplace_id) : 'Todo el cliente'}
                </td>
                <td className={TABLA.celda}>
                  <span className={ESTADO.linea}>
                    <span style={{ color: COLOR_ESTADO[tonoEstadoJob(job.estado)] }} aria-hidden>
                      {glifoEstado(job.estado)}
                    </span>
                    {estados[job.estado] ?? job.estado}
                  </span>
                </td>
                <td className={TABLA.celda}>
                  {/* Cuando no se sabe el total NO se pinta una barra a cero: una
                      barra a cero es indistinguible de una parada, y un trabajo
                      cuyo total todavía no se conoce está trabajando */}
                  {progreso === null ? (
                    <span className={TEXTO.t3}>
                      {cifra(job.procesados)}
                      {job.total_estimado === null ? ' · total sin saber' : ''}
                    </span>
                  ) : (
                    <span className="flex items-center gap-[6px]">
                      <span
                        className={`h-[6px] w-[70px] overflow-hidden ${RADIO.r1} bg-[var(--ls-sup3)]`}
                      >
                        <span
                          className="block h-full"
                          style={{
                            width: `${progreso * 100}%`,
                            backgroundColor: COLOR_ESTADO[tonoEstadoJob(job.estado)],
                          }}
                        />
                      </span>
                      <span className={`${TIPO.xs} ${TEXTO.t2} tabular-nums`}>
                        {Math.round(progreso * 100)}%
                      </span>
                      <span className={`${TIPO.s} ${TEXTO.t4} tabular-nums`}>
                        {cifra(job.procesados)}/{cifra(job.total_estimado)}
                      </span>
                    </span>
                  )}
                </td>
                <td className={`${TABLA.celda} ${TABLA.numero}`}>
                  {job.errores > 0 ? (
                    <span style={{ color: COLOR_ESTADO.rojo }}>{cifra(job.errores)}</span>
                  ) : (
                    <span className={TEXTO.t4}>0</span>
                  )}
                </td>
                <td className={`${TABLA.celda} ${TABLA.numero} ${TEXTO.t3}`}>{job.pasadas}</td>
                <td className={`${TABLA.celda} ${TEXTO.t3} whitespace-nowrap`}>
                  {fechaHora(job.iniciado_at)}
                </td>
                {/* Un trabajo vivo NO tiene hora de fin, y poner un guion ahí lo
                    haría indistinguible de uno que reventó sin cerrar. Se dice
                    que sigue, y la duración cuenta hasta ahora: eso es lo que
                    separa «va lento» de «está colgado». */}
                <td className={`${TABLA.celda} ${TEXTO.t3} whitespace-nowrap`}>
                  {job.terminado_at ? (
                    fechaHora(job.terminado_at)
                  ) : vivo ? (
                    <span className={TEXTO.t4}>en marcha</span>
                  ) : (
                    <span className={TEXTO.t4}>sin cerrar</span>
                  )}
                </td>
                <td className={`${TABLA.celda} ${TEXTO.t3} tabular-nums whitespace-nowrap`}>
                  {job.iniciado_at ? duracion(job.iniciado_at, job.terminado_at) : '—'}
                  {!job.terminado_at && vivo && <span className={TEXTO.t4}> y sigue</span>}
                </td>
                <td className={`${TABLA.celda} ${TEXTO.t3} max-w-[420px]`}>
                  <span className={TABLA.corta} title={job.error_message ?? job.resumen ?? ''}>
                    {job.error_message ? (
                      <span style={{ color: COLOR_ESTADO.rojo }}>{job.error_message}</span>
                    ) : (
                      (job.resumen ?? (job.cancel_motivo ? `Cancelado: ${job.cancel_motivo}` : '—'))
                    )}
                  </span>
                </td>
                <td className={`${TABLA.celda} whitespace-nowrap`}>
                  {vivo && (
                    <span className="flex items-center gap-[2px]">
                      {job.estado === 'pausado' ? (
                        <button
                          type="button"
                          className={BOTON.icono}
                          title="Volver a meterlo en la cola. Conserva el cursor: sigue donde estaba"
                          onClick={() => onReanudar(job)}
                        >
                          <CirclePlay className="h-[13px] w-[13px]" />
                        </button>
                      ) : (
                        <button
                          type="button"
                          className={BOTON.icono}
                          title="Sacarlo de la cola con su progreso intacto"
                          onClick={() => onPausar(job)}
                        >
                          <CirclePause className="h-[13px] w-[13px]" />
                        </button>
                      )}
                      <button
                        type="button"
                        className={BOTON.icono}
                        title="Cancelar. Si lo está procesando el motor, para al acabar el lote"
                        onClick={() => onCancelar(job)}
                      >
                        <Square className="h-[13px] w-[13px]" />
                      </button>
                    </span>
                  )}
                  {job.estado === 'error' && (
                    <button
                      type="button"
                      className={BOTON.icono}
                      title="Volver a intentarlo desde donde se quedó"
                      onClick={() => onReanudar(job)}
                    >
                      <CirclePlay className="h-[13px] w-[13px]" />
                    </button>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* La ingesta de los demás clientes                                     */
/* ------------------------------------------------------------------ */

/**
 * UNA FILA POR CLIENTE, CON SUS PROPIAS CIFRAS.
 *
 * Esto es lo máximo que permite el compromiso firmado ante Amazon: métricas de
 * cada cuenta POR SEPARADO. Aquí no hay ni un dato de negocio —son trabajos de
 * NUESTRA cola e incidencias de NUESTRO registro—, no hay ninguna suma del
 * conjunto y el orden es el alfabético que fija la base, nunca uno calculado con
 * las cifras. Ordenar por «quién tiene más incidencias» convertiría esta lista
 * en un ranking entre clientes, y eso no se puede hacer.
 */
function ListaClientes({
  clientes,
  elegido,
  onElegir,
}: {
  clientes: ClienteConIngesta[]
  elegido: string
  onElegir: (id: string) => void
}) {
  return (
    <Panel titulo="Los demás clientes" sinCuerpo>
      <div className="overflow-x-auto">
        <table className={TABLA.tabla}>
          <thead>
            <tr>
              <th className={`${TABLA.cabecera} ${TABLA.cabeceraFija}`}>Cliente</th>
              <th className={TABLA.cabecera}>Cuentas</th>
              <th className={`${TABLA.cabecera} ${TABLA.derecha}`}>En marcha</th>
              <th className={`${TABLA.cabecera} ${TABLA.derecha}`}>En cola</th>
              <th className={`${TABLA.cabecera} ${TABLA.derecha}`}>Fallos 24 h</th>
              <th className={`${TABLA.cabecera} ${TABLA.derecha}`}>Incidencias</th>
              <th className={TABLA.cabecera}>Último movimiento</th>
            </tr>
          </thead>
          <tbody>
            {clientes.map((c) => (
              <tr
                key={c.id}
                className={`${TABLA.fila} cursor-pointer ${c.id === elegido ? TABLA.filaSel : ''}`}
                onClick={() => onElegir(c.id)}
              >
                <td className={`${TABLA.celda} ${TABLA.celdaFija} ${TEXTO.t1}`}>{c.name}</td>
                <td className={`${TABLA.celda} ${TEXTO.t3}`}>
                  {c.conexiones.length === 0 ? (
                    <span className={TEXTO.t4}>sin conectar</span>
                  ) : (
                    c.conexiones.map((x) => x.name).join(', ')
                  )}
                </td>
                <td className={`${TABLA.celda} ${TABLA.numero}`}>{c.en_curso || '—'}</td>
                <td className={`${TABLA.celda} ${TABLA.numero}`}>{c.pendientes || '—'}</td>
                <td className={`${TABLA.celda} ${TABLA.numero}`}>
                  {c.errores_24h > 0 ? (
                    <span style={{ color: COLOR_ESTADO.rojo }}>{c.errores_24h}</span>
                  ) : (
                    '—'
                  )}
                </td>
                <td className={`${TABLA.celda} ${TABLA.numero}`}>
                  {c.eventos_abiertos > 0 ? (
                    <span
                      style={{
                        color: c.eventos_graves_abiertos > 0 ? COLOR_ESTADO.rojo : COLOR_ESTADO.ambar,
                      }}
                    >
                      {c.eventos_abiertos}
                    </span>
                  ) : (
                    '—'
                  )}
                </td>
                <td className={`${TABLA.celda} ${TEXTO.t3}`}>{hace(c.ultimo_movimiento)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}

/* ------------------------------------------------------------------ */
/* Lanzar                                                              */
/* ------------------------------------------------------------------ */

/** El mismo tope que la ruta de API. Por encima de esto ya no es una prueba */
const MAX_SKUS = 500

function DialogoLanzar({
  cliente,
  unidades,
  tiposEjecutables,
  etiquetas,
  onCerrar,
  onLanzado,
}: {
  cliente: ClienteConIngesta
  unidades: Unidad[]
  tiposEjecutables: AmazonJobTipo[]
  etiquetas: Record<AmazonJobTipo, string>
  onCerrar: () => void
  onLanzado: () => void
}) {
  const [tipo, setTipo] = useState<AmazonJobTipo>(tiposEjecutables[0] ?? 'recalcular_activos')
  const [unidad, setUnidad] = useState(
    unidades[0] ? `${unidades[0].connectionId}|${unidades[0].marketplaceId}` : ''
  )
  const [skusTexto, setSkusTexto] = useState('')
  const [soloActivos, setSoloActivos] = useState(true)
  const [enviando, setEnviando] = useState(false)

  const necesitaConexion = jobNecesitaConexion(tipo)

  /** Se admiten saltos de línea, comas y punto y coma: quien prueba pega SKU de
      una hoja de cálculo, y obligarle a reformatearlos es una fricción tonta */
  const skus = useMemo(
    () =>
      [
        ...new Set(
          skusTexto
            .split(/[\n,;\t]+/)
            .map((s) => s.trim())
            .filter((s) => s !== '')
        ),
      ],
    [skusTexto]
  )

  async function lanzar() {
    if (necesitaConexion && unidad === '') {
      toast.error('Elige con qué cuenta y en qué país')
      return
    }
    if (skus.length > MAX_SKUS) {
      toast.error(`Un subconjunto de prueba admite ${MAX_SKUS} referencias como mucho`)
      return
    }

    const [connectionId, marketplaceId] = unidad.split('|')
    setEnviando(true)
    const res = await postAmazon<JobRespuesta>('/api/plataforma/jobs', {
      tipo,
      clientId: cliente.id,
      connectionId: necesitaConexion ? connectionId : null,
      marketplaceId: necesitaConexion ? marketplaceId : null,
      skus: skus.length > 0 ? skus : undefined,
      soloActivos,
    })
    setEnviando(false)

    if (!res.ok) {
      toast.error(res.error)
      return
    }
    toast.success(res.data.mensaje ?? 'Encolado')
    onLanzado()
  }

  return (
    <Dialogo
      titulo="Lanzar un trabajo"
      entradilla={
        <>
          Se mete en la cola con prioridad alta: va por delante de los refrescos que planifica el
          sistema. Lo recoge el motor en su próxima pasada, dentro de cinco minutos como mucho.{' '}
          <span className={TEXTO.t1}>A1 solo lee de Amazon</span>: ninguno de estos trabajos cambia
          nada en la tienda del cliente.
        </>
      }
      onCerrar={onCerrar}
      pie={
        <>
          <button type="button" onClick={onCerrar} className={`${BOTON.base} ${BOTON.secundario}`}>
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void lanzar()}
            disabled={enviando}
            className={`${BOTON.base} ${BOTON.primario}`}
          >
            {enviando ? 'Encolando…' : 'Encolar'}
          </button>
        </>
      }
    >
      <div className={CAMPO.rejilla}>
        <div className={CAMPO.contenedor}>
          <label className={CAMPO.etiqueta} htmlFor="tipo-trabajo">
            Qué se hace
          </label>
          <select
            id="tipo-trabajo"
            value={tipo}
            onChange={(e) => setTipo(e.target.value as AmazonJobTipo)}
            className={CAMPO.input}
          >
            {tiposEjecutables.map((t) => (
              <option key={t} value={t}>
                {etiquetas[t] ?? t}
              </option>
            ))}
          </select>
          <p className={CAMPO.nota}>{explicacionTipo(tipo)}</p>
        </div>

        {necesitaConexion && (
          <div className={CAMPO.contenedor}>
            <label className={CAMPO.etiqueta} htmlFor="unidad-trabajo">
              Cuenta y país <span className={CAMPO.obligatorio}>*</span>
            </label>
            <select
              id="unidad-trabajo"
              value={unidad}
              onChange={(e) => setUnidad(e.target.value)}
              className={CAMPO.input}
            >
              {unidades.map((u) => (
                <option key={`${u.connectionId}|${u.marketplaceId}`} value={`${u.connectionId}|${u.marketplaceId}`}>
                  {u.conexion} · {nombreMarketplace(u.marketplaceId)}
                </option>
              ))}
            </select>
            {/* Una línea: dos trabajos de la misma cuenta no van a la vez, y sin
                eso el desplegable no explica por qué falla. El porqué —el cupo se
                cuenta por vendedor— está en el botón de información. */}
            <p className={CAMPO.nota}>Dos trabajos de la misma cuenta no van a la vez.</p>
          </div>
        )}
      </div>

      <div className={CAMPO.contenedor}>
        <label className={CAMPO.etiqueta} htmlFor="skus-trabajo">
          Solo estas referencias {skus.length > 0 && <span className={TEXTO.acento}>· {skus.length}</span>}
        </label>
        <textarea
          id="skus-trabajo"
          value={skusTexto}
          onChange={(e) => setSkusTexto(e.target.value)}
          rows={3}
          placeholder="Un SKU por línea, o separados por comas. En blanco = todo el ámbito del trabajo."
          className={`${CAMPO.input} h-auto py-[5px] leading-[1.5] resize-y`}
        />
        {/* Se queda lo que cambia el resultado —que no cuenta como barrido
            completo— y el límite. El resto, en el botón de información. */}
        <p className={CAMPO.nota}>
          <span className={TEXTO.t1}>No cuenta como barrido completo</span>. Máximo {MAX_SKUS}.
        </p>
      </div>

      <label className="flex items-start gap-[6px]">
        <input
          type="checkbox"
          checked={soloActivos}
          onChange={(e) => setSoloActivos(e.target.checked)}
          className="mt-[2px] h-[13px] w-[13px] shrink-0 accent-[var(--ls-acc-relleno)]"
        />
        <span className={`${TIPO.s} ${TEXTO.t2}`}>
          Solo los SKU en seguimiento
          <span className={`${TEXTO.t3} block`}>
            Lo efectivo, o sea lo que dijo una persona por encima de lo que calculó la regla.
            Apagarlo sobre un catálogo grande convierte un trabajo de una hora en uno de toda la
            noche.
          </span>
        </span>
      </label>
    </Dialogo>
  )
}

function DialogoCancelar({
  job,
  etiqueta,
  onCerrar,
  onCancelado,
}: {
  job: AmazonJob
  etiqueta: string
  onCerrar: () => void
  onCancelado: () => void
}) {
  const [motivo, setMotivo] = useState('')
  const [enviando, setEnviando] = useState(false)

  async function cancelar() {
    if (motivo.trim() === '') {
      toast.error('Di por qué se cancela')
      return
    }
    setEnviando(true)
    const res = await patchAmazon<JobRespuesta>(`/api/plataforma/jobs/${job.id}`, {
      accion: 'cancelar',
      motivo: motivo.trim(),
    })
    setEnviando(false)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    toast.success(res.data.mensaje ?? 'Cancelado')
    onCancelado()
  }

  return (
    <Dialogo
      titulo={`Cancelar «${etiqueta}»`}
      entradilla="Si el motor lo está procesando ahora mismo, no se corta a la mitad: para al acabar el lote que tiene entre manos, con el cursor en un punto coherente. Si está parado, se cierra en el acto."
      onCerrar={onCerrar}
      pie={
        <>
          <button type="button" onClick={onCerrar} className={`${BOTON.base} ${BOTON.secundario}`}>
            Dejarlo correr
          </button>
          <button
            type="button"
            onClick={() => void cancelar()}
            disabled={enviando}
            className={`${BOTON.base} ${BOTON.primario}`}
          >
            {enviando ? 'Cancelando…' : 'Cancelar el trabajo'}
          </button>
        </>
      }
    >
      <div className={CAMPO.contenedor}>
        <label className={CAMPO.etiqueta} htmlFor="motivo-cancelar">
          Por qué <span className={CAMPO.obligatorio}>*</span>
        </label>
        <input
          id="motivo-cancelar"
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          className={CAMPO.input}
          placeholder="Se lanzó sin querer sobre el catálogo entero"
          autoFocus
        />
        <p className={CAMPO.nota}>Obligatorio.</p>
      </div>
    </Dialogo>
  )
}

/* ------------------------------------------------------------------ */
/* Piezas                                                              */
/* ------------------------------------------------------------------ */

function explicacionTipo(tipo: AmazonJobTipo): string {
  switch (tipo) {
    case 'censo_catalogo':
      return 'Pide a Amazon el informe del catálogo completo y lo vuelca en el espejo: SKU, ASIN, precio, cantidad, estado y canal. Es el primero de todos: descubre los ASIN de los que cuelgan los demás. Amazon tarda entre uno y veinte minutos en generarlo.'
    case 'enriquecer_catalogo':
      return 'Marca, categoría, medidas del producto y del embalaje. Va por ASIN, no por SKU: doce tallas de un modelo comparten los mismos atributos.'
    case 'snapshot_bsr':
      return 'El ranking de ventas de cada ASIN, guardado con la fecha. Es el dato que NO se puede reconstruir hacia atrás: el día que no se guarda, se pierde para siempre.'
    case 'inventario_fba':
      return 'Existencias en los almacenes de Amazon: disponible, reservado y lo que va de camino. Los SKU que gestiona el vendedor no salen en esa respuesta y se guardan como «no aplica», nunca como cero.'
    case 'recalcular_activos':
      return 'Aplica el criterio del cliente y decide qué SKU se refrescan a diario. No gasta ni una llamada a Amazon, así que se puede lanzar las veces que haga falta.'
    default:
      return 'Este trabajo lo construye un módulo posterior.'
  }
}

function tonoEstadoJob(estado: string): TonoEstado {
  switch (estado) {
    case 'en_curso':
      return 'cian'
    case 'pendiente':
      return 'azul'
    case 'pausado':
      return 'ambar'
    case 'terminado':
      return 'verde'
    case 'error':
      return 'rojo'
    default:
      return 'gris'
  }
}

/** El estado por GLIFO además de por palabra y por color: tapando el color con
    la mano la tabla se sigue leyendo */
function glifoEstado(estado: string): string {
  switch (estado) {
    case 'en_curso':
      return '◐'
    case 'pendiente':
      return '○'
    case 'pausado':
      return '‖'
    case 'terminado':
      return '●'
    case 'error':
      return '✕'
    default:
      return '–'
  }
}

function tonoSeveridad(severidad: string): TonoEstado {
  switch (severidad) {
    case 'critico':
      return 'rojo'
    case 'error':
      return 'rojo'
    case 'aviso':
      return 'ambar'
    default:
      return 'azul'
  }
}


/* ------------------------------------------------------------------ */
/* Cada cuánto le toca a cada refresco                                 */
/* ------------------------------------------------------------------ */

/**
 * LOS HORARIOS DE LOS REFRESCOS.
 *
 * CUIDADO CON NO CONFUNDIR LOS DOS RELOJES DE ESTE ERP, porque ya se ha
 * confundido:
 *
 *   · Amazon API · Sistema  → cada cuánto se DESPIERTA el motor. Minutos.
 *   · esto                  → cada cuánto le TOCA a cada refresco. Horas o días.
 *
 * Que el motor entre cada 5 minutos no significa que se relea el catálogo cada 5
 * minutos: significa que cada 5 minutos se comprueba si a alguien le toca. La
 * columna de la rejilla ponía «diario» y «semanal» a secas y era imposible saber
 * cuál de los dos se estaba mirando. Por eso aquí sale el número, y al lado
 * cuántas veces al día sale eso.
 */
/**
 * QUÉ ES CADA REFRESCO EN CRISTIANO, Y A QUÉ RITMO CAMBIA ESE DATO.
 *
 * La tabla se llamaba por los nombres internos del motor —«Recalcular SKU en
 * seguimiento», «Censo del catálogo»— y eso obligaba a saberse el motor para
 * elegir un número. Aquí manda EL DATO; el nombre técnico va debajo en pequeño
 * porque es el que aparece en la cola de trabajos y en «Al día», y dos
 * vocabularios distintos para lo mismo es justo el lío que esto viene a cerrar.
 *
 * `cambia` contesta la única pregunta que importa al elegir la cadencia: cada
 * cuánto cambia el dato DE VERDAD. Pedirlo más a menudo que eso no trae nada
 * nuevo.
 */
const QUE_ES: Record<string, { dato: string; cambia: string; serie?: boolean }> = {
  snapshot_precios: {
    dato: 'Quién gana la Buy Box',
    cambia: 'minutos · los competidores mueven precios todo el día',
  },
  censo_catalogo: {
    dato: 'Referencias nuevas y retiradas',
    cambia: 'horas · Amazon cachea el informe entre 1 y 6 h',
  },
  inventario_fba: {
    dato: 'Histórico de existencias',
    cambia: '1 vez al día · el stock que se ve en pantalla ya va cada 15 min',
    serie: true,
  },
  snapshot_bsr: {
    dato: 'Ranking de ventas (BSR)',
    cambia: '1 vez al día · Amazon no lo recalcula más a menudo',
    serie: true,
  },
  enriquecer_catalogo: {
    dato: 'Marca, categoría y medidas',
    cambia: 'casi nunca · un producto no cambia de marca',
  },
  recalcular_activos: {
    dato: 'Qué SKU están en seguimiento',
    cambia: 'cuando cambias el criterio · no pide nada a Amazon',
  },
}

/**
 * A partir de cuándo una SERIE se está guardando a sí misma en bucle.
 *
 * El BSR y el inventario no son «el dato de ahora»: son histórico, una fila por
 * SKU y pasada. A cuatro horas ya son seis puntos diarios de algo que cambia una
 * vez al día. Por debajo, lo que crece es la factura de la base y no la
 * información: la línea del gráfico sale idéntica.
 */
const SERIE_DEMASIADO_RAPIDO = 240

/**
 * El orden es POR RITMO, del más vivo al más quieto, y no el del planificador.
 *
 * Puesto por prioridad de ejecución, «Marca y medidas» salía en medio de cosas
 * que van cada hora y no había forma de leer la tabla de un vistazo. Así la
 * columna «cambia cada» baja sola y el número de al lado tiene que acompañarla:
 * cuando no lo hace, se ve.
 */
const ORDEN_POR_RITMO = [
  'snapshot_precios',
  'censo_catalogo',
  'inventario_fba',
  'snapshot_bsr',
  'recalcular_activos',
  'enriquecer_catalogo',
]

function PanelHorarios({
  horarios,
  etiquetas,
  clienteId,
  clienteNombre,
  onGuardado,
}: {
  horarios: ConfigRefresco[]
  etiquetas: Record<AmazonJobTipo, string>
  clienteId: string
  clienteNombre: string
  onGuardado: (config: ConfigRefresco[]) => void
}) {
  const [guardando, setGuardando] = useState<string | null>(null)

  /**
   * El FOEP tiene su propio reloj y NO vive en refresco_config.
   *
   * Es el único de esta tabla que se configura POR CLIENTE, y no por capricho:
   * su precio depende del tamaño del catálogo de cada uno. 40 SKU por llamada y
   * una llamada cada treinta segundos son 4.800 SKU/hora de techo, con el cupo
   * compartido entre todos los países del mismo vendedor. Un cliente de 500
   * referencias con stock puede pedirlo cada hora; uno de 2.500 en cuatro
   * países tarda dos horas en dar una vuelta.
   *
   * Sale aquí igualmente porque es donde alguien viene a mirar cada cuánto se
   * actualiza algo, y tenerlo en otra pantalla es tenerlo escondido. Lo que hace
   * falta es que se vea que es de ESTE cliente y no de todos.
   */
  const [foep, setFoep] = useState<RelojFoep | null>(null)
  const [guardandoFoep, setGuardandoFoep] = useState(false)

  const leerFoep = useCallback(async () => {
    const res = await getAmazon<{ config: { coste?: RelojFoep } }>(
      `/api/plataforma/buybox/config?clientId=${clienteId}`
    )
    if (res.ok && res.data.config?.coste) setFoep(res.data.config.coste)
  }, [clienteId])

  useEffect(() => {
    setFoep(null)
    void leerFoep()
  }, [leerFoep])

  /** `null` = automático: que lo calcule el ERP con las referencias con stock */
  async function guardarFoep(cadaMinutos: number | null) {
    setGuardandoFoep(true)
    const res = await patchAmazon<{ config: { coste?: RelojFoep } }>(
      '/api/plataforma/buybox/config',
      { clientId: clienteId, foepCadaMinutos: cadaMinutos }
    )
    setGuardandoFoep(false)
    if (!res.ok) {
      toast.error(res.error, { duration: 10_000 })
      return
    }
    if (res.data.config?.coste) setFoep(res.data.config.coste)
    toast.success(
      cadaMinutos === null
        ? 'El FOEP vuelve a calcularse solo con el catálogo de este cliente.'
        : 'Horario del FOEP fijado a mano para este cliente.'
    )
  }

  async function guardar(
    tipo: AmazonJobTipo,
    cambios: { cadaMinutos?: number; soloDeNoche?: boolean; activo?: boolean }
  ) {
    setGuardando(tipo)
    const res = await patchAmazon<{ config: ConfigRefresco[] }>('/api/plataforma/refrescos', {
      tipo,
      ...cambios,
    })
    setGuardando(null)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    onGuardado(res.data.config)
    toast.success('Horario guardado. Se aplica en la próxima pasada del planificador.')
  }

  if (horarios.length === 0) return null

  return (
    <Panel titulo="Cada cuánto se actualiza cada dato" sinCuerpo>
      {/* ESTA LÍNEA EXISTE PORQUE LA PANTALLA CONFUNDÍA, Y CON RAZÓN.
          Hay dos horarios en el ERP con controles calcados en pestañas
          distintas, y sin decir cuál es cuál, «cada 5 minutos» en Sistema y
          «cada día» aquí parecen contradecirse. No se contradicen: son el
          reloj del motor y el reloj de los datos. */}
      <div className={`px-[10px] pt-[8px] ${TIPO.s} ${TEXTO.t3}`}>
        La regla es una:{' '}
        <strong className={TEXTO.t2}>pon la cadencia al ritmo al que cambia el dato</strong>, no al
        ritmo al que quieres mirarlo — pedirlo más a menudo no trae nada nuevo. No confundir con{' '}
        <strong className={TEXTO.t2}>Sistema</strong>, que es cada cuánto se despierta el motor a
        mirar si hay algo que hacer.
      </div>
      <div className="overflow-x-auto">
        <table className={TABLA.tabla}>
          <thead>
            <tr>
              <th className={`${TABLA.cabecera} ${TABLA.cabeceraFija}`}>Dato</th>
              <th className={TABLA.cabecera}>Cambia cada</th>
              <th className={TABLA.cabecera}>Se trae cada</th>
              <th className={TABLA.cabecera}>O sea</th>
              <th className={TABLA.cabecera}>Puede arrancar</th>
              <th className={TABLA.cabecera}></th>
            </tr>
          </thead>
          <tbody>
            {/* La fila que NO se configura aquí, y justo por eso está: es el dato
                que más se mira y el que más veces se ha preguntado dónde se
                toca. Sin ella, la tabla parecía decir que el precio se trae una
                vez al día. */}
            <tr className={TABLA.fila}>
              <td className={`${TABLA.celda} ${TABLA.celdaFija}`}>
                <span className={TEXTO.t1}>Precio, stock y estado de los listings</span>
                <span className={`block ${TIPO.s} ${TEXTO.t4}`}>ciclo de catálogo</span>
              </td>
              <td className={`${TABLA.celda} ${TEXTO.t3}`}>minutos</td>
              <td className={`${TABLA.celda} ${TEXTO.t3}`}>cada 15 minutos</td>
              <td className={`${TABLA.celda} ${TEXTO.t3}`}>96 veces al día</td>
              <td className={`${TABLA.celda} ${TEXTO.t3}`}>a cualquier hora</td>
              <td className={`${TABLA.celda} ${TEXTO.t4} ${TIPO.s}`}>se cambia en Sistema</td>
            </tr>
            {[...horarios]
              .sort((a, b) => ORDEN_POR_RITMO.indexOf(a.tipo) - ORDEN_POR_RITMO.indexOf(b.tipo))
              .map((h) => (
                <FilaHorario
                  key={h.tipo}
                  horario={h}
                  etiqueta={etiquetas[h.tipo] ?? h.tipo}
                  guardando={guardando === h.tipo}
                  onGuardar={(cambios) => void guardar(h.tipo, cambios)}
                />
              ))}
            {/* El FOEP, que es de ESTE cliente. Ver la nota de arriba */}
            {foep && (
              <FilaFoep
                reloj={foep}
                cliente={clienteNombre}
                guardando={guardandoFoep}
                onGuardar={(m) => void guardarFoep(m)}
              />
            )}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}

function FilaHorario({
  horario,
  etiqueta,
  guardando,
  onGuardar,
}: {
  horario: ConfigRefresco
  etiqueta: string
  guardando: boolean
  onGuardar: (cambios: { cadaMinutos?: number; soloDeNoche?: boolean; activo?: boolean }) => void
}) {
  const inicial = descomponer(horario.cada_minutos)
  const [valor, setValor] = useState(String(inicial.valor))
  const [unidad, setUnidad] = useState<UnidadTiempo>(inicial.unidad)

  // Si cambia por fuera —otra pestaña— el campo tiene que seguirlo, o el
  // siguiente «Guardar» revertiría el cambio del otro sitio.
  useEffect(() => {
    const d = descomponer(horario.cada_minutos)
    setValor(String(d.valor))
    setUnidad(d.unidad)
  }, [horario.cada_minutos])

  const minutos = aMinutos(Number(valor) || 0, unidad)
  const valido = Number.isFinite(minutos) && minutos >= 15 && minutos <= 259_200
  const cambiado = minutos !== horario.cada_minutos

  /**
   * Lo que hay que avisar de esta combinación de cadencia y ventana.
   *
   * Antes esto era `solo_de_noche && cada_minutos < 1440`, y ESO ERA FALSO: con
   * 20 horas y ventana nocturna saltaba un aviso diciendo que no se cumplía,
   * cuando 20 h de noche significa exactamente una vez por noche, que es lo que
   * se quiere. Un aviso que salta cuando no pasa nada se aprende a ignorar, y
   * entonces tampoco se lee el día que sí pasa algo.
   */
  const aviso = avisoDeVentana(horario.cada_minutos, horario.solo_de_noche)

  const queEs = QUE_ES[horario.tipo]

  /**
   * Aviso propio de las SERIES, que es un problema distinto al del cupo.
   *
   * El BSR y el inventario guardan una fila por SKU y pasada. Pedirlos cada
   * quince minutos no da una línea con más detalle: da LA MISMA línea con el
   * mismo número repetido noventa y seis veces, y una base de datos que crece en
   * cientos de miles de filas al día.
   */
  const serieMuyRapida = queEs?.serie === true && horario.cada_minutos < SERIE_DEMASIADO_RAPIDO

  return (
    <tr className={TABLA.fila}>
      {/* El DATO manda y el nombre técnico va debajo en pequeño: ese es el que
          sale en la cola de trabajos y en «Al día», y hacen falta los dos para
          que no acaben siendo dos vocabularios distintos para lo mismo. */}
      <td className={`${TABLA.celda} ${TABLA.celdaFija}`}>
        <span className={TEXTO.t1}>{queEs?.dato ?? etiqueta}</span>
        <span className={`block ${TIPO.s} ${TEXTO.t4}`}>{etiqueta}</span>
      </td>

      <td className={`${TABLA.celda} ${TEXTO.t3} max-w-[240px]`}>{queEs?.cambia ?? '—'}</td>

      <td className={TABLA.celda}>
        <span className="flex items-center gap-[5px]">
          <input
            type="number"
            min={1}
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            className={`${CAMPO.input} !h-6 !w-[62px] ${TIPO.num}`}
            aria-label={`Cada cuánto se refresca ${etiqueta}`}
          />
          <select
            value={unidad}
            onChange={(e) => setUnidad(e.target.value as UnidadTiempo)}
            className={`${CAMPO.input} !h-6 !w-auto`}
            aria-label="Unidad"
          >
            {UNIDADES.map((u) => (
              <option key={u.id} value={u.id}>
                {u.label}
              </option>
            ))}
          </select>
          {cambiado && (
            <button
              type="button"
              disabled={!valido || guardando}
              onClick={() => onGuardar({ cadaMinutos: minutos })}
              className={`${BOTON.base} ${BOTON.primario}`}
            >
              Guardar
            </button>
          )}
        </span>
        {!valido && (
          <span className={TIPO.s} style={{ color: COLOR_ESTADO.rojo }}>
            Entre 15 minutos y 180 días
          </span>
        )}
      </td>

      <td className={`${TABLA.celda} ${TEXTO.t3}`}>
        {salidaReal(horario.cada_minutos, horario.solo_de_noche)}
        {serieMuyRapida && (
          <span className={`${TIPO.s} block max-w-[240px]`} style={{ color: COLOR_ESTADO.ambar }}>
            Es un histórico: a este ritmo se guarda el mismo número muchas veces al día y la gráfica
            sale idéntica.
          </span>
        )}
      </td>

      <td className={TABLA.celda}>
        <button
          type="button"
          disabled={guardando}
          onClick={() => onGuardar({ soloDeNoche: !horario.solo_de_noche })}
          className={`${BOTON.base} ${BOTON.secundario}`}
          title={
            horario.solo_de_noche
              ? 'Solo puede ARRANCAR entre las 23:00 y las 06:00. Uno que empieza a las 05:50 y tarda dos horas no se corta: cortarlo dejaría el catálogo a medias'
              : 'Puede arrancar a cualquier hora'
          }
        >
          {horario.solo_de_noche ? <Moon className="h-3 w-3" /> : <Sun className="h-3 w-3" />}
          {horario.solo_de_noche ? 'Solo de noche' : 'A cualquier hora'}
        </button>
        {aviso && (
          <span className={`${TIPO.s} block`} style={{ color: COLOR_ESTADO.ambar }}>
            {aviso}
          </span>
        )}
      </td>

      <td className={TABLA.celda}>
        <button
          type="button"
          disabled={guardando}
          onClick={() => onGuardar({ activo: !horario.activo })}
          className={`${BOTON.base} ${BOTON.secundario}`}
          title={
            horario.activo
              ? 'Deja de encolarse solo. Se puede seguir lanzando desde «Lanzar un trabajo»'
              : 'Vuelve a encolarse en su cadencia'
          }
        >
          {horario.activo ? <CirclePause className="h-3 w-3" /> : <CirclePlay className="h-3 w-3" />}
          {horario.activo ? 'Apagar' : 'Encender'}
        </button>
        {horario.pordefecto && (
          <span className={`${TIPO.s} block ${TEXTO.t4}`}>
            valor del código: lanza 139_refresco_config.sql
          </span>
        )}
      </td>
    </tr>
  )
}

/**
 * CADA CUÁNTO SE PIDE EL TECHO DE PRECIO (FOEP) DE ESTE CLIENTE.
 *
 * La única fila de esta tabla que NO es global. Vive en la configuración de Buy
 * Box del cliente porque su precio depende del tamaño de SU catálogo:
 *
 *   getFeaturedOfferExpectedPriceBatch → 40 SKU por llamada, una cada 30 s.
 *   Techo: 4.800 SKU a la hora, y ese cupo lo comparten TODOS los países del
 *   mismo vendedor.
 *
 *     500 SKU con stock →  13 llamadas →  7 min  → cada hora sobra
 *   2.500 SKU con stock →  63 llamadas → 31 min  → cada hora, justo
 *   2.500 × 4 países    → 250 llamadas →  2 h 05 → cada hora imposible
 *
 * Por eso NO hay un botón de «a cualquier hora» ni de apagar: apagarlo se hace
 * en la configuración de Buy Box, donde está el resto de decisiones de ese
 * módulo, y aquí solo se toca el reloj.
 */
function FilaFoep({
  reloj,
  cliente,
  guardando,
  onGuardar,
}: {
  reloj: RelojFoep
  cliente: string
  guardando: boolean
  onGuardar: (minutos: number | null) => void
}) {
  const inicial = descomponer(reloj.foepMinutos)
  const [valor, setValor] = useState(String(inicial.valor))
  const [unidad, setUnidad] = useState<UnidadTiempo>(inicial.unidad)

  useEffect(() => {
    const d = descomponer(reloj.foepMinutos)
    setValor(String(d.valor))
    setUnidad(d.unidad)
  }, [reloj.foepMinutos])

  const nuevos = aMinutos(Number(valor) || 0, unidad)
  const valido = Number.isFinite(nuevos) && nuevos >= 15 && nuevos <= 43_200
  const cambiado = nuevos !== reloj.foepMinutos

  return (
    <tr className={TABLA.fila}>
      <td className={`${TABLA.celda} ${TABLA.celdaFija}`}>
        <span className={TEXTO.t1}>A qué precio ganaríamos la Buy Box</span>
        <span className={`block ${TIPO.s} ${TEXTO.t4}`}>FOEP · solo de {cliente}</span>
      </td>

      {/* LA CUENTA, A LA VISTA. Un automatismo que decide sin decir por qué se
          desactiva la primera vez que alguien no entiende el número; esta cabe
          en una frase, así que se enseña y deja de ser magia. */}
      <td className={`${TABLA.celda} ${TEXTO.t3} max-w-[300px]`}>{reloj.foepPorQue}</td>

      <td className={TABLA.celda}>
        <span className="flex items-center gap-[5px]">
          {reloj.foepAutomatico ? (
            <>
              <span className={`${TIPO.num} ${TEXTO.t1}`}>{textoIntervalo(reloj.foepMinutos)}</span>
              <span className={`${TIPO.s} ${TEXTO.t4}`}>· calculado</span>
            </>
          ) : (
            <>
              <input
                type="number"
                min={15}
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                className={`${CAMPO.input} !h-6 !w-[62px] ${TIPO.num}`}
                aria-label="Cada cuánto se pide el FOEP"
              />
              <select
                value={unidad}
                onChange={(e) => setUnidad(e.target.value as UnidadTiempo)}
                className={`${CAMPO.input} !h-6 !w-auto`}
                aria-label="Unidad"
              >
                {UNIDADES.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.label}
                  </option>
                ))}
              </select>
              {cambiado && (
                <button
                  type="button"
                  disabled={!valido || guardando}
                  onClick={() => onGuardar(nuevos)}
                  className={`${BOTON.base} ${BOTON.primario}`}
                >
                  Guardar
                </button>
              )}
            </>
          )}
        </span>
        {!reloj.foepAutomatico && !valido && (
          <span className={TIPO.s} style={{ color: COLOR_ESTADO.rojo }}>
            Entre 15 minutos y 30 días
          </span>
        )}
      </td>

      <td className={`${TABLA.celda} ${TEXTO.t3}`}>
        {/* `false` porque el FOEP no tiene ventana nocturna: puede arrancar a
            cualquier hora, así que las veces al día son las del reloj. */}
        {salidaReal(reloj.foepMinutos, false)}
      </td>

      <td className={`${TABLA.celda} ${TEXTO.t3}`}>a cualquier hora</td>

      <td className={TABLA.celda}>
        {/* Volver a automático tiene que ser un clic. Si fijarlo a mano no
            tuviera vuelta atrás, el número que alguien puso una tarde para
            probar se quedaría ahí para siempre — y el stock se mueve. */}
        <button
          type="button"
          disabled={guardando}
          onClick={() => onGuardar(reloj.foepAutomatico ? reloj.foepMinutos : null)}
          className={`${BOTON.base} ${BOTON.secundario}`}
          title={
            reloj.foepAutomatico
              ? 'Fijarlo a mano. Deja de ajustarse cuando cambie el stock del cliente'
              : 'Que lo calcule el ERP a partir de las referencias con stock'
          }
        >
          {reloj.foepAutomatico ? 'Fijar a mano' : 'Automático'}
        </button>
        <span className={`block ${TIPO.s} ${TEXTO.t4}`}>de este cliente</span>
      </td>
    </tr>
  )
}
