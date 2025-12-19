import { createClient } from '@/lib/supabase/server'
import { EmployeeManagement } from '@/components/tracker/EmployeeManagement'

export default async function EmployeeManagementPage() {
  const supabase = await createClient()

  // Obtener lista de empleados únicos desde los reportes
  const { data: employees } = await supabase
    .from('tracker_reports')
    .select('employee_id')
    .order('employee_id')

  const uniqueEmployees = Array.from(
    new Set(employees?.map(e => e.employee_id) || [])
  ).sort()

  return <EmployeeManagement employees={uniqueEmployees} />
}



