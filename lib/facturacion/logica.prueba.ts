import {
  agruparFilas,
  diasLaborablesDeRetraso,
  tocaRecordar,
  textoAntesDeVencer,
  esPlantillaDeRecordatorio,
  PLANTILLA_RECORDATORIO,
  DIAS_LABORABLES_PARA_RECORDAR,
  importeDeInformes,
  asuntoDeFactura,
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
  quitarMarcadoresSinRellenar,
  rellenarEnlaces,
  repartoDelMes,
  rotuloDeHueco,
  sumarDias,
  tramoDeVencimiento,
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
const ZOHO = 'Facturación de Servicios | 05 nov 2026 | CREATIVE TOYS ESPAÑA S.L.U.'
igual('asunto con el mes delante', asuntoDeFactura(ZOHO, 'Noviembre 2026 | Creative Toys', '2026-11-05'), 'Facturación de Servicios | Noviembre 2026 | Creative Toys')
igual('asunto con el mes detrás', asuntoDeFactura(ZOHO, 'ShoesF | Noviembre 2026', '2026-11-06'), 'Facturación de Servicios | Noviembre 2026 | ShoesF')
igual('el mes del número, no el de la emisión', asuntoDeFactura(ZOHO, 'Yo By Yolanda | Septiembre 2026', '2026-10-06'), 'Facturación de Servicios | Septiembre 2026 | Yo By Yolanda')
igual('número sin cliente', asuntoDeFactura(ZOHO, 'Octubre 2026', '2026-10-06'), 'Facturación de Servicios | Octubre 2026')
igual('otra plantilla se respeta', asuntoDeFactura('Factura - X de Liberty', 'Noviembre 2026 | X', '2026-11-05'), 'Factura - X de Liberty')
igual('sin nota no queda %Notes% ni su salto', quitarMarcadoresSinRellenar('como referencia.<br>%Notes%</td>'), 'como referencia.</td>')
igual('cualquier otro marcador sin rellenar', quitarMarcadoresSinRellenar('a %DueDate% b'), 'a  b')
igual('no toca un enlace codificado', quitarMarcadoresSinRellenar('x?a=%C3%ABC%20y%AB%CD'), 'x?a=%C3%ABC%20y%AB%CD')
igual('no toca un porcentaje', quitarMarcadoresSinRellenar('al 7,5 % y al 10 %'), 'al 7,5 % y al 10 %')
const tapas = { nombre: 'Tapas Party', url: 'a', importe: 217.5850000000001, cuenta: true }
const poker = { nombre: 'Poker Shop', url: 'b', importe: 43.90899999999999, cuenta: true }
igual('una línea por cuenta', JSON.stringify(lineasDelMes(null, 261.5, [tapas, poker])), JSON.stringify([{ descripcion: 'Comisiones Tapas Party', importe: 217.59 }, { descripcion: 'Comisiones Poker Shop', importe: 43.91 }]))
igual('el céntimo del redondeo va en la última', lineasDelMes(null, 261.49, [tapas, poker]).reduce((s, l) => s + l.importe, 0).toFixed(2), '261.49')
igual('con fee, el fee primero', lineasDelMes(100, 261.5, [tapas, poker]).map((l) => l.descripcion).join(), 'Fee Mensual de Gestión,Comisiones Tapas Party,Comisiones Poker Shop')
igual('si no cuadran, no se reparte', lineasDelMes(null, 300, [tapas, poker]).map((l) => l.descripcion).join(), 'Comisiones Amazon')
igual('una cuenta a cero no lleva línea', lineasDelMes(null, 217.59, [tapas, { ...poker, importe: 0 }]).map((l) => l.descripcion).join(), 'Comisiones Tapas Party')
igual('un cliente normal sigue igual', lineasDelMes(700, 235.9, [{ nombre: 'Creative Toys', url: 'c', importe: 235.89675 }]).map((l) => l.descripcion).join(), 'Fee Mensual de Gestión,Comisiones Amazon')
igual('los informes suman', importeDeInformes([tapas, poker]), 261.49)
igual('si uno no lo dice, no se compara', importeDeInformes([tapas, { nombre: 'K', url: 'k', importe: null }]), null)
const avisosDe = (extra: Partial<Parameters<typeof avisosDeFila>[0]>) => avisosDeFila({ totalTesoreria: 935.9, cobradoEnTesoreria: false, estadoZoho: 'draft', totalZoho: 935.9, moneda: 'EUR', comision: 235.9, hayInformes: true, contactoTieneCorreo: true, hayContacto: true, ...extra })
igual('avisa si el informe y Tesorería no coinciden', avisosDe({ importeInformes: 353.58 }).join(), 'El informe dice 353.58, Tesorería 235.90')
igual('los céntimos del redondeo no avisan', avisosDe({ importeInformes: 235.9 }).length + avisosDe({ importeInformes: 235.87 }).length, 0)
igual('ya enviada no avisa', avisosDe({ importeInformes: 353.58, estadoZoho: 'sent' }).length, 0)
igual('dice qué cuenta no tiene informe', avisosDe({ cuentasSinInforme: ['Poker Shop'] }).join(), 'Sin informe de comisión: Poker Shop')
igual('días desde una fecha', diasDesde('2026-11-01', '2026-11-06'), 5)
igual('días de una fecha que no ha llegado', diasDesde('2026-11-13', '2026-11-06'), -7)

const reparto = repartoDelMes([
  { estado: 'por_crear', totalTesoreria: 500, factura: null },
  { estado: 'sin_importes', totalTesoreria: 0, factura: null },
  { estado: 'borrador', totalTesoreria: 300, factura: { total: 300, saldo: 300 } },
  { estado: 'enviada', totalTesoreria: 400, factura: { total: 400, saldo: 400 } },
  { estado: 'vencida', totalTesoreria: 600, factura: { total: 600, saldo: 600 } },
  { estado: 'parcial', totalTesoreria: 800, factura: { total: 800, saldo: 300 } },
  { estado: 'cobrada', totalTesoreria: 900, factura: { total: 900, saldo: 0 } },
])
igual('el mes se reparte entre los pasos', JSON.stringify(reparto), JSON.stringify({ porCrear: 500, porEnviar: 300, porCobrar: 1300, cobrado: 1400 }))
igual('las partes suman el total del mes', reparto.porCrear + reparto.porEnviar + reparto.porCobrar + reparto.cobrado, 3500)

igual('los tramos de vencimiento cortan donde dicen', [0, 1, 15, 16, 30, 31].map(tramoDeVencimiento).join(), 'en_plazo,hasta_15,hasta_15,hasta_30,hasta_30,mas_de_30')

// Recordar un pago: días laborables desde el vencimiento (el 2026-11-06 es viernes; el 2026-12-08 es fiesta nacional)
igual('sin vencer, cero', diasLaborablesDeRetraso('2026-11-20', '2026-11-11'), 0)
igual('el día que vence, cero', diasLaborablesDeRetraso('2026-11-11', '2026-11-11'), 0)
igual('vence el viernes, el lunes lleva 1', diasLaborablesDeRetraso('2026-11-06', '2026-11-09'), 1)
igual('vence el viernes, el miércoles lleva 3', diasLaborablesDeRetraso('2026-11-06', '2026-11-11'), 3)
igual('un festivo nacional no cuenta', diasLaborablesDeRetraso('2026-12-04', '2026-12-09', new Set(['2026-12-08'])), 2)
igual('sin vencimiento, cero', diasLaborablesDeRetraso(null, '2026-11-11'), 0)
igual('se recuerda a partir de 3', DIAS_LABORABLES_PARA_RECORDAR, 3)
igual('con 2 días aún no toca', tocaRecordar({ diasLaborables: 2, ultimoRecordatorio: null, hoy: '2026-11-11' }), false)
igual('con 3 y sin recordatorio, toca', tocaRecordar({ diasLaborables: 3, ultimoRecordatorio: null, hoy: '2026-11-11' }), true)
igual('recordada ayer, no toca', tocaRecordar({ diasLaborables: 9, ultimoRecordatorio: '2026-11-10T09:00:00Z', hoy: '2026-11-11' }), false)
igual('recordada hace 3 laborables, vuelve a tocar', tocaRecordar({ diasLaborables: 9, ultimoRecordatorio: '2026-11-06T09:00:00Z', hoy: '2026-11-11' }), true)
igual('la plantilla de recordatorio se reconoce', esPlantillaDeRecordatorio({ nombre: PLANTILLA_RECORDATORIO.nombre }) && !esPlantillaDeRecordatorio({ nombre: 'Facturación de Servicios' }), true)
igual(
  'el recordatorio no se propone para facturar, aunque fuera lo último que se mandó',
  plantillaPropuesta([{ id: 'r', nombre: 'Recordatorio de pago' }, { id: 'f', nombre: 'Facturación de Servicios' }], { cliente: 'Shoplamp', tieneComision: true, ultimaUsadaId: 'r' })?.id,
  'f'
)
igual('la plantilla de recordatorio solo lleva marcadores de Zoho que existen', (PLANTILLA_RECORDATORIO.cuerpo + PLANTILLA_RECORDATORIO.asunto).match(/%[A-Za-z]+%/g)?.filter((m) => !['%OrgLogo%', '%InvoiceNumber%', '%CustomerName%', '%DueDate%', '%Balance%', '%InvoiceDate%', '%InvoiceURL%'].includes(m)).length, 0)

{
  // Lo que devuelve Zoho con la plantilla de fábrica ya rellenada
  const zoho = PLANTILLA_RECORDATORIO.cuerpo.replaceAll('%InvoiceNumber%', 'SHOP-11').replaceAll('%DueDate%', '13/11/2026')
  const r = textoAntesDeVencer(zoho, false)
  igual('antes de vencer: se cambia la frase', r.cambiado, true)
  igual('antes de vencer: ya no dice «venció»', /venci[oó]/i.test(r.html), false)
  igual('antes de vencer: dice cuándo vence', r.html.includes('vence el <b>13/11/2026</b> y te la recordamos'), true)
  igual('antes de vencer: la fila de la tabla dice «Vence el»', r.html.includes('>Vence el<'), true)
  igual('antes de vencer: ya no dice que no consta el pago', r.html.includes('no nos consta'), false)
  igual('vence hoy: lo dice', textoAntesDeVencer(zoho, true).html.includes('vence hoy, <b>13/11/2026</b>'), true)
  igual('con <strong> también', textoAntesDeVencer('la factura venció el <strong>1/12/2026</strong> y todavía no nos consta el pago.', false).html, 'la factura vence el <strong>1/12/2026</strong> y te la recordamos para que la tenga a mano.'.replace('tenga', 'tengas'))
  const propia = textoAntesDeVencer('<p>Hola, te recordamos la factura.</p>', false)
  igual('plantilla retocada: no se toca y se avisa', [propia.cambiado, propia.html], [false, '<p>Hola, te recordamos la factura.</p>'])
}

console.log(`\n${comprobaciones - fallos}/${comprobaciones} bien`)
if (fallos > 0) process.exit(1)
