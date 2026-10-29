'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { avisoDeNoSePuede, queHacerConElLead } from '@/lib/cold-calling/abrir-lead'
import { createClient } from '@/lib/supabase/client'

/**
 * ABRIR EL LEAD QUE PIDE LA DIRECCIÓN (`/dashboard/cold-calling?lead=<id>`): el enlace de la ficha de una cita de la Agenda.
 * ==========================================================================================================================
 * Qué hacer en cada situación (estar ya en la cartera, esperar a que llegue, preguntar a la base, ir a la cartera de su dueño) lo decide `queHacerConElLead`
 * (lib/cold-calling/abrir-lead.ts, con su prueba); esto solo lo ejecuta y reevalúa cada vez que cambia algo (llega la cartera, llega la respuesta de la base).
 *
 * SE RESUELVE UNA SOLA VEZ, al montar la pantalla: la dirección se lee entonces (ColdCallingApp) y esta pantalla se queda montada mientras se cambia de aplicación, así que no
 * hay un segundo enlace que atender. Cuando se abre (o se avisa de que no se puede) se quita `?lead=` de la dirección: si no, recargar la página volvería siempre a ese lead.
 *
 * MIENTRAS HAY UN LEAD PENDIENTE la pantalla no abre por su cuenta el primero de la lista (`pendiente` se lo dice): enseñaría un instante la ficha equivocada, y la ficha
 * pide sus datos al abrirse.
 */

interface Opciones {
  /** El lead que pedía la dirección al montar, o null */
  leadInicial: string | null
  /** ¿Se han leído ya las preferencias de la pantalla? Antes de eso no se abre nada: pisarían la vista que se acaba de elegir */
  listo: boolean
  leads: ReadonlyArray<{ id: string }>
  cargando: boolean
  propietario: string
  puedeVerTodos: boolean
  /** Los ids de las personas cuya cartera se puede elegir */
  equipo: readonly string[]
  cambiarPropietario: (quien: string) => void
  abrir: (leadId: string) => void
}

function quitarLeadDeLaDireccion() {
  try {
    const url = new URL(window.location.href)
    if (!url.searchParams.has('lead')) return
    url.searchParams.delete('lead')
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
  } catch {
    // Sin acceso a la dirección: se queda como estaba
  }
}

export function useAbrirLead({ leadInicial, listo, leads, cargando, propietario, puedeVerTodos, equipo, cambiarPropietario, abrir }: Opciones): { pendiente: string | null } {
  const supabase = useMemo(() => createClient(), [])
  const [pendiente, setPendiente] = useState<string | null>(leadInicial)
  const [enLaBase, setEnLaBase] = useState<{ existe: boolean; dueno: string | null } | undefined>(undefined)
  const preguntando = useRef(false)
  const cambioHecho = useRef(false)

  const enCartera = useMemo(() => pendiente !== null && leads.some((l) => l.id === pendiente), [leads, pendiente])

  useEffect(() => {
    if (!pendiente || !listo) return
    const terminar = () => {
      setPendiente(null)
      quitarLeadDeLaDireccion()
    }
    const que = queHacerConElLead({ enCartera, cargando, enLaBase, propietario, puedeVerTodos, equipo, cambioHecho: cambioHecho.current })

    if (que.accion === 'abrir') {
      abrir(pendiente)
      terminar()
    } else if (que.accion === 'preguntar') {
      if (preguntando.current) return
      preguntando.current = true
      void supabase
        .from('cold_leads')
        .select('id, assigned_to')
        .eq('id', pendiente)
        .maybeSingle()
        .then(({ data, error }) => {
          if (error) {
            console.error('No se pudo comprobar el lead del enlace:', error)
            toast.error(avisoDeNoSePuede('sin-comprobar'))
            terminar()
            return
          }
          setEnLaBase({ existe: !!data, dueno: (data as { assigned_to: string | null } | null)?.assigned_to ?? null })
        })
    } else if (que.accion === 'cambiar-cartera') {
      cambioHecho.current = true
      cambiarPropietario(que.a)
    } else if (que.accion === 'no-se-puede') {
      toast.error(avisoDeNoSePuede(que.motivo))
      terminar()
    }
    // `esperar`: no se hace nada; el efecto vuelve a mirar cuando cambie la cartera
  }, [pendiente, listo, enCartera, cargando, enLaBase, propietario, puedeVerTodos, equipo, cambiarPropietario, abrir, supabase])

  return { pendiente }
}
