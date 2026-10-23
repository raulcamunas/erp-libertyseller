import { ANGULOS, ESQUEMA_BORRADOR, INSTRUCCIONES, construirMensajes, leerBorrador, mensajeDeCorreccion, palabrasDe, revisarBorrador } from '@/lib/correo/ia-prompt'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

const CUERPO =
  'Hola,\n\nTe escribo porque hemos revisado vuestra tienda y vemos una oportunidad clara de ordenar las fichas y la publicidad en Amazon, sin cargar a vuestro equipo.\n\n¿Te encaja una videollamada breve de 10-15 minutos? ¿Qué día te viene mejor?\n\nUn saludo,'
const json = (o: Record<string, unknown>) => JSON.stringify(o)

console.log('\n=== las instrucciones y el esquema ===')
ok('las instrucciones prohíben hablar de facturación', /NUNCA menciones facturación/.test(INSTRUCCIONES))
ok('las instrucciones piden «Hola,» a secas y la videollamada de 10-15 minutos', INSTRUCCIONES.includes('«Hola,» a secas') && INSTRUCCIONES.includes('10-15 minutos'))
ok('las instrucciones explican el seguimiento y el «no le interesa»', INSTRUCCIONES.includes('SEGUIMIENTO') && INSTRUCCIONES.includes('No le interesa'))
ok('el esquema es estricto: sin campos de más y todos obligatorios', ESQUEMA_BORRADOR.additionalProperties === false && JSON.stringify([...ESQUEMA_BORRADOR.required].sort()) === JSON.stringify(Object.keys(ESQUEMA_BORRADOR.properties).sort()))
ok('los ángulos del esquema son los de ANGULOS', JSON.stringify(ESQUEMA_BORRADOR.properties.angulo.enum) === JSON.stringify([...ANGULOS]))

console.log('\n=== leerBorrador ===')
{
  const b = leerBorrador(json({ asunto: '  Amazon para Acme  ', texto: CUERPO, angulo: 'seguimiento' }))
  ok('un borrador bueno se lee', !!b && b.asunto === 'Amazon para Acme' && b.angulo === 'seguimiento' && b.texto.startsWith('Hola,'))
  ok('un ángulo desconocido pasa a «mejorar_cuenta»', leerBorrador(json({ asunto: 'A', texto: CUERPO, angulo: 'inventado' }))?.angulo === 'mejorar_cuenta')
  ok('quita las negritas de markdown', !leerBorrador(json({ asunto: 'A', texto: CUERPO.replace('vuestra tienda', '**vuestra tienda**'), angulo: 'seguimiento' }))?.texto.includes('**'))
  ok('quita «Asunto:» del asunto', leerBorrador(json({ asunto: 'Asunto: Amazon para Acme', texto: CUERPO, angulo: 'seguimiento' }))?.asunto === 'Amazon para Acme')
  ok('quita una línea «Asunto: …» al principio del cuerpo', !leerBorrador(json({ asunto: 'A', texto: `Asunto: Amazon\n\n${CUERPO}`, angulo: 'seguimiento' }))?.texto.toLowerCase().startsWith('asunto'))
  ok('quita las comillas alrededor del asunto', leerBorrador(json({ asunto: '«Amazon para Acme»', texto: CUERPO, angulo: 'seguimiento' }))?.asunto === 'Amazon para Acme')
  ok('un asunto en varias líneas se une', leerBorrador(json({ asunto: 'Amazon\npara Acme', texto: CUERPO, angulo: 'seguimiento' }))?.asunto === 'Amazon para Acme')
  ok('no es JSON: null', leerBorrador('esto no es json') === null)
  ok('vacío o undefined: null', leerBorrador('') === null && leerBorrador(null) === null && leerBorrador(undefined) === null)
  ok('sin texto: null', leerBorrador(json({ asunto: 'A', angulo: 'seguimiento' })) === null)
  ok('asunto vacío: null', leerBorrador(json({ asunto: '   ', texto: CUERPO, angulo: 'seguimiento' })) === null)
  ok('asunto larguísimo: null', leerBorrador(json({ asunto: 'x'.repeat(200), texto: CUERPO, angulo: 'seguimiento' })) === null)
  ok('un texto de tres palabras no es un correo: null', leerBorrador(json({ asunto: 'A', texto: 'Hola, ¿qué tal?', angulo: 'seguimiento' })) === null)
  ok('un texto de 5.000 caracteres no es un correo: null', leerBorrador(json({ asunto: 'A', texto: 'palabra '.repeat(700), angulo: 'seguimiento' })) === null)
}

console.log('\n=== revisarBorrador ===')
{
  const base = { asunto: 'Amazon para Acme', texto: CUERPO, angulo: 'seguimiento' as const }
  ok('un borrador limpio no tiene problemas', revisarBorrador(base).length === 0)
  ok('facturación en el texto', revisarBorrador({ ...base, texto: `${CUERPO}\n\nVuestra facturación actual es buena.` }).includes('dinero'))
  ok('una cifra de dinero en el texto', revisarBorrador({ ...base, texto: `${CUERPO}\n\nSupera los 20.000 € al mes.` }).includes('dinero'))
  ok('una cifra de dinero en el asunto', revisarBorrador({ ...base, asunto: 'De 14.000 € a 30.000 €/mes' }).includes('dinero'))
  ok('«Ingresa a Amazon» no es dinero', !revisarBorrador({ ...base, asunto: 'Ingresa a Amazon con Acme' }).includes('dinero'))
  ok('un hueco entre corchetes', revisarBorrador({ ...base, texto: `Hola [Nombre],\n\n${CUERPO}` }).includes('hueco'))
  ok('un campo de plantilla sin rellenar', revisarBorrador({ ...base, texto: `Hola {{nombre}},\n\n${CUERPO}` }).includes('hueco'))
  ok('un marcador entre ángulos', revisarBorrador({ ...base, texto: `${CUERPO}\n\n<comercial>` }).includes('hueco'))
  ok('demasiado largo', revisarBorrador({ ...base, texto: 'palabra '.repeat(200) }).includes('largo'))
  ok('el límite son 190 palabras', !revisarBorrador({ ...base, texto: 'palabra '.repeat(190) }).includes('largo') && palabrasDe('uno dos  tres\ncuatro') === 4)
}

console.log('\n=== construirMensajes ===')
{
  const entrada = { contexto: 'DATOS DE LA EMPRESA\n- Nombre comercial: Acme', ejemplos: [{ asunto: 'Asunto uno', texto: 'Cuerpo uno' }, { asunto: 'Asunto dos', texto: 'Cuerpo dos' }], indicaciones: null, anterior: null, miNombre: 'Ana López', tieneFirma: true }
  const m = construirMensajes(entrada)
  ok('el sistema son las instrucciones', m.system === INSTRUCCIONES)
  ok('lleva el contexto', m.usuario.includes('- Nombre comercial: Acme'))
  ok('numera los ejemplos y avisa de que son de otras empresas', m.usuario.includes('[Ejemplo 1]') && m.usuario.includes('[Ejemplo 2]') && m.usuario.includes('de otras empresas') && m.usuario.includes('Asunto: Asunto dos'))
  ok('con firma automática: no escribir el nombre', m.usuario.includes('se añade sola') && m.usuario.includes('NO escribas el nombre'))
  ok('sin indicaciones: «Ninguna.»', m.usuario.includes('INDICACIONES DEL COMERCIAL PARA ESTE CORREO\nNinguna.'))
  ok('sin borrador anterior no hay bloque de borrador', !m.usuario.includes('BORRADOR ANTERIOR'))

  const sinFirma = construirMensajes({ ...entrada, tieneFirma: false })
  ok('sin firma automática: firma con su nombre', sinFirma.usuario.includes('No hay firma automática') && sinFirma.usuario.includes('«Ana López»'))
  const sinNombre = construirMensajes({ ...entrada, tieneFirma: false, miNombre: null })
  ok('sin firma ni nombre: no inventa uno', sinNombre.usuario.includes('el comercial pondrá su nombre') && sinNombre.usuario.includes('Nombre: no consta'))

  const sinEjemplos = construirMensajes({ ...entrada, ejemplos: [] })
  ok('sin ejemplos no hay sección de ejemplos', !sinEjemplos.usuario.includes('EJEMPLOS'))

  const conIndicaciones = construirMensajes({ ...entrada, indicaciones: `  más corto ${'x'.repeat(900)} ` })
  const trozo = conIndicaciones.usuario.split('INDICACIONES DEL COMERCIAL PARA ESTE CORREO\n')[1].split('\n')[0]
  ok('las indicaciones se recortan a 600 caracteres', trozo.length === 600 && trozo.startsWith('más corto'), String(trozo.length))

  const conAnterior = construirMensajes({ ...entrada, anterior: { asunto: 'Asunto previo', texto: 'Cuerpo previo' } })
  ok('con borrador anterior se incluye', conAnterior.usuario.includes('BORRADOR ANTERIOR') && conAnterior.usuario.includes('Cuerpo previo'))
  ok('con borrador anterior y sin indicaciones, se pide mejorarlo sin cambiar lo que dice', conAnterior.usuario.includes('mejora este borrador'))
  const conAmbos = construirMensajes({ ...entrada, anterior: { asunto: 'A', texto: 'B' }, indicaciones: 'más corto' })
  ok('con indicaciones se usan ésas', conAmbos.usuario.includes('INDICACIONES DEL COMERCIAL PARA ESTE CORREO\nmás corto') && !conAmbos.usuario.includes('mejora este borrador'))
}

console.log('\n=== mensajeDeCorreccion ===')
{
  const m = mensajeDeCorreccion(['dinero', 'hueco'])
  ok('explica cada problema', m.includes('facturación') && m.includes('hueco por rellenar'))
  ok('pide el mismo formato', m.includes('mismo formato'))
  ok('un solo problema', mensajeDeCorreccion(['largo']).includes('150 palabras'))
}

console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
