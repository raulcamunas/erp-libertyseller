import { MAX_APUNTE, cuerpoDelApunte } from '@/lib/correo/apunte'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

console.log('\n=== el apunte de un correo enviado ===')
{
  const a = cuerpoDelApunte({ para: 'joe@tienda.com', asunto: 'Una vía para llegar a Amazon', texto: 'Hola,\n\nTe escribo por una cosa.\n\nUn saludo,' })
  ok('lleva a quién, el asunto y el texto', a === 'Correo enviado a joe@tienda.com\nAsunto: Una vía para llegar a Amazon\n\nHola,\n\nTe escribo por una cosa.\n\nUn saludo,', JSON.stringify(a))
  ok('sin destinatario no deja un «a» colgando', cuerpoDelApunte({ asunto: 'X', texto: 'Y' }).startsWith('Correo enviado\nAsunto: X'))
  ok('sin asunto dice «sin asunto»', cuerpoDelApunte({ para: 'a@b.es', asunto: '   ', texto: 'Y' }).includes('Asunto: sin asunto'))
  ok('sin texto solo lleva la cabecera', cuerpoDelApunte({ para: 'a@b.es', asunto: 'X', texto: '  \n ' }) === 'Correo enviado a a@b.es\nAsunto: X')
  ok('varios destinatarios en una línea', cuerpoDelApunte({ para: 'a@b.es,\n c@d.es', asunto: 'X' }).startsWith('Correo enviado a a@b.es, c@d.es\n'))
  ok('el asunto en una sola línea', cuerpoDelApunte({ asunto: 'Uno\ndos' }).includes('Asunto: Uno dos'))
  const sucio = cuerpoDelApunte({ asunto: 'X', texto: 'Hola   \r\n\r\n\r\n\r\nAdiós  ' })
  ok('limpia espacios al final de línea y saltos de más', sucio.endsWith('Hola\n\nAdiós'), JSON.stringify(sucio))
  const largo = cuerpoDelApunte({ asunto: 'X', texto: 'palabra '.repeat(3000) })
  ok('un texto enorme se corta con «…»', largo.length === MAX_APUNTE && largo.endsWith('…'), String(largo.length))
  ok('un correo normal (1.000 caracteres) no se corta', !cuerpoDelApunte({ asunto: 'X', texto: 'a'.repeat(1000) }).endsWith('…'))
}

console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
