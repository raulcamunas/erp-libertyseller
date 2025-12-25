import { createClient } from '@/lib/supabase/server'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
import { UploadHoursComponent } from '@/components/tracker/UploadHoursComponent'

export default async function SubirHorasPage() {
  const supabase = await createClient()
  const profile = await getUserProfile()

  let employees: string[] = []

  if (profile?.role === 'admin') {
    // Si es admin, obtener todos los empleados desde reportes y perfiles
    const { data: reportsEmployees } = await supabase
      .from('tracker_reports')
      .select('employee_id')
      .order('employee_id')

    const { data: profilesEmployees } = await supabase
      .from('profiles')
      .select('full_name, email')
      .eq('role', 'employee')
      .order('full_name')

    const fromReports = Array.from(
      new Set(reportsEmployees?.map(e => e.employee_id) || [])
    )

    const fromProfiles = (profilesEmployees || [])
      .map(p => p.full_name || p.email || '')
      .filter(Boolean)

    employees = Array.from(new Set([...fromReports, ...fromProfiles])).sort()
  } else {
    // Si es empleado, solo mostrar su propio nombre
    if (profile) {
      const employeeName = profile.full_name || profile.email || ''
      if (employeeName) {
        employees = [employeeName]
      } else {
        // Si no tiene nombre, intentar obtenerlo del email o usar el ID
        const { data: { user } } = await supabase.auth.getUser()
        if (user?.email) {
          employees = [user.email]
        }
      }
    }
  }

  // Si no hay empleados, intentar obtener desde reportes como fallback
  if (employees.length === 0) {
    const { data: reportsEmployees } = await supabase
      .from('tracker_reports')
      .select('employee_id')
      .order('employee_id')

    employees = Array.from(
      new Set(reportsEmployees?.map(e => e.employee_id) || [])
    ).sort()
  }

  return <UploadHoursComponent employees={employees} initialEmployee={profile?.role === 'employee' ? (profile.full_name || profile.email || '') : undefined} />
}

