'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { citasEntre, citasPorId } from '@/lib/agenda/consulta'
import { fusionarRangos, semanasViejas } from '@/lib/agenda/memoria'
import { releerSemanas } from '@/lib/agenda/revalidar'
import { claveDeInstante, claveDeSemana, limitesDeSemanas, lunesDeLaClave, semanasAlrededor, tramosDeSemanas } from '@/lib/agenda/semanas'
import type { AppointmentWithPeople } from '@/lib/types/appointments'
import { useAlDia } from './useAlDia'

/**
 * LAS CITAS QUE TIENE LA AGENDA EN LA MEMORIA, Y CÓMO VAN LLEGANDO.
 * ==================================================================
 * La página del servidor trae tres semanas (la que se mira y las dos de al lado). El resto llega SOLO cuando se navega hacia ellas, y siempre una semana por
 * delante: al pulsar «siguiente» la semana de después ya está pidiéndose, y casi nunca se ve esperar. Lo que se pidió una vez se queda: volver atrás es instantáneo.
 *
 * EL TIEMPO REAL SOLO MIRA LO QUE TENEMOS. Antes cada cambio en la tabla —y una sincronización con Google toca miles de filas— hacía una consulta por fila en cada
 * navegador abierto. Ahora un aviso de una cita de una semana que no está en memoria se ignora (cuando se llegue a esa semana se leerá fresca), y los avisos de las
 * que sí están se juntan 200 ms y se piden de una vez.
 *
 * Y EL TIEMPO REAL NO BASTA. Un aviso perdido no se repite, y se pierden: la pestaña que lleva horas en segundo plano, el portátil que se durmió, medio minuto sin red, el
 * canal que se reconecta. Con una pestaña de Cold Calling y otra de la Agenda abiertas a la vez, la de la Agenda enseñaba lo que había cuando se quedó dormida mientras la otra
 * ya tenía lo nuevo, y no había forma de que se enterase sin recargar. Por eso, además, SE RELEE lo que se mira (lib/agenda/revalidar.ts, lib/agenda/memoria.ts):
 *
 *   · al abrir la agenda: lo que trae la página del servidor puede venir de la caché de navegación de Next, de hasta 30 s antes;
 *   · al volver a ver la pestaña, al recuperar el foco y al volver la red, y cada 15 s mientras se mira (components/agenda/useAlDia.ts);
 *   · al volver el canal de tiempo real tras un corte;
 *   · al navegar a una semana que ya estaba en memoria pero lleva más de 15 s sin confirmarse: se enseña al momento y se relee por debajo.
 *
 * Solo se releen las semanas que se miran y ya están en memoria (una consulta de ~0,15 s para las tres): el resto se confirma cuando se llegue a ellas. Lo leído se junta con
 * lo que hay SIN repintar lo que no cambió, y una lectura que empezó antes de un cambio hecho aquí (guardar, mover, borrar, un aviso aplicado) se descarta y se repite.
 * Si las lecturas fallan dos veces seguidas la agenda lo dice (`desfasada`): mejor un aviso que una pantalla que parece al día y no lo está.
 */

const ESPERA_DE_AVISOS_MS = 200
/** Cada cuánto se relee lo que se mira mientras la pestaña está a la vista */
const RELEER_CADA_MS = 15_000
/** Una semana que se enseña desde la memoria y lleva más de esto sin confirmarse con la base se relee por debajo */
const EDAD_MAXIMA_MS = 15_000
/** Tantas lecturas seguidas fallidas y se avisa de que lo que se ve puede estar desfasado */
const FALLOS_PARA_AVISAR = 2
/** Un aviso que llega mientras otra relectura lleva menos de esto en marcha no pide otra: al abrir la pantalla llegan casi a la vez el montaje, el foco y la visibilidad */
const NO_REPETIR_SI_EMPEZO_HACE_MS = 1_000

export interface CitasDeLaAgenda {
  citas: AppointmentWithPeople[]
  /** Hay semanas pidiéndose ahora mismo */
  cargando: boolean
  /** Pide las semanas que falten de entre estas (los lunes). No hace nada con las que ya están o ya se están pidiendo */
  asegurar: (lunes: Date[]) => void
  /** Pone o sustituye una cita (la que acaba de guardar la ficha, o la que devolvió un arrastre) */
  poner: (cita: AppointmentWithPeople) => void
  quitar: (id: string) => void
  /** Cambia una cita en la memoria ya, sin esperar a la base (el arrastre se ve al instante y se deshace si el servidor dice que no) */
  modificar: (id: string, cambio: (c: AppointmentWithPeople) => AppointmentWithPeople) => void
  /** Vuelve a leer lo que se está mirando (tras sincronizar con Google) y tira el resto de la memoria. Lanza si la lectura falla */
  recargar: (lunes: Date) => Promise<void>
  /** null = al día. Si no, las últimas lecturas han fallado y lo que se ve puede estar desfasado: `desde` es cuándo se pudo leer por última vez (milisegundos) */
  desfasada: { desde: number } | null
  /** Vuelve a leer ya las semanas que se miran, sin tirar nada (el «reintentar» de cuando está desfasada). Nunca lanza */
  releer: () => Promise<void>
}

export function useCitas(inicial: AppointmentWithPeople[], semanasIniciales: string[], alFallar: (mensaje: string) => void): CitasDeLaAgenda {
  const supabase = useMemo(() => createClient(), [])
  const [porId, setPorId] = useState<ReadonlyMap<string, AppointmentWithPeople>>(() => new Map(inicial.map((c) => [c.id, c])))
  const [pidiendo, setPidiendo] = useState(0)
  const [fallos, setFallos] = useState(0)

  // Las semanas que ya están en memoria: clave -> cuándo se confirmaron con la base por última vez. Las de la página del servidor entran con 0 (se leyeron en otro momento,
  // quizá hace medio minuto: se releen en cuanto se pueda). Refs y no estado: cambian sin que nada tenga que repintarse
  const cargadas = useRef(new Map<string, number>(semanasIniciales.map((s) => [s, 0])))
  const enVuelo = useRef(new Set<string>())
  // Las que se están mirando (lo último que pidió `asegurar`): son las que se releen
  const vigiladas = useRef<Date[]>(semanasIniciales.map(lunesDeLaClave).filter((l): l is Date => l !== null))
  // Sube con cada cambio de la memoria que NO es una relectura (guardar, borrar, mover, un aviso en tiempo real aplicado): una relectura que empezó antes de él ya no vale
  const version = useRef(0)
  // Lo mismo para el tiempo real, que necesita saber qué hay sin esperar a un repintado
  const enMemoria = useRef(porId)
  enMemoria.current = porId
  const avisar = useRef(alFallar)
  avisar.current = alFallar
  // Las citas con un cambio hecho aquí que el servidor todavía no ha confirmado (el arrastre): una relectura no las toca hasta que `poner` o `quitar` cierren el cambio
  const enEdicion = useRef(new Set<string>())
  // Lecturas fallidas seguidas, y cuándo se pudo leer por última vez
  const racha = useRef(0)
  const ultimaLectura = useRef(Date.now())
  // `asegurar` se declara antes que `releer` y no debe cambiar de identidad cuando éste cambie: llega por una referencia
  const releerRef = useRef<() => Promise<void>>(async () => {})

  const citas = useMemo(() => [...porId.values()], [porId])

  const poner = useCallback((cita: AppointmentWithPeople) => {
    version.current += 1
    enEdicion.current.delete(cita.id)
    setPorId((prev) => new Map(prev).set(cita.id, cita))
  }, [])

  const quitar = useCallback((id: string) => {
    version.current += 1
    enEdicion.current.delete(id)
    setPorId((prev) => {
      if (!prev.has(id)) return prev
      const sig = new Map(prev)
      sig.delete(id)
      return sig
    })
  }, [])

  const modificar = useCallback((id: string, cambio: (c: AppointmentWithPeople) => AppointmentWithPeople) => {
    version.current += 1
    enEdicion.current.add(id)
    setPorId((prev) => {
      const actual = prev.get(id)
      return actual ? new Map(prev).set(id, cambio(actual)) : prev
    })
  }, [])

  /** Una lectura salió bien: la agenda está al día y, si estaba avisando de lo contrario, deja de hacerlo */
  const leyoBien = useCallback((ahora: number) => {
    racha.current = 0
    ultimaLectura.current = ahora
    setFallos(0)
  }, [])

  const asegurar = useCallback(
    (lunes: Date[]) => {
      vigiladas.current = lunes
      const faltan = lunes.filter((l) => {
        const clave = claveDeSemana(l)
        return !cargadas.current.has(clave) && !enVuelo.current.has(clave)
      })
      for (const tramo of tramosDeSemanas(faltan)) {
        const claves = semanasAlrededor(tramo.lunes, 0, tramo.semanas - 1).map(claveDeSemana)
        claves.forEach((c) => enVuelo.current.add(c))
        setPidiendo((n) => n + 1)
        const { desde, hasta } = limitesDeSemanas(tramo.lunes, tramo.semanas)
        void citasEntre(supabase, desde, hasta)
          .then((r) => {
            if (r.error) {
              console.error('Error cargando semanas de la agenda:', r.error)
              avisar.current('No se pudo cargar esa semana. Vuelve a pulsar para reintentarlo.')
              return
            }
            const ahora = Date.now()
            claves.forEach((c) => cargadas.current.set(c, ahora))
            setPorId((prev) => {
              const sig = new Map(prev)
              for (const c of r.citas) sig.set(c.id, c)
              return sig
            })
            leyoBien(ahora)
          })
          .finally(() => {
            claves.forEach((c) => enVuelo.current.delete(c))
            setPidiendo((n) => n - 1)
          })
      }

      // Las que ya estaban se enseñan al momento; si llevan tiempo sin confirmarse con la base (o vienen de la página del servidor), se releen por debajo
      if (semanasViejas(cargadas.current, lunes.map(claveDeSemana), Date.now(), EDAD_MAXIMA_MS).length > 0) void releerRef.current()
    },
    [supabase, leyoBien]
  )

  const recargar = useCallback(
    async (lunes: Date) => {
      const semanas = semanasAlrededor(lunes, 1, 1)
      const { desde } = limitesDeSemanas(semanas[0])
      const { hasta } = limitesDeSemanas(semanas[semanas.length - 1])
      const r = await citasEntre(supabase, desde, hasta)
      if (r.error) throw new Error('No se pudo volver a leer la agenda')
      const ahora = Date.now()
      version.current += 1
      cargadas.current = new Map(semanas.map((s) => [claveDeSemana(s), ahora]))
      vigiladas.current = semanas
      enEdicion.current.clear()
      setPorId(new Map(r.citas.map((c) => [c.id, c])))
      leyoBien(ahora)
    },
    [supabase, leyoBien]
  )

  /** Una relectura de lo que se mira. Si la memoria cambia mientras se lee, la lectura se descarta y se repite (una vez) */
  const unaVuelta = useCallback(async (): Promise<void> => {
    for (let intento = 0; intento < 2; intento++) {
      // Solo se relee lo que se mira Y está en memoria: lo que no está lo pide `asegurar`, entero
      const lunes = vigiladas.current.filter((l) => cargadas.current.has(claveDeSemana(l)))
      const r = await releerSemanas({ lunes, leer: (desde, hasta) => citasEntre(supabase, desde, hasta), version: () => version.current })
      if (r.tipo === 'nada') return
      if (r.tipo === 'error') {
        racha.current += 1
        // Sin red cada relectura falla: se anota la primera de la racha y no las siguientes
        if (racha.current === 1) console.error('No se pudo releer la agenda:', r.error)
        setFallos(racha.current)
        return
      }
      if (r.tipo === 'cambio-en-medio') continue
      const ahora = Date.now()
      r.semanas.forEach((c) => cargadas.current.set(c, ahora))
      setPorId((prev) => fusionarRangos(prev, r.rangos, r.citas, enEdicion.current))
      leyoBien(ahora)
      return
    }
  }, [supabase, leyoBien])

  // Una sola relectura a la vez: las que lleguen mientras otra está en marcha se juntan en UNA más, que se hace al terminar (con lo último)
  const enCurso = useRef<Promise<void> | null>(null)
  const otraVez = useRef(false)
  const empezoEn = useRef(0)
  const releer = useCallback((): Promise<void> => {
    if (enCurso.current) {
      if (Date.now() - empezoEn.current > NO_REPETIR_SI_EMPEZO_HACE_MS) otraVez.current = true
      return enCurso.current
    }
    const correr = async () => {
      try {
        do {
          otraVez.current = false
          empezoEn.current = Date.now()
          await unaVuelta()
        } while (otraVez.current)
      } catch (error) {
        // `releerSemanas` ya recoge los fallos de la red; esto es por si algo más revienta: una relectura de fondo no puede tumbar la pantalla
        console.error('Error inesperado releyendo la agenda:', error)
      } finally {
        enCurso.current = null
      }
    }
    enCurso.current = correr()
    return enCurso.current
  }, [unaVuelta])
  releerRef.current = releer

  // Al volver a la pestaña, al volver la red y cada 15 s mientras se mira
  useAlDia(() => void releer(), RELEER_CADA_MS)

  // Tiempo real: solo lo que tenemos en memoria, y los avisos de un mismo instante se piden juntos
  useEffect(() => {
    let pendientes = new Set<string>()
    let temporizador: ReturnType<typeof setTimeout> | null = null
    // El canal se cortó y ha vuelto: los avisos de en medio se perdieron
    let huboCorte = false

    const vaciar = async () => {
      temporizador = null
      const ids = [...pendientes]
      pendientes = new Set()
      if (ids.length === 0) return
      const r = await citasPorId(supabase, ids)
      if (r.error) return
      const llegadas = new Map(r.citas.map((c) => [c.id, c]))
      version.current += 1
      setPorId((prev) => {
        const sig = new Map(prev)
        for (const id of ids) {
          const cita = llegadas.get(id)
          // Una cita que ya no se puede leer (borrada entre medias) sale de la memoria
          if (cita) sig.set(id, cita)
          else sig.delete(id)
        }
        return sig
      })
    }

    const canal = supabase
      .channel(`appointments_${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'appointments' }, (payload) => {
        if (payload.eventType === 'DELETE') {
          const id = (payload.old as { id?: string }).id
          if (id) quitar(id)
          return
        }
        const fila = payload.new as { id: string; start_time?: string }
        // Si ahora cae en una semana que no tenemos, no se pide: se ve cuando se navegue allí. Y si estaba en memoria en otra, se quita
        const laTenemos = fila.start_time ? cargadas.current.has(claveDeInstante(fila.start_time)) : true
        if (!laTenemos) {
          if (enMemoria.current.has(fila.id)) quitar(fila.id)
          return
        }
        pendientes.add(fila.id)
        if (!temporizador) temporizador = setTimeout(() => void vaciar(), ESPERA_DE_AVISOS_MS)
      })
      .subscribe((estado) => {
        if (estado === 'SUBSCRIBED') {
          if (huboCorte) {
            huboCorte = false
            void releerRef.current()
          }
        } else {
          huboCorte = true
        }
      })

    return () => {
      if (temporizador) clearTimeout(temporizador)
      supabase.removeChannel(canal)
    }
  }, [supabase, quitar])

  const desfasada = useMemo(() => (fallos >= FALLOS_PARA_AVISAR ? { desde: ultimaLectura.current } : null), [fallos])

  return { citas, cargando: pidiendo > 0, asegurar, poner, quitar, modificar, recargar, desfasada, releer }
}
