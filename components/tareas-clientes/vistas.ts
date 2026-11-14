import type { TareaLigera } from '@/lib/tareas-clientes/servidor'
import { estadosDe, type ClienteTC, type OpcionDeEstado } from '@/lib/tareas-clientes/tipos'

/** Lo que comparten las vistas de tabla, calendario y cronograma */

export type MapaDeClientes = ReadonlyMap<string, ClienteTC>

/** Los estados de una tarea: los de su cliente */
export const estadosDeLaTarea = (t: Pick<TareaLigera, 'cliente_id'>, clientes: MapaDeClientes): OpcionDeEstado[] => estadosDe(clientes.get(t.cliente_id))

/** El color de una tarea en el calendario y el cronograma: el suyo o el de su columna */
export function colorDeTarea(t: Pick<TareaLigera, 'color' | 'estado' | 'cliente_id'>, clientes: MapaDeClientes): string {
  return t.color ?? estadosDeLaTarea(t, clientes).find((e) => e.nombre === t.estado)?.color ?? 'default'
}

export const estaHechaLaTarea = (t: Pick<TareaLigera, 'estado' | 'cliente_id'>, clientes: MapaDeClientes): boolean => estadosDeLaTarea(t, clientes).find((e) => e.nombre === t.estado)?.grupo === 'hecho'

/* ---- Fechas como texto «AAAA-MM-DD»: nunca pasan por un huso horario ---- */

export const aFecha = (d: Date): string => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
export const deFecha = (f: string): Date => new Date(`${f}T00:00:00Z`)
export const sumarDias = (f: string, n: number): string => aFecha(new Date(deFecha(f).getTime() + n * 86_400_000))
export const diasEntre = (desde: string, hasta: string): number => Math.round((deFecha(hasta).getTime() - deFecha(desde).getTime()) / 86_400_000)
/** El lunes de la semana de una fecha */
export const lunesDe = (f: string): string => sumarDias(f, -((deFecha(f).getUTCDay() + 6) % 7))
export const hoyTexto = (): string => aFecha(new Date())

/** Los días que cubre una tarea (de su inicio a su fin), o ninguno si no tiene fecha */
export function rangoDeTarea(t: Pick<TareaLigera, 'fecha_inicio' | 'fecha_fin'>): { desde: string; hasta: string } | null {
  const desde = t.fecha_inicio?.slice(0, 10)
  if (!desde) return null
  const fin = t.fecha_fin?.slice(0, 10)
  return { desde, hasta: fin && fin >= desde ? fin : desde }
}

/** Mover una tarea a otro día conservando cuánto dura */
export function fechasMovidas(t: Pick<TareaLigera, 'fecha_inicio' | 'fecha_fin'>, nuevoInicio: string): { fecha_inicio: string; fecha_fin: string | null } {
  const r = rangoDeTarea(t)
  const duracion = r ? diasEntre(r.desde, r.hasta) : 0
  return { fecha_inicio: nuevoInicio, fecha_fin: duracion > 0 ? sumarDias(nuevoInicio, duracion) : null }
}
