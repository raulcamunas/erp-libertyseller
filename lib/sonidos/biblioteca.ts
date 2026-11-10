/**
 * LA BIBLIOTECA DE SONIDOS DEL ERP — PURO. Un catálogo de sonidos (hechos con notas, sin ficheros que descargar) y la lista de INTERACCIONES que suenan (entrar a una junta, mutearte, que te
 * llamen, un correo nuevo…). Cada persona elige, desde el ERP, qué sonido suena en cada interacción; se guarda en su navegador (lib/sonidos/reproductor.ts). Se comprueba en biblioteca.prueba.ts.
 *
 * DOS FAMILIAS:
 *   · 'aviso'  un sonido corto (hasta ~1,3 s) que suena una vez: entrar, salir, mutear, un mensaje…
 *   · 'tono'   un sonido para repetir mientras algo espera: el «llamando…» de quien llama y el tono de cuando te llaman. Lleva `cada`: cada cuántos ms se repite.
 * Una interacción solo ofrece sonidos de su familia (un tono de llamada de 3 s no tiene sentido al mutearte).
 *
 * Dos sonidos de la biblioteca (los «de siempre») usan además el fichero que ya había en public/sonidos (correo.mp3, tarea.mp3) si existe; si no, suena su versión con notas.
 */

export type FamiliaDeSonido = 'aviso' | 'tono'
export type Onda = 'sine' | 'triangle' | 'square' | 'sawtooth'

export interface Nota {
  /** Frecuencia en Hz */
  f: number
  /** Si lleva, la frecuencia se desliza hasta esta (un «bloop», un láser) */
  fin?: number
  /** Cuándo empieza, en segundos desde el principio del sonido */
  t: number
  /** Cuánto dura, en segundos */
  d: number
  /** Volumen (0 a 1) */
  g: number
  onda: Onda
}

export interface SonidoDeBiblioteca {
  id: string
  nombre: string
  /** El grupo en que sale en el desplegable */
  grupo: string
  familia: FamiliaDeSonido
  notas: readonly Nota[]
  /** Solo en los tonos: cada cuántos ms se repite */
  cada?: number
  /** Si existe este fichero (en public/), suena en vez de las notas */
  fichero?: string
}

const n = (f: number, t: number, d: number, g: number, onda: Onda = 'sine', fin?: number): Nota => (fin === undefined ? { f, t, d, g, onda } : { f, fin, t, d, g, onda })

const aviso = (id: string, nombre: string, grupo: string, notas: readonly Nota[], fichero?: string): SonidoDeBiblioteca => ({ id, nombre, grupo, familia: 'aviso', notas, ...(fichero ? { fichero } : {}) })
const tono = (id: string, nombre: string, notas: readonly Nota[], cada: number): SonidoDeBiblioteca => ({ id, nombre, grupo: 'Tonos de llamada', familia: 'tono', notas, cada })

export const BIBLIOTECA: readonly SonidoDeBiblioteca[] = [
  // Los de siempre (los que ya había en el ERP)
  aviso('din-don-correo', 'Din-don del correo', 'Los de siempre', [n(659.25, 0, 0.45, 0.09), n(523.25, 0.36, 0.75, 0.09)], '/sonidos/correo.mp3'),
  aviso('ding-tareas', 'Ding de las tareas', 'Los de siempre', [n(523.25, 0, 0.32, 0.1, 'triangle'), n(659.25, 0.11, 0.32, 0.1, 'triangle'), n(783.99, 0.22, 0.6, 0.1, 'triangle')], '/sonidos/tarea.mp3'),

  // Estilo chat
  aviso('subida', 'Subida', 'Estilo chat', [n(523.25, 0, 0.13, 0.16, 'triangle'), n(783.99, 0.11, 0.24, 0.16, 'triangle')]),
  aviso('bajada', 'Bajada', 'Estilo chat', [n(659.25, 0, 0.13, 0.15, 'triangle'), n(392, 0.11, 0.26, 0.15, 'triangle')]),
  aviso('doble-subida', 'Doble subida (suave)', 'Estilo chat', [n(587.33, 0, 0.1, 0.12), n(880, 0.09, 0.18, 0.12)]),
  aviso('doble-bajada', 'Doble bajada (suave)', 'Estilo chat', [n(698.46, 0, 0.1, 0.12), n(440, 0.09, 0.2, 0.12)]),
  aviso('pop', 'Pop', 'Estilo chat', [n(500, 0, 0.09, 0.16, 'sine', 1000)]),
  aviso('clic', 'Clic', 'Estilo chat', [n(1800, 0, 0.03, 0.1, 'square'), n(900, 0.025, 0.06, 0.1)]),
  aviso('tup-bajo', 'Tup grave (bajando)', 'Estilo chat', [n(440, 0, 0.09, 0.13, 'triangle'), n(330, 0.08, 0.13, 0.13, 'triangle')]),
  aviso('tup-alto', 'Tup agudo (subiendo)', 'Estilo chat', [n(330, 0, 0.09, 0.13, 'triangle'), n(494, 0.08, 0.13, 0.13, 'triangle')]),
  aviso('descenso-3', 'Descenso en tres notas', 'Estilo chat', [n(392, 0, 0.1, 0.13, 'triangle'), n(294, 0.09, 0.1, 0.13, 'triangle'), n(220, 0.18, 0.18, 0.13, 'triangle')]),
  aviso('ascenso-3', 'Ascenso en tres notas', 'Estilo chat', [n(294, 0, 0.1, 0.13, 'triangle'), n(392, 0.09, 0.1, 0.13, 'triangle'), n(523.25, 0.18, 0.18, 0.13, 'triangle')]),

  // Suaves
  aviso('gota', 'Gota', 'Suaves', [n(880, 0, 0.18, 0.14, 'sine', 560)]),
  aviso('burbuja', 'Burbuja', 'Suaves', [n(420, 0, 0.14, 0.15, 'sine', 900)]),
  aviso('campanilla', 'Campanilla', 'Suaves', [n(1046.5, 0, 0.55, 0.1), n(1568, 0.02, 0.45, 0.06)]),
  aviso('cristal', 'Cristal', 'Suaves', [n(1318.5, 0, 0.3, 0.09), n(1760, 0.08, 0.4, 0.08)]),
  aviso('pluma', 'Pluma', 'Suaves', [n(659.25, 0, 0.12, 0.1, 'triangle'), n(880, 0.1, 0.2, 0.1, 'triangle')]),

  // Cálidos
  aviso('marimba', 'Marimba', 'Cálidos', [n(523.25, 0, 0.25, 0.17, 'triangle'), n(1046.5, 0, 0.12, 0.06)]),
  aviso('madera', 'Madera', 'Cálidos', [n(330, 0, 0.12, 0.2, 'sine', 250), n(660, 0, 0.07, 0.07)]),
  aviso('din-don', 'Din-don largo', 'Cálidos', [n(659.25, 0, 0.4, 0.1), n(523.25, 0.32, 0.7, 0.1)]),
  aviso('arpa', 'Arpa', 'Cálidos', [n(392, 0, 0.25, 0.1), n(523.25, 0.07, 0.25, 0.1), n(659.25, 0.14, 0.25, 0.1), n(784, 0.21, 0.4, 0.1)]),
  aviso('arpa-inversa', 'Arpa inversa (bajando)', 'Cálidos', [n(784, 0, 0.25, 0.1), n(659.25, 0.07, 0.25, 0.1), n(523.25, 0.14, 0.25, 0.1), n(392, 0.21, 0.4, 0.1)]),

  // Digitales
  aviso('bip', 'Bip', 'Digitales', [n(880, 0, 0.09, 0.06, 'square')]),
  aviso('doble-bip', 'Doble bip', 'Digitales', [n(880, 0, 0.07, 0.06, 'square'), n(1175, 0.1, 0.09, 0.06, 'square')]),
  aviso('sintetizador', 'Sintetizador', 'Digitales', [n(523.25, 0, 0.1, 0.07, 'sawtooth'), n(659.25, 0.09, 0.1, 0.07, 'sawtooth'), n(784, 0.18, 0.2, 0.07, 'sawtooth')]),
  aviso('laser', 'Láser', 'Digitales', [n(1400, 0, 0.2, 0.06, 'square', 260)]),
  aviso('moneda', 'Moneda', 'Digitales', [n(988, 0, 0.08, 0.06, 'square'), n(1319, 0.08, 0.34, 0.06, 'square')]),

  // Tonos de llamada (se repiten)
  tono('clasico', 'Clásico', [n(740, 0, 0.34, 0.14), n(587.33, 0.4, 0.34, 0.14), n(740, 0.8, 0.34, 0.14), n(880, 1.2, 0.5, 0.14)], 3000),
  tono('ringback-suave', 'Línea de espera (suave)', [n(440, 0, 0.8, 0.05), n(480, 0, 0.8, 0.05)], 3500),
  tono('campanas', 'Campanas', [n(1046.5, 0, 0.6, 0.1), n(1318.5, 0.35, 0.6, 0.1), n(1568, 0.7, 0.9, 0.1)], 3500),
  tono('telefono-retro', 'Teléfono de siempre', [n(440, 0, 0.35, 0.06, 'square'), n(480, 0, 0.35, 0.06, 'square'), n(440, 0.5, 0.35, 0.06, 'square'), n(480, 0.5, 0.35, 0.06, 'square')], 3000),
  tono('sonar', 'Sónar', [n(1000, 0, 0.5, 0.12), n(1000, 0.45, 0.5, 0.06)], 3000),
  tono('melodia', 'Melodía', [n(659.25, 0, 0.18, 0.1, 'triangle'), n(783.99, 0.2, 0.18, 0.1, 'triangle'), n(880, 0.4, 0.18, 0.1, 'triangle'), n(783.99, 0.6, 0.18, 0.1, 'triangle'), n(1046.5, 0.8, 0.5, 0.1, 'triangle')], 3500),
  tono('pulso-grave', 'Pulso grave', [n(330, 0, 0.25, 0.16), n(330, 0.35, 0.25, 0.16)], 2500),
]

export const SONIDOS_DE_AVISO = BIBLIOTECA.filter((s) => s.familia === 'aviso')
export const SONIDOS_DE_TONO = BIBLIOTECA.filter((s) => s.familia === 'tono')

export const sonidoDeBiblioteca = (id: string): SonidoDeBiblioteca | undefined => BIBLIOTECA.find((s) => s.id === id)

/** El silencio: elegirlo en una interacción hace que no suene nada */
export const SIN_SONIDO = 'ninguno'

export type IdDeInteraccion =
  | 'avisos'
  | 'correo'
  | 'entrar'
  | 'salir'
  | 'otro-entra'
  | 'otro-sale'
  | 'mute'
  | 'unmute'
  | 'ensordecer'
  | 'oir'
  | 'puerta'
  | 'llamando'
  | 'llamada'

export interface Interaccion {
  id: IdDeInteraccion
  nombre: string
  cuando: string
  grupo: 'Avisos' | 'Junta de voz' | 'Llamadas'
  familia: FamiliaDeSonido
  /** El sonido de fábrica */
  defecto: string
  /** Cuánto suena respecto al volumen del sonido (lo que oyes de los demás, más suave que lo tuyo) */
  volumen: number
}

export const INTERACCIONES: readonly Interaccion[] = [
  { id: 'avisos', nombre: 'Mensajes del chat y avisos de tareas', cuando: 'Cuando te escribe alguien, te mencionan o te asignan una tarea', grupo: 'Avisos', familia: 'aviso', defecto: 'ding-tareas', volumen: 1 },
  { id: 'correo', nombre: 'Correo nuevo', cuando: 'Cuando llega un correo a tu buzón', grupo: 'Avisos', familia: 'aviso', defecto: 'din-don-correo', volumen: 1 },
  { id: 'entrar', nombre: 'Entras a una junta', cuando: 'Cuando entras a un canal de voz', grupo: 'Junta de voz', familia: 'aviso', defecto: 'subida', volumen: 1 },
  { id: 'salir', nombre: 'Sales de la junta', cuando: 'Cuando dejas el canal de voz', grupo: 'Junta de voz', familia: 'aviso', defecto: 'bajada', volumen: 1 },
  { id: 'otro-entra', nombre: 'Alguien entra', cuando: 'Lo oyes si ya estás dentro y entra otra persona', grupo: 'Junta de voz', familia: 'aviso', defecto: 'doble-subida', volumen: 0.7 },
  { id: 'otro-sale', nombre: 'Alguien sale', cuando: 'Lo oyes si ya estás dentro y sale otra persona', grupo: 'Junta de voz', familia: 'aviso', defecto: 'doble-bajada', volumen: 0.7 },
  { id: 'mute', nombre: 'Te silencias', cuando: 'Cuando apagas tu micrófono', grupo: 'Junta de voz', familia: 'aviso', defecto: 'tup-bajo', volumen: 1 },
  { id: 'unmute', nombre: 'Te desmuteas', cuando: 'Cuando enciendes tu micrófono', grupo: 'Junta de voz', familia: 'aviso', defecto: 'tup-alto', volumen: 1 },
  { id: 'ensordecer', nombre: 'Te ensordeces', cuando: 'Cuando dejas de oír a todos', grupo: 'Junta de voz', familia: 'aviso', defecto: 'descenso-3', volumen: 1 },
  { id: 'oir', nombre: 'Vuelves a oír', cuando: 'Cuando quitas el ensordecer', grupo: 'Junta de voz', familia: 'aviso', defecto: 'ascenso-3', volumen: 1 },
  { id: 'puerta', nombre: 'Tocan la puerta', cuando: 'Cuando alguien pide entrar a tu sala de voz con candado', grupo: 'Junta de voz', familia: 'aviso', defecto: 'campanilla', volumen: 1 },
  { id: 'llamando', nombre: 'Estás llamando', cuando: 'Lo oyes tú mientras la otra persona no contesta', grupo: 'Llamadas', familia: 'tono', defecto: 'ringback-suave', volumen: 1 },
  { id: 'llamada', nombre: 'Te llaman', cuando: 'El tono cuando alguien te llama por el chat', grupo: 'Llamadas', familia: 'tono', defecto: 'clasico', volumen: 1 },
]

export const interaccionDe = (id: string): Interaccion | undefined => INTERACCIONES.find((i) => i.id === id)

/** Lo que ha elegido la persona: interacción → id de sonido (o SIN_SONIDO). Lo que no esté, es el de fábrica */
export type Eleccion = Readonly<Partial<Record<IdDeInteraccion, string>>>

export const CLAVE_DE_ELECCION = 'sonidos:eleccion'

/** Lo leído del almacenamiento, limpio: un sonido que ya no existe o que es de otra familia se ignora (vuelve al de fábrica) */
export function limpiarEleccion(bruto: unknown): Eleccion {
  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) return {}
  const salida: Partial<Record<IdDeInteraccion, string>> = {}
  for (const i of INTERACCIONES) {
    const v = (bruto as Record<string, unknown>)[i.id]
    if (typeof v !== 'string') continue
    if (v === SIN_SONIDO) {
      salida[i.id] = SIN_SONIDO
      continue
    }
    const s = sonidoDeBiblioteca(v)
    if (s && s.familia === i.familia) salida[i.id] = v
  }
  return salida
}

export function leerEleccion(texto: string | null | undefined): Eleccion {
  if (!texto) return {}
  try {
    return limpiarEleccion(JSON.parse(texto))
  } catch {
    return {}
  }
}

/** El sonido que suena en una interacción: el elegido, el de fábrica, o SIN_SONIDO */
export function sonidoElegidoPara(eleccion: Eleccion, id: IdDeInteraccion): string {
  const i = interaccionDe(id)
  if (!i) return SIN_SONIDO
  return eleccion[id] ?? i.defecto
}

/** ¿Está el sonido de fábrica? (los módulos de siempre —correo y tareas— conservan entonces su camino de siempre) */
export const esDeFabrica = (eleccion: Eleccion, id: IdDeInteraccion): boolean => sonidoElegidoPara(eleccion, id) === interaccionDe(id)?.defecto

/** Las notas de un sonido, o ninguna si es el silencio o no existe */
export function notasDeSonido(id: string): readonly Nota[] {
  return sonidoDeBiblioteca(id)?.notas ?? []
}

export const duracionDeSonido = (id: string): number => Math.max(0, ...notasDeSonido(id).map((x) => x.t + x.d))
