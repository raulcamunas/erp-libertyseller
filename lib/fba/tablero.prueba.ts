import { aTarjeta, agruparPorColumna, columnaDe, filtrarTablero, semaforoDelPlazo, textoDelPlazo, type FilaDeTablero } from './tablero'

let fallos = 0
const ok = (n: string, real: unknown, esp: unknown) => {
  const bien = JSON.stringify(real) === JSON.stringify(esp)
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK  ' : 'FALLA'} ${n}${bien ? '' : ` -> esperado ${JSON.stringify(esp)}, real ${JSON.stringify(real)}`}`)
}

const HOY = '2026-11-14'
const fila = (o: Partial<FilaDeTablero>): FilaDeTablero => ({
  id: 'r1',
  clienteId: 'c1',
  clienteNombre: 'Opinas',
  nombre: 'Envío noviembre',
  fechaEnvio: '2026-11-20',
  estado: 'borrador',
  actualizadaAt: '2026-11-10T10:00:00Z',
  propuestaEnviadaAt: null,
  clienteAceptoAt: null,
  referencias: 3,
  unidades: 40,
  cajas: 0,
  ...o,
})

console.log('\n=== COLUMNAS ===')
ok('borrador sin mandar = montando', columnaDe({ estado: 'borrador', propuestaEnviadaAt: null, clienteAceptoAt: null }), 'montando')
ok('mandada = con el cliente', columnaDe({ estado: 'borrador', propuestaEnviadaAt: 'x', clienteAceptoAt: null }), 'con_el_cliente')
ok('aceptada = revisar', columnaDe({ estado: 'borrador', propuestaEnviadaAt: 'x', clienteAceptoAt: 'y' }), 'revision')
ok('encajando', columnaDe({ estado: 'encajando', propuestaEnviadaAt: null, clienteAceptoAt: null }), 'encajando')
ok('enviada no está en el tablero', columnaDe({ estado: 'enviada', propuestaEnviadaAt: null, clienteAceptoAt: null }), null)

console.log('\n=== PLAZO ===')
ok('vencido', semaforoDelPlazo('2026-11-10', HOY), { semaforo: 'vencido', dias: -4 })
ok('cerca', semaforoDelPlazo('2026-11-16', HOY).semaforo, 'cerca')
ok('hoy cuenta como cerca', semaforoDelPlazo(HOY, HOY).semaforo, 'cerca')
ok('lejos', semaforoDelPlazo('2026-12-01', HOY).semaforo, 'ok')
ok('textos', [textoDelPlazo(-3), textoDelPlazo(-1), textoDelPlazo(0), textoDelPlazo(1), textoDelPlazo(9)], ['Vencido hace 3 días', 'Vencido ayer', 'Sale hoy', 'Sale mañana', 'Sale en 9 días'])

console.log('\n=== TARJETAS ===')
const t1 = aTarjeta(fila({ propuestaEnviadaAt: 'x', clienteAceptoAt: 'y' }), HOY)!
ok('la aceptada le toca a la agencia', t1.quien, 'agencia')
ok('días parada', t1.diasParada, 4)
const t2 = aTarjeta(fila({ id: 'r2', estado: 'encajando', fechaEnvio: '2026-11-12', clienteNombre: 'Cobo' }), HOY)!
ok('encajando le toca al cliente', t2.quien, 'cliente')
const t3 = aTarjeta(fila({ id: 'r3', estado: 'lista', fechaEnvio: '2026-12-01', nombre: 'Navidad' }), HOY)!
ok('ordena por plazo', filtrarTablero([t3, t1, t2], {}).map((t) => t.id), ['r2', 'r1', 'r3'])
ok('solo mías (agencia)', filtrarTablero([t1, t2, t3], { soloMias: 'agencia' }).map((t) => t.id), ['r1', 'r3'])
ok('solo vencidas', filtrarTablero([t1, t2, t3], { soloVencidas: true }).map((t) => t.id), ['r2'])
ok('buscar por cliente', filtrarTablero([t1, t2, t3], { texto: 'cobo' }).map((t) => t.id), ['r2'])
ok('buscar por nombre', filtrarTablero([t1, t2, t3], { texto: 'navidad' }).map((t) => t.id), ['r3'])
const g = agruparPorColumna([t1, t2, t3])
ok('agrupa', [g.revision.length, g.encajando.length, g.lista.length, g.montando.length], [1, 1, 1, 0])

console.log(fallos === 0 ? '\n  TODO CORRECTO\n' : `\n  ${fallos} FALLOS\n`)
process.exit(fallos === 0 ? 0 : 1)
