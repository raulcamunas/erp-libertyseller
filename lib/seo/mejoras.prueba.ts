import { claveDePeriodo, mesesAnteriores, semanasAnteriores, ultimaSemana, ultimoMes } from './periodos'
import { periodoQueToca, topQueToca } from './lectura'
import { LectorDeTop, normalizarConsulta, unaPorPosicion } from './top-terminos'
import { cortarEnPalabra, limpiarBackend, limpiarPropuesta, patchesDeFicha, trozosNuevos } from './propuesta'
import { busquedasSinExacta, terminosQueFaltanEnLaFicha } from './publicidad-calculo'
import { bytesDe } from './cobertura'
import type { ConsultaGuardada, FichaGuardada } from './datos'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

const HOY = '2026-11-11' // miércoles

console.log('\n=== periodos hacia atrás ===')
{
  const s = semanasAnteriores(HOY, 3)
  const u = ultimaSemana(HOY)
  ok('3 semanas anteriores, de domingo a sábado', s.length === 3 && s.every((r) => new Date(`${r.desde}T00:00:00Z`).getUTCDay() === 0 && new Date(`${r.hasta}T00:00:00Z`).getUTCDay() === 6), JSON.stringify(s))
  ok('la primera es justo la anterior a la última publicada', Date.parse(u.desde) - Date.parse(s[0].desde) === 7 * 86_400_000, `${u.desde} / ${s[0].desde}`)
  const m = mesesAnteriores(HOY, 3)
  ok('los 3 meses anteriores al último publicado (sep, ago, jul)', m.map((r) => r.desde).join(',') === '2026-09-01,2026-08-01,2026-07-01', JSON.stringify(m))
  ok('julio acaba el 31', m[2].hasta === '2026-07-31')
  ok('clave de periodo', claveDePeriodo({ periodo: 'WEEK', desde: '2026-11-01' }) === 'WEEK:2026-11-01')
}

console.log('\n=== qué periodo toca ===')
{
  const mes = ultimoMes(HOY)
  const sem = ultimaSemana(HOY)
  ok('sin nada: el mes', periodoQueToca(null, HOY)?.desde === mes.desde)
  ok('sin la migración 299 (sin periodos_leidos), con mes y semana al día: nada', periodoQueToca({ mes_ok: mes.desde, semana_ok: sem.desde }, HOY) === null)
  const t = periodoQueToca({ mes_ok: mes.desde, semana_ok: sem.desde, periodos_leidos: [] }, HOY)
  ok('con histórico: la semana anterior a la última', t?.periodo === 'WEEK' && t.desde === semanasAnteriores(HOY, 1)[0].desde, JSON.stringify(t))
  const todas = [...semanasAnteriores(HOY, 8), ...mesesAnteriores(HOY, 3)].map(claveDePeriodo)
  ok('con todo el histórico leído: nada', periodoQueToca({ mes_ok: mes.desde, semana_ok: sem.desde, periodos_leidos: todas }, HOY) === null)
  const sinMeses = [...semanasAnteriores(HOY, 8)].map(claveDePeriodo)
  ok('con las semanas leídas: el primer mes anterior', periodoQueToca({ mes_ok: mes.desde, semana_ok: sem.desde, periodos_leidos: sinMeses }, HOY)?.desde === '2026-09-01')
}

console.log('\n=== cuándo se pide la competencia ===')
{
  const ahora = Date.parse(`${HOY}T12:00:00Z`)
  const base = { mejoras: true, acceso: 'si' as const, top_report_id: null, top_ok: null, top_pedido_at: null }
  ok('con acceso y sin leer: la última semana', topQueToca(base, HOY, ahora)?.desde === ultimaSemana(HOY).desde)
  ok('sin la migración: nunca', topQueToca({ ...base, mejoras: false }, HOY, ahora) === null)
  ok('sin acceso confirmado: no', topQueToca({ ...base, acceso: 'desconocido' as const }, HOY, ahora) === null)
  ok('ya leída esta semana: no', topQueToca({ ...base, top_ok: ultimaSemana(HOY).desde }, HOY, ahora) === null)
  ok('con un pedido en marcha: no', topQueToca({ ...base, top_report_id: 'x' }, HOY, ahora) === null)
  ok('tras un fallo hace 5 min: espera', topQueToca({ ...base, top_pedido_at: new Date(ahora - 5 * 60_000).toISOString() }, HOY, ahora) === null)
}

console.log('\n=== el informe Top Search Terms leído a trozos ===')
{
  const json = JSON.stringify({
    reportSpecification: { reportType: 'GET_BRAND_ANALYTICS_SEARCH_TERMS_REPORT', reportOptions: { reportPeriod: 'WEEK' }, dataStartTime: '2026-11-01', dataEndTime: '2026-11-07', marketplaceIds: ['A1RKKUPIHCS9HS'] },
    dataByDepartmentAndSearchTerm: [
      { departmentName: 'Amazon.es', searchTerm: 'Jamón Ibérico', searchFrequencyRank: 120, clickedAsin: 'B0AAAAAAA1', clickShareRank: 1, clickShare: 0.21, conversionShare: 0.3 },
      { departmentName: 'Amazon.es', searchTerm: 'Jamón Ibérico', searchFrequencyRank: 120, clickedAsin: 'B0AAAAAAA2', clickShareRank: 2, clickShare: 0.11, conversionShare: 0.09 },
      { departmentName: 'Amazon.es', searchTerm: 'llave {rara} "con comillas"', searchFrequencyRank: 9, clickedAsin: 'B0AAAAAAA3', clickShareRank: 1, clickShare: 0.5, conversionShare: 0.4 },
      { departmentName: 'Amazon.es', searchTerm: 'zapatillas', searchFrequencyRank: 3, clickedAsin: 'B0AAAAAAA4', clickShareRank: 1, clickShare: 0.05, conversionShare: 0.02 },
      { departmentName: 'Hogar', searchTerm: 'jamón ibérico', searchFrequencyRank: 900, clickedAsin: 'B0AAAAAAA9', clickShareRank: 1, clickShare: 0.9, conversionShare: 0.9 },
    ],
  })
  const quiere = new Set(['jamón ibérico', 'llave {rara} "con comillas"'])
  // Trozos de 7 caracteres: las filas, las cadenas y los escapes quedan partidos por en medio
  const l = new LectorDeTop((q) => quiere.has(q))
  for (let i = 0; i < json.length; i += 7) l.empujar(json.slice(i, i + 7))
  ok('ve las 5 filas de datos (y no la cabecera)', l.filasVistas === 5, String(l.filasVistas))
  ok('guarda solo las búsquedas que interesan (4)', l.guardadas.length === 4, JSON.stringify(l.guardadas.map((f) => f.consulta)))
  ok('una «{» dentro de una búsqueda no la confunde', l.guardadas.some((f) => f.consulta === 'llave {rara} "con comillas"'))
  const una = unaPorPosicion(l.guardadas)
  const primera = una.find((f) => normalizarConsulta(f.consulta) === 'jamón ibérico' && f.posicion === 1)
  ok('repetida en dos departamentos: se queda la de mejor rango', una.length === 3 && primera?.asin === 'B0AAAAAAA1', JSON.stringify(una))
  ok('cuotas tal cual (0..1)', primera?.cuotaClics === 0.21 && primera?.cuotaConversion === 0.3)
  const l2 = new LectorDeTop(() => true)
  l2.empujar(json)
  ok('de una vez da lo mismo', l2.guardadas.length === 5)
}

console.log('\n=== limpiar la propuesta de la IA ===')
{
  const larga = 'Ham Master Jamón Ibérico de Cebo 50% Raza Ibérica Entero 8 kg ' + 'curado lentamente en bodega natural '.repeat(8)
  const r = limpiarPropuesta({ titulo: `${larga}!!`, bullets: ['a', 'b', 'c', 'd', 'e', 'f'], backend: 'jamón, paleta, paleta, B0ABCDEFGH, pata negra, ' + 'serrano '.repeat(3) + 'x'.repeat(300), razonamiento: { resumen: 'Estrategia', cambios: [{ campo: 'titulo', que: 'añade cebo', porQue: '5.000 búsquedas' }], palabrasNuevas: ['cebo'] } })
  ok('sin error', !('error' in r), JSON.stringify(r).slice(0, 200))
  if (!('error' in r)) {
    ok('título ≤ 200, sin «!» y sin cortar una palabra', r.titulo.length <= 200 && !r.titulo.includes('!') && !/\s$/.test(r.titulo), `${r.titulo.length}: ${r.titulo}`)
    ok('5 bullets como mucho', r.bullets.length === 5)
    ok('backend ≤ 250 bytes', bytesDe(r.backend) <= 250, String(bytesDe(r.backend)))
    ok('backend sin comas, sin ASIN, sin repetidas y sin palabras del título (jamón)', !r.backend.includes(',') && !/b0abcdefgh/i.test(r.backend) && r.backend.split(' ').filter((w) => w === 'paleta').length === 1 && !r.backend.split(' ').includes('jamón'), r.backend)
    ok('dice lo que ha recortado', r.avisos.length >= 2, JSON.stringify(r.avisos))
    ok('el razonamiento pasa', r.razonamiento.resumen === 'Estrategia' && r.razonamiento.cambios.length === 1 && r.razonamiento.palabrasNuevas[0] === 'cebo')
  }
  ok('sin título → error', 'error' in limpiarPropuesta({ bullets: ['x'] }))
  ok('cortar en palabra', cortarEnPalabra('uno dos tres cuatro', 10) === 'uno dos', cortarEnPalabra('uno dos tres cuatro', 10))
  ok('backend: las tildes cuentan doble en bytes', bytesDe(limpiarBackend('ñ'.repeat(10) + ' ' + 'á'.repeat(200), '').texto) <= 250)
}

console.log('\n=== el PATCH que se manda a Amazon ===')
{
  const p = patchesDeFicha({ titulo: 'T', bullets: ['a', 'b'], backend: 'x y' }, 'A1RKKUPIHCS9HS', 'es_ES')
  ok('tres operaciones replace: título, bullets y backend', p.length === 3 && p.every((o) => o.op === 'replace') && p.map((o) => o.path).join() === '/attributes/item_name,/attributes/bullet_point,/attributes/generic_keyword')
  ok('cada valor con su idioma y su marketplace', p[1].value.length === 2 && p[1].value.every((v) => v.language_tag === 'es_ES' && v.marketplace_id === 'A1RKKUPIHCS9HS'))
  ok('backend vacío: no se manda (no se borra el que hubiera)', patchesDeFicha({ titulo: 'T', bullets: ['a'], backend: '  ' }, 'X', 'es_ES').length === 2)
}

console.log('\n=== lo nuevo resaltado ===')
{
  const t = trozosNuevos('Jamón ibérico entero', 'Jamón ibérico de cebo entero')
  const nuevas = t.filter((x) => x.nuevo).map((x) => x.texto)
  ok('marca solo las palabras que no estaban (cebo; «de» no cuenta)', nuevas.join(',') === 'cebo', nuevas.join(','))
}

console.log('\n=== cruzar con Marketing Test ===')
{
  const ficha: FichaGuardada = { asin: 'B0X', sku: 'S', titulo: 'Jamón ibérico de cebo', bullets: ['Curado 24 meses'], descripcion: null, backend: 'pata negra', leidaAt: '' }
  const t = terminosQueFaltanEnLaFicha(
    [
      { termino: 'jamon iberico bellota', pedidos: 3, ventas: 300, clics: 30, gasto: 20 },
      { termino: 'Jamón ibérico bellota', pedidos: 1, ventas: 100, clics: 5, gasto: 4 },
      { termino: 'pata negra', pedidos: 5, ventas: 500, clics: 40, gasto: 30 },
      { termino: 'b0abcdefgh', pedidos: 2, ventas: 90, clics: 9, gasto: 9 },
      { termino: 'regalo', pedidos: 0, ventas: 0, clics: 50, gasto: 25 },
    ],
    ficha
  )
  ok('suma el mismo término escrito distinto y dice qué falta (bellota)', t.length === 1 && t[0].pedidos === 4 && t[0].faltan.join() === 'bellota', JSON.stringify(t))
  const c = (consulta: string, comprasTotal: number, volumen: number) => ({ consulta, comprasTotal, volumen, cuotaCompras: 0.1 }) as unknown as ConsultaGuardada
  const s = busquedasSinExacta([c('jamon iberico', 200, 9000), c('jamon de cebo', 50, 3000), c('jamon serrano', 0, 20000), c('paleta', 80, 4000)], new Set(['jamon iberico']), new Set(['paleta']))
  ok('sin exacta: fuera la que ya la tiene y la que no vende; ordenadas por compras', s.map((x) => x.consulta).join() === 'paleta,jamon de cebo', JSON.stringify(s))
  ok('marca la que ya está en amplia o frase', s[0].enOtraConcordancia === true && s[1].enOtraConcordancia === false)
}

console.log(fallos === 0 ? '\nTODO OK' : `\n${fallos} FALLOS`)
process.exit(fallos === 0 ? 0 : 1)
