import {
  ejemplosParaLead,
  elegirGanadores,
  esRechazo,
  limpiarCuerpo,
  mencionaFacturacion,
  neutralizarNombres,
  quitarFrasesConDinero,
  sinDatosDeContacto,
  tipoDeEjemplo,
  unirLineasPartidas,
  type EjemploGanador,
  type MensajeDeHilo,
} from '@/lib/correo/ia-ejemplos'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

console.log('\n=== mencionaFacturacion: dinero ===')
for (const t of [
  'estimamos una facturación actual cercana a los 20.200 €/mes',
  'Su empresa factura unos 20k al mes',
  'con unas ventas mensuales de',
  'la facturación se sitúa en torno a los 14.000 € mensuales',
  'Skipping (~16.8k €/mes) en Amazon',
  'unos ingresos de tres millones',
  'más de 30 mil euros',
  'hacia los €20k',
  'Revenue de $5,000',
  'un volumen de negocio importante',
  'la cifra de negocio',
  'alcanzar 30.000 € cada mes',
]) ok(`dinero: «${t}»`, mencionaFacturacion(t))

console.log('\n=== mencionaFacturacion: lo que NO es dinero ===')
for (const t of [
  'Ingresa a Amazon con nosotros',
  'Plan de ingreso e integración en Amazon',
  'una videollamada de 10 minutos por Google Meet',
  'dos cuellos de botella clave',
  'mejora de un 30 % en la conversión',
  'Hola, soy Laura de Liberty Seller',
  'tarifas B2B escalonadas e IVA desglosado',
  'el próximo martes a las 9:30',
]) ok(`no es dinero: «${t}»`, !mencionaFacturacion(t))

console.log('\n=== esRechazo ===')
for (const t of [
  'Hola, No estamos interesados. Gracias.',
  'Muchas gracias por tu explicación. Seguiremos como actualmente. Un saludo',
  'Muchas gracias pero ya tenemos una persona que se está ocupando de Amazon.',
  'Tenemos una empresa externa que realiza este trabajo. Gracias',
  'No, gracias.',
  'ahora mismo no estamos interesados',
  'Por favor, no nos escriban más',
  'Quiero darme de baja de vuestra lista',
]) ok(`rechazo: «${t}»`, esRechazo(t))
for (const t of [
  'Estaría encantado de atenderte el viernes a las 10:00. Envíame el enlace.',
  'Podemos reunirnos con vosotros pero tendría que ser una tarde a partir de las 18h.',
  'Estamos en inicio de temporada y muy ocupados, en cuanto pueda lo miro y te escribo.',
  'Gracias por la llamada y por la información. Como te comenté, estamos explorando opciones.',
]) ok(`no es rechazo: «${t.slice(0, 50)}…»`, !esRechazo(t))
ok('mira lo escrito y no lo citado: un «no estamos interesados» CITADO debajo no cuenta', !esRechazo('Perfecto, hablamos el martes.\n\nEl lun, 5 oct 2026, Ana escribió:\n> no estamos interesados'))

console.log('\n=== limpiarCuerpo ===')
ok('quita lo citado con «> »', limpiarCuerpo('Hola.\n> citado\n> otra\nGracias') === 'Hola.\nGracias')
ok('corta en «El … escribió:»', limpiarCuerpo('Vale, quedamos.\n\nEl lun, 5 oct 2026 a las 10:00, Ana <ana@x.es> escribió:\n> hola') === 'Vale, quedamos.')
ok('corta el encabezado partido en dos líneas', limpiarCuerpo('Vale.\n\nEl lun, 5 oct 2026 a las 10:00, Ana López\n<ana@x.es> escribió:\n> hola') === 'Vale.')
ok('corta cuando todo viene en una sola línea', limpiarCuerpo('Hola. El jue, 22 oct 2026 a las 18:59, Daniela <d@x.es> escribió: > correo de prueba >') === 'Hola.')
ok('corta en la firma «--»', limpiarCuerpo('Texto.\n\nUn saludo.\n--\nAna\n600 11 22 33') === 'Texto.\n\nUn saludo.')
ok('quita «Sent with Hostinger Mail»', limpiarCuerpo('Texto.\n\nSent with Hostinger Mail') === 'Texto.')
ok('corta en «-----Original Message-----»', limpiarCuerpo('Ok.\n-----Original Message-----\nDe: x') === 'Ok.')

console.log('\n=== sinDatosDeContacto ===')
ok('correos', sinDatosDeContacto('escribe a ana@tienda.es o a ventas@x.com') === 'escribe a <correo> o a <correo>')
ok('teléfonos', sinDatosDeContacto('llama al 600 11 22 33 o al +34 910 21 04 65') === 'llama al <teléfono> o al <teléfono>')
ok('no toca un número corto ni una cifra', sinDatosDeContacto('10 minutos, 2026 y 20.200') === '10 minutos, 2026 y 20.200')

console.log('\n=== unirLineasPartidas y quitarFrasesConDinero ===')
{
  const partido = 'Le escribo tras analizar la presencia de su marca en Amazon, donde\nestimamos una facturación actual cercana a los 20.200 €/mes.\n\nOtra cosa distinta.'
  ok('une las líneas partidas a mano', unirLineasPartidas(partido).split('\n').length === 3, JSON.stringify(unirLineasPartidas(partido)))
  const r = quitarFrasesConDinero(unirLineasPartidas(partido))
  ok('quita la frase entera, aunque estuviera partida en dos líneas', r.texto === 'Otra cosa distinta.' && r.quitadas === 1, JSON.stringify(r))
  const s = quitarFrasesConDinero('Hola. Tu facturación es de 20.000 €. Te proponemos una llamada breve.')
  ok('quita solo la frase de dinero y deja las demás', s.texto === 'Hola. Te proponemos una llamada breve.' && s.quitadas === 1, JSON.stringify(s))
  ok('no parte un número por su punto («20.200»)', !quitarFrasesConDinero('Hacia los 20.200 € de caja.').texto.includes('200'))
  const lista = quitarFrasesConDinero('Intro corta.\n\n* Primera fuga: algo.\n* Segunda: llegar a 30.000 €/mes.\n* Tercera: otra.')
  ok('una viñeta con dinero se va y las otras se quedan', lista.texto.includes('Primera') && lista.texto.includes('Tercera') && !lista.texto.includes('Segunda'), JSON.stringify(lista))
  ok('un texto sin dinero queda igual', quitarFrasesConDinero('Todo bien.\n\nSigue bien.').texto === 'Todo bien.\n\nSigue bien.')
}

console.log('\n=== neutralizarNombres ===')
{
  const t = neutralizarNombres('Estimada Aitiana\n\nSoy María Fernanda, de Liberty Seller. Escribo desde josé@x.es. Atentamente, Maoli Carolina.', ['Maria Fernanda', 'José', 'Maoli Carolina Arias'])
  ok('el saludo con nombre queda en «Hola,»', t.startsWith('Hola,\n'), JSON.stringify(t))
  ok('los nombres del equipo, con o sin tilde, se quitan', !/Mar[ií]a|Fernanda|Maoli|Carolina/.test(t), JSON.stringify(t))
  ok('los nombres seguidos se funden en uno solo', t.includes('Soy <comercial>, de Liberty Seller'), JSON.stringify(t))
  ok('un saludo sin nombre se respeta', neutralizarNombres('Hola,\n\nTexto', []).startsWith('Hola,'))
  ok('la primera línea que no es un saludo no se toca', neutralizarNombres('Te escribo por Amazon\nHola', []).startsWith('Te escribo'))
}

console.log('\n=== tipoDeEjemplo ===')
ok('«aún no estáis vendiendo en Amazon» es para entrar', tipoDeEjemplo('Me llamó la atención que aún no estáis vendiendo en Amazon.') === 'entrar')
ok('«no encontramos la presencia directa de su tienda» es para entrar', tipoDeEjemplo('identificamos demanda, pero no encontramos la presencia directa de su tienda.') === 'entrar')
ok('el asunto «Ingresa a Amazon» es para entrar', tipoDeEjemplo('Hola.', 'Ingresa a Amazon') === 'entrar')
ok('optimizar una cuenta no es entrar', tipoDeEjemplo('Revisamos el TACoS y el contenido A+ de vuestra cuenta.') === 'optimizar')

console.log('\n=== elegirGanadores ===')
{
  const parrafo = 'Hemos revisado vuestra tienda y vemos una oportunidad clara para trabajar mejor las fichas de producto, el posicionamiento orgánico y la publicidad, sin cargar trabajo extra a vuestro equipo. Si os encaja, lo vemos en una videollamada breve de diez minutos y os cuento cómo lo haríamos.'
  const propios = new Set(['agencia.es'])
  let n = 0
  const m = (hilo: string, buzon: string, direccion: 'entrante' | 'saliente', de: string, fecha: string, asunto: string, texto: string, automatico = false): MensajeDeHilo => ({
    hiloId: hilo,
    buzonId: buzon,
    direccion,
    deDireccion: de,
    fecha,
    automatico,
    asunto,
    texto,
  })
  const frio = (h: string, b: string, dia: number, asunto = `Asunto ${h}`, texto = parrafo) => m(h, b, 'saliente', `${b}@agencia.es`, `2026-10-${String(dia).padStart(2, '0')}T10:00:00Z`, asunto, texto)
  const resp = (h: string, de: string, dia: number, texto: string, auto = false) => m(h, 'x', 'entrante', de, `2026-10-${String(dia).padStart(2, '0')}T12:00:00Z`, `Re: ${h}`, texto, auto)
  void n

  const mensajes: MensajeDeHilo[] = [
    frio('A', 'ana', 1),
    resp('A', 'cliente@tienda.com', 2, 'Buenos días, nos viene bien el jueves.'),
    frio('B', 'ana', 3),
    resp('B', 'cliente@otra.com', 4, 'No estamos interesados, gracias.'),
    frio('C', 'ana', 5),
    resp('C', 'luis@agencia.es', 6, 'prueba de que llega'),
    frio('D', 'luis', 7, 'Propuesta para Acme', `${parrafo}\n\nEstimamos una facturación actual cercana a los 20.200 €/mes. Por eso creemos que hay margen.\n\nUn saludo,`),
    resp('D', 'cliente@acme.com', 8, 'Hablamos el lunes.'),
    frio('E', 'luis', 9, 'Escalar de 14.000 € a 30.000 €/mes'),
    resp('E', 'cliente@e.com', 10, 'Cuéntame más.'),
    m('F', 'ana', 'entrante', 'cliente@f.com', '2026-10-11T10:00:00Z', 'Consulta', parrafo),
    m('F', 'ana', 'saliente', 'ana@agencia.es', '2026-10-11T11:00:00Z', 'Re: Consulta', parrafo),
    resp('F', 'cliente@f.com', 12, 'Gracias.'),
    frio('G', 'ana', 13, 'Corto', 'Hola, ¿hablamos?'),
    resp('G', 'cliente@g.com', 14, 'Sí.'),
    frio('H', 'ana', 15),
    resp('H', 'no-reply@zendesk.com', 16, 'Hemos recibido tu solicitud'),
    frio('I', 'ana', 17),
    resp('I', 'cliente@i.com', 18, 'Respuesta automática: fuera de la oficina', true),
    frio('J', 'ana', 19, 'Prueba de correo'),
    resp('J', 'cliente@j.com', 20, 'Vale.'),
    frio('K', 'ana', 21, 'Asunto con hueco', `Hola [Nombre],\n\n${parrafo}`),
    resp('K', 'cliente@k.com', 22, 'Vale, hablamos.'),
  ]
  const g = elegirGanadores(mensajes, { dominiosPropios: propios })
  const ids = g.map((x) => x.hiloId)
  ok('entran A y D, y solo ellos', ids.length === 2 && ids.includes('A') && ids.includes('D'), JSON.stringify(ids))
  ok('un rechazo (B) no entra', !ids.includes('B'))
  ok('una «respuesta» de nuestro propio dominio (C) no cuenta', !ids.includes('C'))
  ok('un asunto con cifras de dinero (E) se descarta', !ids.includes('E'))
  ok('un hilo que empezó el cliente (F) no es un frío', !ids.includes('F'))
  ok('un correo demasiado corto (G) no sirve de ejemplo', !ids.includes('G'))
  ok('un «no-reply» o una cola de soporte (H) no es una persona', !ids.includes('H'))
  ok('una respuesta automática (I) no cuenta', !ids.includes('I'))
  ok('un asunto de prueba (J) se descarta', !ids.includes('J'))
  ok('un correo con un hueco entre corchetes (K) se descarta', !ids.includes('K'))
  const d = g.find((x) => x.hiloId === 'D')
  ok('D entra SIN la frase de la facturación', !!d && !mencionaFacturacion(d.texto) && d.texto.includes('Hemos revisado'), JSON.stringify(d?.texto.slice(0, 200)))
  ok('lo más reciente primero', g[0].hiloId === 'D' && g[1].hiloId === 'A', JSON.stringify(ids))
  ok('lleva la fecha de la primera respuesta buena', g.find((x) => x.hiloId === 'A')?.respondioEn === '2026-10-02T12:00:00Z')

  // Diversidad: como mucho 3 por comercial
  const muchos: MensajeDeHilo[] = []
  for (let i = 1; i <= 5; i++) muchos.push(frio(`M${i}`, 'ana', i), resp(`M${i}`, `c${i}@x.com`, i + 1, 'Nos interesa, llamadme.'))
  ok('como mucho 3 de cada comercial', elegirGanadores(muchos, { dominiosPropios: propios }).length === 3)
  ok('con `porBuzon` más alto salen más', elegirGanadores(muchos, { dominiosPropios: propios, porBuzon: 5 }).length === 5)
  ok('`max` limita el total', elegirGanadores(muchos, { dominiosPropios: propios, porBuzon: 5, max: 2 }).length === 2)
  ok('sin mensajes, nada', elegirGanadores([], { dominiosPropios: propios }).length === 0)
}

console.log('\n=== ejemplosParaLead ===')
{
  const e = (id: string, tipo: EjemploGanador['tipo']): EjemploGanador => ({ hiloId: id, buzonId: 'b', asunto: id, texto: id, respondioEn: '2026-10-01T00:00:00Z', tipo })
  const todos = [e('o1', 'optimizar'), e('n1', 'entrar'), e('o2', 'optimizar'), e('n2', 'entrar'), e('o3', 'optimizar')]
  const paraEntrar = ejemplosParaLead(todos, 'entrar', 3).map((x) => x.hiloId)
  ok('primero los de su mismo tipo y luego se rellena', JSON.stringify(paraEntrar) === JSON.stringify(['n1', 'n2', 'o1']), JSON.stringify(paraEntrar))
  ok('respeta cuántos', ejemplosParaLead(todos, 'optimizar', 2).length === 2)
  ok('sin ganadores, nada', ejemplosParaLead([], 'entrar').length === 0)
}

console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
