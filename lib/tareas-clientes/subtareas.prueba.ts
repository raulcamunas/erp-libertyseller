import { bloqueantesPendientes, contarSubtareas, limpiarSubtarea, MAX_BLOQUEOS, tareasBloqueadas, validarBloqueos } from '@/lib/tareas-clientes/subtareas'

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

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

igual('una subtarea nueva necesita título', [limpiarSubtarea({}, true), limpiarSubtarea({ titulo: '   ' }, true), limpiarSubtarea({ titulo: ' Llamar  a Ana ' }, true)], [null, null, { titulo: 'Llamar a Ana' }])
igual('cambiar solo "hecha" no pide título', limpiarSubtarea({ hecha: true }, false), { hecha: true })
igual('fecha válida, vacía y absurda', [limpiarSubtarea({ fecha: '2026-11-20' }, false), limpiarSubtarea({ fecha: '' }, false), limpiarSubtarea({ fecha: '20/11/2026' }, false), limpiarSubtarea({ fecha: '2026-13-45' }, false)], [{ fecha: '2026-11-20' }, { fecha: null }, null, null])
igual('responsable: uuid, vacío y basura', [limpiarSubtarea({ responsable_id: U(1) }, false), limpiarSubtarea({ responsable_id: null }, false), limpiarSubtarea({ responsable_id: 'ana' }, false)], [{ responsable_id: U(1) }, { responsable_id: null }, null])
igual('título de más de 300 letras no vale', limpiarSubtarea({ titulo: 'x'.repeat(301) }, true), null)
igual('contar', contarSubtareas([{ hecha: true }, { hecha: false }, { hecha: true }]), { total: 3, hechas: 2 })

igual('bloqueantes: solo las que existen y no están hechas', bloqueantesPendientes([U(1), U(2), U(3)], (id) => id !== U(3), (id) => id === U(2)), [U(1)])
igual('sin bloqueos', bloqueantesPendientes(undefined, () => true, () => false), [])

// A depende de B, B depende de C
const mapa = new Map<string, string[]>([[U(1), []], [U(2), [U(3)]], [U(3), []], [U(4), [U(1)]]])
igual('depender de otra es válido', validarBloqueos(U(1), [U(2)], mapa), { ok: true, ids: [U(2)] })
igual('de sí misma no', validarBloqueos(U(1), [U(1)], mapa).ok, false)
igual('un círculo directo no', validarBloqueos(U(1), [U(4)], mapa).ok, false)
igual('un círculo en cadena no (3→2→... y 3 depende de 1)', validarBloqueos(U(3), [U(2)], mapa).ok, false)
igual('una desconocida no', validarBloqueos(U(1), [U(99)], mapa).ok, false)
igual('repetidos y basura se limpian', validarBloqueos(U(1), [U(2), U(2), 'x', 7], mapa), { ok: true, ids: [U(2)] })
igual('quitar todos vale', validarBloqueos(U(4), [], mapa), { ok: true, ids: [] })
igual('no es una lista', validarBloqueos(U(1), 'x', mapa).ok, false)
const muchas = new Map<string, string[]>(Array.from({ length: MAX_BLOQUEOS + 2 }, (_, i) => [U(i + 10), []]))
igual('demasiadas', validarBloqueos(U(1), [...muchas.keys()], new Map([...muchas, [U(1), []]])).ok, false)

const hechasIds = new Set([U(2)])
const lista = [
  { id: U(1), bloqueada_por: [U(2)] },
  { id: U(2), bloqueada_por: [] },
  { id: U(3), bloqueada_por: [U(1)] },
  { id: U(4), bloqueada_por: [U(99)] },
  { id: U(5), bloqueada_por: [U(1)] },
]
const hecha = (t: { id: string }) => hechasIds.has(t.id) || t.id === U(5)
igual('bloqueada: depende de una viva sin hacer; no lo está si su bloqueante ya está hecha, si ya no existe, ni si ella misma está hecha', [...tareasBloqueadas(lista, hecha)], [U(3)])

console.log(`\n${fallos === 0 ? 'TODO BIEN' : `HAY ${fallos} FALLOS`} (${comprobaciones} comprobaciones)`)
process.exit(fallos === 0 ? 0 : 1)
