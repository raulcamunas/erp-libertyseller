import { randomBytes } from 'node:crypto'
import { createServiceClient } from '@/lib/supabase/service'
import { cajasDeRemesa, guardarCajas, type ClienteDeBase } from './cajas'
import { limpiarCajas } from './cajas-validacion'
import { porQueNoSePuedeEncajar, resumirEncaje, type CajaEnEdicion, type LineaParaEncajar } from './encaje-resumen'
import { puedeAvanzar, puedeEditarCajas, type EstadoRemesa } from './flujo'

/**
 * EL ENLACE PÚBLICO PARA QUE EL CLIENTE ENCAJE SIN ENTRAR AL ERP.
 * ==============================================================
 * SOLO SERVIDOR. Se comprueba con encaje-enlace.prueba.ts, con una base de mentira en memoria.
 *
 * Encajar es el paso que depende del cliente —él tiene la mercancía, el metro y la báscula— y
 * obligarle a entrar al ERP, con su usuario y su contraseña, para repartir unas unidades en unas
 * cajas es justo lo que hace que el envío se quede esperando. Un enlace con un token lo evita: abre
 * una página con la marca de Liberty Seller que SOLO sirve para eso.
 *
 *
 * ============ QUÉ PUEDE HACER QUIEN TIENE EL ENLACE, Y NADA MÁS ============
 *
 *   · Ver qué referencias y cuántas unidades tiene ESE envío (nombre, variante, SKU y cantidad: nada
 *     de precios, ni de otros envíos, ni de otros clientes).
 *   · Guardar las cajas de ESE envío, y solo mientras está en «Encajando».
 *   · Decir «he terminado», que es el mismo paso de 'encajando' a 'lista' que da el cliente en el ERP,
 *     con las MISMAS comprobaciones (`puedeAvanzar`): que cuadre y que cada caja tenga medidas y peso.
 *
 * No hay sesión: el token ES la credencial. Por eso:
 *
 *   · 256 bits de azar (32 bytes en base64url): no se adivina ni se recorre.
 *   · Caduca a los 30 días y se puede desactivar en cualquier momento. Solo hay UNO activo por envío.
 *   · Las tablas del enlace no se pueden leer desde el navegador (sin políticas): todo pasa por aquí,
 *     con la clave de servicio y después de comprobar el token.
 *   · Un enlace caducado, desactivado o inventado se contesta igual desde fuera: «no es válido».
 *
 * El token se guarda tal cual, no su resumen: la agencia tiene que poder volver a copiar el enlace
 * cuando quiera, y quien llegara a leer esta tabla ya podría leer mucho más que un enlace de encaje.
 */

export const DIAS_DE_VIDA_DEL_ENLACE = 30
/** Si le quedan menos días que esto, al copiarlo se alarga la fecha (el enlace es el mismo: el cliente ya lo tiene) */
export const DIAS_PARA_RENOVAR = 7
export const FORMA_DE_TOKEN = /^[A-Za-z0-9_-]{43}$/
/** Tope de cajas desde fuera de la agencia: un envío real tiene decenas, no cientos */
export const MAX_CAJAS_PUBLICAS = 200
/** Tope del cuerpo de una petición de guardado: 200 cajas con 60 referencias caben de sobra en esto */
export const MAX_BYTES_ENCAJE = 256 * 1024

const DIA_MS = 86_400_000

export const nuevoToken = (): string => randomBytes(32).toString('base64url')
export const rutaDelEnlace = (token: string): string => `/encajar/${token}`

/* ------------------------------------------------------------------ */
/* El enlace                                                           */
/* ------------------------------------------------------------------ */

export interface EnlaceDeEncaje {
  id: string
  remesaId: string
  token: string
  creadoAt: string
  caducaAt: string
  revocadoAt: string | null
  abiertoVeces: number
  ultimoUsoAt: string | null
  ultimaEdicionAt: string | null
  terminadoAt: string | null
}

interface FilaEnlace {
  id: string
  remesa_id: string
  token: string
  creado_at: string
  caduca_at: string
  revocado_at: string | null
  abierto_veces: number | null
  ultimo_uso_at: string | null
  ultima_edicion_at: string | null
  terminado_at: string | null
}

const COLUMNAS = 'id, remesa_id, token, creado_at, caduca_at, revocado_at, abierto_veces, ultimo_uso_at, ultima_edicion_at, terminado_at'

const aEnlace = (f: FilaEnlace): EnlaceDeEncaje => ({
  id: f.id,
  remesaId: f.remesa_id,
  token: f.token,
  creadoAt: f.creado_at,
  caducaAt: f.caduca_at,
  revocadoAt: f.revocado_at,
  abiertoVeces: f.abierto_veces ?? 0,
  ultimoUsoAt: f.ultimo_uso_at,
  ultimaEdicionAt: f.ultima_edicion_at,
  terminadoAt: f.terminado_at,
})

/** 42P01 lo dice Postgres y PGRST205 PostgREST cuando no tiene la tabla en su caché: la migración 232 no está lanzada */
const faltaLaTabla = (e: { code?: string } | null): boolean => e?.code === '42P01' || e?.code === 'PGRST205'

/** La migración no está lanzada. Solo se lanza desde las funciones de la agencia: desde fuera, el enlace «no es válido» */
export class FaltaLaMigracion extends Error {
  constructor() {
    super('Falta lanzar la migración 232_fba_enlaces_encaje.sql en Supabase: sin ella no se pueden crear enlaces para el cliente.')
    this.name = 'FaltaLaMigracion'
  }
}

/* ------------------------------------------------------------------ */
/* Lo que hace la agencia: copiar, ver y desactivar el enlace          */
/* ------------------------------------------------------------------ */

/** El enlace vivo de un envío: el que no está desactivado ni caducado. null si no hay */
export async function enlaceActivoDe(remesaId: string, service: ClienteDeBase = createServiceClient(), ahora = new Date()): Promise<EnlaceDeEncaje | null> {
  const { data, error } = await service
    .from('fba_enlaces_encaje')
    .select(COLUMNAS)
    .eq('remesa_id', remesaId)
    .is('revocado_at', null)
    .order('creado_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) {
    if (faltaLaTabla(error)) throw new FaltaLaMigracion()
    throw error
  }
  if (!data) return null
  const enlace = aEnlace(data as FilaEnlace)
  return Date.parse(enlace.caducaAt) > ahora.getTime() ? enlace : null
}

/** Desactiva el enlace vivo y crea otro. Quien tuviera el anterior deja de poder entrar */
export async function crearEnlace(remesaId: string, userId: string | null, service: ClienteDeBase = createServiceClient(), ahora = new Date()): Promise<EnlaceDeEncaje> {
  const iso = ahora.toISOString()
  // Hay un único enlace sin desactivar por envío (índice único parcial): primero se apaga el de antes, caducado o no
  const { error: errApagar } = await service.from('fba_enlaces_encaje').update({ revocado_at: iso }).eq('remesa_id', remesaId).is('revocado_at', null)
  if (errApagar) {
    if (faltaLaTabla(errApagar)) throw new FaltaLaMigracion()
    throw errApagar
  }
  const { data, error } = await service
    .from('fba_enlaces_encaje')
    .insert({ remesa_id: remesaId, token: nuevoToken(), creado_por: userId, caduca_at: new Date(ahora.getTime() + DIAS_DE_VIDA_DEL_ENLACE * DIA_MS).toISOString() })
    .select(COLUMNAS)
    .single()
  if (error) {
    if (faltaLaTabla(error)) throw new FaltaLaMigracion()
    // Dos clics a la vez: el otro se adelantó. Vale el que ha quedado
    if (error.code === '23505') {
      const vivo = await enlaceActivoDe(remesaId, service, ahora)
      if (vivo) return vivo
    }
    throw error
  }
  return aEnlace(data as FilaEnlace)
}

/**
 * El enlace para copiar: el que ya hay, o uno nuevo si no hay. Si al que hay le quedan pocos días se
 * le alarga la fecha SIN cambiar el token: el cliente ya lo tiene y no debería dejar de funcionarle
 * por haber vuelto a copiarlo.
 */
export async function enlaceParaCopiar(remesaId: string, userId: string | null, service: ClienteDeBase = createServiceClient(), ahora = new Date()): Promise<EnlaceDeEncaje> {
  const vivo = await enlaceActivoDe(remesaId, service, ahora)
  if (!vivo) return crearEnlace(remesaId, userId, service, ahora)
  if (Date.parse(vivo.caducaAt) - ahora.getTime() >= DIAS_PARA_RENOVAR * DIA_MS) return vivo
  const caducaAt = new Date(ahora.getTime() + DIAS_DE_VIDA_DEL_ENLACE * DIA_MS).toISOString()
  const { error } = await service.from('fba_enlaces_encaje').update({ caduca_at: caducaAt }).eq('id', vivo.id)
  if (error) throw error
  return { ...vivo, caducaAt }
}

/** Desactiva el enlace vivo. true si había alguno */
export async function revocarEnlace(remesaId: string, service: ClienteDeBase = createServiceClient(), ahora = new Date()): Promise<boolean> {
  const { data, error } = await service.from('fba_enlaces_encaje').update({ revocado_at: ahora.toISOString() }).eq('remesa_id', remesaId).is('revocado_at', null).select('id')
  if (error) {
    if (faltaLaTabla(error)) throw new FaltaLaMigracion()
    throw error
  }
  return ((data as unknown[] | null) ?? []).length > 0
}

/* ------------------------------------------------------------------ */
/* Lo que hace quien tiene el enlace                                   */
/* ------------------------------------------------------------------ */

export type MotivoDeEnlaceNoValido = 'invalido' | 'revocado' | 'caducado'

export interface RemesaDeEnlace {
  id: string
  nombre: string | null
  fechaEnvio: string
  estado: EstadoRemesa
  clienteId: string
  clienteNombre: string
}

export type ResolucionDeEnlace = { ok: true; enlace: EnlaceDeEncaje; remesa: RemesaDeEnlace } | { ok: false; motivo: MotivoDeEnlaceNoValido }

/** Lo que se le dice a quien llega con un enlace que no vale */
export const TEXTO_DE_ENLACE_NO_VALIDO: Record<MotivoDeEnlaceNoValido, string> = {
  invalido: 'Este enlace no es válido. Comprueba que lo has copiado entero o pide uno nuevo a Liberty Seller.',
  revocado: 'Este enlace ya no está activo. Pide uno nuevo a Liberty Seller.',
  caducado: 'Este enlace ha caducado. Pide uno nuevo a Liberty Seller.',
}

/** De quién es el token y a qué envío da paso. El único sitio por el que se entra: todo lo demás parte de aquí */
export async function resolverEnlace(token: string, service: ClienteDeBase = createServiceClient(), ahora = new Date()): Promise<ResolucionDeEnlace> {
  const invalido: ResolucionDeEnlace = { ok: false, motivo: 'invalido' }
  if (!FORMA_DE_TOKEN.test(token)) return invalido

  const { data, error } = await service.from('fba_enlaces_encaje').select(COLUMNAS).eq('token', token).maybeSingle()
  if (error) {
    // Sin la migración no hay ningún enlace: desde fuera es un enlace que no vale, no un fallo
    if (faltaLaTabla(error)) return invalido
    throw error
  }
  if (!data) return invalido

  const enlace = aEnlace(data as FilaEnlace)
  if (enlace.revocadoAt) return { ok: false, motivo: 'revocado' }
  if (Date.parse(enlace.caducaAt) <= ahora.getTime()) return { ok: false, motivo: 'caducado' }

  const { data: r } = await service.from('fba_remesas').select('id, nombre, fecha_envio, estado, client_id').eq('id', enlace.remesaId).maybeSingle()
  if (!r) return invalido
  const fila = r as { id: string; nombre: string | null; fecha_envio: string; estado: EstadoRemesa | null; client_id: string }
  const { data: c } = await service.from('amazon_clients').select('name').eq('id', fila.client_id).maybeSingle()

  return {
    ok: true,
    enlace,
    remesa: {
      id: fila.id,
      nombre: fila.nombre,
      fechaEnvio: fila.fecha_envio,
      // Las de antes de la 195 no tienen estado: son historia y cuentan como cerradas
      estado: (fila.estado ?? 'cerrada') as EstadoRemesa,
      clienteId: fila.client_id,
      clienteNombre: (c as { name: string } | null)?.name ?? 'Tu envío',
    },
  }
}

/** Anota que se ha abierto la página. Si falla no importa: es un dato para la agencia, no parte del trabajo */
export async function anotarApertura(enlace: EnlaceDeEncaje, service: ClienteDeBase = createServiceClient(), ahora = new Date()): Promise<void> {
  try {
    await service.from('fba_enlaces_encaje').update({ abierto_veces: enlace.abiertoVeces + 1, ultimo_uso_at: ahora.toISOString() }).eq('id', enlace.id)
  } catch {
    /* un contador que no sube no tumba la página */
  }
}

export interface DatosDeEncaje {
  titulo: string
  cliente: string
  fechaEnvio: string
  estado: EstadoRemesa
  /** ¿Se pueden tocar las cajas ahora? Solo en «Encajando» */
  editable: boolean
  caducaAt: string
  lineas: LineaParaEncajar[]
  cajas: CajaEnEdicion[]
}

const fechaCorta = (f: string) => (/^\d{4}-\d{2}-\d{2}/.test(f) ? `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}` : f)

/** Lo que la página necesita para pintarse: qué hay que encajar y qué lleva ya encajado */
export async function datosParaEncajar(r: Extract<ResolucionDeEnlace, { ok: true }>, service: ClienteDeBase = createServiceClient()): Promise<DatosDeEncaje> {
  const lineas = await lineasDeLaRemesa(r.remesa.id, service)
  const { cajas } = await cajasDeRemesa(r.remesa.id, service)
  return {
    titulo: r.remesa.nombre?.trim() || `Envío del ${fechaCorta(r.remesa.fechaEnvio)}`,
    cliente: r.remesa.clienteNombre,
    fechaEnvio: r.remesa.fechaEnvio,
    estado: r.remesa.estado,
    editable: puedeEditarCajas(r.remesa.estado),
    caducaAt: r.enlace.caducaAt,
    lineas,
    cajas: cajas.map((c) => ({ numero: c.numero, largoCm: c.largoCm, anchoCm: c.anchoCm, altoCm: c.altoCm, pesoKg: c.pesoKg, contenido: c.contenido })),
  }
}

async function lineasDeLaRemesa(remesaId: string, service: ClienteDeBase): Promise<LineaParaEncajar[]> {
  const { data, error } = await service.from('fba_remesa_lineas').select('sku, unidades, nombre, variante, referencia').eq('remesa_id', remesaId)
  if (error) throw error
  return ((data ?? []) as Array<{ sku: string; unidades: number; nombre: string | null; variante: string | null; referencia: string | null }>)
    .map((l) => ({ sku: l.sku, nombre: l.nombre, variante: l.variante, referencia: l.referencia, unidades: l.unidades }))
    .sort((a, b) => a.sku.localeCompare(b.sku, 'es', { numeric: true, sensitivity: 'base' }))
}

/* ------------------------------------------------------------------ */
/* Guardar y terminar                                                  */
/* ------------------------------------------------------------------ */

export interface Fallo {
  ok: false
  /** El código HTTP que le corresponde */
  estado: number
  error: string
  motivos?: string[]
}

export { porQueNoSePuedeEncajar }

export type ResultadoDeGuardado = { ok: true; guardadoAt: string; cajas: number; listo: boolean } | Fallo

/**
 * Guarda las cajas que manda la página. Se valida TODO antes de tocar nada y con reglas más estrictas
 * que en el ERP: solo SKU de este envío y nunca más unidades de las declaradas.
 */
export async function guardarEncaje(r: Extract<ResolucionDeEnlace, { ok: true }>, crudas: unknown, service: ClienteDeBase = createServiceClient(), ahora = new Date()): Promise<ResultadoDeGuardado> {
  if (!puedeEditarCajas(r.remesa.estado)) return { ok: false, estado: 409, error: porQueNoSePuedeEncajar(r.remesa.estado) }

  const lineas = await lineasDeLaRemesa(r.remesa.id, service)
  const declaradas = new Map(lineas.map((l) => [l.sku, l.unidades]))
  const limpieza = limpiarCajas(crudas, { maxCajas: MAX_CAJAS_PUBLICAS, declaradas })
  if (!limpieza.ok) return { ok: false, estado: 400, error: limpieza.error }

  await guardarCajas(r.remesa.id, limpieza.cajas, service)
  const guardadoAt = ahora.toISOString()
  await service.from('fba_enlaces_encaje').update({ ultima_edicion_at: guardadoAt }).eq('id', r.enlace.id)

  const resumen = resumirEncaje(lineas, limpieza.cajas.map((c) => ({ ...c, contenido: c.contenido })))
  return { ok: true, guardadoAt, cajas: limpieza.cajas.length, listo: resumen.listo }
}

export type ResultadoDeTerminar = { ok: true } | Fallo

/**
 * «He terminado de encajar»: de 'encajando' a 'lista', como lo da el cliente en el ERP. Decide
 * `puedeAvanzar` con lo que hay en la base en este instante —no con lo que la página crea tener—, y el
 * cambio de estado solo se aplica si el envío SIGUE en 'encajando': así un cambio de la agencia entre
 * medias no se pisa.
 */
export async function terminarEncaje(r: Extract<ResolucionDeEnlace, { ok: true }>, service: ClienteDeBase = createServiceClient(), ahora = new Date()): Promise<ResultadoDeTerminar> {
  if (r.remesa.estado !== 'encajando') return { ok: false, estado: 409, error: porQueNoSePuedeEncajar(r.remesa.estado) }

  const lineas = await lineasDeLaRemesa(r.remesa.id, service)
  const datos = await cajasDeRemesa(r.remesa.id, service)
  const permiso = puedeAvanzar('encajando', 'lista', 'cliente', { lineas: lineas.length, cuadre: datos.cuadre, cajas: datos.estado })
  if (!permiso.puede) {
    const motivos = permiso.motivos.map((m) => m.texto)
    return { ok: false, estado: 409, error: motivos.join('. '), motivos }
  }

  const iso = ahora.toISOString()
  const { data, error } = await service.from('fba_remesas').update({ estado: 'lista', lista_at: iso, updated_at: iso }).eq('id', r.remesa.id).eq('estado', 'encajando').select('id')
  if (error) throw error
  if (((data as unknown[] | null) ?? []).length === 0) return { ok: false, estado: 409, error: 'El envío acaba de cambiar de paso. Recarga la página.' }

  await service.from('fba_enlaces_encaje').update({ terminado_at: iso }).eq('id', r.enlace.id)
  return { ok: true }
}
