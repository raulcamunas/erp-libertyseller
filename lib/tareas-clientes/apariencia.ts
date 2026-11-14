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
  { id: 'robot', nombre: 'Robot' },
  { id: 'cerebro', nombre: 'Cerebro' },
  { id: 'calavera', nombre: 'Calavera' },
  { id: 'espadas', nombre: 'Espadas' },
  { id: 'escudo', nombre: 'Escudo' },
  { id: 'varita', nombre: 'Varita' },
  { id: 'chispas', nombre: 'Chispas' },
  { id: 'trofeo', nombre: 'Trofeo' },
  { id: 'medalla', nombre: 'Medalla' },
  { id: 'bandera', nombre: 'Bandera' },
  { id: 'brujula', nombre: 'Brújula' },
  { id: 'mundo', nombre: 'Mundo' },
  { id: 'paraguas', nombre: 'Paraguas' },
  { id: 'nieve', nombre: 'Copo de nieve' },
  { id: 'nube', nombre: 'Nube' },
  { id: 'flor', nombre: 'Flor' },
  { id: 'pino', nombre: 'Pino' },
  { id: 'cereza', nombre: 'Cereza' },
  { id: 'manzana', nombre: 'Manzana' },
  { id: 'zanahoria', nombre: 'Zanahoria' },
  { id: 'helado', nombre: 'Helado' },
  { id: 'galleta', nombre: 'Galleta' },
  { id: 'cerveza', nombre: 'Cerveza' },
  { id: 'vino', nombre: 'Vino' },
  { id: 'pesas', nombre: 'Pesas' },
  { id: 'conejo', nombre: 'Conejo' },
  { id: 'ardilla', nombre: 'Ardilla' },
  { id: 'tortuga', nombre: 'Tortuga' },
  { id: 'caracol', nombre: 'Caracol' },
  { id: 'bicho', nombre: 'Bicho' },
  { id: 'huevo', nombre: 'Huevo' },
  { id: 'gafas', nombre: 'Gafas' },
  { id: 'auriculares', nombre: 'Auriculares' },
  { id: 'guitarra', nombre: 'Guitarra' },
  { id: 'telescopio', nombre: 'Telescopio' },
  { id: 'atomo', nombre: 'Átomo' },
  { id: 'donut', nombre: 'Donut' },
  { id: 'sandwich', nombre: 'Sándwich' },
  { id: 'caramelo', nombre: 'Caramelo' },
  { id: 'platano', nombre: 'Plátano' },
  { id: 'uvas', nombre: 'Uvas' },
  { id: 'citrico', nombre: 'Cítrico' },
  { id: 'hueso', nombre: 'Hueso' },
]

/**
 * LOS PERSONAJES: avatares con forma de animal, criatura o cosa, dibujados con un emoji. Se eligen como un icono más (y también son exclusivos): lo que se guarda es el id, que empieza
 * por «e-»; el emoji lo pone la pantalla. Los ids son solo letras para que nada raro viaje a la base de datos.
 */
export const PERSONAJES: ReadonlyArray<{ id: string; nombre: string; emoji: string }> = [
  { id: 'e-zorro', nombre: 'Zorro', emoji: '🦊' },
  { id: 'e-panda', nombre: 'Panda', emoji: '🐼' },
  { id: 'e-koala', nombre: 'Koala', emoji: '🐨' },
  { id: 'e-leon', nombre: 'León', emoji: '🦁' },
  { id: 'e-tigre', nombre: 'Tigre', emoji: '🐯' },
  { id: 'e-rana', nombre: 'Rana', emoji: '🐸' },
  { id: 'e-pulpo', nombre: 'Pulpo', emoji: '🐙' },
  { id: 'e-unicornio', nombre: 'Unicornio', emoji: '🦄' },
  { id: 'e-pinguino', nombre: 'Pingüino', emoji: '🐧' },
  { id: 'e-buho', nombre: 'Búho', emoji: '🦉' },
  { id: 'e-mariposa', nombre: 'Mariposa', emoji: '🦋' },
  { id: 'e-delfin', nombre: 'Delfín', emoji: '🐬' },
  { id: 'e-tiburon', nombre: 'Tiburón', emoji: '🦈' },
  { id: 'e-ballena', nombre: 'Ballena', emoji: '🐳' },
  { id: 'e-dinosaurio', nombre: 'Dinosaurio', emoji: '🦖' },
  { id: 'e-dragon', nombre: 'Dragón', emoji: '🐲' },
  { id: 'e-oso', nombre: 'Oso', emoji: '🐻' },
  { id: 'e-mono', nombre: 'Mono', emoji: '🐵' },
  { id: 'e-perezoso', nombre: 'Perezoso', emoji: '🦥' },
  { id: 'e-flamenco', nombre: 'Flamenco', emoji: '🦩' },
  { id: 'e-abeja', nombre: 'Abeja', emoji: '🐝' },
  { id: 'e-cangrejo', nombre: 'Cangrejo', emoji: '🦀' },
  { id: 'e-robot', nombre: 'Robot', emoji: '🤖' },
  { id: 'e-arcade', nombre: 'Marciano', emoji: '👾' },
  { id: 'e-alien', nombre: 'Alienígena', emoji: '👽' },
  { id: 'e-mago', nombre: 'Mago', emoji: '🧙' },
  { id: 'e-vampiro', nombre: 'Vampiro', emoji: '🧛' },
  { id: 'e-sirena', nombre: 'Sirena', emoji: '🧜' },
  { id: 'e-ninja', nombre: 'Ninja', emoji: '🥷' },
  { id: 'e-heroe', nombre: 'Superhéroe', emoji: '🦸' },
  { id: 'e-vaquero', nombre: 'Vaquero', emoji: '🤠' },
  { id: 'e-gafas', nombre: 'Con gafas', emoji: '😎' },
  { id: 'e-payaso', nombre: 'Payaso', emoji: '🤡' },
  { id: 'e-espectro', nombre: 'Espectro', emoji: '👻' },
  { id: 'e-craneo', nombre: 'Cráneo', emoji: '💀' },
  { id: 'e-calabaza', nombre: 'Calabaza', emoji: '🎃' },
  { id: 'e-genio', nombre: 'Genio', emoji: '🧞' },
  { id: 'e-hada', nombre: 'Hada', emoji: '🧚' },
  { id: 'e-zombi', nombre: 'Zombi', emoji: '🧟' },
  { id: 'e-donut', nombre: 'Donut', emoji: '🍩' },
  { id: 'e-hamburguesa', nombre: 'Hamburguesa', emoji: '🍔' },
  { id: 'e-taco', nombre: 'Taco', emoji: '🌮' },
  { id: 'e-sandia', nombre: 'Sandía', emoji: '🍉' },
  { id: 'e-fresa', nombre: 'Fresa', emoji: '🍓' },
  { id: 'e-ovni', nombre: 'Ovni', emoji: '🛸' },
  { id: 'e-guitarra', nombre: 'Guitarra', emoji: '🎸' },
  { id: 'e-copa', nombre: 'Copa', emoji: '🏆' },
  { id: 'e-bola', nombre: 'Bola de cristal', emoji: '🔮' },
  { id: 'e-saturno', nombre: 'Saturno', emoji: '🪐' },
  { id: 'e-arcoiris', nombre: 'Arcoíris', emoji: '🌈' },
  { id: 'e-cactus', nombre: 'Cactus', emoji: '🌵' },
  { id: 'e-seta', nombre: 'Seta', emoji: '🍄' },
]
export const EMOJI_DE_PERSONAJE: ReadonlyMap<string, string> = new Map(PERSONAJES.map((p) => [p.id, p.emoji]))

export interface AparienciaDePersona {
  color: string | null
  icono: string | null
}
/** De cada persona (id del perfil) lo que ha elegido; las que no han elegido nada no salen */
export type MapaDeApariencia = Record<string, AparienciaDePersona>

export const hexDeColor = (id: string | null | undefined): string | null => COLORES.find((c) => c.id === id)?.hex ?? null
export const esColorValido = (id: unknown): id is string => typeof id === 'string' && COLORES.some((c) => c.id === id)
export const esIconoValido = (id: unknown): id is string => typeof id === 'string' && (ICONOS.some((i) => i.id === id) || EMOJI_DE_PERSONAJE.has(id))

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
