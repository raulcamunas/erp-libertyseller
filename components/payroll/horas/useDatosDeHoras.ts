'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { fetchAll } from '@/lib/supabase/paginacion'
import { ESTADOS_QUE_COBRAN, type ManualAppointment, type PayrollRate, type WorkHourEntry } from '@/lib/types/payroll'
import { horasValidas } from '@/lib/payroll/horas'
import type { QualifiedAppointment } from './tipos'

/** Mete o sustituye una fila por id */
function ponerFila<T extends { id: string }>(prev: T[], fila: T): T[] {
  return prev.some((x) => x.id === fila.id) ? prev.map((x) => (x.id === fila.id ? fila : x)) : [...prev, fila]
}

/**
 * LOS DATOS DE «MIS HORAS» Y LO QUE LOS CAMBIA.
 *
 * El estado que antes vivía suelto en HoursTracker: horas, tarifas, citas que cobran y citas manuales, el tiempo real
 * y las escrituras (guardar un día, alta y baja de citas manuales). Las escrituras son las mismas de siempre; lo único
 * que cambia es el tiempo real de las citas, ver abajo.
 */
export function useDatosDeHoras({
  initialHours,
  initialRates,
  qualifiedAppointments,
  initialManual,
  currentUserId,
  isAdmin,
}: {
  initialHours: WorkHourEntry[]
  initialRates: PayrollRate[]
  qualifiedAppointments: QualifiedAppointment[]
  initialManual: ManualAppointment[]
  currentUserId: string
  isAdmin: boolean
}) {
  const supabase = useMemo(() => createClient(), [])
  const [hours, setHours] = useState<WorkHourEntry[]>(initialHours)
  const [rates, setRates] = useState<PayrollRate[]>(initialRates)
  const [appointments, setAppointments] = useState(qualifiedAppointments)
  const [manual, setManual] = useState<ManualAppointment[]>(initialManual)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    /**
     * LAS CITAS EN TIEMPO REAL, CON FILTRO Y SIN PRISAS.
     *
     * Antes cualquier cambio en CUALQUIER cita de la Agenda (miles de filas, mucho movimiento) hacía que cada pestaña
     * abierta de Mis Horas releyera todas las citas que cobran, al instante. Es carga sobre una base pequeña que ya se
     * ha caído. Además la relectura no llevaba el filtro por comercial que sí pone el servidor, y un comercial acababa
     * con las citas de todo el equipo en memoria.
     *
     *   · Quien no es admin solo escucha SUS citas (filtro del canal) y relee solo las suyas, como el servidor.
     *   · Los cambios se juntan: se relee 2 s después del último, no una vez por cambio.
     */
    let espera: ReturnType<typeof setTimeout> | null = null
    const releerCitas = () => {
      if (espera) clearTimeout(espera)
      espera = setTimeout(async () => {
        try {
          // PAGINADA, igual que la carga inicial: PostgREST corta a 1000 filas SIN dar error.
          const filas = await fetchAll<QualifiedAppointment>((desde, hasta) => {
            const q = supabase
              .from('appointments')
              .select('id, comercial_id, status, start_time, lead_name, lead_company')
              .in('status', [...ESTADOS_QUE_COBRAN])
              .eq('is_external', false)
            return (isAdmin ? q : q.eq('comercial_id', currentUserId))
              // Orden por columna única: paginar sin él repite unas filas y se salta otras.
              .order('id', { ascending: true })
              .range(desde, hasta)
          })
          setAppointments(filas)
        } catch (error) {
          // Si falla, la lista se queda como estaba (igual que antes).
          console.error('No se pudieron releer las citas cualificadas:', error)
        }
      }, 2000)
    }

    const channel = supabase
      .channel(`payroll_${currentUserId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'work_hours' }, (payload) => {
        if (payload.eventType === 'DELETE') {
          const old = payload.old as { id: string }
          setHours((prev) => prev.filter((h) => h.id !== old.id))
          return
        }
        setHours((prev) => ponerFila(prev, payload.new as WorkHourEntry))
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payroll_rates' }, (payload) => {
        if (payload.eventType === 'DELETE') {
          const old = payload.old as { id: string }
          setRates((prev) => prev.filter((r) => r.id !== old.id))
          return
        }
        setRates((prev) => ponerFila(prev, payload.new as PayrollRate))
      })
      .on(
        'postgres_changes',
        isAdmin
          ? { event: '*', schema: 'public', table: 'appointments' }
          : { event: '*', schema: 'public', table: 'appointments', filter: `comercial_id=eq.${currentUserId}` },
        releerCitas,
      )
      .subscribe()

    return () => {
      if (espera) clearTimeout(espera)
      supabase.removeChannel(channel)
    }
  }, [supabase, currentUserId, isAdmin])

  /**
   * Guarda (o borra) las horas de un día de una persona. Devuelve true si ha ido bien.
   *
   * `null` o 0 = no ha trabajado ese día: se borra la fila en vez de dejar un 0 suelto. Un valor que no es un número de
   * 0 a 24 (un NaN de «7,5» con coma, por ejemplo) NO borra nada: avisa y vuelve. `nota` es opcional; si no se pasa, la
   * que hubiera se conserva (el upsert solo toca las columnas que se le dan).
   */
  const saveDay = useCallback(
    async (userId: string, key: string, value: number | null, nota?: string | null): Promise<boolean> => {
      if (!horasValidas(value)) {
        toast.error('Ese número de horas no es válido: no se ha guardado nada')
        return false
      }
      setSaving(true)
      try {
        const existing = hours.find((h) => h.user_id === userId && h.work_date === key)
        if (value === null || value === 0) {
          if (existing) {
            const { error } = await supabase.from('work_hours').delete().eq('id', existing.id)
            if (error) throw error
            setHours((prev) => prev.filter((h) => h.id !== existing.id))
          }
          return true
        }
        const fila: { user_id: string; work_date: string; hours: number; note?: string | null } = { user_id: userId, work_date: key, hours: value }
        if (nota !== undefined) fila.note = nota && nota.trim() ? nota.trim() : null
        const { data, error } = await supabase.from('work_hours').upsert(fila, { onConflict: 'user_id,work_date' }).select('*').single()
        if (error) throw error
        setHours((prev) => ponerFila(prev, data as WorkHourEntry))
        return true
      } catch (err) {
        console.error('Error guardando horas:', err)
        toast.error('No se pudieron guardar las horas')
        return false
      } finally {
        setSaving(false)
      }
    },
    [supabase, hours],
  )

  /** Suma una cita que no pasó por la agenda a una persona. `importe` null = la tarifa del mes de su fecha. */
  const addManual = useCallback(
    async (datos: { userId: string; nombre: string; fecha: string; importe: number | null }): Promise<boolean> => {
      setSaving(true)
      try {
        const { data, error } = await supabase
          .from('payroll_manual_appointments')
          .insert({
            user_id: datos.userId,
            lead_name: datos.nombre,
            appointment_date: datos.fecha,
            commission: datos.importe,
            created_by: currentUserId,
          })
          .select('*')
          .single()
        if (error) throw error
        setManual((prev) => [...prev, data as ManualAppointment])
        toast.success('Cita añadida')
        return true
      } catch (err) {
        console.error('Error añadiendo cita manual:', err)
        toast.error('No se pudo añadir la cita')
        return false
      } finally {
        setSaving(false)
      }
    },
    [supabase, currentUserId],
  )

  /**
   * Le quita a una cita manual su importe escrito a mano para que pase a cobrar la tarifa del mes de su fecha. Poner
   * `commission` a null es lo que hace que el motor la resuelva por fecha (ver cost.ts).
   */
  const soltarImporteFijo = useCallback(
    async (id: string) => {
      try {
        const { data, error } = await supabase.from('payroll_manual_appointments').update({ commission: null }).eq('id', id).select('*').single()
        if (error) throw error
        setManual((prev) => prev.map((m) => (m.id === id ? (data as ManualAppointment) : m)))
        toast.success('Ahora cobra la tarifa de su mes')
      } catch (err) {
        console.error('Error soltando el importe fijo:', err)
        toast.error('No se ha podido cambiar')
      }
    },
    [supabase],
  )

  const removeManual = useCallback(
    async (id: string) => {
      try {
        const { error } = await supabase.from('payroll_manual_appointments').delete().eq('id', id)
        if (error) throw error
        setManual((prev) => prev.filter((m) => m.id !== id))
        toast.success('Cita quitada')
      } catch (err) {
        console.error('Error quitando cita manual:', err)
        toast.error('No se pudo quitar')
        throw err
      }
    },
    [supabase],
  )

  const tarifaGuardada = useCallback((r: PayrollRate) => setRates((prev) => ponerFila(prev, r)), [])
  const tarifaQuitada = useCallback((id: string) => setRates((prev) => prev.filter((r) => r.id !== id)), [])

  return { hours, rates, appointments, manual, saving, saveDay, addManual, soltarImporteFijo, removeManual, tarifaGuardada, tarifaQuitada }
}
