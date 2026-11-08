import { bloqueNuevo, textoDe, type Bloque } from '@/lib/tareas-clientes/bloques'
import { separarCuerpo, tieneContenido, TITULO_DE_LA_LISTA, unirCuerpo } from '@/lib/tareas-clientes/cuerpo'

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
const B = (id: string, tipo: Parameters<typeof bloqueNuevo>[0], texto: string, extra: Partial<Bloque> = {}): Bloque => ({ ...bloqueNuevo(tipo, texto), id, notion_id: `n-${id}`, ...extra })
const ids = (l: readonly Bloque[]) => l.map((b) => b.id)

// La forma de siempre: lista, «Contexto», párrafos
const cuerpo = [B('h', 'h1', TITULO_DE_LA_LISTA), B('t1', 'tarea', 'Uno'), B('t2', 'tarea', 'Dos', { hecho: true }), B('c', 'h2', 'Contexto'), B('p1', 'parrafo', 'Porque sí'), B('p2', 'parrafo', 'Y más')]
const s = separarCuerpo(cuerpo)
igual('separa lista y contexto, sin los encabezados', [ids(s.lista), ids(s.contexto), s.cabeceraLista?.id, s.cabeceraContexto?.id, s.hayLista], [['t1', 't2'], ['p1', 'p2'], 'h', 'c', true])
igual('juntar sin tocar nada devuelve lo mismo', ids(unirCuerpo(s, s.lista, s.contexto)), ids(cuerpo))
igual('los encabezados conservan su id de Notion', unirCuerpo(s, s.lista, s.contexto).filter((b) => b.tipo !== 'parrafo' && b.tipo !== 'tarea').map((b) => b.notion_id), ['n-h', 'n-c'])

// Añadir una tarea y escribir un párrafo nuevo en el contexto
const nueva = B('t3', 'tarea', 'Tres')
const parrafoNuevo = bloqueNuevo('parrafo', 'Nuevo')
const r = unirCuerpo(s, [...s.lista, nueva], [...s.contexto, parrafoNuevo])
igual('una tarea nueva entra en la lista y un párrafo nuevo en el contexto (detrás)', ids(r).slice(0, 7), ['h', 't1', 't2', 't3', 'c', 'p1', 'p2'])
igual('…y el párrafo nuevo al final', r[r.length - 1].id, parrafoNuevo.id)

// Quitar todas las tareas: desaparece el encabezado de la lista
const sinLista = unirCuerpo(s, [], s.contexto)
igual('sin tareas no queda el encabezado de la lista', ids(sinLista), ['c', 'p1', 'p2'])
igual('el contexto conserva su encabezado (ya lo tenía)', sinLista[0].tipo, 'h2')

// Cuerpo sin lista: la primera tarea crea el encabezado y va ARRIBA
const libre = [B('a', 'parrafo', 'Notas sueltas'), B('b', 'parrafo', 'Más notas')]
const sl = separarCuerpo(libre)
igual('sin casillas, todo es contexto', [sl.hayLista, ids(sl.contexto), sl.lista.length], [false, ['a', 'b'], 0])
const conPrimera = unirCuerpo(sl, [bloqueNuevo('tarea', 'Primera')], sl.contexto)
igual('la primera tarea nace con su encabezado, arriba, y el contexto pasa a llevar el suyo', [conPrimera[0].tipo, textoDe(conPrimera[0].texto), conPrimera[1].tipo, conPrimera[2].tipo, textoDe(conPrimera[2].texto), ids(conPrimera).slice(3)], ['h1', TITULO_DE_LA_LISTA, 'tarea', 'h2', 'Contexto', ['a', 'b']])
igual('sin lista ni tareas nuevas el cuerpo no cambia (no se inventan encabezados)', ids(unirCuerpo(sl, [], sl.contexto)), ['a', 'b'])

// Contexto ANTES de la lista: cada cosa en su sitio
const invertido = [B('x', 'parrafo', 'Intro'), B('h', 'h1', 'Lista de tareas'), B('t1', 'tarea', 'Uno'), B('y', 'parrafo', 'Cierre')]
const si = separarCuerpo(invertido)
igual('lo de antes de la lista sigue antes', ids(unirCuerpo(si, si.lista, si.contexto)), ['x', 'h', 't1', 'y'])
const nuevoEntre = bloqueNuevo('parrafo', 'tras la intro')
igual('un bloque nuevo escrito tras el de arriba va arriba', ids(unirCuerpo(si, si.lista, [si.contexto[0], nuevoEntre, si.contexto[1]])), ['x', nuevoEntre.id, 'h', 't1', 'y'])
const alFinal = bloqueNuevo('parrafo', 'tras el cierre')
igual('y uno tras el de abajo va abajo', ids(unirCuerpo(si, si.lista, [...si.contexto, alFinal])), ['x', 'h', 't1', 'y', alFinal.id])

// Lista sin contexto: escribir en el contexto no se cuela por encima de las casillas
const soloLista = [B('h', 'h1', TITULO_DE_LA_LISTA), B('t1', 'tarea', 'Uno')]
const ss = separarCuerpo(soloLista)
const escrito = bloqueNuevo('parrafo', 'Contexto nuevo')
const tras = unirCuerpo(ss, ss.lista, [escrito])
igual('el contexto nuevo va debajo de la lista, con su encabezado', [ids(tras).slice(0, 2), tras[2].tipo, textoDe(tras[2].texto), tras[3].id], [['h', 't1'], 'h2', 'Contexto', escrito.id])
igual('un párrafo en blanco no crea encabezado', ids(unirCuerpo(ss, ss.lista, [bloqueNuevo('parrafo', '')])).length, 3)

// El contexto nace en dos pasos: primero un párrafo en blanco y luego el texto (como hace el editor): el encabezado aparece cuando hay texto
const enBlanco = bloqueNuevo('parrafo', '')
const paso1 = unirCuerpo(ss, ss.lista, [enBlanco])
const sp = separarCuerpo(paso1)
const paso2 = unirCuerpo(sp, sp.lista, [{ ...sp.contexto[0], texto: [{ t: 'Ya hay texto' }] }])
igual('un párrafo en blanco primero y el texto después: sale el encabezado «Contexto»', [paso1.length, paso2.map((b) => b.tipo), textoDe(paso2[2].texto)], [3, ['h1', 'tarea', 'h2', 'parrafo'], 'Contexto'])

// Casillas dispersas: solo la primera tanda es «la lista»; las demás quedan en el contexto, editables
const dispersas = [B('t1', 'tarea', 'Uno'), B('p', 'parrafo', 'Texto'), B('t2', 'tarea', 'Otra suelta')]
const sd = separarCuerpo(dispersas)
igual('la segunda tanda de casillas se queda en el contexto', [ids(sd.lista), ids(sd.contexto)], [['t1'], ['p', 't2']])
igual('y vuelve a su sitio', ids(unirCuerpo(sd, sd.lista, sd.contexto)), ['t1', 'p', 't2'])

igual('nada que ver: cuerpo vacío', [separarCuerpo([]).hayLista, unirCuerpo(separarCuerpo([]), [], [])], [false, []])
igual('tieneContenido', [tieneContenido([]), tieneContenido([bloqueNuevo('parrafo', '  ')]), tieneContenido([bloqueNuevo('parrafo', 'x')]), tieneContenido([bloqueNuevo('divisor')])], [false, false, true, true])

console.log(`\n${fallos === 0 ? 'TODO BIEN' : `HAY ${fallos} FALLOS`} (${comprobaciones} comprobaciones)`)
process.exit(fallos === 0 ? 0 : 1)
