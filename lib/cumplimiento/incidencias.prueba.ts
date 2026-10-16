import {
  clasificarTema,
  conservarDesde,
  estaExenta,
  huella,
  necesitaAtencion,
  normalizarIncidencias,
  ocultaAhora,
  ordenarIncidencias,
  problemaMasAntiguo,
  resumir,
} from '@/lib/cumplimiento/incidencias'
import type { Incidencia } from '@/lib/cumplimiento/tipos'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/**
 * Estas respuestas están escritas A MANO a partir del modelo documentado de la API
 * de listados (Issue / Enforcements / Exemption). NO son capturas de la cuenta de
 * ningún cliente: no hay credenciales de Amazon en esta máquina. Los mensajes son
 * el tipo de texto que Amazon devuelve con issueLocale es_ES, no copias literales.
 * La prueba de verdad es la primera pasada en producción.
 */
const AHORA = new Date('2026-10-15T10:00:00Z')

const faltaFabricante = {
  code: '90220',
  message: "Falta el atributo «Fabricante», que es obligatorio.",
  severity: 'ERROR',
  attributeNames: ['manufacturer'],
  categories: ['MISSING_ATTRIBUTE'],
}
const gtinOculta = {
  code: '8541',
  message: 'El código de barras (GTIN) no es válido. El producto está oculto en las búsquedas.',
  severity: 'ERROR',
  attributeNames: ['externally_assigned_product_identifier'],
  categories: ['INVALID_ATTRIBUTE'],
  enforcements: { actions: [{ action: 'SEARCH_SUPPRESSED' }], exemption: { status: 'NOT_EXEMPT' } },
}
const gpsr = (exencion?: { status: string; expiryDate?: string }) => ({
  code: '99010',
  message: 'Este producto necesita información de seguridad del producto.',
  severity: 'ERROR',
  attributeNames: ['gpsr_safety_attestation', 'dsa_responsible_party_address'],
  categories: ['MISSING_ATTRIBUTE'],
  enforcements: { actions: [{ action: 'LISTING_SUPPRESSED' }], ...(exencion ? { exemption: exencion } : {}) },
})
const avisoImagen = {
  code: '5461',
  message: 'La imagen principal podría mejorarse.',
  severity: 'WARNING',
  attributeNames: ['main_product_image_locator'],
  categories: ['INVALID_IMAGE'],
}

console.log('\n=== lo que no es una lista de incidencias no rompe nada ===')
ok('null', normalizarIncidencias(null).length === 0)
ok('undefined', normalizarIncidencias(undefined).length === 0)
ok('un objeto suelto', normalizarIncidencias({ code: '1' }).length === 0)
ok('basura dentro de la lista', normalizarIncidencias([null, 5, 'x', {}, [], { code: '', message: '' }]).length === 0)
ok('campos con el tipo equivocado se descartan', (() => {
  const r = normalizarIncidencias([{ code: 7, message: ['no'], severity: 3, attributeNames: 'x', categories: [1, 'A'] }])
  return r.length === 1 && r[0].codigo === '7' && r[0].mensaje === '' && r[0].atributos.length === 0 && r[0].categorias.join() === 'A'
})())

console.log('\n=== una incidencia normal ===')
{
  const [i] = normalizarIncidencias([faltaFabricante])
  ok('código como texto', i.codigo === '90220')
  ok('gravedad error', i.gravedad === 'error')
  ok('atributos y categorías', i.atributos.join() === 'manufacturer' && i.categorias.join() === 'MISSING_ATTRIBUTE')
  ok('sin acciones ni exención', i.acciones.length === 0 && i.exencion === null)
  ok('tema datos', i.tema === 'datos', i.tema)
}

console.log('\n=== severidades ===')
{
  const r = normalizarIncidencias([
    { code: 'a', message: 'x', severity: 'WARNING' },
    { code: 'b', message: 'x', severity: 'INFO' },
    { code: 'c', message: 'x', severity: 'ALGO_NUEVO' },
    { code: 'd', message: 'x' },
    { code: 'e', message: 'x', severity: 'error' },
  ])
  ok('WARNING = aviso', r[0].gravedad === 'aviso')
  ok('INFO = info', r[1].gravedad === 'info')
  ok('una gravedad desconocida se enseña como aviso, no se esconde', r[2].gravedad === 'aviso')
  ok('sin gravedad = aviso', r[3].gravedad === 'aviso')
  ok('en minúsculas también', r[4].gravedad === 'error')
}

console.log('\n=== acciones y exención ===')
{
  const [a] = normalizarIncidencias([gtinOculta])
  ok('acción SEARCH_SUPPRESSED', a.acciones.join() === 'SEARCH_SUPPRESSED')
  ok('exención NOT_EXEMPT guardada', a.exencion?.estado === 'NOT_EXEMPT' && a.exencion.caduca === null)
  ok('oculta ahora', ocultaAhora(a, AHORA))

  const [fut] = normalizarIncidencias([gpsr({ status: 'EXEMPT_UNTIL_EXPIRY_DATE', expiryDate: '2026-12-01T00:00:00Z' })])
  ok('plazo de gracia vigente: NO oculta todavía', !ocultaAhora(fut, AHORA))
  ok('pero la fecha se conserva', fut.exencion?.caduca === '2026-12-01T00:00:00Z')

  const [pas] = normalizarIncidencias([gpsr({ status: 'EXEMPT_UNTIL_EXPIRY_DATE', expiryDate: '2026-09-01T00:00:00Z' })])
  ok('plazo caducado: oculta', ocultaAhora(pas, AHORA))

  const [sinFecha] = normalizarIncidencias([gpsr({ status: 'EXEMPT_UNTIL_EXPIRY_DATE' })])
  ok('plazo sin fecha legible: oculta (no se da por protegido)', ocultaAhora(sinFecha, AHORA))

  const [exento] = normalizarIncidencias([gpsr({ status: 'EXEMPT' })])
  ok('exento sin fecha: no oculta', !ocultaAhora(exento, AHORA))

  const [atr] = normalizarIncidencias([
    { code: '1', message: 'x', severity: 'WARNING', enforcements: { actions: [{ action: 'ATTRIBUTE_SUPPRESSED' }] } },
  ])
  ok('ATTRIBUTE_SUPPRESSED oculta un dato, no el listing', !ocultaAhora(atr, AHORA))

  const [ret] = normalizarIncidencias([
    { code: '1', message: 'x', severity: 'ERROR', enforcements: { actions: [{ action: 'CATALOG_ITEM_REMOVED' }] } },
  ])
  ok('CATALOG_ITEM_REMOVED oculta', ocultaAhora(ret, AHORA))

  ok('acciones como texto plano también', normalizarIncidencias([
    { code: '1', message: 'x', enforcements: { actions: ['SEARCH_SUPPRESSED'] } },
  ])[0].acciones.join() === 'SEARCH_SUPPRESSED')
}

console.log('\n=== estaExenta, directa ===')
ok('null', !estaExenta(null, AHORA))
ok('EXEMPT', estaExenta({ estado: 'EXEMPT', caduca: null }, AHORA))
ok('hasta una fecha futura', estaExenta({ estado: 'EXEMPT_UNTIL_EXPIRY_DATE', caduca: '2026-10-16T00:00:00Z' }, AHORA))
ok('hasta una fecha pasada', !estaExenta({ estado: 'EXEMPT_UNTIL_EXPIRY_DATE', caduca: '2026-10-14T00:00:00Z' }, AHORA))
ok('hasta una fecha ilegible', !estaExenta({ estado: 'EXEMPT_UNTIL_EXPIRY_DATE', caduca: 'mañana' }, AHORA))
ok('NOT_EXEMPT', !estaExenta({ estado: 'NOT_EXEMPT', caduca: null }, AHORA))
ok('un estado que no conocemos', !estaExenta({ estado: 'OTRA_COSA', caduca: null }, AHORA))

console.log('\n=== temas ===')
const tema = (i: { mensaje?: string; atributos?: string[]; categorias?: string[]; codigo?: string }) =>
  clasificarTema({ codigo: i.codigo ?? '1', mensaje: i.mensaje ?? '', atributos: i.atributos ?? [], categorias: i.categorias ?? [] })
ok('GPSR por atributos', tema({ atributos: ['gpsr_safety_attestation'] }) === 'normativa')
ok('persona responsable (DSA)', tema({ atributos: ['dsa_responsible_party_address'] }) === 'normativa')
ok('documentos de cumplimiento', tema({ atributos: ['compliance_media'] }) === 'normativa')
ok('certificado por el nombre', tema({ atributos: ['regulatory_compliance_certification'] }) === 'normativa')
ok('marcado CE como palabra entera', tema({ atributos: ['ce_marking'] }) === 'normativa')
ok('«ce» dentro de «price» NO es normativa', tema({ atributos: ['list_price'], categorias: ['INVALID_PRICE'] }) === 'precio')
ok('«ce» dentro de «device_...» tampoco', tema({ atributos: ['device_type'], categorias: ['MISSING_ATTRIBUTE'] }) === 'datos')
ok('normativa por el texto', tema({ mensaje: 'Falta el cumplimiento de la normativa de seguridad de los productos.' }) === 'normativa')
ok('RAEE por el texto', tema({ mensaje: 'Debes indicar tu número de registro RAEE.' }) === 'normativa')
ok('mercancías peligrosas por atributo', tema({ atributos: ['supplier_declared_dg_hz_regulation'] }) === 'peligrosas')
ok('hoja de seguridad por atributo', tema({ atributos: ['safety_data_sheet_url'] }) === 'peligrosas')
ok('baterías por atributo', tema({ atributos: ['batteries_required'] }) === 'peligrosas')
ok('litio por atributo', tema({ atributos: ['lithium_battery_weight'] }) === 'peligrosas')
ok('baterías por el texto, con acento', tema({ mensaje: 'La información de la batería es obligatoria.' }) === 'peligrosas')
ok('peligrosas gana a normativa si coinciden', tema({ atributos: ['hazmat'], mensaje: 'normativa de seguridad' }) === 'peligrosas')
ok('aprobación por categoría, aunque haya atributos de normativa', tema({ categorias: ['QUALIFICATION_REQUIRED'], atributos: ['gpsr_safety_attestation'] }) === 'aprobacion')
ok('aprobación por el texto', tema({ mensaje: 'Esta categoría está restringida y necesita aprobación.' }) === 'aprobacion')
ok('marca por atributo', tema({ atributos: ['brand'] }) === 'marca')
ok('marca por el texto', tema({ mensaje: 'La marca no coincide con la del catálogo.' }) === 'marca')
ok('GTIN por atributo', tema({ atributos: ['externally_assigned_product_identifier'] }) === 'identificadores')
ok('EAN como palabra', tema({ mensaje: 'El valor del EAN no es válido.' }) === 'identificadores')
ok('«ean» dentro de otra palabra NO cuenta', tema({ mensaje: 'Limpieza del océano.' }) === 'otros')
ok('imagen por categoría', tema({ categorias: ['MISSING_IMAGE'] }) === 'imagenes')
ok('precio por categoría', tema({ categorias: ['INVALID_PRICE'] }) === 'precio')
ok('duplicado por categoría', tema({ categorias: ['DUPLICATE'] }) === 'duplicado')
ok('imagen por el texto', tema({ mensaje: 'La imagen tiene fondo blanco.' }) === 'imagenes')
ok('atributo suelto = datos', tema({ atributos: ['color'] }) === 'datos')
ok('sin nada = otros', tema({ mensaje: 'Algo ha pasado.' }) === 'otros')

console.log('\n=== mensajes REALES de Amazon (capturados de las cuentas el 16 oct 2026, recortados) ===')
{
  // Estos sí son reales: salen de listing_cumplimiento tras las primeras pasadas en producción
  const real = (mensaje: string, categorias: string[], atributos: string[] = []) => tema({ mensaje, categorias, atributos })
  ok('RAP/RER con QUALIFICATION_REQUIRED es normativa, no aprobación',
    real('Para vender este producto en las tiendas de Amazon, debes obtener la información de una RER para cumplir la normativa de responsabilidad ampliada del productor (RAP). Más', ['QUALIFICATION_REQUIRED', 'LISTING']) === 'normativa')
  ok('RAP/RER como simple aviso',
    real('Para vender este producto en las tiendas de Amazon, debes obtener la información de una RER para cumplir la normativa de responsabilidad ampliada del productor (RAP). Si ', ['LISTING']) === 'normativa')
  ok('GPSR: información del fabricante',
    real('Para vender este producto en las tiendas de Amazon ubicadas en la UE, debes proporcionar información del fabricante para cumplir con el Reglamento general de seguridad de los productos', ['MISSING_ATTRIBUTE', 'PRODUCT']) === 'normativa')
  ok('GPSR: advertencias y seguridad',
    real('Para vender este producto en las tiendas de Amazon ubicadas en la UE, debes proporcionar información de advertencia y seguridad para cumplir con el Reglamento general de seguridad', ['MISSING_ATTRIBUTE', 'PRODUCT']) === 'normativa')
  ok('GPSR: persona responsable',
    real('Para vender este producto en las tiendas europeas de Amazon, debes proporcionar información sobre la persona responsable para cumplir con el Reglamento general de seguridad', ['MISSING_ATTRIBUTE', 'LISTING']) === 'normativa')
  ok('documento de cumplimiento en el panel de estado de la cuenta',
    real('Visita el panel de estado de la cuenta para verificar el requisito y continuar con la carga del documento de cumplimiento necesario, atribuir o apelar el requisito', ['MISSING_ATTRIBUTE', 'LISTING']) === 'normativa')
  ok('permisos de acceso con compliance_media', real('Es necesario actualizar tus permisos de acceso. Comprueba la configuración del navegador e inténtalo de nuevo.', ['INVALID_ATTRIBUTE', 'LISTING'], ['compliance_media']) === 'normativa')
  ok('autorización de marca sigue siendo aprobación',
    real('Necesitas autorización para publicar productos de esta marca.', ['QUALIFICATION_REQUIRED', 'LISTING']) === 'aprobacion')
  ok('precio por debajo del umbral',
    real('El precio de venta está por debajo del umbral de precio mínimo. Comprueba si has introducido el precio correcto', ['INVALID_PRICE', 'INVALID_ATTRIBUTE', 'LISTING']) === 'precio')
  ok('identificadores del catálogo (UPC, ISBN, EAN)',
    real('Los datos proporcionados del listing son diferentes de los que ya están en el catálogo de Amazon. La identificadores de productos estándar (como códigos UPC, ISBN, EAN o', ['INVALID_ATTRIBUTE', 'LISTING']) === 'identificadores')
  ok('atributo obligatorio que falta', real("'Color' es obligatorio y no está.", ['MISSING_ATTRIBUTE', 'PRODUCT'], ['color']) === 'datos')
  ok('relaciones de variante de una marca', real('No puedes crear nuevas relaciones de variante para esta marca. Puedes añadir ofertas a cualquier ASIN existente de esta marca.', ['LISTING']) === 'marca')
  ok('la marca no coincide con toda la familia', real('El ASIN secundario no se puede añadir al ASIN principal porque el valor de la marca no coincide con toda la familia.', ['INVALID_ATTRIBUTE', 'PRODUCT'], ['brand', 'global_catalog_owner']) === 'marca')
  ok('un mensaje de códigos de barras que acaba hablando de «certificado GS1» NO es normativa',
    real('El ID de producto (ASIN, UPC, EAN, ISBN o JAN) que has proporcionado no coincide con los registros de nuestra marca. Comprueba que estás utilizando el código de barras asignado por el fabricante correcto. Si has comprado recientemente un GTIN/UPC en GS1, espera 72 horas antes de volver a enviarlo. Si estás seguro de que has utilizado un ID de producto correcto, ponte en contacto con el servicio de asistencia para colaboradores comerciales con las imágenes del producto que muestren el código de barras y la marca, tu certificado GS1 y los documentos de autorización de la marca.', ['INVALID_ATTRIBUTE', 'LISTING']) === 'identificadores')
  ok('uno que acaba pidiendo «el nombre de tu marca» NO es de marca',
    real('El SKU no coincide con ningún ASIN existente y no podemos crear uno nuevo con la información proporcionada. Asegúrate de que tu UPC/EAN/GTIN esté registrado en la plataforma GS1. Si lo ha registrado recientemente, espera hasta 72 horas para que nuestros sistemas se actualicen. Verifica también que el nombre de tu marca coincida exactamente con el nombre asociado a tu UPC/EAN/GTIN.', ['INVALID_ATTRIBUTE', 'LISTING'], ['273672-39']) === 'identificadores')
  ok('imagen principal que no representa el producto', real('La imagen MAIN que has enviado para US/Global no representa con precisión el producto', ['INVALID_IMAGE', 'INVALID_ATTRIBUTE', 'LISTING'], ['media_locator']) === 'imagenes')
}

console.log('\n=== la misma incidencia dos veces es una ===')
{
  const r = normalizarIncidencias([
    { ...gtinOculta, severity: 'WARNING', enforcements: undefined },
    { ...gtinOculta, message: 'Otro texto, mismo problema.' },
  ])
  ok('una sola', r.length === 1, String(r.length))
  ok('se queda la más grave', r[0].gravedad === 'error')
  ok('con las acciones de las dos', r[0].acciones.join() === 'SEARCH_SUPPRESSED')
  ok('el mismo código con otro atributo es otra', normalizarIncidencias([
    { code: '9', message: 'a', attributeNames: ['x'] },
    { code: '9', message: 'a', attributeNames: ['y'] },
  ]).length === 2)
  ok('el singular antiguo se acepta', normalizarIncidencias([{ code: '9', message: 'a', attributeName: 'color' }])[0].atributos.join() === 'color')
  ok('la huella no depende del orden de los atributos', huella({ codigo: '1', mensaje: 'a', atributos: ['b', 'a'] }) === huella({ codigo: '1', mensaje: 'a', atributos: ['a', 'b'] }))
  ok('sin código, la huella sale del mensaje', huella({ codigo: '', mensaje: 'Hola Mundo', atributos: [] }) === 'hola mundo|')
}

console.log('\n=== desde cuándo ===')
{
  const hoy = '2026-10-15T10:00:00.000Z'
  const nuevas = normalizarIncidencias([faltaFabricante, gtinOculta])
  const previas: Incidencia[] = [
    { ...normalizarIncidencias([gtinOculta])[0], desde: '2026-09-01T08:00:00.000Z' },
    { ...normalizarIncidencias([avisoImagen])[0], desde: '2026-08-01T00:00:00.000Z' },
  ]
  const r = conservarDesde(nuevas, previas, hoy)
  ok('la que ya estaba conserva su fecha', r.find((i) => i.codigo === '8541')?.desde === '2026-09-01T08:00:00.000Z')
  ok('la nueva lleva la de hoy', r.find((i) => i.codigo === '90220')?.desde === hoy)
  ok('la que se arregló desaparece', !r.some((i) => i.codigo === '5461'))
  ok('sin previas, todas son de hoy', conservarDesde(nuevas, [], hoy).every((i) => i.desde === hoy))
  ok('problemaMasAntiguo', problemaMasAntiguo(r) === '2026-09-01T08:00:00.000Z')
  ok('problemaMasAntiguo de nada', problemaMasAntiguo([]) === null)
  ok('las info no cuentan como problema', problemaMasAntiguo([
    { ...normalizarIncidencias([{ code: 'i', message: 'x', severity: 'INFO' }])[0], desde: '2020-01-01T00:00:00.000Z' },
  ]) === null)
}

console.log('\n=== el resumen de un listing ===')
{
  const limpio = resumir([], AHORA)
  ok('limpio: nada', limpio.errores === 0 && limpio.avisos === 0 && !limpio.suprimido && limpio.tema === null && limpio.temas.length === 0)
  ok('limpio: no necesita atención', !necesitaAtencion(limpio))

  const r = resumir(normalizarIncidencias([avisoImagen, faltaFabricante, gtinOculta]), AHORA)
  ok('cuenta errores', r.errores === 2, String(r.errores))
  ok('cuenta avisos', r.avisos === 1, String(r.avisos))
  ok('suprimido', r.suprimido)
  ok('el tema lo pone la que oculta', r.tema === 'identificadores', String(r.tema))
  ok('todos los temas, de más a menos grave', r.temas.join() === 'identificadores,datos,imagenes', r.temas.join())
  ok('necesita atención', necesitaAtencion(r))

  const soloAvisos = resumir(normalizarIncidencias([avisoImagen]), AHORA)
  ok('solo avisos: NO necesita atención', !necesitaAtencion(soloAvisos))
  ok('pero se cuentan', soloAvisos.avisos === 1 && soloAvisos.tema === 'imagenes')

  const infos = resumir(normalizarIncidencias([{ code: 'i', message: 'Sugerencia', severity: 'INFO' }]), AHORA)
  ok('una sugerencia no es ni error ni aviso', infos.errores === 0 && infos.avisos === 0 && infos.tema === null)

  const gracia = resumir(normalizarIncidencias([gpsr({ status: 'EXEMPT_UNTIL_EXPIRY_DATE', expiryDate: '2026-12-01T00:00:00Z' })]), AHORA)
  ok('con plazo de gracia sigue contando como error', gracia.errores === 1)
  ok('pero no como suprimido', !gracia.suprimido)
  ok('y por el error necesita atención', necesitaAtencion(gracia))
  ok('su tema es normativa', gracia.tema === 'normativa')

  const soloOculta = resumir(normalizarIncidencias([
    { code: '1', message: 'x', severity: 'WARNING', enforcements: { actions: [{ action: 'SEARCH_SUPPRESSED' }] } },
  ]), AHORA)
  ok('un aviso que oculta sí es suprimido y necesita atención', soloOculta.suprimido && necesitaAtencion(soloOculta))
}

console.log('\n=== el orden ===')
{
  const o = ordenarIncidencias(normalizarIncidencias([avisoImagen, faltaFabricante, gtinOculta]), AHORA)
  ok('primero la que oculta, luego el error, luego el aviso', o.map((i) => i.codigo).join() === '8541,90220,5461', o.map((i) => i.codigo).join())
  ok('no muta la lista de entrada', (() => {
    const e = normalizarIncidencias([avisoImagen, faltaFabricante])
    ordenarIncidencias(e, AHORA)
    return e[0].codigo === '5461'
  })())
}

console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
