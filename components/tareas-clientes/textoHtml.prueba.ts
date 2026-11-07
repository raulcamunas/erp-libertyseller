import { createRequire } from 'module'
import { htmlASegmentos, segmentosAHtml } from '@/components/tareas-clientes/textoHtml'

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

// jsdom solo hace falta para esta prueba y no es una dependencia del proyecto: se busca donde esté instalada (NODE_PATH)
const { JSDOM } = createRequire(import.meta.url)('jsdom') as { JSDOM: new (html: string) => { window: { document: Document } } }
const dom = new JSDOM('<div id="x"></div>')
const leer = (html: string) => {
  const el = dom.window.document.getElementById('x')!
  el.innerHTML = html
  return htmlASegmentos(el)
}

igual('un texto sin formato ida y vuelta', leer(segmentosAHtml([{ t: 'Hola' }])), [{ t: 'Hola' }])
const completo = [{ t: 'a ', b: true }, { t: 'b', i: true, u: true }, { t: ' c', s: true }, { t: 'd', c: true }, { t: 'e', l: 'https://x.es' }, { t: 'f', k: 'red' }]
igual('todos los formatos sobreviven al ida y vuelta', leer(segmentosAHtml(completo)), completo)
igual('el texto con < y & se escapa', segmentosAHtml([{ t: '<b>&"' }]), '&lt;b&gt;&amp;&quot;')
igual('un salto de línea es un <br> y vuelve como salto', leer(segmentosAHtml([{ t: 'a\nb' }])), [{ t: 'a\nb' }])
igual('un enlace javascript: no se escribe como enlace', segmentosAHtml([{ t: 'x', l: 'javascript:alert(1)' }]), 'x')
igual('y si llega en el HTML, se pierde al leerlo', leer('<a href="javascript:alert(1)">malo</a>'), [{ t: 'malo' }])
igual('un script o un evento en lo pegado desaparece', leer('hola<script>alert(1)</script><img src=x onerror=alert(1)><b onclick="x()">negrita</b>'), [{ t: 'hola' }, { t: 'negrita', b: true }])
igual('un color que no existe no se guarda', leer('<span data-k="rosa-fuerte">x</span>'), [{ t: 'x' }])
igual('un color con fondo sí', leer('<span data-k="blue_background">x</span>'), [{ t: 'x', k: 'blue_background' }])
igual('el div que mete el navegador al pulsar Enter es otra línea', leer('uno<div>dos</div>'), [{ t: 'uno\ndos' }])
igual('un <br> final no es texto', leer('hola<br>'), [{ t: 'hola' }])
igual('un bloque vacío no tiene segmentos', leer('<br>'), [])

console.log(`\n${comprobaciones - fallos}/${comprobaciones} bien`)
if (fallos > 0) process.exit(1)
