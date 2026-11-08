import type { NextRequest } from 'next/server'
import { analizarImportacion, empezarImportacion, estadoDeImportacion } from '@/lib/chat/importar-servidor'
import { ErrorDeChat } from '@/lib/chat/servidor'
import { conChat } from '@/lib/chat/rutas'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

/** El avance de una importación: `?trabajo=<id>` */
export async function GET(request: NextRequest) {
  return conChat(async (quien) => {
    if (!quien.esAdmin) throw new ErrorDeChat('Importar es solo para administradores.', 403)
    const e = estadoDeImportacion(request.nextUrl.searchParams.get('trabajo'))
    if (!e) throw new ErrorDeChat('Esa importación no existe (o el servidor se ha reiniciado).', 404)
    return e
  })
}

/** La exportación de Slack (.zip) en el campo `fichero`. Con `simulacro=1` solo la revisa y cuenta lo que haría; sin él, empieza a importar y da el id para seguir el avance */
export async function POST(request: NextRequest) {
  const formulario = await request.formData().catch(() => null)
  return conChat(async (quien) => {
    const fichero = formulario?.get('fichero')
    if (!(fichero instanceof File)) throw new ErrorDeChat('Falta el archivo .zip de Slack.')
    const bytes = new Uint8Array(await fichero.arrayBuffer())
    if (formulario?.get('simulacro') === '1') return { resumen: await analizarImportacion(quien, bytes) }
    return empezarImportacion(quien, bytes)
  })
}
