import { combinarEnvios } from './inbound-estados'
import { agregarPagina, ESTADOS_ENVIO_ANULADO, ESTADOS_POR_IDENTIFICADOR, type LineaInbound } from './inbound'

let fallos = 0
function ok(nombre: string, real: unknown, esperado: unknown) {
  const bien = JSON.stringify(real) === JSON.stringify(esperado)
  if (!bien) fallos += 1
  console.log(`  ${bien ? 'OK  ' : 'FALLA'}  ${nombre}${bien ? '' : ` → ${JSON.stringify(real)} (esperado ${JSON.stringify(esperado)})`}`)
}

console.log('=== PÁGINAS DE UN ENVÍO ===')
const pagina: LineaInbound[] = [
  { sku: 'A', enviadas: 3, recibidas: 3 },
  { sku: 'B', enviadas: 7, recibidas: 7 },
]
const m = new Map<string, LineaInbound>()
ok('la primera página trae 2 SKU nuevos', agregarPagina(m, pagina), 2)
ok('la MISMA página otra vez no trae nuevos', agregarPagina(m, pagina), 0)
ok('y no duplica unidades: 10, no 20', [...m.values()].reduce((s, l) => s + l.enviadas, 0), 10)
ok('veinte repeticiones siguen siendo 2 SKU', (() => { for (let i = 0; i < 20; i += 1) agregarPagina(m, pagina); return m.size })(), 2)
ok('una página con uno nuevo lo suma', agregarPagina(m, [{ sku: 'C', enviadas: 1, recibidas: 0 }]), 1)

ok('por identificador se piden también los cancelados (A5.1)', ['CANCELLED', 'DELETED', 'ERROR', 'CLOSED', 'IN_TRANSIT'].every((e) => ESTADOS_POR_IDENTIFICADOR.includes(e)), true)
ok('cancelado = anulado; cerrado no', [ESTADOS_ENVIO_ANULADO.includes('CANCELLED'), ESTADOS_ENVIO_ANULADO.includes('CLOSED')], [true, false])

const dos = combinarEnvios([
  { estado: 'CLOSED', lineas: [{ sku: 'A', enviadas: 10, recibidas: 10 }] },
  { estado: 'IN_TRANSIT', lineas: [{ sku: 'A', enviadas: 6, recibidas: 0 }, { sku: 'B', enviadas: 4, recibidas: 0 }] },
])
ok('varios FBA: el estado es el del menos avanzado (sigue viva)', dos.estado, 'IN_TRANSIT')
ok('varios FBA: las unidades se suman por SKU', dos.lineas.map((l) => `${l.sku}:${l.enviadas}/${l.recibidas}`).sort(), ['A:16/10', 'B:4/0'])
ok('un FBA cancelado no cuenta mientras haya otro vivo', combinarEnvios([{ estado: 'CANCELLED', lineas: [{ sku: 'A', enviadas: 5, recibidas: 0 }] }, { estado: 'CLOSED', lineas: [{ sku: 'A', enviadas: 5, recibidas: 5 }] }]).estado, 'CLOSED')
ok('todos cancelados: cancelada', combinarEnvios([{ estado: 'CANCELLED', lineas: [] }]).estado, 'CANCELLED')

console.log(fallos === 0 ? '\n  TODO CORRECTO' : `\n  ${fallos} FALLOS`)
if (fallos) process.exit(1)
