import { calibrar, desdeDeCalibrar, limitesDeCalibracion, PARAMETROS_POR_CLASE } from './calibrar-calculo'
import type { ClaseDeCambio, Veredicto } from './tipos'
import { UMBRALES_DE_PARTIDA, type UmbralesEstimados } from '../umbrales'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/** n veredictos de una clase con el reparto dado */
const lote = (clase: ClaseDeCambio, reparto: Partial<Record<Veredicto, number>>) => {
  const salida: Array<{ clase: ClaseDeCambio; veredicto: Veredicto }> = []
  for (const [v, n] of Object.entries(reparto) as Array<[Veredicto, number]>) for (let i = 0; i < n; i++) salida.push({ clase, veredicto: v })
  return salida
}
const U = (cambios: Partial<UmbralesEstimados> = {}): UmbralesEstimados => ({ ...UMBRALES_DE_PARTIDA, ...cambios })

console.log('\n=== parámetros por clase ===')
ok('presupuesto_subir no se calibra', PARAMETROS_POR_CLASE.presupuesto_subir === undefined)
ok('puja_subir mueve subirPujaPct y luego subirSiAcosBajoX', PARAMETROS_POR_CLASE.puja_subir?.map((p) => p.clave).join(',') === 'subirPujaPct,subirSiAcosBajoX')
ok('el ACoS objetivo no está en ninguna clase', !Object.values(PARAMETROS_POR_CLASE).some((ps) => ps?.some((p) => String(p.clave).toLowerCase().includes('objetivo'))))

console.log('\n=== límites ===')
{
  const l = limitesDeCalibracion('subirPujaPct')
  ok('subirPujaPct: de 7,5 a 22,5 (±50 % de 15)', l.min === 7.5 && l.max === 22.5, JSON.stringify(l))
  const b = limitesDeCalibracion('pujaMaxBajadaPct')
  ok('pujaMaxBajadaPct: tope 25 aunque ±50 % de 25 diga 37,5', b.min === 12.5 && b.max === 25, JSON.stringify(b))
  const x = limitesDeCalibracion('subirSiAcosBajoX')
  ok('subirSiAcosBajoX: de 0,35 a 1 (el max de la ficha corta el +50 %)', x.min === 0.35 && x.max === 1, JSON.stringify(x))
  const s = limitesDeCalibracion('bajarSiAcosSobreX')
  ok('bajarSiAcosSobreX: de 1 (min de la ficha) a 1,8', s.min === 1 && s.max === 1.8, JSON.stringify(s))
}

console.log('\n=== falta de muestra ===')
{
  const r = calibrar(U(), lote('puja_subir', { mejoro: 19 }))
  ok('19 veredictos, todos «mejoró» → nada', r.cambios.length === 0 && r.umbrales.subirPujaPct === 15)
  const m = calibrar(U(), [...lote('puja_subir', { mejoro: 15, neutro: 4 }), ...lote('puja_subir', { mezclado: 10, sin_muestra: 10 })])
  ok('19 que cuentan + 20 mezclados/sin muestra → nada (se ignoran)', m.cambios.length === 0, JSON.stringify(m.cambios))
  const otra = calibrar(U(), [...lote('puja_subir', { mejoro: 10 }), ...lote('puja_bajar', { mejoro: 10 })])
  ok('las clases no se suman entre sí', otra.cambios.length === 0)
  const nada = calibrar(U(), [])
  ok('sin veredictos → umbrales iguales', nada.cambios.length === 0 && JSON.stringify(nada.umbrales) === JSON.stringify(U()))
}

console.log('\n=== mezclados ignorados en la proporción ===')
{
  // 12 mejoró + 8 neutro = 60 % (los 30 mezclados no bajan la proporción)
  const r = calibrar(U(), [...lote('puja_subir', { mejoro: 12, neutro: 8 }), ...lote('puja_subir', { mezclado: 30 })])
  ok('12 de 20 mejoraron con 30 mezclados → sube un paso', r.cambios.length === 1 && r.umbrales.subirPujaPct === 20, JSON.stringify(r.cambios))
  const e = calibrar(U(), [...lote('puja_subir', { mejoro: 11, neutro: 9 }), ...lote('puja_subir', { sin_muestra: 5 })])
  ok('11 de 20 (55 %) → nada', e.cambios.length === 0)
}

console.log('\n=== puja_subir ===')
{
  const u = U()
  const r = calibrar(u, lote('puja_subir', { mejoro: 14, neutro: 4, empeoro: 2 }))
  ok('14 de 20 mejoraron → subirPujaPct 15 → 20', r.umbrales.subirPujaPct === 20 && r.cambios.length === 1)
  ok('motivo en español', r.cambios[0]?.motivo === 'subirPujaPct 15 → 20 (14 de 20 mejoraron)', r.cambios[0]?.motivo)
  ok('antes/después', r.cambios[0]?.antes === 15 && r.cambios[0]?.despues === 20)
  ok('no toca el objeto de entrada', u.subirPujaPct === 15)
  ok('un solo parámetro por clase (subirSiAcosBajoX sigue igual)', r.umbrales.subirSiAcosBajoX === 0.7)

  const r2 = calibrar(r.umbrales, lote('puja_subir', { mejoro: 14, neutro: 6 }))
  ok('desde 20, 25 pasaría de 22,5 → mueve subirSiAcosBajoX 0,7 → 0,75', r2.umbrales.subirPujaPct === 20 && r2.umbrales.subirSiAcosBajoX === 0.75, JSON.stringify(r2.cambios))
  ok('motivo con coma decimal', r2.cambios[0]?.motivo === 'subirSiAcosBajoX 0,7 → 0,75 (14 de 20 mejoraron)', r2.cambios[0]?.motivo)

  const p = calibrar(U(), lote('puja_subir', { empeoro: 8, neutro: 12 }))
  ok('8 de 20 empeoraron → subirPujaPct 15 → 10', p.umbrales.subirPujaPct === 10 && p.cambios[0]?.motivo === 'subirPujaPct 15 → 10 (8 de 20 empeoraron)', p.cambios[0]?.motivo)
  const p2 = calibrar(p.umbrales, lote('puja_subir', { empeoro: 10, neutro: 10 }))
  ok('desde 10, 5 bajaría de 7,5 → subirSiAcosBajoX 0,7 → 0,65', p2.umbrales.subirPujaPct === 10 && p2.umbrales.subirSiAcosBajoX === 0.65, JSON.stringify(p2.cambios))

  const ambos = calibrar(U(), lote('puja_subir', { mejoro: 12, empeoro: 8 }))
  ok('60 % mejoró y 40 % empeoró a la vez → gana la prudencia (15 → 10)', ambos.umbrales.subirPujaPct === 10, JSON.stringify(ambos.cambios))
  const neutros = calibrar(U(), lote('puja_subir', { mejoro: 10, empeoro: 7, neutro: 3 }))
  ok('50 % mejoró y 35 % empeoró → nada', neutros.cambios.length === 0)
}

console.log('\n=== puja_bajar ===')
{
  const a = calibrar(U(), lote('puja_bajar', { mejoro: 15, neutro: 5 }))
  ok('más agresivo: pujaMaxBajadaPct ya está en 25 (tope) → bajarSiAcosSobreX 1,2 → 1,15', a.umbrales.pujaMaxBajadaPct === 25 && a.umbrales.bajarSiAcosSobreX === 1.15, JSON.stringify(a.cambios))
  const p = calibrar(U(), lote('puja_bajar', { empeoro: 9, neutro: 11 }))
  ok('más prudente: pujaMaxBajadaPct 25 → 20', p.umbrales.pujaMaxBajadaPct === 20 && p.umbrales.bajarSiAcosSobreX === 1.2, JSON.stringify(p.cambios))
  const s = calibrar(U({ pujaMaxBajadaPct: 20 }), lote('puja_bajar', { mejoro: 15, neutro: 5 }))
  ok('desde 20, más agresivo → 25 (llega al tope, no lo pasa)', s.umbrales.pujaMaxBajadaPct === 25)
}

console.log('\n=== tope de 25 ===')
{
  const humano = calibrar(U({ pujaMaxBajadaPct: 30 }), lote('puja_bajar', { mejoro: 20 }))
  ok('una persona lo dejó en 30: más agresivo no lo sube a 35 (pasa al siguiente parámetro)', humano.umbrales.pujaMaxBajadaPct === 30 && humano.umbrales.bajarSiAcosSobreX === 1.15, JSON.stringify(humano.cambios))
  const baja = calibrar(U({ pujaMaxBajadaPct: 30 }), lote('puja_bajar', { empeoro: 20 }))
  ok('… y más prudente lo baja a 25', baja.umbrales.pujaMaxBajadaPct === 25)
  const sp = calibrar(U({ bajarSinPedidosPct: 20 }), lote('puja_bajar_sin_pedidos', { mejoro: 20 }))
  ok('bajarSinPedidosPct 20 → 25 no (pasa de 22,5) → nada', sp.cambios.length === 0 && sp.umbrales.bajarSinPedidosPct === 20)
  const sp2 = calibrar(U(), lote('puja_bajar_sin_pedidos', { mejoro: 20 }))
  ok('bajarSinPedidosPct 15 → 20', sp2.umbrales.bajarSinPedidosPct === 20 && sp2.cambios[0]?.motivo === 'bajarSinPedidosPct 15 → 20 (20 de 20 mejoraron)', sp2.cambios[0]?.motivo)
  const sp3 = calibrar(U(), lote('puja_bajar_sin_pedidos', { empeoro: 8, neutro: 12 }))
  ok('bajarSinPedidosPct más prudente 15 → 10', sp3.umbrales.bajarSinPedidosPct === 10)
}

console.log('\n=== negativizar ===')
{
  const a = calibrar(U(), lote('negativizar', { mejoro: 13, neutro: 7 }))
  ok('más agresivo: negativizarClicsPorCvr 3 → 2,5', a.umbrales.negativizarClicsPorCvr === 2.5 && a.cambios[0]?.motivo === 'negativizarClicsPorCvr 3 → 2,5 (13 de 20 mejoraron)', a.cambios[0]?.motivo)
  const p = calibrar(U(), lote('negativizar', { empeoro: 8, neutro: 12 }))
  ok('más prudente: 3 → 3,5', p.umbrales.negativizarClicsPorCvr === 3.5)
  const tope = calibrar(U({ negativizarClicsPorCvr: 4.5 }), lote('negativizar', { empeoro: 20 }))
  ok('desde 4,5, 5 pasaría del +50 % → nada', tope.cambios.length === 0)
}

console.log('\n=== clases que no se calibran ===')
{
  const r = calibrar(U(), [...lote('presupuesto_subir', { mejoro: 30 }), ...lote('presupuesto_bajar', { empeoro: 30 }), ...lote('promover', { mejoro: 30 }), ...lote('pausar', { mejoro: 30 })])
  ok('presupuesto, promover y pausar → nada', r.cambios.length === 0 && JSON.stringify(r.umbrales) === JSON.stringify(U()))
}

console.log('\n=== varias clases a la vez ===')
{
  const r = calibrar(U(), [...lote('puja_subir', { mejoro: 20 }), ...lote('negativizar', { empeoro: 20 }), ...lote('puja_bajar_sin_pedidos', { mejoro: 20 })])
  ok('cada clase mueve su parámetro (3 cambios)', r.cambios.length === 3 && r.umbrales.subirPujaPct === 20 && r.umbrales.negativizarClicsPorCvr === 3.5 && r.umbrales.bajarSinPedidosPct === 20, JSON.stringify(r.cambios))
}

console.log('\n=== nunca más del ±50 % (ni del tope) tras muchos ciclos ===')
{
  for (const sentido of ['mejoro', 'empeoro'] as const) {
    let u = U()
    for (let i = 0; i < 40; i++) {
      const v = (['puja_subir', 'puja_bajar', 'puja_bajar_sin_pedidos', 'negativizar'] as ClaseDeCambio[]).flatMap((c) => lote(c, { [sentido]: 25 }))
      u = calibrar(u, v).umbrales
    }
    let dentro = true
    let detalle = ''
    for (const clase of Object.keys(PARAMETROS_POR_CLASE) as ClaseDeCambio[]) {
      for (const p of PARAMETROS_POR_CLASE[clase] ?? []) {
        const partida = UMBRALES_DE_PARTIDA[p.clave]
        const valor = u[p.clave]
        const lim = limitesDeCalibracion(p.clave)
        if (valor < partida * 0.5 - 1e-9 || valor > partida * 1.5 + 1e-9 || valor < lim.min - 1e-9 || valor > lim.max + 1e-9) {
          dentro = false
          detalle += `${p.clave}=${valor} `
        }
      }
    }
    ok(`40 ciclos «${sentido}»: todo dentro de ±50 %, min/max y ≤ 25`, dentro, detalle)
    ok(`… y los porcentajes de puja ≤ 25 («${sentido}»)`, u.subirPujaPct <= 25 && u.pujaMaxBajadaPct <= 25 && u.bajarSinPedidosPct <= 25)
    ok(`… valores limpios, sin restos de coma flotante («${sentido}»)`, [u.subirSiAcosBajoX, u.bajarSiAcosSobreX, u.negativizarClicsPorCvr].every((x) => Math.round(x * 100) / 100 === x), JSON.stringify(u))
  }
}

console.log('\n=== cada veredicto cuenta en UN ciclo ===')
{
  const ahora = Date.parse('2026-11-15T12:00:00Z')
  const anterior = '2026-10-18T12:00:00Z' // hace 28 días
  ok('con calibración anterior hace 28 días → desde esa calibración (no 60 días)', desdeDeCalibrar(ahora, anterior) === new Date(anterior).toISOString(), desdeDeCalibrar(ahora, anterior))
  ok('sin calibración anterior → 60 días', desdeDeCalibrar(ahora, null) === new Date(ahora - 60 * 86_400_000).toISOString())
  ok('calibración anterior de hace 90 días → 60 días', desdeDeCalibrar(ahora, '2026-08-17T12:00:00Z') === new Date(ahora - 60 * 86_400_000).toISOString())
  ok('fecha rota → 60 días', desdeDeCalibrar(ahora, 'nada') === new Date(ahora - 60 * 86_400_000).toISOString())
}

console.log(fallos ? `\n${fallos} FALLOS` : '\nTodo bien')
if (fallos) process.exit(1)
