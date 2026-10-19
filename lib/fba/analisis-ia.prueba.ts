import { MAX_BYTES_ANALISIS, limpiarAnalisis, type AnalisisIa } from '@/lib/fba/analisis-ia'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/**
 * EL ANÁLISIS DE LA IA QUE SE GUARDA CON LA PROPUESTA.
 *
 * Lo que llega del navegador no se guarda tal cual: se reconstruye campo a campo. Aquí se
 * comprueba que un análisis bueno pasa intacto y que uno hostil, enorme o roto se queda en lo
 * que es seguro guardar.
 */

const BUENO: AnalisisIa = {
  version: 1,
  generadaEn: '2026-10-19T09:30:00.000Z',
  ventasHasta: '2026-10-14',
  modelo: 'gpt-5.5-2026-xx',
  usada: true,
  aviso: null,
  resumen: 'Mandar lo urgente y esperar con lo demás.',
  estrategia: 'Cubrir 60 días con 10 de plazo.',
  riesgos: ['Black Friday en 39 días'],
  dudas: ['Cuántas unidades tiene en su almacén'],
  notas: ['Hay 3 referencias más que no han cabido'],
  parametros: { coberturaObjetivo: 60, plazoDias: 10, margenDias: 7, multiplo: 6, minimoLinea: 2, topeUnidades: 300, notas: 'Black Friday en seis semanas' },
  lineas: {
    'FBA047768-40': { motivo: 'Vende 0,8 ud/día y se agota antes de llegar.', prioridad: 'alta', confianza: 'media', origen: 'ia', base: 48, propuestas: 54 },
    'FBA047768-41': { motivo: 'Cálculo base.', prioridad: 'baja', confianza: null, origen: 'calculo', base: 12, propuestas: 12 },
  },
  descartadas: [{ sku: 'FBA047999-38', nombre: 'Bota negra', motivo: 'Se devuelve el 31 %.', base: 24 }],
}

console.log('\n=== lo que no se parece a un análisis ===')
{
  ok('nada, texto, número o lista: null', limpiarAnalisis(null) === null && limpiarAnalisis(undefined) === null && limpiarAnalisis('hola') === null && limpiarAnalisis(5) === null && limpiarAnalisis([BUENO]) === null)
  const minimo = limpiarAnalisis({})!
  ok('un objeto vacío se queda en un análisis vacío pero con forma', !!minimo && minimo.version === 1 && minimo.ventasHasta === null && minimo.usada === false && minimo.riesgos.length === 0 && Object.keys(minimo.lineas).length === 0 && minimo.descartadas.length === 0)
  ok('con los parámetros mínimos razonables', minimo.parametros.multiplo === 1 && minimo.parametros.minimoLinea === 1 && minimo.parametros.topeUnidades === null && minimo.parametros.notas === '')
  ok('y una fecha de generación válida (la de ahora)', !Number.isNaN(Date.parse(minimo.generadaEn)))
}

console.log('\n=== un análisis bueno pasa entero ===')
{
  const l = limpiarAnalisis(JSON.parse(JSON.stringify(BUENO)))!
  ok('ida y vuelta idéntica', JSON.stringify(l) === JSON.stringify(BUENO), JSON.stringify(l).slice(0, 200))
  ok('la fecha se conserva', l.generadaEn === '2026-10-19T09:30:00.000Z')
  ok('y hasta cuándo llegaban las ventas con las que se hizo: es lo que explica una propuesta que no cuenta lo de los últimos días', l.ventasHasta === '2026-10-14')
  ok('el modelo, el resumen y el criterio también', l.modelo === 'gpt-5.5-2026-xx' && l.resumen === BUENO.resumen && l.estrategia === BUENO.estrategia)
  ok('las líneas por SKU, con su origen', l.lineas['FBA047768-40'].origen === 'ia' && l.lineas['FBA047768-41'].origen === 'calculo' && l.lineas['FBA047768-41'].confianza === null)
}

console.log('\n=== lo hostil y lo roto ===')
{
  const sucio = limpiarAnalisis({
    version: 99,
    generadaEn: 'ayer por la tarde',
    ventasHasta: '14 de octubre',
    modelo: `gpt\u0007-5 ${'m'.repeat(200)}`,
    usada: 'sí',
    aviso: 'a'.repeat(1000),
    resumen: `  con\u0000 control\n\ny   espacios `,
    estrategia: 'e'.repeat(4000),
    riesgos: Array.from({ length: 40 }, (_, i) => `r${i}`),
    dudas: ['', 7, null, 'una duda', 'd'.repeat(900)],
    notas: 'esto no es una lista',
    parametros: { coberturaObjetivo: -5, plazoDias: 'x', margenDias: 12.6, multiplo: 0, minimoLinea: -3, topeUnidades: 0, notas: 'n'.repeat(5000) },
    lineas: {
      ' A ': { motivo: 'm'.repeat(1000), prioridad: 'urgentísima', confianza: 'enorme', origen: 'humano', base: -4, propuestas: 11.6 },
      B: { motivo: 5, prioridad: 'baja', confianza: 'alta', origen: 'ia', base: Number.NaN, propuestas: 'tres' },
      C: 'no soy un objeto',
      D: null,
      '': { motivo: 'sin sku' },
    },
    descartadas: [{ sku: 'X', nombre: 'n'.repeat(500), motivo: 'm'.repeat(900), base: -1 }, { sku: '', motivo: 'sin sku' }, 'x', null, { sku: 7 }],
  })!
  ok('la versión es siempre la 1 y «usada» solo vale si es true de verdad', sucio.version === 1 && sucio.usada === false)
  ok('una fecha ilegible se sustituye por la de ahora', !Number.isNaN(Date.parse(sucio.generadaEn)) && sucio.generadaEn !== 'ayer por la tarde')
  ok('y un «hasta cuándo llegaban las ventas» que no es un día, queda en null', sucio.ventasHasta === null)
  ok('el modelo pierde los caracteres de control y se corta a 60', sucio.modelo !== null && sucio.modelo.length <= 60 && !/[\u0000-\u0008]/.test(sucio.modelo))
  ok('el aviso se corta a 400', sucio.aviso?.length === 400)
  ok('el resumen se limpia y colapsa', sucio.resumen === 'con control y espacios', JSON.stringify(sucio.resumen))
  ok('el criterio se corta a 1.500', sucio.estrategia?.length === 1500)
  ok('12 riesgos como mucho', sucio.riesgos.length === 12)
  ok('las dudas vacías o que no son texto se quitan; las largas se cortan a 400', sucio.dudas.length === 2 && sucio.dudas[1].length === 400, JSON.stringify(sucio.dudas.map((d) => d.length)))
  ok('«notas» que no es una lista queda vacía', sucio.notas.length === 0)
  const p = sucio.parametros
  ok('los parámetros nunca salen negativos ni ilegibles', p.coberturaObjetivo === 0 && p.plazoDias === 0 && p.margenDias === 13 && p.multiplo === 1 && p.minimoLinea === 1, JSON.stringify(p))
  ok('un tope de 0 pasa a 1 y no a «sin tope»: lo guardado es lo que se usó, no una opinión', p.topeUnidades === 1, String(p.topeUnidades))
  ok('las notas se cortan a 1.500', p.notas.length === 1500)
  ok('de las líneas sobreviven las que son objeto y tienen SKU (A y B)', Object.keys(sucio.lineas).sort().join() === 'A,B', Object.keys(sucio.lineas).join())
  const a = sucio.lineas.A
  ok('prioridad inventada = media, confianza inventada = null, origen inventado = cálculo', a.prioridad === 'media' && a.confianza === null && a.origen === 'calculo')
  ok('el motivo se corta a 300 y los números se redondean y no bajan de 0', a.motivo.length === 300 && a.base === 0 && a.propuestas === 12, JSON.stringify(a).slice(0, 120))
  const b = sucio.lineas.B
  ok('un motivo que no es texto queda vacío y un número roto, a 0', b.motivo === '' && b.base === 0 && b.propuestas === 0 && b.origen === 'ia' && b.confianza === 'alta')
  ok('de las descartadas, solo las que tienen SKU de texto', sucio.descartadas.length === 1 && sucio.descartadas[0].sku === 'X')
  ok('con su nombre y motivo acotados', sucio.descartadas[0].nombre!.length === 120 && sucio.descartadas[0].motivo.length === 300 && sucio.descartadas[0].base === 0)
}

console.log('\n=== lo que intenta colarse por la clave ===')
{
  // JSON.parse crea «__proto__» como clave propia; asignarla a un objeto normal cambiaría su prototipo
  const hostil = limpiarAnalisis(JSON.parse('{"lineas":{"__proto__":{"motivo":"x","prioridad":"alta","base":5,"propuestas":5},"BUENA":{"motivo":"y"}},"descartadas":[{"sku":"__proto__","motivo":"z"}]}'))!
  ok('una clave «__proto__» no entra en las líneas', !Object.prototype.hasOwnProperty.call(hostil.lineas, '__proto__') && Object.getPrototypeOf(hostil.lineas) === Object.prototype, Object.keys(hostil.lineas).join())
  ok('y las demás sí', Object.keys(hostil.lineas).join() === 'BUENA')
  ok('Object.prototype sigue limpio', ({} as Record<string, unknown>).motivo === undefined && ({} as Record<string, unknown>).prioridad === undefined)
  ok('lo guardado se puede volver a serializar sin sorpresas', JSON.stringify(hostil).includes('"BUENA"') && !JSON.stringify(hostil).includes('"x"'))
}

console.log('\n=== el tamaño ===')
{
  const lineas = (n: number, largo: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`SKU-${i}`, { motivo: 'm'.repeat(largo), prioridad: 'media', confianza: 'media', origen: 'ia', base: 1, propuestas: 1 }]))
  const descartadas = (n: number, largo: number) => Array.from({ length: n }, (_, i) => ({ sku: `D-${i}`, nombre: 'n', motivo: 'm'.repeat(largo), base: 1 }))

  const normal = limpiarAnalisis({ lineas: lineas(120, 250), descartadas: descartadas(120, 250) })!
  ok('una propuesta grande de verdad cabe entera', !!normal && Object.keys(normal.lineas).length === 120 && normal.descartadas.length === 120 && JSON.stringify(normal).length < MAX_BYTES_ANALISIS, String(JSON.stringify(normal).length))

  const justo = limpiarAnalisis({ lineas: lineas(200, 300), descartadas: descartadas(3000, 300) })!
  ok('si no cabe con lo descartado, se tira lo descartado y se conserva lo importante', !!justo && justo.descartadas.length === 0 && Object.keys(justo.lineas).length === 200 && JSON.stringify(justo).length <= MAX_BYTES_ANALISIS, justo ? String(JSON.stringify(justo).length) : 'null')

  const enorme = limpiarAnalisis({ lineas: lineas(3000, 300) })
  ok('si ni así cabe, no se guarda nada', enorme === null)

  // Miles de líneas, por cortas que sean, no son un análisis: son ruido
  const muchas = limpiarAnalisis({ lineas: lineas(3500, 5) })
  ok('miles de líneas, aunque sean cortas, no caben', muchas === null)
  ok('el tope en bytes es el de siempre: 200.000', MAX_BYTES_ANALISIS === 200_000)
}

console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
