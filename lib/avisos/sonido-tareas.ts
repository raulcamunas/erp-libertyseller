/**
 * EL SONIDO DE LOS AVISOS DE TAREAS (asignaciones, menciones, comentarios y fechas) Y LOS AVISOS DEL ESCRITORIO. Solo navegador.
 *
 * QUÉ SUENA. Si existe un fichero en `public/sonidos/` (`tarea.mp3`, `tarea.ogg` o `tarea.wav`, en ese orden) suena ese: así se puede poner el sonido que se quiera sin tocar
 * código, solo copiando el fichero (mejor corto, de uno o dos segundos). Si no hay ninguno, suena un «ding» de tres notas que suben, hecho en el momento con la API de audio
 * (distinto del «din-don» del correo, para saber de un oído qué ha llegado).
 *
 * EL NAVEGADOR NO DEJA SONAR hasta que la persona ha tocado la página una vez; si no, devuelve `bloqueado` y no suena (ver lib/avisos/sonido.ts, que explica lo mismo).
 *
 * LOS AVISOS DEL ESCRITORIO son las notificaciones del sistema (arriba a la derecha en Mac y Windows). Hay que pedir permiso una vez, a propósito, con un botón; solo salen si la
 * pestaña del ERP NO está a la vista (con ella delante basta el sonido y la campana) y funcionan mientras el ERP esté abierto en alguna pestaña. Para que lleguen con el ERP
 * cerrado hará falta otro camino (avisos push o Slack), que no está.
 */

import { SIN_SONIDO, interaccionDe, sonidoElegidoPara } from '@/lib/sonidos/biblioteca'
import { eleccionGuardada, reproducirSonido } from '@/lib/sonidos/reproductor'

const CLAVE_SONIDO = 'avisos:sonido-de-tareas'
const CLAVE_ESCRITORIO = 'avisos:escritorio-de-tareas'
const FICHEROS = ['/sonidos/tarea.mp3', '/sonidos/tarea.ogg', '/sonidos/tarea.wav'] as const
const SEGUNDOS_ENTRE_SONIDOS = 4
const NOTAS = [
  { hz: 523.25, empieza: 0, dura: 0.32 },
  { hz: 659.25, empieza: 0.11, dura: 0.32 },
  { hz: 783.99, empieza: 0.22, dura: 0.6 },
] as const
const VOLUMEN = 0.1

export type ResultadoDeSonidoDeTarea = 'sono' | 'silenciado' | 'repetido' | 'bloqueado' | 'sin_audio'

const hayNavegador = typeof window !== 'undefined'
const oyentes = new Set<() => void>()
const avisar = () => {
  for (const o of [...oyentes]) o()
}

function leer(clave: string, porDefecto: boolean): boolean {
  if (!hayNavegador) return porDefecto
  try {
    const v = window.localStorage.getItem(clave)
    return v === null ? porDefecto : v === '1'
  } catch {
    return porDefecto
  }
}
function guardar(clave: string, valor: boolean) {
  try {
    window.localStorage.setItem(clave, valor ? '1' : '0')
  } catch {
    // Sin almacenamiento: vale para esta sesión
  }
}

let sonidoActivo: boolean | null = null
export const sonidoDeTareasActivo = (): boolean => (sonidoActivo ??= leer(CLAVE_SONIDO, true))
export function ponerSonidoDeTareas(valor: boolean): void {
  sonidoActivo = valor
  guardar(CLAVE_SONIDO, valor)
  avisar()
}
export function suscribirSonidoDeTareas(oyente: () => void): () => void {
  oyentes.add(oyente)
  return () => {
    oyentes.delete(oyente)
  }
}

/* ---------- El fichero propio, si lo hay ---------- */

let ficheroElegido: string | null | undefined
async function buscarFichero(): Promise<string | null> {
  if (ficheroElegido !== undefined) return ficheroElegido
  for (const f of FICHEROS) {
    try {
      const r = await fetch(f, { method: 'HEAD', cache: 'no-store' })
      if (r.ok && (r.headers.get('content-type') ?? '').startsWith('audio')) {
        ficheroElegido = f
        return f
      }
    } catch {
      // Sin red: se sigue con el siguiente
    }
  }
  ficheroElegido = null
  return null
}

/* ---------- El «ding» de tres notas ---------- */

let contexto: AudioContext | null = null
function sintetizar(): ResultadoDeSonidoDeTarea | Promise<ResultadoDeSonidoDeTarea> {
  const Clase = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Clase) return 'sin_audio'
  contexto ??= new Clase()
  const c = contexto
  const tocar = (): ResultadoDeSonidoDeTarea => {
    if (c.state !== 'running') return 'bloqueado'
    const t0 = c.currentTime + 0.02
    for (const n of NOTAS) {
      const inicio = t0 + n.empieza
      const fin = inicio + n.dura
      const g = c.createGain()
      g.gain.setValueAtTime(0.0001, inicio)
      g.gain.linearRampToValueAtTime(VOLUMEN, inicio + 0.01)
      g.gain.exponentialRampToValueAtTime(0.0001, fin)
      g.connect(c.destination)
      const o = c.createOscillator()
      o.type = 'triangle'
      o.frequency.setValueAtTime(n.hz, inicio)
      o.connect(g)
      o.start(inicio)
      o.stop(fin + 0.05)
    }
    return 'sono'
  }
  if (c.state === 'running') return tocar()
  return c.resume().then(tocar, () => 'bloqueado' as const)
}

async function reproducir(): Promise<ResultadoDeSonidoDeTarea> {
  if (!hayNavegador) return 'sin_audio'
  // Lo que la persona ha elegido en la biblioteca de sonidos (selector «Sonidos»): el silencio no suena; otro sonido, ese; el de fábrica, el de siempre (fichero o «ding»)
  const elegido = sonidoElegidoPara(eleccionGuardada(), 'avisos')
  if (elegido === SIN_SONIDO) return 'silenciado'
  if (elegido !== interaccionDe('avisos')?.defecto) {
    const r = await reproducirSonido(elegido)
    if (r === 'sono') ultimoSonido = Date.now()
    return r === 'sono' ? 'sono' : r === 'bloqueado' ? 'bloqueado' : 'sin_audio'
  }
  const fichero = await buscarFichero()
  if (fichero) {
    try {
      const a = new Audio(fichero)
      a.volume = 0.7
      await a.play()
      ultimoSonido = Date.now()
      return 'sono'
    } catch {
      return 'bloqueado'
    }
  }
  const r = await sintetizar()
  if (r === 'sono') ultimoSonido = Date.now()
  return r
}

let ultimoSonido = 0
const sonados: string[] = []

/** Un aviso de tareas nuevo. `id` es su clave: si ya sonó por él (por el otro camino) no vuelve a sonar; tampoco dos veces en menos de cuatro segundos */
export async function sonarTarea(id?: string): Promise<ResultadoDeSonidoDeTarea> {
  if (!sonidoDeTareasActivo()) return 'silenciado'
  if (id !== undefined) {
    if (sonados.includes(id)) return 'repetido'
    sonados.push(id)
    if (sonados.length > 200) sonados.splice(0, sonados.length - 200)
  }
  if (ultimoSonido !== 0 && Date.now() - ultimoSonido < SEGUNDOS_ENTRE_SONIDOS * 1000) return 'repetido'
  return reproducir()
}

/** «Probar»: suena siempre que se pueda */
export const probarSonidoDeTarea = (): Promise<ResultadoDeSonidoDeTarea> => reproducir()

/** Si hay un fichero propio, cuál (para decírselo a la persona); null = el «ding» de siempre */
export const ficheroDeSonidoDeTarea = (): Promise<string | null> => buscarFichero()

/* ---------- Avisos del escritorio ---------- */

export const escritorioDisponible = (): boolean => hayNavegador && 'Notification' in window
export const escritorioActivo = (): boolean => escritorioDisponible() && Notification.permission === 'granted' && leer(CLAVE_ESCRITORIO, false)
export const escritorioDenegado = (): boolean => escritorioDisponible() && Notification.permission === 'denied'

/** Pide permiso (solo se puede desde un clic) y, si lo dan, deja los avisos encendidos */
export async function activarEscritorio(): Promise<'concedido' | 'denegado' | 'no_disponible'> {
  if (!escritorioDisponible()) return 'no_disponible'
  const permiso = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission()
  if (permiso !== 'granted') return 'denegado'
  guardar(CLAVE_ESCRITORIO, true)
  avisar()
  return 'concedido'
}

export function desactivarEscritorio(): void {
  guardar(CLAVE_ESCRITORIO, false)
  avisar()
}

/** Una notificación del sistema, solo si están activadas y la pestaña no se está viendo. Al pulsarla se vuelve al ERP y se abre lo que avisaba */
export function avisarEnEscritorio(titulo: string, cuerpo: string, ruta: string): void {
  if (!escritorioActivo() || document.visibilityState === 'visible') return
  try {
    const n = new Notification(titulo, { body: cuerpo, tag: ruta, icon: '/favicon.ico' })
    n.onclick = () => {
      window.focus()
      n.close()
      if (window.location.pathname + window.location.search !== ruta) window.location.assign(ruta)
    }
  } catch {
    // Algunos navegadores solo dejan crearlas desde el service worker: sin ello no se avisa y ya está
  }
}
