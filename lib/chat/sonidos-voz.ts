/**
 * LOS SONIDOS DE LA JUNTA DE VOZ Y DE LAS LLAMADAS — sin ficheros: se sintetizan con Web Audio (como el tono de llamada de siempre), así no hay nada que descargar y suenan al instante.
 *
 *   · entrar / salir          lo oyes tú al entrar a una junta o dejarla
 *   · otro-entra / otro-sale  lo oye quien ya está dentro cuando alguien entra o sale (más suave que el tuyo, como en Discord)
 *   · mute / unmute           tu micrófono
 *   · ensordecer / oir        dejar de oír a todos y volver a oír
 *   · llamando                el tono que oye quien llama mientras el otro no contesta
 *   · tono de llamada         el que suena cuando te llaman (iniciarTonoDeLlamada)
 *
 * Cada persona los puede apagar en «Ajustes de audio → Sonidos de la junta» (el tono de LLAMADA no se apaga con eso: es lo que avisa de que te llaman). Las notas se comprueban en
 * sonidos-voz.prueba.ts; lo que suena de verdad solo se puede oír.
 */

export type SonidoDeVoz = 'entrar' | 'salir' | 'otro-entra' | 'otro-sale' | 'mute' | 'unmute' | 'ensordecer' | 'oir' | 'llamando'

export interface Nota {
  /** Frecuencia en Hz */
  f: number
  /** Cuándo empieza, en segundos desde el principio del sonido */
  t: number
  /** Cuánto dura, en segundos */
  d: number
  /** Volumen (0 a 1) */
  g: number
  onda: OscillatorType
}

const nota = (f: number, t: number, d: number, g: number, onda: OscillatorType = 'sine'): Nota => ({ f, t, d, g, onda })

const NOTAS: Record<SonidoDeVoz, readonly Nota[]> = {
  entrar: [nota(523.25, 0, 0.13, 0.16, 'triangle'), nota(783.99, 0.11, 0.24, 0.16, 'triangle')],
  salir: [nota(659.25, 0, 0.13, 0.15, 'triangle'), nota(392, 0.11, 0.26, 0.15, 'triangle')],
  'otro-entra': [nota(587.33, 0, 0.1, 0.085), nota(880, 0.09, 0.18, 0.085)],
  'otro-sale': [nota(698.46, 0, 0.1, 0.085), nota(440, 0.09, 0.2, 0.085)],
  mute: [nota(440, 0, 0.09, 0.13, 'triangle'), nota(330, 0.08, 0.13, 0.13, 'triangle')],
  unmute: [nota(330, 0, 0.09, 0.13, 'triangle'), nota(494, 0.08, 0.13, 0.13, 'triangle')],
  ensordecer: [nota(392, 0, 0.1, 0.13, 'triangle'), nota(294, 0.09, 0.1, 0.13, 'triangle'), nota(220, 0.18, 0.18, 0.13, 'triangle')],
  oir: [nota(294, 0, 0.1, 0.13, 'triangle'), nota(392, 0.09, 0.1, 0.13, 'triangle'), nota(523.25, 0.18, 0.18, 0.13, 'triangle')],
  // El «ring» de quien llama: dos tonos a la vez, suave
  llamando: [nota(440, 0, 0.8, 0.05), nota(480, 0, 0.8, 0.05)],
}

/** Las notas de un sonido (para las pruebas) */
export const notasDe = (s: SonidoDeVoz): readonly Nota[] => NOTAS[s]
export const duracionDe = (s: SonidoDeVoz): number => Math.max(...NOTAS[s].map((n) => n.t + n.d))

/** Cada cuánto vuelve a sonar el «llamando», y hasta cuándo */
export const CADA_LLAMANDO_MS = 3_500
export const MAX_LLAMANDO_MS = 40_000

let contexto: AudioContext | null = null
let activos = true
let salida = ''

function crear(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (contexto && contexto.state !== 'closed') return contexto
  try {
    const Clase = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Clase) return null
    contexto = new Clase()
    aplicarSalida()
    return contexto
  } catch {
    return null
  }
}

/** Si la persona ha elegido altavoz para las juntas, los sonidos salen por el mismo (donde el navegador lo permite) */
function aplicarSalida(): void {
  const c = contexto as (AudioContext & { setSinkId?: (id: string) => Promise<void> }) | null
  if (!c?.setSinkId) return
  void c.setSinkId(salida || '').catch(() => undefined)
}

/** Lo que decide cada persona: si suenan los sonidos de la junta y por qué altavoz */
export function ponerSonidosDeVoz(ajustes: { activos: boolean; salida: string }): void {
  activos = ajustes.activos
  const cambia = salida !== ajustes.salida
  salida = ajustes.salida
  if (cambia) aplicarSalida()
}

/**
 * El navegador no deja sonar nada hasta que la persona toca la página: se prepara el audio con el primer clic, toque o tecla (y se vuelve a despertar si el navegador lo duerme).
 * Devuelve cómo quitar los oyentes.
 */
export function prepararSonidosDeVoz(): () => void {
  if (typeof window === 'undefined') return () => undefined
  const despertar = () => {
    const c = crear()
    if (c && c.state === 'suspended') void c.resume().catch(() => undefined)
  }
  const eventos = ['pointerdown', 'keydown', 'touchstart'] as const
  for (const e of eventos) window.addEventListener(e, despertar, { passive: true })
  return () => {
    for (const e of eventos) window.removeEventListener(e, despertar)
  }
}

function tocar(notas: readonly Nota[], volumen = 1): void {
  const c = crear()
  if (!c) return
  if (c.state === 'suspended') void c.resume().catch(() => undefined)
  const t0 = c.currentTime + 0.01
  for (const n of notas) {
    try {
      const o = c.createOscillator()
      const g = c.createGain()
      o.type = n.onda
      o.frequency.value = n.f
      const pico = Math.max(0.0002, n.g * volumen)
      g.gain.setValueAtTime(0.0001, t0 + n.t)
      g.gain.exponentialRampToValueAtTime(pico, t0 + n.t + 0.015)
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + n.t + n.d)
      o.connect(g).connect(c.destination)
      o.start(t0 + n.t)
      o.stop(t0 + n.t + n.d + 0.04)
    } catch {
      /* un sonido que falla no debe romper la junta */
    }
  }
}

/** Un sonido de la junta (si la persona no los ha apagado) */
export function sonarVoz(s: SonidoDeVoz): void {
  if (!activos) return
  tocar(NOTAS[s])
}

/** El «llamando…» de quien llama: se repite hasta que se pare (cuando el otro entra) o pasen MAX_LLAMANDO_MS. Devuelve cómo pararlo */
export function iniciarLlamando(): () => void {
  if (!activos) return () => undefined
  let parado = false
  const tanda = () => {
    if (!parado) tocar(NOTAS.llamando)
  }
  tanda()
  const t = setInterval(tanda, CADA_LLAMANDO_MS)
  const tope = setTimeout(() => {
    parado = true
    clearInterval(t)
  }, MAX_LLAMANDO_MS)
  return () => {
    parado = true
    clearInterval(t)
    clearTimeout(tope)
  }
}

/** El tono de cuando te llaman: dos notas cada dos segundos. No depende del interruptor de los sonidos de la junta */
const TONO_DE_LLAMADA: readonly Nota[] = [nota(740, 0, 0.34, 0.14), nota(587.33, 0.4, 0.34, 0.14), nota(740, 0.8, 0.34, 0.14), nota(880, 1.2, 0.5, 0.14)]
export const CADA_TONO_DE_LLAMADA_MS = 3_000

export function iniciarTonoDeLlamada(): () => void {
  let parado = false
  const tanda = () => {
    if (!parado) tocar(TONO_DE_LLAMADA)
  }
  tanda()
  const t = setInterval(tanda, CADA_TONO_DE_LLAMADA_MS)
  return () => {
    parado = true
    clearInterval(t)
  }
}
export const notasDelTonoDeLlamada = (): readonly Nota[] => TONO_DE_LLAMADA
