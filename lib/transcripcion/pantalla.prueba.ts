import { ESPERA_MAXIMA_MS, esperaResumen, hayQueEsperar, leToca, primeraFrase, vistaDelResumen, type LlamadaTranscribible } from '@/lib/transcripcion/pantalla'
import type { ResumenDeLlamadaGuardado } from '@/lib/transcripcion/tipos'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

const AHORA = Date.parse('2026-10-23T15:00:00Z')
const llamada = (extra: Partial<LlamadaTranscribible> = {}): LlamadaTranscribible => ({ id: 'c1', fecha: '2026-10-23T14:50:00Z', duracion_s: 60, estado: 'ANSWERED', grabacion_id: 'g1', ...extra })
const fila = (extra: Partial<ResumenDeLlamadaGuardado> = {}): ResumenDeLlamadaGuardado => ({
  llamada_id: 'c1',
  estado: 'hecha',
  motivo: null,
  intentos: 1,
  tipo: 'conversacion',
  resumen: 'Se habló con Pedro.',
  linea: [],
  siguiente_paso: null,
  interes: 'alto',
  ...extra,
})

console.log('\n=== qué llamadas le tocan al proceso ===')
{
  ok('contestada, con conversación y grabación', leToca(llamada()))
  ok('justo 20 s sí; 19 no', leToca(llamada({ duracion_s: 20 })) && !leToca(llamada({ duracion_s: 19 })))
  ok('no contestada no', !leToca(llamada({ estado: 'MISSED' })))
  ok('sin grabación no', !leToca(llamada({ grabacion_id: null })))
  ok('sin lead (consta como null) no; sin el dato (el historial) sí', !leToca(llamada({ lead_id: null })) && leToca(llamada({ lead_id: 'l1' })) && leToca(llamada()))
}

console.log('\n=== qué se enseña ===')
{
  ok('sin fila: nada', vistaDelResumen(undefined) === 'nada')
  ok('conversación resumida: el bloque', vistaDelResumen(fila()) === 'resumen')
  ok('«hecha» pero sin texto de resumen: nada', vistaDelResumen(fila({ resumen: null })) === 'nada')
  ok('buzón de voz: línea apagada', vistaDelResumen(fila({ tipo: 'buzon_de_voz' })) === 'buzon')
  ok('sin contenido: nada', vistaDelResumen(fila({ tipo: 'sin_contenido', resumen: null })) === 'nada')
  ok('procesando: «transcribiendo»', vistaDelResumen(fila({ estado: 'procesando' })) === 'procesando')
  ok('fallida con intentos por gastar: se va a reintentar, «transcribiendo»', vistaDelResumen(fila({ estado: 'fallida', intentos: 2 })) === 'procesando')
  ok('fallida con los tres intentos: sin resumen', vistaDelResumen(fila({ estado: 'fallida', intentos: 3 })) === 'sin_resumen')
  ok('omitida: sin resumen (con su motivo)', vistaDelResumen(fila({ estado: 'omitida', motivo: 'Rinkel ya no tiene la grabación.' })) === 'sin_resumen')
}

console.log('\n=== cuándo seguir preguntando ===')
{
  const sin = new Map<string, ResumenDeLlamadaGuardado>()
  ok('una llamada que acaba de colgar y aún no tiene fila: se espera', hayQueEsperar([llamada()], sin, AHORA))
  ok('una de hace cuatro horas sin fila: ya no', !hayQueEsperar([llamada({ fecha: '2026-10-23T10:00:00Z' })], sin, AHORA))
  // Las dos empezaron hace 80 minutos; una duró media hora (acabó hace 50 min: se espera) y la otra un minuto (acabó hace 79: ya no)
  ok('el límite es una hora desde que ACABA la llamada, no desde que empezó', hayQueEsperar([llamada({ fecha: '2026-10-23T13:40:00Z', duracion_s: 1800 })], sin, AHORA) && !hayQueEsperar([llamada({ fecha: '2026-10-23T13:40:00Z', duracion_s: 60 })], sin, AHORA))
  ok('justo una hora después de acabar ya no', !hayQueEsperar([llamada({ fecha: '2026-10-23T13:30:00Z', duracion_s: 1800 })], sin, AHORA))
  ok('la espera máxima es una hora', ESPERA_MAXIMA_MS === 3_600_000)
  ok('con la fila hecha: no se espera', !hayQueEsperar([llamada()], new Map([['c1', fila()]]), AHORA))
  ok('con la fila procesando: se espera (aunque la llamada sea vieja)', hayQueEsperar([llamada({ fecha: '2026-10-23T08:00:00Z' })], new Map([['c1', fila({ estado: 'procesando' })]]), AHORA))
  ok('con la fila fallida pendiente de reintento: se espera', hayQueEsperar([llamada()], new Map([['c1', fila({ estado: 'fallida', intentos: 1 })]]), AHORA))
  ok('con la fila fallida del todo: no', !hayQueEsperar([llamada()], new Map([['c1', fila({ estado: 'fallida', intentos: 3 })]]), AHORA))
  ok('una llamada que no le toca al proceso no hace esperar a nadie', !hayQueEsperar([llamada({ estado: 'MISSED' }), llamada({ id: 'c2', duracion_s: 5 }), llamada({ id: 'c3', grabacion_id: null })], sin, AHORA))
  ok('con una lista vacía, no', !hayQueEsperar([], sin, AHORA))
  ok('esperaResumen mira una sola llamada con su fila', esperaResumen(llamada(), undefined, AHORA) && !esperaResumen(llamada(), fila(), AHORA) && esperaResumen(llamada(), fila({ estado: 'procesando' }), AHORA) && !esperaResumen(llamada({ estado: 'MISSED' }), undefined, AHORA))
  ok('una fecha rota no hace esperar para siempre', !hayQueEsperar([llamada({ fecha: 'rota' })], sin, AHORA))
}

console.log('\n=== la primera frase ===')
{
  ok('corta en el primer punto', primeraFrase('Maoli habló con Pedro. Ya venden en Amazon.') === 'Maoli habló con Pedro.')
  ok('sin punto, todo', primeraFrase('Una sola frase sin punto') === 'Una sola frase sin punto')
  ok('un punto dentro de un número no corta', primeraFrase('Factura 300.000 euros al año. Y más.') === 'Factura 300.000 euros al año.')
  ok('un correo con punto tampoco', primeraFrase('Escribir a pedro@joe.es hoy. Luego llamar.') === 'Escribir a pedro@joe.es hoy.')
  ok('una frase larguísima se recorta con puntos suspensivos', primeraFrase('a'.repeat(400)).length === 160 && primeraFrase('a'.repeat(400)).endsWith('…'))
  ok('saltos de línea y huecos se aplanan', primeraFrase('Hola\n\n  mundo.  Adiós') === 'Hola mundo.')
  ok('vacío', primeraFrase('   ') === '')
}

console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
