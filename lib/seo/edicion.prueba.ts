/**
 * PRUEBAS DEL EDITOR DE FICHA (lib/seo/edicion.ts): qué se manda a Amazon, los Item Highlights y la verificación después de aplicar.
 *   npx tsx lib/seo/edicion.prueba.ts
 */
import { atributoDeHighlights, bloqueosDeEdicion, camposCambiados, camposPisadosDesdeValidar, decidirEdicion, explicacionDeNoAplicada, highlightsDeAtributos, medidasDeEdicion, planDePatch, valoresDeAtributo, verificarEdicion, vinetasQueSalen, type TextosFicha } from './edicion'
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
  ok('seis viñetas con una vacía no bloquean (cuentan las llenas)', bloqueosDeEdicion({ ...base, bullets: ['a', 'b', 'c', 'd', 'e', ' '] }, ['bullets']).bloqueos.length === 0)
  ok('siete viñetas no bloquean si no se tocan', bloqueosDeEdicion({ ...base, bullets: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }, ['titulo']).bloqueos.length === 0)
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

console.log('\n=== solo lo tocado, sin pisar (fallos 10 y 11) ===')
{
  const guardada: TextosFicha = { titulo: 'Título viejo', highlights: '', bullets: ['A', 'B', 'C', 'D', 'E'], descripcion: '', backend: 'backend viejo' }
  const viva: TextosFicha = { titulo: 'Título viejo', highlights: '', bullets: ['A2', 'B2', 'C', 'D', 'E'], descripcion: '', backend: 'backend nuevo' }
  const despues: TextosFicha = { ...guardada, titulo: 'Título nuevo' }
  // (a)
  const a = decidirEdicion({ viva, despues, soloCampos: ['titulo'], antesVisto: { titulo: guardada.titulo } })
  ok('(a) viva con viñetas y backend cambiados en Amazon, solo se toca el título → campos [titulo]', a.ok && JSON.stringify(a.campos) === '["titulo"]', JSON.stringify(a))
  const planA = a.ok ? planDePatch(despues, a.campos, { marketplaceId: ES, languageTag: 'es_ES', atributoHighlights: null }) : null
  ok('(a) y el PATCH solo lleva item_name', planA?.patches.map((p) => p.path).join() === '/attributes/item_name', JSON.stringify(planA?.patches.map((p) => p.path)))
  // (b)
  const b = decidirEdicion({ viva: { ...viva, titulo: 'Título de Seller Central' }, despues, soloCampos: ['titulo'], antesVisto: { titulo: guardada.titulo } })
  ok('(b) el campo tocado cambió en Amazon → ok:false', !b.ok && b.motivo.includes('ha cambiado en Amazon') && JSON.stringify(b.camposCambiadosEnAmazon) === '["titulo"]', JSON.stringify(b))
  const b2 = decidirEdicion({ viva: { ...viva, titulo: 'Título nuevo' }, despues, soloCampos: ['titulo'], antesVisto: { titulo: guardada.titulo } })
  ok('    si Amazon ya tiene lo nuevo, no es pisar (nada que cambiar)', !b2.ok && b2.motivo.includes('No hay nada que cambiar'))
  ok('    sin soloCampos → rechaza', !decidirEdicion({ viva, despues, soloCampos: undefined, antesVisto: {} }).ok)
  ok('    viñetas tocadas que cambiaron en Amazon → ok:false', !decidirEdicion({ viva, despues: { ...guardada, bullets: ['A', 'B', 'C', 'D', 'F'] }, soloCampos: ['bullets'], antesVisto: { bullets: guardada.bullets } }).ok)
  // (c)
  const siete: TextosFicha = { titulo: 'T', highlights: '', bullets: ['1', '2', '3', '4', '5', '6', '7'], descripcion: '', backend: 'k' }
  const c = decidirEdicion({ viva: siete, despues: { ...siete, titulo: 'T2' }, soloCampos: ['titulo'], antesVisto: { titulo: 'T' } })
  const planC = c.ok ? planDePatch({ ...siete, titulo: 'T2' }, c.campos, { marketplaceId: ES, languageTag: 'es_ES', atributoHighlights: null }) : null
  ok('(c) viva con 7 viñetas y solo el título → el PATCH no lleva bullet_point', !!planC && !planC.patches.some((p) => p.path === '/attributes/bullet_point') && planC.patches.length === 1, JSON.stringify(c))
  const planSiete = planDePatch(siete, ['bullets'], { marketplaceId: ES, languageTag: 'es_ES', atributoHighlights: null })
  ok('    7 viñetas mandadas: no se recortan en silencio, se avisa y no se mandan', planSiete.patches.length === 0 && planSiete.avisos.length === 1)
  ok('    la confirmación dice qué viñetas se borran', JSON.stringify(vinetasQueSalen(siete, { ...siete, bullets: ['1', '2', '3', '4', '5'] })) === '["6","7"]')
  // Al aplicar: lo guardado al validar frente a la ficha viva
  ok('    al aplicar, un campo cambiado en Amazon desde validar se detecta', JSON.stringify(camposPisadosDesdeValidar({ ...viva, titulo: 'Otro' }, viva, { ...viva, titulo: 'Título nuevo' }, ['titulo'])) === '["titulo"]')
  ok('    y lo que no se manda no cuenta', camposPisadosDesdeValidar({ ...viva, backend: 'otro' }, viva, { ...viva, titulo: 'Título nuevo' }, ['titulo']).length === 0)
  // (e)
  const e = decidirEdicion({ viva, despues: { ...viva, titulo: 'Propuesta IA' }, soloCampos: ['titulo', 'highlights', 'bullets', 'backend'], esperado: guardada })
  ok('(e) esperado distinto de la ficha viva → no se manda nada', !e.ok && e.motivo.includes('desde que se hizo la propuesta'), JSON.stringify(e))
  const e2 = decidirEdicion({ viva, despues: { ...viva, titulo: 'Propuesta IA' }, soloCampos: ['titulo', 'highlights', 'bullets', 'backend'], esperado: { ...viva, titulo: ' Título  viejo', highlights: 'otros' } })
  ok('    esperado igual (espacios y highlights aparte) → se manda', e2.ok && JSON.stringify(e2.campos) === '["titulo"]', JSON.stringify(e2))
}

console.log('\n=== un solo idioma (fallo 12) ===')
{
  const BE = 'AMEN7PMS3EDWL'
  const item = {
    sku: 'SKU-BE',
    summaries: [{ marketplaceId: BE, asin: 'B0BELGICA1', productType: 'TOY' }],
    attributes: {
      item_name: [
        { value: 'Titre FR', language_tag: 'fr_BE', marketplace_id: BE },
        { value: 'Titel NL', language_tag: 'nl_BE', marketplace_id: BE },
      ],
      bullet_point: [
        { value: 'fr 1', language_tag: 'fr_BE', marketplace_id: BE },
        { value: 'nl 1', language_tag: 'nl_BE', marketplace_id: BE },
        { value: 'fr 2', language_tag: 'fr_BE', marketplace_id: BE },
        { value: 'nl 2', language_tag: 'nl_BE', marketplace_id: BE },
        { value: 'fr 3', language_tag: 'fr_BE', marketplace_id: BE },
        { value: 'nl 3', language_tag: 'nl_BE', marketplace_id: BE },
      ],
      generic_keyword: [
        { value: 'jouet', language_tag: 'fr_BE', marketplace_id: BE },
        { value: 'speelgoed', language_tag: 'nl_BE', marketplace_id: BE },
      ],
    },
  }
  const f = fichaDeItem(item, BE)
  ok("(d) Bélgica con fr_BE y nl_BE → título 'Titre FR'", f?.titulo === 'Titre FR', f?.titulo ?? '')
  ok('(d) 3 viñetas en francés', JSON.stringify(f?.bullets) === '["fr 1","fr 2","fr 3"]', JSON.stringify(f?.bullets))
  ok("(d) otrosIdiomas ['nl_BE'] y se lee con fr_BE", JSON.stringify(f?.otrosIdiomas) === '["nl_BE"]' && f?.languageTag === 'fr_BE', JSON.stringify([f?.otrosIdiomas, f?.languageTag]))
  ok('    el backend, solo el del idioma', f?.backend === 'jouet')
  const v = decidirEdicion({ viva: { titulo: 'Titre FR', bullets: ['fr 1'], backend: 'jouet' }, despues: { titulo: 'Nouveau', bullets: ['fr 1'], backend: 'jouet' }, soloCampos: ['titulo'], antesVisto: { titulo: 'Titre FR' }, otrosIdiomas: f?.otrosIdiomas, languageTag: f?.languageTag })
  ok('    la edición de una ficha bilingüe se bloquea con los dos idiomas', !v.ok && v.motivo.includes('fr_BE y nl_BE') && v.motivo.includes('Seller Central'), JSON.stringify(v))
  // Si el país trae el suyo y otro primero, gana el del país
  const nlPrimero = fichaDeItem({ ...item, attributes: { ...item.attributes, item_name: [...item.attributes.item_name].reverse() } }, BE)
  ok('    si el título viene antes en nl_BE, se lee igual en el idioma del país (fr_BE)', nlPrimero?.titulo === 'Titre FR')
  const es = fichaDeItem({ sku: 'S', summaries: [{ marketplaceId: ES }], attributes: { item_name: [{ value: 'Título', language_tag: 'es_ES', marketplace_id: ES }], bullet_point: [{ value: 'uno', language_tag: 'es_ES', marketplace_id: ES }] } }, ES)
  ok('    una ficha de un idioma no tiene otros', es?.otrosIdiomas?.length === 0 && es?.languageTag === 'es_ES')
  ok('    valoresDeAtributo sin idioma devuelve todo (como antes)', valoresDeAtributo(item.attributes, 'bullet_point', BE).length === 6)
  ok('    los valores sin language_tag se cuentan en cualquier idioma', valoresDeAtributo({ x: [{ value: 'a' }, { value: 'b', language_tag: 'nl_BE' }] }, 'x', BE, 'fr_BE').join() === 'a')
}

console.log(fallos === 0 ? '\nTodo bien.\n' : `\n${fallos} FALLOS\n`)
process.exit(fallos === 0 ? 0 : 1)
