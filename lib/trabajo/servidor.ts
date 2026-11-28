import { createServiceClient } from '@/lib/supabase/service'
import { cruzarClientes } from '@/lib/tareas-clientes/automaticas'
import { crearComentario, crearTarea, personasConAcceso, type Actor } from '@/lib/tareas-clientes/servidor'
import type { PersonaTC } from '@/lib/tareas-clientes/tipos'

/**
 * EL TRABAJO DE LOS MÓDULOS (PPC, SEO, Cumplimiento…) COMO TAREAS DE CLIENTES. SOLO SERVIDOR.
 *
 * Cualquier cosa de un módulo (una propuesta de PPC, una tarea de SEO, un listing bloqueado) se puede convertir en una tarea de Tareas de clientes con un clic:
 * con responsables, fecha, estado, comentarios con @menciones, avisos a la campana, «Mi día» e historial, que ya existen allí. La tarea guarda la referencia del
 * elemento (`origen_ref` = «módulo:ref», única por cliente: no se crean dos para lo mismo) y un enlace de vuelta (`url`).
 *
 * El cliente de Tareas se empareja con el de Amazon como las tareas automáticas: por el enlace de `vinculos` o, si no hay, por el nombre (cruzarClientes).
 */

export type ModuloDeTrabajo = 'ppc' | 'seo' | 'cumplimiento' | 'remesas' | 'resenas'
export const MODULOS: readonly ModuloDeTrabajo[] = ['ppc', 'seo', 'cumplimiento', 'remesas', 'resenas']

export interface TareaEnlazada {
  ref: string
  tareaId: string
  tcClienteId: string
  titulo: string
  estado: string
  responsables: Array<{ id: string; nombre: string }>
  fechaFin: string | null
  comentarios: number
  href: string
}

const origen = (modulo: ModuloDeTrabajo, ref: string) => `${modulo}:${ref}`.slice(0, 300)
const hrefDe = (tcClienteId: string, tareaId: string) => `/dashboard/tareas-clientes/${tcClienteId}?tarea=${tareaId}`

/** El cliente de Tareas de un cliente de Amazon (null = no hay pareja: hay que crearlo o enlazarlo en Tareas) */
export async function tcClienteDeAmazon(amazonClientId: string): Promise<string | null> {
  const s = createServiceClient()
  const [tc, amazon] = await Promise.all([s.from('tc_clientes').select('id, nombre, vinculos').eq('activo', true), s.from('amazon_clients').select('id, name')])
  const clientes = ((tc.data ?? []) as Array<{ id: string; nombre: string; vinculos: Record<string, string> | null }>).map((c) => ({ id: c.id, nombre: c.nombre, amazonClientId: c.vinculos?.amazon_client_id ?? null }))
  const lista = ((amazon.data ?? []) as Array<{ id: string; name: string }>).map((a) => ({ id: a.id, nombre: a.name }))
  return cruzarClientes(clientes, lista).porAmazon.get(amazonClientId) ?? null
}

/** Las tareas ya enlazadas a estos elementos de un módulo (las archivadas no) y quién puede llevarlas */
export async function tareasEnlazadas(amazonClientId: string, modulo: ModuloDeTrabajo, refs: readonly string[]): Promise<{ tcClienteId: string | null; tareas: TareaEnlazada[]; personas: PersonaTC[] }> {
  const tcClienteId = await tcClienteDeAmazon(amazonClientId)
  if (!tcClienteId) return { tcClienteId: null, tareas: [], personas: [] }
  const s = createServiceClient()
  const claves = [...new Set(refs.map((r) => origen(modulo, r)))]
  const personas = await personasConAcceso(tcClienteId)
  const nombre = new Map(personas.map((p) => [p.id, p.nombre]))
  const tareas: TareaEnlazada[] = []
  for (let i = 0; i < claves.length; i += 200) {
    const { data, error } = await s.from('tc_tareas').select('id, titulo, estado, responsables, fecha_fin, origen_ref, comentarios').eq('cliente_id', tcClienteId).eq('archivada', false).in('origen_ref', claves.slice(i, i + 200))
    if (error) throw error
    for (const t of (data ?? []) as Array<{ id: string; titulo: string; estado: string; responsables: string[] | null; fecha_fin: string | null; origen_ref: string; comentarios: number | null }>) {
      tareas.push({
        ref: t.origen_ref.slice(modulo.length + 1),
        tareaId: t.id,
        tcClienteId,
        titulo: t.titulo,
        estado: t.estado,
        responsables: (t.responsables ?? []).map((id) => ({ id, nombre: nombre.get(id) ?? 'Sin nombre' })),
        fechaFin: t.fecha_fin,
        comentarios: Number(t.comentarios ?? 0),
        href: hrefDe(tcClienteId, t.id),
      })
    }
  }
  return { tcClienteId, tareas, personas }
}

export interface EntradaDeTrabajo {
  amazonClientId: string
  modulo: ModuloDeTrabajo
  ref: string
  titulo: string
  /** Ruta del ERP para volver al elemento (se guarda como URL absoluta en la tarea) */
  enlace: string
  responsables?: string[]
  /** AAAA-MM-DD */
  fechaFin?: string | null
  /** Primer comentario (puede llevar @menciones) */
  nota?: string | null
}

/** Crea la tarea del elemento (o devuelve la que ya tenía). Lanza un error legible si el cliente no tiene pareja en Tareas */
export async function crearTareaDesde(actor: Actor, e: EntradaDeTrabajo, base: string): Promise<TareaEnlazada> {
  const tcClienteId = await tcClienteDeAmazon(e.amazonClientId)
  if (!tcClienteId) throw new Error('Este cliente no está en Tareas de clientes (o tiene otro nombre): créalo o enlázalo allí y vuelve a probar.')
  const ya = await tareasEnlazadas(e.amazonClientId, e.modulo, [e.ref])
  if (ya.tareas[0]) return ya.tareas[0]
  const url = e.enlace.startsWith('http') ? e.enlace : `${base}${e.enlace}`
  const t = await crearTarea(actor, {
    clienteId: tcClienteId,
    titulo: e.titulo.slice(0, 200),
    url,
    responsables: e.responsables ?? [],
    ...(e.fechaFin ? { fecha_fin: `${e.fechaFin}T12:00:00Z` } : {}),
    origenRef: origen(e.modulo, e.ref),
  })
  if (e.nota && e.nota.trim()) await crearComentario(actor, t.id, e.nota.trim()).catch((err) => console.error('[trabajo] nota de la tarea:', err instanceof Error ? err.message : err))
  const nuevas = await tareasEnlazadas(e.amazonClientId, e.modulo, [e.ref])
  return nuevas.tareas[0] ?? { ref: e.ref, tareaId: t.id, tcClienteId, titulo: e.titulo, estado: '', responsables: [], fechaFin: null, comentarios: 0, href: hrefDe(tcClienteId, t.id) }
}
