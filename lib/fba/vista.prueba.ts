import { diasEntre, esEnvio, esPropuesta, estaEnCamino, estaEnlazada, fechasDePasos, haceCuanto, indicePasoAmazon, leToca, turnoDe } from './vista'

let fallos = 0
function ok(nombre: string, real: unknown, esperado: unknown) {
  const bien = JSON.stringify(real) === JSON.stringify(esperado)
  if (!bien) fallos += 1
  console.log(`  ${bien ? 'OK  ' : 'FALLA'}  ${nombre}${bien ? '' : ` → ${JSON.stringify(real)} (esperado ${JSON.stringify(esperado)})`}`)
}

console.log('=== ENVÍOS Y PROPUESTAS ===')
ok('enviada y cerrada son envíos', [esEnvio({ estado: 'enviada' }), esEnvio({ estado: 'cerrada' })], [true, true])
ok('el resto son propuestas', (['borrador', 'aprobada', 'encajando', 'lista'] as const).map((e) => esPropuesta({ estado: e })), [true, true, true, true])
ok('un envío nunca es propuesta', esPropuesta({ estado: 'cerrada' }), false)
ok('enlazada = tiene número', [estaEnlazada({ referenciaEnvio: 'FBA15ML7ZSVQ' }), estaEnlazada({ referenciaEnvio: null }), estaEnlazada({ referenciaEnvio: '  ' })], [true, false, false])

console.log('=== EL RECORRIDO DE AMAZON ===')
ok('WORKING y READY_TO_SHIP son «creado»', [indicePasoAmazon('WORKING'), indicePasoAmazon('READY_TO_SHIP')], [0, 0])
ok('SHIPPED e IN_TRANSIT son el mismo paso', [indicePasoAmazon('SHIPPED'), indicePasoAmazon('IN_TRANSIT')], [1, 1])
ok('RECEIVING es el paso 4 y CLOSED el último', [indicePasoAmazon('RECEIVING'), indicePasoAmazon('CLOSED')], [4, 5])
ok('cancelado o sin dato no está en ningún paso', [indicePasoAmazon('CANCELLED'), indicePasoAmazon(null), indicePasoAmazon('XYZ')], [-1, -1, -1])
ok('de camino: tránsito a recibiendo, no creado ni cerrado', ['WORKING', 'IN_TRANSIT', 'DELIVERED', 'RECEIVING', 'CLOSED'].map(estaEnCamino), [false, true, true, true, false])

const f = fechasDePasos([
  { vistoAt: '2026-10-03T08:14:00Z', estadoAmazon: 'RECEIVING' },
  { vistoAt: '2026-10-01T02:34:00Z', estadoAmazon: 'IN_TRANSIT' },
  { vistoAt: '2026-10-02T13:51:00Z', estadoAmazon: 'DELIVERED' },
  { vistoAt: '2026-10-02T15:00:00Z', estadoAmazon: 'DELIVERED' },
])
ok('cada paso se apunta con su primera observación', [f[1], f[2]], ['2026-10-01T02:34:00Z', '2026-10-02T13:51:00Z'])
ok('un paso que no se vio queda en null (registrado)', f[3], null)
ok('recibiendo con su hora', f[4], '2026-10-03T08:14:00Z')

console.log('=== DE QUIÉN ES EL TURNO ===')
ok('borrador vacío: le toca a la agencia montar', turnoDe('borrador', 0).quien, 'agencia')
ok('borrador con líneas: le toca aprobar al cliente', turnoDe('borrador', 5).quien, 'cliente')
ok('aprobada y encajando: cliente', [turnoDe('aprobada', 5).quien, turnoDe('encajando', 5).quien], ['cliente', 'cliente'])
ok('lista: agencia', turnoDe('lista', 5).quien, 'agencia')
ok('a la agencia le toca en lista', leToca(turnoDe('lista', 5), 'agencia'), true)
ok('al cliente no le toca en lista', leToca(turnoDe('lista', 5), 'cliente'), false)

console.log('=== FECHAS ===')
ok('días entre fechas', diasEntre('2026-10-01', '2026-10-14'), 13)
ok('acepta ISO con hora', diasEntre('2026-10-01T22:00:00Z', '2026-10-02'), 1)
ok('hace cuánto', [haceCuanto('2026-10-14', '2026-10-14'), haceCuanto('2026-10-13', '2026-10-14'), haceCuanto('2026-10-09', '2026-10-14'), haceCuanto(null, '2026-10-14')], ['hoy', 'ayer', 'hace 5 días', '—'])

console.log(fallos === 0 ? '\n  TODO CORRECTO' : `\n  ${fallos} FALLOS`)
if (fallos) process.exit(1)
