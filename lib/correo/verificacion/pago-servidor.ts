import type { createServiceClient } from '@/lib/supabase/service'
import { decryptToken, encryptToken, hasTokenKey } from '@/lib/amazon/crypto'
import { isMissingSchema } from '@/lib/plataforma/eventos'
import { almacenDeSecuencias } from '../secuencias/almacen'
import { esDominioLibre } from '../secuencias/reglas'
import { analizarDireccion } from './direccion'
import { MENSAJE_DE_ERROR, consultarCreditos, motivoDelVeredicto, verificarEnElServicio, type NivelDePago, type OpcionesDeLlamada } from './millionverifier'
import {
  POLITICA_POR_DEFECTO,
  decidirEnvio,
  esDireccionPropia,
  esPoliticaDeDudosas,
  estaVigente,
  fraseDeDireccionMala,
  motivoParaLaMemoria,
  type CausaDeNoComprobar,
  type DecisionDeEnvio,
  type PoliticaDeDudosas,
  type ResultadoDeComprobar,
  type VeredictoDePago,
} from './pago'

/**
 * LA VERIFICACIÓN DE DIRECCIONES DE PAGO: PREGUNTAR UNA VEZ, GUARDAR LA RESPUESTA Y NO BLOQUEAR NUNCA POR UN FALLO — SOLO SERVIDOR.
 * ====================================================================================================================================
 * Las reglas de qué hacer con lo que se averigua están en pago.ts (puro); la llamada al servicio, en millionverifier.ts. Esto es lo que las une con la base. Se
 * comprueba con pago-servidor.prueba.ts, con la base en memoria y un `fetch` de mentira.
 *
 * LO QUE HACE `comprobarDirecciones` CON CADA DIRECCIÓN, EN ESTE ORDEN (y para en cuanto sabe):
 *   1. Del propio equipo (sus dominios y buzones): no se comprueba.
 *   2. Apagada, o sin clave: no se comprueba (y el correo sale como siempre).
 *   3. Una persona la liberó en «Direcciones que no sirven»: se da por buena, sin preguntar. Está en esa memoria como mala (rebotó, o la dio por mala el servicio):
 *      mala, sin preguntar.
 *   4. Ya se comprobó antes (y no ha caducado): se usa lo guardado. NO SE PAGA OTRA VEZ. Esto es lo que hace que los seguimientos, que salen a la misma
 *      dirección que el primer correo, no vuelvan a gastar créditos.
 *   5. Hay un freno puesto (la clave no vale, no hay créditos o la IP está bloqueada: se probó hace menos de 10 minutos): no se pregunta.
 *   6. Se pregunta al servicio. Lo que contesta se guarda; si es «mala», entra además en la memoria de direcciones que no sirven, que es la que ya miran el
 *      cuadro de escribir, las secuencias y el botón «Liberar».
 *
 * UN FALLO NO BLOQUEA. Si el servicio no contesta, se pasa de clave, no quedan créditos o la IP está bloqueada, la dirección queda «sin comprobar» y el correo sale. Lo
 * que sí se hace es apuntar el fallo (para enseñarlo en Ajustes y avisar a los administradores cuando se acaban los créditos) y, si es de los que no se arreglan
 * solos, poner un freno de diez minutos para no insistir con cada correo.
 */

type Servicio = ReturnType<typeof createServiceClient>

/** Para qué se cifra la clave: una clave cifrada aquí no se descifra si alguien la pega en la columna de otra cosa */
const PROPOSITO = 'verificacion.millionverifier.v1'

export const FALTA_LA_MIGRACION_256 =
  'Falta lanzar la migración 256_correo_verificacion_de_direcciones.sql en el editor SQL de Supabase: hasta entonces los correos salen sin comprobar la dirección. El resto de Correo no se ve afectado.'

/** Los dominios del propio equipo, a los que no se les pregunta nada. Se suman los de los buzones conectados */
export const DOMINIOS_PROPIOS = ['libertyseller.es', 'libertyseller.com']

/** Cuánto se espera antes de volver a probar con una clave que no vale, sin créditos o con la IP bloqueada */
export const FRENO_MS = 10 * 60_000
/** Cuánto se espera antes de volver a preguntar por una dirección cuya comprobación falló por un motivo pasajero (solo para los seguimientos: un envío hecho a mano siempre lo intenta) */
export const ENFRIAMIENTO_MS = 2 * 60_000

/** Por debajo de esto se avisa a los administradores de que quedan pocos créditos */
export const CREDITOS_PARA_AVISAR = 500

const iso = (ms: number): string => new Date(ms).toISOString()
const aMs = (v: string | null | undefined): number | null => {
  if (!v) return null
  const t = Date.parse(v)
  return Number.isFinite(t) ? t : null
}

/* ------------------------------------------------------------------ */
/* La configuración                                                    */
/* ------------------------------------------------------------------ */

export type CausaDeFallo = 'clave' | 'sin_creditos' | 'ip' | 'red' | 'otro'

export interface AjustesDeVerificacion {
  activa: boolean
  dudosas: PoliticaDeDudosas
  hayClave: boolean
  /** Dónde está la clave: guardada en el ERP (Ajustes) o puesta en el servidor como variable de entorno */
  claveDe: 'ajustes' | 'entorno' | null
  /** Hay una clave guardada pero no se puede descifrar (cambió la clave de cifrado del servidor): hay que volver a pegarla */
  claveIlegible: boolean
  claveTermina: string | null
  clavePuestaAt: number | null
  creditos: number | null
  creditosAt: number | null
  fallo: { causa: CausaDeFallo; texto: string; en: number } | null
}

export interface Configuracion {
  ajustes: AjustesDeVerificacion
  /** La clave en claro, solo para usarla ahora mismo. NUNCA se devuelve a la pantalla */
  clave: string | null
}

interface FilaDeAjustes {
  activa: boolean | null
  dudosas: string | null
  clave_cifrada: string | null
  clave_termina: string | null
  clave_puesta_at: string | null
  creditos: number | null
  creditos_at: string | null
  error_causa: string | null
  error_texto: string | null
  error_at: string | null
}

const COLUMNAS_DE_AJUSTES = 'activa, dudosas, clave_cifrada, clave_termina, clave_puesta_at, creditos, creditos_at, error_causa, error_texto, error_at'

const CAUSAS_DE_FALLO: readonly string[] = ['clave', 'sin_creditos', 'ip', 'red', 'otro']

/** Los ajustes y la clave. null = falta la migración 256 (todo sigue como siempre) */
export async function leerConfiguracion(service: Servicio): Promise<Configuracion | null> {
  const { data, error } = await service.from('correo_verificacion_ajustes').select(COLUMNAS_DE_AJUSTES).eq('id', true).maybeSingle()
  if (error) {
    if (isMissingSchema(error)) return null
    throw new Error('No se han podido leer los ajustes de la verificación de direcciones.', { cause: error })
  }
  const f = (data as FilaDeAjustes | null) ?? null

  let clave: string | null = null
  let claveDe: 'ajustes' | 'entorno' | null = null
  let claveIlegible = false
  if (f?.clave_cifrada) {
    try {
      clave = decryptToken(f.clave_cifrada, PROPOSITO)
      claveDe = 'ajustes'
    } catch {
      // Sin el texto del error: puede llevar material de lo descifrado
      claveIlegible = true
    }
  }
  if (!clave) {
    const delEntorno = (process.env.MILLIONVERIFIER_API_KEY ?? '').trim()
    if (delEntorno !== '') {
      clave = delEntorno
      claveDe = 'entorno'
    }
  }

  const causa = f?.error_causa && CAUSAS_DE_FALLO.includes(f.error_causa) ? (f.error_causa as CausaDeFallo) : null
  return {
    clave,
    ajustes: {
      activa: f?.activa === true,
      dudosas: esPoliticaDeDudosas(f?.dudosas) ? f.dudosas : POLITICA_POR_DEFECTO,
      hayClave: clave !== null,
      claveDe,
      claveIlegible,
      claveTermina: f?.clave_termina ?? null,
      clavePuestaAt: aMs(f?.clave_puesta_at),
      creditos: typeof f?.creditos === 'number' ? f.creditos : null,
      creditosAt: aMs(f?.creditos_at),
      fallo: causa && f?.error_at ? { causa, texto: f.error_texto ?? '', en: aMs(f.error_at) ?? 0 } : null,
    },
  }
}

/* ------------------------------------------------------------------ */
/* Los frenos y lo que está en marcha (en la memoria del proceso)       */
/* ------------------------------------------------------------------ */

let frenoHasta = 0
let frenoCausa: CausaDeNoComprobar | null = null
const enfriadas = new Map<string, number>()
const enVuelo = new Map<string, Promise<ResultadoDeComprobar>>()

/** Quita todos los frenos: cuando alguien pone una clave nueva o prueba la que hay, lo que se frenó ya no vale */
export function reiniciarLosFrenos(): void {
  frenoHasta = 0
  frenoCausa = null
  enfriadas.clear()
  enVuelo.clear()
}

function frenoVigente(config: Configuracion, ahora: number): CausaDeNoComprobar | null {
  if (frenoCausa && ahora < frenoHasta) return frenoCausa
  // Tras un reinicio del servidor el freno de la memoria se pierde: el fallo apuntado en la base lo recuerda
  const f = config.ajustes.fallo
  if (f && (f.causa === 'clave' || f.causa === 'sin_creditos' || f.causa === 'ip') && ahora - f.en < FRENO_MS) return f.causa
  return null
}

/* ------------------------------------------------------------------ */
/* Lo que ya se sabe de unas direcciones (sin preguntar)                */
/* ------------------------------------------------------------------ */

interface FilaDeMemoria {
  direccion: string
  estado: string
  motivo: string | null
  origen: string | null
  veces: number | null
}

interface FilaDeVerificacion {
  direccion: string
  nivel: string
  resultado: string | null
  detalle: string | null
  calidad: string | null
  sugerencia: string | null
  verificada_at: string
}

const NIVELES: readonly string[] = ['buena', 'dudosa', 'mala']

/**
 * Lo que ya se sabe de estas direcciones sin preguntar a nadie: la memoria de direcciones (una persona la liberó, o rebotó, o la dio por mala el servicio) y lo
 * guardado de comprobaciones anteriores. Una dirección de la que no se sabe nada no sale en el resultado.
 */
export async function loQueYaSeSabe(service: Servicio, direcciones: readonly string[], ahora: number): Promise<Map<string, VeredictoDePago>> {
  const salida = new Map<string, VeredictoDePago>()
  if (direcciones.length === 0) return salida
  const lista = [...direcciones]
  const [memoria, guardadas] = await Promise.all([
    service.from('correo_direcciones_malas').select('direccion, estado, motivo, origen, veces').in('direccion', lista),
    service.from('correo_verificaciones').select('direccion, nivel, resultado, detalle, calidad, sugerencia, verificada_at').in('direccion', lista),
  ])
  // Sin la tabla de la memoria (migración 245) o sin la de lo guardado (la 256), esa parte no se sabe: no es un error
  if (memoria.error && !isMissingSchema(memoria.error)) throw new Error('No se ha podido consultar la memoria de direcciones.', { cause: memoria.error })
  if (guardadas.error && !isMissingSchema(guardadas.error)) throw new Error('No se han podido consultar las direcciones ya comprobadas.', { cause: guardadas.error })
  const filasDeMemoria = new Map(((memoria.data ?? []) as FilaDeMemoria[]).map((f) => [f.direccion, f]))
  const filasGuardadas = new Map(((guardadas.data ?? []) as FilaDeVerificacion[]).map((f) => [f.direccion, f]))

  for (const d of lista) {
    const m = filasDeMemoria.get(d)
    const g = filasGuardadas.get(d)
    const guardada = g && NIVELES.includes(g.nivel) && estaVigente(g.nivel as NivelDePago, aMs(g.verificada_at) ?? 0, ahora) ? g : null

    // Una persona dijo que funciona: manda sobre todo lo demás
    if (m?.estado === 'liberada') {
      salida.set(d, { direccion: d, nivel: 'buena', resultado: 'liberada', detalle: null, sugerencia: null, motivo: 'Un administrador ha marcado esta dirección como buena.', origen: 'persona', verificadaAt: null })
      continue
    }
    if (m?.estado === 'mala') {
      const delVerificador = m.origen === 'verificador'
      salida.set(d, {
        direccion: d,
        nivel: 'mala',
        resultado: delVerificador ? (guardada?.resultado ?? 'invalid') : 'rebotada',
        detalle: guardada?.detalle ?? null,
        sugerencia: guardada?.sugerencia ?? null,
        motivo: fraseDeDireccionMala({ motivo: m.motivo, veces: m.veces ?? 1, origen: m.origen }, 'aviso'),
        origen: delVerificador ? 'memoria' : 'rebote',
        verificadaAt: guardada ? aMs(guardada.verificada_at) : null,
      })
      continue
    }
    if (guardada) {
      const nivel = guardada.nivel as NivelDePago
      salida.set(d, {
        direccion: d,
        nivel,
        resultado: guardada.resultado ?? '',
        detalle: guardada.detalle,
        sugerencia: guardada.sugerencia,
        motivo: motivoDelVeredicto({ nivel, resultado: guardada.resultado ?? '', detalle: guardada.detalle }),
        origen: 'memoria',
        verificadaAt: aMs(guardada.verificada_at),
      })
    }
  }
  return salida
}

/* ------------------------------------------------------------------ */
/* Comprobar                                                            */
/* ------------------------------------------------------------------ */

export type OrigenDeLaComprobacion = 'primer_correo' | 'seguimiento' | 'prueba'

export interface OpcionesDeComprobar {
  origen: OrigenDeLaComprobacion
  usuarioId?: string | null
  ahora?: () => number
  fetch?: typeof fetch
  /** Cuántas llamadas al servicio se pueden hacer como mucho (el motor no alarga una pasada). Se va gastando: el mismo objeto se comparte entre llamadas */
  presupuestoDeLlamadas?: { restantes: number }
  esperaDelServicioS?: number
  esperaMaximaMs?: number
  /** Los dominios y las direcciones del propio equipo, que no se comprueban */
  dominiosPropios?: readonly string[]
  direccionesPropias?: readonly string[]
  /** Comprobar también las del propio equipo (la prueba que hace un administrador desde Ajustes) */
  incluirLasPropias?: boolean
}

const MOTIVO_DE_NO_COMPROBAR: Record<CausaDeNoComprobar, string> = {
  apagada: 'La verificación de direcciones está apagada.',
  sin_clave: 'Falta la clave de MillionVerifier.',
  propia: 'Es una dirección del propio equipo.',
  limite: 'Ya se han hecho todas las comprobaciones que tocaban en esta pasada.',
  sin_creditos: MENSAJE_DE_ERROR.sin_creditos,
  clave: MENSAJE_DE_ERROR.clave,
  ip: MENSAJE_DE_ERROR.ip,
  red: 'MillionVerifier no ha contestado.',
  otro: MENSAJE_DE_ERROR.otro,
}

const sinComprobar = (causa: CausaDeNoComprobar, motivo?: string): ResultadoDeComprobar => ({ tipo: 'sin_comprobar', causa, motivo: motivo ?? MOTIVO_DE_NO_COMPROBAR[causa] })

/** Anota lo último que fue mal con el servicio, o que ya funciona. NUNCA lanza: un fallo al apuntar no tumba el envío */
async function anotarEstado(service: Servicio, cambios: { creditos?: number | null; fallo?: { causa: CausaDeFallo; texto: string } | null }, ahora: number): Promise<void> {
  try {
    const fila: Record<string, unknown> = {}
    if (cambios.creditos !== undefined && cambios.creditos !== null) {
      fila.creditos = Math.max(0, cambios.creditos)
      fila.creditos_at = iso(ahora)
    }
    if (cambios.fallo === null) Object.assign(fila, { error_causa: null, error_texto: null, error_at: null })
    else if (cambios.fallo) Object.assign(fila, { error_causa: cambios.fallo.causa, error_texto: cambios.fallo.texto.slice(0, 300), error_at: iso(ahora) })
    if (Object.keys(fila).length === 0) return
    const { error } = await service.from('correo_verificacion_ajustes').update(fila).eq('id', true)
    if (error && !isMissingSchema(error)) console.error('[verificación] no se ha podido apuntar el estado del servicio', { codigo: (error as { code?: string }).code ?? null })
  } catch (e) {
    console.error('[verificación] fallo al apuntar el estado del servicio', { mensaje: e instanceof Error ? e.message : 'desconocido' })
  }
}

/** Guarda lo que dijo el servicio de una dirección y, si es mala, la apunta en la memoria de direcciones que no sirven. NUNCA lanza */
async function guardarVeredicto(service: Servicio, v: VeredictoDePago, o: OpcionesDeComprobar, ahora: number): Promise<void> {
  try {
    const { error } = await service.from('correo_verificaciones').upsert(
      {
        direccion: v.direccion,
        nivel: v.nivel,
        resultado: v.resultado.slice(0, 40),
        detalle: v.detalle?.slice(0, 60) ?? null,
        sugerencia: v.sugerencia?.slice(0, 320) ?? null,
        proveedor: 'millionverifier',
        origen: o.origen,
        verificada_por: o.usuarioId ?? null,
        verificada_at: iso(ahora),
      },
      { onConflict: 'direccion' }
    )
    if (error && !isMissingSchema(error)) console.error('[verificación] no se ha podido guardar la comprobación', { codigo: (error as { code?: string }).code ?? null })
  } catch (e) {
    console.error('[verificación] fallo al guardar la comprobación', { mensaje: e instanceof Error ? e.message : 'desconocido' })
  }
  if (v.nivel === 'mala') {
    // marcarDireccionMala no lanza jamás (aprender de una dirección mala no puede tumbar lo que se estaba haciendo)
    await almacenDeSecuencias(service).marcarDireccionMala(v.direccion, motivoParaLaMemoria(v.motivo), 'verificador', ahora, ahora)
  }
}

/** Pregunta al servicio por UNA dirección, la guarda y devuelve lo que se ha averiguado. NUNCA lanza */
async function preguntar(service: Servicio, config: Configuracion, d: string, o: OpcionesDeComprobar, ahora: number): Promise<ResultadoDeComprobar> {
  const opciones: OpcionesDeLlamada = { fetch: o.fetch, esperaDelServicioS: o.esperaDelServicioS, esperaMaximaMs: o.esperaMaximaMs }
  const r = await verificarEnElServicio(config.clave as string, d, opciones)

  if (r.tipo === 'red') {
    await anotarEstado(service, { fallo: { causa: 'red', texto: r.mensaje } }, ahora)
    enfriadas.set(d, ahora + ENFRIAMIENTO_MS)
    return sinComprobar('red', r.mensaje)
  }
  if (r.tipo === 'error') {
    const causa: CausaDeFallo = r.causa === 'interno' ? 'red' : r.causa
    // Los créditos que dice un error no valen: con una clave que no existe el servicio contesta «credits: 0». Solo «sin créditos» sabe de verdad que son cero
    await anotarEstado(service, { creditos: r.causa === 'sin_creditos' ? 0 : undefined, fallo: { causa, texto: r.mensaje } }, ahora)
    if (causa === 'clave' || causa === 'sin_creditos' || causa === 'ip') {
      frenoHasta = ahora + FRENO_MS
      frenoCausa = causa
      return sinComprobar(causa)
    }
    enfriadas.set(d, ahora + ENFRIAMIENTO_MS)
    return sinComprobar(causa, r.mensaje)
  }
  if (r.tipo === 'sin_veredicto') {
    await anotarEstado(service, { creditos: r.creditos, fallo: null }, ahora)
    enfriadas.set(d, ahora + ENFRIAMIENTO_MS)
    return sinComprobar('otro', 'MillionVerifier no ha podido verificar esa dirección.')
  }

  // Funciona: los créditos que quedan y, si había un fallo apuntado, ya no
  frenoHasta = 0
  frenoCausa = null
  await anotarEstado(service, { creditos: r.creditos, fallo: null }, ahora)
  const veredicto: VeredictoDePago = { direccion: d, nivel: r.nivel, resultado: r.resultado, detalle: r.detalle, sugerencia: r.sugerencia, motivo: motivoDelVeredicto(r), origen: 'servicio', verificadaAt: ahora }
  await guardarVeredicto(service, veredicto, o, ahora)
  return { tipo: 'veredicto', veredicto }
}

/**
 * Lo que se sabe de cada dirección, preguntando al servicio lo que no estaba guardado. Ya con la configuración leída (el que llama la necesita también para saber
 * qué hacer con las dudosas). Devuelve una entrada por dirección, en minúsculas.
 */
export async function comprobarConConfiguracion(service: Servicio, config: Configuracion, direcciones: readonly string[], o: OpcionesDeComprobar): Promise<Map<string, ResultadoDeComprobar>> {
  const ahora = (o.ahora ?? Date.now)()
  const salida = new Map<string, ResultadoDeComprobar>()
  const unicas = [...new Set(direcciones.map((d) => analizarDireccion(d).direccion).filter((d) => d !== ''))]
  if (unicas.length === 0) return salida

  const dominiosPropios = [...DOMINIOS_PROPIOS, ...(o.dominiosPropios ?? [])]
  const aComprobar: string[] = []
  for (const d of unicas) {
    if (!o.incluirLasPropias && esDireccionPropia(d, dominiosPropios, o.direccionesPropias)) salida.set(d, sinComprobar('propia'))
    else aComprobar.push(d)
  }
  if (aComprobar.length === 0) return salida
  if (!config.ajustes.activa) {
    for (const d of aComprobar) salida.set(d, sinComprobar('apagada'))
    return salida
  }
  if (!config.clave) {
    for (const d of aComprobar) salida.set(d, sinComprobar('sin_clave'))
    return salida
  }

  const sabidas = await loQueYaSeSabe(service, aComprobar, ahora)
  const freno = frenoVigente(config, ahora)
  await Promise.all(
    aComprobar.map(async (d) => {
      const conocida = sabidas.get(d)
      if (conocida) return void salida.set(d, { tipo: 'veredicto', veredicto: conocida })
      if (freno) return void salida.set(d, sinComprobar(freno))
      if (o.origen !== 'primer_correo' && o.origen !== 'prueba' && (enfriadas.get(d) ?? 0) > ahora) return void salida.set(d, sinComprobar('red', 'Se acaba de intentar y no se pudo: se reintentará dentro de un rato.'))
      if (o.presupuestoDeLlamadas) {
        if (o.presupuestoDeLlamadas.restantes <= 0) return void salida.set(d, sinComprobar('limite'))
        o.presupuestoDeLlamadas.restantes -= 1
      }
      // Si ya se está preguntando por esa dirección (un doble clic, dos personas a la vez), se espera esa respuesta: no se paga dos veces
      const enMarcha = enVuelo.get(d)
      if (enMarcha) return void salida.set(d, await enMarcha)
      const mia = preguntar(service, config, d, o, ahora).finally(() => enVuelo.delete(d))
      enVuelo.set(d, mia)
      salida.set(d, await mia)
    })
  )
  return salida
}

/** Lo mismo, leyendo la configuración. Con la migración sin lanzar, todas «apagada» (el correo sale como siempre) */
export async function comprobarDirecciones(service: Servicio, direcciones: readonly string[], o: OpcionesDeComprobar): Promise<Map<string, ResultadoDeComprobar>> {
  const config = await leerConfiguracion(service)
  if (!config) {
    const salida = new Map<string, ResultadoDeComprobar>()
    for (const d of direcciones) salida.set(analizarDireccion(d).direccion, sinComprobar('apagada', FALTA_LA_MIGRACION_256))
    return salida
  }
  return comprobarConConfiguracion(service, config, direcciones, o)
}

/* ------------------------------------------------------------------ */
/* Antes de enviar un primer correo                                     */
/* ------------------------------------------------------------------ */

export interface EntradaDeVerificarAntesDeEnviar {
  /** Las direcciones de «Para» y «Cc» */
  para: readonly string[]
  /** La dirección del buzón desde el que se envía (y su dominio) no se comprueba */
  direccionDelBuzon: string
  usuarioId: string
  ahora?: () => number
  fetch?: typeof fetch
}

/**
 * Lo que hay que hacer antes de enviar el primer correo a estas direcciones. `null` = no se hace nada (apagada, sin clave o sin migración): el correo sale como
 * siempre. NUNCA lanza: si algo inesperado falla aquí, el correo sale sin comprobar.
 */
export async function verificarAntesDeEnviar(service: Servicio, e: EntradaDeVerificarAntesDeEnviar): Promise<DecisionDeEnvio | null> {
  try {
    const config = await leerConfiguracion(service)
    if (!config || !config.ajustes.activa || !config.clave) return null
    const buzones = await service.from('correo_buzones').select('direccion')
    const direccionesDeBuzones = buzones.error ? [] : ((buzones.data ?? []) as Array<{ direccion: string }>).map((b) => b.direccion.toLowerCase())
    // El dominio de un buzón es «del equipo» salvo que sea de un proveedor libre (un buzón de gmail.com no exime a todos los gmail.com de ser comprobados): de esos solo vale la dirección exacta
    const dominiosPropios = [...new Set([e.direccionDelBuzon, ...direccionesDeBuzones].map((d) => d.slice(d.lastIndexOf('@') + 1).toLowerCase()).filter((d) => d !== '' && !esDominioLibre(d)))]
    const resultados = await comprobarConConfiguracion(service, config, e.para, {
      origen: 'primer_correo',
      usuarioId: e.usuarioId,
      ahora: e.ahora,
      fetch: e.fetch,
      dominiosPropios,
      direccionesPropias: [e.direccionDelBuzon, ...direccionesDeBuzones],
    })
    return decidirEnvio(resultados, config.ajustes.dudosas)
  } catch (error) {
    console.error('[verificación] no se ha podido comprobar antes de enviar; el correo sale sin comprobar', { mensaje: error instanceof Error ? error.message : 'desconocido', codigo: (error as { cause?: { code?: string } } | null)?.cause?.code ?? null })
    return null
  }
}

/* ------------------------------------------------------------------ */
/* Mientras se escribe: lo que ya se sabe, sin gastar nada              */
/* ------------------------------------------------------------------ */

export interface SaberSinPreguntar {
  dudosas: PoliticaDeDudosas
  /** Lo que ya se sabe de cada dirección (solo las que se saben) */
  conocidas: ReadonlyMap<string, VeredictoDePago>
}

/**
 * Para el cuadro de escribir: lo que ya se sabe de estas direcciones por lo guardado y por la memoria de direcciones, SIN preguntar al servicio (preguntar
 * mientras se teclea gastaría créditos en cada errata). null = la verificación está apagada o no hay migración: no se enseña nada.
 */
export async function loQueSeSabeAntesDeEnviar(service: Servicio, direcciones: readonly string[], ahora: number = Date.now()): Promise<SaberSinPreguntar | null> {
  try {
    const config = await leerConfiguracion(service)
    if (!config || !config.ajustes.activa || !config.clave) return null
    const unicas = [...new Set(direcciones.map((d) => analizarDireccion(d).direccion).filter((d) => d !== '' && !esDireccionPropia(d, DOMINIOS_PROPIOS)))]
    return { dudosas: config.ajustes.dudosas, conocidas: await loQueYaSeSabe(service, unicas, ahora) }
  } catch (error) {
    console.error('[verificación] no se ha podido mirar lo guardado', { mensaje: error instanceof Error ? error.message : 'desconocido' })
    return null
  }
}

/* ------------------------------------------------------------------ */
/* Para los seguimientos que ya están en marcha                         */
/* ------------------------------------------------------------------ */

export interface VeredictoParaElMotor {
  nivel: NivelDePago
  motivo: string
  /** Con los ajustes de ahora, a esta dirección no se le escribe más (mala; o dudosa si los ajustes dicen «no enviar» o «sin seguimientos») */
  parar: boolean
  /** mala · dudosa */
  porQue: 'mala' | 'dudosa'
}

/**
 * El verificador que usa el motor justo antes de enviar un seguimiento. Una dirección ya comprobada no cuesta nada (usa lo guardado); una que no se había comprobado
 * (los seguimientos que se programaron antes de tener esto) se pregunta UNA vez. Como mucho `llamadasPorPasada` llamadas al servicio por pasada, para no alargarla; las
 * demás se quedan sin comprobar y se hacen en la pasada siguiente. Devuelve null si no hay nada que decir (apagada, sin comprobar, buena).
 */
export function verificadorParaElMotor(service: Servicio, o: { llamadasPorPasada?: number; fetch?: typeof fetch; ahora?: () => number } = {}): (direccion: string) => Promise<VeredictoParaElMotor | null> {
  const presupuesto = { restantes: o.llamadasPorPasada ?? 5 }
  let config: { en: number; valor: Configuracion | null } | null = null
  return async (direccion) => {
    try {
      const ahora = (o.ahora ?? Date.now)()
      // La configuración se lee una vez por minuto como mucho: la pasada puede pedir muchas
      if (!config || ahora - config.en > 60_000) config = { en: ahora, valor: await leerConfiguracion(service) }
      const c = config.valor
      if (!c || !c.ajustes.activa || !c.clave) return null
      const r = (await comprobarConConfiguracion(service, c, [direccion], { origen: 'seguimiento', ahora: o.ahora, fetch: o.fetch, presupuestoDeLlamadas: presupuesto, esperaDelServicioS: 5, esperaMaximaMs: 8000 })).get(analizarDireccion(direccion).direccion)
      // Si el servicio no contesta no se insiste con las demás direcciones de esta pasada (cada una esperaría hasta el límite y alargaría la pasada): se vuelve a intentar en la siguiente
      if (r?.tipo === 'sin_comprobar' && r.causa === 'red') presupuesto.restantes = 0
      if (!r || r.tipo !== 'veredicto') return null
      const v = r.veredicto
      if (v.nivel === 'buena') return null
      const parar = v.nivel === 'mala' || c.ajustes.dudosas !== 'avisar'
      return { nivel: v.nivel, motivo: v.motivo, parar, porQue: v.nivel }
    } catch (error) {
      console.error('[verificación] no se ha podido comprobar una dirección de un seguimiento; sale sin comprobar', { mensaje: error instanceof Error ? error.message : 'desconocido' })
      return null
    }
  }
}

/* ------------------------------------------------------------------ */
/* Lo que cambian los administradores                                   */
/* ------------------------------------------------------------------ */

export type ResultadoDeCambiar<T = object> = ({ ok: true } & T) | { ok: false; estado: number; mensaje: string }

const MAX_CLAVE = 128

/** Una clave plausible: letras, cifras, guiones, sin espacios. Una de MillionVerifier tiene unos 25 caracteres */
export function claveValida(clave: unknown): clave is string {
  return typeof clave === 'string' && clave.length >= 8 && clave.length <= MAX_CLAVE && /^[A-Za-z0-9_-]+$/.test(clave)
}

/** Enciende o apaga la verificación y elige qué hacer con las dudosas. Encender sin clave no se puede */
export async function guardarAjustes(service: Servicio, quien: { id: string }, cambios: { activa?: unknown; dudosas?: unknown }, ahora: number = Date.now()): Promise<ResultadoDeCambiar> {
  const fila: Record<string, unknown> = {}
  if (cambios.activa !== undefined) {
    if (typeof cambios.activa !== 'boolean') return { ok: false, estado: 400, mensaje: '«activa» tiene que ser verdadero o falso.' }
    fila.activa = cambios.activa
  }
  if (cambios.dudosas !== undefined) {
    if (!esPoliticaDeDudosas(cambios.dudosas)) return { ok: false, estado: 400, mensaje: 'Esa opción para las direcciones dudosas no existe.' }
    fila.dudosas = cambios.dudosas
  }
  if (Object.keys(fila).length === 0) return { ok: false, estado: 400, mensaje: 'No hay ningún cambio que guardar.' }

  const config = await leerConfiguracion(service)
  if (!config) return { ok: false, estado: 503, mensaje: FALTA_LA_MIGRACION_256 }
  if (fila.activa === true && !config.clave) return { ok: false, estado: 422, mensaje: 'Primero hay que guardar la clave de MillionVerifier.' }

  const { error } = await service.from('correo_verificacion_ajustes').update({ ...fila, actualizada_at: iso(ahora), actualizada_por: quien.id }).eq('id', true)
  if (error) throw new Error('No se han podido guardar los ajustes de la verificación.', { cause: error })
  return { ok: true }
}

export interface OpcionesDeClave {
  fetch?: typeof fetch
}

/**
 * Guarda la clave de la API, cifrada, SOLO si el servicio dice que vale (se le pregunta por los créditos, que no gasta ninguno). Si era la primera clave, enciende
 * la verificación: pegar la clave es pedir que funcione.
 */
export async function guardarClave(service: Servicio, quien: { id: string }, clave: unknown, o: OpcionesDeClave = {}, ahora: number = Date.now()): Promise<ResultadoDeCambiar<{ creditos: number; activada: boolean }>> {
  if (!claveValida(clave)) return { ok: false, estado: 400, mensaje: 'Esa clave no tiene buena pinta: son letras y cifras, sin espacios (unas 25). Cópiala entera de app.millionverifier.com/api.' }
  const config = await leerConfiguracion(service)
  if (!config) return { ok: false, estado: 503, mensaje: FALTA_LA_MIGRACION_256 }
  if (!hasTokenKey()) return { ok: false, estado: 503, mensaje: 'El servidor no tiene la clave con la que se cifran las claves guardadas (AMAZON_TOKEN_KEY), así que no se puede guardar esta. Se puede poner en su lugar la variable MILLIONVERIFIER_API_KEY en el servidor.' }

  const c = await consultarCreditos(clave, { fetch: o.fetch })
  if (c.tipo === 'red') return { ok: false, estado: 502, mensaje: `${c.mensaje} No se ha guardado la clave: vuelve a probar en un momento.` }
  if (c.tipo === 'error') return { ok: false, estado: 422, mensaje: c.mensaje }

  let cifrada: string
  try {
    cifrada = encryptToken(clave, PROPOSITO)
  } catch {
    return { ok: false, estado: 503, mensaje: 'No se ha podido cifrar la clave en el servidor, así que no se ha guardado.' }
  }
  const eraLaPrimera = !config.clave
  const { error } = await service
    .from('correo_verificacion_ajustes')
    .update({
      clave_cifrada: cifrada,
      clave_termina: clave.slice(-4),
      clave_puesta_at: iso(ahora),
      creditos: Math.max(0, c.creditos),
      creditos_at: iso(ahora),
      error_causa: null,
      error_texto: null,
      error_at: null,
      ...(eraLaPrimera ? { activa: true } : {}),
      actualizada_at: iso(ahora),
      actualizada_por: quien.id,
    })
    .eq('id', true)
  if (error) throw new Error('No se ha podido guardar la clave de la verificación.', { cause: error })
  reiniciarLosFrenos()
  return { ok: true, creditos: c.creditos, activada: eraLaPrimera }
}

/** Borra la clave guardada y apaga la verificación */
export async function quitarClave(service: Servicio, quien: { id: string }, ahora: number = Date.now()): Promise<ResultadoDeCambiar> {
  const config = await leerConfiguracion(service)
  if (!config) return { ok: false, estado: 503, mensaje: FALTA_LA_MIGRACION_256 }
  const { error } = await service
    .from('correo_verificacion_ajustes')
    .update({ clave_cifrada: null, clave_termina: null, clave_puesta_at: null, activa: false, error_causa: null, error_texto: null, error_at: null, actualizada_at: iso(ahora), actualizada_por: quien.id })
    .eq('id', true)
  if (error) throw new Error('No se ha podido quitar la clave de la verificación.', { cause: error })
  reiniciarLosFrenos()
  return { ok: true }
}

/** Pregunta al servicio por los créditos con la clave que hay (no gasta ninguno) y lo apunta. Quita los frenos: si ya hay créditos, se vuelve a comprobar */
export async function probarClave(service: Servicio, o: OpcionesDeClave = {}, ahora: number = Date.now()): Promise<ResultadoDeCambiar<{ creditos: number }>> {
  const config = await leerConfiguracion(service)
  if (!config) return { ok: false, estado: 503, mensaje: FALTA_LA_MIGRACION_256 }
  if (!config.clave) return { ok: false, estado: 422, mensaje: config.ajustes.claveIlegible ? 'La clave guardada no se puede leer (ha cambiado la clave de cifrado del servidor): vuelve a pegarla.' : 'Todavía no hay ninguna clave.' }
  const c = await consultarCreditos(config.clave, { fetch: o.fetch })
  if (c.tipo === 'red') return { ok: false, estado: 502, mensaje: c.mensaje }
  if (c.tipo === 'error') {
    const causa: CausaDeFallo = c.causa === 'interno' ? 'red' : c.causa
    await anotarEstado(service, { fallo: { causa, texto: c.mensaje } }, ahora)
    return { ok: false, estado: 422, mensaje: c.mensaje }
  }
  await anotarEstado(service, { creditos: c.creditos, fallo: null }, ahora)
  reiniciarLosFrenos()
  return { ok: true, creditos: c.creditos }
}

/** La prueba de un administrador: comprobar UNA dirección ahora (gasta un crédito si el servicio la da por buena o por mala). También la guarda */
export async function comprobarUna(service: Servicio, quien: { id: string }, direccion: unknown, o: { fetch?: typeof fetch; ahora?: () => number } = {}): Promise<ResultadoDeCambiar<{ resultado: ResultadoDeComprobar; direccion: string }>> {
  if (typeof direccion !== 'string') return { ok: false, estado: 400, mensaje: 'Falta la dirección.' }
  const analisis = analizarDireccion(direccion)
  const malEscrita = analisis.problemas.some((p) => p.gravedad === 'mala' && ['vacia', 'sintaxis', 'sin_dominio', 'dominio_sin_punto', 'dominio_no_valido', 'extension_no_valida', 'local_largo', 'dominio_largo'].includes(p.codigo))
  if (analisis.direccion === '' || !analisis.dominio || !analisis.local || malEscrita) return { ok: false, estado: 400, mensaje: 'Esa dirección no está bien escrita.' }
  const config = await leerConfiguracion(service)
  if (!config) return { ok: false, estado: 503, mensaje: FALTA_LA_MIGRACION_256 }
  if (!config.clave) return { ok: false, estado: 422, mensaje: 'Todavía no hay ninguna clave.' }
  // La prueba se hace aunque la verificación esté apagada: sirve justamente para ver que funciona antes de encenderla
  const resultados = await comprobarConConfiguracion(service, { ...config, ajustes: { ...config.ajustes, activa: true } }, [analisis.direccion], { origen: 'prueba', usuarioId: quien.id, ahora: o.ahora, fetch: o.fetch, incluirLasPropias: true })
  const resultado = resultados.get(analisis.direccion)
  if (!resultado) return { ok: false, estado: 500, mensaje: 'No se ha podido comprobar la dirección.' }
  return { ok: true, resultado, direccion: analisis.direccion }
}

/** Cuántas direcciones hay comprobadas de cada tipo (para enseñarlo en Ajustes). Sin la tabla, ceros */
export async function contarComprobadas(service: Servicio): Promise<{ buenas: number; dudosas: number; malas: number; ultima: number | null }> {
  const contar = async (nivel: string): Promise<number> => {
    const { count, error } = await service.from('correo_verificaciones').select('direccion', { count: 'exact', head: true }).eq('nivel', nivel)
    if (error) {
      if (isMissingSchema(error)) return 0
      throw new Error('No se han podido contar las direcciones comprobadas.', { cause: error })
    }
    return count ?? 0
  }
  const [buenas, dudosas, malas] = await Promise.all([contar('buena'), contar('dudosa'), contar('mala')])
  let ultima: number | null = null
  const { data } = await service.from('correo_verificaciones').select('verificada_at').order('verificada_at', { ascending: false }).limit(1)
  if (Array.isArray(data) && data.length > 0) ultima = aMs((data[0] as { verificada_at: string }).verificada_at)
  return { buenas, dudosas, malas, ultima }
}

/** Lo mínimo de la verificación para la pantalla de Salud y el vigía: sin migración o apagada, null */
export interface EstadoParaLaSalud {
  hayClave: boolean
  creditos: number | null
  fallo: { causa: CausaDeFallo; en: number } | null
}

export async function estadoParaLaSalud(service: Servicio): Promise<EstadoParaLaSalud | null> {
  try {
    const config = await leerConfiguracion(service)
    if (!config || !config.ajustes.activa || !config.ajustes.hayClave) return null
    const a = config.ajustes
    return { hayClave: true, creditos: a.creditos, fallo: a.fallo ? { causa: a.fallo.causa, en: a.fallo.en } : null }
  } catch {
    return null
  }
}
