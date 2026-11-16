/**
 * Pruebas de las piezas puras de cerebro-ia.ts y resumen-servidor.ts (sin red ni base de datos).
 *   npx tsx lib/ads/agente/cerebro-ia.prueba.ts
 */
import {
  ayerParaLaIa,
  claveDeTermino,
  esRevisar,
  etiquetaDelMotivo,
  etiquetaSigueValiendo,
  posturasDeLosProductos,
  queDePropuesta,
  rarasDeLasPendientes,
  resultadosParaLaIa,
  terminosParaLaIa,
  type PendienteParaCerebro,
} from './cerebro-ia'
import { datosDelResumen, hechosPorClase, necesitaPersona, veredictosDelResumen } from './resumen-servidor'
import { textoDelResumen } from './avisos-calculo'
import type { ContextoDelAgente, ProductoDelContexto } from './tipos'

let fallos = 0
const ok = (n: string, bien: boolean, d: unknown = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || d === '' ? '' : ` -> ${typeof d === 'string' ? d : JSON.stringify(d)}`}`)
}

const prod = (asin: string, extra: Partial<ProductoDelContexto> = {}): ProductoDelContexto => ({
  asin,
  nombre: `PRODUCTO ${asin}`,
  acosObjetivoPct: 25,
  fuenteObjetivo: 'humano',
  objetivoCongeladoAt: null,
  soloDefensivo: false,
  equilibrioPct: 31,
  cpaObjetivo: 8,
  fase: 'normal',
  marca: null,
  acos14Pct: 15,
  acos30Pct: 18,
  tacos30Pct: 6,
  clics14: 200,
  gasto30: 500,
  ventas30: 2500,
  pedidos30: 80,
  ventasTotales30: 8000,
  ventasTotalesMes: 4000,
  ventasTotalesMesAnterior: 3500,
  tacosMesPct: 6,
  tacosMesAnteriorPct: 7,
  tendenciaVentasTotalesPct: 12,
  stock: 400,
  stockActualizadoAt: '2026-11-15T08:00:00Z',
  coberturaDias: 40,
  postura: 'mantener',
  fuentePostura: null,
  motivoPostura: null,
  ...extra,
})

const mes = { gastoMes: 540, techo: 1200, proyeccion: 900, media7: 30, diasRestantes: 16, ritmo: 'crecer' as const, cambiado: false, motivo: '' }

const contexto = (productos: ProductoDelContexto[], extra: Partial<ContextoDelAgente> = {}): ContextoDelAgente => ({
  perfilId: 'p1',
  nombreCuenta: 'Ham Master · España',
  pais: 'ES',
  moneda: 'EUR',
  zonaHoraria: 'Europe/Madrid',
  fechaLocal: '2026-11-19',
  tacosObjetivoPct: 10,
  acosObjetivoMedioPct: 25,
  muestraMinimaClics: 12,
  techo: { techo: 1200, automatico: false, congeladoAt: null },
  mes,
  evento: null,
  cuentaPequena: false,
  cuenta: {
    gasto7: 300, ventas7: 1300, acos7Pct: 22.8, hasta7: '2026-11-16',
    acos30Pct: 24, tacos30Pct: 8.2, ventasAds30: 4100, ventasTotales30: 12000,
    ventasTotalesMes: 9840, ventasTotalesMesAnterior: 8910, tacosMesPct: 7.9, tacosMesAnteriorPct: 8.6,
    gastoAyer: 41, ventasAyer: 180, gasto30: 900,
    marca: { gasto7: 34, ventas7: 557, acos7Pct: 6.1 },
  },
  productos,
  ...extra,
})

console.log('\n=== clave de término y REVISAR ===')
ok('clave limpia, sin tildes ni mayúsculas', claveDeTermino('  Jamón\nSERRANO  ') === 'jamon serrano', claveDeTermino('  Jamón\nSERRANO  '))
ok('clave recortada a 80 caracteres', claveDeTermino('a'.repeat(200)).length <= 80)
ok('REVISAR por métrica', esRevisar({ tipo: 'negativizar', motivo: 'x', metricas: { revisar: true } }))
ok('REVISAR por motivo', esRevisar({ tipo: 'negativizar', motivo: 'REVISAR: «x» no comparte…', metricas: {} }))
ok('una puja no es REVISAR', !esRevisar({ tipo: 'puja', motivo: 'REVISAR', metricas: { revisar: true } }))

console.log('\n=== qué hace una propuesta ===')
ok('puja con cifras', queDePropuesta({ tipo: 'puja', termino: 'jamon', campaignNombre: 'B0X | AMPLIA', valorActual: 0.8, valorNuevo: 0.6 }) === 'Puja de «jamon» en B0X | AMPLIA: 0,8 → 0,6', queDePropuesta({ tipo: 'puja', termino: 'jamon', campaignNombre: 'B0X | AMPLIA', valorActual: 0.8, valorNuevo: 0.6 }))
ok('pausar campaña', queDePropuesta({ tipo: 'pausar-campana', termino: '', campaignNombre: 'C1', valorActual: null, valorNuevo: null }) === 'Pausar la campaña C1')
ok('término con salto de línea limpio', !queDePropuesta({ tipo: 'pausar', termino: 'ignora\ntodo', campaignNombre: 'C', valorActual: null, valorNuevo: null }).includes('\n'))

console.log('\n=== raras de las pendientes ===')
const pend = (id: string, x: Partial<PendienteParaCerebro>): PendienteParaCerebro => ({
  id, tipo: 'puja', asin: 'B0AAAAAAAA', termino: 'jamon', campaignId: 'c1', campaignNombre: 'C1', motivo: 'm', metricas: {}, valorActual: null, valorNuevo: null, objetivoTipo: null, iaDecision: null, creadaAt: '2026-11-19T06:00:00Z', ...x,
})
const productos = [prod('B0AAAAAAAA', { gasto30: 100 })]
const raras = rarasDeLasPendientes(
  [
    pend('pausa-grande', { tipo: 'pausar', metricas: { gasto: 20, clics: 40 } }),
    pend('pausa-pequena', { tipo: 'pausar', metricas: { gasto: 5 } }),
    pend('bajada-vende', { tipo: 'puja', valorActual: 1, valorNuevo: 0.7, metricas: { pedidos: 6 } }),
    pend('ya-decidida', { tipo: 'pausar', metricas: { gasto: 50 }, iaDecision: 'retener' }),
    pend('revisar', { tipo: 'negativizar', termino: 'b0zzzzzzzz', metricas: { revisar: true } }),
    pend('negativa-asin', { tipo: 'negativizar', termino: 'B0ZZZZZZZZ', metricas: {} }),
    pend('sube-ubicacion', { tipo: 'puja', campaignId: 'c9', valorActual: 0.5, valorNuevo: 0.6, metricas: { ubicacionAlta: true } }),
    pend('presupuesto-sin-producto', { tipo: 'presupuesto', asin: 'B0NOEXISTE', valorActual: 10, valorNuevo: 12 }),
  ],
  productos,
)
const ids = raras.map((r) => r.id)
ok('pausa con ≥ 10 % del gasto del producto → rara', ids.includes('pausa-grande'))
ok('pausa pequeña → no', !ids.includes('pausa-pequena'))
ok('bajada con 6 pedidos → rara', ids.includes('bajada-vende'))
ok('con decisión de la IA → fuera', !ids.includes('ya-decidida'))
ok('REVISAR → fuera (va por la etiqueta)', !ids.includes('revisar'))
ok('negativizar un ASIN → rara', ids.includes('negativa-asin'))
ok('subida en campaña con ubicación alta → rara', ids.includes('sube-ubicacion'))
ok('subida de presupuesto sin stock conocido → rara', ids.includes('presupuesto-sin-producto'))
ok('el motivo dice por qué es rara', raras.find((r) => r.id === 'bajada-vende')!.motivo.startsWith('Rara: '))

console.log('\n=== etiquetas vigentes ===')
const ahora = Date.parse('2026-11-19T08:00:00Z')
ok('vigente', etiquetaSigueValiendo({ caduca_at: '2027-05-01T00:00:00Z', titulo_hash: 'abc' }, 'abc', ahora))
ok('caducada → no', !etiquetaSigueValiendo({ caduca_at: '2026-11-18T00:00:00Z', titulo_hash: 'abc' }, 'abc', ahora))
ok('otro título → no', !etiquetaSigueValiendo({ caduca_at: '2027-05-01T00:00:00Z', titulo_hash: 'abc' }, 'xyz', ahora))
ok('sin hash del que pregunta → vale', etiquetaSigueValiendo({ caduca_at: '2027-05-01T00:00:00Z', titulo_hash: 'abc' }, null, ahora))
ok('guardada sin hash y se pregunta con hash → no', !etiquetaSigueValiendo({ caduca_at: '2027-05-01T00:00:00Z', titulo_hash: null }, 'abc', ahora))

console.log('\n=== términos para la IA ===')
const conEtiqueta = new Set(['B0AAAAAAAA|soporte'])
const ter = terminosParaLaIa(
  [
    { asin: 'B0AAAAAAAA', termino: 'Jamonero barato', clics: 3, gasto: 1 },
    { asin: null, termino: 'sin producto', clics: 3, gasto: 9 },
  ],
  [
    { asin: 'B0AAAAAAAA', termino: 'cuchillo', clics: 10, gasto: 8, pedidos: 0 },
    { asin: 'B0AAAAAAAA', termino: 'jamonero  BARATO', clics: 10, gasto: 7, pedidos: 0 },
    { asin: 'B0AAAAAAAA', termino: 'soporte', clics: 10, gasto: 6, pedidos: 0 },
    { asin: 'B0AAAAAAAA', termino: 'vendido', clics: 10, gasto: 50, pedidos: 2 },
    { asin: 'B0AAAAAAAA', termino: 'b0cccccccc', clics: 10, gasto: 40, pedidos: 0 },
  ],
  (asin, clave) => conEtiqueta.has(`${asin}|${clave}`),
)
ok('primero los REVISAR', ter[0]?.termino === 'Jamonero barato', ter)
ok('sin ASIN de producto → fuera', !ter.some((t) => t.termino === 'sin producto'))
ok('repetido (misma clave) → fuera', ter.filter((t) => claveDeTermino(t.termino) === 'jamonero barato').length === 1)
ok('con etiqueta vigente → fuera', !ter.some((t) => t.termino === 'soporte'))
ok('con pedidos → fuera', !ter.some((t) => t.termino === 'vendido'))
ok('un ASIN como término → fuera', !ter.some((t) => t.termino === 'b0cccccccc'))
ok('quedan 2', ter.length === 2, ter)
const muchos = terminosParaLaIa([], Array.from({ length: 300 }, (_, i) => ({ asin: 'B0AAAAAAAA', termino: `t${i}`, clics: 1, gasto: i, pedidos: 0 })), () => false)
ok('como mucho 120', muchos.length === 120)
ok('los de más gasto', muchos[0].termino === 't299')

console.log('\n=== resultados y ayer ===')
const res = resultadosParaLaIa([
  { clase: 'puja_subir', veredicto: 'mejoro', detalle: null },
  { clase: 'puja_subir', veredicto: 'empeoro', detalle: 'Subida de puja «jamon» +15 %: ACoS 38 %' },
  { clase: 'negativizar', veredicto: 'sin_muestra', detalle: null },
  { clase: 'negativizar', veredicto: 'mezclado', detalle: null },
])
ok('por clase', res.porClase.puja_subir?.mejoro === 1 && res.porClase.puja_subir?.empeoro === 1 && !res.porClase.negativizar, res)
ok('empeorados con detalle', res.ultimosEmpeorados.length === 1)
const ayer = ayerParaLaIa(
  [
    { estado: 'aplicada', agente_at: '2026-11-18T10:00:00Z', retenida_at: null },
    { estado: 'deshecha', agente_at: '2026-11-18T11:00:00Z', retenida_at: null },
    { estado: 'ensayada', agente_at: '2026-11-18T12:00:00Z', retenida_at: null },
    { estado: 'aplicada', agente_at: '2026-11-19T01:00:00Z', retenida_at: null },
    { estado: 'pendiente', agente_at: null, retenida_at: '2026-11-18T15:00:00Z' },
  ],
  1,
  { desde: Date.parse('2026-11-17T23:00:00Z'), hasta: Date.parse('2026-11-18T23:00:00Z') },
  { gastoAyer: 41, ventasAyer: 180 },
)
ok('ayer: 2 aplicadas, 1 ensayada, 1 retenida, 1 deshecha, sin ACoS', ayer.aplicadas === 2 && ayer.ensayadas === 1 && ayer.retenidas === 1 && ayer.deshechas === 1 && ayer.acosPct === null && ayer.gasto === 41, ayer)

console.log('\n=== posturas (IA acotada por reglas) ===')
const ctx = contexto([
  prod('B0CRECE0001'),
  prod('B0DEFENS001', { soloDefensivo: true, equilibrioPct: null, fuenteObjetivo: 'acos_real' }),
  prod('B0SINSTOCK1', { stock: 0, coberturaDias: 0 }),
  prod('B0LANZA0001', { fase: 'lanzamiento', acos14Pct: 60 }),
])
const conIa = posturasDeLosProductos(ctx, new Map([
  ['B0CRECE0001', { postura: 'crecer' as const, motivo: 'Rinde y crece' }],
  ['B0DEFENS001', { postura: 'crecer' as const, motivo: 'x' }],
  ['B0SINSTOCK1', { postura: 'crecer' as const, motivo: 'x' }],
  ['B0LANZA0001', { postura: 'recortar' as const, motivo: 'x' }],
]))
const de = (asin: string) => conIa.find((p) => p.asin === asin)!
ok('IA crecer con todo a favor → crecer (fuente ia)', de('B0CRECE0001').postura === 'crecer' && de('B0CRECE0001').fuente === 'ia', de('B0CRECE0001'))
ok('solo defensivo → como mucho mantener', de('B0DEFENS001').postura === 'mantener')
ok('sin stock → recortar (fuente stock)', de('B0SINSTOCK1').postura === 'recortar' && de('B0SINSTOCK1').fuente === 'stock')
ok('lanzamiento con recortar → mantener', de('B0LANZA0001').postura === 'mantener')
const sinIa = posturasDeLosProductos(ctx, null)
ok('sin IA: reglas para todos', sinIa.length === 4 && sinIa.every((p) => p.fuente !== 'ia'), sinIa)
ok('sin IA: el que rinde crece por reglas (ritmo crecer)', sinIa[0].postura === 'crecer', sinIa[0])
const enRecorte = posturasDeLosProductos({ ...ctx, mes: { ...mes, ritmo: 'recorte' } }, new Map([['B0CRECE0001', { postura: 'crecer' as const, motivo: 'x' }]]))
ok('ritmo recorte → nadie crece', enRecorte.every((p) => p.postura !== 'crecer'))

console.log('\n=== validación persona-IA (motivo) ===')
ok('«otro producto» del motivo', etiquetaDelMotivo('La IA dice: otro producto (0,92). Revísala para enseñar al agente') === 'otro_producto')
ok('«intención mala» con tilde', etiquetaDelMotivo('La IA dice: intención mala (0,90).') === 'intencion_mala')
ok('con guion bajo', etiquetaDelMotivo('La IA dice: marca_ajena (0,7)') === 'marca_ajena')
ok('no se entiende → null', etiquetaDelMotivo('Ha vendido: lo decide una persona') === null)

console.log('\n=== resumen ===')
const hechos = hechosPorClase([
  { tipo: 'negativizar', estado: 'aplicada', valorActual: null, valorNuevo: null, metricas: {} },
  { tipo: 'negativizar', estado: 'ensayada', valorActual: null, valorNuevo: null, metricas: {} },
  { tipo: 'puja', estado: 'aplicada', valorActual: 1, valorNuevo: 0.8, metricas: { pedidos: 2 } },
  { tipo: 'puja', estado: 'deshecha', valorActual: 1, valorNuevo: 1.2, metricas: {} },
  { tipo: 'presupuesto', estado: 'error', valorActual: 10, valorNuevo: 12, metricas: {} },
])
ok('hechos por clase', hechos.negativizar === 2 && hechos.puja_bajar === 1 && hechos.puja_subir === 1 && !hechos.presupuesto_subir, hechos)
{
  const pausa = { tipo: 'pausar-campana', estado: 'ensayada', valorActual: null, valorNuevo: null, metricas: {}, campaignId: 'c9', objetivoId: null, termino: 'B0X | S | R | AUTO' }
  const h = hechosPorClase([pausa, pausa, pausa, { ...pausa, campaignId: 'c10' }, { ...pausa, estado: 'aplicada' }])
  ok('la misma pausa ensayada 3 veces cuenta una (y otra campaña, otra; lo aplicado aparte)', h.pausar_campana === 3, h)
}
ok('veredictos sin «sin muestra»', JSON.stringify(veredictosDelResumen([{ veredicto: 'mejoro' }, { veredicto: 'sin_muestra' }, { veredicto: 'mezclado' }])) === JSON.stringify({ mejoro: 1, empeoro: 0, neutro: 0, mezclado: 1 }))
const np = necesitaPersona(2, [
  prod('B0XXXXXXXX', { equilibrioPct: null, soloDefensivo: true, marca: 'Ham' }),
  prod('B0YYYYYYYY', { marca: null }),
  prod('B0ZZZZZZZZ', { acosObjetivoPct: null, marca: 'Ham' }),
])
ok('necesita a una persona', np[0] === '2 propuestas retenidas' && np.some((x) => x === 'B0XXXXXXXX sin coste (solo defensivo)') && np.some((x) => x === 'B0YYYYYYYY sin marca') && np.some((x) => x === 'B0ZZZZZZZZ sin ACoS objetivo'), np)
const npMuchos = necesitaPersona(0, Array.from({ length: 5 }, (_, i) => prod(`B0M000000${i}`, { marca: null })))
ok('lista corta con «y N más»', npMuchos[0] === 'B0M0000000, B0M0000001, B0M0000002 y 2 más sin marca', npMuchos)

const datos = datosDelResumen({
  config: { estado: 'activo', frenoMotivo: null, frenoDetalle: null },
  contexto: ctx,
  fecha: '2026-11-19',
  hechos: { negativizar: 7, puja_bajar: 3, presupuesto_subir: 1, pausar: 1 },
  deshechos: ['Subida de puja «jamon» deshecha'],
  retenidas: 2,
  veredictos: [{ veredicto: 'mejoro' }, { veredicto: 'empeoro' }],
  informeIa: { titular: 'Semana buena: ventas totales +10 %', puntos: ['El TACoS baja'], necesitaPersona: [] },
  veda: null,
  rampa: { dia: 2, de: 7 },
})
const texto = textoDelResumen(datos)
ok('primera línea con la cuenta y la fecha', texto.cuerpo.split('\n')[0].includes('Ham Master') && texto.cuerpo.includes('jueves 19 nov'), texto.cuerpo)
ok('negocio primero', texto.cuerpo.split('\n')[1].startsWith('**Ventas totales del mes**'), texto.cuerpo)
ok('ayer sin ACoS', /\*\*Ayer\*\*[^\n]*gasto 41,00 €/.test(texto.cuerpo) && !/\*\*Ayer\*\*[^\n]*ACoS/.test(texto.cuerpo))
ok('rampa en activo', texto.cuerpo.includes('(rampa: día 2 de 7)'))
ok('la lectura de la IA', texto.cuerpo.includes('**La lectura**: Semana buena'))
ok('necesita a una persona', texto.cuerpo.includes('**Necesita a una persona**: 2 propuestas retenidas'))
const enEnsayo = datosDelResumen({ ...{ config: { estado: 'ensayo' as const, frenoMotivo: null, frenoDetalle: null } }, contexto: ctx, fecha: '2026-11-19', hechos: {}, deshechos: [], retenidas: 0, veredictos: [], informeIa: null, veda: { nombre: 'Black Friday + Cyber Monday', hasta: '2026-12-02' }, rampa: { dia: 2, de: 7 } })
ok('en ensayo: sin rampa', enEnsayo.enEnsayo && enEnsayo.rampa === null)
const tEnsayo = textoDelResumen(enEnsayo).cuerpo
ok('en ensayo: «Habría hecho» y sin «La lectura»', tEnsayo.includes('Habría hecho (ensayo)') && !tEnsayo.includes('La lectura'), tEnsayo)
const frenado = datosDelResumen({ config: { estado: 'frenado', frenoMotivo: 'gasto_disparado', frenoDetalle: 'Gasto a 112 €' }, contexto: ctx, fecha: '2026-11-19', hechos: {}, deshechos: [], retenidas: 0, veredictos: [], informeIa: null, veda: null, rampa: null })
ok('frenado arriba', textoDelResumen(frenado).cuerpo.split('\n')[1].startsWith('🛑'), textoDelResumen(frenado).cuerpo)

console.log(fallos ? `\n${fallos} FALLOS` : '\nTodo bien')
if (fallos) process.exit(1)
