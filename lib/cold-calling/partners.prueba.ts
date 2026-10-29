import { busquedasDeOrigen, dominioDeWeb, esPrioridadDePartner, ORDEN_DE_PRIORIDADES, PRIORIDADES_DE_PARTNER, segmentoDeLista, textoDeLinkedin, urlSegura, valoracionDe } from './partners'
import { pesoDePartner, pesoOrden } from '@/lib/types/cold-leads'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

console.log('\n=== las cuatro prioridades ===')
{
  ok('hay cuatro, en orden, cada una con su etiqueta, su tono y su pista', ORDEN_DE_PRIORIDADES.join() === '1,2,3,4' && ORDEN_DE_PRIORIDADES.every((p) => PRIORIDADES_DE_PARTNER[p].etiqueta.length > 3 && PRIORIDADES_DE_PARTNER[p].pista.length > 10))
  ok('las etiquetas son las del Excel (sin el número delante)', PRIORIDADES_DE_PARTNER[1].etiqueta === 'Llamar primero' && PRIORIDADES_DE_PARTNER[2].etiqueta === 'Segunda ronda' && PRIORIDADES_DE_PARTNER[3].etiqueta === 'Solo email' && PRIORIDADES_DE_PARTNER[4].etiqueta.startsWith('Revisar'))
  ok('cada una tiene un tono distinto (se distinguen por color además de por texto)', new Set(ORDEN_DE_PRIORIDADES.map((p) => PRIORIDADES_DE_PARTNER[p].tono)).size === 4)
  ok('una prioridad válida lo es, y lo demás no', esPrioridadDePartner(1) && esPrioridadDePartner(4) && !esPrioridadDePartner(0) && !esPrioridadDePartner(5) && !esPrioridadDePartner('1') && !esPrioridadDePartner(null))
}

console.log('\n=== el peso de orden: la prioridad manda y los puntos desempatan ===')
{
  ok('una 1 con pocos puntos pesa más que una 2 con muchos', pesoDePartner(1, 20) > pesoDePartner(2, 100))
  ok('y una 2 con 40 puntos más que una 3 con 90 (la «solo email» no se cuela)', pesoDePartner(2, 40) > pesoDePartner(3, 90))
  ok('dentro de una prioridad, los puntos', pesoDePartner(2, 80) > pesoDePartner(2, 79))
  ok('sin prioridad pesa por debajo de la 4, aunque tenga 99 puntos', pesoDePartner(null, 99) < pesoDePartner(4, 0) + 0.5 && pesoDePartner(undefined, 99) === 99 && pesoDePartner(4, 16) > pesoDePartner(null, 99))
  ok('sin puntos no revienta', pesoDePartner(1, null) === 4000 && pesoDePartner(1, undefined) === 4000)
  ok('pesoOrden usa el del partner y no mira la facturación', pesoOrden({ tipo_lead: 'partner', revenue_monthly: 99999, ventas_estimadas_usd: 99999, prioridad: 2, puntos: 60 }) === 3060)
  ok('para un vendedor y una tienda sigue siendo lo de siempre', pesoOrden({ tipo_lead: 'seller_amazon', revenue_monthly: 5000, ventas_estimadas_usd: 9 }) === 5000 && pesoOrden({ tipo_lead: 'tienda_online', revenue_monthly: 5, ventas_estimadas_usd: 7000 }) === 7000)
}

console.log('\n=== un enlace solo se abre si es http o https ===')
{
  ok('una dirección normal se deja como está', urlSegura('https://www.aeuroweb.com/') === 'https://www.aeuroweb.com/')
  ok('http también', urlSegura('http://www.gruposese.com/') === 'http://www.gruposese.com/')
  ok('sin protocolo se le pone https', urlSegura('www.ejemplo.es') === 'https://www.ejemplo.es/' && urlSegura('ejemplo.es/contacto') === 'https://ejemplo.es/contacto')
  ok('con los parámetros de seguimiento los respeta (es la dirección, no se limpia)', (urlSegura('https://bamboo.legal/?utm_source=google&utm_medium=organic') ?? '').includes('utm_source=google'))
  ok('javascript: no se abre NUNCA', urlSegura('javascript:alert(1)') === null && urlSegura('JaVaScRiPt:alert(1)') === null)
  ok('ni data:, ni file:, ni ftp:', urlSegura('data:text/html,<script>alert(1)</script>') === null && urlSegura('file:///etc/passwd') === null && urlSegura('ftp://x.es/a') === null)
  ok('vacío o con espacios: nada', urlSegura('') === null && urlSegura('   ') === null && urlSegura(null) === null && urlSegura(undefined) === null)
  ok('basura que no es una dirección: nada', urlSegura('http://') === null && urlSegura('https://exa mple.com') === null)
}

console.log('\n=== el dominio, para enseñarlo en una celda ===')
{
  ok('sin protocolo ni www', dominioDeWeb('https://www.aeuroweb.com/') === 'aeuroweb.com')
  ok('sin la ruta ni los parámetros de seguimiento', dominioDeWeb('https://bamboo.legal/?utm_source=google&utm_medium=organic&utm_campaign=gbp-madrid') === 'bamboo.legal')
  ok('conserva un subdominio que no es www', dominioDeWeb('https://tienda.ejemplo.es/a/b') === 'tienda.ejemplo.es')
  ok('sin web: nada', dominioDeWeb(null) === null && dominioDeWeb('') === null && dominioDeWeb('javascript:alert(1)') === null)
}

console.log('\n=== LinkedIn ===')
{
  ok('el nombre de la empresa', textoDeLinkedin('https://www.linkedin.com/company/aeuroweb/') === 'aeuroweb')
  ok('con el idioma delante', textoDeLinkedin('https://es.linkedin.com/company/bamboo-legal') === 'bamboo-legal')
  ok('un perfil de persona', textoDeLinkedin('https://www.linkedin.com/in/ana-lopez-123') === 'ana-lopez-123')
  ok('con ruta de más (las de administración que trae el Excel)', textoDeLinkedin('https://www.linkedin.com/company/18862855/admin/') === '18862855')
  ok('sin enlace o con uno peligroso: nada', textoDeLinkedin(null) === null && textoDeLinkedin('javascript:x') === null)
}

console.log('\n=== la valoración ===')
{
  ok('valoración y reseñas', valoracionDe(4.8, 385) === '4,8 · 385 reseñas', String(valoracionDe(4.8, 385)))
  ok('un cinco entero lleva su decimal', valoracionDe(5, 54) === '5,0 · 54 reseñas')
  ok('miles con punto (como en español: el de cuatro cifras no lleva, el de cinco sí)', valoracionDe(4.8, 5717) === '4,8 · 5717 reseñas' && valoracionDe(4.5, 46177) === '4,5 · 46.177 reseñas')
  ok('una sola reseña, en singular', valoracionDe(5, 1) === '5,0 · 1 reseña')
  ok('sin valoración, solo las reseñas', valoracionDe(null, 120) === '120 reseñas')
  ok('sin reseñas ni valoración: nada', valoracionDe(null, null) === null && valoracionDe(undefined, 0) === null)
  ok('con valoración y cero reseñas, se dice (es un dato)', valoracionDe(4, 0) === '4,0 · 0 reseñas')
}

console.log('\n=== las búsquedas con las que se encontró ===')
{
  ok('se separan por comas', busquedasDeOrigen('agencia ecommerce, asesoría ecommerce, desarrollo ecommerce').join('|') === 'agencia ecommerce|asesoría ecommerce|desarrollo ecommerce')
  ok('sin vacías ni espacios de más', busquedasDeOrigen('  a ,, b  ,').join('|') === 'a|b')
  ok('sin repetidas (aunque cambien las mayúsculas)', busquedasDeOrigen('registro de marcas, Registro de Marcas').join('|') === 'registro de marcas')
  ok('nada: lista vacía', busquedasDeOrigen(null).length === 0 && busquedasDeOrigen('').length === 0)
}

console.log('\n=== el segmento, sin el prefijo de la lista ===')
{
  ok('«Partners - Gestorías» -> «Gestorías»', segmentoDeLista('Partners - Gestorías') === 'Gestorías')
  ok('con otros separadores', segmentoDeLista('Partners · Fulfillment') === 'Fulfillment' && segmentoDeLista('partners: Registro de marcas') === 'Registro de marcas')
  ok('una lista que no es de partners se queda como está', segmentoDeLista('No Amazon - Nivel 1') === 'No Amazon - Nivel 1')
  ok('sin lista: nada', segmentoDeLista(null) === null && segmentoDeLista('  ') === null)
}

console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
