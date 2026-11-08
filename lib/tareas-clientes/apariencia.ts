/**
 * EL ICONO Y EL COLOR DE CADA PERSONA EN TAREAS DE CLIENTES — PURO.
 *
 * Cada persona elige un color y un icono que la identifican en las tareas (responsables, comentarios, quién está en línea). Son EXCLUSIVOS: lo que ya tiene un compañero no se puede
 * coger, para que dos personas no se confundan. Quien no ha elegido nada sigue con las iniciales y un color que sale de su id. Se guarda en tc_preferencias (migración 283); aquí viven
 * las listas y las reglas, que comprueban lo mismo el servidor y la pantalla.
 */

export const COLORES: ReadonlyArray<{ id: string; nombre: string; hex: string }> = [
  { id: 'naranja', nombre: 'Naranja', hex: '#F97316' },
  { id: 'rojo', nombre: 'Rojo', hex: '#EF4444' },
  { id: 'rosa', nombre: 'Rosa', hex: '#EC4899' },
  { id: 'magenta', nombre: 'Magenta', hex: '#D946EF' },
  { id: 'violeta', nombre: 'Violeta', hex: '#8B5CF6' },
  { id: 'indigo', nombre: 'Índigo', hex: '#6366F1' },
  { id: 'azul', nombre: 'Azul', hex: '#3B82F6' },
  { id: 'cielo', nombre: 'Cielo', hex: '#0EA5E9' },
  { id: 'cian', nombre: 'Cian', hex: '#06B6D4' },
  { id: 'turquesa', nombre: 'Turquesa', hex: '#14B8A6' },
  { id: 'verde', nombre: 'Verde', hex: '#22C55E' },
  { id: 'lima', nombre: 'Lima', hex: '#84CC16' },
  { id: 'amarillo', nombre: 'Amarillo', hex: '#EAB308' },
  { id: 'ambar', nombre: 'Ámbar', hex: '#F59E0B' },
  { id: 'tierra', nombre: 'Tierra', hex: '#B45309' },
  { id: 'pizarra', nombre: 'Pizarra', hex: '#94A3B8' },
]

/** Los iconos disponibles: el dibujo de cada uno lo pone la pantalla (components/tareas-clientes/AvatarTC.tsx) */
export const ICONOS: ReadonlyArray<{ id: string; nombre: string }> = [
  { id: 'cohete', nombre: 'Cohete' },
  { id: 'llama', nombre: 'Llama' },
  { id: 'estrella', nombre: 'Estrella' },
  { id: 'rayo', nombre: 'Rayo' },
  { id: 'corazon', nombre: 'Corazón' },
  { id: 'hoja', nombre: 'Hoja' },
  { id: 'luna', nombre: 'Luna' },
  { id: 'sol', nombre: 'Sol' },
  { id: 'gato', nombre: 'Gato' },
  { id: 'perro', nombre: 'Perro' },
  { id: 'pajaro', nombre: 'Pájaro' },
  { id: 'pez', nombre: 'Pez' },
  { id: 'ancla', nombre: 'Ancla' },
  { id: 'corona', nombre: 'Corona' },
  { id: 'gema', nombre: 'Gema' },
  { id: 'cafe', nombre: 'Café' },
  { id: 'pizza', nombre: 'Pizza' },
  { id: 'musica', nombre: 'Música' },
  { id: 'camara', nombre: 'Cámara' },
  { id: 'mando', nombre: 'Mando' },
  { id: 'fantasma', nombre: 'Fantasma' },
  { id: 'sonrisa', nombre: 'Sonrisa' },
  { id: 'bici', nombre: 'Bici' },
  { id: 'montana', nombre: 'Montaña' },
  { id: 'avion', nombre: 'Avión' },
  { id: 'diana', nombre: 'Diana' },
]

export interface AparienciaDePersona {
  color: string | null
  icono: string | null
}
/** De cada persona (id del perfil) lo que ha elegido; las que no han elegido nada no salen */
export type MapaDeApariencia = Record<string, AparienciaDePersona>

export const hexDeColor = (id: string | null | undefined): string | null => COLORES.find((c) => c.id === id)?.hex ?? null
export const esColorValido = (id: unknown): id is string => typeof id === 'string' && COLORES.some((c) => c.id === id)
export const esIconoValido = (id: unknown): id is string => typeof id === 'string' && ICONOS.some((i) => i.id === id)

export interface Ocupados {
  /** color → id de la persona que lo tiene */
  colores: Map<string, string>
  iconos: Map<string, string>
}

/** Lo que tienen cogido los demás (lo mío no cuenta: puedo quedarme con lo que ya tengo) */
export function ocupadosPorOtros(mapa: MapaDeApariencia, yo: string): Ocupados {
  const colores = new Map<string, string>()
  const iconos = new Map<string, string>()
  for (const [persona, a] of Object.entries(mapa)) {
    if (persona === yo) continue
    if (a.color) colores.set(a.color, persona)
    if (a.icono) iconos.set(a.icono, persona)
  }
  return { colores, iconos }
}

export type ResultadoDeElegir = { ok: true; color: string | null; icono: string | null } | { ok: false; motivo: string }

/**
 * Lo que una persona quiere ponerse (`null` = quitarlo y volver al automático) contra lo que ya tienen los demás. `nombres` es para decir quién lo tiene.
 */
export function elegirApariencia(
  mapa: MapaDeApariencia,
  yo: string,
  quiere: { color: unknown; icono: unknown },
  nombres: (id: string) => string = () => 'otra persona',
): ResultadoDeElegir {
  const color = quiere.color === null || quiere.color === undefined ? null : quiere.color
  const icono = quiere.icono === null || quiere.icono === undefined ? null : quiere.icono
  if (color !== null && !esColorValido(color)) return { ok: false, motivo: 'Ese color no existe.' }
  if (icono !== null && !esIconoValido(icono)) return { ok: false, motivo: 'Ese icono no existe.' }
  const otros = ocupadosPorOtros(mapa, yo)
  if (color !== null && otros.colores.has(color)) return { ok: false, motivo: `Ese color ya lo tiene ${nombres(otros.colores.get(color)!)}.` }
  if (icono !== null && otros.iconos.has(icono)) return { ok: false, motivo: `Ese icono ya lo tiene ${nombres(otros.iconos.get(icono)!)}.` }
  return { ok: true, color, icono }
}
