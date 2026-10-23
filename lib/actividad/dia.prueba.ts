import { desfaseMs, duracion, etiquetaDeFecha, fechaCorta, fechaDeMs, finDelDiaMs, horaDeMs, inicioDelDiaMs, sumarDias, ventanaValida, zonaValida } from '@/lib/actividad/dia'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}
const H = 3_600_000

console.log('\n=== zonas ===')
ok('Madrid es válida', zonaValida('Europe/Madrid'))
ok('Bogotá es válida', zonaValida('America/Bogota'))
ok('algo inventado no', !zonaValida('Marte/Olympus'))
ok('un número no', !zonaValida(5))
ok('vacío no', !zonaValida(''))

console.log('\n=== desfase ===')
ok('Bogotá va 5 h por detrás todo el año', desfaseMs('America/Bogota', Date.UTC(2026, 6, 1)) === -5 * H && desfaseMs('America/Bogota', Date.UTC(2026, 11, 1)) === -5 * H)
ok('Dubái va 4 h por delante', desfaseMs('Asia/Dubai', Date.UTC(2026, 9, 23)) === 4 * H)
ok('Madrid: +2 en verano', desfaseMs('Europe/Madrid', Date.UTC(2026, 6, 1)) === 2 * H)
ok('Madrid: +1 en invierno', desfaseMs('Europe/Madrid', Date.UTC(2026, 11, 1)) === 1 * H)

console.log('\n=== el día en su zona ===')
ok('empieza a medianoche de Bogotá', inicioDelDiaMs('2026-10-23', 'America/Bogota') === Date.UTC(2026, 9, 23, 5, 0, 0))
ok('y acaba a la siguiente', finDelDiaMs('2026-10-23', 'America/Bogota') === Date.UTC(2026, 9, 24, 5, 0, 0))
ok('Madrid en octubre (verano): empieza a las 22:00Z del día anterior', inicioDelDiaMs('2026-10-23', 'Europe/Madrid') === Date.UTC(2026, 9, 22, 22, 0, 0))
ok('un día normal dura 24 h', finDelDiaMs('2026-10-23', 'Europe/Madrid') - inicioDelDiaMs('2026-10-23', 'Europe/Madrid') === 24 * H)
ok('el día en que se atrasa el reloj (25-oct-2026) dura 25 h', finDelDiaMs('2026-10-25', 'Europe/Madrid') - inicioDelDiaMs('2026-10-25', 'Europe/Madrid') === 25 * H)
ok('el día en que se adelanta (29-mar-2026) dura 23 h', finDelDiaMs('2026-03-29', 'Europe/Madrid') - inicioDelDiaMs('2026-03-29', 'Europe/Madrid') === 23 * H)
ok('Bogotá no tiene días raros', finDelDiaMs('2026-03-29', 'America/Bogota') - inicioDelDiaMs('2026-03-29', 'America/Bogota') === 24 * H)

console.log('\n=== de un instante al día y la hora ===')
{
  const ms = Date.UTC(2026, 9, 24, 3, 30, 0) // sábado 03:30 UTC
  ok('en Bogotá aún es viernes 22:30', fechaDeMs(ms, 'America/Bogota') === '2026-10-23' && horaDeMs(ms, 'America/Bogota') === '22:30')
  ok('en Madrid ya es sábado 05:30', fechaDeMs(ms, 'Europe/Madrid') === '2026-10-24' && horaDeMs(ms, 'Europe/Madrid') === '05:30')
  ok('en Dubái, 07:30', horaDeMs(ms, 'Asia/Dubai') === '07:30')
}
ok('medianoche exacta es 00:00 (no 24:00)', horaDeMs(inicioDelDiaMs('2026-10-23', 'America/Bogota'), 'America/Bogota') === '00:00')
ok('el instante de inicio pertenece a su día', fechaDeMs(inicioDelDiaMs('2026-10-25', 'Europe/Madrid'), 'Europe/Madrid') === '2026-10-25')
ok('un ms antes del final es todavía su día', fechaDeMs(finDelDiaMs('2026-10-25', 'Europe/Madrid') - 1, 'Europe/Madrid') === '2026-10-25')

console.log('\n=== fechas ===')
ok('sumar un día', sumarDias('2026-10-23', 1) === '2026-10-24')
ok('cruza de mes', sumarDias('2026-10-31', 1) === '2026-11-01')
ok('cruza de año', sumarDias('2026-12-31', 1) === '2027-01-01')
ok('restar', sumarDias('2026-03-01', -1) === '2026-02-28')
ok('etiqueta en español', etiquetaDeFecha('2026-10-23') === 'viernes, 23 de octubre' || etiquetaDeFecha('2026-10-23') === 'viernes 23 de octubre', etiquetaDeFecha('2026-10-23'))

console.log('\n=== fechaCorta ===')
{
  const hoyBogota = '2026-10-23'
  const ms = (y: number, m: number, d: number, h: number, mi: number) => Date.UTC(y, m - 1, d, h, mi) // en UTC
  ok('de hoy: «hoy 08:12»', fechaCorta(ms(2026, 10, 23, 13, 12), 'America/Bogota', hoyBogota) === 'hoy 08:12')
  ok('de ayer', fechaCorta(ms(2026, 10, 22, 22, 40), 'America/Bogota', hoyBogota) === 'ayer 17:40')
  ok('de otro día: «21 oct 09:00»', fechaCorta(ms(2026, 10, 21, 14, 0), 'America/Bogota', hoyBogota) === '21 oct 09:00', fechaCorta(ms(2026, 10, 21, 14, 0), 'America/Bogota', hoyBogota))
  ok('el día depende de la zona: las 03:30Z del sábado son viernes 22:30 en Bogotá', fechaCorta(ms(2026, 10, 24, 3, 30), 'America/Bogota', hoyBogota) === 'hoy 22:30')
  ok('y sábado en Madrid', fechaCorta(ms(2026, 10, 24, 3, 30), 'Europe/Madrid', '2026-10-24') === 'hoy 05:30')
}

console.log('\n=== duración ===')
ok('0 min', duracion(0) === '0 min')
ok('45 min', duracion(45) === '45 min')
ok('1 h', duracion(60) === '1 h')
ok('2 h 05 min', duracion(125) === '2 h 05 min')
ok('negativo se queda en 0', duracion(-4) === '0 min')

console.log('\n=== la ventana que se puede pedir ===')
{
  const ahora = Date.UTC(2026, 9, 23, 12, 0, 0)
  const dia = inicioDelDiaMs('2026-10-23', 'America/Bogota')
  const v = ventanaValida(String(dia), String(dia + 24 * H), ahora)
  ok('un día normal vale (con números en texto, como llegan de la URL)', v !== null && v.hasta - v.desde === 24 * H)
  ok('también con números', ventanaValida(dia, dia + 25 * H, ahora) !== null)
  ok('49 horas es el techo', ventanaValida(dia, dia + 49 * H, ahora) !== null && ventanaValida(dia, dia + 50 * H, ahora) === null)
  ok('al revés no vale', ventanaValida(dia + H, dia, ahora) === null)
  ok('vacía no vale', ventanaValida(dia, dia, ahora) === null)
  ok('NaN, texto y nulos no valen', ventanaValida('x', '1', ahora) === null && ventanaValida(null, undefined, ahora) === null && ventanaValida('', '', ahora) === null)
  ok('de hace más de 100 días no vale', ventanaValida(ahora - 101 * 86_400_000, ahora - 100 * 86_400_000 + H, ahora) === null)
  ok('de hace 99 días sí', ventanaValida(ahora - 99 * 86_400_000, ahora - 99 * 86_400_000 + 24 * H, ahora) !== null)
  ok('del futuro lejano no vale', ventanaValida(ahora + 10 * 86_400_000, ahora + 11 * 86_400_000, ahora) === null)
  ok('mañana sí (por si la zona de quien mira va por delante)', ventanaValida(ahora + 12 * H, ahora + 36 * H, ahora) !== null)
}

console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
