import { createHash } from 'node:crypto'
import type { createServiceClient } from '@/lib/supabase/service'
import { decryptToken, encryptToken, hasTokenKey } from '@/lib/amazon/crypto'
import { pedirTurnoDeLectura } from '@/lib/fba/lectura-en-curso'
import { isMissingSchema } from '@/lib/plataforma/eventos'
import {
  ErrorRinkel,
  MENSAJE_DE_ERROR,
  comprobarClave,
  finalDeClave,
  leerPaginaDeLlamadas,
  limpiarClave,
  type CodigoErrorRinkel,
  type CuentaDeRinkel,
  type DepsRinkel,
} from './rinkel'
import { esDelEquipoMedido } from './equipo'
import { decidirObjetivo, type DecisionDeObjetivo } from './gestion'
import { ESTADO_INICIAL, sincronizarCuenta, type EstadoDeSincronizacion, type FilaParaGuardar } from './sincronizar'
import { indiceDeTelefonos, mapaDeLeadsDe, type LeadParaVincular } from '@/lib/cold-calling/vinculos'
import { leerLeadsParaVincular, repasarTrasLeer } from '@/lib/cold-calling/vinculos-servidor'

/**
 * LO QUE EL SERVIDOR HACE CON LA CLAVE DE RINKEL DE CADA COMERCIAL.
 * =================================================================
 * SOLO SERVIDOR. Une la lógica de rinkel.ts y sincronizar.ts con Supabase y con el cifrado. Se comprueba con
 * servidor.prueba.ts contra una base falsa en memoria.
 *
 *
 * ============ LA CLAVE ============
 *
 * Una clave de la API de Rinkel deja leer TODAS las llamadas y grabaciones de la cuenta de una persona, así que:
 *
 *   · Se guarda CIFRADA (AES-256-GCM, la misma pieza que cifra los tokens de Amazon) en una tabla cerrada al
 *     navegador. En ningún sitio se escribe en claro: ni en la base, ni en un registro, ni en un error.
 *   · Nunca se le devuelve a quien la escribió, ni a un supervisor. Lo único que se enseña es su final («…8f90»).
 *   · Los errores que salen de aquí son frases FIJAS. Esta ruta maneja un secreto, así que no se reenvía el
 *     texto de una excepción (ver el aviso de errorResponse en lib/amazon/api.ts).
 *   · Solo su dueño la vincula o la desvincula, o un ADMINISTRADOR en su nombre (ver gestion.ts). Un supervisor
 *     ve el estado de las cuentas del equipo, no las claves, y tampoco las pone ni las quita.
 *
 * Una misma cuenta de Rinkel no se puede vincular a dos personas (huella única): contaría cada llamada dos veces
 * en los totales del equipo.
 */

type Servicio = ReturnType<typeof createServiceClient>

export const FALTA_MIGRACION_RENDIMIENTO = 'Falta lanzar la migración 234_rendimiento_rinkel.sql en el editor SQL de Supabase: hasta entonces el panel no puede guardar ni leer llamadas.'

/** ¿Este error es que la migración 234 no está lanzada? Mira el error original, que viaja como `cause` */
export function esFaltaDeMigracion(error: unknown): boolean {
  return isMissingSchema(error) || isMissingSchema((error as { cause?: unknown } | null)?.cause)
}

/** Huella de una clave: se compara sin guardarla. Una clave de 64 cifras al azar no se puede recuperar de su SHA-256 */
export const huellaDeClave = (clave: string): string => createHash('sha256').update(clave).digest('hex')

/** Para qué se cifra: ata la clave de Rinkel a este uso, así que no se descifra si se pega en otra columna (p. ej. un token de Amazon) */
const PROPOSITO = 'rinkel.api_key.v1'

const POR_BLOQUE = 500

/* ------------------------------------------------------------------ */
/* Lo que se lee de la base                                            */
/* ------------------------------------------------------------------ */

export interface VinculoGuardado extends EstadoDeSincronizacion {
  user_id: string
  rinkel_usuario: string | null
  rinkel_numero: string | null
  vinculado_at: string
  ultimo_intento_at: string | null
  ultimo_error: string | null
  rinkel_total: number | null
}

const CAMPOS_DEL_VINCULO =
  'user_id, rinkel_usuario, rinkel_numero, vinculado_at, ultimo_sync_at, ultimo_intento_at, ultimo_error, historico_completo, siguiente_pagina, rinkel_total'

export async function leerVinculo(service: Servicio, userId: string): Promise<VinculoGuardado | null> {
  const { data, error } = await service.from('rinkel_vinculos').select(CAMPOS_DEL_VINCULO).eq('user_id', userId).maybeSingle()
  if (error) throw new Error('No se ha podido leer el estado de la cuenta de Rinkel.', { cause: error })
  return (data as VinculoGuardado | null) ?? null
}

/** Cuántas llamadas hay guardadas de esta persona */
export async function contarLlamadas(service: Servicio, userId: string): Promise<number> {
  const { count, error } = await service.from('rinkel_llamadas').select('id', { count: 'exact', head: true }).eq('user_id', userId)
  if (error) throw new Error('No se han podido contar las llamadas guardadas.', { cause: error })
  return count ?? 0
}

/** La clave descifrada de una persona, o null si no tiene una guardada o no se puede leer */
export async function leerClaveDe(service: Servicio, userId: string): Promise<{ clave: string } | { sinClave: true } | { ilegible: true }> {
  const { data, error } = await service.from('rinkel_claves').select('clave_cifrada').eq('user_id', userId).maybeSingle()
  if (error) throw new Error('No se ha podido leer la clave de Rinkel guardada.', { cause: error })
  const fila = data as { clave_cifrada: string } | null
  if (!fila) return { sinClave: true }
  try {
    return { clave: decryptToken(fila.clave_cifrada, PROPOSITO) }
  } catch {
    // Sin el texto del error: puede llevar material de lo descifrado
    return { ilegible: true }
  }
}

/**
 * Los teléfonos de los leads de ESTE comercial: clave de nueve cifras -> id del lead.
 * Solo los suyos: el nombre de una tienda de la cartera de otro no hace falta para saber a quién se llamó.
 * Si varios leads suyos comparten el teléfono se lleva la llamada UNO, siempre el mismo (ver elegirLead en
 * lib/cold-calling/vinculos.ts): el que sigue abierto y se tocó más recientemente.
 */
export async function leadsPorTelefonoDe(service: Servicio, userId: string): Promise<Map<string, string>> {
  return mapaDeLeadsDe(indiceDeTelefonos(await leerLeadsParaVincular(service, userId)), userId)
}

/**
 * Guarda llamadas con upsert por (usuario, id de Rinkel): repetir una no duplica nada.
 *
 * LAS QUE TIENEN LEAD Y LAS QUE NO VAN EN UPSERTS SEPARADOS, y las segundas SIN la clave `lead_id`. Un upsert que
 * llevara `lead_id: null` BORRARÍA el enlace de una llamada que ya lo tenía cada vez que se vuelve a leer en el solape
 * de tres días —porque el lead cambió de teléfono o de dueño—, y el historial del lead perdería sus llamadas. Sin la
 * clave, una fila que ya existe conserva el enlace que tenía y una nueva nace sin lead.
 */
export async function guardarLlamadas(service: Servicio, filas: FilaParaGuardar[]): Promise<void> {
  const ahora = new Date().toISOString()
  for (let i = 0; i < filas.length; i += POR_BLOQUE) {
    const bloque = filas.slice(i, i + POR_BLOQUE).map((f) => ({ ...f, actualizada_at: ahora }))
    const conLead = bloque.filter((f) => f.lead_id !== null)
    const sinLead = bloque
      .filter((f) => f.lead_id === null)
      .map((f) => {
        const { lead_id: _sin, ...resto } = f
        return resto
      })
    for (const grupo of [conLead, sinLead]) {
      if (grupo.length === 0) continue
      const { error } = await service.from('rinkel_llamadas').upsert(grupo, { onConflict: 'user_id,rinkel_id' })
      if (error) throw new Error('No se han podido guardar las llamadas.', { cause: error })
    }
  }
}

/* ------------------------------------------------------------------ */
/* Sobre quién se actúa                                                */
/* ------------------------------------------------------------------ */

/**
 * ¿Es del equipo que se mide: comercial o manager comercial (lib/rendimiento/equipo.ts)? Un administrador solo puede ponerle la clave de Rinkel a quien lo es (o quitársela a
 * cualquiera). El nombre es de cuando solo se medía a los comerciales; un manager comercial —que también llama— cuenta como «si».
 */
export async function esComercial(service: Servicio, userId: string): Promise<'si' | 'no' | 'no_existe'> {
  let r = await service.from('profiles').select('id, is_comercial, puesto').eq('id', userId).maybeSingle()
  // Sin la migración 257 la base no tiene `puesto`: se comprueba solo si es comercial, como antes de los managers
  if (r.error) r = await service.from('profiles').select('id, is_comercial').eq('id', userId).maybeSingle()
  if (r.error) throw new Error('No se ha podido comprobar a esa persona.', { cause: r.error })
  if (!r.data) return 'no_existe'
  return esDelEquipoMedido(r.data as { is_comercial: boolean | null; puesto?: string | null }) ? 'si' : 'no'
}

async function nombreDe(service: Servicio, userId: string): Promise<string | null> {
  const { data } = await service.from('profiles').select('full_name, email').eq('id', userId).maybeSingle()
  const p = data as { full_name: string | null; email: string | null } | null
  return p?.full_name?.trim() || p?.email || null
}

export type ResultadoDeAutorizar = DecisionDeObjetivo

/**
 * Decide sobre la clave de QUIÉN se va a actuar en esta petición, con el rol de quien la hace.
 *
 *   · Sin `usuario`, o con el propio: la suya. Sin tocar la base.
 *   · Con otra persona y sin ser administrador: 403, sin tocar la base.
 *   · Con otra persona y siendo administrador: la persona tiene que existir y ser del equipo que se mide (comercial
 *     o manager comercial) para vincular o sincronizar. QUITAR la clave se deja hacer aunque ya no sea comercial (alguien que pasa a
 *     otro puesto no puede dejar su clave guardada sin que nadie pueda borrarla).
 */
export async function autorizarObjetivo(
  service: Servicio,
  sesion: { userId: string; role: string },
  pedido: unknown,
  accion: 'vincular' | 'sincronizar' | 'desvincular'
): Promise<ResultadoDeAutorizar> {
  const d = decidirObjetivo(sesion, pedido)
  if (!d.ok || !d.deOtra) return d

  const pertenece = await esComercial(service, d.userId)
  if (pertenece === 'no_existe') return { ok: false, estado: 404, mensaje: 'Esa persona no existe.' }
  if (pertenece === 'no' && accion !== 'desvincular') {
    return { ok: false, estado: 409, mensaje: 'Esa persona no es del equipo comercial ni manager comercial, así que no tiene panel de rendimiento.' }
  }
  return d
}

/* ------------------------------------------------------------------ */
/* Leer la cuenta de una persona                                       */
/* ------------------------------------------------------------------ */

export interface ResumenDeSincronizacion {
  /** Se ha hecho todo lo que tocaba sin ningún error */
  ok: boolean
  /** Queda histórico por importar: hay que volver a pedirlo */
  pendiente: boolean
  /** Cuántas llamadas hay ahora guardadas de esta persona */
  importadas: number
  totalEnRinkel: number | null
  paginas: number
  /** Qué falló, si algo falló: un código de Rinkel o 'base' si fue al guardar */
  codigo: CodigoErrorRinkel | 'base' | null
  /** Frase para enseñar. Nunca el texto de una excepción */
  mensaje: string | null
  ultimoSyncAt: string | null
}

export type ResultadoDeLeerCuenta =
  | { tipo: 'hecha'; resumen: ResumenDeSincronizacion }
  | { tipo: 'ocupada' }
  | { tipo: 'sin_vinculo' }

const MENSAJE_DE_BASE = 'No se han podido guardar las llamadas. Vuelve a probar en un momento.'
const MENSAJE_DE_CLAVE_ILEGIBLE = 'No se ha podido leer la clave guardada. Vuelve a vincularla.'

export interface OpcionesDeLeerCuenta {
  presupuestoMs: number
  rinkel?: Partial<DepsRinkel>
  /**
   * Cuántos días se releen hacia atrás de lo reciente. Por defecto 3, que es lo que hace la pasada de fondo. La pantalla
   * de Cold Calling pide una lectura cada minuto para que la llamada que acaba de acabar salga ya en el historial del
   * lead, y para eso releer tres días enteros cada vez son decenas de páginas de Rinkel: con dos horas basta (una
   * grabación aparece unos minutos después de colgar).
   */
  solapeDias?: number
}

/**
 * Lee de Rinkel lo que falte de la cuenta de una persona y lo guarda.
 *
 * Una a la vez por persona: si la pasada de la noche y el botón «Sincronizar» coinciden, el segundo recibe
 * `ocupada` en vez de pedir lo mismo dos veces. No es por seguridad de los datos —guardar es un upsert—, es
 * para no gastar el cupo de peticiones de Rinkel de esa cuenta.
 */
export async function leerCuentaDe(service: Servicio, userId: string, opciones: OpcionesDeLeerCuenta): Promise<ResultadoDeLeerCuenta> {
  const turno = pedirTurnoDeLectura(`rinkel|${userId}`)
  if (!turno.ok) return { tipo: 'ocupada' }
  try {
    const vinculo = await leerVinculo(service, userId)
    if (!vinculo) return { tipo: 'sin_vinculo' }

    const ahoraIso = new Date().toISOString()
    await service.from('rinkel_vinculos').update({ ultimo_intento_at: ahoraIso }).eq('user_id', userId)

    const clave = await leerClaveDe(service, userId)
    if (!('clave' in clave)) {
      const mensaje = 'sinClave' in clave ? 'Esta cuenta ya no tiene la clave de Rinkel guardada. Vuelve a vincularla.' : MENSAJE_DE_CLAVE_ILEGIBLE
      await service.from('rinkel_vinculos').update({ ultimo_error: mensaje }).eq('user_id', userId)
      return {
        tipo: 'hecha',
        resumen: { ok: false, pendiente: !vinculo.historico_completo, importadas: await contarLlamadas(service, userId), totalEnRinkel: vinculo.rinkel_total, paginas: 0, codigo: 'clave_invalida', mensaje, ultimoSyncAt: vinculo.ultimo_sync_at },
      }
    }

    // Los leads de la persona se leen una sola vez por pasada y se reparten entre el casamiento al importar y el repaso
    const lectura: { leads: LeadParaVincular[] | null } = { leads: null }
    const leadsDe = async () => (lectura.leads ??= await leerLeadsParaVincular(service, userId))

    const resultado = await sincronizarCuenta(
      { historico_completo: vinculo.historico_completo, siguiente_pagina: vinculo.siguiente_pagina, ultimo_sync_at: vinculo.ultimo_sync_at },
      {
        leerPagina: (op) => leerPaginaDeLlamadas(clave.clave, op, opciones.rinkel),
        guardar: (filas) => guardarLlamadas(service, filas),
        leadsPorTelefono: async () => mapaDeLeadsDe(indiceDeTelefonos(await leadsDe()), userId),
        ahora: () => Date.now(),
      },
      { usuario: userId, presupuestoMs: opciones.presupuestoMs, solapeDias: opciones.solapeDias }
    )

    const error = resultado.error
    // Un fallo de la base al guardar no es un problema de la cuenta de Rinkel: no se le dice a nadie que su clave falla
    const mensaje = error ? (resultado.falloInterno ? MENSAJE_DE_BASE : MENSAJE_DE_ERROR[error.codigo]) : null
    await service
      .from('rinkel_vinculos')
      .update({
        siguiente_pagina: resultado.estado.siguiente_pagina,
        historico_completo: resultado.estado.historico_completo,
        ultimo_sync_at: resultado.estado.ultimo_sync_at,
        ultimo_error: mensaje,
        ...(resultado.totalEnRinkel !== null ? { rinkel_total: resultado.totalEnRinkel } : {}),
      })
      .eq('user_id', userId)

    // El lead se apunta solo: las llamadas de estos días que aún no tienen lead (porque el lead se creó o cambió de
    // teléfono después) se enlazan ahora. No es crítico y no espera a nadie: si falla, se registra y ya
    await repasarTrasLeer(service, userId, lectura.leads ?? undefined)

    return {
      tipo: 'hecha',
      resumen: {
        ok: error === null,
        pendiente: resultado.pendiente,
        importadas: await contarLlamadas(service, userId),
        totalEnRinkel: resultado.totalEnRinkel ?? vinculo.rinkel_total,
        paginas: resultado.paginas,
        codigo: error ? (resultado.falloInterno ? 'base' : error.codigo) : null,
        mensaje,
        ultimoSyncAt: resultado.estado.ultimo_sync_at,
      },
    }
  } finally {
    turno.soltar()
  }
}

/* ------------------------------------------------------------------ */
/* Vincular y desvincular                                              */
/* ------------------------------------------------------------------ */

/** Qué HTTP le corresponde a cada fallo de Rinkel */
export function estadoHttpDe(codigo: CodigoErrorRinkel): number {
  switch (codigo) {
    case 'clave_invalida':
    case 'sin_permiso':
      return 422
    case 'limite':
      return 429
    case 'no_encontrada':
      return 404
    default:
      return 502
  }
}

export type ResultadoDeVincular =
  | { ok: true; cuenta: CuentaDeRinkel; finalClave: string; lectura: ResultadoDeLeerCuenta }
  | { ok: false; estado: number; mensaje: string }

export interface OpcionesDeVincular extends OpcionesDeLeerCuenta {
  /**
   * Si la cuenta ya la tiene otra persona, decir QUIÉN. Solo para un administrador, que ve todo el equipo de
   * todos modos y así no tiene que adivinar a quién le ha pegado por error la clave de quién.
   */
  revelarQuien?: boolean
}

/**
 * Vincula la clave de Rinkel de una persona: la comprueba contra Rinkel, la guarda cifrada y empieza a
 * importar su histórico.
 *
 * Volver a vincular reinicia la importación desde cero: la clave puede ser de otra cuenta, y lo ya guardado no
 * estorba porque guardar es un upsert.
 */
export async function vincularClave(
  service: Servicio,
  userId: string,
  entrada: unknown,
  opciones: OpcionesDeVincular
): Promise<ResultadoDeVincular> {
  if (!hasTokenKey()) {
    return { ok: false, estado: 503, mensaje: 'El servidor no tiene configurada la clave de cifrado, así que no puede guardar la clave de Rinkel. Avisa a Liberty Seller.' }
  }

  const clave = limpiarClave(entrada)
  if (!clave) {
    return { ok: false, estado: 400, mensaje: 'Eso no parece una clave de Rinkel. Es una sola palabra larga, de letras y números, sin espacios. Cópiala entera.' }
  }

  let cuenta: CuentaDeRinkel
  try {
    cuenta = await comprobarClave(clave, opciones.rinkel)
  } catch (e) {
    const codigo: CodigoErrorRinkel = e instanceof ErrorRinkel ? e.codigo : 'respuesta'
    return { ok: false, estado: estadoHttpDe(codigo), mensaje: MENSAJE_DE_ERROR[codigo] }
  }

  const huella = huellaDeClave(clave)
  const { data: existente, error: errorHuella } = await service.from('rinkel_claves').select('user_id').eq('huella', huella).maybeSingle()
  if (errorHuella) {
    return esFaltaDeMigracion(errorHuella)
      ? { ok: false, estado: 503, mensaje: FALTA_MIGRACION_RENDIMIENTO }
      : { ok: false, estado: 500, mensaje: 'No se ha podido comprobar la clave. Vuelve a probar en un momento.' }
  }
  if (existente && (existente as { user_id: string }).user_id !== userId) {
    const quien = opciones.revelarQuien ? await nombreDe(service, (existente as { user_id: string }).user_id) : null
    return { ok: false, estado: 409, mensaje: `Esta cuenta de Rinkel ya está vinculada a otra persona del equipo${quien ? ` (${quien})` : ''}.` }
  }

  let cifrada: string
  try {
    cifrada = encryptToken(clave, PROPOSITO)
  } catch {
    return { ok: false, estado: 503, mensaje: 'No se ha podido cifrar la clave. Avisa a Liberty Seller.' }
  }

  const ahora = new Date().toISOString()
  const { error: errorClave } = await service
    .from('rinkel_claves')
    .upsert({ user_id: userId, clave_cifrada: cifrada, huella, final_clave: finalDeClave(clave), actualizada_at: ahora }, { onConflict: 'user_id' })
  if (errorClave) return { ok: false, estado: 500, mensaje: 'No se ha podido guardar la clave. Vuelve a probar en un momento.' }

  const { error: errorVinculo } = await service.from('rinkel_vinculos').upsert(
    {
      user_id: userId,
      rinkel_usuario: cuenta.usuario,
      rinkel_numero: cuenta.numero,
      vinculado_at: ahora,
      ultimo_sync_at: ESTADO_INICIAL.ultimo_sync_at,
      ultimo_intento_at: null,
      ultimo_error: null,
      historico_completo: ESTADO_INICIAL.historico_completo,
      siguiente_pagina: ESTADO_INICIAL.siguiente_pagina,
      rinkel_total: cuenta.totalLlamadas,
    },
    { onConflict: 'user_id' }
  )
  if (errorVinculo) return { ok: false, estado: 500, mensaje: 'No se ha podido guardar el vínculo. Vuelve a probar en un momento.' }

  const lectura = await leerCuentaDe(service, userId, opciones)
  return { ok: true, cuenta, finalClave: finalDeClave(clave), lectura }
}

/**
 * Desvincula: borra la clave y el estado de la cuenta. Las llamadas ya importadas SE QUEDAN (son el historial
 * del comercial); lo que se pierde es poder leer más y poder reproducir las grabaciones, que se piden a Rinkel
 * con esa clave.
 */
export async function desvincularClave(service: Servicio, userId: string): Promise<{ ok: boolean }> {
  const { error: e1 } = await service.from('rinkel_claves').delete().eq('user_id', userId)
  const { error: e2 } = await service.from('rinkel_vinculos').delete().eq('user_id', userId)
  return { ok: !e1 && !e2 }
}
