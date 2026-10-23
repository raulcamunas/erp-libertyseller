import type { TipoDeEvento } from './ingesta'

/**
 * DE LAS FILAS DE UN DÍA A LO QUE SE PINTA: CUÁNDO ESTUVO ACTIVA UNA PERSONA Y EN QUÉ.
 * PURO. Se prueba en linea.prueba.ts.
 *
 * LA REGLA QUE LO ORDENA TODO: el tiempo se cuenta en MINUTOS ACTIVOS. El navegador manda un «sigo aquí» por minuto SOLO si
 * la persona ha tocado algo (ratón, teclado, desplazamiento) en los últimos dos minutos y la pestaña está a la vista, y
 * cada clic cuenta como actividad ese minuto. Un minuto con alguna de las dos señales es un minuto activo; el resto
 * —pestaña oculta, ordenador quieto, ventana cerrada— no suma. Así «tiempo activo» no se infla por dejar el ERP abierto.
 *
 *   · Un TRAMO es un periodo seguido de actividad: se une lo que está a menos de `HUECO_MAXIMO_MIN` minutos.
 *   · El tiempo de una PANTALLA son los minutos activos que pasó en ella (cada señal lleva la ruta en la que estaba).
 */

export interface EventoDeActividad {
  id: number
  /** Instante, en ms desde 1970 */
  t: number
  tipo: TipoDeEvento
  ruta: string | null
  detalle: string | null
  sesion: string | null
  /** De dónde y con qué se abrió: solo vienen en las filas de «sesion» y «login» */
  ip?: string | null
  agente?: string | null
}

export interface TramoActivo {
  desde: number
  /** Fin del último minuto activo del tramo (sin incluir) */
  hasta: number
}

export interface PantallaUsada {
  ruta: string
  minutos: number
  visitas: number
  clics: number
}

export interface DiaDeUnaPersona {
  /** El primer y el último momento con actividad (no cuenta salir de la pestaña) */
  primera: number | null
  ultima: number | null
  minutosActivos: number
  tramos: TramoActivo[]
  pantallas: PantallaUsada[]
  sesiones: number
  logins: number
  paginas: number
  clics: number
  /** Todo lo que pasó menos los «sigo aquí», en orden */
  registro: EventoDeActividad[]
}

/** Dos minutos activos con menos de esto de por medio son el mismo tramo (una pausa corta no lo parte) */
export const HUECO_MAXIMO_MIN = 3

const MIN = 60_000

/** ¿Este tipo de evento es la persona haciendo algo? (salir de la pestaña o volver no cuenta como hacer) */
const esHacer = (tipo: TipoDeEvento) => tipo !== 'oculta' && tipo !== 'visible'

export function construirDia(eventos: readonly EventoDeActividad[]): DiaDeUnaPersona {
  const ordenados = [...eventos].sort((a, b) => a.t - b.t || a.id - b.id)

  let primera: number | null = null
  let ultima: number | null = null
  let sesiones = 0
  let logins = 0
  let paginas = 0
  let clics = 0
  const minutosActivos = new Map<number, string | null>()
  const visitas = new Map<string, number>()
  const clicsPorRuta = new Map<string, number>()
  const registro: EventoDeActividad[] = []

  for (const e of ordenados) {
    if (esHacer(e.tipo)) {
      if (primera === null) primera = e.t
      ultima = e.t
    }
    if (e.tipo === 'sesion') sesiones++
    if (e.tipo === 'login') logins++
    if (e.tipo === 'pagina') {
      paginas++
      if (e.ruta) visitas.set(e.ruta, (visitas.get(e.ruta) ?? 0) + 1)
    }
    if (e.tipo === 'clic') {
      clics++
      if (e.ruta) clicsPorRuta.set(e.ruta, (clicsPorRuta.get(e.ruta) ?? 0) + 1)
    }
    if (e.tipo === 'latido' || e.tipo === 'clic') {
      const minuto = Math.floor(e.t / MIN)
      // La ruta de ese minuto es la primera que se vio en él
      if (!minutosActivos.has(minuto) || minutosActivos.get(minuto) === null) minutosActivos.set(minuto, e.ruta)
    }
    if (e.tipo !== 'latido') registro.push(e)
  }

  // Los tramos: minutos activos seguidos, tolerando una pausa corta
  const minutos = [...minutosActivos.keys()].sort((a, b) => a - b)
  const tramos: TramoActivo[] = []
  if (minutos.length > 0) {
    let inicio = minutos[0]
    let anterior = minutos[0]
    for (let i = 1; i < minutos.length; i++) {
      const m = minutos[i]
      if (m - anterior > HUECO_MAXIMO_MIN) {
        tramos.push({ desde: inicio * MIN, hasta: (anterior + 1) * MIN })
        inicio = m
      }
      anterior = m
    }
    tramos.push({ desde: inicio * MIN, hasta: (anterior + 1) * MIN })
  }

  // El tiempo de cada pantalla: sus minutos activos
  const porPantalla = new Map<string, PantallaUsada>()
  const dame = (ruta: string) => {
    let p = porPantalla.get(ruta)
    if (!p) {
      p = { ruta, minutos: 0, visitas: visitas.get(ruta) ?? 0, clics: clicsPorRuta.get(ruta) ?? 0 }
      porPantalla.set(ruta, p)
    }
    return p
  }
  for (const ruta of minutosActivos.values()) if (ruta) dame(ruta).minutos++
  // Una pantalla que se abrió y no llegó a sumar ni un minuto activo también se ve (con 0 min)
  for (const ruta of visitas.keys()) dame(ruta)
  const pantallas = [...porPantalla.values()].sort((a, b) => b.minutos - a.minutos || b.visitas - a.visitas || a.ruta.localeCompare(b.ruta))

  return { primera, ultima, minutosActivos: minutosActivos.size, tramos, pantallas, sesiones, logins, paginas, clics, registro }
}

/** Los nombres de las pantallas del ERP, por ruta: el prefijo más largo gana */
export function nombreDePantalla(ruta: string, conocidas: ReadonlyArray<{ route: string; name: string }>): string {
  if (ruta === '/dashboard') return 'Inicio'
  if (ruta.startsWith('/auth/login')) return 'Inicio de sesión'
  let mejor: { route: string; name: string } | null = null
  for (const a of conocidas) {
    if (a.route === '/dashboard') continue
    if (ruta === a.route || ruta.startsWith(`${a.route}/`)) {
      if (!mejor || a.route.length > mejor.route.length) mejor = a
    }
  }
  return mejor ? mejor.name : ruta
}
