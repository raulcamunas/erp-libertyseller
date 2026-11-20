/**
 * PRUEBAS DE LA PROPUESTA CON IA (lib/seo/propuesta.ts y aplicarPropuesta): marcas ajenas, descartadas, la marca en el título, cifras inventadas, propuesta vieja y caducidad.
 *   npx tsx lib/seo/propuesta.prueba.ts
 * No llama a la IA, ni a Amazon, ni a la base: aplicarPropuesta se prueba con validarYAplicar simulado.
 */
import { avisosRojos, cambiosDesdeLaPropuesta, cantidadesDe, marcasAjenasDe, motivoFichaCambiada, propuestaCaducada, sinMarcasAjenas, vigilarPropuesta, type ContextoDeVigilancia, type TextosPropuestos } from './propuesta'
import { aplicarPropuesta, type DepsDeAplicar, type PropuestaGuardada } from './propuesta-servidor'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

const fichaActual = { titulo: 'Cecotec Freidora de aire 5L sin aceite', highlights: null, bullets: ['CAPACIDAD: 5L para 4 personas', 'FÁCIL: cesta antiadherente'], descripcion: null, backend: 'airfryer freidora' }
const ctx = (o: Partial<ContextoDeVigilancia> = {}): ContextoDeVigilancia => ({ fichaActual, consultasRelevantes: [], descartadas: [], marcasAjenas: [], ...o })
const propuesta = (o: Partial<TextosPropuestos> = {}): TextosPropuestos => ({ titulo: 'Cecotec Freidora de aire 5L sin aceite digital', highlights: 'Cesta de 5L', bullets: ['CAPACIDAD: 5L para 4 personas', 'FÁCIL: cesta antiadherente'], backend: 'airfryer', ...o })

console.log('\n=== (a) marcas ajenas en el backend: se quitan y se avisa ===')
{
  const r = vigilarPropuesta(propuesta({ backend: 'cecotec cosori philips airfryer' }), ctx({ marcasAjenas: ['Cosori', 'Philips'] }))
  ok('backend sin cosori ni philips', r.propuesta.backend === 'cecotec airfryer', r.propuesta.backend)
  ok('aviso del backend', r.avisos.some((a) => a.campo === 'backend' && /cosori/i.test(a.texto) && /philips/i.test(a.texto)), JSON.stringify(r.avisos))
  ok('no es rojo (solo estaba en el backend)', avisosRojos(r.avisos).length === 0, JSON.stringify(r.avisos))
  const m = vigilarPropuesta(propuesta({ backend: 'airfryer de longhi cesta' }), ctx({ marcasAjenas: ["De'Longhi"] }))
  ok('marca de dos palabras con apóstrofo', m.propuesta.backend === 'airfryer cesta', m.propuesta.backend)
}

console.log('\n=== marcas ajenas arriba: rojo y sin tocar ===')
{
  const r = vigilarPropuesta(propuesta({ bullets: ['COMO COSORI: misma capacidad', 'FÁCIL: cesta'] }), ctx({ marcasAjenas: ['Cosori'] }))
  ok('rojo en las viñetas', avisosRojos(r.avisos).some((a) => a.campo === 'bullets'), JSON.stringify(r.avisos))
  ok('la viñeta no se toca', r.propuesta.bullets[0] === 'COMO COSORI: misma capacidad')
  const t = vigilarPropuesta(propuesta({ titulo: 'Cecotec Freidora tipo Philips 5L' }), ctx({ marcasAjenas: ['Philips'] }))
  ok('rojo en el título', avisosRojos(t.avisos).some((a) => a.campo === 'titulo'))
  const parte = vigilarPropuesta(propuesta({ bullets: ['PHILIPSHUE no es la marca', 'b'] }), ctx({ marcasAjenas: ['Philips'] }))
  ok('no casa dentro de otra palabra', avisosRojos(parte.avisos).length === 0, JSON.stringify(parte.avisos))
}

console.log('\n=== (b) búsqueda descartada en la salida ===')
{
  const r = vigilarPropuesta(propuesta({ titulo: 'Marca Freidora de aire 5L', bullets: ['COMPATIBLE: como la cecotec de siempre', 'b'] }), ctx({ fichaActual: { ...fichaActual, titulo: 'Marca Freidora de aire 5L' }, descartadas: ['cecotec'] }))
  ok('rojo por «cecotec» en las viñetas', avisosRojos(r.avisos).some((a) => /cecotec/.test(a.texto) && a.campo === 'bullets'), JSON.stringify(r.avisos))
  const plural = vigilarPropuesta(propuesta({ bullets: ['JUEGOS DE MESA para adultos', 'b'] }), ctx({ descartadas: ['juego de mesa'] }))
  ok('casa con el plural y sin palabras vacías', avisosRojos(plural.avisos).length === 1, JSON.stringify(plural.avisos))
  const yaEstaba = vigilarPropuesta(propuesta(), ctx({ descartadas: ['freidora'] }))
  ok('una descartada que ya estaba en la ficha no avisa', avisosRojos(yaEstaba.avisos).length === 0, JSON.stringify(yaEstaba.avisos))
  const dentro = vigilarPropuesta(propuesta({ highlights: 'Cesta antiadherente' }), ctx({ fichaActual: { ...fichaActual, titulo: 'Cecotec 5L', bullets: [] }, descartadas: ['freidora'], consultasRelevantes: ['freidora de aire'] }))
  ok('ni la que va dentro de una búsqueda buena', avisosRojos(dentro.avisos).length === 0, JSON.stringify(dentro.avisos))
  const suelta = vigilarPropuesta(propuesta({ bullets: ['MESA para el juego', 'b'] }), ctx({ descartadas: ['juego de mesa'] }))
  ok('las palabras sueltas y en otro orden no cuentan', avisosRojos(suelta.avisos).length === 0, JSON.stringify(suelta.avisos))
}

console.log('\n=== (c) el título no empieza por la marca ===')
{
  const r = vigilarPropuesta(propuesta({ titulo: 'Freidora de aire Cecotec 5L sin aceite' }), ctx())
  ok('rojo', avisosRojos(r.avisos).some((a) => a.campo === 'titulo' && /no empieza por la marca/.test(a.texto)), JSON.stringify(r.avisos))
  const bien = vigilarPropuesta(propuesta(), ctx())
  ok('con la marca delante, ningún rojo', avisosRojos(bien.avisos).length === 0, JSON.stringify(bien.avisos))
  const mayus = vigilarPropuesta(propuesta({ titulo: 'CECOTEC Freidora de aire 5L' }), ctx())
  ok('mayúsculas no cuentan', avisosRojos(mayus.avisos).length === 0)
}

console.log('\n=== cifras con unidad que no están en la ficha ===')
{
  ok('cantidades normalizadas', JSON.stringify(cantidadesDe('5L, 30 cm, 1.500 W y 2,5 litros')) === JSON.stringify(['5 l', '30 cm', '1500 w', '2.5 l']), JSON.stringify(cantidadesDe('5L, 30 cm, 1.500 W y 2,5 litros')))
  const r = vigilarPropuesta(propuesta({ highlights: 'Cesta de 6L y 1500 W' }), ctx({ consultasRelevantes: ['freidora 6l'] }))
  const amb = r.avisos.filter((a) => a.nivel === 'ambar')
  ok('6 l y 1500 w son ámbar', amb.some((a) => a.texto.includes('6 l')) && amb.some((a) => a.texto.includes('1500 w')), JSON.stringify(amb))
  ok('dice de qué búsqueda sale', amb.some((a) => a.texto.includes('freidora 6l')))
  ok('5 l (ya en la ficha) no avisa', !r.avisos.some((a) => a.texto.includes('«5 l»')))
  ok('una palabra nueva sin cifra no avisa', vigilarPropuesta(propuesta({ highlights: 'Cesta antiadherente digital' }), ctx()).avisos.length === 0)
}

console.log('\n=== marcas ajenas de los rivales y filtro antes de la IA ===')
{
  const m = marcasAjenasDe(['COSORI', 'Cosori', 'Cecotec Conga', 'Generic', 'Philips', null, 'Freidora'], 'Cecotec Freidora de aire 5L')
  ok('sin repetidas, sin la propia, sin Generic ni palabras del título', JSON.stringify(m) === JSON.stringify(['COSORI', 'Philips']), JSON.stringify(m))
  const f = sinMarcasAjenas(['freidora cosori', 'freidora de aire', 'philips airfryer xl'], (x) => x, m)
  ok('quita las búsquedas con marca', JSON.stringify(f.quedan) === JSON.stringify(['freidora de aire']) && f.fuera.length === 2, JSON.stringify(f))
}

console.log('\n=== ficha cambiada y caducidad ===')
{
  const antes = { titulo: 'Cecotec  Freidora', bullets: ['A', 'B'], backend: 'x y' }
  ok('espacios no cuentan', cambiosDesdeLaPropuesta(antes, { titulo: 'Cecotec Freidora', bullets: ['A ', 'B'], backend: 'x  y' }).length === 0)
  ok('viñetas y backend cambiados', JSON.stringify(cambiosDesdeLaPropuesta(antes, { titulo: 'Cecotec Freidora', bullets: ['A2', 'B'], backend: 'z' })) === '["bullets","backend"]')
  ok('motivo', motivoFichaCambiada(['bullets', 'backend']) === 'La ficha ha cambiado desde que se pidió esta propuesta (viñetas, backend): pide una nueva.', motivoFichaCambiada(['bullets', 'backend']))
  const ahora = Date.parse('2026-11-21T12:00:00Z')
  ok('pendiente de 8 días caduca', propuestaCaducada('pendiente', '2026-11-13T11:00:00Z', ahora))
  ok('pendiente de 6 días no', !propuestaCaducada('pendiente', '2026-11-15T12:00:00Z', ahora))
  ok('una aplicada no caduca', !propuestaCaducada('aplicada', '2026-10-01T12:00:00Z', ahora))
}

async function pruebasDeAplicar() {
  console.log('\n=== (d) aplicarPropuesta con la ficha cambiada (validarYAplicar simulado) ===')
  const c = { connectionId: 'c', marketplaceId: 'A1RKKUPIHCS9HS' }
  const base: PropuestaGuardada = {
    id: '00000000-0000-0000-0000-000000000001',
    asin: 'B000000001',
    sku: 'SKU-1',
    estado: 'pendiente',
    antes: { titulo: 'Cecotec Freidora', bullets: ['A', 'B', 'C', 'D', 'E'], backend: 'viejo' },
    propuesta: { titulo: 'Cecotec Freidora de aire', highlights: 'H', bullets: ['A1', 'B1', 'C1', 'D1', 'E1'], backend: 'nuevo' },
    razonamiento: { resumen: '', cambios: [], palabrasNuevas: [], vigilancia: [] },
    modelo: null,
    caducada: false,
    creadaAt: new Date().toISOString(),
    aplicadaAt: null,
    resultado: null,
    error: null,
  }
  const viva = { titulo: 'Cecotec Freidora', highlights: '', bullets: ['A2', 'B2', 'C', 'D', 'E'], descripcion: '', backend: 'nuevo de otro' }
  const montar = (p: PropuestaGuardada) => {
    const registro = { mandado: false, esperado: null as unknown, actualizaciones: [] as Array<Record<string, unknown>> }
    const deps: DepsDeAplicar = {
      leer: async () => p,
      actualizar: async (_id, cambios) => void registro.actualizaciones.push(cambios),
      ventana: async () => null,
      vigilancia: async (_c, x) => x.razonamiento.vigilancia ?? [],
      // Simula validarYAplicar de A3: compara `esperado` con la ficha viva y solo manda si coincide
      validarYAplicar: async (_c, _e, opciones = {}) => {
        registro.esperado = opciones.esperado ?? null
        const cambiados = opciones.esperado ? cambiosDesdeLaPropuesta(opciones.esperado, viva) : []
        if (cambiados.length > 0) return { ok: false, motivo: motivoFichaCambiada(cambiados), issues: [], fichaCambiada: cambiados }
        registro.mandado = true
        return { ok: true, edicion: null, submissionId: 'sub-1', avisos: null, campos: ['titulo'], antes: viva }
      },
    }
    return { deps, registro }
  }

  {
    const { deps, registro } = montar(base)
    const r = await aplicarPropuesta(c, base.id, 'u', {}, deps)
    ok('no se manda nada', !registro.mandado && !r.ok)
    ok('se pasa esperado = p.antes', JSON.stringify((registro.esperado as { bullets: string[] } | null)?.bullets) === JSON.stringify(base.antes.bullets))
    ok('motivo con viñetas y backend', !r.ok && r.motivo === 'La ficha ha cambiado desde que se pidió esta propuesta (viñetas, backend): pide una nueva.', !r.ok ? r.motivo : '')
    ok('la propuesta queda descartada', registro.actualizaciones.some((u) => u.estado === 'descartada' && typeof u.error === 'string'), JSON.stringify(registro.actualizaciones))
  }
  {
    const coincide = { ...base, antes: { titulo: viva.titulo, bullets: viva.bullets, backend: viva.backend } }
    const { deps, registro } = montar(coincide)
    const r = await aplicarPropuesta(c, base.id, 'u', {}, deps)
    ok('si la ficha es la misma, se manda y queda aplicada', r.ok && registro.mandado && registro.actualizaciones.some((u) => u.estado === 'aplicada'))
  }
  {
    const conRojo: PropuestaGuardada = { ...base, antes: { titulo: viva.titulo, bullets: viva.bullets, backend: viva.backend }, razonamiento: { ...base.razonamiento, vigilancia: [{ nivel: 'rojo', campo: 'titulo', texto: 'Marca de un rival en el título: Cosori.' }] } }
    const a = montar(conRojo)
    const r1 = await aplicarPropuesta(c, base.id, 'u', {}, a.deps)
    ok('con un aviso rojo sin confirmar, no se manda', !r1.ok && !a.registro.mandado && (r1.avisosRojos?.length ?? 0) === 1)
    const b = montar(conRojo)
    const r2 = await aplicarPropuesta(c, base.id, 'u', { aceptarAvisos: true }, b.deps)
    ok('con la segunda confirmación, sí', r2.ok && b.registro.mandado)
  }
  {
    const { deps, registro } = montar({ ...base, caducada: true })
    const r = await aplicarPropuesta(c, base.id, 'u', {}, deps)
    ok('caducada: no se manda', !r.ok && !registro.mandado && /caducado/.test(r.motivo))
  }
}

pruebasDeAplicar().then(() => {
  console.log(fallos === 0 ? '\nTodo bien.\n' : `\n${fallos} FALLOS.\n`)
  process.exit(fallos === 0 ? 0 : 1)
})
