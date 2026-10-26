import { alDeshacer, alElegirDeLaLista, alEscribir, alLlegarDeLaIa, borradorVacio, estaTocado, etiquetaDelOrigen, revisarBorrador, textoMostrado } from '@/lib/whatsapp/borrador'
import { MAX_DE_MENSAJE } from '@/lib/whatsapp/mensajes'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

const SUGERIDO = 'Hola, soy Maoli de Liberty Seller. Te he llamado hace un rato y no hemos podido hablar. ¿Hablamos mañana?'
const DE_LA_LISTA = 'Hola, soy Maoli. ¿Te viene bien que te llame mañana por la mañana para contarte lo de Amazon?'
const DE_LA_IA = { mensaje: 'Hola Ana, soy Maoli. Ayer no pudimos hablar; ¿te llamo mañana a primera hora?', base: 'su tienda en Amazon y la llamada de ayer', aviso: null, maxPalabras: null }
const clave = 'lead-1|no_contesta'

console.log('\n=== nada tocado: se ve el sugerido ===')
{
  const b = borradorVacio(clave)
  ok('el cuadro muestra el sugerido', textoMostrado(b, SUGERIDO) === SUGERIDO)
  ok('y no está tocado', !estaTocado(b))
  ok('si el sugerido cambia (llegan tarde los mensajes de la base), el cuadro se pone al día solo', textoMostrado(b, 'Otro sugerido') === 'Otro sugerido')
  const r = revisarBorrador(b, SUGERIDO)
  ok('el sugerido está listo para enviar, tal cual', r.listo === SUGERIDO && !r.bloquea && r.problemas.length === 0, JSON.stringify(r))
  ok('la etiqueta dice que es el sugerido y de qué momento', etiquetaDelOrigen(b, 'no_contesta') === 'Mensaje sugerido · Te he llamado y no contesta', etiquetaDelOrigen(b, 'no_contesta'))
}

console.log('\n=== escribir encima ===')
{
  const a = alEscribir(borradorVacio(clave), 'Hola, soy Maoli y te escribo por lo de Amazon.')
  ok('lo escrito pasa a ser lo que se muestra, y el sugerido ya no cuenta', textoMostrado(a, SUGERIDO) === 'Hola, soy Maoli y te escribo por lo de Amazon.')
  ok('queda tocado y marcado como retocado', estaTocado(a) && a.editado && /\(retocado\)$/.test(etiquetaDelOrigen(a, 'no_contesta')), etiquetaDelOrigen(a, 'no_contesta'))
  ok('el origen sigue siendo el sugerido: escribir encima no lo cambia de dónde viene', a.origen === 'sugerido')
  ok(
    'lo que se envía y se apunta es lo escrito, solo sin espacios ni saltos de línea de sobra',
    revisarBorrador(alEscribir(borradorVacio(clave), '  Hola,\n\n\n\nsoy Maoli.  \n'), SUGERIDO).listo === 'Hola,\n\nsoy Maoli.',
    JSON.stringify(revisarBorrador(alEscribir(borradorVacio(clave), '  Hola,\n\n\n\nsoy Maoli.  \n'), SUGERIDO).listo)
  )
  ok('y las palabras no se tocan: ni se reescriben ni se «arreglan»', revisarBorrador(alEscribir(borradorVacio(clave), 'ola q tal, soy maoli, t llamo mañana?'), SUGERIDO).listo === 'ola q tal, soy maoli, t llamo mañana?')
  ok('se puede vaciar del todo: entonces no hay nada que enviar y se bloquea', (() => {
    const v = alEscribir(borradorVacio(clave), '')
    const r = revisarBorrador(v, SUGERIDO)
    return textoMostrado(v, SUGERIDO) === '' && r.listo === '' && r.bloquea
  })())
  ok('pero vaciarlo NO hace volver al sugerido: un cuadro en blanco es un cuadro en blanco', textoMostrado(alEscribir(borradorVacio(clave), ''), SUGERIDO) === '')
  ok('un texto larguísimo se corta en el máximo', textoMostrado(alEscribir(borradorVacio(clave), 'a'.repeat(MAX_DE_MENSAJE + 500)), SUGERIDO).length === MAX_DE_MENSAJE)
}

console.log('\n=== elegir otro mensaje de la lista ===')
{
  const b = alElegirDeLaLista(borradorVacio(clave), DE_LA_LISTA)
  ok('el mensaje pasa al cuadro (no se abre nada)', textoMostrado(b, SUGERIDO) === DE_LA_LISTA)
  ok('la etiqueta lo dice', etiquetaDelOrigen(b, 'no_contesta') === 'Mensaje elegido de la lista')
  ok('se puede deshacer y vuelve a lo que había: el sugerido sin tocar', (() => {
    const d = alDeshacer(b)
    return !estaTocado(d) && textoMostrado(d, SUGERIDO) === SUGERIDO && d.previo === null
  })())
  ok('si antes se había escrito a mano, deshacer recupera ESO (no el sugerido)', (() => {
    const mano = alEscribir(borradorVacio(clave), 'Mi mensaje a mano, bien trabajado.')
    const d = alDeshacer(alElegirDeLaLista(mano, DE_LA_LISTA))
    return textoMostrado(d, SUGERIDO) === 'Mi mensaje a mano, bien trabajado.' && d.editado
  })())
  ok('retocarlo después lo marca como retocado', /\(retocado\)$/.test(etiquetaDelOrigen(alEscribir(b, DE_LA_LISTA + ' Gracias.'), 'no_contesta')))
  ok('deshacer sin nada que recuperar no hace nada', alDeshacer(borradorVacio(clave)).texto === null)
}

console.log('\n=== lo que escribe la IA ===')
{
  const b = alLlegarDeLaIa(borradorVacio(clave), DE_LA_IA, 'no_contesta')
  ok('el mensaje de la IA pasa al cuadro', textoMostrado(b, SUGERIDO) === DE_LA_IA.mensaje)
  ok('se ofrecen los atajos para cambiarlo', b.hayIa)
  ok('la etiqueta dice que lo escribió la IA y para qué momento', etiquetaDelOrigen(b, 'no_contesta') === 'Escrito con IA · Te he llamado y no contesta', etiquetaDelOrigen(b, 'no_contesta'))
  ok('si el lead cambia de momento después, la etiqueta sigue diciendo para qué momento se escribió', etiquetaDelOrigen(b, 'tras_hablar').startsWith('Escrito con IA · Te he llamado y no contesta'), etiquetaDelOrigen(b, 'tras_hablar'))
  ok('dice en qué datos se apoya', revisarBorrador(b, SUGERIDO).base === DE_LA_IA.base)
  ok('deshacer devuelve el sugerido, y los atajos de la IA siguen disponibles (se pidió una)', (() => {
    const d = alDeshacer(b)
    return textoMostrado(d, SUGERIDO) === SUGERIDO && !estaTocado(d)
  })())

  // Lo que la persona cambia a mano deja de ser «lo que dijo la IA»
  const conAviso = alLlegarDeLaIa(borradorVacio(clave), { ...DE_LA_IA, aviso: 'Cita una llamada de ayer que no está en el historial: confírmalo.' }, 'no_contesta')
  ok('el aviso de la IA se ve mientras nadie toca el texto', revisarBorrador(conAviso, SUGERIDO).avisos.includes('Cita una llamada de ayer que no está en el historial: confírmalo.'))
  const retocado = alEscribir(conAviso, DE_LA_IA.mensaje + ' Un abrazo.')
  const rr = revisarBorrador(retocado, SUGERIDO)
  ok('al retocarlo, el aviso de la IA y su «basado en» se quitan: ya no hablan de este texto', rr.avisos.length === 0 && rr.base === '', JSON.stringify(rr))
  ok('y la etiqueta lo dice', /^Escrito con IA · .+ \(retocado\)$/.test(etiquetaDelOrigen(retocado, 'no_contesta')), etiquetaDelOrigen(retocado, 'no_contesta'))

  // Una segunda petición (un atajo como «Más corto») reemplaza y guarda lo anterior, también lo retocado a mano
  const otra = alLlegarDeLaIa(retocado, { ...DE_LA_IA, mensaje: 'Hola Ana, ¿te llamo mañana?' }, 'no_contesta')
  ok('una segunda petición a la IA reemplaza el texto', textoMostrado(otra, SUGERIDO) === 'Hola Ana, ¿te llamo mañana?' && !otra.editado)
  ok('y deshacer devuelve lo que la persona había retocado', textoMostrado(alDeshacer(otra), SUGERIDO) === DE_LA_IA.mensaje + ' Un abrazo.')
  ok('la configuración de la IA (hasta cuántas palabras) viaja con el mensaje', alLlegarDeLaIa(borradorVacio(clave), { ...DE_LA_IA, maxPalabras: 90 }, 'no_contesta').maxPalabras === 90)
}

console.log('\n=== huecos y reparos antes de enviar ===')
{
  const conHueco = alEscribir(borradorVacio(clave), 'Hola {{nombre}}, soy Maoli.')
  const r = revisarBorrador(conHueco, SUGERIDO)
  ok('un hueco por rellenar impide enviar', r.bloquea && r.problemas.includes('hueco'), JSON.stringify(r))
  ok('y lo dice con una frase', r.avisos.some((a) => /hueco/i.test(a)), JSON.stringify(r.avisos))
  ok('al completarlo a mano se desbloquea', !revisarBorrador(alEscribir(conHueco, 'Hola Ana, soy Maoli.'), SUGERIDO).bloquea)
  ok('el sugerido con un hueco (falta el nombre de quien escribe) también bloquea, hasta que se complete', revisarBorrador(borradorVacio(clave), 'Hola, soy {{mi_nombre}} de Liberty Seller.').bloquea)
  ok('un corchete también cuenta como hueco', revisarBorrador(alEscribir(borradorVacio(clave), 'Hola [nombre], soy Maoli.'), SUGERIDO).bloquea)
  ok('un reparo que no es un hueco avisa pero NO bloquea (decide quien lo manda)', (() => {
    const largo = revisarBorrador(alEscribir(borradorVacio(clave), 'palabra '.repeat(200)), SUGERIDO)
    return largo.problemas.length > 0 && !largo.problemas.includes('hueco') && !largo.bloquea
  })())
}

console.log('\n=== un borrador es de un lead en un momento ===')
{
  const a = alEscribir(borradorVacio('lead-1|no_contesta'), 'Para el lead 1')
  ok('la clave viaja con el borrador', a.clave === 'lead-1|no_contesta')
  ok('un borrador nuevo de otra clave arranca limpio', borradorVacio('lead-2|primer_contacto').texto === null && borradorVacio('lead-2|primer_contacto').previo === null)
}

console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
