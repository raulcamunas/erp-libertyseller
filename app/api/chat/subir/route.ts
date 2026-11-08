import type { NextRequest } from 'next/server'
import { subirArchivo } from '@/lib/chat/extras-servidor'
import { ErrorDeChat } from '@/lib/chat/servidor'
import { conChat } from '@/lib/chat/rutas'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

/** Sube un archivo para un mensaje: formulario con `fichero` → `{ nombre, ruta, url, tipo, tamano }` (la `ruta` es lo que se manda luego con el mensaje) */
export async function POST(request: NextRequest) {
  const formulario = await request.formData().catch(() => null)
  return conChat(async (quien) => {
    const fichero = formulario?.get('fichero')
    if (!(fichero instanceof File)) throw new ErrorDeChat('Falta el archivo.')
    return subirArchivo(quien, fichero)
  }, 201)
}
