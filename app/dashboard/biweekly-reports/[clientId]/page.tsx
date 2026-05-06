import { createClient } from '@/lib/supabase/server'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
import { notFound, redirect } from 'next/navigation'
import { BiweeklyReportsClient } from '@/components/biweekly-reports/BiweeklyReportsClient'

export default async function BiweeklyReportsClientPage({
  params,
}: {
  params: { clientId: string }
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/auth/login')
  }

  const profile = await getUserProfile()
  if (!profile) {
    redirect('/auth/login')
  }

  const { data: client, error: clientError } = await supabase
    .from('client_canvas')
    .select('id, name, created_by')
    .eq('id', params.clientId)
    .single()

  if (clientError || !client) {
    notFound()
  }

  if (profile.role !== 'admin') {
    const { data: membership } = await supabase
      .from('client_members')
      .select('id')
      .eq('client_id', params.clientId)
      .eq('user_id', user.id)
      .maybeSingle()

    const isCreator = client.created_by === user.id

    if (!membership && !isCreator) {
      notFound()
    }
  }

  return (
    <div className="w-full">
      <BiweeklyReportsClient clientId={client.id} clientName={client.name} />
    </div>
  )
}
