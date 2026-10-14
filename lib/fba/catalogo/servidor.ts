/**
 * LEER Y ESCRIBIR LA BASE DE DATOS DE REFERENCIAS. SOLO SERVIDOR.
 *
 * Todo pasa por aquí y por la clave de servicio —la tabla tiene las escrituras
 * revocadas para el navegador, como el resto de fba_*—, así que lo que no se
 * compruebe en este fichero no lo comprueba nadie. Por eso:
 *
 *   · Cada función recibe el cliente y filtra por él SIEMPRE. Las rutas ya han
 *     comprobado que la sesión puede con ese cliente (lib/fba/acceso.ts); aquí se
 *     impide que un id de otro cliente, metido en una lista, se cuele.
 *   · Se valida todo lo que llega, campo a campo, con tope de longitud.
 *   · Antes de escribir se miran los choques (misma talla dos veces, mismo FBASKU en
 *     dos tallas) para decir cuál es, con sus palabras. Los índices únicos de la
 *     migración 226 son la red de debajo, para dos personas guardando a la vez.
 *
 * El código despliega antes de que nadie lance la migración, así que una tabla que
 * no existe NO es un error: se devuelve `sinMigrar` y la pantalla explica qué hacer.
 */

import { isMissingSchema } from '@/lib/plataforma/eventos'
import type { createServiceClient } from '@/lib/supabase/service'
import { leerCatalogo, planificarImportacion, type CambioFila, type FilaEntrante, type ResumenImportacion } from './importar'
import { claveTalla, type DatosFila, type FilaCatalogo } from './tipos'

type Servicio = ReturnType<typeof createServiceClient>

const COLUMNAS = 'id, ref, nombre, talla, ean, fnsku, asin, fbasku, cod_art, continuidad, precio, nota'
const POR_PAGINA = 1000
const MAX_PAGINAS = 50

interface Registro {
  id: string
  ref: string
  nombre: string
  talla: string
  ean: string | null
  fnsku: string | null
  asin: string | null
  fbasku: string | null
  cod_art: string | null
  continuidad: boolean
  precio: number | string | null
  nota: string | null
}

function deRegistro(r: Registro): FilaCatalogo {
  return {
    id: r.id,
    ref: r.ref,
    nombre: r.nombre,
    talla: r.talla,
    ean: r.ean,
    fnsku: r.fnsku,
    asin: r.asin,
    fbasku: r.fbasku,
    codArt: r.cod_art,
    continuidad: r.continuidad,
    precio: r.precio === null ? null : Number(r.precio),
    nota: r.nota,
  }
}

/** Del vocabulario de la pantalla (codArt) al de la columna (cod_art) */
function aRegistro(d: Partial<DatosFila>): Record<string, unknown> {
  const salida: Record<string, unknown> = {}
  if (d.ref !== undefined) salida.ref = d.ref
  if (d.nombre !== undefined) salida.nombre = d.nombre
  if (d.talla !== undefined) salida.talla = d.talla
  if (d.ean !== undefined) salida.ean = d.ean
  if (d.fnsku !== undefined) salida.fnsku = d.fnsku
  if (d.asin !== undefined) salida.asin = d.asin
  if (d.fbasku !== undefined) salida.fbasku = d.fbasku
  if (d.codArt !== undefined) salida.cod_art = d.codArt
  if (d.continuidad !== undefined) salida.continuidad = d.continuidad
  if (d.precio !== undefined) salida.precio = d.precio
  if (d.nota !== undefined) salida.nota = d.nota
  return salida
}

/* ------------------------------------------------------------------ */
/* Leer                                                                */
/* ------------------------------------------------------------------ */

/**
 * TODAS las filas del cliente. PostgREST corta cada respuesta en 1.000 filas sin
 * avisar —lo mismo que pasaba con los 42.737 listings de ShoesF—, así que se pide
 * por páginas hasta que una viene corta. Con una sola petición, el día que la base
 * pase de mil tallas los desplegables dejarían de ver las últimas sin dar ningún error.
 */
export async function listarCatalogo(service: Servicio, clienteId: string): Promise<{ filas: FilaCatalogo[]; sinMigrar: boolean }> {
  const filas: FilaCatalogo[] = []
  for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
    const { data, error } = await service
      .from('fba_catalogo')
      .select(COLUMNAS)
      .eq('client_id', clienteId)
      // Un orden total: sin él, dos filas con la misma REF pueden saltar de una página a otra
      .order('ref', { ascending: true })
      .order('nombre', { ascending: true })
      .order('talla', { ascending: true })
      .order('id', { ascending: true })
      .range(pagina * POR_PAGINA, (pagina + 1) * POR_PAGINA - 1)
    if (error) {
      if (isMissingSchema(error)) return { filas: [], sinMigrar: true }
      throw error
    }
    const lote = (data ?? []) as unknown as Registro[]
    for (const r of lote) filas.push(deRegistro(r))
    if (lote.length < POR_PAGINA) break
  }
  return { filas, sinMigrar: false }
}

/* ------------------------------------------------------------------ */
/* Validar lo que llega                                                */
/* ------------------------------------------------------------------ */

const LIMITES = { ref: 120, nombre: 200, talla: 20, codigo: 80, nota: 500 }

function texto(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const t = v.replace(/\s+/g, ' ').trim()
  return t === '' ? null : t.slice(0, max)
}

/**
 * Convierte lo que manda la pantalla en datos limpios. Con `completa`, ref, color y
 * talla son obligatorios (un alta); sin ella solo se miran los campos presentes (una
 * corrección). Devuelve la frase de error lista para enseñar, o los datos.
 */
export function validarDatos(bruto: unknown, completa: boolean): { datos: Partial<DatosFila> } | { error: string } {
  if (typeof bruto !== 'object' || bruto === null) return { error: 'Faltan los datos de la referencia' }
  const b = bruto as Record<string, unknown>
  const datos: Partial<DatosFila> = {}

  const obligatorio = (clave: 'ref' | 'nombre' | 'talla', max: number, rotulo: string): string | null => {
    if (!(clave in b) && !completa) return null
    const t = texto(b[clave], max)
    if (!t) return `Falta ${rotulo}`
    datos[clave] = t
    return null
  }
  const e1 = obligatorio('ref', LIMITES.ref, 'la REF') ?? obligatorio('nombre', LIMITES.nombre, 'el nombre y color') ?? obligatorio('talla', LIMITES.talla, 'la talla')
  if (e1) return { error: e1 }

  const opcional = (clave: 'ean' | 'fnsku' | 'asin' | 'fbasku' | 'codArt' | 'nota', max: number) => {
    if (clave in b) datos[clave] = texto(b[clave], max)
  }
  opcional('ean', LIMITES.codigo)
  opcional('fnsku', LIMITES.codigo)
  opcional('asin', LIMITES.codigo)
  opcional('fbasku', LIMITES.codigo)
  opcional('codArt', LIMITES.codigo)
  opcional('nota', LIMITES.nota)
  // Los códigos de Amazon van en mayúsculas; el FBASKU, tal cual
  if (datos.fnsku) datos.fnsku = datos.fnsku.toUpperCase().replace(/\s+/g, '')
  if (datos.asin) datos.asin = datos.asin.toUpperCase().replace(/\s+/g, '')
  if (datos.fbasku) datos.fbasku = datos.fbasku.replace(/\s+/g, '')
  if (datos.ean) datos.ean = datos.ean.replace(/[\s-]/g, '')

  if ('continuidad' in b) {
    if (typeof b.continuidad !== 'boolean') return { error: 'La continuidad es Sí o No' }
    datos.continuidad = b.continuidad
  }
  if ('precio' in b) {
    if (b.precio === null || b.precio === '') {
      datos.precio = null
    } else {
      const n = typeof b.precio === 'number' ? b.precio : Number(String(b.precio).replace(',', '.'))
      if (!Number.isFinite(n) || n < 0 || n > 100000) return { error: 'El precio no es un número válido' }
      datos.precio = Math.round(n * 100) / 100
    }
  }

  return { datos }
}

/* ------------------------------------------------------------------ */
/* Choques                                                             */
/* ------------------------------------------------------------------ */

/**
 * Mira si el conjunto resultante repite una talla o un FBASKU, y dice cuál con
 * palabras. `cambian` son las filas ya con sus datos finales (nuevas con id nulo,
 * o existentes corregidas); `resto` son las que no se tocan.
 */
export function buscarChoque(
  cambian: ReadonlyArray<{ id: string | null; datos: Pick<DatosFila, 'ref' | 'nombre' | 'talla' | 'fbasku'> }>,
  resto: readonly FilaCatalogo[]
): string | null {
  const tallas = new Map<string, string>()
  const skus = new Map<string, string>()
  const etiqueta = (d: Pick<DatosFila, 'ref' | 'nombre' | 'talla'>) => `${d.ref} ${d.nombre} talla ${d.talla}`

  for (const f of resto) {
    tallas.set(claveTalla(f.ref, f.nombre, f.talla), etiqueta(f))
    if (f.fbasku) skus.set(f.fbasku, etiqueta(f))
  }
  for (const c of cambian) {
    const k = claveTalla(c.datos.ref, c.datos.nombre, c.datos.talla)
    if (tallas.has(k)) return `Ya existe ${etiqueta(c.datos)}`
    tallas.set(k, etiqueta(c.datos))
    if (c.datos.fbasku) {
      const propietaria = skus.get(c.datos.fbasku)
      if (propietaria) return `El FBASKU ${c.datos.fbasku} ya lo usa ${propietaria}`
      skus.set(c.datos.fbasku, etiqueta(c.datos))
    }
  }
  return null
}

/* ------------------------------------------------------------------ */
/* Escribir                                                            */
/* ------------------------------------------------------------------ */

const MENSAJE_SIN_MIGRAR =
  'Falta lanzar la migración 226 en Supabase (fba_catalogo). Hasta entonces la base de datos de referencias no se puede guardar.'

function esChoqueUnico(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === '23505'
}

export type ResultadoEscritura<T> = { ok: true; valor: T } | { ok: false; estado: number; error: string }

/** Da de alta filas nuevas. Todas o ninguna: se comprueba el conjunto antes de escribir */
export async function crearFilas(
  service: Servicio,
  clienteId: string,
  usuarioId: string,
  filas: Array<Partial<DatosFila>>
): Promise<ResultadoEscritura<{ creadas: number }>> {
  const { filas: existentes, sinMigrar } = await listarCatalogo(service, clienteId)
  if (sinMigrar) return { ok: false, estado: 503, error: MENSAJE_SIN_MIGRAR }

  const completas = filas.map((f) => ({
    ref: f.ref as string,
    nombre: f.nombre as string,
    talla: f.talla as string,
    ean: f.ean ?? null,
    fnsku: f.fnsku ?? null,
    asin: f.asin ?? null,
    fbasku: f.fbasku ?? null,
    codArt: f.codArt ?? null,
    continuidad: f.continuidad ?? true,
    precio: f.precio ?? null,
    nota: f.nota ?? null,
  }))

  const choque = buscarChoque(
    completas.map((datos) => ({ id: null, datos })),
    existentes
  )
  if (choque) return { ok: false, estado: 409, error: choque }

  const { error } = await service
    .from('fba_catalogo')
    .insert(completas.map((d) => ({ ...aRegistro(d), client_id: clienteId, created_by: usuarioId })))
  if (error) {
    if (esChoqueUnico(error)) {
      return { ok: false, estado: 409, error: 'Alguna de esas tallas acaba de darse de alta desde otro sitio. Recarga y vuelve a mirar.' }
    }
    if (isMissingSchema(error)) return { ok: false, estado: 503, error: MENSAJE_SIN_MIGRAR }
    throw error
  }
  return { ok: true, valor: { creadas: completas.length } }
}

/**
 * Corrige una o varias filas con los MISMOS cambios. Una fila suelta lleva su talla,
 * sus códigos…; varias a la vez sirven para renombrar un modelo (REF y color en todas
 * sus tallas) o cambiar su continuidad.
 */
export async function corregirFilas(
  service: Servicio,
  clienteId: string,
  ids: string[],
  cambios: Partial<DatosFila>
): Promise<ResultadoEscritura<{ cambiadas: number }>> {
  if (Object.keys(cambios).length === 0) return { ok: false, estado: 400, error: 'No hay nada que cambiar' }

  const { filas: todas, sinMigrar } = await listarCatalogo(service, clienteId)
  if (sinMigrar) return { ok: false, estado: 503, error: MENSAJE_SIN_MIGRAR }

  const elegidas = new Set(ids)
  const afectadas = todas.filter((f) => elegidas.has(f.id))
  if (afectadas.length !== elegidas.size) return { ok: false, estado: 404, error: 'Alguna de esas referencias ya no existe' }

  // Un FBASKU solo puede ser de una talla: aplicarlo a varias a la vez es un error de quien lo manda
  if (cambios.fbasku && afectadas.length > 1) {
    return { ok: false, estado: 400, error: 'Un mismo FBASKU no puede ser de varias tallas' }
  }

  const choque = buscarChoque(
    afectadas.map((f) => ({ id: f.id, datos: { ref: cambios.ref ?? f.ref, nombre: cambios.nombre ?? f.nombre, talla: cambios.talla ?? f.talla, fbasku: cambios.fbasku !== undefined ? cambios.fbasku : f.fbasku } })),
    todas.filter((f) => !elegidas.has(f.id))
  )
  if (choque) return { ok: false, estado: 409, error: choque }

  const { error } = await service.from('fba_catalogo').update(aRegistro(cambios)).eq('client_id', clienteId).in('id', ids)
  if (error) {
    if (esChoqueUnico(error)) return { ok: false, estado: 409, error: 'Esa combinación ya existe en la base de datos' }
    if (isMissingSchema(error)) return { ok: false, estado: 503, error: MENSAJE_SIN_MIGRAR }
    throw error
  }
  return { ok: true, valor: { cambiadas: ids.length } }
}

export async function borrarFilas(service: Servicio, clienteId: string, ids: string[]): Promise<ResultadoEscritura<{ borradas: number }>> {
  const { data, error } = await service.from('fba_catalogo').delete().eq('client_id', clienteId).in('id', ids).select('id')
  if (error) {
    if (isMissingSchema(error)) return { ok: false, estado: 503, error: MENSAJE_SIN_MIGRAR }
    throw error
  }
  return { ok: true, valor: { borradas: (data ?? []).length } }
}

/* ------------------------------------------------------------------ */
/* Importar                                                            */
/* ------------------------------------------------------------------ */


const MAX_AVISOS = 300
const MAX_CAMBIOS_VISIBLES = 100

function datosDeEntrante(f: FilaEntrante): DatosFila {
  return {
    ref: f.ref,
    nombre: f.nombre,
    talla: f.talla,
    ean: f.ean,
    fnsku: f.fnsku,
    asin: f.asin,
    fbasku: f.fbasku,
    codArt: f.codArt,
    continuidad: f.continuidad ?? true,
    precio: f.precio,
    nota: f.nota,
  }
}

/** Ejecuta `tarea` sobre cada elemento con como mucho `n` a la vez */
async function conLimite<T>(items: readonly T[], n: number, tarea: (x: T) => Promise<void>): Promise<void> {
  let siguiente = 0
  const trabajadores = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (siguiente < items.length) {
      const mio = items[siguiente++]
      await tarea(mio)
    }
  })
  await Promise.all(trabajadores)
}

/**
 * Lee la hoja y la cruza con lo que hay. Con `simular` no escribe nada: es lo que
 * enseña la pantalla antes de pedir confirmación. Sin ella, aplica el MISMO plan.
 */
export async function importarHoja(
  service: Servicio,
  clienteId: string,
  usuarioId: string,
  hoja: string,
  simular: boolean
): Promise<ResumenImportacion> {
  const lectura = leerCatalogo(hoja)
  const resumen: ResumenImportacion = {
    simulado: simular,
    sinMigrar: false,
    error: lectura.error,
    leidas: lectura.leidas,
    importables: lectura.filas.length,
    columnas: lectura.columnas,
    ignoradas: lectura.ignoradas,
    nuevas: 0,
    cambian: 0,
    iguales: 0,
    avisos: lectura.avisos.slice(0, MAX_AVISOS),
    conflictos: [],
    cambios: [],
    resultado: null,
  }
  if (lectura.error) return resumen

  const { filas: existentes, sinMigrar } = await listarCatalogo(service, clienteId)
  resumen.sinMigrar = sinMigrar

  const plan = planificarImportacion(lectura.filas, existentes)
  resumen.nuevas = plan.nuevas.length
  resumen.cambian = plan.cambios.length
  resumen.iguales = plan.iguales
  resumen.conflictos = plan.conflictos.slice(0, MAX_AVISOS)
  resumen.cambios = plan.cambios.slice(0, MAX_CAMBIOS_VISIBLES).map((c: CambioFila) => ({
    fila: c.fila,
    etiqueta: `${c.antes.ref} ${c.antes.nombre} talla ${c.antes.talla}`,
    campos: c.campos as string[],
  }))

  if (simular || sinMigrar) return resumen

  let creadas = 0
  let actualizadas = 0
  let fallidas = 0

  // Altas en lotes. Si un lote choca (otra persona acaba de dar de alta alguna), se
  // reintenta fila a fila para que una mala no tire a las otras cien.
  const LOTE = 100
  for (let i = 0; i < plan.nuevas.length; i += LOTE) {
    const lote = plan.nuevas.slice(i, i + LOTE).map((f) => ({ ...aRegistro(datosDeEntrante(f)), client_id: clienteId, created_by: usuarioId }))
    const { error } = await service.from('fba_catalogo').insert(lote)
    if (!error) {
      creadas += lote.length
      continue
    }
    if (isMissingSchema(error)) throw error
    for (const fila of lote) {
      const { error: e } = await service.from('fba_catalogo').insert(fila)
      if (e) fallidas += 1
      else creadas += 1
    }
  }

  await conLimite(plan.cambios, 8, async (c) => {
    const { error } = await service.from('fba_catalogo').update(aRegistro(c.despues)).eq('client_id', clienteId).eq('id', c.id)
    if (error) fallidas += 1
    else actualizadas += 1
  })

  resumen.resultado = { creadas, actualizadas, fallidas }
  return resumen
}
