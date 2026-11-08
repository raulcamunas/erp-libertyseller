import { cargarInicio } from '@/lib/chat/servidor'
import { conChat } from '@/lib/chat/rutas'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Todo lo que necesita la pantalla del chat para abrirse: quién soy, quién más hay y mis canales con lo que llevo sin leer */
export async function GET() {
  return conChat((quien) => cargarInicio(quien))
}
