import { atajoDeMarkdown, borrar, cambiarTipo, dividir, insertarDespues, mover, numeracion, retrocederAlInicio, sangrar } from '@/lib/tareas-clientes/edicion'
import { textoDe, type Bloque } from '@/lib/tareas-clientes/bloques'

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

const b = (id: string, tipo: Bloque['tipo'], t = '', extra: Partial<Bloque> = {}): Bloque => ({ id, tipo, texto: t ? [{ t }] : [], ...extra })
const textos = (l: Bloque[]) => l.map((x) => `${x.tipo}:${textoDe(x.texto)}`)
const t = (s: string) => [{ t: s }]

/* dividir */
let r = dividir([b('a', 'parrafo', 'HolaMundo')], 'a', t('Hola'), t('Mundo'))
igual('Enter parte un párrafo en dos', textos(r.bloques), ['parrafo:Hola', 'parrafo:Mundo'])
igual('y el cursor va al principio del nuevo', r.cursor && { pos: r.cursor.posicion, nuevo: r.cursor.id !== 'a' }, { pos: 'inicio', nuevo: true })
r = dividir([b('a', 'tarea', 'Hacer', { hecho: true })], 'a', t('Hacer'), [])
igual('una casilla sigue con otra casilla SIN marcar', [r.bloques[1].tipo, r.bloques[1].hecho], ['tarea', false])
r = dividir([b('a', 'h1', 'Título')], 'a', t('Título'), [])
igual('un título abre un párrafo', r.bloques.map((x) => x.tipo), ['h1', 'parrafo'])
r = dividir([b('a', 'vineta', '')], 'a', [], [])
igual('una viñeta vacía sale de la lista', r.bloques.map((x) => x.tipo), ['parrafo'])
r = dividir([b('a', 'vineta', ''), ], 'a', [], [])
r = dividir([b('a', 'vineta', 'x'), b('b', 'vineta', '', { nivel: 1 })], 'b', [], [])
igual('una viñeta vacía sangrada sube un nivel', r.bloques[1].nivel, 0)
r = dividir([b('a', 'vineta', 'x', { nivel: 1 })], 'a', t('x'), t('y'))
igual('el elemento nuevo conserva la sangría', r.bloques[1].nivel, 1)

/* retroceso */
r = retrocederAlInicio([b('a', 'h2', 'Hola')], 'a')
igual('Retroceso en un título lo vuelve párrafo', textos(r.bloques), ['parrafo:Hola'])
r = retrocederAlInicio([b('a', 'parrafo', 'Hola '), b('b', 'parrafo', 'mundo')], 'b')
igual('Retroceso en un párrafo lo une con el anterior', [textos(r.bloques), r.cursor?.id, r.cursor?.posicion], [['parrafo:Hola mundo'], 'a', 5])
r = retrocederAlInicio([b('a', 'divisor'), b('b', 'parrafo', 'x')], 'b')
igual('con un divisor encima, lo quita', r.bloques.map((x) => x.id), ['b'])
r = retrocederAlInicio([b('a', 'notion', '', { notion_tipo: 'table', vista: 'Tabla' }), b('b', 'parrafo', 'x')], 'b')
igual('con un bloque ajeno encima no hace nada', r.bloques.map((x) => x.id), ['a', 'b'])
r = retrocederAlInicio([b('a', 'parrafo', 'x')], 'a')
igual('el primero no se une con nada', r.bloques.length, 1)
r = retrocederAlInicio([b('a', 'parrafo', 'x'), b('b', 'parrafo', 'y', { nivel: 1 })], 'b')
igual('un párrafo sangrado primero sube de nivel', [r.bloques.length, r.bloques[1].nivel], [2, 0])

/* sangría */
const lista = [b('a', 'vineta', 'a'), b('b', 'vineta', 'b'), b('c', 'vineta', 'c')]
igual('el primero no se sangra', sangrar(lista, 'a', 1)[0].nivel, undefined)
igual('el segundo se sangra bajo el primero', sangrar(lista, 'b', 1)[1].nivel, 1)
igual('el tercero no puede ir dos más hondo que el de arriba', sangrar(sangrar(lista, 'b', 1), 'c', 1)[2].nivel, 1)
igual('quitar sangría', sangrar(sangrar(lista, 'b', 1), 'b', -1)[1].nivel, undefined)
igual('un título no se sangra', sangrar([b('a', 'parrafo', 'x'), b('b', 'h1', 'y')], 'b', 1)[1].nivel, undefined)

/* tipo, insertar, borrar, mover */
igual('cambiar a casilla conserva el texto y la deja sin marcar', cambiarTipo([b('a', 'parrafo', 'x')], 'a', 'tarea').map((x) => [x.tipo, x.hecho, textoDe(x.texto)]), [['tarea', false, 'x']])
igual('cambiar de casilla a párrafo quita la marca', cambiarTipo([b('a', 'tarea', 'x', { hecho: true })], 'a', 'parrafo')[0].hecho, undefined)
igual('un bloque ajeno no cambia de tipo', cambiarTipo([b('a', 'notion', '', { vista: 'Tabla' })], 'a', 'parrafo')[0].tipo, 'notion')
igual('cambiar a divisor vacía el texto', cambiarTipo([b('a', 'parrafo', 'x')], 'a', 'divisor')[0].texto, [])
igual('insertar después', insertarDespues([b('a', 'parrafo', 'a'), b('c', 'parrafo', 'c')], 'a', b('b', 'parrafo', 'b')).map((x) => x.id), ['a', 'b', 'c'])
igual('insertar sin referencia, al final', insertarDespues([b('a', 'parrafo', 'a')], null, b('z', 'parrafo', 'z')).map((x) => x.id), ['a', 'z'])
igual('borrar', borrar([b('a', 'parrafo', 'a'), b('b', 'parrafo', 'b')], 'a').map((x) => x.id), ['b'])
igual('un bloque de Notion no se borra desde aquí', borrar([b('a', 'notion', '', { vista: 'Tabla' })], 'a').length, 1)
igual('mover', mover([b('a', 'parrafo'), b('b', 'parrafo'), b('c', 'parrafo')], 0, 2).map((x) => x.id), ['b', 'c', 'a'])
igual('mover fuera de rango no hace nada', mover([b('a', 'parrafo')], 0, 5).map((x) => x.id), ['a'])

/* numeración */
igual('numera seguidos y reinicia tras otro bloque', numeracion([b('a', 'numerada'), b('b', 'numerada'), b('c', 'parrafo'), b('d', 'numerada')]), [1, 2, null, 1])
igual('los de dentro empiezan de nuevo', numeracion([b('a', 'numerada'), b('b', 'numerada', '', { nivel: 1 }), b('c', 'numerada', '', { nivel: 1 }), b('d', 'numerada')]), [1, 1, 2, 2])

/* atajos */
igual('«# » es un título', atajoDeMarkdown('# Plan'), { tipo: 'h1', resto: 'Plan' })
igual('«### » un título 3', atajoDeMarkdown('### '), { tipo: 'h3', resto: '' })
igual('«- » una viñeta', atajoDeMarkdown('- cosas'), { tipo: 'vineta', resto: 'cosas' })
igual('«1. » una lista numerada', atajoDeMarkdown('1. uno'), { tipo: 'numerada', resto: 'uno' })
igual('«[] » una casilla', atajoDeMarkdown('[] hacer'), { tipo: 'tarea', resto: 'hacer', extra: { hecho: false } })
igual('«[x] » una casilla marcada', atajoDeMarkdown('[x] hecho')?.extra, { hecho: true })
igual('«> » una cita', atajoDeMarkdown('> frase'), { tipo: 'cita', resto: 'frase' })
igual('«---» un divisor', atajoDeMarkdown('---'), { tipo: 'divisor', resto: '' })
igual('un guion pegado a la palabra no es lista', atajoDeMarkdown('-hola'), null)
igual('texto normal, nada', atajoDeMarkdown('Hola mundo'), null)

console.log(`\n${comprobaciones - fallos}/${comprobaciones} bien`)
if (fallos > 0) process.exit(1)
