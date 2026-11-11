/**
 * EL REPRODUCTOR DE LA BIBLIOTECA DE SONIDOS — solo navegador. Toca lo que cada persona ha elegido para cada interacción (lib/sonidos/biblioteca.ts), con un único contexto de audio
 * compartido que se despierta con el primer clic, toque o tecla (el navegador no deja sonar antes). Lo elegido se guarda en el navegador (localStorage) y se sincroniza entre pestañas.
 *
 * Los sonidos con fichero (los «de siempre») prueban primero el fichero de public/sonidos y, si no existe, suenan con notas. Un sonido que falla nunca rompe lo que se estaba haciendo.
 */

import {
  CLAVE_DE_ELECCION,
  SIN_SONIDO,
  interaccionDe,
  leerEleccion,
  sonidoDeBiblioteca,
  sonidoElegidoPara,
  type Eleccion,
  type IdDeInteraccion,
  type Nota,
} from './biblioteca'

export type ResultadoDeReproducir = 'sono' | 'silencio' | 'bloqueado' | 'no_hay'

const hayNavegador = typeof window !== 'undefined'
let contexto: AudioContext | null = null
let salida = ''
let eleccion: Eleccion | null = null
const oyentes = new Set<() => void>()
const sinFichero = new Set<string>()

const avisar = () => {
  for (const o of [...oyentes]) o()
}

/* ---------- Lo elegido ---------- */

export function eleccionGuardada(): Eleccion {
  if (eleccion) return eleccion
  try {
    eleccion = hayNavegador ? leerEleccion(window.localStorage.getItem(CLAVE_DE_ELECCION)) : {}
  } catch {
    eleccion = {}
  }
  return eleccion
}

function guardar(nueva: Eleccion) {
  eleccion = nueva
  try {
    if (Object.keys(nueva).length === 0) window.localStorage.removeItem(CLAVE_DE_ELECCION)
    else window.localStorage.setItem(CLAVE_DE_ELECCION, JSON.stringify(nueva))
  } catch {
    /* sin almacenamiento: vale para esta sesión */
  }
  avisar()
}

/** Elige el sonido de una interacción. Elegir el de fábrica deja de guardarlo */
export function elegirSonido(id: IdDeInteraccion, sonido: string): void {
  const nueva: Partial<Record<IdDeInteraccion, string>> = { ...eleccionGuardada() }
  if (sonido === interaccionDe(id)?.defecto) delete nueva[id]
  else nueva[id] = sonido
  guardar(nueva)
}

export function restablecerSonidos(): void {
  guardar({})
}

export function suscribirEleccion(oyente: () => void): () => void {
  oyentes.add(oyente)
  return () => {
    oyentes.delete(oyente)
  }
}

if (hayNavegador) {
  // Otra pestaña la cambia: esta se entera
  window.addEventListener('storage', (e) => {
    if (e.key === CLAVE_DE_ELECCION) {
      eleccion = null
      avisar()
    }
  })
}

/* ---------- El audio ---------- */

function crear(): AudioContext | null {
  if (!hayNavegador) return null
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
function aplicarSalida() {
  const c = contexto as (AudioContext & { setSinkId?: (id: string) => Promise<void> }) | null
  if (c?.setSinkId) void c.setSinkId(salida || '').catch(() => undefined)
}

export function ponerSalidaDeAudio(id: string): void {
  if (id === salida) return
  salida = id
  aplicarSalida()
}

/** El navegador solo deja sonar tras el primer toque en la página: se prepara el audio con el primer clic, toque o tecla. Devuelve cómo quitar los oyentes */
export function prepararAudio(): () => void {
  if (!hayNavegador) return () => undefined
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

function tocarNotas(notas: readonly Nota[], volumen: number): ResultadoDeReproducir {
  const c = crear()
  if (!c) return 'bloqueado'
  if (c.state === 'suspended') void c.resume().catch(() => undefined)
  const t0 = c.currentTime + 0.01
  for (const n of notas) {
    try {
      const o = c.createOscillator()
      const g = c.createGain()
      o.type = n.onda
      o.frequency.setValueAtTime(n.f, t0 + n.t)
      if (n.fin !== undefined) o.frequency.exponentialRampToValueAtTime(n.fin, t0 + n.t + n.d)
      const pico = Math.max(0.0002, n.g * volumen)
      g.gain.setValueAtTime(0.0001, t0 + n.t)
      g.gain.exponentialRampToValueAtTime(pico, t0 + n.t + 0.015)
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + n.t + n.d)
      o.connect(g).connect(c.destination)
      o.start(t0 + n.t)
      o.stop(t0 + n.t + n.d + 0.04)
    } catch {
      /* un sonido que falla no debe romper lo que se estaba haciendo */
    }
  }
  return 'sono'
}

/** Un <audio> con el fichero, por el altavoz elegido (donde el navegador lo permite) */
function audioDe(url: string, volumen: number): HTMLAudioElement {
  const a = new Audio(url)
  a.volume = Math.min(1, 0.7 * volumen)
  const conSalida = a as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }
  if (salida && conSalida.setSinkId) void conSalida.setSinkId(salida).catch(() => undefined)
  return a
}

async function tocarFichero(url: string, volumen: number): Promise<'sono' | 'bloqueado' | 'fallo'> {
  if (sinFichero.has(url)) return 'fallo'
  try {
    const a = audioDe(url, volumen)
    await a.play()
    return 'sono'
  } catch (e) {
    if ((e as { name?: string })?.name === 'NotAllowedError') return 'bloqueado'
    sinFichero.add(url)
    return 'fallo'
  }
}

/* ---------- Tocar ---------- */

/** Toca un sonido de la biblioteca (para escucharlo o para una interacción) */
export async function reproducirSonido(id: string, volumen = 1): Promise<ResultadoDeReproducir> {
  const s = sonidoDeBiblioteca(id)
  if (!s) return 'no_hay'
  if (s.fichero) {
    const r = await tocarFichero(s.fichero, volumen)
    if (r !== 'fallo') return r === 'sono' ? 'sono' : 'bloqueado'
  }
  return tocarNotas(s.notas, volumen)
}

/** Toca lo que la persona ha elegido para una interacción (o nada, si eligió el silencio) */
export async function reproducirInteraccion(id: IdDeInteraccion): Promise<ResultadoDeReproducir> {
  const i = interaccionDe(id)
  if (!i) return 'no_hay'
  const elegido = sonidoElegidoPara(eleccionGuardada(), id)
  if (elegido === SIN_SONIDO) return 'silencio'
  return reproducirSonido(elegido, i.volumen)
}

/** Un tono que se repite (el «llamando…» y el de cuando te llaman) hasta que se pare, o hasta `max` ms. Devuelve cómo pararlo */
export function iniciarBucle(id: IdDeInteraccion, opciones: { max?: number } = {}): () => void {
  const i = interaccionDe(id)
  const elegido = sonidoElegidoPara(eleccionGuardada(), id)
  const s = elegido === SIN_SONIDO ? undefined : sonidoDeBiblioteca(elegido)
  if (!i || !s) return () => undefined
  // Con fichero: el <audio> en bucle, sin huecos, y al parar se corta en seco (no sigue hasta acabar). Si el fichero falla, el tono con notas
  if (s.fichero && !sinFichero.has(s.fichero)) {
    const url = s.fichero
    const a = audioDe(url, i.volumen)
    a.loop = true
    let parado = false
    let pararNotas: (() => void) | null = null
    // El navegador aún no deja sonar (nadie ha tocado la página): suena en cuanto se toque algo, si sigue sonando
    const reintentar = () => {
      quitarReintento()
      if (!parado) void a.play().catch(() => undefined)
    }
    const quitarReintento = () => {
      for (const ev of ['pointerdown', 'keydown'] as const) window.removeEventListener(ev, reintentar)
    }
    void a.play().catch((e: { name?: string }) => {
      if (parado) return
      if (e?.name === 'NotAllowedError') {
        for (const ev of ['pointerdown', 'keydown'] as const) window.addEventListener(ev, reintentar, { passive: true })
        return
      }
      sinFichero.add(url)
      pararNotas = bucleDeNotas(s.id, i.volumen, s.cada ?? 3000, opciones.max)
    })
    const tope = opciones.max ? setTimeout(() => { parado = true; quitarReintento(); a.pause() }, opciones.max) : null
    return () => {
      parado = true
      quitarReintento()
      a.pause()
      a.removeAttribute('src')
      if (tope) clearTimeout(tope)
      pararNotas?.()
    }
  }
  return bucleDeNotas(s.id, i.volumen, s.cada ?? 3000, opciones.max)
}

function bucleDeNotas(id: string, volumen: number, cada: number, max?: number): () => void {
  const s = sonidoDeBiblioteca(id)
  if (!s) return () => undefined
  const tocar = () => tocarNotas(s.notas, volumen)
  let parado = false
  const tanda = () => {
    if (!parado) tocar()
  }
  tanda()
  const t = setInterval(tanda, cada)
  const tope = max ? setTimeout(() => { parado = true; clearInterval(t) }, max) : null
  return () => {
    parado = true
    clearInterval(t)
    if (tope) clearTimeout(tope)
  }
}
