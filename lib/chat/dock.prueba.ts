import { ANCHO_LATERAL, TAMANO_MINIMO, TAMANO_POR_DEFECTO, anchoQueAparta, leerModo, leerTamano, limitarTamano, modoEfectivo, seOfreceElDock, tamanoAlArrastrar } from '@/lib/chat/dock'

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

const pantalla = { ancho: 1600, alto: 900 }
igual('el tamaño guardado se lee; lo roto vuelve al de siempre', [leerTamano('{"ancho":500,"alto":700}'), leerTamano('{no'), leerTamano(null), leerTamano('{"ancho":-3,"alto":"x"}')], [{ ancho: 500, alto: 700 }, TAMANO_POR_DEFECTO, TAMANO_POR_DEFECTO, TAMANO_POR_DEFECTO])
igual('ni más pequeño que el mínimo ni más grande que la ventana menos el margen', [limitarTamano({ ancho: 100, alto: 100 }, pantalla), limitarTamano({ ancho: 5000, alto: 5000 }, pantalla), limitarTamano({ ancho: 500.4, alto: 600.6 }, pantalla)], [TAMANO_MINIMO, { ancho: 1564, alto: 864 }, { ancho: 500, alto: 601 }])
igual('en una ventana diminuta manda el mínimo', limitarTamano({ ancho: 900, alto: 900 }, { ancho: 300, alto: 300 }), TAMANO_MINIMO)
const inicio = { ancho: 400, alto: 600 }
igual('arrastrar el borde izquierdo hacia la izquierda la ensancha (y no cambia el alto)', tamanoAlArrastrar(inicio, 'izquierda', -120, -50, pantalla), { ancho: 520, alto: 600 })
igual('arrastrar el borde de arriba hacia arriba la alarga (y no cambia el ancho)', tamanoAlArrastrar(inicio, 'arriba', -70, -100, pantalla), { ancho: 400, alto: 700 })
igual('la esquina cambia las dos cosas; hacia dentro, la achica hasta el mínimo', [tamanoAlArrastrar(inicio, 'esquina', -100, -100, pantalla), tamanoAlArrastrar(inicio, 'esquina', 500, 500, pantalla)], [{ ancho: 500, alto: 700 }, TAMANO_MINIMO])

console.log(`\n${fallos === 0 ? 'TODO BIEN' : `HAY ${fallos} FALLOS`} (${comprobaciones} comprobaciones)`)
process.exit(fallos === 0 ? 0 : 1)
