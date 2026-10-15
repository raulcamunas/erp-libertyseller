import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ListingConIncidencias } from '@/lib/amazon/sp-api'
import { construirFilas, type MetaListing } from '@/lib/cumplimiento/filas'
import { clave } from '@/lib/cumplimiento/pendientes'
import { TEMAS, type Incidencia } from '@/lib/cumplimiento/tipos'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/**
 * Las respuestas están escritas a mano a partir del modelo documentado de la API de
 * listados; no son capturas de ninguna cuenta (no hay credenciales de Amazon aquí).
 * Lo que sí se comprueba contra algo REAL es que cada columna que escribe el código
 * existe en el SQL de la migración 227.
 */
const AHORA = new Date('2026-10-15T10:00:00Z')
const ES = 'A1RKKUPIHCS9HS'
const meta = (extra: Record<string, Partial<MetaListing>> = {}) =>
  new Map<string, MetaListing>(
    ['LIMPIO', 'ERROR', 'OCULTO', 'AVISO', 'SINCAMPO', 'AUSENTE', 'ANTIGUO'].map((sku) => [
      clave(ES, sku),
      { conStock: sku === 'OCULTO', esPadre: sku === 'AUSENTE', id: null, abierto: false, ...(extra[sku] ?? {}) },
    ])
  )
const item = (sku: string, extra: Partial<ListingConIncidencias> = {}): ListingConIncidencias => ({
  sku,
  asin: `B0${sku.padEnd(8, '0').slice(0, 8)}`,
  titulo: `Producto ${sku}`,
  estado: ['DISCOVERABLE'],
  productType: 'SHOES',
  incidencias: [],
  ...extra,
})

const errorFabricante = {
  code: '90220',
  message: 'Falta el atributo «Fabricante».',
  severity: 'ERROR',
  attributeNames: ['manufacturer'],
  categories: ['MISSING_ATTRIBUTE'],
}
const ocultoPorGtin = {
  code: '8541',
  message: 'El GTIN no es válido.',
  severity: 'ERROR',
  attributeNames: ['externally_assigned_product_identifier'],
  categories: ['INVALID_ATTRIBUTE'],
  enforcements: { actions: [{ action: 'SEARCH_SUPPRESSED' }], exemption: { status: 'NOT_EXEMPT' } },
}
const soloAviso = { code: '5461', message: 'La imagen podría mejorar.', severity: 'WARNING', categories: ['INVALID_IMAGE'] }

console.log('\n=== de la respuesta de Amazon a las filas ===')
const r = construirFilas({
  connectionId: 'conn-1',
  mercado: ES,
  items: [
    item('LIMPIO', { estado: ['BUYABLE', 'DISCOVERABLE'] }),
    item('ERROR', { incidencias: [errorFabricante] }),
    item('OCULTO', { estado: [], incidencias: [soloAviso, ocultoPorGtin, errorFabricante] }),
    item('AVISO', { incidencias: [soloAviso] }),
    item('SINCAMPO', { incidencias: undefined }),
    item('NOPEDIDO'),
  ],
  noVinieron: ['AUSENTE'],
  meta: meta(),
  previas: new Map(),
  ahora: AHORA,
})
const por = (sku: string) => r.devueltos.find((f) => f.sku === sku)!

ok('una fila por listing devuelto que se había pedido', r.devueltos.length === 5, String(r.devueltos.length))
ok('un SKU que Amazon devuelve sin que se pidiera no genera fila', !r.devueltos.some((f) => f.sku === 'NOPEDIDO'))
ok('limpio: sin errores ni avisos ni tema', por('LIMPIO').errores === 0 && por('LIMPIO').avisos === 0 && por('LIMPIO').tema === null)
ok('limpio: desde nulo', por('LIMPIO').desde === null)
ok('limpio conserva su estado', JSON.stringify(por('LIMPIO').estado) === '["BUYABLE","DISCOVERABLE"]')
ok('con error: 1 error, tema datos', por('ERROR').errores === 1 && por('ERROR').tema === 'datos')
ok('con error: no está oculto', por('ERROR').suprimido === false)
ok('oculto: suprimido', por('OCULTO').suprimido === true)
ok('oculto: 2 errores y 1 aviso', por('OCULTO').errores === 2 && por('OCULTO').avisos === 1)
ok('oculto: el tema lo pone la incidencia que oculta', por('OCULTO').tema === 'identificadores', String(por('OCULTO').tema))
ok('oculto: sin estado de Amazon', JSON.stringify(por('OCULTO').estado) === '[]')
ok('oculto: con stock, del catálogo del ERP', por('OCULTO').con_stock === true)
ok('oculto: las incidencias van de la más grave a la menos', (por('OCULTO').incidencias as Incidencia[]).map((i) => i.codigo).join() === '8541,90220,5461')
ok('oculto: todas llevan fecha de hoy', (por('OCULTO').incidencias as Incidencia[]).every((i) => i.desde === AHORA.toISOString()))
ok('solo aviso: 0 errores y 1 aviso', por('AVISO').errores === 0 && por('AVISO').avisos === 1)
ok('sin el campo de incidencias se trata como limpio y se cuenta', por('SINCAMPO').errores === 0 && r.sinCampo === 1, String(r.sinCampo))
ok('todas llevan la conexión, el país y la hora', r.devueltos.every((f) => f.connection_id === 'conn-1' && f.marketplace_id === ES && f.revisado_at === AHORA.toISOString()))
ok('todas están en Amazon', r.devueltos.every((f) => f.en_amazon === true))

console.log('\n=== los que Amazon no devuelve ===')
ok('una fila para el ausente', r.ausentes.length === 1 && r.ausentes[0].sku === 'AUSENTE')
ok('fuera de Amazon', r.ausentes[0].en_amazon === false)
ok('ni limpio ni con problemas: todo a cero', r.ausentes[0].errores === 0 && r.ausentes[0].avisos === 0 && r.ausentes[0].suprimido === false && r.ausentes[0].tema === null)
ok('NO lleva asin ni título (no se pisa lo que se supo)', !('asin' in r.ausentes[0]) && !('titulo' in r.ausentes[0]))
ok('conserva si es padre', r.ausentes[0].es_padre === true)

console.log('\n=== el «desde cuándo» entre dos revisiones ===')
{
  const previa: Incidencia = {
    codigo: '8541',
    gravedad: 'error',
    mensaje: 'El GTIN no es válido.',
    atributos: ['externally_assigned_product_identifier'],
    categorias: ['INVALID_ATTRIBUTE'],
    acciones: ['SEARCH_SUPPRESSED'],
    exencion: null,
    tema: 'identificadores',
    desde: '2026-08-20T06:00:00.000Z',
  }
  const r2 = construirFilas({
    connectionId: 'conn-1',
    mercado: ES,
    items: [item('ANTIGUO', { estado: [], incidencias: [ocultoPorGtin, errorFabricante] })],
    noVinieron: [],
    meta: meta({ ANTIGUO: { abierto: true, id: 'abc' } }),
    previas: new Map([['ANTIGUO', [previa]]]),
    ahora: AHORA,
  })
  const f = r2.devueltos[0]
  const incs = f.incidencias as Incidencia[]
  ok('la que ya estaba conserva su fecha', incs.find((i) => i.codigo === '8541')?.desde === '2026-08-20T06:00:00.000Z')
  ok('la nueva lleva la de hoy', incs.find((i) => i.codigo === '90220')?.desde === AHORA.toISOString())
  ok('el listing lleva la más antigua', f.desde === '2026-08-20T06:00:00.000Z', String(f.desde))

  const arreglado = construirFilas({
    connectionId: 'conn-1',
    mercado: ES,
    items: [item('ANTIGUO', { estado: ['BUYABLE', 'DISCOVERABLE'], incidencias: [] })],
    noVinieron: [],
    meta: meta({ ANTIGUO: { abierto: true, id: 'abc' } }),
    previas: new Map([['ANTIGUO', [previa]]]),
    ahora: AHORA,
  }).devueltos[0]
  ok('arreglado: queda limpio', arreglado.errores === 0 && arreglado.suprimido === false && arreglado.tema === null && arreglado.desde === null)
  ok('arreglado: sin incidencias', (arreglado.incidencias as Incidencia[]).length === 0)
}

console.log('\n=== cada columna que se escribe existe en la migración 227 ===')
{
  const sql = readFileSync(join(__dirname, '../../supabase/migrations/227_cumplimiento_listings.sql'), 'utf8')
  const bloque = sql.slice(sql.indexOf('CREATE TABLE IF NOT EXISTS public.listing_cumplimiento'))
  const cuerpo = bloque.slice(bloque.indexOf('(') + 1, bloque.indexOf('\n);'))
  const columnas = new Set(
    cuerpo
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => /^[a-z_]+\s+[A-Z]/.test(l))
      .map((l) => l.split(/\s+/)[0])
  )
  ok('el SQL declara columnas', columnas.size >= 18, [...columnas].join(','))
  const usadas = new Set([...r.devueltos, ...r.ausentes].flatMap((f) => Object.keys(f)))
  const sobran = [...usadas].filter((k) => !columnas.has(k))
  ok('no se escribe ninguna columna que no exista', sobran.length === 0, sobran.join(','))
  const obligatorias = ['connection_id', 'marketplace_id', 'sku']
  ok('las tres de la clave van siempre', obligatorias.every((k) => [...r.devueltos, ...r.ausentes].every((f) => k in f)))
  ok('el CHECK de temas coincide con TEMAS', TEMAS.every((t) => sql.includes(`'${t}'`)) && (sql.match(/'(normativa|peligrosas|aprobacion|marca|identificadores|imagenes|precio|duplicado|datos|otros)'/g) ?? []).length === TEMAS.length)
  ok('la restricción única es la del upsert', sql.includes('UNIQUE (connection_id, marketplace_id, sku)'))
  ok('el onConflict del código coincide con ella', readFileSync(join(__dirname, 'revisar.ts'), 'utf8').includes("onConflict: 'connection_id,marketplace_id,sku'"))
}

console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
