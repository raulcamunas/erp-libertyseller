'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { format } from 'date-fns'
import { createClient } from '@/lib/supabase/client'
import { toMadrid } from '@/lib/timezone'
import { colorForAgent } from '@/lib/types/appointments'
import type { UserProfile } from '@/lib/supabase/get-user-profile'

/**
 * QUIÉN ESTÁ AGENDANDO O EDITANDO UNA CITA AHORA MISMO.
 *
 * Un canal de presencia compartido por todo el equipo, para que dos comerciales no rellenen la misma hora a la vez: se ve un recuadro punteado en el hueco donde otro
 * está creando una cita y un punto vivo en la que otro está editando. Funciona igual que antes; lo único que cambia es CÓMO SE IDENTIFICA EL DÍA.
 *
 * Antes iba `day.toISOString()`, y como esa fecha es la medianoche del lunes en la zona del NAVEGADOR (se construye con la hora de pared de España pero se serializa en
 * local), un comercial en Bogotá y un administrador en Madrid veían «el mismo día» con textos distintos y nunca se cruzaban. Ahora va el día de España, «2026-10-28», igual
 * para todos.
 */

export interface EntradaDePresencia {
  userId: string
  fullName: string | null
  email: string | null
  color: string
  mode: 'create' | 'edit'
  /** «2026-10-28», solo al crear */
  dia?: string
  hour?: number
  minute?: number
  appointmentId?: string
}

/** Qué ficha tiene abierta quien mira: una cita nueva (con su hora de inicio) o una que ya existe */
export type FichaAbierta = { modo: 'create'; inicio: Date } | { modo: 'edit'; citaId: string } | null

export function usePresencia(usuario: UserProfile, ficha: FichaAbierta): EntradaDePresencia[] {
  const supabase = useMemo(() => createClient(), [])
  const [presentes, setPresentes] = useState<EntradaDePresencia[]>([])
  const [conectado, setConectado] = useState(false)
  const canal = useRef<RealtimeChannel | null>(null)

  useEffect(() => {
    const c = supabase.channel('agenda-presence', { config: { presence: { key: usuario.id } } })
    c.on('presence', { event: 'sync' }, () => {
      const estado = c.presenceState<EntradaDePresencia>()
      setPresentes(
        Object.values(estado)
          .flat()
          .filter((p) => p.userId !== usuario.id)
      )
    }).subscribe((estado) => {
      if (estado === 'SUBSCRIBED') setConectado(true)
    })
    canal.current = c
    return () => {
      setConectado(false)
      canal.current = null
      supabase.removeChannel(c)
    }
  }, [supabase, usuario.id])

  // Se anuncia qué se está rellenando (y se deja de anunciar al cerrar la ficha)
  const modo = ficha?.modo ?? null
  const inicio = ficha?.modo === 'create' ? ficha.inicio.getTime() : null
  const citaId = ficha?.modo === 'edit' ? ficha.citaId : null
  useEffect(() => {
    const c = canal.current
    if (!c || !conectado) return
    if (!modo) {
      void c.untrack()
      return
    }
    const base = { userId: usuario.id, fullName: usuario.full_name, email: usuario.email, color: colorForAgent(usuario.id) }
    if (modo === 'create' && inicio !== null) {
      const enMadrid = toMadrid(new Date(inicio))
      void c.track({ ...base, mode: 'create', dia: format(enMadrid, 'yyyy-MM-dd'), hour: enMadrid.getHours(), minute: enMadrid.getMinutes() } satisfies EntradaDePresencia)
    } else if (modo === 'edit' && citaId) {
      void c.track({ ...base, mode: 'edit', appointmentId: citaId } satisfies EntradaDePresencia)
    }
    return () => {
      void c.untrack()
    }
  }, [conectado, modo, inicio, citaId, usuario.id, usuario.full_name, usuario.email])

  return presentes
}
