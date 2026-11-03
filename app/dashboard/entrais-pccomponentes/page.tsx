import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
import { MiraklError, baseDePcc, faltaConfigurarPcc, leerCuenta, leerTodasLasOfertas } from '@/lib/pccomponentes/mirakl'
import { PanelPccomponentes, type EstadoDelPanel } from '@/components/entrais/PanelPccomponentes'

/**
 * /dashboard/entrais-pccomponentes — LA TIENDA DE ENTRAIS EN PCCOMPONENTES. SOLO ADMIN.
 *
 * PcComponentes vende sobre Mirakl y da a cada vendedor una API: aquí se lee todo lo que la tienda de Entrais tiene publicado —ofertas, precios, stock y
 * estado— y se puede probar la subida de una oferta suelta. El stock y los precios automáticos, como en Amazon, vienen después de comprobar esto.
 *
 * Solo admin por lo mismo que Entrais Amazon: la clave de API es de la tienda de un cliente y las ofertas son de cara al público, con pedidos reales detrás.
 * La clave vive en la variable ENTRAIS_PCCOMPONENTES del servidor y NO llega nunca a esta página ni al navegador.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export default async function EntraisPccomponentesPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')
  const perfil = await getUserProfile()
  if (perfil?.role !== 'admin') redirect('/dashboard')

  let estado: EstadoDelPanel
  const falta = faltaConfigurarPcc()
  if (falta) {
    estado = { tipo: 'sin_clave', mensaje: falta }
  } else {
    try {
      const [cuenta, { ofertas, total }] = await Promise.all([leerCuenta(), leerTodasLasOfertas()])
      estado = { tipo: 'ok', cuenta, ofertas, total, leidoAt: new Date().toISOString(), servidor: new URL(baseDePcc()).host }
    } catch (e) {
      estado = { tipo: 'error', mensaje: e instanceof MiraklError ? `${e.message}${e.cuerpo ? ` (${e.cuerpo.slice(0, 160)})` : ''}` : 'No se ha podido leer la tienda de PcComponentes' }
    }
  }
  return <PanelPccomponentes estado={estado} />
}
