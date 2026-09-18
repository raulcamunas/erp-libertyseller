import { NextResponse, type NextRequest } from 'next/server'
import { UUID, errorResponse, fail, requireAmazonAdmin } from '@/lib/amazon/api'
import { connectionCredentials } from '@/lib/amazon/data'
import { AmazonApiError } from '@/lib/amazon/errors'
import { spApiRequest, type AmazonCredentials } from '@/lib/amazon/sp-api'
import { consultarInforme, descargarInforme } from '@/lib/plataforma/amazon/informes'

/**
 * QUÉ PERMISOS TENEMOS DE VERDAD EN LA CUENTA DE UN CLIENTE.
 *
 * No hay ningún endpoint en la SP-API que conteste «estos son tus roles». La
 * única forma de saberlo es llamar a algo que dependa de cada rol y mirar si
 * Amazon contesta o da un 403. Esto hace justo eso, y traduce el código HTTP a
 * un veredicto en español.
 *
 *
 * ============ POR QUÉ HACE FALTA ============
 *
 * El portal de desarrollador enseña los roles que PIDIÓ la aplicación, no los
 * que el vendedor concedió al autorizar ni los que Amazon aprobó. Los tres
 * números pueden no coincidir, y el único que importa es el tercero. Antes de
 * construir encima de un rol conviene comprobar que está.
 *
 *
 * ============ SOLO LEE ============
 *
 * Las cuatro sondas son de lectura. Ninguna toca listings, precios, stock ni
 * pedidos, y ninguna devuelve datos del comprador.
 *
 * Matiz honesto: dos de ellas son `createReport`, que técnicamente CREA algo —
 * una petición de informe en la cola de Amazon—. No modifica la cuenta del
 * vendedor: un informe es un extracto, igual que el de catálogo que el ERP ya
 * pide cada hora. Pero como es un POST, se dice.
 *
 * El cupo de createReport se repone UNA VEZ POR MINUTO, así que las dos sondas
 * de informe van con `maxAttempts: 1`: un reintento automático quemaría la ficha
 * de la otra.
 *
 *
 * ============ CÓMO SE LEE EL RESULTADO ============
 *
 *   2xx  -> el rol está.
 *   403  -> el rol NO está. Es la respuesta que buscamos.
 *   400  -> el rol SÍ está: Amazon ha llegado a validar los parámetros, y para
 *           eso primero ha tenido que dejarnos pasar. Cuenta como concedido, y
 *           el mensaje se devuelve por si el parámetro hay que corregirlo.
 *   401  -> no es cuestión de roles: el token de esa conexión no vale.
 *
 * Esa distinción entre 400 y 403 es la que hace que la sonda sirva: si se
 * tratara cualquier error como «no tengo permiso», un parámetro mal puesto se
 * leería como un rol que falta y se acabaría migrando de aplicación para nada.
 *
 *
 * ============ DOS PASOS ============
 *
 *   GET ?conexion=<uuid>                     -> lanza las sondas
 *   GET ?conexion=<uuid>&informe=<reportId>  -> cuando el informe esté listo,
 *                                               devuelve SUS COLUMNAS
 *   GET ?conexion=<uuid>&sku=<sku>&dias=30   -> unidades vendidas por día de esa
 *                                               referencia, que es el flujo que
 *                                               consume una remesa
 *
 * El segundo paso existe por el FIFO de remesas: hace falta saber si el libro
 * mayor trae el identificador del envío en las entradas y el del pedido en las
 * devoluciones, porque de eso depende que las unidades se puedan atribuir solas
 * a su remesa o haya que inventarse una convención.
 *
 * Devuelve LOS NOMBRES DE LAS COLUMNAS Y EL NÚMERO DE FILAS, nunca el contenido.
 * Para responder «¿viene el ID del pedido?» basta la cabecera, y así no sale de
 * Amazon ni un dato de ninguna venta.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 120

type Veredicto = 'concedido' | 'denegado' | 'token' | 'indeterminado'

interface Sonda {
  nombre: string
  rol: string
  para: string
  veredicto: Veredicto
  httpStatus: number | null
  detalle: string | null
  /** Solo la sonda del libro mayor: con esto se pide el segundo paso */
  reportId?: string
}

function veredictoDe(status: number | null): Veredicto {
  if (status === null) return 'indeterminado'
  if (status >= 200 && status < 300) return 'concedido'
  if (status === 403) return 'denegado'
  if (status === 400) return 'concedido'
  if (status === 401) return 'token'
  return 'indeterminado'
}

/** Envuelve una sonda para que un fallo suyo no tumbe las demás */
async function sondar(
  base: Omit<Sonda, 'veredicto' | 'httpStatus' | 'detalle'>,
  ejecutar: () => Promise<{ httpStatus: number; reportId?: string }>
): Promise<Sonda> {
  try {
    const { httpStatus, reportId } = await ejecutar()
    return { ...base, veredicto: veredictoDe(httpStatus), httpStatus, detalle: null, reportId }
  } catch (error) {
    if (error instanceof AmazonApiError) {
      return {
        ...base,
        veredicto: veredictoDe(error.httpStatus),
        httpStatus: error.httpStatus,
        detalle: error.humanMessage,
      }
    }
    return {
      ...base,
      veredicto: 'indeterminado',
      httpStatus: null,
      detalle: error instanceof Error ? error.message : 'Error desconocido',
    }
  }
}

/** ISO sin milisegundos: createReport rechaza el formato con fracción de segundo */
function iso(fecha: Date): string {
  return `${fecha.toISOString().slice(0, 19)}Z`
}

/**
 * Lo mismo pero con el desplazamiento escrito entero.
 *
 * El `interval` de la Sales API quiere la forma `-00:00` y no acepta la `Z`
 * abreviada, al revés que createReport. Son dos APIs distintas con dos manías
 * distintas, y mezclarlas da un 400 que se confundiría con un permiso que falta.
 */
function isoConOffset(fecha: Date): string {
  return `${fecha.toISOString().slice(0, 19)}-00:00`
}

async function pedirInformeConRango(
  creds: AmazonCredentials,
  tipo: string,
  marketplaceId: string,
  dias: number,
  reportOptions?: Record<string, string>
): Promise<{ httpStatus: number; reportId?: string }> {
  const hasta = new Date(Date.now() - 60 * 60 * 1000)
  const desde = new Date(hasta.getTime() - dias * 24 * 60 * 60 * 1000)

  const { data, httpStatus } = await spApiRequest<{ reportId?: string }>(creds, 'createReport', {
    method: 'POST',
    path: '/reports/2021-06-30/reports',
    body: {
      reportType: tipo,
      marketplaceIds: [marketplaceId],
      dataStartTime: iso(desde),
      dataEndTime: iso(hasta),
      ...(reportOptions ? { reportOptions } : {}),
    },
    repeatable: false,
    maxAttempts: 1,
  })

  return { httpStatus, reportId: data.reportId }
}

export async function GET(request: NextRequest) {
  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session

    const conexionId = request.nextUrl.searchParams.get('conexion') ?? ''
    if (!UUID.test(conexionId)) {
      return fail(400, 'Hay que decir de qué conexión, con ?conexion=<id>')
    }

    const resuelta = await connectionCredentials(conexionId)
    if (!resuelta) return fail(404, 'Esa conexión no existe')

    const { connection, credentials } = resuelta
    const marketplaceId =
      connection.default_marketplace_id ??
      connection.marketplaces_activos?.[0] ??
      connection.marketplace_ids?.[0]

    if (!marketplaceId) {
      return fail(400, `La conexión de ${connection.name} no tiene ningún marketplace asignado`)
    }

    /* ---------- Segundo paso: las columnas de un informe ya pedido ---------- */

    const informeId = request.nextUrl.searchParams.get('informe')
    if (informeId) {
      const estado = await consultarInforme(credentials, informeId)
      if (estado.estado !== 'DONE' || !estado.documentId) {
        return NextResponse.json({
          conexion: connection.name,
          informe: informeId,
          estado: estado.estado,
          listo: false,
          mensaje:
            estado.estado === 'CANCELLED'
              ? 'Amazon ha cancelado el informe. Suele ser que no había datos en el rango pedido.'
              : 'Todavía se está generando. Un informe tarda entre uno y quince minutos.',
        })
      }

      const doc = await descargarInforme(credentials, estado.documentId)
      const lineas = doc.texto.split('\n').filter((l) => l.trim().length > 0)
      const cabecera = lineas[0] ?? ''
      // Los informes de Amazon son TSV. Se parte por tabulador y, si no hay,
      // por coma: hay tipos que salen en CSV y la cabecera se leería entera
      // como una sola columna.
      // Las comillas se quitan AQUÍ y no solo en las filas de datos. Amazon
      // entrecomilla también la cabecera, así que sin esto el nombre de la
      // columna es «"Event Type"» —con las comillas dentro— y no casa con nada:
      // el recuento por tipo salía entero como «(sin columna)» sin dar error.
      const sinComillas = (c: string) => c.trim().replace(/^"|"$/g, '')
      const columnas = (
        cabecera.includes('\t') ? cabecera.split('\t') : cabecera.split(',')
      ).map(sinComillas)

      /**
       * LA FORMA DEL INFORME, NO SU CONTENIDO.
       *
       * Saber que existe una columna «Reference ID» no dice si viene rellena, ni
       * en qué tipos de movimiento. Y de eso depende el diseño entero del FIFO:
       *
       *   · si las entradas la traen  -> las remesas se detectan solas
       *   · si las devoluciones la traen -> cada unidad devuelta vuelve a la
       *     remesa exacta de la que salió, sin inventarse una convención
       *
       * Así que se cuenta POR TIPO DE MOVIMIENTO cuántas filas la llevan. Eso
       * responde la pregunta sin sacar de Amazon el identificador de ningún
       * pedido ni de ninguna venta: salen tipos, recuentos y nada más.
       */
      const idx = (nombre: string) => columnas.findIndex(c => c === nombre)
      const iTipo = idx('Event Type')
      const iRef = idx('Reference ID')
      const iDisp = idx('Disposition')

      const porTipo = new Map<string, { filas: number; conReferencia: number }>()
      const porDisposicion = new Map<string, number>()

      for (const linea of lineas.slice(1)) {
        const campos = (linea.includes('\t') ? linea.split('\t') : linea.split(',')).map(
          sinComillas
        )

        const tipo = iTipo >= 0 ? campos[iTipo] || '(vacío)' : '(sin columna)'
        const fila = porTipo.get(tipo) ?? { filas: 0, conReferencia: 0 }
        fila.filas += 1
        if (iRef >= 0 && (campos[iRef] ?? '').length > 0) fila.conReferencia += 1
        porTipo.set(tipo, fila)

        if (iDisp >= 0) {
          const d = campos[iDisp] || '(vacío)'
          porDisposicion.set(d, (porDisposicion.get(d) ?? 0) + 1)
        }
      }

      return NextResponse.json({
        conexion: connection.name,
        informe: informeId,
        estado: estado.estado,
        listo: true,
        bytes: doc.bytes,
        filas: Math.max(0, lineas.length - 1),
        columnas,
        movimientos: [...porTipo.entries()]
          .sort((a, b) => b[1].filas - a[1].filas)
          .map(([tipo, v]) => ({
            tipo,
            filas: v.filas,
            conReferencia: v.conReferencia,
            // Lo que de verdad se quiere leer de un vistazo
            sirveParaAtribuir: v.filas > 0 && v.conReferencia === v.filas,
          })),
        disposiciones: [...porDisposicion.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([disposicion, filas]) => ({ disposicion, filas })),
      })
    }

    /* ---------- Modo aparte: ¿hay ventas por SKU y por día? ---------- */

    /**
     * Esto no es una sonda de permisos, es la pregunta que decide la
     * arquitectura del FIFO.
     *
     * El libro mayor da 403, así que el flujo de consumo tiene que salir de otro
     * sitio. getOrderMetrics SÍ está concedido, y admite filtrar por SKU y pedir
     * granularidad diaria. Si eso funciona, ya hay de dónde restar unidades sin
     * depender de ningún rol nuevo: una serie de unidades vendidas por día y por
     * referencia es exactamente lo que consume una remesa.
     *
     * Lo que NO da, y conviene tenerlo escrito: las devoluciones. orderMetrics
     * cuenta lo que se pidió, no lo que volvió. Una devolución no aparece aquí y
     * solo se verá como descuadre en el cuadre nocturno contra el stock real.
     */
    const sku = request.nextUrl.searchParams.get('sku')
    if (sku) {
      const dias = Math.min(60, Math.max(1, Number(request.nextUrl.searchParams.get('dias') ?? 30)))
      const hasta = new Date(Date.now() - 2 * 60 * 60 * 1000)
      const desde = new Date(hasta.getTime() - dias * 24 * 60 * 60 * 1000)

      const { data, httpStatus } = await spApiRequest<{
        payload?: Array<{
          interval?: string
          unitCount?: number
          orderCount?: number
          totalSales?: { amount?: number; currencyCode?: string }
        }>
      }>(credentials, 'getOrderMetrics', {
        method: 'GET',
        path: '/sales/v1/orderMetrics',
        query: {
          marketplaceIds: [marketplaceId],
          interval: `${isoConOffset(desde)}--${isoConOffset(hasta)}`,
          granularity: 'Day',
          sku,
        },
      })

      const serie = (data.payload ?? []).map((d) => ({
        dia: (d.interval ?? '').slice(0, 10),
        unidades: d.unitCount ?? 0,
        pedidos: d.orderCount ?? 0,
        importe: d.totalSales?.amount ?? 0,
      }))

      const unidades = serie.reduce((suma, d) => suma + d.unidades, 0)
      const conVenta = serie.filter((d) => d.unidades > 0).length

      return NextResponse.json({
        conexion: connection.name,
        sku,
        httpStatus,
        dias,
        // Lo que de verdad se quiere saber: ¿sirve esto para el FIFO?
        sirveParaElFifo: serie.length > 0,
        resumen: {
          unidadesVendidas: unidades,
          diasConVenta: conVenta,
          mediaDiaria: dias > 0 ? Number((unidades / dias).toFixed(2)) : 0,
        },
        serie,
      })
    }

    /* ---------- Primer paso: las cuatro sondas ---------- */

    const sondas: Sonda[] = []

    sondas.push(
      await sondar(
        {
          nombre: 'getInventorySummaries',
          rol: 'Logística de Amazon',
          para: 'Stock en los almacenes de Amazon. Es el control: ya se usa cada 15 minutos, así que si esta falla es que algo más está roto.',
        },
        async () => {
          const { httpStatus } = await spApiRequest<unknown>(credentials, 'getInventorySummaries', {
            method: 'GET',
            path: '/fba/inventory/v1/summaries',
            query: {
              granularityType: 'Marketplace',
              granularityId: marketplaceId,
              marketplaceIds: [marketplaceId],
              details: false,
            },
          })
          return { httpStatus }
        }
      )
    )

    sondas.push(
      await sondar(
        {
          nombre: 'createReport · GET_LEDGER_DETAIL_VIEW_DATA',
          rol: 'Logística de Amazon',
          para: 'El libro mayor de inventario: entradas, ventas, devoluciones y mermas, una fila por movimiento. Es lo que mueve el FIFO de remesas.',
        },
        // Sin reportOptions a propósito. Todas las de este informe son
        // opcionales, y una mal escrita da un 400: el veredicto de permisos
        // seguiría siendo correcto (400 = nos dejó pasar), pero nos quedaríamos
        // sin informe que abrir en el segundo paso, que es lo que de verdad
        // queremos ver. Los valores por defecto sirven para mirar la cabecera.
        () => pedirInformeConRango(credentials, 'GET_LEDGER_DETAIL_VIEW_DATA', marketplaceId, 7)
      )
    )

    sondas.push(
      await sondar(
        {
          nombre: 'createReport · GET_SALES_AND_TRAFFIC_REPORT',
          rol: 'Análisis de marcas',
          para: 'Unidades vendidas por SKU y día. Es el rol que el código da por pendiente desde hace meses.',
        },
        () =>
          pedirInformeConRango(credentials, 'GET_SALES_AND_TRAFFIC_REPORT', marketplaceId, 7, {
            dateGranularity: 'DAY',
            asinGranularity: 'SKU',
          })
      )
    )

    sondas.push(
      await sondar(
        {
          nombre: 'getOrderMetrics',
          rol: 'Seguimiento de pedidos e inventario',
          para: 'Ventas agregadas por intervalo. Sin datos del comprador: solo importes y unidades.',
        },
        async () => {
          const hasta = new Date(Date.now() - 2 * 60 * 60 * 1000)
          const desde = new Date(hasta.getTime() - 7 * 24 * 60 * 60 * 1000)
          const { httpStatus } = await spApiRequest<unknown>(credentials, 'getOrderMetrics', {
            method: 'GET',
            path: '/sales/v1/orderMetrics',
            query: {
              marketplaceIds: [marketplaceId],
              interval: `${isoConOffset(desde)}--${isoConOffset(hasta)}`,
              granularity: 'Total',
            },
          })
          return { httpStatus }
        }
      )
    )

    const ledger = sondas.find((s) => s.nombre.includes('LEDGER'))

    return NextResponse.json({
      conexion: connection.name,
      marketplace: marketplaceId,
      sondas,
      siguiente: ledger?.reportId
        ? `Para ver las columnas del libro mayor, vuelve a llamar dentro de unos minutos con ?conexion=${conexionId}&informe=${ledger.reportId}`
        : null,
    })
  } catch (error) {
    return errorResponse(error, 'No se han podido comprobar los permisos')
  }
}
