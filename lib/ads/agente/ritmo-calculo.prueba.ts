import { posturaPorReglas, presionDelDia, recortePorRitmo, reglasDePresupuesto, ritmoDelMes } from './ritmo-calculo'
import { AGENTE, type CampanaParaRitmo, type EstadoDelMes } from './tipos'
import { limitarPresupuestoAhora, moverSumas, type SumasDePresupuesto } from './aplicar-servidor'
import { faltaEnSumas } from './guardarrailes-calculo'
import { techoAutomatico } from './objetivos-calculo'
import { sumarDias, ultimoDiaCerrado, ultimoDiaConVentasCerradas, type DiaDeCampana } from './contexto-servidor'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}
const j = (x: unknown) => JSON.stringify(x)

/**
 * RITMO DE GASTO DEL AGENTE. Campaña de partida: presupuesto 20, se agota hoy a las 13:40 y 2 de los 3 últimos días,
 * ACoS de 7 días 16,7 % con 5 pedidos (objetivo para subir 25 %), gasta de media 18 al día en 14 días.
 */
const camp = (id: string, extra: Partial<CampanaParaRitmo> = {}): CampanaParaRitmo => ({
  campaignId: id,
  nombre: `B0X | SKU | ${id.toUpperCase()}`,
  asin: 'B0TEST0001',
  presupuesto: 20,
  agotadaHoyMin: 13 * 60 + 40,
  agotadaHoyPorEstado: false,
  agotadaDias3: 2,
  agotadaAntes18Dias3: 2,
  gasto7: 100,
  ventas7: 600,
  pedidos7: 5,
  clics7: 80,
  diasConDatos7: 7,
  gasto14: 250,
  ventas14: 1300,
  pedidos14: 11,
  clics14: 170,
  mediaGasto14: 18,
  maxGasto14: 21,
  diasConDatos14: 14,
  acosParaSubir: 25,
  acosParaBajar: 25,
  muestraMinima: 12,
  tieneEquilibrio: true,
  postura: 'mantener',
  soloDefensivo: false,
  esMarca: false,
  fase: 'normal',
  bloqueadaPresupuesto: false,
  portfolioTopado: false,
  presupuestoAntesDelRecorte: null,
  ...extra,
})
/** Campaña que no usa su presupuesto: 50 de presupuesto, 10 de media (20 %), máximo 14; ni se agota */
const floja = (id: string, extra: Partial<CampanaParaRitmo> = {}) =>
  camp(id, { presupuesto: 50, mediaGasto14: 10, maxGasto14: 14, agotadaHoyMin: null, agotadaDias3: 0, agotadaAntes18Dias3: 0, ...extra })

type Ctx = Parameters<typeof reglasDePresupuesto>[1]
const C = (extra: Partial<Ctx> = {}): Ctx => ({
  ritmo: 'normal', evento: null, sinSubidas: false, sinPresupuestoSubir: false, techoNulo: false, cuentaPequena: false, usoDisponible: true,
  huecoDeSuma: () => 0,
  ...extra,
})
const subidas = (r: ReturnType<typeof reglasDePresupuesto>) => r.propuestas.filter((p) => p.clase === 'presupuesto_subir')

console.log('\n=== R1: se agota pronto y rinde → subir presupuesto ===')
{
  const r = reglasDePresupuesto([camp('a')], C())
  ok('agotada a las 13:40 y 2 de 3 días, ACoS 16,7 % ≤ 25 % → 20 → 24 (+20 %)', r.propuestas.length === 1 && r.propuestas[0].regla === 'R1' && r.propuestas[0].presupuestoNuevo === 24, j(r))
  ok('… el motivo lleva la hora «13:40» y las cifras', /13:40/.test(r.propuestas[0]?.motivo ?? '') && /16,7 %/.test(r.propuestas[0]?.motivo ?? '') && /20,00 → 24,00/.test(r.propuestas[0]?.motivo ?? ''), r.propuestas[0]?.motivo)
  ok('con 1 pedido (7 d y 14 d) no sube', reglasDePresupuesto([camp('b', { pedidos7: 1, pedidos14: 1 })], C()).propuestas.length === 0)
  const v14 = reglasDePresupuesto([camp('c', { pedidos7: 2, pedidos14: 4 })], C())
  ok('con 2 pedidos en 7 d pero 4 en 14 d usa la ventana de 14 d y sube', subidas(v14).length === 1 && /14 días/.test(v14.propuestas[0].motivo), j(v14))
  ok('agotada solo hoy (0 de 3 días cerrados) → no sube', reglasDePresupuesto([camp('d', { agotadaDias3: 0 })], C()).propuestas.length === 0)
  ok('no agotada hoy → no sube', reglasDePresupuesto([camp('e', { agotadaHoyMin: null })], C()).propuestas.length === 0)
  ok('agotada hoy a las 19:00 → no sube', reglasDePresupuesto([camp('e2', { agotadaHoyMin: 19 * 60 })], C()).propuestas.length === 0)
  ok('ACoS 30 % > 25 % → no sube', reglasDePresupuesto([camp('f', { gasto7: 180 })], C()).propuestas.length === 0)
  // Spec §4.2: R1 exige agotadaHoyMin < 18:00. «Agotada por estado» no tiene minuto (se fija a cualquier hora y no se borra): no basta para subir
  const est = reglasDePresupuesto([camp('g', { agotadaHoyMin: null, agotadaHoyPorEstado: true })], C({ ritmo: 'crecer' }))
  ok('agotada solo por estado (sin minuto; p. ej. detectada a las 22:00) → sin R1', subidas(est).length === 0, j(est))
  ok('agotada por estado y por la API a las 22:00 → sin R1', subidas(reglasDePresupuesto([camp('g2', { agotadaHoyMin: 22 * 60, agotadaHoyPorEstado: true })], C())).length === 0)
  ok('agotada por estado y por la API a las 13:40 → R1 (cuenta el minuto)', subidas(reglasDePresupuesto([camp('g3', { agotadaHoyPorEstado: true })], C())).length === 1)
  const c30 = reglasDePresupuesto([camp('h', { agotadaHoyMin: 13 * 60 })], C({ ritmo: 'crecer' }))
  ok('antes de las 14:00 con ritmo crecer y equilibrio → +30 % (26)', c30.propuestas[0]?.presupuestoNuevo === 26, j(c30))
  ok('… sin equilibrio → +20 % (24)', reglasDePresupuesto([camp('h2', { agotadaHoyMin: 13 * 60, tieneEquilibrio: false })], C({ ritmo: 'crecer' })).propuestas[0]?.presupuestoNuevo === 24)
  ok('… con ritmo normal → +20 % (24)', reglasDePresupuesto([camp('h3', { agotadaHoyMin: 13 * 60 })], C()).propuestas[0]?.presupuestoNuevo === 24)
  ok('mes que venía de recorte: no pasa del presupuesto de antes (22)', reglasDePresupuesto([camp('i', { presupuestoAntesDelRecorte: 22 })], C()).propuestas[0]?.presupuestoNuevo === 22)
  ok('… y si ya está en él, no sube', reglasDePresupuesto([camp('i2', { presupuestoAntesDelRecorte: 20 })], C()).propuestas.length === 0)

  const nada = (n: string, k: Partial<CampanaParaRitmo>, c: Partial<Ctx> = {}) => ok(n, subidas(reglasDePresupuesto([camp('x', k)], C(c))).length === 0)
  nada('bloqueada (cuarentena) → no sube', { bloqueadaPresupuesto: true })
  nada('su última subida empeoró o se deshizo sola (subidaVetada) → R1 no la repite', { subidaVetada: true })
  nada('solo defensivo → no sube', { soloDefensivo: true })
  nada('marca → no sube', { esMarca: true })
  nada('postura recortar → no sube', { postura: 'recortar' })
  nada('ritmo recorte → no sube', {}, { ritmo: 'recorte' })
  nada('cuenta pequeña → no sube', {}, { cuentaPequena: true })
  nada('rampa sin subidas → no sube', {}, { sinSubidas: true })
  nada('rampa sin subir presupuesto → no sube', {}, { sinPresupuestoSubir: true })
  nada('techo nulo → no sube', {}, { techoNulo: true })
  nada('7 días tras un evento → no sube', {}, { evento: 'posterior' })
  const port = reglasDePresupuesto([camp('p', { portfolioTopado: true })], C())
  ok('portfolio topado → no sube y avisa', port.propuestas.length === 0 && port.avisos.length === 1 && /portfolio/.test(port.avisos[0].texto), j(port))
  ok('sin la API de uso → nada (ni R1 ni R4)', reglasDePresupuesto([camp('a'), floja('f')], C({ usoDisponible: false })).propuestas.length === 0)
}

console.log('\n=== R1 financiada (mover dinero de campañas que no usan su presupuesto) ===')
{
  // Faltan 4 en la suma: la floja (usa el 20 %, piso max(10×1,3; 14×1,1) = 15,4) da 4
  const hueco = (id: string, nuevo: number) => (id === 'a' ? Math.max(0, nuevo - 20) : 0)
  const donante = camp('d', { presupuesto: 50, mediaGasto14: 25, maxGasto14: 28, agotadaHoyMin: null, agotadaDias3: 0, agotadaAntes18Dias3: 0 }) // usa el 50 %: donante, no R4
  const r = reglasDePresupuesto([camp('a'), donante], C({ huecoDeSuma: hueco }))
  ok('la bajada del donante va PRIMERO en la lista, con regla «donante»', r.propuestas[0]?.regla === 'donante' && r.propuestas[0].campaignId === 'd' && r.propuestas[0].presupuestoNuevo === 46, j(r.propuestas))
  ok('… y luego la subida entera como R1_financiada (24)', r.propuestas[1]?.regla === 'R1_financiada' && r.propuestas[1].presupuestoNuevo === 24, j(r.propuestas))
  ok('… motivo «Muevo 4,00 de … (usa el 50 %) … 13:40»', /^Muevo 4,00 de .*usa el 50 %.*13:40/.test(r.propuestas[0]?.motivo ?? ''), r.propuestas[0]?.motivo)
  ok('… el donante nunca baja de max(media × 1,3, máx × 1,1)', r.propuestas[0].presupuestoNuevo >= Math.max(25 * 1.3, 28 * 1.1))

  const sinDonantes = reglasDePresupuesto([camp('a')], C({ huecoDeSuma: hueco }))
  ok('sin hueco ni donantes → no sube y avisa', sinDonantes.propuestas.length === 0 && sinDonantes.avisos.length === 1, j(sinDonantes))
  const parcial = reglasDePresupuesto([camp('a')], C({ huecoDeSuma: (_id, n) => Math.max(0, n - 22) }))
  ok('si cabe una parte (≥ 5 %) sube lo que cabe (22)', parcial.propuestas[0]?.regla === 'R1' && parcial.propuestas[0].presupuestoNuevo === 22, j(parcial))
  const agota = camp('d2', { presupuesto: 50, mediaGasto14: 25, maxGasto14: 28, agotadaHoyMin: null, agotadaDias3: 1 })
  ok('una campaña que se agota no es donante', reglasDePresupuesto([camp('a'), agota], C({ huecoDeSuma: hueco })).propuestas.length === 0)
  ok('una campaña bloqueada no es donante', reglasDePresupuesto([camp('a'), { ...donante, bloqueadaPresupuesto: true }], C({ huecoDeSuma: hueco })).propuestas.length === 0)
  ok('una campaña que usa el 70 % no es donante', reglasDePresupuesto([camp('a'), { ...donante, mediaGasto14: 35, maxGasto14: 36 }], C({ huecoDeSuma: hueco })).propuestas.length === 0)

  // Una R4 también financia: se marca «donante» y baja a su valor de R4
  const r4 = reglasDePresupuesto([camp('a'), floja('f')], C({ huecoDeSuma: hueco }))
  ok('una R4 que financia sale como «donante» primero, bajando a su valor de R4 (15,4)', r4.propuestas[0]?.regla === 'donante' && r4.propuestas[0].presupuestoNuevo === 15.4 && r4.propuestas.length === 2, j(r4.propuestas))

  // Dos subidas no usan el mismo hueco (hay sitio para 5 en total)
  const sitio = 5
  const compartido = (_id: string, nuevo: number, comp: { suma: number; semana: number }) => Math.max(0, nuevo + comp.semana - 20 - sitio)
  const dos = reglasDePresupuesto([camp('a'), camp('b')], C({ huecoDeSuma: compartido }))
  ok('dos R1 con 5 de sitio: la primera +4 (24), la segunda solo +1 (21)', dos.propuestas.map((p) => p.presupuestoNuevo).join(',') === '24,21', j(dos.propuestas))

  // El hueco es del TECHO (suma útil). Donante: presupuesto 50, media 22 (usa el 44 %), máximo de 14 días 28 → cuenta 36,4 en la suma útil. Bajarlo de 50 a 46 no
  // libera nada de suma útil (sigue por encima de 36,4): para liberar 4 tiene que bajar hasta 32,4 (piso 30,8 = max(22 × 1,3; 28 × 1,1))
  const util = { ...donante, mediaGasto14: 22, maxGasto14Util: 28 }
  const soloTecho = (id: string) => (id === 'a' ? { suma: 4, semana: 0 } : { suma: 0, semana: 0 })
  const t = reglasDePresupuesto([camp('a'), util], C({ huecoDeSuma: soloTecho }))
  ok('hueco del techo: el donante baja hasta liberar 4 de suma útil (50 → 32,4)', t.propuestas[0]?.regla === 'donante' && t.propuestas[0].presupuestoNuevo === 32.4, j(t.propuestas))
  ok('… y la subida entera (24)', t.propuestas[1]?.regla === 'R1_financiada' && t.propuestas[1].presupuestoNuevo === 24, j(t.propuestas))
  // Si el donante no puede liberar suma útil suficiente (su piso está cerca de 1,3 × máx), la subida se queda en lo que sí cabe
  const corto = { ...donante, maxGasto14Util: 28, mediaGasto14: 27.5 } // piso max(35,75; 30,8) = 35,75 → libera como mucho 0,65 de útil
  const tc = reglasDePresupuesto([camp('a'), corto], C({ huecoDeSuma: soloTecho }))
  ok('donante que apenas libera suma útil: no se finge el hueco (sin subida y con aviso)', subidas(tc).length === 0 && tc.avisos.length === 1, j(tc))
  // Hueco de la SEMANA (suma de hoy): aquí cuenta lo que baja, como antes
  const soloSemana = (id: string) => (id === 'a' ? { suma: 0, semana: 4 } : { suma: 0, semana: 0 })
  const sw = reglasDePresupuesto([camp('a'), util], C({ huecoDeSuma: soloSemana }))
  ok('hueco de la semana: el donante baja solo 4 (50 → 46)', sw.propuestas[0]?.presupuestoNuevo === 46 && sw.propuestas[1]?.presupuestoNuevo === 24, j(sw.propuestas))

  // DE PUNTA A PUNTA: vigilar propone (con faltaEnSumas) → aplicar baja el donante (moverSumas) → la subida pasa el guardarraíl de aplicar (limitarPresupuestoAhora)
  // Tope diario 56,4 (techo ÷ 30,4 × 1,1) = suma útil de hoy (20 de «a» + 36,4 de «d»): no cabe nada sin mover
  const sumas = (): SumasDePresupuesto => ({ sumaUtil: 56.4, sumaActual: 70, suma7: null, techoMes: (56.4 * AGENTE.DIAS_MES_MEDIO) / AGENTE.HOLGURA_SUMA_PRESUPUESTOS, campanas: new Map([['a', { presupuesto: 20, max14: null }], ['d', { presupuesto: 50, max14: 28 }]]) })
  const s0 = sumas()
  const actual: Record<string, number> = { a: 20, d: 50 }
  const hueco2 = (id: string, nuevo: number, comp: { suma: number; semana: number }) =>
    faltaEnSumas({ actual: actual[id] ?? 0, nuevo, sumaUtil: s0.sumaUtil + comp.suma, sumaActual: s0.sumaActual + comp.semana, techoMes: s0.techoMes, suma7: s0.suma7 })
  const fin = reglasDePresupuesto([camp('a'), util], C({ huecoDeSuma: hueco2 }))
  const baja = fin.propuestas.find((p) => p.regla === 'donante')
  const sube = fin.propuestas.find((p) => p.clase === 'presupuesto_subir')
  ok('punta a punta: hay donante y subida financiada', !!baja && !!sube && sube.regla === 'R1_financiada', j(fin))
  const sa = sumas()
  if (baja) moverSumas(sa, baja.campaignId, baja.presupuestoActual, baja.presupuestoNuevo)
  const g = sube ? limitarPresupuestoAhora(sube.presupuestoActual, sube.presupuestoNuevo, sa, sube.campaignId) : null
  ok('… y al aplicar, tras bajar el donante, la subida cabe entera (no se retiene ni se recorta)', !!g && 'valor' in g && g.valor === sube!.presupuestoNuevo && g.nota === null, j(g))
  // Con el cálculo viejo (bajar solo 4 en bruto: 50 → 46) la subida no habría cabido
  const sv = sumas()
  moverSumas(sv, 'd', 50, 46)
  ok('… (con la bajada bruta de 4 no cabía: se retenía)', 'retener' in limitarPresupuestoAhora(20, 24, sv, 'a'))
}

console.log('\n=== techo automático: con campañas que agotan y rinden, R1 tiene que poder subir ===')
{
  // A: presupuesto 20, se agota con ACoS 16,7 % (útil 20). B: presupuesto 30, gasta 15 de media y 18 de máximo (útil 23,4). La cuenta gasta 35 al día (1.050 en 30 d).
  // Suma útil 43,4 y real 50 (la misma que al encender). Techo = max(gasto 30 d, TACoS objetivo × ventas totales), como mucho +25 %.
  const a = camp('a', { maxGasto14Util: 21 })
  const b = camp('b', { presupuesto: 30, mediaGasto14: 15, maxGasto14: 18, maxGasto14Util: 18, agotadaHoyMin: null, agotadaDias3: 0, agotadaAntes18Dias3: 0 })
  const techoCon = (ventasTotales30: number | null) => techoAutomatico({ presupuestoMensual: null, congelado: null, gasto30: 1050, ventasTotales30, tacosObjetivoPct: 10 }).techo
  const bueno = techoCon(15000)
  ok('TACoS que va bien (7 % < 10 %): el techo crece, como mucho un 25 % (1.050 → 1.312,5)', bueno === 1312.5, j(bueno))
  ok('TACoS que va mal (13 % > 10 %): techo = gasto de 30 d (1.050), ni crece ni recorta', techoCon(8000) === 1050, j(techoCon(8000)))
  ok('sin ventas totales: techo = gasto de 30 d (1.050)', techoCon(null) === 1050)
  const actual: Record<string, number> = { a: 20, b: 30 }
  const puntaAPunta = (camps: CampanaParaRitmo[], techoMes: number | null, s: { util: number; real: number; inicio: number | null; max14: Record<string, number> }) => {
    const hueco = (id: string, nuevo: number, comp: { suma: number; semana: number }) =>
      faltaEnSumas({ actual: actual[id] ?? 0, nuevo, sumaUtil: s.util + comp.suma, sumaActual: s.real + comp.semana, techoMes, suma7: null, sumaInicio: s.inicio })
    const r = reglasDePresupuesto(camps, C({ huecoDeSuma: hueco }))
    const sumas: SumasDePresupuesto = { sumaUtil: s.util, sumaActual: s.real, suma7: null, techoMes, sumaInicio: s.inicio, campanas: new Map(camps.map((c) => [c.campaignId, { presupuesto: c.presupuesto, max14: s.max14[c.campaignId] ?? null }])) }
    for (const p of r.propuestas.filter((x) => x.clase === 'presupuesto_bajar')) moverSumas(sumas, p.campaignId, p.presupuestoActual, p.presupuestoNuevo)
    const sube = r.propuestas.find((p) => p.clase === 'presupuesto_subir')
    return { r, sube, sumas, g: sube ? limitarPresupuestoAhora(sube.presupuestoActual, sube.presupuestoNuevo, sumas, sube.campaignId) : null }
  }
  const dos = { util: 43.4, real: 50, inicio: 50, max14: { a: 21, b: 18 } }
  const conB = puntaAPunta([a, b], bueno, dos)
  ok('A sube hasta 24 (R1 financiada: la suma real ya está en la de encender, se MUEVEN 4 de B)', conB.sube?.campaignId === 'a' && conB.sube.presupuestoNuevo === 24 && conB.r.propuestas.some((p) => p.regla === 'donante' && p.campaignId === 'b' && p.presupuestoNuevo === 26), j(conB.r))
  ok('… y aplicar la deja pasar entera; la suma real no crece (50)', !!conB.g && 'valor' in conB.g && conB.g.valor === 24 && conB.g.nota === null && conB.sumas.sumaActual + 4 === 50, j(conB.g))
  // Sola (sin campañas de las que mover): con el TACoS bien, A crece sin donantes; con el TACoS mal, solo lo que deja techo ÷ 30,4 × 1,1
  const sola = { util: 20, real: 20, inicio: 20, max14: { a: 21 } }
  const techoSola = (ventas: number) => techoAutomatico({ presupuestoMensual: null, congelado: null, gasto30: 600, ventasTotales30: ventas, tacosObjetivoPct: 10 }).techo
  const creceSola = puntaAPunta([a], techoSola(9000), sola)
  ok('TACoS bien (techo 750 → 27,14 al día): A sube sola de 20 a 24 y aplicar la deja entera', creceSola.sube?.presupuestoNuevo === 24 && creceSola.sube.regla === 'R1' && !!creceSola.g && 'valor' in creceSola.g && creceSola.g.valor === 24, j(creceSola))
  const malSola = puntaAPunta([a], techoSola(5000), sola)
  ok('TACoS mal (techo 600 → 21,71 al día): A solo llega a 21,71', malSola.sube?.presupuestoNuevo === 21.71, j(malSola.r))
  // El caso de la revisión: el techo VIEJO (gasto 30 d × 1,0 y la suma útil ≤ techo ÷ 30,4) retenía siempre la subida de A
  const viejo = puntaAPunta([a, b], 1050 / (AGENTE.HOLGURA_SUMA_PRESUPUESTOS * AGENTE.PRESUPUESTO_UTIL_X), dos)
  ok('… con el techo viejo (tope útil 34,5) no había subida posible', !viejo.sube, j(viejo.r))
}

console.log('\n=== una subida pendiente no frena una bajada ===')
{
  // Una campaña con una subida pendiente (retenida o esperando) está bloqueada para SUBIR, pero no para bajar (R4 o recorte)
  const conSubida = floja('f', { bloqueadaPresupuesto: true, soloSubidaPendiente: true })
  ok('R4 se propone aunque haya una subida pendiente', reglasDePresupuesto([conSubida], C()).propuestas.some((p) => p.regla === 'R4'))
  ok('… pero bloqueada por otra cosa (cambio a mano, efecto abierto) no', reglasDePresupuesto([floja('f', { bloqueadaPresupuesto: true })], C()).propuestas.length === 0)
}

console.log('\n=== R4: presupuesto sobredimensionado → bajar ===')
{
  const r = reglasDePresupuesto([floja('f')], C())
  ok('usa el 20 % en 14 días → 50 → 15,4 (max(10×1,3; 14×1,1))', r.propuestas.length === 1 && r.propuestas[0].regla === 'R4' && r.propuestas[0].presupuestoNuevo === 15.4, j(r))
  ok('… motivo con cifras', /20 %/.test(r.propuestas[0]?.motivo ?? '') && /50,00 → 15,40/.test(r.propuestas[0]?.motivo ?? ''), r.propuestas[0]?.motivo)
  ok('usa el 50 % → no baja', reglasDePresupuesto([floja('f', { mediaGasto14: 25 })], C()).propuestas.length === 0)
  ok('con 9 días de datos → no baja', reglasDePresupuesto([floja('f', { diasConDatos14: 9 })], C()).propuestas.length === 0)
  ok('postura crecer → no baja', reglasDePresupuesto([floja('f', { postura: 'crecer' })], C()).propuestas.length === 0)
  ok('bloqueada → no baja', reglasDePresupuesto([floja('f', { bloqueadaPresupuesto: true })], C()).propuestas.length === 0)
  ok('bajaría menos de un 20 % → no baja (18 → 15,4)', reglasDePresupuesto([floja('f', { presupuesto: 18, mediaGasto14: 6 })], C()).propuestas.length === 0)
  const min = reglasDePresupuesto([floja('f', { presupuesto: 10, mediaGasto14: 0.2, maxGasto14: 0.5 })], C())
  ok('nunca baja de 1', min.propuestas[0]?.presupuestoNuevo === 1, j(min))
  // Agotada a las 13:00 con el presupuesto de siempre (mal ACoS: no es R1) durante un evento → no se baja
  const enEvento = floja('ev', { agotadaHoyMin: 13 * 60, gasto7: 300, ventas7: 600 })
  ok('agotada a las 13:00 con el presupuesto de siempre durante un evento → NO se baja', reglasDePresupuesto([enEvento], C({ evento: 'durante' })).propuestas.length === 0)
  ok('… ni en los 2 días previos', reglasDePresupuesto([enEvento], C({ evento: 'previo' })).propuestas.length === 0)
  ok('… fuera del evento sí', reglasDePresupuesto([enEvento], C()).propuestas.length === 1)
  ok('en evento, una que NO se agota sí se baja', reglasDePresupuesto([floja('f')], C({ evento: 'durante' })).propuestas.length === 1)
  const gana = reglasDePresupuesto([camp('r', { presupuesto: 50, mediaGasto14: 10, maxGasto14: 14 })], C())
  ok('R1 gana a R4 en la misma campaña (una sola propuesta, sube)', gana.propuestas.length === 1 && gana.propuestas[0].regla === 'R1', j(gana))
}

console.log('\n=== presión del día (R2 bajar · R3 subir) ===')
{
  const malo = camp('m', { gasto7: 150, ventas7: 300 }) // ACoS 50 % > 25 × 1,2
  ok('R2: agotada antes de las 18:00 en 2 de 3 días con ACoS 50 % → bajar', presionDelDia([malo], { ritmo: 'normal' }).m === 'bajar')
  ok('R2: con gasto y sin ventas → bajar', presionDelDia([camp('s', { ventas7: 0, gasto7: 40 })], { ritmo: 'normal' }).s === 'bajar')
  ok('R2: solo 1 de 3 días → nada', presionDelDia([{ ...malo, agotadaAntes18Dias3: 1 }], { ritmo: 'normal' }).m === undefined)
  ok('R2: ACoS 28 % (≤ 30) → nada', presionDelDia([camp('n', { gasto7: 168, ventas7: 600 })], { ritmo: 'normal' }).n === undefined)

  // R3: 2 al día de 10 de presupuesto, 4 pedidos y 30 clics en 14 d, ACoS 10 %
  const bueno = camp('b', { presupuesto: 10, gasto7: 14, ventas7: 140, agotadaAntes18Dias3: 0, pedidos14: 4, clics14: 30, gasto14: 30, ventas14: 300 })
  ok('R3: gasta poco con ACoS 10 % (≤ 25 × 0,8) → subir', presionDelDia([bueno], { ritmo: 'normal' }).b === 'subir')
  const sinR3 = (n: string, k: Partial<CampanaParaRitmo>, ritmo: 'normal' | 'recorte' = 'normal') => ok(n, presionDelDia([{ ...bueno, ...k }], { ritmo }).b === undefined)
  sinR3('R3: ritmo recorte → nada', {}, 'recorte')
  sinR3('R3: solo defensivo → nada', { soloDefensivo: true })
  sinR3('R3: marca → nada', { esMarca: true })
  sinR3('R3: postura recortar → nada', { postura: 'recortar' })
  sinR3('R3: 2 pedidos en 14 d → nada', { pedidos14: 2 })
  sinR3('R3: 10 clics (< 12) → nada', { clics14: 10 })
  sinR3('R3: 4 días con datos → nada', { diasConDatos7: 4 })
  sinR3('R3: gasta 6 al día de 10 → nada', { gasto7: 42 })
  sinR3('R3: ACoS 22 % (> 20) → nada', { ventas14: 136 })
}

console.log('\n=== ritmo del mes ===')
{
  type E = Parameters<typeof ritmoDelMes>[0]
  // Día 10 de 30: quedan 21 días. Techo 1.000. Proyección = gasto + 30 × 21
  const e = (proyeccion: number, extra: Partial<E> = {}): E => ({
    gastoMesHastaAyer: proyeccion - 30 * 21, techoMes: 1000, dia: 10, diasDelMes: 30, media7: 30,
    ritmoAnterior: 'normal', ritmoAnteriorEsDeEsteMes: true, diasDesdeCambio: null,
    acos30Cuenta: 20, acosObjetivoMedio: 25, tacos30: 8, tacosObjetivoPct: 10, ventasTotalesCrecen: true, evento: null, ...extra,
  })
  const r106 = ritmoDelMes(e(1060))
  ok('entra en recorte a 1,06', r106.ritmo === 'recorte' && r106.cambiado && r106.diasRestantes === 21 && r106.proyeccion === 1060, j(r106))
  ok('… motivo con cifras', /1060,00|1\.060,00/.test(r106.motivo) && /106 %/.test(r106.motivo), r106.motivo)
  ok('no entra a 1,04', ritmoDelMes(e(1040)).ritmo === 'normal')
  ok('en recorte, a 1,00 NO sale', ritmoDelMes(e(1000, { ritmoAnterior: 'recorte', diasDesdeCambio: 5 })).ritmo === 'recorte')
  const sale = ritmoDelMes(e(960, { ritmoAnterior: 'recorte', diasDesdeCambio: 5 }))
  ok('en recorte, a 0,96 sale (normal)', sale.ritmo === 'normal' && sale.cambiado, j(sale))
  // Última semana: día 25 de 30 (quedan 6)
  const ult = (p: number) => ritmoDelMes(e(p, { dia: 25, gastoMesHastaAyer: p - 30 * 6 }))
  ok('última semana: entra a 1,01', ult(1010).ritmo === 'recorte')
  ok('última semana: a 1,00 justo no entra', ult(1000).ritmo === 'normal')
  ok('crecer a 0,80 con ACoS, TACoS y ventas a favor', ritmoDelMes(e(800)).ritmo === 'crecer')
  ok('… no con ACoS 30 % > objetivo medio 25 %', ritmoDelMes(e(800, { acos30Cuenta: 30 })).ritmo === 'normal')
  ok('… no con TACoS 12 % > 10 %', ritmoDelMes(e(800, { tacos30: 12 })).ritmo === 'normal')
  ok('… no si las ventas totales caen', ritmoDelMes(e(800, { ventasTotalesCrecen: false })).ritmo === 'normal')
  ok('… no sin ACoS de cuenta', ritmoDelMes(e(800, { acos30Cuenta: null })).ritmo === 'normal')
  ok('en crecer, a 0,90 sigue en crecer', ritmoDelMes(e(900, { ritmoAnterior: 'crecer', diasDesdeCambio: 5 })).ritmo === 'crecer')
  ok('en crecer, a 0,96 sale (normal)', ritmoDelMes(e(960, { ritmoAnterior: 'crecer', diasDesdeCambio: 5 })).ritmo === 'normal')
  ok('desde normal, a 0,90 no entra en crecer', ritmoDelMes(e(900)).ritmo === 'normal')
  // Antes del día 4
  ok('día 3: se mantiene el recorte de este mes aunque vaya a 0,5', ritmoDelMes(e(500, { dia: 3, ritmoAnterior: 'recorte' })).ritmo === 'recorte')
  ok('día 3: con 1,5 y ritmo normal no cambia', ritmoDelMes(e(1500, { dia: 3 })).ritmo === 'normal')
  const nuevoMes = ritmoDelMes(e(1500, { dia: 2, ritmoAnterior: 'recorte', ritmoAnteriorEsDeEsteMes: false }))
  ok('día 2 con un recorte del mes pasado → normal', nuevoMes.ritmo === 'normal' && nuevoMes.cambiado, j(nuevoMes))
  // Un cambio cada 3 días
  const reciente = ritmoDelMes(e(1200, { diasDesdeCambio: 1 }))
  ok('no cambia dos veces en 3 días (cambió hace 1 día, a 1,2 sigue normal)', reciente.ritmo === 'normal' && !reciente.cambiado && /hace 1 días?/.test(reciente.motivo), j(reciente))
  ok('… a los 3 días sí cambia', ritmoDelMes(e(1200, { diasDesdeCambio: 3 })).ritmo === 'recorte')
  // Evento
  const ev = ritmoDelMes(e(1200, { evento: 'durante' }))
  ok('durante un evento nunca recorte (y lo dice)', ev.ritmo === 'normal' && /temporada/i.test(ev.motivo), j(ev))
  ok('en los 2 días previos tampoco', ritmoDelMes(e(1200, { evento: 'previo' })).ritmo === 'normal')
  ok('si venía de recorte, en el evento sale a normal aunque cambiara ayer', ritmoDelMes(e(1200, { evento: 'durante', ritmoAnterior: 'recorte', diasDesdeCambio: 1 })).ritmo === 'normal')
  ok('después del evento sí puede recortar', ritmoDelMes(e(1200, { evento: 'posterior' })).ritmo === 'recorte')
  ok('sin techo → normal', ritmoDelMes(e(5000, { techoMes: null, ritmoAnterior: 'normal' })).ritmo === 'normal')
}

console.log('\n=== recorte por ritmo ===')
{
  // Techo 1.000, proyección 1.120, quedan 20 días → exceso de 6 al día
  const mes = (proyeccion: number, ritmo: 'recorte' | 'normal' = 'recorte'): EstadoDelMes => ({
    gastoMes: 500, techo: 1000, proyeccion, media7: 31, diasRestantes: 20, ritmo, cambiado: false, motivo: '',
  })
  const sinVentas = camp('sv', { gasto7: 70, ventas7: 0, presupuesto: 15 }) // 10 al día → 2
  const mala = camp('ma', { gasto7: 140, ventas7: 280, presupuesto: 30 }) // ACoS 50 %, 20 al día → 4
  const buena = camp('bu', { gasto7: 210, ventas7: 2100, presupuesto: 40 }) // ACoS 10 %, 30 al día → 6
  const r = recortePorRitmo([buena, sinVentas, mala], mes(1120), 1)
  ok('primero presión «bajar» en las que peor rinden, por gasto: mala y sin ventas cubren 6', j(r.presionBajar) === j(['ma', 'sv']), j(r))
  ok('… el primer y segundo día, sin tocar presupuestos', r.propuestas.length === 0)
  ok('al 2.º día con 1,12 todavía sin presupuestos', recortePorRitmo([buena, sinVentas, mala], mes(1120), 2).propuestas.length === 0)
  const tercero = recortePorRitmo([buena, sinVentas, mala], mes(1120), 3)
  ok('al 3.er día con 1,12 → presupuesto −20 % en esas campañas', tercero.propuestas.length === 2 && tercero.propuestas.every((p) => p.regla === 'recorte' && p.clase === 'presupuesto_bajar') && tercero.propuestas.find((p) => p.campaignId === 'ma')?.presupuestoNuevo === 24, j(tercero.propuestas))
  ok('… motivo con cifras', /3 días en recorte/.test(tercero.propuestas[0]?.motivo ?? '') && /−20 %/.test(tercero.propuestas[0]?.motivo ?? ''), tercero.propuestas[0]?.motivo)
  ok('al 3.er día con 1,08 → solo presión, sin presupuestos', recortePorRitmo([buena, sinVentas, mala], mes(1080), 3).propuestas.length === 0)
  ok('una campaña bloqueada no baja de presupuesto', recortePorRitmo([buena, sinVentas, { ...mala, bloqueadaPresupuesto: true }], mes(1120), 3).propuestas.length === 1)
  const amplio = recortePorRitmo([buena, sinVentas, mala], mes(1300), 1)
  ok('si las malas no bastan, sigue con las demás', amplio.presionBajar.length === 3 && amplio.presionBajar[2] === 'bu', j(amplio))
  ok('mínimo 1 de presupuesto', recortePorRitmo([camp('mi', { gasto7: 70, ventas7: 0, presupuesto: 1.1 })], mes(1120), 3).propuestas[0]?.presupuestoNuevo === 1)
  ok('ritmo normal → nada', recortePorRitmo([mala], mes(1120, 'normal'), 5).presionBajar.length === 0)
}

console.log('\n=== postura por reglas ===')
{
  type P = Parameters<typeof posturaPorReglas>[0]
  const p = (extra: Partial<P> = {}): P => ({
    acos14Pct: 15, clics14: 100, muestraMinima: 12, acosObjetivoPct: 25, tieneEquilibrio: true, tacos30Pct: 8, tacosObjetivoPct: 10,
    ventasTotalesCrecen: true, tacosBaja: true, coberturaDias: 40, stock: 200, soloDefensivo: false, esMarca: false, fase: 'normal', ...extra,
  })
  ok('todo a favor y ritmo crecer → crecer', posturaPorReglas(p(), 'crecer').postura === 'crecer')
  ok('sin muestra (8 clics) → mantener', posturaPorReglas(p({ clics14: 8, acos14Pct: 80 }), 'crecer').postura === 'mantener')
  ok('ritmo normal → mantener', posturaPorReglas(p(), 'normal').postura === 'mantener')
  ok('sin equilibrio → mantener', posturaPorReglas(p({ tieneEquilibrio: false }), 'crecer').postura === 'mantener')
  ok('solo defensivo → mantener', posturaPorReglas(p({ soloDefensivo: true }), 'crecer').postura === 'mantener')
  ok('marca → mantener', posturaPorReglas(p({ esMarca: true }), 'crecer').postura === 'mantener')
  ok('ACoS 22 % (> 0,8 × 25) → mantener', posturaPorReglas(p({ acos14Pct: 22 }), 'crecer').postura === 'mantener')
  ok('ventas totales que no crecen → mantener', posturaPorReglas(p({ ventasTotalesCrecen: null }), 'crecer').postura === 'mantener')
  ok('TACoS 11 % que no baja → mantener', posturaPorReglas(p({ tacos30Pct: 11, tacosBaja: false }), 'crecer').postura === 'mantener')
  ok('TACoS 11 % que baja → crecer', posturaPorReglas(p({ tacos30Pct: 11, tacosBaja: true }), 'crecer').postura === 'crecer')
  ok('cobertura 10 días → mantener', posturaPorReglas(p({ coberturaDias: 10 }), 'crecer').postura === 'mantener')
  ok('cobertura desconocida → mantener', posturaPorReglas(p({ coberturaDias: null }), 'crecer').postura === 'mantener')
  const tacos = posturaPorReglas(p({ tacos30Pct: 13, ventasTotalesCrecen: false }), 'normal')
  ok('TACoS 13 % (> 1,2 × 10) sin crecer las ventas → recortar', tacos.postura === 'recortar' && /13 %/.test(tacos.motivo), j(tacos))
  ok('… con las ventas totales creciendo → no recorta', posturaPorReglas(p({ tacos30Pct: 13, ventasTotalesCrecen: true }), 'normal').postura === 'mantener')
  ok('ACoS 14 d 35 % (> 1,3 × 25) → recortar', posturaPorReglas(p({ acos14Pct: 35 }), 'normal').postura === 'recortar')
  ok('… salvo en lanzamiento', posturaPorReglas(p({ acos14Pct: 35, fase: 'lanzamiento' }), 'normal').postura === 'mantener')
  ok('cobertura 5 días → recortar', posturaPorReglas(p({ coberturaDias: 5 }), 'crecer').postura === 'recortar')
  ok('stock 0 → recortar', posturaPorReglas(p({ stock: 0, coberturaDias: null }), 'crecer').postura === 'recortar')
}

console.log('\n=== A4: las ventanas de ACoS acaban en los días con las ventas ya atribuidas ===')
{
  // Una campaña con ACoS REAL igual al objetivo (25 %): 30 al día de gasto y 120 de ventas. Los 2 últimos días Amazon aún no ha atribuido todas las ventas (salen un 40 % o un 60 % más bajas)
  const fechaLocal = '2026-11-20'
  const dias = (corte: number): DiaDeCampana[] =>
    Array.from({ length: 17 }, (_, i) => {
      const fecha = new Date(Date.parse('2026-11-03T00:00:00Z') + i * 86_400_000).toISOString().slice(0, 10)
      const ultimos = fecha >= '2026-11-18'
      return { campaignId: 'nu', nombre: 'B0X | SKU | NU', fecha, clics: 30, gasto: 30, ventas: ultimos ? 120 * (1 - corte) : 120, pedidos: ultimos ? 2 : 4, unidades: 4 }
    })
  const hasta = ultimoDiaCerrado(dias(0.4), fechaLocal)
  const hastaVentas = ultimoDiaConVentasCerradas(hasta, fechaLocal, 3)
  ok('hasta = ayer; hastaVentas = 3 días antes de hoy', hasta === '2026-11-19' && hastaVentas === '2026-11-17', `${hasta} ${hastaVentas}`)
  ok('hastaVentas nunca pasa de «hasta» (si el rendimiento va atrasado)', ultimoDiaConVentasCerradas('2026-11-15', fechaLocal, 3) === '2026-11-15')
  const ventana = (filas: DiaDeCampana[], h: string) => sumarDias(filas, new Date(Date.parse(`${h}T00:00:00Z`) - 6 * 86_400_000).toISOString().slice(0, 10), h)
  const comoCampana = (w: ReturnType<typeof sumarDias>, id: string) => camp(id, { gasto7: w.gasto, ventas7: w.ventas, pedidos7: w.pedidos, clics7: w.clics, diasConDatos7: w.dias, acosParaBajar: 25 })
  const mes: EstadoDelMes = { gastoMes: 500, techo: 1000, proyeccion: 1060, media7: 31, diasRestantes: 20, ritmo: 'recorte', cambiado: false, motivo: '' }
  // La «mala» de verdad (ACoS 50 %) cubre ella sola el exceso de 3 al día
  const mala = camp('ma', { gasto7: 140, ventas7: 280, presupuesto: 30, acosParaBajar: 25 })

  const antes = recortePorRitmo([comoCampana(ventana(dias(0.4), hasta), 'nu'), mala], mes, 1)
  ok('con la ventana hasta ayer (ventas a medio atribuir) la que cumple el objetivo salía «mala»', antes.presionBajar[0] === 'nu', j(antes))
  const ahora = recortePorRitmo([comoCampana(ventana(dias(0.4), hastaVentas), 'nu'), mala], mes, 1)
  ok('con la ventana de hastaVentas no se la marca mala (baja la mala de verdad)', j(ahora.presionBajar) === j(['ma']), j(ahora))

  const r2Antes = presionDelDia([comoCampana(ventana(dias(0.6), hasta), 'nu')], { ritmo: 'normal' })
  ok('R2 con la ventana hasta ayer daba «bajar»', r2Antes.nu === 'bajar', j(r2Antes))
  const r2 = presionDelDia([comoCampana(ventana(dias(0.6), hastaVentas), 'nu')], { ritmo: 'normal' })
  ok('R2 con la ventana de hastaVentas no da «bajar»', r2.nu !== 'bajar', j(r2))
  const w = ventana(dias(0.6), hastaVentas)
  ok('gasto y ventas del cociente salen de la MISMA ventana (7 días, ACoS 25 %)', w.dias === 7 && Math.abs((w.gasto / w.ventas) * 100 - 25) < 1e-9, j(w))
}

console.log(fallos ? `\n${fallos} FALLOS` : '\nTodo OK')
if (fallos) process.exit(1)
