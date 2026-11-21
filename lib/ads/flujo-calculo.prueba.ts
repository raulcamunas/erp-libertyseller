/**
 * Pruebas del flujo de términos entre campañas y del diario por días. npx tsx lib/ads/flujo-calculo.prueba.ts
 */
import {
  clasificarEntrada,
  construirDiario,
  construirFlujo,
  diaEspana,
  etiquetaDeDia,
  fraseDeAccion,
  horaEspana,
  inicioDelDiaEspana,
  numeroDeTexto,
  productosDelPeriodo,
  quienDeFila,
  resumenDelDia,
  SUMIDERO,
  terminoDeFila,
  type FilaDeLogFlujo,
  type PropuestaFlujo,
} from './flujo-calculo'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

const A = 'B0FN4MT7VP'
const C = (rol: string) => `${A} | MONTE 001 | JAMON ENTERO | ${rol}`
const ID = { auto: '1001', amplia: '1002', exacta: '1003', estab: '1004', ataque: '1005' }

let n = 0
const fila = (x: Partial<FilaDeLogFlujo>): FilaDeLogFlujo => ({
  id: `f${++n}`,
  creadoAt: '2026-11-20T16:37:00Z',
  campaignId: ID.auto,
  nombreCampana: C('AUTO RADAR'),
  entidad: 'negativa',
  accion: 'negativizar',
  campo: 'palabra clave negativa exacta',
  valorAnterior: null,
  valorNuevo: 'spam carne',
  motivo: null,
  origen: 'agente',
  ok: true,
  error: null,
  persona: null,
  propuestaId: null,
  entidadId: null,
  ...x,
})

const propuesta = (x: Partial<PropuestaFlujo>): PropuestaFlujo => ({
  id: `p${++n}`,
  tipo: 'negativizar',
  estado: 'pendiente',
  origen: 'motor',
  asin: A,
  termino: 'algo',
  campaignId: ID.auto,
  campaignNombre: C('AUTO RADAR'),
  desdeRol: 'AUTO RADAR',
  haciaRol: null,
  haciaCampaignId: null,
  haciaCampaignNombre: null,
  negativizarEnOrigen: false,
  motivo: 'motivo',
  metricas: { clics: 5, pedidos: 0, gasto: 1.22, ventas: 0, acosPct: null },
  creadaAt: '2026-11-19T10:00:00Z',
  resueltaAt: null,
  retenidaMotivo: null,
  retenidaAt: null,
  error: null,
  resueltaPor: null,
  ...x,
})

console.log('\n=== números y fechas ===')
{
  ok('«0,35» → 0,35', numeroDeTexto('0,35') === 0.35)
  ok('«1.234,50» → 1234,5', numeroDeTexto('1.234,50') === 1234.5)
  ok('«12.5» → 12,5', numeroDeTexto('12.5') === 12.5)
  ok('basura → null', numeroDeTexto('activa') === null && numeroDeTexto(null) === null)
  ok('día en España: las 23:30 UTC de invierno ya son el día siguiente', diaEspana('2026-11-20T23:30:00Z') === '2026-11-21')
  ok('hora en España (invierno, UTC+1)', horaEspana('2026-11-20T12:08:00Z') === '13:08')
  ok('el día de España empieza a las 23:00 UTC en invierno', inicioDelDiaEspana('2026-11-20') === '2026-11-19T23:00:00.000Z', inicioDelDiaEspana('2026-11-20'))
  ok('…y a las 22:00 UTC en verano', inicioDelDiaEspana('2026-07-10') === '2026-07-09T22:00:00.000Z', inicioDelDiaEspana('2026-07-10'))
  ok('Hoy / Ayer / «mié 18 nov»', etiquetaDeDia('2026-11-20', '2026-11-20') === 'Hoy' && etiquetaDeDia('2026-11-19', '2026-11-20') === 'Ayer' && etiquetaDeDia('2026-11-18', '2026-11-20') === 'mié 18 nov', etiquetaDeDia('2026-11-18', '2026-11-20'))
}

console.log('\n=== clasificar y describir ===')
{
  const puja = fila({ entidad: 'keyword', accion: 'cambiar', campo: 'puja de «reseñas google»', valorAnterior: '0,83', valorNuevo: '0,63', campaignId: ID.amplia, nombreCampana: C('MANUAL AMPLIA') })
  ok('puja 0,83 → 0,63 es una bajada', clasificarEntrada(puja) === 'puja_baja')
  ok('frase de la puja', fraseDeAccion(puja) === 'Se ha bajado la puja de «reseñas google» en MANUAL AMPLIA', fraseDeAccion(puja))
  const pres = fila({ entidad: 'campaña', accion: 'cambiar', campo: 'presupuesto diario', valorAnterior: '4,60', valorNuevo: '10,00' })
  ok('presupuesto 4,60 → 10,00 sube', clasificarEntrada(pres) === 'presupuesto_sube')
  ok('una puja igual no es ni subida ni bajada', clasificarEntrada({ ...puja, valorNuevo: '0,83' }) === 'otro')
  ok('pausa, deshacer, cosecha, descartar, crear', clasificarEntrada({ ...puja, accion: 'pausar' }) === 'pausa' && clasificarEntrada({ ...puja, accion: 'deshacer' }) === 'deshacer' && clasificarEntrada({ ...puja, accion: 'promover' }) === 'cosecha' && clasificarEntrada({ ...puja, accion: 'descartar' }) === 'descartada' && clasificarEntrada({ ...puja, accion: 'crear' }) === 'crear')

  const neg = fila({ origen: 'manual', persona: 'Ana', valorNuevo: 'crocs deportivos', motivo: '«crocs deportivos» lleva 5 clics (1,22) sin pedido' })
  ok('negativa con su cifra', fraseDeAccion(neg) === 'Se ha negativizado "crocs deportivos" en AUTO RADAR (exacta): 5 clics (1,22) sin pedido', fraseDeAccion(neg))
  const negMal = fila({ ok: false, campo: 'crocs 39/40', valorNuevo: null })
  ok('negativa fallida: el término va en «campo»', terminoDeFila(negMal) === 'crocs 39/40' && fraseDeAccion(negMal) === 'No se ha podido negativizar "crocs 39/40" en AUTO RADAR')
  const prod = fila({ campo: 'segmentación negativa por productos', valorNuevo: 'B0CLFJ9N7V' })
  ok('negativa por producto', fraseDeAccion(prod).includes('(producto)'))
  const pausa = fila({ entidad: 'target', accion: 'pausar', campo: 'estado de «ASIN B0CLFJ9N7V y parecidos»', valorAnterior: 'activa', valorNuevo: 'pausada', nombreCampana: C('ATAQUE ASIN'), campaignId: ID.ataque })
  ok('pausa', fraseDeAccion(pausa) === 'Se ha pausado «ASIN B0CLFJ9N7V y parecidos» en ATAQUE ASIN', fraseDeAccion(pausa))
  const cos = fila({ entidad: 'keyword', accion: 'promover', campo: 'keyword exacta', valorAnterior: 'AUTO RADAR', valorNuevo: 'jamon 7kg → MANUAL EXACTA / ESTABILIDAD', campaignId: ID.estab, nombreCampana: C('MANUAL EXACTA / ESTABILIDAD') })
  ok('cosecha', fraseDeAccion(cos) === 'Se ha pasado "jamon 7kg" de AUTO RADAR a EXACTA ESTABILIDAD', fraseDeAccion(cos))
}

console.log('\n=== quién ===')
{
  ok('agente', quienDeFila({ origen: 'agente', motivo: null, persona: null, propuestaId: 'x' }, 'motor').texto === 'Agente PPC')
  ok('respaldo «[AGENTE]»', quienDeFila({ origen: 'automatico', motivo: '[AGENTE] baja', persona: null, propuestaId: null }, null).texto === 'Agente PPC')
  ok('motor aprobado por una persona', quienDeFila({ origen: 'manual', motivo: null, persona: 'Ana', propuestaId: 'x' }, 'motor').texto === 'Motor · aprobada por Ana')
  ok('a mano', quienDeFila({ origen: 'manual', motivo: null, persona: 'Ana', propuestaId: null }, null).texto === 'Ana (a mano)')
  ok('ensayo', quienDeFila({ origen: 'ensayo', motivo: null, persona: null, propuestaId: null }, null).tipo === 'ensayo')
}

console.log('\n=== flujo: cosecha con dos filas ===')
{
  const P = 'prop-cosecha'
  const filas = [
    fila({ id: 'k', entidad: 'keyword', accion: 'promover', campo: 'keyword exacta', valorAnterior: 'AUTO RADAR', valorNuevo: 'jamon 7kg → MANUAL EXACTA / ESTABILIDAD', campaignId: ID.estab, nombreCampana: C('MANUAL EXACTA / ESTABILIDAD'), propuestaId: P, entidadId: 'kw1', creadoAt: '2026-11-18T10:00:00Z' }),
    fila({ id: 'n', valorNuevo: 'jamon 7kg', propuestaId: P, motivo: 'Para que no compita con la campaña MANUAL EXACTA / ESTABILIDAD: …', creadoAt: '2026-11-18T10:00:01Z' }),
    fila({ id: 'n2', valorNuevo: 'spam carne', propuestaId: 'prop-neg' }),
    fila({ id: 'n3', ok: false, campo: 'crocs 39/40', valorNuevo: null, propuestaId: 'prop-mal' }),
    fila({ id: 'pj', entidad: 'keyword', accion: 'cambiar', campo: 'puja de «x»', valorAnterior: '0,50', valorNuevo: '0,60', campaignId: ID.amplia, nombreCampana: C('MANUAL AMPLIA') }),
    fila({ id: 'b1', entidad: 'campaña', accion: 'cambiar', campo: 'presupuesto diario', valorAnterior: '10,00', valorNuevo: '8,00', campaignId: ID.amplia, nombreCampana: C('MANUAL AMPLIA'), creadoAt: '2026-11-17T10:00:00Z' }),
    fila({ id: 'b2', entidad: 'campaña', accion: 'cambiar', campo: 'presupuesto diario', valorAnterior: '8,00', valorNuevo: '4,60', campaignId: ID.amplia, nombreCampana: C('MANUAL AMPLIA'), creadoAt: '2026-11-19T10:00:00Z' }),
    fila({ id: 'otro', nombreCampana: 'B0OTROASIN | X | Y | AUTO RADAR', campaignId: '9999', valorNuevo: 'de otro producto' }),
  ]
  const propuestas = [
    propuesta({ id: P, tipo: 'promover', estado: 'aplicada', termino: 'jamon 7kg', haciaRol: 'MANUAL EXACTA / ESTABILIDAD', haciaCampaignId: ID.estab, negativizarEnOrigen: true, metricas: { clics: 20, pedidos: 3, gasto: 9, ventas: 60, acosPct: 15 } }),
    propuesta({ id: 'prop-caducada', tipo: 'promover', estado: 'caducada', termino: 'zapatillas', haciaRol: 'MANUAL AMPLIA', haciaCampaignId: ID.amplia, error: 'Caducada por el agente: No subo: el producto está en «recortar»' }),
    propuesta({ id: 'prop-sin-destino', tipo: 'promover', estado: 'pendiente', termino: 'b0aaaaaaaa', haciaRol: 'ATAQUE ASIN' }),
    propuesta({ id: 'prop-pend', estado: 'pendiente', termino: 'feo' }),
  ]
  const diasDeObjetivo = [
    { fecha: '2026-11-17', objetivoId: 'kw1', clics: 99, pedidos: 9, gasto: 9, ventas: 9 },
    { fecha: '2026-11-18', objetivoId: 'kw1', clics: 7, pedidos: 1, gasto: 2.5, ventas: 20 },
    { fecha: '2026-11-19', objetivoId: 'kw1', clics: 5, pedidos: 1, gasto: 1.5, ventas: 20 },
  ]
  const campanas = [{ campaignId: ID.auto, nombre: C('AUTO RADAR'), rol: null }, { campaignId: ID.ataque, nombre: C('ATAQUE ASIN'), rol: null }]
  const f = construirFlujo({ asin: A, filas, propuestas, campanas, diasDeObjetivo, efectos: [{ propuestaId: P, veredicto: 'mejoro' }], conPropuestas: true })
  const cosecha = f.flechas.find((x) => x.id === `cosecha:${ID.auto}>${ID.estab}`)
  ok('las dos filas de la cosecha son UNA flecha AUTO → ESTABILIDAD', cosecha?.hechos === 1, JSON.stringify(f.flechas))
  const t = f.terminos.find((x) => x.id === P)
  ok('…con la negativa en origen marcada dentro', t?.negativizadoEnOrigen === true && t.concordancia === 'exacta')
  ok('…y su «después» desde el día de la cosecha (no cuenta el 17)', t?.despues?.clics === 12 && t.despues.pedidos === 2 && t.despues.desde === '2026-11-18', JSON.stringify(t?.despues))
  ok('…con el veredicto de ads_efectos y las cifras de antes', t?.veredicto === 'mejoro' && t.antes?.pedidos === 3)
  const sumidero = f.flechas.find((x) => x.id === `negativa:${ID.auto}>${SUMIDERO}`)
  ok('la negativa de la cosecha NO cuenta además como flecha al sumidero', sumidero?.hechos === 1 && sumidero.fallidos === 1, JSON.stringify(sumidero))
  ok('…y la pendiente cuenta como propuesta', sumidero?.propuestos === 1)
  const auto = f.nodos.find((x) => x.id === ID.auto)
  ok('el nodo AUTO lleva 2 negativas hechas (la de la cosecha y la suelta) y 1 salida', auto?.negativas === 2 && auto.salen === 1, JSON.stringify(auto))
  ok('el nodo ESTABILIDAD lleva 1 entrada', f.nodos.find((x) => x.id === ID.estab)?.entran === 1)
  const amplia = f.nodos.find((x) => x.id === ID.amplia)
  ok('MANUAL AMPLIA: 1 puja sube y presupuesto 10 → 4,60 (del primero al último)', amplia?.pujas.suben === 1 && amplia.presupuesto?.de === 10 && amplia.presupuesto.a === 4.6, JSON.stringify(amplia))
  ok('ATAQUE ASIN sale aunque no tenga cambios (de las campañas conocidas)', f.nodos.some((x) => x.id === ID.ataque))
  ok('lo de otro producto no entra', !f.nodos.some((x) => x.id === '9999') && !f.terminos.some((x) => x.termino === 'de otro producto'))
  const cad = f.terminos.find((x) => x.id === 'prop-caducada')
  ok('la cosecha caducada sale como propuesta, con el motivo sin «Caducada por el agente:»', cad?.estado === 'caducada' && cad.motivo === 'No subo: el producto está en «recortar»' && f.flechas.find((x) => x.id === cad.flechaId)?.sinAplicar === 1, JSON.stringify(cad))
  ok('una cosecha a ATAQUE ASIN sin campaña destino conocida usa la que existe', f.terminos.find((x) => x.id === 'prop-sin-destino')?.flechaId === `cosecha:${ID.auto}>${ID.ataque}`)
  ok('el sumidero existe y cuenta lo hecho', f.nodos.find((x) => x.id === SUMIDERO)?.entran === 1)

  const sin = construirFlujo({ asin: A, filas, propuestas, campanas, diasDeObjetivo, efectos: [], conPropuestas: false })
  ok('sin «ver lo propuesto» no hay flechas solo propuestas', !sin.flechas.some((x) => x.hechos + x.deshechos + x.fallidos === 0), JSON.stringify(sin.flechas))

  // Deshacer
  const des = construirFlujo({ asin: A, filas: [...filas, fila({ id: 'd', accion: 'deshacer', entidad: 'negativa', campo: 'spam carne', valorAnterior: 'spam carne', valorNuevo: 'quitado', propuestaId: 'prop-neg' })], propuestas, campanas, diasDeObjetivo, efectos: [], conPropuestas: false })
  const sum2 = des.flechas.find((x) => x.id === `negativa:${ID.auto}>${SUMIDERO}`)
  ok('una negativa deshecha cuenta como deshecha, no como hecha', sum2?.hechos === 0 && sum2.deshechos === 1, JSON.stringify(sum2))

  // Un destino que no existe todavía
  const hip = construirFlujo({ asin: A, filas: [], propuestas: [propuesta({ tipo: 'promover', estado: 'pendiente', haciaRol: 'MANUAL EXACTA / DOMINIO' })], campanas: [{ campaignId: ID.auto, nombre: C('AUTO RADAR'), rol: null }], diasDeObjetivo: [], efectos: [], conPropuestas: true })
  ok('si la exacta no existe, se dibuja como «todavía no existe»', hip.nodos.some((x) => x.hipotetica && x.rol === 'MANUAL EXACTA / DOMINIO'))
}

console.log('\n=== diario ===')
{
  const P = 'prop-cosecha'
  const filas = [
    fila({ entidad: 'keyword', accion: 'promover', campo: 'keyword exacta', valorAnterior: 'AUTO RADAR', valorNuevo: 'jamon → MANUAL EXACTA / DOMINIO', campaignId: ID.exacta, nombreCampana: C('MANUAL EXACTA / DOMINIO'), propuestaId: P, creadoAt: '2026-11-20T10:00:00Z' }),
    fila({ valorNuevo: 'jamon', propuestaId: P, creadoAt: '2026-11-20T10:00:01Z' }),
    fila({ entidad: 'keyword', accion: 'cambiar', campo: 'puja de «x»', valorAnterior: '0,83', valorNuevo: '0,63', creadoAt: '2026-11-20T13:19:00Z' }),
    fila({ entidad: 'keyword', accion: 'cambiar', campo: 'puja de «y»', valorAnterior: '0,50', valorNuevo: '0,60', origen: 'ensayo', creadoAt: '2026-11-20T13:20:00Z' }),
    fila({ ok: false, campo: 'crocs', valorNuevo: null, error: 'Amazon dijo que no', creadoAt: '2026-11-19T09:00:00Z' }),
    fila({ entidad: 'campaña', accion: 'crear', campo: 'estado · presupuesto diario', origen: 'estructura', persona: 'Raúl', creadoAt: '2026-11-18T09:00:00Z' }),
    fila({ entidad: 'campaña', accion: 'crear', origen: 'estructura', campaignId: ID.amplia, nombreCampana: C('MANUAL AMPLIA'), persona: 'Raúl', creadoAt: '2026-11-18T09:00:05Z' }),
    fila({ entidad: 'grupo', accion: 'crear', origen: 'estructura', persona: 'Raúl', creadoAt: '2026-11-18T09:00:06Z' }),
    fila({ creadoAt: '2026-11-01T10:00:00Z', valorNuevo: 'viejo' }),
  ]
  const propuestas = [
    propuesta({ id: 'cad', tipo: 'promover', estado: 'caducada', termino: 'zapatillas', resueltaAt: '2026-11-20T08:00:00Z', error: 'Caducada por el agente: No subo: el producto está en «recortar»' }),
    propuesta({ id: 'ret', estado: 'pendiente', termino: 'retenida', retenidaMotivo: 'lleva pocos clics', retenidaAt: '2026-11-19T08:00:00Z' }),
    propuesta({ id: 'otra', estado: 'caducada', asin: 'B0OTROASIN', campaignNombre: 'B0OTROASIN | X | Y | AUTO RADAR', resueltaAt: '2026-11-20T08:00:00Z' }),
  ]
  const eventos = [
    { id: 'e1', creadoAt: '2026-11-20T07:00:00Z', tipo: 'freno', titulo: 'Freno: gasto disparado', detalle: null, datosTexto: '' },
    { id: 'e2', creadoAt: '2026-11-20T07:00:00Z', tipo: 'postura', titulo: 'Postura de OTRO: recortar → mantener', detalle: null, datosTexto: '{"asin":"B0OTROASIN"}' },
    { id: 'e3', creadoAt: '2026-11-20T07:00:00Z', tipo: 'postura', titulo: 'Postura de JAMON', detalle: null, datosTexto: `{"asin":"${A}"}` },
  ]
  const d = construirDiario({ filas, propuestas, eventos, asin: A, desde: '2026-11-14', hoy: '2026-11-20' })
  ok('tres días, el más reciente arriba; lo de antes del periodo no sale', d.map((x) => x.dia).join(',') === '2026-11-20,2026-11-19,2026-11-18', d.map((x) => x.dia).join(','))
  const hoy = d[0]
  ok('«Hoy» y la cosecha en una sola línea con su negativa en origen', hoy.etiqueta === 'Hoy' && hoy.acciones.filter((a) => a.clase === 'cosecha').length === 1 && hoy.acciones.every((a) => a.clase !== 'negativa') && hoy.acciones.find((a) => a.clase === 'cosecha')!.frase.endsWith('y se ha negativizado en AUTO RADAR'), JSON.stringify(hoy.acciones.map((a) => a.frase)))
  ok('resumen de hoy: 1 cosecha, 1 bajada de puja, 1 ensayo', hoy.resumen.cosechas === 1 && hoy.resumen.pujasBajan === 1 && hoy.resumen.ensayos === 1 && hoy.resumen.pujasSuben === 0, JSON.stringify(hoy.resumen))
  ok('la puja lleva el de→a', hoy.acciones.find((a) => a.clase === 'puja_baja')?.de === '0,83')
  ok('lo no hecho de hoy: la caducada de este producto (no la del otro)', hoy.noHechas.length === 1 && hoy.noHechas[0].motivo === 'No subo: el producto está en «recortar»', JSON.stringify(hoy.noHechas))
  ok('notas: la de la cuenta y la del producto, no la de otro producto', hoy.notas.map((x) => x.id).sort().join(',') === 'e1,e3', hoy.notas.map((x) => x.id).join(','))
  ok('ayer: el fallo cuenta como fallido y la retenida sale como no hecha', d[1].resumen.fallidos === 1 && d[1].noHechas[0]?.motivo === 'Retenida: lleva pocos clics' && d[1].etiqueta === 'Ayer')
  const crear = d[2].acciones
  ok('«Crear campañas» se resume en una línea por producto', crear.length === 1 && crear[0].frase === `Se han creado 2 campañas de ${A} (JAMON ENTERO)`, JSON.stringify(crear.map((a) => a.frase)))

  const cuenta = construirDiario({ filas, propuestas, eventos, asin: null, desde: '2026-11-14', hoy: '2026-11-20' })
  ok('sin producto: todas las notas y todo lo no hecho', cuenta[0].notas.length === 3 && cuenta[0].noHechas.length === 2)

  ok('el resumen no cuenta lo deshecho como hecho', resumenDelDia([{ ...hoy.acciones[0], clase: 'negativa', ok: true, ensayo: false, deshecho: true }]).negativas === 0)
}

console.log('\n=== productos del periodo ===')
{
  const filas = [fila({}), fila({}), fila({ nombreCampana: 'B0OTROASIN | X | OTRO | MANUAL AMPLIA', campaignId: '9' })]
  const p = productosDelPeriodo(filas, [propuesta({ asin: 'B0TERCEROO', campaignNombre: null })], [])
  ok('ordenados por cambios, con su resumen y sus papeles', p[0].asin === A && p[0].cambios === 2 && p[0].resumen === 'JAMON ENTERO' && p[0].roles[0] === 'AUTO RADAR', JSON.stringify(p))
  ok('un producto solo con propuestas también sale', p.some((x) => x.asin === 'B0TERCEROO' && x.cambios === 0))
}

console.log(fallos === 0 ? '\nTODO OK' : `\n${fallos} FALLO(S)`)
if (fallos > 0) process.exit(1)
