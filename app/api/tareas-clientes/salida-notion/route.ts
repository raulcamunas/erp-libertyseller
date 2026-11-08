import type { NextRequest } from 'next/server'
import { cuerpoDe, conPermiso } from '@/lib/tareas-clientes/rutas'
import { esClaveManual } from '@/lib/tareas-clientes/salida'
import { estadoDeLaSalida, marcarManual } from '@/lib/tareas-clientes/salida-servidor'
import { ErrorDeTareas } from '@/lib/tareas-clientes/servidor'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30

/**
 * LA LISTA PARA DEJAR NOTION. Solo administradores. `GET` mide ahora las comprobaciones automáticas y da el estado de las casillas manuales;
 * `PUT { clave, hecho }` marca o desmarca una casilla manual y devuelve el estado entero.
 */
export async function GET() {
  return conPermiso(async (p) => {
    if (!p.esAdmin) throw new ErrorDeTareas('Solo un administrador ve esta lista.', 403)
    return estadoDeLaSalida()
  })
}

export async function PUT(request: NextRequest) {
  const c = await cuerpoDe(request)
  return conPermiso(async (p) => {
    if (!p.esAdmin) throw new ErrorDeTareas('Solo un administrador marca esta lista.', 403)
    if (!esClaveManual(c.clave) || typeof c.hecho !== 'boolean') throw new ErrorDeTareas('Falta qué casilla marcar.')
    await marcarManual(c.clave, c.hecho)
    return estadoDeLaSalida()
  })
}
