import { fechaCompleta, fechaDeLista, tamanoLegible } from '@/lib/correo/formato'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}
const igual = (n: string, real: unknown, esperado: unknown) => ok(n, JSON.stringify(real) === JSON.stringify(esperado), `real ${JSON.stringify(real)}, esperado ${JSON.stringify(esperado)}`)

/** FORMATO: fechas de la lista y tamaños, siempre en hora de Madrid. */

// Jueves 22 de octubre de 2026, 12:00 en Madrid (10:00 UTC, horario de verano)
const AHORA = new Date('2026-10-22T10:00:00Z')

console.log('fechaDeLista')
igual('hoy: la hora', fechaDeLista('2026-10-22T07:15:00Z', AHORA), '09:15')
igual('hoy a medianoche pasada: la hora', fechaDeLista('2026-10-21T22:30:00Z', AHORA), '00:30')
igual('ayer', fechaDeLista('2026-10-21T10:00:00Z', AHORA), 'ayer')
igual('anoche (22:00 UTC = 00:00 Madrid de hoy) es hoy', fechaDeLista('2026-10-21T22:00:00Z', AHORA), '00:00')
igual('anteayer: el día de la semana', fechaDeLista('2026-10-20T10:00:00Z', AHORA), 'mar')
igual('hace seis días: el día de la semana', fechaDeLista('2026-10-16T10:00:00Z', AHORA), 'vie')
igual('hace siete días: día y mes', fechaDeLista('2026-10-15T10:00:00Z', AHORA), '15 oct')
igual('de este año: día y mes', fechaDeLista('2026-03-05T10:00:00Z', AHORA), '5 mar')
igual('de otro año: numérica', fechaDeLista('2025-12-31T10:00:00Z', AHORA), '31/12/25')
igual('una fecha inválida', fechaDeLista('nada', AHORA), '')
igual('una fecha del futuro cuenta como hoy', fechaDeLista('2026-10-22T20:00:00Z', AHORA), '22:00')
igual('la hora usa Madrid y no la del ordenador (invierno: UTC+1)', fechaDeLista('2026-12-01T08:00:00Z', new Date('2026-12-01T12:00:00Z')), '09:00')
igual('el cambio de hora no descuadra el «ayer»', fechaDeLista('2026-10-24T12:00:00Z', new Date('2026-10-25T12:00:00Z')), 'ayer')

console.log('fechaCompleta')
igual('con año y hora', fechaCompleta('2026-10-21T08:15:00Z'), '21 oct 2026, 10:15')
igual('inválida', fechaCompleta('nada'), '')

console.log('tamanoLegible')
igual('bytes', tamanoLegible(512), '512 B')
igual('kilobytes', tamanoLegible(48_213), '47 KB')
igual('megabytes con decimal', tamanoLegible(1_300_000), '1,2 MB')
igual('megabytes grandes sin decimal', tamanoLegible(24 * 1024 * 1024), '24 MB')
igual('negativo', tamanoLegible(-1), '')

console.log(fallos === 0 ? '\nTODO BIEN' : `\n${fallos} FALLOS`)
process.exit(fallos === 0 ? 0 : 1)
