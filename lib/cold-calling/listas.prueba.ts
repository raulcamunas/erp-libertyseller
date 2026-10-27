import {
  ETIQUETA_DE_TRAMO,
  FILTRO_DE_BANCO_VACIO,
  FILTRO_DE_LEADS_VACIO,
  NOMBRE_SIN_LISTA,
  SIN_DUENO,
  SIN_LISTA,
  armarPanorama,
  claveDeLista,
  filtroDeBancoParaLaBase,
  filtroParaLaBase,
  hayFiltroDeBanco,
  hayFiltroDeLeads,
  leerFiltroDeBanco,
  leerFiltroDeLeads,
  limpiarNombreDeLista,
  nombreCortoDePersona,
  nombreDeListaSugerido,
  ordenarListas,
  porcentajeTexto,
  situacionDeLista,
  type FilaDeResumen,
  type ListaRegistrada,
} from './listas'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

const JOSE = '00000000-0000-4000-8000-000000000004'
const DANI = '00000000-0000-4000-8000-000000000005'
const ALEJ = '00000000-0000-4000-8000-000000000003'

const fila = (e: Partial<FilaDeResumen> & { lista: string | null }): FilaDeResumen => ({
  dueno: null,
  tipo_lead: 'seller_amazon',
  total: 0,
  pendiente: 0,
  no_contesta: 0,
  programado: 0,
  email_enviado: 0,
  seguimiento: 0,
  cita_cualificada: 0,
  no_interesa: 0,
  vende: 0,
  no_vende: 0,
  sin_comprobar: 0,
  llamados: 0,
  intentos: 0,
  ultimo_contacto: null,
  ...e,
})

const registrada = (nombre: string, e: Partial<ListaRegistrada> = {}): ListaRegistrada => ({ id: `id-${nombre}`, nombre, descripcion: null, responsable: null, archivada: false, ...e })

console.log('\n=== los nombres de lista ===')
{
  ok('la clave no mira mayúsculas ni espacios de los lados', claveDeLista('  Maoli V1 ') === 'maoli v1' && claveDeLista('MAOLI V1') === claveDeLista('maoli v1'))
  ok('sin nombre, clave vacía', claveDeLista(null) === '' && claveDeLista(undefined) === '' && claveDeLista('   ') === '')
  ok('«José» y «Jose» NO son la misma lista (es lo que pasaba en silencio y se vigila a mano)', claveDeLista('José V2') !== claveDeLista('Jose V2'))
  ok('el nombre se limpia: sin espacios de los lados y con los dobles reducidos', limpiarNombreDeLista('  María   Fernanda  V1 ') === 'María Fernanda V1')
  ok('vacío o que no es texto: null', limpiarNombreDeLista('   ') === null && limpiarNombreDeLista(null) === null && limpiarNombreDeLista(42) === null && limpiarNombreDeLista({}) === null)
}

console.log('\n=== juntar lo que dice la base en una lista por nombre ===')
{
  const filas: FilaDeResumen[] = [
    fila({ lista: 'José V2', dueno: JOSE, total: 10, pendiente: 6, no_contesta: 2, seguimiento: 1, cita_cualificada: 1, sin_comprobar: 10, llamados: 4, intentos: 7, ultimo_contacto: '2026-10-20T10:00:00.000Z' }),
    fila({ lista: 'No Amazon V1', dueno: JOSE, tipo_lead: 'tienda_online', total: 5, pendiente: 5, sin_comprobar: 5 }),
    fila({ lista: 'No Amazon V1', dueno: DANI, tipo_lead: 'tienda_online', total: 4, pendiente: 2, no_interesa: 1, no_contesta: 1, vende: 1, no_vende: 1, sin_comprobar: 2, llamados: 2, intentos: 3, ultimo_contacto: '2026-10-25T08:00:00.000Z' }),
    fila({ lista: 'no amazon v1 ', dueno: null, tipo_lead: 'tienda_online', total: 1, pendiente: 1, sin_comprobar: 1 }),
    fila({ lista: null, dueno: null, total: 3, pendiente: 3, sin_comprobar: 3 }),
    fila({ lista: '   ', dueno: ALEJ, total: 2, pendiente: 2, sin_comprobar: 2 }),
  ]
  const registro: ListaRegistrada[] = [registrada('José V2', { responsable: JOSE }), registrada('No Amazon V1'), registrada('Lista vacía', { descripcion: 'Para el nuevo' }), registrada('Vieja', { archivada: true })]
  const p = armarPanorama(filas, registro)

  ok('las listas con nombre salen una vez cada una, aunque se escriban distinto', p.listas.map((l) => l.nombre).sort().join('|') === 'José V2|Lista vacía|No Amazon V1|Vieja')
  const noAmazon = p.listas.find((l) => l.nombre === 'No Amazon V1')!
  ok('sumando los tres dueños de «No Amazon V1» (y la escrita en minúsculas)', noAmazon.total === 10 && noAmazon.estados.pendiente === 8 && noAmazon.estados.no_interesa === 1 && noAmazon.estados.no_contesta === 1)
  ok('con su nombre del registro, no el de la fila', noAmazon.nombre === 'No Amazon V1' && noAmazon.registrada && noAmazon.id === 'id-No Amazon V1')
  ok('los dueños, de más a menos, y los que no tienen dueño aparte', JSON.stringify(noAmazon.duenos) === JSON.stringify([{ id: JOSE, n: 5 }, { id: DANI, n: 4 }, { id: null, n: 1 }]), JSON.stringify(noAmazon.duenos))
  ok('es una lista de tiendas online', noAmazon.tipo === 'tienda_online' && noAmazon.porTipo.tienda_online === 10 && noAmazon.porTipo.seller_amazon === 0)
  ok('lo comprobado de «vende en Amazon»', noAmazon.vende.vende === 1 && noAmazon.vende.no_vende === 1 && noAmazon.vende.sin_comprobar === 8)
  ok('lo usada que está: trabajados = los que no están «Sin contactar»', noAmazon.trabajados === 2 && Math.abs(noAmazon.pctTrabajados - 0.2) < 1e-9 && Math.abs(noAmazon.pctLlamados - 0.2) < 1e-9)
  ok('la última actividad es la más reciente de las filas', noAmazon.ultimoContacto === Date.parse('2026-10-25T08:00:00.000Z'))
  const jose = p.listas.find((l) => l.nombre === 'José V2')!
  ok('«José V2»: responsable del registro, vendedores de Amazon, 10 leads, 4 trabajados', jose.responsable === JOSE && jose.tipo === 'seller_amazon' && jose.total === 10 && jose.trabajados === 4 && jose.intentos === 7)
  const vacia = p.listas.find((l) => l.nombre === 'Lista vacía')!
  ok('una lista registrada sin leads sale, vacía y sin tipo', vacia.total === 0 && vacia.tipo === null && vacia.pctTrabajados === 0 && vacia.descripcion === 'Para el nuevo' && vacia.duenos.length === 0)
  ok('una archivada se marca', p.listas.find((l) => l.nombre === 'Vieja')!.archivada)
  ok('los leads sin lista (nulo o en blanco) van juntos en «Sin lista»', p.sinLista !== null && p.sinLista.nombre === NOMBRE_SIN_LISTA && p.sinLista.clave === SIN_LISTA && p.sinLista.total === 5 && !p.sinLista.registrada)
  ok('y de quién son', JSON.stringify(p.sinLista!.duenos) === JSON.stringify([{ id: null, n: 3 }, { id: ALEJ, n: 2 }]))
  ok('los totales: 25 leads, 4 listas (3 activas), 4 sin dueño', p.totales.leads === 25 && p.totales.listas === 3 && p.totales.sinDueno === 4, JSON.stringify(p.totales))
  ok('los que venden en Amazon (vendedores) y los que no (tiendas online)', p.totales.venden === 15 && p.totales.noVenden === 10)
  ok('lo comprobado: 1 vende, 1 no vende, el resto sin comprobar', p.totales.vendeComprobado === 1 && p.totales.noVendeComprobado === 1 && p.totales.sinComprobar === 23)

  const mixta = armarPanorama([fila({ lista: 'Mezcla', total: 2, pendiente: 2 }), fila({ lista: 'Mezcla', tipo_lead: 'tienda_online', total: 3, pendiente: 3 })], [])
  ok('una lista con de los dos tipos es «mixta»', mixta.listas[0].tipo === 'mixto')
  ok('sin registro, las listas que tienen leads salen igual (no registradas)', mixta.listas[0].registrada === false && mixta.listas[0].id === null)
  const nada = armarPanorama([], [])
  ok('sin nada, todo en cero y sin «Sin lista»', nada.listas.length === 0 && nada.sinLista === null && nada.totales.leads === 0 && nada.totales.pctTrabajados === 0)
  const dos = armarPanorama([], [registrada('Ana V1'), registrada('ana v1')])
  ok('dos nombres iguales en el registro se juntan en uno', dos.listas.length === 1)
}

console.log('\n=== ordenar las listas ===')
{
  const p = armarPanorama(
    [
      fila({ lista: 'B', total: 10, pendiente: 5, ultimo_contacto: '2026-10-10T00:00:00.000Z' }),
      fila({ lista: 'A', total: 20, pendiente: 20, ultimo_contacto: '2026-10-25T00:00:00.000Z' }),
      fila({ lista: 'C', total: 5, pendiente: 0, ultimo_contacto: '2026-10-01T00:00:00.000Z' }),
      fila({ lista: 'Z archivada', total: 99, pendiente: 99 }),
    ],
    [registrada('Z archivada', { archivada: true })]
  )
  const ordenOriginal = p.listas.map((l) => l.nombre).join(',')
  const nombres = (c: Parameters<typeof ordenarListas>[1]) => ordenarListas(p.listas, c).map((l) => l.nombre).join(',')
  ok('por leads: las que más tienen primero, y la archivada, la última aunque sea la mayor', nombres('leads') === 'A,B,C,Z archivada', nombres('leads'))
  ok('por nombre', nombres('nombre') === 'A,B,C,Z archivada')
  ok('por uso: las más trabajadas primero', nombres('uso') === 'C,B,A,Z archivada', nombres('uso'))
  ok('por última actividad', nombres('reciente') === 'A,B,C,Z archivada', nombres('reciente'))
  ok('ordenar no cambia la lista original (devuelve una copia)', p.listas.map((l) => l.nombre).join(',') === ordenOriginal)
}

console.log('\n=== los filtros de los leads vienen del navegador: se sanean ===')
{
  const v = leerFiltroDeLeads(null)
  ok('sin nada, el filtro vacío', JSON.stringify(v) === JSON.stringify(FILTRO_DE_LEADS_VACIO))
  const bueno = leerFiltroDeLeads({ lista: ' José V2 ', dueno: JOSE.toUpperCase(), estado: 'seguimiento', vende: 'no_vende', tipo: 'tienda_online', nivel: '2', empresa: 'sin_tipo', q: ' casa ', orden: 'nombre' })
  ok('un filtro bueno se conserva (la lista sin espacios de los lados, el id en minúsculas)', bueno.lista === 'José V2' && bueno.dueno === JOSE && bueno.estado === 'seguimiento' && bueno.vende === 'no_vende' && bueno.tipo === 'tienda_online' && bueno.nivel === 2 && bueno.empresa === 'sin_tipo' && bueno.q === 'casa' && bueno.orden === 'nombre')
  const malo = leerFiltroDeLeads({ lista: 'x'.repeat(200), dueno: "'; drop table cold_leads; --", estado: 'inventado', vende: 'quizá', tipo: 'otro', nivel: 9, empresa: 'rara', q: 'y'.repeat(500), orden: 'al azar' })
  ok('lo que no vale queda como «sin filtro», sin lanzar', malo.lista === null && malo.dueno === null && malo.estado === null && malo.vende === null && malo.tipo === null && malo.nivel === null && malo.empresa === null && malo.orden === 'prioridad')
  ok('la búsqueda se corta a 100 caracteres', malo.q.length === 100)
  ok('los valores especiales valen', leerFiltroDeLeads({ lista: SIN_LISTA, dueno: SIN_DUENO }).lista === SIN_LISTA && leerFiltroDeLeads({ lista: SIN_LISTA, dueno: SIN_DUENO }).dueno === SIN_DUENO)
  ok('tipos que no son objeto: vacío', JSON.stringify(leerFiltroDeLeads('hola')) === JSON.stringify(FILTRO_DE_LEADS_VACIO) && JSON.stringify(leerFiltroDeLeads([1, 2])) === JSON.stringify(FILTRO_DE_LEADS_VACIO))
  ok('hay filtro o no', !hayFiltroDeLeads(FILTRO_DE_LEADS_VACIO) && hayFiltroDeLeads({ ...FILTRO_DE_LEADS_VACIO, q: 'a' }) && hayFiltroDeLeads({ ...FILTRO_DE_LEADS_VACIO, dueno: SIN_DUENO }) && !hayFiltroDeLeads({ ...FILTRO_DE_LEADS_VACIO, orden: 'nombre' }))
  const base = filtroParaLaBase({ ...FILTRO_DE_LEADS_VACIO, lista: 'José V2', estado: 'pendiente', q: 'x' })
  ok('a la base solo va lo que filtra, más el orden', JSON.stringify(base) === JSON.stringify({ orden: 'prioridad', lista: 'José V2', estado: 'pendiente', q: 'x' }), JSON.stringify(base))
  ok('un filtro vacío manda solo el orden', JSON.stringify(filtroParaLaBase(FILTRO_DE_LEADS_VACIO)) === JSON.stringify({ orden: 'prioridad' }))
}

console.log('\n=== los filtros del banco ===')
{
  ok('sin nada, vacío', JSON.stringify(leerFiltroDeBanco(undefined)) === JSON.stringify(FILTRO_DE_BANCO_VACIO))
  const b = leerFiltroDeBanco({ nivel: 1, tramo: 'a', empresa: 'sociedad', categoria: ' Moda y complementos ', plataforma: 'Shopify', ciudad: ' Madrid ', conTelefono: true, conEmail: 'sí', conDecisor: true, ventasMin: '50000', q: ' tienda ', incluirRepartidas: true })
  ok('uno bueno se conserva (el tramo en mayúscula, lo de «sí» como texto NO cuenta como verdadero)', b.nivel === 1 && b.tramo === 'A' && b.empresa === 'sociedad' && b.categoria === 'Moda y complementos' && b.plataforma === 'Shopify' && b.ciudad === 'Madrid' && b.conTelefono && !b.conEmail && b.conDecisor && b.ventasMin === 50000 && b.q === 'tienda' && b.incluirRepartidas)
  const m = leerFiltroDeBanco({ nivel: 4, tramo: 'Z', empresa: 'x', ventasMin: -5, categoria: 3 })
  ok('lo raro, a «sin filtro»', m.nivel === null && m.tramo === null && m.empresa === null && m.ventasMin === null && m.categoria === null)
  ok('«ab» (las dos de llamar juntas) vale como tramo', leerFiltroDeBanco({ tramo: 'ab' }).tramo === 'AB' && filtroDeBancoParaLaBase({ ...FILTRO_DE_BANCO_VACIO, tramo: 'AB' }).tramo === 'AB')
  ok('y cada tramo tiene su etiqueta', (['AB', 'A', 'B', 'C', 'D', 'G'] as const).every((t) => (ETIQUETA_DE_TRAMO[t] ?? '').length > 0))
  ok('ventas mínimas a cero valen', leerFiltroDeBanco({ ventasMin: 0 }).ventasMin === 0)
  const base = filtroDeBancoParaLaBase({ ...FILTRO_DE_BANCO_VACIO, tramo: 'B', conTelefono: true, ventasMin: 0, q: 'x' })
  ok('a la base solo va lo que filtra, con los nombres de la base', JSON.stringify(base) === JSON.stringify({ tramo: 'B', con_telefono: true, ventas_min: 0, q: 'x' }), JSON.stringify(base))
  ok('hay filtro o no (incluir las repartidas no cuenta como filtro)', !hayFiltroDeBanco(FILTRO_DE_BANCO_VACIO) && !hayFiltroDeBanco({ ...FILTRO_DE_BANCO_VACIO, incluirRepartidas: true }) && hayFiltroDeBanco({ ...FILTRO_DE_BANCO_VACIO, conEmail: true }))
}

console.log('\n=== el nombre de la lista de una persona nueva ===')
{
  ok('con nombre de pila y apellido: los dos (no se sabe cuál es cuál)', nombreCortoDePersona('Ana López') === 'Ana López')
  ok('«María Fernanda» se queda entera', nombreCortoDePersona('Maria Fernanda') === 'Maria Fernanda')
  ok('con tres palabras o más, la primera', nombreCortoDePersona('Laura Gómez Ruiz') === 'Laura')
  ok('sin nombre, lo que va antes de la @', nombreCortoDePersona(null, 'carla.salido@libertyseller.es') === 'Carla salido' && nombreCortoDePersona('', 'pepe@x.es') === 'Pepe')
  ok('sin nada, un nombre por defecto', nombreCortoDePersona(null, null) === 'Lista nueva')
  ok('la primera lista de alguien es la V1', nombreDeListaSugerido('Ana', []) === 'Ana V1')
  ok('si ya existe, la V2, y así', nombreDeListaSugerido('Ana', ['Ana V1']) === 'Ana V2' && nombreDeListaSugerido('Ana', ['Ana V1', 'ana v2', 'Ana V3']) === 'Ana V4')
  ok('no mira mayúsculas', nombreDeListaSugerido('Ana', ['ANA V1']) === 'Ana V2')
  ok('una V3 suelta no tapa la V1 libre', nombreDeListaSugerido('Ana', ['Ana V3']) === 'Ana V1')
}

console.log('\n=== lo usada que está una lista, en una palabra ===')
{
  ok('vacía, sin tocar, empezada, en marcha, casi agotada', situacionDeLista({ total: 0, pctTrabajados: 0 }) === 'vacia' && situacionDeLista({ total: 10, pctTrabajados: 0 }) === 'sin_tocar' && situacionDeLista({ total: 10, pctTrabajados: 0.1 }) === 'empezada' && situacionDeLista({ total: 10, pctTrabajados: 0.5 }) === 'en_marcha' && situacionDeLista({ total: 10, pctTrabajados: 0.9 }) === 'casi_agotada')
  ok('los porcentajes, en español y con decimal solo cuando es poco', porcentajeTexto(0.2) === '20 %' && porcentajeTexto(0.034) === '3,4 %' && porcentajeTexto(0) === '0 %' && porcentajeTexto(1) === '100 %')
}

console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
