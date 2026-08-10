'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Loader2, Play, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import {
  BOTON,
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
import { Aviso, Cargando, hace } from '@/components/plataforma/comun'
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

interface Proceso {
  id: string
  nombre: string
  ruta: string
  cadaMinutos: number
  que: string
  ultima: Ejecucion | null
  ultimaAutomatica: Ejecucion | null
}

export function PanelSistema() {
  const [procesos, setProcesos] = useState<Proceso[] | null>(null)
  const [ejecuciones, setEjecuciones] = useState<Ejecucion[]>([])
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)
  const [lanzando, setLanzando] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    try {
      const res = await fetch('/api/sistema/cron')
      const datos = await res.json()
      if (!res.ok) throw new Error(datos?.error ?? 'No se ha podido leer el estado')
      setProcesos(datos.procesos)
      setEjecuciones(datos.ejecuciones ?? [])
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
                    <span className={`${TIPO.s} ${TEXTO.t4}`}>· cada {p.cadaMinutos} min</span>
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
                </div>

                <button
                  type="button"
                  onClick={() => void lanzar(p.id, p.nombre)}
                  disabled={lanzando !== null}
                  className={`${BOTON.secundario} shrink-0`}
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

      <div className="mt-[14px] flex items-center justify-between">
        <span className={`${TITULO.seccion} ${TEXTO.t1}`}>Últimas pasadas</span>
        <button type="button" onClick={() => void cargar()} className={BOTON.secundario}>
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
