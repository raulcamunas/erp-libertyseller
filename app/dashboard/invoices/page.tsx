import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { InvoicesDashboard } from '@/components/invoices/InvoicesDashboard'

export default async function InvoicesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  return (
    <div>
      <div className="mb-8">
        <h1 className="heading-medium text-white mb-2">Facturación</h1>
        <p className="text-white/50">Crea, envía y haz seguimiento de tus facturas</p>
      </div>
      <InvoicesDashboard />
    </div>
  )
}
