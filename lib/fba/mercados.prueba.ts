import { diaDeCreacionDeEnvio, mercadoDeEnvio, mercadosQueVendeLaCuenta, participaEn } from '@/lib/fba/mercados'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/**
 * EN QUÉ MERCADO ESTÁ UN ENVÍO TRAÍDO DE AMAZON.
 *
 * El caso real: Portico LLC es una cuenta de Norteamérica con sus 27 productos en Amazon.com, y sus tres
 * envíos se importaron como de España porque el diálogo lo llevaba fijo. Las ventas se quedaron en cero.
 */

const ES = 'A1RKKUPIHCS9HS'
const FR = 'A13V1IB3VIYZZH'
const DE = 'A1PA6795UKMFR9'
const US = 'ATVPDKIKX0DER'
const CA = 'A2EUQ1WTGCTBG2'
const MX = 'A1AM78C64UM0Y8'
const BR = 'A2Q3Y263D00KWC'

// Las cuentas tal y como están en la base
const cobo = { marketplace_ids: [FR, ES, DE], marketplaces_activos: [ES], default_marketplace_id: ES }
const lenobotics = { marketplace_ids: [DE, ES, FR], marketplaces_activos: [ES, DE, FR], default_marketplace_id: ES }
const portico = { marketplace_ids: [MX, 'A1MQXOICRS2Z7M', CA, BR, 'A2ZV50J4W1RKNI', 'A3H6HPSLHAK3XG', 'AHRY1CZE9ZY4H', US], marketplaces_activos: [], default_marketplace_id: MX }

console.log('\n=== lo de siempre: los clientes de España no cambian ===')
{
  const m = mercadoDeEnvio({ pedido: ES, conexion: cobo })
  ok('Cobo pide España y es España', m.id === ES && !m.cambiado, JSON.stringify(m))
  ok('con su nombre para pantalla', m.nombre === 'España' && m.region === 'eu', JSON.stringify(m))
  ok('Lenobotics, igual', mercadoDeEnvio({ pedido: ES, conexion: lenobotics }).id === ES)
  ok('si pide Alemania y la cuenta está en Alemania, es Alemania', mercadoDeEnvio({ pedido: DE, conexion: lenobotics }).id === DE)
  ok('sin pedir nada, el por defecto de la conexión, y eso no es un cambio', (() => { const x = mercadoDeEnvio({ pedido: null, conexion: cobo }); return x.id === ES && !x.cambiado })())
}

console.log('\n=== el caso de Portico: lo que se pide no es lo que la cuenta vende ===')
{
  const sinDatos = mercadoDeEnvio({ pedido: ES, conexion: portico })
  const m = mercadoDeEnvio({ pedido: ES, conexion: portico, fbaPorMercado: new Map([[US, 27]]) })
  ok('pide España, la cuenta no está en España: se elige donde tiene los productos (Estados Unidos)', m.id === US && m.cambiado, JSON.stringify(m))
  ok('con nombre y región para pantalla y para leer la fecha del nombre', m.nombre === 'Estados Unidos' && m.region === 'na', JSON.stringify(m))
  ok('aunque el mercado por defecto de la conexión sea México', portico.default_marketplace_id === MX && m.id !== MX)
  ok('y pidiendo ya Estados Unidos, es Estados Unidos y no se marca como cambiado', (() => { const x = mercadoDeEnvio({ pedido: US, conexion: portico }); return x.id === US && !x.cambiado })())
  ok('sin datos de productos cae en el por defecto de la conexión, que al menos es un mercado en el que la cuenta está', sinDatos.id === MX && sinDatos.cambiado, JSON.stringify(sinDatos))
  ok('con productos repartidos gana el mercado con más', mercadoDeEnvio({ pedido: ES, conexion: portico, fbaPorMercado: new Map([[US, 27], [CA, 3]]) }).id === US)
  ok('y si el que más tiene es Canadá, Canadá', mercadoDeEnvio({ pedido: ES, conexion: portico, fbaPorMercado: new Map([[US, 2], [CA, 30]]) }).id === CA)
}

console.log('\n=== casos raros ===')
{
  const sinLista = { marketplace_ids: [], marketplaces_activos: null, default_marketplace_id: null }
  ok('una conexión sin lista de mercados no bloquea lo que se pide (conexión antigua)', mercadoDeEnvio({ pedido: ES, conexion: sinLista }).id === ES && participaEn(sinLista, ES))
  ok('sin lista y sin pedido, España', mercadoDeEnvio({ pedido: null, conexion: sinLista }).id === ES)
  ok('un pedido vacío se trata como no pedido', mercadoDeEnvio({ pedido: '   ', conexion: cobo }).id === ES)
  const sinDefecto = { marketplace_ids: [CA, MX, US], marketplaces_activos: null, default_marketplace_id: null }
  ok('sin por defecto ni productos, el primero en el orden de la agencia (Estados Unidos antes que Canadá o México)', mercadoDeEnvio({ pedido: ES, conexion: sinDefecto }).id === US, mercadoDeEnvio({ pedido: ES, conexion: sinDefecto }).id)
  ok('participaEn: la cuenta está o no está', participaEn(portico, US) && !participaEn(portico, ES) && !participaEn(cobo, US))
  ok('los mercados que vende la cuenta, con nombre, para el mensaje de error', mercadosQueVendeLaCuenta(portico).join(', ') === 'México, Canadá, Brasil, Estados Unidos', mercadosQueVendeLaCuenta(portico).join(', '))
}

console.log('\n=== el día de creación, leído del nombre ===')
{
  // Las cadenas de verdad de los tres envíos de Portico
  ok('MIT2, cuenta de EE. UU.: 07/08 es 8 de julio (el diálogo lo leía como 7 de agosto)', diaDeCreacionDeEnvio('FBA STA (07/08/2026 21:43)-MIT2', 'na') === '2026-07-08', String(diaDeCreacionDeEnvio('FBA STA (07/08/2026 21:43)-MIT2', 'na')))
  ok('TCY2: 07/14 solo puede ser mes/día', diaDeCreacionDeEnvio('FBA STA (07/14/2026 10:08)-TCY2', 'na') === '2026-07-14')
  ok('GEU3: 07/19 (antes ni siquiera daba una fecha)', diaDeCreacionDeEnvio('FBA STA (07/19/2026 11:18)-GEU3', 'na') === '2026-07-19')
  // Un cliente de España
  ok('España: 06/10 es 6 de octubre', diaDeCreacionDeEnvio('FBA STA (06/10/2026 10:17)', 'eu') === '2026-10-06')
  ok('España: 19/07 es 19 de julio', diaDeCreacionDeEnvio('FBA STA (19/07/2026 11:18)', 'eu') === '2026-07-19')
  ok('si un número pasa de 12 manda sobre la región, también en EE. UU.', diaDeCreacionDeEnvio('FBA STA (19/07/2026 11:18)', 'na') === '2026-07-19')
  ok('y al revés: el segundo pasa de 12 en una cuenta de Europa', diaDeCreacionDeEnvio('FBA STA (07/19/2026 11:18)', 'eu') === '2026-07-19')
  ok('región desconocida: día/mes, como siempre', diaDeCreacionDeEnvio('FBA STA (06/10/2026 10:17)', null) === '2026-10-06')
  ok('un nombre sin fecha no inventa nada', diaDeCreacionDeEnvio('Reposición de octubre', 'eu') === null && diaDeCreacionDeEnvio(null, 'na') === null && diaDeCreacionDeEnvio('', 'na') === null)
  ok('una fecha que no existe se descarta (31/02)', diaDeCreacionDeEnvio('FBA STA (31/02/2026 10:17)', 'eu') === null)
  ok('mes 13 se descarta', diaDeCreacionDeEnvio('FBA STA (13/13/2026 10:17)', 'eu') === null)
  ok('con un solo dígito también', diaDeCreacionDeEnvio('FBA STA (7/8/2026 9:43)', 'na') === '2026-07-08')
}

console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
