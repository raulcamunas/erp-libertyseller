import { mencionaFacturacion } from '@/lib/correo/ia-ejemplos'
import {
  CAMPOS_DE_WHATSAPP,
  ETIQUETA_DE_SITUACION,
  LEAD_SIN_WHATSAPP,
  MAX_DE_MENSAJE,
  MENSAJE_DE_SERIE,
  SITUACIONES_DE_WHATSAPP,
  cuentaDe,
  cuerpoDelApunteDeWhatsapp,
  elegirMensaje,
  enlaceDeWhatsapp,
  esSituacionDeWhatsapp,
  mensajesDeLaSituacion,
  nombreDePila,
  nombreParaElMensaje,
  numeroDeWhatsapp,
  numerosDeWhatsapp,
  rellenarMensaje,
  situacionDelLead,
  type MensajeDeWhatsapp,
} from '@/lib/whatsapp/mensajes'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

console.log('\n=== a qué número se escribe ===')
{
  ok('un móvil español con espacios', numeroDeWhatsapp('612 34 56 78') === '34612345678', String(numeroDeWhatsapp('612 34 56 78')))
  ok('con el prefijo escrito de dos formas', numeroDeWhatsapp('+34 712345678') === '34712345678' && numeroDeWhatsapp('0034 612345678') === '34612345678')
  ok('un móvil que viene del Excel con «.0» sigue valiendo', numeroDeWhatsapp('600112233.0') === '34600112233', String(numeroDeWhatsapp('600112233.0')))
  ok('un fijo español (9xx) no tiene WhatsApp', numeroDeWhatsapp('912345678') === null && numeroDeWhatsapp('+34 951234567') === null)
  ok('un 8xx español tampoco', numeroDeWhatsapp('812345678') === null)
  ok('un número de otro país se ofrece (no se puede saber)', numeroDeWhatsapp('+44 7911 123456') === '447911123456' && numeroDeWhatsapp('+351 912 345 678') === '351912345678')
  ok('lo que no es un teléfono, no', numeroDeWhatsapp('abc') === null && numeroDeWhatsapp('') === null && numeroDeWhatsapp('12345') === null)
  const lista = numerosDeWhatsapp(['600 11 22 33', '+34600112233', '912345678', '+44 7911 123456', 'abc'])
  ok('de la lista de la ficha salen solo los móviles, sin repetir el mismo escrito de otra forma', lista.length === 2 && lista[0].numero === '34600112233' && lista[0].telefono === '600 11 22 33' && lista[1].numero === '447911123456', JSON.stringify(lista))
}

console.log('\n=== el enlace ===')
{
  const texto = '¿Qué tal, Ñoño? Soy Ana & «Liberty Seller» #1\nSegunda línea: 100 %'
  const web = enlaceDeWhatsapp({ numero: '34612345678', texto, via: 'web' })
  const app = enlaceDeWhatsapp({ numero: '34612345678', texto, via: 'app' })
  ok('WhatsApp Web: la dirección y el número', web.startsWith('https://web.whatsapp.com/send?phone=34612345678&text='), web)
  ok('la aplicación: wa.me con el número', app.startsWith('https://wa.me/34612345678?text='), app)
  ok('el texto viaja entero y sin romper el enlace (tildes, &, #, saltos de línea)', new URL(web).searchParams.get('text') === texto && new URL(app).searchParams.get('text') === texto)
  ok('y el enlace no lleva ni un salto de línea ni un espacio sueltos', !/[\s]/.test(web) && !/[\s]/.test(app))
}

console.log('\n=== qué mensaje ===')
{
  ok('las tres situaciones tienen su nombre y su mensaje de serie', SITUACIONES_DE_WHATSAPP.every((s) => ETIQUETA_DE_SITUACION[s].length > 3 && MENSAJE_DE_SERIE[s].length > 40))
  ok('«No contesta» es lo que deja Rinkel solo tras una llamada sin respuesta', situacionDelLead('no_contesta') === 'no_contesta')
  ok('lo que viene de haber hablado pide un mensaje de después de hablar', ['programado', 'email_enviado', 'seguimiento', 'cita_cualificada'].every((e) => situacionDelLead(e) === 'tras_hablar'))
  ok('lo demás es un primer contacto', situacionDelLead('pendiente') === 'primer_contacto' && situacionDelLead(null) === 'primer_contacto' && situacionDelLead('algo-raro') === 'primer_contacto')
  ok('a quien ha dicho que no, no se le escribe', LEAD_SIN_WHATSAPP.has('no_interesa') && !LEAD_SIN_WHATSAPP.has('pendiente'))
  ok('situación válida o no', esSituacionDeWhatsapp('no_contesta') && !esSituacionDeWhatsapp('otra') && !esSituacionDeWhatsapp(null))

  const sinNada = mensajesDeLaSituacion('no_contesta', null)
  ok('sin ninguno guardado se ofrece el de serie, que no es de nadie', sinNada.length === 1 && sinNada[0].id === null && sinNada[0].user_id === null && sinNada[0].texto === MENSAJE_DE_SERIE.no_contesta)

  const guardados: MensajeDeWhatsapp[] = [
    { id: 'a', user_id: 'u1', situacion: 'no_contesta', texto: 'Hola, te he llamado.' },
    { id: 'b', user_id: null, situacion: 'no_contesta', texto: 'Buenas, intenté hablar contigo.' },
    { id: 'c', user_id: 'u1', situacion: 'primer_contacto', texto: 'Hola, soy {{mi_nombre}}.' },
    { id: 'd', user_id: 'u1', situacion: 'no_contesta', texto: '   ' },
  ]
  const deNoContesta = mensajesDeLaSituacion('no_contesta', guardados)
  ok('con guardados, solo los de esa situación y sin los que están en blanco', deNoContesta.map((m) => m.id).join() === 'a,b', deNoContesta.map((m) => m.id).join())
  ok('y una situación sin guardados sigue teniendo el de serie', mensajesDeLaSituacion('tras_hablar', guardados)[0].id === null)

  ok('con un solo mensaje, ese', elegirMensaje([deNoContesta[0]], 'lo-que-sea').id === 'a')
  const tres: MensajeDeWhatsapp[] = ['x', 'y', 'z'].map((id) => ({ id, user_id: null, situacion: 'primer_contacto', texto: `Mensaje ${id} con texto suficiente` }))
  ok('el mismo lead siempre sale con el mismo mensaje', elegirMensaje(tres, 'lead-1').id === elegirMensaje(tres, 'lead-1').id)
  const reparto: Record<string, number> = { x: 0, y: 0, z: 0 }
  for (let i = 0; i < 600; i++) reparto[elegirMensaje(tres, `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`).id as string]++
  ok('y los distintos se reparten entre todos (ninguno se queda con casi todo ni sin nada)', Object.values(reparto).every((n) => n > 120 && n < 290), JSON.stringify(reparto))
  ok('la cuenta es estable', cuentaDe('abc') === cuentaDe('abc') && cuentaDe('abc') !== cuentaDe('abd'))
  let sinMensajes = false
  try {
    elegirMensaje([], 'x')
  } catch {
    sinMensajes = true
  }
  ok('elegir entre ninguno es un error (no se inventa nada)', sinMensajes)
}

console.log('\n=== el nombre de pila ===')
{
  ok('el primer nombre, bien escrito', nombreDePila('Maoli García') === 'Maoli' && nombreDePila('  daniela   rojas ') === 'Daniela')
  ok('en mayúsculas se arregla, con tildes también', nombreDePila('MAOLI') === 'Maoli' && nombreDePila('ÁNGEL RUIZ') === 'Ángel')
  ok('sin nombre, el principio del correo', nombreDePila(null, 'lucia.perez@libertyseller.com') === 'Lucia' && nombreDePila('', 'ana@x.es') === 'Ana')
  ok('y sin nada, vacío (el mensaje no se abrirá: falta el campo)', nombreDePila(null, null) === '' && nombreDePila('  ', '') === '')
}

console.log('\n=== cómo se llama el lead en el mensaje ===')
{
  ok('un nombre de tienda normal se respeta', nombreParaElMensaje('Casa Luz', 'CASA LUZ SL') === 'Casa Luz' && nombreParaElMensaje('Textiles del Sur', null) === 'Textiles del Sur')
  ok('si la tienda es una dirección web, manda la empresa del registro, arreglada', nombreParaElMensaje('www.elmundodelpapelpintado.com', 'MUNDO DEL PAPEL PINTADO') === 'Mundo del Papel Pintado', nombreParaElMensaje('www.elmundodelpapelpintado.com', 'MUNDO DEL PAPEL PINTADO'))
  ok('sin la forma legal del final (SL, S.L., S.L.U., SA…)', nombreParaElMensaje('https://tienda.es', 'CASA LUZ SL') === 'Casa Luz' && nombreParaElMensaje('tienda.es', 'Muebles Roca, S.L.') === 'Muebles Roca' && nombreParaElMensaje('tienda.es', 'TEXTILES DEL SUR S.L.U.') === 'Textiles del Sur' && nombreParaElMensaje('tienda.es', 'BAMBU HOME SA') === 'Bambu Home')
  ok('una empresa que ya trae minúsculas no se toca', nombreParaElMensaje('tienda.es', 'Pedro Pérez e Hijos') === 'Pedro Pérez e Hijos')
  ok('«SL» solo no se borra: es lo único que hay', nombreParaElMensaje('tienda.es', 'SL') === 'Sl')
  ok('sin empresa, la web sin «www.» ni camino', nombreParaElMensaje('https://www.mitienda.es/productos', null) === 'mitienda.es' && nombreParaElMensaje('www.mitienda.es', '  ') === 'mitienda.es')
  ok('sin nada, vacío (el mensaje no se abrirá: falta el campo)', nombreParaElMensaje(null, null) === '' && nombreParaElMensaje('', undefined) === '')
}

console.log('\n=== rellenar el mensaje ===')
{
  const r = rellenarMensaje(MENSAJE_DE_SERIE.no_contesta, { empresa: 'Casa Luz', miNombre: 'Maoli' })
  ok('con todo lo que se sabe, no queda nada sin rellenar', r.sinRellenar.length === 0 && r.texto.includes('Maoli') && r.texto.includes('Casa Luz') && !r.texto.includes('{{'), r.texto)
  const sinNombre = rellenarMensaje('Hola {{nombre}}, soy {{mi_nombre}} de {{empresa}}', { empresa: 'Casa Luz', miNombre: 'Maoli' })
  ok('un campo que no se sabe (el nombre del contacto) se queda escrito y se avisa', sinNombre.sinRellenar.join() === '{{nombre}}' && sinNombre.texto.includes('{{nombre}}'), JSON.stringify(sinNombre))
  const sinEmpresa = rellenarMensaje('Soy {{mi_nombre}} y te escribo por {{ empresa }}', { empresa: '  ', miNombre: 'Maoli' })
  ok('una empresa en blanco tampoco se rellena', sinEmpresa.sinRellenar.join() === '{{empresa}}', JSON.stringify(sinEmpresa))
  ok('los mensajes de serie se rellenan del todo, caben y no hablan de dinero', SITUACIONES_DE_WHATSAPP.every((s) => {
    const x = rellenarMensaje(MENSAJE_DE_SERIE[s], { empresa: 'Casa Luz', miNombre: 'Maoli' })
    return x.sinRellenar.length === 0 && x.texto.length <= MAX_DE_MENSAJE && !mencionaFacturacion(x.texto)
  }))
  ok('los campos que se ofrecen al escribir un mensaje son los que se saben rellenar', CAMPOS_DE_WHATSAPP.map((c) => c.etiqueta).join() === '{{empresa}},{{mi_nombre}}')
}

console.log('\n=== el apunte del historial ===')
{
  const cuerpo = cuerpoDelApunteDeWhatsapp({ numero: '34612345678', texto: '  Hola, soy Maoli.\r\n\r\n\r\n\r\nUn saludo  \n' })
  ok('dice que se ha ABIERTO con ese mensaje (no que se ha enviado) y a qué número', cuerpo.startsWith('WhatsApp abierto con este mensaje (+34612345678):\n') && !/enviado/i.test(cuerpo), cuerpo)
  ok('lleva el mensaje entero, con los saltos de línea normalizados', cuerpo.endsWith('Hola, soy Maoli.\n\nUn saludo'), JSON.stringify(cuerpo))
}

console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
