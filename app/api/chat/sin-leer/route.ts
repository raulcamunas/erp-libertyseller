import { resumenSinLeer } from '@/lib/chat/servidor'
import { conChat } from '@/lib/chat/rutas'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Cuánto hay sin leer en el chat: `{ mensajes, menciones }`. Lo pregunta el dock cada minuto, desde cualquier pantalla del ERP */
export async function GET() {
  return conChat((quien) => resumenSinLeer(quien))
}
