import { NextResponse, type NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
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

    /**
     * SIN `?conexion=` NO SE FALLA: SE ENSEÑA LA LISTA.
     *
     * El id de la conexión no sale en la URL de la pantalla —vive en el estado
     * de React— así que quien quiera sondar tenía que ir a buscarlo a la base
     * de datos. Un 400 diciendo «pon ?conexion=<id>» sin decir de dónde sacar
     * ese id es una puerta cerrada con la llave dentro.
     *
     * Devolver la lista no enseña nada que un admin no vea ya en la pestaña
     * Cuentas: el nombre del cliente y el identificador de su fila. Ni tokens,
     * ni credenciales, ni datos de ninguna venta.
     */
    const conexionId = request.nextUrl.searchParams.get('conexion') ?? ''
    if (!conexionId) {
      const service = createServiceClient()
      const { data } = await service
        .from('amazon_connections')
        .select('id, name, is_active')
        .order('name', { ascending: true })

      const conexiones = (data ?? []) as { id: string; name: string; is_active: boolean }[]
      return NextResponse.json({
        mensaje:
          'Elige de qué conexión quieres sondar los permisos y vuelve a abrir esta dirección ' +
          'añadiéndole ?conexion=<id>.',
        conexiones: conexiones.map((c) => ({
          nombre: c.name,
          activa: c.is_active,
          url: `/api/amazon/permisos?conexion=${c.id}`,
        })),
      })
    }
    if (!UUID.test(conexionId)) {
      return fail(400, 'Ese ?conexion= no es un identificador válido. Abre esta dirección sin parámetros para ver la lista.')
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

    /* ---------- Modo aparte: un mes de dinero, resumido ---------- */

    /**
     * ?modo=finanzas&dias=30 · LA PRUEBA DEL PANEL DE VENTAS (sustituir Sellerboard, 26 nov 2026).
     *
     * Lee los movimientos de dinero de la cuenta (listFinancialEvents, Finance and Accounting) de los últimos `dias` (hasta 2 días atrás,
     * que es lo que Amazon ya ha publicado) y devuelve SOLO SUMAS por concepto y moneda: ventas, comisiones, tarifa FBA, devoluciones,
     * publicidad, almacenamiento… y cuántos movimientos de cada tipo. Nunca un pedido ni un dato del comprador. Solo lee.
     * Tope de páginas para no pasar del tiempo de la ruta: si se corta, lo dice.
     */
    if (request.nextUrl.searchParams.get('modo') === 'finanzas') {
      const dias = Math.min(Math.max(Number(request.nextUrl.searchParams.get('dias')) || 30, 1), 60)
      const hasta = new Date(Date.now() - 2 * 86_400_000)
      const desde = new Date(hasta.getTime() - dias * 86_400_000)
      const conceptos = new Map<string, { importe: number; veces: number }>()
      const eventos = new Map<string, number>()
      const skus = new Set<string>()
      const sumar = (clave: string, importe: number) => {
        const x = conceptos.get(clave) ?? { importe: 0, veces: 0 }
        x.importe += importe
        x.veces += 1
        conceptos.set(clave, x)
      }
      // Recorre un evento: cada objeto con un «…Type» de texto y un importe { CurrencyAmount, CurrencyCode } al lado es un concepto
      const recorrer = (lista: string, v: unknown, tipoPadre: string | null) => {
        if (Array.isArray(v)) return v.forEach((x) => recorrer(lista, x, tipoPadre))
        if (!v || typeof v !== 'object') return
        const o = v as Record<string, unknown>
        if (typeof o.SellerSKU === 'string') skus.add(o.SellerSKU)
        const tipo = Object.entries(o).find(([k, x]) => /Type$/.test(k) && typeof x === 'string')?.[1] as string | undefined
        for (const [k, x] of Object.entries(o)) {
          if (x && typeof x === 'object' && !Array.isArray(x) && typeof (x as Record<string, unknown>).CurrencyAmount === 'number') {
            const m = x as { CurrencyAmount: number; CurrencyCode?: string }
            sumar(`${lista} · ${tipo ?? tipoPadre ?? k} · ${m.CurrencyCode ?? '?'}`, m.CurrencyAmount)
          } else if (x && typeof x === 'object') recorrer(lista, x, tipo ?? tipoPadre)
        }
      }
      let siguiente: string | undefined
      let paginas = 0
      let cortado = false
      const TOPE = 45
      try {
        do {
          const { data } = await spApiRequest<{ payload?: { FinancialEvents?: Record<string, unknown[]>; NextToken?: string } }>(credentials, 'listFinancialEvents', {
            method: 'GET',
            path: '/finances/v0/financialEvents',
            query: siguiente ? { NextToken: siguiente } : { MaxResultsPerPage: '100', PostedAfter: iso(desde), PostedBefore: iso(hasta) },
            maxAttempts: 4,
          })
          paginas += 1
          for (const [lista, filas] of Object.entries(data?.payload?.FinancialEvents ?? {})) {
            if (!Array.isArray(filas) || filas.length === 0) continue
            eventos.set(lista, (eventos.get(lista) ?? 0) + filas.length)
            recorrer(lista.replace(/EventList$/, ''), filas, null)
          }
          siguiente = data?.payload?.NextToken
          if (siguiente && paginas >= TOPE) {
            cortado = true
            break
          }
        } while (siguiente)
      } catch (error) {
        return NextResponse.json({ conexion: connection.name, error: error instanceof AmazonApiError ? error.humanMessage : String(error), paginas })
      }
      const redondo = (n: number) => Math.round(n * 100) / 100
      return NextResponse.json({
        conexion: connection.name,
        desde: iso(desde),
        hasta: iso(hasta),
        paginas,
        cortado,
        skusDistintos: skus.size,
        eventos: Object.fromEntries([...eventos.entries()].sort((a, b) => b[1] - a[1])),
        conceptos: [...conceptos.entries()].sort((a, b) => Math.abs(b[1].importe) - Math.abs(a[1].importe)).map(([c, v]) => ({ concepto: c, importe: redondo(v.importe), veces: v.veces })),
      })
    }

    /* ---------- Modo aparte: ¿podemos pedir reseñas? ---------- */

    /**
     * ?modo=resenas · LA PETICIÓN DE RESEÑA DE AMAZON (Solicitations API), la del botón «Solicitar una reseña» de Seller Central y la que usa Sellerboard.
     *
     * Solo lee: busca UN pedido enviado de hace 10–30 días (getOrders, sin datos del comprador) y pregunta qué peticiones admite
     * (getSolicitationActionsForOrder). NO manda ninguna petición. Devuelve el veredicto y las acciones que Amazon ofrece, nunca el pedido.
     *   200 -> el rol de pedir reseñas está · 403 -> no está.
     */
    if (request.nextUrl.searchParams.get('modo') === 'resenas') {
      const hasta = new Date(Date.now() - 10 * 86_400_000)
      const desde = new Date(Date.now() - 30 * 86_400_000)
      let pedido: string | null = null
      let pedidosVistos = 0
      try {
        const { data } = await spApiRequest<{ payload?: { Orders?: Array<{ AmazonOrderId: string; OrderStatus: string }> } }>(credentials, 'getOrders', {
          method: 'GET',
          path: '/orders/v0/orders',
          query: { MarketplaceIds: [marketplaceId], CreatedAfter: iso(desde), CreatedBefore: iso(hasta), OrderStatuses: ['Shipped'], MaxResultsPerPage: 5 },
          maxAttempts: 2,
        })
        const pedidos = data?.payload?.Orders ?? []
        pedidosVistos = pedidos.length
        pedido = pedidos[0]?.AmazonOrderId ?? null
      } catch (error) {
        return NextResponse.json({ conexion: connection.name, marketplaceId, veredicto: 'indeterminado', detalle: error instanceof AmazonApiError ? `No se han podido leer los pedidos: ${error.humanMessage}` : 'No se han podido leer los pedidos' })
      }
      if (!pedido) return NextResponse.json({ conexion: connection.name, marketplaceId, veredicto: 'indeterminado', detalle: 'No hay ningún pedido enviado de hace 10–30 días en este país para probar.' })
      let acciones: string[] = []
      const sonda = await sondar(
        { nombre: 'getSolicitationActionsForOrder', rol: 'Buyer Solicitation (pedir reseñas)', para: 'Pedir la reseña de Amazon de cada pedido, como el botón «Solicitar una reseña».' },
        async () => {
          const { httpStatus, data } = await spApiRequest<{ _links?: { actions?: Array<{ name?: string }> } }>(credentials, 'getSolicitationActionsForOrder', {
            method: 'GET',
            path: `/solicitations/v1/orders/${encodeURIComponent(pedido as string)}`,
            query: { marketplaceIds: [marketplaceId] },
            maxAttempts: 2,
          })
          acciones = (data?._links?.actions ?? []).map((a) => a.name ?? '').filter(Boolean)
          return { httpStatus }
        }
      )
      return NextResponse.json({ conexion: connection.name, marketplaceId, pedidosVistos, sonda, accionesDisponibles: acciones })
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

    /**
     * ¿PODEMOS SACAR LA VENTA SIN IVA POR MES SIN TOCAR DATOS DE COMPRADORES?
     *
     * Esta sonda decide un encargo entero: el volcado mensual que alimenta el
     * cálculo de comisiones. Hoy ese número se saca a mano del fichero de la
     * Tax Document Library, que lleva dentro la ciudad, el código postal y el
     * país de entrega de cada pedido, y un enlace a la factura del comprador.
     *
     * La Finances API da lo mismo por otro camino: dentro de cada ShipmentEvent
     * vienen los ChargeComponent separados —«Principal» es el precio y «Tax» es
     * el IVA, cada uno en su concepto—, así que la venta sin IVA sale de restar
     * uno de otro sin que aparezca ni un dato de comprador.
     *
     * El rol es «Finance and Accounting» y NO es de los restringidos, que es la
     * otra mitad de por qué este camino y no el fiscal: pedir un rol nuevo
     * INVALIDA todas las autorizaciones y obliga a los siete clientes a volver
     * a autorizar la aplicación. Si esta sonda sale concedida, no hay que pedir
     * nada a nadie.
     *
     * Ventana de un día y una sola página: solo interesa si Amazon deja pasar
     * la llamada, no lo que devuelva. Un 400 cuenta como concedido —significa
     * que validó los parámetros, o sea que pasó el control de permisos— igual
     * que en el resto de sondas.
     */
    sondas.push(
      await sondar(
        {
          nombre: 'listFinancialEvents',
          rol: 'Finance and Accounting',
          para: 'Los movimientos de dinero con el IVA separado del precio. Es de donde saldría la venta sin IVA de cada mes sin tocar ni un dato de comprador.',
        },
        async () => {
          // Dos días atrás: los eventos de las últimas 48 h pueden no estar
          // publicados todavía, y pedir un rango vacío no cambia el veredicto.
          const hasta = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
          const desde = new Date(hasta.getTime() - 24 * 60 * 60 * 1000)
          const { httpStatus } = await spApiRequest<unknown>(credentials, 'listFinancialEvents', {
            method: 'GET',
            path: '/finances/v0/financialEvents',
            query: {
              MaxResultsPerPage: '1',
              PostedAfter: iso(desde),
              PostedBefore: iso(hasta),
            },
          })
          return { httpStatus }
        }
      )
    )

    /**
     * Y LA DEL INFORME FISCAL, QUE SE ESPERA DENEGADA.
     *
     * No se sonda para usarlo: se sonda para no tener que decir «creo que no
     * podemos» basándose en la documentación. Es el mismo informe que se baja a
     * mano de Informes › Tax Document Library.
     *
     * Si contesta 403 —lo esperado—, queda confirmado que el rol «Tax
     * Invoicing» no está concedido y que el camino limpio es el de arriba.
     *
     * Si contestara 2xx, NO SE DESCARGA EL CONTENIDO. Para eso está el segundo
     * paso de esta misma ruta (?informe=<id>), que devuelve los nombres de las
     * columnas y los recuentos y nunca las filas: sirve para ver si la versión
     * por API trae además el nombre del comprador, sin leer los datos de nadie.
     */
    sondas.push(
      await sondar(
        {
          nombre: 'createReport · GET_VAT_TRANSACTION_DATA',
          rol: 'Tax Invoicing (restringido)',
          para: 'El informe fiscal que hoy se baja a mano. Se sonda para confirmar que está cerrado, no para usarlo: lleva datos de comprador dentro.',
        },
        () => pedirInformeConRango(credentials, 'GET_VAT_TRANSACTION_DATA', marketplaceId, 7)
      )
    )

    sondas.push(
      await sondar(
        {
          nombre: 'getInboundShipments',
          rol: 'Logística de Amazon',
          para: 'Seguimiento de los envíos a FBA: en qué estado está cada uno y cuántas unidades ha recibido Amazon de las que mandamos.',
        },
        async () => {
          // Una ventana corta y sin filtrar por estado: solo interesa si Amazon
          // deja pasar la llamada, no lo que devuelva.
          const hasta = new Date()
          const desde = new Date(hasta.getTime() - 30 * 24 * 60 * 60_000)
          const { httpStatus } = await spApiRequest<unknown>(credentials, 'getInboundShipments', {
            method: 'GET',
            path: '/fba/inbound/v0/shipments',
            query: {
              MarketplaceId: marketplaceId,
              QueryType: 'DATE_RANGE',
              LastUpdatedAfter: iso(desde),
              LastUpdatedBefore: iso(hasta),
              // Obligatorio SIEMPRE, también con DATE_RANGE. Sin esto Amazon
              // contesta 400 «At least one of ShipmentStatusList and
              // ShipmentIdList must be provided», que es lo que pasó la primera
              // vez: el permiso estaba y el fallo era de la petición.
              ShipmentStatusList: ['SHIPPED', 'IN_TRANSIT', 'RECEIVING', 'CLOSED'],
            },
          })
          return { httpStatus }
        }
      )
    )

    // La API de envíos 2024-03-20 (crear el envío desde el ERP). SOLO LEE: lista un plan, no crea nada
    sondas.push(
      await sondar(
        {
          nombre: 'listInboundPlans (2024-03-20)',
          rol: 'Logística de Amazon',
          para: 'Crear el envío a FBA desde el ERP (plan, cajas, reparto, transporte UPS y etiquetas). Las escrituras siguen sin probar hasta el primer envío real.',
        },
        async () => {
          const { httpStatus } = await spApiRequest<unknown>(credentials, 'listInboundPlans', {
            method: 'GET',
            path: '/inbound/fba/2024-03-20/inboundPlans',
            query: { pageSize: 1 },
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
