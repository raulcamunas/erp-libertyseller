import { desdeCampoDeFecha, describirInstante, diasHastaElLunes, finDeLaSemana, finDelDia, haciaCampoDeFecha, horaDeMadridEnDias, instanteEnMadrid, partesEnMadrid } from '@/lib/chat/tiempo'
import { OPCIONES_RAPIDAS, fechaValida, instanteDeOpcion, MAXIMO_MS } from '@/lib/chat/recordatorios'
import { caducidad, estaVigente, limpiarEstado } from '@/lib/chat/estado'
import { esImagen, esRutaDe, rutaDeArchivo } from '@/lib/chat/archivos'

let fallos = 0
let comprobaciones = 0
function igual(nombre: string, real: unknown, esperado: unknown) {
  comprobaciones += 1
  const a = JSON.stringify(real)
  const b = JSON.stringify(esperado)
  const bien = a === b
  if (!bien) fallos += 1
  console.log(`  ${bien ? 'OK  ' : 'MAL '}  ${nombre}${bien ? '' : ` → ${a}, esperaba ${b}`}`)
}
const iso = (ms: number) => new Date(ms).toISOString()

// Madrid: en invierno UTC+1, en verano UTC+2
igual('invierno: las 9:00 de Madrid son las 8:00 UTC', iso(instanteEnMadrid(2026, 11, 9, 9, 0)), '2026-11-09T08:00:00.000Z')
igual('verano: las 9:00 de Madrid son las 7:00 UTC', iso(instanteEnMadrid(2026, 7, 9, 9, 0)), '2026-07-09T07:00:00.000Z')
igual('y de vuelta', partesEnMadrid(Date.parse('2026-11-08T22:30:00Z')), { anio: 2026, mes: 11, dia: 8, hora: 23, minuto: 30, diaDeSemana: 0 })
igual('cerca de medianoche cambia el día', partesEnMadrid(Date.parse('2026-11-08T23:30:00Z')).dia, 9)
// El 29 de marzo de 2026 se adelanta la hora (las 2:00 pasan a ser las 3:00); el 25 de octubre se atrasa
igual('mañana a las 9 al cruzar el cambio de primavera', iso(horaDeMadridEnDias(Date.parse('2026-03-28T12:00:00Z'), 1, 9)), '2026-03-29T07:00:00.000Z')
igual('mañana a las 9 al cruzar el cambio de otoño', iso(horaDeMadridEnDias(Date.parse('2026-10-24T12:00:00Z'), 1, 9)), '2026-10-25T08:00:00.000Z')
igual('una hora que no existe (2:30 el día del cambio) cae en la siguiente', partesEnMadrid(instanteEnMadrid(2026, 3, 29, 2, 30)).hora >= 3, true)
igual('días hasta el lunes', [diasHastaElLunes(0), diasHastaElLunes(1), diasHastaElLunes(5), diasHastaElLunes(6)], [1, 7, 3, 2])

const DOMINGO_NOCHE = Date.parse('2026-11-08T21:00:00Z') // domingo 22:00 en Madrid
igual('opciones rápidas', Object.fromEntries(OPCIONES_RAPIDAS.map((o) => [o.id, iso(instanteDeOpcion(o.id, DOMINGO_NOCHE))])), {
  '20min': '2026-11-08T21:20:00.000Z', '1h': '2026-11-08T22:00:00.000Z', '3h': '2026-11-09T00:00:00.000Z', manana: '2026-11-09T08:00:00.000Z', lunes: '2026-11-09T08:00:00.000Z',
})
igual('desde un lunes, «el lunes» es el de la semana siguiente', iso(instanteDeOpcion('lunes', Date.parse('2026-11-09T10:00:00Z'))), '2026-11-16T08:00:00.000Z')
igual('fin del día y de la semana', [iso(finDelDia(Date.parse('2026-11-04T10:00:00Z'))), iso(finDeLaSemana(Date.parse('2026-11-04T10:00:00Z'))), iso(finDeLaSemana(DOMINGO_NOCHE))], ['2026-11-04T22:59:00.000Z', '2026-11-08T22:59:00.000Z', '2026-11-08T22:59:00.000Z'])
igual('cómo se cuenta una hora', [describirInstante(Date.parse('2026-11-08T16:30:00Z'), Date.parse('2026-11-08T10:00:00Z')), describirInstante(Date.parse('2026-11-09T08:00:00Z'), Date.parse('2026-11-08T10:00:00Z')), describirInstante(Date.parse('2026-11-12T08:00:00Z'), Date.parse('2026-11-08T10:00:00Z')), describirInstante(Date.parse('2026-12-20T08:00:00Z'), Date.parse('2026-11-08T10:00:00Z'))], ['hoy a las 17:30', 'mañana a las 9:00', 'el jueves a las 9:00', 'el 20/12 a las 9:00'])
igual('el campo de fecha, de ida y vuelta', [iso(desdeCampoDeFecha('2026-11-12T09:00')!), haciaCampoDeFecha(Date.parse('2026-11-12T08:00:00Z')), desdeCampoDeFecha('mañana'), desdeCampoDeFecha('2026-13-40T09:00')], ['2026-11-12T08:00:00.000Z', '2026-11-12T09:00', null, null])

const AHORA = Date.parse('2026-11-08T12:00:00Z')
igual('fechas válidas: ni pasadas, ni de ahora mismo, ni a más de un año', [fechaValida(AHORA - 1000, AHORA).ok, fechaValida(AHORA + 30_000, AHORA).ok, fechaValida(AHORA + 120_000, AHORA).ok, fechaValida(AHORA + MAXIMO_MS + 1000, AHORA).ok, fechaValida('no', AHORA).ok, fechaValida(iso(AHORA + 3_600_000), AHORA).ok], [false, false, true, false, false, true])

// Estado
igual('caducidad del estado', [caducidad('siempre', AHORA), caducidad('1h', AHORA), caducidad('hoy', AHORA)], [null, '2026-11-08T13:00:00.000Z', '2026-11-08T22:59:00.000Z'])
igual('un estado caducado no se enseña', [estaVigente({ hasta: null }, AHORA), estaVigente({ hasta: iso(AHORA + 1000) }, AHORA), estaVigente({ hasta: iso(AHORA - 1000) }, AHORA), estaVigente(null, AHORA)], [true, true, false, false])
igual('limpiar el estado', [limpiarEstado('🌴', ' De  vacaciones ', 'siempre', AHORA), limpiarEstado('', '', '1h', AHORA), limpiarEstado('📅', 'x'.repeat(100), 'no-existe', AHORA)?.texto.length, limpiarEstado(5, 7, '1h', AHORA)], [{ emoji: '🌴', texto: 'De vacaciones', hasta: null }, null, 60, null])

// Archivos
const U = '11111111-1111-4111-8111-111111111111'
const F = '22222222-2222-4222-8222-222222222222'
const ruta = rutaDeArchivo(U, F, 'Informe Final.PDF')
igual('la ruta de un archivo', ruta, `${U}/${F}.pdf`)
igual('solo vale la ruta propia, con su forma exacta', [esRutaDe(ruta, U), esRutaDe(ruta, F), esRutaDe(`${U}/../${F}.pdf`, U), esRutaDe(`${U}/${F}.pdf/x`, U), esRutaDe(5, U), esRutaDe(`${U}/${F}`, U)], [true, false, false, false, false, true])
igual('qué es una imagen', [esImagen('image/png'), esImagen('image/svg+xml'), esImagen('application/pdf'), esImagen('', 'foto.JPG')], [true, false, false, true])

console.log(`\n${fallos === 0 ? 'TODO BIEN' : `HAY ${fallos} FALLOS`} (${comprobaciones} comprobaciones)`)
process.exit(fallos === 0 ? 0 : 1)
