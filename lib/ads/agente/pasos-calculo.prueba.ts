import { SIN_SELLO_DE_VIGILAR, diaDeRampa, ensayoAlReanudar, ensayoTerminado, finDeEnsayo, horaEnMadrid, lunesLocal, motorFueraDeModoAgente, pasoCabe, siguientePaso, textoDeEstado } from './pasos-calculo'
import type { ConfigDelAgente, EstadoDelAgente, MarcasDePasos } from './tipos'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/** PASOS DEL AGENTE. Cuenta de Nueva York (UTC−5 en noviembre); Madrid va a UTC+1 en noviembre */

const T = (iso: string) => Date.parse(iso)
const NY = 'America/New_York'

/** Fecha y hora local de pared en una zona (para montar `local` como lo haría el servidor con horaLocal) */
const local = (ahora: number, zona = NY) => {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: zona, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  const v: Record<string, string> = {}
  for (const p of f.formatToParts(new Date(ahora))) v[p.type] = p.value
  return { fecha: `${v.year}-${v.month}-${v.day}`, hora: Number(v.hour) % 24, minutos: Number(v.minute) }
}

// Miércoles 18 nov 2026, 10:00 UTC = 11:00 Madrid = 05:00 Nueva York
const AHORA = T('2026-11-18T10:00:00Z')
const iso = (ms: number) => new Date(ms).toISOString()

/** Todo hecho a las 10:00 UTC del 18 nov */
const hecho = (extra: Partial<MarcasDePasos> = {}): MarcasDePasos => ({
  vigilarAt: iso(AHORA - 5 * 60_000),
  aplicarAt: iso(AHORA - 2 * 60_000),
  cerebroAt: '2026-11-18T07:05:00Z', // 08:05 Madrid
  cerebroTardeDia: '2026-11-18',
  resumenDia: '2026-11-18',
  efectosDia: '2026-11-18',
  efectosResto: false,
  objetivosDia: '2026-11-18',
  terminosSemana: '2026-11-16',
  limpiezaDia: '2026-11-18',
  calibradoAt: iso(AHORA - 86_400_000),
  ...extra,
})

const paso = (o: { estado?: EstadoDelAgente; marcas?: Partial<MarcasDePasos>; ahora?: number; hayPendientes?: boolean; rarasSinIa?: number; hayTerminosSinIa?: boolean; pensarYa?: boolean; zona?: string }) => {
  const ahora = o.ahora ?? AHORA
  return siguientePaso({
    estado: o.estado ?? 'activo',
    marcas: hecho(o.marcas),
    ahora,
    local: local(ahora, o.zona),
    hayPendientes: o.hayPendientes ?? false,
    rarasSinIa: o.rarasSinIa ?? 0,
    hayTerminosSinIa: o.hayTerminosSinIa ?? false,
    pensarYa: o.pensarYa ?? false,
  })
}

const NULOS: MarcasDePasos = {
  vigilarAt: null, aplicarAt: null, cerebroAt: null, cerebroTardeDia: null, resumenDia: null, efectosDia: null, efectosResto: false,
  objetivosDia: null, terminosSemana: null, limpiezaDia: null, calibradoAt: null,
}

console.log('\n=== hora de Madrid ===')
{
  const m = horaEnMadrid(T('2026-11-18T23:30:00Z'))
  ok('23:30 UTC del 18 nov = 00:30 del 19 en Madrid', m.fecha === '2026-11-19' && m.hora === 0 && m.minutos === 30, JSON.stringify(m))
  ok('inicio del día = 18 nov 23:00 UTC', m.inicioDelDia === '2026-11-18T23:00:00.000Z', m.inicioDelDia)
  ok('inicio del mes = 31 oct 23:00 UTC', m.inicioDelMes === '2026-10-31T23:00:00.000Z', m.inicioDelMes)
  const v = horaEnMadrid(T('2026-07-15T12:00:00Z'))
  ok('verano: 12:00 UTC = 14:00 Madrid, mes desde el 30 jun 22:00 UTC', v.hora === 14 && v.inicioDelMes === '2026-06-30T22:00:00.000Z', JSON.stringify(v))
  const c = horaEnMadrid(T('2026-10-25T10:00:00Z'))
  ok('día del cambio de hora (25 oct): 11:00 y el día empezó a las 22:00 UTC (horario de verano)', c.hora === 11 && c.inicioDelDia === '2026-10-24T22:00:00.000Z', JSON.stringify(c))
}

console.log('\n=== lunes local ===')
ok('domingo 15 nov → lunes 9', lunesLocal('2026-11-15') === '2026-11-09', lunesLocal('2026-11-15'))
ok('lunes 16 → él mismo', lunesLocal('2026-11-16') === '2026-11-16')
ok('miércoles 18 → lunes 16', lunesLocal('2026-11-18') === '2026-11-16')
ok('domingo 1 nov → lunes 26 oct (cruza el mes)', lunesLocal('2026-11-01') === '2026-10-26', lunesLocal('2026-11-01'))
ok('viernes 1 ene 2027 → lunes 28 dic 2026 (cruza el año)', lunesLocal('2027-01-01') === '2026-12-28', lunesLocal('2027-01-01'))

console.log('\n=== nada que hacer / apagado ===')
ok('todo hecho → null', paso({}) === null, String(paso({})))
ok('apagado con todo por hacer → null', siguientePaso({ estado: 'apagado', marcas: NULOS, ahora: AHORA, local: local(AHORA), hayPendientes: true, rarasSinIa: 3, hayTerminosSinIa: true, pensarYa: true }) === null)

console.log('\n=== vigilar (cada 30 min) ===')
ok('sin sello → vigilar', paso({ marcas: { vigilarAt: null } }) === 'vigilar')
ok('hace 30 min → vigilar', paso({ marcas: { vigilarAt: iso(AHORA - 30 * 60_000) } }) === 'vigilar')
ok('hace 29 min → nada', paso({ marcas: { vigilarAt: iso(AHORA - 29 * 60_000) } }) === null)

console.log('\n=== aplicar (cada 10 min, con pendientes, en ensayo o activo) ===')
ok('activo, pendientes, hace 10 min → aplicar', paso({ hayPendientes: true, marcas: { aplicarAt: iso(AHORA - 10 * 60_000) } }) === 'aplicar')
ok('ensayo, pendientes, sin sello → aplicar', paso({ estado: 'ensayo', hayPendientes: true, marcas: { aplicarAt: null } }) === 'aplicar')
ok('hace 9 min → nada', paso({ hayPendientes: true, marcas: { aplicarAt: iso(AHORA - 9 * 60_000) } }) === null)
ok('sin pendientes → nada', paso({ hayPendientes: false, marcas: { aplicarAt: null } }) === null)
ok('frenado con pendientes → nada', paso({ estado: 'frenado', hayPendientes: true, marcas: { aplicarAt: null } }) === null)
ok('vigilar gana a aplicar', paso({ hayPendientes: true, marcas: { aplicarAt: null, vigilarAt: null } }) === 'vigilar')

console.log('\n=== objetivos (fecha LOCAL del marketplace) ===')
ok('sello de ayer → objetivos', paso({ marcas: { objetivosDia: '2026-11-17' } }) === 'objetivos')
{
  // 19 nov 02:00 UTC: en Madrid ya es 19 (03:00), en Nueva York sigue siendo 18 (21:00)
  const a = T('2026-11-19T02:00:00Z')
  const m = { vigilarAt: iso(a - 60_000), objetivosDia: '2026-11-18', efectosDia: '2026-11-18', resumenDia: '2026-11-18', cerebroTardeDia: '2026-11-18' }
  ok('NY aún 18 aunque Madrid sea 19 → no toca objetivos', paso({ ahora: a, marcas: m }) === null, String(paso({ ahora: a, marcas: m })))
  ok('la misma hora con sello del 17 → objetivos', paso({ ahora: a, marcas: { ...m, objetivosDia: '2026-11-17' } }) === 'objetivos')
}
ok('frenado → objetivos sí', paso({ estado: 'frenado', marcas: { objetivosDia: '2026-11-17' } }) === 'objetivos')

console.log('\n=== cerebro (hora de Madrid) ===')
ok('mañana: 11:00 Madrid, cerebro de ayer → cerebro', paso({ marcas: { cerebroAt: '2026-11-17T07:10:00Z' } }) === 'cerebro')
ok('mañana: sin sello → cerebro', paso({ marcas: { cerebroAt: null } }) === 'cerebro')
ok('mañana: 07:59 Madrid → todavía no', paso({ ahora: T('2026-11-18T06:59:00Z'), marcas: { cerebroAt: '2026-11-17T07:10:00Z', vigilarAt: '2026-11-18T06:50:00Z' } }) === null)
ok('mañana: 08:00 Madrid en punto → cerebro', paso({ ahora: T('2026-11-18T07:00:00Z'), marcas: { cerebroAt: '2026-11-17T07:10:00Z', vigilarAt: '2026-11-18T06:50:00Z' } }) === 'cerebro')
ok('mañana: hecho a las 07:30 Madrid (antes de las 8) → cerebro otra vez', paso({ marcas: { cerebroAt: '2026-11-18T06:30:00Z' } }) === 'cerebro')
ok('día del cambio de hora: hecho a las 07:30 locales (06:30 UTC) → cerebro', paso({ ahora: T('2026-10-25T10:00:00Z'), marcas: { cerebroAt: '2026-10-25T06:30:00Z', vigilarAt: '2026-10-25T09:55:00Z', aplicarAt: null, objetivosDia: '2026-10-25', resumenDia: '2026-10-25', efectosDia: '2026-10-25', terminosSemana: '2026-10-19', cerebroTardeDia: '2026-10-25' } }) === 'cerebro')
{
  const tarde = T('2026-11-18T14:00:00Z') // 15:00 Madrid, 09:00 NY
  const m = { vigilarAt: iso(tarde - 60_000), cerebroTardeDia: '2026-11-17' }
  ok('tarde: 15:00 Madrid con raras sin IA → cerebro', paso({ ahora: tarde, marcas: m, rarasSinIa: 2 }) === 'cerebro')
  ok('tarde: con términos sin etiqueta → cerebro', paso({ ahora: tarde, marcas: m, hayTerminosSinIa: true }) === 'cerebro')
  ok('tarde: sin raras ni términos → nada', paso({ ahora: tarde, marcas: m }) === null)
  ok('tarde: ya hecha hoy → nada', paso({ ahora: tarde, marcas: { ...m, cerebroTardeDia: '2026-11-18' }, rarasSinIa: 2 }) === null)
  ok('tarde: 14:59 Madrid → todavía no', paso({ ahora: tarde - 60_000, marcas: { ...m, vigilarAt: iso(tarde - 120_000) }, rarasSinIa: 2 }) === null)
}
ok('pensar ya → cerebro aunque esté hecho', paso({ pensarYa: true }) === 'cerebro')
ok('frenado: ni con pensar ya', paso({ estado: 'frenado', pensarYa: true, marcas: { cerebroAt: null } }) === null)
ok('objetivos gana a cerebro', paso({ marcas: { cerebroAt: null, objetivosDia: '2026-11-17' } }) === 'objetivos')

console.log('\n=== resumen (09:00 Madrid) ===')
ok('11:00 Madrid, resumen de ayer → resumen', paso({ marcas: { resumenDia: '2026-11-17' } }) === 'resumen')
ok('08:59 Madrid → todavía no', paso({ ahora: T('2026-11-18T07:59:00Z'), marcas: { resumenDia: '2026-11-17', vigilarAt: '2026-11-18T07:50:00Z' } }) === null)
ok('09:00 Madrid → resumen', paso({ ahora: T('2026-11-18T08:00:00Z'), marcas: { resumenDia: '2026-11-17', vigilarAt: '2026-11-18T07:50:00Z' } }) === 'resumen')
ok('frenado → resumen sí', paso({ estado: 'frenado', marcas: { resumenDia: '2026-11-17' } }) === 'resumen')
ok('cerebro gana a resumen', paso({ marcas: { resumenDia: '2026-11-17', cerebroAt: null } }) === 'cerebro')

console.log('\n=== efectos (06:00 locales o resto pendiente) ===')
{
  const seis = T('2026-11-18T11:00:00Z') // 06:00 NY
  const m = { vigilarAt: iso(seis - 60_000), efectosDia: '2026-11-17' }
  ok('06:00 en NY, sello de ayer → efectos', paso({ ahora: seis, marcas: m }) === 'efectos')
  ok('05:59 en NY → todavía no', paso({ ahora: seis - 60_000, marcas: { ...m, vigilarAt: iso(seis - 120_000) } }) === null)
  ok('05:00 en NY con resto pendiente → efectos', paso({ marcas: { efectosResto: true } }) === 'efectos')
  ok('frenado → efectos sí', paso({ estado: 'frenado', ahora: seis, marcas: m }) === 'efectos')
  ok('resumen gana a efectos', paso({ ahora: seis, marcas: { ...m, resumenDia: '2026-11-17' } }) === 'resumen')
}

console.log('\n=== términos de la semana (lunes local) ===')
ok('sello del lunes pasado → terminos_semana', paso({ marcas: { terminosSemana: '2026-11-09' } }) === 'terminos_semana')
ok('sin sello → terminos_semana', paso({ marcas: { terminosSemana: null } }) === 'terminos_semana')
{
  // Lunes 23 nov 03:00 UTC: en Madrid ya es lunes, en NY aún domingo 22 → la semana local sigue siendo la del 16
  const a = T('2026-11-23T03:00:00Z')
  const m = { vigilarAt: iso(a - 60_000), objetivosDia: '2026-11-22', efectosDia: '2026-11-22', resumenDia: '2026-11-23', cerebroAt: '2026-11-22T07:05:00Z', cerebroTardeDia: '2026-11-22', terminosSemana: '2026-11-16' }
  ok('domingo en NY (lunes en Madrid) → aún no toca', paso({ ahora: a, marcas: m }) === null, String(paso({ ahora: a, marcas: m })))
  const b = T('2026-11-23T06:00:00Z') // lunes 01:00 NY
  ok('lunes en NY → terminos_semana', paso({ ahora: b, marcas: { ...m, vigilarAt: iso(b - 60_000), objetivosDia: '2026-11-23' } }) === 'terminos_semana', String(paso({ ahora: b, marcas: { ...m, vigilarAt: iso(b - 60_000), objetivosDia: '2026-11-23' } })))
}
ok('frenado → terminos_semana sí', paso({ estado: 'frenado', marcas: { terminosSemana: '2026-11-09' } }) === 'terminos_semana')

console.log('\n=== calibrar (cada 28 días) ===')
ok('sin sello → calibrar', paso({ marcas: { calibradoAt: null } }) === 'calibrar')
ok('hace 28 días → calibrar', paso({ marcas: { calibradoAt: iso(AHORA - 28 * 86_400_000) } }) === 'calibrar')
ok('hace 27 días → nada', paso({ marcas: { calibradoAt: iso(AHORA - 27 * 86_400_000) } }) === null)
ok('frenado → no calibra', paso({ estado: 'frenado', marcas: { calibradoAt: null } }) === null)
ok('términos gana a calibrar', paso({ marcas: { calibradoAt: null, terminosSemana: '2026-11-09' } }) === 'terminos_semana')

console.log('\n=== prioridad completa, sellando cada paso ===')
{
  const orden: string[] = []
  const m: MarcasDePasos = { ...NULOS }
  const l = local(AHORA)
  for (let i = 0; i < 10; i++) {
    const p = siguientePaso({ estado: 'ensayo', marcas: m, ahora: AHORA, local: l, hayPendientes: true, rarasSinIa: 0, hayTerminosSinIa: false, pensarYa: false })
    if (!p) break
    orden.push(p)
    if (p === 'vigilar') m.vigilarAt = iso(AHORA)
    if (p === 'aplicar') m.aplicarAt = iso(AHORA)
    if (p === 'objetivos') m.objetivosDia = l.fecha
    if (p === 'cerebro') m.cerebroAt = iso(AHORA)
    if (p === 'resumen') m.resumenDia = '2026-11-18'
    if (p === 'efectos') m.efectosDia = l.fecha
    if (p === 'terminos_semana') m.terminosSemana = lunesLocal(l.fecha)
    if (p === 'calibrar') m.calibradoAt = iso(AHORA)
  }
  // 05:00 en NY: efectos aún no (hora local < 6)
  const esperado = 'vigilar,aplicar,objetivos,cerebro,resumen,terminos_semana,calibrar'
  ok('ensayo a las 05:00 NY: ' + esperado, orden.join(',') === esperado, orden.join(','))
  const f: string[] = []
  const mf: MarcasDePasos = { ...NULOS }
  const a = T('2026-11-18T12:00:00Z') // 07:00 NY, 13:00 Madrid
  const lf = local(a)
  for (let i = 0; i < 10; i++) {
    const p = siguientePaso({ estado: 'frenado', marcas: mf, ahora: a, local: lf, hayPendientes: true, rarasSinIa: 5, hayTerminosSinIa: true, pensarYa: true })
    if (!p) break
    f.push(p)
    if (p === 'vigilar') mf.vigilarAt = iso(a)
    if (p === 'objetivos') mf.objetivosDia = lf.fecha
    if (p === 'resumen') mf.resumenDia = '2026-11-18'
    if (p === 'efectos') mf.efectosDia = lf.fecha
    if (p === 'terminos_semana') mf.terminosSemana = lunesLocal(lf.fecha)
  }
  ok('frenado: vigilar,objetivos,resumen,efectos,terminos_semana', f.join(',') === 'vigilar,objetivos,resumen,efectos,terminos_semana', f.join(','))
}

console.log('\n=== ¿cabe el paso? (240 s de pasada) ===')
ok('cerebro (75 s) a 170 s → no', pasoCabe('cerebro', 170_000, 240_000) === false)
ok('cerebro a 165 s (quedan 75) → sí', pasoCabe('cerebro', 165_000, 240_000) === true)
ok('vigilar (15 s) a 225 s → sí', pasoCabe('vigilar', 225_000, 240_000) === true)
ok('vigilar a 226 s → no', pasoCabe('vigilar', 226_000, 240_000) === false)
ok('aplicar (40 s) al empezar → sí', pasoCabe('aplicar', 0, 240_000) === true)
ok('aplicar a 201 s → no', pasoCabe('aplicar', 201_000, 240_000) === false)
ok('ya pasado del presupuesto → no', pasoCabe('calibrar', 250_000, 240_000) === false)

console.log('\n=== ensayo ===')
ok('fin de ensayo = 3 días después', finDeEnsayo(T('2026-11-15T10:00:00Z'), false) === '2026-11-18T10:00:00.000Z', String(finDeEnsayo(T('2026-11-15T10:00:00Z'), false)))
ok('saltar el ensayo → null', finDeEnsayo(T('2026-11-15T10:00:00Z'), true) === null)
{
  const c = { estado: 'ensayo' as const, ensayoHasta: '2026-11-18T10:00:00Z' }
  ok('cumplido y sin veda → terminado', ensayoTerminado(c, T('2026-11-18T10:00:00Z'), null) === true)
  ok('un minuto antes → no', ensayoTerminado(c, T('2026-11-18T09:59:00Z'), null) === false)
  ok('cumplido pero en veda (20 nov → 2 dic) → no', ensayoTerminado(c, T('2026-11-21T10:00:00Z'), { hasta: '2026-12-02' }) === false)
  ok('activo → no (ya no está en ensayo)', ensayoTerminado({ estado: 'activo', ensayoHasta: c.ensayoHasta }, T('2026-11-20T10:00:00Z'), null) === false)
  ok('ensayo sin fecha → no', ensayoTerminado({ estado: 'ensayo', ensayoHasta: null }, T('2026-11-20T10:00:00Z'), null) === false)
}

console.log('\n=== rampa (días entre fechas locales) ===')
ok('sin rampa → null', diaDeRampa(null, '2026-11-20') === null)
ok('mismo día → 0', diaDeRampa('2026-11-20', '2026-11-20') === 0)
ok('día siguiente → 1', diaDeRampa('2026-11-20', '2026-11-21') === 1)
ok('cruza el mes: 30 nov → 6 dic = 6', diaDeRampa('2026-11-30', '2026-12-06') === 6)
ok('cruza el cambio de hora de NY (1 nov): 31 oct → 2 nov = 2', diaDeRampa('2026-10-31', '2026-11-02') === 2)
ok('fecha de hoy anterior (no debería) → 0', diaDeRampa('2026-11-21', '2026-11-20') === 0)
{
  // Empieza el 20 nov 03:00 UTC = 19 nov 22:00 en NY; el 21 nov 04:00 UTC = 20 nov 23:00 en NY → día 1 (en UTC serían 1 también, en Madrid 20→21 = 1)
  const desde = local(T('2026-11-20T03:00:00Z')).fecha
  const hoy = local(T('2026-11-21T04:00:00Z')).fecha
  ok('NY: 19 nov → 20 nov = día 1', desde === '2026-11-19' && hoy === '2026-11-20' && diaDeRampa(desde, hoy) === 1, `${desde} ${hoy}`)
  // A las 04:30 UTC del 20 nov: en NY sigue siendo el 19 → día 0 (en UTC sería día 1)
  ok('NY: aún el mismo día local → 0', diaDeRampa(desde, local(T('2026-11-20T04:30:00Z')).fecha) === 0)
}

console.log('\n=== texto de estado ===')
const conf = (c: Partial<ConfigDelAgente>): Pick<ConfigDelAgente, 'estado' | 'ensayoHasta' | 'frenoMotivo' | 'frenoDetalle' | 'encendidoAt' | 'activoDesde' | 'rampaDesde'> => ({
  estado: 'apagado', ensayoHasta: null, frenoMotivo: null, frenoDetalle: null, encendidoAt: null, activoDesde: null, rampaDesde: null, ...c,
})
const BF = { nombre: 'Black Friday', hasta: '2026-12-02' }
{
  const t1 = textoDeEstado(null, AHORA, 'Europe/Madrid', null)
  ok('sin config → Apagado', t1 === 'Apagado', t1)
  const t2 = textoDeEstado(conf({ estado: 'apagado' }), AHORA, 'Europe/Madrid', null)
  ok('apagado → Apagado', t2 === 'Apagado', t2)
  const t3 = textoDeEstado(conf({ estado: 'ensayo', ensayoHasta: '2026-11-19T13:00:00Z' }), T('2026-11-17T10:00:00Z'), 'Europe/Madrid', null)
  ok('«En ensayo hasta el jueves 19 nov, 14:00»', t3 === 'En ensayo hasta el jueves 19 nov, 14:00', t3)
  const t3b = textoDeEstado(conf({ estado: 'ensayo', ensayoHasta: '2026-11-19T13:00:00Z' }), T('2026-11-17T10:00:00Z'), NY, null)
  ok('la misma hora en NY → «jueves 19 nov, 08:00»', t3b === 'En ensayo hasta el jueves 19 nov, 08:00', t3b)
  const t4 = textoDeEstado(conf({ estado: 'ensayo', ensayoHasta: '2026-11-21T13:00:00Z' }), T('2026-11-20T10:00:00Z'), 'Europe/Madrid', BF)
  ok('ensayo que acaba en la veda lo dice', t4 === 'En ensayo hasta el sábado 21 nov, 14:00 · no pasa a activo hasta el 3 dic (Black Friday)', t4)
  const t5 = textoDeEstado(conf({ estado: 'ensayo', ensayoHasta: '2026-11-21T13:00:00Z' }), T('2026-11-25T10:00:00Z'), 'Europe/Madrid', BF)
  ok('«Ensayo terminado: activo desde el 3 dic (Black Friday)»', t5 === 'Ensayo terminado: activo desde el 3 dic (Black Friday)', t5)
  const t6 = textoDeEstado(conf({ estado: 'ensayo', ensayoHasta: '2026-11-18T10:00:00Z' }), T('2026-11-18T10:05:00Z'), 'Europe/Madrid', null)
  ok('ensayo cumplido sin veda → pasa en la próxima vigilancia', t6.startsWith('Ensayo terminado'), t6)
  // Rampa con fechas locales: empieza el 20 nov 15:00 UTC; ahora el 22 nov 03:00 UTC
  const ram = conf({ estado: 'activo', activoDesde: '2026-11-20T15:00:00Z', rampaDesde: '2026-11-20T15:00:00Z' })
  const t7 = textoDeEstado(ram, T('2026-11-22T03:00:00Z'), NY, null)
  ok('NY (20 → 21 nov) → «Activo (rampa, día 2 de 7)»', t7 === 'Activo (rampa, día 2 de 7)', t7)
  const t8 = textoDeEstado(ram, T('2026-11-22T03:00:00Z'), 'Europe/Madrid', null)
  ok('Madrid (20 → 22 nov) → «día 3 de 7»', t8 === 'Activo (rampa, día 3 de 7)', t8)
  const t9 = textoDeEstado(ram, T('2026-11-26T20:00:00Z'), 'Europe/Madrid', null)
  ok('día 7 (26 nov) → «día 7 de 7»', t9 === 'Activo (rampa, día 7 de 7)', t9)
  const t10 = textoDeEstado(conf({ estado: 'activo', activoDesde: '2026-12-03T09:00:00Z', rampaDesde: '2026-12-03T09:00:00Z' }), T('2026-12-20T10:00:00Z'), 'Europe/Madrid', null)
  ok('rampa acabada → «Activo desde el 3 dic»', t10 === 'Activo desde el 3 dic', t10)
  const t11 = textoDeEstado(conf({ estado: 'frenado', frenoMotivo: 'gasto_disparado', frenoDetalle: 'Proyección 112 € frente a 61 € de media' }), AHORA, 'Europe/Madrid', null)
  ok('frenado con motivo y detalle', t11 === 'Frenado: el gasto de hoy se ha disparado. Proyección 112 € frente a 61 € de media', t11)
  const t12 = textoDeEstado(conf({ estado: 'frenado', frenoMotivo: 'manual' }), AHORA, 'Europe/Madrid', null)
  ok('frenado a mano', t12 === 'Frenado: lo ha frenado una persona', t12)
}

{
  console.log('\n· ensayoAlReanudar (frenado en el ensayo y reanudado después de ensayo_hasta)')
  const T = (iso: string) => Date.parse(iso)
  // Encendido el 15, ensayo hasta el 18; frena el 16 y una persona reanuda el 19 (pasado ensayo_hasta)
  const viejo = { estado: 'ensayo' as const, ensayoHasta: '2026-11-18T10:00:00.000Z' }
  const reanuda = T('2026-11-19T12:00:00Z')
  ok('sin mover ensayo_hasta, el siguiente vigilar lo pasaría a activo (el fallo)', ensayoTerminado(viejo, reanuda + 30 * 60_000, null) === true)
  const nuevo = { estado: 'ensayo' as const, ensayoHasta: ensayoAlReanudar(reanuda) }
  ok('con ensayoAlReanudar sigue en ensayo media hora después', ensayoTerminado(nuevo, reanuda + 30 * 60_000, null) === false)
  ok('y dos días después', ensayoTerminado(nuevo, reanuda + 2 * 86_400_000, null) === false)
  ok('termina a los 3 días completos', ensayoTerminado(nuevo, reanuda + 3 * 86_400_000, null) === true)
}

console.log('\n=== reanudar / encender: sin el sello del vigilar hecho en frenado ===')
{
  ok('anula vigilar_ok_at y vigilar_at', SIN_SELLO_DE_VIGILAR.vigilar_ok_at === null && SIN_SELLO_DE_VIGILAR.vigilar_at === null)
  // Recién reanudado (activo) con pendientes y aplicar sin hacer: el primer paso es vigilar (evalúa el freno con el «ignorar» nuevo), no aplicar
  const marcas = { aplicarAt: null, vigilarAt: SIN_SELLO_DE_VIGILAR.vigilar_at }
  ok('activo recién reanudado con pendientes → vigilar antes que aplicar', paso({ hayPendientes: true, marcas }) === 'vigilar', String(paso({ hayPendientes: true, marcas })))
  // El fallo: con el sello de hace 5 min (puesto en frenado), el paso era aplicar sin un vigilar que hubiera mirado el freno
  ok('con el sello heredado era aplicar (el fallo)', paso({ hayPendientes: true, marcas: { aplicarAt: null, vigilarAt: iso(AHORA - 5 * 60_000) } }) === 'aplicar')
}

console.log('\n=== el agente «en marcha» con el motor fuera del modo agente ===')
{
  ok('activo con el motor en «aprueba» (reanudar a medias) → aviso', motorFueraDeModoAgente('activo', 'aprueba') === true)
  ok('ensayo con el motor en «sugiere» → aviso', motorFueraDeModoAgente('ensayo', 'sugiere') === true)
  ok('activo sin fila de modo → aviso', motorFueraDeModoAgente('activo', null) === true)
  ok('activo con el motor en «agente» → nada', motorFueraDeModoAgente('activo', 'agente') === false)
  ok('frenado con el motor en «aprueba» (lo normal) → nada', motorFueraDeModoAgente('frenado', 'aprueba') === false)
  ok('apagado → nada', motorFueraDeModoAgente('apagado', 'sugiere') === false)
}

console.log(fallos ? `\n${fallos} FALLOS` : '\nTodo bien')
if (fallos) process.exit(1)
