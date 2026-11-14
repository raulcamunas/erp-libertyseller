import { createServiceClient } from '@/lib/supabase/service'
import { FORMATOS, hojaDeEtiquetas, type EtiquetaProducto } from './etiquetas'
import { leerFnskusDeAmazon } from './fnsku-amazon'
import { puedeImprimirEtiquetas, type EstadoRemesa } from './flujo'

/**
 * EL PDF DE ETIQUETAS FNSKU DE UNA REMESA, PARA EL ERP Y PARA EL ENLACE DEL CLIENTE.
 * =================================================================================
 * SOLO SERVIDOR.
 *
 * Estaba entero dentro de la ruta del ERP (que exige sesión), y por eso el cliente —que es quien etiqueta—
 * no podía sacarlas desde su enlace: alguien de la agencia generaba el PDF y se lo mandaba por fuera. Ahora
 * la generación vive aquí y la usan las dos puertas, cada una con su control de acceso:
 *
 *   · /api/fba/remesas/[id]/etiquetas           sesión del ERP
 *   · /api/publico/envio/[token]/etiquetas      el token del enlace, con la remesa aprobada
 *
 * Las reglas no cambian: una etiqueta por unidad; el FNSKU de la línea, del espejo del catálogo o leído de
 * Amazon en el momento (solo LECTURA); lo que no tiene FNSKU se descarta y se dice; nunca antes de aprobar.
 * Cada tirada se registra en fba_impresiones con la versión del boceto y de dónde salió (ERP o enlace).
 */

type ClienteDeBase = ReturnType<typeof createServiceClient>

export type ResultadoDeEtiquetas =
  | { ok: false; estado: number; error: string }
  | {
      ok: true
      pdf: ArrayBuffer | Uint8Array
      impresas: number
      paginas: number
      descartadas: Array<{ motivo: string }>
      avisos: string[]
      nombreFichero: string
      remesaId: string
      formato: string
    }

export async function generarEtiquetasDeRemesa(remesaId: string, formato: string, service: ClienteDeBase = createServiceClient()): Promise<ResultadoDeEtiquetas> {
  const { data: cabecera } = await service
    .from('fba_remesas')
    // `version` NO va aquí: si la 215 no está lanzada, un select que la nombra devuelve 42703 y deja sin
    // etiquetas a quien tiene la mercancía delante. Se pide aparte al registrar la impresión.
    .select('id, nombre, client_id, connection_id, marketplace_id, estado')
    .eq('id', remesaId)
    .maybeSingle()
  if (!cabecera) return { ok: false, estado: 404, error: 'Esa remesa ya no existe' }

  const remesa = cabecera as { id: string; nombre: string | null; client_id: string; connection_id: string | null; marketplace_id: string; estado: EstadoRemesa | null }
  if (!puedeImprimirEtiquetas((remesa.estado ?? 'cerrada') as EstadoRemesa)) {
    return { ok: false, estado: 409, error: 'Todavía no. Las etiquetas se imprimen cuando el envío está aprobado: en borrador aún puede cambiar qué se manda.' }
  }
  if (!FORMATOS.some((f) => f.id === formato)) return { ok: false, estado: 400, error: 'Ese formato de hoja no existe' }

  const { data: lineas } = await service
    .from('fba_remesa_lineas')
    .select('sku, unidades, fnsku, nombre, variante')
    .eq('remesa_id', remesaId)
    .gt('unidades', 0)
    .order('sku', { ascending: true })

  const filas = (lineas ?? []) as Array<{ sku: string; unidades: number; fnsku: string | null; nombre: string | null; variante: string | null }>
  if (filas.length === 0) return { ok: false, estado: 400, error: 'Esta remesa no tiene ninguna referencia' }

  // El espejo completa lo que falte: FNSKU de las referencias que no lo traían y el título real de Amazon.
  // Por tramos de 200 y mirando el error: un `.in()` con todo pasa de largo la URL y se quedaba vacío.
  const catalogo = new Map<string, { fnsku: string | null; title: string | null; asin: string | null }>()
  if (remesa.connection_id) {
    const TRAMO = 200
    const skus = filas.map((l) => l.sku)
    for (let i = 0; i < skus.length; i += TRAMO) {
      const { data: espejo, error } = await service
        .from('amazon_listings')
        .select('sku, fnsku, title, asin')
        .eq('connection_id', remesa.connection_id)
        .eq('marketplace_id', remesa.marketplace_id)
        .in('sku', skus.slice(i, i + TRAMO))
      if (error) {
        return {
          ok: false,
          estado: 502,
          error: 'No se ha podido leer el catálogo para completar los FNSKU, así que las etiquetas saldrían incompletas y no se imprimen. Vuelve a intentarlo.',
        }
      }
      for (const l of (espejo ?? []) as Array<{ sku: string; fnsku: string | null; title: string | null; asin: string | null }>) {
        catalogo.set(l.sku, { fnsku: l.fnsku, title: l.title, asin: l.asin })
      }
    }

    // Si falta el FNSKU (o es el ASIN), se le pregunta a Amazon ahora. Solo lectura
    const esAsin = (f: string, a: string | null) => !!a && f.trim().toUpperCase() === a.trim().toUpperCase()
    const faltan = filas
      .filter((l) => {
        const c = catalogo.get(l.sku)
        const f = l.fnsku ?? c?.fnsku ?? null
        return !f || esAsin(f, c?.asin ?? null)
      })
      .map((l) => l.sku)
    if (faltan.length > 0) {
      const { leidos } = await leerFnskusDeAmazon(service, remesa.connection_id, remesa.marketplace_id, faltan)
      for (const x of leidos) {
        if (!x.fnsku) continue
        const previo = catalogo.get(x.sku)
        catalogo.set(x.sku, { fnsku: x.fnsku, title: previo?.title ?? null, asin: previo?.asin ?? null })
      }
    }
  }

  const etiquetas: EtiquetaProducto[] = filas.map((l) => {
    const delEspejo = catalogo.get(l.sku)
    // El título de Amazon manda: quien pega y quien recibe en el almacén ven el mismo texto que Seller Central
    const titulo = delEspejo?.title ?? [l.nombre, l.variante].filter(Boolean).join(' · ') ?? l.sku
    return { fnsku: l.fnsku ?? delEspejo?.fnsku ?? '', titulo: titulo || l.sku, sku: l.sku, asin: delEspejo?.asin ?? null, unidades: l.unidades }
  })

  const { pdf, etiquetas: impresas, paginas, descartadas, avisos } = hojaDeEtiquetas(etiquetas, formato)

  // Ni una imprimible no es un PDF en blanco: se dice por qué
  if (impresas === 0) {
    const motivos = descartadas.slice(0, 8).map((d) => d.motivo)
    return {
      ok: false,
      estado: 400,
      error:
        `No se puede imprimir ni una etiqueta de esta remesa (${descartadas.length} descartadas). ` +
        motivos.join(' · ') +
        (descartadas.length > motivos.length ? ` …y ${descartadas.length - motivos.length} más.` : ''),
    }
  }

  // El nombre del fichero, en ASCII a la fuerza: una cabecera HTTP solo admite bytes 0-255
  const nombre =
    (remesa.nombre ?? '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .toLowerCase() || `remesa-${remesaId.slice(0, 8)}`

  return { ok: true, pdf, impresas, paginas, descartadas, avisos, nombreFichero: `etiquetas-${nombre}.pdf`, remesaId, formato }
}

/**
 * Apunta la tirada en fba_impresiones con la versión del boceto y su origen. No lanza: el PDF sale igual
 * aunque no se pueda apuntar. Sin la 309 (sin `origen`), se apunta sin él.
 */
export async function registrarImpresion(
  r: Extract<ResultadoDeEtiquetas, { ok: true }>,
  quien: { userId: string | null; origen: 'erp' | 'enlace'; enlaceId?: string | null },
  service: ClienteDeBase = createServiceClient()
): Promise<void> {
  try {
    const { data: v } = await service.from('fba_remesas').select('version').eq('id', r.remesaId).maybeSingle()
    const fila = {
      remesa_id: r.remesaId,
      version: (v as { version?: number } | null)?.version ?? 1,
      etiquetas: r.impresas,
      formato: r.formato,
      descartadas: r.descartadas.length,
      impreso_por: quien.userId,
    }
    const { error } = await service.from('fba_impresiones').insert({ ...fila, origen: quien.origen, enlace_id: quien.enlaceId ?? null })
    if (error) {
      const { error: sinOrigen } = await service.from('fba_impresiones').insert(fila)
      if (sinOrigen) console.error('[fba] no se ha podido registrar la impresión de etiquetas:', sinOrigen.message)
    }
  } catch (error) {
    console.error('[fba] no se ha podido registrar la impresión de etiquetas:', error instanceof Error ? error.message : error)
  }
}

/** La respuesta HTTP con el PDF y las cabeceras que lee la pantalla para avisar sin abrirlo */
export function respuestaPdf(r: Extract<ResultadoDeEtiquetas, { ok: true }>): Response {
  return new Response(Buffer.from(r.pdf as ArrayBuffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${r.nombreFichero}"`,
      'Cache-Control': 'no-store',
      'X-Etiquetas': String(r.impresas),
      'X-Paginas': String(r.paginas),
      'X-Descartadas': String(r.descartadas.length),
      'X-Motivos': encodeURIComponent(r.descartadas.map((d) => d.motivo).join(' | ').slice(0, 900)),
      'X-Avisos': encodeURIComponent(r.avisos.join(' | ').slice(0, 600)),
    },
  })
}
