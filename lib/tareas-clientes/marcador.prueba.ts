import { cuentaEnElMarcador } from '@/lib/tareas-clientes/marcador'

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
igual('cuentan En progreso y En revisión (con o sin tilde, mayúsculas o espacios)', ['En progreso', 'EN PROGRESO', 'En revisión', 'en revision', '  En  revisión '].map(cuentaEnElMarcador), [true, true, true, true, true])
igual('no cuentan Backlog, Recurrentes, ni lo hecho', ['Backlog', 'Recurrentes', 'Completadas', 'Hitos', 'Cierres Sprint', '', 'Revisión final'].map(cuentaEnElMarcador), [false, false, false, false, false, false, false])
console.log(`\n${fallos === 0 ? 'TODO BIEN' : `HAY ${fallos} FALLOS`} (${comprobaciones} comprobaciones)`)
process.exit(fallos === 0 ? 0 : 1)
