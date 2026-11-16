/**
 * FOTO REAL DE PRODUCCIÓN PARA LAS PRUEBAS DEL PLANIFICADOR  —  W1-K (spec de Remesas «pro», §11 D17)
 * ====================================================================================================
 *
 * Genera `lib/fba/__fixtures__/plan-real.json`: una foto FIJA de los datos de producción de unas pocas
 * referencias elegidas porque cada una enseña un caso difícil del planificador (rota normal, stock de
 * sobra, entrante sin remesa, envío dudoso, tallas de calzado, agotado sin BUYABLE, plazo largo de EE. UU.).
 * Las pruebas (`plan-cliente.prueba.ts`, S1) leen esa foto y comprueban lo cualitativo; las cifras exactas
 * se escriben mirando la foto que salga, nunca a mano.
 *
 * CÓMO REGENERARLA (desde la raíz del repo, con `.env.local` en su sitio):
 *
 *     npx tsx scripts/fba-foto-pruebas.ts                 # hoy = el día de hoy en España
 *     npx tsx scripts/fba-foto-pruebas.ts --hoy 2026-11-15  # solo cambia la fecha que se apunta como «hoy»
 *     npx tsx scripts/fba-foto-pruebas.ts --salida /ruta/otra.json
 *
 * Ojo: regenerarla CAMBIA las cifras (es otro día de ventas). Si se regenera, hay que repasar las cifras
 * que las pruebas tengan escritas a partir de la foto anterior.
 *
 * SOLO LEE. Usa la clave de servicio de `.env.local` (NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY)
 * y SOLO hace `select`: ni insert, ni update, ni delete, ni rpc. No llama a Amazon.
 *
 * SIN DATOS PERSONALES: ni correos, ni direcciones, ni nombres de personas (se quitan `created_by`,
 * `aprobada_por`, `cliente_acepto_*`, `transporte_aceptado_*`, `actualizado_por`, notas y el análisis IA).
 * Quedan el nombre comercial del cliente, los títulos de producto (recortados) y el nombre de cada remesa.
 *
 * QUÉ LLEVA, por cliente (forma en `FotoPlanReal`, abajo):
 *   - `conexion`: región y mercados de la conexión activa (sin tokens ni el id de vendedor).
 *   - `lecturas`: todas las copias del libro de la conexión con `leido_desde` (primer movimiento) y
 *     `leido_hasta`, y la elegida con la regla de §11 D35 (`lecturaElegida`, `avisoLectura`).
 *   - `libro`: el libro mayor de la lectura elegida, AGREGADO por SKU, día, tipo y disposición (la forma de
 *     `fba_movimientos_diarios`, migración 316: `MovimientoDiario`) desde hoy − 400 hasta hoy.
 *   - `ventasAnoPasado`: solo Shipments, en positivo, por SKU y día, de hoy − 730 a hoy − 365 + 180 (año
 *     anterior entero para el perfil semanal + el horizonte para la estacionalidad). Se pisa con `libro` en
 *     parte: es a propósito, el servidor también las pide aparte (§11 D29).
 *   - `listings`: las filas de `amazon_listings` de esos SKU en TODOS los mercados de la conexión.
 *   - `remesas`: las del cliente desde hoy − 400 (y cualquiera anterior que no esté cerrada), con sus
 *     totales y las líneas de los SKU de la foto.
 *   - `receipts`: los Receipts del libro (lectura elegida) por referencia de envío y día, todas las referencias
 *     de esas remesas (para medir la recepción, §11 D10).
 *   - `alertasConfig`, `plazosSku` y, en ShoesF, `catalogo` (modelo F0047 BURDEOS entero y FBA047768-45).
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { leerTodo } from '../lib/fba/paginar'
import { diaEnEspana } from '../lib/fba/fechas'

/* ------------------------------ Entorno ------------------------------ */

for (const l of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(l)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

function argumento(nombre: string): string | null {
  const i = process.argv.indexOf(`--${nombre}`)
  return i >= 0 ? process.argv[i + 1] ?? null : null
}

/* ------------------------------ Qué se fotografía ------------------------------ */

const ES = 'A1RKKUPIHCS9HS'

interface Seleccion {
  /** Nombre del cliente en `amazon_clients.name` */
  cliente: string
  /** SKU exactos */
  skus: string[]
  /** Patrones `ilike` sobre `amazon_listings.sku` (modelos enteros) */
  patrones?: string[]
  /** Modelos del catálogo (ref + nombre/color) que entran enteros */
  modelosCatalogo?: Array<{ ref: string; nombre: string }>
}

const SELECCION: Seleccion[] = [
  { cliente: 'Opinas', skus: ['80-HGPJ-1F82', '12-CDXR-I4TN'] },
  { cliente: 'Creative Toys', skus: ['WM40297', 'WM01550', 'WM50531', 'T7-0CG9-DSP7'] },
  {
    cliente: 'ShoesF',
    skus: ['FBA047768-45', 'FBA633372-41'],
    patrones: ['FBA633372-%'],
    modelosCatalogo: [{ ref: 'F0047', nombre: 'BURDEOS' }],
  },
  { cliente: 'Cobo Family', skus: [], patrones: ['262 BURDEO/%'] },
  { cliente: 'Shoplamp', skus: ['FBA-UE-F14V-ZFQA'] },
  { cliente: 'Portico LLC', skus: ['CARSEK'] },
]

const DIAS_LIBRO = 400
const TITULO_MAX = 80

/* ------------------------------ Forma de la foto ------------------------------ */

/** Fila de `fba_movimientos_diarios` (316): libro agregado por SKU, día, tipo y disposición */
export interface MovimientoDiarioFoto { sku: string; fecha: string; tipo: string; disposicion: string | null; cantidad: number }

export interface LecturaFoto {
  marketplace_id: string
  leido_hasta: string | null
  /** Primer movimiento guardado de esa copia del libro (null = vacía) */
  leido_desde: string | null
  ultimo_error: string | null
  updated_at: string | null
}

export interface ListingFoto {
  marketplace_id: string; sku: string; asin: string | null; fnsku: string | null; title: string | null
  listing_status: string[] | null; price: number | null; currency: string | null
  fba_quantity: number | null; fba_fulfillable_quantity: number | null
  fba_inbound_quantity: number | null; fba_reserved_quantity: number | null; fba_unfulfillable_quantity: number | null
  activo_manual: boolean | null; is_fba: boolean | null; updated_at: string | null
}

export interface RemesaFoto {
  id: string; nombre: string | null; estado: string; estado_amazon: string | null
  marketplace_id: string | null; referencia_envio: string | null
  fecha_envio: string | null; llegada_at: string | null
  created_at: string; updated_at: string | null
  aprobada_at: string | null; encajado_at: string | null; lista_at: string | null
  /** Totales de TODAS las líneas de la remesa (no solo las de la foto) */
  totales: { lineas: number; unidades: number; recibidas: number }
  /** Solo las líneas de los SKU de la foto */
  lineas: Array<{ sku: string; unidades: number; unidades_recibidas: number | null; unidades_propuestas: number | null }>
}

export interface ClienteFoto {
  nombre: string
  clienteId: string
  conexion: { id: string; region: string | null; marketplace_ids: string[]; default_marketplace_id: string | null; is_active: boolean; status: string | null }
  skus: string[]
  lecturas: LecturaFoto[]
  /** Primer `fecha_envio` de una remesa enviada o cerrada */
  primerEnvio: string | null
  /** max(primerEnvio, hoy − 400) */
  desdeNecesario: string
  lecturaElegida: string | null
  avisoLectura: string | null
  libro: MovimientoDiarioFoto[]
  ventasAnoPasado: { desde: string; hasta: string; filas: Array<{ sku: string; fecha: string; unidades: number }> }
  listings: ListingFoto[]
  remesas: RemesaFoto[]
  receipts: Array<{ referencia: string; fecha: string; cantidad: number }>
  alertasConfig: Record<string, unknown> | null
  plazosSku: Array<Record<string, unknown>>
  catalogo: Array<Record<string, unknown>>
}

export interface FotoPlanReal {
  version: 1
  /** «Hoy» de la foto (Europe/Madrid) */
  hoy: string
  generadaAt: string
  libroDesde: string
  nota: string
  clientes: ClienteFoto[]
}

/* ------------------------------ Fechas ------------------------------ */

function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

const dia = (v: string | null | undefined) => (v ? v.slice(0, 10) : null)

/* ------------------------------ Lectura elegida (§11 D35, copia local) ------------------------------ */

/**
 * Misma regla que `elegirLectura` (W1-H), repetida aquí porque un paquete no importa de su misma oleada:
 * gana la más reciente entre las que cubren `desdeNecesario`; empate → España; si ninguna cubre, la de más
 * historia con aviso. Las que no tienen `leido_hasta` solo cuentan si no hay otra.
 */
function elegir(lecturas: LecturaFoto[], desdeNecesario: string): { mercado: string | null; aviso: string | null } {
  if (lecturas.length === 0) return { mercado: null, aviso: 'Sin lecturas del libro' }
  const desempate = (a: LecturaFoto, b: LecturaFoto) =>
    (a.marketplace_id === ES ? 0 : 1) - (b.marketplace_id === ES ? 0 : 1) || a.marketplace_id.localeCompare(b.marketplace_id)
  const conFecha = lecturas.filter((l) => l.leido_hasta)
  if (conFecha.length === 0) return { mercado: [...lecturas].sort(desempate)[0].marketplace_id, aviso: 'Las ventas no están leídas todavía' }
  const masReciente = (a: LecturaFoto, b: LecturaFoto) => (b.leido_hasta ?? '').localeCompare(a.leido_hasta ?? '') || desempate(a, b)
  const cubren = conFecha.filter((l) => l.leido_desde !== null && l.leido_desde <= desdeNecesario)
  if (cubren.length > 0) {
    const e = [...cubren].sort(masReciente)[0]
    const otra = conFecha.some((l) => (l.leido_hasta ?? '') > (e.leido_hasta ?? ''))
    return { mercado: e.marketplace_id, aviso: otra ? `Ventas hasta el ${e.leido_hasta}: es la única copia con historia suficiente` : null }
  }
  const masHistoria = (a: LecturaFoto, b: LecturaFoto) => {
    if (a.leido_desde === null && b.leido_desde !== null) return 1
    if (b.leido_desde === null && a.leido_desde !== null) return -1
    return (a.leido_desde ?? '').localeCompare(b.leido_desde ?? '') || masReciente(a, b)
  }
  const e = [...conFecha].sort(masHistoria)[0]
  return { mercado: e.marketplace_id, aviso: e.leido_desde ? `Las ventas solo están leídas desde el ${e.leido_desde}` : 'El libro está vacío' }
}

/* ------------------------------ Lecturas de la base (solo select) ------------------------------ */

function crearServicio(url: string, clave: string) {
  return createClient(url, clave, { auth: { persistSession: false, autoRefreshToken: false } })
}
type Servicio = ReturnType<typeof crearServicio>

async function enTrozos<T>(lista: string[], tam: number, f: (trozo: string[]) => Promise<T[]>): Promise<T[]> {
  const sal: T[] = []
  for (let i = 0; i < lista.length; i += tam) sal.push(...(await f(lista.slice(i, i + tam))))
  return sal
}

async function fotoDeCliente(s: Servicio, sel: Seleccion, hoy: string): Promise<ClienteFoto> {
  const { data: cli, error: e1 } = await s.from('amazon_clients').select('id, name').eq('name', sel.cliente).maybeSingle()
  if (e1) throw e1
  if (!cli) throw new Error(`No existe el cliente «${sel.cliente}»`)
  const clienteId = (cli as { id: string }).id

  const { data: cons, error: e2 } = await s
    .from('amazon_connections')
    .select('id, region, marketplace_ids, default_marketplace_id, is_active, status')
    .eq('client_id', clienteId)
  if (e2) throw e2
  const conexiones = (cons ?? []) as ClienteFoto['conexion'][]
  const conexion = conexiones.find((c) => c.is_active) ?? conexiones[0]
  if (!conexion) throw new Error(`«${sel.cliente}» no tiene conexión con Amazon`)

  /* --- SKU: los exactos, los de los patrones y los del catálogo --- */
  const skus = new Set(sel.skus)
  for (const p of sel.patrones ?? []) {
    const filas = await leerTodo<{ sku: string }>((a, b) =>
      s.from('amazon_listings').select('sku').eq('connection_id', conexion.id).ilike('sku', p).order('id').range(a, b)
    )
    for (const f of filas) skus.add(f.sku)
  }
  let catalogo: Array<Record<string, unknown>> = []
  if (sel.modelosCatalogo?.length || sel.cliente === 'ShoesF') {
    const filas: Array<Record<string, unknown>> = []
    for (const m of sel.modelosCatalogo ?? []) {
      const { data, error } = await s
        .from('fba_catalogo')
        .select('ref, nombre, talla, ean, fnsku, asin, fbasku, cod_art, continuidad, precio')
        .eq('client_id', clienteId)
        .eq('ref', m.ref)
        .eq('nombre', m.nombre)
        .order('talla')
      if (error) throw error
      filas.push(...((data ?? []) as Array<Record<string, unknown>>))
    }
    // Las filas del catálogo de los SKU sueltos (FBA047768-45)
    const { data: sueltos, error: e3 } = await s
      .from('fba_catalogo')
      .select('ref, nombre, talla, ean, fnsku, asin, fbasku, cod_art, continuidad, precio')
      .eq('client_id', clienteId)
      .in('fbasku', sel.skus)
    if (e3) throw e3
    for (const f of (sueltos ?? []) as Array<Record<string, unknown>>) {
      if (!filas.some((x) => x.fbasku === f.fbasku)) filas.push(f)
    }
    catalogo = filas
    for (const f of filas) if (typeof f.fbasku === 'string' && f.fbasku) skus.add(f.fbasku)
  }
  const listaSkus = [...skus].sort()

  /* --- Lecturas del libro, con su primer movimiento --- */
  const { data: lecs, error: e4 } = await s
    .from('fba_lecturas')
    .select('marketplace_id, leido_hasta, ultimo_error, updated_at')
    .eq('connection_id', conexion.id)
  if (e4) throw e4
  const lecturas: LecturaFoto[] = []
  for (const l of (lecs ?? []) as Array<Omit<LecturaFoto, 'leido_desde'>>) {
    const { data: primero, error } = await s
      .from('fba_movimientos')
      .select('fecha')
      .eq('connection_id', conexion.id)
      .eq('marketplace_id', l.marketplace_id)
      .order('fecha', { ascending: true })
      .limit(1)
    if (error) throw error
    lecturas.push({ ...l, leido_desde: (primero?.[0] as { fecha: string } | undefined)?.fecha ?? null })
  }
  lecturas.sort((a, b) => a.marketplace_id.localeCompare(b.marketplace_id))

  /* --- Remesas (todas las del cliente; se recortan después) --- */
  const todasRemesas = await leerTodo<Omit<RemesaFoto, 'totales' | 'lineas'>>((a, b) =>
    s
      .from('fba_remesas')
      .select('id, nombre, estado, estado_amazon, marketplace_id, referencia_envio, fecha_envio, llegada_at, created_at, updated_at, aprobada_at, encajado_at, lista_at')
      .eq('client_id', clienteId)
      .order('created_at')
      .order('id')
      .range(a, b)
  )
  const enviadas = todasRemesas.filter((r) => (r.estado === 'enviada' || r.estado === 'cerrada') && r.fecha_envio)
  const primerEnvio = enviadas.map((r) => dia(r.fecha_envio)!).sort()[0] ?? null
  const libroDesde = sumarDias(hoy, -DIAS_LIBRO)
  const desdeNecesario = primerEnvio && primerEnvio > libroDesde ? primerEnvio : libroDesde
  const { mercado, aviso } = elegir(lecturas, desdeNecesario)

  const remesas = todasRemesas.filter((r) => (dia(r.fecha_envio) ?? dia(r.created_at)!) >= libroDesde || r.estado !== 'cerrada')
  const lineas = await enTrozos(remesas.map((r) => r.id), 100, (ids) =>
    leerTodo<{ remesa_id: string; sku: string; unidades: number; unidades_recibidas: number | null; unidades_propuestas: number | null }>((a, b) =>
      s
        .from('fba_remesa_lineas')
        .select('remesa_id, sku, unidades, unidades_recibidas, unidades_propuestas')
        .in('remesa_id', ids)
        .order('id')
        .range(a, b)
    )
  )
  const remesasFoto: RemesaFoto[] = remesas.map((r) => {
    const suyas = lineas.filter((l) => l.remesa_id === r.id)
    return {
      ...r,
      totales: {
        lineas: suyas.length,
        unidades: suyas.reduce((t, l) => t + (l.unidades ?? 0), 0),
        recibidas: suyas.reduce((t, l) => t + (l.unidades_recibidas ?? 0), 0),
      },
      lineas: suyas
        .filter((l) => skus.has(l.sku))
        .map(({ sku, unidades, unidades_recibidas, unidades_propuestas }) => ({ sku, unidades, unidades_recibidas, unidades_propuestas }))
        .sort((a, b) => a.sku.localeCompare(b.sku)),
    }
  })

  /* --- Libro agregado (lectura elegida) y ventas del año pasado --- */
  const libro: MovimientoDiarioFoto[] = []
  const anoDesde = sumarDias(hoy, -730)
  const anoHasta = sumarDias(hoy, -365 + 180)
  const ventasAno: Array<{ sku: string; fecha: string; unidades: number }> = []
  let receipts: Array<{ referencia: string; fecha: string; cantidad: number }> = []
  if (mercado && listaSkus.length > 0) {
    const crudo = await enTrozos(listaSkus, 50, (trozo) =>
      leerTodo<MovimientoDiarioFoto>((a, b) =>
        s
          .from('fba_movimientos')
          .select('sku, fecha, tipo, disposicion, cantidad')
          .eq('connection_id', conexion.id)
          .eq('marketplace_id', mercado)
          .in('sku', trozo)
          .gte('fecha', libroDesde)
          .lte('fecha', hoy)
          .order('fecha')
          .order('id')
          .range(a, b)
      )
    )
    const agregado = new Map<string, MovimientoDiarioFoto>()
    for (const m of crudo) {
      const clave = `${m.fecha}|${m.sku}|${m.tipo}|${m.disposicion ?? ''}`
      const previo = agregado.get(clave)
      if (previo) previo.cantidad += m.cantidad
      else agregado.set(clave, { sku: m.sku, fecha: m.fecha, tipo: m.tipo, disposicion: m.disposicion ?? null, cantidad: m.cantidad })
    }
    libro.push(...agregado.values())
    libro.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.sku.localeCompare(b.sku) || a.tipo.localeCompare(b.tipo) || (a.disposicion ?? '').localeCompare(b.disposicion ?? ''))

    const ventas = await enTrozos(listaSkus, 50, (trozo) =>
      leerTodo<{ sku: string; fecha: string; cantidad: number }>((a, b) =>
        s
          .from('fba_movimientos')
          .select('sku, fecha, cantidad')
          .eq('connection_id', conexion.id)
          .eq('marketplace_id', mercado)
          .eq('tipo', 'Shipments')
          .in('sku', trozo)
          .gte('fecha', anoDesde)
          .lt('fecha', anoHasta)
          .order('fecha')
          .order('id')
          .range(a, b)
      )
    )
    const porDia = new Map<string, { sku: string; fecha: string; unidades: number }>()
    for (const v of ventas) {
      const clave = `${v.fecha}|${v.sku}`
      const previo = porDia.get(clave)
      if (previo) previo.unidades += Math.abs(v.cantidad)
      else porDia.set(clave, { sku: v.sku, fecha: v.fecha, unidades: Math.abs(v.cantidad) })
    }
    ventasAno.push(...[...porDia.values()].filter((v) => v.unidades > 0).sort((a, b) => a.fecha.localeCompare(b.fecha) || a.sku.localeCompare(b.sku)))

    const referencias = [...new Set(remesas.map((r) => r.referencia_envio).filter((r): r is string => !!r))]
    const filasReceipts = await enTrozos(referencias, 50, (trozo) =>
      leerTodo<{ referencia: string; fecha: string; cantidad: number }>((a, b) =>
        s
          .from('fba_movimientos')
          .select('referencia, fecha, cantidad')
          .eq('connection_id', conexion.id)
          .eq('marketplace_id', mercado)
          .eq('tipo', 'Receipts')
          .in('referencia', trozo)
          .order('fecha')
          .order('id')
          .range(a, b)
      )
    )
    const porRef = new Map<string, { referencia: string; fecha: string; cantidad: number }>()
    for (const r of filasReceipts) {
      const clave = `${r.referencia}|${r.fecha}`
      const previo = porRef.get(clave)
      if (previo) previo.cantidad += r.cantidad
      else porRef.set(clave, { referencia: r.referencia, fecha: r.fecha, cantidad: r.cantidad })
    }
    receipts = [...porRef.values()].sort((a, b) => a.referencia.localeCompare(b.referencia) || a.fecha.localeCompare(b.fecha))
  }

  /* --- Listings de todos los mercados --- */
  const listings = (
    await enTrozos(listaSkus, 100, (trozo) =>
      leerTodo<ListingFoto>((a, b) =>
        s
          .from('amazon_listings')
          .select('marketplace_id, sku, asin, fnsku, title, listing_status, price, currency, fba_quantity, fba_fulfillable_quantity, fba_inbound_quantity, fba_reserved_quantity, fba_unfulfillable_quantity, activo_manual, is_fba, updated_at')
          .eq('connection_id', conexion.id)
          .in('sku', trozo)
          .order('id')
          .range(a, b)
      )
    )
  )
    .map((l) => ({ ...l, title: l.title ? l.title.slice(0, TITULO_MAX) : null }))
    .sort((a, b) => a.sku.localeCompare(b.sku) || a.marketplace_id.localeCompare(b.marketplace_id))

  /* --- Plazos --- */
  const { data: config, error: e5 } = await s.from('fba_alertas_config').select('*').eq('client_id', clienteId).maybeSingle()
  if (e5) throw e5
  const { data: plazos, error: e6 } = await s.from('fba_alertas_plazo_sku').select('*').eq('client_id', clienteId).order('sku')
  if (e6) throw e6
  const sinQuien = (f: Record<string, unknown>) => {
    const { actualizado_por: _q, client_id: _c, ...resto } = f
    return resto
  }

  return {
    nombre: sel.cliente,
    clienteId,
    conexion: {
      id: conexion.id,
      region: conexion.region,
      marketplace_ids: conexion.marketplace_ids ?? [],
      default_marketplace_id: conexion.default_marketplace_id,
      is_active: conexion.is_active,
      status: conexion.status,
    },
    skus: listaSkus,
    lecturas,
    primerEnvio,
    desdeNecesario,
    lecturaElegida: mercado,
    avisoLectura: aviso,
    libro,
    ventasAnoPasado: { desde: anoDesde, hasta: anoHasta, filas: ventasAno },
    listings,
    remesas: remesasFoto,
    receipts,
    alertasConfig: config ? sinQuien(config as Record<string, unknown>) : null,
    plazosSku: ((plazos ?? []) as Array<Record<string, unknown>>).map(sinQuien),
    catalogo,
  }
}

/* ------------------------------ JSON legible y compacto ------------------------------ */

/** Las listas de filas planas van una fila por línea: se lee en un diff y pesa la mitad que con sangría */
function serializar(valor: unknown, sangria = ''): string {
  const plano = (v: unknown) => v === null || typeof v !== 'object' || (Array.isArray(v) && v.every((x) => x === null || typeof x !== 'object'))
  if (Array.isArray(valor)) {
    if (valor.length === 0) return '[]'
    if (valor.every(plano)) return JSON.stringify(valor)
    const dentro = sangria + '  '
    const filaPlana = (v: unknown) => v !== null && typeof v === 'object' && !Array.isArray(v) && Object.values(v).every(plano)
    return `[\n${valor.map((v) => dentro + (filaPlana(v) ? JSON.stringify(v) : serializar(v, dentro))).join(',\n')}\n${sangria}]`
  }
  if (valor !== null && typeof valor === 'object') {
    const entradas = Object.entries(valor)
    if (entradas.length === 0) return '{}'
    const dentro = sangria + '  '
    return `{\n${entradas.map(([k, v]) => `${dentro}${JSON.stringify(k)}: ${serializar(v, dentro)}`).join(',\n')}\n${sangria}}`
  }
  return JSON.stringify(valor)
}

/* ------------------------------ Principal ------------------------------ */

async function principal() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const clave = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !clave) throw new Error('Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local')
  const s = crearServicio(url, clave)

  const hoy = argumento('hoy') ?? diaEnEspana()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(hoy)) throw new Error(`--hoy tiene que ser YYYY-MM-DD («${hoy}»)`)
  const salida = resolve(argumento('salida') ?? 'lib/fba/__fixtures__/plan-real.json')

  const clientes: ClienteFoto[] = []
  for (const sel of SELECCION) {
    const c = await fotoDeCliente(s, sel, hoy)
    console.log(
      `${c.nombre.padEnd(14)} ${String(c.skus.length).padStart(3)} SKU · libro ${c.lecturaElegida ?? '—'} ${String(c.libro.length).padStart(5)} filas · ` +
        `año pasado ${String(c.ventasAnoPasado.filas.length).padStart(4)} · listings ${String(c.listings.length).padStart(3)} · remesas ${String(c.remesas.length).padStart(3)} · receipts ${c.receipts.length}` +
        (c.avisoLectura ? ` · ${c.avisoLectura}` : '')
    )
    clientes.push(c)
  }

  const foto: FotoPlanReal = {
    version: 1,
    hoy,
    generadaAt: new Date().toISOString(),
    libroDesde: sumarDias(hoy, -DIAS_LIBRO),
    nota: 'Foto de producción (solo lectura) generada con scripts/fba-foto-pruebas.ts. No editar a mano: se regenera.',
    clientes,
  }
  const texto = serializar(foto) + '\n'
  mkdirSync(dirname(salida), { recursive: true })
  writeFileSync(salida, texto)
  const kb = Buffer.byteLength(texto) / 1024
  console.log(`\n${salida} · ${kb.toFixed(0)} KB`)
  if (kb >= 1024) {
    console.error('La foto pesa 1 MB o más: recorta algo antes de commitearla')
    process.exit(1)
  }
}

principal().catch((e) => {
  console.error(e)
  process.exit(1)
})
