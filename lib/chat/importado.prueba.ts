import { archivoDeSlack, esAvisoDeUnion, separarArchivosDeSlack } from '@/lib/chat/importado'

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

igual('los archivos salen del texto', separarArchivosDeSlack('46cm de largo\n📎 5c79.png (archivo de Slack, no importado)\n📎 plano.pdf (archivo de Slack, no importado)'), { texto: '46cm de largo', archivos: [{ nombre: '5c79.png', tipo: 'imagen', extension: 'PNG' }, { nombre: 'plano.pdf', tipo: 'pdf', extension: 'PDF' }] })
igual('solo archivos: texto vacío', separarArchivosDeSlack('📎 a.xlsx (archivo de Slack, no importado)').texto, '')
igual('un mensaje normal no cambia', separarArchivosDeSlack('hola 📎 esto no es un archivo'), { texto: 'hola 📎 esto no es un archivo', archivos: [] })
igual('sin extensión es un archivo', archivoDeSlack('LEEME'), { nombre: 'LEEME', tipo: 'archivo', extension: '' })
igual('avisos de unión', [esAvisoDeUnion('@Jhanna Carrizales se ha unido al canal'), esAvisoDeUnion('Mario se ha unido al canal.'), esAvisoDeUnion('Ana se ha unido al grupo')], [true, true, true])
igual('un mensaje que lo cita no es un aviso', [esAvisoDeUnion('Hola, Ana se ha unido al canal y pregunta si hay novedades'), esAvisoDeUnion('hola')], [false, false])

console.log(`\n${comprobaciones - fallos}/${comprobaciones} comprobaciones bien`)
if (fallos > 0) process.exit(1)
