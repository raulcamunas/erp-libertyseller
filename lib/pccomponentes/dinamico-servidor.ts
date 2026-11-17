import 'server-only'
import { createServiceClient } from '@/lib/supabase/service'
import { fetchAll } from '@/lib/supabase/paginacion'
import { isMissingSchema } from '@/lib/plataforma/eventos'
import { comisionDe, precioMinimoParaMargen } from './margenes'
import { decidirPrecio, type MotivoDinamico } from './dinamico'
import { FRASE_DE_CONFIRMACION, leerTodasLasOfertas, ofertasDeProductos, subirOfertas } from './mirakl'
import type { OfertaParaSubir, OfertaPcc } from './datos'

/**
 * PRECIOS DINÁMICOS DE ENTRAIS EN PCCOMPONENTES — LA PASADA. SOLO SERVIDOR. ESCRIBE EN LA TIENDA (si no está en ensayo).
 *
 *   1. Lee las ofertas de Entrais (OF21) y, de esos productos, las de todas las tiendas (P11, 100 por llamada).
 *   2. Para cada una decide el precio con `decidirPrecio` (lib/pccomponentes/dinamico.ts) y el mínimo del margen por tramos de coste.
 *   3. En ENSAYO apunta lo que haría en `pcc_precios_log` y no toca nada. Si no, manda los que cambian (OF24, 500 por envío, uno por minuto) con TODOS los
 *      campos de la oferta: Mirakl reinicia a su valor por defecto cualquiera que no se mande.
 *
 * El reloj está en la configuración (`cada_minutos`): la ruta del cron se llama cada minuto y casi siempre contesta sin hacer nada.
 */

export interface ConfigDinamica {
  activo: boolean
  ensayo: boolean
  cada_minutos: number
  centimos: number
  limite_coste: number
  margen_bajo: number
  margen_alto: number
  subir: boolean
  ultima_pasada_at: string | null
  ultimo_resumen: Record<string, unknown> | null
}

export class FaltaMigracion321 extends Error {
  constructor() {
    super('Falta lanzar la migración 321 (precios dinámicos de PcComponentes).')
  }
}

export async function leerConfig(): Promise<ConfigDinamica> {
  const { data, error } = await createServiceClient().from('pcc_precios_config').select('*').eq('unica', true).maybeSingle()
  if (error) throw isMissingSchema(error) ? new FaltaMigracion321() : error
  if (!data) throw new FaltaMigracion321()
  const c = data as Record<string, unknown>
  return {
    activo: c.activo === true,
    ensayo: c.ensayo !== false,
    cada_minutos: Number(c.cada_minutos),
    centimos: Number(c.centimos),
    limite_coste: Number(c.limite_coste),
    margen_bajo: Number(c.margen_bajo),
    margen_alto: Number(c.margen_alto),
    subir: c.subir !== false,
    ultima_pasada_at: (c.ultima_pasada_at as string | null) ?? null,
    ultimo_resumen: (c.ultimo_resumen as Record<string, unknown> | null) ?? null,
  }
}

export async function guardarConfig(cambios: Partial<Omit<ConfigDinamica, 'ultima_pasada_at' | 'ultimo_resumen'>>, userId: string): Promise<ConfigDinamica> {
  const { error } = await createServiceClient()
    .from('pcc_precios_config')
    .update({ ...cambios, actualizado_at: new Date().toISOString(), actualizado_por: userId })
    .eq('unica', true)
  if (error) throw isMissingSchema(error) ? new FaltaMigracion321() : error
  return leerConfig()
}

const r2 = (n: number) => Math.round(n * 100) / 100

export interface ResumenDePasada {
  hecho: boolean
  motivo: string
  ensayo?: boolean
  ofertas?: number
  cambios?: number
  bajan?: number
  suben?: number
  alMinimo?: number
  sinCoste?: number
  enviados?: number
  importaciones?: string[]
  errores?: string[]
}

/** ¿Le toca pasada ahora? (para no abrir registro de cron cada minuto) */
export async function tocaPasada(): Promise<boolean> {
  const c = await leerConfig()
  return c.activo && (!c.ultima_pasada_at || Date.now() - Date.parse(c.ultima_pasada_at) >= c.cada_minutos * 60_000 - 20_000)
}

/** Una pasada si toca (o si se fuerza). `forzarEnsayo` la hace en ensayo aunque la configuración diga que no (el botón «Probar ahora») */
export async function pasadaSiToca(opciones: { forzar?: boolean; forzarEnsayo?: boolean } = {}): Promise<ResumenDePasada> {
  const config = await leerConfig()
  if (!config.activo && !opciones.forzar) return { hecho: false, motivo: 'apagado' }
  if (!opciones.forzar && config.ultima_pasada_at && Date.now() - Date.parse(config.ultima_pasada_at) < config.cada_minutos * 60_000 - 20_000) {
    return { hecho: false, motivo: 'todavía no toca' }
  }
  const ensayo = config.ensayo || opciones.forzarEnsayo === true
  const service = createServiceClient()
  const ahora = new Date().toISOString()
  // Se sella al empezar: si esta pasada se cuelga, la siguiente no arranca encima cada minuto
  await service.from('pcc_precios_config').update({ ultima_pasada_at: ahora }).eq('unica', true)

  const { ofertas } = await leerTodasLasOfertas(5000, { forzar: true })
  const nuestras = ofertas.filter((o) => o.activa && o.ean && o.precio !== null && o.precio > 0)
  const mercado = await ofertasDeProductos([...new Set(nuestras.map((o) => o.ean!))])

  const costes = new Map(
    (await fetchAll<{ sku: string; coste: number | null }>((a, b) => service.from('entrais_precios').select('sku, coste').order('sku', { ascending: true }).range(a, b))).map((f) => [f.sku, f.coste === null ? null : Number(f.coste)])
  )

  const log: Array<Record<string, unknown>> = []
  const aSubir: Array<{ oferta: OfertaPcc; precio: number; fila: Record<string, unknown> }> = []
  const cuenta: Record<MotivoDinamico, number> = { bajar_bajo_rival: 0, subir_bajo_siguiente: 0, al_minimo_rival_mas_barato: 0, subir_al_minimo: 0, sin_rivales: 0, ya_esta: 0, sin_coste: 0 }

  for (const o of nuestras) {
    const lista = mercado.get(o.ean!) ?? []
    const idx = lista.findIndex((x) => x.ofertaId !== null && x.ofertaId === o.ofertaId)
    const yo = idx >= 0 ? lista[idx] : null
    const rivales = lista.filter((x, i) => i !== idx && x.activa && x.cantidad > 0).map((x) => ({ tienda: x.tienda, precio: x.precio, total: x.total }))
    const coste = costes.get(o.sku) ?? null
    const margen = coste === null ? 0 : coste < config.limite_coste ? config.margen_bajo : config.margen_alto
    const minimo = coste === null || !(coste > 0) ? null : precioMinimoParaMargen(coste, margen, comisionDe(o.categoria))
    const d = decidirPrecio({ precio: o.precio!, total: yo?.total ?? null, rivales, minimo, centimos: config.centimos, subir: config.subir })
    cuenta[d.motivo] += 1
    if (d.precio === null) continue
    const fila: Record<string, unknown> = {
      pasada_at: ahora,
      sku: o.sku,
      ean: o.ean,
      titulo: o.titulo.slice(0, 200),
      precio_antes: o.precio,
      precio_nuevo: d.precio,
      minimo,
      competidor_precio: d.rival?.total ?? null,
      competidor_tienda: d.rival?.tienda ?? null,
      puesto: idx >= 0 ? idx + 1 : null,
      tiendas: lista.length,
      motivo: d.motivo,
      ensayo,
      enviado: false,
    }
    log.push(fila)
    if (!ensayo) aSubir.push({ oferta: o, precio: d.precio, fila })
  }

  const importaciones: string[] = []
  const errores: string[] = []
  if (!ensayo && aSubir.length > 0) {
    for (let i = 0; i < aSubir.length; i += 500) {
      const lote = aSubir.slice(i, i + 500)
      const paraSubir: OfertaParaSubir[] = lote.map(({ oferta: o, precio }) => ({
        sku: o.sku,
        ean: o.ean!,
        precio: r2(precio),
        cantidad: o.cantidad,
        estadoProducto: o.estadoProducto ?? undefined,
        plazoEnvioDias: o.plazoEnvioDias ?? undefined,
        claseLogistica: o.claseLogistica ?? undefined,
        tipoIva: o.adicionales['tipo-iva'] !== undefined ? Number(o.adicionales['tipo-iva']) : undefined,
        canon: o.adicionales['canon'] !== undefined ? Number(o.adicionales['canon']) : undefined,
      }))
      // PcComponentes admite una subida por minuto
      if (i > 0) await new Promise((r) => setTimeout(r, 62_000))
      try {
        const { importacionId } = await subirOfertas(paraSubir, FRASE_DE_CONFIRMACION)
        importaciones.push(importacionId)
        for (const x of lote) Object.assign(x.fila, { enviado: true, importacion_id: importacionId })
      } catch (e) {
        const m = e instanceof Error ? e.message : String(e)
        errores.push(m)
        for (const x of lote) x.fila.error = m.slice(0, 300)
      }
    }
  }

  for (let i = 0; i < log.length; i += 500) {
    const { error } = await service.from('pcc_precios_log').insert(log.slice(i, i + 500))
    if (error) errores.push(`No se ha podido guardar el registro: ${error.message}`)
  }

  const enviados = log.filter((f) => f.enviado === true).length
  const resumen: ResumenDePasada = {
    hecho: true,
    motivo: ensayo ? `Ensayo: ${log.length} precios cambiarían` : `${enviados} de ${log.length} precios enviados a PcComponentes`,
    ensayo,
    ofertas: nuestras.length,
    cambios: log.length,
    bajan: cuenta.bajar_bajo_rival,
    suben: cuenta.subir_bajo_siguiente + cuenta.subir_al_minimo,
    alMinimo: cuenta.al_minimo_rival_mas_barato,
    sinCoste: cuenta.sin_coste,
    enviados,
    importaciones,
    errores,
  }
  await service.from('pcc_precios_config').update({ ultimo_resumen: { ...resumen, at: ahora } }).eq('unica', true)
  return resumen
}

export interface FilaDeLog {
  id: number
  pasada_at: string
  sku: string
  titulo: string | null
  precio_antes: number | null
  precio_nuevo: number | null
  minimo: number | null
  competidor_precio: number | null
  competidor_tienda: string | null
  puesto: number | null
  tiendas: number | null
  motivo: MotivoDinamico
  ensayo: boolean
  enviado: boolean
  error: string | null
}

export async function ultimosCambios(limite = 300): Promise<FilaDeLog[]> {
  const { data, error } = await createServiceClient().from('pcc_precios_log').select('id, pasada_at, sku, titulo, precio_antes, precio_nuevo, minimo, competidor_precio, competidor_tienda, puesto, tiendas, motivo, ensayo, enviado, error').order('pasada_at', { ascending: false }).order('id', { ascending: false }).limit(limite)
  if (error) throw isMissingSchema(error) ? new FaltaMigracion321() : error
  return (data ?? []) as FilaDeLog[]
}
