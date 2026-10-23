import { redirect } from 'next/navigation'
import { PanelActividad } from '@/components/actividad/PanelActividad'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
import { createClient } from '@/lib/supabase/server'

/**
 * ACTIVIDAD DEL EQUIPO.
 *
 * Cuándo entra cada empleado al ERP, qué pantallas pisa, qué botones pulsa y cuánto rato está activo, con hora y minuto.
 * Lo ve un administrador y quien tenga la casilla «Actividad del equipo» ('actividad') en Gestión de Usuarios; los empleados no
 * ven ni esta pantalla ni los datos.
 *
 * ESTA PÁGINA SOLO DECIDE QUIÉN LA ABRE. Quien manda de verdad es requireAppAccess('actividad') en las dos rutas que la
 * alimentan (/api/actividad/equipo y /persona), porque la tabla actividad_registro está cerrada al navegador (migración 240).
 *
 * LAS HORAS SE ENSEÑAN EN LA ZONA QUE ELIJA QUIEN MIRA (por defecto, la de su navegador), y el día es de medianoche a
 * medianoche en esa zona: se calcula en el navegador (lib/actividad/dia.ts).
 */
export const dynamic = 'force-dynamic'

export default async function ActividadPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const profile = await getUserProfile()
  if (!profile) redirect('/auth/login')

  if (profile.role !== 'admin') {
    const { data: permiso } = await supabase.from('user_app_permissions').select('can_access').eq('user_id', user.id).eq('app_id', 'actividad').maybeSingle()
    if (!permiso?.can_access) redirect('/dashboard')
  }

  return (
    <div className="space-y-3 pb-10">
      <div>
        <h1 className="mb-0.5 text-[22px] font-semibold leading-tight tracking-[-0.012em] text-[var(--ls-t1)]">Actividad del equipo</h1>
        <p className="text-[13px] text-[var(--ls-t3)]">
          Cuándo entra cada persona al ERP, qué pantallas pisa, qué botones pulsa y cuánto rato está activa. Solo lo ve quien administra o tiene este permiso.
        </p>
      </div>
      <PanelActividad />
    </div>
  )
}
