import {
  AVISO_DE_PROBLEMA,
  MAX_CARACTERES_DE_WHATSAPP,
  PALABRAS_MAXIMAS_DE_WHATSAPP,
  PROBLEMAS_QUE_BLOQUEAN,
  limpiarMensajeDeWhatsapp,
  mensajeListoParaWhatsapp,
  revisarMensajeDeWhatsapp,
  type ProblemaDeWhatsapp,
} from '@/lib/whatsapp/ia-revision'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

const BUENO = 'Hola, soy Raúl de Liberty Seller. Estuve mirando vuestra cerámica y creo que en Amazon hay un hueco claro para piezas así, sin que tengáis que ocuparos del alta. ¿Te cuento cómo lo haríamos en una llamada de diez minutos?'
const palabras = (n: number) => Array.from({ length: n }, (_, i) => `palabra${i}`).join(' ')

console.log('\n=== un mensaje bueno ===')
{
  ok('no tiene ningún problema', revisarMensajeDeWhatsapp(BUENO).length === 0, JSON.stringify(revisarMensajeDeWhatsapp(BUENO)))
  ok('las cifras que no son dinero no cuentan (diez minutos, 15 productos, a las 17:30)', revisarMensajeDeWhatsapp('Hola, soy Marta. Te llamo en 10 minutos por vuestros 15 productos, ¿te va bien a las 17:30 o mejor mañana?').length === 0)
}

console.log('\n=== dinero ===')
{
  const dinero = (t: string) => revisarMensajeDeWhatsapp(t).includes('dinero')
  ok('la facturación', dinero('Hola, soy Raúl. Sé que vuestra facturación es buena y queremos ayudaros a crecer. ¿Hablamos un momento?'))
  ok('una cifra con euros', dinero('Hola, soy Raúl de Liberty Seller. Con 20.000 € al mes podríais crecer mucho en Amazon, ¿te llamo?'))
  ok('lo que factura al mes', dinero('Hola, soy Raúl de Liberty Seller. Vi que facturáis unos 15 al mes y creo que podemos mejorarlo, ¿hablamos?'))
  ok('los ingresos', dinero('Hola, soy Raúl de Liberty Seller. Os ayudamos a aumentar vuestros ingresos en Amazon, ¿tienes un minuto?'))
  ok('«ingresar» a Amazon no es dinero', !dinero('Hola, soy Raúl de Liberty Seller. Os ayudamos a ingresar en Amazon sin cargar a vuestro equipo, ¿te llamo un momento?'))
}

console.log('\n=== huecos, largo, corto, enlaces ===')
{
  ok('un hueco entre corchetes', revisarMensajeDeWhatsapp(BUENO.replace('Raúl', '[Nombre]')).includes('hueco'))
  ok('un hueco entre llaves', revisarMensajeDeWhatsapp(BUENO.replace('Raúl', '{{mi_nombre}}')).includes('hueco'))
  ok('un hueco entre ángulos', revisarMensajeDeWhatsapp(BUENO.replace('Raúl', '<tu nombre>')).includes('hueco'))
  ok('demasiado largo por palabras', revisarMensajeDeWhatsapp(`Hola, soy Raúl. ${palabras(PALABRAS_MAXIMAS_DE_WHATSAPP + 5)}`).includes('largo'))
  ok('justo en el tope no es largo', !revisarMensajeDeWhatsapp(palabras(PALABRAS_MAXIMAS_DE_WHATSAPP)).includes('largo'))
  ok('demasiado largo por caracteres aunque tenga pocas palabras', revisarMensajeDeWhatsapp('a'.repeat(MAX_CARACTERES_DE_WHATSAPP + 1)).includes('largo'))
  ok('demasiado corto', revisarMensajeDeWhatsapp('Hola, ¿qué tal?').includes('corto'))
  ok('un enlace con https', revisarMensajeDeWhatsapp(`${BUENO} https://libertyseller.com/cita`).includes('enlace'))
  ok('una dirección web con www', revisarMensajeDeWhatsapp(`${BUENO} Mira www.libertyseller.com`).includes('enlace'))
  ok('una dirección web sin www', revisarMensajeDeWhatsapp(`${BUENO} Entra en libertyseller.com`).includes('enlace'))
  ok('hablar de «Amazon» o de «la web» no es un enlace', !revisarMensajeDeWhatsapp('Hola, soy Raúl de Liberty Seller. Vi vuestra web y creo que en Amazon hay un hueco claro para vuestro catálogo. ¿Te cuento cómo en una llamada corta?').includes('enlace'))
}

console.log('\n=== repetir un WhatsApp anterior ===')
{
  ok('el mismo texto es una repetición', revisarMensajeDeWhatsapp(BUENO, [BUENO]).includes('repite'))
  ok('uno casi igual, también', revisarMensajeDeWhatsapp(BUENO.replace('diez', 'quince'), [BUENO]).includes('repite'))
  ok('uno distinto, no', !revisarMensajeDeWhatsapp('Hola, soy Raúl. Te escribí el martes por aquí y no quería dejarlo sin más: tengo una idea concreta para vuestras fichas que te puede interesar. ¿Cuándo te viene bien que te llame?', [BUENO]).includes('repite'))
  ok('sin anteriores o con anteriores vacíos, no hay nada que repetir', !revisarMensajeDeWhatsapp(BUENO).includes('repite') && !revisarMensajeDeWhatsapp(BUENO, ['', '   ']).includes('repite'))
}

console.log('\n=== varios problemas a la vez ===')
{
  const p = revisarMensajeDeWhatsapp('Hola [Nombre], vuestra facturación: www.x.com')
  ok('salen todos, sin repetirse', ['dinero', 'hueco', 'corto', 'enlace'].every((x) => p.includes(x as ProblemaDeWhatsapp)) && new Set(p).size === p.length, JSON.stringify(p))
  ok('cada problema tiene su frase para la pantalla', (['dinero', 'hueco', 'largo', 'corto', 'enlace', 'repite'] as const).every((x) => AVISO_DE_PROBLEMA[x].length > 10))
  ok('solo un hueco impide abrir WhatsApp', PROBLEMAS_QUE_BLOQUEAN.size === 1 && PROBLEMAS_QUE_BLOQUEAN.has('hueco'))
}

console.log('\n=== limpiar lo que la IA cuela ===')
{
  ok('negritas de markdown', limpiarMensajeDeWhatsapp('Hola, soy **Raúl** de Liberty Seller.') === 'Hola, soy Raúl de Liberty Seller.')
  ok('negritas de WhatsApp con un asterisco', limpiarMensajeDeWhatsapp('Hola, te llamo por *tus fichas* de Amazon. ¿Cuándo hablamos?') === 'Hola, te llamo por tus fichas de Amazon. ¿Cuándo hablamos?')
  ok('un asterisco suelto (una nota al pie) no se toca', limpiarMensajeDeWhatsapp('Hola * esto no es negrita') === 'Hola * esto no es negrita')
  ok('comillas alrededor de todo el mensaje', limpiarMensajeDeWhatsapp('«Hola, soy Raúl. ¿Hablamos?»') === 'Hola, soy Raúl. ¿Hablamos?' && limpiarMensajeDeWhatsapp('"Hola, soy Raúl. ¿Hablamos?"') === 'Hola, soy Raúl. ¿Hablamos?')
  ok('comillas dentro del mensaje se respetan', limpiarMensajeDeWhatsapp('Hola, soy Raúl. Te escribo por «Casa Luz». ¿Hablamos?') === 'Hola, soy Raúl. Te escribo por «Casa Luz». ¿Hablamos?')
  ok('la despedida de correo de la última línea', limpiarMensajeDeWhatsapp('Hola, soy Raúl. ¿Hablamos?\n\nUn saludo,') === 'Hola, soy Raúl. ¿Hablamos?' && limpiarMensajeDeWhatsapp('Hola, soy Raúl. ¿Hablamos?\nSaludos.') === 'Hola, soy Raúl. ¿Hablamos?')
  ok('un «gracias» sí vale como cierre', limpiarMensajeDeWhatsapp('Hola, soy Raúl. ¿Hablamos?\n\nGracias') === 'Hola, soy Raúl. ¿Hablamos?\n\nGracias')
  ok('saltos de línea de más y espacios al final de línea', limpiarMensajeDeWhatsapp('Hola, soy Raúl.   \r\n\r\n\r\n\r\n¿Hablamos?  ') === 'Hola, soy Raúl.\n\n¿Hablamos?')
  ok('el mensaje que se abre se normaliza igual', mensajeListoParaWhatsapp('  Hola.  \r\n\r\n\r\n¿Qué tal?  ') === 'Hola.\n\n¿Qué tal?')
}

console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
