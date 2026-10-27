import { createServiceClient } from '@/lib/supabase/service'
import { isMissingSchema } from '@/lib/plataforma/eventos'
import { loadSubmissionAuthors, loadSubmissions } from '@/lib/amazon/data'
import { clientesGrowth } from '@/lib/growth/clientes'
import { conexionesDeCliente } from '@/lib/plataforma/datos'
import { limpiarBusqueda, paginaDeCliente, resumenDeCliente } from '@/lib/cumplimiento/consulta'
import { estaExenta } from '@/lib/cumplimiento/incidencias'
import { ACCION_ES, ROTULO_TEMA, TEMAS, estadoDeFicha, type FiltrosCumplimiento } from '@/lib/cumplimiento/tipos'
import { estaParada, leerConfigCron, TAREAS_CRON } from '@/lib/sistema/cron'
import { AMAZON_MARKETPLACES, marketplaceLabel, mercadosDeConexion } from '@/lib/types/amazon'
import { acortar, aTexto, entero, booleano, opcion, texto } from './argumentos'
import { ErrorDeHerramienta, type Herramienta } from './protocolo'
import type { ContextoMcp } from './contexto'
import { HERRAMIENTAS_COMERCIALES, INSTRUCCIONES_COMERCIALES } from './comercial/herramientas'

/**
 * LAS HERRAMIENTAS DEL CONECTOR: TODAS DE SOLO LECTURA.
 * SOLO SERVIDOR.
 *
 *
 * ============ LA REGLA QUE ATRAVIESA TODO ============
 *
 * Cada herramienta DE LAS CUENTAS DE AMAZON trabaja con UN cliente, que llega como
 * `cliente` (su slug) y se traduce AQUÍ, en el servidor, a sus cuentas de Amazon.
 * Ninguna devuelve datos de dos clientes a la vez y ninguna compara. Es el mismo
 * compromiso que cumple el resto del ERP: los datos de un vendedor se usan para
 * operar y asesorar SU cuenta. `listar_clientes` solo devuelve nombres, para poder
 * elegir uno.
 *
 * Las del EQUIPO COMERCIAL (lib/mcp/comercial: Mi rendimiento, Cold Calling, Agenda y
 * correo) son otra cosa: no hay `cliente`, porque no tratan cuentas de Amazon sino
 * el trabajo del equipo de ventas y sus leads, y sí agregan y comparan personas.
 *
 * Y NINGUNA toca datos de compradores —pedidos con dirección, el Tax Report—: no
 * hay herramienta para ellos y no se añade.
 *
 *
 * ============ LO QUE DEVUELVE ============
 *
 * JSON compacto, con las cifras ya calculadas, los textos de Amazon recortados y
 * un techo de tamaño (aTexto). Una pregunta que pida 40.000 listings recibe 25 y
 * un `hay_mas`, no el catálogo entero metido en una conversación.
 */

export type { ContextoMcp }

/* ------------------------------------------------------------------ */
/* Lo común                                                            */
/* ------------------------------------------------------------------ */

const ESQUEMA_CLIENTE = {
  type: 'string',
  description: 'Slug del cliente, por ejemplo «shoesf». Usa listar_clientes para ver los que hay.',
}
const ESQUEMA_PAIS = {
  type: 'string',
  description: 'País con su código de dos letras (ES, FR, IT, DE, GB…) o su nombre. Sin él, todos los países.',
}
const ESQUEMA_TEXTO_BUSQUEDA = {
  type: 'string',
  description: 'SKU, ASIN o parte del título. No distingue mayúsculas.',
}

/** El cliente pedido, con su cuenta de Amazon. Falla con un mensaje que el modelo pueda usar */
async function clienteDe(args: Record<string, unknown>) {
  const slug = texto(args, 'cliente', { requerido: true, max: 80 })!.toLowerCase()
  const lista = await clientesGrowth()
  const c = lista.find((x) => x.slug === slug)
  if (!c) {
    throw new ErrorDeHerramienta(
      `No hay ningún cliente con el slug «${slug}». Los que existen: ${lista.map((x) => x.slug).join(', ')}.`
    )
  }
  if (!c.amazonClientId) {
    throw new ErrorDeHerramienta(`${c.nombre} no tiene la cuenta de Amazon conectada, así que no hay nada que consultar.`)
  }
  return { nombre: c.nombre, slug: c.slug, amazonClientId: c.amazonClientId }
}

/** El marketplace pedido (por código de país, nombre o identificador), o undefined si no se pide ninguno */
function paisDe(args: Record<string, unknown>): string | undefined {
  const v = texto(args, 'pais', { max: 40 })
  if (!v) return undefined
  const u = v.toUpperCase()
  const m = AMAZON_MARKETPLACES.find(
    (x) => x.countryCode === u || x.id === u || x.label.toUpperCase() === u
  )
  if (!m) {
    throw new ErrorDeHerramienta(`No conozco el país «${v}». Usa el código de dos letras: ES, FR, IT, DE, GB…`)
  }
  return m.id
}

/** Lo que enseña `ficha`: el estado del listing según lo último que se leyó de Amazon */
function fichaDe(listingStatus: string[] | null | undefined): 'comprable' | 'visible' | 'sin_dato' {
  const e = listingStatus ?? []
  if (e.length === 0) return 'sin_dato'
  const f = estadoDeFicha(e)
  return f === 'oculto' ? 'sin_dato' : f
}

const fecha = (iso: string | null | undefined) => (iso ? iso.slice(0, 16).replace('T', ' ') + ' UTC' : null)

/* ------------------------------------------------------------------ */
/* 1. Clientes                                                         */
/* ------------------------------------------------------------------ */

const listarClientes: Herramienta<ContextoMcp> = {
  nombre: 'listar_clientes',
  titulo: 'Listar clientes',
  descripcion:
    'Lista los clientes de Liberty Seller con su slug (el que hay que pasar como `cliente` al resto de herramientas), ' +
    'si están activos, si tienen la cuenta de Amazon conectada y si mandan volcado de stock. Solo nombres: no devuelve datos de negocio.',
  esquema: { type: 'object', properties: {}, additionalProperties: false },
  soloLectura: true,
  async ejecutar() {
    const lista = await clientesGrowth()
    return {
      texto: aTexto({
        clientes: lista.map((c) => ({
          cliente: c.slug,
          nombre: c.nombre,
          activo: c.activo,
          cuenta_amazon_conectada: c.amazonClientId !== null,
          manda_volcado_de_stock: c.stockClientId !== null,
        })),
      }),
    }
  },
}

/* ------------------------------------------------------------------ */
/* 2. Resumen del catálogo                                             */
/* ------------------------------------------------------------------ */

const resumenCatalogo: Herramienta<ContextoMcp> = {
  nombre: 'resumen_catalogo',
  titulo: 'Resumen del catálogo de un cliente',
  descripcion:
    'Cuántos listings tiene un cliente en cada país: total, con stock, FBA y FBM, padres de variación y comprables, ' +
    'y cuándo se leyó por última vez. Es el punto de partida para saber de qué tamaño es la cuenta. ' +
    'Los datos son los del espejo del ERP, que se refresca cada 15 minutos; no son en directo.',
  esquema: { type: 'object', properties: { cliente: ESQUEMA_CLIENTE }, required: ['cliente'], additionalProperties: false },
  soloLectura: true,
  async ejecutar(args) {
    const c = await clienteDe(args)
    const conexiones = await conexionesDeCliente(c.amazonClientId)
    if (conexiones.length === 0) {
      throw new ErrorDeHerramienta(`${c.nombre} no tiene ninguna cuenta de Amazon activa ahora mismo.`)
    }
    const service = createServiceClient()

    const cuentas = await Promise.all(
      conexiones.map(async (conn) => {
        const paises = await Promise.all(
          mercadosDeConexion(conn).map(async (mercado) => {
            const base = () =>
              service
                .from('amazon_listings')
                .select('id', { count: 'exact', head: true })
                .eq('connection_id', conn.id)
                .eq('marketplace_id', mercado)
            const [total, conStock, fba, padres, comprables, ultima] = await Promise.all([
              base(),
              base().or('and(is_fba.eq.true,fba_fulfillable_quantity.gt.0),and(is_fba.eq.false,quantity.gt.0)'),
              base().eq('is_fba', true),
              base().eq('clasificacion_item', 'VARIATION_PARENT'),
              base().contains('listing_status', ['BUYABLE']),
              service
                .from('amazon_listings')
                .select('last_seen_at')
                .eq('connection_id', conn.id)
                .eq('marketplace_id', mercado)
                .order('last_seen_at', { ascending: false })
                .limit(1),
            ])
            for (const r of [total, conStock, fba, padres, comprables, ultima]) if (r.error) throw r.error
            const n = total.count ?? 0
            return {
              pais: marketplaceLabel(mercado),
              listings: n,
              con_stock: conStock.count ?? 0,
              fba: fba.count ?? 0,
              fbm: n - (fba.count ?? 0),
              padres_de_variacion: padres.count ?? 0,
              comprables: comprables.count ?? 0,
              ultima_lectura: fecha(((ultima.data ?? [])[0] as { last_seen_at: string } | undefined)?.last_seen_at),
            }
          })
        )
        return {
          cuenta: conn.name,
          ultima_sincronizacion_del_catalogo: fecha(conn.last_sync_at),
          listings_en_la_ultima_sincronizacion: conn.last_sync_items,
          paises: paises.filter((p) => p.listings > 0),
        }
      })
    )

    return {
      texto: aTexto({
        cliente: c.nombre,
        cuentas,
        nota:
          '«comprables» cuenta los listings que Amazon marcó como comprables en la última lectura; que un listing sin stock no sea comprable es normal. ' +
          'Para saber qué listings tienen problemas de verdad, usa cumplimiento_resumen.',
      }),
    }
  },
}

/* ------------------------------------------------------------------ */
/* 3. Buscar listings                                                  */
/* ------------------------------------------------------------------ */

const COLUMNAS_LISTING =
  'sku, asin, title, marketplace_id, listing_status, price, currency, quantity, is_fba, ' +
  'fba_quantity, fba_fulfillable_quantity, product_type, clasificacion_item, last_seen_at'

interface FilaListing {
  sku: string
  asin: string | null
  title: string | null
  marketplace_id: string
  listing_status: string[] | null
  price: number | null
  currency: string | null
  quantity: number | null
  is_fba: boolean | null
  fba_quantity: number | null
  fba_fulfillable_quantity: number | null
  product_type: string | null
  clasificacion_item: string | null
  last_seen_at: string
  publicacion_bloqueada_motivo?: string | null
}

const buscarListings: Herramienta<ContextoMcp> = {
  nombre: 'buscar_listings',
  titulo: 'Buscar listings de un cliente',
  descripcion:
    'Busca listings de UN cliente por SKU, ASIN o título, con precio, stock y canal (FBA/FBM). Los que tienen stock salen primero. ' +
    'Devuelve como mucho `limite` filas y dice si hay más. Datos del espejo del ERP (cada 15 minutos), no en directo.',
  esquema: {
    type: 'object',
    properties: {
      cliente: ESQUEMA_CLIENTE,
      texto: ESQUEMA_TEXTO_BUSQUEDA,
      pais: ESQUEMA_PAIS,
      solo_con_stock: { type: 'boolean', description: 'Solo listings con unidades disponibles. Por defecto no.' },
      limite: { type: 'integer', minimum: 1, maximum: 50, description: 'Filas a devolver (1-50). Por defecto 20.' },
    },
    required: ['cliente'],
    additionalProperties: false,
  },
  soloLectura: true,
  async ejecutar(args) {
    const c = await clienteDe(args)
    const busca = limpiarBusqueda(texto(args, 'texto', { max: 120 }) ?? '')
    const mercado = paisDe(args)
    const soloStock = booleano(args, 'solo_con_stock')
    const limite = entero(args, 'limite', { min: 1, max: 50, defecto: 20 })

    const conexiones = await conexionesDeCliente(c.amazonClientId)
    if (conexiones.length === 0) throw new ErrorDeHerramienta(`${c.nombre} no tiene ninguna cuenta de Amazon activa ahora mismo.`)
    const ids = conexiones.map((x) => x.id)
    const service = createServiceClient()

    const consulta = (columnas: string) => {
      let q = service.from('amazon_listings').select(columnas).in('connection_id', ids)
      if (mercado) q = q.eq('marketplace_id', mercado)
      if (busca) q = q.or(`sku.ilike.*${busca}*,asin.ilike.*${busca}*,title.ilike.*${busca}*`)
      if (soloStock) q = q.or('and(is_fba.eq.true,fba_fulfillable_quantity.gt.0),and(is_fba.eq.false,quantity.gt.0)')
      // Se pide una de más para saber si hay más sin contar todo
      return q.order('sku', { ascending: true }).order('marketplace_id', { ascending: true }).limit(limite + 1)
    }

    // El motivo de «publicación bloqueada» es de la migración 169: si no está, se sigue sin él
    let res = await consulta(`${COLUMNAS_LISTING}, publicacion_bloqueada_motivo`)
    if (res.error && isMissingSchema(res.error)) res = await consulta(COLUMNAS_LISTING)
    if (res.error) throw res.error

    const filas = (res.data ?? []) as unknown as FilaListing[]
    const visibles = filas.slice(0, limite)
    // Con stock primero, sin perder el orden por SKU dentro de cada grupo
    const tieneStock = (f: FilaListing) => (f.is_fba ? (f.fba_fulfillable_quantity ?? f.fba_quantity ?? 0) : (f.quantity ?? 0)) > 0
    visibles.sort((a, b) => Number(tieneStock(b)) - Number(tieneStock(a)))

    return {
      texto: aTexto({
        cliente: c.nombre,
        listings: visibles.map((f) => ({
          sku: f.sku,
          asin: f.asin,
          titulo: acortar(f.title, 120),
          pais: marketplaceLabel(f.marketplace_id),
          canal: f.is_fba ? 'FBA' : 'FBM',
          stock: f.is_fba ? (f.fba_fulfillable_quantity ?? f.fba_quantity) : f.quantity,
          precio: f.price,
          moneda: f.currency,
          ficha: fichaDe(f.listing_status),
          tipo_de_producto: f.product_type,
          es_padre_de_variacion: f.clasificacion_item === 'VARIATION_PARENT',
          publicacion_bloqueada: f.publicacion_bloqueada_motivo ?? null,
          ultima_lectura: fecha(f.last_seen_at),
        })),
        devueltos: visibles.length,
        hay_mas: filas.length > limite,
        nota:
          '«ficha» es el estado según la última lectura: «sin_dato» no significa oculto, solo que ese listing aún no se ha leído con detalle. ' +
          'Los problemas reales de un listing están en cumplimiento_listings.',
      }),
    }
  },
}

/* ------------------------------------------------------------------ */
/* 4. Cumplimiento: resumen                                            */
/* ------------------------------------------------------------------ */

const cumplimientoResumen: Herramienta<ContextoMcp> = {
  nombre: 'cumplimiento_resumen',
  titulo: 'Cumplimiento: resumen de un cliente',
  descripcion:
    'Las incidencias que Amazon pone a los listings de UN cliente: cuántos tienen errores, cuántos están ocultos, cuántos solo avisos, ' +
    'cuántos tienen stock y problema a la vez, y el reparto por tema (normativa y GPSR, mercancías peligrosas, aprobación de marca, ' +
    'códigos de producto, imágenes, precio…), tanto entre los que necesitan atención como entre todos los que tienen alguna incidencia: ' +
    'la normativa (RAP, GPSR) llega casi toda como AVISO, y solo aparece en la segunda serie. ' +
    'IMPORTANTE: son cifras de lo REVISADO, no de todo el catálogo; la respuesta dice cuánto falta. ' +
    'No incluye el panel «Gestionar su cumplimiento» de Seller Central, que Amazon no publica por API.',
  esquema: {
    type: 'object',
    properties: { cliente: ESQUEMA_CLIENTE, pais: ESQUEMA_PAIS },
    required: ['cliente'],
    additionalProperties: false,
  },
  soloLectura: true,
  async ejecutar(args) {
    const c = await clienteDe(args)
    const mercado = paisDe(args) ?? 'todos'
    const r = await resumenDeCliente(c.amazonClientId, mercado)
    if (!r.ok) {
      throw new ErrorDeHerramienta(
        r.faltaMigracion
          ? 'Falta lanzar la migración 227 (cumplimiento) en Supabase: todavía no hay dónde guardar las revisiones.'
          : r.error
      )
    }
    const pct = r.total > 0 ? Math.round((r.revisados / r.total) * 100) : 0
    return {
      texto: aTexto({
        cliente: c.nombre,
        pais: mercado === 'todos' ? 'todos' : marketplaceLabel(mercado),
        cobertura: { revisados: r.revisados, de_un_total: r.total, porcentaje: pct },
        ultima_revision: fecha(r.ultimaRevision),
        necesitan_atencion: r.atencion,
        con_errores: r.conErrores,
        ocultos_por_amazon: r.suprimidos,
        solo_avisos: r.soloAvisos,
        con_stock_y_con_problema: r.atencionConStock,
        // Un listing cuenta en TODOS sus temas, así que las cifras no suman el total
        por_tema_entre_los_que_necesitan_atencion: r.porTema.map((t) => ({
          tema: t.tema,
          descripcion: ROTULO_TEMA[t.tema].largo,
          listings: t.n,
        })),
        // Con cualquier incidencia, avisos incluidos: la normativa (RAP, GPSR) llega casi toda como aviso
        por_tema_con_cualquier_incidencia: r.porTemaTodos.map((t) => ({
          tema: t.tema,
          descripcion: ROTULO_TEMA[t.tema].largo,
          listings: t.n,
        })),
        paises: r.mercados.map((m) => ({ pais: m.nombre, revisados: m.revisados, de_un_total: m.total })),
        nota:
          pct < 100
            ? `Solo se ha revisado el ${pct} % del catálogo: las cifras son de lo revisado y el resto puede tener más problemas. Se empieza por los que tienen stock.`
            : 'Se ha revisado todo el catálogo.',
      }),
    }
  },
}

/* ------------------------------------------------------------------ */
/* 5. Cumplimiento: la lista                                           */
/* ------------------------------------------------------------------ */

const TEMAS_ARG = [...TEMAS] as const

const cumplimientoListings: Herramienta<ContextoMcp> = {
  nombre: 'cumplimiento_listings',
  titulo: 'Cumplimiento: listings con incidencias',
  descripcion:
    'Los listings de UN cliente con incidencias de Amazon, con el mensaje original de Amazon, los atributos implicados, qué hace Amazon ' +
    '(ocultar el listing, ocultar un dato, quitarlo del catálogo), el plazo de gracia si lo hay y desde cuándo está abierto cada problema. ' +
    'Salen primero los que tienen stock y los que están ocultos. Filtra por gravedad, tema (normativa, peligrosas, aprobacion, marca, ' +
    'identificadores, imagenes, precio, duplicado, datos, otros), país o texto. Un listing sale en un tema si tiene ALGUNA incidencia de ese tema. ' +
    'Para ver la normativa (RAP, GPSR), que llega como aviso, usa gravedad «todo» y tema «normativa». Paginado.',
  esquema: {
    type: 'object',
    properties: {
      cliente: ESQUEMA_CLIENTE,
      pais: ESQUEMA_PAIS,
      gravedad: {
        type: 'string',
        enum: ['atencion', 'avisos', 'todo'],
        description: '«atencion» = con errores u ocultos (por defecto); «avisos» = solo recomendaciones; «todo» = cualquiera con incidencias.',
      },
      tema: { type: 'string', enum: TEMAS_ARG, description: 'Solo los de este tema. Por defecto todos.' },
      solo_con_stock: { type: 'boolean', description: 'Solo los que tienen unidades disponibles.' },
      texto: ESQUEMA_TEXTO_BUSQUEDA,
      pagina: { type: 'integer', minimum: 0, description: 'Página, empezando en 0.' },
      limite: { type: 'integer', minimum: 1, maximum: 25, description: 'Listings por página (1-25). Por defecto 10.' },
    },
    required: ['cliente'],
    additionalProperties: false,
  },
  soloLectura: true,
  async ejecutar(args) {
    const c = await clienteDe(args)
    const filtros: FiltrosCumplimiento = {
      mercado: paisDe(args) ?? 'todos',
      gravedad: opcion(args, 'gravedad', ['atencion', 'avisos', 'todo'] as const, 'atencion'),
      tema: opcion(args, 'tema', ['todos', ...TEMAS_ARG] as const, 'todos'),
      soloStock: booleano(args, 'solo_con_stock'),
      busca: texto(args, 'texto', { max: 120 }) ?? '',
    }
    const pagina = entero(args, 'pagina', { min: 0, max: 10_000, defecto: 0 })
    const limite = entero(args, 'limite', { min: 1, max: 25, defecto: 10 })

    const r = await paginaDeCliente(c.amazonClientId, filtros, pagina, limite)
    if ('error' in r) throw new ErrorDeHerramienta(r.error)

    const ahora = new Date()
    return {
      texto: aTexto({
        cliente: c.nombre,
        pagina,
        devueltos: r.filas.length,
        hay_mas: r.hayMas,
        listings: r.filas.map((f) => ({
          sku: f.sku,
          asin: f.asin,
          titulo: acortar(f.titulo, 100),
          pais: marketplaceLabel(f.marketplace_id),
          ficha: estadoDeFicha(f.estado),
          con_stock: f.con_stock,
          errores: f.errores,
          avisos: f.avisos,
          oculto_por_amazon: f.suprimido,
          tema_principal: f.tema ? ROTULO_TEMA[f.tema].corto : null,
          problema_abierto_desde: fecha(f.desde),
          revisado: fecha(f.revisado_at),
          incidencias: f.incidencias.slice(0, 3).map((i) => ({
            codigo: i.codigo,
            gravedad: i.gravedad,
            tema: ROTULO_TEMA[i.tema].corto,
            mensaje: acortar(i.mensaje, 240),
            atributos: i.atributos,
            que_hace_amazon: i.acciones.map((a) => ACCION_ES[a] ?? a),
            plazo_de_gracia_hasta:
              i.exencion?.estado === 'EXEMPT_UNTIL_EXPIRY_DATE' && estaExenta(i.exencion, ahora) ? fecha(i.exencion.caduca) : null,
            abierta_desde: fecha(i.desde),
          })),
          incidencias_no_mostradas: Math.max(0, f.incidencias.length - 3),
        })),
      }, 30_000),
    }
  },
}

/* ------------------------------------------------------------------ */
/* 6. Historial de cambios                                             */
/* ------------------------------------------------------------------ */

const ETIQUETA_CAMPO: Record<string, string> = { price: 'precio', quantity: 'stock' }

const historialCambios: Herramienta<ContextoMcp> = {
  nombre: 'historial_cambios',
  titulo: 'Historial de cambios enviados a Amazon',
  descripcion:
    'Los cambios de precio y de stock que el ERP ha enviado a Amazon en la cuenta de UN cliente, del más reciente al más antiguo: ' +
    'qué SKU, valor anterior y nuevo, si Amazon lo aceptó o lo confirmó, quién lo mandó y de dónde salió (a mano o de un fichero). ' +
    'Sirve para contestar «¿por qué está este SKU a este precio?». Solo lectura: no envía nada.',
  esquema: {
    type: 'object',
    properties: {
      cliente: ESQUEMA_CLIENTE,
      sku: { type: 'string', description: 'Solo los cambios de los SKU que contengan este texto.' },
      limite: { type: 'integer', minimum: 1, maximum: 50, description: 'Cambios a devolver (1-50). Por defecto 20.' },
    },
    required: ['cliente'],
    additionalProperties: false,
  },
  soloLectura: true,
  async ejecutar(args) {
    const c = await clienteDe(args)
    const sku = texto(args, 'sku', { max: 120 })
    const limite = entero(args, 'limite', { min: 1, max: 50, defecto: 20 })

    const conexiones = await conexionesDeCliente(c.amazonClientId)
    if (conexiones.length === 0) throw new ErrorDeHerramienta(`${c.nombre} no tiene ninguna cuenta de Amazon activa ahora mismo.`)

    const lotes = await Promise.all(conexiones.map((conn) => loadSubmissions(conn.id, { sku: sku ?? null, limit: limite })))
    const todos = lotes
      .flat()
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
      .slice(0, limite)
    const autores = await loadSubmissionAuthors(todos)

    return {
      texto: aTexto({
        cliente: c.nombre,
        cambios: todos.map((s) => ({
          cuando: fecha(s.created_at),
          sku: s.sku,
          pais: marketplaceLabel(s.marketplace_id),
          campo: ETIQUETA_CAMPO[s.field] ?? s.field,
          valor_anterior: s.previous_value,
          valor_nuevo: s.new_value,
          moneda: s.currency,
          estado: s.status,
          mensaje_de_error: acortar(s.error_message, 240),
          // El ERP guarda como «manual» lo que manda un proceso de precios sin fichero: sin
          // autor no lo tecleó nadie, así que no se dice «a mano»
          origen:
            s.source === 'fichero'
              ? `fichero (${s.source_ref ?? 'sin nombre'})`
              : s.created_by
                ? 'a mano'
                : 'proceso automático del ERP',
          quien: s.created_by ? (autores[s.created_by] ?? 'desconocido') : 'proceso automático',
        })),
        devueltos: todos.length,
        nota:
          '«aceptado» significa que Amazon lo aceptó para procesarlo; solo «confirmado» prueba que el valor nuevo ya se ha visto en Amazon.',
      }),
    }
  },
}

/* ------------------------------------------------------------------ */
/* 7. Estado de los procesos automáticos                               */
/* ------------------------------------------------------------------ */

const estadoProcesos: Herramienta<ContextoMcp> = {
  nombre: 'estado_procesos',
  titulo: 'Estado de los procesos automáticos del ERP',
  descripcion:
    'Los procesos que corren solos en el ERP (catálogo de Amazon, cumplimiento, auditor de stock, remesas FBA…): cada cuánto corren, ' +
    'si están activos, cuándo corrieron por última vez, cómo acabaron y si se han parado. Sirve para saber si los datos que se consultan están al día.',
  esquema: { type: 'object', properties: {}, additionalProperties: false },
  soloLectura: true,
  async ejecutar() {
    const [config, runs] = await Promise.all([
      leerConfigCron(),
      createServiceClient()
        .from('cron_ejecuciones')
        .select('tarea, iniciado_at, ok, resumen, error, duracion_ms, lanzado_por')
        .order('iniciado_at', { ascending: false })
        .limit(400),
    ])
    if (runs.error && !isMissingSchema(runs.error)) throw runs.error
    const filas = (runs.data ?? []) as Array<{
      tarea: string
      iniciado_at: string
      ok: boolean | null
      resumen: string | null
      error: string | null
      duracion_ms: number | null
      lanzado_por: string | null
    }>

    return {
      texto: aTexto({
        procesos: TAREAS_CRON.map((t) => {
          const cfg = config.find((x) => x.tarea === t.id)
          const ultima = filas.find((f) => f.tarea === t.id && f.lanzado_por === null) ?? null
          const cadaMinutos = cfg?.cada_minutos ?? t.cadaMinutos
          return {
            proceso: t.id,
            nombre: t.nombre,
            cada_minutos: cadaMinutos,
            activo: cfg?.activo ?? true,
            parado: estaParada(cadaMinutos, ultima?.iniciado_at ?? null),
            ultima_pasada_automatica: ultima
              ? {
                  cuando: fecha(ultima.iniciado_at),
                  ok: ultima.ok,
                  segundos: ultima.duracion_ms === null ? null : Math.round(ultima.duracion_ms / 1000),
                  resumen: acortar(ultima.resumen, 200),
                  error: acortar(ultima.error, 240),
                }
              : null,
          }
        }),
        nota: '«parado» = lleva más de tres veces su cadencia sin correr (o no ha corrido nunca).',
      }),
    }
  },
}

/* ------------------------------------------------------------------ */

export const HERRAMIENTAS: readonly Herramienta<ContextoMcp>[] = [
  listarClientes,
  resumenCatalogo,
  buscarListings,
  cumplimientoResumen,
  cumplimientoListings,
  historialCambios,
  estadoProcesos,
  // El equipo comercial: Mi rendimiento, Cold Calling y el correo (lib/mcp/comercial). No llevan `cliente`
  ...HERRAMIENTAS_COMERCIALES,
]

export const INSTRUCCIONES = [
  'Servidor interno del ERP de Liberty Seller, solo para el equipo. Todas las herramientas son de SOLO LECTURA: no cambian nada en el ERP, ni en las cuentas de Amazon de los clientes, ni en Cold Calling ni en el correo.',
  'CUENTAS DE AMAZON DE LOS CLIENTES (`listar_clientes`, `resumen_catalogo`, `buscar_listings`, `cumplimiento_resumen`, `cumplimiento_listings`, `historial_cambios`): trabajan con UN cliente a la vez y piden `cliente` (su slug; `listar_clientes` los da). Los datos de cada cliente solo se usan para operar y asesorar SU cuenta: no los mezcles, agregues ni compares con los de otro cliente en la misma conversación, y no los compartas fuera del equipo. Si te piden comparar clientes, explica que no se hace. `estado_procesos` no es de un cliente: sirve para todo.',
  'Los datos son una foto, no tiempo real: el catálogo se refresca cada 15 minutos y el cumplimiento se revisa por tandas (empezando por los listings con stock). Antes de afirmar que algo está así «ahora», mira las fechas de lectura que devuelve cada herramienta; `estado_procesos` dice si el ERP está al día.',
  'En cumplimiento las cifras son de lo REVISADO: si `cobertura.porcentaje` es menor que 100, dilo y no presentes la cifra como el total de la cuenta. Tampoco incluye el panel «Gestionar su cumplimiento» de Seller Central, que Amazon no publica por API.',
  'Las respuestas están recortadas a propósito (límites por llamada y `hay_mas`): pide más páginas o filtra antes que dar por completa una lista.',
  INSTRUCCIONES_COMERCIALES,
].join('\n\n')
