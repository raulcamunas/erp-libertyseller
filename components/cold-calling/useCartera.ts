'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { cargarCartera } from '@/lib/cold-calling/cargar'
import { createClient } from '@/lib/supabase/client'
import type { ColdLead } from '@/lib/types/cold-leads'

/**
 * LA CARTERA QUE SE ESTÁ MIRANDO: los leads de UNA persona (o, para quien supervisa, los de todos), al día por el canal en tiempo real.
 *
 * LA CARTERA SE PIDE DESDE EL NAVEGADOR, UNA VEZ POR SESIÓN. Cold Calling se queda montada mientras se cambia a otra aplicación y se
 * vuelve (components/layout/AppsPersistentes.tsx), así que ya no la trae una página del servidor cada vez que se entra: la primera vez se
 * pide aquí, con el esqueleto a la vista, y las siguientes la pantalla ya está como se dejó. Mientras está oculta el canal en tiempo real
 * la sigue poniendo al día; si estuvo mucho rato fuera de la vista, al volver se pide otra vez EN SILENCIO (`refrescar`), sin vaciar la lista.
 *
 * LA CARTERA ES DE UNA PERSONA. Quien supervisa elige de quién, y esta cartera se pide al elegirlo: antes se bajaban los leads de TODOS los
 * comerciales (unas 6.000 filas, una petición detrás de otra) para después quedarse con los de uno. La elección se recuerda en las
 * preferencias de la pantalla (usePreferencias), que es de donde sale `propietarioInicial`.
 *
 * LO DE TIEMPO REAL llega por un canal de Supabase y se junta en un buzón que se vacía cada 250 ms: cuando la lectura de Rinkel apunta
 * cincuenta llamadas seguidas (migración 237) llegan cincuenta cambios de lead de golpe, y aplicar cada uno por separado sería volver a
 * calcular filtros y orden de miles de leads cincuenta veces.
 */

const CADA_MS = 250

interface Opciones {
  /** 'all' o el id de la persona cuya cartera se pide al montar */
  propietarioInicial: string
  userId: string
}

export function useCartera({ propietarioInicial, userId }: Opciones) {
  const supabase = useMemo(() => createClient(), [])
  const [leads, setLeads] = useState<ColdLead[]>([])
  const [propietario, setPropietario] = useState(propietarioInicial)
  // Empieza cargando: no hay nada que enseñar hasta que llegue el primer tramo
  const [cargando, setCargando] = useState(true)
  const [incompleta, setIncompleta] = useState(false)
  const pedido = useRef(0)
  /** Cuándo llegó la última cartera completa: sirve para saber si, al volver a la pantalla, hay que pedirla otra vez */
  const cargadaEn = useRef(0)

  const cargar = useCallback(
    async (quien: string, silenciosa = false) => {
      const numero = ++pedido.current
      if (!silenciosa) setCargando(true)
      const r = await cargarCartera(supabase, { propietario: quien === 'all' ? undefined : quien })
      // Si mientras tanto se pidió otra, esta ya no vale
      if (numero !== pedido.current) return
      // Una relectura en silencio que falla NO pisa lo que ya había con una cartera vacía: se deja como estaba
      if (silenciosa && r.leads.length === 0 && r.incompleta) return
      setLeads(r.leads)
      setIncompleta(r.incompleta)
      setCargando(false)
      cargadaEn.current = Date.now()
    },
    [supabase]
  )

  // La primera carga, al montar. En desarrollo React monta dos veces: la primera petición queda superada por la segunda (`pedido`)
  useEffect(() => {
    void cargar(propietarioInicial)
    // Solo al montar: cambiar de persona es cosa de `cambiarPropietario`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const cambiarPropietario = useCallback(
    (quien: string) => {
      if (quien === propietario) return
      setPropietario(quien)
      // Se vacía la lista en vez de dejar la de otra persona mientras llega la nueva: no se debe trabajar un lead creyendo que es de otro
      setLeads([])
      void cargar(quien)
    },
    [propietario, cargar]
  )

  /** Volver a pedir la cartera que se está mirando (cuando llegó incompleta) */
  const recargar = useCallback(() => cargar(propietario), [cargar, propietario])

  /** Pedirla otra vez sin que se note: la lista sigue ahí mientras llega y se sustituye de golpe */
  const refrescar = useCallback(() => cargar(propietario, true), [cargar, propietario])

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

  return { leads, propietario, cargando, incompleta, cargadaEn, cambiarPropietario, recargar, refrescar, parchear }
}
