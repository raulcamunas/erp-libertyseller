/** Prueba de useAtajosDeCorreo (lo puro) y de la chuleta: cd /Users/raulcamunas/Dev/ERP-correo && npx tsx components/correo/useAtajosDeCorreo.prueba.ts */
import { ESPERA_DE_G_MS, focoEnCampo, resolverTecla, type EstadoDelGancho, type ManejadoresDeAtajos } from './useAtajosDeCorreo'
import { GRUPOS_DE_CHULETA, gruposDeLaChuleta } from './AyudaDeAtajos'
import { ATAJOS } from '@/lib/correo/atajos'

let fallos = 0
function ok(nombre: string, cond: boolean) {
  if (cond) console.log('  ✓', nombre)
  else {
    fallos++
    console.log('  ✗', nombre)
  }
}

const llamadas: string[] = []
const m = (n: string) => () => llamadas.push(n)
const todos: ManejadoresDeAtajos = {
  siguiente: m('siguiente'),
  anterior: m('anterior'),
  abrir: m('abrir'),
  volver: m('volver'),
  redactar: m('redactar'),
  responder: m('responder'),
  'responder-todos': m('responder-todos'),
  'ir-mis-correos': m('ir-mis-correos'),
  'ir-asignados': m('ir-asignados'),
  ayuda: m('ayuda'),
  enviar: m('enviar'),
  silenciar: m('silenciar'),
}
const base: EstadoDelGancho = { activa: true, enCampo: false, gDesde: null, ahora: 10_000, puedeResponder: true, hiloAbierto: true, manejadores: todos }

console.log('resolverTecla')
let r = resolverTecla({ key: 'j' }, base)
ok('j → siguiente, con preventDefault', r.prevenir && r.ejecutar !== null && (r.ejecutar(), llamadas.at(-1) === 'siguiente'))
r = resolverTecla({ key: 'j' }, { ...base, enCampo: true })
ok('j en un campo → nada y sin preventDefault', !r.prevenir && r.ejecutar === null)
r = resolverTecla({ key: 'Escape' }, { ...base, enCampo: true })
ok('Esc en un campo → volver', r.prevenir && !!r.ejecutar)
r = resolverTecla({ key: 'Enter', metaKey: true }, { ...base, enCampo: true })
ok('⌘↵ en un campo → enviar', r.prevenir && !!r.ejecutar)
r = resolverTecla({ key: 'c', metaKey: true }, base)
ok('⌘C no es un atajo (copiar sigue)', !r.prevenir && r.ejecutar === null)
r = resolverTecla({ key: 'f' }, base)
ok('f sin manejador → nada y sin preventDefault', !r.prevenir && r.ejecutar === null)
r = resolverTecla({ key: 'r' }, { ...base, puedeResponder: false })
ok('r sin poder responder → nada', !r.prevenir && r.ejecutar === null)
r = resolverTecla({ key: 'j' }, { ...base, activa: false })
ok('inactiva → nada', !r.prevenir && r.ejecutar === null)

console.log('prefijo g')
r = resolverTecla({ key: 'g' }, base)
ok('g → apunta la hora y previene', r.prevenir && r.gDesde === base.ahora && r.ejecutar === null)
r = resolverTecla({ key: 'i' }, { ...base, gDesde: base.ahora - 500 })
ok('g, i antes de 1 s → Mis correos y borra el prefijo', r.gDesde === null && (r.ejecutar?.(), llamadas.at(-1) === 'ir-mis-correos'))
r = resolverTecla({ key: 'a' }, { ...base, gDesde: base.ahora - 999 })
ok('g, a → Asignados (no «responder a todos»)', r.ejecutar !== null && (r.ejecutar(), llamadas.at(-1) === 'ir-asignados'))
r = resolverTecla({ key: 'a' }, { ...base, gDesde: base.ahora - ESPERA_DE_G_MS - 1 })
ok('g, a pasado 1 s → responder a todos', r.ejecutar !== null && (r.ejecutar(), llamadas.at(-1) === 'responder-todos'))
r = resolverTecla({ key: 'x' }, { ...base, gDesde: base.ahora - 100 })
ok('g, x → anula el prefijo sin hacer nada', r.gDesde === null && !r.prevenir && r.ejecutar === null)
r = resolverTecla({ key: 'Shift', shiftKey: true }, { ...base, gDesde: base.ahora - 100 })
ok('⇧ sola tras g → el prefijo sigue', r.gDesde === base.ahora - 100 && !r.prevenir)
r = resolverTecla({ key: 'g' }, { ...base, manejadores: { siguiente: m('s') } })
ok('g sin carpetas a las que ir → no previene ni apunta', !r.prevenir && r.gDesde === null)

console.log('evento sintético del iframe (isTrusted false, target = window)')
const sintetico = { key: '?', shiftKey: true, isTrusted: false, target: {} } as unknown as KeyboardEvent
r = resolverTecla(sintetico, base)
ok('? reenviado → ayuda', r.ejecutar !== null && (r.ejecutar(), llamadas.at(-1) === 'ayuda'))

console.log('focoEnCampo')
ok('sin foco → no', !focoEnCampo({ activeElement: null }))
ok('un textarea → sí', focoEnCampo({ activeElement: { tagName: 'TEXTAREA' } }))
ok('un input de texto → sí', focoEnCampo({ activeElement: { tagName: 'INPUT', type: 'text' } }))
ok('una casilla → no', !focoEnCampo({ activeElement: { tagName: 'INPUT', type: 'checkbox' } }))
ok('contenteditable → sí', focoEnCampo({ activeElement: { tagName: 'DIV', isContentEditable: true } }))
ok('el iframe del cuerpo (sin campo dentro) → no', !focoEnCampo({ activeElement: { tagName: 'IFRAME', contentDocument: { activeElement: { tagName: 'BODY' } } } }))
ok('un iframe con un campo dentro → sí', focoEnCampo({ activeElement: { tagName: 'IFRAME', contentDocument: { activeElement: { tagName: 'TEXTAREA' } } } }))
const deOtroOrigen = { tagName: 'IFRAME' }
Object.defineProperty(deOtroOrigen, 'contentDocument', { get: () => { throw new Error('SecurityError') } })
ok('un iframe de otro origen → no y no rompe', !focoEnCampo({ activeElement: deOtroOrigen }))

console.log('chuleta')
const grupos = gruposDeLaChuleta(true)
ok('cuatro grupos en orden', grupos.map((g) => g.grupo).join() === GRUPOS_DE_CHULETA.join() && grupos.length === 4)
ok('todas las acciones salen una vez', grupos.flatMap((g) => g.filas).length === ATAJOS.length)
const organizar = grupos.find((g) => g.grupo === 'Organizar')!.filas.map((f) => f.accion)
ok('Organizar = destacar, no leído, silenciar', ['destacar', 'no-leido', 'silenciar'].every((a) => organizar.includes(a as never)) && organizar.length === 3)
const enviarPc = gruposDeLaChuleta(false).flatMap((g) => g.filas).find((f) => f.accion === 'enviar')!
ok('fuera del Mac ⌘ se ve como Ctrl', enviarPc.teclas[0] === 'Ctrl' && enviarPc.modo === 'combinacion')
const ga = grupos.flatMap((g) => g.filas).find((f) => f.accion === 'ir-asignados')!
ok('g y luego a es una secuencia', ga.modo === 'secuencia')
const abrir = grupos.flatMap((g) => g.filas).find((f) => f.accion === 'abrir')!
ok('↵ o o es una alternativa', abrir.modo === 'alternativa')

console.log(fallos ? `\n${fallos} fallo(s)` : '\nTodo bien')
if (fallos) process.exit(1)
