import type { NextRequest } from 'next/server'
import { anadirMiembros, cambiarAvisos, cambiarCanal, crearCanal, marcarLeido, salir, silenciar, unirse } from '@/lib/chat/servidor'
import { ErrorDeChat } from '@/lib/chat/servidor'
import { conChat, cuerpoDe } from '@/lib/chat/rutas'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Crea un canal: `{ tipo: 'canal' | 'privado', nombre, descripcion?, miembros?: [id], clienteId? }` → `{ canalId }` */
export async function POST(request: NextRequest) {
  const c = await cuerpoDe(request)
  return conChat((quien) => crearCanal(quien, { tipo: c.tipo, nombre: c.nombre, descripcion: c.descripcion, miembros: c.miembros, clienteId: c.clienteId, anuncios: c.anuncios, voz: c.voz }), 201)
}

/**
 * Lo que se hace con un canal que ya existe: `{ accion, canalId, ... }` con `accion` = `unirse` · `salir` · `leido` · `silenciar` (`silenciado`) · `anadir` (`miembros`) ·
 * `cambiar` (`nombre`, `descripcion` o `archivar`).
 */
export async function PATCH(request: NextRequest) {
  const c = await cuerpoDe(request)
  return conChat((quien) => {
    switch (c.accion) {
      case 'unirse':
        return unirse(quien, c.canalId)
      case 'salir':
        return salir(quien, c.canalId)
      case 'leido':
        return marcarLeido(quien, c.canalId)
      case 'silenciar':
        return silenciar(quien, c.canalId, c.silenciado)
      case 'avisos':
        return cambiarAvisos(quien, c.canalId, c.nivel)
      case 'anadir':
        return anadirMiembros(quien, c.canalId, c.miembros)
      case 'cambiar':
        return cambiarCanal(quien, c.canalId, { nombre: c.nombre, descripcion: c.descripcion, archivar: c.archivar, anuncios: c.anuncios })
      default:
        throw new ErrorDeChat('Esa acción no existe.')
    }
  })
}
