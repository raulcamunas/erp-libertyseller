import { ventasCompactas } from './cifras'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

console.log('\n=== las cifras compactas de la lista ===')
ok('menos de mil: tal cual', ventasCompactas(850) === '850 $' && ventasCompactas(1) === '1 $')
ok('miles: «k$»', ventasCompactas(24_000) === '24 k$' && ventasCompactas(1_000) === '1 k$' && ventasCompactas(24_499) === '24 k$')
ok('miles redondeados al más cercano', ventasCompactas(24_500) === '25 k$' && ventasCompactas(793_590) === '794 k$')
ok('millones: «M$» con un decimal', ventasCompactas(1_200_000) === '1,2 M$' && ventasCompactas(5_000_000) === '5 M$' && ventasCompactas(12_345_678) === '12,3 M$')
ok('el borde de los millones no enseña «1000 k$»', ventasCompactas(999_600) === '1 M$' && ventasCompactas(999_400) === '999 k$', `${ventasCompactas(999_600)} ${ventasCompactas(999_400)}`)
ok('los números que llegan como texto de la base se entienden', ventasCompactas('793590') === '794 k$' && ventasCompactas('24000.5') === '24 k$')
ok('sin cifra, nada (ni guion ni cero)', ventasCompactas(null) === null && ventasCompactas(undefined) === null && ventasCompactas('') === null && ventasCompactas(0) === null && ventasCompactas(-5) === null)
ok('lo que no es número, nada', ventasCompactas('abc') === null && ventasCompactas(NaN) === null && ventasCompactas(Infinity) === null)

console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
