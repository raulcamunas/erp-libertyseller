import { MAX_CAJAS, limpiarCajas } from '@/lib/fba/cajas-validacion'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}
const error = (r: ReturnType<typeof limpiarCajas>) => (r.ok ? '' : r.error)

/**
 * LAS CAJAS QUE LLEGAN DE FUERA, ANTES DE TOCAR LA BASE.
 *
 * Las mismas reglas valen para la ruta del ERP y para la página pública del encaje. Lo que importa
 * comprobar: que lo malo se rechaza con una frase que se entienda, que lo bueno pasa limpio, y que la
 * versión ESTRICTA —la que se le exige a quien llega con un enlace— no deja colar SKU ajenos ni más
 * unidades de las declaradas.
 */

const buena = { numero: 1, largoCm: 40, anchoCm: 30, altoCm: 20, pesoKg: 8.5, contenido: [{ sku: 'A', unidades: 3 }] }

console.log('\n=== lo bueno pasa limpio ===')
{
  const r = limpiarCajas([buena])
  ok('una caja correcta', r.ok && r.cajas.length === 1 && r.cajas[0].pesoKg === 8.5 && r.cajas[0].contenido[0].unidades === 3)
  const medidas = limpiarCajas([{ numero: 2, largoCm: '40,5' as unknown as number, contenido: [] }])
  ok('«40,5» con coma NO es un número para el servidor: la pantalla lo convierte antes', !medidas.ok, error(medidas))
  const vacia = limpiarCajas([{ numero: 3, contenido: [] }])
  ok('una caja sin medidas ni contenido se guarda (el ERP deja guardar a medias; lo que bloquea es terminar)', vacia.ok && vacia.cajas[0].largoCm === null && vacia.cajas[0].contenido.length === 0)
  const ceros = limpiarCajas([{ numero: 1, contenido: [{ sku: 'A', unidades: 0 }, { sku: ' B ', unidades: 2 }, { sku: '', unidades: 5 }] }])
  ok('las líneas con cero unidades o sin SKU se descartan y el SKU se recorta', ceros.ok && ceros.cajas[0].contenido.length === 1 && ceros.cajas[0].contenido[0].sku === 'B')
  ok('lista vacía: se guardan cero cajas', limpiarCajas([]).ok)
  ok('un valor de medida vacío es null, no cero', limpiarCajas([{ numero: 1, largoCm: '', anchoCm: null, altoCm: undefined, pesoKg: null, contenido: [] }]).ok)
}

console.log('\n=== lo malo se rechaza con una frase ===')
ok('no es una lista', error(limpiarCajas({ cajas: [] })) === 'Falta la lista de cajas', error(limpiarCajas({})))
ok('demasiadas cajas', error(limpiarCajas(Array.from({ length: MAX_CAJAS + 1 }, (_, i) => ({ numero: i + 1 })))) === `Son demasiadas cajas (máximo ${MAX_CAJAS})`)
ok('sin número', error(limpiarCajas([{ largoCm: 1 }])) === 'La caja 1 no tiene un número válido')
ok('número no entero', error(limpiarCajas([{ numero: 1.5 }])) === 'La caja 1 no tiene un número válido')
ok('número repetido', error(limpiarCajas([{ numero: 1 }, { numero: 1 }])) === 'Hay dos cajas con el número 1')
ok('una caja nula en la lista no revienta (antes daba un 500)', error(limpiarCajas([null])) === 'La caja 1 no tiene un número válido')
ok('medida negativa', error(limpiarCajas([{ numero: 2, largoCm: -3 }])) === 'La caja 2: «largo» tiene que ser un número mayor que cero')
ok('medida cero', error(limpiarCajas([{ numero: 2, pesoKg: 0 }])) === 'La caja 2: «peso» tiene que ser un número mayor que cero')
ok('medida que no es un número', error(limpiarCajas([{ numero: 2, anchoCm: 'ancho' }])) === 'La caja 2: «ancho» tiene que ser un número mayor que cero')
ok('medida imposible (más de 1.000)', error(limpiarCajas([{ numero: 2, altoCm: 5000 }])) === 'La caja 2: «alto» es imposible')
ok('unidades con decimales', error(limpiarCajas([{ numero: 1, contenido: [{ sku: 'A', unidades: 1.5 }] }])) === 'La caja 1: las unidades de A no son válidas')
ok('unidades negativas', error(limpiarCajas([{ numero: 1, contenido: [{ sku: 'A', unidades: -1 }] }])) === 'La caja 1: las unidades de A no son válidas')
ok('el mismo SKU dos veces en una caja', error(limpiarCajas([{ numero: 1, contenido: [{ sku: 'A', unidades: 1 }, { sku: 'A', unidades: 2 }] }])) === 'La caja 1 tiene A dos veces. Súmalo en una sola línea')

console.log('\n=== la versión estricta, para quien llega con un enlace ===')
{
  const declaradas = new Map([['A', 5], ['B', 2]])
  const bien = limpiarCajas([{ numero: 1, contenido: [{ sku: 'A', unidades: 3 }] }, { numero: 2, contenido: [{ sku: 'A', unidades: 2 }, { sku: 'B', unidades: 2 }] }], { declaradas })
  ok('repartir justo lo declarado entre dos cajas vale', bien.ok)
  ok('un SKU que no es de este envío se rechaza', error(limpiarCajas([{ numero: 1, contenido: [{ sku: 'Z', unidades: 1 }] }], { declaradas })) === 'La caja 1: Z no es de este envío')
  ok('más unidades de las declaradas, sumando las cajas, se rechaza', error(limpiarCajas([{ numero: 1, contenido: [{ sku: 'A', unidades: 3 }] }, { numero: 2, contenido: [{ sku: 'A', unidades: 3 }] }], { declaradas })) === 'A: hay 6 unidades en las cajas y en el envío son 5')
  ok('menos de lo declarado SÍ vale: se está encajando a medias', limpiarCajas([{ numero: 1, contenido: [{ sku: 'A', unidades: 1 }] }], { declaradas }).ok)
  ok('el tope de cajas es el que se pide', error(limpiarCajas([{ numero: 1 }, { numero: 2 }, { numero: 3 }], { maxCajas: 2 })) === 'Son demasiadas cajas (máximo 2)')
  ok('sin pedir lo estricto, un SKU ajeno pasa (el cuadre del ERP ya lo marca)', limpiarCajas([{ numero: 1, contenido: [{ sku: 'Z', unidades: 1 }] }]).ok)
}

console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
