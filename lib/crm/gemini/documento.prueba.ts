import {
  aplanarDocumento,
  fusionarNotas,
  idDelEventoDeUnEnlace,
  invitadosDe,
  leerDocumento,
  leerTituloDeDocumento,
  type ContenidoDeDocs,
  type DocumentoDeDocs,
  type ElementoDeDocs,
} from './documento'
import { leerCorreoDeGemini, type CorreoDeGemini } from './correo'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/* ---------- constructores de un documento con la forma de la API de Docs (todo INVENTADO: ningún texto de un cliente real) ---------- */

const t = (content: string, negrita = false, url?: string): ElementoDeDocs => ({
  textRun: { content, textStyle: { ...(negrita ? { bold: true } : {}), ...(url ? { link: { url } } : {}) } },
})
const persona = (email: string, name: string): ElementoDeDocs => ({ person: { personProperties: { email, name } } })
const enlaceRico = (uri: string, title: string): ElementoDeDocs => ({ richLink: { richLinkProperties: { uri, title } } })
const parrafo = (estilo: string, ...elements: ElementoDeDocs[]): ContenidoDeDocs => ({ paragraph: { paragraphStyle: { namedStyleType: estilo }, elements } })
const normal = (...elements: ElementoDeDocs[]) => parrafo('NORMAL_TEXT', ...elements)
const vineta = (...elements: ElementoDeDocs[]): ContenidoDeDocs => ({ paragraph: { paragraphStyle: { namedStyleType: 'NORMAL_TEXT' }, bullet: { nestingLevel: 0 }, elements } })

const ID_EVENTO = 'evt7k2m9x4p1q8w3z5n6b0c2d4'
const EID = Buffer.from(`${ID_EVENTO} business@libertyseller.com`).toString('base64').replace(/=+$/, '')
const URL_EVENTO = `https://calendar.google.com/calendar/event?eid=${EID}`
const URL_NOTAS = 'https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-aBcD/edit?usp=meet_tnfm_calendar'
const TITULO_REUNION = 'Consultoría Estratégica Amazon · Liberty Seller · LAURA GOMEZ (Socia única)'
const NOMBRE = `${TITULO_REUNION} - 2026/10/20 10:02 CEST - Notas de Gemini`

const PESTANA_NOTAS: ContenidoDeDocs[] = [
  parrafo('HEADING_1', t(`${TITULO_REUNION}\n`)),
  normal(t('Invitado ', true), persona('laura@cosmeticaejemplo.com', 'Laura Gomez'), t(' '), persona('Raul@LibertySeller.com', 'Raúl'), t('\n')),
  normal(t('Archivos adjuntos ', true), enlaceRico(URL_EVENTO, TITULO_REUNION), t(' '), enlaceRico(URL_NOTAS, 'Notas de Gemini'), t('\n')),
  parrafo('HEADING_2', t('Resumen\n')),
  normal(t('Evaluación de una tienda de cosmética y viabilidad de expandirse a Europa.\n')),
  normal(t('Análisis de tienda actual', true), t(' Negocio rentable pero con márgenes ajustados por la publicidad.\n')),
  normal(t('Modelos de servicio', true), t(' La agencia ofrece asociación en Estados Unidos y mentoría en España.\n')),
  parrafo('HEADING_2', t('Decisiones\n')),
  vineta(t('Se hará una prueba de tres meses en Estados Unidos.\n')),
  parrafo('HEADING_3', t('Requiere más debate\n')),
  vineta(t('Si la inversión en inventario se hace en una o dos remesas.\n')),
  parrafo('HEADING_2', t('Próximos pasos\n')),
  vineta(t('[Liberty Seller] Consultar tarifas: Revisar con el equipo la disponibilidad.\n')),
  vineta(t('[Laura Gomez] Evaluar propuestas: Analizar las dos opciones y decidir.\n')),
  vineta(t('[El grupo] Retomar discusión\n')),
  parrafo('HEADING_2', t('Detalles\n')),
  normal(t('Análisis de tienda actual', true), t(' La tienda factura unos 20.000 € al mes y deja poco margen por la publicidad (ACOS alto).\n')),
  normal(t('----------\n')),
  normal(t('Modelos de servicio', true), t(' Se explican los dos modelos: asociación con inversión de inventario y mentoría puntual.\n')),
]

const PESTANA_TRANSCRIPCION: ContenidoDeDocs[] = [
  parrafo('HEADING_1', t(`${TITULO_REUNION} - Transcripción\n`)),
  parrafo('HEADING_3', t('00:00:00\n')),
  normal(t('Liberty Seller:', true), t(' Hola Laura, ¿qué tal?\n')),
  normal(t('Laura Gomez:', true), t(' Muy bien, gracias.\n')),
  parrafo('HEADING_3', t('00:01:12\n')),
  normal(t('Laura Gomez:', true), t(' Facturamos unos veinte mil euros al mes.\n')),
  normal(t('La transcripción finalizó después de 00:38:00\n')),
]

const DOC: DocumentoDeDocs = {
  title: NOMBRE,
  tabs: [
    { tabProperties: { title: 'Notas' }, documentTab: { body: { content: PESTANA_NOTAS } } },
    { tabProperties: { title: 'Transcripción' }, documentTab: { body: { content: PESTANA_TRANSCRIPCION } } },
  ],
}

console.log('\n=== el nombre del documento: título y hora de inicio ===')
{
  const a = leerTituloDeDocumento(NOMBRE)
  ok('el título, sin la hora ni «Notas de Gemini»', a.titulo === TITULO_REUNION, a.titulo)
  ok('las 10:02 de España en octubre (CEST) son las 08:02 UTC', a.inicio === '2026-10-20T08:02:00.000Z', String(a.inicio))
  ok('en invierno (CET) son una hora menos', leerTituloDeDocumento('Reunión - 2026/11/03 16:30 CET - Notas de Gemini').inicio === '2026-11-03T15:30:00.000Z')
  ok('un título con guiones no se confunde con la hora', leerTituloDeDocumento('Consultoría - Liberty Seller - Ana - 2026/10/20 10:02 CEST - Notas de Gemini').titulo === 'Consultoría - Liberty Seller - Ana')
  ok('con huso «GMT-5»', leerTituloDeDocumento('X - 2026/10/20 10:02 GMT-5 - Notas de Gemini').inicio === '2026-10-20T15:02:00.000Z')
  ok('con huso «GMT+5:30»', leerTituloDeDocumento('X - 2026/10/20 10:02 GMT+5:30 - Notas de Gemini').inicio === '2026-10-20T04:32:00.000Z')
  ok('con huso «GMT-3:30»', leerTituloDeDocumento('X - 2026/10/20 10:02 GMT-3:30 - Notas de Gemini').inicio === '2026-10-20T13:32:00.000Z')
  ok('«GMT» a secas es UTC', leerTituloDeDocumento('X - 2026/10/20 10:02 GMT - Notas de Gemini').inicio === '2026-10-20T10:02:00.000Z')
  ok('en inglés', leerTituloDeDocumento('Call - 2026/10/20 10:02 CEST - Notes by Gemini').titulo === 'Call')
  const sin = leerTituloDeDocumento('Reunión del 23 oct 2026 a las 12:03 PM CEST - Notas de Gemini')
  ok('una reunión sin título: el nombre sin «Notas de Gemini» y sin hora que leer', sin.titulo === 'Reunión del 23 oct 2026 a las 12:03 PM CEST' && sin.inicio === null)
  ok('un nombre cualquiera es el título', leerTituloDeDocumento('Apuntes sueltos').titulo === 'Apuntes sueltos' && leerTituloDeDocumento('Apuntes sueltos').inicio === null)
  ok('una fecha imposible no revienta: sin hora', leerTituloDeDocumento('X - 2026/13/45 10:02 CEST - Notas de Gemini').inicio === null)
}

console.log('\n=== el enlace al evento ===')
{
  ok('saca el id del evento (el de appointments.google_event_id)', idDelEventoDeUnEnlace(URL_EVENTO) === ID_EVENTO, String(idDelEventoDeUnEnlace(URL_EVENTO)))
  ok('con más parámetros detrás', idDelEventoDeUnEnlace(`${URL_EVENTO}&ctz=Europe%2FMadrid`) === ID_EVENTO)
  ok('desde www.google.com también', idDelEventoDeUnEnlace(`https://www.google.com/calendar/event?eid=${EID}`) === ID_EVENTO)
  ok('un base64 con relleno vale igual', idDelEventoDeUnEnlace(`https://calendar.google.com/calendar/event?eid=${Buffer.from(`${ID_EVENTO} x@y.com`).toString('base64')}`) === ID_EVENTO)
  ok('el enlace al documento no es un evento', idDelEventoDeUnEnlace(URL_NOTAS) === null)
  ok('un enlace de calendario sin eid, tampoco', idDelEventoDeUnEnlace('https://calendar.google.com/calendar/u/0/r') === null)
  ok('un eid que no es base64 de un id, tampoco', idDelEventoDeUnEnlace('https://calendar.google.com/calendar/event?eid=%FF%FE%00') === null)
  ok('algo que no es un enlace: null y sin reventar', idDelEventoDeUnEnlace('no es un enlace') === null && idDelEventoDeUnEnlace('') === null)
  ok('otro dominio con la misma forma no vale', idDelEventoDeUnEnlace(`https://calendar.google.com.otra.es/calendar/event?eid=${EID}`) === null)
}

console.log('\n=== los invitados ===')
{
  ok('quita los del equipo, pasa a minúsculas y no repite', JSON.stringify(invitadosDe(['Laura@X.com', 'raul@libertyseller.com', 'laura@x.com', '<ana@y.es>'])) === JSON.stringify(['laura@x.com', 'ana@y.es']), JSON.stringify(invitadosDe(['Laura@X.com', 'raul@libertyseller.com', 'laura@x.com', '<ana@y.es>'])))
  ok('lo que no es un correo se ignora', invitadosDe(['Laura', '', 'a@b']).length === 0)
  ok('otros dominios propios, si se pasan', invitadosDe(['a@mia.com', 'b@otra.com'], ['mia.com']).join() === 'b@otra.com')
}

console.log('\n=== el árbol de la API, aplanado ===')
{
  const a = aplanarDocumento(DOC)
  ok('dos pestañas y el nombre', a.pestanas.length === 2 && a.titulo === NOMBRE)
  ok('el título de cada pestaña', a.pestanas[0].titulo === 'Notas' && a.pestanas[1].titulo === 'Transcripción')
  const inv = a.pestanas[0].parrafos[1]
  ok('«Invitado» lleva los dos chips de persona', inv.correos.length === 2 && inv.correos[1] === 'raul@libertyseller.com' && inv.texto.startsWith('Invitado'), JSON.stringify(inv.correos))
  const adj = a.pestanas[0].parrafos[2]
  ok('los enlaces ricos se recogen', adj.enlaces.length === 2 && adj.enlaces[0] === URL_EVENTO)
  const tema = a.pestanas[0].parrafos[5]
  ok('el principio en negrita se separa del resto', tema.negrita === 'Análisis de tienda actual' && tema.resto.startsWith('Negocio rentable'), JSON.stringify([tema.negrita, tema.resto]))
  ok('un titular de sección tiene su estilo', a.pestanas[0].parrafos[3].estilo === 'h2' && a.pestanas[0].parrafos[3].texto === 'Resumen')
  ok('una viñeta se marca como lista', a.pestanas[0].parrafos[8].lista)
  ok('el hablante de la transcripción va en negrita sin los dos puntos', a.pestanas[1].parrafos[2].negrita === 'Liberty Seller' && a.pestanas[1].parrafos[2].resto === 'Hola Laura, ¿qué tal?')

  const sinPestanas = aplanarDocumento({ title: 'X', body: { content: [normal(t('Hola\n'))] } })
  ok('un documento sin pestañas (el formato antiguo) se lee igual', sinPestanas.pestanas.length === 1 && sinPestanas.pestanas[0].parrafos[0].texto === 'Hola')

  const anidada = aplanarDocumento({ tabs: [{ tabProperties: { title: 'A' }, documentTab: { body: { content: [normal(t('a\n'))] } }, childTabs: [{ tabProperties: { title: 'B' }, documentTab: { body: { content: [normal(t('b\n'))] } } }] }] })
  ok('las pestañas hijas también', anidada.pestanas.length === 2 && anidada.pestanas[1].titulo === 'B')

  const tabla = aplanarDocumento({ body: { content: [{ table: { tableRows: [{ tableCells: [{ content: [normal(t('celda 1\n'))] }, { content: [normal(t('celda 2\n'))] }] }] } }] } })
  ok('el texto de una tabla no se pierde', tabla.pestanas[0].parrafos.map((p) => p.texto).join('|') === 'celda 1|celda 2')

  const todoNegrita = aplanarDocumento({ body: { content: [normal(t('Un titular suelto\n', true))] } }).pestanas[0].parrafos[0]
  ok('un párrafo entero en negrita no tiene «principio»: es un titular', todoNegrita.negrita === null && todoNegrita.soloNegrita && todoNegrita.texto === 'Un titular suelto')

  const saltoSuave = aplanarDocumento({ body: { content: [normal(t('Tema', true), t('\u000bTexto del tema\n'))] } }).pestanas[0].parrafos[0]
  ok('un salto de línea suave tras el título se queda como salto y el título se separa', saltoSuave.negrita === 'Tema' && saltoSuave.resto === 'Texto del tema', JSON.stringify([saltoSuave.negrita, saltoSuave.resto]))
}

console.log('\n=== el documento entero ===')
{
  const n = leerDocumento(DOC, 'drive-1')
  ok('sale una nota', n !== null)
  if (n) {
    ok('el título, sin la hora', n.titulo === TITULO_REUNION, n.titulo)
    ok('la hora de inicio de verdad', n.fechaReunion === '2026-10-20T08:02:00.000Z', String(n.fechaReunion))
    ok('el id del documento es el que se pasa', n.driveFileId === 'drive-1')
    ok('el id del evento sale del enlace de «Archivos adjuntos»', n.googleEventId === ID_EVENTO, String(n.googleEventId))
    ok('el invitado es el lead, sin el correo del equipo', JSON.stringify(n.invitados) === JSON.stringify(['laura@cosmeticaejemplo.com']), JSON.stringify(n.invitados))
    ok('el resumen es la frase de debajo de «Resumen»', n.resumen === 'Evaluación de una tienda de cosmética y viabilidad de expandirse a Europa.', String(n.resumen))
    ok('dos temas con su título y su texto', n.temas.length === 2 && n.temas[0].titulo === 'Análisis de tienda actual' && n.temas[0].texto === 'Negocio rentable pero con márgenes ajustados por la publicidad.' && n.temas[1].titulo === 'Modelos de servicio', JSON.stringify(n.temas))
    ok('tres próximos pasos', n.proximosPasos.length === 3 && n.proximosPasos[0].quien === 'Liberty Seller' && n.proximosPasos[0].que === 'Consultar tarifas' && n.proximosPasos[2].detalle === null, JSON.stringify(n.proximosPasos))
    ok('el detalle trae las decisiones, lo que requiere debate y los detalles', !!n.detalle && n.detalle.includes('## Decisiones') && n.detalle.includes('- Se hará una prueba de tres meses') && n.detalle.includes('### Requiere más debate') && n.detalle.includes('## Detalles'), String(n.detalle))
    ok('en el detalle, el título de cada tema va en negrita', !!n.detalle && n.detalle.includes('**Análisis de tienda actual** La tienda factura unos 20.000 €'))
    ok('y las rayas de separación no se cuelan', !!n.detalle && !n.detalle.includes('----------'))
    ok('el orden: decisiones antes que detalles', !!n.detalle && n.detalle.indexOf('## Decisiones') < n.detalle.indexOf('## Detalles'))
    ok('la transcripción lleva el minuto y quién habla', !!n.transcripcion && n.transcripcion.includes('[00:01:12]') && n.transcripcion.includes('Laura Gomez: Facturamos unos veinte mil euros al mes.') && n.transcripcion.includes('Liberty Seller: Hola Laura'), String(n.transcripcion))
    ok('sin el título repetido de la pestaña', !!n.transcripcion && !n.transcripcion.includes('- Transcripción'))
    ok('el cierre de la transcripción se conserva', !!n.transcripcion && n.transcripcion.includes('La transcripción finalizó después de 00:38:00'))
    ok('es una nota completa y todavía sin correo', n.completa && n.gmailMessageId === null)
  }
}

console.log('\n=== documentos incompletos ===')
{
  const sinTranscripcion = leerDocumento({ title: NOMBRE, tabs: [{ tabProperties: { title: 'Notas' }, documentTab: { body: { content: PESTANA_NOTAS } } }] }, 'd')
  ok('sin pestaña de transcripción: la nota sale, sin transcripción', sinTranscripcion !== null && sinTranscripcion.transcripcion === null && sinTranscripcion.temas.length === 2)

  const unaSolaPestanaSinNombre = leerDocumento({ title: NOMBRE, tabs: [{ documentTab: { body: { content: PESTANA_NOTAS } } }] }, 'd')
  ok('una pestaña sin nombre se toma por la de notas', unaSolaPestanaSinNombre !== null && unaSolaPestanaSinNombre.resumen !== null)

  const sinEnlaceDeEvento = leerDocumento({ title: NOMBRE, tabs: [{ tabProperties: { title: 'Notas' }, documentTab: { body: { content: PESTANA_NOTAS.filter((_, i) => i !== 2) } } }] }, 'd')
  ok('sin el enlace al evento: googleEventId null, pero se sabe el invitado', sinEnlaceDeEvento !== null && sinEnlaceDeEvento.googleEventId === null && sinEnlaceDeEvento.invitados.length === 1)

  const sinDecisiones = leerDocumento({ title: NOMBRE, tabs: [{ tabProperties: { title: 'Notas' }, documentTab: { body: { content: PESTANA_NOTAS.filter((_, i) => i < 7 || i > 10) } } }] }, 'd')
  ok('sin «Decisiones»: el detalle son solo los detalles', sinDecisiones !== null && !!sinDecisiones.detalle && !sinDecisiones.detalle.includes('## Decisiones') && sinDecisiones.detalle.includes('## Detalles'))

  const correoEscritoAMano = leerDocumento({ title: NOMBRE, tabs: [{ tabProperties: { title: 'Notas' }, documentTab: { body: { content: [parrafo('HEADING_1', t('X\n')), normal(t('Invitado ana@empresa.es, raul@libertyseller.com\n')), parrafo('HEADING_2', t('Resumen\n')), normal(t('Algo.\n'))] } } }] }, 'd')
  ok('un correo escrito a mano en la cabecera también cuenta como invitado', correoEscritoAMano !== null && correoEscritoAMano.invitados.join() === 'ana@empresa.es', JSON.stringify(correoEscritoAMano?.invitados))

  const tituloSuelto = leerDocumento({ title: NOMBRE, tabs: [{ tabProperties: { title: 'Notas' }, documentTab: { body: { content: [parrafo('HEADING_2', t('Resumen\n')), normal(t('Algo.\n')), normal(t('Tema uno\n', true)), normal(t('Texto del tema uno.\n')), normal(t('Tema dos\n', true)), normal(t('Texto del tema dos.\n'))] } } }] }, 'd')
  ok('el título del tema en su propio párrafo y el texto debajo: también se casan', tituloSuelto !== null && tituloSuelto.resumen === 'Algo.' && tituloSuelto.temas.length === 2 && tituloSuelto.temas[1].titulo === 'Tema dos' && tituloSuelto.temas[1].texto === 'Texto del tema dos.', JSON.stringify(tituloSuelto?.temas))

  ok('un documento vacío no es una nota', leerDocumento({ title: NOMBRE, tabs: [{ tabProperties: { title: 'Notas' }, documentTab: { body: { content: [] } } }] }, 'd') === null && leerDocumento({}, 'd') === null)
  ok('sin ningún título en ninguna parte, tampoco', leerDocumento({ tabs: [{ tabProperties: { title: 'Notas' }, documentTab: { body: { content: [parrafo('HEADING_2', t('Resumen\n')), normal(t('Algo.\n'))] } } }] }, 'd') === null)
  ok('con el título solo en la pestaña (el nombre sin formato)', leerDocumento({ title: 'Notas', tabs: [{ tabProperties: { title: 'Notas' }, documentTab: { body: { content: [parrafo('HEADING_1', t('Llamada con Ana\n')), parrafo('HEADING_2', t('Resumen\n')), normal(t('Algo.\n'))] } } }] }, 'd')?.titulo === 'Notas')

  const largo = 'palabra '.repeat(40_000)
  const conTranscripcionLarga = leerDocumento({ title: NOMBRE, tabs: [{ tabProperties: { title: 'Notas' }, documentTab: { body: { content: PESTANA_NOTAS } } }, { tabProperties: { title: 'Transcripción' }, documentTab: { body: { content: [normal(t('Ana:', true), t(` ${largo}\n`))] } } }] }, 'd')
  ok('una transcripción enorme se recorta (tope de 200.000 caracteres)', !!conTranscripcionLarga?.transcripcion && conTranscripcionLarga.transcripcion.length < 200_100 && conTranscripcionLarga.transcripcion.endsWith('[…recortada…]'))
}

console.log('\n=== juntar el correo con el documento ===')
{
  const CORREO: CorreoDeGemini = {
    id: 'msg-9',
    asunto: 'Notas: Consultoría Estratégica Amazon · Liberty Seller · LAURA GOMEZ (Socia única) 20 oct 2026',
    remitente: 'gemini-notes@google.com',
    recibidoMs: Date.parse('2026-10-20T08:54:44Z'),
    texto: 'Resumen\n\nUna frase del correo.\n\nPasos siguientes recomendados\n\n[Ana] Hacer algo: Con detalle',
    html: '<a href="https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-aBcD/edit">Abrir</a>',
  }
  const delCorreo = leerCorreoDeGemini(CORREO)!
  const delDocumento = leerDocumento(DOC, '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-aBcD')!
  const junta = fusionarNotas(delCorreo, delDocumento)
  ok('conserva el id del correo y gana el documento en todo lo que trae', junta.gmailMessageId === 'msg-9' && junta.driveFileId === delDocumento.driveFileId && junta.googleEventId === ID_EVENTO && junta.invitados.length === 1 && junta.completa)
  ok('la hora de inicio es la del documento, no la de llegada del correo', junta.fechaReunion === '2026-10-20T08:02:00.000Z')
  ok('el detalle y la transcripción vienen del documento', !!junta.detalle && !!junta.transcripcion)
  ok('el resumen es el del documento', junta.resumen === delDocumento.resumen)
  ok('sin documento, se queda el correo entero (incompleta)', fusionarNotas(delCorreo, null) === delCorreo && !fusionarNotas(delCorreo, null).completa)

  const documentoSinHora = leerDocumento({ ...DOC, title: 'Llamada con Ana' }, 'x')!
  const sinHora = fusionarNotas(delCorreo, documentoSinHora)
  ok('si el documento no sabe cuándo empezó, queda la hora de llegada del correo', sinHora.fechaReunion === delCorreo.fechaReunion)
  const documentoSinPasos = { ...delDocumento, proximosPasos: [], temas: [], resumen: null }
  const mezcla = fusionarNotas(delCorreo, documentoSinPasos)
  ok('si el documento viene sin resumen ni pasos, se aprovechan los del correo', mezcla.resumen === 'Una frase del correo.' && mezcla.proximosPasos.length === 1)
}

console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
