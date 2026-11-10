import { AJUSTES_DE_VOZ_POR_DEFECTO, DB_MAXIMO, DB_MINIMO, RETENCION_DE_PUERTA_MS, dbAMedidor, dbAUmbral, decidirPuerta, ganancia, leerAjustesDeVoz, limpiarAjustesDeVoz, necesitaProcesador, nivelEnDb, umbralADb } from '@/lib/chat/voz-ajustes'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}
const cerca = (a: number, b: number, e = 0.01) => Math.abs(a - b) <= e

/**
 * LOS AJUSTES DE LA VOZ. Lo que duele si falla: que la puerta de ruido corte la voz (retención), que un valor guardado roto deje el micrófono mudo (volumen 0) o con ganancia absurda, que el medidor y la
 * marca del umbral no coincidan (se ajustaría a ciegas), o que con los valores de fábrica se meta un procesador sin hacer falta.
 */
function main() {
  console.log('\n=== lo guardado ===')
  {
    ok('de fábrica: volumen 100, sin puerta', AJUSTES_DE_VOZ_POR_DEFECTO.volumen === 100 && AJUSTES_DE_VOZ_POR_DEFECTO.puerta === false)
    ok('sin nada guardado, lo de fábrica', JSON.stringify(leerAjustesDeVoz(null)) === JSON.stringify(AJUSTES_DE_VOZ_POR_DEFECTO) && JSON.stringify(leerAjustesDeVoz('')) === JSON.stringify(AJUSTES_DE_VOZ_POR_DEFECTO))
    ok('lo guardado se respeta', JSON.stringify(leerAjustesDeVoz('{"volumen":150,"puerta":true,"umbral":60}')) === JSON.stringify({ volumen: 150, puerta: true, umbral: 60 }))
    ok('un valor fuera de rango se recorta (no deja el micrófono a 1000 %)', limpiarAjustesDeVoz({ volumen: 1000, umbral: -5 }).volumen === 200 && limpiarAjustesDeVoz({ volumen: -3, umbral: 999 }).volumen === 0 && limpiarAjustesDeVoz({ umbral: 999 }).umbral === 100)
    ok('un valor roto vuelve a lo de fábrica sin tocar lo demás', limpiarAjustesDeVoz({ volumen: 'mucho', puerta: true }).volumen === 100 && limpiarAjustesDeVoz({ volumen: 'mucho', puerta: true }).puerta === true)
    ok('basura: JSON roto, lista, número, null', [leerAjustesDeVoz('{no'), leerAjustesDeVoz('[1]'), leerAjustesDeVoz('3'), limpiarAjustesDeVoz(null)].every((a) => JSON.stringify(a) === JSON.stringify(AJUSTES_DE_VOZ_POR_DEFECTO)))
  }

  console.log('\n=== niveles ===')
  {
    ok('0 de sensibilidad es el umbral más bajo y 100 el más alto', cerca(umbralADb(0), DB_MINIMO) && cerca(umbralADb(100), DB_MAXIMO))
    ok('ida y vuelta de la sensibilidad a decibelios', [0, 25, 45, 80, 100].every((u) => cerca(dbAUmbral(umbralADb(u)), u)))
    ok('la sensibilidad solo sube el umbral', umbralADb(20) < umbralADb(50) && umbralADb(50) < umbralADb(90))
    ok('el nivel: señal máxima = 0 dB, mitad ≈ −6 dB, silencio = −100', cerca(nivelEnDb(1), 0) && cerca(nivelEnDb(0.5), -6.02) && nivelEnDb(0) === -100 && nivelEnDb(NaN) === -100)
    ok('el medidor: −90 dB vacío, 0 dB lleno, y la marca del umbral cae donde toca', dbAMedidor(-90) === 0 && dbAMedidor(0) === 100 && cerca(dbAMedidor(umbralADb(45)), ((umbralADb(45) + 90) / 90) * 100))
    ok('la ganancia: 100 % = 1, 0 % = 0, 200 % = 2, y se recorta', ganancia(100) === 1 && ganancia(0) === 0 && ganancia(200) === 2 && ganancia(500) === 2 && ganancia(-5) === 0)
    ok('con lo de fábrica no hace falta procesador; con volumen o puerta, sí', !necesitaProcesador(AJUSTES_DE_VOZ_POR_DEFECTO) && necesitaProcesador({ volumen: 120, puerta: false, umbral: 45 }) && necesitaProcesador({ volumen: 100, puerta: true, umbral: 45 }))
  }

  console.log('\n=== la puerta de ruido ===')
  {
    const base = { umbralDb: -50, abierta: false, ultimoSobreMs: 0, ahoraMs: 1000 }
    const abre = decidirPuerta({ ...base, nivelDb: -30 })
    ok('abre al instante en cuanto se supera el umbral', abre.abierta && abre.ultimoSobreMs === 1000)
    const cierraPronto = decidirPuerta({ ...base, nivelDb: -70, abierta: true, ultimoSobreMs: 1000 - RETENCION_DE_PUERTA_MS + 50 })
    ok('con la voz hace un momento, sigue abierta (no corta las pausas ni el final de la frase)', cierraPronto.abierta)
    const cierra = decidirPuerta({ ...base, nivelDb: -70, abierta: true, ultimoSobreMs: 1000 - RETENCION_DE_PUERTA_MS - 50 })
    ok('pasada la retención sin superar el umbral, se cierra', !cierra.abierta)
    ok('cerrada y con ruido por debajo del umbral, sigue cerrada', !decidirPuerta({ ...base, nivelDb: -60 }).abierta)
    ok('justo en el umbral cuenta como voz', decidirPuerta({ ...base, nivelDb: -50 }).abierta)
    // Una frase: voz, pausa corta (no corta), silencio largo (corta)
    let estado = { abierta: false, ultimoSobreMs: 0 }
    const pasos: Array<[number, number]> = [[0, -30], [100, -30], [200, -70], [350, -70], [600, -70], [900, -70]]
    const abiertas = pasos.map(([t, db]) => (estado = decidirPuerta({ nivelDb: db, umbralDb: -50, abierta: estado.abierta, ultimoSobreMs: estado.ultimoSobreMs, ahoraMs: t })).abierta)
    ok('una frase con pausa: abierta mientras habla y durante la retención, cerrada después', abiertas.join() === 'true,true,true,true,false,false', abiertas.join())
  }

  console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS de ${comprobaciones} comprobaciones\n`)
  if (fallos > 0) process.exit(1)
}

main()
