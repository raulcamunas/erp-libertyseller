import { claveDeLectura, planDeLectura, type ConexionParaLeer, type RemesaParaLeer } from '@/lib/fba/lectura-plan'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/**
 * QUÉ CUENTAS SE LEEN CADA NOCHE.
 *
 * La regla de antes era «las que tienen remesas». El 15 de octubre la pasada pasó de cuatro
 * cuentas a una y ShoesF se quedó cinco días sin leerse. Aquí se fija la regla nueva.
 */

const ES = 'A1RKKUPIHCS9HS'
const FR = 'A13V1IB3VIYZZH'
const remesa = (conexion: string, fechaEnvio: string, mercado = ES): RemesaParaLeer => ({ conexion, mercado, fechaEnvio })
const conexion = (id: string, conStockFba: boolean, mercado: string | null = ES): ConexionParaLeer => ({ id, mercado, conStockFba })
const leido = (pares: Array<[string, string, (string | null)?]>) => new Map<string, string | null>(pares.map(([c, m, f]) => [claveDeLectura(c, m), f ?? null]))
const ids = (u: Array<{ conexion: string; mercado: string }>) => u.map((x) => `${x.conexion}@${x.mercado === ES ? 'ES' : x.mercado}`).join(' ')

console.log('\n=== lo de siempre: las cuentas con remesas ===')
{
  const p = planDeLectura({
    remesas: [remesa('cobo', '2026-09-28'), remesa('shoesf', '2026-05-03'), remesa('shoesf', '2026-10-19'), remesa('cobo', '2026-09-01')],
    conexiones: [],
    leidoHasta: new Map(),
  })
  ok('cada cuenta sale una sola vez', p.length === 2, ids(p))
  ok('de la remesa más antigua a la más reciente, como siempre', p[0].conexion === 'shoesf' && p[1].conexion === 'cobo', ids(p))
  ok('con la fecha de la remesa MÁS ANTIGUA de cada cuenta, la que decide hasta dónde se lee la primera vez', p[0].primera === '2026-05-03' && p[1].primera === '2026-09-01', JSON.stringify(p.map((x) => x.primera)))
  ok('y marcadas como con remesas', p.every((x) => x.conRemesas))
  ok('la misma conexión en dos mercados son dos lecturas', planDeLectura({ remesas: [remesa('a', '2026-01-01'), remesa('a', '2026-01-02', FR)], conexiones: [], leidoHasta: new Map() }).length === 2)
  ok('sin nada, nada', planDeLectura({ remesas: [], conexiones: [], leidoHasta: new Map() }).length === 0)
}

console.log('\n=== lo nuevo: las cuentas con stock en Amazon, tengan remesas o no ===')
{
  const entrada = {
    remesas: [remesa('cobo', '2026-09-28'), remesa('shoesf', '2026-10-19')],
    conexiones: [
      conexion('cobo', true),
      conexion('shoesf', true),
      conexion('argi', true),
      conexion('yolanda', true),
      conexion('creative', true),
      conexion('solter', false),
      conexion('portico', false, null),
    ],
    leidoHasta: leido([
      ['cobo', ES, '2026-10-19'],
      ['shoesf', ES, '2026-10-14'],
      ['argi', ES, '2026-10-13'],
      ['yolanda', ES, '2026-10-14'],
    ]),
  }
  const p = planDeLectura(entrada)
  ok('entran las que tienen stock aunque no tengan remesas (el caso de ShoesF, Yolanda, Argi y Creative Toys)', ['argi', 'yolanda', 'creative'].every((c) => p.some((x) => x.conexion === c)), ids(p))
  ok('una cuenta sin stock y sin lecturas previas no gasta un informe', !p.some((x) => x.conexion === 'solter'))
  ok('una conexión sin mercado no se puede leer y se salta', !p.some((x) => x.conexion === 'portico'))
  ok('las cuentas con remesas no se duplican como «con stock»', p.filter((x) => x.conexion === 'cobo').length === 1 && p.filter((x) => x.conexion === 'shoesf').length === 1)
  ok('las nuevas no tienen remesa más antigua: la primera lectura será de 90 días', p.filter((x) => !x.conRemesas).every((x) => x.primera === null))
  ok('primero las que tienen remesas, en su orden de siempre…', ids(p.slice(0, 2)) === 'cobo@ES shoesf@ES', ids(p))
  ok('…y después las demás de la más atrasada a la más al día: Creative Toys (nunca leída), Argi (13/10), Yolanda (14/10)', ids(p.slice(2)) === 'creative@ES argi@ES yolanda@ES', ids(p.slice(2)))
}

console.log('\n=== seguir mirando lo que ya se leía ===')
{
  const p = planDeLectura({
    remesas: [],
    conexiones: [conexion('vendido-todo', false), conexion('nunca', false)],
    leidoHasta: leido([['vendido-todo', ES, '2026-10-01']]),
  })
  ok('un cliente que se queda a cero de stock pero ya se leía, se sigue leyendo', ids(p) === 'vendido-todo@ES', ids(p))
  const nunca = planDeLectura({ remesas: [], conexiones: [conexion('x', false)], leidoHasta: leido([['x', ES, null]]) })
  ok('una fila de lectura sin fecha también cuenta como «ya se intentó leer»', nunca.length === 1)
}

console.log('\n=== el orden reparte la suerte ===')
{
  // Sin un orden por atraso, la última de la lista se quedaría sin leer cada noche que falte tiempo
  const conexiones = ['a', 'b', 'c', 'd'].map((id) => conexion(id, true))
  const noche1 = planDeLectura({ remesas: [], conexiones, leidoHasta: leido([['a', ES, '2026-10-18'], ['b', ES, '2026-10-18'], ['c', ES, '2026-10-18'], ['d', ES, '2026-10-18']]) })
  ok('con todas igual de al día, el orden es estable (por nombre)', ids(noche1) === 'a@ES b@ES c@ES d@ES', ids(noche1))
  // Esa noche solo dio tiempo a leer a y b: ahora c y d van delante
  const noche2 = planDeLectura({ remesas: [], conexiones, leidoHasta: leido([['a', ES, '2026-10-19'], ['b', ES, '2026-10-19'], ['c', ES, '2026-10-18'], ['d', ES, '2026-10-18']]) })
  ok('la noche siguiente van primero las que se quedaron sin leer', ids(noche2) === 'c@ES d@ES a@ES b@ES', ids(noche2))
  const nunca = planDeLectura({ remesas: [], conexiones, leidoHasta: leido([['a', ES, '2026-10-01'], ['b', ES, null]]) })
  // «b» tiene fila pero sin fecha (un intento que falló) y «c» y «d» ni eso: las tres siguen sin lectura, y van antes que «a»
  ok('lo que no se ha leído nunca —con o sin un intento fallido— va antes que lo que se leyó hace tiempo', ids(nunca) === 'b@ES c@ES d@ES a@ES', ids(nunca))
}

console.log('\n=== duplicados y mercados ===')
{
  const p = planDeLectura({ remesas: [], conexiones: [conexion('x', true), conexion('x', true)], leidoHasta: new Map() })
  ok('una conexión repetida se lee una vez', p.length === 1)
  const q = planDeLectura({ remesas: [remesa('x', '2026-01-01', FR)], conexiones: [conexion('x', true, ES)], leidoHasta: new Map() })
  ok('una cuenta con remesas en un mercado y stock en el suyo de siempre se lee en los dos', ids(q) === `x@${FR} x@ES`, ids(q))
}

console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
