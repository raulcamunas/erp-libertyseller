import { createServiceClient } from '@/lib/supabase/service'
import type { Cuadre, EstadoDeCajas } from './flujo'

/**
 * LAS CAJAS DE UNA REMESA.
 * ========================
 * SOLO SERVIDOR.
 *
 * Sustituye a la hoja donde había un bloque por caja —CAJA 1, medidas, peso,
 * total unidades— y debajo qué iba dentro. Y sobre todo sustituye las tres
 * celdas del final: Total unidades, Total Envío y Discrepancia. Ese cero era lo
 * que se miraba antes de cerrar un envío, y calcularlo a mano en una hoja de 83
 * referencias es donde se cuelan los errores.
 */

export interface ContenidoCaja {
  sku: string
  unidades: number
}

export interface Caja {
  id: string
  numero: number
  largoCm: number | null
  anchoCm: number | null
  altoCm: number | null
  pesoKg: number | null
  boxIdAmazon: string | null
  seguimiento: string | null
  contenido: ContenidoCaja[]
  /** Suma de su contenido. Lo que en la hoja era «Total unidades» de la caja */
  unidades: number
  /** ¿Tiene las cuatro medidas? Sin ellas Amazon no acepta el envío */
  completa: boolean
}

export interface CajasDeRemesa {
  cajas: Caja[]
  cuadre: Cuadre
  estado: EstadoDeCajas
  /** Suma de todas las cajas. Lo que en la hoja era «Total unidades» */
  unidadesEncajadas: number
  /** Suma de la remesa. Lo que era «Total Envío» */
  unidadesDeclaradas: number
  /** Los kilos de todo, para el transportista */
  pesoTotalKg: number
}

interface FilaCaja {
  id: string
  numero: number
  largo_cm: string | number | null
  ancho_cm: string | number | null
  alto_cm: string | number | null
  peso_kg: string | number | null
  box_id_amazon: string | null
  seguimiento: string | null
}

/**
 * NUMERIC llega como CADENA desde PostgREST.
 *
 * Un peso de 13,20 viene como "13.20", y `13.20 > 0` en JavaScript es `true`
 * por la conversión automática pero `"".length` y las sumas se comportan como
 * texto: sumar dos pesos daría "13.2016.50". Se convierte una vez, aquí.
 */
function numero(v: string | number | null): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

/** Una caja está completa si tiene las tres medidas Y el peso, todos > 0 */
function estaCompleta(c: { largoCm: number | null; anchoCm: number | null; altoCm: number | null; pesoKg: number | null }): boolean {
  return [c.largoCm, c.anchoCm, c.altoCm, c.pesoKg].every((v) => v !== null && v > 0)
}

export async function cajasDeRemesa(remesaId: string): Promise<CajasDeRemesa> {
  const service = createServiceClient()

  const { data: filas, error } = await service
    .from('fba_cajas')
    .select('id, numero, largo_cm, ancho_cm, alto_cm, peso_kg, box_id_amazon, seguimiento')
    .eq('remesa_id', remesaId)
    .order('numero', { ascending: true })
  if (error) throw error

  const lista = (filas ?? []) as FilaCaja[]

  const { data: contenidos } = lista.length
    ? await service
        .from('fba_caja_contenido')
        .select('caja_id, sku, unidades')
        .in('caja_id', lista.map((c) => c.id))
    : { data: [] }

  const porCaja = new Map<string, ContenidoCaja[]>()
  for (const c of (contenidos ?? []) as Array<{ caja_id: string; sku: string; unidades: number }>) {
    const lote = porCaja.get(c.caja_id) ?? []
    lote.push({ sku: c.sku, unidades: c.unidades })
    porCaja.set(c.caja_id, lote)
  }

  const cajas: Caja[] = lista.map((f) => {
    const contenido = (porCaja.get(f.id) ?? []).sort((a, b) => a.sku.localeCompare(b.sku))
    const medidas = {
      largoCm: numero(f.largo_cm),
      anchoCm: numero(f.ancho_cm),
      altoCm: numero(f.alto_cm),
      pesoKg: numero(f.peso_kg),
    }
    return {
      id: f.id,
      numero: f.numero,
      ...medidas,
      boxIdAmazon: f.box_id_amazon,
      seguimiento: f.seguimiento,
      contenido,
      unidades: contenido.reduce((s, c) => s + c.unidades, 0),
      completa: estaCompleta(medidas),
    }
  })

  // El cuadre: lo declarado en la remesa contra lo que hay en las cajas.
  const { data: lineas } = await service
    .from('fba_remesa_lineas')
    .select('sku, unidades')
    .eq('remesa_id', remesaId)

  const encajadoPorSku = new Map<string, number>()
  for (const c of cajas) {
    for (const x of c.contenido) {
      encajadoPorSku.set(x.sku, (encajadoPorSku.get(x.sku) ?? 0) + x.unidades)
    }
  }

  const descuadres = ((lineas ?? []) as Array<{ sku: string; unidades: number }>).map((l) => {
    const encajadas = encajadoPorSku.get(l.sku) ?? 0
    return { sku: l.sku, declaradas: l.unidades, encajadas, diferencia: l.unidades - encajadas }
  })

  // Un SKU que está en las cajas y NO en la remesa también es un descuadre, y
  // del peligroso: mercancía que se manda sin declarar. El bucle de arriba solo
  // recorre lo declarado, así que se busca aparte.
  const declarados = new Set(descuadres.map((d) => d.sku))
  for (const [sku, encajadas] of encajadoPorSku) {
    if (!declarados.has(sku)) {
      descuadres.push({ sku, declaradas: 0, encajadas, diferencia: -encajadas })
    }
  }

  return {
    cajas,
    cuadre: { descuadres, cuadra: descuadres.every((d) => d.diferencia === 0) },
    estado: {
      cajas: cajas.length,
      sinMedidas: cajas.filter((c) => !c.completa).length,
      vacias: cajas.filter((c) => c.unidades === 0).length,
    },
    unidadesEncajadas: cajas.reduce((s, c) => s + c.unidades, 0),
    unidadesDeclaradas: descuadres.reduce((s, d) => s + d.declaradas, 0),
    pesoTotalKg: Math.round(cajas.reduce((s, c) => s + (c.pesoKg ?? 0), 0) * 100) / 100,
  }
}

export interface CajaEntrante {
  numero: number
  largoCm: number | null
  anchoCm: number | null
  altoCm: number | null
  pesoKg: number | null
  contenido: ContenidoCaja[]
}

/**
 * Guarda TODAS las cajas de una remesa de golpe.
 *
 * Se sustituye el conjunto entero en vez de ir caja a caja, y es deliberado: la
 * pantalla es una tabla que se edita a la vez —se añade una caja, se mueven tres
 * unidades de la 1 a la 2, se corrige un peso— y mandar eso como diez
 * operaciones sueltas abre la puerta a que la mitad se apliquen. Aquí o queda
 * todo como está en pantalla, o no queda nada.
 *
 * Se borra y se reinserta en vez de comparar: son cajas de un envío, decenas
 * como mucho, y el código que compara es el que se equivoca.
 */
export async function guardarCajas(remesaId: string, cajas: CajaEntrante[]): Promise<number> {
  const service = createServiceClient()

  // El contenido cae con las cajas (CASCADE), así que basta con borrar estas.
  const { error: errBorrar } = await service.from('fba_cajas').delete().eq('remesa_id', remesaId)
  if (errBorrar) throw errBorrar

  if (cajas.length === 0) return 0

  const { data: creadas, error: errAlta } = await service
    .from('fba_cajas')
    .insert(
      cajas.map((c) => ({
        remesa_id: remesaId,
        numero: c.numero,
        largo_cm: c.largoCm,
        ancho_cm: c.anchoCm,
        alto_cm: c.altoCm,
        peso_kg: c.pesoKg,
      }))
    )
    .select('id, numero')
  if (errAlta) throw errAlta

  const porNumero = new Map(
    ((creadas ?? []) as Array<{ id: string; numero: number }>).map((c) => [c.numero, c.id])
  )

  const contenido = cajas.flatMap((c) =>
    c.contenido
      .filter((x) => x.unidades > 0)
      .map((x) => ({ caja_id: porNumero.get(c.numero)!, sku: x.sku, unidades: x.unidades }))
  )

  if (contenido.length > 0) {
    const { error: errContenido } = await service.from('fba_caja_contenido').insert(contenido)
    if (errContenido) throw errContenido
  }

  return cajas.length
}
