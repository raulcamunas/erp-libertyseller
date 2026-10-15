import {
  HORA_MS,
  POLITICA_POR_DEFECTO,
  elegirPendientes,
  huerfanas,
  type FilaPrevia,
  type FilaUniverso,
  type Politica,
} from '@/lib/cumplimiento/pendientes'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

const AHORA = Date.parse('2026-10-15T10:00:00Z')
const politica = (extra: Partial<Politica> = {}): Politica => ({ ahora: AHORA, ...POLITICA_POR_DEFECTO, ...extra })
const hace = (horas: number) => AHORA - horas * HORA_MS
const ES = 'A1RKKUPIHCS9HS'
const FR = 'A13V1IB3VIYZZH'
const u = (sku: string, conStock: boolean, mercado = ES): FilaUniverso => ({ mercado, sku, conStock })
const p = (sku: string, horas: number, abierto = false, enAmazon = true, mercado = ES): FilaPrevia => ({
  mercado,
  sku,
  revisadoAt: hace(horas),
  abierto,
  enAmazon,
})
const skus = (c: { sku: string }[]) => c.map((x) => x.sku).join()

console.log('\n=== el orden de los niveles ===')
{
  const universo = [
    u('limpio-sin-stock', false),
    u('limpio-con-stock', true),
    u('nuevo-sin-stock', false),
    u('abierto', true),
    u('nuevo-con-stock', true),
    u('inexistente', false),
  ]
  const previas = [
    p('limpio-sin-stock', 100),
    p('limpio-con-stock', 30),
    p('abierto', 8, true),
    p('inexistente', 24 * 8, false, false),
  ]
  const r = elegirPendientes(universo, previas, politica(), 100)
  ok(
    'nuevo con stock, abierto, nuevo sin stock, limpio con stock, limpio sin stock, inexistente',
    skus(r) === 'nuevo-con-stock,abierto,nuevo-sin-stock,limpio-con-stock,limpio-sin-stock,inexistente',
    skus(r)
  )
  ok('los niveles son 0,1,2,3,4,5', r.map((c) => c.nivel).join() === '0,1,2,3,4,5')
}

console.log('\n=== lo que no ha vencido no se vuelve a pedir ===')
{
  const universo = [u('a', true), u('b', true), u('c', false), u('d', false)]
  const previas = [p('a', 2, true), p('b', 20), p('c', 60), p('d', 10, false, false)]
  ok('ninguno vencido: nada', elegirPendientes(universo, previas, politica(), 100).length === 0)
  const r = elegirPendientes(universo, [p('a', 7, true), p('b', 25), p('c', 73), p('d', 24 * 7 + 1, false, false)], politica(), 100)
  ok('vencidos justo después del plazo: todos', skus(r) === 'a,b,c,d', skus(r))
  ok('un abierto vence a las 6 h', elegirPendientes([u('a', true)], [p('a', 5.9, true)], politica(), 5).length === 0 && elegirPendientes([u('a', true)], [p('a', 6.1, true)], politica(), 5).length === 1)
}

console.log('\n=== «revisar ahora» ===')
{
  const universo = [u('abierto', true), u('limpio-con-stock', true), u('limpio-sin-stock', false), u('inexistente', false)]
  const previas = [p('abierto', 0.1, true), p('limpio-con-stock', 0.1), p('limpio-sin-stock', 0.1), p('inexistente', 0.1, false, false)]
  const r = elegirPendientes(universo, previas, politica({ forzar: true }), 100)
  ok('fuerza los abiertos y los limpios con stock', skus(r) === 'abierto,limpio-con-stock', skus(r))
  ok('pero no los limpios sin stock ni los inexistentes', !skus(r).includes('sin-stock') && !skus(r).includes('inexistente'))
}

console.log('\n=== dentro de un nivel, el más antiguo primero ===')
{
  const universo = [u('x', true), u('y', true), u('z', true)]
  const previas = [p('x', 30), p('y', 90), p('z', 50)]
  ok('y, z, x', skus(elegirPendientes(universo, previas, politica(), 10)) === 'y,z,x')
  const nuevos = [u('b', true), u('a', true), u('c', true)]
  ok('los nuevos, por SKU', skus(elegirPendientes(nuevos, [], politica(), 10)) === 'a,b,c')
}

console.log('\n=== el límite ===')
{
  const universo = Array.from({ length: 50 }, (_, i) => u(`s${String(i).padStart(2, '0')}`, true))
  ok('corta en el límite', elegirPendientes(universo, [], politica(), 7).length === 7)
  ok('límite 0 = nada', elegirPendientes(universo, [], politica(), 0).length === 0)
  ok('límite negativo = nada', elegirPendientes(universo, [], politica(), -3).length === 0)
  ok('límite mayor que lo que hay = todo', elegirPendientes(universo, [], politica(), 500).length === 50)
  const mezcla = [...universo, u('viejo', true)]
  const r = elegirPendientes(mezcla, [p('viejo', 200, true)], politica(), 3)
  ok('el límite respeta los niveles: los nuevos con stock van antes que un abierto', !skus(r).includes('viejo'), skus(r))
}

console.log('\n=== el mismo SKU en dos países son dos listings ===')
{
  const universo = [u('A', true, ES), u('A', true, FR)]
  const r = elegirPendientes(universo, [p('A', 1, false, true, ES)], politica(), 10)
  ok('solo falta Francia', r.length === 1 && r[0].mercado === FR, JSON.stringify(r))
}

console.log('\n=== huérfanas ===')
{
  const universo = [u('a', true), u('b', true)]
  const previas = [p('a', 1), p('b', 1), p('borrado', 1), p('a', 1, false, true, FR)]
  const h = huerfanas(universo, previas)
  ok('el borrado y el del otro país', h.length === 2 && h.some((x) => x.sku === 'borrado') && h.some((x) => x.mercado === FR))
  ok('con el universo vacío no se da ninguna por huérfana', huerfanas([], previas).length === 0)
  ok('sin previas, nada', huerfanas(universo, []).length === 0)
}

console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
