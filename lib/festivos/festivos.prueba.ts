import { aniosConCalendario, avisoDeFestivo, cuandoEs, diaDeLaSemana, dondeEsFestivo, esFestivo, festivosDelDia, fiestasDe, hayCalendarioPara, proximoDiaHabil, proximosFestivos } from './festivos'
import { CALENDARIOS } from './datos'
import { FIESTAS_LOCALES } from './locales'
import { MUNICIPIOS_DE_ZONA, zonaDeMunicipio } from './zonas-especiales'
import { municipioDeIne, buscarMunicipios } from '@/lib/ubicacion/municipios'
import { normalizar } from '@/lib/ubicacion/texto'
import { CODIGOS_CCAA, type CodigoCcaa } from '@/lib/ubicacion/zonas'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}
const festivosEn = (dia: string) => CODIGOS_CCAA.filter((c) => esFestivo(dia, { ccaa: c })).sort().join(',')
const lista = (...cs: CodigoCcaa[]) => [...cs].sort().join(',')

console.log('\n=== los calendarios del BOE están enteros ===')
{
  ok('hay dos: 2026 y 2027', aniosConCalendario().join() === '2026,2027')
  const c26 = CALENDARIOS.find((c) => c.anio === 2026)!
  const c27 = CALENDARIOS.find((c) => c.anio === 2027)!
  ok('2026 viene del BOE-A-2025-21667 y 2027 del BOE-A-2026-21254', c26.fuente === 'BOE-A-2025-21667' && c27.fuente === 'BOE-A-2026-21254')
  ok('2026 trae 36 fiestas y 2027, 35', c26.fiestas.length === 36 && c27.fiestas.length === 35, `${c26.fiestas.length}/${c27.fiestas.length}`)
  ok('cada fiesta cae en el año de su calendario, en formato AAAA-MM-DD y sin repetirse', CALENDARIOS.every((c) => c.fiestas.every((f) => /^\d{4}-\d{2}-\d{2}$/.test(f.f) && f.f.startsWith(String(c.anio))) && new Set(c.fiestas.map((f) => f.f + f.n)).size === c.fiestas.length))
  ok('todas las comunidades que cita existen', CALENDARIOS.every((c) => c.fiestas.every((f) => f.c === 'todas' || (f.c.length > 0 && f.c.every((x) => CODIGOS_CCAA.includes(x))))))
  ok('cada fiesta de la tabla cae en un día real del año', CALENDARIOS.every((c) => c.fiestas.every((f) => { const m = Number(f.f.slice(5, 7)), d = Number(f.f.slice(8, 10)); return new Date(c.anio, m - 1, d).getDate() === d })))
  ok('los lunes de pascua son lunes, el jueves santo jueves y el viernes santo viernes', CALENDARIOS.every((c) => c.fiestas.every((f) => (!/^Lunes de Pascua/.test(f.n) || diaDeLaSemana(f.f) === 1) && (f.n !== 'Jueves Santo' || diaDeLaSemana(f.f) === 4) && (f.n !== 'Viernes Santo' || diaDeLaSemana(f.f) === 5))))
  ok('las que dicen «Lunes siguiente…» o «Día siguiente a Todos los Santos» caen en lunes', CALENDARIOS.every((c) => c.fiestas.every((f) => !/^(Lunes siguiente|Día siguiente a Todos)/.test(f.n) || diaDeLaSemana(f.f) === 1)))
  ok('las zonas: siete islas y el Valle de Arán cada año', CALENDARIOS.every((c) => new Set(c.zonas.map((z) => z.z)).size === 8))
  const nueve27 = c27.fiestas.filter((f) => f.c === 'todas').length
  ok('2027 tiene nueve fiestas comunes a toda España (lo que dice la prensa y el BOE)', nueve27 === 9, String(nueve27))
}

console.log('\n=== el lunes 2 de noviembre de 2026 (el ejemplo de Raúl) ===')
{
  ok('es festivo en Andalucía, Aragón, Asturias, Canarias, Castilla-La Mancha, Castilla y León, Extremadura, Madrid y Navarra', festivosEn('2026-11-02') === lista('AN', 'AR', 'AS', 'CN', 'CM', 'CL', 'EX', 'MD', 'NC'), festivosEn('2026-11-02'))
  ok('no lo es en Cataluña, Valencia, País Vasco, Galicia, Baleares, La Rioja, Murcia, Cantabria, Ceuta ni Melilla', !['CT', 'VC', 'PV', 'GA', 'IB', 'RI', 'MC', 'CB', 'CE', 'ME'].some((c) => esFestivo('2026-11-02', { ccaa: c as CodigoCcaa })))
  const a = avisoDeFestivo('2026-11-02', '2026-11-02', { ccaa: 'MD' })
  ok('el aviso de Madrid ese día', a?.titulo === 'Hoy es festivo en Madrid' && a?.detalle === 'Día siguiente a Todos los Santos', JSON.stringify(a))
  ok('visto desde el viernes, dice «el lunes 2 de noviembre»', avisoDeFestivo('2026-11-02', '2026-10-30', { ccaa: 'MD' })?.titulo === 'El lunes 2 de noviembre es festivo en Madrid')
  ok('y desde el domingo, «mañana»', avisoDeFestivo('2026-11-02', '2026-11-01', { ccaa: 'AN' })?.titulo === 'Mañana es festivo en Andalucía')
  ok('un lead de Cataluña ese día: sin aviso', avisoDeFestivo('2026-11-02', '2026-11-02', { ccaa: 'CT' }) === null)
  ok('el día 1 (domingo) es festivo en toda España en 2026? no: cae en domingo y el BOE no lo lista', festivosEn('2026-11-01') === '')
}

console.log('\n=== festivos de toda España ===')
{
  for (const dia of ['2026-01-01', '2026-04-03', '2026-05-01', '2026-08-15', '2026-10-12', '2026-12-08', '2026-12-25', '2027-01-01', '2027-03-26', '2027-11-01', '2027-12-06']) {
    ok(`${dia} lo es en las 19`, festivosEn(dia) === CODIGOS_CCAA.slice().sort().join(','), festivosEn(dia))
  }
  ok('su aviso dice «toda España»', avisoDeFestivo('2026-12-25', '2026-12-25', { ccaa: 'GA' })?.titulo === 'Hoy es festivo en toda España')
  ok('es de alcance nacional', fiestasDe('2026-12-25', { ccaa: 'GA' })[0].alcance === 'nacional')
}

console.log('\n=== Semana Santa: el jueves no es de todos ===')
{
  ok('Jueves Santo 2026 (2 de abril): no es festivo en Cataluña ni en la Comunitat Valenciana', !esFestivo('2026-04-02', { ccaa: 'CT' }) && !esFestivo('2026-04-02', { ccaa: 'VC' }) && esFestivo('2026-04-02', { ccaa: 'AN' }) && esFestivo('2026-04-02', { ccaa: 'ME' }))
  ok('Jueves Santo 2027 (25 de marzo): lo mismo', !esFestivo('2027-03-25', { ccaa: 'CT' }) && !esFestivo('2027-03-25', { ccaa: 'VC' }) && esFestivo('2027-03-25', { ccaa: 'MD' }))
  ok('Lunes de Pascua 2026 (6 de abril): Baleares, C-LM, Cataluña, Navarra, País Vasco, La Rioja y Valencia', festivosEn('2026-04-06') === lista('IB', 'CM', 'CT', 'NC', 'PV', 'RI', 'VC'), festivosEn('2026-04-06'))
  ok('Lunes de Pascua 2027 (29 de marzo): Baleares, Cataluña, Navarra, País Vasco, La Rioja y Valencia', festivosEn('2027-03-29') === lista('IB', 'CT', 'NC', 'PV', 'RI', 'VC'), festivosEn('2027-03-29'))
}

console.log('\n=== fiestas de una sola comunidad ===')
{
  ok('2 de mayo: Madrid', festivosEn('2026-05-02') === 'MD')
  ok('9 de octubre: Comunitat Valenciana', festivosEn('2026-10-09') === 'VC')
  ok('11 de septiembre: Cataluña', festivosEn('2026-09-11') === 'CT')
  ok('23 de abril: Aragón y Castilla y León', festivosEn('2026-04-23') === lista('AR', 'CL'))
  ok('28 de febrero de 2026: Andalucía; en 2027 es el 1 de marzo', festivosEn('2026-02-28') === 'AN' && festivosEn('2027-03-01') === lista('AN', 'IB'))
  ok('el lunes 16 de agosto de 2027 (Asunción en domingo): Andalucía, Aragón, Asturias, Canarias, Castilla y León y Madrid', festivosEn('2027-08-16') === lista('AN', 'AR', 'AS', 'CN', 'CL', 'MD'), festivosEn('2027-08-16'))
  ok('Ceuta y Melilla tienen las suyas (Eid, Nuestra Señora de África)', festivosEn('2026-08-05') === 'CE' && festivosEn('2026-03-20') === 'ME')
}

console.log('\n=== las islas de Canarias ===')
{
  const tfe = { ccaa: 'CN' as const, ine: '38038' } // Santa Cruz de Tenerife
  const gc = { ccaa: 'CN' as const, ine: '35016' } // Las Palmas de Gran Canaria
  const sinMunicipio = { ccaa: 'CN' as const }
  ok('Candelaria (2 de febrero) es festivo en Tenerife', esFestivo('2026-02-02', tfe) && fiestasDe('2026-02-02', tfe)[0].alcance === 'zona')
  ok('no lo es en Gran Canaria ni en un lead de Canarias sin municipio', !esFestivo('2026-02-02', gc) && !esFestivo('2026-02-02', sinMunicipio))
  ok('Nuestra Señora del Pino (8 de septiembre): Gran Canaria sí, Tenerife no', esFestivo('2026-09-08', gc) && !esFestivo('2026-09-08', tfe))
  ok('Volcanes (15 de septiembre) en Arrecife (Lanzarote)', esFestivo('2026-09-15', { ccaa: 'CN', ine: '35004' }))
  ok('la fecha de la Virgen de la Peña cambia de un año a otro (18 de septiembre de 2026, 17 de 2027)', esFestivo('2026-09-18', { ccaa: 'CN', ine: '35017' }) && !esFestivo('2026-09-17', { ccaa: 'CN', ine: '35017' }) && esFestivo('2027-09-17', { ccaa: 'CN', ine: '35017' }))
  ok('Guadalupe en La Gomera: 5 de octubre de 2026, 4 de 2027', esFestivo('2026-10-05', { ccaa: 'CN', ine: '38036' }) && esFestivo('2027-10-04', { ccaa: 'CN', ine: '38036' }))
  ok('el aviso nombra la isla', avisoDeFestivo('2026-02-02', '2026-02-02', tfe)?.titulo === 'Hoy es festivo en Tenerife (Canarias)', avisoDeFestivo('2026-02-02', '2026-02-02', tfe)?.titulo)
  ok('el día de Canarias (30 de mayo) es de toda la comunidad, también sin municipio', esFestivo('2026-05-30', sinMunicipio) && esFestivo('2026-05-30', tfe))
}

console.log('\n=== el Valle de Arán ===')
{
  const aran = { ccaa: 'CT' as const, ine: '25243' } // Vielha e Mijaran
  const barcelona = { ccaa: 'CT' as const, ine: '08019' }
  ok('Sant Esteve de 2026 (26 de diciembre): festivo en Cataluña pero no en Arán', esFestivo('2026-12-26', barcelona) && !esFestivo('2026-12-26', aran))
  ok('la Fiesta de Arán (17 de junio) solo es de Arán', esFestivo('2026-06-17', aran) && !esFestivo('2026-06-17', barcelona) && !esFestivo('2026-06-17', { ccaa: 'CT' }))
  ok('en 2027 lo que se sustituye es el Lunes de Pascua (29 de marzo)', esFestivo('2027-03-29', barcelona) && !esFestivo('2027-03-29', aran) && esFestivo('2027-06-17', aran))
  ok('un lead de Cataluña sin municipio cuenta como el resto de Cataluña', esFestivo('2026-12-26', { ccaa: 'CT' }))
  ok('Sant Esteve sigue siendo festivo en Baleares', esFestivo('2026-12-26', { ccaa: 'IB', ine: '07040' }))
}

console.log('\n=== las listas de zonas coinciden con el INE ===')
{
  const cuantos = Object.fromEntries(Object.entries(MUNICIPIOS_DE_ZONA).map(([z, m]) => [z, Object.keys(m).length]))
  ok('Gran Canaria 21, Tenerife 31, La Palma 14, Lanzarote 7, Fuerteventura 6, La Gomera 6, El Hierro 3, Arán 9', JSON.stringify(cuantos) === JSON.stringify({ 'gran-canaria': 21, lanzarote: 7, fuerteventura: 6, tenerife: 31, palma: 14, gomera: 6, hierro: 3, aran: 9 }), JSON.stringify(cuantos))
  const canarias = Object.entries(MUNICIPIOS_DE_ZONA).filter(([z]) => z !== 'aran').flatMap(([, m]) => Object.keys(m))
  ok('las siete islas suman los 88 municipios de Canarias, ninguno repetido', canarias.length === 88 && new Set(canarias).size === 88)
  ok('y son exactamente los de las provincias 35 y 38', canarias.every((i) => i.startsWith('35') || i.startsWith('38')) && canarias.filter((i) => i.startsWith('35')).length === 34 && canarias.filter((i) => i.startsWith('38')).length === 54)
  const malos: string[] = []
  for (const [zona, municipios] of Object.entries(MUNICIPIOS_DE_ZONA)) {
    for (const [ine, nombre] of Object.entries(municipios)) {
      const m = municipioDeIne(ine)
      if (!m || m.nombre !== nombre) malos.push(`${zona} ${ine} ${nombre} <> ${m?.nombre}`)
      if (zonaDeMunicipio(ine) !== zona) malos.push(`zona de ${ine}`)
    }
  }
  ok('cada código existe en el INE y se llama como dice', malos.length === 0, malos.slice(0, 3).join(' | '))
  ok('un municipio de fuera de las zonas no tiene zona', zonaDeMunicipio('28079') === null && zonaDeMunicipio(null) === null && zonaDeMunicipio(undefined) === null && zonaDeMunicipio('') === null)
  ok('Santa Cruz de Tenerife, buscada por su nombre, cae en Tenerife', zonaDeMunicipio(buscarMunicipios(normalizar('Santa Cruz de Tenerife'))[0].ine) === 'tenerife')
}

console.log('\n=== las fiestas locales de la Comunidad de Madrid (BOCM, 2026) ===')
{
  const madrid = { ccaa: 'MD' as const, ine: '28079' }
  const alcobendas = { ccaa: 'MD' as const, ine: '28006' }
  ok('hay 355 fiestas de 178 municipios', FIESTAS_LOCALES.length === 355 && new Set(FIESTAS_LOCALES.map((l) => l.ine)).size === 178, `${FIESTAS_LOCALES.length}/${new Set(FIESTAS_LOCALES.map((l) => l.ine)).size}`)
  const porMunicipio = new Map<string, number>()
  for (const l of FIESTAS_LOCALES) porMunicipio.set(l.ine, (porMunicipio.get(l.ine) ?? 0) + 1)
  ok('cada municipio tiene dos fiestas (solo Valdeolmos-Alalpardo una, por tener dos núcleos con fechas distintas)', [...porMunicipio.entries()].every(([ine, n]) => n === 2 || (ine === '28162' && n === 1)), JSON.stringify([...porMunicipio.entries()].filter(([, n]) => n !== 2)))
  ok('todas son de 2026, con un día real', FIESTAS_LOCALES.every((l) => /^2026-\d{2}-\d{2}$/.test(l.f) && new Date(2026, Number(l.f.slice(5, 7)) - 1, Number(l.f.slice(8, 10))).getDate() === Number(l.f.slice(8, 10))))
  ok('y cada código es de un municipio de la provincia de Madrid que existe en el INE', FIESTAS_LOCALES.every((l) => l.ine.startsWith('28') && municipioDeIne(l.ine) !== undefined), FIESTAS_LOCALES.find((l) => !l.ine.startsWith('28') || municipioDeIne(l.ine) === undefined)?.ine)
  ok('la modificación de enero sustituyó a «no comunicado»: La Hiruela (13 de febrero y 29 de septiembre) y Rascafría tienen sus fechas', FIESTAS_LOCALES.filter((l) => l.lugar === 'La Hiruela').map((l) => l.f).sort().join() === '2026-02-13,2026-09-29' && FIESTAS_LOCALES.some((l) => l.lugar === 'Rascafría'))
  ok('y la de diciembre cambió las de Coslada (15 de junio y no 8)', FIESTAS_LOCALES.filter((l) => l.lugar === 'Coslada').map((l) => l.f).sort().join() === '2026-05-15,2026-06-15')

  ok('Madrid capital: el viernes 15 de mayo y el lunes 9 de noviembre de 2026', esFestivo('2026-05-15', madrid) && esFestivo('2026-11-09', madrid))
  const f = fiestasDe('2026-11-09', madrid)
  ok('es una fiesta local, del municipio de Madrid', f.length === 1 && f[0].alcance === 'local' && f[0].lugar === 'Madrid' && f[0].nombre === 'Fiesta local', JSON.stringify(f))
  const a = avisoDeFestivo('2026-11-09', '2026-11-09', madrid)
  ok('el aviso dice «Hoy es festivo en Madrid» y «Fiesta local»', a?.titulo === 'Hoy es festivo en Madrid' && a?.detalle === 'Fiesta local', JSON.stringify(a))
  ok('visto desde el lunes 2: «El lunes 9 de noviembre es festivo en Madrid»', avisoDeFestivo('2026-11-09', '2026-11-02', madrid)?.titulo === 'El lunes 9 de noviembre es festivo en Madrid')
  ok('otro municipio de la Comunidad de Madrid (Alcobendas) no lo tiene ese día, y sí el 24 de enero y el 15 de mayo', !esFestivo('2026-11-09', alcobendas) && esFestivo('2026-01-24', alcobendas) && esFestivo('2026-05-15', alcobendas))
  ok('un lead de Madrid sin municipio (solo la comunidad) no recibe la fiesta local: no se sabe cuál es su municipio', !esFestivo('2026-11-09', { ccaa: 'MD' }) && !esFestivo('2026-11-09', { ccaa: 'MD', ine: null }))
  ok('Barcelona ese día, no', !esFestivo('2026-11-09', { ccaa: 'CT', ine: '08019' }))
  ok('en 2027 no hay fiestas locales cargadas: ni siquiera el 9 de noviembre', !esFestivo('2027-11-09', madrid) && !esFestivo('2027-05-15', madrid))
  ok('Majadahonda (25 de noviembre), Fuenlabrada (26 de diciembre), San Martín de Valdeiglesias (11 de noviembre)', esFestivo('2026-11-25', { ccaa: 'MD', ine: '28080' }) && esFestivo('2026-12-26', { ccaa: 'MD', ine: '28058' }) && esFestivo('2026-11-11', { ccaa: 'MD', ine: '28133' }))
  const dia = festivosDelDia('2026-11-09')!
  ok('el resumen del 9 de noviembre: ninguna comunidad entera, el municipio de Madrid, y se llama «Fiesta local»', dia.comunidades.length === 0 && dia.zonas.length === 0 && dia.municipios.join() === 'Madrid' && dia.nombres.join() === 'Fiesta local' && !dia.nacional, JSON.stringify(dia))
  ok('el 11 de noviembre son dos municipios, por orden alfabético', festivosDelDia('2026-11-11')!.municipios.join() === 'San Martin de Valdeiglesias,Valdilecha', festivosDelDia('2026-11-11')!.municipios.join())
  const mixto = fiestasDe('2026-10-12', madrid)
  ok('un festivo nacional sigue siendo nacional aunque haya locales', mixto.length === 1 && mixto[0].alcance === 'nacional')
}

console.log('\n=== sin calendario no se inventa ===')
{
  ok('2028 aún no tiene calendario', !hayCalendarioPara('2028-01-01') && hayCalendarioPara('2026-06-01') && hayCalendarioPara('2027-12-31'))
  ok('un día de 2028 no es festivo para nadie, ni siquiera el 25 de diciembre', !esFestivo('2028-12-25', { ccaa: 'MD' }) && fiestasDe('2028-01-01', { ccaa: 'MD' }).length === 0)
  ok('sin lugar tampoco: no se sabe', !esFestivo('2026-12-25', null) && !esFestivo('2026-12-25', undefined) && avisoDeFestivo('2026-12-25', '2026-12-25', null) === null)
  ok('un texto que no es un día no rompe', !esFestivo('', { ccaa: 'MD' }) && !esFestivo('mañana', { ccaa: 'MD' }))
}

console.log('\n=== el próximo día para llamar ===')
{
  ok('desde el jueves 29 de octubre de 2026, Madrid: el viernes 30', proximoDiaHabil('2026-10-29', { ccaa: 'MD' }) === '2026-10-30')
  ok('desde el viernes 30, Madrid: el martes 3 (el lunes 2 es festivo allí)', proximoDiaHabil('2026-10-30', { ccaa: 'MD' }) === '2026-11-03')
  ok('desde el viernes 30, Cataluña: el lunes 2 (allí no es festivo)', proximoDiaHabil('2026-10-30', { ccaa: 'CT' }) === '2026-11-02')
  ok('desde el lunes 2 (festivo en Madrid), Madrid: el martes 3', proximoDiaHabil('2026-11-02', { ccaa: 'MD' }) === '2026-11-03')
  ok('sin lugar solo salta fines de semana', proximoDiaHabil('2026-10-30', null) === '2026-11-02' && proximoDiaHabil('2026-11-01', undefined) === '2026-11-02')
  ok('Navidad de 2026 (viernes 25) en Cataluña: del 24 al lunes 28 (el 26 es sábado)', proximoDiaHabil('2026-12-24', { ccaa: 'CT' }) === '2026-12-28')
  ok('el puente de diciembre de 2026: del martes 1 de diciembre al miércoles 2', proximoDiaHabil('2026-12-01', { ccaa: 'MD' }) === '2026-12-02')
  ok('de lunes 7 de diciembre de 2026 (festivo en Madrid, la Constitución cae en domingo) al martes 8 es festivo en todas: el miércoles 9', proximoDiaHabil('2026-12-07', { ccaa: 'MD' }) === '2026-12-09')
  ok('días de la semana de verdad', diaDeLaSemana('2026-11-02') === 1 && diaDeLaSemana('2026-11-01') === 0 && diaDeLaSemana('2026-10-31') === 6)
}

console.log('\n=== el resumen de un día y de la semana ===')
{
  const f = festivosDelDia('2026-11-02')!
  ok('el 2 de noviembre de 2026: 9 comunidades, no es nacional, se llama «Día siguiente a Todos los Santos»', f.comunidades.length === 9 && !f.nacional && f.nombres.join() === 'Día siguiente a Todos los Santos', JSON.stringify(f))
  ok('el día de Navidad es nacional', festivosDelDia('2026-12-25')!.nacional && festivosDelDia('2026-12-25')!.comunidades.length === 19)
  ok('un día normal no tiene resumen', festivosDelDia('2026-10-29') === null && festivosDelDia('2028-01-01') === null)
  ok('el 2 de febrero de 2026 solo lo celebra una isla (ninguna comunidad entera)', ((x) => x !== null && x.comunidades.length === 0 && x.zonas.join() === 'tenerife')(festivosDelDia('2026-02-02')))
  const proximos = proximosFestivos('2026-10-29', 14)
  ok('desde el 29 de octubre, los próximos 14 días traen el 30 (local de Berzosa de Lozoya), el lunes 2 de noviembre, el lunes 9 (local de Madrid) y el miércoles 11 (locales)', proximos.map((p) => p.dia).join() === '2026-10-30,2026-11-02,2026-11-09,2026-11-11', proximos.map((p) => p.dia).join())
  ok('el sábado y el domingo no cuentan: en dos días desde el sábado 31 no hay ninguno y al tercero sale el lunes 2', proximosFestivos('2026-10-31', 2).length === 0 && proximosFestivos('2026-10-31', 3).map((p) => p.dia).join() === '2026-11-02')
}

console.log('\n=== los textos ===')
{
  ok('hoy, mañana y otro día', cuandoEs('2026-11-02', '2026-11-02') === 'hoy' && cuandoEs('2026-11-02', '2026-11-01') === 'mañana' && cuandoEs('2026-11-02', '2026-10-30') === 'el lunes 2 de noviembre')
  ok('mañana cruza el fin de mes', cuandoEs('2026-12-01', '2026-11-30') === 'mañana' && cuandoEs('2027-01-01', '2026-12-31') === 'mañana')
  ok('«dónde» de una fiesta de comunidad', dondeEsFestivo(fiestasDe('2026-05-02', { ccaa: 'MD' }), { ccaa: 'MD' }) === 'Madrid')
  ok('«dónde» de varias fiestas el mismo día: sigue siendo la comunidad', dondeEsFestivo(fiestasDe('2026-04-23', { ccaa: 'AR' }), { ccaa: 'AR' }) === 'Aragón')
  ok('dos fiestas el mismo día salen en el detalle', avisoDeFestivo('2026-04-23', '2026-04-23', { ccaa: 'AR' })?.detalle === 'San Jorge/Día de Aragón', avisoDeFestivo('2026-04-23', '2026-04-23', { ccaa: 'AR' })?.detalle)
  ok('Ceuta ese día lleva su nombre', avisoDeFestivo('2026-09-02', '2026-09-02', { ccaa: 'CE' })?.titulo === 'Hoy es festivo en Ceuta')
}

console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
