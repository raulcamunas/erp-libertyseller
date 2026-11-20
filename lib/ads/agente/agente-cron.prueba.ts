/**
 * Pruebas de las piezas PURAS de agente-cron.ts (sin red ni base de datos).
 *   npx tsx lib/ads/agente/agente-cron.prueba.ts
 */
import { camposDeVigilarFallido, cambiosDistintosDelEnsayo, horaDeMinuto, ordenarPorUrgencia, pendientesDeResultados, seguirTrasPasoFallido, vigilarHizoAlgo } from './agente-cron'
import { firmaDeReserva } from './estado-servidor'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

console.log('\n=== hora de un minuto ===')
ok('13:40', horaDeMinuto(820) === '13:40')
ok('00:05', horaDeMinuto(5) === '00:05')
ok('fuera de rango se acota', horaDeMinuto(-3) === '00:00' && horaDeMinuto(5000) === '23:59')

console.log('\n=== cambios DISTINTOS del ensayo ===')
{
  const f = (x: Partial<Parameters<typeof cambiosDistintosDelEnsayo>[0][number]>) => ({ tipo: 'negativizar', campaign_id: 'c1', objetivo_id: null, termino: 'gratis', valor_actual: null, valor_nuevo: null, metricas: { pedidos: 0 }, ...x })
  const r = cambiosDistintosDelEnsayo([
    f({}),
    f({ termino: 'Gratis ' }), // la misma negativa ensayada otro día: una
    f({ termino: 'segunda mano' }),
    f({ tipo: 'puja', objetivo_id: 'k1', termino: 'jamon', valor_actual: '1', valor_nuevo: '0.8', metricas: { pedidos: 3 } }),
    f({ tipo: 'puja', objetivo_id: 'k1', termino: 'jamon', valor_actual: 1, valor_nuevo: 0.7, metricas: { pedidos: 3 } }), // misma segmentación y tipo
    f({ tipo: 'puja', objetivo_id: 'k2', termino: 'paleta', valor_actual: 1, valor_nuevo: 1.2, metricas: { pedidos: 5 } }),
    f({ tipo: 'presupuesto', campaign_id: 'c2', termino: 'B0X | S | R | MANUAL AMPLIA', valor_actual: 20, valor_nuevo: 24 }),
    f({ tipo: 'pausar-campana', campaign_id: 'c3', termino: 'B0Y | S | R | AUTO RADAR' }),
  ])
  ok('2 negativas distintas', r.negativizar === 2, JSON.stringify(r))
  ok('1 bajada de puja (aunque se ensayara dos veces)', r.puja_bajar === 1, JSON.stringify(r))
  ok('1 subida de puja', r.puja_subir === 1)
  ok('1 subida de presupuesto', r.presupuesto_subir === 1)
  ok('1 pausa de campaña', r.pausar_campana === 1)
}

console.log('\n=== ¿abre fila el vigilar? ===')
{
  const nada = { insertadas: 0, frenado: false, deshechas: 0, activado: false, eventos: 0, reactivadas: 0 }
  ok('un vigilar rutinario NO abre fila', !vigilarHizoAlgo(nada))
  ok('con propuestas nuevas, sí', vigilarHizoAlgo({ ...nada, insertadas: 1 }))
  ok('con freno, sí', vigilarHizoAlgo({ ...nada, frenado: true }))
  ok('al pasar a activo, sí', vigilarHizoAlgo({ ...nada, activado: true }))
  ok('con reactivaciones, sí', vigilarHizoAlgo({ ...nada, reactivadas: 2 }))
}

console.log('\n=== vigilar fallido: cierra el paso ===')
{
  const c = camposDeVigilarFallido(1)
  ok('suma el fallo', c.vigilar_fallos === 2)
  ok('anula el sello del último vigilar bueno (aplicar no escribe)', 'vigilar_ok_at' in c && c.vigilar_ok_at === null)
  ok('fallos raros cuentan desde 0', camposDeVigilarFallido(Number.NaN).vigilar_fallos === 1)
  ok('tras un vigilar fallido no se da otro paso (ni aplicar)', seguirTrasPasoFallido('vigilar') === false)
  ok('tras otro paso fallido se sigue', seguirTrasPasoFallido('cerebro') === true)
}

console.log('\n=== pendientes por cuenta (dos consultas de límite 1 por cuenta, sin el corte de 1.000 filas) ===')
{
  const m = pendientesDeResultados(['a', 'b', 'c', 'd'], [
    { hay: 1, revisar: 0 },
    { hay: 0, revisar: 0 },
    { hay: 1, revisar: 1 },
    // Un REVISAR libre es también una pendiente libre aunque la primera consulta no la trajera
    { hay: 0, revisar: 1 },
  ])
  ok('con una libre: hay, sin REVISAR', m.get('a')?.hay === true && m.get('a')?.revisar === false)
  ok('sin ninguna: no sale', !m.has('b'))
  ok('con REVISAR: hay y revisar', m.get('c')?.hay === true && m.get('c')?.revisar === true)
  ok('solo el REVISAR: hay = true', m.get('d')?.hay === true && m.get('d')?.revisar === true)
  // Cada cuenta se mira por separado: que otra cuenta tenga miles de pendientes no deja a esta sin ellas
  const muchas = pendientesDeResultados(['grande', 'pequena'], [{ hay: 1, revisar: 1 }, { hay: 1, revisar: 0 }])
  ok('una cuenta con pocas pendientes sigue con hay = true junto a una con muchas', muchas.get('pequena')?.hay === true)
}

console.log('\n=== orden de las cuentas: la más urgente primero ===')
{
  const c = (id: string, vigilarOkAt: string | null, aplicarAt: string | null = null) => ({ id, config: { vigilarOkAt, marcas: { aplicarAt } } })
  const orden = ordenarPorUrgencia([
    c('reciente', '2026-12-10T11:55:00Z', '2026-12-10T11:50:00Z'),
    c('vieja', '2026-12-10T10:00:00Z'),
    c('nunca', null),
    c('igual-aplico-antes', '2026-12-10T11:55:00Z', '2026-12-10T08:00:00Z'),
    c('igual-sin-aplicar', '2026-12-10T11:55:00Z', null),
  ]).map((x) => x.id)
  ok('sin vigilar bueno primero', orden[0] === 'nunca', orden.join(','))
  ok('después el vigilar más viejo', orden[1] === 'vieja', orden.join(','))
  ok('a igualdad de vigilar, la que nunca aplicó y luego la que aplicó hace más', orden.slice(2).join(',') === 'igual-sin-aplicar,igual-aplico-antes,reciente', orden.join(','))
  ok('no cambia la lista de entrada', ordenarPorUrgencia([c('x', null)]).length === 1)
}

console.log('\n=== firma de la reserva de la cuenta ===')
{
  const ms = Date.parse('2026-12-10T12:00:00.123Z')
  const f = firmaDeReserva(ms, 0.4567)
  ok('lleva microsegundos: 6 decimales', f === '2026-12-10T12:00:00.123456Z', f)
  ok('el instante es el mismo (al milisegundo)', Date.parse(f) === ms)
  ok('dos reservas del mismo milisegundo con distinto azar no se confunden (soltar con una firma ajena no toca la reserva)', firmaDeReserva(ms, 0.1) !== firmaDeReserva(ms, 0.2))
  ok('azar fuera de rango se acota', firmaDeReserva(ms, 1) === '2026-12-10T12:00:00.123999Z' && firmaDeReserva(ms, -1) === '2026-12-10T12:00:00.123000Z')
}

if (fallos) {
  console.log(`\n${fallos} FALLO(S)`)
  process.exit(1)
}
console.log('\nTODO BIEN')
