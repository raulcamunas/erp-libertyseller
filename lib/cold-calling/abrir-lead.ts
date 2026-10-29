/**
 * ABRIR UN LEAD CONCRETO DE COLD CALLING DESDE FUERA DE LA PANTALLA — PURO.
 * =========================================================================
 * La ficha de una cita de la Agenda lleva un enlace al lead de Cold Calling del que viene (components/agenda/BuscadorDeClientes.tsx). Ese enlace es una dirección con el id del lead,
 * `/dashboard/cold-calling?lead=<id>`, y se abre en OTRA pestaña a propósito: la ficha de la cita puede tener cosas escritas sin guardar, y salir de ella en la misma pestaña las
 * perdería. Además así funciona el clic con Ctrl/Cmd y el «abrir en una pestaña nueva» de siempre.
 *
 * Cold Calling se monta una sola vez y solo trae LA CARTERA DE UNA PERSONA (components/cold-calling/useCartera.ts), así que «abrir el lead X» no es siempre seleccionar una fila
 * que ya está: puede que X sea de otra persona y quien mira supervise y esté viendo la cartera de una tercera. Esta función decide qué hacer en cada situación; el componente solo
 * ejecuta lo que dice (components/cold-calling/useAbrirLead.ts):
 *
 *   · ya está en la cartera que se mira           -> abrirlo.
 *   · la cartera todavía está llegando            -> esperar (no se puede decidir nada con una lista a medias).
 *   · no se sabe nada de él                       -> preguntar a la base si existe y de quién es (la RLS decide si lo deja ver).
 *   · la base dice que no existe, o no lo deja ver -> avisar. Un comercial no ve los leads de otro, y eso es una respuesta, no un error.
 *   · existe pero no está en la cartera que se mira -> quien supervisa va a la cartera de su dueño (o a la de todos, si no tiene dueño o su dueño no es del equipo); quien no, no puede.
 *
 * El cambio de cartera se hace UNA vez por enlace: si tras cambiar sigue sin aparecer, no se va y se viene.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const RUTA_DE_COLD_CALLING = '/dashboard/cold-calling'

/** El enlace a la ficha de un lead de Cold Calling. Es lo que lleva el nombre del lead en la ficha de la cita */
export function rutaDeLaFicha(leadId: string): string {
  return `${RUTA_DE_COLD_CALLING}?lead=${encodeURIComponent(leadId)}`
}

/** El lead que pide la dirección (`?lead=…`), si es un id de verdad. Cualquier otra cosa da null: un enlace a medio escribir no abre nada ni rompe la pantalla */
export function leadDeLaDireccion(busqueda: string): string | null {
  const valor = new URLSearchParams(busqueda).get('lead')?.trim() ?? ''
  return UUID.test(valor) ? valor.toLowerCase() : null
}

export interface SituacionAlAbrir {
  /** El lead ya está en la cartera que se está mirando */
  enCartera: boolean
  /** La cartera todavía está llegando */
  cargando: boolean
  /** Lo que la base dijo de él, si ya se le preguntó. `undefined` = todavía no se ha preguntado */
  enLaBase?: { existe: boolean; dueno: string | null }
  /** La cartera que se mira ahora: 'all' o el id de una persona */
  propietario: string
  /** ¿Puede cambiar de cartera? (quien supervisa) */
  puedeVerTodos: boolean
  /** Las personas del equipo cuya cartera se puede elegir */
  equipo: readonly string[]
  /** Ya se cambió de cartera una vez por este enlace */
  cambioHecho: boolean
}

export type QueHacer =
  | { accion: 'abrir' }
  | { accion: 'esperar' }
  | { accion: 'preguntar' }
  | { accion: 'cambiar-cartera'; a: string }
  | { accion: 'no-se-puede'; motivo: 'no-existe-o-ajeno' | 'fuera-de-la-cartera' }

export function queHacerConElLead(s: SituacionAlAbrir): QueHacer {
  if (s.enCartera) return { accion: 'abrir' }
  if (s.cargando) return { accion: 'esperar' }
  if (!s.enLaBase) return { accion: 'preguntar' }
  if (!s.enLaBase.existe) return { accion: 'no-se-puede', motivo: 'no-existe-o-ajeno' }

  if (s.puedeVerTodos && !s.cambioHecho) {
    const destino = s.enLaBase.dueno && s.equipo.includes(s.enLaBase.dueno) ? s.enLaBase.dueno : 'all'
    if (destino !== s.propietario) return { accion: 'cambiar-cartera', a: destino }
  }
  return { accion: 'no-se-puede', motivo: 'fuera-de-la-cartera' }
}

/** Lo que se le dice a quien pulsó el enlace cuando no se puede abrir */
export function avisoDeNoSePuede(motivo: 'no-existe-o-ajeno' | 'fuera-de-la-cartera' | 'sin-comprobar'): string {
  if (motivo === 'no-existe-o-ajeno') return 'No se ha podido abrir ese lead: ya no existe o no es de tu cartera.'
  if (motivo === 'fuera-de-la-cartera') return 'Ese lead existe, pero no está en la cartera que se está mirando.'
  return 'No se ha podido comprobar ese lead. Vuelve a abrirlo desde la cita.'
}
