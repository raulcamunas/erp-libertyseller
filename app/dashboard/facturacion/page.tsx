import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
import { CentroFacturacion } from '@/components/facturacion/CentroFacturacion'

/**
 * FACTURACIÓN: EL MES ENTERO EN UNA PANTALLA.
 *
 * Lo que sustituye, por cliente y a mano: montar la factura fuera del ERP,
 * copiar su enlace, buscar el desglose de comisiones, abrir el correo, pegar la
 * plantilla, adjuntar el PDF y marcarlo en Tesorería.
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
    <div className="min-w-0">
      <div className="mb-4">
        <h1 className="heading-medium mb-1 text-white">Facturación</h1>
        <p className="text-sm text-white/50">
          Emite la factura de cada cliente y mándasela con el desglose y el PDF dentro, sin salir de
          aquí.
        </p>
      </div>

      <CentroFacturacion />
    </div>
  )
}
