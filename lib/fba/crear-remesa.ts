import { limpiarAnalisis, type AnalisisIa } from './analisis-ia'
import { puedeEditar, type SesionFba } from './acceso'
import type { createServiceClient } from '@/lib/supabase/service'

/**
 * DAR DE ALTA UNA REMESA: LO QUE MANDAMOS A LOS ALMACENES DE AMAZON.
 * =================================================================
 * SOLO SERVIDOR (la base llega inyectada; la validación es pura y se prueba en crear-remesa.prueba.ts).
 *
 * Es la lógica que antes vivía dentro de POST /api/fba/remesas, sacada aquí para que la use también
 * «Convertir en remesa» de un envío propuesto (spec remesas-pro §4.2 y D20). El comportamiento es el mismo
 * que tenía la ruta, con UN cambio anotado (D21): el análisis de la IA lo guarda la AGENCIA que puede editar
 * ese cliente, no solo el admin. Antes un administrativo con la casilla de Remesas creaba la propuesta y el
 * porqué de cada línea se perdía en silencio.
 *
 * La cabecera y sus líneas se escriben JUNTAS. Si las líneas fallan, la remesa se borra: media remesa —una
 * cabecera sin referencias— aparece en el panel como un envío de cero unidades y se lee como un envío que no
 * vendió nada, que es justo lo contrario de lo que pasa.
 *
 * Supabase no da transacciones desde el cliente REST, así que el rescate es manual y explícito. Es feo y es
 * correcto.
 */

export const MAX_LINEAS_REMESA = 3000

type Servicio = ReturnType<typeof createServiceClient>

export interface LineaEntrante {
  sku?: unknown
  unidades?: unknown
  referencia?: unknown
  nombre?: unknown
  variante?: unknown
  ean?: unknown
  fnsku?: unknown
  asin?: unknown
}

/** Una línea ya validada, con los nombres de columna de fba_remesa_lineas */
export interface LineaRemesaNueva {
  sku: string
  unidades: number
  referencia: string | null
  nombre: string | null
  variante: string | null
  ean: string | null
  fnsku: string | null
  asin: string | null
}

export interface RemesaNueva {
  clienteId: string
  marketplaceId: string
  nombre: string | null
  fechaEnvio: string
  referenciaEnvio: string | null
  nota: string | null
  lineas: LineaRemesaNueva[]
  /** Lo que llega; se reconstruye con limpiarAnalisis antes de guardarlo */
  analisisIa: unknown
}

export type ResultadoValidacionRemesa = { ok: true; datos: RemesaNueva } | { ok: false; estado: number; error: string }

export const textoLimpio = (v: unknown, max = 200): string | null => {
  if (typeof v !== 'string') return null
  const t = v.trim().slice(0, max)
  return t.length > 0 ? t : null
}

const mal = (error: string): ResultadoValidacionRemesa => ({ ok: false, estado: 400, error })

/**
 * Valida TODO antes de escribir nada: media remesa es peor que ninguna. Los textos de error son los que daba
 * la ruta. El cliente ya llega comprobado (y con permiso de editar) desde la ruta.
 */
export function validarRemesaNueva(cuerpo: unknown, clienteId: string): ResultadoValidacionRemesa {
  const body = (typeof cuerpo === 'object' && cuerpo !== null ? cuerpo : {}) as Record<string, unknown>

  const marketplaceId = textoLimpio(body.marketplaceId, 20)
  if (!marketplaceId) return mal('Falta el mercado de la remesa')

  const fechaEnvio = textoLimpio(body.fechaEnvio, 10)
  if (!fechaEnvio || !/^\d{4}-\d{2}-\d{2}$/.test(fechaEnvio)) {
    return mal('La fecha de envío tiene que ser un día, con el formato 2026-09-18')
  }

  if (!Array.isArray(body.lineas) || body.lineas.length === 0) {
    return mal('Una remesa sin referencias no es una remesa. Añade al menos una')
  }
  if (body.lineas.length > MAX_LINEAS_REMESA) {
    return mal(`Son demasiadas referencias de golpe (máximo ${MAX_LINEAS_REMESA})`)
  }

  const vistos = new Set<string>()
  const lineas: LineaRemesaNueva[] = []
  for (const [i, bruta] of (body.lineas as unknown[]).entries()) {
    const cruda = (typeof bruta === 'object' && bruta !== null ? bruta : {}) as LineaEntrante
    const sku = textoLimpio(cruda.sku, 120)
    if (!sku) return mal(`La línea ${i + 1} no tiene SKU`)
    if (vistos.has(sku)) {
      return mal(
        `El SKU ${sku} está dos veces. En una misma remesa cada referencia va una sola vez: ` +
          'si mandaste dos cajas del mismo, suma las unidades en una línea'
      )
    }
    vistos.add(sku)

    const unidades = Number(cruda.unidades)
    if (!Number.isInteger(unidades) || unidades <= 0) {
      return mal(`Las unidades de ${sku} tienen que ser un número entero mayor que cero`)
    }

    lineas.push({
      sku,
      unidades,
      referencia: textoLimpio(cruda.referencia, 120),
      nombre: textoLimpio(cruda.nombre, 400),
      variante: textoLimpio(cruda.variante, 80),
      ean: textoLimpio(cruda.ean, 40),
      fnsku: textoLimpio(cruda.fnsku, 40),
      asin: textoLimpio(cruda.asin, 20),
    })
  }

  return {
    ok: true,
    datos: {
      clienteId,
      marketplaceId,
      nombre: textoLimpio(body.nombre, 120),
      fechaEnvio,
      referenciaEnvio: textoLimpio(body.referenciaEnvio, 120),
      nota: textoLimpio(body.nota, 1000),
      lineas,
      analisisIa: body.analisisIa,
    },
  }
}

/**
 * ¿Puede esta sesión dejar el análisis de la IA en la remesa? (D21)
 *
 * Solo la agencia y solo en un cliente que puede editar. Un acceso de cliente que mandara su propio «análisis»
 * estaría poniendo palabras en boca de Liberty Seller.
 */
export function puedeGuardarAnalisis(sesion: Pick<SesionFba, 'actor' | 'clientesEditables'>, clienteId: string): boolean {
  return sesion.actor === 'agencia' && puedeEditar(sesion as SesionFba, clienteId)
}

/** Columna que falta (la 230 para el análisis, la 316 para el envío propuesto): se reintenta sin ella */
const esColumnaQueFalta = (code: string | undefined): boolean => ['42703', 'PGRST204', 'PGRST205'].includes(code ?? '')

/** Error con un estado HTTP para que la ruta lo devuelva tal cual */
export class ErrorDeRemesa extends Error {
  constructor(message: string, public estado: number, public codigo?: string) {
    super(message)
    this.name = 'ErrorDeRemesa'
  }
}

export interface OpcionesCrearRemesa {
  /** La remesa nace de un envío propuesto (migración 316): fba_remesas.envio_propuesto_id */
  envioPropuestoId?: string | null
  /** Campos que se añaden al análisis ya limpio (p. ej. `origen: 'planificador'`). Solo los pone el servidor */
  extraAnalisis?: Record<string, unknown>
}

export interface RemesaCreada {
  id: string
  lineas: number
  analisisGuardado: boolean
  /** false si hubo que crearla sin `envio_propuesto_id` porque la 316 no está lanzada */
  enlazadaAlEnvio: boolean
}

/**
 * Crea la cabecera en borrador y sus líneas. Lanza el error de la base si algo falla (la ruta lo traduce); un
 * `23505` sobre `envio_propuesto_id` sale como ErrorDeRemesa 409: ese envío propuesto ya tiene remesa.
 */
export async function crearRemesa(
  service: Servicio,
  sesion: Pick<SesionFba, 'userId' | 'actor' | 'clientesEditables'>,
  datos: RemesaNueva,
  opciones: OpcionesCrearRemesa = {},
): Promise<RemesaCreada> {
  // La conexión del cliente, si la tiene. ShoesF no la tiene y es un caso normal: sus remesas se llevan igual,
  // solo que sin ventas automáticas.
  const { data: conexion } = await service
    .from('amazon_connections')
    .select('id')
    .eq('client_id', datos.clienteId)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()

  const cabecera: Record<string, unknown> = {
    client_id: datos.clienteId,
    connection_id: (conexion as { id: string } | null)?.id ?? null,
    marketplace_id: datos.marketplaceId,
    nombre: datos.nombre,
    fecha_envio: datos.fechaEnvio,
    referencia_envio: datos.referenciaEnvio,
    nota: datos.nota,
    // Una remesa nueva NACE en borrador: es una propuesta hasta que el cliente la aprueba. El DEFAULT de la
    // tabla es 'cerrada' porque las que ya existían son historia, pero eso no vale para las nuevas.
    estado: 'borrador',
    created_by: sesion.userId,
  }

  /**
   * EL ANÁLISIS DE LA IA VA APARTE, Y SU FALTA NO ES UN ERROR.
   *
   * Solo lo trae una propuesta nacida de la IA (o del planificador), y solo lo puede escribir la agencia que
   * edita ese cliente (D21). Lo que llega se reconstruye campo a campo (lib/fba/analisis-ia.ts).
   *
   * La columna es de la migración 230, que se lanza a mano: si todavía no está, la propuesta se crea igual y
   * lo único que se pierde es el análisis.
   */
  const limpio: AnalisisIa | null = puedeGuardarAnalisis(sesion, datos.clienteId) ? limpiarAnalisis(datos.analisisIa) : null
  const analisis = limpio ? { ...limpio, ...(opciones.extraAnalisis ?? {}) } : null
  const envioPropuestoId = opciones.envioPropuestoId ?? null

  let conAnalisis = analisis !== null
  let conEnvio = envioPropuestoId !== null
  const fila = () => ({
    ...cabecera,
    ...(conAnalisis ? { analisis_ia: analisis } : {}),
    ...(conEnvio ? { envio_propuesto_id: envioPropuestoId } : {}),
  })

  let alta = await service.from('fba_remesas').insert(fila()).select('id').single()
  // Sin la columna se reintenta sin ella: primero sin el análisis (230), luego sin el enlace (316)
  for (let intento = 0; intento < 2 && alta.error && esColumnaQueFalta(alta.error.code); intento++) {
    const mensaje = `${alta.error.message ?? ''}`
    if (conEnvio && /envio_propuesto_id/.test(mensaje)) conEnvio = false
    else if (conAnalisis) conAnalisis = false
    else if (conEnvio) conEnvio = false
    else break
    alta = await service.from('fba_remesas').insert(fila()).select('id').single()
  }
  if (alta.error) {
    if (alta.error.code === '23505' && conEnvio) {
      throw new ErrorDeRemesa('Ese envío propuesto ya tiene una remesa', 409, 'ya_convertido')
    }
    throw alta.error
  }

  const remesaId = (alta.data as { id: string }).id

  const { error: errorLineas } = await service
    .from('fba_remesa_lineas')
    .insert(datos.lineas.map((l) => ({ ...l, remesa_id: remesaId })))

  if (errorLineas) {
    // El rescate. Sin esto queda una cabecera sin líneas que el panel pinta como un envío de cero unidades, o
    // sea como un envío que no vendió nada.
    await service.from('fba_remesas').delete().eq('id', remesaId)
    throw errorLineas
  }

  return { id: remesaId, lineas: datos.lineas.length, analisisGuardado: conAnalisis, enlazadaAlEnvio: conEnvio }
}
