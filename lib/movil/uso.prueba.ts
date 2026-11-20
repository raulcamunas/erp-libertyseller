import { conFijada, cuentaA, leerIdsDe, leerUsoDe, ordenarMasUsadas, ordenarRecientes, puntuar, sumarApertura, MAX_FIJADAS, type Uso } from '@/lib/movil/uso'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}
const DIA = 24 * 60 * 60 * 1000
const T0 = Date.UTC(2026, 10, 1)

console.log('\n=== la cuenta con olvido semanal ===')
{
  let u: Uso = {}
  u = sumarApertura(u, 'correo', T0)
  ok('la primera apertura vale 1', cuentaA(u.correo, T0) === 1)
  u = sumarApertura(u, 'correo', T0)
  ok('dos seguidas valen 2', Math.abs(cuentaA(u.correo, T0) - 2) < 1e-9)
  ok('a la semana vale la mitad', Math.abs(cuentaA(u.correo, T0 + 7 * DIA) - 1) < 1e-9)
  u = sumarApertura(u, 'correo', T0 + 7 * DIA)
  ok('abrir a la semana: mitad + 1', Math.abs(u.correo.n - 2) < 1e-9 && u.correo.t === T0 + 7 * DIA)
  ok('no cambia el que recibe', sumarApertura(u, 'agenda', T0).correo === u.correo && !('agenda' in u))
  const viejo = sumarApertura({ crm: { n: 1, t: T0 - 70 * DIA } }, 'correo', T0)
  ok('lo que ya no cuenta se tira', !('crm' in viejo))
  ok('una hora rara (futuro) no da más de lo que hay', cuentaA({ n: 3, t: T0 + DIA }, T0) === 3)
  ok('sin datos: 0', cuentaA(undefined, T0) === 0)
}

console.log('\n=== puntuar, recientes y más usadas ===')
{
  const u: Uso = {
    correo: { n: 10, t: T0 - 14 * DIA }, // hoy vale 2,5
    agenda: { n: 3, t: T0 - DIA },
    crm: { n: 3, t: T0 },
    chat: { n: 1, t: T0 - 2 * DIA },
  }
  const p = puntuar(u, T0)
  ok('puntuar aplica el olvido', Math.abs(p.correo - 2.5) < 1e-9)
  ok('más usadas: por puntos y a igualdad la más reciente', JSON.stringify(ordenarMasUsadas(u, T0, 3, ['correo', 'agenda', 'crm', 'chat'])) === JSON.stringify(['crm', 'agenda', 'correo']), JSON.stringify(ordenarMasUsadas(u, T0, 3, ['correo', 'agenda', 'crm', 'chat'])))
  ok('más usadas: solo las visibles', JSON.stringify(ordenarMasUsadas(u, T0, 3, ['chat', 'correo'])) === JSON.stringify(['correo', 'chat']))
  ok('recientes: por la última apertura', JSON.stringify(ordenarRecientes(u, 2)) === JSON.stringify(['crm', 'agenda']))
  ok('recientes: solo las visibles', JSON.stringify(ordenarRecientes(u, 4, ['chat', 'correo'])) === JSON.stringify(['chat', 'correo']))
  ok('recientes: n = 0', ordenarRecientes(u, 0).length === 0)
}

console.log('\n=== lo que viene del almacenamiento ===')
{
  ok('vacío o roto: nada', Object.keys(leerUsoDe(null)).length === 0 && Object.keys(leerUsoDe('{roto')).length === 0 && Object.keys(leerUsoDe('[1,2]')).length === 0)
  const u = leerUsoDe(JSON.stringify({ a: { n: 2, t: 5 }, b: { n: 'x', t: 1 }, c: null, d: { n: -1, t: 1 } }))
  ok('se queda solo lo bueno', JSON.stringify(Object.keys(u)) === JSON.stringify(['a']))
  ok('ids: sin repetidos ni basura', JSON.stringify(leerIdsDe('["a","a",3,"","b"]')) === JSON.stringify(['a', 'b']))
  ok('ids: con tope', leerIdsDe('["a","b","c","d"]', 3).length === 3)
  ok('ids: roto', leerIdsDe('nope').length === 0)
}

console.log('\n=== fijar ===')
{
  ok('se añade al final', JSON.stringify(conFijada(['a'], 'b')) === JSON.stringify(['a', 'b']))
  ok('fijar otra vez la mueve al final', JSON.stringify(conFijada(['a', 'b'], 'a')) === JSON.stringify(['b', 'a']))
  ok(`como mucho ${MAX_FIJADAS}: sale la más antigua`, JSON.stringify(conFijada(['a', 'b', 'c'], 'd')) === JSON.stringify(['b', 'c', 'd']))
}

console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
