import { tablaDePersonas } from '@/lib/tareas-clientes/notion/personas'

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

const perfiles = [
  { id: 'p-raul', nombre: 'Raúl Camuñas' },
  { id: 'p-dani', nombre: 'Daniella ' },
  { id: 'p-pat', nombre: 'Patricia Angulo' },
  { id: 'p-maria1', nombre: 'Maria' },
  { id: 'p-maria2', nombre: 'Maria' },
]
const t = tablaDePersonas(perfiles, [{ perfil_id: 'p-pat', notion_user_id: 'n-pat' }])
igual('un enlace confirmado manda, aunque el nombre no coincida', t.deNotion('n-pat', 'P. A.'), 'p-pat')
igual('el nombre completo, sin mirar tildes ni mayúsculas', t.deNotion('n-raul', 'raul camunas'), 'p-raul')
igual('el nombre de pila si en el ERP solo se llama así y es único', t.deNotion('n-dani', 'Daniella Villarroel'), 'p-dani')
igual('dos con el mismo nombre de pila: no se adivina', t.deNotion('n-maria', 'Maria Lopez'), null)
igual('alguien que no está en el ERP: ninguno', t.deNotion('n-ext', 'Carlos Externo'), null)
igual('sin nombre y sin enlace: ninguno', t.deNotion('n-x', null), null)
igual('los enlaces deducidos por nombre se apuntan para guardarlos', t.nuevos.map((n) => `${n.perfil_id}:${n.notion_user_id}`), ['p-raul:n-raul', 'p-dani:n-dani'])
igual('y ya valen para escribir hacia Notion', [t.haciaNotion('p-raul'), t.haciaNotion('p-dani'), t.haciaNotion('p-pat'), t.haciaNotion('p-maria1')], ['n-raul', 'n-dani', 'n-pat', null])
igual('la segunda vez el mismo id ya está resuelto y no se vuelve a apuntar', [t.deNotion('n-raul', 'otro nombre'), t.nuevos.length], ['p-raul', 2])

console.log(`\n${comprobaciones - fallos}/${comprobaciones} bien`)
if (fallos > 0) process.exit(1)
