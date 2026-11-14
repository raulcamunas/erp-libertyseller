import type { ActividadTC, ClienteTC, ComentarioTC, PersonaTC, Portada, TareaTC } from '@/lib/tareas-clientes/tipos'
import type { EstadisticasDeCliente, TareaLigera } from '@/lib/tareas-clientes/servidor'

/** Lo que devuelven las rutas de /api/tareas-clientes, con sus tipos. Los datos se piden con `pedir` y los errores llegan con su motivo */

export interface Preferencias {
  usuario_id?: string
  fondo: Portada
  portada: Portada
  favoritos: string[]
}

export interface DatosDeInicio {
  clientes: ClienteTC[]
  estadisticas: Record<string, EstadisticasDeCliente>
  preferencias: Preferencias | null
  personas: PersonaTC[]
  mias: { abiertas: number; vencidas: number }
}

export interface ClienteBreve {
  id: string
  nombre: string
  icono: string | null
  color: string
  grupo: string
  orden: number
}

export interface DatosDeCliente {
  cliente: ClienteTC
  tareas: TareaLigera[]
  clientes: ClienteBreve[]
  preferencias: Preferencias | null
  personas: PersonaTC[]
}

/**
 * LO ÚLTIMO QUE SE LEYÓ de «todas las tareas», guardado en memoria mientras la pestaña siga abierta: al volver al espacio de trabajo (desde el inicio, por ejemplo) se
 * pinta al instante con esto y se refresca por detrás. Solo vive en el navegador de esta persona; al recargar la página se pierde, que es lo que se quiere.
 */
export const memoria: { todas: DatosDeTodas | null } = { todas: null }

export interface DatosDeTodas {
  clientes: ClienteTC[]
  tareas: TareaLigera[]
  preferencias: Preferencias | null
  personas: PersonaTC[]
}

export interface DatosDeTarea {
  tarea: TareaTC
  comentarios: ComentarioTC[]
  actividad: ActividadTC[]
}

export class ErrorDeRed extends Error {}

export async function pedir<T>(url: string, init?: { metodo?: string; cuerpo?: unknown; formulario?: FormData }): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, {
      method: init?.metodo ?? 'GET',
      cache: 'no-store',
      ...(init?.formulario ? { body: init.formulario } : init?.cuerpo !== undefined ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(init.cuerpo) } : {}),
    })
  } catch {
    throw new ErrorDeRed('No hay conexión con el servidor. Inténtalo otra vez.')
  }
  const datos = (await res.json().catch(() => null)) as (T & { error?: string }) | null
  if (!res.ok || !datos) throw new ErrorDeRed(datos?.error ?? `Error ${res.status}`)
  return datos
}

export const BASE = '/api/tareas-clientes'
