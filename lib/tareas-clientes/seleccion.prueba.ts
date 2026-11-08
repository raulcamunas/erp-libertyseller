import { alternar, combinarSeleccion, recortar, rectDeDosPuntos, seTocan } from '@/lib/tareas-clientes/seleccion'

let fallos = 0
let comprobaciones = 0
const igual = (n: string, a: unknown, b: unknown) => {
  comprobaciones++
  const bien = JSON.stringify(a) === JSON.stringify(b)
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien ? '' : ` -> ${JSON.stringify(a)} y no ${JSON.stringify(b)}`}`)
}

igual('arrastrar hacia abajo a la derecha', rectDeDosPuntos(10, 10, 50, 40), { left: 10, top: 10, right: 50, bottom: 40 })
igual('y hacia arriba a la izquierda da lo mismo', rectDeDosPuntos(50, 40, 10, 10), { left: 10, top: 10, right: 50, bottom: 40 })
const tarjeta = { left: 100, top: 100, right: 200, bottom: 180 }
igual('un cuadro que la cruza la toca', seTocan(rectDeDosPuntos(150, 150, 300, 300), tarjeta), true)
igual('uno que solo roza su borde la toca', seTocan(rectDeDosPuntos(200, 180, 300, 300), tarjeta), true)
igual('uno que queda lejos no', seTocan(rectDeDosPuntos(201, 181, 300, 300), tarjeta), false)
igual('uno que la contiene entera la toca', seTocan(rectDeDosPuntos(0, 0, 500, 500), tarjeta), true)
igual('uno dentro de ella también', seTocan(rectDeDosPuntos(120, 120, 130, 130), tarjeta), true)

const columna = { left: 90, top: 50, right: 210, bottom: 150 }
igual('lo que asoma por debajo de la columna se recorta', recortar(tarjeta, columna), { left: 100, top: 100, right: 200, bottom: 150 })
igual('lo que queda del todo fuera de la columna (tapado) no cuenta', recortar({ left: 100, top: 160, right: 200, bottom: 240 }, columna), null)
igual('sin límite, no se recorta', recortar(tarjeta, null), tarjeta)
igual('una tarjeta tapada no se selecciona aunque el cuadro pase por donde estaría', (() => { const visible = recortar({ left: 100, top: 160, right: 200, bottom: 240 }, columna); return visible !== null && seTocan(rectDeDosPuntos(120, 200, 180, 220), visible) })(), false)

igual('sin Mayús, el cuadro sustituye la selección', [...combinarSeleccion(new Set(['a']), ['b', 'c'], false)], ['b', 'c'])
igual('con Mayús, se suma a la que había', [...combinarSeleccion(new Set(['a']), ['b', 'a'], true)], ['a', 'b'])
igual('alternar marca', [...alternar(new Set(['a']), 'b')], ['a', 'b'])
igual('y desmarca', [...alternar(new Set(['a', 'b']), 'a')], ['b'])
igual('no toca el conjunto original', (() => { const o = new Set(['a']); alternar(o, 'b'); return [...o] })(), ['a'])

console.log(`\n${comprobaciones - fallos}/${comprobaciones} comprobaciones`)
if (fallos > 0) process.exit(1)
