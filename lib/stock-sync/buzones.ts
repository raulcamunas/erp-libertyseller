/**
 * EL CATÁLOGO DE BUZONES DE CORREO (migración 198) — SOLO SERVIDOR.
 *
 * Es el ÚNICO fichero que toca `public.stock_buzones`. Hermano de perfiles.ts,
 * y con el mismo cliente de servicio, porque estas tablas están cerradas a
 * `authenticated` y la RLS solo deja mirar, no escribir.
 *
 *
 * ============ LA FRONTERA: QUÉ SALE AL NAVEGADOR Y QUÉ NO ============
 *
 * Aquí hay TRES formas del mismo buzón, y la diferencia no es cosmética:
 *
 *   · `BuzonFila`     — la fila entera. NO SALE DE ESTE FICHERO.
 *   · `BuzonElegible` — lo que viaja en cada carga de Amazon API, dentro de
 *                       `loadPerfiles()`, para que el desplegable del perfil
 *                       tenga con qué pintarse. Ocho campos y ni uno más: sin
 *                       host, sin puerto, sin usuario, sin notas.
 *   · `BuzonAdmin`    — lo que ve la pestaña Buzones, que sí necesita el host
 *                       para poder editarlo. Va por su propia ruta, pedida
 *                       solo cuando se abre esa pestaña.
 *
 * La razón de que `BuzonElegible` sea tan corto: perfiles.ts hace `select('*')`
 * y esa respuesta se serializa ENTERA en el HTML de cada carga de la pantalla.
 * Lo que entre en ese objeto acaba en el navegador de todo el que abra Amazon
 * API. El host y el usuario de un buzón no son un secreto como la contraseña,
 * pero son media credencial, y no hacen ninguna falta para pintar un
 * desplegable.
 *
 * La contraseña no está en NINGUNA de las tres: vive cifrada en
 * stock_buzon_credenciales y se lee desde ./origenes/credenciales-buzon.ts.
 *
 *
 * ============ EL DUEÑO (client_id) ES LO QUE IMPIDE CRUZAR CLIENTES =========
 *
 * Un catálogo compartido es justo el sitio por donde se cuela un cruce, y
 * cruzar datos entre clientes es lo que este proyecto tiene firmado con Amazon
 * que no hace. Si el buzón del cliente A queda elegible en el perfil del
 * cliente B, el fichero de stock de uno acaba publicado en la cuenta de Amazon
 * del otro, y NO da ningún error: se publica y ya está.
 *
 * `buzonElegibleParaPerfil()` es quien dice que no, y la ruta del perfil la
 * llama ANTES de escribir nada. El trigger de la 198 dice lo mismo desde la
 * base: es el segundo candado, el que sigue ahí cuando alguien escribe desde el
 * editor SQL de Supabase.
 */

import { createServiceClient } from '@/lib/supabase/service'
import { estadoCredencialBuzon } from './origenes/credenciales-buzon'

/** Cómo se entra en el buzón. Ver el comentario de la columna en la 198 */
export type TransporteBuzon = 'google' | 'imap'

/** De quién es: de la agencia (cualquier perfil) o de un cliente (solo el suyo) */
export type AmbitoBuzon = 'agencia' | 'cliente'

/**
 * La fila entera. NO SALE DE ESTE FICHERO: es el tipo con el que se trabaja
 * dentro, y el que usa el conector de correo para saber a dónde conectarse.
 */
export interface BuzonFila {
  id: string
  nombre: string
  direccion: string
  transporte: TransporteBuzon
  client_id: string | null
  host: string | null
  puerto: number | null
  usuario: string | null
  carpeta: string
  seguro: boolean
  activo: boolean
  notas: string | null
  ultima_prueba_at: string | null
  ultima_prueba_ok: boolean | null
  ultima_prueba_error: string | null
}

/** Lo ÚNICO que viaja en el payload de cada carga. Ver la cabecera */
export interface BuzonElegible {
  id: string
  nombre: string
  direccion: string
  transporte: TransporteBuzon
  ambito: AmbitoBuzon
  clientId: string | null
  activo: boolean
  /**
   * Si tiene contraseña guardada. Es un booleano y nunca la huella ni nada que
   * se le parezca: la pantalla solo necesita poder avisar de que un buzón IMAP
   * sin contraseña no va a leer nada, y eso cabe en un sí o un no.
   */
  tieneContrasena: boolean
}

/** Lo que ve la pestaña Buzones, que sí edita el host. Por su propia ruta */
export interface BuzonAdmin extends BuzonElegible {
  host: string | null
  puerto: number | null
  usuario: string | null
  carpeta: string
  seguro: boolean
  notas: string | null
  ultimaPruebaAt: string | null
  ultimaPruebaOk: boolean | null
  ultimaPruebaError: string | null
  /** Los perfiles que lo están usando, por nombre. Es lo que impide borrarlo */
  enUsoPor: string[]
}

/**
 * Las columnas, UNA A UNA y nunca `select('*')`.
 *
 * Es el mismo candado que DESTINO_FIELDS en perfiles.ts: lo que no se pide no
 * se puede filtrar por descuido. El día que alguien añada una columna a
 * stock_buzones, esa columna NO nace dentro de la respuesta que viaja al
 * navegador — nace fuera, y hay que decidir a mano que entre.
 */
const CAMPOS =
  'id, nombre, direccion, transporte, client_id, host, puerto, usuario, carpeta, seguro, activo, notas, ultima_prueba_at, ultima_prueba_ok, ultima_prueba_error'

const TABLA = 'stock_buzones'

/* ------------------------------------------------------------------ */
/* Lectura                                                             */
/* ------------------------------------------------------------------ */

/**
 * El catálogo para el desplegable del perfil.
 *
 * Devuelve TODOS los buzones, también los apagados y los de otros clientes: el
 * filtro lo hace la pantalla, que es quien sabe de qué cliente es el perfil que
 * se está mirando. Mandar la lista ya filtrada obligaría a recargarla cada vez
 * que se cambia de perfil, y son cuatro filas.
 *
 * Lanza si la tabla no está. Quien lo llame decide si eso apaga la pantalla
 * entera (no debería) o solo el desplegable.
 */
export async function listarBuzonesElegibles(): Promise<BuzonElegible[]> {
  const filas = await leerFilas()
  const conContrasena = await cualesTienenContrasena(filas)
  return filas.map((f) => aElegible(f, conContrasena.has(f.id)))
}

/** El catálogo para la pestaña Buzones, con el host y con quién lo usa */
export async function listarBuzonesAdmin(): Promise<BuzonAdmin[]> {
  const filas = await leerFilas()
  const conContrasena = await cualesTienenContrasena(filas)
  const uso = await usoPorBuzon()

  return filas.map((f) => ({
    ...aElegible(f, conContrasena.has(f.id)),
    host: f.host,
    puerto: f.puerto,
    usuario: f.usuario,
    carpeta: f.carpeta,
    seguro: f.seguro,
    notas: f.notas,
    ultimaPruebaAt: f.ultima_prueba_at,
    ultimaPruebaOk: f.ultima_prueba_ok,
    ultimaPruebaError: f.ultima_prueba_error,
    enUsoPor: uso.get(f.id) ?? [],
  }))
}

/** Un buzón, con todo. Para el conector: es quien necesita el host */
export async function leerBuzon(id: string): Promise<BuzonFila | null> {
  const service = createServiceClient()
  const { data, error } = await service.from(TABLA).select(CAMPOS).eq('id', id).maybeSingle()
  if (error) throw error
  return (data as BuzonFila | null) ?? null
}

/**
 * CON QUÉ USUARIO SE ENTRA.
 *
 * Casi siempre la dirección entera: es lo que piden Hostinger, Gmail y la
 * mayoría. La columna `usuario` solo se rellena en los proveedores raros cuyo
 * login no coincide con el correo, y por eso aquí hay un `??` y no un campo
 * obligatorio que habría que rellenar noventa y nueve veces de cada cien.
 */
export function loginDe(b: Pick<BuzonFila, 'usuario' | 'direccion'>): string {
  const u = (b.usuario ?? '').trim()
  return u || b.direccion
}

/**
 * Los perfiles que usan un buzón, por nombre.
 *
 * Por NOMBRE y no por id a propósito: es lo que se enseña al negarse a borrar
 * un buzón, y «lo usan 3 perfiles» sin decir cuáles obliga a buscarlos a mano.
 */
export async function perfilesQueUsan(buzonId: string): Promise<string[]> {
  const service = createServiceClient()
  const { data, error } = await service
    .from('stock_read_profiles')
    .select('name')
    .eq('buzon_id', buzonId)
    .order('name', { ascending: true })
  if (error) throw error
  return ((data ?? []) as { name: string }[]).map((f) => f.name)
}

/**
 * ¿PUEDE ESTE PERFIL ELEGIR ESTE BUZÓN?
 *
 * Devuelve null si sí, y el motivo EN ESPAÑOL si no. Lo llama la ruta del
 * perfil antes de escribir nada; el trigger de la 198 comprueba lo mismo desde
 * la base pero contesta con un error de Postgres, que no se puede enseñar.
 *
 * Quitar el buzón (null) siempre vale: es volver a la cuenta de siempre.
 */
export async function buzonElegibleParaPerfil(
  buzonId: string | null,
  clientId: string
): Promise<string | null> {
  if (!buzonId) return null

  const buzon = await leerBuzon(buzonId)
  if (!buzon) return 'Ese buzón ya no existe. Recarga la pantalla y vuelve a elegirlo.'

  if (buzon.client_id && buzon.client_id !== clientId) {
    return (
      'Ese buzón es de otro cliente y este perfil no puede usarlo. Un buzón con dueño solo lo ' +
      'pueden elegir los perfiles de ese cliente; si es compartido, quítale el dueño en Amazon API › Buzones.'
    )
  }

  if (!buzon.activo) {
    return (
      `El buzón «${buzon.nombre}» está apagado. Enciéndelo en Amazon API › Buzones antes de ` +
      'asignárselo a un perfil, o elige otro.'
    )
  }

  return null
}

/* ------------------------------------------------------------------ */
/* Escritura                                                           */
/* ------------------------------------------------------------------ */

export interface AltaBuzon {
  nombre: string
  direccion: string
  transporte: TransporteBuzon
  clientId: string | null
  host: string | null
  puerto: number | null
  usuario: string | null
  carpeta: string | null
  seguro: boolean
  notas: string | null
}

export async function crearBuzon(datos: AltaBuzon, userId: string | null): Promise<BuzonFila> {
  const service = createServiceClient()
  const { data, error } = await service
    .from(TABLA)
    .insert({
      ...aFila(datos),
      created_by: userId,
      updated_by: userId,
    })
    .select(CAMPOS)
    .single()
  if (error) throw error
  return data as BuzonFila
}

export async function actualizarBuzon(
  id: string,
  cambios: Partial<AltaBuzon> & { activo?: boolean },
  userId: string | null
): Promise<BuzonFila> {
  const patch: Record<string, unknown> = { updated_by: userId }

  // Uno a uno y no un spread: así un campo que no venga en el cuerpo se queda
  // como está, en vez de escribirse a null porque `undefined` se serializó.
  if (cambios.nombre !== undefined) patch.nombre = cambios.nombre.trim()
  if (cambios.direccion !== undefined) patch.direccion = cambios.direccion.trim().toLowerCase()
  if (cambios.transporte !== undefined) patch.transporte = cambios.transporte
  if (cambios.clientId !== undefined) patch.client_id = cambios.clientId
  if (cambios.host !== undefined) patch.host = vacioEsNull(cambios.host)
  if (cambios.puerto !== undefined) patch.puerto = cambios.puerto
  if (cambios.usuario !== undefined) patch.usuario = vacioEsNull(cambios.usuario)
  if (cambios.carpeta !== undefined) patch.carpeta = (cambios.carpeta ?? '').trim() || 'INBOX'
  if (cambios.seguro !== undefined) patch.seguro = cambios.seguro
  if (cambios.notas !== undefined) patch.notas = vacioEsNull(cambios.notas)
  if (cambios.activo !== undefined) patch.activo = cambios.activo

  const service = createServiceClient()
  const { data, error } = await service
    .from(TABLA)
    .update(patch)
    .eq('id', id)
    .select(CAMPOS)
    .single()
  if (error) throw error
  return data as BuzonFila
}

/**
 * Borra un buzón. NO comprueba si está en uso: eso lo hace la ruta, que es
 * quien puede contestar con la lista de perfiles por nombre.
 *
 * Si aun así llega aquí uno en uso, Postgres lo para con un 23503 y la ruta lo
 * traduce. La clave ajena no lleva RESTRICT —ver el comentario largo de la
 * 198— pero un perfil apuntando a una fila que ya no está sigue siendo una
 * violación de integridad y Postgres la sigue impidiendo.
 */
export async function borrarBuzon(id: string): Promise<void> {
  const service = createServiceClient()
  const { error } = await service.from(TABLA).delete().eq('id', id)
  if (error) throw error
}

/**
 * Deja escrito el resultado del botón «Probar».
 *
 * Tres columnas y no una: «nunca se probó» y «se probó y falló» no se parecen
 * en nada. La FECHA la enseña siempre la pantalla al lado del resultado, porque
 * un «bien» de hace tres semanas con la contraseña caducada ayer es una mentira.
 *
 * No lanza: que falle el apunte no puede tumbar la prueba, que es lo que de
 * verdad se ha pedido. Se traga y se sigue.
 */
export async function anotarPrueba(id: string, ok: boolean, error: string | null): Promise<void> {
  try {
    const service = createServiceClient()
    await service
      .from(TABLA)
      .update({
        ultima_prueba_at: new Date().toISOString(),
        ultima_prueba_ok: ok,
        ultima_prueba_error: ok ? null : (error ?? '').slice(0, 500) || null,
      })
      .eq('id', id)
  } catch {
    // A propósito en silencio. Ver arriba.
  }
}

/* ------------------------------------------------------------------ */

async function leerFilas(): Promise<BuzonFila[]> {
  const service = createServiceClient()
  const { data, error } = await service
    .from(TABLA)
    .select(CAMPOS)
    .order('client_id', { ascending: true, nullsFirst: true })
    .order('nombre', { ascending: true })
  if (error) throw error
  return (data ?? []) as BuzonFila[]
}

/**
 * Cuáles tienen contraseña guardada.
 *
 * Los de Google NO se preguntan siquiera: entran por delegación de dominio y no
 * tienen fila en la tabla de credenciales, así que preguntarlo sería una
 * consulta por buzón para recibir siempre «no» y pintar un aviso falso de
 * «falta la contraseña» en un buzón que funciona.
 */
async function cualesTienenContrasena(filas: readonly BuzonFila[]): Promise<Set<string>> {
  const conSecreto = new Set<string>()
  for (const f of filas) {
    if (f.transporte !== 'imap') continue
    const estado = await estadoCredencialBuzon(f.id)
    if (estado.hay) conSecreto.add(f.id)
  }
  return conSecreto
}

/** Qué perfiles usa cada buzón, de una sola consulta y no una por buzón */
async function usoPorBuzon(): Promise<Map<string, string[]>> {
  const service = createServiceClient()
  const { data, error } = await service
    .from('stock_read_profiles')
    .select('name, buzon_id')
    .not('buzon_id', 'is', null)
    .order('name', { ascending: true })
  if (error) throw error

  const mapa = new Map<string, string[]>()
  for (const fila of (data ?? []) as { name: string; buzon_id: string }[]) {
    const lista = mapa.get(fila.buzon_id)
    if (lista) lista.push(fila.name)
    else mapa.set(fila.buzon_id, [fila.name])
  }
  return mapa
}

function aElegible(f: BuzonFila, tieneContrasena: boolean): BuzonElegible {
  return {
    id: f.id,
    nombre: f.nombre,
    direccion: f.direccion,
    transporte: f.transporte,
    ambito: f.client_id ? 'cliente' : 'agencia',
    clientId: f.client_id,
    activo: f.activo,
    tieneContrasena,
  }
}

function aFila(d: AltaBuzon): Record<string, unknown> {
  const esGoogle = d.transporte === 'google'
  return {
    nombre: d.nombre.trim(),
    direccion: d.direccion.trim().toLowerCase(),
    transporte: d.transporte,
    client_id: d.clientId,
    // En los de Google el host y el puerto TIENEN que ir a null: lo exige el
    // CHECK stock_buzones_google_ok de la 198, y con razón — un host escrito en
    // un buzón que se lee por la API de Gmail solo sirve para confundir a quien
    // lo lea dentro de seis meses.
    host: esGoogle ? null : vacioEsNull(d.host),
    puerto: esGoogle ? null : d.puerto,
    usuario: vacioEsNull(d.usuario),
    carpeta: (d.carpeta ?? '').trim() || 'INBOX',
    seguro: d.seguro,
    notas: vacioEsNull(d.notas),
  }
}

function vacioEsNull(v: string | null | undefined): string | null {
  const t = (v ?? '').trim()
  return t === '' ? null : t
}
