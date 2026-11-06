import {
  agruparFilas,
  avisosDeFila,
  candidatasDeCobro,
  claveDeContacto,
  correosValidos,
  diasDesde,
  emparejarContacto,
  estadoParaElReflejo,
  etiquetaDeNumero,
  huecosDeEnlace,
  lineasDelMes,
  numeroPropuesto,
  periodoDeFactura,
  plantillaPropuesta,
  proponerEnlaces,
  rellenarEnlaces,
  rotuloDeHueco,
  sumarDias,
} from '@/lib/facturacion/logica'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d: unknown = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien ? '' : ` -> ${JSON.stringify(d)}`}`)
}
const igual = (n: string, a: unknown, b: unknown) => ok(n, JSON.stringify(a) === JSON.stringify(b), a)

console.log('Mes de una factura (con los números reales de Zoho)')
igual('el mes del número manda sobre la fecha', periodoDeFactura('Yo By Yolanda | Septiembre 2026', '2026-10-06'), '2026-09-01')
igual('mes delante', periodoDeFactura('Noviembre 2026 | Creative Toys', '2026-11-05'), '2026-11-01')
igual('en mayúsculas', periodoDeFactura('EVOCOMPUTER | OCTUBRE 2026', '2026-10-09'), '2026-10-01')
igual('sin mes: la fecha', periodoDeFactura('LS-2026-001', '2026-09-05'), '2026-09-01')

console.log('Etiqueta y número')
igual('quita el mes', etiquetaDeNumero('Lenobotics | Octubre 2026'), 'Lenobotics')
igual('mes delante', etiquetaDeNumero('Octubre 2026 | ShoesF'), 'ShoesF')
igual('solo el mes', etiquetaDeNumero('Octubre 2026'), '')
igual('número propuesto', numeroPropuesto('Creative Toys', '2026-11-01'), 'Creative Toys | Noviembre 2026')

console.log('Pareja por nombre')
const contactos = [
  { contact_name: 'EVO COMPUTER SL', company_name: 'EVO COMPUTER SL' },
  { contact_name: 'Creative Toys', company_name: 'CREATIVE TOYS ESPAÑA JUGUETES S.L.U.' },
  { contact_name: 'Naelpaa LLC' },
  { contact_name: 'Doble S.L.' },
  { contact_name: 'Doble' },
]
igual('Evocomputer = EVO COMPUTER SL', emparejarContacto('Evocomputer', contactos)?.contact_name, 'EVO COMPUTER SL')
igual('tal cual', emparejarContacto('Creative Toys', contactos)?.contact_name, 'Creative Toys')
igual('sin forma legal', emparejarContacto('Naelpaa', contactos)?.contact_name, 'Naelpaa LLC')
igual('dos candidatos: ninguno', emparejarContacto('Doble', contactos), null)
igual('nada que se parezca', emparejarContacto('Pablo (seguridad social)', contactos), null)
igual('sin nombre', emparejarContacto('', contactos), null)
igual('la s de una palabra no se come', claveDeContacto('Shoplamp'), 'shoplamp')

console.log('Líneas')
igual('las dos', lineasDelMes(700, 235.9).map((l) => l.descripcion), ['Fee Mensual de Gestión', 'Comisiones Amazon'])
igual('comisión a 0 no se factura', lineasDelMes(550, 0).length, 1)
igual('nada', lineasDelMes(null, null), [])

console.log('Fechas y estados')
igual('vencimiento a 7 días, cruzando mes', sumarDias('2026-11-28', 7), '2026-12-05')
igual('reflejo: desconocido cuenta como enviada', estadoParaElReflejo('viewed'), 'sent')
igual('reflejo: anulada', estadoParaElReflejo('void'), 'cancelled')

console.log('Huecos de enlace (plantillas reales)')
const cuerpo = '<a href="ENLACE_TAPAS_PARTY">T</a><a href="ENLACE_POKER_SHOP">P</a><a href="ENLACE_TAPAS_PARTY">T</a>'
igual('sin repetir', huecosDeEnlace(cuerpo), ['ENLACE_TAPAS_PARTY', 'ENLACE_POKER_SHOP'])
igual('rótulo genérico', rotuloDeHueco('ENLACE_ERP'), 'Enlace de comisiones')
igual('rótulo con nombre', rotuloDeHueco('ENLACE_POKER_SHOP'), 'Enlace de Poker Shop')
const relleno = rellenarEnlaces(cuerpo, { ENLACE_TAPAS_PARTY: 'https://a.es/x?a=1&b=2', ENLACE_POKER_SHOP: '' })
ok('rellena el que tiene y escapa', relleno.includes('href="https://a.es/x?a=1&amp;b=2"'), relleno)
igual('el vacío sigue siendo un hueco y bloquea', huecosDeEnlace(relleno), ['ENLACE_POKER_SHOP'])
ok('una comilla no rompe el atributo', !rellenarEnlaces('<a href="ENLACE_ERP">', { ENLACE_ERP: 'x"><b' }).includes('"><b'))

console.log('Propuesta de enlaces')
const uno = [{ nombre: 'Creative Toys', url: 'u1' }]
const dos = [{ nombre: 'Tapas Party', url: 'tp' }, { nombre: 'Pokershop', url: 'ps' }]
igual('un informe: va al genérico', proponerEnlaces(['ENLACE_ERP'], uno), { ENLACE_ERP: 'u1' })
igual('varios: el genérico se deja vacío', proponerEnlaces(['ENLACE_ERP'], dos), { ENLACE_ERP: '' })
igual('por nombre, sin mirar espacios', proponerEnlaces(['ENLACE_POKER_SHOP', 'ENLACE_TAPAS_PARTY'], dos), {
  ENLACE_POKER_SHOP: 'ps',
  ENLACE_TAPAS_PARTY: 'tp',
})
igual('sin informe de esa tienda: vacío', proponerEnlaces(['ENLACE_POKER_SHOP'], uno), { ENLACE_POKER_SHOP: '' })

console.log('Plantilla propuesta (las cuatro reales)')
const plantillas = [
  { id: 'p', nombre: 'Predeterminado' },
  { id: 'n', nombre: 'Facturación de Servicios' },
  { id: 's', nombre: 'Facturación de Servicios Sin Comisiones' },
  { id: 't', nombre: 'Facturación de Servicios Tapas Party' },
]
const prop = (cliente: string, tieneComision: boolean, ultimaUsadaId?: string) =>
  plantillaPropuesta(plantillas, { cliente, tieneComision, ultimaUsadaId })?.id
igual('con comisión: la normal', prop('Creative Toys', true), 'n')
igual('sin comisión: Sin Comisiones', prop('Yo By Yolanda', false), 's')
igual('el cliente de su plantilla', prop('GFY Logis tic S.L (Jamones Tapas Party + Pokershop)', true), 't')
igual('la última usada manda', prop('Creative Toys', true, 's'), 's')
igual('una última que ya no existe se ignora', prop('Creative Toys', true, 'x'), 'n')
igual('sin plantillas', plantillaPropuesta([], { cliente: 'x', tieneComision: true }), null)

console.log('Correos')
igual('limpia y quita duplicados', correosValidos([' a@b.es', 'a@b.es', '']), ['a@b.es'])
igual('uno malo invalida la lista', correosValidos(['a@b.es', 'nada']), null)
igual('no es una lista', correosValidos('a@b.es'), null)

console.log('Avisos')
const base = {
  totalTesoreria: 750, cobradoEnTesoreria: false, estadoZoho: 'sent', totalZoho: 750, moneda: 'EUR',
  comision: null, hayInformes: false, contactoTieneCorreo: true, hayContacto: true,
}
igual('todo cuadra', avisosDeFila(base), [])
igual('EVO: importes distintos', avisosDeFila({ ...base, totalZoho: 1200 }), ['Tesorería dice 750.00, Zoho 1200.00'])
igual('cobrada solo en Tesorería', avisosDeFila({ ...base, cobradoEnTesoreria: true, estadoZoho: 'overdue' }), ['Cobrada en Tesorería, sin cobro en Zoho'])
igual('cobrada en los dos: sin aviso', avisosDeFila({ ...base, cobradoEnTesoreria: true, estadoZoho: 'paid' }), [])
igual('comisión sin informe', avisosDeFila({ ...base, comision: 10, estadoZoho: 'draft' }), ['Sin informe de comisión'])
igual('ya enviada: el informe ya no se avisa', avisosDeFila({ ...base, comision: 10 }), [])

console.log('Qué factura paga un ingreso')
const pendientes = [
  { saldo: 719.7, cliente: 'Otro', moneda: 'EUR' },
  { saldo: 300, cliente: 'Zapaterias Basoco S.L', moneda: 'EUR' },
  { saldo: 300, cliente: 'Yo By Yolanda', moneda: 'EUR' },
  { saldo: 300, cliente: 'Dolares', moneda: 'USD' },
]
const orden = candidatasDeCobro({ importe: 300, moneda: 'EUR', concepto: 'From ZAPATERIAS BASOCO, SOCIEDAD LIMITAD' }, pendientes)
igual('importe + nombre primero', orden[0].cliente, 'Zapaterias Basoco S.L')
igual('otra moneda fuera', orden.some((f) => f.moneda === 'USD'), false)
igual('el resto sigue disponible', orden.length, 3)

const filaDe = (nombre: string, estado: Parameters<typeof agruparFilas>[0][number]['estado'], avisos: string[] = [], contactoId: string | null = 'c') => ({ nombre, estado, avisos, contactoId })
const grupos = agruparFilas([
  filaDe('Con aviso', 'por_crear', ['Sin informe de comisión']),
  filaDe('Sin enlazar', 'por_crear', [], null),
  filaDe('Lista', 'por_crear'),
  filaDe('Enviada', 'enviada'),
  filaDe('Parcial', 'parcial'),
  filaDe('Vencida', 'vencida'),
  filaDe('Nada', 'sin_importes'),
])
igual('lo vencido primero y sin grupos vacíos', grupos.map((g) => g.grupo.id).join(), 'vencida,por_crear,por_cobrar,sin_importes')
igual('lo que se puede hacer ya, arriba', grupos[1].filas.map((f) => f.nombre).join(), 'Lista,Con aviso,Sin enlazar')
igual('enviada y parcial van juntas', grupos[2].filas.length, 2)
igual('solo se pliega lo que no pide nada', grupos.filter((g) => g.grupo.plegado).map((g) => g.grupo.id).join(), 'sin_importes')
igual('días desde una fecha', diasDesde('2026-11-01', '2026-11-06'), 5)
igual('días de una fecha que no ha llegado', diasDesde('2026-11-13', '2026-11-06'), -7)

console.log(`\n${comprobaciones - fallos}/${comprobaciones} bien`)
if (fallos > 0) process.exit(1)
