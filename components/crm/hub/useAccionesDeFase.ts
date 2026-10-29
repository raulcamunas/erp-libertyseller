'use client'

import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { avisoDeAccion, destinoDe, esAccionDeDescarte, notaDeDescarte, type AccionDeFase } from '@/lib/crm/pestanas'
import { esTablaInexistente, FALTA_MIGRACION_258 } from '@/lib/crm/migracion'
import { CRM_STAGE_LABELS, type CrmClientWithDetails } from '@/lib/types/crm'

/**
 * LO QUE SE HACE CON UN LEAD DESDE LA LISTA: SEGUIR, DESCARTAR, AVANZAR, CERRAR, PERDER, REABRIR — y, para dirección, el resultado de la cita.
 * =============================================================================================================================================
 * La ficha tiene su propio `patch` (FichaHub), pero las pestañas mueven leads sin abrirlos. Esto es el mismo gesto: un UPDATE de `crm_clients.stage` con la sesión de quien lo hace
 * (la RLS de las migraciones 212 y 261 decide si puede), con el aviso «Deshacer» de siempre. La base anota el cambio en el historial de fases (disparador de la 258) y, si pasa a
 * «Cliente cerrado», sella la fecha de cierre sola (disparador de la 082): aquí no hay que hacer ni una ni otra cosa.
 *
 * DESCARTAR lleva un motivo opcional que se apunta como una toma de contacto de tipo nota («Descartado: …»), así queda en la Actividad del cliente sin columnas nuevas. Si se deshace,
 * esa nota se corrige a «Descarte deshecho: …» (los managers y los autónomos pueden corregir las suyas, pero no borrar: la RLS no deja borrar a nadie más que a dirección).
 */

interface Opciones {
  currentUserId: string
  /** Avisa a la pantalla de que una ficha ha cambiado (para repintar la lista y el historial) */
  onPatched: (id: string, patch: Partial<CrmClientWithDetails>) => void
  /** Avisa de que el motivo de descartar de un cliente ha cambiado (null = ya no está descartado) */
  onMotivo: (id: string, nota: string | null) => void
}

export function useAccionesDeFase({ currentUserId, onPatched, onMotivo }: Opciones) {
  const supabase = createClient()
  /** Los clientes con un cambio en vuelo: sus botones se quedan quietos hasta que acabe */
  const [ocupados, setOcupados] = useState<ReadonlySet<string>>(new Set())

  const marcar = useCallback((id: string, ocupado: boolean) => {
    setOcupados((prev) => {
      const n = new Set(prev)
      if (ocupado) n.add(id)
      else n.delete(id)
      return n
    })
  }, [])

  const guardarFase = useCallback(
    async (id: string, stage: CrmClientWithDetails['stage']): Promise<boolean> => {
      // `.select('id')` para saber CUÁNTAS filas se han tocado: una política de RLS que no deja actualizar no da error, deja 0 filas, y sin esto la pantalla creería que se movió
      const { data, error } = await supabase.from('crm_clients').update({ stage }).eq('id', id).select('id')
      if (error) {
        console.error('Error moviendo el cliente de fase:', error)
        toast.error(esTablaInexistente(error) ? FALTA_MIGRACION_258 : 'No se pudo guardar el cambio')
        return false
      }
      if (!data || data.length === 0) {
        toast.error('No se ha guardado: tu usuario no puede mover este cliente (si es un manager, falta lanzar la migración 261 en Supabase).')
        return false
      }
      onPatched(id, { stage })
      return true
    },
    [supabase, onPatched]
  )

  const mover = useCallback(
    async (c: CrmClientWithDetails, accion: AccionDeFase, descarte?: { motivo: string | null; detalle?: string | null }): Promise<boolean> => {
      const destino = destinoDe(accion, c.stage)
      if (!destino || ocupados.has(c.id)) return false
      marcar(c.id, true)
      try {
        const anterior = c.stage
        if (!(await guardarFase(c.id, destino))) return false

        // El motivo de descartar, como una nota en la Actividad del cliente (si falla, el cambio de fase ya está hecho: se avisa y se sigue)
        let notaId: string | null = null
        const cuerpo = esAccionDeDescarte(accion) ? notaDeDescarte(descarte?.motivo, descarte?.detalle) : null
        if (cuerpo) {
          const { data, error } = await supabase.from('crm_interactions').insert({ client_id: c.id, author_id: currentUserId, kind: 'nota', body: cuerpo }).select('id').single()
          if (error) {
            console.error('No se pudo apuntar el motivo del descarte:', error)
            toast.warning('El lead se ha descartado, pero no se ha podido apuntar el motivo.')
          } else {
            notaId = (data as { id: string } | null)?.id ?? null
            onMotivo(c.id, cuerpo)
          }
        }

        toast(avisoDeAccion(accion, destino, CRM_STAGE_LABELS[destino]), {
          action: {
            label: 'Deshacer',
            onClick: () => {
              void (async () => {
                if (!(await guardarFase(c.id, anterior))) return
                if (cuerpo) {
                  onMotivo(c.id, null)
                  if (notaId) await supabase.from('crm_interactions').update({ body: `Descarte deshecho: ${cuerpo.replace(/^Descartado:\s*/, '')}`.slice(0, 500) }).eq('id', notaId)
                }
              })()
            },
          },
        })
        return true
      } finally {
        marcar(c.id, false)
      }
    },
    [ocupados, marcar, guardarFase, supabase, currentUserId, onMotivo]
  )

  /**
   * Cualificar, no cualificar o marcar «no asistió»: SOLO DIRECCIÓN (genera la comisión del comercial que agendó la cita). Va por la ruta de la agenda y no por un UPDATE directo, igual
   * que en la ficha: las citas se sincronizan con Google Calendar y esa ruta es la que lleva el `updated_source` y el `sync_status`.
   */
  const cambiarResultadoDeCita = useCallback(
    async (c: CrmClientWithDetails, estado: 'qualified' | 'not_qualified' | 'no_show'): Promise<void> => {
      const appt = c.appointment
      if (!appt || ocupados.has(c.id) || appt.status === estado) return
      marcar(c.id, true)
      try {
        const res = await fetch(`/api/appointments/${appt.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: estado }) })
        if (!res.ok) {
          toast.error('No se pudo cambiar el estado de la cita')
          return
        }
        onPatched(c.id, { appointment: { ...appt, status: estado } })
        toast.success(estado === 'qualified' ? 'Cita cualificada' : estado === 'no_show' ? 'Cita marcada como «no asistió»' : 'Cita marcada como no cualificada')
      } finally {
        marcar(c.id, false)
      }
    },
    [ocupados, marcar, onPatched]
  )

  return { mover, cambiarResultadoDeCita, ocupados }
}
