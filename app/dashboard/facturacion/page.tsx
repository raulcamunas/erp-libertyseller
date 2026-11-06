import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
import { CentroFacturacion } from '@/components/facturacion/CentroFacturacion'

/**
 * FACTURACIÓN: EL MES ENTERO EN UNA PANTALLA, CONTRA ZOHO BOOKS.
 *
 * Crear la factura, enviarla con su plantilla y el enlace de comisiones, y registrar
 * cobros y gastos sin entrar en Zoho.
 */
export default async function FacturacionPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const profile = await getUserProfile()
  if (!profile) redirect('/auth/login')

  // Los mismos que Tesorería: aquí se emiten facturas a nombre de la agencia y
  // se mandan correos a clientes desde su dirección.
  if (profile.role !== 'admin' && profile.role !== 'partner') redirect('/dashboard')

  return (
    <CentroFacturacion />
  )
}
