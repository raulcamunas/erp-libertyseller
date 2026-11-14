import { ACCIONES, type IdAccion } from '@/lib/cumplimiento/acciones'
import {
  RESOLUCION,
  aFormulario,
  atributosDePatches,
  atributosEditables,
  corregibleDesdeErp,
  definicionDeAtributo,
  deFila,
  elementosDelPais,
  erroresDeFila,
  hayErrores,
  huellaDe,
  idiomaDe,
  issuesLegibles,
  patchesDeCorreccion,
} from '@/lib/cumplimiento/correccion'

/**
 * Pruebas de lib/cumplimiento/correccion.ts: quién arregla cada tarea, del esquema de Amazon al formulario, los patches y
 * lo que contesta Amazon. Se ejecuta con `npx tsx lib/cumplimiento/correccion.prueba.ts`.
 * Los esquemas son recortes con la forma REAL de la Product Type Definitions API (meta-esquema de Amazon, 2020-09-01).
 */

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

const ES = 'A1RKKUPIHCS9HS'
const DE = 'A1PA6795UKMFR9'
const DEFS = {
  marketplace_id: { type: 'string', editable: false, hidden: true },
  language_tag: { type: 'string', editable: false, hidden: true },
}
const ITEM_NAME = {
  title: 'Nombre del producto',
  type: 'array',
  minItems: 1,
  maxUniqueItems: 1,
  items: {
    type: 'object',
    required: ['value', 'language_tag', 'marketplace_id'],
    properties: {
      value: { title: 'Nombre del producto', type: 'string', maxLength: 200, examples: ['Zapatilla de running'] },
      language_tag: { $ref: '#/$defs/language_tag' },
      marketplace_id: { $ref: '#/$defs/marketplace_id' },
    },
  },
}
const COLOR = {
  title: 'Color',
  type: 'array',
  items: {
    type: 'object',
    required: ['value'],
    properties: {
      value: { title: 'Color', type: 'string', maxLength: 50 },
      standardized_values: { title: 'Mapa de color', type: 'array', items: { type: 'string', enum: ['Negro', 'Blanco'] } },
      language_tag: { $ref: '#/$defs/language_tag' },
      marketplace_id: { $ref: '#/$defs/marketplace_id' },
    },
  },
}
const BATERIAS = {
  title: '¿Necesita baterías?',
  type: 'array',
  items: {
    type: 'object',
    required: ['value'],
    properties: {
      value: { title: '¿Necesita baterías?', type: 'boolean', enum: [true, false], enumNames: ['Sí', 'No'] },
      marketplace_id: { $ref: '#/$defs/marketplace_id' },
    },
  },
}
const PESO = {
  title: 'Peso del artículo',
  type: 'array',
  items: {
    type: 'object',
    required: ['value', 'unit'],
    properties: {
      value: { title: 'Peso', type: 'number', minimum: 0 },
      unit: { title: 'Unidad', type: 'string', enum: ['grams', 'kilograms'], enumNames: ['Gramos', 'Kilogramos'] },
      marketplace_id: { $ref: '#/$defs/marketplace_id' },
    },
  },
}
const TALLA = {
  title: 'Talla',
  type: 'array',
  items: {
    type: 'object',
    properties: {
      value: { title: 'Talla', anyOf: [{ type: 'string' }, { type: 'string', enum: ['38', '39'], enumNames: ['38 EU', '39 EU'] }] },
      language_tag: { $ref: '#/$defs/language_tag' },
      marketplace_id: { $ref: '#/$defs/marketplace_id' },
    },
  },
}
const VINETAS = { ...ITEM_NAME, title: 'Viñetas', maxItems: 5, maxUniqueItems: 5 }
const GPSR_FABRICANTE = {
  title: 'Fabricante (GPSR)',
  type: 'array',
  items: {
    type: 'object',
    properties: {
      value: { title: 'Nombre', type: 'string' },
      contact: {
        type: 'array',
        items: { type: 'object', properties: { email: { title: 'Correo', type: 'string' }, address: { type: 'object', properties: { city: { title: 'Ciudad', type: 'string' } } } } },
      },
      marketplace_id: { $ref: '#/$defs/marketplace_id' },
    },
  },
}

console.log('\n=== quién arregla cada tarea ===')
{
  const todas = Object.keys(ACCIONES) as IdAccion[]
  ok('todas las acciones tienen resolución', todas.every((a) => RESOLUCION[a] != null))
  ok('RAP y aprobación de marca necesitan al cliente', RESOLUCION.rap === 'cliente' && RESOLUCION['aprobacion-marca'] === 'cliente')
  ok('dato de la ficha y GPSR se corrigen desde el ERP', RESOLUCION['dato-ficha'] === 'erp' && RESOLUCION['gpsr-responsable'] === 'erp')
  ok('imagen principal y oferta en pausa, solo en Seller Central', RESOLUCION['imagen-principal'] === 'seller-central' && RESOLUCION['oferta-en-pausa'] === 'seller-central')
  ok('sin atributos no hay formulario', !corregibleDesdeErp({ atributos: [], categorias: [] }, 'dato-ficha'))
  ok('dato de la ficha con color: corregible', corregibleDesdeErp({ atributos: ['color'], categorias: ['MISSING_ATTRIBUTE'] }, 'dato-ficha'))
  ok('un oculto genérico con atributo inválido: corregible', corregibleDesdeErp({ atributos: ['size'], categorias: ['INVALID_ATTRIBUTE'] }, 'oculto-otros'))
  ok('un oculto genérico sin categoría de atributo: no', !corregibleDesdeErp({ atributos: ['size'], categorias: ['LISTING'] }, 'oculto-otros'))
  ok('la RAP nunca, aunque traiga atributo', !corregibleDesdeErp({ atributos: ['epr_number'], categorias: ['MISSING_ATTRIBUTE'] }, 'rap'))
  ok('precio, stock e imágenes fuera del formulario', JSON.stringify(atributosEditables(['purchasable_offer', 'main_product_image_locator', 'color', 'color'])) === '["color"]')
}

console.log('\n=== del esquema al formulario ===')
{
  const nombre = definicionDeAtributo('item_name', ITEM_NAME, DEFS, ['item_name'])
  ok('item_name: un campo de texto, con idioma y país', nombre.soportado && nombre.campos.length === 1 && nombre.campos[0].tipo === 'texto' && nombre.conIdioma && nombre.conMercado, JSON.stringify(nombre))
  ok('item_name: obligatorio, 200 caracteres y ejemplo', nombre.obligatorio && nombre.campos[0].maxLength === 200 && nombre.campos[0].ejemplo === 'Zapatilla de running')

  const color = definicionDeAtributo('color', COLOR, DEFS)
  ok('color: la lista suelta opcional (mapa de color) se deja aparte', color.soportado && color.campos.map((c) => c.clave).join() === 'value', JSON.stringify(color))
  const rara = definicionDeAtributo('raro', { type: 'array', items: { type: 'object', required: ['lista'], properties: { lista: { type: 'array', items: { type: 'string' } } } } })
  ok('una lista suelta obligatoria: no se entiende, a Seller Central', !rara.soportado && !!rara.motivo)

  const bat = definicionDeAtributo('batteries_required', BATERIAS, DEFS)
  ok('baterías: sí/no con los nombres de Amazon', bat.soportado && bat.campos[0].tipo === 'booleano' && bat.campos[0].opciones?.map((o) => o.texto).join() === 'Sí,No', JSON.stringify(bat.campos))

  const peso = definicionDeAtributo('item_weight', PESO, DEFS)
  ok('peso: número + unidad con desplegable', peso.campos.map((c) => `${c.clave}:${c.tipo}`).join() === 'value:numero,unit:opcion' && peso.campos[1].opciones?.[1].texto === 'Kilogramos')

  const talla = definicionDeAtributo('size', TALLA, DEFS)
  ok('talla: anyOf → opciones y texto libre', talla.campos[0].tipo === 'opcion' && talla.campos[0].libre === true && talla.campos[0].opciones?.length === 2, JSON.stringify(talla.campos))

  const vinetas = definicionDeAtributo('bullet_point', VINETAS, DEFS)
  ok('viñetas: hasta 5 elementos', vinetas.maxElementos === 5)

  const gpsr = definicionDeAtributo('gpsr_manufacturer_reference', GPSR_FABRICANTE, DEFS)
  ok('GPSR: objetos y arrays anidados, con ruta', gpsr.campos.map((c) => c.clave).join() === 'value,contact.0.email,contact.0.address.city', JSON.stringify(gpsr.campos.map((c) => c.clave)))

  ok('atributo que no existe en el tipo de producto', !definicionDeAtributo('nada', undefined).soportado)
}

console.log('\n=== valores: de Amazon al formulario y vuelta ===')
{
  const atributos = {
    item_name: [
      { value: 'Zapatilla roja', language_tag: 'es_ES', marketplace_id: ES },
      { value: 'Roter Schuh', language_tag: 'de_DE', marketplace_id: DE },
    ],
    item_weight: [{ value: 300, unit: 'grams', marketplace_id: ES }],
    gpsr_manufacturer_reference: [{ value: 'Fábrica SL', contact: [{ email: 'a@b.es', phone: '600' }], marketplace_id: ES }],
  }
  ok('solo los elementos del país', elementosDelPais(atributos, 'item_name', DE).length === 1 && elementosDelPais(atributos, 'item_name', DE)[0].value === 'Roter Schuh')
  ok('el idioma: el que ya trae la ficha', idiomaDe(atributos, ES) === 'es_ES' && idiomaDe({}, DE) === 'de_DE')

  const nombre = definicionDeAtributo('item_name', ITEM_NAME, DEFS, ['item_name'])
  const peso = definicionDeAtributo('item_weight', PESO, DEFS)
  const gpsr = definicionDeAtributo('gpsr_manufacturer_reference', GPSR_FABRICANTE, DEFS)
  ok('al formulario: el texto actual', aFormulario(nombre, elementosDelPais(atributos, 'item_name', ES))[0].value === 'Zapatilla roja')
  ok('al formulario: sin valor, una fila vacía', JSON.stringify(aFormulario(nombre, [])) === '[{"value":""}]')
  ok('al formulario: lo anidado', aFormulario(gpsr, elementosDelPais(atributos, 'gpsr_manufacturer_reference', ES))[0]['contact.0.email'] === 'a@b.es')

  ok('fila de peso: número con coma', JSON.stringify(deFila(peso, { value: '0,5', unit: 'kilograms' }, ES, 'es_ES')) === JSON.stringify({ value: 0.5, unit: 'kilograms', marketplace_id: ES }))
  ok('fila vacía: null', deFila(peso, { value: '', unit: '' }, ES, 'es_ES') === null)

  ok('errores: texto largo', erroresDeFila(nombre, { value: 'x'.repeat(201) }).value?.startsWith('Como mucho 200'))
  ok('errores: número que no es número', erroresDeFila(peso, { value: 'mucho', unit: 'grams' }).value === 'Tiene que ser un número')
  ok('errores: unidad fuera de la lista', erroresDeFila(peso, { value: '1', unit: 'libras' }).unit === 'Elige uno de los valores de Amazon')
  ok('errores: una fila vacía no da error', Object.keys(erroresDeFila(peso, { value: '', unit: '' })).length === 0)

  const sinCambio = patchesDeCorreccion([nombre, peso], { item_name: [{ value: 'Zapatilla roja' }], item_weight: [{ value: '300', unit: 'grams' }] }, atributos, ES, 'es_ES')
  ok('lo que no cambia no se manda', sinCambio.patches.length === 0 && sinCambio.errores.length === 0, JSON.stringify(sinCambio))

  const cambio = patchesDeCorreccion([nombre, peso], { item_name: [{ value: 'Zapatilla roja de running' }], item_weight: [{ value: '300', unit: 'grams' }] }, atributos, ES, 'es_ES')
  ok('un replace por atributo que cambia', cambio.patches.length === 1 && cambio.patches[0].op === 'replace' && cambio.patches[0].path === '/attributes/item_name', JSON.stringify(cambio.patches))
  ok('con su país y su idioma', JSON.stringify(cambio.patches[0].value) === JSON.stringify([{ value: 'Zapatilla roja de running', language_tag: 'es_ES', marketplace_id: ES }]))
  ok('y lo que había antes (solo de este país)', JSON.stringify(cambio.anteriores.item_name) === JSON.stringify([{ value: 'Zapatilla roja', language_tag: 'es_ES', marketplace_id: ES }]))

  const anidado = patchesDeCorreccion([gpsr], { gpsr_manufacturer_reference: [{ value: 'Fábrica SL', 'contact.0.email': 'nuevo@b.es', 'contact.0.address.city': '' }] }, atributos, ES, 'es_ES')
  const enviado = anidado.patches[0]?.value[0] as { contact: Array<{ email: string; phone?: string }> }
  ok('lo anidado conserva lo que el formulario no enseña (el teléfono)', enviado?.contact?.[0]?.email === 'nuevo@b.es' && enviado.contact[0].phone === '600', JSON.stringify(anidado.patches))

  const conError = patchesDeCorreccion([peso], { item_weight: [{ value: '-1', unit: 'grams' }] }, atributos, ES, 'es_ES')
  ok('los errores del formulario se devuelven', conError.errores.length === 1 && conError.errores[0].includes('mínimo 0'), JSON.stringify(conError.errores))

  ok('dejar vacío no borra nada', patchesDeCorreccion([nombre], { item_name: [{ value: '' }] }, atributos, ES, 'es_ES').patches.length === 0)

  const h1 = huellaDe(cambio.patches, 'SKU-1', ES)
  ok('huella estable y distinta por SKU', h1 === huellaDe(JSON.parse(JSON.stringify(cambio.patches)), 'SKU-1', ES) && h1 !== huellaDe(cambio.patches, 'SKU-2', ES))
  ok('atributos de unos patches', atributosDePatches(cambio.patches).join() === 'item_name')
}

console.log('\n=== lo que contesta Amazon ===')
{
  const issues = [
    { code: '90220', message: 'Falta «Color».', severity: 'WARNING', attributeNames: ['color'] },
    { code: '8541', message: 'El valor no es válido.', severity: 'ERROR', attributeNames: ['item_name'] },
    { code: '8541', message: 'El valor no es válido.', severity: 'ERROR', attributeNames: ['item_name'] },
    { code: '1', severity: 'ERROR', categories: ['MISSING_ATTRIBUTE'] },
  ]
  const l = issuesLegibles(issues, [{ nombre: 'item_name', titulo: 'Nombre del producto' }])
  ok('errores primero, sin repetidos', l.length === 3 && l[0].gravedad === 'error' && l[2].gravedad === 'aviso', JSON.stringify(l))
  ok('con el título del atributo', l[0].atributos[0]?.titulo === 'Nombre del producto')
  ok('sin mensaje: el de su categoría', l[1].mensaje === 'Falta un dato obligatorio.')
  ok('hay errores', hayErrores(issues) && !hayErrores([issues[0]]) && hayErrores([], 'INVALID'))
}

console.log(`\n${fallos === 0 ? 'TODO BIEN' : `${fallos} FALLOS`}\n`)
if (fallos > 0) process.exit(1)
