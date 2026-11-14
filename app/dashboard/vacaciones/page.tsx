import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
import { redirect } from 'next/navigation'
import { PantallaVacaciones } from '@/components/vacaciones/PantallaVacaciones'
import type { DatosDePantalla } from '@/components/vacaciones/modelo'
import { loadMyVacations, loadVacationsData } from '@/lib/employees/vacations'
import { rangoDelAnio } from '@/lib/vacations/calendario'
import { cargarEquipo } from '@/lib/vacations/servidor'

/**
 * VACACIONES — LA PANTALLA ÚNICA, para el empleado y para el admin (14 nov 2026).
 *
 * Antes había dos sitios: «Mis vacaciones» para cada uno y un modal dentro de Control empleados (la pantalla de sueldos)
 * para aprobar. Ahora todo pasa aquí:
 *   · cualquiera con el permiso de la app `vacaciones` ve el calendario de TODA la empresa (quién está fuera, aprobadas y
 *     pendientes), sin motivos ni saldos ajenos;
 *   · el empleado ve su saldo y sus solicitudes y pide días;
 *   · el admin, además, la bandeja de pendientes, todas las solicitudes y los saldos y ajustes del equipo.
 *
 * Sigue sin llegar NI UN DATO SALARIAL: lo que sale de employees es `VacationEmployee` (sin sueldo) y, para los
 * compañeros, solo nombre, color, fechas y estado (lib/vacations/servidor.ts cargarEquipo).
 * El modal de Control empleados se queda como estaba, por si alguien lo usa.
 */

export const dynamic = 'force-dynamic'

export default async function VacacionesPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const profile = await getUserProfile()
  if (!profile) redirect('/auth/login')

  const esAdmin = profile.role === 'admin'
  const service = createServiceClient()

  let inicial: DatosDePantalla
  if (esAdmin) {
    const datos = await loadVacationsData()
    const anio = Number(datos.today.slice(0, 4))
    const { desde, hasta } = rangoDelAnio(anio)
    const equipo = datos.missingTables ? { ausencias: [], personas: [], maxALaVez: 1 } : await cargarEquipo(service, desde, hasta)
    inicial = { esAdmin, userId: user.id, yo: datos.employees.find((e) => e.user_id === user.id) ?? null, saldo: null, datos, anio, equipo }
  } else {
    const mios = await loadMyVacations(user.id)
    const anio = Number(mios.today.slice(0, 4))
    const { desde, hasta } = rangoDelAnio(anio)
    const equipo = mios.missingTables ? { ausencias: [], personas: [], maxALaVez: 1 } : await cargarEquipo(service, desde, hasta)
    const { employee, balance, ...datos } = mios
    inicial = { esAdmin, userId: user.id, yo: employee, saldo: balance, datos, anio, equipo }
  }

  return <PantallaVacaciones inicial={inicial} />
}
