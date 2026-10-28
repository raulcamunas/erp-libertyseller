import {
  ANGULOS,
  CLAVES_DE_SECCION,
  ESQUEMA_BORRADOR,
  INSTRUCCIONES,
  PRESENTACION_FIJA,
  REGLAS_FIJAS,
  REGLA_DE_INDICACIONES,
  SECCIONES_BASE,
  SECCIONES_DE_LA_VERSION,
  compilarInstrucciones,
  construirMensajes,
  leerBorrador,
  mensajeDeCorreccion,
  palabrasDe,
  revisarBorrador,
  validarSecciones,
} from '@/lib/correo/ia-prompt'

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
ok('las instrucciones traen los principios de persuasión y los limitan a lo verdadero', INSTRUCCIONES.includes('CÓMO PERSUADES') && INSTRUCCIONES.includes('Curiosidad') && INSTRUCCIONES.includes('Prueba social solo si es REAL') && INSTRUCCIONES.includes('Nunca inventes clientes'))
ok('el cierre es una pregunta de dos opciones y se sigue tuteando', INSTRUCCIONES.includes('esta semana o la próxima') && INSTRUCCIONES.includes('Tuteas a la persona'))
ok('las instrucciones explican el seguimiento y el «no le interesa»', INSTRUCCIONES.includes('SEGUIMIENTO') && INSTRUCCIONES.includes('No le interesa'))
ok('el esquema es estricto: sin campos de más y todos obligatorios', ESQUEMA_BORRADOR.additionalProperties === false && JSON.stringify([...ESQUEMA_BORRADOR.required].sort()) === JSON.stringify(Object.keys(ESQUEMA_BORRADOR.properties).sort()))
ok('los ángulos del esquema son los de ANGULOS', JSON.stringify(ESQUEMA_BORRADOR.properties.angulo.enum) === JSON.stringify([...ANGULOS]))

console.log('\n=== leerBorrador ===')
{
  const b = leerBorrador(json({ asunto: '  Amazon para Acme  ', texto: CUERPO, angulo: 'seguimiento' }))
  ok('un borrador bueno se lee', !!b && b.asunto === 'Amazon para Acme' && b.angulo === 'seguimiento' && b.texto.startsWith('Hola,'))
  ok('un ángulo desconocido pasa a «mejorar_cuenta»', leerBorrador(json({ asunto: 'A', texto: CUERPO, angulo: 'inventado' }))?.angulo === 'mejorar_cuenta')
  ok('quita las negritas de markdown', !leerBorrador(json({ asunto: 'A', texto: CUERPO.replace('vuestra tienda', '**vuestra tienda**'), angulo: 'seguimiento' }))?.texto.includes('**'))
  const saludo = (primera: string) => leerBorrador(json({ asunto: 'A', texto: `${primera}\n\n${CUERPO}`, angulo: 'seguimiento' }))?.texto.split('\n')[0]
  ok('«Hola Acme:» pasa a «Hola Acme,» (los dos puntos del saludo eran de los fallos más repetidos)', saludo('Hola Acme:') === 'Hola Acme,' && saludo('Hola Suministros Lavin:') === 'Hola Suministros Lavin,' && saludo('Hola, equipo de Punto Jardín:') === 'Hola, equipo de Punto Jardín,')
  ok('un saludo que ya lleva coma o punto no se toca', saludo('Hola Acme,') === 'Hola Acme,' && saludo('Hola,') === 'Hola,' && saludo('Hola, TPB.') === 'Hola, TPB.')
  ok('solo se toca la PRIMERA línea y solo si es un saludo', leerBorrador(json({ asunto: 'A', texto: `${CUERPO}\nHola equipo:\nOtra cosa`, angulo: 'seguimiento' }))?.texto.includes('Hola equipo:') === true && saludo('Estimado don Manuel:') === 'Estimado don Manuel:')
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

console.log('\n=== las instrucciones en piezas ===')
{
  ok('la versión original compila a las instrucciones de siempre', compilarInstrucciones(SECCIONES_BASE) === INSTRUCCIONES)
  ok('las cinco secciones se enseñan en el editor, en orden', SECCIONES_DE_LA_VERSION.map((x) => x.clave).join() === CLAVES_DE_SECCION.join() && SECCIONES_DE_LA_VERSION.every((x) => x.titulo && x.ayuda && x.filas > 0))
  ok('la sección «extra» de la original está vacía', SECCIONES_BASE.extra === '')

  const vacia = compilarInstrucciones({ queHacemos: '', comoEscribes: '', comoPersuades: '', segunElCaso: '', extra: '' })
  ok('con todo vacío siguen la presentación y las reglas fijas', vacia.includes(PRESENTACION_FIJA) && vacia.includes(REGLAS_FIJAS) && vacia.includes(REGLA_DE_INDICACIONES))
  ok('las reglas fijas dicen lo de la facturación', REGLAS_FIJAS.includes('NUNCA menciones facturación') && REGLAS_FIJAS.includes('No inventes'))

  const mia = compilarInstrucciones({ ...SECCIONES_BASE, comoEscribes: 'CÓMO ESCRIBES:\n- Trata de usted.', extra: 'Menciona siempre que la primera reunión es gratuita.' })
  ok('lo que se edita entra', mia.includes('Trata de usted.') && !mia.includes('Tuteas a la persona'))
  ok('lo que NO se edita sigue', mia.includes(REGLAS_FIJAS) && mia.includes(PRESENTACION_FIJA))
  ok('«extra» va en su bloque, después de «según el caso»', mia.indexOf('SEGÚN EL CASO') < mia.indexOf('INSTRUCCIONES ADICIONALES DE ESTA VERSIÓN') && mia.includes('valen mientras no contradigan'))
  ok('las reglas fijas van antes que «según el caso» (como siempre)', mia.indexOf('LO QUE NUNCA HACES') < mia.indexOf('SEGÚN EL CASO'))
  ok('si el editor intenta ocultar las reglas poniendo su propio texto, las reglas siguen una sola vez', (mia.match(/LO QUE NUNCA HACES:/g) ?? []).length === 1)
  ok('sin «extra» no hay bloque extra', !compilarInstrucciones(SECCIONES_BASE).includes('INSTRUCCIONES ADICIONALES'))

  const m = construirMensajes({ instrucciones: 'MIS INSTRUCCIONES', contexto: 'C', ejemplos: [], indicaciones: null, anterior: null, miNombre: null, tieneFirma: false })
  ok('construirMensajes usa las instrucciones de la versión', m.system === 'MIS INSTRUCCIONES')
  ok('y las de siempre si no se le pasan', construirMensajes({ contexto: 'C', ejemplos: [], indicaciones: null, anterior: null, miNombre: null, tieneFirma: false }).system === INSTRUCCIONES)
}

console.log('\n=== validarSecciones ===')
{
  const buenas = validarSecciones({ ...SECCIONES_BASE })
  ok('las originales valen y no traen avisos', buenas.ok && buenas.avisos.length === 0)
  ok('devuelve solo las cinco claves, recortadas', buenas.ok && Object.keys(buenas.secciones).join() === CLAVES_DE_SECCION.join())
  const sucia = validarSecciones({ ...SECCIONES_BASE, extra: '  \r\n algo   ', sobrante: 'x' })
  ok('recorta y normaliza, y ignora claves de más', sucia.ok && sucia.secciones.extra === 'algo' && !('sobrante' in sucia.secciones))
  ok('sin objeto o con algo que no es texto: error', !validarSecciones(null).ok && !validarSecciones('x').ok && !validarSecciones({ ...SECCIONES_BASE, extra: 5 }).ok)
  const corta = validarSecciones({ queHacemos: 'poco', comoEscribes: '', comoPersuades: '', segunElCaso: '', extra: '' })
  ok('demasiado corto: error que lo explica', !corta.ok && /demasiado cortas/.test(corta.error))
  const larga = validarSecciones({ ...SECCIONES_BASE, extra: 'x'.repeat(5001) })
  ok('una sección larguísima: error con su nombre', !larga.ok && /Instrucciones extra/.test(larga.error) && /demasiado larga/.test(larga.error))
  const todoLargo = validarSecciones({ queHacemos: 'x'.repeat(4900), comoEscribes: 'x'.repeat(4900), comoPersuades: 'x'.repeat(4900), segunElCaso: '', extra: '' })
  ok('todas juntas pasando el tope: error', !todoLargo.ok && /juntas/.test(todoLargo.error))
  const dinero = validarSecciones({ ...SECCIONES_BASE, extra: 'Menciona la facturación estimada de la empresa para dar credibilidad.' })
  ok('pedir hablar de dinero se guarda pero avisa', dinero.ok && dinero.avisos.length === 1 && /regla que no se puede quitar/.test(dinero.avisos[0]))
  const inventa = validarSecciones({ ...SECCIONES_BASE, extra: 'Inventa un caso de éxito de un cliente parecido.' })
  ok('pedir inventar avisa', inventa.ok && inventa.avisos.some((a) => /inventar/.test(a)))
  const normal = validarSecciones({ ...SECCIONES_BASE, extra: 'Dile que la reunión no cuesta nada y que hablamos de ventas en Amazon en general.' })
  ok('hablar de «ventas en Amazon» en general no es pedir facturación', normal.ok && normal.avisos.length === 0, JSON.stringify(normal))
}

console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
