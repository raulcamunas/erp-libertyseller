import { analizarContenido } from '@/lib/correo/verificacion/contenido'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}
const codigos = (a: ReturnType<typeof analizarContenido>): string => a.avisos.map((x) => `${x.codigo}:${x.gravedad}`).join(',')

const BUENO = {
  asunto: 'Casa Luz en Amazon: una observación sobre vuestro catálogo',
  texto:
    'Hola,\n\nHe estado viendo vuestra tienda de decoración y creo que hay una oportunidad clara en Amazon para vuestras lámparas y textiles, donde la gente busca por estilo y no por marca.\n\nEn Liberty Seller nos encargamos de todo el alta y la puesta en marcha, sin cargar a vuestro equipo. ¿Te viene mejor una videollamada de 10-15 minutos esta semana o la próxima?\n\nUn saludo,\nAna López\nLiberty Seller',
}

console.log('\n=== un buen correo ===')
{
  const a = analizarContenido(BUENO)
  ok('puntúa 100 y es «bien»', a.puntos === 100 && a.nivel === 'bien' && a.avisos.length === 0, codigos(a))
  ok('cuenta palabras y enlaces', a.palabras > 50 && a.enlaces === 0)
  const link = analizarContenido({ ...BUENO, texto: `${BUENO.texto}\n\nPuedes ver quiénes somos en https://libertyseller.com` })
  ok('un enlace es normal', link.puntos === 100 && link.enlaces === 1)
}

console.log('\n=== el asunto ===')
{
  ok('sin asunto: grave', analizarContenido({ ...BUENO, asunto: '  ' }).avisos.some((a) => a.codigo === 'asunto_vacio' && a.gravedad === 'grave'))
  ok('largo (>78): leve; larguísimo (>120): medio', analizarContenido({ ...BUENO, asunto: 'a'.repeat(90) }).avisos.some((a) => a.codigo === 'asunto_largo') && analizarContenido({ ...BUENO, asunto: 'a'.repeat(130) }).avisos.some((a) => a.codigo === 'asunto_muy_largo'))
  ok('en mayúsculas', analizarContenido({ ...BUENO, asunto: 'OFERTA ESPECIAL PARA TU TIENDA' }).avisos.some((a) => a.codigo === 'asunto_en_mayusculas'))
  ok('«Amazon FBA» en un asunto normal no es gritar', !analizarContenido({ ...BUENO, asunto: 'Casa Luz y Amazon FBA: una idea' }).avisos.some((a) => a.codigo === 'asunto_en_mayusculas'))
  ok('exclamaciones: una es leve, tres son medio', analizarContenido({ ...BUENO, asunto: '¡Hola!' }).avisos.some((a) => a.codigo === 'asunto_con_exclamacion') && analizarContenido({ ...BUENO, asunto: '¡¡Hola!! ¡Mira!' }).avisos.some((a) => a.codigo === 'asunto_con_exclamaciones'))
  ok('un «Re:» que no es respuesta es un engaño (grave)', analizarContenido({ ...BUENO, asunto: 'Re: tu pedido' }).avisos.some((a) => a.codigo === 're_falso' && a.gravedad === 'grave') && analizarContenido({ ...BUENO, asunto: 'RV: información' }).avisos.some((a) => a.codigo === 're_falso'))
  ok('pero en una respuesta es verdad', !analizarContenido({ ...BUENO, asunto: 'Re: Casa Luz en Amazon', esRespuesta: true }).avisos.some((a) => a.codigo === 're_falso'))
  ok('cifras o % en el asunto suenan a promoción', analizarContenido({ ...BUENO, asunto: 'Ahorra un 30% en Amazon' }).avisos.some((a) => a.codigo === 'asunto_con_dinero'))
  ok('palabras de spam en el asunto', analizarContenido({ ...BUENO, asunto: 'Consultoría gratis para tu tienda' }).avisos.some((a) => a.codigo === 'asunto_con_palabras_de_spam'))
}

console.log('\n=== el texto ===')
{
  ok('casi vacío: grave; muy corto: medio', analizarContenido({ ...BUENO, texto: 'Hola' }).avisos.some((a) => a.codigo === 'texto_vacio') && analizarContenido({ ...BUENO, texto: 'Hola, ¿me puedes llamar mañana por la mañana? Gracias.' }).avisos.some((a) => a.codigo === 'texto_muy_corto'))
  ok('largo: leve; larguísimo: medio', analizarContenido({ ...BUENO, texto: `Hola, ${'palabra '.repeat(200)}` }).avisos.some((a) => a.codigo === 'texto_largo') && analizarContenido({ ...BUENO, texto: `Hola, ${'palabra '.repeat(300)}` }).avisos.some((a) => a.codigo === 'texto_muy_largo'))
  ok('enlaces: 2 leve, 3 medio, 5 grave', analizarContenido({ ...BUENO, texto: `${BUENO.texto} https://a.es https://b.es` }).avisos.some((a) => a.codigo === 'dos_enlaces') && analizarContenido({ ...BUENO, texto: `${BUENO.texto} https://a.es https://b.es https://c.es` }).avisos.some((a) => a.codigo === 'varios_enlaces') && analizarContenido({ ...BUENO, texto: `${BUENO.texto} https://a.es https://b.es https://c.es www.d.es https://e.es` }).avisos.some((a) => a.codigo === 'muchos_enlaces' && a.gravedad === 'grave'))
  ok('un enlace acortado es grave', analizarContenido({ ...BUENO, texto: `${BUENO.texto}\nhttps://bit.ly/3abc` }).avisos.some((a) => a.codigo === 'enlace_acortado' && a.gravedad === 'grave'))
  ok('un enlace a una IP es grave', analizarContenido({ ...BUENO, texto: `${BUENO.texto}\nhttp://192.168.4.5/oferta` }).avisos.some((a) => a.codigo === 'enlace_con_ip'))
  ok('varias palabras en MAYÚSCULAS', analizarContenido({ ...BUENO, texto: `${BUENO.texto}\nIMPORTANTE: LLÁMANOS HOY MISMO PORQUE ES MUY URGENTE` }).avisos.some((a) => a.codigo === 'mayusculas'))
  ok('las siglas del sector no cuentan como gritos', !analizarContenido({ ...BUENO, texto: `${BUENO.texto}\nTrabajamos PPC, ACOS, TACOS, FBA y SEO.` }).avisos.some((a) => a.codigo === 'mayusculas'))
  ok('exclamaciones: 3 medio, 6 grave', analizarContenido({ ...BUENO, texto: `${BUENO.texto} ¡Hola! ¡Mira! ¡Ya!` }).avisos.some((a) => a.codigo === 'exclamaciones') && analizarContenido({ ...BUENO, texto: `${BUENO.texto} ¡a! ¡b! ¡c! ¡d! ¡e! ¡f!` }).avisos.some((a) => a.codigo === 'muchas_exclamaciones'))
  ok('palabras de spam: una es medio, dos son graves', analizarContenido({ ...BUENO, texto: `${BUENO.texto}\nLa auditoría es gratis.` }).avisos.some((a) => a.codigo === 'palabras_de_spam' && a.gravedad === 'medio') && analizarContenido({ ...BUENO, texto: `${BUENO.texto}\nLa auditoría es gratis y el resultado garantizado, última oportunidad.` }).avisos.some((a) => a.codigo === 'palabras_de_spam' && a.gravedad === 'grave'))
  ok('«sin compromiso» (normal en un primer contacto) NO cuenta', !analizarContenido({ ...BUENO, texto: `${BUENO.texto}\nLa videollamada es sin compromiso.` }).avisos.some((a) => a.codigo === 'palabras_de_spam'))
  ok('hablar de promociones: una palabra no, dos sí (leve)', !analizarContenido({ ...BUENO, texto: `${BUENO.texto}\nTenemos una oferta.` }).avisos.some((a) => a.codigo === 'palabras_de_promocion') && analizarContenido({ ...BUENO, texto: `${BUENO.texto}\nTenemos una oferta y un descuento.` }).avisos.some((a) => a.codigo === 'palabras_de_promocion'))
  ok('hablar de dinero (la regla del equipo)', analizarContenido({ ...BUENO, texto: `${BUENO.texto}\nSabemos que facturáis 20.000 € al mes.` }).avisos.some((a) => a.codigo === 'dinero'))
  ok('un hueco por rellenar es grave', analizarContenido({ ...BUENO, texto: BUENO.texto.replace('Hola,', 'Hola [Nombre],') }).avisos.some((a) => a.codigo === 'hueco' && a.gravedad === 'grave') && analizarContenido({ ...BUENO, texto: BUENO.texto.replace('Hola,', 'Hola {{nombre}},') }).avisos.some((a) => a.codigo === 'hueco'))
  ok('HTML escrito a mano', analizarContenido({ ...BUENO, texto: `${BUENO.texto}\n<div>Hola</div>` }).avisos.some((a) => a.codigo === 'html_en_texto'))
  ok('saludo genérico y sin saludo (leves)', analizarContenido({ ...BUENO, texto: BUENO.texto.replace('Hola,', 'Estimado cliente,') }).avisos.some((a) => a.codigo === 'saludo_generico') && analizarContenido({ ...BUENO, texto: BUENO.texto.replace('Hola,\n\n', '') }).avisos.some((a) => a.codigo === 'sin_saludo'))
}

console.log('\n=== la nota y el nivel ===')
{
  const malo = analizarContenido({ asunto: '¡¡GANA DINERO FÁCIL YA!!', texto: 'CLICK HERE https://bit.ly/x gratis garantizado 100% seguro!!! ÚLTIMA OPORTUNIDAD' })
  ok('un correo basura puntúa muy bajo y es «arriesgado»', malo.puntos < 40 && malo.nivel === 'arriesgado', `${malo.puntos} ${codigos(malo)}`)
  const medio = analizarContenido({ ...BUENO, asunto: 'Casa Luz en Amazon: una observación!', texto: `${BUENO.texto}\nTenemos una oferta y un descuento.` })
  ok('con un par de pegas leves es «bien» o «mejorable», no «arriesgado»', medio.nivel !== 'arriesgado' && medio.puntos < 100, `${medio.puntos} ${medio.nivel}`)
  ok('la nota nunca baja de 0 ni pasa de 100', malo.puntos >= 0 && medio.puntos <= 100)
  ok('lo que escribe la IA (los textos de las pruebas de seguimientos) puntúa limpio', analizarContenido({ asunto: 'Re: Casa Luz en Amazon', esRespuesta: true, texto: 'Hola,\n\nTe escribí hace unos días sobre vuestro catálogo. Una idea distinta: revisar cómo aparecen vuestras lámparas cuando alguien busca por estilo y no por marca. Si te encaja, lo vemos en diez minutos.\n\nUn saludo,' }).puntos === 100)
}

console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
