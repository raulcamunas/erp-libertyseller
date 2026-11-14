import { createServiceClient } from '@/lib/supabase/service'
import { MIN_LETRAS_DE_BUSQUEDA } from './busqueda'
import type { Permitidos } from './permisos'
import { ErrorDeTareas, esUuid } from './servidor'

/**
 * EL BUSCADOR DEL SERVIDOR: busca en títulos, cuerpos y comentarios de las tareas sin archivar, solo en los clientes que puede ver quien busca (y, si se pide, en uno).
 * Usa `tc_buscar` (migración 277), que no distingue mayúsculas ni acentos. Si esa función todavía no existe, busca igual pero distinguiendo acentos: así lanzar el código
 * antes que el SQL no rompe nada.
 */

export interface ResultadoDeBusqueda {
  donde: 'titulo' | 'cuerpo' | 'comentario'
  tarea_id: string
  cliente_id: string
  titulo: string
  estado: string
  fragmento: string
}

const LIMITE = 40

/** El texto como patrón de `ilike`: lo que el usuario escribe nunca es un comodín */
const comoPatron = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`

export async function buscarTareas(consulta: unknown, permitidos: Permitidos, clienteId?: unknown): Promise<ResultadoDeBusqueda[]> {
  const q = typeof consulta === 'string' ? consulta.trim().slice(0, 80) : ''
  if ([...q].length < MIN_LETRAS_DE_BUSQUEDA) return []
  if (clienteId !== undefined && clienteId !== null && clienteId !== '' && !esUuid(clienteId)) throw new ErrorDeTareas('Ese cliente no es válido.')

  // Dónde buscar: los clientes permitidos y, si se pide, solo uno (que tiene que estar entre ellos)
  let ids: string[] | null = permitidos ? [...permitidos] : null
  if (typeof clienteId === 'string' && clienteId) {
    if (ids && !ids.includes(clienteId)) return []
    ids = [clienteId]
  }

  const service = createServiceClient()
  const { data, error } = await service.rpc('tc_buscar', { p_q: q, p_clientes: ids, p_limite: LIMITE })
  if (!error) return (data ?? []).map((r: { donde: ResultadoDeBusqueda['donde']; tarea_id: string; cliente_id: string; titulo: string; estado: string; fragmento: string }) => ({ donde: r.donde, tarea_id: r.tarea_id, cliente_id: r.cliente_id, titulo: r.titulo, estado: r.estado, fragmento: r.fragmento ?? '' }))

  // Sin la función (migración sin lanzar): la misma búsqueda con `ilike`, que distingue acentos
  const patron = comoPatron(q)
  const filtrar = <T extends { in: (c: string, v: string[]) => T }>(consulta: T): T => (ids ? consulta.in('cliente_id', ids) : consulta)
  const [titulos, cuerpos] = await Promise.all([
    filtrar(service.from('tc_tareas').select('id, cliente_id, titulo, estado').eq('archivada', false).ilike('titulo', patron).limit(LIMITE)),
    filtrar(service.from('tc_tareas').select('id, cliente_id, titulo, estado, contenido_texto').eq('archivada', false).ilike('contenido_texto', patron).limit(LIMITE)),
  ])
  const salida: ResultadoDeBusqueda[] = []
  for (const t of (titulos.data ?? []) as Array<{ id: string; cliente_id: string; titulo: string; estado: string }>) salida.push({ donde: 'titulo', tarea_id: t.id, cliente_id: t.cliente_id, titulo: t.titulo, estado: t.estado, fragmento: '' })
  for (const t of (cuerpos.data ?? []) as Array<{ id: string; cliente_id: string; titulo: string; estado: string; contenido_texto: string }>) {
    const i = t.contenido_texto.toLowerCase().indexOf(q.toLowerCase())
    salida.push({ donde: 'cuerpo', tarea_id: t.id, cliente_id: t.cliente_id, titulo: t.titulo, estado: t.estado, fragmento: t.contenido_texto.slice(Math.max(0, i - 50), Math.max(0, i - 50) + 160) })
  }
  return salida.slice(0, LIMITE)
}
