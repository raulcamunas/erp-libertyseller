import { coberturaDias, decisionDeStock, PAISES_EFN, pausasYaHechas, posturasPorStock, puedeReactivar, stockDeAsin, stockEfectivo, topeDePosturaPorStock } from './stock-calculo'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/** STOCK POR ASIN, EFN, COBERTURA Y DECISIÓN DE PAUSA */

const H = 3_600_000
const AHORA = Date.parse('2026-11-15T14:30:00Z')
const hace = (h: number) => new Date(AHORA - h * H).toISOString()

console.log('\n=== stock por ASIN ===')
{
  const m = stockDeAsin([
    { asin: 'B0AAA', isFba: true, quantity: null, fbaDisponible: 10, updatedAt: hace(1) },
    { asin: 'B0AAA', isFba: true, quantity: null, fbaDisponible: 7, updatedAt: hace(3) },
    { asin: 'B0BBB', isFba: false, quantity: 4, fbaDisponible: 99, updatedAt: hace(1) },
    { asin: 'B0CCC', isFba: true, quantity: 50, fbaDisponible: null, updatedAt: hace(1) },
    { asin: null, isFba: true, quantity: null, fbaDisponible: 5, updatedAt: hace(1) },
  ])
  ok('dos SKU de un ASIN se suman (10 + 7 = 17)', m.get('B0AAA')?.stock === 17, JSON.stringify(m.get('B0AAA')))
  ok('… con la fecha de la fila más vieja', m.get('B0AAA')?.actualizadoAt === hace(3))
  ok('no FBA → quantity (4, no 99)', m.get('B0BBB')?.stock === 4)
  ok('FBA sin «Disponible» → null (no se usa quantity)', m.get('B0CCC')?.stock === null)
  ok('filas sin ASIN fuera', m.size === 3)
  const t = stockDeAsin([{ asin: 'B0TTT', isFba: true, quantity: 0, fbaDisponible: 56, updatedAt: hace(1) }])
  ok('FBA con 0 disponible + 56 en transferencia (ya sumado en fbaDisponible) → 56', t.get('B0TTT')?.stock === 56)
  const d = decisionDeStock({ stock: t.get('B0TTT')!.stock, ceroDesde: hace(10), lecturasCero: 3, listingAt: hace(1), ahora: AHORA, campanaGastaHoy: true, asinsEnCampana: 1 })
  ok('… y no pausa', d.decision === 'nada', JSON.stringify(d))
  const mix = stockDeAsin([
    { asin: 'B0MIX', isFba: true, quantity: null, fbaDisponible: null, updatedAt: hace(1) },
    { asin: 'B0MIX', isFba: true, quantity: null, fbaDisponible: 3, updatedAt: hace(2) },
  ])
  ok('una fila sin número y otra con 3 → 3', mix.get('B0MIX')?.stock === 3)
  ok('… la fecha es la de la fila que aporta número (la sin número no cuenta)', mix.get('B0MIX')?.actualizadoAt === hace(2), JSON.stringify(mix.get('B0MIX')))

  // Un SKU viejo (retirado, el sync ya no lo actualiza: 30 días) junto a uno fresco: la frescura es la del fresco; su número se sigue sumando
  const muerto = stockDeAsin([
    { asin: 'B0OLD', isFba: true, quantity: null, fbaDisponible: 0, updatedAt: hace(1) },
    { asin: 'B0OLD', isFba: false, quantity: 0, fbaDisponible: null, updatedAt: hace(30 * 24) },
  ])
  ok('SKU muerto (30 días) + SKU fresco (1 h) → fecha la del fresco', muerto.get('B0OLD')?.actualizadoAt === hace(1), JSON.stringify(muerto.get('B0OLD')))
  ok('… y el listing cuenta como fresco: con dos lecturas a 0, pausa', decisionDeStock({ stock: muerto.get('B0OLD')!.stock, ceroDesde: hace(7), lecturasCero: 2, listingAt: muerto.get('B0OLD')!.actualizadoAt, ahora: AHORA, campanaGastaHoy: true, asinsEnCampana: 1 }).decision === 'pausar_campana')
  const conStock = stockDeAsin([
    { asin: 'B0OL2', isFba: true, quantity: null, fbaDisponible: 0, updatedAt: hace(1) },
    { asin: 'B0OL2', isFba: false, quantity: 4, fbaDisponible: null, updatedAt: hace(30 * 24) },
  ])
  ok('el número del SKU muerto se suma (ante la duda, más stock: no se pausa)', conStock.get('B0OL2')?.stock === 4 && conStock.get('B0OL2')?.actualizadoAt === hace(1), JSON.stringify(conStock.get('B0OL2')))
  const seisDias = stockDeAsin([
    { asin: 'B0SEI', isFba: true, quantity: null, fbaDisponible: 2, updatedAt: hace(1) },
    { asin: 'B0SEI', isFba: true, quantity: null, fbaDisponible: 2, updatedAt: hace(6 * 24) },
  ])
  ok('dos SKU vivos (1 h y 6 días) → la fecha sigue siendo la más vieja', seisDias.get('B0SEI')?.actualizadoAt === hace(6 * 24))
}

console.log('\n=== EFN ===')
{
  ok('PAISES_EFN = FR, DE, IT, NL, BE, SE, PL', PAISES_EFN.join(',') === 'FR,DE,IT,NL,BE,SE,PL')
  const es = { stock: 300, actualizadoAt: hace(2) }
  const fr = stockEfectivo({ stock: 0, actualizadoAt: hace(1) }, es, 'FR')
  ok('FR con 0 y ES con 300 → 300', fr.stock === 300 && fr.actualizadoAt === hace(2), JSON.stringify(fr))
  ok('… y la fuente lo dice', /ES/.test(fr.fuente) && /EFN/.test(fr.fuente), fr.fuente)
  ok('DE sin dato → el de ES', stockEfectivo(undefined, es, 'de').stock === 300)
  ok('FR con 12 propios → 12', stockEfectivo({ stock: 12, actualizadoAt: hace(1) }, es, 'FR').stock === 12)
  ok('ES con 0 → 0 (no es EFN)', stockEfectivo({ stock: 0, actualizadoAt: hace(1) }, es, 'ES').stock === 0)
  ok('UK (no EFN) con 0 → 0', stockEfectivo({ stock: 0, actualizadoAt: hace(1) }, es, 'UK').stock === 0)
  ok('FR con 0 y ES sin dato → 0', stockEfectivo({ stock: 0, actualizadoAt: hace(1) }, { stock: null, actualizadoAt: null }, 'FR').stock === 0)
}

console.log('\n=== cobertura ===')
ok('70 unidades con 14 vendidas en 14 d → 70 días', coberturaDias(70, 14) === 70)
ok('sin ventas → null', coberturaDias(70, 0) === null && coberturaDias(70, null) === null)
ok('stock desconocido → null', coberturaDias(null, 14) === null)

console.log('\n=== decisión de pausa ===')
{
  const base = { stock: 0, ceroDesde: hace(6.5), lecturasCero: 2, listingAt: hace(1), ahora: AHORA, campanaGastaHoy: true, asinsEnCampana: 1 }
  const una = decisionDeStock({ ...base, lecturasCero: 1, ceroDesde: hace(0) })
  ok('una sola lectura cero → solo_recortar', una.decision === 'solo_recortar' && /una lectura/.test(una.porque), JSON.stringify(una))
  const dos = decisionDeStock(base)
  ok('dos separadas 6 h con listing fresco y gasto → pausar_campana', dos.decision === 'pausar_campana', JSON.stringify(dos))
  ok('campaña con 3 ASIN → pausar_anuncio', decisionDeStock({ ...base, asinsEnCampana: 3 }).decision === 'pausar_anuncio')
  ok('dos lecturas a 0 pero solo 5 h entre ellas → solo_recortar', decisionDeStock({ ...base, ceroDesde: hace(5) }).decision === 'solo_recortar')
  const viejo = decisionDeStock({ ...base, listingAt: hace(7) })
  ok('listing de hace 7 h → solo_recortar (y dice por qué)', viejo.decision === 'solo_recortar' && /inventario/.test(viejo.porque), viejo.porque)
  ok('la campaña no gasta hoy → solo_recortar', decisionDeStock({ ...base, campanaGastaHoy: false }).decision === 'solo_recortar')
  ok('stock desconocido → nada', decisionDeStock({ ...base, stock: null }).decision === 'nada')
  ok('stock 3 → nada', decisionDeStock({ ...base, stock: 3 }).decision === 'nada')
}

console.log('\n=== reactivar ===')
{
  const base = { stock: 8, listingAt: hace(1), ahora: AHORA, cambiosManualesDesdeLaPausa: 0 }
  ok('stock 8 fresco y sin cambios → reactivar', puedeReactivar(base).reactivar === true)
  const mano = puedeReactivar({ ...base, cambiosManualesDesdeLaPausa: 1 })
  ok('reactivación con cambio manual → no', mano.reactivar === false && /a mano/.test(mano.porque), JSON.stringify(mano))
  ok('stock 4 → no', puedeReactivar({ ...base, stock: 4 }).reactivar === false)
  ok('stock 5 → sí', puedeReactivar({ ...base, stock: 5 }).reactivar === true)
  ok('lectura de hace 8 h → no', puedeReactivar({ ...base, listingAt: hace(8) }).reactivar === false)
}

console.log('\n=== tope de postura ===')
ok('cobertura 5 días → recortar', topeDePosturaPorStock(20, 5).maximo === 'recortar')
ok('stock 0 → recortar', topeDePosturaPorStock(0, null).maximo === 'recortar')
ok('cobertura 10 días → mantener', topeDePosturaPorStock(20, 10).maximo === 'mantener')
ok('stock desconocido → mantener', topeDePosturaPorStock(null, null).maximo === 'mantener')
ok('cobertura 30 días → crecer sin porqué', (() => { const t = topeDePosturaPorStock(100, 30); return t.maximo === 'crecer' && t.porque === null })())
ok('stock conocido sin ventas → sin tope', topeDePosturaPorStock(100, null).maximo === 'crecer')

console.log('\n=== postura «recortar» por stock (vigilar, sin esperar al cerebro) ===')
{
  const guardadas = new Map<string, 'crecer' | 'mantener' | 'recortar'>([['B0AAA', 'crecer'], ['B0BBB', 'recortar']])
  const r = posturasPorStock([{ asin: 'b0aaa', porque: 'la campaña no gasta hoy' }, { asin: 'B0BBB', porque: 'x' }, { asin: 'B0CCC', porque: 'y' }, { asin: 'B0AAA', porque: 'repetido' }], guardadas)
  ok('crecer → recortar (con la postura de antes)', r.some((x) => x.asin === 'B0AAA' && x.antes === 'crecer' && /Sin stock/.test(x.motivo)), JSON.stringify(r))
  ok('el que ya está en recortar no se reescribe', !r.some((x) => x.asin === 'B0BBB'))
  ok('sin postura guardada → se guarda recortar', r.some((x) => x.asin === 'B0CCC' && x.antes === null))
  ok('sin repetidos', r.length === 2)
}

console.log('\n=== pausas por stock ya hechas (la ensayada no se repite en el ensayo) ===')
{
  const enc = hace(48)
  const filas = [
    { tipo: 'pausar-campana', campaign_id: 'c1', objetivo_id: null, objetivo_tipo: null, estado: 'ensayada', agente_at: hace(2) },
    { tipo: 'pausar', campaign_id: 'c2', objetivo_id: 'ad9', objetivo_tipo: 'anuncio', estado: 'ensayada', agente_at: hace(3) },
    { tipo: 'pausar-campana', campaign_id: 'c3', objetivo_id: null, objetivo_tipo: null, estado: 'ensayada', agente_at: hace(100) }, // de un ensayo anterior
    { tipo: 'pausar-campana', campaign_id: 'c4', objetivo_id: null, objetivo_tipo: null, estado: 'aplicada', agente_at: hace(100) },
    { tipo: 'pausar-campana', campaign_id: 'c5', objetivo_id: null, objetivo_tipo: null, estado: 'descartada', agente_at: hace(1) },
  ]
  const e = pausasYaHechas(filas, 'ensayo', enc, AHORA)
  ok('en ensayo, la campaña ya ensayada no se vuelve a proponer', e.campanas.has('c1'))
  ok('en ensayo, el anuncio ya ensayado tampoco', e.anuncios.has('ad9'))
  ok('una ensayada de antes de encender no cuenta', !e.campanas.has('c3'))
  ok('la aplicada cuenta siempre', e.campanas.has('c4'))
  ok('la descartada no cuenta', !e.campanas.has('c5'))
  const a = pausasYaHechas(filas, 'activo', enc, AHORA)
  ok('en activo, una ensayada NO cuenta (se pausa de verdad)', !a.campanas.has('c1') && !a.anuncios.has('ad9') && a.campanas.has('c4'))
  const sinEnc = pausasYaHechas(filas, 'ensayo', null, AHORA)
  ok('sin fecha de encendido: solo las ensayadas de las últimas 24 h', sinEnc.campanas.has('c1') && !sinEnc.campanas.has('c3'))
}

console.log(fallos === 0 ? '\nTODO OK' : `\n${fallos} FALLOS`)
process.exit(fallos === 0 ? 0 : 1)
