import { INTENTOS_MAXIMOS, PALABRAS_MINIMAS, esperaTrasFallo, palabrasDe, pistasDeLaLlamada, primerNombre, sinContenido } from '@/lib/transcripcion/reglas'
import { costeDeTexto, costeDeVoz, enDolares } from '@/lib/transcripcion/precios'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}
const cerca = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) <= tol

console.log('\n=== cuándo reintentar ===')
{
  ok('tras el primer fallo se espera 3 minutos', esperaTrasFallo(1) === 3 * 60_000)
  ok('tras el segundo, 20 minutos', esperaTrasFallo(2) === 20 * 60_000)
  ok('tras el tercero ya no se reintenta', esperaTrasFallo(INTENTOS_MAXIMOS) === null && esperaTrasFallo(7) === null)
  ok('con 0 intentos (no debería pasar) no revienta', esperaTrasFallo(0) === 3 * 60_000)
}

console.log('\n=== ¿hay algo que resumir? ===')
{
  ok('contar palabras', palabrasDe('  hola   buenas tardes ') === 3 && palabrasDe('') === 0 && palabrasDe('   ') === 0)
  ok('vacío = sin contenido', sinContenido('') && sinContenido('   '))
  ok('un «¿diga? no, perdone» = sin contenido', sinContenido('¿Diga? No, perdone, me he equivocado.'))
  ok(`justo en el mínimo (${PALABRAS_MINIMAS}) ya es contenido`, !sinContenido(Array(PALABRAS_MINIMAS).fill('palabra').join(' ')))
  ok(`uno menos que el mínimo no`, sinContenido(Array(PALABRAS_MINIMAS - 1).fill('palabra').join(' ')))
}

console.log('\n=== nombre de pila ===')
{
  ok('solo la primera palabra', primerNombre('Maoli García Pérez') === 'Maoli')
  ok('limpia saltos y espacios', primerNombre('  Ana\n María ') === 'Ana')
  ok('vacío o nulo -> null', primerNombre('') === null && primerNombre(null) === null && primerNombre(undefined) === null && primerNombre('   ') === null)
}

console.log('\n=== las pistas para el oído de la IA ===')
{
  const p = pistasDeLaLlamada({ empresa: 'Joe Black Pets', comercial: 'Maoli García' })
  ok('palabras: la marca, Amazon y la tienda', p.palabras === 'Liberty Seller, Amazon, Joe Black Pets', p.palabras)
  ok('el contexto nombra al comercial y a la tienda', p.prompt.includes('Maoli, comercial') && p.prompt.includes('Joe Black Pets') && p.prompt.includes('Liberty Seller'))
  ok('el contexto no lleva el apellido', !p.prompt.includes('García'))

  const rara = pistasDeLaLlamada({ empresa: 'Casa <Paco>\ny Hijos, S.L.', comercial: null })
  ok('sin < > ni saltos de línea ni comas en las palabras (la API rechaza la petición entera)', !/[<>\r\n]/.test(rara.palabras) && rara.palabras.split(', ').length === 3, rara.palabras)
  ok('sin comercial: «un comercial»', rara.prompt.includes('un comercial de Liberty Seller'))

  const sin = pistasDeLaLlamada({ empresa: null, comercial: null })
  ok('sin tienda no se inventa una palabra', sin.palabras === 'Liberty Seller, Amazon' && sin.prompt.includes('una empresa'))

  const larga = pistasDeLaLlamada({ empresa: 'X'.repeat(500), comercial: 'Y'.repeat(500) })
  ok('con nombres larguísimos el contexto cabe y la palabra se recorta', larga.prompt.length <= 300 && larga.palabras.length <= 'Liberty Seller, Amazon, '.length + 60, `${larga.prompt.length}/${larga.palabras.length}`)

  const repetida = pistasDeLaLlamada({ empresa: 'Amazon', comercial: null })
  ok('una palabra repetida no sale dos veces', repetida.palabras === 'Liberty Seller, Amazon', repetida.palabras)
}

console.log('\n=== precios ===')
{
  ok('73 s con gpt-transcribe = 0,005475 $ (lo que cobró la prueba)', cerca(costeDeVoz('gpt-transcribe', 73), (73 / 60) * 0.0045))
  ok('un minuto del mini cuesta 0,003', cerca(costeDeVoz('gpt-4o-mini-transcribe', 60), 0.003))
  ok('un modelo desconocido se cuenta al precio MÁS ALTO (el tope salta antes, no después)', cerca(costeDeVoz('modelo-nuevo', 60), 0.006))
  ok('segundos negativos no restan', costeDeVoz('gpt-transcribe', -50) === 0)

  // La prueba real: 981 tokens de entrada y 489 de salida con gpt-6-luna = 0,00034 $
  ok('texto: gpt-6-luna con 981/489 tokens ≈ 0,00034 $', cerca(costeDeTexto('gpt-6-luna', 981, 489), (981 * 0.1 + 489 * 0.5) / 1e6) && Math.round(costeDeTexto('gpt-6-luna', 981, 489) * 100000) === 34)
  ok('texto: un modelo desconocido va al precio más alto', cerca(costeDeTexto('gpt-x', 1_000_000, 0), 5))

  ok('formato de dinero', enDolares(0.0345) === '0,034 $' || enDolares(0.0345) === '0,035 $', enDolares(0.0345))
  ok('formato: grande con dos decimales', enDolares(1.8) === '1,80 $')
  ok('formato: pequeño con cuatro decimales', enDolares(0.00034) === '0,0003 $', enDolares(0.00034))
  ok('formato: cero', enDolares(0) === '0,0000 $')
}

console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
