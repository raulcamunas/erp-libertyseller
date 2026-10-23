import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

/**
 * LA RAÍZ YA NO ES UNA PÁGINA: ES UNA PUERTA QUE NO SE VE.
 *
 * Antes era el logo y un botón de «Iniciar Sesión» que llevaba al formulario: un clic de más para quien viene a entrar («esta parte de iniciar sesión
 * quítala», Raúl, 23 oct 2026). Ahora quien llega aquí sin sesión cae directamente en el formulario de acceso (/auth/login) y quien ya está dentro, en
 * el ERP (/dashboard). Sirve también para el logo de la barra lateral y el de la pantalla de acceso, que apuntan a «/».
 *
 * `force-dynamic` para que Next no lo prepare una vez en la compilación con la respuesta de quien no tiene sesión. Si la consulta de la sesión falla
 * (Supabase caído), se manda al formulario: es de donde se sale a entrar de todas formas.
 */
export const dynamic = 'force-dynamic'

export default async function Home() {
  let haySesion = false
  try {
    const supabase = await createClient()
    const { data } = await supabase.auth.getUser()
    haySesion = !!data.user
  } catch {
    haySesion = false
  }
  redirect(haySesion ? '/dashboard' : '/auth/login')
}
