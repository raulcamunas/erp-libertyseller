import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { sesionDeRemesas } from '@/lib/fba/clientes-de-sesion'
import RemesasPage from '../page'

/**
 * ALERTAS FBA · LA RUTA DE SIEMPRE (spec remesas-pro §1.2 y §8).
 *
 * Las alertas son ahora una vista de Remesas a FBA (`/dashboard/remesas?vista=alertas`). Esta dirección sigue existiendo para no romper los
 * marcadores, la campana ni los correos: pinta la MISMA carcasa con la vista `alertas`, sin redirección (la carcasa sabe por la ruta que está
 * aquí). El acceso es el de `clientesDeSesion` (D27): un empleado con la casilla `remesas` ve todas; uno sin ella, las de sus `fba_accesos`.
 *
 * Es de la AGENCIA: un cliente de fuera, aunque entre en Remesas, vuelve a Remesas (como hasta ahora).
 */
export const dynamic = 'force-dynamic'

export default async function AlertasFbaPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const sesion = await sesionDeRemesas(user.id)
  if (sesion.actor === 'cliente') redirect('/dashboard/remesas')

  return RemesasPage({ searchParams: { ...searchParams, vista: 'alertas' } })
}
