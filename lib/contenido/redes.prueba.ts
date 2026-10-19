import {
  INFO_RED,
  REDES,
  caracteres,
  componer,
  contarHashtags,
  estadoDeRed,
  nivelLongitud,
  normalizarHashtags,
  redesEsperadas,
} from '@/lib/contenido/redes'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

console.log('\n=== dónde se publica cada cosa ===')
ok('un vídeo va a las cuatro redes', redesEsperadas('video').join() === 'linkedin,instagram,tiktok,facebook')
ok('un carrusel, solo a LinkedIn', redesEsperadas('carrusel').join() === 'linkedin')
ok('las cuatro tienen su ficha', REDES.every((r) => INFO_RED[r].limite > 0 && INFO_RED[r].nombre !== ''))
ok('Instagram limita a 5 hashtags y lo impone', INFO_RED.instagram.maxHashtags === 5 && INFO_RED.instagram.hashtagsDuros)
ok('TikTok recomienda 5 y no lo impone', INFO_RED.tiktok.maxHashtags === 5 && !INFO_RED.tiktok.hashtagsDuros)

console.log('\n=== contar caracteres ===')
ok('un texto normal', caracteres('hola') === 4)
ok('vacío', caracteres('') === 0)
ok('las tildes cuentan una', caracteres('Raúl Camuñas') === 12)
ok('un emoji cuenta como UNO (length de JS diría 2)', caracteres('🚀') === 1 && '🚀'.length === 2)
ok('un salto de línea cuenta uno', caracteres('a\nb') === 3)
ok('el euro y las comillas españolas', caracteres('1,20 € «x»') === 10)

console.log('\n=== componer lo que se pega ===')
ok('sin hashtags, el texto tal cual', componer('Hola', []) === 'Hola')
ok('con hashtags, en un párrafo aparte', componer('Hola', ['#a', '#b']) === 'Hola\n\n#a #b')
ok('se quitan los espacios y saltos del final', componer('Hola  \n\n', ['#a']) === 'Hola\n\n#a')
ok('los hashtags cuentan para el límite', caracteres(componer('Hola', ['#a', '#b'])) === 4 + 2 + 5)

console.log('\n=== hashtags ===')
ok('pone la almohadilla donde falta', normalizarHashtags('amazonfba ecommerce').join() === '#amazonfba,#ecommerce')
ok('acepta comas y espacios mezclados', normalizarHashtags('amazonfba, #ecommerce  ,#blackfriday').join() === '#amazonfba,#ecommerce,#blackfriday')
ok('quita los repetidos sin mirar mayúsculas', normalizarHashtags('#AmazonFBA #amazonfba #AMAZONFBA').join() === '#AmazonFBA')
ok('quita lo que no es letra ni número', normalizarHashtags('#amazon-fba #e!commerce').join() === '#amazonfba,#ecommerce')
ok('conserva las tildes y la ñ', normalizarHashtags('#logística #diseño').join() === '#logística,#diseño')
ok('una almohadilla suelta no es un hashtag', normalizarHashtags('# ## #a').join() === '#a')
ok('vacío', normalizarHashtags('').length === 0 && normalizarHashtags('   ').length === 0)
ok('acepta una lista', normalizarHashtags(['a', '#b', 'A']).join() === '#a,#b')
ok('con dos almohadillas pegadas', normalizarHashtags('##amazonfba').join() === '#amazonfba')

console.log('\n=== contar los hashtags de lo que se publica ===')
ok('los de la lista', contarHashtags('hola', ['#a', '#b']) === 2)
ok('los que van dentro del texto (LinkedIn)', contarHashtags('hola\n\n#amazonfba #ecommerce #amazonseller') === 3)
ok('lista y texto, sin contar dos veces el mismo', contarHashtags('hola #a #c', ['#A', '#b']) === 3)
ok('un hashtag pegado al principio del texto', contarHashtags('#amazonfba y más') === 1)
ok('con tildes y ñ', contarHashtags('#logística #diseño') === 2)
ok('«#1» no es un hashtag: no tiene letras', contarHashtags('el #1 de Amazon') === 0)
ok('«C#» no es un hashtag: va pegado a una letra', contarHashtags('programo en C# a diario') === 0)
ok('el «#top» de una dirección tampoco', contarHashtags('mira https://x.com/#top y https://x.com/a#b') === 0)
ok('una entidad HTML no lo es', contarHashtags('l&#39;amour') === 0)
ok('sin nada, cero', contarHashtags('') === 0 && contarHashtags('hola') === 0)
ok('con salto de línea delante', contarHashtags('hola\n#a\n#b') === 2)

console.log('\n=== el nivel de longitud ===')
ok('lejos del límite: ok', nivelLongitud(1000, 2200) === 'ok')
ok('justo al 90 %: ok', nivelLongitud(1980, 2200) === 'ok')
ok('pasado el 90 %: cerca', nivelLongitud(1981, 2200) === 'cerca')
ok('justo en el límite: cerca, todavía vale', nivelLongitud(2200, 2200) === 'cerca')
ok('uno por encima: pasa', nivelLongitud(2201, 2200) === 'pasa')

console.log('\n=== el estado de una red ===')
{
  const vacio = estadoDeRed('instagram', null)
  ok('sin texto: no tiene', !vacio.tiene && vacio.caracteres === 0 && vacio.nivel === 'ok')
  const enBlanco = estadoDeRed('instagram', { texto: '   \n ', hashtags: ['#a'] })
  ok('un texto en blanco tampoco cuenta como texto', !enBlanco.tiene)
  const bueno = estadoDeRed('instagram', { texto: 'x'.repeat(1000), hashtags: ['#a', '#b', '#c'] })
  ok('con texto: mide con los hashtags dentro', bueno.tiene && bueno.caracteres === 1000 + 2 + 8, String(bueno.caracteres))
  ok('el límite es el de la red', bueno.limite === 2200)
  ok('3 hashtags en Instagram: bien', !bueno.demasiadosHashtags)
  const muchos = estadoDeRed('instagram', { texto: 'hola', hashtags: ['#a', '#b', '#c', '#d', '#e', '#f'] })
  ok('6 hashtags en Instagram: demasiados', muchos.demasiadosHashtags && muchos.hashtags === 6)
  const largo = estadoDeRed('instagram', { texto: 'x'.repeat(2300), hashtags: [] })
  ok('un texto que se pasa', largo.nivel === 'pasa')
  const li = estadoDeRed('linkedin', { texto: 'hola', hashtags: ['#a', '#b', '#c', '#d', '#e', '#f', '#g'] })
  ok('LinkedIn no limita los hashtags', !li.demasiadosHashtags)
  const liDentro = estadoDeRed('linkedin', { texto: 'Hola\n\n#amazonfba #ecommerce', hashtags: [] })
  ok('LinkedIn cuenta los hashtags que lleva dentro del texto', liDentro.hashtags === 2, String(liDentro.hashtags))
  const igDentro = estadoDeRed('instagram', { texto: 'Hola #a #b #c', hashtags: ['#d', '#e', '#f'] })
  ok('los de dentro del texto también cuentan para el tope de Instagram', igDentro.hashtags === 6 && igDentro.demasiadosHashtags)
  ok('LinkedIn llega a 3.000', estadoDeRed('linkedin', { texto: 'x'.repeat(3000), hashtags: [] }).nivel === 'cerca' && estadoDeRed('linkedin', { texto: 'x'.repeat(3001), hashtags: [] }).nivel === 'pasa')
}

console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
