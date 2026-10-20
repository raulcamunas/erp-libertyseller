import { CADUCA_MS, claveDeCuenta, haceCuanto, pedirTurnoDeLectura } from '@/lib/fba/lectura-en-curso'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/**
 * UNA LECTURA DEL LIBRO MAYOR A LA VEZ POR CUENTA Y MERCADO.
 *
 * Si dos lecturas de la misma cuenta se cruzan, el borrado de la ventana y la escritura se
 * entremezclan y cada movimiento queda dos veces SIN ningún error. Aquí se fija que la segunda
 * no entra.
 */

const T0 = 1_000_000_000_000
const ES = 'A1RKKUPIHCS9HS'
const US = 'ATVPDKIKX0DER'

console.log('\n=== el turno ===')
{
  const mapa = new Map<string, number>()
  const k = claveDeCuenta('portico', US)
  const a = pedirTurnoDeLectura(k, T0, mapa)
  ok('la primera lectura entra', a.ok)

  const b = pedirTurnoDeLectura(k, T0 + 30_000, mapa)
  ok('la segunda de la MISMA cuenta y mercado, no', !b.ok)
  ok('y dice cuánto lleva la que está en marcha', !b.ok && b.desdeHaceMs === 30_000, JSON.stringify(b))

  ok('otro mercado de la misma cuenta, sí (son lecturas distintas)', pedirTurnoDeLectura(claveDeCuenta('portico', ES), T0, mapa).ok)
  ok('otra cuenta, sí', pedirTurnoDeLectura(claveDeCuenta('cobo', ES), T0, mapa).ok)

  if (a.ok) a.soltar()
  ok('al soltar, la cuenta vuelve a poder leerse', pedirTurnoDeLectura(k, T0 + 60_000, mapa).ok)
}

console.log('\n=== soltar bien ===')
{
  const mapa = new Map<string, number>()
  const k = claveDeCuenta('portico', US)
  const a = pedirTurnoDeLectura(k, T0, mapa)
  if (a.ok) {
    a.soltar()
    a.soltar()
  }
  ok('soltar dos veces no rompe nada', pedirTurnoDeLectura(k, T0 + 1, mapa).ok)

  // Una lectura que se quedó colgada y cuyo candado caducó: otra entra, y el `soltar` tardío de la primera
  // NO puede llevarse por delante el candado de la segunda
  const m2 = new Map<string, number>()
  const vieja = pedirTurnoDeLectura(k, T0, m2)
  const nueva = pedirTurnoDeLectura(k, T0 + CADUCA_MS + 1, m2)
  ok('un candado caducado deja entrar a otra lectura', nueva.ok)
  if (vieja.ok) vieja.soltar()
  ok('el soltar tardío de la vieja no suelta el de la nueva', !pedirTurnoDeLectura(k, T0 + CADUCA_MS + 2, m2).ok)
  if (nueva.ok) nueva.soltar()
  ok('y al soltar la nueva, queda libre', pedirTurnoDeLectura(k, T0 + CADUCA_MS + 3, m2).ok)
}

console.log('\n=== caducidad ===')
{
  const mapa = new Map<string, number>()
  const k = claveDeCuenta('portico', US)
  pedirTurnoDeLectura(k, T0, mapa)
  ok('justo antes de caducar sigue ocupado', !pedirTurnoDeLectura(k, T0 + CADUCA_MS - 1, mapa).ok)
  ok('al caducar se puede volver a pedir', pedirTurnoDeLectura(k, T0 + CADUCA_MS, mapa).ok)
  ok('la caducidad es MAYOR que lo que tarda Amazon en preparar un informe (15 min)', CADUCA_MS > 15 * 60_000)
}

console.log('\n=== el mensaje ===')
{
  ok('menos de un minuto', haceCuanto(20_000) === 'hace menos de un minuto', haceCuanto(20_000))
  ok('minutos', haceCuanto(3 * 60_000) === 'hace 3 min', haceCuanto(3 * 60_000))
}

console.log('\n=== el candado de verdad (el mapa del proceso) ===')
{
  const k = claveDeCuenta('prueba-global', US)
  const a = pedirTurnoDeLectura(k)
  const b = pedirTurnoDeLectura(k)
  ok('con el mapa del proceso, también se rechaza la segunda', a.ok && !b.ok)
  if (a.ok) a.soltar()
  const c = pedirTurnoDeLectura(k)
  ok('y se libera', c.ok)
  if (c.ok) c.soltar()
}

console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
