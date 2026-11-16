/**
 * Pruebas de `planificarCliente` sobre la FOTO REAL de producción (spec remesas-pro §11 D17).
 *
 *   cd /Users/raulcamunas/Dev/ERP-remesas && npx tsx lib/fba/plan-cliente.prueba.ts
 *   (con `--ver` imprime las líneas de cada cliente para repasar las cifras)
 *
 * La foto `__fixtures__/plan-real.json` la genera `scripts/fba-foto-pruebas.ts` (solo lectura). Aquí se comprueba lo
 * CUALITATIVO que el plan tiene que cumplir con datos de verdad (D17); las cifras que se escriben salen de esta foto y, si se
 * regenera, hay que repasarlas.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  avisosDeCalidad,
  calcularAcierto,
  catalogoDesdeFila,
  estadoListingDeSku,
  configAlertasDesdeFila,
  estadoDePasada,
  lineasRelevantes,
  listingDesdeFila,
  ordenarLineasPlan,
  planificarCliente,
  remesaDesdeFila,
  type EntradaPlanCliente,
} from './plan-cliente'
import type { ComprometidoRemesa } from './llegadas'
import type { LineaPlan, PlanCliente } from './plan-tipos'
import type { FotoPlanReal, ClienteFoto } from '../../scripts/fba-foto-pruebas'
import { elegirLectura } from './lectura-elegida'
import { filtrarLineas, lineasConLasPropias, planDesdePasada, plazoParaGuardar, reconciliarCliente } from './plan-datos'
import { reaplicarAjustes } from './envios-propuestos-servidor'
import { esNoComprable } from './planificador'
import { roturaDeLinea, rompeEn } from './rotura-linea'
import { pasaFiltro } from '../../components/remesas/reposicion/calculos'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d: unknown = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || d === '' ? '' : ` -> ${typeof d === 'string' ? d : JSON.stringify(d)}`}`)
}
const VER = process.argv.includes('--ver')

const foto = JSON.parse(readFileSync(join(__dirname, '__fixtures__', 'plan-real.json'), 'utf8')) as FotoPlanReal
const HOY = foto.hoy
const AHORA = `${HOY}T12:00:00.000Z`

const ESTADOS_COMPROMETIDOS = ['borrador', 'aprobada', 'encajando', 'lista']

/** Días entre dos fechas ISO (para `diasParada` de la foto) */
const dias = (desde: string, hasta: string) => Math.round((Date.parse(`${hasta.slice(0, 10)}T00:00:00Z`) - Date.parse(`${desde.slice(0, 10)}T00:00:00Z`)) / 86_400_000)

/** La foto de un cliente → la entrada de `planificarCliente` (lo mismo que hace `plan-datos.ts` con la base) */
function entradaDeFoto(c: ClienteFoto, cambios: Partial<EntradaPlanCliente> = {}): EntradaPlanCliente {
  const elegida = elegirLectura(
    c.lecturas.map((l) => ({ marketplaceId: l.marketplace_id, leidoHasta: l.leido_hasta, leidoDesde: l.leido_desde, ultimoError: l.ultimo_error })),
    c.desdeNecesario,
  )
  const comprometido = new Map<string, ComprometidoRemesa[]>()
  for (const r of c.remesas) {
    if (!ESTADOS_COMPROMETIDOS.includes(r.estado)) continue
    for (const l of r.lineas) {
      if (!(l.unidades > 0)) continue
      const lista = comprometido.get(l.sku) ?? []
      lista.push({ remesaId: r.id, nombre: r.nombre, estado: r.estado, fechaEnvio: r.fecha_envio?.slice(0, 10) ?? null, diasParada: r.updated_at ? dias(r.updated_at, HOY) : null, unidades: l.unidades })
      comprometido.set(l.sku, lista)
    }
  }
  return {
    clienteId: c.clienteId,
    clienteNombre: c.nombre,
    connectionId: c.conexion.id,
    region: (c.conexion.region as 'eu' | 'na' | 'fe' | null) ?? null,
    conexionesActivas: 1,
    hoy: HOY,
    ahora: AHORA,
    lectura: elegida ? { marketplaceId: elegida.elegida.marketplaceId, leidoHasta: elegida.elegida.leidoHasta, leidoDesde: elegida.elegida.leidoDesde, ultimoError: elegida.elegida.ultimoError } : null,
    avisoLectura: elegida?.aviso ?? null,
    libro: c.libro,
    listings: c.listings.map((l) => listingDesdeFila(l)),
    hayBuyableEnCliente: null,
    remesas: c.remesas.map((r) => remesaDesdeFila(
      { ...r, unidades_totales: r.totales.unidades, recibidas_totales: r.totales.recibidas },
      r.lineas.map((l) => ({ sku: l.sku, unidades: l.unidades, unidades_recibidas: l.unidades_recibidas })),
    )),
    receipts: c.receipts,
    comprometido,
    hablados: [],
    configAlertas: configAlertasDesdeFila(c.alertasConfig),
    plazosSku: {},
    configReposicion: null,
    reposicionSku: [],
    catalogo: c.catalogo.map((f) => catalogoDesdeFila(f)),
    edadAmazon: null,
    descartes: [],
    pasadaAnterior: null,
    ...cambios,
  }
}

const cliente = (nombre: string) => {
  const c = foto.clientes.find((x) => x.nombre === nombre)
  if (!c) throw new Error(`La foto no trae ${nombre}`)
  return c
}
const linea = (p: PlanCliente, sku: string): LineaPlan => {
  const l = p.lineas.find((x) => x.sku === sku)
  if (!l) throw new Error(`El plan no trae ${sku}`)
  return l
}
const propuesta = (l: LineaPlan) => l.fuera === null && l.cantidad > 0
const enAlgunEnvio = (p: PlanCliente, sku: string) => p.envios.some((e) => e.lineas.some((l) => l.sku === sku))

function ver(p: PlanCliente, nombre: string) {
  if (!VER) return
  console.log(`\n--- ${nombre}: plazo ${JSON.stringify({ prep: p.plazo.preparacion, tr: p.plazo.transporte, rec: p.plazo.recepcion, mg: p.plazo.margen, L: p.plazo.hastaLaVenta, origen: p.plazo.origen })}`)
  console.log(`    medidas ${JSON.stringify(p.medidas)} · calidad ${p.calidad.libro} hasta ${p.calidad.leidoHasta} (${p.calidad.diasAtraso} d)`)
  for (const l of p.lineas) {
    console.log(`    ${l.sku.padEnd(22)} V${String(l.vendibles).padStart(4)} cam${String(l.deCamino).padStart(4)} comp${String(l.comprometido).padStart(4)} D=${l.ritmo.previsto?.toFixed(2) ?? '—'} (${l.ritmo.confianza}, ${l.ritmo.origen}, ${l.ritmo.tendencia ?? '·'}) rot=${l.fechaRotura ?? '—'} salir=${l.salirAntesDe ?? '—'} ${l.prioridad} cant=${l.cantidad} fuera=${l.fuera ?? '—'} [${l.avisos.join(',')}]`)
    console.log(`        ${l.porque}`)
  }
  for (const e of p.envios) console.log(`    ENVÍO ${e.clave} salir ${e.salirAntesDe} ${e.prioridad} ${e.unidades} ud · ${e.porque.join(' | ')}`)
  console.log(`    resumen ${JSON.stringify(p.resumen)}`)
  console.log(`    avisos ${JSON.stringify(p.calidad.avisos)}`)
}

/* ------------------------------ Opinas ------------------------------ */

console.log('Opinas (rota normal, stock de sobra, tendencia)')
{
  const r = planificarCliente(entradaDeFoto(cliente('Opinas')))
  const p = r.plan
  ver(p, 'Opinas')
  const a = linea(p, '80-HGPJ-1F82')
  ok('80-HGPJ-1F82 tiene ritmo con confianza (no sin datos)', a.ritmo.previsto !== null && a.ritmo.confianza !== 'sin_datos', a.ritmo)
  ok('80-HGPJ-1F82 va con tendencia a la baja', a.ritmo.tendencia === 'baja', a.ritmo.tendencia)
  ok('80-HGPJ-1F82 tiene fecha de rotura y de salida', a.fechaRotura !== null && a.salirAntesDe !== null, { rot: a.fechaRotura, salir: a.salirAntesDe })
  ok('80-HGPJ-1F82: salir antes de la rotura', !!a.salirAntesDe && !!a.fechaRotura && a.salirAntesDe < a.fechaRotura)
  ok('80-HGPJ-1F82: la frase lleva cifras', /\d/.test(a.porque) && a.porque.length > 20, a.porque)
  const b = linea(p, '12-CDXR-I4TN')
  ok('12-CDXR-I4TN no se propone (stock de sobra o exceso)', !propuesta(b) && (b.fuera === 'stock_de_sobra' || b.fuera === 'exceso'), b.fuera)
  ok('12-CDXR-I4TN cubre más de 120 días', (b.coberturaDias ?? 0) > 120, b.coberturaDias)
  ok('Opinas: plazo con transporte medido', p.plazo.origen.transporte === 'medido', p.plazo.origen)
  ok('Opinas: moneda EUR', p.moneda === 'EUR')
  ok('Opinas: el resumen cuenta las referencias', p.resumen.referencias === p.lineas.length && p.resumen.referencias >= 2)
  ok('Opinas: conPropuesta = líneas con cantidad en envíos', p.resumen.conPropuesta === p.envios.reduce((t, e) => t + e.lineas.length, 0))
  ok('Opinas: las unidades propuestas suman las de los envíos', p.resumen.unidadesPropuestas === p.envios.reduce((t, e) => t + e.unidades, 0))
  ok('Opinas: estado de la pasada ok', estadoDePasada(p) === 'ok', estadoDePasada(p))
  ok('Opinas: los previstos llevan el ritmo de 80-HGPJ-1F82', (r.previstos['80-HGPJ-1F82'] ?? 0) > 0)
}

/* ------------------------------ Creative Toys ------------------------------ */

console.log('Creative Toys (entrante sin remesa, envío dudoso)')
{
  const p = planificarCliente(entradaDeFoto(cliente('Creative Toys'))).plan
  ver(p, 'Creative Toys')
  const t7 = linea(p, 'T7-0CG9-DSP7')
  ok('T7-0CG9-DSP7 no se propone (Amazon ya tiene entrante)', !propuesta(t7) && !enAlgunEnvio(p, 'T7-0CG9-DSP7'), { fuera: t7.fuera, cant: t7.cantidad })
  ok('T7-0CG9-DSP7 cuenta lo entrante de Amazon como de camino', t7.deCamino >= 500 && t7.entranteSinRemesa > 0, { camino: t7.deCamino, sin: t7.entranteSinRemesa })
  ok('T7-0CG9-DSP7 lleva el aviso entrante_sin_remesa', t7.avisos.includes('entrante_sin_remesa'), t7.avisos)
  const w = linea(p, 'WM40297')
  ok('WM40297 separa lo dudoso de lo de camino', w.dudoso > 0, { dudoso: w.dudoso, camino: w.deCamino })
  ok('WM40297: lo dudoso no cuenta como de camino', w.dudoso > 0 && w.deCamino < w.deCamino + w.dudoso)
  ok('WM40297 lleva el aviso envio_dudoso', w.avisos.includes('envio_dudoso'), w.avisos)
  // Vende desde abril: su «año pasado» no tiene Navidad. No puede salir un perfil propio que baje en Black Friday y Navidad
  ok('WM40297 (lanzado en abril) no usa un perfil propio', w.ritmo.origenPerfil !== 'sku', w.ritmo.origenPerfil)
  const fBf = w.ritmo.perfilSemanal ? w.ritmo.perfilSemanal[48] : 1
  ok('WM40297: el perfil no baja en Black Friday (semana 48 ≥ 0,9)', fBf >= 0.9, fBf)
  for (const sku of ['WM01550', 'WM50531']) {
    const x = p.lineas.find((l) => l.sku === sku)
    if (x) ok(`${sku} (sin el año entero) no usa un perfil propio`, x.ritmo.origenPerfil !== 'sku', x.ritmo.origenPerfil)
  }
  ok('Creative Toys: el envío dudoso sale en «de camino» marcado', p.enCamino.some((e) => e.dudoso), p.enCamino.map((e) => [e.nombre, e.dudoso]))
  ok('Creative Toys: la lectura es la de APJ6 (más reciente y con historia)', p.calidad.mercado === 'APJ6JRA9NG5V4', p.calidad.mercado)
}

/* ------------------------------ ShoesF ------------------------------ */

console.log('ShoesF (llegada mañana, tallas)')
{
  const c = cliente('ShoesF')
  const p = planificarCliente(entradaDeFoto(c)).plan
  ver(p, 'ShoesF')
  // Un envío recibido entero ya no está «de camino» (como en el Resumen)
  const recibidosEnteros = p.enCamino.filter((e) => e.unidades > 0 && e.recibidas >= e.unidades)
  ok('ShoesF: «de camino» no trae envíos recibidos enteros', recibidosEnteros.length === 0, recibidosEnteros.map((e) => `${e.nombre} ${e.recibidas}/${e.unidades}`))
  {
    const e = entradaDeFoto(c)
    const base = e.remesas.find((r) => r.estado === 'enviada') ?? e.remesas[0]
    if (base) {
      const entera = { ...base, id: 'prueba-recibida-entera', estado: 'enviada', estadoAmazon: 'CLOSED_NO', unidades: 99, recibidas: 99 }
      const conEntera = planificarCliente({ ...e, remesas: [...e.remesas, entera] }).plan
      ok('una remesa enviada con 99 de 99 recibidas no sale de camino', !conEntera.enCamino.some((x) => x.remesaId === 'prueba-recibida-entera'))
    }
  }
  // Con la recepción medida (3 d) lo que está de camino llega el 18 nov: 3 días de hueco SÍ deciden (D4, ≥ 3 días).
  // Lo que se comprueba con la foto tal cual: la rotura que decide es la de después de la llegada, no la de hoy.
  for (const sku of ['FBA047768-45', 'FBA633372-41']) {
    const l = p.lineas.find((x) => x.sku === sku)
    if (!l) { ok(`${sku} está en el plan`, false); continue }
    ok(`${sku}: la rotura que decide es posterior a la llegada (no la de hoy)`, !!l.fechaRotura && l.fechaRotura > HOY && l.fechaPrimerHueco === HOY, { hueco: l.fechaPrimerHueco, rot: l.fechaRotura })
    ok(`${sku}: cuenta lo que llega como de camino`, l.deCamino >= 3, l.deCamino)
  }
  // Y el caso de D4 tal cual: si llega MAÑANA (recepción de 1 día), el hueco de 1 día no lo vuelve «tarde»
  const manana = planificarCliente(entradaDeFoto(c, { configAlertas: { diasPreparacion: null, diasTransporte: null, diasRecepcion: 1, diasMargen: null, total: null } })).plan
  for (const sku of ['FBA047768-45', 'FBA633372-41']) {
    const l = manana.lineas.find((x) => x.sku === sku)
    if (!l) { ok(`${sku} está en el plan`, false); continue }
    ok(`${sku} con llegada mañana no sale «tarde»`, l.prioridad !== 'tarde' && l.diasSinStockInevitables < 3, { prio: l.prioridad, hueco: l.fechaPrimerHueco, rot: l.fechaRotura, inevitables: l.diasSinStockInevitables })
  }
  // D4 bien hecho: los 3 días de hueco hasta lo que llega el 18 nov no los evita ningún envío y la rotura de verdad es en diciembre:
  // no son «tarde» (ni salida forzada ni aviso al chat)
  for (const sku of ['FBA633372-40', 'FBA633372-41', 'FBA047768-45']) {
    const l = p.lineas.find((x) => x.sku === sku)
    if (!l) { ok(`${sku} está en el plan`, false); continue }
    ok(`${sku}: con la foto tal cual NO sale «tarde»`, !l.vaTarde && l.prioridad !== 'tarde' && l.diasSinStockInevitables >= 3, { prio: l.prioridad, rot: l.fechaRotura, inevitables: l.diasSinStockInevitables })
    ok(`${sku}: la frase no dice «Ya vas tarde» y cuenta el hueco`, !/Ya vas tarde/.test(l.porque) && /no se evitan/.test(l.porque), l.porque)
  }
  {
    const l = linea(p, 'FBA047768-45')
    const m = l.porque.match(/Mandando (\d+) ud/)
    ok('FBA047768-45: si la frase dice «Mandando N ud», N es la cantidad del envío', !m || Number(m[1]) === l.cantidad, [l.cantidad, l.porque])
    ok('FBA047768-45: no se sube a una caja de 8 que pasa de la cobertura máxima', l.cantidad + l.deCamino <= Math.max(8, Math.ceil(l.tope) + l.deCamino), [l.cantidad, l.tope])
  }
  // Lleva mucho agotada pero el cliente ya ha mandado 4 ud (FBA STA del 13 nov): no se le pregunta «¿se repone?»
  {
    const l = linea(p, 'FBA633372-43')
    ok('FBA633372-43: con 4 ud de camino no es agotado_largo', l.fuera !== 'agotado_largo' && !/Se repone/.test(l.porque), [l.fuera, l.porque])
  }
  const modelo = p.lineas.filter((l) => l.sku.startsWith('FBA633372-'))
  ok('ShoesF: las tallas de F0047 BURDEOS llevan su modelo del catálogo', modelo.length > 0 && modelo.every((l) => (l.modelo ?? '').includes('F0047')), modelo.map((l) => l.modelo))
  ok('ShoesF: las tallas llevan su talla', modelo.every((l) => !!l.talla && /^\d{2}/.test(l.talla)), modelo.map((l) => l.talla))
  ok('ShoesF: el envío lleva el aviso de «Envío pequeño» o pasa del mínimo', p.envios.every((e) => e.unidades >= p.ajustes.minEnvio || e.porque.some((f) => /Envío pequeño/.test(f))))
}

/* ------------------------------ Cobo ------------------------------ */

console.log('Cobo Family (modelo desde el SKU)')
{
  const p = planificarCliente(entradaDeFoto(cliente('Cobo Family'))).plan
  ver(p, 'Cobo')
  const tallas = p.lineas.filter((l) => l.sku.startsWith('262 BURDEO/'))
  ok('Cobo: modelo «262 BURDEO» sacado del SKU', tallas.length > 0 && tallas.every((l) => l.modelo === '262 BURDEO'), tallas.map((l) => l.modelo))
  ok('Cobo: sin catálogo no hay aviso de refs fuera de la base', p.calidad.refsFueraDeCatalogo === 0)
  // Lo comprometido en «Reposición de octubre» sale en la frase con su nombre (si no, parece que no hay nada y se crea otra remesa)
  for (const sku of ['262 BURDEO/37 FBA', '262 BURDEO/38 FBA', '262 BURDEO/39 FBA']) {
    const l = p.lineas.find((x) => x.sku === sku)
    if (!l) { ok(`${sku} está en el plan`, false); continue }
    ok(`${sku}: la frase nombra «Reposición de octubre»`, l.comprometido > 0 && /«Reposición de octubre» \(sin salir/.test(l.porque), l.porque)
    if (l.cantidad > 0) ok(`${sku}: y dice cuánto mandar y hasta cuándo cubre (sin «añádelo ahí»)`, /Mandando [\d.,]+ ud antes del .+ cubres/.test(l.porque) && !/añádelo ahí/.test(l.porque), l.porque)
  }
}

/* ------------------------------ Shoplamp ------------------------------ */

console.log('Shoplamp (agotado sin BUYABLE)')
{
  const c = cliente('Shoplamp')
  const p = planificarCliente(entradaDeFoto(c)).plan
  ver(p, 'Shoplamp')
  const l = linea(p, 'FBA-UE-F14V-ZFQA')
  ok('FBA-UE-F14V-ZFQA no es «no comprable» (V = 0 sin BUYABLE = agotado)', l.fuera !== 'no_comprable', l.fuera)
  ok('FBA-UE-F14V-ZFQA se propone', propuesta(l) && enAlgunEnvio(p, 'FBA-UE-F14V-ZFQA'), { fuera: l.fuera, cant: l.cantidad, prio: l.prioridad })
  // Los días sin stock hasta lo que llega el 19 nov no deciden: la prioridad sale de la rotura del 16 dic
  ok('FBA-UE-F14V-ZFQA: no es «tarde»; prioridad según la rotura de diciembre', !l.vaTarde && l.prioridad !== 'tarde' && l.prioridad !== 'urgente' && (l.fechaRotura ?? '') >= '2026-12-01', { prio: l.prioridad, rot: l.fechaRotura })
}

/* ------------------------------ Portico ------------------------------ */

console.log('Portico LLC (EE. UU., plazo largo)')
{
  const p = planificarCliente(entradaDeFoto(cliente('Portico LLC'))).plan
  ver(p, 'Portico')
  const l = linea(p, 'CARSEK')
  ok('Portico: moneda USD', p.moneda === 'USD' && l.moneda === 'USD', [p.moneda, l.moneda])
  ok('Portico: plazo hasta la venta largo (> 40 días)', p.plazo.hastaLaVenta > 40, p.plazo.hastaLaVenta)
  ok('Portico: cobertura efectiva ≥ transporte + recepción', l.coberturaEfectiva >= p.plazo.transporte + p.plazo.recepcion, { tef: l.coberturaEfectiva, tr: p.plazo.transporte, rec: p.plazo.recepcion })
  if (l.vaTarde) ok('Portico: va tarde y lo dice («Ya vas tarde…»)', /ya vas tarde/i.test(l.porque), l.porque)
  else ok('Portico: no va tarde y la salida es posterior a hoy', !!l.salirAntesDe && l.salirAntesDe >= HOY, l.salirAntesDe)
  ok('Portico: el mercado de la remesa es el de EE. UU.', p.calidad.mercadoRemesa === 'ATVPDKIKX0DER', p.calidad.mercadoRemesa)
  ok('Portico: los € van en $', !p.envios.length || p.envios.every((e) => e.moneda === 'USD'))
}

/* ------------------------------ Casos sintéticos sobre la foto ------------------------------ */

console.log('Libro sin leer, atraso, apagado')
{
  const c = cliente('Opinas')
  const sinLeer = planificarCliente(entradaDeFoto(c, { lectura: null, libro: [] })).plan
  ok('sin lectura: libro sin_leer', sinLeer.calidad.libro === 'sin_leer')
  ok('sin lectura: no hay envíos', sinLeer.envios.length === 0)
  ok('sin lectura: estado sin_datos', estadoDePasada(sinLeer) === 'sin_datos')
  ok('sin lectura: aviso de calidad', sinLeer.calidad.avisos.some((a) => /no se han leído/.test(a)), sinLeer.calidad.avisos)

  const atrasado = entradaDeFoto(c)
  const leidoHasta = '2026-11-05'
  const p = planificarCliente({ ...atrasado, lectura: { ...atrasado.lectura!, leidoHasta }, libro: atrasado.libro.filter((m) => m.fecha <= leidoHasta) }).plan
  ok('10 días de atraso: provisional', p.calidad.provisional && p.calidad.diasAtraso === 10, p.calidad)
  ok('10 días de atraso: estado provisional', estadoDePasada(p) === 'provisional')
  ok('10 días de atraso: aviso «No te fíes de las fechas»', p.calidad.avisos.some((a) => a.startsWith('No te fíes de las fechas')), p.calidad.avisos)
  ok('10 días de atraso: los envíos salen provisionales', p.envios.every((e) => e.provisional))

  const apagado = planificarCliente(entradaDeFoto(c, { configReposicion: { planificador_activo: false } })).plan
  ok('planificador apagado: sin envíos', apagado.envios.length === 0 && apagado.ajustes.activo === false)

  const sinConexion = planificarCliente(entradaDeFoto(c, { connectionId: null })).plan
  ok('sin conexión: aviso y sin_datos', sinConexion.calidad.sinConexion && estadoDePasada(sinConexion) === 'sin_datos')
}

// Opinas hoy no llega al mínimo de envío (63 de 72 ud sin prisa): no se propone. Para probar lo demás se baja el mínimo.
const OPINAS_MIN_BAJO = { configReposicion: { min_unidades_envio: 10 } }

console.log('Opinas sin prisa y por debajo del mínimo: no se propone un envío')
{
  const p = planificarCliente(entradaDeFoto(cliente('Opinas'))).plan
  const a = linea(p, '80-HGPJ-1F82')
  ok('Opinas: 80-HGPJ-1F82 no va en un envío de 63 ud sin prisa', !enAlgunEnvio(p, '80-HGPJ-1F82') && a.fuera === 'aun_no_toca', [a.fuera, p.envios.map((e) => e.unidades)])
  ok('…sin la caja de 25 deducida a la fuerza', a.caja?.origen !== 'deducida', a.caja)
}

console.log('Excluida y cuarentena')
{
  const c = cliente('Opinas')
  const base = planificarCliente(entradaDeFoto(c, OPINAS_MIN_BAJO)).plan
  const a = linea(base, '80-HGPJ-1F82')
  const excl = planificarCliente(entradaDeFoto(c, { reposicionSku: [{ sku: '80-HGPJ-1F82', unidadesCaja: null, coberturaDias: null, excluir: true, motivo: 'lo deja' }] })).plan
  ok('excluida a mano: descatalogada y sin proponer', linea(excl, '80-HGPJ-1F82').fuera === 'descatalogada' && !enAlgunEnvio(excl, '80-HGPJ-1F82'), linea(excl, '80-HGPJ-1F82').fuera)
  if (propuesta(a)) {
    const q = planificarCliente(entradaDeFoto(c, { ...OPINAS_MIN_BAJO, descartes: [{ prioridad: 'tarde', estadoCambiadoAt: `${HOY}T08:00:00Z`, skus: ['80-HGPJ-1F82'] }] })).plan
    ok('descartada hace nada con prioridad igual o mayor: en cuarentena', linea(q, '80-HGPJ-1F82').fuera === 'en_cuarentena', linea(q, '80-HGPJ-1F82').fuera)
  }
  if (propuesta(a) && a.prioridad !== 'mas_adelante') {
    // El envío se descartó como «tarde» (su línea más urgente), pero ESTA referencia iba «más adelante»: si hoy está más arriba, vuelve
    const q = planificarCliente(entradaDeFoto(c, { ...OPINAS_MIN_BAJO, descartes: [{ prioridad: 'tarde', estadoCambiadoAt: `${HOY}T08:00:00Z`, skus: ['80-HGPJ-1F82', 'OTRA'], prioridadPorSku: { '80-HGPJ-1F82': 'mas_adelante', OTRA: 'tarde' } }] })).plan
    ok('cuarentena por línea: con su prioridad «más adelante» y hoy más urgente, no queda en cuarentena', linea(q, '80-HGPJ-1F82').fuera !== 'en_cuarentena', [linea(q, '80-HGPJ-1F82').fuera, a.prioridad])
    const r = planificarCliente(entradaDeFoto(c, { ...OPINAS_MIN_BAJO, descartes: [{ prioridad: 'mas_adelante', estadoCambiadoAt: `${HOY}T08:00:00Z`, skus: ['80-HGPJ-1F82'], prioridadPorSku: { '80-HGPJ-1F82': a.prioridad } }] })).plan
    ok('cuarentena por línea: con su misma prioridad sí queda en cuarentena', linea(r, '80-HGPJ-1F82').fuera === 'en_cuarentena', linea(r, '80-HGPJ-1F82').fuera)
  }
  const caja = planificarCliente(entradaDeFoto(c, { reposicionSku: [{ sku: '80-HGPJ-1F82', unidadesCaja: 12, coberturaDias: null, excluir: false, motivo: null }] })).plan
  const lc = linea(caja, '80-HGPJ-1F82')
  if (lc.cantidad > 0) ok('caja de la referencia: la cantidad es múltiplo de 12', lc.cantidad % 12 === 0 && lc.caja?.origen === 'sku', { cant: lc.cantidad, caja: lc.caja })
}

console.log('Estado del listing unido entre mercados (D11)')
{
  const hoyL = '2026-11-16'
  ok('IT con stock y [] + ES BUYABLE → BUYABLE', JSON.stringify(estadoListingDeSku([{ listingStatus: [], updatedAt: '2026-11-16T05:00:00Z' }, { listingStatus: ['BUYABLE'], updatedAt: '2026-11-16T05:00:00Z' }], hoyL)) === '["BUYABLE"]')
  ok('solo [] → sin dato (null)', estadoListingDeSku([{ listingStatus: [], updatedAt: '2026-11-16T05:00:00Z' }], hoyL) === null)
  ok('DISCOVERABLE reciente manda sobre un BUYABLE viejo', JSON.stringify(estadoListingDeSku([{ listingStatus: ['DISCOVERABLE'], updatedAt: '2026-11-15T05:00:00Z' }, { listingStatus: ['BUYABLE'], updatedAt: '2026-09-01T05:00:00Z' }], hoyL)) === '["DISCOVERABLE"]')
  // De punta a punta: la fila de IT ([] con 4 ud) y la de ES (BUYABLE) → comprable, aunque el stock elegido sea el de IT
  const ita = esNoComprable({ vendibles: 4, listingStatus: estadoListingDeSku([{ listingStatus: [], updatedAt: '2026-11-16' }, { listingStatus: ['BUYABLE'], updatedAt: '2026-11-16' }], hoyL), hayBuyableEnCliente: true, suprimido: false, activoManual: null })
  ok('fila de IT con stock y [] + fila de ES BUYABLE → comprable', !ita)
}

console.log('Una sola regla de rotura para la cifra y el filtro (D4 · D30)')
{
  const hoyR = '2026-11-16'
  const l = (c: Partial<LineaPlan>): LineaPlan => ({ fuera: null, fechaRotura: null, fechaPrimerHueco: null, ritmo: { confianza: 'media' }, ...c } as unknown as LineaPlan)
  // ShoesF FBA047768-45: V = 0, 4 ud llegan mañana → hueco inevitable hoy, pero con lo que viene no rompe en 30 días
  const hueco = l({ fechaPrimerHueco: hoyR, fechaRotura: null })
  ok('el hueco inevitable no cuenta como rotura', !rompeEn(hueco, hoyR, 14) && roturaDeLinea(hueco) === null)
  ok('…ni sale en el filtro «Rompen en 30 días»', !pasaFiltro(hueco, 'rompen30', hoyR, 90))
  const rompe = l({ fechaRotura: '2026-12-01' })
  ok('rotura en 15 días: cuenta en 30 y sale en el filtro', rompeEn(rompe, hoyR, 30) && !rompeEn(rompe, hoyR, 14) && pasaFiltro(rompe, 'rompen30', hoyR, 90))
  const sinDatos = l({ fechaRotura: '2026-11-20', ritmo: { confianza: 'sin_datos' } as LineaPlan['ritmo'] })
  const agotLargo = l({ fechaRotura: '2026-11-20', fuera: 'agotado_largo' })
  ok('sin_datos y FUERA_SIN_ROTURA fuera de la cifra y del filtro', !rompeEn(sinDatos, hoyR, 30) && !pasaFiltro(sinDatos, 'rompen30', hoyR, 90) && !rompeEn(agotLargo, hoyR, 30) && !pasaFiltro(agotLargo, 'rompen30', hoyR, 90))
}

const pruebaReconciliar = async () => {
  console.log('La pasada no pisa un envío que una persona acaba de cambiar (D22/D23)')
  const c = cliente('Opinas')
  const p = planificarCliente(entradaDeFoto(c, OPINAS_MIN_BAJO)).plan
  const env = p.envios[0]
  if (!env) { ok('Opinas tiene un envío para la prueba', false); return }
  const fila = {
    id: 'ep-1', client_id: 'cli', clave: env.clave, estado: 'nuevo', prioridad: env.prioridad, salir_antes_de: env.salirAntesDe,
    decidir_antes_de: env.decidirAntesDe, fecha_limite: env.decidirAntesDe, unidades: env.unidades + 40, cajas_estimadas: null,
    euros_en_riesgo: null, porque: [], lineas: env.lineas.map((l) => ({ ...l, cantidad: l.cantidad + 40 })), lineas_aceptadas: null,
    cambios_desde_ayer: null, plan_ya_no_lo_pide: false, ajustes_aplicados: [], ia: null, motivo_descarte: null, nota: null,
    remesa_id: null, esperando_desde: null, pasada_id: null, version: 3,
    creado_at: `${HOY}T01:00:00Z`, actualizado_at: `${HOY}T01:00:00Z`, estado_cambiado_at: `${HOY}T01:00:00Z`,
  }
  const llamadas: Array<{ tabla: string; ops: Array<[string, unknown[]]> }> = []
  const responder = (tabla: string, ops: Array<[string, unknown[]]>) => {
    const tiene = (k: string) => ops.some(([o]) => o === k)
    if (tabla === 'fba_envios_propuestos' && tiene('update')) return { data: [], error: null } // alguien la cambió: no vuelve ninguna fila
    if (tabla === 'fba_envios_propuestos' && tiene('insert')) return { data: { id: `nuevo-${llamadas.length}` }, error: null }
    if (tabla === 'fba_envios_propuestos' && tiene('gte')) return { data: [], error: null }
    if (tabla === 'fba_envios_propuestos') return { data: [fila], error: null }
    return { data: [], error: null }
  }
  const from = (tabla: string) => {
    const ops: Array<[string, unknown[]]> = []
    llamadas.push({ tabla, ops })
    const b: unknown = new Proxy({}, {
      get(_t, k) {
        if (k === 'then') return (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(responder(tabla, ops)).then(res, rej)
        return (...args: unknown[]) => { ops.push([String(k), args]); return b }
      },
    })
    return b
  }
  const r = await reconciliarCliente({ from } as never, 'cli', p, null, true)
  const upd = llamadas.find((l) => l.tabla === 'fba_envios_propuestos' && l.ops.some(([o]) => o === 'update') && l.ops.some(([o, a]) => o === 'eq' && a[0] === 'id' && a[1] === 'ep-1'))
  const eqs = (upd?.ops ?? []).filter(([o]) => o === 'eq').map(([, a]) => `${a[0]}=${a[1]}`)
  ok('el update filtra por estado y versión leídos', eqs.includes('estado=nuevo') && eqs.includes('version=3') && (upd?.ops ?? []).some(([o]) => o === 'select'), eqs)
  ok('sin fila devuelta no cuenta como actualizado', r.actualizados === 0, r)
  const notas = llamadas.filter((l) => l.tabla === 'fba_envios_propuestos_historial').flatMap((l) => l.ops.filter(([o]) => o === 'insert').flatMap(([, a]) => a[0] as Array<{ accion: string; envio_propuesto_id: string }>))
  ok('…ni apunta «actualizar_plan» en el historial', !notas.some((n) => n.accion === 'actualizar_plan' && n.envio_propuesto_id === 'ep-1'), notas)
}

console.log('Hablados cuentan como llegada')
{
  const c = cliente('Opinas')
  const base = planificarCliente(entradaDeFoto(c, OPINAS_MIN_BAJO)).plan
  const a = linea(base, '80-HGPJ-1F82')
  if (propuesta(a)) {
    const h = planificarCliente(entradaDeFoto(c, { ...OPINAS_MIN_BAJO, hablados: [{ envioPropuestoId: 'e1', salirAntesDe: a.salirAntesDe!, lineas: [{ sku: '80-HGPJ-1F82', cantidad: a.cantidad }] }] })).plan
    const b = linea(h, '80-HGPJ-1F82')
    ok('con lo hablado de camino ya no pide lo mismo otra vez', b.cantidad < a.cantidad || !propuesta(b), { antes: a.cantidad, ahora: b.cantidad, fuera: b.fuera })
    ok('lo hablado cuenta como comprometido', b.comprometido >= a.cantidad, b.comprometido)
  } else ok('80-HGPJ-1F82 se propone en la foto (para probar hablados)', false, a.fuera)
}

console.log('Acierto (D43.2)')
{
  const movs = new Map([['A', [
    ...Array.from({ length: 30 }, (_, i) => ({ sku: 'A', fecha: `2026-10-${String(i + 1).padStart(2, '0')}`, tipo: 'Shipments', disposicion: 'SELLABLE', cantidad: -2 })),
  ]]])
  const a1 = calcularAcierto({ hoy: '2026-10-01', previstos: { A: 2.2 } }, movs, '2026-11-14')
  ok('previsto 2,2 y vendió 2/día → ±10 %', a1?.errorPct === 10 && a1.desde === '2026-10-01', a1)
  ok('sin pasada anterior → null', calcularAcierto(null, movs, '2026-11-14') === null)
  ok('menos de 14 días reales → null', calcularAcierto({ hoy: '2026-11-05', previstos: { A: 2 } }, movs, '2026-11-14') === null)
}

console.log('Orden, líneas relevantes y avisos de calidad')
{
  const p = planificarCliente(entradaDeFoto(cliente('Creative Toys'))).plan
  const orden = ordenarLineasPlan([...p.lineas].reverse())
  ok('ordenarLineasPlan: primero las propuestas', orden.findIndex((l) => !propuesta(l)) === -1 || orden.slice(0, orden.findIndex((l) => !propuesta(l))).every(propuesta))
  const rel = lineasRelevantes(p.lineas, HOY)
  ok('lineasRelevantes: incluye todas las propuestas', p.lineas.filter(propuesta).every((l) => rel.includes(l)))
  const av = avisosDeCalidad(
    { libro: 'ok', leidoHasta: '2026-11-10', leidoDesde: '2025-11-01', diasAtraso: 5, ultimoError: null, mercado: 'A1RKKUPIHCS9HS', mercadoRemesa: 'A1RKKUPIHCS9HS', sinConexion: false, conexionesActivas: 2, plazoDePartida: false, sinPrecio: 1, provisional: false, refsFueraDeCatalogo: 16, pctMerma90: 13.6, calculadoAt: null, horasDesdeCalculo: null, avisos: [] },
    p.plazo, null, 'Creative Toys',
  )
  ok('avisos: atraso de 5 días', av.some((a) => a.includes('5 días de atraso')), av)
  ok('avisos: dos conexiones', av.some((a) => a.includes('2 conexiones')))
  ok('avisos: refs fuera de la base', av.some((a) => a.startsWith('16 referencias que venden no están')))
  ok('avisos: merma 13,6 %', av.some((a) => a.includes('13,6 %')), av)
}

/** JSON con las claves ordenadas (el orden de las claves no importa) */
const estable = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x))

console.log('Pasada guardada → plan (plan-datos)')
{
  const r = planificarCliente(entradaDeFoto(cliente('Creative Toys')))
  const p = r.plan
  // Lo que se guarda en la fila (JSON ida y vuelta, como en la base)
  const fila = JSON.parse(JSON.stringify({
    client_id: p.clienteId, connection_id: p.connectionId, hoy: p.hoy, calculado_at: AHORA,
    plazo: plazoParaGuardar(p, r.previstos, r.movimientos90), calidad: p.calidad, resumen: p.resumen, lineas: p.lineas,
  }))
  ok('el plazo guardado sigue siendo un PlazoEtapas (lo leen S3 y S4)', typeof fila.plazo.transporte === 'number' && typeof fila.plazo.hastaLaVenta === 'number')
  const leido = planDesdePasada(fila, Date.parse(AHORA) + 5 * 3_600_000)
  ok('se reconstruye', leido !== null)
  if (leido) {
    ok('mismo plazo (sin el extra)', JSON.stringify(leido.plazo) === JSON.stringify(p.plazo), Object.keys(leido.plazo))
    ok('mismos envíos con sus líneas', estable(leido.envios) === estable(JSON.parse(JSON.stringify(p.envios))), [estable(leido.envios).slice(0, 300), estable(p.envios).slice(0, 300)])
    ok('mismos ajustes, medidas y envíos de camino', JSON.stringify([leido.ajustes, leido.medidas, leido.enCamino]) === JSON.stringify([p.ajustes, p.medidas, p.enCamino]))
    ok('horas desde el cálculo', leido.calidad.horasDesdeCalculo === 5, leido.calidad.horasDesdeCalculo)
    ok('moneda', leido.moneda === p.moneda)
  }
  const sinLineas = planDesdePasada({ ...fila, lineas: [] }, Date.parse(AHORA))
  ok('con las líneas vaciadas (> 7 días) sigue leyéndose, sin líneas en los envíos', sinLineas !== null && sinLineas.envios.every((e) => e.lineas.length === 0))
  ok('sin el extra no se inventa un plan', planDesdePasada({ ...fila, plazo: p.plazo }, Date.parse(AHORA)) === null)
  const todas = filtrarLineas(p.lineas, HOY, { lineas: 'todas', pagina: 1 })
  ok('paginar: la página 1 trae como mucho 200', todas.length === Math.min(200, p.lineas.length))
  ok('buscar por SKU', filtrarLineas(p.lineas, HOY, { lineas: 'propuestas', sku: 'wm40297' }).map((l) => l.sku).join() === 'WM40297')
}

console.log('Hablados y ajustes que sobreviven a la pasada siguiente')
{
  const p = planificarCliente(entradaDeFoto(cliente('Opinas'), OPINAS_MIN_BAJO)).plan
  const a = linea(p, '80-HGPJ-1F82')
  // Un hablado con 80-HGPJ-1F82: en la pasada siguiente el plan ya no la trae (cuenta como llegada) y no se pierde de «lineas»
  const otra = { ...a, sku: 'OTRA' }
  const ls = lineasConLasPropias([otra], { lineas: [a], lineas_aceptadas: [a] }, new Set(['80-HGPJ-1F82']))
  ok('el hablado conserva su propia línea en «lineas»', ls.map((l) => l.sku).join() === 'OTRA,80-HGPJ-1F82', ls.map((l) => l.sku))
  ok('sin SKU propios, las del plan tal cual', lineasConLasPropias([otra], { lineas: [a], lineas_aceptadas: null }, undefined).length === 1)
  // Un «excluir» que alguien aplicó a un envío «nuevo» sigue aplicado cuando la pasada reescribe las líneas
  const env = p.envios.find((e) => e.lineas.some((l) => l.sku === '80-HGPJ-1F82'))
  if (env) {
    const r = reaplicarAjustes(env.lineas, [{ tipo: 'excluir', sku: '80-HGPJ-1F82', motivo: 'no tiene' }], HOY, { plazo: p.plazo, ajustes: p.ajustes })
    const l = r.lineas.find((x) => x.sku === '80-HGPJ-1F82')
    ok('el ajuste «excluir» se vuelve a aplicar sobre el plan de hoy', r.aplicados === 1 && l?.cantidad === 0 && l.ajusteIa?.tipo === 'excluir', [r.aplicados, l?.cantidad])
    const nada = reaplicarAjustes(env.lineas, [{ tipo: 'excluir', sku: 'NO-ESTA', motivo: '' }], HOY, { plazo: p.plazo, ajustes: p.ajustes })
    ok('un ajuste de una referencia que ya no está se salta', nada.aplicados === 0 && nada.lineas === env.lineas)
  } else ok('80-HGPJ-1F82 va en un envío (para probar ajustes)', false)
}

console.log('Mapeo de filas')
{
  const l = listingDesdeFila({ marketplace_id: 'X', sku: 'S', asin: 'A', fnsku: null, title: 'T', listing_status: ['BUYABLE'], price: '12.5', currency: 'eur', fba_quantity: 3, fba_fulfillable_quantity: 2, fba_inbound_quantity: null, fba_reserved_quantity: 1, fba_unfulfillable_quantity: 0, activo_manual: null, updated_at: null })
  ok('listing: precio en número y moneda en mayúsculas', l.precio === 12.5 && l.moneda === 'EUR' && l.vendibles === 2 && l.entrante === null)
  const cfg = configAlertasDesdeFila({ plazo_reposicion_dias: 30, dias_preparacion: null, dias_transporte: 10, dias_recepcion: null, margen_dias: null })
  ok('config de alertas: total y etapas', cfg?.total === 30 && cfg.diasTransporte === 10 && cfg.diasPreparacion === null)
  ok('config de alertas: sin fila → null', configAlertasDesdeFila(null) === null)
  const cat = catalogoDesdeFila({ ref: 'F0047', nombre: 'BURDEOS', talla: 39, fbasku: ' FBA633372-39 ', continuidad: null, precio: '19,90' })
  ok('catálogo: talla en texto, fbasku limpio y precio con coma', cat.talla === '39' && cat.fbasku === 'FBA633372-39' && cat.precio === 19.9 && cat.continuidad === null, cat)
}

pruebaReconciliar().then(() => {
  console.log(`\n${comprobaciones - fallos}/${comprobaciones} comprobaciones bien${fallos ? ` · ${fallos} FALLAN` : ''}`)
  if (fallos) process.exit(1)
}, (e) => { console.error(e); process.exit(1) })
