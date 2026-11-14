import { textoDelAviso } from './avisos'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/** EL AVISO DEL LUNES Y DEL JUEVES AL RESPONSABLE DE UNA CUENTA */
const base = { nombre: 'Opinas', semana: 2 as const, pendientes: ['Resolver lo que bloquea la venta', 'Auditoría de visibilidad', 'Informe quincenal al cliente'], propuestas: 6, recuperable: 32, moneda: 'EUR', fichasConStock: 11 }

const l = textoDelAviso({ ...base, dia: 'lunes' })
ok('el lunes dice la semana en el título', l?.titulo === 'Opinas · S2 · quincenal', l?.titulo)
ok('y los pasos de la semana', !!l?.mensaje.startsWith('Esta semana: resolver lo que bloquea la venta, auditoría de visibilidad y informe quincenal al cliente.'), l?.mensaje)
ok('y lo que ya espera, con el dinero sin vender', !!l?.mensaje.includes('6 propuestas de PPC por revisar (32') && !!l?.mensaje.includes('11 fichas con stock'), l?.mensaje)
ok('poco dinero sin vender no se menciona', !textoDelAviso({ ...base, dia: 'lunes', recuperable: 3 })?.mensaje.includes('sin vender'))

const j = textoDelAviso({ ...base, dia: 'jueves' })
ok('el jueves cuenta lo que falta', j?.titulo === 'Opinas: te quedan 3 pasos de la S2', j?.titulo)
ok('el jueves con todo hecho no avisa', textoDelAviso({ ...base, dia: 'jueves', pendientes: [] }) === null)
ok('un paso: singular', textoDelAviso({ ...base, dia: 'jueves', pendientes: ['Informe quincenal al cliente'] })?.titulo === 'Opinas: te queda 1 paso de la S2')

ok('sin ciclo, el lunes pide elegirlo', !!textoDelAviso({ ...base, dia: 'lunes', semana: null })?.titulo.includes('elige cuándo empieza su ciclo'))
ok('sin ciclo, el jueves no insiste', textoDelAviso({ ...base, dia: 'jueves', semana: null }) === null)
ok('una propuesta y una ficha: singular', !!textoDelAviso({ ...base, dia: 'lunes', propuestas: 1, fichasConStock: 1 })?.mensaje.match(/1 propuesta de PPC.*1 ficha con stock/), textoDelAviso({ ...base, dia: 'lunes', propuestas: 1, fichasConStock: 1 })?.mensaje)

console.log(fallos ? `\n${fallos} FALLOS\n` : '\nTodo bien\n')
if (fallos) process.exit(1)
