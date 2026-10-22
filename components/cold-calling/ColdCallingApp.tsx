'use client'

import { useEffect, useMemo, useState } from 'react'
import { puedeVerEquipoComercialEnNavegador } from '@/lib/permisos-cliente'
import { createClient } from '@/lib/supabase/client'
import type { UserProfile } from '@/lib/supabase/get-user-profile'
import type { CalendarPerson } from '@/lib/types/appointments'
import { ColdCallingBoard } from './ColdCallingBoard'
import { clavePreferencias, leerPreferencias } from './usePreferencias'

/**
 * COLD CALLING COMO APLICACIÓN QUE SE QUEDA ABIERTA.
 *
 * Antes la pintaba una página del servidor (`app/dashboard/cold-calling/page.tsx`) que, cada vez que se entraba, averiguaba los permisos,
 * traía la cartera y devolvía la pantalla entera: al ir a Correo y volver, todo se perdía —el lead abierto, el filtro, hasta donde estaba la
 * lista— y la cartera se pedía otra vez. Ahora esta pantalla la monta una sola vez `AppsPersistentes` (en el layout, que no se recarga
 * al navegar) la primera vez que se entra, y desde entonces se QUEDA MONTADA y solo se oculta al cambiar de aplicación. Volver es instantáneo
 * y está exactamente como se dejó.
 *
 * LOS PERMISOS Y EL EQUIPO SE AVERIGUAN AQUÍ, desde el navegador y con la sesión de quien mira: es el mismo criterio que usaba el servidor
 * (lib/permisos-cliente.ts), y NO es el filtro de verdad —quien recorta son las políticas RLS de cold_leads y cold_lead_notes (migración
 * 212)—: solo decide si se enseña el selector de comercial. Un administrador o un partner lo saben ya por su rol, sin esperar a ninguna
 * consulta; el resto empieza sin selector y lo gana si la consulta dice que sí.
 *
 * QUÉ CARTERA SE PIDE AL MONTAR: la que quien supervisa miraba la última vez (`ownerFilter`, en las preferencias de la pantalla). Se lee
 * antes de la primera petición para no pedir la de todos y, nada más llegar, tirarla para pedir la de una persona.
 */

interface Props {
  perfil: UserProfile
  /** ¿Es la aplicación que se está viendo? (la otra está oculta pero montada) */
  activa: boolean
}

const supervisaPorRol = (perfil: UserProfile) => perfil.role === 'admin' || perfil.role === 'partner'

export function ColdCallingApp({ perfil, activa }: Props) {
  const supabase = useMemo(() => createClient(), [])
  const [puedeVerTodos, setPuedeVerTodos] = useState(() => supervisaPorRol(perfil))
  const [team, setTeam] = useState<CalendarPerson[]>([])

  // Una sola vez: la cartera que se pide al montar. Quien no supervisa no elige: la RLS ya le da solo la suya
  const propietarioInicial = useMemo(() => {
    if (!supervisaPorRol(perfil)) return 'all'
    try {
      return leerPreferencias(window.localStorage.getItem(clavePreferencias(perfil.id)), true).propietario ?? 'all'
    } catch {
      return 'all'
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Si no se supervisa por rol, se comprueba el permiso suelto del equipo comercial (el manager de captación)
  useEffect(() => {
    if (supervisaPorRol(perfil)) return
    let vivo = true
    void puedeVerEquipoComercialEnNavegador(supabase, perfil.role, perfil.id).then((v) => {
      if (vivo) setPuedeVerTodos(v)
    })
    return () => {
      vivo = false
    }
  }, [supabase, perfil])

  // La lista de comerciales, para el selector y para decir quién es quién en el historial
  useEffect(() => {
    if (!puedeVerTodos) return
    let vivo = true
    void supabase
      .from('profiles')
      .select('id, full_name, email, role, calendar_color')
      .eq('is_comercial', true)
      .order('full_name', { ascending: true })
      .then(({ data }) => {
        if (vivo) setTeam((data as CalendarPerson[] | null) ?? [])
      })
    return () => {
      vivo = false
    }
  }, [supabase, puedeVerTodos])

  return (
    <div className="flex h-[calc(100dvh-8rem)] min-w-0 flex-col lg:h-[calc(100vh-4rem)]">
      <ColdCallingBoard propietarioInicial={propietarioInicial} team={team} currentUser={perfil} puedeVerTodos={puedeVerTodos} activa={activa} />
    </div>
  )
}
