import { limpiarCajas } from '@/lib/fba/cajas-validacion'
import { resumirEncaje, type CajaEnEdicion, type LineaParaEncajar } from '@/lib/fba/encaje-resumen'
import { anadirCaja, maximoEnCaja, meterPendientes, meterTodoLoPendiente, moverLinea, pendientesDe, ponerMedida, ponerUnidades, quitarCaja } from '@/lib/fba/encaje-operaciones'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/**
 * LO QUE SE HACE CON LAS CAJAS EN LA PÁGINA DEL CLIENTE.
 *
 * Lo que de verdad importa: que ninguna operación pueda dejar las cajas en un estado que el servidor
 * rechazaría (más unidades de las declaradas, un SKU repetido en una caja), que quitar una caja
 * renumere las demás, y que mover no duplique. Cada operación se comprueba además pasando su
 * resultado por la MISMA validación estricta del servidor.
 */

const linea = (sku: string, unidades: number): LineaParaEncajar => ({ sku, nombre: sku, variante: null, referencia: null, unidades })
const lineas = [linea('A', 5), linea('B', 3), linea('C', 4)]
const vacia = (numero: number, extra: Partial<CajaEnEdicion> = {}): CajaEnEdicion => ({ numero, largoCm: null, anchoCm: null, altoCm: null, pesoKg: null, contenido: [], ...extra })
const declaradas = new Map(lineas.map((l) => [l.sku, l.unidades]))
const valida = (cajas: CajaEnEdicion[]) => limpiarCajas(cajas, { declaradas }).ok
const de = (c: CajaEnEdicion, sku: string) => c.contenido.find((x) => x.sku === sku)?.unidades ?? 0

console.log('\n=== añadir y quitar cajas ===')
{
  const una = anadirCaja([])
  ok('la primera caja es la 1 y viene vacía', una.length === 1 && una[0].numero === 1 && una[0].contenido.length === 0 && una[0].pesoKg === null)
  const dos = anadirCaja(una)
  ok('la siguiente es la 2', dos.map((c) => c.numero).join() === '1,2')
  const medidas = ponerMedida(ponerMedida(ponerMedida(ponerMedida(dos, 1, 'largoCm', 40), 1, 'anchoCm', 30), 1, 'altoCm', 20), 1, 'pesoKg', 7.5)
  const copia = anadirCaja(medidas, 1)
  ok('«nueva caja con las mismas medidas» copia largo, ancho y alto', copia[2].largoCm === 40 && copia[2].anchoCm === 30 && copia[2].altoCm === 20)
  ok('pero NO el peso: cada caja pesa lo suyo', copia[2].pesoKg === null && copia[0].pesoKg === 7.5)
  ok('las cajas de entrada no se tocan (la operación no muta)', dos.length === 2 && dos[0].largoCm === null)

  const con = ponerUnidades(copia, lineas, 2, 'A', 3)
  const sin2 = quitarCaja(con, 2)
  ok('al quitar la 2, la que era 3 pasa a ser la 2 (sin huecos)', sin2.map((c) => c.numero).join() === '1,2' && sin2[1].largoCm === 40)
  ok('lo que tenía dentro la caja quitada vuelve a «por encajar»', pendientesDe(lineas, sin2, 'A') === 5 && pendientesDe(lineas, con, 'A') === 2)
  ok('quitar una que no existe no cambia nada', quitarCaja(dos, 9).length === 2)
}

console.log('\n=== poner unidades: nunca más de las declaradas ===')
{
  let c: CajaEnEdicion[] = [vacia(1), vacia(2)]
  c = ponerUnidades(c, lineas, 1, 'A', 3)
  ok('3 de las 5 de A en la caja 1', de(c[0], 'A') === 3 && pendientesDe(lineas, c, 'A') === 2)
  ok('en la caja 2 solo caben 2 más: se ajusta a lo que queda, no se rechaza', maximoEnCaja(lineas, c, 2, 'A') === 2 && de(ponerUnidades(c, lineas, 2, 'A', 99)[1], 'A') === 2)
  ok('en la caja 1 caben las 5 (sus 3 + las 2 que quedan)', maximoEnCaja(lineas, c, 1, 'A') === 5 && de(ponerUnidades(c, lineas, 1, 'A', 99)[0], 'A') === 5)
  ok('negativos, decimales y no-números se ajustan', de(ponerUnidades(c, lineas, 1, 'A', -4)[0], 'A') === 0 && de(ponerUnidades(c, lineas, 1, 'A', 2.9)[0], 'A') === 2 && de(ponerUnidades(c, lineas, 1, 'A', Number.NaN)[0], 'A') === 0)
  ok('cero quita la línea de la caja', ponerUnidades(c, lineas, 1, 'A', 0)[0].contenido.length === 0)
  ok('un SKU que no es de este envío no cabe: su máximo es 0', maximoEnCaja(lineas, c, 1, 'ZZ') === 0 && ponerUnidades(c, lineas, 1, 'ZZ', 4)[0].contenido.every((x) => x.sku !== 'ZZ'))
  const orden = ponerUnidades(ponerUnidades(ponerUnidades(c, lineas, 1, 'B', 1), lineas, 1, 'C', 2), lineas, 1, 'A', 4)
  ok('cambiar las unidades de una línea que ya estaba no la mueve de sitio', orden[0].contenido.map((x) => x.sku).join() === 'A,B,C', orden[0].contenido.map((x) => x.sku).join())
  ok('y el resultado siempre pasa la validación estricta del servidor', valida(orden) && valida(ponerUnidades(c, lineas, 2, 'A', 99)))
}

console.log('\n=== meter lo que falta ===')
{
  let c: CajaEnEdicion[] = [vacia(1), vacia(2)]
  c = meterPendientes(c, lineas, 1, 'A')
  ok('«meter lo que falta» pone las 5 en la caja 1', de(c[0], 'A') === 5 && pendientesDe(lineas, c, 'A') === 0)
  ok('si ya no falta nada, no hace nada', meterPendientes(c, lineas, 2, 'A') === c)
  c = ponerUnidades(c, lineas, 1, 'A', 2)
  c = meterPendientes(c, lineas, 2, 'A')
  ok('con 2 en la caja 1 y las 3 que faltan en la 2, queda repartido', de(c[0], 'A') === 2 && de(c[1], 'A') === 3)
  const todo = meterTodoLoPendiente([vacia(1)], lineas, 1)
  ok('«todo en una caja» mete las tres referencias, 12 unidades', todo[0].contenido.length === 3 && todo[0].contenido.reduce((s, x) => s + x.unidades, 0) === 12)
  ok('y deja el envío cuadrado', resumirEncaje(lineas, todo).pendientes === 0 && valida(todo))
  ok('sobre una caja que no existe no hace nada', meterPendientes([vacia(1)], lineas, 7, 'A').every((x) => x.contenido.length === 0))
}

console.log('\n=== mover una línea de una caja a otra ===')
{
  let c: CajaEnEdicion[] = [vacia(1), vacia(2)]
  c = ponerUnidades(ponerUnidades(c, lineas, 1, 'A', 3), lineas, 1, 'B', 3)
  const movido = moverLinea(c, 'A', 1, 2)
  ok('las 3 de A pasan a la caja 2 y salen de la 1', de(movido[1], 'A') === 3 && de(movido[0], 'A') === 0 && de(movido[0], 'B') === 3)
  ok('el total de A no cambia: ni se pierde ni se duplica', pendientesDe(lineas, movido, 'A') === pendientesDe(lineas, c, 'A'))
  const mezclado = moverLinea(ponerUnidades(movido, lineas, 1, 'A', 2), 'A', 1, 2)
  ok('si en la de destino ya había de ese SKU, se suman (3 + 2)', de(mezclado[1], 'A') === 5 && mezclado[0].contenido.every((x) => x.sku !== 'A'))
  ok('moverla a la misma caja, o desde una que no la tiene, no hace nada', moverLinea(c, 'A', 1, 1) === c && moverLinea(c, 'C', 1, 2) === c && moverLinea(c, 'A', 1, 9) === c)
  ok('el resultado pasa la validación del servidor', valida(movido) && valida(mezclado))
}

console.log('\n=== un encaje entero, como lo haría un cliente ===')
{
  let c: CajaEnEdicion[] = []
  c = anadirCaja(c)
  c = anadirCaja(c, 1)
  c = meterPendientes(c, lineas, 1, 'A')
  c = meterPendientes(c, lineas, 2, 'B')
  c = meterPendientes(c, lineas, 2, 'C')
  for (const n of [1, 2]) {
    c = ponerMedida(c, n, 'largoCm', 40)
    c = ponerMedida(c, n, 'anchoCm', 30)
    c = ponerMedida(c, n, 'altoCm', 25)
    c = ponerMedida(c, n, 'pesoKg', 6 + n)
  }
  const r = resumirEncaje(lineas, c)
  ok('dos cajas, 12 unidades, todo medido y pesado: se puede terminar', r.listo && r.cajas === 2 && r.encajadas === 12 && r.pesoTotalKg === 15, JSON.stringify([r.listo, r.cajas, r.encajadas, r.pesoTotalKg, r.motivos]))
  ok('y el servidor lo acepta tal cual', valida(c))
}

console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
