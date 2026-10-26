import { MODELOS_ELEGIBLES, PRECIOS_OFICIALES, costeDeUso, costeSinCache, enCentimos, precioDe, sinFechaDeVersion } from '@/lib/ia/precios'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}
const cerca = (a: number | null, b: number, margen = 1e-9) => a !== null && Math.abs(a - b) < margen

console.log('\n=== los precios ===')
{
  ok('luna: 0,10 de entrada, 0,01 en caché, 0,50 de salida (página oficial)', precioDe('gpt-6-luna')?.entrada === 0.1 && precioDe('gpt-6-luna')?.cache === 0.01 && precioDe('gpt-6-luna')?.salida === 0.5)
  ok('terra: 2 de entrada, 0,20 en caché, 12 de salida', precioDe('gpt-5.6-terra')?.entrada === 2 && precioDe('gpt-5.6-terra')?.cache === 0.2 && precioDe('gpt-5.6-terra')?.salida === 12)
  ok('un modelo con fecha de versión cuesta lo mismo', precioDe('gpt-5.6-terra-2026-03-01')?.salida === 12 && sinFechaDeVersion('GPT-5.6-Terra-2026-03-01') === 'gpt-5.6-terra' && sinFechaDeVersion('gpt-6-luna') === 'gpt-6-luna')
  ok('uno que no se conoce, null', precioDe('gpt-9') === null && precioDe('') === null)
  ok('todos tienen entrada, salida y caché que no sube de la entrada', Object.values(PRECIOS_OFICIALES).every((p) => p.entrada > 0 && p.salida > p.entrada && (p.cache === null || p.cache <= p.entrada)))
}

console.log('\n=== lo que cuesta una llamada ===')
{
  ok('luna: 2.500 de entrada sin caché y 100 de salida son 0,0003 $', cerca(costeDeUso('gpt-6-luna', { entrada: 2500, salida: 100 }), 0.0003, 1e-9))
  ok('con 2.000 en caché baja a 0,00014 $', cerca(costeDeUso('gpt-6-luna', { entrada: 2500, salida: 100, cache: 2000 }), (500 * 0.1 + 2000 * 0.01 + 100 * 0.5) / 1e6, 1e-12) && cerca(costeDeUso('gpt-6-luna', { entrada: 2500, salida: 100, cache: 2000 }), 0.00012, 0.00003))
  ok('terra con caché caliente ronda 0,0024 $ y sin caché 0,0062 $', cerca(costeDeUso('gpt-5.6-terra', { entrada: 2480, salida: 93, cache: 2025 }), 0.0024, 0.0003) && cerca(costeSinCache('gpt-5.6-terra', { entrada: 2480, salida: 93, cache: 2025 }), 0.00608, 0.0001))
  ok('terra cuesta de 10 a 20 veces más que luna con los mismos tokens', (costeDeUso('gpt-5.6-terra', { entrada: 2500, salida: 100, cache: 2000 }) as number) / (costeDeUso('gpt-6-luna', { entrada: 2500, salida: 100, cache: 2000 }) as number) > 10)
  ok('una caché mayor que la entrada se recorta, una negativa se ignora', cerca(costeDeUso('gpt-6-luna', { entrada: 1000, salida: 0, cache: 5000 }), 1000 * 0.01 / 1e6, 1e-12) && cerca(costeDeUso('gpt-6-luna', { entrada: 1000, salida: 0, cache: -3 }), 1000 * 0.1 / 1e6, 1e-12))
  ok('un modelo sin tarifa de caché cobra todo a entrada', cerca(costeDeUso('gpt-5.5', { entrada: 1000, salida: 0, cache: 1000 }), 1000 * 0.5 / 1e6, 1e-12))
  ok('modelo desconocido o sin tokens: null, antes que inventar', costeDeUso('gpt-9', { entrada: 1, salida: 1 }) === null && costeDeUso('gpt-6-luna', null) === null && costeDeUso('gpt-6-luna', undefined) === null && costeSinCache('gpt-6-luna', null) === null)
  ok('sin caché es el techo', (costeSinCache('gpt-6-luna', { entrada: 2500, salida: 100, cache: 2000 }) as number) > (costeDeUso('gpt-6-luna', { entrada: 2500, salida: 100, cache: 2000 }) as number))
}

console.log('\n=== dicho en céntimos ===')
{
  ok('0,00014 $ = 0,014 céntimos', enCentimos(0.00014) === '0,014 céntimos', enCentimos(0.00014))
  ok('0,0024 $ = 0,24 céntimos', enCentimos(0.0024) === '0,24 céntimos', enCentimos(0.0024))
  ok('0,0087 $ = 0,87 céntimos y 0,05 $ = 5,0 céntimos', enCentimos(0.0087) === '0,87 céntimos' && enCentimos(0.05) === '5,0 céntimos', `${enCentimos(0.0087)} · ${enCentimos(0.05)}`)
  ok('0,25 $ = 25 céntimos', enCentimos(0.25) === '25 céntimos', enCentimos(0.25))
  ok('sin dato, «coste desconocido»', enCentimos(null) === 'coste desconocido' && enCentimos(undefined) === 'coste desconocido' && enCentimos(NaN) === 'coste desconocido')
}

console.log('\n=== los modelos que se pueden elegir ===')
{
  ok('hay cuatro, del más barato al más caro', MODELOS_ELEGIBLES.length === 4 && MODELOS_ELEGIBLES.every((m, i, l) => i === 0 || (precioDe(m.id)?.salida ?? 0) >= (precioDe(l[i - 1].id)?.salida ?? 0)))
  ok('todos tienen precio conocido, nombre y una frase', MODELOS_ELEGIBLES.every((m) => precioDe(m.id) !== null && m.nombre.length > 2 && m.detalle.length > 20))
  ok('el primero es luna', MODELOS_ELEGIBLES[0].id === 'gpt-6-luna')
}

console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
