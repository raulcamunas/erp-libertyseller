import {
  acosAutomatico,
  acosObjetivoMedio,
  combinarAjustes,
  esCampanaDeMarca,
  esTextoDeMarca,
  faseDeProducto,
  motivoDeTechoIncompleto,
  objetivoBase,
  pujaMaxima,
  revisarObjetivo,
  subidaPermitida,
  techoAutomatico,
  techoDelMes,
  type EntradaAcosAuto,
} from './objetivos-calculo'
import { UMBRALES_DE_PARTIDA, DESCRIPCION_DE_UMBRALES, type UmbralesEstimados } from '../umbrales'
import type { Postura, Presion } from './tipos'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/** OBJETIVOS DEL AGENTE: ACoS automático congelado, techo, objetivo medio, fase, marca y combinación acotada */

const entrada = (e: Partial<EntradaAcosAuto> = {}): EntradaAcosAuto => ({
  precio: null,
  ivaPct: 21,
  costeProducto: null,
  comisionPct: 15,
  tarifaFba: 3.5,
  otrosCostes: 1,
  acos30Pct: null,
  acos90Pct: null,
  pedidos30: 0,
  ventasAds30: 0,
  ventasTotales30: null,
  tacosObjetivoPct: 10,
  ...e,
})

console.log('\n=== ACoS automático (candidato) ===')
{
  // margen.prueba: 24,20 € con 21 % de IVA, coste 6, comisión 15 %, FBA 3,5, otros 1 → equilibrio 24,3 % → objetivo 0,8 × 24,3 = 19,4 %
  const r = acosAutomatico(entrada({ precio: 24.2, costeProducto: 6 }))
  ok('del margen: equilibrio 24,3 % → 19,4 %, fuente equilibrio', r.acosObjetivoPct === 19.4 && r.fuente === 'equilibrio' && r.equilibrioPct === 24.3, JSON.stringify(r))
  ok('… y NO es solo defensivo', r.soloDefensivo === false)
  const pierde = acosAutomatico(entrada({ precio: 10, costeProducto: 9 }))
  ok('pierde dinero sin publicidad → null', pierde.acosObjetivoPct === null && pierde.fuente === null && pierde.motivoSinObjetivo === 'pierde dinero sin publicidad', JSON.stringify(pierde))
  ok('… aunque tenga ventas (no cae al ACoS real)', acosAutomatico(entrada({ precio: 10, costeProducto: 9, acos30Pct: 20, pedidos30: 50, ventasAds30: 1000 })).acosObjetivoPct === null)
  const real = acosAutomatico(entrada({ acos30Pct: 55, acos90Pct: 30, pedidos30: 12, ventasAds30: 800 }))
  ok('acos_real con 30 d 55 % y 90 d 30 % → min × 0,9 = 27 %', real.acosObjetivoPct === 27 && real.fuente === 'acos_real', JSON.stringify(real))
  ok('… y es solo defensivo', real.soloDefensivo === true)
  ok('acos_real sin 90 d usa el de 30 d (20 × 0,9 = 18)', acosAutomatico(entrada({ acos30Pct: 20, pedidos30: 5, ventasAds30: 100 })).acosObjetivoPct === 18)
  ok('acos_real acotado a 40 (80 × 0,9 = 72 → 40)', acosAutomatico(entrada({ acos30Pct: 80, acos90Pct: 90, pedidos30: 5, ventasAds30: 100 })).acosObjetivoPct === 40)
  ok('acos_real acotado a 10 (5 × 0,9 → 10)', acosAutomatico(entrada({ acos30Pct: 5, pedidos30: 5, ventasAds30: 100 })).acosObjetivoPct === 10)
  const tacos = acosAutomatico(entrada({ acos30Pct: 30, pedidos30: 4, ventasAds30: 1000, ventasTotales30: 2500, tacosObjetivoPct: 10 }))
  ok('con 4 pedidos no hay acos_real: TACoS 10 % × 2.500 ÷ 1.000 = 25 %', tacos.acosObjetivoPct === 25 && tacos.fuente === 'tacos' && tacos.soloDefensivo, JSON.stringify(tacos))
  ok('tacos acotado a 40 (10 × 10.000 ÷ 1.000 = 100 → 40)', acosAutomatico(entrada({ ventasAds30: 1000, ventasTotales30: 10000 })).acosObjetivoPct === 40)
  const nada = acosAutomatico(entrada())
  ok('sin costes ni ventas → null y solo defensivo', nada.acosObjetivoPct === null && nada.soloDefensivo && nada.motivoSinObjetivo === 'sin costes ni ventas suficientes', JSON.stringify(nada))
}

console.log('\n=== revisarObjetivo (congelado; una revisión al mes) ===')
{
  const cand = (n: number | null) => ({ ...acosAutomatico(entrada({ acos30Pct: 20, pedidos30: 10, ventasAds30: 100 })), acosObjetivoPct: n })
  const nuevo = revisarObjetivo(null, cand(18), { mes: '2026-11', dia: 15 }, false)
  ok('producto nuevo → se guarda el candidato y se marca el mes', nuevo.acosObjetivoPct === 18 && nuevo.cambia && nuevo.revisadoMes === '2026-11', JSON.stringify(nuevo))
  ok('producto nuevo sin candidato → nada', revisarObjetivo(null, cand(null), { mes: '2026-11', dia: 15 }, false).acosObjetivoPct === null)

  // Un ACoS que SUBE 3 días seguidos: el candidato crece cada día pero el objetivo ya está revisado este mes → no se mueve
  const actual = { acosObjetivoPct: 20, revisadoMes: '2026-11' }
  let quieto = true
  for (const [dia, c] of [[16, 24], [17, 28], [18, 33]] as const) {
    const r = revisarObjetivo(actual, cand(c), { mes: '2026-11', dia }, false)
    if (r.cambia || r.acosObjetivoPct !== 20) quieto = false
  }
  ok('un ACoS que sube 3 días seguidos NO mueve el objetivo', quieto)
  ok('antes del día 4 no se revisa', !revisarObjetivo({ acosObjetivoPct: 20, revisadoMes: '2026-10' }, cand(15), { mes: '2026-11', dia: 3 }, false).cambia)
  ok('con la ventana tocando un evento no se revisa (y no se marca el mes)', (() => {
    const r = revisarObjetivo({ acosObjetivoPct: 20, revisadoMes: '2026-10' }, cand(15), { mes: '2026-11', dia: 10 }, true)
    return !r.cambia && r.acosObjetivoPct === 20 && r.revisadoMes === '2026-10'
  })())
  const sube = revisarObjetivo({ acosObjetivoPct: 20, revisadoMes: '2026-10' }, cand(25), { mes: '2026-11', dia: 4 }, false)
  ok('revisión que sube 5 puntos → sube solo 2 (20 → 22)', sube.acosObjetivoPct === 22 && sube.cambia && sube.revisadoMes === '2026-11', JSON.stringify(sube))
  const baja = revisarObjetivo({ acosObjetivoPct: 20, revisadoMes: '2026-10' }, cand(12), { mes: '2026-11', dia: 4 }, false)
  ok('revisión que baja → baja entera (20 → 12)', baja.acosObjetivoPct === 12 && baja.cambia, JSON.stringify(baja))
  const igual = revisarObjetivo({ acosObjetivoPct: 20, revisadoMes: '2026-10' }, cand(20), { mes: '2026-11', dia: 5 }, false)
  ok('revisión sin cambio → marca el mes, cambia = false', !igual.cambia && igual.revisadoMes === '2026-11')
}

console.log('\n=== techo mensual ===')
{
  const ficha = techoAutomatico({ presupuestoMensual: 900, congelado: { techo: 500, automatico: true }, gasto30: 2000, ventasTotales30: 30000, tacosObjetivoPct: 10 })
  ok('la ficha manda (900), no automático', ficha.techo === 900 && !ficha.automatico && !ficha.congelar)
  // Techo = max(gasto 30 d, TACoS objetivo × ventas totales proyectadas), creciendo como mucho un 25 % (vender más con menos publicidad: crece si el TACoS va bien)
  const T = (x: Partial<Parameters<typeof techoAutomatico>[0]>) => techoAutomatico({ presupuestoMensual: null, congelado: null, gasto30: 1230, ventasTotales30: 20000, tacosObjetivoPct: 10, ...x })
  const tope = T({})
  ok('TACoS muy bien (2.000 ≫ 1.230): crece como mucho un 25 % → 1.537,5', tope.techo === 1537.5 && tope.automatico && tope.congelar && tope.cambia, JSON.stringify(tope))
  const porTacos = T({ ventasTotales30: 13000 })
  ok('TACoS bien (1.300 entre el gasto y +25 %): techo = TACoS × ventas (1.300)', porTacos.techo === 1300 && porTacos.congelar, JSON.stringify(porTacos))
  const tacosMal = T({ ventasTotales30: 8000 })
  ok('TACoS mal (800 < 1.230): techo = gasto de 30 d (no crece, y no mete la cuenta en recorte)', tacosMal.techo === 1230 && tacosMal.congelar, JSON.stringify(tacosMal))
  ok('sin ventas totales: el gasto de 30 d', T({ ventasTotales30: null }).techo === 1230)
  const congelado = T({ congelado: { techo: 800, automatico: true, mes: '2026-11' }, gasto30: 5000, ventasTotales30: 90000, mesActual: '2026-11' })
  ok('techo congelado NO cambia dentro del mes aunque el gasto suba', congelado.techo === 800 && congelado.automatico && !congelado.congelar && !congelado.cambia)
  ok('… ni sin el mes del congelado', T({ congelado: { techo: 800, automatico: true }, mesActual: '2026-12' }).techo === 800)
  const revision = T({ congelado: { techo: 1000, automatico: true, mes: '2026-11' }, gasto30: 1000, ventasTotales30: 20000, mesActual: '2026-12' })
  ok('revisión mensual con el TACoS bien: +25 % como mucho (1.000 → 1.250)', revision.techo === 1250 && revision.congelar && revision.cambia, JSON.stringify(revision))
  const revisionMal = T({ congelado: { techo: 1000, automatico: true, mes: '2026-11' }, gasto30: 900, ventasTotales30: 6000, mesActual: '2026-12' })
  ok('revisión con el TACoS mal y menos gasto: baja al gasto de 30 d (900)', revisionMal.techo === 900 && revisionMal.cambia, JSON.stringify(revisionMal))
  const revisionIgual = T({ congelado: { techo: 1230, automatico: true, mes: '2026-11' }, gasto30: 1230, ventasTotales30: 8000, mesActual: '2026-12' })
  ok('revisión que lo deja igual: congela (marca el mes) pero no «cambia» (no avisa)', revisionIgual.techo === 1230 && revisionIgual.congelar && !revisionIgual.cambia, JSON.stringify(revisionIgual))
  ok('sin revisión con 30 días que tocan un evento', T({ congelado: { techo: 1000, automatico: true, mes: '2026-11' }, gasto30: 1000, mesActual: '2026-12', ventanaConEvento: true }).techo === 1000)
  const sinGasto = techoAutomatico({ presupuestoMensual: null, congelado: null, gasto30: 0.5, ventasTotales30: 1000, tacosObjetivoPct: 10 })
  ok('sin gasto real → null (no sube nada)', sinGasto.techo === null && !sinGasto.congelar)
  ok('techo del mes con evento y pico_eventos → × 1,3', techoDelMes(1000, true, true) === 1300)
  ok('… con evento sin pico_eventos → igual', techoDelMes(1000, true, false) === 1000)
  ok('… sin techo → null', techoDelMes(null, true, true) === null)
}

console.log('\n=== techo con datos incompletos (no se congela) y revisión que no baja del gasto real ===')
{
  const T = (x: Partial<Parameters<typeof techoAutomatico>[0]>) => techoAutomatico({ presupuestoMensual: null, congelado: null, gasto30: 1230, ventasTotales30: 20000, tacosObjetivoPct: 10, ...x })
  const nueva = T({ gasto30: 35, ventasTotales30: null, datosIncompletos: 'la cuenta aún no tiene 30 días de datos', diasDeHistoria: 3 })
  ok('(a) 3 días de historia con 35 €: no se congela y el techo no es nulo (≥ 35)', !nueva.congelar && nueva.techo != null && nueva.techo >= 35, JSON.stringify(nueva))
  ok('(a) … provisional = media diaria × 30,4 (35 ÷ 3 × 30,4 = 354,67)', nueva.techo === 354.67, JSON.stringify(nueva))
  const dudosas = T({ congelado: { techo: 800, automatico: true, mes: '2026-11' }, mesActual: '2026-12', datosIncompletos: 'no se han podido leer las ventas totales' })
  ok('(b) ventas dudosas con un techo del mes pasado: no se revisa ni se congela, se queda el previo', !dudosas.congelar && dudosas.techo === 800 && !dudosas.cambia, JSON.stringify(dudosas))
  const reparado = T({ congelado: { techo: 35, automatico: true, mes: '2026-11' }, gasto30: 1050, ventasTotales30: null, mesActual: '2026-12' })
  ok('(c) revisión con un techo minúsculo (35) y 1.050 de gasto real en una ventana completa → ≥ 1.050', reparado.techo != null && reparado.techo >= 1050 && reparado.congelar && reparado.cambia, JSON.stringify(reparado))
  const completo = T({ datosIncompletos: null, diasDeHistoria: 90 })
  ok('(d) ventana completa con ventas: idéntico a sin los campos nuevos', JSON.stringify(completo) === JSON.stringify(T({})), JSON.stringify(completo))
  ok('(d) … revisión normal sin cambios: +25 % como mucho (1.000 → 1.250)', T({ congelado: { techo: 1000, automatico: true, mes: '2026-11' }, gasto30: 1000, mesActual: '2026-12' }).techo === 1250)
  ok('sin gasto real y datos incompletos → null (sigue sin techo)', T({ gasto30: 0.5, datosIncompletos: 'x', diasDeHistoria: 2 }).techo === null)

  const ahora = Date.parse('2026-12-10T12:00:00Z')
  const M = (x: Partial<Parameters<typeof motivoDeTechoIncompleto>[0]>) =>
    motivoDeTechoIncompleto({ primerDia: '2026-09-01', inicioVentana: '2026-11-10', ventasCuentan: true, ventasFallo: false, ventasTotales30: 5000, ventasLeidoAt: '2026-12-10T02:00:00Z', ahora, ...x })
  ok('datos completos → null', M({}) === null)
  ok('primer día dentro de la ventana → incompleto', M({ primerDia: '2026-12-06' }) != null)
  ok('primer día justo el inicio de la ventana → completo', M({ primerDia: '2026-11-10' }) === null)
  ok('sin rendimiento → incompleto', M({ primerDia: null }) != null)
  ok('ventas que fallan → incompleto', M({ ventasFallo: true }) != null)
  ok('sin ventas de 30 días → incompleto', M({ ventasTotales30: null }) != null)
  ok('ventas de hace más de 72 h → incompleto', M({ ventasLeidoAt: '2026-12-06T12:00:00Z' }) != null)
  ok('sin TACoS objetivo (o sin cuenta de vendedor) las ventas no cuentan', M({ ventasCuentan: false, ventasFallo: true, ventasTotales30: null }) === null)
}

console.log('\n=== objetivo medio de la cuenta ===')
{
  ok('ponderado por gasto: (100×20 + 300×30) ÷ 400 = 27,5', acosObjetivoMedio([{ acosObjetivoPct: 20, gasto30: 100 }, { acosObjetivoPct: 30, gasto30: 300 }, { acosObjetivoPct: null, gasto30: 999 }]) === 27.5)
  ok('sin gasto → media simple (20, 30 → 25)', acosObjetivoMedio([{ acosObjetivoPct: 20, gasto30: 0 }, { acosObjetivoPct: 30, gasto30: 0 }]) === 25)
  ok('sin ninguno → null', acosObjetivoMedio([{ acosObjetivoPct: null, gasto30: 100 }]) === null)
}

console.log('\n=== fase y objetivo base (lanzamiento) ===')
{
  const ahora = Date.parse('2026-11-15T12:00:00Z')
  ok('estructura de hace 20 días → lanzamiento', faseDeProducto({ faseManual: null, primeraEstructuraAt: '2026-10-26T00:00:00Z', ahora }) === 'lanzamiento')
  ok('estructura de hace 90 días → normal', faseDeProducto({ faseManual: null, primeraEstructuraAt: '2026-08-17T00:00:00Z', ahora }) === 'normal')
  ok('la manual manda (normal aunque sea reciente)', faseDeProducto({ faseManual: 'normal', primeraEstructuraAt: '2026-11-10T00:00:00Z', ahora }) === 'normal')
  ok('sin estructura → normal', faseDeProducto({ faseManual: null, primeraEstructuraAt: null, ahora }) === 'normal')
  const lanz = objetivoBase({ humano: null, automatico: { acosObjetivoPct: 20, fuente: 'equilibrio', soloDefensivo: false }, fase: 'lanzamiento', acosLanzamientoX: 1.5 })
  ok('lanzamiento: automático × 1,5 (20 → 30)', lanz.acosObjetivoPct === 30 && lanz.fuente === 'equilibrio' && !lanz.soloDefensivo, JSON.stringify(lanz))
  ok('lanzamiento con humano: el humano tal cual', objetivoBase({ humano: 25, automatico: null, fase: 'lanzamiento', acosLanzamientoX: 1.5 }).acosObjetivoPct === 25)
  const hum = objetivoBase({ humano: 25, automatico: { acosObjetivoPct: 18, fuente: 'acos_real', soloDefensivo: true }, fase: 'normal', acosLanzamientoX: 1.5 })
  ok('humano gana al automático y no es solo defensivo', hum.acosObjetivoPct === 25 && hum.fuente === 'humano' && !hum.soloDefensivo)
  const real = objetivoBase({ humano: null, automatico: { acosObjetivoPct: 18, fuente: 'acos_real', soloDefensivo: true }, fase: 'normal', acosLanzamientoX: 1.5 })
  ok('automático por acos_real → solo defensivo', real.acosObjetivoPct === 18 && real.soloDefensivo)
  ok('sin ninguno → null y solo defensivo', (() => { const r = objetivoBase({ humano: null, automatico: null, fase: 'normal', acosLanzamientoX: 1.5 }); return r.acosObjetivoPct === null && r.soloDefensivo })())
}

console.log('\n=== marca ===')
{
  ok('término con la marca (tildes y mayúsculas) → de marca', esTextoDeMarca('jamón JOSELITO 5 jotas', 'Joselito'))
  ok('término sin la marca → no', !esTextoDeMarca('jamon iberico', 'Joselito'))
  ok('marca de menos de 3 letras → nunca', !esTextoDeMarca('ab cd', 'Ab'))
  ok('sin marca → no', !esTextoDeMarca('joselito', null))
  ok('campaña con rol DEFENSA → de marca', esCampanaDeMarca('B0X | SKU | DEFENSA', 'DEFENSA', null))
  ok('campaña con rol MARCA → de marca', esCampanaDeMarca('B0X | SKU | X', 'MARCA', null))
  ok('campaña con la marca en el nombre → de marca', esCampanaDeMarca('B0X | Joselito exacta', 'EXACTA', 'joselito'))
  ok('campaña normal → no', !esCampanaDeMarca('B0X | SKU | AMPLIA', 'AMPLIA', 'joselito'))
  const m = combinarAjustes(UMBRALES_DE_PARTIDA, { postura: 'crecer', presion: 'subir', objetivoBase: 30, equilibrioPct: 40, soloDefensivo: false, esMarca: true, cuentaPequena: false, sinSubidasCuenta: false })
  ok('marca: sin subidas y objetivo para bajar × 0,5 (30 → 15)', m.sinSubidas && m.acosParaBajar === 15, JSON.stringify(m))
}

console.log('\n=== combinarAjustes (acotado) y subidaPermitida ===')
{
  const a = (p: Partial<{ postura: Postura; presion: Presion | null; objetivoBase: number; equilibrioPct: number | null; soloDefensivo: boolean; esMarca: boolean; cuentaPequena: boolean; sinSubidasCuenta: boolean }> = {}) => ({
    postura: 'mantener' as Postura, presion: null, objetivoBase: 30, equilibrioPct: 40, soloDefensivo: false, esMarca: false, cuentaPequena: false, sinSubidasCuenta: false, ...p,
  })

  // crecer + presión subir: subirSiAcosBajoX 0,7 + 0,10 + 0,15 = 0,95 → 0,85; pedidosParaSubir 3 − 1 − 1 = 1 → 2
  const c = combinarAjustes(UMBRALES_DE_PARTIDA, a({ postura: 'crecer', presion: 'subir' }))
  ok('crecer + subir: subirSiAcosBajoX acotado a 0,85', c.umbrales.subirSiAcosBajoX === 0.85, String(c.umbrales.subirSiAcosBajoX))
  ok('crecer + subir: pedidosParaSubir acotado a 2', c.umbrales.pedidosParaSubir === 2, String(c.umbrales.pedidosParaSubir))
  ok('crecer: subirPujaPct 15 → 20', c.umbrales.subirPujaPct === 20)
  ok('crecer: acosParaBajar = 30 × 1,10 = 33', c.acosParaBajar === 33, String(c.acosParaBajar))
  ok('acosParaSubir = objetivo base (30), nunca el efectivo', c.acosParaSubir === 30)
  // LA PRUEBA OBLIGATORIA: crecer + presión subir con 1 pedido NO sube (aunque el ACoS sea buenísimo)
  ok('crecer + presión subir con 1 pedido → NO sube', !subidaPermitida({ clics: 40, gasto: 2, ventas: 100, pedidos: 1 }, c.acosParaSubir, c.umbrales, 12))
  ok('… con 2 pedidos y ACoS 10 % < 30 × 0,85 → sí', subidaPermitida({ clics: 40, gasto: 10, ventas: 100, pedidos: 2 }, c.acosParaSubir, c.umbrales, 12))
  ok('… con ACoS 26 % (≥ 30 × 0,85 = 25,5) → no', !subidaPermitida({ clics: 40, gasto: 26, ventas: 100, pedidos: 5 }, c.acosParaSubir, c.umbrales, 12))
  ok('… con menos clics que la muestra mínima → no', !subidaPermitida({ clics: 11, gasto: 10, ventas: 100, pedidos: 5 }, c.acosParaSubir, c.umbrales, 12))
  ok('… sin ventas → no', !subidaPermitida({ clics: 40, gasto: 10, ventas: 0, pedidos: 0 }, c.acosParaSubir, c.umbrales, 12))

  // Barrido: con cualquier combinación (y umbrales de partida extremos) el acotado final se cumple SIEMPRE
  const extremos: UmbralesEstimados[] = [
    UMBRALES_DE_PARTIDA,
    { ...UMBRALES_DE_PARTIDA, subirSiAcosBajoX: 1, pedidosParaSubir: 1, subirPujaPct: 50, pujaMaxBajadaPct: 50, bajarSinPedidosPct: 50, bajarSiAcosSobreX: 1, pedidosParaBajar: 1 },
    { ...UMBRALES_DE_PARTIDA, subirSiAcosBajoX: 0.3, pedidosParaSubir: 10, subirPujaPct: 22 },
  ]
  let siempre = true
  let nuncaSobreBase = true
  let detalle = ''
  for (const u of extremos)
    for (const postura of ['crecer', 'mantener', 'recortar'] as Postura[])
      for (const presion of ['subir', 'bajar', null] as Array<Presion | null>)
        for (const cuentaPequena of [false, true])
          for (const equilibrioPct of [null, 20, 40]) {
            const r = combinarAjustes(u, a({ postura, presion, cuentaPequena, equilibrioPct }))
            const x = r.umbrales
            const dentro = (Object.keys(DESCRIPCION_DE_UMBRALES) as Array<keyof UmbralesEstimados>).every((k) => x[k] >= DESCRIPCION_DE_UMBRALES[k].min && x[k] <= DESCRIPCION_DE_UMBRALES[k].max)
            const bien = x.subirSiAcosBajoX <= 0.85 && x.pedidosParaSubir >= (cuentaPequena ? 3 : 2) && x.subirPujaPct <= 25 && x.pujaMaxBajadaPct <= 25 && x.bajarSinPedidosPct <= 25 && x.bajarSiAcosSobreX >= 1 && x.pedidosParaBajar >= 1 && dentro
            if (!bien) { siempre = false; detalle = JSON.stringify({ postura, presion, cuentaPequena, x }) }
            if (r.acosParaSubir > 30) nuncaSobreBase = false
          }
  ok('subirSiAcosBajoX ≤ 0,85, pedidosParaSubir ≥ 2 (≥ 3 pequeña), % ≤ 25 y dentro de límites SIEMPRE', siempre, detalle)
  ok('acosParaSubir nunca > objetivo base', nuncaSobreBase)

  const eq = combinarAjustes(UMBRALES_DE_PARTIDA, a({ postura: 'crecer', objetivoBase: 30, equilibrioPct: 20 }))
  ok('con equilibrio 20 %: acosParaSubir y acosParaBajar ≤ 0,95 × 20 = 19', eq.acosParaSubir === 19 && eq.acosParaBajar === 19, JSON.stringify(eq))
  const rec = combinarAjustes(UMBRALES_DE_PARTIDA, a({ postura: 'recortar' }))
  ok('recortar: sin subidas, bajarSiAcosSobreX 1,2 → 1,1, acosParaBajar 30 × 0,85 = 25,5', rec.sinSubidas && rec.umbrales.bajarSiAcosSobreX === 1.1 && rec.acosParaBajar === 25.5, JSON.stringify(rec))
  const baj = combinarAjustes(UMBRALES_DE_PARTIDA, a({ presion: 'bajar' }))
  ok('presión bajar: bajarSiAcosSobreX = 1,0 y pedidosParaBajar 2 → 1', baj.umbrales.bajarSiAcosSobreX === 1 && baj.umbrales.pedidosParaBajar === 1)
  ok('solo defensivo → sin subidas', combinarAjustes(UMBRALES_DE_PARTIDA, a({ soloDefensivo: true })).sinSubidas)
  ok('sin subidas de cuenta (rampa, techo nulo…) → sin subidas', combinarAjustes(UMBRALES_DE_PARTIDA, a({ sinSubidasCuenta: true })).sinSubidas)
  ok('mantener sin nada → se puede subir', !combinarAjustes(UMBRALES_DE_PARTIDA, a()).sinSubidas)
  const def = combinarAjustes(UMBRALES_DE_PARTIDA, a({ postura: 'crecer', soloDefensivo: true }))
  ok('crecer de un solo defensivo se trata como mantener (no tolera más para bajar)', def.acosParaBajar === 30 && def.umbrales.subirPujaPct === 15)
  ok('cuenta pequeña: pedidosParaSubir ≥ 3 aun con crecer + subir', combinarAjustes(UMBRALES_DE_PARTIDA, a({ postura: 'crecer', presion: 'subir', cuentaPequena: true })).umbrales.pedidosParaSubir === 3)
  ok('crecer con subirPujaPct ya en 22 se queda en 22', combinarAjustes({ ...UMBRALES_DE_PARTIDA, subirPujaPct: 22 }, a({ postura: 'crecer' })).umbrales.subirPujaPct === 22)
}

console.log('\n=== puja máxima ===')
{
  // 30 € × 10 % × 25 % × 1,2 = 0,90
  ok('precio 30, CVR 10 %, objetivo 25 % → 0,90', pujaMaxima({ precio: 30, cvrPct: 10, acosObjetivoPct: 25, topeFijo: 3 }) === 0.9)
  ok('tope fijo si la cuenta da más (200 × 20 % × 30 % × 1,2 = 14,4 → 3)', pujaMaxima({ precio: 200, cvrPct: 20, acosObjetivoPct: 30, topeFijo: 3 }) === 3)
  ok('sin precio → el tope fijo', pujaMaxima({ precio: null, cvrPct: 10, acosObjetivoPct: 25, topeFijo: 2 }) === 2)
  ok('tope fijo inválido → 3', pujaMaxima({ precio: null, cvrPct: null, acosObjetivoPct: 25, topeFijo: 0 }) === 3)
  ok('nunca por debajo de 0,02', pujaMaxima({ precio: 1, cvrPct: 1, acosObjetivoPct: 5, topeFijo: 3 }) === 0.02)
}

console.log(fallos ? `\n${fallos} FALLOS` : '\nTodo OK')
if (fallos) process.exit(1)
