import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { InvoiceDetail } from '@/components/invoices/InvoiceDetail'

export default async function InvoicePage({
  params,
  searchParams,
}: {
  params: { id: string }
  searchParams: { send?: string }
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  return <InvoiceDetail invoiceId={params.id} autoSend={searchParams.send === '1'} />
}
