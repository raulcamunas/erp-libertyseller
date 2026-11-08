import type { NextRequest } from 'next/server'
import { preguntarAlErp } from '@/lib/chat/asistente-servidor'
import { conChat, cuerpoDe } from '@/lib/chat/rutas'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120

/** Pregunta a los datos del ERP (solo administradores): `{ mensajes: [{ rol: 'user' | 'assistant', texto }] }` → `{ respuesta, herramientas, costeUsd }` */
export async function POST(request: NextRequest) {
  const c = await cuerpoDe(request)
  return conChat((quien) => preguntarAlErp(quien, { mensajes: c.mensajes }))
}
