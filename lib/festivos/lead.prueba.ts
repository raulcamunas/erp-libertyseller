import { avisosDeLaFicha, bandaDeFestivos, comunidadesCompletas, esFestivoParaElLead, lugarDelLead, marcaDeLista, nombreDeComunidades, notaDeUbicacion, textosDeLaBanda } from './lead'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

const madrid = { ccaa: 'MD', municipio_ine: '28079' }
const barcelona = { ccaa: 'CT', municipio_ine: '08019' }
const sinUbicar = { ccaa: null, municipio_ine: null }

console.log('\n=== el lugar de un lead ===')
{
  ok('con comunidad y municipio', JSON.stringify(lugarDelLead(madrid)) === '{"ccaa":"MD","ine":"28079"}')
  ok('solo con la comunidad, sin municipio', JSON.stringify(lugarDelLead({ ccaa: 'AN' })) === '{"ccaa":"AN","ine":null}')
  ok('sin ubicar, o con una comunidad que no existe, o sin nada: no se sabe', lugarDelLead(sinUbicar) === null && lugarDelLead({ ccaa: 'XX' }) === null && lugarDelLead({}) === null && lugarDelLead(null) === null && lugarDelLead(undefined) === null)
  ok('un lead sin ubicar nunca es festivo, ni el día de Navidad: no se inventa', !esFestivoParaElLead('2026-12-25', sinUbicar) && !esFestivoParaElLead('2026-12-25', {}))
  ok('el lunes 2 de noviembre: Madrid sí, Barcelona no', esFestivoParaElLead('2026-11-02', madrid) && !esFestivoParaElLead('2026-11-02', barcelona))
  ok('la marca de la lista dice dónde y qué', marcaDeLista('2026-11-02', '2026-11-02', madrid) === 'Hoy es festivo en Madrid: Día siguiente a Todos los Santos' && marcaDeLista('2026-11-02', '2026-11-02', barcelona) === null)
  ok('y no sale en un festivo de toda España (sería igual en todas las filas), aunque el aviso de la ficha sí', marcaDeLista('2026-12-25', '2026-12-25', madrid) === null && avisosDeLaFicha(madrid, '2026-12-25').hoy?.titulo === 'Hoy es festivo en toda España')
  ok('en un festivo de una isla sí sale', marcaDeLista('2026-02-02', '2026-02-02', { ccaa: 'CN', municipio_ine: '38038' }) === 'Hoy es festivo en Tenerife (Canarias): La Virgen de la Candelaria')
}

console.log('\n=== el aviso de la ficha ===')
{
  const hoyFestivo = avisosDeLaFicha({ ...madrid, next_call_date: null }, '2026-11-02')
  ok('hoy es festivo en Madrid y el primer día para llamar es el martes 3', hoyFestivo.hoy?.titulo === 'Hoy es festivo en Madrid' && hoyFestivo.siguienteHabil === '2026-11-03' && hoyFestivo.rellamada === null, JSON.stringify(hoyFestivo))
  const bcn = avisosDeLaFicha({ ...barcelona, next_call_date: null }, '2026-11-02')
  ok('el mismo día en Barcelona no hay nada', bcn.hoy === null && bcn.siguienteHabil === null && bcn.rellamada === null)
  const futura = avisosDeLaFicha({ ...madrid, next_call_date: '2026-11-02' }, '2026-10-30')
  ok('una rellamada apuntada para el lunes 2 avisa, con el martes 3 como alternativa, y hoy (viernes) no es festivo', futura.hoy === null && futura.rellamada?.dia === '2026-11-02' && futura.rellamada?.siguienteHabil === '2026-11-03' && futura.rellamada?.titulo === 'El lunes 2 de noviembre es festivo en Madrid', JSON.stringify(futura))
  const mañana = avisosDeLaFicha({ ...madrid, next_call_date: '2026-11-02' }, '2026-11-01')
  ok('si la rellamada es mañana, lo dice así', mañana.rellamada?.titulo === 'Mañana es festivo en Madrid')
  const enCataluña = avisosDeLaFicha({ ...barcelona, next_call_date: '2026-11-02' }, '2026-10-30')
  ok('una rellamada en un día normal para ese lead no avisa', enCataluña.rellamada === null)
  const atrasada = avisosDeLaFicha({ ...madrid, next_call_date: '2026-10-12' }, '2026-10-30')
  ok('una rellamada atrasada no se mira (ya pasó)', atrasada.rellamada === null)
  const lamismaHoy = avisosDeLaFicha({ ...madrid, next_call_date: '2026-11-02' }, '2026-11-02')
  ok('si la rellamada es hoy y hoy es festivo, avisa solo el de hoy', lamismaHoy.hoy !== null && lamismaHoy.rellamada === null)
  const ambas = avisosDeLaFicha({ ccaa: 'MD', municipio_ine: null, next_call_date: '2026-12-08' }, '2026-11-02')
  ok('hoy y la rellamada pueden ser festivos a la vez, cada una con su aviso', ambas.hoy !== null && ambas.rellamada?.dia === '2026-12-08' && ambas.rellamada?.siguienteHabil === '2026-12-09')
  ok('sin ubicación o sin calendario, nada', avisosDeLaFicha(sinUbicar, '2026-11-02').hoy === null && avisosDeLaFicha(madrid, '2028-12-25').hoy === null && avisosDeLaFicha(madrid, '').hoy === null && avisosDeLaFicha(null, '2026-11-02').hoy === null)
}

console.log('\n=== de dónde sale la comunidad ===')
{
  ok('lo que dice el propio lead (ciudad, código postal, provincia) no lleva advertencia', notaDeUbicacion('ciudad', 'alta') === null && notaDeUbicacion('direccion', 'alta') === null && notaDeUbicacion('provincia', 'alta') === null)
  ok('el teléfono, la web, el registro y una dirección sin código postal sí', ['telefono', 'web', 'registro'].every((o) => (notaDeUbicacion(o, 'baja') ?? '').length > 20) && (notaDeUbicacion('direccion', 'media') ?? '').includes('sin código postal'))
  ok('sin dato, nada', notaDeUbicacion(null, null) === null && notaDeUbicacion(undefined, undefined) === null)
}

console.log('\n=== la banda de arriba ===')
{
  const cartera = [madrid, madrid, barcelona, { ccaa: 'AN' }, sinUbicar, {}, { ccaa: 'GA' }]
  const b = bandaDeFestivos(cartera, '2026-11-02')!
  ok('el lunes 2 de noviembre: hoy, afecta a Madrid ×2 y Andalucía ×1 = 3 leads', b.esHoy && b.afectados === 3 && b.dia === '2026-11-02' && !b.nacional, JSON.stringify(b))
  ok('trae las nueve comunidades', b.comunidades.length === 9)
  const t = textosDeLaBanda(b, '2026-11-02')
  ok('el título nombra dos y cuenta el resto', t.titulo === 'Hoy es festivo en Andalucía, Aragón y 7 comunidades más', t.titulo)
  ok('y el detalle dice qué se celebra', t.detalle === 'Día siguiente a Todos los Santos')
  const antes = bandaDeFestivos(cartera, '2026-10-30')!
  ok('desde el viernes 30 ve venir el lunes 2: no es hoy', !antes.esHoy && antes.dia === '2026-11-02' && antes.afectados === 3 && textosDeLaBanda(antes, '2026-10-30').titulo.startsWith('El lunes 2 de noviembre es festivo en '), JSON.stringify(textosDeLaBanda(antes, '2026-10-30')))
  ok('desde el jueves 29 todavía lo ve venir (jueves, viernes, sábado, domingo y lunes son cinco días)', bandaDeFestivos(cartera, '2026-10-29')?.dia === '2026-11-02')
  ok('desde el lunes 26 es demasiado pronto: no lo enseña', bandaDeFestivos(cartera, '2026-10-26') === null)
  ok('una cartera sin leads en las comunidades que celebran: nada que decir', bandaDeFestivos([barcelona, { ccaa: 'GA' }], '2026-11-02') === null)
  ok('una cartera vacía o sin ubicar: nada', bandaDeFestivos([], '2026-11-02') === null && bandaDeFestivos([sinUbicar, {}], '2026-11-02') === null)
  ok('el día de Navidad es de toda España y la banda lo dice', ((x) => x !== null && x.nacional && textosDeLaBanda(x, '2026-12-25').titulo === 'Hoy es festivo en toda España' && x.afectados === 5)(bandaDeFestivos(cartera, '2026-12-25')))
  ok('sin calendario (2028) o sin día: nada', bandaDeFestivos(cartera, '2028-12-25') === null && bandaDeFestivos(cartera, '') === null)
  ok('si hoy no es festivo para esta cartera pero mañana sí, enseña mañana', ((x) => x !== null && !x.esHoy && x.dia === '2026-11-02')(bandaDeFestivos([madrid], '2026-11-01')))
  ok('hoy festivo para otra comunidad y el próximo para la de la cartera: sale el que le afecta', ((x) => x !== null && x.dia === '2026-11-02')(bandaDeFestivos([madrid], '2026-10-30')))
}

console.log('\n=== los nombres de las comunidades ===')
{
  ok('una', nombreDeComunidades(['MD'], false) === 'Madrid')
  ok('dos', nombreDeComunidades(['MD', 'AN'], false) === 'Madrid y Andalucía')
  ok('tres', nombreDeComunidades(['AN', 'AR', 'MD'], false) === 'Andalucía, Aragón y Madrid')
  ok('muchas se recortan', nombreDeComunidades(['AN', 'AR', 'AS', 'CN', 'CM', 'CL', 'EX', 'MD', 'NC'], false) === 'Andalucía, Aragón y 7 comunidades más')
  ok('todas', nombreDeComunidades(['AN'], true) === 'toda España')
  ok('la lista entera, sin recortar, para el texto del ratón', comunidadesCompletas(bandaDeFestivos([madrid], '2026-11-02')!).split(', ').length === 9 && comunidadesCompletas(bandaDeFestivos([madrid], '2026-12-25')!).startsWith('Las 19'))
}

console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
