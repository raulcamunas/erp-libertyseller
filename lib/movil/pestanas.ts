/**
 * LAS TRES PESTAÑAS DEL MEDIO DE LA BARRA DE ABAJO (en el móvil): entre «Inicio» y «Más».
 * ========================================================================================
 * PURO. Se comprueba con pestanas.prueba.ts.
 *
 *   1. Las que la persona ha fijado (y puede ver).
 *   2. Si sobra sitio, las que más usa (lib/movil/uso.ts, con el olvido semanal).
 *   3. Si aún sobra, un orden de siempre (las del día a día del equipo) y, detrás, el orden del menú.
 *
 * Nunca «Inicio» (ya tiene su pestaña) y nada para el rol 'cliente', que no tiene Inicio y solo ve Remesas.
 *
 * Mientras dura la sesión, la elección se CONGELA (la guarda quien la pinta): una pestaña que cambia de sitio bajo el dedo es peor que una que no es la
 * mejor. `congeladas` se respeta mientras siga siendo válida: todas visibles, sin repetidas, las que tocan y con todas las fijadas dentro.
 */
import { ordenarMasUsadas, type Uso } from './uso'

export const PESTANAS = 3

/** Sin historial, este orden (cruzado con lo que la persona ve) */
export const ORDEN_POR_DEFECTO: readonly string[] = ['cold-calling', 'correo', 'agenda', 'chat', 'tareas-clientes', 'rendimiento', 'crm', 'remesas']

export interface EntradaDePestanas {
  /** Los ids que la persona ve, en el orden del menú */
  visibles: readonly string[]
  uso: Uso
  fijadas: readonly string[]
  rol: string | null | undefined
  ahora: number
  congeladas?: readonly string[] | null
}

export function elegirPestanas({ visibles, uso, fijadas, rol, ahora, congeladas }: EntradaDePestanas): string[] {
  if (rol === 'cliente') return []
  const candidatas = visibles.filter((id, i) => id !== 'home' && visibles.indexOf(id) === i)
  const cuantas = Math.min(PESTANAS, candidatas.length)
  const vale = new Set(candidatas)
  const fijadasVisibles = fijadas.filter((id) => vale.has(id))

  if (congeladas && congeladas.length === cuantas && new Set(congeladas).size === congeladas.length && congeladas.every((id) => vale.has(id)) && fijadasVisibles.every((id) => congeladas.includes(id))) {
    return [...congeladas]
  }

  const salida: string[] = []
  const meter = (id: string) => {
    if (salida.length < cuantas && vale.has(id) && !salida.includes(id)) salida.push(id)
  }
  fijadasVisibles.forEach(meter)
  ordenarMasUsadas(uso, ahora, PESTANAS, candidatas).forEach(meter)
  ORDEN_POR_DEFECTO.forEach(meter)
  candidatas.forEach(meter)
  return salida
}
