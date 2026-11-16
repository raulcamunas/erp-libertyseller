import { ATAJOS, TECLAS_DE_ATAJO, VENTANA_DE_G_MS, accionDeTecla, esCampoDeTexto, hayQueReenviar, teclasDe, type AccionDeAtajo, type EstadoDeAtajos, type EventoDeTecla } from '@/lib/correo/atajos'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

const AHORA = 1_000_000
const E = (extra: Partial<EstadoDeAtajos> = {}): EstadoDeAtajos => ({ activa: true, puedeResponder: true, hiloAbierto: true, gDesde: null, ahora: AHORA, ...extra })
const T = (key: string, extra: Omit<Partial<EventoDeTecla>, 'key'> = {}): EventoDeTecla => ({ key, ...extra })
const es = (n: string, evento: EventoDeTecla, estado: EstadoDeAtajos, esperado: AccionDeAtajo | null) => {
  const r = accionDeTecla(evento, estado)
  ok(n, r === esperado, String(r))
}

console.log('\n=== la tabla de 1.7 ===')
es('j: siguiente', T('j'), E(), 'siguiente')
es('k: anterior', T('k'), E(), 'anterior')
es('↵: abrir', T('Enter'), E(), 'abrir')
es('o: abrir', T('o'), E(), 'abrir')
es('u: volver', T('u'), E(), 'volver')
es('Esc: volver', T('Escape'), E(), 'volver')
es('c: redactar', T('c'), E(), 'redactar')
es('r: responder', T('r'), E(), 'responder')
es('a: responder a todos', T('a'), E(), 'responder-todos')
es('f: reenviar', T('f'), E(), 'reenviar')
es('s: destacar', T('s'), E(), 'destacar')
es('⇧U: no leído', T('U', { shiftKey: true }), E(), 'no-leido')
es('m: silenciar', T('m'), E(), 'silenciar')
es('/: buscar', T('/'), E(), 'buscar')
es('?: ayuda (con ⇧, como sale en el teclado)', T('?', { shiftKey: true }), E(), 'ayuda')
es('?: ayuda (sin ⇧, teclados que lo dan así)', T('?'), E(), 'ayuda')
es('⌘↵: enviar', T('Enter', { metaKey: true }), E(), 'enviar')
es('Ctrl+↵: enviar', T('Enter', { ctrlKey: true }), E(), 'enviar')

console.log('\n=== g y luego i / a ===')
es('g: prefijo', T('g'), E(), 'prefijo-g')
es('g + i: Mis correos', T('i'), E({ gDesde: AHORA - 300 }), 'ir-mis-correos')
es('g + a: Asignados a mí (no «responder a todos»)', T('a'), E({ gDesde: AHORA - 300 }), 'ir-asignados')
es('g + otra tecla: nada (anula el prefijo)', T('j'), E({ gDesde: AHORA - 300 }), null)
es('g + i pasada la ventana: i sola no hace nada', T('i'), E({ gDesde: AHORA - VENTANA_DE_G_MS - 1 }), null)
es('g + a pasada la ventana: vuelve a ser responder a todos', T('a'), E({ gDesde: AHORA - VENTANA_DE_G_MS - 1 }), 'responder-todos')
es('i sola: nada', T('i'), E(), null)
es('g + i en un campo: nada', T('i', { enCampo: true }), E({ gDesde: AHORA - 300 }), null)

console.log('\n=== en un campo solo Esc y ⌘↵ ===')
for (const k of ['j', 'k', 'o', 'u', 'c', 'r', 'a', 'f', 's', 'm', '/', 'g', '?', 'Enter']) es(`«${k}» en un campo: nada`, T(k, { enCampo: true }), E(), null)
es('⇧U en un campo: nada', T('U', { shiftKey: true, enCampo: true }), E(), null)
es('Esc en un campo: volver', T('Escape', { enCampo: true }), E(), 'volver')
es('⌘↵ en un campo: enviar', T('Enter', { metaKey: true, enCampo: true }), E(), 'enviar')
es('Ctrl+↵ en un campo: enviar', T('Enter', { ctrlKey: true, enCampo: true }), E(), 'enviar')

console.log('\n=== sin poder responder o sin hilo ===')
for (const k of ['r', 'a', 'f', 's']) es(`«${k}» sin poder responder: nada`, T(k), E({ puedeResponder: false }), null)
es('⇧U sin poder responder: nada', T('U', { shiftKey: true }), E({ puedeResponder: false }), null)
for (const k of ['r', 'a', 'f', 's', 'm']) es(`«${k}» sin hilo abierto: nada`, T(k), E({ hiloAbierto: false }), null)
es('m sin poder responder (silenciar es personal): sí', T('m'), E({ puedeResponder: false }), 'silenciar')
es('j sin hilo: siguiente igual', T('j'), E({ hiloAbierto: false }), 'siguiente')
es('c sin poder responder: redactar igual (la pantalla elige el buzón propio)', T('c'), E({ puedeResponder: false }), 'redactar')

console.log('\n=== modificadores, composición y app oculta ===')
es('⌘C: no es un atajo', T('c', { metaKey: true }), E(), null)
es('Ctrl+R: no es un atajo', T('r', { ctrlKey: true }), E(), null)
es('Alt+j: no es un atajo', T('j', { altKey: true }), E(), null)
es('⇧J: no es un atajo', T('J', { shiftKey: true }), E(), null)
es('⇧R: no es un atajo', T('R', { shiftKey: true }), E(), null)
es('U sin ⇧ (bloq mayús): nada', T('U'), E(), null)
es('componiendo un carácter: nada', T('j', { isComposing: true }), E(), null)
es('Esc componiendo: nada', T('Escape', { isComposing: true }), E(), null)
es('Correo oculto: nada', T('j'), E({ activa: false }), null)
es('Correo oculto, Esc: nada', T('Escape'), E({ activa: false }), null)
es('Correo oculto, ⌘↵: nada', T('Enter', { metaKey: true }), E({ activa: false }), null)
es('Alt+⌘↵: nada', T('Enter', { metaKey: true, altKey: true }), E(), null)
es('sin ahora usa el reloj (g reciente)', T('i'), { activa: true, puedeResponder: true, hiloAbierto: true, gDesde: Date.now() }, 'ir-mis-correos')

console.log('\n=== esCampoDeTexto ===')
ok('input de texto', esCampoDeTexto({ tagName: 'INPUT', type: 'text' }))
ok('input sin tipo', esCampoDeTexto({ tagName: 'input' }))
ok('input de búsqueda', esCampoDeTexto({ tagName: 'INPUT', type: 'search' }))
ok('textarea', esCampoDeTexto({ tagName: 'TEXTAREA' }))
ok('select', esCampoDeTexto({ tagName: 'SELECT' }))
ok('contenteditable', esCampoDeTexto({ tagName: 'DIV', isContentEditable: true }))
ok('casilla: no', !esCampoDeTexto({ tagName: 'INPUT', type: 'checkbox' }))
ok('botón: no', !esCampoDeTexto({ tagName: 'BUTTON' }))
ok('div: no', !esCampoDeTexto({ tagName: 'DIV', isContentEditable: false }))
ok('null y basura: no', !esCampoDeTexto(null) && !esCampoDeTexto('INPUT') && !esCampoDeTexto(undefined))

console.log('\n=== TECLAS_DE_ATAJO (lo que reenvía el iframe) ===')
const todas = ['j', 'k', 'o', 'u', 'c', 'r', 'a', 'f', 's', 'U', 'm', '/', 'g', 'i', '?', 'Enter', 'Escape']
ok('están todas las de la tabla', todas.every((k) => TECLAS_DE_ATAJO.has(k)), todas.filter((k) => !TECLAS_DE_ATAJO.has(k)).join(','))
ok('cada tecla del conjunto hace algo en algún estado', [...TECLAS_DE_ATAJO].every((k) => {
  const shift = k === 'U' || k === '?'
  return accionDeTecla(T(k, { shiftKey: shift }), E()) !== null || accionDeTecla(T(k), E({ gDesde: AHORA })) !== null
}))
ok('no reenvía letras sin atajo', !TECLAS_DE_ATAJO.has('x') && !TECLAS_DE_ATAJO.has('J'))
ok('hayQueReenviar: j sí, ⌘j no, x no', hayQueReenviar(T('j')) && !hayQueReenviar(T('j', { metaKey: true })) && !hayQueReenviar(T('x')))

console.log('\n=== la chuleta ===')
ok('cada acción (menos el prefijo) sale en la chuleta', (['siguiente', 'anterior', 'abrir', 'volver', 'redactar', 'responder', 'responder-todos', 'reenviar', 'destacar', 'no-leido', 'silenciar', 'buscar', 'ir-mis-correos', 'ir-asignados', 'ayuda', 'enviar'] as AccionDeAtajo[]).every((a) => ATAJOS.some((x) => x.accion === a)))
ok('sin repetidos', new Set(ATAJOS.map((a) => a.accion)).size === ATAJOS.length)
ok('teclasDe(responder) = [r]', teclasDe('responder').join() === 'r')
ok('teclasDe(prefijo-g) = []', teclasDe('prefijo-g').length === 0)

console.log(fallos ? `\n${fallos} FALLOS` : '\nTodo bien')
if (fallos) process.exit(1)
