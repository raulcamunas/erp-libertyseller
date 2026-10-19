import { calcularInventario, type ListingInventario, type MovimientoInventario, type SkuInventario } from '@/lib/fba/inventario'
import {
  PARAMETROS_POR_DEFECTO,
  ajustarATope,
  calcularBase,
  combinarConIa,
  normalizarParametros,
  plazoDeEnvios,
  seleccionarCandidatas,
  type CandidataRepo,
  type LineaGenerada,
  type ParametrosReposicion,
  type RespuestaIa,
} from '@/lib/fba/reposicion'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/**
 * LA CUENTA BASE Y LA RED DE SEGURIDAD, CON NÚMEROS QUE SE PUEDEN SEGUIR A MANO.
 *
 * Un SKU a mano con ritmo exacto: se construye a partir de un `SkuInventario` mínimo para
 * que cada resultado esperado salga de una cuenta de cabeza y no de lo que devuelva el código.
 */

const P: ParametrosReposicion = { ...PARAMETROS_POR_DEFECTO, plazoDias: 10, coberturaObjetivo: 60, margenDias: 7, multiplo: 1, minimoLinea: 2 }

function sku(sobre: Partial<SkuInventario> & { sku: string }): SkuInventario {
  const base: SkuInventario = {
    sku: sobre.sku,
    asin: null,
    fnsku: `X00${sobre.sku}`,
    nombre: `Producto ${sobre.sku}`,
    precio: 20,
    moneda: 'EUR',
    enAmazon: 0,
    vendibles: 0,
    entrante: 0,
    noDisponibles: 0,
    vendidas: { d7: 0, d14: 0, d30: 0, d60: 0, d90: 0 },
    devueltas: { d30: 0, d90: 0 },
    tasaDevolucion90: null,
    ritmo7: 1,
    ritmo30: 1,
    ritmo90: 1,
    ritmoPlan: 1,
    tendencia: null,
    muestraCorta: false,
    serie90: null,
    ultimaVenta: null,
    diasSinVenta: 1,
    primeraEntrada: null,
    lotes: [],
    edadMediaDias: null,
    edadMaxDias: null,
    porTramo: { t0: 0, t91: 0, t181: 0, t271: 0, t366: 0 },
    anteriorALaLectura: 0,
    diasMedioDeVenta: null,
    retiradas: 0,
    mermas: 0,
    descuadre: 0,
    cobertura: null,
    seAgotaEl: null,
    valorStock: null,
    valorVentas30: null,
    estado: 'ok',
    alertas: [],
  }
  const s = { ...base, ...sobre }
  // La cobertura sale del stock y el ritmo, como en el inventario de verdad
  if (sobre.cobertura === undefined) s.cobertura = s.ritmoPlan > 0 && s.vendibles > 0 ? s.vendibles / s.ritmoPlan : null
  return s
}

console.log('\n=== la cuenta base ===')
{
  // ritmo 1/día, plazo 10, cobertura 60, margen 7 -> quiere 67; tope 77 × 1,6 = 123,2 -> 124
  const a = calcularBase(sku({ sku: 'A', vendibles: 10 }), P)
  ok('con 10 y un ritmo de 1/día se agota justo al llegar: hay que mandar los 67', a.unidades === 67 && a.enLlegada === 0 && a.meta === 67, JSON.stringify(a))
  ok('el tope es 1,6 veces plazo + cobertura + margen', a.tope === 124, String(a.tope))
  const b = calcularBase(sku({ sku: 'B', vendibles: 30 }), P)
  ok('con 30: a la llegada quedan 20 y se quieren 67: faltan 47', b.unidades === 47 && b.enLlegada === 20, JSON.stringify(b))
  const c = calcularBase(sku({ sku: 'C', vendibles: 100 }), P)
  ok('con 100 llega de sobra: no hace falta nada', c.unidades === 0, String(c.unidades))
  const d = calcularBase(sku({ sku: 'D', vendibles: 0, entrante: 40 }), P)
  ok('lo que viene de camino cuenta: 40 − 10 de plazo = 30 al llegar, faltan 37', d.unidades === 37, String(d.unidades))
  const e = calcularBase(sku({ sku: 'E', vendibles: 0, entrante: 0 }), P)
  ok('agotado: no se «recuperan» las ventas perdidas, se manda para cubrir lo que viene (67, no 77)', e.unidades === 67, String(e.unidades))
  ok('y es crítica', e.urgencia === 'critica', e.urgencia)
  const f = calcularBase(sku({ sku: 'F', vendibles: 5 }), P)
  ok('se agota antes de que llegue el envío: urgencia alta', f.urgencia === 'alta', f.urgencia)
  const g = calcularBase(sku({ sku: 'G', vendibles: 40 }), P)
  ok('le quedan 40 días y el plazo es 10: urgencia normal', g.urgencia === 'normal', g.urgencia)
  const h = calcularBase(sku({ sku: 'H', vendibles: 300 }), P)
  ok('300 días de stock: baja', h.urgencia === 'baja' && h.unidades === 0)
  const i = calcularBase(sku({ sku: 'I', ritmoPlan: 0, vendibles: 10 }), P)
  ok('sin ritmo no hay cuenta: 0 y sin tope', i.unidades === 0 && i.tope === 0 && i.explicacion.includes('Sin ventas'))
  const j = calcularBase(sku({ sku: 'J', vendibles: 30 }), { ...P, multiplo: 6 })
  ok('a la caja de 6: 47 pasa a 48', j.unidades === 48, String(j.unidades))
  const k = calcularBase(sku({ sku: 'K', ritmoPlan: 0.35, vendibles: 0 }), P)
  ok('un ritmo bajo da pocas unidades: 0,35 × 67 = 23,45 -> 24', k.unidades === 24, String(k.unidades))
  ok('la explicación se entiende', a.explicacion.includes('Vende 1 ud/día') && a.explicacion.includes('faltan 67'), a.explicacion)
}

console.log('\n=== los parámetros que llegan de fuera ===')
{
  const n = normalizarParametros({ coberturaObjetivo: 9999, plazoDias: -3, margenDias: '5', multiplo: 0, minimoLinea: 'x', topeUnidades: '300', notas: '  Black Friday\u0007 en seis semanas  ' })
  ok('lo que se pasa de rango se acota', n.coberturaObjetivo === 180 && n.plazoDias === 1 && n.multiplo === 1, JSON.stringify(n))
  ok('un número en texto vale', n.margenDias === 5 && n.topeUnidades === 300)
  ok('lo ilegible se queda en el valor de siempre', n.minimoLinea === PARAMETROS_POR_DEFECTO.minimoLinea)
  ok('las notas pierden los caracteres de control y los espacios', n.notas === 'Black Friday en seis semanas', JSON.stringify(n.notas))
  const vacio = normalizarParametros(null)
  ok('nada de nada: los valores de siempre', JSON.stringify(vacio) === JSON.stringify(PARAMETROS_POR_DEFECTO))
  ok('sin tope es null', normalizarParametros({ topeUnidades: '' }).topeUnidades === null && normalizarParametros({ topeUnidades: 0 }).topeUnidades === null)
  ok('las notas se cortan a 1.500', normalizarParametros({ notas: 'x'.repeat(5000) }).notas.length === 1500)
}

console.log('\n=== el plazo real de los envíos ===')
{
  const envio = (id: string, fechaEnvio: string, llegadaAt: string | null, estado = 'cerrada') => ({ id, nombre: null, fechaEnvio, llegadaAt, estadoAmazon: 'CLOSED', estado, referenciaEnvio: null, lineas: [] })
  const sin = plazoDeEnvios([])
  ok('sin envíos: el plazo de siempre', sin.mediana === null && sin.sugerido === 10 && sin.envios === 0)
  const uno = plazoDeEnvios([envio('a', '2026-09-28', '2026-10-01T10:00:00Z')])
  ok('con un solo envío no se fía: lo anota pero no lo usa', uno.mediana === 3 && uno.envios === 1 && uno.sugerido === 10)
  const tres = plazoDeEnvios([envio('a', '2026-09-28', '2026-10-01T10:00:00Z'), envio('b', '2026-08-10', '2026-08-18T00:00:00Z'), envio('c', '2026-07-01', '2026-07-05T00:00:00Z')])
  ok('con tres: la mediana (4) más la recepción (4)', tres.mediana === 4 && tres.sugerido === 8, JSON.stringify(tres))
  const par = plazoDeEnvios([envio('a', '2026-09-20', '2026-09-24T00:00:00Z'), envio('b', '2026-09-01', '2026-09-07T00:00:00Z')])
  ok('con dos: la media de los dos del medio (5)', par.mediana === 5 && par.sugerido === 9, JSON.stringify(par))
  const propuestas = plazoDeEnvios([envio('a', '2026-09-20', '2026-09-24T00:00:00Z', 'borrador'), envio('b', '2026-09-01', null)])
  ok('una propuesta o un envío sin llegada no cuentan', propuestas.envios === 0)
  const absurdo = plazoDeEnvios([envio('a', '2026-01-01', '2026-06-01T00:00:00Z'), envio('b', '2026-09-01', '2026-08-01T00:00:00Z')])
  ok('fechas absurdas (más de 60 días o negativas) se descartan', absurdo.envios === 0)
}

console.log('\n=== qué se le enseña a la IA ===')
const HOY = '2026-10-19'
function inventarioDePrueba() {
  const mov = (s: string, fecha: string, tipo: string, cantidad: number, ref?: string): MovimientoInventario => ({ sku: s, fecha, tipo, cantidad, referencia: ref ?? null })
  const listing = (s: string, total: number, vend: number): ListingInventario => ({ sku: s, asin: null, fnsku: `X${s}`, titulo: `P ${s}`, precio: 10, moneda: 'EUR', enAmazon: total, vendibles: vend })
  const movs: MovimientoInventario[] = [mov('LIBRO', '2026-05-01', 'Receipts', 1, 'R0')]
  // Vende 2 al día en 30 días y tiene 5: hay que reponer
  movs.push(mov('VENDE', '2026-08-01', 'Receipts', 500, 'R1'))
  for (let i = 0; i < 30; i += 1) movs.push(mov('VENDE', `2026-09-${String(19 + i > 30 ? 0 : 19 + i).padStart(2, '0')}`, 'Shipments', 0))
  const ventas = (s: string, desde: string, dias: number, porDia: number) => {
    for (let i = 0; i < dias; i += 1) movs.push(mov(s, new Date(Date.parse(`${desde}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10), 'Shipments', -porDia))
  }
  const sinCeros = movs.filter((m) => m.cantidad !== 0)
  movs.length = 0
  movs.push(...sinCeros)
  ventas('VENDE', '2026-09-18', 30, 2)
  // Agotado hace poco, vendía 1 al día
  movs.push(mov('AGOTA', '2026-08-01', 'Receipts', 60, 'R2'))
  ventas('AGOTA', '2026-08-20', 55, 1)
  // Sobra stock
  movs.push(mov('SOBRA', '2026-08-01', 'Receipts', 900, 'R3'))
  ventas('SOBRA', '2026-09-18', 30, 1)
  // Parado
  movs.push(mov('PARADO', '2026-05-02', 'Receipts', 40, 'R4'))
  return calcularInventario({
    hoy: HOY,
    leidoHasta: '2026-10-18',
    listings: [listing('LIBRO', 0, 0), listing('VENDE', 5, 5), listing('AGOTA', 0, 0), listing('SOBRA', 880, 880), listing('PARADO', 40, 40)],
    movimientos: movs,
    envios: [],
  })
}
const inv = inventarioDePrueba()
const sel = seleccionarCandidatas(inv, P)
const nombres = sel.candidatas.map((c) => c.sku.sku)
ok('se le enseñan la que vende y la agotada', nombres.includes('VENDE') && nombres.includes('AGOTA'), nombres.join())
ok('no la que tiene stock de sobra', !nombres.includes('SOBRA'))
ok('ni la parada ni la que no tiene nada', !nombres.includes('PARADO') && !nombres.includes('LIBRO'))
ok('la agotada va antes que la que aún tiene stock', nombres.indexOf('AGOTA') < nombres.indexOf('VENDE'), nombres.join())
ok('se cuenta lo que tiene stock y no se propone', sel.sinNecesidad >= 2, String(sel.sinNecesidad))
ok('cabe todo', sel.quedanFuera === 0)

console.log('\n=== la IA propone, el cálculo comprueba ===')
const cands: CandidataRepo[] = [
  { sku: sku({ sku: 'A', vendibles: 10 }), base: calcularBase(sku({ sku: 'A', vendibles: 10 }), P) }, // base 67, tope 124
  { sku: sku({ sku: 'B', vendibles: 30 }), base: calcularBase(sku({ sku: 'B', vendibles: 30 }), P) }, // base 47
  { sku: sku({ sku: 'C', vendibles: 5 }), base: calcularBase(sku({ sku: 'C', vendibles: 5 }), P) }, // se agota antes de llegar: base 67
  { sku: sku({ sku: 'D', vendibles: 0 }), base: calcularBase(sku({ sku: 'D', vendibles: 0 }), P) }, // base 67
]
const resp = (r: Partial<RespuestaIa>): RespuestaIa => ({ resumen: 'r', estrategia: 'e', lineas: [], descartadas: [], riesgos: [], dudas: [], ...r })
type LineaDeIa = RespuestaIa['lineas'][number]
const linea = (s: string, unidades: number, motivo = 'porque sí'): LineaDeIa => ({ sku: s, unidades, prioridad: 'alta', confianza: 'media', motivo });
{
  const m = combinarConIa(cands, resp({ lineas: [linea('A', 90), linea('B', 40)], descartadas: [{ sku: 'C', motivo: 'Se devuelve el 40 %' }] }), P)
  const por = Object.fromEntries(m.lineas.map((l) => [l.sku, l]))
  ok('la cantidad de la IA manda mientras esté dentro del tope', por.A.unidades === 90 && por.A.origen === 'ia' && !por.A.recortada)
  ok('y la de B también, aunque sea menos que el cálculo', por.B.unidades === 40 && por.B.base === 47)
  ok('lo que la IA descarta sale con su motivo', m.descartadas.some((d) => d.sku === 'C' && d.motivo === 'Se devuelve el 40 %' && d.base === 67))
  ok('lo que la IA no menciona entra con el cálculo y lo dice', por.D.origen === 'calculo' && por.D.unidades === 67 && por.D.motivo.includes('La IA no la ha comentado'), JSON.stringify(por.D))
  ok('y se avisa de ello', m.notas.some((n) => n.includes('no ha comentado')))
}
{
  const m = combinarConIa(cands, resp({ lineas: [linea('A', 5000), linea('INVENTADO', 100)] }), P)
  const a = m.lineas.find((l) => l.sku === 'A')!
  ok('una cantidad desorbitada se recorta al tope (124)', a.unidades === 124 && a.recortada && a.motivo.includes('recortado'), `${a.unidades} ${a.motivo}`)
  ok('un SKU que no existe se ignora y se cuenta', !m.lineas.some((l) => l.sku === 'INVENTADO') && m.notas.some((n) => n.includes('no estaban en el análisis')))
  ok('se avisa de lo recortado', m.notas.some((n) => n.includes('recortado')))
}
{
  const m = combinarConIa(cands, resp({ lineas: [linea('A', -20), linea('B', Number.NaN), linea('C', 12.9)] }), P)
  ok('una cantidad negativa o ilegible no manda nada: va a descartadas', m.descartadas.some((d) => d.sku === 'A') && m.descartadas.some((d) => d.sku === 'B'))
  ok('un decimal se redondea hacia abajo', m.lineas.find((l) => l.sku === 'C')!.unidades === 12)
}
{
  const m = combinarConIa(cands, resp({ lineas: [linea('A', 50), linea('A', 999)] }), P)
  ok('si la IA repite un SKU, vale el primero', m.lineas.find((l) => l.sku === 'A')!.unidades === 50)
}
{
  const m = combinarConIa(cands, null, P)
  ok('sin respuesta de la IA sale todo del cálculo', m.lineas.length === 4 && m.lineas.every((l) => l.origen === 'calculo' && l.unidades === l.base))
  ok('con los motivos del cálculo y sin confianza', m.lineas.every((l) => l.confianza === null && l.motivo.includes('Vende')))
  ok('la crítica va delante (prioridad alta y más ritmo)', m.lineas[0].prioridad === 'alta')
}
{
  const m = combinarConIa(cands, resp({ lineas: [linea('A', 100, 'x'.repeat(2000))] }), P)
  ok('el motivo de la IA se corta a 300 caracteres', m.lineas.find((l) => l.sku === 'A')!.motivo.length <= 300 + 80)
  const control = combinarConIa(cands, resp({ lineas: [linea('A', 100, 'texto\u0007 con\ncontrol')] }), P)
  ok('y pierde los caracteres de control y los saltos', control.lineas.find((l) => l.sku === 'A')!.motivo === 'texto con control', control.lineas.find((l) => l.sku === 'A')!.motivo)
}
{
  const m = combinarConIa(cands, resp({ lineas: [linea('A', 33)] }), { ...P, multiplo: 12 })
  ok('la cantidad de la IA también va a la caja (33 -> 36)', m.lineas.find((l) => l.sku === 'A')!.unidades === 36)
}
{
  const pocas: CandidataRepo[] = [{ sku: sku({ sku: 'P', ritmoPlan: 0.03, vendibles: 0, estado: 'ok' }), base: calcularBase(sku({ sku: 'P', ritmoPlan: 0.03, vendibles: 0 }), P) }]
  ok('la cuenta de una referencia casi sin ventas sale en 2 unidades', pocas[0].base.unidades === 3 || pocas[0].base.unidades === 2, String(pocas[0].base.unidades))
  const suelta: CandidataRepo[] = [{ sku: sku({ sku: 'Q', ritmoPlan: 0.01, vendibles: 40 }), base: { ...calcularBase(sku({ sku: 'Q', ritmoPlan: 0.01, vendibles: 40 }), P), unidades: 1, urgencia: 'baja' } }]
  const m = combinarConIa(suelta, null, P)
  ok('el cálculo no manda una sola unidad si no es urgente', m.lineas.length === 0 && m.descartadas.length === 1 && m.descartadas[0].motivo.includes('no compensa'))
}

console.log('\n=== el tope de unidades ===')
{
  const l = (s: string, unidades: number, prioridad: 'alta' | 'media' | 'baja', ritmo = 1): LineaGenerada => ({ ...(combinarConIa([{ sku: sku({ sku: s }), base: calcularBase(sku({ sku: s, vendibles: 0 }), P) }], null, P).lineas[0] as LineaGenerada), sku: s, unidades, prioridad, ritmo })
  const lineas = [l('X1', 50, 'baja'), l('X2', 50, 'alta'), l('X3', 50, 'media')]
  const sin = ajustarATope(lineas, null, 1)
  ok('sin tope no se toca nada', sin.lineas.length === 3 && sin.fuera.length === 0 && sin.nota === null)
  const cabe = ajustarATope(lineas, 150, 1)
  ok('si cabe todo, no se toca', cabe.lineas.length === 3 && cabe.nota === null)
  const t = ajustarATope(lineas, 100, 1)
  ok('con tope 100 entran las dos más urgentes (alta y media)', t.lineas.map((x) => x.sku).join() === 'X2,X3', t.lineas.map((x) => x.sku).join())
  ok('y la baja sale con su motivo', t.fuera.length === 1 && t.fuera[0].sku === 'X1' && t.fuera[0].motivo.includes('tope de 100'))
  const medio = ajustarATope(lineas, 120, 1)
  ok('con tope 120 la menos urgente (X1) se reduce a lo que quepa: 20', medio.lineas.find((x) => x.sku === 'X1')!.unidades === 20 && medio.fuera.length === 0 && medio.lineas.find((x) => x.sku === 'X2')!.unidades === 50, JSON.stringify(medio.lineas.map((x) => [x.sku, x.unidades])))
  ok('y la línea reducida lo dice en su motivo', medio.lineas.find((x) => x.sku === 'X1')!.motivo.includes('Reducida a 20'))
  const caja = ajustarATope(lineas, 118, 12)
  ok('a la caja hacia abajo: caben 18 y se queda en 12', caja.lineas.find((x) => x.sku === 'X1')!.unidades === 12, JSON.stringify(caja.lineas.map((x) => [x.sku, x.unidades])))
  const justo = ajustarATope([l('Y1', 50, 'alta'), l('Y2', 50, 'baja')], 55, 12)
  ok('si ni una caja más cabe, esa referencia queda fuera', justo.lineas.length === 1 && justo.fuera.length === 1 && justo.fuera[0].sku === 'Y2' && justo.fuera[0].motivo.includes('ni una caja'), JSON.stringify([justo.lineas.map((x) => [x.sku, x.unidades]), justo.fuera.map((x) => x.sku)]))
  ok('el total nunca pasa del tope', [t, medio, caja].every((r, i) => r.lineas.reduce((s, x) => s + x.unidades, 0) <= [100, 120, 118][i]))
  ok('la nota dice cuántas se han dejado fuera', !!t.nota && t.nota.includes('1 referencia'))
}

console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
