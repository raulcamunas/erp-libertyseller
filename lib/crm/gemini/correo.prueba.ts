import {
  docIdDelCorreo,
  esCorreoDeGemini,
  esReunionConCliente,
  esReunionSinTitulo,
  htmlATexto,
  leerCorreoDeGemini,
  leerCuerpo,
  leerPaso,
  nombreDelTitulo,
  tituloDeLaReunion,
  type CorreoDeGemini,
} from './correo'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

// Un correo INVENTADO con la forma exacta de los de gemini-notes@google.com (texto plano partido a ~80 columnas, y el HTML con el enlace al documento)
const TEXTO = `Notas de Consultoría Estratégica Amazon · Liberty Seller · LAURA GOMEZ
(Socia única)

Estas notas se han enviado a los invitados de tu organización.

Abrir notas de la reunión

El contenido se generó automáticamente el October 20, 2026, 10:53 AM CEST y
puede contener errores.

Resumen

Evaluación de tienda de cosmética y viabilidad de expansión a Europa con
análisis de rentabilidad y modelos de asociación

Análisis de tienda actual
Negocio rentable pero con márgenes reducidos por la publicidad. Expandirse a
Europa requiere mayor facturación.

Modelos de servicio
Agencia ofrece asociación en Estados Unidos y mentoría en España. Se
requiere inversión de 10000 dólares para inventario.

Pasos siguientes recomendados

[Liberty Seller] Consultar tarifas asesoría: Consultar con el equipo la
disponibilidad y las tarifas para un servicio de asesoría personalizada.

[laura gomez] Evaluar propuestas: Analizar las 2 opciones de negocio
propuestas y tomar una decisión.

[El grupo] Retomar discusión

Registros de la reunión Documento Notas de Gemini

¿Te ha resultado útil el contenido de este correo?
Correo no útil Correo útil

Google LLC, 1600 Ampitheatre Parkway, Mountain View, CA 94043, USA`

const HTML = `<div><a href="https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-aBcD/edit?usp=meet_tnfm_email&tab=t.l1g6hnqrmv11" class="link-button"><span>Abrir notas de la reunión</span></a></div>
<style>.x { color: red }</style><p><strong>Análisis</strong><br>Texto &amp; m&aacute;s</p>`

const CORREO: CorreoDeGemini = {
  id: 'msg-1',
  asunto: 'Notas: Consultoría Estratégica Amazon · Liberty Seller · LAURA GOMEZ (Socia única) 20 oct 2026',
  remitente: 'gemini-notes@google.com',
  recibidoMs: Date.parse('2026-10-20T08:54:44Z'),
  texto: TEXTO,
  html: HTML,
}

console.log('\n=== de quién es el correo ===')
{
  ok('gemini-notes@google.com', esCorreoDeGemini('gemini-notes@google.com'))
  ok('con nombre delante y en mayúsculas', esCorreoDeGemini('Gemini <Gemini-Notes@Google.com>'))
  ok('cualquier otro remitente, no', !esCorreoDeGemini('ana@empresa.com') && !esCorreoDeGemini('noreply@google.com'))
}

console.log('\n=== el título de la reunión ===')
{
  ok('sin «Notas: » y sin la fecha corta del final', tituloDeLaReunion(CORREO.asunto) === 'Consultoría Estratégica Amazon · Liberty Seller · LAURA GOMEZ (Socia única)', tituloDeLaReunion(CORREO.asunto))
  ok('una reunión sin título conserva su «del 23 oct 2026 a las 12:03 PM CEST» (no acaba en fecha)', tituloDeLaReunion('Notas: Reunión del 23 oct 2026 a las 12:03 PM CEST') === 'Reunión del 23 oct 2026 a las 12:03 PM CEST')
  ok('en inglés también', tituloDeLaReunion('Notes: Strategy call · Ana 5 Oct 2026') === 'Strategy call · Ana')
  ok('la fecha con «sept» y con punto', tituloDeLaReunion('Notas: Consultoría 3 sept. 2026') === 'Consultoría')
  ok('un título con un número suelto no se confunde con una fecha', tituloDeLaReunion('Notas: Reunión Semanal | Worldtenda 20 oct 2026') === 'Reunión Semanal | Worldtenda')
}

console.log('\n=== qué reuniones son con clientes ===')
{
  ok('la cita del ERP, sí', esReunionConCliente('Consultoría Estratégica Amazon · Liberty Seller · LAURA GOMEZ'))
  ok('aunque falten las tildes o cambie el punto medio', esReunionConCliente('Consultoria Estrategica Amazon - Liberty Seller - Ana') && esReunionConCliente('Consultoría Estratégica Amazon | Liberty Seller | Ana'))
  ok('una reunión interna, no', !esReunionConCliente('Reunión Semanal | Comerciales Liberty Seller') && !esReunionConCliente('Unbording Jhanna') && !esReunionConCliente('Reunión del 23 oct 2026 a las 12:03 PM CEST'))
  ok('el nombre del cliente sale del título, sin «(Socia única)»', nombreDelTitulo('Consultoría Estratégica Amazon · Liberty Seller · LAURA GOMEZ (Socia única)') === 'LAURA GOMEZ')
  ok('con un título que no es de cita, el nombre es el título entero', nombreDelTitulo('Llamada con Ana') === 'Llamada con Ana')
}

console.log('\n=== reuniones sin título ===')
{
  ok('«Reunión del 23 oct 2026 a las 12:03 PM CEST»', esReunionSinTitulo('Reunión del 23 oct 2026 a las 12:03 PM CEST'))
  ok('sin tilde y con punto en el mes', esReunionSinTitulo('Reunion del 3 sept. 2026 a las 9:05 AM CEST'))
  ok('en inglés', esReunionSinTitulo('Meeting on 23 Oct 2026 at 12:03 PM CEST'))
  ok('una reunión con título, no (ni interna ni de cliente)', !esReunionSinTitulo('Reunión Semanal | Comerciales Liberty Seller') && !esReunionSinTitulo('Consultoría Estratégica Amazon · Liberty Seller · Ana') && !esReunionSinTitulo('Unbording Jhanna'))
}

console.log('\n=== el enlace al documento ===')
{
  ok('sale del HTML', docIdDelCorreo(HTML) === '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-aBcD', String(docIdDelCorreo(HTML)))
  ok('sin enlace, null', docIdDelCorreo('<p>nada</p>') === null && docIdDelCorreo('') === null)
}

console.log('\n=== los pasos siguientes ===')
{
  const p = leerPaso('[Liberty Seller] Consultar tarifas asesoría: Consultar con el equipo la disponibilidad.')
  ok('quién, tarea y detalle', p?.quien === 'Liberty Seller' && p.que === 'Consultar tarifas asesoría' && p.detalle === 'Consultar con el equipo la disponibilidad.', JSON.stringify(p))
  const q = leerPaso('[El grupo] Retomar discusión')
  ok('sin detalle: la tarea y ya', q?.quien === 'El grupo' && q.que === 'Retomar discusión' && q.detalle === null)
  const r = leerPaso('Llamar mañana')
  ok('sin corchetes: todo es la tarea', r?.quien === null && r.que === 'Llamar mañana')
  ok('un texto vacío no es un paso', leerPaso('   ') === null)
  ok('los dos puntos del detalle no parten la tarea (solo cuenta el primero)', leerPaso('[Ana] Revisar: precio: 10 €')?.detalle === 'precio: 10 €')
}

console.log('\n=== el cuerpo del correo ===')
{
  const c = leerCuerpo(TEXTO)
  ok('el resumen es la frase de debajo de «Resumen», con sus líneas unidas', c.resumen === 'Evaluación de tienda de cosmética y viabilidad de expansión a Europa con análisis de rentabilidad y modelos de asociación', String(c.resumen))
  ok('dos temas, cada uno con su título y su texto (líneas unidas)', c.temas.length === 2 && c.temas[0].titulo === 'Análisis de tienda actual' && c.temas[0].texto === 'Negocio rentable pero con márgenes reducidos por la publicidad. Expandirse a Europa requiere mayor facturación.', JSON.stringify(c.temas))
  ok('el segundo tema es «Modelos de servicio»', c.temas[1].titulo === 'Modelos de servicio' && c.temas[1].texto.endsWith('inventario.'))
  ok('tres pasos, partidos en varias líneas y unidos', c.proximosPasos.length === 3 && c.proximosPasos[0].detalle === 'Consultar con el equipo la disponibilidad y las tarifas para un servicio de asesoría personalizada.', JSON.stringify(c.proximosPasos[0]))
  ok('el segundo paso lo hace el invitado', c.proximosPasos[1].quien === 'laura gomez')
  ok('el tercero, sin detalle', c.proximosPasos[2].que === 'Retomar discusión' && c.proximosPasos[2].detalle === null)
  ok('nada del pie («Registros de la reunión», «¿Te ha resultado útil?», la dirección de Google) se cuela', !JSON.stringify(c).includes('Mountain View') && !JSON.stringify(c).includes('útil') && !JSON.stringify(c).includes('Registros'))
  ok('nada de la cabecera («Estas notas se han enviado…») se cuela', !JSON.stringify(c).includes('Estas notas'))
}
{
  const vacio = leerCuerpo('Notas de algo\n\nSin secciones')
  ok('sin secciones: resumen null, sin temas ni pasos (no inventa)', vacio.resumen === null && vacio.temas.length === 0 && vacio.proximosPasos.length === 0)
  const soloResumen = leerCuerpo('Resumen\n\nUna sola frase.')
  ok('solo resumen: lo lee', soloResumen.resumen === 'Una sola frase.' && soloResumen.proximosPasos.length === 0)
  const ingles = leerCuerpo('Summary\n\nA short summary.\n\nSuggested next steps\n\n[Ana] Send deck: By Friday')
  ok('en inglés también', ingles.resumen === 'A short summary.' && ingles.proximosPasos[0]?.quien === 'Ana')
  const finales = leerCuerpo('Resumen\n\nUna frase.\n\nSegundo párrafo suelto de una línea.')
  ok('un párrafo de una línea tras el resumen lo continúa', finales.resumen === 'Una frase. Segundo párrafo suelto de una línea.', String(finales.resumen))
}

console.log('\n=== el HTML como último recurso ===')
{
  const t = htmlATexto(HTML)
  ok('quita las etiquetas y la hoja de estilos', !t.includes('<') && !t.includes('color: red'))
  ok('convierte las entidades', t.includes('Texto & más') || t.includes('Texto & m&aacute;s'))
  ok('separa los párrafos', htmlATexto('<p>a</p><p>b</p>').split('\n\n').length === 2)
}

console.log('\n=== el correo entero ===')
{
  const n = leerCorreoDeGemini(CORREO)
  ok('sale una nota', n !== null)
  ok('con el título sin fecha', n?.titulo === 'Consultoría Estratégica Amazon · Liberty Seller · LAURA GOMEZ (Socia única)')
  ok('el id del correo y el del documento', n?.gmailMessageId === 'msg-1' && n.driveFileId === '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-aBcD')
  ok('la fecha es la de llegada (ISO)', n?.fechaReunion === '2026-10-20T08:54:44.000Z')
  ok('resumen, temas y pasos', !!n?.resumen && n.temas.length === 2 && n.proximosPasos.length === 3)
  ok('sin detalle ni transcripción: está INCOMPLETA hasta que se lea el documento', n?.completa === false && n.detalle === null && n.transcripcion === null)
  ok('no se sabe nada del invitado ni del evento todavía', n?.invitados.length === 0 && n.googleEventId === null)
  ok('un correo de otro remitente no es una nota', leerCorreoDeGemini({ ...CORREO, remitente: 'ana@empresa.com' }) === null)
  ok('un correo sin asunto utilizable, tampoco', leerCorreoDeGemini({ ...CORREO, asunto: 'Notas: ' }) === null)
  ok('sin texto plano se apoya en el HTML y no revienta', leerCorreoDeGemini({ ...CORREO, texto: '' }) !== null)
}

console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
