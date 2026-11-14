import { lineasComoTareas } from '@/components/tareas-clientes/ListaDeTareas'

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
igual('líneas sueltas', lineasComoTareas('Uno\nDos\n\n  Tres  '), ['Uno', 'Dos', 'Tres'])
igual('viñetas, casillas de Markdown y numeración se quitan', lineasComoTareas('- Uno\n* Dos\n• Tres\n- [ ] Cuatro\n- [x] Cinco\n1. Seis\n2) Siete\n[ ] Ocho'), ['Uno', 'Dos', 'Tres', 'Cuatro', 'Cinco', 'Seis', 'Siete', 'Ocho'])
igual('un texto con números dentro no se toca', lineasComoTareas('Revisar 3 productos'), ['Revisar 3 productos'])
igual('vacío', lineasComoTareas(' \n \n'), [])
igual('saltos de Windows', lineasComoTareas('A\r\nB'), ['A', 'B'])
console.log(`\n${fallos === 0 ? 'TODO BIEN' : `HAY ${fallos} FALLOS`} (${comprobaciones} comprobaciones)`)
process.exit(fallos === 0 ? 0 : 1)
