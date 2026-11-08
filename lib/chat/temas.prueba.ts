import { AJUSTES_POR_DEFECTO, FONDOS, TEMAS, leerAjustes, limpiarAjustes, temaDe, variablesDeTema } from '@/lib/chat/temas'

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

igual('los temas no repiten id ni color', [new Set(TEMAS.map((t) => t.id)).size === TEMAS.length, new Set(TEMAS.map((t) => t.acento)).size === TEMAS.length], [true, true])
igual('todos los colores son hexadecimales', TEMAS.every((t) => [t.acento, t.acentoDos, t.tinta].every((c) => /^#[0-9A-F]{6}$/i.test(c))), true)
igual('sin nada guardado, lo de siempre', [leerAjustes(null), leerAjustes(''), leerAjustes('no es json'), leerAjustes('[1,2]')], [AJUSTES_POR_DEFECTO, AJUSTES_POR_DEFECTO, AJUSTES_POR_DEFECTO, AJUSTES_POR_DEFECTO])
igual('lo válido se respeta', leerAjustes(JSON.stringify({ tema: 'oceano', fondo: 'puntos', estilo: 'burbujas', densidad: 'compacta', texto: 'grande' })), { tema: 'oceano', fondo: 'puntos', estilo: 'burbujas', densidad: 'compacta', texto: 'grande' })
igual('un valor roto vuelve al de siempre sin afectar a los demás', limpiarAjustes({ tema: 'inventado', fondo: 'malla', estilo: 7, densidad: null, texto: 'grande' }), { ...AJUSTES_POR_DEFECTO, fondo: 'malla', texto: 'grande' })
igual('un tema que ya no existe cae en Liberty', temaDe('borrado').id, 'liberty')
igual('Liberty no pisa los colores del ERP, los demás sí', [variablesDeTema(AJUSTES_POR_DEFECTO), Object.keys(variablesDeTema({ ...AJUSTES_POR_DEFECTO, tema: 'bosque' }))], [{}, ['--c-acc', '--c-acc-dos', '--c-tinta']])
igual('el fondo por defecto existe', FONDOS.some((f) => f.id === AJUSTES_POR_DEFECTO.fondo), true)

console.log(`\n${fallos === 0 ? 'TODO BIEN' : `HAY ${fallos} FALLOS`} (${comprobaciones} comprobaciones)`)
process.exit(fallos === 0 ? 0 : 1)
