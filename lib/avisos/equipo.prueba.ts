import { HITOS_DE_LLAMADAS, avisoDeEquipo, type FilaDeAvisoDeEquipo } from './equipo'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}
const fila = (extra: Partial<FilaDeAvisoDeEquipo>): FilaDeAvisoDeEquipo => ({ id: 'x1', tipo: 'hito_llamadas', usuario_id: 'u1', usuario_nombre: 'Alejandro', cifra: 40, detalle: null, ...extra })

console.log('\n=== hitos de llamadas ===')
for (const h of HITOS_DE_LLAMADAS) {
  const a = avisoDeEquipo(fila({ cifra: h }))
  ok(`el ${h} sale con su frase`, !!a && a.titulo === `Alejandro lleva ${h} llamadas hoy` && !!a.texto && a.tipo === 'hito')
}
ok('una cifra que no es un hito no se avisa', avisoDeEquipo(fila({ cifra: 30 })) === null && avisoDeEquipo(fila({ cifra: null })) === null)
ok('el id es estable por fila (no se enseña dos veces)', avisoDeEquipo(fila({ id: 'abc' }))!.id === 'equipo-abc')

console.log('\n=== citas ===')
{
  const a = avisoDeEquipo(fila({ tipo: 'cita_agendada', cifra: null, detalle: 'Badis Aquariums' }))!
  ok('dice quién y con quién', a.titulo === 'Alejandro ha agendado una cita' && a.texto === 'Con Badis Aquariums.' && a.tipo === 'cita')
  ok('sin empresa, una frase general', avisoDeEquipo(fila({ tipo: 'cita_agendada', cifra: null, detalle: '  ' }))!.texto === '¡Una más para el equipo!')
}

console.log('\n=== lo raro no rompe nada ===')
{
  ok('un tipo desconocido no da aviso', avisoDeEquipo({ ...fila({}), tipo: 'otra_cosa' as never }) === null)
  ok('sin nombre, «alguien del equipo»', avisoDeEquipo(fila({ usuario_nombre: '  ' }))!.titulo.startsWith('Alguien del equipo lleva'))
  const textos = HITOS_DE_LLAMADAS.map((h) => avisoDeEquipo(fila({ cifra: h }))!.texto ?? '').join(' ').toLowerCase()
  ok('no compara a nadie con nadie (ni «más que», ni «te faltan», ni «primero»)', !/más que|te faltan|primer[oa]s? del|ganas|pierdes|por detrás|por delante/.test(textos))
}

console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
