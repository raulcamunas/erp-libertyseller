/**
 * PRUEBAS DEL EDITOR DE FICHA (lib/seo/edicion.ts): qué se manda a Amazon, los Item Highlights y la verificación después de aplicar.
 *   npx tsx lib/seo/edicion.prueba.ts
 */
import { atributoDeHighlights, bloqueosDeEdicion, camposCambiados, explicacionDeNoAplicada, highlightsDeAtributos, medidasDeEdicion, planDePatch, verificarEdicion, type TextosFicha } from './edicion'
import { fichaDeItem, incidenciasDe } from './ficha-servidor'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

const ES = 'A1RKKUPIHCS9HS'
const base: TextosFicha = { titulo: 'Marca Lámpara de pie LED regulable', highlights: '', bullets: ['UNO: a', 'DOS: b'], descripcion: 'Desc', backend: 'flexo salon' }

console.log('\n=== campos que cambian ===')
{
  ok('nada cambia → ninguno', camposCambiados(base, { ...base }).length === 0)
  ok('espacios de más no cuentan', camposCambiados(base, { ...base, titulo: '  Marca  Lámpara de pie LED regulable ' }).length === 0)
  ok('cambia el título', JSON.stringify(camposCambiados(base, { ...base, titulo: 'Otra' })) === '["titulo"]')
  ok('highlights sin venir (null) no se tocan', camposCambiados(base, { ...base, highlights: null }).length === 0)
  ok('highlights nuevos sí', camposCambiados(base, { ...base, highlights: 'Pack de 2' }).includes('highlights'))
  ok('orden de viñetas cuenta', camposCambiados(base, { ...base, bullets: ['DOS: b', 'UNO: a'] }).includes('bullets'))
}

console.log('\n=== atributo de los Item Highlights ===')
{
  ok('lo encuentra por nombre conocido', atributoDeHighlights(['item_name', 'bullet_point', 'item_highlights']) === 'item_highlights')
  ok('o por parecido', atributoDeHighlights(['item_name', 'key_highlight_text']) === 'key_highlight_text')
  ok('si el tipo no lo tiene → null', atributoDeHighlights(['item_name', 'bullet_point']) === null)
  const atributos = { item_highlights: [{ value: 'Pack de 2 · 3 años', marketplace_id: ES, language_tag: 'es_ES' }, { value: 'Otro país', marketplace_id: 'X' }] }
  ok('lee los highlights de este marketplace', highlightsDeAtributos(atributos, ES) === 'Pack de 2 · 3 años')
  ok('con el atributo pedido', highlightsDeAtributos(atributos, ES, 'item_highlights') === 'Pack de 2 · 3 años')
  ok('sin atributo → null', highlightsDeAtributos({ item_name: [{ value: 'x' }] }, ES) === null)
}

console.log('\n=== el PATCH ===')
{
  const t: TextosFicha = { titulo: 'T nuevo', highlights: 'Pack de 2', bullets: ['a', '', 'b'], descripcion: 'D', backend: '' }
  const con = planDePatch(t, ['titulo', 'highlights', 'bullets', 'backend'], { marketplaceId: ES, languageTag: 'es_ES', atributoHighlights: 'item_highlights' })
  ok('manda los highlights con su atributo', con.patches.some((p) => p.path === '/attributes/item_highlights' && p.value[0].value === 'Pack de 2'))
  ok('viñetas sin vacías', con.patches.find((p) => p.path === '/attributes/bullet_point')?.value.length === 2)
  ok('backend vacío no se manda (no se borra)', !con.patches.some((p) => p.path === '/attributes/generic_keyword'))
  ok('cada valor con idioma y marketplace', con.patches.every((p) => p.value.every((v) => v.language_tag === 'es_ES' && v.marketplace_id === ES)))
  ok('enviados = los mandados de verdad', JSON.stringify(con.enviados) === '["titulo","highlights","bullets"]', JSON.stringify(con.enviados))
  const sin = planDePatch(t, ['titulo', 'highlights'], { marketplaceId: ES, languageTag: 'es_ES', atributoHighlights: null })
  ok('sin atributo: NO se pierden en silencio, se avisa', sin.avisos.length === 1 && !sin.enviados.includes('highlights'))
  ok('solo los campos pedidos', planDePatch(t, ['descripcion'], { marketplaceId: ES, languageTag: 'es_ES', atributoHighlights: null }).patches.map((p) => p.path).join() === '/attributes/product_description')
}

console.log('\n=== límites (norma de 2026) ===')
{
  const largo = 'x'.repeat(80)
  const b = bloqueosDeEdicion({ ...base, titulo: largo }, ['titulo'])
  ok('título de 80 caracteres no se manda', b.bloqueos.length === 1 && b.bloqueos[0].includes('80 de 75'), b.bloqueos.join('|'))
  ok('un campo que no se toca no bloquea', bloqueosDeEdicion({ ...base, titulo: largo }, ['backend']).bloqueos.length === 0)
  ok('backend de 250 bytes bloquea', bloqueosDeEdicion({ ...base, backend: 'a'.repeat(250) }, ['backend']).bloqueos.length === 1)
  ok('la ñ cuenta 2 bytes en el backend', medidasDeEdicion({ ...base, backend: 'ñ' }).find((m) => m.campo === 'backend')?.valor === 2)
  ok('título vacío bloquea', bloqueosDeEdicion({ ...base, titulo: ' ' }, ['titulo']).bloqueos.some((x) => x.includes('vacío')))
  ok('seis viñetas bloquean', bloqueosDeEdicion({ ...base, bullets: ['a', 'b', 'c', 'd', 'e', 'f'] }, ['bullets']).bloqueos.length === 1)
}

console.log('\n=== verificar después de aplicar ===')
{
  const enviado: TextosFicha = { titulo: 'Nuevo', highlights: 'H', bullets: ['a', 'b'], backend: 'k' }
  const igual = verificarEdicion(enviado, { titulo: 'Nuevo ', bullets: ['a', 'b'], backend: 'k', highlights: 'H' }, ['titulo', 'bullets', 'backend', 'highlights'], 1)
  ok('todo igual → aplicada', igual.estado === 'aplicada')
  const pronto = verificarEdicion(enviado, { titulo: 'Viejo', bullets: ['a', 'b'], backend: 'k' }, ['titulo', 'bullets'], 1)
  ok('a la hora aún distinto → pendiente', pronto.estado === 'pendiente')
  const parcial = verificarEdicion(enviado, { titulo: 'Viejo', bullets: ['a', 'b'], backend: 'k' }, ['titulo', 'bullets'], 30)
  ok('pasado el plazo, uno sí y otro no → parcial', parcial.estado === 'parcial' && parcial.campos.titulo === 'distinto' && parcial.campos.bullets === 'igual')
  const no = verificarEdicion(enviado, { titulo: 'Reescrito por Amazon', bullets: ['z'] }, ['titulo', 'bullets'], 30)
  ok('ninguno → no aplicada', no.estado === 'no_aplicada')
  ok('y se explica (otro contribuidor / Amazon)', (explicacionDeNoAplicada(no.estado, no.campos) ?? '').includes('contribuidor'))
  const sinLeer = verificarEdicion(enviado, { titulo: 'Nuevo' }, ['titulo', 'highlights'], 2)
  ok('highlights que no se pueden leer no cuentan', sinLeer.estado === 'aplicada' && sinLeer.campos.highlights === 'sin_leer')
  const nadaLeido = verificarEdicion(enviado, {}, ['titulo', 'bullets'], 30)
  ok('sin poder releer la ficha en 24 h → no aplicada (no «aplicada»)', nadaLeido.estado === 'no_aplicada')
  ok('y se explica que no se pudo releer', (explicacionDeNoAplicada(nadaLeido.estado, nadaLeido.campos) ?? '').includes('releer'))
  const sinHighlights = verificarEdicion(enviado, { highlights: '' }, ['highlights'], 30)
  ok('highlights mandados que la ficha no trae → no aplicada', sinHighlights.estado === 'no_aplicada' && sinHighlights.campos.highlights === 'distinto')
}

console.log('\n=== lectura del listing: highlights, tipo e incidencias ===')
{
  const f = fichaDeItem(
    {
      sku: 'SKU1',
      summaries: [{ marketplaceId: ES, asin: 'B0ABCDEFGH', productType: 'LAMP' }],
      attributes: { item_name: [{ value: 'Título', marketplace_id: ES }], item_highlights: [{ value: 'Pack', marketplace_id: ES }] },
      issues: [{ code: '90220', message: 'Falta la marca', severity: 'ERROR', attributeNames: ['brand'] }, { foo: 1 }],
    },
    ES
  )
  ok('tipo de producto', f?.productType === 'LAMP')
  ok('highlights', f?.highlights === 'Pack')
  ok('incidencias aplanadas (sin las vacías)', f?.issues.length === 1 && f.issues[0].atributos[0] === 'brand')
  ok('incidencias de algo que no es lista → vacías', incidenciasDe(null).length === 0)
}

console.log(fallos === 0 ? '\nTodo bien.\n' : `\n${fallos} FALLOS\n`)
process.exit(fallos === 0 ? 0 : 1)
