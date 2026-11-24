/**
 * Pruebas de lib/fba/ritmo.ts (spec remesas-pro §2.10 casos 5, 7, 8, 9, 10, 14 y 36; §11.8 casos 43, 44, 45 y 52; bordes).
 * cd /Users/raulcamunas/Dev/ERP-remesas && npx tsx lib/fba/ritmo.prueba.ts
 */
import {
  serieDiaria, ritmoRobusto, ritmoPorModelo, perfilSemanal, perfilDelCliente, devolucionesYMermas, primeraEntradaDe,
  consumoDelDia, semanaIso, sumarDias, type MovimientoDiario, type OpcionesRitmo,
} from '@/lib/fba/ritmo'

let fallos = 0
function comprobar(nombre: string, ok: boolean, detalle?: unknown) {
  if (!ok) fallos++
  console.log(`  ${ok ? 'OK  ' : 'FALLA'} ${nombre}${ok || detalle === undefined ? '' : `\n        ${JSON.stringify(detalle)}`}`)
}
const cerca = (a: number | null, b: number, tol = 0.02) => a !== null && Math.abs(a - b) <= tol

const HOY = '2026-11-15'
const dia = (n: number) => sumarDias(HOY, n) // n ≤ 0: hace |n| días
const mov = (sku: string, n: number, tipo: string, cantidad: number, disposicion: string | null = 'SELLABLE'): MovimientoDiario =>
  ({ sku, fecha: dia(n), tipo, disposicion, cantidad })
const venta = (sku: string, n: number, ud: number) => mov(sku, n, 'Shipments', -ud)
const entrada = (sku: string, n: number, ud: number) => mov(sku, n, 'Receipts', ud)

const OPC: OpcionesRitmo = {
  primeraEntrada: null, perfil: null, origenPerfil: null, picoAnoPasado: null, topeEstacional: 1.8,
  horizonte: [HOY, dia(60)], libro: 'ok', devolucionesVendibles90: 0, mermas90: 0,
}
function ritmoDe(movs: MovimientoDiario[], sku: string, vendibles: number, extra: Partial<OpcionesRitmo> = {}, leidoHasta = HOY) {
  const serie = serieDiaria(movs, sku, vendibles, leidoHasta, HOY)
  return { serie, ritmo: ritmoRobusto(serie, { ...OPC, primeraEntrada: primeraEntradaDe(movs, sku), ...extra }) }
}

console.log('\n=== 7. La rotura esconde ventas: el ritmo va sobre los días con stock ===')
{
  const movs: MovimientoDiario[] = [entrada('A', -60, 30)]
  for (let n = -60; n <= -31; n++) movs.push(venta('A', n, 1))
  const { ritmo, serie } = ritmoDe(movs, 'A', 0)
  comprobar('r60 = 1 ud/día (no 0,5)', cerca(ritmo.r60, 1), ritmo.r60)
  comprobar('los últimos 30 días, sin stock', serie.conStock.slice(-30).every((c) => c === false))
  comprobar('ventas30 = 0', ritmo.ventas30 === 0, ritmo.ventas30)
}

console.log('\n=== 8. Las retiradas no son ventas ===')
{
  const movs: MovimientoDiario[] = [entrada('A', -100, 500)]
  for (let i = 0; i < 20; i++) movs.push(venta('A', -1 - i, 1))
  movs.push(mov('A', -5, 'VendorReturns', -50))
  const { ritmo } = ritmoDe(movs, 'A', 430)
  comprobar('ventas30 = 20', ritmo.ventas30 === 20, ritmo.ventas30)
  comprobar('serie fiable', ritmo.serieDeStockFiable)
}

console.log('\n=== 9. Las mermas no son ventas ===')
{
  const base: MovimientoDiario[] = [entrada('A', -120, 400)]
  for (let n = -100; n <= 0; n += 2) base.push(venta('A', n, 2))
  const sin = ritmoDe(base, 'A', 400 - 102).ritmo
  const con = ritmoDe([...base, mov('A', -10, 'Adjustments', -30)], 'A', 400 - 102 - 30).ritmo
  comprobar('mismo ritmo con un ajuste de −30', sin.base === con.base && sin.ventas90 === con.ventas90, { sin: sin.base, con: con.base })
}

console.log('\n=== 10. Pedido grande ===')
{
  const movs: MovimientoDiario[] = [entrada('A', -120, 1000)]
  for (let n = -89; n <= 0; n++) movs.push(venta('A', n, n === -20 ? 40 : 2))
  const { ritmo } = ritmoDe(movs, 'A', 1000 - 89 * 2 - 40)
  comprobar('tope 8: r90 = (89×2 + 8)/90', cerca(ritmo.r90, (89 * 2 + 8) / 90, 0.001), ritmo.r90)
  comprobar('recortado 32 de 218 (< 25 %): no es pedido grande', !ritmo.pedidoGrande)

  const movs2: MovimientoDiario[] = [entrada('A', -40, 1000)]
  for (let n = -19; n <= 0; n++) movs2.push(venta('A', n, n === -5 ? 40 : 2))
  const r2 = ritmoDe(movs2, 'A', 1000 - 19 * 2 - 40).ritmo
  comprobar('recortado 32 de 78 (> 25 %): pedido grande', r2.pedidoGrande)
  comprobar('la frase lo dice', r2.explicacion.includes('pedido de 40 ud el 10 nov'), r2.explicacion)
}

console.log('\n=== 14. Datos escasos ===')
{
  const movs: MovimientoDiario[] = [entrada('A', -10, 5), venta('A', -8, 1), venta('A', -3, 1)]
  const { ritmo } = ritmoDe(movs, 'A', 3)
  comprobar('confianza sin_datos', ritmo.confianza === 'sin_datos', ritmo.confianza)
  comprobar('diasConStock90 = 10', ritmo.diasConStock90 === 10, ritmo.diasConStock90)
  comprobar('«sin datos suficientes» en la frase', ritmo.explicacion.toLowerCase().includes('sin datos suficientes'), ritmo.explicacion)
}

console.log('\n=== 36. Serie de stock no fiable ===')
{
  const movs: MovimientoDiario[] = [entrada('A', -200, 50), entrada('A', -5, 100)] // 100 que no están en las vendibles
  for (let n = -199; n <= 0; n += 2) movs.push(venta('A', n, 1))
  const { ritmo, serie } = ritmoDe(movs, 'A', 0)
  comprobar('serie no fiable', serie.fiable === false && ritmo.serieDeStockFiable === false)
  comprobar('todos los días con stock desde la primera entrada: r90 ≈ 0,5', cerca(ritmo.r90, 0.5, 0.02), ritmo.r90)
  comprobar('diasConStock90 = 90', ritmo.diasConStock90 === 90, ritmo.diasConStock90)
  comprobar('confianza como mucho media', ritmo.confianza === 'media', ritmo.confianza)
}

console.log('\n=== Descuadre pequeño: se absorbe subiendo el ancla ===')
{
  // Se agotó entre -80 y -41 (1/3 del libro) y luego entraron 100; el listing dice 92 y el libro, 100 (8 reservadas)
  const movs: MovimientoDiario[] = [entrada('A', -120, 40)]
  for (let n = -120; n <= -81; n += 1) movs.push(venta('A', n, 1))
  movs.push(entrada('A', -40, 100))
  const { ritmo, serie } = ritmoDe(movs, 'A', 92)
  comprobar('serie fiable (sin absorber, 41 de 121 días saldrían a −8)', serie.fiable, ritmo.explicacion)
  comprobar('41 días sin stock (-80 a -40)', serie.conStock.filter((c) => c === false).length === 41, serie.conStock.filter((c) => c === false).length)
  comprobar('un descuadre grande no se absorbe', ritmoDe(movs, 'A', 40).serie.fiable === false)
}

console.log('\n=== 43. Estacionalidad por semana: el pico no cubre enero ===')
{
  const movs: MovimientoDiario[] = [entrada('A', -200, 2000)]
  for (let n = -150; n <= 0; n++) movs.push(venta('A', n, 2))
  const perfil = new Array<number>(54).fill(1)
  perfil[48] = 5.8
  perfil[1] = 0.2
  const vend = 2000 - 151 * 2
  const enero = ritmoDe(movs, 'A', vend, { perfil, origenPerfil: 'sku', picoAnoPasado: 5.8, horizonte: ['2027-01-04', '2027-01-10'] }).ritmo
  comprobar('semana 1 de 2027 es la ISO 1', semanaIso('2027-01-04') === 1)
  comprobar('enero: previsto = base × 0,2', cerca(enero.previsto, enero.base! * 0.2, 0.001), { base: enero.base, previsto: enero.previsto })
  comprobar('enero: el factor no es el del pico', enero.factorEstacional < 1, enero.factorEstacional)
  const bf = ritmoDe(movs, 'A', vend, { perfil, origenPerfil: 'sku', picoAnoPasado: 5.8, horizonte: ['2026-11-23', '2026-11-29'] }).ritmo
  comprobar('Black Friday: topado a 1,8', cerca(bf.previsto, bf.base! * 1.8, 0.001) && bf.factorEstacional === 1.8, { base: bf.base, previsto: bf.previsto })
  comprobar('perfil guardado: semana 48 = 1,8 y semana 1 = 0,2', bf.perfilSemanal![48] === 1.8 && cerca(bf.perfilSemanal![1], 0.2, 0.001))
  comprobar('la frase dice ×5,8 y ×1,8', bf.explicacion.includes('×5,8') && bf.explicacion.includes('×1,8'), bf.explicacion)
  comprobar('picoAnoPasado sin topar', bf.picoAnoPasado === 5.8)
  comprobar('consumoDelDia en Black Friday = base × 1,8', cerca(consumoDelDia(bf, '2026-11-25'), bf.base! * 1.8, 0.001))
}

console.log('\n=== Perfil semanal y del cliente ===')
{
  comprobar('menos de 12 ud: null', perfilSemanal([{ fecha: '2025-11-28', unidades: 11 }]) === null)
  const dias: Array<{ fecha: string; unidades: number }> = []
  for (let n = 0; n < 365; n++) {
    const f = sumarDias('2025-11-16', n)
    const w = semanaIso(f)
    dias.push({ fecha: f, unidades: w === 48 ? 60 : w === 51 ? 70 : 4 })
  }
  const p = perfilSemanal(dias)!
  const media = p.perfil.slice(1, 53).reduce((a, b) => a + b, 0) / 52
  comprobar('media 1', cerca(media, 1, 0.001), media)
  comprobar('54 posiciones (1..53)', p.perfil.length === 54)
  const semanaPico = p.perfil.indexOf(Math.max(...p.perfil.slice(1)))
  comprobar('pico en la semana 51 y > 3', p.pico > 3 && semanaPico === 51, { pico: p.pico, semanaPico })
  comprobar('enero por debajo de 1', p.perfil[3] < 1, p.perfil[3])
  const poco = perfilSemanal([{ fecha: '2025-11-28', unidades: 12 }])!
  comprobar('con 12 ud en una semana, casi plano (pico < 1,5)', poco.pico < 1.5, poco.pico)
  const cli = perfilDelCliente([{ perfil: p.perfil, peso: 3 }, { perfil: new Array(54).fill(1), peso: 1 }])!
  comprobar('perfil del cliente con media 1', cerca(cli.slice(1, 53).reduce((a, b) => a + b, 0) / 52, 1, 0.001))
  comprobar('perfil del cliente entre plano y el del SKU', cli[48] > 1 && cli[48] < p.perfil[48])
  comprobar('sin perfiles: null', perfilDelCliente([]) === null)
}

console.log('\n=== 44. Agotado largo: el último periodo con stock ===')
{
  const movs: MovimientoDiario[] = [entrada('A', -364, 245)]
  for (let n = -364; n <= -120; n++) movs.push(venta('A', n, 1))
  const { ritmo } = ritmoDe(movs, 'A', 0)
  comprobar('origen ultimo_periodo', ritmo.origen === 'ultimo_periodo', ritmo.origen)
  comprobar('ritmo ≈ 1 ud/día', cerca(ritmo.base, 1, 0.01), ritmo.base)
  comprobar('confianza baja', ritmo.confianza === 'baja', ritmo.confianza)
  comprobar('hasta el 18 jul', ritmo.ultimoPeriodoHasta === dia(-120), ritmo.ultimoPeriodoHasta)
  comprobar('sin ventanas recientes', ritmo.r14 === null && ritmo.r30 === null && ritmo.r90 === null)
  comprobar('la frase lo dice', ritmo.explicacion.includes('último periodo con stock'), ritmo.explicacion)
}

console.log('\n=== 52. Anclaje con 9 días de atraso ===')
{
  const leido = dia(-9)
  const movs: MovimientoDiario[] = [entrada('A', -80, 162)]
  for (let n = -80; n <= -10; n += 2) movs.push(venta('A', n, 4))
  const { ritmo, serie } = ritmoDe(movs, 'A', 0, {}, leido)
  comprobar('anclaje estimado', serie.anclajeEstimado && ritmo.anclajeEstimado)
  comprobar('los 9 días sin libro: conStock null', serie.conStock.slice(-9).every((c) => c === null))
  comprobar('el día leído sí tiene libro', serie.conStock[serie.conStock.length - 10] !== null)
  comprobar('r30 sube como mucho un 5 % sobre 2', ritmo.r30 !== null && ritmo.r30 <= 2 * 1.05 && ritmo.r30 >= 1.9, ritmo.r30)
  // Sin anclaje (ancla en las vendibles) el último día sin venta saldría sin stock
  comprobar('frase de atraso', ritmo.explicacion.includes('atrasado'), ritmo.explicacion)
}

console.log('\n=== Bordes ===')
{
  // Libro corto: solo 40 días de libro; lo de antes no es «sin venta»
  const otros: MovimientoDiario[] = [venta('B', -39, 1)]
  const movs: MovimientoDiario[] = [...otros]
  for (let n = -39; n <= 0; n++) movs.push(venta('A', n, 1))
  const { ritmo, serie } = ritmoDe(movs, 'A', 100)
  comprobar('libro corto: días anteriores al libro en null', serie.conStock[0] === null && serie.conStock.filter((c) => c !== null).length === 40)
  comprobar('libro corto: r90 = 1 (40 días con stock)', cerca(ritmo.r90, 1, 0.001) && ritmo.diasConStock90 === 40, ritmo.r90)

  // Primera entrada reciente
  const nuevo: MovimientoDiario[] = [entrada('N', -9, 30), venta('B', -300, 1)]
  for (let n = -9; n <= 0; n++) nuevo.push(venta('N', n, 1))
  const rn = ritmoDe(nuevo, 'N', 20).ritmo
  comprobar('primera entrada hace 10 días: r14 = 1, sin r30', cerca(rn.r14, 1, 0.001) && rn.r30 === null, { r14: rn.r14, r30: rn.r30 })
  comprobar('primera entrada reciente: sin datos (10 días)', rn.confianza === 'sin_datos', rn.confianza)

  // Todo ceros
  const cero = ritmoDe([], 'Z', 0).ritmo
  comprobar('sin nada: base null, sin_datos', cero.base === null && cero.confianza === 'sin_datos', cero)
  const ceroStock = ritmoDe([], 'Z', 10).ritmo
  comprobar('con stock y sin ventas: base 0, sin_datos', ceroStock.base === 0 && ceroStock.confianza === 'sin_datos', ceroStock.base)
  comprobar('libro sin leer: sin_datos', ritmoDe(movs, 'A', 100, { libro: 'sin_leer' }).ritmo.confianza === 'sin_datos')
}

console.log('\n=== Confianza alta y tendencia ===')
{
  const movs: MovimientoDiario[] = [entrada('A', -120, 1000)]
  for (let n = -89; n <= 0; n++) movs.push(venta('A', n, n > -14 ? 3 : 1))
  const { ritmo } = ritmoDe(movs, 'A', 500)
  comprobar('confianza alta', ritmo.confianza === 'alta', ritmo.confianza)
  comprobar('tendencia sube', ritmo.tendencia === 'sube', ritmo.tendencia)
  comprobar('r14 entra topado a 2 × r90', ritmo.base !== null && ritmo.base < 0.3 * 3 + 0.4 * ritmo.r30! + 0.3 * ritmo.r90!, ritmo)
}

console.log('\n=== D12. Consumo neto: devoluciones vendibles (tope 0,3) y mermas ===')
{
  const movs: MovimientoDiario[] = [entrada('A', -120, 1000)]
  for (let n = -89; n <= 0; n++) movs.push(venta('A', n, 1))
  movs.push(mov('A', -10, 'CustomerReturns', 17), mov('A', -11, 'CustomerReturns', 5, 'CUSTOMER_DAMAGED'))
  movs.push(mov('A', -20, 'Adjustments', -12), mov('A', -20, 'Adjustments', 3), mov('A', -30, 'VendorReturns', -6))
  movs.push(mov('A', -30, 'VendorReturns', -9, 'DEFECTIVE'))
  const dm = devolucionesYMermas(movs, 'A', HOY)
  comprobar('devueltas vendibles 17 (las dañadas no)', dm.devolucionesVendibles90 === 17, dm)
  comprobar('mermas = 9 de ajustes + 6 retiradas vendibles = 15', dm.mermas90 === 15, dm)
  const { ritmo } = ritmoDe(movs, 'A', 800, dm)
  comprobar('tasa 17/90', cerca(ritmo.tasaDevolucionVendible, 17 / 90, 0.001), ritmo.tasaDevolucionVendible)
  comprobar('lo que se proyecta: sin la retirada y el ajuste de golpe topado (1 ud)', dm.mermasRecurrentes90 === 1, dm)
  comprobar('merma diaria 1/90 (no 15/90)', cerca(ritmo.mermaDiaria, 1 / 90, 0.001), ritmo.mermaDiaria)
  comprobar('consumo neto = previsto × (1 − tasa) + merma', cerca(ritmo.consumoNeto, ritmo.previsto! * (1 - 17 / 90) + 1 / 90, 0.001))
  comprobar('el aviso sigue contando las 15 ud brutas', /pierde 15 ud/.test(ritmo.explicacion), ritmo.explicacion)
  const tope = ritmoDe(movs, 'A', 800, { devolucionesVendibles90: 60, mermas90: 0 }).ritmo
  comprobar('la tasa se topa en 0,3', tope.tasaDevolucionVendible === 0.3, tope.tasaDevolucionVendible)
}

console.log('\n=== D12b. Una retirada de golpe no es demanda (CT93673 de Creative Toys) ===')
{
  const movs: MovimientoDiario[] = [entrada('A', -120, 200)]
  for (const n of [-80, -65, -50, -35, -20, -5]) movs.push(venta('A', n, 1))
  movs.push(mov('A', -40, 'VendorReturns', -95))
  const dm = devolucionesYMermas(movs, 'A', HOY)
  comprobar('bruto 95 para el aviso', dm.mermas90 === 95, dm)
  comprobar('nada que proyectar', dm.mermasRecurrentes90 === 0, dm)
  const { ritmo } = ritmoDe(movs, 'A', 20, dm)
  comprobar('merma diaria ≈ 0', ritmo.mermaDiaria < 0.02, ritmo.mermaDiaria)
  const consumo30 = ritmo.base === null ? 0 : (ritmo.base * (1 - ritmo.tasaDevolucionVendible) + ritmo.mermaDiaria) * 30
  comprobar('con 20 ud no se rompe en 30 días', consumo30 < 20, { consumo30, ritmo: ritmo.base })
}
{
  const movs: MovimientoDiario[] = [entrada('A', -120, 1000)]
  for (let n = -89; n <= 0; n++) movs.push(venta('A', n, 1))
  for (let w = 0; w < 13; w++) movs.push(mov('A', -(w * 7 + 2), 'Adjustments', -1))
  const dm = devolucionesYMermas(movs, 'A', HOY)
  comprobar('una merma de 1 ud cada semana sí se proyecta (13)', dm.mermasRecurrentes90 === 13, dm)
  const { ritmo } = ritmoDe(movs, 'A', 800, dm)
  comprobar('merma diaria 13/90', cerca(ritmo.mermaDiaria, 13 / 90, 0.001), ritmo.mermaDiaria)
  const muchas = ritmoDe(movs, 'A', 800, { ...dm, mermasRecurrentes90: 90 }).ritmo
  comprobar('topada al 30 % del ritmo base', cerca(muchas.mermaDiaria, 0.3 * muchas.base!, 0.001), muchas)
}

console.log('\n=== 5 y 45. Talla de ShoesF repartida por modelo ===')
{
  const ventasPorTalla: Record<string, number> = { '38': 3, '39': 5, '40': 8, '41': 7, '42': 5, '43': 3, '47': 0, '44': 12 }
  const movs: MovimientoDiario[] = []
  const vendibles: Record<string, number> = {}
  for (const [t, ud] of Object.entries(ventasPorTalla)) {
    const sku = `FBA035188-${t}`
    movs.push(entrada(sku, -200, 20))
    // Repartidas en los últimos 90 días
    for (let k = 0; k < ud; k++) movs.push(venta(sku, -Math.floor(((k + 0.5) * 90) / Math.max(ud, 1)), 1))
    vendibles[sku] = 20 - ud
  }
  const tallas = Object.entries(ventasPorTalla).map(([t, ud]) => {
    const sku = `FBA035188-${t}`
    return { sku, serie: serieDiaria(movs, sku, vendibles[sku], HOY, HOY), continuidad: t !== '44', ventas180: ud }
  })
  const porSku: Record<string, { primeraEntrada: string | null; devolucionesVendibles90: number; mermas90: number }> = {}
  for (const t of tallas) porSku[t.sku] = { primeraEntrada: dia(-200), devolucionesVendibles90: 0, mermas90: 0 }
  const { primeraEntrada: _p, devolucionesVendibles90: _d, mermas90: _m, ...comun } = OPC
  const m = ritmoPorModelo(tallas, { modelo: 'FBA035188', comun, porSku })
  const r38 = m.get('FBA035188-38')!
  const r39 = m.get('FBA035188-39')!
  comprobar('talla 38: origen modelo', r38.origen === 'modelo', r38.origen)
  comprobar('cuota (3+1)/(31+6) ≈ 10,8 % en la frase', r38.explicacion.includes('10,8 %'), r38.explicacion)
  comprobar('38/39 = 4/6 (Laplace)', cerca(r38.base! / r39.base!, 4 / 6, 0.001), { r38: r38.base, r39: r39.base })
  comprobar('confianza del modelo (≥ media)', r38.confianza === 'alta' || r38.confianza === 'media', r38.confianza)
  const r47 = m.get('FBA035188-47')!
  comprobar('45. talla 47 sin ventas en 180 d: cuota 0', r47.base === 0 && r47.origen === 'modelo' && r47.ventas180 === 0, r47)
  comprobar('45. la frase dice cuota 0', r47.explicacion.includes('cuota 0'), r47.explicacion)
  const r44 = m.get('FBA035188-44')!
  comprobar('descatalogada: su ritmo propio, fuera del reparto', r44.origen === 'sku', r44.origen)
  // Suma de las tallas repartidas ≈ ritmo del modelo (cuotas suman 1)
  const suma = tallas.filter((t) => t.continuidad).reduce((a, t) => a + (m.get(t.sku)!.base ?? 0), 0)
  comprobar('las cuotas suman 1: Σ tallas ≈ 31/90', cerca(suma, 31 / 90, 0.03), suma)
}

console.log('\n=== D6. Días-equivalentes: el modelo no cuenta un día porque quede una talla ===')
{
  // Dos tallas al 50 %: la A se agota los últimos 45 días; la B sigue
  const movs: MovimientoDiario[] = [entrada('M-A', -100, 44), entrada('M-B', -100, 200)]
  for (let n = -89; n <= 0; n++) {
    if (n <= -46) movs.push(venta('M-A', n, 1))
    movs.push(venta('M-B', n, 1))
  }
  const tallas = [
    { sku: 'M-A', serie: serieDiaria(movs, 'M-A', 0, HOY, HOY), continuidad: true, ventas180: 44 },
    { sku: 'M-B', serie: serieDiaria(movs, 'M-B', 110, HOY, HOY), continuidad: true, ventas180: 90 },
  ]
  const { primeraEntrada: _p, devolucionesVendibles90: _d, mermas90: _m, ...comun } = OPC
  const m = ritmoPorModelo(tallas, { modelo: 'M', comun })
  const a = m.get('M-A')!
  // Modelo: 134 ud en 90 d; días-eq = 44 × 1 + 46 × cuotaB (91/136) ≈ 74,8 → ≈ 1,79 ud/día (no 134/90 ≈ 1,49)
  const qa = 45 / 136
  comprobar('A (media) usa el ritmo del modelo × su cuota', a.origen === 'modelo', a.origen)
  const rB = m.get('M-B')!
  comprobar('B con confianza propia alta usa la suya (1 ud/día)', rB.origen === 'sku' && cerca(rB.base, 1, 0.01), rB)
  const esperado = 134 / (44 + 46 * (91 / 136))
  comprobar('r90 del modelo = 134 / días-equivalentes ≈ 1,79 (no 134/90)', cerca(a.r90! / qa, esperado, 0.01), { real: a.r90! / qa, esperado })
}

console.log('\n=== Perfil de un SKU lanzado hace 7 meses (las semanas sin stock no son «demanda cero») ===')
{
  // Vende 5 ud/día desde el 15 abr 2026; antes no existía (sin stock). El año va del 16 nov 2025 al 15 nov 2026.
  const lanzamiento = '2026-04-15'
  const ventas: Array<{ fecha: string; unidades: number }> = []
  const sinStock: string[] = []
  for (let n = 0; n < 365; n++) {
    const f = sumarDias('2025-11-16', n)
    if (f < lanzamiento) sinStock.push(f)
    else ventas.push({ fecha: f, unidades: 5 })
  }
  const crudo = perfilSemanal(ventas)!
  comprobar('(sin decirle los días sin stock, diciembre sale hundido)', crudo.perfil[51] < 0.6, crudo.perfil[51])
  const bien = perfilSemanal(ventas, { diasSinStock: sinStock })
  // 30 semanas con stock: o no hay perfil propio (el plan usa el del cliente) o diciembre queda neutro
  const dic = bien ? bien.perfil[51] : 1
  const bf = bien ? bien.perfil[48] : 1
  comprobar('con los días sin stock, diciembre no baja (≥ 0,9)', dic >= 0.9 && bf >= 0.9, { dic, bf, hay: !!bien })
  const tresMeses = perfilSemanal(ventas.filter((d) => d.fecha >= '2026-08-15'), { diasSinStock: [...sinStock, ...ventas.filter((d) => d.fecha < '2026-08-15').map((d) => d.fecha)] })
  comprobar('con menos de 30 semanas con stock no hay perfil propio', tresMeses === null)
}

console.log('\n=== 24 nov 2026. Un modelo que se agotó hace poco sigue mandando sobre sus tallas (F0047 BURDEOS de ShoesF) ===')
{
  // 4 tallas con 6 pares cada una desde hace 60 días; cada talla vende 1 cada 5 días y se agota hace ~34: 24 pares del modelo, nada en el último mes
  const movs: MovimientoDiario[] = []
  const tallas = ['38', '39', '40', '41'].map((t) => {
    const sku = `F0047-${t}`
    movs.push(entrada(sku, -60, 6))
    for (let k = 0; k < 6; k++) movs.push(venta(sku, -59 + k * 5, 1))
    return sku
  })
  const { primeraEntrada: _p, devolucionesVendibles90: _d, mermas90: _m, ...comun } = OPC
  const m = ritmoPorModelo(
    tallas.map((sku) => ({ sku, serie: serieDiaria(movs, sku, 0, HOY, HOY), continuidad: true, ventas180: 6 })),
    { modelo: 'F0047', comun, porSku: Object.fromEntries(tallas.map((sku) => [sku, { primeraEntrada: dia(-60), devolucionesVendibles90: 0, mermas90: 0 }])) },
  )
  const propia = ritmoRobusto(serieDiaria(movs, tallas[0], 0, HOY, HOY), { ...OPC, primeraEntrada: dia(-60) })
  comprobar('la talla suelta, sola, es «último periodo» con confianza baja (6 ventas)', propia.origen === 'ultimo_periodo' && propia.confianza === 'baja', propia)
  const r = tallas.map((sku) => m.get(sku)!)
  comprobar('todas las tallas usan el ritmo del modelo', r.every((x) => x.deModelo === true), r.map((x) => x.origen))
  comprobar('con la confianza del modelo (24 pares en sus días-equivalentes): media, no baja', r.every((x) => x.confianza === 'media'), r.map((x) => x.confianza))
  comprobar('agotadas: cada talla lleva SU fecha de último stock, para que el planificador pregunte por talla si lleva mucho', r.every((x) => x.origen === 'ultimo_periodo' && x.ultimoPeriodoHasta === propia.ultimoPeriodoHasta), r.map((x) => x.ultimoPeriodoHasta))
  const suma = r.reduce((a, x) => a + (x.base ?? 0), 0)
  comprobar('y las cuotas reparten el ritmo entero del modelo (4 × la de una talla)', cerca(suma, 4 * (r[0].base ?? 0), 0.001) && suma > 0, suma)
}

console.log(`\n${fallos === 0 ? 'TODO OK' : `${fallos} FALLOS`}`)
process.exit(fallos === 0 ? 0 : 1)
