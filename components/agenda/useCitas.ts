'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { citasEntre, citasPorId } from '@/lib/agenda/consulta'
import { claveDeInstante, claveDeSemana, limitesDeSemanas, semanasAlrededor, tramosDeSemanas } from '@/lib/agenda/semanas'
import type { AppointmentWithPeople } from '@/lib/types/appointments'

/**
 * LAS CITAS QUE TIENE LA AGENDA EN LA MEMORIA, Y CÓMO VAN LLEGANDO.
 * ==================================================================
 * La página del servidor trae tres semanas (la que se mira y las dos de al lado). El resto llega SOLO cuando se navega hacia ellas, y siempre una semana por
 * delante: al pulsar «siguiente» la semana de después ya está pidiéndose, y casi nunca se ve esperar. Lo que se pidió una vez se queda: volver atrás es instantáneo.
 *
 * EL TIEMPO REAL SOLO MIRA LO QUE TENEMOS. Antes cada cambio en la tabla —y una sincronización con Google toca miles de filas— hacía una consulta por fila en cada
 * navegador abierto. Ahora un aviso de una cita de una semana que no está en memoria se ignora (cuando se llegue a esa semana se leerá fresca), y los avisos de las
 * que sí están se juntan 200 ms y se piden de una vez.
 */

const ESPERA_DE_AVISOS_MS = 200

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
}

export function useCitas(inicial: AppointmentWithPeople[], semanasIniciales: string[], alFallar: (mensaje: string) => void): CitasDeLaAgenda {
  const supabase = useMemo(() => createClient(), [])
  const [porId, setPorId] = useState<Map<string, AppointmentWithPeople>>(() => new Map(inicial.map((c) => [c.id, c])))
  const [pidiendo, setPidiendo] = useState(0)

  // Las semanas que ya están (claves) y las que se están pidiendo. Refs y no estado: cambian sin que nada tenga que repintarse
  const cargadas = useRef(new Set(semanasIniciales))
  const enVuelo = useRef(new Set<string>())
  // Lo mismo para el tiempo real, que necesita saber qué hay sin esperar a un repintado
  const enMemoria = useRef(porId)
  enMemoria.current = porId
  const avisar = useRef(alFallar)
  avisar.current = alFallar

  const citas = useMemo(() => [...porId.values()], [porId])

  const poner = useCallback((cita: AppointmentWithPeople) => {
    setPorId((prev) => new Map(prev).set(cita.id, cita))
  }, [])

  const quitar = useCallback((id: string) => {
    setPorId((prev) => {
      if (!prev.has(id)) return prev
      const sig = new Map(prev)
      sig.delete(id)
      return sig
    })
  }, [])

  const modificar = useCallback((id: string, cambio: (c: AppointmentWithPeople) => AppointmentWithPeople) => {
    setPorId((prev) => {
      const actual = prev.get(id)
      return actual ? new Map(prev).set(id, cambio(actual)) : prev
    })
  }, [])

  const asegurar = useCallback(
    (lunes: Date[]) => {
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
            claves.forEach((c) => cargadas.current.add(c))
            setPorId((prev) => {
              const sig = new Map(prev)
              for (const c of r.citas) sig.set(c.id, c)
              return sig
            })
          })
          .finally(() => {
            claves.forEach((c) => enVuelo.current.delete(c))
            setPidiendo((n) => n - 1)
          })
      }
    },
    [supabase]
  )

  const recargar = useCallback(
    async (lunes: Date) => {
      const semanas = semanasAlrededor(lunes, 1, 1)
      const { desde } = limitesDeSemanas(semanas[0])
      const { hasta } = limitesDeSemanas(semanas[semanas.length - 1])
      const r = await citasEntre(supabase, desde, hasta)
      if (r.error) throw new Error('No se pudo volver a leer la agenda')
      cargadas.current = new Set(semanas.map(claveDeSemana))
      setPorId(new Map(r.citas.map((c) => [c.id, c])))
    },
    [supabase]
  )

  // Tiempo real: solo lo que tenemos en memoria, y los avisos de un mismo instante se piden juntos
  useEffect(() => {
    let pendientes = new Set<string>()
    let temporizador: ReturnType<typeof setTimeout> | null = null

    const vaciar = async () => {
      temporizador = null
      const ids = [...pendientes]
      pendientes = new Set()
      if (ids.length === 0) return
      const r = await citasPorId(supabase, ids)
      if (r.error) return
      const llegadas = new Map(r.citas.map((c) => [c.id, c]))
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
      .subscribe()

    return () => {
      if (temporizador) clearTimeout(temporizador)
      supabase.removeChannel(canal)
    }
  }, [supabase, quitar])

  return { citas, cargando: pidiendo > 0, asegurar, poner, quitar, modificar, recargar }
}
