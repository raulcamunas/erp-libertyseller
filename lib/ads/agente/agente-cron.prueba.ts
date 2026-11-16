/**
 * Pruebas de las piezas PURAS de agente-cron.ts (sin red ni base de datos).
 *   npx tsx lib/ads/agente/agente-cron.prueba.ts
 */
import { camposDeVigilarFallido, cambiosDistintosDelEnsayo, horaDeMinuto, seguirTrasPasoFallido, vigilarHizoAlgo } from './agente-cron'

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

if (fallos) {
  console.log(`\n${fallos} FALLO(S)`)
  process.exit(1)
}
console.log('\nTODO BIEN')
