import { MINIMO_PARA_COMPARAR, desenlaceDeEnvio, intervaloDeWilson, resumirGrupo, veredicto, type MensajeEntrante } from '@/lib/correo/ia-resultados'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}
const cerca = (a: number, b: number, tol = 0.001) => Math.abs(a - b) <= tol

const PROPIOS = new Set(['agencia.es'])
const entrante = (fecha: string, de: string, texto: string, automatico = false): MensajeEntrante => ({ hiloId: 'h', fecha, deDireccion: de, automatico, texto })

console.log('\n=== qué pasó con un envío ===')
{
  const enviado = '2026-10-10T10:00:00Z'
  const buena = entrante('2026-10-11T09:00:00Z', 'cliente@tienda.com', 'Buenas, nos viene bien el jueves.')
  ok('contesta alguien de fuera con interés: respondió e interesada', JSON.stringify(desenlaceDeEnvio(enviado, [buena], PROPIOS)) === '{"respondio":true,"interesada":true}')
  const no = entrante('2026-10-11T09:00:00Z', 'cliente@tienda.com', 'No estamos interesados, gracias.')
  ok('un «no»: respondió pero NO interesada', JSON.stringify(desenlaceDeEnvio(enviado, [no], PROPIOS)) === '{"respondio":true,"interesada":false}')
  ok('sin respuestas: nada', JSON.stringify(desenlaceDeEnvio(enviado, [], PROPIOS)) === '{"respondio":false,"interesada":false}')
  ok('una respuesta ANTERIOR al envío no cuenta (es de una conversación anterior)', !desenlaceDeEnvio(enviado, [entrante('2026-10-09T09:00:00Z', 'cliente@tienda.com', 'Hola')], PROPIOS).respondio)
  ok('un correo de un compañero (el propio dominio) no cuenta', !desenlaceDeEnvio(enviado, [entrante('2026-10-11T09:00:00Z', 'luis@agencia.es', 'prueba')], PROPIOS).respondio)
  ok('una respuesta automática no cuenta', !desenlaceDeEnvio(enviado, [entrante('2026-10-11T09:00:00Z', 'cliente@tienda.com', 'Fuera de la oficina', true)], PROPIOS).respondio)
  ok('un no-reply no cuenta', !desenlaceDeEnvio(enviado, [entrante('2026-10-11T09:00:00Z', 'no-reply@zendesk.com', 'Recibido')], PROPIOS).respondio)
  ok('un «no» y luego un «sí»: interesada', desenlaceDeEnvio(enviado, [no, entrante('2026-10-12T09:00:00Z', 'otro@tienda.com', 'Perdón, sí me interesa que me llaméis')], PROPIOS).interesada)
}

console.log('\n=== el intervalo de Wilson ===')
{
  const a = intervaloDeWilson(5, 50)!
  ok('5 de 50: entre 4,3 % y 21,4 %', cerca(a[0], 0.0435) && cerca(a[1], 0.2136), JSON.stringify(a))
  const b = intervaloDeWilson(0, 30)!
  ok('0 de 30: de 0 a 11,4 %', b[0] === 0 && cerca(b[1], 0.1135), JSON.stringify(b))
  const c = intervaloDeWilson(30, 30)!
  ok('30 de 30: acaba en 1', c[1] === 1 && c[0] > 0.88)
  ok('sin envíos: null', intervaloDeWilson(0, 0) === null)
  const pequeno = intervaloDeWilson(2, 20)!
  const grande = intervaloDeWilson(200, 2000)!
  ok('con más envíos el intervalo se estrecha', grande[1] - grande[0] < (pequeno[1] - pequeno[0]) / 4)
}

console.log('\n=== resumirGrupo ===')
{
  const si = { respondio: true, interesada: true }
  const no = { respondio: true, interesada: false }
  const nada = { respondio: false, interesada: false }
  const r = resumirGrupo([{ desenlace: si, cambios: 10 }, { desenlace: no, cambios: 30 }, { desenlace: nada, cambios: null }, { desenlace: nada }])
  ok('cuenta enviados, respuestas e interesadas', r.enviados === 4 && r.respondieron === 2 && r.interesadas === 1)
  ok('las tasas', r.tasaRespuesta === 0.5 && r.tasaInteres === 0.25)
  ok('la media de cambios solo cuenta los envíos con texto final', r.cambiosMedios === 20)
  ok('lleva su intervalo', r.intervaloInteres !== null && r.intervaloInteres[0] < 0.25 && r.intervaloInteres[1] > 0.25)
  const vacio = resumirGrupo([])
  ok('sin envíos: todo a cero y las tasas null', vacio.enviados === 0 && vacio.tasaRespuesta === null && vacio.tasaInteres === null && vacio.intervaloInteres === null && vacio.cambiosMedios === null)
}

console.log('\n=== el veredicto ===')
{
  const g = (id: string, enviados: number, interesadas: number) => ({ id, nombre: `Versión ${id}`, enviados, interesadas })
  const pocos = veredicto([g('a', 20, 3), g('b', 25, 1)])
  ok('con pocos envíos: sin datos, y dice cuánto llevan', pocos.tipo === 'sin-datos' && /al menos 30/.test(pocos.texto) && /tiene 25/.test(pocos.texto), pocos.texto)
  ok('con una sola versión madura: sin datos', veredicto([g('a', 200, 10), g('b', 5, 1)]).tipo === 'sin-datos')
  ok('sin versiones: sin datos', veredicto([]).tipo === 'sin-datos')
  const parecidas = veredicto([g('a', 100, 5), g('b', 100, 3)])
  ok('5 % contra 3 % con 100 cada una: sin diferencia clara', parecidas.tipo === 'sin-diferencia', parecidas.texto)
  const clara = veredicto([g('a', 400, 40), g('b', 400, 12)])
  ok('10 % contra 3 % con 400 cada una: gana la A', clara.tipo === 'lider' && clara.id === 'a' && /Versión a/.test(clara.texto), JSON.stringify(clara))
  const alReves = veredicto([g('a', 400, 12), g('b', 400, 40)])
  ok('gana la que tiene más, esté donde esté', alReves.tipo === 'lider' && alReves.id === 'b')
  ok('empate exacto: sin diferencia', veredicto([g('a', 100, 5), g('b', 100, 5)]).tipo === 'sin-diferencia')
  ok('tres versiones: compara la primera con la segunda', veredicto([g('a', 400, 12), g('b', 400, 40), g('c', 400, 38)]).tipo === 'sin-diferencia')
  ok('el mínimo para comparar son 30', MINIMO_PARA_COMPARAR === 30)
}

console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
