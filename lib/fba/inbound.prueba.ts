import { agregarPagina, type LineaInbound } from './inbound'

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

console.log(fallos === 0 ? '\n  TODO CORRECTO' : `\n  ${fallos} FALLOS`)
if (fallos) process.exit(1)
