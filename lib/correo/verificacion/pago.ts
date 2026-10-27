import type { NivelDePago } from './millionverifier'

/**
 * LAS REGLAS DE LA VERIFICACIÓN DE PAGO: QUÉ SE HACE CON LO QUE DICE EL SERVICIO — PURO.
 * =====================================================================================
 * No toca la base ni la red. Se comprueba con pago.prueba.ts. Lo que habla con el servicio y con la base está en pago-servidor.ts.
 *
 * LA IDEA, EN CINCO LÍNEAS:
 *   1. Antes de enviar el PRIMER correo a un lead, el ERP pregunta al servicio (MillionVerifier) si esa dirección existe. Una vez por dirección: la respuesta se
 *      guarda y los seguimientos, que salen a la misma dirección, no vuelven a preguntar ni a pagar.
 *   2. Si el servicio dice que NO existe (o es desechable), el correo no sale.
 *   3. Si dice que es DUDOSA (el servidor de esa empresa acepta cualquier dirección, así que no se puede confirmar), se hace lo que diga el ajuste: avisar y enviar
 *      (por defecto), enviar sin seguimientos automáticos, o no enviar.
 *   4. Si NO SE PUEDE comprobar (sin clave, sin créditos, el servicio no contesta), el correo sale igual: un fallo del servicio nunca deja al equipo sin poder
 *      escribir. Lo que sí se hace es avisar a los administradores cuando se acaban los créditos.
 *   5. Lo que no es una dirección de un cliente (los buzones del propio equipo) no se comprueba.
 */

export type PoliticaDeDudosas = 'avisar' | 'sin_seguimientos' | 'bloquear'
export const POLITICAS_DE_DUDOSAS: readonly PoliticaDeDudosas[] = ['avisar', 'sin_seguimientos', 'bloquear']
export const POLITICA_POR_DEFECTO: PoliticaDeDudosas = 'avisar'

export const ETIQUETA_DE_POLITICA: Record<PoliticaDeDudosas, { titulo: string; texto: string }> = {
  avisar: { titulo: 'Avisar y enviar', texto: 'El correo sale con sus seguimientos y se le dice a quien envía que no se pudo confirmar la dirección. Es lo recomendado: muchas empresas reales tienen un servidor que acepta todo.' },
  sin_seguimientos: { titulo: 'Enviar sin seguimientos', texto: 'El primer correo sale, pero no se programan seguimientos automáticos a esa dirección.' },
  bloquear: { titulo: 'No enviar', texto: 'El correo no sale. Perderás también empresas reales cuyo servidor no deja comprobar el buzón.' },
}

export const esPoliticaDeDudosas = (v: unknown): v is PoliticaDeDudosas => typeof v === 'string' && (POLITICAS_DE_DUDOSAS as readonly string[]).includes(v)

/* ------------------------------------------------------------------ */
/* Lo que se sabe de una dirección                                     */
/* ------------------------------------------------------------------ */

export type CausaDeNoComprobar = 'apagada' | 'sin_clave' | 'propia' | 'limite' | 'sin_creditos' | 'clave' | 'ip' | 'red' | 'otro'

/** De dónde sale lo que se sabe: del servicio (esta vez se ha preguntado), de lo guardado, de la memoria de rebotes o de una persona que la dio por buena */
export type OrigenDelVeredicto = 'servicio' | 'memoria' | 'rebote' | 'persona'

export interface VeredictoDePago {
  direccion: string
  nivel: NivelDePago
  /** ok · catch_all · unknown · disposable · invalid, o `rebotada` / `liberada` si viene de la memoria de direcciones */
  resultado: string
  detalle: string | null
  /** La corrección que propone el servicio para una errata («…@gmail.com» para «…@gmal.com») */
  sugerencia: string | null
  /** La frase para quien envía */
  motivo: string
  origen: OrigenDelVeredicto
  verificadaAt: number | null
}

export type ResultadoDeComprobar = { tipo: 'veredicto'; veredicto: VeredictoDePago } | { tipo: 'sin_comprobar'; causa: CausaDeNoComprobar; motivo: string }

/** Cuánto vale lo ya comprobado antes de volver a preguntar. Una dirección buena o mala no cambia de un día para otro; una dudosa se puede reintentar antes (no se cobra) */
export const VIGENCIA_EN_DIAS: Record<NivelDePago, number> = { buena: 365, mala: 365, dudosa: 90 }

export function estaVigente(nivel: NivelDePago, verificadaAt: number, ahora: number): boolean {
  return ahora - verificadaAt < VIGENCIA_EN_DIAS[nivel] * 86_400_000 && verificadaAt <= ahora + 60_000
}

/** ¿Es una dirección del propio equipo? Esas no se comprueban (no cuesta nada, pero tampoco aporta: sabemos que existen) */
export function esDireccionPropia(direccion: string, dominiosPropios: readonly string[], direccionesPropias: readonly string[] = []): boolean {
  const d = direccion.trim().toLowerCase()
  const dominio = d.slice(d.lastIndexOf('@') + 1)
  return direccionesPropias.some((x) => x.toLowerCase() === d) || dominiosPropios.some((x) => x.toLowerCase() === dominio)
}

/* ------------------------------------------------------------------ */
/* Qué hacer antes de enviar                                           */
/* ------------------------------------------------------------------ */

/** Lo que el cuadro de escribir necesita saber de cada dirección, para enseñarlo */
export interface DireccionParaElCliente {
  direccion: string
  nivel: NivelDePago
  motivo: string
  sugerencia: string | null
  sinComprobar: boolean
  rebotada: boolean
  /** Con los ajustes de ahora, un envío a esta dirección NO saldría */
  bloquea: boolean
}

export interface DecisionDeEnvio {
  /** Si hay algo que impide enviar: la frase y las direcciones que lo causan */
  bloqueo: { mensaje: string; direcciones: DireccionParaElCliente[] } | null
  /** Sale, pero SIN seguimientos automáticos: la frase de por qué (una dirección dudosa con la política «sin seguimientos») */
  sinSeguimientos: string | null
  /** Lo que se le dice a quien envía cuando el correo sale (una dirección dudosa que se envía, una que no se ha podido comprobar) */
  avisos: string[]
  /** Todas las direcciones comprobadas, para pintarlas */
  direcciones: DireccionParaElCliente[]
}

/** Los fallos que merecen decírselo a quien envía: el correo sale igual, pero que sepa que esta vez no se comprobó */
const CAUSAS_QUE_SE_AVISAN: ReadonlySet<CausaDeNoComprobar> = new Set(['sin_creditos', 'clave', 'ip', 'red', 'otro'])

const comillas = (d: string): string => `«${d}»`

function mensajeDeBloqueo(bloqueadas: readonly DireccionParaElCliente[]): string {
  const detalle = bloqueadas.map((d) => `${comillas(d.direccion)}: ${d.motivo}${d.sugerencia ? ` ¿Querías decir ${comillas(d.sugerencia)}?` : ''}`).join(' ')
  const dudosa = bloqueadas.every((d) => d.nivel === 'dudosa')
  if (dudosa) return `No se ha enviado. ${detalle} Los ajustes de verificación están en «No enviar» para las direcciones que no se pueden confirmar.`
  return `No se ha enviado: ${bloqueadas.length === 1 ? 'esa dirección no sirve' : 'hay direcciones que no sirven'}. ${detalle} Corrígela, o escribe a otra dirección. Si crees que es un error, un administrador puede liberarla en Correo → Secuencias → Ajustes.`
}

/**
 * Lo que se hace con lo que se ha averiguado de las direcciones de «Para». `resultados` lleva una entrada por dirección (en minúsculas).
 */
export function decidirEnvio(resultados: ReadonlyMap<string, ResultadoDeComprobar>, dudosas: PoliticaDeDudosas): DecisionDeEnvio {
  const direcciones: DireccionParaElCliente[] = []
  const avisos: string[] = []
  let sinSeguimientos: string | null = null

  for (const [direccion, r] of resultados) {
    if (r.tipo === 'sin_comprobar') {
      if (CAUSAS_QUE_SE_AVISAN.has(r.causa)) avisos.push(`No se ha podido comprobar la dirección ${comillas(direccion)}: ${r.motivo} El correo se ha enviado igualmente.`)
      continue
    }
    const v = r.veredicto
    const bloquea = v.nivel === 'mala' || (v.nivel === 'dudosa' && dudosas === 'bloquear')
    direcciones.push({ direccion, nivel: v.nivel, motivo: v.motivo, sugerencia: v.sugerencia, sinComprobar: false, rebotada: v.origen === 'rebote', bloquea })
    if (v.nivel === 'dudosa' && !bloquea) {
      if (dudosas === 'sin_seguimientos') {
        sinSeguimientos = `La dirección ${comillas(direccion)} es dudosa (${v.motivo.replace(/\.$/, '')}): el correo ha salido sin seguimientos automáticos.`
        avisos.push(sinSeguimientos)
      } else {
        avisos.push(`La dirección ${comillas(direccion)} es dudosa: ${v.motivo} El correo se ha enviado igualmente.`)
      }
    }
  }

  const bloqueadas = direcciones.filter((d) => d.bloquea)
  return { bloqueo: bloqueadas.length > 0 ? { mensaje: mensajeDeBloqueo(bloqueadas), direcciones } : null, sinSeguimientos, avisos, direcciones }
}

/* ------------------------------------------------------------------ */
/* Mientras se escribe: lo gratis y lo ya sabido, juntos               */
/* ------------------------------------------------------------------ */

/** Lo que mira el cuadro de escribir mientras se teclea (cómo está escrita, dominio, rebotes): lo gratis */
export interface VeredictoLibre {
  direccion: string
  nivel: NivelDePago
  motivo: string
  sugerencia: string | null
  sinComprobar: boolean
  rebotada: boolean
}

export interface VeredictoParaLaPantalla extends VeredictoLibre {
  /** Con los ajustes de ahora, un envío a esta dirección NO saldría: el cuadro no ofrece «enviar igualmente» */
  bloquea: boolean
  /** Ya se comprobó con el servicio (o una persona la dio por buena): no hay nada más que preguntar */
  verificada: boolean
}

/**
 * Junta lo que dice la revisión gratuita con lo que ya se sabe del servicio de verificación (lo guardado y la memoria de direcciones), SIN preguntar nada nuevo
 * (preguntar mientras se teclea gastaría créditos en cada errata). `dudosas` es null si la verificación está apagada: entonces nada bloquea.
 */
export function combinarConLoSabido(libre: VeredictoLibre, sabido: VeredictoDePago | undefined, dudosas: PoliticaDeDudosas | null): VeredictoParaLaPantalla {
  if (!sabido || dudosas === null) return { ...libre, bloquea: false, verificada: false }
  if (sabido.origen === 'persona') return { ...libre, nivel: 'buena', motivo: sabido.motivo, rebotada: false, bloquea: false, verificada: true }
  if (sabido.nivel === 'mala') return { ...libre, nivel: 'mala', motivo: sabido.motivo, sugerencia: sabido.sugerencia ?? libre.sugerencia, rebotada: sabido.origen === 'rebote', sinComprobar: false, bloquea: true, verificada: true }
  if (sabido.nivel === 'dudosa') {
    const peor = libre.nivel === 'mala'
    return { ...libre, nivel: peor ? 'mala' : 'dudosa', motivo: peor ? libre.motivo : sabido.motivo, sinComprobar: false, bloquea: dudosas === 'bloquear', verificada: true }
  }
  return { ...libre, bloquea: false, verificada: true }
}

/* ------------------------------------------------------------------ */
/* Cómo se dice una dirección mala, según de dónde viene               */
/* ------------------------------------------------------------------ */

export interface DireccionMalaConocida {
  motivo: string | null
  veces?: number
  /** rebote · rechazo_smtp · manual · verificador (y, solo para el motor, verificador_dudosa: no se pudo confirmar y los ajustes no dejan escribirle) */
  origen?: string | null
}

/**
 * La frase de una dirección que está en la memoria de direcciones malas. Una que rebotó dice «ya rebotó antes»; una que dijo mala el servicio de verificación
 * dice eso, porque nunca se le escribió y «rebotó» sería mentira.
 */
export function fraseDeDireccionMala(d: DireccionMalaConocida, uso: 'aviso' | 'parada' | 'alta'): string {
  // Una dirección DUDOSA que según los ajustes no recibe seguimientos: no es que no exista, es que no se pudo confirmar
  if (d.origen === 'verificador_dudosa') {
    const razon = d.motivo ? ` (${d.motivo.replace(/\.$/, '')})` : ''
    return uso === 'alta' ? `No se programan seguimientos: el servicio de verificación no ha podido confirmar que esa dirección exista${razon} y los ajustes no lo permiten.` : `El servicio de verificación no ha podido confirmar que esa dirección exista${razon}: según los ajustes no se le escriben seguimientos.`
  }
  const del = d.origen === 'verificador'
  const veces = (d.veces ?? 1) > 1 ? ` (${d.veces} veces)` : ''
  if (uso === 'aviso') return del ? `El servicio de verificación dice que esa dirección no existe${d.motivo ? `: ${d.motivo.replace(/\.$/, '')}` : ''}.` : `Esa dirección ya rebotó antes${veces}${d.motivo ? `: ${d.motivo}` : ': el servidor dijo que no existe'}.`
  if (uso === 'parada') return del ? `El servicio de verificación dijo que esa dirección no existe${d.motivo ? ` (${d.motivo.replace(/\.$/, '')})` : ''}: no se le escribe más.` : `Esa dirección ya había rebotado antes${d.motivo ? ` (${d.motivo})` : ''}: no se le escribe más.`
  return del ? `No se programan seguimientos: el servicio de verificación dice que esa dirección no existe${d.motivo ? ` (${d.motivo.replace(/\.$/, '')})` : ''}.` : `No se programan seguimientos: esa dirección ya rebotó antes${veces}.`
}

/** El motivo que se apunta en la memoria de direcciones malas cuando el servicio da una dirección por mala (sin el punto final: las frases lo añaden) */
export const motivoParaLaMemoria = (motivo: string): string => motivo.replace(/\.$/, '').slice(0, 300)
