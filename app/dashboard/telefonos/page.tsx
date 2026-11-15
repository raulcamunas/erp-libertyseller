import { createClient } from '@/lib/supabase/server'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
import { redirect } from 'next/navigation'
import { PhoneNumbersTable, PhoneNumber } from '@/components/phones/PhoneNumbersTable'

export default async function PhoneNumbersPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const profile = await getUserProfile()
  if (!profile) redirect('/auth/login')

  // Registro interno: solo dirección. Las políticas RLS ya lo blindan.
  const isAdmin = profile.role === 'admin' || profile.role === 'partner'
  if (!isAdmin) redirect('/dashboard')

  const { data: rows } = await supabase
    .from('phone_numbers')
    .select('*')
    .order('position', { ascending: true, nullsFirst: false })

  // La cabecera, el buscador y la tabla los pinta el componente (con el kit visual común)
  return <PhoneNumbersTable initialRows={(rows as PhoneNumber[]) || []} />
}
