/**
 * EL MOTOR DE PRECIOS DE ENTRAIS · JUNTAR LOS DATOS Y CALCULAR
 * ===========================================================
 * SOLO SERVIDOR.
 *
 * `precios.ts` sabe calcular un precio y no sabe de dónde salen los números.
 * Este fichero es lo contrario: sabe dónde vive cada dato y no sabe calcular
 * nada. Esa separación es lo que permite contrastar el cálculo contra el Excel
 * del cliente sin base de datos ni red — y es lo que hay que respetar al tocar
 * cualquiera de los dos.
 *
 *
 * ============ CUATRO FUENTES, Y NINGUNA SABE DE LAS OTRAS ============
 *
 *   COSTE     API de Entrais           precio + canon del proveedor
 *   TARIFA    amazon_fees_estimados    la comisión REAL de Amazon, si la hay
 *   PVP       amazon_listings          lo que está publicado hoy
 *   BUY BOX   amazon_buybox_diagnostico  el FOEP y quién tiene la oferta
 *
 * Las cuatro pueden faltar y el motor sigue dando un número, pero no el mismo:
 * sin tarifa real usa el 15% prudente, sin PVP no hay con qué comparar, y sin
 * diagnóstico de Buy Box no se persigue la oferta destacada. Cada uno de esos
 * huecos sale marcado en la fila, porque un precio calculado con datos a medias
 * y uno calculado con todos se parecen mucho en una tabla y no valen lo mismo.
 *
 *
 * ============ NADA DE ESTO PUBLICA NADA ============
 *
 * Calcula y guarda la propuesta. Escribir el precio en Amazon es otra decisión,
 * con su pantalla y su confirmación, y todavía no está tomada.
 */

import { createServiceClient } from '@/lib/supabase/service'
import { fetchAll } from '@/lib/supabase/paginacion'
import { llamarEntrais, type EntornoEntrais, type ProductoEntrais } from './api'
import {
  calcularPrecio,
  type ConfigPrecios,
  type EntradaPrecio,
  type Redondeo,
  type ResultadoPrecio,
} from './precios'

/* ------------------------------------------------------------------ */
/* La configuración, tal como vive en la base                          */
/* ------------------------------------------------------------------ */

export interface FilaConfig {
  id: string
  connection_id: string | null
  marketplace_id: string | null
  entorno: EntornoEntrais
  margen_global: number
  usar_tramos: boolean
  tramos: { desde: number; margen: number }[]
  decidir_tramo_por: 'coste' | 'pvp'
  iva_venta: number
  porte: number
  tasa_digital: number
  tarifa_por_defecto: number
  redondeo: Redondeo
  margen_suelo: number | null
  updated_at: string
}

export async function leerConfig(): Promise<FilaConfig> {
  const service = createServiceClient()
  const { data, error } = await service.from('entrais_config').select('*').limit(1).single()
  if (error) throw error
  return data as unknown as FilaConfig
}

function aConfigPrecios(fila: FilaConfig): ConfigPrecios {
  return {
    margenGlobal: Number(fila.margen_global),
    usarTramos: fila.usar_tramos,
    tramos: (fila.tramos ?? []).map((t) => ({
      desde: Number(t.desde),
      margen: Number(t.margen),
    })),
    decidirTramoPor: fila.decidir_tramo_por,
    ivaVenta: Number(fila.iva_venta),
    porte: Number(fila.porte),
    tasaDigital: Number(fila.tasa_digital),
    tarifaPorDefecto: Number(fila.tarifa_por_defecto),
    redondeo: fila.redondeo,
    margenSuelo: fila.margen_suelo === null ? null : Number(fila.margen_suelo),
  }
}

/* ------------------------------------------------------------------ */
/* El porte, que ya no es un número fijo                               */
/* ------------------------------------------------------------------ */

export interface ReglaPorte {
  id: string
  orden: number
  nombre: string
  tipo: 'subfamilia' | 'familia' | 'sku' | 'defecto'
  patron: string | null
  importe: number
  iva_incluido: boolean
  activa: boolean
  nota: string | null
}

/** Sin tildes, sin mayúsculas y sin dobles espacios: «TV 55''-75''» casa igual escrito de tres formas */
function llano(v: string): string {
  return v
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Qué porte le toca a un producto, YA SIN IVA.
 *
 * La primera regla que encaja manda, por eso van ordenadas. Y la de tipo
 * `defecto` encaja siempre, así que ningún producto se queda sin porte — un
 * producto sin porte tendría el coste incompleto y el margen inflado, que es el
 * error que más caro sale de todos los de esta pantalla.
 *
 * EL IVA SE QUITA AQUÍ. Los 4 € de siempre van sin IVA; los portes de televisor
 * que dio el cliente van con IVA. Sumar 35 donde el resto del cálculo trabaja
 * sin impuestos es un 21 % de error que no da ningún síntoma: el margen sale
 * bien en pantalla y mal en la liquidación.
 */
export function porteDe(
  producto: ProductoEntrais,
  reglas: ReglaPorte[],
  ivaVenta: number
): { importe: number; regla: ReglaPorte | null } {
  const sub = llano(producto.subfamily?.description ?? '')
  const fam = llano(producto.family?.description ?? '')
  const sku = String(producto.code)

  for (const r of reglas) {
    if (!r.activa) continue
    const patron = llano(r.patron ?? '')
    const encaja =
      r.tipo === 'defecto' ||
      (r.tipo === 'subfamilia' && patron !== '' && sub.includes(patron)) ||
      (r.tipo === 'familia' && patron !== '' && fam.includes(patron)) ||
      (r.tipo === 'sku' && patron !== '' && llano(sku) === patron)
    if (!encaja) continue
    const bruto = Number(r.importe)
    return { importe: r.iva_incluido ? bruto / (1 + ivaVenta) : bruto, regla: r }
  }
  return { importe: 0, regla: null }
}

/* ------------------------------------------------------------------ */
/* Lo que sabe Amazon de cada SKU                                      */
/* ------------------------------------------------------------------ */

interface DatosAmazon {
  /** Lo publicado hoy, con IVA */
  pvp: number | null
  /** Comisión de referencia en tanto por uno. null = no la tenemos */
  tarifa: number | null
  foep: number | null
  buybox: 'nuestra' | 'de_otro' | 'nadie' | 'desconocido'
}

/**
 * Lee de una vez lo que Amazon sabe de todo el catálogo del cliente.
 *
 * SE LEE ENTERO Y SE INDEXA EN MEMORIA, en vez de preguntar por SKU. Son ~2.700
 * referencias: una consulta de tres tablas contra 2.700 filas cuesta menos que
 * 2.700 idas y venidas, y sobre todo evita el patrón de mil consultas dentro de
 * un bucle que es como se convierte un cálculo de segundos en uno de minutos.
 */
async function datosDeAmazon(
  connectionId: string,
  marketplaceId: string
): Promise<Map<string, DatosAmazon>> {
  const service = createServiceClient()
  const porSku = new Map<string, DatosAmazon>()

  /* ---------- El espejo: precio publicado ---------- */
  const listings = await fetchAll<{ sku: string; price: number | null }>((a, b) =>
    service
      .from('amazon_listings')
      .select('sku, price')
      .eq('connection_id', connectionId)
      .eq('marketplace_id', marketplaceId)
      .order('sku', { ascending: true })
      .order('id')
      .range(a, b)
  )
  for (const l of listings) {
    porSku.set(l.sku, {
      pvp: l.price === null ? null : Number(l.price),
      tarifa: null,
      foep: null,
      buybox: 'desconocido',
    })
  }

  /* ---------- Las tarifas ----------
   *
   * La tabla es de SOLO INSERCIÓN y guarda una fila por SKU y pasada, así que
   * hay varias por SKU: se lee ordenado por fecha y se queda la ÚLTIMA de cada
   * uno. Y solo las del canal propio: la de FBA es la respuesta a otra pregunta.
   *
   * La tarifa se guarda en euros y a un precio de referencia concreto, no en
   * porcentaje. El porcentaje se saca dividiendo — y es lo correcto, porque es
   * lo que se puede aplicar a un precio distinto del que se preguntó. */
  const tarifas = await fetchAll<{
    sku: string
    referral_fee: number | null
    precio_referencia: number | null
    fecha: string
  }>((a, b) =>
    service
      .from('amazon_fees_estimados')
      .select('sku, referral_fee, precio_referencia, fecha')
      .eq('connection_id', connectionId)
      .eq('marketplace_id', marketplaceId)
      .eq('canal', 'propio')
      .order('fecha', { ascending: true })
      .order('id')
      .range(a, b)
  )
  for (const t of tarifas) {
    const fila = porSku.get(t.sku)
    if (!fila) continue
    const referral = t.referral_fee === null ? null : Number(t.referral_fee)
    const referencia = t.precio_referencia === null ? null : Number(t.precio_referencia)
    // Una tarifa pedida a precio cero no dice nada, y dividir por cero menos.
    if (referral === null || referencia === null || referencia <= 0) continue
    // Van ordenadas por fecha ascendente, así que la última sobrescribe.
    fila.tarifa = referral / referencia
  }

  /* ---------- El diagnóstico de Buy Box ---------- */
  const diagnosticos = await fetchAll<{
    sku: string
    datos: { foep?: number | null; foepEstado?: string; buybox?: string } | null
    fecha: string
  }>((a, b) =>
    service
      .from('amazon_buybox_diagnostico')
      .select('sku, datos, fecha')
      .eq('connection_id', connectionId)
      .eq('marketplace_id', marketplaceId)
      .order('fecha', { ascending: true })
      .order('id')
      .range(a, b)
  )
  for (const d of diagnosticos) {
    const fila = porSku.get(d.sku)
    if (!fila) continue
    const datos = d.datos ?? {}
    // El FOEP solo vale si Amazon dijo que lo tenía. `no_disponible` y
    // `no_consultado` NO son cero: son «no lo sabemos», y tratarlos como un
    // precio bajaría el catálogo entero a nada.
    fila.foep = datos.foepEstado === 'disponible' ? (datos.foep ?? null) : null
    const bb = datos.buybox
    fila.buybox =
      bb === 'nuestra' || bb === 'de_otro' || bb === 'nadie' ? bb : 'desconocido'
  }

  return porSku
}

/* ------------------------------------------------------------------ */
/* El cálculo entero                                                   */
/* ------------------------------------------------------------------ */

export interface ResumenCalculo {
  productos: number
  conPrecio: number
  imposibles: number
  conTarifaReal: number
  porBuybox: number
  subirian: number
  bajarian: number
  sinCambio: number
  margenMedio: number | null
}

/**
 * Trae el catálogo, lo cruza con lo que sabe Amazon, calcula y guarda.
 *
 * Devuelve el resumen. Las filas quedan en `entrais_precios`, una por SKU,
 * actualizada — ver la migración 154 para por qué no es un histórico.
 */
export async function calcularTodo(
  opciones: { lanzadoPor?: string | null } = {}
): Promise<{ resumen: ResumenCalculo; ejecucionId: string }> {
  const service = createServiceClient()
  const config = await leerConfig()
  const cfg = aConfigPrecios(config)

  const { data: eje, error: errorEje } = await service
    .from('entrais_ejecuciones')
    .insert({ lanzado_por: opciones.lanzadoPor ?? null })
    .select('id')
    .single()
  if (errorEje) throw errorEje
  const ejecucionId = (eje as { id: string }).id

  try {
    /* ---------- El catálogo del proveedor ---------- */
    const productos = await llamarEntrais<ProductoEntrais[]>(config.entorno, '/api/v1/Products')
    if (!Array.isArray(productos) || productos.length === 0) {
      throw new Error(
        `Entrais ha contestado sin productos en el entorno «${config.entorno}». No se calcula nada: ` +
          'un catálogo vacío dejaría todas las propuestas sin precio.'
      )
    }

    /* ---------- Lo que sabe Amazon ---------- */
    const amazon =
      config.connection_id && config.marketplace_id
        ? await datosDeAmazon(config.connection_id, config.marketplace_id)
        : new Map<string, DatosAmazon>()

    /* ---------- Las reglas de porte ---------- */
    const { data: reglasCrudas, error: errorReglas } = await service
      .from('entrais_portes')
      .select('*')
      .order('orden', { ascending: true })
    if (errorReglas) throw errorReglas
    const reglas = (reglasCrudas ?? []) as unknown as ReglaPorte[]
    if (!reglas.some((r) => r.tipo === 'defecto' && r.activa)) {
      throw new Error(
        'No hay ninguna regla de porte por defecto activa. Sin ella habría productos sin porte, ' +
          'con el coste incompleto y el margen inflado — y nada lo delataría.'
      )
    }

    /* ---------- Los márgenes propios ---------- */
    const { data: propios, error: errorPropios } = await service
      .from('entrais_margenes_sku')
      .select('sku, margen')
    if (errorPropios) throw errorPropios
    const margenPropio = new Map(
      (propios ?? []).map((m) => [(m as { sku: string }).sku, Number((m as { margen: number }).margen)])
    )

    /* ---------- Calcular ---------- */
    const resultados: (ResultadoPrecio & { datos: DatosAmazon })[] = []
    for (const p of productos) {
      const sku = String(p.code)
      const datos = amazon.get(sku) ?? {
        pvp: null,
        tarifa: null,
        foep: null,
        buybox: 'desconocido' as const,
      }

      const { importe: porte } = porteDe(p, reglas, cfg.ivaVenta)

      const entrada: EntradaPrecio = {
        sku,
        porte,
        precioProveedor: Number(p.price) || 0,
        canon: Number(p.digitalCanon) || 0,
        tarifaReal: datos.tarifa,
        pvpActual: datos.pvp,
        margenPropio: margenPropio.get(sku) ?? null,
        foep: datos.foep,
        buybox: datos.buybox,
      }
      resultados.push({ ...calcularPrecio(entrada, cfg), datos })
    }

    /* ---------- Guardar ---------- */
    const ahora = new Date().toISOString()
    const filas = resultados.map((r) => ({
      sku: r.sku,
      precio_proveedor: null as number | null, // se rellena abajo
      canon: null as number | null,
      coste: r.coste,
      porte: r.porte,
      tarifa_aplicada: r.tarifaAplicada,
      tarifa_estimada: r.tarifaEstimada,
      margen_aplicado: r.margenAplicado,
      de_donde_el_margen: r.deDondeElMargen,
      precio_objetivo: r.precioObjetivo,
      precio: r.precio,
      origen: r.origen,
      beneficio: r.beneficio,
      margen_real: r.margenReal,
      pvp_actual: r.datos.pvp,
      dif_euros: r.difEuros,
      dif_porcentaje: r.difPorcentaje,
      foep: r.datos.foep,
      buybox: r.datos.buybox,
      aviso: r.aviso,
      calculado_at: ahora,
    }))
    // El precio del proveedor y el canon salen del producto, no del resultado
    productos.forEach((p, i) => {
      filas[i].precio_proveedor = Number(p.price) || 0
      filas[i].canon = Number(p.digitalCanon) || 0
    })

    // De 500 en 500: un upsert de 6.900 filas de golpe se pasa del tamaño que
    // aguanta PostgREST y falla con un error que no menciona el tamaño.
    const CHUNK = 500
    for (let i = 0; i < filas.length; i += CHUNK) {
      const { error } = await service
        .from('entrais_precios')
        .upsert(filas.slice(i, i + CHUNK), { onConflict: 'sku' })
      if (error) throw error
    }

    /* ---------- El resumen ---------- */
    const conPrecio = resultados.filter((r) => r.precio !== null)
    const margenes = conPrecio.map((r) => r.margenReal ?? 0)
    const resumen: ResumenCalculo = {
      productos: resultados.length,
      conPrecio: conPrecio.length,
      imposibles: resultados.filter((r) => r.aviso === 'imposible').length,
      conTarifaReal: resultados.filter((r) => !r.tarifaEstimada).length,
      porBuybox: resultados.filter((r) => r.origen === 'buybox').length,
      // Solo cuentan los que tienen con qué compararse: un producto sin listar
      // no «sube» ni «baja», simplemente todavía no está.
      subirian: resultados.filter((r) => (r.difEuros ?? 0) > 0.005).length,
      bajarian: resultados.filter((r) => (r.difEuros ?? 0) < -0.005).length,
      sinCambio: resultados.filter((r) => r.difEuros !== null && Math.abs(r.difEuros) <= 0.005)
        .length,
      margenMedio:
        margenes.length > 0 ? margenes.reduce((a, b) => a + b, 0) / margenes.length : null,
    }

    await service
      .from('entrais_ejecuciones')
      .update({
        terminado_at: new Date().toISOString(),
        productos: resumen.productos,
        con_precio: resumen.conPrecio,
        imposibles: resumen.imposibles,
        con_tarifa_real: resumen.conTarifaReal,
        por_buybox: resumen.porBuybox,
        subirian: resumen.subirian,
        bajarian: resumen.bajarian,
        sin_cambio: resumen.sinCambio,
        margen_medio: resumen.margenMedio,
      })
      .eq('id', ejecucionId)

    return { resumen, ejecucionId }
  } catch (error) {
    // La ejecución queda cerrada CON el motivo. Una fila abierta para siempre no
    // dice si el cálculo falló o si sigue corriendo.
    await service
      .from('entrais_ejecuciones')
      .update({
        terminado_at: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'Error desconocido',
      })
      .eq('id', ejecucionId)
    throw error
  }
}
