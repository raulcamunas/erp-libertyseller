import { ipDe, limitar, reiniciarLimites } from '@/lib/fba/limite-publico'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

console.log('\n=== el freno cuenta por clave y por ventana ===')
{
  reiniciarLimites()
  const t0 = 1_000_000
  const r = Array.from({ length: 5 }, (_, i) => limitar('ip1', 5, 60_000, t0 + i * 100))
  ok('las cinco primeras pasan', r.every((x) => x.ok))
  const sexta = limitar('ip1', 5, 60_000, t0 + 600)
  ok('la sexta dentro del minuto no, y dice cuánto esperar (59 s desde la primera)', !sexta.ok && sexta.reintentarEnS === 60 - 1 || (!sexta.ok && sexta.reintentarEnS >= 58 && sexta.reintentarEnS <= 60), JSON.stringify(sexta))
  ok('otra clave no se ve afectada', limitar('ip2', 5, 60_000, t0 + 700).ok)
  ok('pasado el minuto vuelve a dejar pasar', limitar('ip1', 5, 60_000, t0 + 61_000).ok)
  ok('lo rechazado no se cuenta: no se alarga el castigo', (() => { reiniciarLimites(); for (let i = 0; i < 3; i += 1) limitar('x', 3, 1000, 0); for (let i = 0; i < 50; i += 1) limitar('x', 3, 1000, 500); return limitar('x', 3, 1000, 1001).ok })())
}

console.log('\n=== la IP de quien llama ===')
{
  const con = (h: Record<string, string>) => new Request('http://x/', { headers: h })
  ok('la primera de x-forwarded-for', ipDe(con({ 'x-forwarded-for': '81.2.3.4, 10.0.0.1' })) === '81.2.3.4')
  ok('si no, x-real-ip', ipDe(con({ 'x-real-ip': '9.9.9.9' })) === '9.9.9.9')
  ok('si no hay nada, «desconocida»: todos esos comparten un solo cubo', ipDe(con({})) === 'desconocida')
}

console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
