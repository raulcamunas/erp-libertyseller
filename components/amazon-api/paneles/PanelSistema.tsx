'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  PauseCircle,
  Play,
  PlayCircle,
  RotateCcw,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  BOTON,
  CAMPO,
  COLOR_ESTADO,
  LINEA,
  PANTALLA,
  RADIO,
  SUPERFICIE,
  TABLA,
  TEXTO,
  TIPO,
  TITULO,
} from '@/lib/estilo/denso'
import { ListaInfo, SeccionInfo } from '@/components/ui/BotonInfo'
import { Aviso, Cargando, hace, nombreMarketplace } from '@/components/plataforma/comun'
import { AMAZON_JOB_TIPO_LABELS } from '@/lib/plataforma/tipos'
import { TAREAS_CRON, estaParada } from '@/lib/sistema/cron'

/**
 * ¿ESTÁN CORRIENDO LOS PROCESOS AUTOMÁTICOS?
 *
 * La pantalla que no existía cuando hizo falta. Los tres crones llevaban desde
 * el primer día pidiendo a `localhost:3000` mientras el servidor escuchaba en el
 * 80: contestaban HTTP 000 en cada pasada y ninguna pantalla lo dijo. El
 * catálogo se quedó «refrescado hace 17 horas», los trabajos de plataforma
 * acumularon 0 pasadas y la agenda solo se sincronizaba a mano.
 *
 * Se descubrió mirando los registros del contenedor de casualidad. Esto es para
 * que la próxima vez se vea aquí.
 */

interface Ejecucion {
  id: string
  tarea: string
  iniciado_at: string
  terminado_at: string | null
  ok: boolean | null
  resumen: string | null
  error: string | null
  duracion_ms: number | null
  lanzado_por: string | null
}

interface Trabajo {
  id: string
  tipo: string
  client_id: string
  marketplace_id: string | null
  estado: string
  iniciado_at: string | null
  terminado_at: string | null
  procesados: number
  errores: number
  pasadas: number
  resumen: string | null
  error_message: string | null
}

interface Cliente {
  id: string
  name: string
}

interface Proceso {
  id: string
  nombre: string
  ruta: string
  cadaMinutos: number
  activo: boolean
  /** El horario todavía sale del código: falta lanzar la migración 138 */
  horarioPorDefecto: boolean
  que: string
  ultima: Ejecucion | null
  ultimaAutomatica: Ejecucion | null
}

/* ------------------------------------------------------------------ */
/* El horario                                                          */
/* ------------------------------------------------------------------ */

/**
 * El intervalo se guarda SIEMPRE en minutos, y aquí se enseña en la unidad que
 * toque.
 *
 * Una sola columna en la base y una sola comparación en tocaAhora(); la unidad
 * es cosa de la pantalla. Guardar «2 semanas» como número y unidad obligaría a
 * convertir en cada comprobación, sesenta veces por hora, para no ganar nada.
 */
const UNIDADES = [
  { id: 'min', label: 'minutos', minutos: 1 },
  { id: 'h', label: 'horas', minutos: 60 },
  { id: 'd', label: 'días', minutos: 1440 },
] as const

type Unidad = (typeof UNIDADES)[number]['id']

/** La unidad más grande en la que el intervalo es un número redondo */
function descomponer(minutos: number): { valor: number; unidad: Unidad } {
  for (const u of [...UNIDADES].reverse()) {
    if (minutos % u.minutos === 0) return { valor: minutos / u.minutos, unidad: u.id }
  }
  return { valor: minutos, unidad: 'min' }
}

function aMinutos(valor: number, unidad: Unidad): number {
  return valor * (UNIDADES.find((u) => u.id === unidad)?.minutos ?? 1)
}

function textoIntervalo(minutos: number): string {
  const { valor, unidad } = descomponer(minutos)
  const label = UNIDADES.find((u) => u.id === unidad)!.label
  return `cada ${valor} ${valor === 1 ? label.replace(/s$/, '') : label}`
}

export function PanelSistema() {
  const [procesos, setProcesos] = useState<Proceso[] | null>(null)
  const [ejecuciones, setEjecuciones] = useState<Ejecucion[]>([])
  const [trabajos, setTrabajos] = useState<Trabajo[]>([])
  const [clientes, setClientes] = useState<Cliente[]>([])
  /** Vacío = todos. El desglose por cliente contesta otra pregunta que los tres
      procesos de arriba: si el motor está vivo, qué ha hecho por ESTA cuenta */
  const [clienteId, setClienteId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)
  const [lanzando, setLanzando] = useState<string | null>(null)
  const [guardando, setGuardando] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    try {
      const res = await fetch('/api/sistema/cron')
      const datos = await res.json()
      if (!res.ok) throw new Error(datos?.error ?? 'No se ha podido leer el estado')
      setProcesos(datos.procesos)
      setEjecuciones(datos.ejecuciones ?? [])
      setTrabajos(datos.trabajos ?? [])
      setClientes(datos.clientes ?? [])
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se ha podido leer el estado')
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    void cargar()
    // Cada minuto: es una pantalla de vigilancia y se deja abierta. Con el
    // proceso de agenda cada 3 minutos, un minuto de refresco basta para ver
    // entrar las pasadas sin machacar la base.
    const t = setInterval(() => void cargar(), 60_000)
    return () => clearInterval(t)
  }, [cargar])

  /**
   * Guarda el horario de un proceso.
   *
   * Se recarga entero después en vez de tocar el estado a mano: lo que decide
   * si un proceso «está parado» depende del intervalo, así que cambiarlo cambia
   * también los avisos de arriba. Reconstruirlo aquí sería repetir esa cuenta en
   * dos sitios.
   */
  async function guardarHorario(id: string, cambios: { cadaMinutos?: number; activo?: boolean }) {
    setGuardando(id)
    try {
      const res = await fetch('/api/sistema/cron', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tarea: id, ...cambios }),
      })
      const datos = await res.json()
      if (!res.ok) throw new Error(datos?.error ?? 'No se ha podido guardar')
      toast.success('Horario guardado. Tiene efecto en el minuto siguiente.')
      await cargar()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se ha podido guardar el horario')
      // Se recarga también al fallar: si no, el campo se queda enseñando un
      // número que no está guardado y parece que sí.
      await cargar()
    } finally {
      setGuardando(null)
    }
  }

  async function lanzar(id: string, nombre: string) {
    setLanzando(id)
    try {
      const res = await fetch('/api/sistema/cron', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tarea: id }),
      })
      const datos = await res.json()
      if (!res.ok) throw new Error(datos?.error ?? 'No se ha podido lanzar')
      if (datos.ok) toast.success(datos.mensaje)
      else toast.error(datos.mensaje, { duration: 12_000 })
      await cargar()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : `No se ha podido lanzar «${nombre}»`)
    } finally {
      setLanzando(null)
    }
  }

  if (cargando && !procesos) return <Cargando texto="Leyendo el estado de los procesos…" />
  if (error && !procesos) {
    return (
      <div className={PANTALLA.cuerpo}>
        <Aviso tono="rojo" icono={AlertTriangle}>
          {error}
        </Aviso>
      </div>
    )
  }
  if (!procesos) return null

  const parados = procesos.filter((p) => estaParada(p.cadaMinutos, p.ultimaAutomatica?.iniciado_at ?? null))
  const trabajosVisibles = clienteId ? trabajos.filter((t) => t.client_id === clienteId) : trabajos

  return (
    <div className={`${PANTALLA.cuerpo} h-full overflow-auto`}>
      {/* El aviso va aquí y no en la campana: no es una incidencia de un cliente,
          es mantenimiento. Quien abre esta pestaña ya viene a mirar esto. */}
      {parados.length > 0 && (
        <Aviso tono="rojo" icono={AlertTriangle}>
          {parados.length === 1
            ? `«${parados[0].nombre}» no ha corrido solo desde hace más de ${parados[0].cadaMinutos * 3} minutos.`
            : `${parados.length} procesos llevan sin correr solos más de tres veces su intervalo.`}{' '}
          Lánzalos aquí abajo: lo que conteste es exactamente lo que recibe el cron.
        </Aviso>
      )}

      <div className="flex flex-col gap-[10px]">
        {procesos.map((p) => {
          const parado = estaParada(p.cadaMinutos, p.ultimaAutomatica?.iniciado_at ?? null)
          const tono: keyof typeof COLOR_ESTADO = parado ? 'rojo' : 'verde'
          const Icono = parado ? AlertTriangle : CheckCircle2

          return (
            <div key={p.id} className={`${SUPERFICIE.sup} ${RADIO.r2} border ${LINEA.normal} p-[12px]`}>
              <div className="flex items-start justify-between gap-3 min-w-0">
                <div className="min-w-0">
                  <div className="flex items-center gap-[6px]">
                    <Icono className="h-[13px] w-[13px] shrink-0" style={{ color: COLOR_ESTADO[tono] }} />
                    <span className={`${TITULO.seccion} ${TEXTO.t1}`}>{p.nombre}</span>
                    <span className={`${TIPO.s} ${TEXTO.t4}`}>· {textoIntervalo(p.cadaMinutos)}</span>
                    {!p.activo && (
                      <span className={`${TIPO.s}`} style={{ color: COLOR_ESTADO.ambar }}>
                        · apagado
                      </span>
                    )}
                  </div>
                  <p className={`mt-[3px] ${TIPO.s} ${TEXTO.t3} leading-[1.45]`}>{p.que}</p>

                  <div className={`mt-[6px] flex flex-wrap items-center gap-x-[14px] gap-y-[3px] ${TIPO.s}`}>
                    {/* SOLO las que lanzó el cron. Una pasada disparada a mano
                        desde aquí no demuestra que el automatismo funcione, y
                        contarla taparía justo lo que se viene a buscar. */}
                    <span className={TEXTO.t3}>
                      Última automática:{' '}
                      {p.ultimaAutomatica ? (
                        hace(p.ultimaAutomatica.iniciado_at)
                      ) : (
                        <span style={{ color: COLOR_ESTADO.rojo }}>nunca</span>
                      )}
                    </span>
                    {p.ultima && p.ultima.lanzado_por !== null && (
                      <span className={TEXTO.t4}>
                        (la última de todas fue a mano, {hace(p.ultima.iniciado_at)})
                      </span>
                    )}
                    {p.ultimaAutomatica?.duracion_ms != null && (
                      <span className={`${TEXTO.t4} ${TIPO.num}`}>
                        tardó {(p.ultimaAutomatica.duracion_ms / 1000).toFixed(1)} s
                      </span>
                    )}
                  </div>

                  {p.ultimaAutomatica?.error && (
                    <p className={`mt-[5px] ${TIPO.s}`} style={{ color: COLOR_ESTADO.rojo }}>
                      {p.ultimaAutomatica.error}
                    </p>
                  )}

                  <EditorHorario
                    proceso={p}
                    guardando={guardando === p.id}
                    onGuardar={(cambios) => void guardarHorario(p.id, cambios)}
                  />
                </div>

                <button
                  type="button"
                  onClick={() => void lanzar(p.id, p.nombre)}
                  disabled={lanzando !== null}
                  className={`${BOTON.base} ${BOTON.secundario} shrink-0`}
                >
                  {lanzando === p.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Play className="h-3.5 w-3.5" />
                  )}
                  Lanzar ahora
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {/* -------- Qué ha corrido por cliente -------- */}
      <div className="mt-[16px] flex flex-wrap items-center gap-[8px]">
        <span className={`${TITULO.seccion} ${TEXTO.t1}`}>Trabajos por cliente</span>
        <select
          value={clienteId}
          onChange={(e) => setClienteId(e.target.value)}
          className={`${CAMPO.input} !h-6 !w-auto max-w-[220px]`}
          aria-label="Cliente"
        >
          <option value="">Todos los clientes</option>
          {clientes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      {/* Sale de amazon_jobs y no del registro de pasadas: una pasada del cron
          avanza un tramo de VARIOS clientes, así que el grano de «qué le ha
          pasado a este» es el trabajo, no la pasada. */}
      {trabajosVisibles.length === 0 ? (
        <p className={`mt-[8px] ${TIPO.s} ${TEXTO.t3}`}>
          {clienteId
            ? 'A este cliente no le ha corrido ningún trabajo todavía. Si su cola tiene cosas pendientes, es que aún no le ha tocado.'
            : 'Todavía no ha corrido ningún trabajo.'}
        </p>
      ) : (
        <div className={`mt-[8px] overflow-auto ${RADIO.r2} border ${LINEA.normal}`}>
          <table className={TABLA.tabla}>
            <thead>
              <tr>
                {!clienteId && <th className={TABLA.cabecera}>Cliente</th>}
                <th className={TABLA.cabecera}>Trabajo</th>
                <th className={TABLA.cabecera}>País</th>
                <th className={TABLA.cabecera}>Empezó</th>
                <th className={TABLA.cabecera}>Tardó</th>
                <th className={TABLA.cabecera}>Procesados</th>
                <th className={TABLA.cabecera}>Cómo acabó</th>
              </tr>
            </thead>
            <tbody>
              {trabajosVisibles.map((t) => {
                const dur =
                  t.iniciado_at && t.terminado_at
                    ? (new Date(t.terminado_at).getTime() - new Date(t.iniciado_at).getTime()) / 1000
                    : null
                const tono =
                  t.estado === 'terminado'
                    ? ('verde' as const)
                    : t.estado === 'error'
                      ? ('rojo' as const)
                      : ('ambar' as const)
                return (
                  <tr key={t.id} className={TABLA.fila}>
                    {!clienteId && (
                      <td className={`${TABLA.celda} ${TEXTO.t3}`}>
                        {clientes.find((c) => c.id === t.client_id)?.name ?? '—'}
                      </td>
                    )}
                    <td className={TABLA.celda}>
                      {AMAZON_JOB_TIPO_LABELS[t.tipo as keyof typeof AMAZON_JOB_TIPO_LABELS] ?? t.tipo}
                    </td>
                    <td className={`${TABLA.celda} ${TEXTO.t3}`}>
                      {t.marketplace_id ? nombreMarketplace(t.marketplace_id) : 'Todo el cliente'}
                    </td>
                    <td className={`${TABLA.celda} ${TEXTO.t3}`}>{hace(t.iniciado_at)}</td>
                    {/* Un trabajo sin terminar no tiene duración, y poner un 0
                        seria decir que fue instantaneo. Se dice que sigue. */}
                    <td className={`${TABLA.celda} ${TIPO.num} ${TEXTO.t3}`}>
                      {dur != null ? `${dur.toFixed(1)} s` : t.estado === 'en_curso' ? 'sigue' : '—'}
                    </td>
                    <td className={`${TABLA.celda} ${TIPO.num} ${TEXTO.t3}`}>
                      {t.procesados}
                      {t.errores > 0 && (
                        <span style={{ color: COLOR_ESTADO.rojo }}> · {t.errores} err</span>
                      )}
                    </td>
                    <td className={TABLA.celda}>
                      <span style={{ color: COLOR_ESTADO[tono] }}>{t.estado}</span>
                      {t.error_message && (
                        <span className={`ml-[6px] ${TEXTO.t3} ${TIPO.s}`}>{t.error_message}</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-[14px] flex items-center justify-between">
        <span className={`${TITULO.seccion} ${TEXTO.t1}`}>Últimas pasadas</span>
        <button type="button" onClick={() => void cargar()} className={`${BOTON.base} ${BOTON.secundario}`}>
          <RotateCcw className="h-3.5 w-3.5" />
          Actualizar
        </button>
      </div>

      {ejecuciones.length === 0 ? (
        <p className={`mt-[8px] ${TIPO.s} ${TEXTO.t3}`}>
          Todavía no hay ninguna. Si acabas de lanzar la migración, es lo normal: solo se guardan
          las pasadas a partir de ese momento.
        </p>
      ) : (
        <div className={`mt-[8px] overflow-auto ${RADIO.r2} border ${LINEA.normal}`}>
          <table className={TABLA.tabla}>
            <thead>
              <tr>
                <th className={TABLA.cabecera}>Proceso</th>
                <th className={TABLA.cabecera}>Cuándo</th>
                <th className={TABLA.cabecera}>Cómo acabó</th>
                <th className={TABLA.cabecera}>Tardó</th>
                <th className={TABLA.cabecera}>Qué hizo</th>
              </tr>
            </thead>
            <tbody>
              {ejecuciones.map((e) => {
                const nombre = TAREAS_CRON.find((t) => t.id === e.tarea)?.nombre ?? e.tarea
                // `ok` a NULL con la fila cerrada hace rato = arrancó y no llegó
                // al final. Es un estado distinto de «falló», y se dice.
                const estado =
                  e.ok === true
                    ? { txt: 'Bien', tono: 'verde' as const }
                    : e.ok === false
                      ? { txt: 'Falló', tono: 'rojo' as const }
                      : { txt: 'Sin terminar', tono: 'ambar' as const }
                return (
                  <tr key={e.id} className={TABLA.fila}>
                    <td className={TABLA.celda}>
                      {nombre}
                      {e.lanzado_por !== null && (
                        <span className={`ml-[5px] ${TEXTO.t4} ${TIPO.s}`}>a mano</span>
                      )}
                    </td>
                    <td className={`${TABLA.celda} ${TEXTO.t3}`}>
                      {hace(e.iniciado_at)}
                    </td>
                    <td className={TABLA.celda}>
                      <span style={{ color: COLOR_ESTADO[estado.tono] }}>{estado.txt}</span>
                    </td>
                    <td className={`${TABLA.celda} ${TIPO.num} ${TEXTO.t3}`}>
                      {e.duracion_ms != null ? `${(e.duracion_ms / 1000).toFixed(1)} s` : '—'}
                    </td>
                    <td className={`${TABLA.celda} ${TEXTO.t3}`}>{e.error ?? e.resumen ?? '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export function InfoSistema() {
  return (
    <>
      <SeccionInfo titulo="Qué se ve aquí">
        <p>
          Si los procesos que corren solos están corriendo de verdad, y un botón para lanzarlos a
          mano cuando hay que depurar algo.
        </p>
      </SeccionInfo>

      <SeccionInfo titulo="Por qué existe esta pantalla">
        <p>
          Los tres procesos llevaban desde el primer día pidiendo al puerto 3000 mientras el
          servidor escuchaba en el 80. Contestaban un error en cada pasada y{' '}
          <strong>ninguna pantalla lo dijo</strong>: el catálogo se quedó parado diecisiete horas,
          los trabajos de plataforma acumularon cero pasadas y la agenda solo se sincronizaba
          cuando alguien pulsaba el botón.
        </p>
        <p>
          Se descubrió mirando los registros del contenedor de casualidad. Esto es para que la
          próxima vez se vea aquí.
        </p>
      </SeccionInfo>

      <SeccionInfo titulo="«Última automática» y no «última»">
        <p>
          Es la distinción importante de esta pantalla. Una pasada lanzada a mano desde aquí{' '}
          <strong>no demuestra que el automatismo funcione</strong>, y es exactamente la trampa en
          la que ya caímos: la agenda se sincronizaba al pulsar, así que parecía viva, y llevaba
          meses sin correr sola.
        </p>
        <p>
          Por eso el estado de cada proceso se calcula solo con las pasadas que lanzó el cron. Las
          de mano salen marcadas en la lista de abajo.
        </p>
      </SeccionInfo>

      <SeccionInfo titulo="Cuándo se considera parado">
        <ListaInfo>
          <li>
            Cuando lleva <strong>más de tres veces su intervalo</strong> sin correr solo. No una:
            una pasada puede tardar y el contenedor puede estar reiniciándose, y un aviso que salta
            al primer minuto de retraso es un aviso que nadie lee.
          </li>
          <li>
            <strong>Sin terminar</strong> en la lista significa que arrancó y no llegó al final —el
            contenedor se reinició, o se acabó el tiempo—. Es distinto de «falló».
          </li>
        </ListaInfo>
      </SeccionInfo>

      <SeccionInfo titulo="El botón llama por el mismo camino que el cron">
        <p>
          Podría ejecutar la función directamente y sería más rápido, pero entonces probaría otra
          cosa: que el código funciona, no que el camino que usa el cron funciona. El fallo que
          motivó esta pantalla estaba justo en el camino —un puerto equivocado—, no en el código.
        </p>
      </SeccionInfo>
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Cada cuánto corre                                                   */
/* ------------------------------------------------------------------ */

/**
 * EL HORARIO DE UN PROCESO, EDITABLE AQUÍ MISMO.
 *
 * Antes vivía en el crontab del Dockerfile: para pasar de 15 a 30 minutos había
 * que editar un fichero, hacer commit y esperar un despliegue entero — y desde
 * el ERP no se veía siquiera cuál era el intervalo. Ahora el crontab despierta
 * las rutas cada minuto y el número está en la base (migración 138), así que
 * cambiarlo tiene efecto en el minuto siguiente.
 *
 * NO SE GUARDA AL TECLEAR. El campo es local hasta que se pulsa «Guardar»: con
 * un guardado automático, teclear «30» sobre un «5» pasa por «3», y ese estado
 * intermedio sería un intervalo real de tres minutos aplicado de verdad. Aquí
 * eso significa disparar barridos del catálogo de todos los clientes.
 */
function EditorHorario({
  proceso,
  guardando,
  onGuardar,
}: {
  proceso: Proceso
  guardando: boolean
  onGuardar: (cambios: { cadaMinutos?: number; activo?: boolean }) => void
}) {
  const inicial = descomponer(proceso.cadaMinutos)
  const [valor, setValor] = useState(String(inicial.valor))
  const [unidad, setUnidad] = useState<Unidad>(inicial.unidad)

  // Si el horario cambia por fuera —otra pestaña, o la recarga de cada minuto—
  // el campo tiene que seguirlo. Sin esto se quedaría enseñando lo de antes y
  // el siguiente «Guardar» revertiría el cambio de la otra pestaña.
  useEffect(() => {
    const d = descomponer(proceso.cadaMinutos)
    setValor(String(d.valor))
    setUnidad(d.unidad)
  }, [proceso.cadaMinutos])

  const minutos = aMinutos(Number(valor) || 0, unidad)
  const valido = Number.isFinite(minutos) && minutos >= 1 && minutos <= 43_200
  const cambiado = minutos !== proceso.cadaMinutos

  return (
    <div className={`mt-[8px] flex flex-wrap items-center gap-[6px] ${TIPO.s}`}>
      <span className={TEXTO.t3}>Correr cada</span>
      <input
        type="number"
        min={1}
        value={valor}
        onChange={(e) => setValor(e.target.value)}
        className={`${CAMPO.input} !h-6 !w-[64px] ${TIPO.num}`}
        aria-label={`Cada cuánto corre ${proceso.nombre}`}
      />
      <select
        value={unidad}
        onChange={(e) => setUnidad(e.target.value as Unidad)}
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
          {guardando ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
          Guardar
        </button>
      )}

      {/* El interruptor NO para el cron: la línea del crontab sigue llamando cada
          minuto y recibe un «no toca». Así un proceso apagado sigue demostrando
          que el camino funciona, y volver a encenderlo es un clic. */}
      <button
        type="button"
        disabled={guardando}
        onClick={() => onGuardar({ activo: !proceso.activo })}
        className={`${BOTON.base} ${BOTON.secundario}`}
        title={
          proceso.activo
            ? 'Deja de ejecutarse hasta que se vuelva a encender. El botón de «Lanzar ahora» sigue funcionando'
            : 'Vuelve a ejecutarse en su intervalo'
        }
      >
        {proceso.activo ? <PauseCircle className="h-3 w-3" /> : <PlayCircle className="h-3 w-3" />}
        {proceso.activo ? 'Apagar' : 'Encender'}
      </button>

      {!valido && (
        <span style={{ color: COLOR_ESTADO.rojo }}>Entre 1 minuto y 30 días</span>
      )}

      {/* Sin la migración lanzada el número que se ve es el del código y el
          botón de guardar contesta un 503. Decirlo aquí evita el «le doy y no
          pasa nada» de siempre. */}
      {proceso.horarioPorDefecto && (
        <span className={TEXTO.t4}>
          · valor del código: lanza 138_cron_config.sql para poder cambiarlo
        </span>
      )}
    </div>
  )
}
