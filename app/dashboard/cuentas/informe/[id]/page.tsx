import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
import { entraEnApp } from '@/lib/cuentas/acceso'
import { EditorDeInforme } from '@/components/cuentas/EditorDeInforme'

/** /dashboard/cuentas/informe/<id> — revisar el borrador de un informe al cliente, editar la lectura, añadir lo hecho fuera del ERP y enviarlo */
export const dynamic = 'force-dynamic'

export default async function PaginaEditorDeInforme({ params }: { params: { id: string } }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')
  const perfil = await getUserProfile()
  if (!perfil) redirect('/auth/login')
  if (!(await entraEnApp(supabase, user.id, perfil.role, perfil.puesto, 'cuentas'))) redirect('/dashboard')
  return <EditorDeInforme id={params.id} />
}
