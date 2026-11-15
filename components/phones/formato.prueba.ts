import { formatoTelefono, separarNumeros } from './formato'

let fallos = 0
const ok = (n: string, c: boolean) => {
  console.log(`${c ? 'OK   ' : 'FALLA'} ${n}`)
  if (!c) fallos++
}
const igual = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

ok('9 cifras agrupadas', formatoTelefono('623973018') === '623 973 018')
ok('con +34', formatoTelefono('+34623973018') === '+34 623 973 018')
ok('con 0034 y espacios', formatoTelefono('0034 623 97 30 18') === '+34 623 973 018')
ok('con guiones pegados', formatoTelefono('623-973-018') === '623 973 018')
ok('lo que no es un número se deja', formatoTelefono('amazon@libertyupgrowth.com') === 'amazon@libertyupgrowth.com')
ok('número corto se deja', formatoTelefono('12345') === '12345')
ok('dos números con « - »', igual(separarNumeros('621099518 - 650612345'), ['621099518', '650612345']))
ok('barra, coma y «y»', igual(separarNumeros('621 / 622, 623 y 624'), ['621', '622', '623', '624']))
ok('guiones pegados = un número', igual(separarNumeros('623-973-018'), ['623-973-018']))
ok('vacío = nada', igual(separarNumeros('   '), []))

if (fallos) {
  console.log(`\n${fallos} fallos`)
  process.exit(1)
}
console.log('\nTodo bien')
