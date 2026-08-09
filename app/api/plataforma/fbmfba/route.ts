import { NextResponse, type NextRequest } from 'next/server'
import { UUID, errorResponse, fail, requireAmazonAdmin } from '@/lib/amazon/api'
import { marketplaceById } from '@/lib/types/amazon'
import {
  FALTAN_MIGRACIONES_A4,
  analisisDeUnidad,
  csvDeA4,
  faltaEsquema,
  unidadesDeCliente,
} from '@/lib/plataforma/fbmfba/pantalla'
import {
  CANAL_A4_LABELS,
  VEREDICTOS_A4,
  VEREDICTO_A4_LABELS,
  type VeredictoA4,
} from '@/lib/plataforma/fbmfba/tipos'

/**
 * EL ANÁLISIS FBM → FBA DE UN CLIENTE.
 *
 * SOLO ADMIN. Y UNA CUENTA Y UN PAÍS POR PETICIÓN, sin excepción: lo que
 * devuelve esta ruta son los costes, los precios y los márgenes del catálogo de
 * una tienda ajena, que es exactamente el dato que el compromiso firmado ante
 * Amazon obliga a mantener separado por cuenta. No hay ninguna variante que
 * devuelva varios clientes, ni medias, ni comparativas, y si algún día alguien la
 * pide hay que pararse y decirlo en vez de buscar un rodeo.
 *
 * En middleware.ts todo lo que empieza por /api/ está en la lista de rutas
 * públicas, así que una ruta que no comprueba nada contesta a cualquiera:
 * requireAmazonAdmin() no es una formalidad, es la única puerta que hay.
 *
 *
 * ============ A4 RECOMIENDA. NO EJECUTA. ============
 *
 * Esta ruta es de SOLO LECTURA y no existe ninguna hermana que mande nada a
 * Amazon. Crear un envío de entrada a un centro logístico necesita el rol de
 * Logística de Amazon, que la aplicación no tiene y no ha pedido. Lo que sale de
 * aquí es una lista de candidatos con su porqué, para decidirla con el cliente y
 * ejecutarla a mano en Seller Central.
 */
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session

    const params = request.nextUrl.searchParams
    const clientId = params.get('clientId') ?? ''
    if (!UUID.test(clientId)) return fail(400, 'Elige el cliente cuyo análisis quieres ver')

    const unidades = await unidadesDeCliente(clientId)
    const etiquetas = {
      etiquetas: VEREDICTO_A4_LABELS,
      canales: CANAL_A4_LABELS,
      leidoAt: new Date().toISOString(),
    }

    if (unidades.length === 0) {
      return NextResponse.json({
        unidades: [],
        unidad: null,
        filas: [],
        resumen: null,
        fiscal: null,
        sugerenciaFiscal: null,
        config: null,
        faltaPorDecidir: [],
        moneda: null,
        ...etiquetas,
      })
    }

    const connectionId = limpio(params.get('connectionId'))
    if (connectionId && !UUID.test(connectionId)) return fail(400, 'Esa cuenta no es válida')
    const marketplaceId = limpio(params.get('marketplaceId'))

    // La unidad elegida, o la primera. Que una dirección vieja caiga en la
    // primera cuenta es preferible a una pantalla en blanco: el selector de
    // arriba dice cuál se está mirando, así que nadie se confunde de cuenta.
    const unidad =
      unidades.find(
        (u) =>
          (!connectionId || u.connectionId === connectionId) &&
          (!marketplaceId || u.marketplaceId === marketplaceId)
      ) ?? unidades[0]

    // Los veredictos que no existen se descartan en vez de rechazar la petición:
    // un filtro guardado en un enlace no puede tumbar la pantalla el día que se
    // renombre un veredicto.
    const veredictos = (params.get('veredictos') ?? '')
      .split(',')
      .map((v) => v.trim())
      .filter((v): v is VeredictoA4 => VEREDICTOS_A4.includes(v as VeredictoA4))

    const vista = await analisisDeUnidad({
      clientId,
      unidad,
      veredictos,
      busqueda: limpio(params.get('busqueda')),
    })

    // La exportación sale de LAS MISMAS FILAS que se están viendo, ya filtradas.
    // Un fichero que trae más de lo que hay en pantalla —o menos— es la forma más
    // rápida de que alguien le enseñe a un cliente algo que no había mirado.
    if (params.get('formato') === 'csv') {
      const pais = marketplaceById(unidad.marketplaceId)?.label ?? unidad.marketplaceId
      const csv = csvDeA4(
        vista.filas,
        {
          veredicto: VEREDICTO_A4_LABELS,
          canal: CANAL_A4_LABELS,
          nombreMarketplace: (id) => marketplaceById(id)?.label ?? id,
        },
        unidad.marketplaceId
      )
      return new NextResponse(csv, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="fbm-fba-${slug(unidad.connectionName)}-${slug(pais)}.csv"`,
        },
      })
    }

    return NextResponse.json({
      unidades,
      unidad: vista.unidad,
      filas: vista.filas,
      resumen: vista.resumen,
      fiscal: vista.fiscal,
      sugerenciaFiscal: vista.sugerenciaFiscal,
      config: vista.config,
      faltaPorDecidir: vista.faltaPorDecidir,
      moneda: vista.moneda,
      ...etiquetas,
    })
  } catch (error) {
    if (faltaEsquema(error)) return fail(503, FALTAN_MIGRACIONES_A4)
    return errorResponse(error, 'Error calculando el análisis FBM → FBA')
  }
}

function limpio(valor: string | null): string | null {
  if (!valor) return null
  const texto = valor.trim()
  return texto === '' ? null : texto
}

function slug(valor: string): string {
  return (
    valor
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase() || 'cuenta'
  )
}
