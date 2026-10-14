import { filasACsv } from './exportar'
import { leerCatalogo, planificarImportacion } from './importar'
import { aLineaElegida, buscarTalla, coincide, coloresDe, construirIndice, textoBuscable } from './indice'
import {
  compararNatural,
  compararTalla,
  expandirTallas,
  limpiarCodigoAmazon,
  limpiarContinuidad,
  limpiarEan,
  limpiarPrecio,
  limpiarSku,
  limpiarTalla,
  limpiarTexto,
  sugerirFbasku,
} from './normalizar'
import { esClienteConCatalogo, type FilaCatalogo } from './tipos'
import { avisosDeFila, eanValido, estaCompleta } from './validar'

let fallos = 0
function ok(nombre: string, real: unknown, esperado: unknown) {
  const bien = JSON.stringify(real) === JSON.stringify(esperado)
  if (!bien) fallos += 1
  console.log(`  ${bien ? 'OK  ' : 'FALLA'}  ${nombre}${bien ? '' : ` → ${JSON.stringify(real)} (esperado ${JSON.stringify(esperado)})`}`)
}

/* ------------------------------------------------------------------ */
console.log('=== LIMPIAR ===')
ok('texto: espacios de más y marcas de vacío', [limpiarTexto('  a   b '), limpiarTexto('.'), limpiarTexto('#REF!'), limpiarTexto('N/A')], ['a b', '', '', ''])
ok('FBASKU: solo se recorta, los guiones finales se respetan', [limpiarSku(' FBA939229-35'), limpiarSku('FBA366246-39--'), limpiarSku('FBA-787141-37')], ['FBA939229-35', 'FBA366246-39--', 'FBA-787141-37'])
ok('FNSKU/ASIN: mayúsculas y sin espacios; el punto es vacío', [limpiarCodigoAmazon(' b072m2q2rl '), limpiarCodigoAmazon('.')], ['B072M2Q2RL', ''])
ok('EAN: cifras; con guiones se limpia; en notación científica se deja', [limpiarEan('8435215107664'), limpiarEan('843 5215-107664'), limpiarEan('8,43522E+12')], ['8435215107664', '8435215107664', '8,43522E+12'])
ok('talla: 39.0 -> 39; #REF! vacía; UNICA se queda', [limpiarTalla('39.0'), limpiarTalla('#REF!'), limpiarTalla('UNICA'), limpiarTalla('37/38')], ['39', '', 'UNICA', '37/38'])
ok('precio: coma decimal', limpiarPrecio('74,95'), 74.95)
ok('precio: miles y decimales (1.234,56 y 1,234.56)', [limpiarPrecio('1.234,56'), limpiarPrecio('1,234.56')], [1234.56, 1234.56])
ok('precio: un punto con tres cifras es de miles', limpiarPrecio('1.234'), 1234)
ok('precio: con euro y espacios; texto no es precio', [limpiarPrecio('99 €'), limpiarPrecio('REVISAR PRECIO'), limpiarPrecio('')], [99, null, null])
ok('continuidad: Si / No / vacío', [limpiarContinuidad('Si'), limpiarContinuidad('Sí'), limpiarContinuidad('No'), limpiarContinuidad('')], [true, true, false, null])

ok('FBASKU sugerido: FBA + código + talla', sugerirFbasku('047768', '40'), 'FBA047768-40')
ok('FBASKU sugerido: si el código ya lleva la talla no se repite', sugerirFbasku('912683-44', '44'), 'FBA912683-44')
ok('FBASKU sugerido: sin código o sin talla, nada', [sugerirFbasku('', '40'), sugerirFbasku('047768', '')], ['', ''])

console.log('\n=== ORDEN ===')
ok('REF en orden natural', ['13451ST', '8412', 'F0047', '9578'].sort(compararNatural), ['8412', '9578', '13451ST', 'F0047'])
ok('tallas: números, luego letras', ['42', 'M', '36', 'S', '36,5', 'UNICA', 'XL'].sort(compararTalla), ['36', '36,5', '42', 'S', 'M', 'XL', 'UNICA'])
ok('rango de tallas', expandirTallas('36-41'), ['36', '37', '38', '39', '40', '41'])
ok('lista y rango mezclados, sin repetir', expandirTallas('39, 40; 40 42-43'), ['39', '40', '42', '43'])
ok('«36 a 41» también', expandirTallas('36 a 38'), ['36', '37', '38'])
ok('un rango al revés no vale', expandirTallas('41-36'), [])

console.log('\n=== CLIENTE CON BASE DE DATOS ===')
ok('ShoesF, con cualquier forma de escribirlo', ['ShoesF', 'Shoes F', 'SHOESF S.L.', 'shoes-f'].map(esClienteConCatalogo), [true, true, true, true])
ok('los demás no', ['Cobo Family', 'Shoplamp', '', null].map((n) => esClienteConCatalogo(n as string | null)), [false, false, false, false])

console.log('\n=== VALIDAR ===')
ok('EAN válido del CSV de ShoesF', eanValido('8435215107664'), true)
ok('EAN con una cifra cambiada', eanValido('8435215107665'), false)
const buena = { ean: '8435215107671', fnsku: 'X002I7R3N3', asin: 'B072Q1L4CJ', fbasku: 'FBA047768-40', talla: '40' }
ok('fila completa y correcta: sin avisos', avisosDeFila(buena), [])
ok('sin FNSKU: falta, no está completa', [avisosDeFila({ ...buena, fnsku: null }).map((a) => a.gravedad), estaCompleta({ ...buena, fnsku: null })], [['falta'], false])
ok('FBASKU que acaba en otra talla', avisosDeFila({ ...buena, fbasku: 'FBA209065-41' }).map((a) => a.texto), ['El FBASKU acaba en -41 pero la talla es 40'])
ok('FBASKU con guiones finales no da aviso de talla', avisosDeFila({ ...buena, fbasku: 'FBA366246-40--' }), [])
ok('FNSKU sin la X', avisosDeFila({ ...buena, fnsku: '002LLMEFD' }).map((a) => a.campo), ['fnsku'])
ok('FNSKU igual al ASIN (B0…) es válido', avisosDeFila({ ...buena, fnsku: 'B072Q1L4CJ' }), [])

/* ------------------------------------------------------------------ */
console.log('\n=== LEER LA HOJA ===')
const HOJA = [
  'REF,Nombre y color,EAN,CHECK,Talla,COD ART,FBASKU,FNSKU,ASIN,CONTINUIDAD,PRECIO,',
  '8412,CUERO,8435215107664,FALSE,39,047768,FBA047768-39,,B07DFR2JV4,Si,,',
  '8412,CUERO,8435215107671,FALSE,40,047768,FBA047768-40,X002I7R3N3,B072Q1L4CJ,Si,,',
  'F0047,BURDEOS,8434656152950,FALSE,40,633372,FBA633372-40,X002I7SEYZ,B0772TC3MD,Si,,',
  'F0047,BURDEOS,8434656152950,FALSE,40,633372,FBA633372-40,X002I7SEYZ,B0772TC3MD,Si,,',
  'F1475,TIBET BLANCO,8445472112905,FALSE,37,560802,,.,B09WRWMGZH,Si,,',
  '13451ST,P.N. COÑAC,8445197013631,FALSE,40,366246,FBA366246-40--,X002LFBL85,B08QMK99WW,Si,"74,95",',
  '11091,ORO,8445191743220,FALSE,40,209065,FBA209065-41,X002LLG6JX,B0GJ7432X1,Si,"64,95",',
  '9579,CIDACOS LIBANO,8434656192789,,40,852191-40,FBA852191-40,X002PHDSRV, B072M2Q2RL,,"70,89",REVISAR PRECIO',
  ',,,,,,,,,,,',
  ',8674,OCEANO TAUPE PIEDRA,39,#REF!,X002MKAQ9T,B07W42YVJD,FBA571168-39,2,,,2',
  'W8K-0705C1,OCEANO,8445442378423,FALSE,35,039901,FBA039901-35,X002LLBGAR,B0CPW4BTN7,Si,,',
  'W8K-0705C1,OCEANO,8445442378430,FALSE,36,039901,FBA039901-36,X002LLBGAR,B0CPW4BTN7,Si,,',
].join('\n')

const lectura = leerCatalogo(HOJA)
ok('sin error', lectura.error, null)
ok('columnas entendidas', lectura.columnas.map((c) => c.campo), ['ref', 'nombre', 'ean', 'talla', 'codArt', 'fbasku', 'fnsku', 'asin', 'continuidad', 'precio'])
ok('CHECK se ignora y se dice', lectura.ignoradas, ['CHECK'])
ok('filas importables: 9 de 11 con contenido (la repetida se junta, la sin REF se salta)', [lectura.filas.length, lectura.leidas], [9, 11])
ok('la talla 37 sin FBASKU llega con FBASKU y FNSKU vacíos', (() => { const f = lectura.filas.find((x) => x.ref === 'F1475'); return [f?.fbasku, f?.fnsku] })(), [null, null])
ok('el FBASKU con guiones finales se conserva', lectura.filas.find((x) => x.ref === '13451ST')?.fbasku, 'FBA366246-40--')
ok('el precio entre comillas se lee: 74,95', lectura.filas.find((x) => x.ref === '13451ST')?.precio, 74.95)
ok('el ASIN con espacio se recorta', lectura.filas.find((x) => x.ref === '9579')?.asin, 'B072M2Q2RL')
ok('la nota de la columna sin título se recoge', lectura.filas.find((x) => x.ref === '9579')?.nota, 'REVISAR PRECIO')
ok('continuidad en blanco = no lo dice', lectura.filas.find((x) => x.ref === '9579')?.continuidad, null)
ok('avisos: una repetida, una saltada', [lectura.avisos.filter((a) => a.tipo === 'repetida').length, lectura.avisos.filter((a) => a.tipo === 'saltada').length], [1, 1])
ok('aviso de dato: FBASKU -41 en la talla 40', lectura.avisos.some((a) => a.tipo === 'dato' && a.texto.includes('acaba en -41')), true)
ok('aviso de dato: FNSKU compartido', lectura.avisos.some((a) => a.tipo === 'dato' && a.texto.includes('comparte el FNSKU X002LLBGAR')), true)
ok('la fila del archivo es la de la hoja (cabecera = 1)', lectura.filas[0].fila, 2)

ok('sin cabecera reconocible: error legible', leerCatalogo('foo,bar\n1,2').error?.startsWith('No encuentro las columnas'), true)
ok('vacío: error legible', leerCatalogo('  \n ').error?.startsWith('No hay nada'), true)
ok('sin columna de color: error', leerCatalogo('REF,Talla\n1,40').error?.includes('Nombre y color'), true)

const pegado = leerCatalogo('REF\tNombre y color\tTalla\tFBASKU\n8412\tCUERO\t41\tFBA047768-41')
ok('pegado desde una hoja (tabuladores)', [pegado.error, pegado.filas.length, pegado.filas[0]?.fbasku], [null, 1, 'FBA047768-41'])

/* ------------------------------------------------------------------ */
console.log('\n=== CONTRA LO QUE YA HAY ===')
const f = (id: string, ref: string, nombre: string, talla: string, extra: Partial<FilaCatalogo> = {}): FilaCatalogo => ({
  id,
  ref,
  nombre,
  talla,
  ean: null,
  fnsku: null,
  asin: null,
  fbasku: null,
  codArt: null,
  continuidad: true,
  precio: null,
  nota: null,
  ...extra,
})
const existentes: FilaCatalogo[] = [
  // Igual que en la hoja: no cambia
  f('a', '8412', 'CUERO', '39', { ean: '8435215107664', asin: 'B07DFR2JV4', fbasku: 'FBA047768-39', codArt: '047768', continuidad: true }),
  // Le falta el FNSKU: la hoja lo trae
  f('b', '8412', 'CUERO', '40', { ean: '8435215107671', asin: 'B072Q1L4CJ', fbasku: 'FBA047768-40', codArt: '047768' }),
  // Tiene un FNSKU puesto a mano que la hoja no trae: se queda
  f('c', 'F1475', 'TIBET BLANCO', '37', { fnsku: 'X002MANUAL', ean: '8445472112905', asin: 'B09WRWMGZH', codArt: '560802' }),
]
const plan = planificarImportacion(lectura.filas, existentes)
ok('una cambia (la que ganaba un FNSKU)', plan.cambios.map((c) => [c.id, c.campos]), [['b', ['fnsku']]])
ok('lo que la hoja trae en blanco no borra: el FNSKU manual se queda', plan.cambios.some((c) => c.id === 'c'), false)
ok('una ya estaba tal cual', plan.iguales >= 1, true)
ok('el resto son nuevas', plan.nuevas.length, lectura.filas.length - plan.cambios.length - plan.iguales)
ok('la que coincide por REF+color+talla y completa el FBASKU cambia', (() => { const p = planificarImportacion(lectura.filas, [f('z', 'F1475', 'tibet blanco', '37')]); return p.cambios.map((c) => c.id) })(), ['z'])

const choque = planificarImportacion(
  [{ ...lectura.filas[1], fila: 3 }],
  [f('x', '8412', 'CUERO', '40', { fbasku: 'OTRO-SKU' }), f('y', '9999', 'AZUL', '41', { fbasku: 'FBA047768-40' })]
)
ok('FBASKU de una talla y REF+color+talla de otra: conflicto, no se toca nada', [choque.conflictos.length, choque.cambios.length, choque.nuevas.length], [1, 0, 0])

/* ------------------------------------------------------------------ */
console.log('\n=== ÍNDICE Y DESPLEGABLES ===')
const base: FilaCatalogo[] = [
  f('1', '8412', 'NEGRO', '41', { fbasku: 'FBA377785-41', fnsku: 'X1', ean: '8435215107787', asin: 'B072M2R4W6' }),
  f('2', '8412', 'CUERO', '40', { fbasku: 'FBA047768-40', fnsku: 'X2', ean: '8435215107671', asin: 'B072Q1L4CJ' }),
  f('3', '8412', 'CUERO', '39', { fbasku: 'FBA047768-39', ean: '8435215107664', asin: 'B07DFR2JV4' }),
  f('4', 'F0047', 'BURDEOS', '45', { fbasku: 'FBA633372-45', fnsku: 'X4', ean: '8434656153001', asin: 'B07DPX7BYZ', continuidad: false }),
  f('5', '13451ST', 'P.N. COÑAC', '42'),
  f('6', '8412', 'cuero', '41'), // misma REF y color escritos distinto: es el MISMO color
]
const ix = construirIndice(base)
ok('REF en orden natural', ix.grupos.map((g) => g.ref), ['8412', '13451ST', 'F0047'])
ok('los colores de 8412, sin duplicar «cuero»/«CUERO»', coloresDe(ix, '8412').map((m) => m.nombre), ['CUERO', 'NEGRO'])
ok('las tallas del color, en orden', coloresDe(ix, '8412')[0].filas.map((x) => x.talla), ['39', '40', '41'])
ok('una REF buscada con otra grafía', coloresDe(ix, ' 8412 ').length, 2)
ok('REF inexistente: vacío', coloresDe(ix, 'zzz'), [])
ok('buscar una talla concreta', buscarTalla(ix, '8412', 'Cuero', '40')?.fbasku, 'FBA047768-40')
ok('cuántas incompletas tiene CUERO (39 sin FNSKU, la 41 sin nada)', coloresDe(ix, '8412')[0].incompletas, 2)
ok('sin continuidad solo si TODAS las tallas lo están', [coloresDe(ix, 'F0047')[0].sinContinuidad, coloresDe(ix, '8412')[0].sinContinuidad], [true, false])
ok('por FBASKU se reconoce una línea ya guardada', ix.porSku.get('FBA377785-41')?.id, '1')
ok('la línea de remesa: FBASKU->sku, color->titulo, talla->variante, REF->referencia', aLineaElegida(base[1], 7), {
  sku: 'FBA047768-40', titulo: 'CUERO', asin: 'B072Q1L4CJ', fnsku: 'X2', stock: null, vendible: null, unidades: 7, variante: '40', referencia: '8412', ean: '8435215107671',
})
ok('una talla sin FBASKU no se puede convertir', (() => { try { aLineaElegida(base[4], 1); return 'no falla' } catch { return 'falla' } })(), 'falla')
ok('buscar por EAN lleva al modelo', coincide(textoBuscable(coloresDe(ix, '8412')[0]), '8435215107671'), true)
ok('buscar varias palabras: REF y color', [coincide(textoBuscable(coloresDe(ix, '8412')[1]), '8412 negro'), coincide(textoBuscable(coloresDe(ix, '8412')[0]), '8412 negro')], [true, false])
ok('buscar sin tildes: coñac', coincide(textoBuscable(coloresDe(ix, '13451ST')[0]), 'conac'), true)

/* ------------------------------------------------------------------ */
console.log('\n=== EXPORTAR Y VOLVER A LEER ===')
const csv = filasACsv(base.filter((x) => x.fbasku))
ok('la primera línea es la cabecera de la hoja', csv.split('\r\n')[0], 'REF,Nombre y color,EAN,Talla,COD ART,FBASKU,FNSKU,ASIN,CONTINUIDAD,PRECIO,NOTA')
const vuelta = leerCatalogo(csv)
ok('se vuelve a leer entero', [vuelta.error, vuelta.filas.length, vuelta.filas.map((x) => x.fbasku).sort()], [null, 4, ['FBA047768-39', 'FBA047768-40', 'FBA377785-41', 'FBA633372-45']])
ok('el precio vuelve con coma y se lee igual', (() => {
  const c = filasACsv([f('p', '1', 'A', '40', { fbasku: 'S', precio: 74.95 })])
  return [c.includes('"74,95"'), leerCatalogo(c).filas[0].precio]
})(), [true, 74.95])
ok('la continuidad vuelve como Si/No', vuelta.filas.find((x) => x.fbasku === 'FBA633372-45')?.continuidad, false)

console.log(fallos === 0 ? '\n  TODO CORRECTO' : `\n  ${fallos} FALLOS`)
if (fallos) process.exit(1)
