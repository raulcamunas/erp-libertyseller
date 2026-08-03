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

  return (
    <div className="space-y-4">
      <div>
        <h1 className="heading-medium text-white mb-1">Teléfonos</h1>
        <p className="text-white/50 text-sm">
          Los números que usamos y para qué es cada uno.
        </p>
      </div>

      <PhoneNumbersTable initialRows={(rows as PhoneNumber[]) || []} />
    </div>
  )
}
