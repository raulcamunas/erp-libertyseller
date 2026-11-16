import {
  avisoDeRecortarPorStock,
  avisoDeNoReactivar,
  idDeAvisoDePausaPorStock,
  claveDeAviso,
  idDeAvisoDeStock,
  dinero,
  nombreDeClase,
  textoDeAgotada,
  textoDeEnsayoFin,
  textoDeFreno,
  textoDeIa,
  textoDelResumen,
  textoDePrimeraEscritura,
  textoDeStock,
  textoDeStockFallo,
  textoDeTechoAuto,
} from './avisos-calculo'
import type { DatosDelResumen } from './tipos'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}
const tiene = (texto: string, trozo: string) => texto.includes(trozo)

console.log('\n=== claves estables ===')
ok('clave sin id', claveDeAviso('p1', 'resumen', '2026-11-19') === 'ads-agente:p1:resumen:2026-11-19')
ok('clave con id', claveDeAviso('p1', 'stock', '2026-11-19', 'B0X') === 'ads-agente:p1:stock:2026-11-19:B0X')
ok('misma entrada → misma clave', claveDeAviso('p1', 'freno', '2026-11-19') === claveDeAviso('p1', 'freno', '2026-11-19'))
ok('hechos distintos → claves distintas', claveDeAviso('p1', 'errores', '2026-11-19') !== claveDeAviso('p1', 'freno', '2026-11-19'))

console.log('\n=== dinero ===')
ok('EUR con miles', dinero(9840, 'EUR') === '9.840 €', dinero(9840, 'EUR'))
ok('EUR con céntimos', dinero(41.5, 'EUR') === '41,50 €', dinero(41.5, 'EUR'))
ok('EUR entero pequeño', dinero(34, 'EUR') === '34 €', dinero(34, 'EUR'))
ok('EUR grande redondea', dinero(1230.4, 'EUR') === '1.230 €', dinero(1230.4, 'EUR'))
ok('millón', dinero(1234567, 'EUR') === '1.234.567 €', dinero(1234567, 'EUR'))
ok('USD delante', dinero(1230, 'USD') === '$1.230', dinero(1230, 'USD'))
ok('MXN', dinero(25000, 'MXN') === 'MX$25.000', dinero(25000, 'MXN'))
ok('sin moneda → euros', dinero(12.3, null) === '12,30 €', dinero(12.3, null))
ok('otra moneda → código detrás', dinero(500, 'SEK') === '500 SEK', dinero(500, 'SEK'))
ok('NaN no rompe', dinero(Number.NaN, 'EUR') === '0 €', dinero(Number.NaN, 'EUR'))

console.log('\n=== plurales ===')
ok('negativa / negativas', nombreDeClase('negativizar', 1) === 'negativa' && nombreDeClase('negativizar', 7) === 'negativas')
ok('bajada(s) de puja', nombreDeClase('puja_bajar', 1) === 'bajada de puja' && nombreDeClase('puja_bajar', 3) === 'bajadas de puja')
ok('pausa / pausas', nombreDeClase('pausar', 1) === 'pausa' && nombreDeClase('pausar', 0) === 'pausas')
ok('campaña(s) pausada(s)', nombreDeClase('pausar_campana', 1) === 'campaña pausada' && nombreDeClase('pausar_campana', 2) === 'campañas pausadas')
ok('subida de presupuesto', nombreDeClase('presupuesto_subir', 1) === 'subida de presupuesto')

console.log('\n=== resumen (activo, con IA) ===')
const base: DatosDelResumen = {
  nombreCuenta: 'Ham Master · España',
  moneda: 'EUR',
  fecha: '2026-11-19',
  enEnsayo: false,
  rampa: null,
  frenado: null,
  evento: null,
  veda: null,
  negocio: { ventasTotalesMes: 9840, ventasTotalesMesAnterior: 8910, tacosMesPct: 7.9, tacosMesAnteriorPct: 8.6, tacosObjetivoPct: 10 },
  ayer: { gasto: 41, ventas: 180 },
  cerrado7: { acosPct: 22.8, acosObjetivoMedioPct: 25, hasta: '2026-11-16' },
  mes: { gastoMes: 540, techo: 1200, proyeccion: 1150, media7: 40, diasRestantes: 12, ritmo: 'normal', cambiado: false, motivo: '' },
  hechos: { negativizar: 7, puja_bajar: 3, presupuesto_subir: 1, pausar: 1 },
  deshechos: ['Subida de puja «jamon» +15 %'],
  veredictos: { mejoro: 6, empeoro: 1, neutro: 3, mezclado: 2 },
  marca: { gasto7: 34, acos7Pct: 6.1 },
  informeIa: { titular: 'Semana buena', puntos: ['Las ventas totales\nsuben'], necesitaPersona: [] },
  necesitaPersona: ['2 propuestas retenidas', 'B0XXXX sin coste (solo defensivo)'],
}
const r1 = textoDelResumen(base)
const l1 = r1.cuerpo.split('\n')
ok('cabecera con el día', l1[0] === '📊 **Agente PPC · Ham Master · España** — jueves 19 nov', l1[0])
ok('negocio primero', l1[1] === '**Ventas totales del mes**: 9.840 € (mes anterior a la misma fecha 8.910 €, +10 %) · TACoS 7,9 % (objetivo 10 %; mes anterior 8,6 %)', l1[1])
ok('ayer provisional sin ACoS', l1[2] === '**Ayer** (provisional, faltan ventas por atribuir): gasto 41,00 € · ventas Ads 180,00 €' && !tiene(l1[2], 'ACoS'), l1[2])
ok('7 días cerrados', l1[3] === '**7 días cerrados** (hasta el 16 nov): ACoS 22,8 % (objetivo 25 %)', l1[3])
ok('mes', l1[4] === '**Mes**: 540 € de 1.200 € (proyección 1.150 €) → ritmo **normal**', l1[4])
ok('hechos ordenados y plurales', tiene(l1[5], '**Hecho en 24 h**: 12 cambios (7 negativas, 3 bajadas de puja, 1 pausa, 1 subida de presupuesto)'), l1[5])
ok('deshecho solo', tiene(l1[5], '1 deshecho solo'), l1[5])
ok('resultados', l1[6] === '**Resultados** (14 d medidos): 6 mejoraron · 1 empeoró · 3 neutros · 2 mezclados', l1[6])
ok('marca propia', l1[7] === '**Marca propia**: gasto 7 d 34 € · ACoS 6,1 %', l1[7])
ok('la lectura en una línea', l1[8] === '**La lectura**: Semana buena · Las ventas totales suben', l1[8])
ok('necesita a una persona', l1[9] === '**Necesita a una persona**: 2 propuestas retenidas · B0XXXX sin coste (solo defensivo)', l1[9])
ok('título ≤ 80 y sin negrita', r1.titulo.length <= 80 && !tiene(r1.titulo, '**'), r1.titulo)

console.log('\n=== resumen en ensayo, sin IA ===')
const r2 = textoDelResumen({ ...base, enEnsayo: true, informeIa: null, marca: null, deshechos: [], veda: { nombre: 'Black Friday + Cyber Monday', hasta: '2026-12-02' } })
ok('habría hecho (ensayo)', tiene(r2.cuerpo, '**Habría hecho (ensayo)**: 12 cambios'), r2.cuerpo)
ok('sin «Hecho en 24 h»', !tiene(r2.cuerpo, 'Hecho en 24 h'))
ok('sin IA no hay «La lectura»', !tiene(r2.cuerpo, 'La lectura'))
ok('sin marca no hay línea', !tiene(r2.cuerpo, 'Marca propia'))
ok('línea de veda', tiene(r2.cuerpo, '🗓️ Black Friday + Cyber Monday: el agente no pasa de ensayo a activo hasta el 3 dic'), r2.cuerpo)

console.log('\n=== resumen en rampa ===')
const r3 = textoDelResumen({ ...base, rampa: { dia: 2, de: 7 } })
ok('(rampa: día 2 de 7)', tiene(r3.cuerpo, '**Hecho en 24 h** (rampa: día 2 de 7): 12 cambios'), r3.cuerpo)

console.log('\n=== resumen con freno y evento ===')
const r4 = textoDelResumen({
  ...base,
  frenado: { motivo: 'gasto_disparado', detalle: 'proyección 112 € frente a 61 € de media' },
  evento: { nombre: 'Black Friday + Cyber Monday', fase: 'durante' },
  hechos: {},
  veredictos: { mejoro: 0, empeoro: 0, neutro: 0, mezclado: 0 },
  mes: { ...base.mes, techo: null, proyeccion: null },
  negocio: { ventasTotalesMes: null, ventasTotalesMesAnterior: null, tacosMesPct: null, tacosMesAnteriorPct: null, tacosObjetivoPct: 10 },
  cerrado7: { acosPct: null, acosObjetivoMedioPct: null, hasta: '2026-11-16' },
})
const l4 = r4.cuerpo.split('\n')
ok('cabecera frenado', tiene(l4[0], 'Agente PPC frenado'), l4[0])
ok('freno arriba', l4[1].startsWith('🛑 **Frenado** (gasto disparado): proyección 112 €'), l4[1])
ok('evento después del freno', l4[2].startsWith('🗓️ Black Friday + Cyber Monday: en curso'), l4[2])
ok('negocio sigue antes que «Ayer»', l4[3].startsWith('**Ventas totales del mes**') && l4[4].startsWith('**Ayer**'), l4[3])
ok('sin techo', tiene(r4.cuerpo, '**Mes**: 540 € sin techo'), r4.cuerpo)
ok('ningún cambio', tiene(r4.cuerpo, '**Hecho en 24 h**: ningún cambio'))
ok('aún sin mediciones', tiene(r4.cuerpo, '**Resultados**: aún sin mediciones'))
ok('ACoS sin ventas sin objetivo', tiene(r4.cuerpo, '(hasta el 16 nov): ACoS sin ventas'), r4.cuerpo)

console.log('\n=== freno ===')
const f1 = textoDeFreno({ nombreCuenta: 'Ham Master · España', motivo: 'gasto_disparado', detalle: 'El gasto de hoy va a 112 € proyectados.', deshechas: 3 })
ok('freno con deshechas', tiene(f1.cuerpo, '🛑 **Agente PPC frenado · Ham Master · España**') && tiene(f1.cuerpo, 'He deshecho 3 subidas de las últimas 48 h'), f1.cuerpo)
ok('freno: cómo reanudar', tiene(f1.cuerpo, 'Marketing Test → Agente'))
const f1b = textoDeFreno({ nombreCuenta: 'X', motivo: 'gasto_disparado', detalle: 'x', deshechas: 3, noDeshechas: 2, quedan: 25 })
ok('freno: dice lo que no se ha podido deshacer y lo que queda', tiene(f1b.cuerpo, '2 subidas no se han podido deshacer') && tiene(f1b.cuerpo, 'Quedan 25 subidas por deshacer'), f1b.cuerpo)
const f2 = textoDeFreno({ nombreCuenta: 'X', motivo: 'datos_viejos', detalle: '', deshechas: 0 })
ok('freno sin deshechas', !tiene(f2.cuerpo, 'He deshecho') && tiene(f2.cuerpo, 'datos sin actualizar'), f2.cuerpo)
const f3 = textoDeFreno({ nombreCuenta: 'X', motivo: 'errores_amazon', detalle: 'Último: «401»', deshechas: 1 })
ok('errores de Amazon', tiene(f3.cuerpo, '⚠️ **Errores de Amazon · X**') && tiene(f3.cuerpo, '1 subida '), f3.cuerpo)
const f4 = textoDeFreno({ nombreCuenta: 'X', motivo: 'ventas_caidas', detalle: '3 días a 120 €/día frente a 410 € de media.', deshechas: 0 })
ok('ventas caídas', tiene(f4.cuerpo, '📉 **Las ventas totales se han hundido · X**') && tiene(f4.cuerpo, 'Buy Box'), f4.cuerpo)
const largo = textoDeFreno({ nombreCuenta: 'Una cuenta con un nombre larguísimo de verdad que no cabe · Estados Unidos', motivo: 'acos_cuenta', detalle: 'x', deshechas: 0 })
ok('título ≤ 80', largo.titulo.length <= 80, `${largo.titulo.length}`)

console.log('\n=== stock ===')
const s1 = textoDeStock({ nombreCuenta: 'HM · España', producto: 'JAMON SERRANO 2,5KG', asin: 'B0A', campanas: 1, anuncios: 2, fuente: 'dos lecturas, inventario FBA de España', vuelve: false })
ok('pausa (activo, sin estado): «voy a pausar», nunca «he pausado» (aún no está aplicada)', tiene(s1.cuerpo, 'Voy a pausar 1 campaña y 2 anuncios') && !tiene(s1.cuerpo, 'He pausado'), s1.cuerpo)
const sEns = textoDeStock({ nombreCuenta: 'HM', producto: 'P', asin: 'B0A', campanas: 1, anuncios: 0, fuente: '', vuelve: false, estado: 'ensayo' })
ok('pausa en ensayo: «habría pausado… (ensayo, no escribo…)»', tiene(sEns.cuerpo, 'Habría pausado 1 campaña') && tiene(sEns.cuerpo, 'ensayo, no escribo') && !tiene(sEns.cuerpo, 'He pausado'), sEns.cuerpo)
const sFre = textoDeStock({ nombreCuenta: 'HM', producto: 'P', asin: 'B0A', campanas: 1, anuncios: 0, fuente: '', vuelve: false, estado: 'frenado' })
ok('pausa con el agente frenado: «propongo pausar…; lo aplica una persona»', tiene(sFre.cuerpo, 'Propongo pausar 1 campaña') && tiene(sFre.cuerpo, 'lo aplica una persona'), sFre.cuerpo)
// Las dos situaciones el mismo día: «aún no pauso» (1.ª lectura a 0) y «pauso» (6 h después) tienen claves distintas
const kRecortar = claveDeAviso('p1', 'stock', '2026-11-19', idDeAvisoDeStock('B0A', 'recortar'))
const kPausa = claveDeAviso('p1', 'stock', '2026-11-19', idDeAvisoDeStock('B0A', 'pausa'))
ok('mismo día y ASIN: «recortar» y «pausa» → claves distintas (el segundo no se descarta)', kRecortar !== kPausa, `${kRecortar} / ${kPausa}`)
{
  const d1 = avisoDeRecortarPorStock({ asin: 'B0A', ceroDesde: '2026-11-17T09:00:00.000Z', estado: 'activo', hoy: '2026-11-19' })
  const d2 = avisoDeRecortarPorStock({ asin: 'B0A', ceroDesde: '2026-11-17T09:00:00.000Z', estado: 'activo', hoy: '2026-11-20' })
  ok('«aún no pauso»: misma clave cada día del mismo episodio (un solo aviso)', claveDeAviso('p1', 'stock', d1.fecha, d1.id) === claveDeAviso('p1', 'stock', d2.fecha, d2.id), `${d1.fecha} ${d1.id}`)
  const otro = avisoDeRecortarPorStock({ asin: 'B0A', ceroDesde: '2026-11-21T09:00:00.000Z', estado: 'activo', hoy: '2026-11-21' })
  ok('un episodio nuevo de stock 0 avisa otra vez', claveDeAviso('p1', 'stock', otro.fecha, otro.id) !== claveDeAviso('p1', 'stock', d1.fecha, d1.id))
  ok('en activo va a la campana (sin avisar:false)', d1.avisar === undefined)
  ok('en ensayo, sin campana', avisoDeRecortarPorStock({ asin: 'B0A', ceroDesde: null, estado: 'ensayo', hoy: '2026-11-19' }).avisar === false)
  ok('sin fecha del episodio: la de hoy', avisoDeRecortarPorStock({ asin: 'B0A', ceroDesde: null, estado: 'activo', hoy: '2026-11-19' }).fecha === '2026-11-19')
}
{
  // El día que pasa de ensayo a activo: «habría pausado» (ensayo) y «voy a pausar» (activo) no pueden compartir clave
  const kEns = claveDeAviso('p1', 'stock', '2026-11-19', idDeAvisoDePausaPorStock('B0A', 'ensayo'))
  const kAct = claveDeAviso('p1', 'stock', '2026-11-19', idDeAvisoDePausaPorStock('B0A', 'activo'))
  const kFre = claveDeAviso('p1', 'stock', '2026-11-19', idDeAvisoDePausaPorStock('B0A', 'frenado'))
  ok('pausa por stock: ensayo, activo y frenado → tres claves distintas el mismo día', new Set([kEns, kAct, kFre]).size === 3, `${kEns} / ${kAct}`)
  ok('… y distintas de la de «recortar»', ![kEns, kAct, kFre].includes(kRecortar))
  // «Vuelve el stock, no lo reactivo»: una vez por pausa, no cada día
  const a1 = avisoDeNoReactivar('B0A', 'prop-1')
  const a2 = avisoDeNoReactivar('B0A', 'prop-1')
  ok('no reactivar: la misma clave cualquier día (un solo aviso por pausa)', claveDeAviso('p1', 'stock-vuelve', a1.fecha, a1.id) === claveDeAviso('p1', 'stock-vuelve', a2.fecha, a2.id) && !/\d{4}-\d{2}-\d{2}/.test(a1.fecha), a1.fecha)
  ok('no reactivar: otra pausa → otra clave', avisoDeNoReactivar('B0A', 'prop-2').id !== a1.id)
}
ok('de dónde sale el 0', tiene(s1.cuerpo, '0 disponibles (dos lecturas, inventario FBA de España)'), s1.cuerpo)
ok('umbral de reactivar', tiene(s1.cuerpo, '5 o más'))
const s2 = textoDeStock({ nombreCuenta: 'HM', producto: 'P', asin: 'B0A', campanas: 0, anuncios: 0, fuente: 'una lectura', vuelve: false })
ok('sin pausas → recortar', tiene(s2.cuerpo, '«recortar»') && !tiene(s2.cuerpo, 'He pausado'), s2.cuerpo)
const s3 = textoDeStock({ nombreCuenta: 'HM', producto: 'P', asin: 'B0A', campanas: 1, anuncios: 0, fuente: '', vuelve: true })
ok('vuelve: reactivada', tiene(s3.cuerpo, 'he reactivado 1 campaña'), s3.cuerpo)
const s4 = textoDeStock({ nombreCuenta: 'HM', producto: 'P', asin: 'B0A', campanas: 1, anuncios: 0, fuente: '', vuelve: true, noReactivada: 'alguien la cambió a mano el 18/11' })
ok('vuelve: no reactivada', tiene(s4.cuerpo, 'no lo reactivo: alguien la cambió a mano el 18/11') && !tiene(s4.cuerpo, 'he reactivado'), s4.cuerpo)
const sf = textoDeStockFallo({ nombreCuenta: 'HM', campana: 'C1', error: 'línea1\nlínea2' })
ok('stock-fallo en una línea', tiene(sf.cuerpo, '«C1»: «línea1 línea2». Revísalo a mano.'), sf.cuerpo)

console.log('\n=== agotada, ensayo, primera escritura, techo, IA ===')
const ag = textoDeAgotada({ nombreCuenta: 'HM', campana: 'C1', hora: '13:40', presupuesto: 30, acosPct: 18, nuevo: 36, moneda: 'EUR', porque: null })
ok('agotada con subida', tiene(ag.cuerpo, 'a las 13:40') && tiene(ag.cuerpo, 'Lo subo a 36 €'), ag.cuerpo)
const ag2 = textoDeAgotada({ nombreCuenta: 'HM', campana: 'C1', hora: '13:40', presupuesto: 30, acosPct: null, nuevo: null, moneda: 'USD', porque: 'el portfolio tiene tope' })
ok('agotada sin subida', tiene(ag2.cuerpo, 'No lo subo: el portfolio tiene tope') && tiene(ag2.cuerpo, '$30'), ag2.cuerpo)
const e1 = textoDeEnsayoFin({ nombreCuenta: 'HM', hechos: { negativizar: 20, puja_bajar: 11 }, veda: null })
ok('ensayo-fin', tiene(e1.cuerpo, 'En 3 días habría hecho 31 cambios distintos (20 negativas, 11 bajadas de puja)') && tiene(e1.cuerpo, 'hoy solo negativas y bajadas'), e1.cuerpo)
const e2 = textoDeEnsayoFin({ nombreCuenta: 'HM', hechos: {}, veda: { nombre: 'Black Friday + Cyber Monday', hasta: '2026-12-02' } })
ok('ensayo-fin con veda', tiene(e2.cuerpo, 'no activo hasta el 3 dic') && tiene(e2.cuerpo, 'Black Friday') && tiene(e2.cuerpo, 'ningún cambio'), e2.cuerpo)
const pe = textoDePrimeraEscritura({ nombreCuenta: 'HM', que: 'Negativa «gratis» en C1' })
ok('primera escritura', tiene(pe.cuerpo, '✍️ **Primera escritura real en Amazon** · HM'), pe.cuerpo)
const t1 = textoDeTechoAuto({ nombreCuenta: 'HM', techo: 1030, detalle: 'gasto de 30 días', moneda: 'EUR' })
ok('techo automático hasta la revisión del mes', tiene(t1.cuerpo, 'Uso como techo 1.030 € (gasto de 30 días) hasta la revisión del mes que viene'), t1.cuerpo)
const t2 = textoDeTechoAuto({ nombreCuenta: 'HM', techo: null, detalle: '', moneda: 'EUR' })
ok('techo nulo: nada sube', tiene(t2.cuerpo, 'no subo pujas ni presupuestos'), t2.cuerpo)
const i1 = textoDeIa({ nombreCuenta: 'HM', tipo: 'tope', tope: 2 })
ok('tope de IA', tiene(i1.cuerpo, '(2,00 $)'), i1.cuerpo)
const i2 = textoDeIa({ nombreCuenta: 'HM', tipo: 'fallo' })
ok('fallo de IA', tiene(i2.cuerpo, 'sigo solo con reglas'), i2.cuerpo)
const todos = [r1, r2, r3, r4, f1, f2, f3, f4, s1, s2, s3, s4, sf, ag, ag2, e1, e2, pe, t1, t2, i1, i2]
ok('todos los títulos ≤ 80 y sin **', todos.every((t) => t.titulo.length <= 80 && !t.titulo.includes('**')))

console.log(fallos ? `\n${fallos} FALLOS` : '\nTodo bien')
if (fallos) process.exit(1)
