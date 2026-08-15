import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
import { cuentasDeTrabajo } from '@/lib/ads/datos'
import { MarketingBoard } from '@/components/marketing/MarketingBoard'

/**
 * /dashboard/marketing-ads — MARKETING. SOLO ADMIN.
 *
 * REDISEÑO COMPLETO. Antes esta pantalla era la revisión semanal que se
 * rellenaba A MANO: alguien copiaba de Seller Central las métricas de cada
 * campaña, apuntaba los cambios de puja en un diario y la semana siguiente
 * volvía a empezar. Tenía sentido cuando no había API.
 *
 * Ahora la hay. Las campañas se piden a Amazon en vivo, así que ya no hay nada
 * que teclear ni nada que se quede viejo entre lunes y lunes.
 *
 *
 * ============ LO ANTERIOR NO SE HA BORRADO ============
 *
 * Las tablas `marketing_clients`, `marketing_weeks`, `marketing_campaigns`,
 * `marketing_keywords` y `marketing_changes` siguen ahí con todo lo que se
 * anotó. Lo que se ha sustituido es la PANTALLA. El día que se quiera recuperar
 * ese histórico —para comparar lo que se hacía a mano con lo que dice la API—
 * los datos están.
 *
 * `marketing_clients` además sigue en uso: es una de las dos tablas que apuntan
 * a `public.clientes` (migración 151).
 *
 *
 * ============ POR QUÉ NO SE GUARDA NADA DE LO QUE SE PIDE ============
 *
 * Una campaña cambia de estado y de presupuesto varias veces al día. Una copia
 * en la base sería una copia vieja en cuanto alguien tocara algo en Seller
 * Central, y la pantalla estaría mintiendo sin dar ningún error — que es el
 * fallo que más caro sale de todos. Lo que sí se guardará, cuando llegue, es el
 * histórico de MÉTRICAS, que es otra cosa: eso no cambia hacia atrás.
 */
export const dynamic = 'force-dynamic'

export default async function MarketingPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  // Desde aquí se ven las campañas y el gasto de la cuenta de un cliente. El
  // mismo listón que Amazon API y Growth Partner.
  const perfil = await getUserProfile()
  if (perfil?.role !== 'admin') redirect('/dashboard')

  /**
   * Solo las cuentas ENCENDIDAS y CON CLIENTE ASIGNADO.
   *
   * Las dos condiciones, y cada una tapa un agujero distinto: sin la primera
   * saldrían las cuentas de encargos viejos a los que el correo autorizado sigue
   * llegando; sin la segunda, el gasto de un anunciante se enseñaría bajo el
   * cliente equivocado. Se decide en Amazon API · Publicidad.
   */
  const cuentas = await cuentasDeTrabajo()

  return <MarketingBoard cuentas={cuentas} />
}
