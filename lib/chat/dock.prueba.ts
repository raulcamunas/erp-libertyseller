import { ANCHO_LATERAL, anchoQueAparta, leerModo, modoEfectivo, seOfreceElDock } from '@/lib/chat/dock'

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

igual('leer el modo guardado: lo roto vuelve a cerrado', [leerModo('pequeno'), leerModo('lateral'), leerModo('cerrado'), leerModo('grande'), leerModo(null), leerModo(3)], ['pequeno', 'lateral', 'cerrado', 'cerrado', 'cerrado', 'cerrado'])
igual('el dock se ofrece en todo el ERP menos en el propio chat', [seOfreceElDock('/dashboard/tareas-clientes'), seOfreceElDock('/dashboard/crm'), seOfreceElDock('/dashboard/chat'), seOfreceElDock('/dashboard/chat/algo'), seOfreceElDock('/dashboard/chatbot'), seOfreceElDock(null)], [true, true, false, false, true, false])
igual('un lateral en una ventana estrecha se pinta flotante', [modoEfectivo('lateral', 1600), modoEfectivo('lateral', 1100), modoEfectivo('pequeno', 1100), modoEfectivo('cerrado', 2000)], ['lateral', 'pequeno', 'pequeno', 'cerrado'])
igual('solo el lateral aparta la página', [anchoQueAparta('lateral', 1600), anchoQueAparta('lateral', 1100), anchoQueAparta('pequeno', 1600), anchoQueAparta('cerrado', 1600)], [ANCHO_LATERAL, 0, 0, 0])

console.log(`\n${fallos === 0 ? 'TODO BIEN' : `HAY ${fallos} FALLOS`} (${comprobaciones} comprobaciones)`)
process.exit(fallos === 0 ? 0 : 1)
