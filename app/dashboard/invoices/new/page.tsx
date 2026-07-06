import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { InvoiceBuilder } from '@/components/invoices/InvoiceBuilder'

export default async function NewInvoicePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: clients } = await supabase
    .from('clients')
    .select('*')
    .order('name')

  return <InvoiceBuilder clients={clients || []} />
}
