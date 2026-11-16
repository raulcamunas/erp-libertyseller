import {
  calidadDesdeLectura,
  claveDeResumen,
  domingoDe,
  kpisDeEnvios,
  llegadaPrevistaDe,
  prioridadesDeLineas,
  resumenDesdeAlertas,
  salidasPorSemana,
  totalesPorMoneda,
  type EnvioParaResumen,
} from '@/lib/fba/resumen-servidor'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/**
 * LAS PIEZAS PURAS DEL RESUMEN GLOBAL (vista «Hoy»; spec §9, §11 D34 y D42).
 * Hoy = domingo 15 nov 2026: la semana va del lunes 9 al domingo 15.
 */
const HOY = '2026-11-15'

const envio = (e: Partial<EnvioParaResumen> = {}): EnvioParaResumen => ({
  id: 'e1', clienteId: 'opinas', estado: 'nuevo', prioridad: 'esta_semana', salirAntesDe: '2026-11-20', fechaLimite: null, unidades: 100, ...e,
})

console.log('\n=== semana ===')
ok('el domingo de un domingo es él mismo', domingoDe(HOY) === '2026-11-15', domingoDe(HOY))
ok('el domingo de un miércoles', domingoDe('2026-11-18') === '2026-11-22', domingoDe('2026-11-18'))

console.log('\n=== € por moneda (D34): nunca se suman monedas ===')
{
  const t = totalesPorMoneda([
    { moneda: 'EUR', total: 8000 }, { moneda: 'EUR', total: 420.4 }, { moneda: 'USD', total: 1200 }, { moneda: 'EUR', total: 0 }, { moneda: null, total: 10 }, { moneda: 'GBP', total: null },
  ])
  ok('dos monedas, la mayor primero', t.length === 2 && t[0].moneda === 'EUR' && t[1].moneda === 'USD', JSON.stringify(t))
  ok('EUR = 8.000 + 420 + 10 (sin moneda cuenta como EUR)', t[0].total === 8430, JSON.stringify(t))
  ok('USD aparte, sin convertir', t[1].total === 1200)
  ok('sin nada → lista vacía', totalesPorMoneda([]).length === 0)
}

console.log('\n=== salidas por semana (8 semanas, siempre 8 filas) ===')
{
  const s = salidasPorSemana(
    [
      envio({ salirAntesDe: '2026-11-10', unidades: 50 }), // ya tenía que haber salido → semana actual
      envio({ id: 'e2', salirAntesDe: '2026-11-20', unidades: 100 }),
      envio({ id: 'e3', clienteId: 'cobo', salirAntesDe: '2026-11-19', unidades: 30, estado: 'en_preparacion' }),
      envio({ id: 'e4', salirAntesDe: '2026-11-18', unidades: 999, estado: 'descartado' }), // no activo
      envio({ id: 'e5', salirAntesDe: '2027-03-01', unidades: 70 }), // fuera de la ventana
      envio({ id: 'e6', salirAntesDe: '2026-11-01', unidades: 5, prioridad: 'tarde' }), // muy pasado → semana actual
    ],
    HOY
  )
  ok('8 filas', s.length === 8, String(s.length))
  ok('la primera es el lunes de esta semana', s[0].semana === '2026-11-09', s[0].semana)
  ok('la segunda, el lunes siguiente', s[1].semana === '2026-11-16', s[1].semana)
  ok('lo atrasado cae en la semana actual', s[0].porCliente.opinas === 55, JSON.stringify(s[0]))
  ok('semana del 16: opinas 100 y cobo 30', s[1].porCliente.opinas === 100 && s[1].porCliente.cobo === 30, JSON.stringify(s[1]))
  ok('lo descartado y lo de marzo no salen', s.every((f) => !Object.values(f.porCliente).some((n) => n === 999 || n === 70)))
  ok('sin envíos, 8 filas vacías', salidasPorSemana([], HOY).every((f) => Object.keys(f.porCliente).length === 0))
}

console.log('\n=== KPI de envíos ===')
{
  const k = kpisDeEnvios(
    [
      envio({ salirAntesDe: '2026-11-14', fechaLimite: '2026-11-13' }), // sale esta semana y está vencido
      envio({ id: 'e2', salirAntesDe: '2026-11-15', fechaLimite: '2026-11-15', estado: 'hablado' }), // sale hoy, vence hoy (no vencido)
      envio({ id: 'e3', salirAntesDe: '2026-11-22', fechaLimite: '2026-11-20' }), // la semana que viene
      envio({ id: 'e4', salirAntesDe: '2026-11-12', fechaLimite: '2026-11-01', estado: 'en_preparacion' }), // ya en preparación: no vence
    ],
    HOY
  )
  ok('salen esta semana: 3 (incluye en preparación)', k.salenEstaSemana === 3, JSON.stringify(k))
  ok('vencidos: 1', k.pendientesVencidos === 1, JSON.stringify(k))
  ok('vencen esta semana: 1 (el de hoy)', k.pendientesEstaSemana === 1, JSON.stringify(k))
}

console.log('\n=== prioridades de las líneas ===')
{
  const p = prioridadesDeLineas([
    { prioridad: 'urgente', cantidad: 12, fuera: null },
    { prioridad: 'urgente', cantidad: 0, fuera: null },
    { prioridad: 'tarde', cantidad: 5, fuera: 'parado' },
    { prioridad: 'esta_semana', cantidad: 3, fuera: null },
  ])
  ok('solo cuentan las que se proponen', p.urgente === 1 && p.esta_semana === 1 && p.tarde === undefined, JSON.stringify(p))
}

console.log('\n=== resumen sin plan (desde alertas, sin la 316) ===')
{
  const r = resumenDesdeAlertas(
    [
      { tipo: 'agotado', impacto: 300, datos: {} },
      { tipo: 'reponer_ya', impacto: 120.6, datos: { diasHastaRotura: 9 } },
      { tipo: 'rotura_proxima', impacto: 50, datos: { diasHastaRotura: 25 } },
      { tipo: 'parado', impacto: 999, datos: { diasHastaRotura: 1 } }, // no es de reposición
    ],
    { referencias: 52, vendibles: 3138, deCamino: 2079 },
    HOY,
    'EUR'
  )
  ok('roturas en 14 días: agotado + reponer ya', r.roturas14 === 2, String(r.roturas14))
  ok('roturas en 30 días: 3', r.roturas30 === 3, String(r.roturas30))
  ok('€ = 300 + 121 + 50, sin la de «parado»', r.eurosEnRiesgo === 471, String(r.eurosEnRiesgo))
  ok('primera rotura hoy (el agotado)', r.primeraRotura === HOY, String(r.primeraRotura))
  ok('agotados con ventas: 1', r.agotadosConVentas === 1)
  ok('sin propuestas ni cobertura (solo las sabe el plan)', r.conPropuesta === 0 && r.coberturaMediana === null)
  ok('stock tal cual', r.vendibles === 3138 && r.deCamino === 2079 && r.referencias === 52)
}

console.log('\n=== calidad sin pasada ===')
{
  const sin = calidadDesdeLectura(null, HOY, { mercadoRemesa: 'A1RKKUPIHCS9HS', conexionesActivas: 1 })
  ok('sin lectura → sin_leer con aviso', sin.libro === 'sin_leer' && sin.avisos.length === 1, JSON.stringify(sin.avisos))
  const atrasada = calidadDesdeLectura(
    { marketplaceId: 'A1RKKUPIHCS9HS', leidoHasta: '2026-11-06', leidoDesde: '2025-06-01', ultimoError: null, aviso: null },
    HOY,
    { mercadoRemesa: null, conexionesActivas: 1 }
  )
  ok('9 días de atraso → provisional', atrasada.provisional && atrasada.diasAtraso === 9, JSON.stringify(atrasada))
  ok('…y el aviso «No te fíes»', atrasada.avisos.some((a) => a.startsWith('No te fíes')), JSON.stringify(atrasada.avisos))
  const fallo = calidadDesdeLectura(
    { marketplaceId: 'A1RKKUPIHCS9HS', leidoHasta: '2026-11-14', leidoDesde: '2025-06-01', ultimoError: 'No dio tiempo', aviso: null },
    HOY,
    { mercadoRemesa: null, conexionesActivas: 2 }
  )
  ok('lectura fallida se dice', fallo.avisos.some((a) => a.includes('No dio tiempo')) && !fallo.provisional && fallo.libro === 'ok')
  ok('conexiones activas se conservan', fallo.conexionesActivas === 2)
}

console.log('\n=== llegada prevista de un envío de camino (D3) ===')
ok('si Amazon ya dio la llegada, esa', llegadaPrevistaDe({ fechaEnvio: '2026-11-01', llegadaAt: '2026-11-08T10:00:00Z' }, HOY, 6, 4) === '2026-11-08')
ok('salida + transporte si es futura', llegadaPrevistaDe({ fechaEnvio: '2026-11-14', llegadaAt: null }, HOY, 10, 4) === '2026-11-24')
ok('nunca antes de hoy + recepción', llegadaPrevistaDe({ fechaEnvio: '2026-09-20', llegadaAt: null }, HOY, 16, 7) === '2026-11-22')
ok('sin fecha de envío, null', llegadaPrevistaDe({ fechaEnvio: null, llegadaAt: null }, HOY, 6, 4) === null)

console.log('\n=== clave de la memoria (D32) ===')
ok('ordenada: el orden de los permitidos no cambia la clave', claveDeResumen(['b', 'a'], HOY) === claveDeResumen(['a', 'b'], HOY))
ok('todos ≠ una lista', claveDeResumen(null, HOY) !== claveDeResumen(['a'], HOY))
ok('cambia con el día', claveDeResumen(null, HOY) !== claveDeResumen(null, '2026-11-16'))

console.log(fallos === 0 ? '\nTODO BIEN' : `\n${fallos} FALLOS`)
if (fallos > 0) process.exit(1)
