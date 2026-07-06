import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { paid_amount, bank_reference, paid_at } = await request.json().catch(() => ({}))

  const { data, error } = await supabase
    .from('invoices')
    .update({
      status: 'paid',
      paid_at: paid_at || new Date().toISOString(),
      paid_amount: paid_amount || null,
      bank_reference: bank_reference || null,
    })
    .eq('id', params.id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data })
}
