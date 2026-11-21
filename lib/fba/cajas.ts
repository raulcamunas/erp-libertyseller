import { leerTodo } from './paginar'
import { motivosDeLimites } from './limites-caja'
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
  /**
   * La versión de las cajas (fba_remesas.cajas_version, migración 309). Quien guarda la devuelve y, si
   * alguien guardó entre medias, el guardado se rechaza con 409. null = la 309 no está lanzada.
   */
  version: number | null
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

/** El cliente de la base. Se puede pasar uno de mentira en las pruebas; por defecto es el de servicio */
export type ClienteDeBase = ReturnType<typeof createServiceClient>

export async function cajasDeRemesa(remesaId: string, service: ClienteDeBase = createServiceClient()): Promise<CajasDeRemesa> {

  const { data: filas, error } = await service
    .from('fba_cajas')
    .select('id, numero, largo_cm, ancho_cm, alto_cm, peso_kg, box_id_amazon, seguimiento')
    .eq('remesa_id', remesaId)
    .order('numero', { ascending: true })
  if (error) throw error

  const lista = (filas ?? []) as FilaCaja[]

  // Paginado: una remesa grande reparte cientos de referencias en decenas de cajas y las filas de contenido pueden pasar de 1.000
  const contenidos = lista.length
    ? await leerTodo<{ caja_id: string; sku: string; unidades: number }>((a, b) =>
        service
          .from('fba_caja_contenido')
          .select('caja_id, sku, unidades')
          .in('caja_id', lista.map((c) => c.id))
          .order('id', { ascending: true })
          .range(a, b)
      )
    : []

  const porCaja = new Map<string, ContenidoCaja[]>()
  for (const c of contenidos) {
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
      fueraDeLimites: motivosDeLimites(cajas.map((c) => ({ numero: c.numero, largoCm: c.largoCm, anchoCm: c.anchoCm, altoCm: c.altoCm, pesoKg: c.pesoKg, unidades: c.unidades }))),
    },
    unidadesEncajadas: cajas.reduce((s, c) => s + c.unidades, 0),
    unidadesDeclaradas: descuadres.reduce((s, d) => s + d.declaradas, 0),
    pesoTotalKg: Math.round(cajas.reduce((s, c) => s + (c.pesoKg ?? 0), 0) * 100) / 100,
    version: await versionesDe(remesaId, service).then((v) => v.cajas),
  }
}

/**
 * LAS VERSIONES DE LÍNEAS Y CAJAS (bloqueo optimista, migración 309).
 *
 * Aparte y sin lanzar: un `select` que nombra una columna que no existe revienta entero (42703), y la 309
 * se lanza a mano después de desplegar. Sin ella, null: se guarda como antes, sin comprobar.
 */
export async function versionesDe(remesaId: string, service: ClienteDeBase = createServiceClient()): Promise<{ lineas: number | null; cajas: number | null }> {
  try {
    const { data, error } = await service.from('fba_remesas').select('lineas_version, cajas_version').eq('id', remesaId).maybeSingle()
    if (error || !data) return { lineas: null, cajas: null }
    const f = data as { lineas_version: number | null; cajas_version: number | null }
    return { lineas: f.lineas_version ?? null, cajas: f.cajas_version ?? null }
  } catch {
    return { lineas: null, cajas: null }
  }
}

/** Alguien guardó entre medias: la versión que mandó quien guarda ya no es la de la base */
export class ConflictoDeVersion extends Error {
  constructor(mensaje = 'Alguien ha cambiado esto mientras lo editabas. Recarga para ver lo último.') {
    super(mensaje)
    this.name = 'ConflictoDeVersion'
  }
}

/** La remesa ha cambiado de paso entre la lectura y la escritura */
export class EstadoCambiado extends Error {
  constructor(mensaje: string) {
    super(mensaje)
    this.name = 'EstadoCambiado'
  }
}

/** ¿La función de la base no existe? (la migración no está lanzada) */
export const faltaLaFuncion = (e: { code?: string } | null): boolean => e?.code === 'PGRST202' || e?.code === '42883'

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
export async function guardarCajas(
  remesaId: string,
  cajas: CajaEntrante[],
  service: ClienteDeBase = createServiceClient(),
  version: number | null = null
): Promise<{ cajas: number; version: number | null }> {
  /**
   * EN UNA SOLA TRANSACCIÓN, CON EL ESTADO Y LA VERSIÓN COMPROBADOS DENTRO (migración 309).
   *
   * Antes eran tres viajes sin transacción —borrar, meter cajas, meter contenido— y un fallo a mitad
   * dejaba el envío sin cajas. Y el estado se miraba antes de escribir, no a la vez: si la agencia pasaba
   * la remesa a «Lista» entre medias, el autoguardado del cliente reescribía las cajas igual. La función
   * bloquea la remesa con FOR UPDATE, comprueba que SIGUE en «Encajando» y que nadie ha guardado desde la
   * versión que se tenía, y conserva box_id_amazon, seguimiento y envio_id por número de caja.
   */
  const { data, error } = await service.rpc('fba_guardar_cajas', {
    p_remesa: remesaId,
    p_cajas: cajas.map((c) => ({ ...c, contenido: c.contenido.filter((x) => x.unidades > 0) })),
    p_version: version,
  })
  if (!error) return { cajas: cajas.length, version: typeof data === 'number' ? data : Number(data) }
  if (error.code === '40001') throw new ConflictoDeVersion(error.message)
  if (error.code === '23514') throw new EstadoCambiado(error.message)
  if (!faltaLaFuncion(error)) throw error

  // Sin la 309: como antes. Se avisa en el registro para que se note que falta lanzarla
  console.warn('[fba] falta la migración 309: las cajas se guardan sin transacción')
  return { cajas: await guardarCajasSinTransaccion(remesaId, cajas, service), version: null }
}

/** El guardado de antes de la 309: tres viajes. Solo se usa si la función de la base no existe todavía */
async function guardarCajasSinTransaccion(remesaId: string, cajas: CajaEntrante[], service: ClienteDeBase): Promise<number> {
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
