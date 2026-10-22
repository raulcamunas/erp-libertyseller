'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { COOKIE_DE_PROPIETARIO, cargarCartera } from '@/lib/cold-calling/cargar'
import { createClient } from '@/lib/supabase/client'
import type { ColdLead } from '@/lib/types/cold-leads'

/**
 * LA CARTERA QUE SE ESTÁ MIRANDO: los leads de UNA persona (o, para quien supervisa, los de todos), al día por el canal en tiempo real.
 *
 * LA CARTERA ES DE UNA PERSONA. Quien supervisa elige de quién, y esta cartera se pide al elegirlo: antes la página bajaba los leads de TODOS
 * los comerciales (unas 6.000 filas, una petición detrás de otra) para después quedarse con los de uno. La elección se recuerda en una
 * cookie para que la próxima vez el servidor ya traiga la buena.
 *
 * LO DE TIEMPO REAL llega por un canal de Supabase y se junta en un buzón que se vacía cada 250 ms: cuando la lectura de Rinkel apunta
 * cincuenta llamadas seguidas (migración 237) llegan cincuenta cambios de lead de golpe, y aplicar cada uno por separado sería volver a
 * calcular filtros y orden de miles de leads cincuenta veces.
 */

const CADA_MS = 250

export function guardarPropietario(id: string) {
  try {
    document.cookie = `${COOKIE_DE_PROPIETARIO}=${encodeURIComponent(id)}; path=/dashboard/cold-calling; max-age=31536000; SameSite=Lax`
  } catch {
    // Sin cookies no pasa nada: la próxima vez se empieza en «todos»
  }
}

interface Opciones {
  inicial: ColdLead[]
  propietarioInicial: string
  incompletaInicial: boolean
  userId: string
}

export function useCartera({ inicial, propietarioInicial, incompletaInicial, userId }: Opciones) {
  const supabase = useMemo(() => createClient(), [])
  const [leads, setLeads] = useState<ColdLead[]>(inicial)
  const [propietario, setPropietario] = useState(propietarioInicial)
  const [cargando, setCargando] = useState(false)
  const [incompleta, setIncompleta] = useState(incompletaInicial)
  const pedido = useRef(0)

  const cargar = useCallback(
    async (quien: string) => {
      const numero = ++pedido.current
      setCargando(true)
      const r = await cargarCartera(supabase, { propietario: quien === 'all' ? undefined : quien })
      // Si mientras tanto se pidió otra, esta ya no vale
      if (numero !== pedido.current) return
      setLeads(r.leads)
      setIncompleta(r.incompleta)
      setCargando(false)
    },
    [supabase]
  )

  const cambiarPropietario = useCallback(
    (quien: string) => {
      if (quien === propietario) return
      setPropietario(quien)
      guardarPropietario(quien)
      // Se vacía la lista en vez de dejar la de otra persona mientras llega la nueva: no se debe trabajar un lead creyendo que es de otro
      setLeads([])
      void cargar(quien)
    },
    [propietario, cargar]
  )

  /** Volver a pedir la cartera que se está mirando (cuando llegó incompleta) */
  const recargar = useCallback(() => cargar(propietario), [cargar, propietario])

  /** Un cambio hecho aquí: se aplica al momento, sin esperar a que vuelva por el canal */
  const parchear = useCallback((id: string, campos: Partial<ColdLead>) => {
    setLeads((previos) => previos.map((l) => (l.id === id ? { ...l, ...campos } : l)))
  }, [])

  useEffect(() => {
    // Lo que llega por el canal: id -> la fila nueva, o null si se borró o ya no es de esta cartera
    const buzon = new Map<string, ColdLead | null>()
    let temporizador: ReturnType<typeof setTimeout> | null = null

    const vaciar = () => {
      temporizador = null
      if (buzon.size === 0) return
      const cambios = new Map(buzon)
      buzon.clear()
      setLeads((previos) => {
        const resultado: ColdLead[] = []
        for (const l of previos) {
          if (!cambios.has(l.id)) resultado.push(l)
          else {
            const nueva = cambios.get(l.id)
            if (nueva) resultado.push({ ...l, ...nueva })
            cambios.delete(l.id)
          }
        }
        // Lo que no estaba y es de esta cartera, es un lead nuevo
        for (const nueva of cambios.values()) if (nueva) resultado.push(nueva)
        return resultado
      })
    }

    const canal = supabase
      .channel(`cold_leads_${userId}_${propietario}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'cold_leads', ...(propietario !== 'all' ? { filter: `assigned_to=eq.${propietario}` } : {}) },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            const viejo = payload.old as { id?: string }
            if (viejo?.id) buzon.set(viejo.id, null)
          } else {
            const fila = payload.new as ColdLead
            // Un lead reasignado a otra persona deja de ser de esta cartera
            buzon.set(fila.id, propietario !== 'all' && fila.assigned_to !== propietario ? null : fila)
          }
          if (!temporizador) temporizador = setTimeout(vaciar, CADA_MS)
        }
      )
      .subscribe()

    return () => {
      if (temporizador) clearTimeout(temporizador)
      supabase.removeChannel(canal)
    }
  }, [supabase, userId, propietario])

  return { leads, propietario, cargando, incompleta, cambiarPropietario, recargar, parchear }
}
