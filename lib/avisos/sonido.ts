/**
 * EL SONIDO SUAVE QUE AVISA DE UN CORREO NUEVO, PARA DEJAR EL ERP EN SEGUNDO PLANO.
 * ================================================================================
 * Solo navegador. La lógica va con las piezas del navegador (el audio, el reloj, el almacenamiento) inyectadas, para poder comprobarla con sonido.prueba.ts sin
 * navegador. Al final del fichero está la instancia de verdad, que usan AvisosEnVivo y la campana.
 *
 * QUÉ SUENA. Un «din-don» corto y bajo (dos notas, poco más de un segundo en total, con un volumen que se oye sin sobresaltar), sintetizado en el momento con la API de
 * audio del navegador: no hay ningún fichero de sonido que descargar. Suena UNA vez por correo, aunque lleguen varios a la vez o el mismo lo anuncien dos caminos
 * (el aviso en vivo y la campana): se recuerda el id de cada correo y, además, nunca suena dos veces en menos de doce segundos.
 *
 * QUÉ NO. No suena con un rebote ni con una noticia del equipo: es para lo que hay que contestar. Y se puede apagar (campana → «Sonido al llegar un correo»);
 * lo elegido se guarda en este navegador.
 *
 * EL NAVEGADOR NO DEJA SONAR NADA HASTA QUE LA PERSONA HA TOCADO LA PÁGINA UNA VEZ (política de reproducción automática). Por eso el audio se prepara con el primer
 * clic, toque o tecla de la sesión; a partir de ahí suena también con la pestaña oculta o detrás de otra ventana, que es para lo que sirve. Si el navegador lo sigue
 * bloqueando (nadie ha tocado la página desde que se abrió), no suena y se dice «bloqueado»: no hay forma de saltárselo ni se debe intentar.
 */

export interface NodoDeAudio {
  connect(destino: unknown): unknown
}

export interface ParametroDeAudio {
  value: number
  setValueAtTime(valor: number, t: number): unknown
  linearRampToValueAtTime(valor: number, t: number): unknown
  exponentialRampToValueAtTime(valor: number, t: number): unknown
}

export interface OsciladorDeAudio extends NodoDeAudio {
  type: string
  frequency: ParametroDeAudio
  start(t?: number): void
  stop(t?: number): void
}

export interface GananciaDeAudio extends NodoDeAudio {
  gain: ParametroDeAudio
}

/** Lo poco que se usa de AudioContext */
export interface ContextoDeAudio {
  readonly state: string
  readonly currentTime: number
  readonly destination: unknown
  resume(): Promise<void>
  createOscillator(): OsciladorDeAudio
  createGain(): GananciaDeAudio
}

export interface DepsDeSonido {
  /** Un contexto de audio nuevo, o null si el navegador no tiene */
  crearContexto(): ContextoDeAudio | null
  ahora(): number
  /** ¿La persona ya ha tocado la página en esta sesión? Con eso el navegador deja sonar */
  yaHuboGesto(): boolean
  /** Para estar atento al primer gesto: devuelve cómo dejar de estarlo */
  alPrimerGesto(manejador: () => void): () => void
  /** La preferencia guardada: true = suena (por defecto) */
  leerPreferencia(): boolean
  guardarPreferencia(suena: boolean): void
}

export type ResultadoDeSonar = 'sono' | 'silenciado' | 'repetido' | 'bloqueado' | 'sin_audio'

/** Las notas del «din-don»: frecuencia (Hz), cuándo empieza (s) y cuánto dura (s) */
export const NOTAS_DEL_AVISO: ReadonlyArray<{ hz: number; empieza: number; dura: number }> = [
  { hz: 659.25, empieza: 0, dura: 0.5 },
  { hz: 880, empieza: 0.16, dura: 0.9 },
]
/** El volumen máximo de cada nota (0 a 1): bajo a propósito, es un aviso para dejar de fondo, no una alarma */
export const VOLUMEN_DEL_AVISO = 0.09
const SOBRETONO = 0.18
/** Pasados estos segundos de silencio, no vuelve a sonar por el mismo motivo */
export const SEGUNDOS_ENTRE_SONIDOS = 12
const MAX_CORREOS_RECORDADOS = 200

export function crearSonido(deps: DepsDeSonido) {
  let contexto: ContextoDeAudio | null = null
  let preparado = false
  let quitarOyente: (() => void) | null = null
  let suena: boolean | null = null
  let ultimoSonido = 0
  const sonados: string[] = []
  const oyentes = new Set<() => void>()

  const activo = (): boolean => {
    if (suena === null) suena = deps.leerPreferencia()
    return suena
  }

  function obtenerContexto(): ContextoDeAudio | null {
    if (!contexto) contexto = deps.crearContexto()
    return contexto
  }

  /** Deja el audio listo para cuando haga falta. Se llama una vez al abrir el ERP: con el primer gesto de la persona se desbloquea */
  function preparar(): () => void {
    if (preparado) return () => undefined
    preparado = true
    const desbloquear = () => {
      quitarOyente?.()
      quitarOyente = null
      const c = obtenerContexto()
      if (c && c.state !== 'running') void c.resume().catch(() => undefined)
    }
    if (deps.yaHuboGesto()) desbloquear()
    else quitarOyente = deps.alPrimerGesto(desbloquear)
    return () => {
      quitarOyente?.()
      quitarOyente = null
      preparado = false
    }
  }

  function tocar(c: ContextoDeAudio): void {
    const t0 = c.currentTime + 0.02
    for (const nota of NOTAS_DEL_AVISO) {
      const inicio = t0 + nota.empieza
      const fin = inicio + nota.dura
      // Cada nota: el tono y, muy flojo, su octava, para que no suene a pitido seco
      const volumen = c.createGain()
      volumen.gain.setValueAtTime(0.0001, inicio)
      volumen.gain.linearRampToValueAtTime(VOLUMEN_DEL_AVISO, inicio + 0.012)
      volumen.gain.exponentialRampToValueAtTime(0.0001, fin)
      volumen.connect(c.destination)
      for (const [multiplo, parte] of [
        [1, 1],
        [2, SOBRETONO],
      ] as const) {
        const o = c.createOscillator()
        o.type = 'sine'
        o.frequency.setValueAtTime(nota.hz * multiplo, inicio)
        const g = c.createGain()
        g.gain.setValueAtTime(parte, inicio)
        o.connect(g)
        g.connect(volumen)
        o.start(inicio)
        o.stop(fin + 0.05)
      }
    }
  }

  /** Reproduce el aviso ahora mismo (lo usa «Probar» y lo que viene detrás de las comprobaciones). Devuelve si ha podido sonar */
  async function reproducir(): Promise<'sono' | 'bloqueado' | 'sin_audio'> {
    const c = obtenerContexto()
    if (!c) return 'sin_audio'
    if (c.state !== 'running') {
      try {
        await c.resume()
      } catch {
        return 'bloqueado'
      }
      if (c.state !== 'running') return 'bloqueado'
    }
    tocar(c)
    ultimoSonido = deps.ahora()
    return 'sono'
  }

  /**
   * Un correo nuevo. `id` es el del correo: si ya sonó por él (por el otro camino), no vuelve a sonar. Sin `id` solo vale la regla de los doce segundos.
   */
  async function sonarCorreo(id?: string): Promise<ResultadoDeSonar> {
    if (!activo()) return 'silenciado'
    if (id !== undefined) {
      if (sonados.includes(id)) return 'repetido'
      sonados.push(id)
      if (sonados.length > MAX_CORREOS_RECORDADOS) sonados.splice(0, sonados.length - MAX_CORREOS_RECORDADOS)
    }
    if (ultimoSonido !== 0 && deps.ahora() - ultimoSonido < SEGUNDOS_ENTRE_SONIDOS * 1000) return 'repetido'
    return reproducir()
  }

  /** «Probar»: suena siempre que se pueda, esté o no apagado el aviso y haya sonado hace un momento */
  const probar = (): Promise<'sono' | 'bloqueado' | 'sin_audio'> => reproducir()

  function poner(valor: boolean): void {
    suena = valor
    deps.guardarPreferencia(valor)
    for (const o of [...oyentes]) o()
  }

  function suscribir(oyente: () => void): () => void {
    oyentes.add(oyente)
    return () => {
      oyentes.delete(oyente)
    }
  }

  /** Otra pestaña ha cambiado la preferencia: se adopta */
  function adoptar(valor: boolean): void {
    suena = valor
    for (const o of [...oyentes]) o()
  }

  return { preparar, sonarCorreo, probar, activo, poner, suscribir, adoptar }
}

/* ------------------------------------------------------------------ */
/* La instancia de verdad, en el navegador                             */
/* ------------------------------------------------------------------ */

const CLAVE = 'avisos:sonido-de-correo'

interface VentanaConAudio {
  AudioContext?: new () => ContextoDeAudio
  webkitAudioContext?: new () => ContextoDeAudio
}

const hayNavegador = typeof window !== 'undefined'

const sonido = hayNavegador
  ? crearSonido({
      crearContexto() {
        const w = window as unknown as VentanaConAudio
        const Clase = w.AudioContext ?? w.webkitAudioContext
        if (!Clase) return null
        try {
          return new Clase()
        } catch {
          return null
        }
      },
      ahora: () => Date.now(),
      yaHuboGesto() {
        // Chrome y Safari lo dicen; Firefox no lo expone y cuenta con el primer gesto de esta sesión
        return (navigator as unknown as { userActivation?: { hasBeenActive?: boolean } }).userActivation?.hasBeenActive === true
      },
      alPrimerGesto(manejador) {
        const eventos = ['pointerdown', 'keydown', 'touchstart'] as const
        const una = () => manejador()
        for (const e of eventos) window.addEventListener(e, una, { capture: true, passive: true, once: true })
        return () => {
          for (const e of eventos) window.removeEventListener(e, una, { capture: true })
        }
      },
      leerPreferencia() {
        try {
          // Apagado solo si se apagó a propósito: lo que no esté guardado es «suena»
          return window.localStorage.getItem(CLAVE) !== '0'
        } catch {
          return true
        }
      },
      guardarPreferencia(suena) {
        try {
          if (suena) window.localStorage.removeItem(CLAVE)
          else window.localStorage.setItem(CLAVE, '0')
        } catch {
          // Sin almacenamiento: vale para esta sesión
        }
      },
    })
  : null

if (hayNavegador && sonido) {
  // Otra pestaña lo cambia: esta se entera
  window.addEventListener('storage', (e) => {
    if (e.key === CLAVE) sonido.adoptar(e.newValue !== '0')
  })
}

export const prepararSonido = (): (() => void) => sonido?.preparar() ?? (() => undefined)
export const sonarCorreo = (id?: string): Promise<ResultadoDeSonar> => sonido?.sonarCorreo(id) ?? Promise.resolve('sin_audio')
export const probarSonido = (): Promise<'sono' | 'bloqueado' | 'sin_audio'> => sonido?.probar() ?? Promise.resolve('sin_audio')
export const sonidoDeCorreoActivo = (): boolean => sonido?.activo() ?? true
export const ponerSonidoDeCorreo = (valor: boolean): void => sonido?.poner(valor)
export const suscribirSonido = (oyente: () => void): (() => void) => sonido?.suscribir(oyente) ?? (() => undefined)
