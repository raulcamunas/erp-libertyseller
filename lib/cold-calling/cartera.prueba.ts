import {
  SIN_FILTROS,
  contarNiveles,
  contarPrioridades,
  hayPartnersEn,
  contarPorEstado,
  cuantosFiltros,
  esVistaDeCiclo,
  fechaDeRellamada,
  filtrar,
  filtrarYOrdenar,
  hayFiltros,
  listasDeCiclo,
  listasDisponibles,
  normalizarFiltros,
  ordenDeLaVista,
  ordenar,
  panorama,
  rellamadasDe,
  resumenDeCartera,
  type FiltrosDeCartera,
} from '@/lib/cold-calling/cartera'
import type { ColdLead } from '@/lib/types/cold-leads'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/**
 * LA CARTERA: FILTRAR, ORDENAR, CONTAR Y LAS RELLAMADAS.
 *
 * Cada caso es una regla que existe por un fallo que ya pasó y no daba ningún error (ver el principio de cartera.ts):
 * una rellamada que desaparece detrás de un filtro, unas tiendas que no se ven nunca, una pantalla vacía sin explicación.
 */

let n = 0
const lead = (extra: Partial<ColdLead> = {}): ColdLead =>
  ({
    id: `l${String(++n).padStart(4, '0')}`,
    store_name: `Tienda ${n}`,
    company: null,
    revenue_monthly: null,
    phone: null,
    email: null,
    province: null,
    category: null,
    ciudad: null,
    web: null,
    tipo_lead: 'seller_amazon',
    nivel: null,
    ventas_estimadas_usd: null,
    assigned_to: 'maoli',
    status: 'pendiente',
    follow_up: null,
    next_call_date: null,
    last_contacted_at: null,
    call_attempts: 0,
    source_list: null,
    ...extra,
  }) as ColdLead

const tienda = (extra: Partial<ColdLead> = {}) => lead({ tipo_lead: 'tienda_online', ...extra })
const f = (extra: Partial<FiltrosDeCartera>): FiltrosDeCartera => ({ ...SIN_FILTROS, ...extra })
const ids = (ls: ColdLead[]) => ls.map((l) => l.store_name).join(' · ')

console.log('\n=== filtrar ===')
{
  const a = lead({ store_name: 'Alfa', status: 'no_contesta', source_list: 'José V2', nivel: null, revenue_monthly: 80000 })
  const b = lead({ store_name: 'Beta', status: 'seguimiento', source_list: 'José V2', revenue_monthly: 30000 })
  const c = tienda({ store_name: 'Gamma', status: 'pendiente', source_list: 'No Amazon V1', nivel: 1, ventas_estimadas_usd: 500000 })
  const d = tienda({ store_name: 'Delta', status: 'pendiente', source_list: 'No Amazon V1', nivel: 2 })
  const sinLista = lead({ store_name: 'Epsilon', revenue_monthly: 10000 })
  const todos = [a, b, c, d, sinLista]

  ok('sin filtros no quita nada', filtrar(todos, SIN_FILTROS).length === 5)
  ok('por estado', ids(filtrar(todos, f({ estado: 'no_contesta' }))) === 'Alfa')
  ok('por lista', ids(filtrar(todos, f({ lista: 'No Amazon V1' }))) === 'Gamma · Delta')
  ok('«Sin lista» es una lista como las demás', ids(filtrar(todos, f({ lista: 'Sin lista' }))) === 'Epsilon')
  ok('por nivel', ids(filtrar(todos, f({ nivel: 2 }))) === 'Delta')
  ok('los filtros se suman', ids(filtrar(todos, f({ lista: 'José V2', estado: 'seguimiento' }))) === 'Beta')
  ok('un filtro que no deja pasar a nadie da una lista vacía', filtrar(todos, f({ lista: 'José V2', estado: 'cita_cualificada' })).length === 0)
}

console.log('\n=== buscar ===')
{
  const a = lead({ store_name: 'Sklum', company: 'Sklum Home and Deco SL', phone: '+34 910 21 04 65', email: 'info@sklum.com' })
  const b = tienda({ store_name: 'ECOALF', ciudad: 'Madrid', web: 'https://ecoalf.com' })
  const c = lead({ store_name: 'Verdecora', province: 'Madrid', category: 'Jardín' })
  const todos = [a, b, c]
  ok('por nombre, sin importar mayúsculas', filtrar(todos, f({ busqueda: 'SKLUM' })).length === 1 && filtrar(todos, f({ busqueda: 'SKLUM' }))[0] === a)
  ok('por empresa', filtrar(todos, f({ busqueda: 'home and deco' })).length === 1)
  ok('por teléfono, como esté escrito', filtrar(todos, f({ busqueda: '910 21' })).length === 1)
  ok('por correo', filtrar(todos, f({ busqueda: 'info@' })).length === 1)
  ok('por la ciudad de una tienda online (su provincia viene vacía)', filtrar(todos, f({ busqueda: 'madrid' })).length === 2)
  ok('por la web, porque el nombre de una tienda suele ser su dominio', filtrar(todos, f({ busqueda: 'ecoalf.com' })).length === 1)
  ok('por categoría', filtrar(todos, f({ busqueda: 'jardín' })).length === 1)
  ok('con espacios alrededor', filtrar(todos, f({ busqueda: '  sklum  ' })).length === 1)
  ok('no cruza campos: el final de uno y el principio de otro no hacen una coincidencia', filtrar([lead({ store_name: 'abc', company: 'def' })], f({ busqueda: 'cd' })).length === 0)
  ok('una búsqueda vacía no filtra', filtrar(todos, f({ busqueda: '   ' })).length === 3)
}

console.log('\n=== el rango de facturación ===')
{
  const grande = lead({ store_name: 'Grande', revenue_monthly: 120000 })
  const mediano = lead({ store_name: 'Mediano', revenue_monthly: 60000 })
  const pequeno = lead({ store_name: 'Pequeño', revenue_monthly: 10000 })
  const sinImporte = lead({ store_name: 'Sin importe', revenue_monthly: null })
  const online = tienda({ store_name: 'Online', revenue_monthly: null, ventas_estimadas_usd: 900000 })
  const todos = [grande, mediano, pequeno, sinImporte, online]
  ok('desde', ids(filtrar(todos, f({ minRev: '50000' }))) === 'Grande · Mediano · Online')
  ok('hasta', ids(filtrar(todos, f({ maxRev: '50000' }))) === 'Pequeño · Online')
  ok('desde y hasta', ids(filtrar(todos, f({ minRev: '20000', maxRev: '100000' }))) === 'Mediano · Online')
  ok('un seller SIN importe queda fuera cuando hay rango (no se puede afirmar que caiga dentro)', !filtrar(todos, f({ minRev: '1' })).includes(sinImporte) && !filtrar(todos, f({ maxRev: '999999999' })).includes(sinImporte))
  ok('una TIENDA ONLINE no se filtra por rango: no tiene facturación observada y se quedaría la pantalla vacía', filtrar([online], f({ minRev: '50000' })).length === 1 && filtrar([online], f({ maxRev: '10' })).length === 1)
  ok('sin rango, el seller sin importe sí sale', filtrar(todos, SIN_FILTROS).includes(sinImporte))
  ok('en el límite entra', filtrar(todos, f({ minRev: '60000' })).includes(mediano) && filtrar(todos, f({ maxRev: '60000' })).includes(mediano))
}

console.log('\n=== ordenar ===')
{
  const grande = lead({ store_name: 'Grande', revenue_monthly: 120000 })
  const mediano = lead({ store_name: 'Mediano', revenue_monthly: 60000 })
  const pequeno = lead({ store_name: 'Pequeño', revenue_monthly: 10000 })
  const online = tienda({ store_name: 'Online', ventas_estimadas_usd: 90000, nivel: 1 })
  const onlineMenor = tienda({ store_name: 'Online menor', ventas_estimadas_usd: 5000, nivel: 2 })
  const todos = [pequeno, online, grande, onlineMenor, mediano]

  ok('más facturación: cada tipo con SU cifra, sin que las tiendas caigan al final por no tener importe', ids(ordenar(todos, 'revenue_desc')) === 'Grande · Online · Mediano · Pequeño · Online menor', ids(ordenar(todos, 'revenue_desc')))
  ok('menos facturación', ids(ordenar(todos, 'revenue_asc')) === 'Online menor · Pequeño · Mediano · Online · Grande')
  ok('por nombre, con los acentos en su sitio', ids(ordenar([lead({ store_name: 'Zeta' }), lead({ store_name: 'Árbol' }), lead({ store_name: 'Beta' })], 'name')) === 'Árbol · Beta · Zeta')
  ok('por prioridad: primero el nivel, y dentro el que más vende; los de Amazon (sin nivel) detrás', ids(ordenar(todos, 'prioridad')) === 'Online · Online menor · Grande · Mediano · Pequeño', ids(ordenar(todos, 'prioridad')))
  ok('no toca el array original', todos[0] === pequeno && todos.length === 5)

  const hoyMismo = lead({ store_name: 'Hoy', next_call_date: '2026-10-22', revenue_monthly: 1000 })
  const ayer = lead({ store_name: 'Ayer', next_call_date: '2026-10-21', revenue_monthly: 500 })
  const manana = lead({ store_name: 'Mañana', next_call_date: '2026-10-23', revenue_monthly: 99999 })
  const mismoDiaGrande = lead({ store_name: 'Hoy grande', next_call_date: '2026-10-22', revenue_monthly: 50000 })
  const sinFecha = lead({ store_name: 'Sin fecha', revenue_monthly: 999999 })
  const cerradoConFecha = lead({ store_name: 'Cerrado', status: 'no_interesa', next_call_date: '2026-09-01', revenue_monthly: 5 })
  const r = ordenar([sinFecha, manana, hoyMismo, cerradoConFecha, ayer, mismoDiaGrande], 'due_first')
  ok('rellamadas primero: la fecha más antigua arriba y, a igual día, el que más factura', ids(r.slice(0, 4)) === 'Ayer · Hoy grande · Hoy · Mañana', ids(r))
  ok('sin fecha detrás, por lo que facturan', r[4] === sinFecha)
  ok('un lead CERRADO con una fecha vieja no sube al principio: esa fecha ya no significa nada', r[r.length - 1] === cerradoConFecha && fechaDeRellamada(cerradoConFecha) === null, ids(r))
}

console.log('\n=== contar ===')
{
  const a = lead({ status: 'no_contesta', source_list: 'A', nivel: null })
  const b = lead({ status: 'no_contesta', source_list: 'A' })
  const c = tienda({ status: 'pendiente', source_list: 'B', nivel: 1 })
  const d = tienda({ status: 'pendiente', source_list: 'B', nivel: 1 })
  const e = tienda({ status: 'pendiente', source_list: 'B', nivel: 3 })
  const g = tienda({ status: 'seguimiento', source_list: 'C', nivel: 2 })
  const cartera = [a, b, c, d, e, g, lead({ source_list: null })]
  const porEstado = contarPorEstado(cartera)
  ok('por estado', porEstado.get('no_contesta') === 2 && porEstado.get('pendiente') === 4 && porEstado.get('seguimiento') === 1 && !porEstado.has('cita_cualificada'))
  const listas = listasDisponibles(cartera)
  ok('las listas, de la más grande a la más pequeña', listas[0][0] === 'B' && listas[0][1] === 3 && listas[1][0] === 'A' && listas[1][1] === 2)
  ok('y a igualdad, por nombre; «Sin lista» cuenta como una', listas.map((x) => x[0]).join() === 'B,A,C,Sin lista', listas.map((x) => x[0]).join())
  const niveles = contarNiveles(cartera, 'B')
  ok('los niveles se cuentan DENTRO de la lista elegida', niveles[1] === 2 && niveles[2] === 0 && niveles[3] === 1)
  ok('con «todas», se cuentan todos', contarNiveles(cartera, 'all')[2] === 1)
  ok('una lista de vendedores de Amazon no tiene niveles', contarNiveles(cartera, 'A')[1] === 0 && contarNiveles(cartera, 'A')[2] === 0)
}

console.log('\n=== un filtro que ya no tiene nada que filtrar se quita solo ===')
{
  const sellers = [lead({ source_list: 'José V2' }), lead({ source_list: 'José V2' })]
  const tiendas = [tienda({ source_list: 'No Amazon V1', nivel: 1 }), tienda({ source_list: 'No Amazon V1', nivel: 2 })]
  const cartera = [...sellers, ...tiendas]

  const conNivelAjeno = f({ nivel: 1, lista: 'José V2' })
  const r1 = normalizarFiltros(conNivelAjeno, cartera)
  ok('«Nivel 1» recordado y abierta una lista de sellers: se quita el nivel y la lista se queda', r1.nivel === 'all' && r1.lista === 'José V2')
  const r2 = normalizarFiltros(f({ lista: 'Lista que ya no existe' }), cartera)
  ok('una lista que ya no está en esta cartera se quita', r2.lista === 'all')
  const r3 = normalizarFiltros(f({ lista: 'Lista que ya no existe', nivel: 1 }), cartera)
  ok('y entonces el nivel se mira sobre todas las listas', r3.lista === 'all' && r3.nivel === 1)
  const buenos = f({ lista: 'No Amazon V1', nivel: 2, estado: 'pendiente', busqueda: 'x', minRev: '5' })
  ok('si no hay nada que quitar devuelve LOS MISMOS filtros (misma referencia: no provoca otro pintado)', normalizarFiltros(buenos, cartera) === buenos)
  ok('un nivel que no es 1, 2 ni 3 se quita', normalizarFiltros(f({ nivel: 7 }), cartera).nivel === 'all')
  ok('lo demás no se toca', normalizarFiltros(f({ nivel: 1, lista: 'José V2', estado: 'seguimiento', busqueda: 'abc' }), cartera).estado === 'seguimiento' && normalizarFiltros(f({ nivel: 1, lista: 'José V2', busqueda: 'abc' }), cartera).busqueda === 'abc')
}

console.log('\n=== ¿hay algo puesto? ===')
{
  ok('sin filtros', !hayFiltros(SIN_FILTROS) && cuantosFiltros(SIN_FILTROS) === 0)
  ok('cada uno cuenta', hayFiltros(f({ busqueda: 'a' })) && hayFiltros(f({ estado: 'pendiente' })) && hayFiltros(f({ lista: 'x' })) && hayFiltros(f({ nivel: 1 })) && hayFiltros(f({ minRev: '1' })) && hayFiltros(f({ maxRev: '1' })))
  ok('cambiar el orden también: cambia lo que se ve', hayFiltros(f({ orden: 'name' })))
  ok('la insignia del botón cuenta filtros, no la búsqueda ni el orden', cuantosFiltros(f({ busqueda: 'a', orden: 'name' })) === 0 && cuantosFiltros(f({ estado: 'pendiente', lista: 'x', nivel: 2, minRev: '1', maxRev: '9' })) === 4)
}

console.log('\n=== el resumen ===')
{
  const hoy = '2026-10-22'
  const cartera = [
    lead({ status: 'pendiente' }),
    lead({ status: 'no_contesta', next_call_date: '2026-10-22' }),
    lead({ status: 'programado', next_call_date: '2026-10-19' }),
    lead({ status: 'seguimiento', next_call_date: '2026-10-30' }),
    lead({ status: 'cita_cualificada' }),
    lead({ status: 'no_interesa', next_call_date: '2026-09-01' }),
  ]
  const r = resumenDeCartera(cartera, hoy)
  ok('total, trabajados (todos menos «Sin contactar») y cualificados', r.total === 6 && r.trabajados === 5 && r.cualificados === 1)
  ok('la conversión es cualificados entre trabajados', Math.abs(r.conversion - 1 / 5) < 1e-9)
  ok('las rellamadas por hacer son las de hoy Y las atrasadas, sin las de más adelante ni las de un lead cerrado', r.paraLlamar === 2 && r.atrasadas === 1)
  const vacio = resumenDeCartera([], hoy)
  ok('una cartera vacía no divide por cero', vacio.total === 0 && vacio.conversion === 0 && vacio.paraLlamar === 0)
}

console.log('\n=== las rellamadas NO se filtran ===')
{
  const hoy = '2026-10-22'
  const cuatroMil = lead({ store_name: 'Apalabrada', status: 'programado', next_call_date: '2026-10-22', revenue_monthly: 4000, source_list: 'José V2' })
  const grande = lead({ store_name: 'Grande', status: 'no_contesta', next_call_date: '2026-10-22', revenue_monthly: 90000 })
  const online = tienda({ store_name: 'Tienda', next_call_date: '2026-10-22', ventas_estimadas_usd: 700000, nivel: 1, source_list: 'No Amazon V1' })
  const atrasada = lead({ store_name: 'Atrasada', next_call_date: '2026-10-15' })
  const masAntigua = lead({ store_name: 'Más antigua', next_call_date: '2026-10-01' })
  const manana = lead({ store_name: 'Mañana', next_call_date: '2026-10-23' })
  const cerrada = lead({ store_name: 'Cerrada', status: 'no_interesa', next_call_date: '2026-10-22' })
  const sinFecha = lead({ store_name: 'Sin fecha' })
  const cartera = [cuatroMil, grande, online, atrasada, masAntigua, manana, cerrada, sinFecha]

  const filtrosDeProspectar = f({ minRev: '6000', lista: 'No Amazon V1' })
  ok('con un filtro de facturación puesto, la prospección esconde la rellamada de 4.000…', !filtrar(cartera, filtrosDeProspectar).includes(cuatroMil))
  const r = rellamadasDe(cartera, hoy, hoy)
  ok('…pero la agenda de rellamadas SÍ la enseña: sale de la cartera de la persona, no de lo filtrado', r.delDia.includes(cuatroMil))
  ok('las de hoy, las que más factura primero (cada tipo con su cifra)', ids(r.delDia) === 'Tienda · Grande · Apalabrada', ids(r.delDia))
  ok('las atrasadas, las más viejas primero, solo mirando HOY', ids(r.atrasadas) === 'Más antigua · Atrasada', ids(r.atrasadas))
  ok('un lead cerrado no es una rellamada, ni de hoy ni atrasada', !r.delDia.includes(cerrada) && !r.atrasadas.includes(cerrada))
  ok('lo de más adelante y lo que no tiene fecha, fuera', !r.delDia.includes(manana) && !r.atrasadas.includes(manana) && !r.delDia.includes(sinFecha))
  const otroDia = rellamadasDe(cartera, '2026-10-23', hoy)
  ok('mirando otro día: solo ese día, y sin «atrasadas» (ahí no quieren decir nada)', ids(otroDia.delDia) === 'Mañana' && otroDia.atrasadas.length === 0)
  ok('un día sin nada', rellamadasDe(cartera, '2026-12-25', hoy).delDia.length === 0)
}

console.log('\n=== filtrar y ordenar a la vez ===')
{
  const a = lead({ store_name: 'A', status: 'pendiente', revenue_monthly: 100 })
  const b = lead({ store_name: 'B', status: 'pendiente', revenue_monthly: 900 })
  const c = lead({ store_name: 'C', status: 'seguimiento', revenue_monthly: 500 })
  ok('filtra y ordena', ids(filtrarYOrdenar([a, b, c], f({ estado: 'pendiente', orden: 'revenue_desc' }))) === 'B · A')
}

console.log('\n=== los números de los chips dicen lo que saldría al pulsarlos ===')
{
  const a = lead({ store_name: 'A', status: 'pendiente', source_list: 'No Amazon V1', nivel: 1, ventas_estimadas_usd: 9, tipo_lead: 'tienda_online' })
  const b = lead({ store_name: 'B', status: 'pendiente', source_list: 'No Amazon V1', nivel: 2, tipo_lead: 'tienda_online' })
  const c = lead({ store_name: 'C', status: 'no_contesta', source_list: 'No Amazon V1', nivel: 1, tipo_lead: 'tienda_online' })
  const d = lead({ store_name: 'D', status: 'pendiente', source_list: 'José V2', revenue_monthly: 500 })
  const e = lead({ store_name: 'E', status: 'seguimiento', source_list: 'José V2', revenue_monthly: 900 })
  const todos = [a, b, c, d, e]

  const sin = panorama(todos, SIN_FILTROS)
  ok('sin filtros, todo cuenta', sin.visibles.length === 5 && sin.totalSinEstado === 5 && sin.porEstado.get('pendiente') === 3)

  const enLista = panorama(todos, f({ lista: 'No Amazon V1' }))
  ok('con una lista elegida, los estados cuentan DENTRO de esa lista (no la cartera entera)', enLista.porEstado.get('pendiente') === 2 && enLista.porEstado.get('no_contesta') === 1 && !enLista.porEstado.has('seguimiento'), JSON.stringify([...enLista.porEstado]))
  ok('«Todos» cuenta lo mismo que la suma de los estados', enLista.totalSinEstado === 3)
  ok('y los niveles también, dentro de la lista', enLista.niveles[1] === 2 && enLista.niveles[2] === 1)

  const pendientes = panorama(todos, f({ estado: 'pendiente' }))
  ok('con un estado puesto, las LISTAS cuentan los de ese estado', pendientes.listas.find(([n]) => n === 'No Amazon V1')?.[1] === 2 && pendientes.listas.find(([n]) => n === 'José V2')?.[1] === 1)
  ok('pero los estados siguen contando todos (para poder cambiar de estado)', pendientes.porEstado.get('seguimiento') === 1 && pendientes.porEstado.get('no_contesta') === 1)
  ok('lo que se ve es lo que cumple TODO', pendientes.visibles.length === 3 && pendientes.visibles.every((l) => l.status === 'pendiente'))

  const nivel1 = panorama(todos, f({ lista: 'No Amazon V1', nivel: 1 }))
  ok('con un nivel puesto, los niveles siguen contando todos los de la lista (para poder cambiar de nivel)', nivel1.niveles[1] === 2 && nivel1.niveles[2] === 1)
  ok('y los estados cuentan solo los de ese nivel', nivel1.porEstado.get('pendiente') === 1 && nivel1.porEstado.get('no_contesta') === 1)
  ok('el orden elegido se aplica a lo visible', panorama(todos, f({ orden: 'name' })).visibles.map((l) => l.store_name).join('') === 'ABCDE')
}

console.log('\n=== los partners: prioridad, puntos y «menciona Amazon» ===')
{
  const partner = (extra: Partial<ColdLead> = {}) => lead({ tipo_lead: 'partner', source_list: 'Partners - Gestorías', ...extra })
  const p1 = partner({ store_name: 'Gestoría A', prioridad: 1, puntos: 86, menciona_amazon: false })
  const p2alta = partner({ store_name: 'Gestoría B', prioridad: 2, puntos: 79, menciona_amazon: true })
  const p2baja = partner({ store_name: 'Gestoría C', prioridad: 2, puntos: 40, menciona_amazon: false })
  const p3 = partner({ store_name: 'Gestoría D', prioridad: 3, puntos: 90, menciona_amazon: false })
  const p4 = partner({ store_name: 'Gestoría E', prioridad: 4, puntos: 70, menciona_amazon: true })
  const sinPrioridad = partner({ store_name: 'Gestoría F', prioridad: null, puntos: 99 })
  const vendedor = lead({ store_name: 'Vendedor', revenue_monthly: 90000 })
  const todos = [p3, p2baja, vendedor, p4, p1, sinPrioridad, p2alta]

  const orden = (o: FiltrosDeCartera['orden']) => ordenar(todos, o).map((l) => l.store_name.replace('Gestoría ', ''))
  ok('«Prioridad y puntos»: las 1 antes que las 2, y dentro de cada prioridad las de más puntos', orden('prioridad').slice(0, 5).join(',') === 'A,B,C,D,E', orden('prioridad').join(','))
  ok('una prioridad 3 con 90 puntos NO se cuela por delante de una 2 con 40: la prioridad manda y los puntos desempatan', orden('prioridad').indexOf('C') < orden('prioridad').indexOf('D'))
  ok('sin prioridad va detrás de todas las que la tienen, aunque tenga más puntos', orden('prioridad').indexOf('F') > orden('prioridad').indexOf('E'))
  // Los pesos de un vendedor (euros) y de un partner (prioridad y puntos) no se comparan: se ordena una lista de partners, que es lo que se mira
  const soloPartners = todos.filter((l) => l.tipo_lead === 'partner')
  const nombres = (ls: ColdLead[]) => ls.map((l) => l.store_name.replace('Gestoría ', '')).join(',')
  ok('el orden por defecto (rellamadas primero, luego el peso) ordena igual: P1 arriba y los puntos desempatan', nombres(ordenar(soloPartners, 'due_first')).startsWith('A,B,C,D,E'), nombres(ordenar(soloPartners, 'due_first')))
  ok('«Más puntos» respeta también la prioridad (los puntos solos engañarían: la D tiene 90)', nombres(ordenar(soloPartners, 'revenue_desc')).startsWith('A,B,C,D,E'), nombres(ordenar(soloPartners, 'revenue_desc')))
  ok('«Menos puntos» es el orden contrario', nombres(ordenar(soloPartners, 'revenue_asc')).startsWith('F'), nombres(ordenar(soloPartners, 'revenue_asc')))
  const conRellamada = partner({ store_name: 'Gestoría G', prioridad: 4, puntos: 10, next_call_date: '2026-10-28' })
  ok('una rellamada apalabrada sigue yendo antes que cualquier prioridad', ordenar([...soloPartners, conRellamada], 'due_first')[0].store_name === 'Gestoría G')

  console.log('\n  — filtrar —')
  ok('prioridad 1: solo los partners de prioridad 1', filtrar(todos, f({ prioridad: 1 })).map((l) => l.store_name).join() === 'Gestoría A')
  ok('prioridad 2: las dos', filtrar(todos, f({ prioridad: 2 })).length === 2)
  ok('una prioridad deja fuera al que no es partner (un vendedor no tiene prioridad)', !filtrar(todos, f({ prioridad: 2 })).some((l) => l.store_name === 'Vendedor'))
  ok('«menciona Amazon»: solo los partners que lo mencionan', filtrar(todos, f({ mencionaAmazon: true })).map((l) => l.store_name.replace('Gestoría ', '')).sort().join() === 'B,E')
  ok('prioridad y «menciona Amazon» a la vez se juntan', filtrar(todos, f({ prioridad: 4, mencionaAmazon: true })).length === 1 && filtrar(todos, f({ prioridad: 1, mencionaAmazon: true })).length === 0)
  ok('el rango de facturación NO deja fuera a los partners (no tienen facturación)', filtrar([p1, vendedor], f({ minRev: '50000' })).some((l) => l.store_name === 'Gestoría A'))

  console.log('\n  — contar —')
  const c = contarPrioridades(todos, 'all')
  ok('cuenta cada prioridad (solo partners)', c[1] === 1 && c[2] === 2 && c[3] === 1 && c[4] === 1, JSON.stringify(c))
  const otraLista = partner({ prioridad: 1, source_list: 'Partners - Fulfillment' })
  ok('dentro de la lista elegida: la otra no cuenta', contarPrioridades([...todos, otraLista], 'Partners - Gestorías')[1] === 1 && contarPrioridades([...todos, otraLista], 'Partners - Fulfillment')[1] === 1)
  ok('hayPartnersEn: sí en la lista de partners, no en una de vendedores', hayPartnersEn(todos, 'Partners - Gestorías') && !hayPartnersEn([vendedor], 'all') && !hayPartnersEn(todos, 'No Amazon V1'))
  const pan = panorama(todos, f({ prioridad: 2 }))
  ok('el panorama cuenta las prioridades con los demás filtros y SIN el suyo (para poder cambiar de prioridad)', pan.prioridades[1] === 1 && pan.prioridades[2] === 2 && pan.visibles.length === 2)
  ok('y cuántos mencionan Amazon: lo que saldría al pulsar el chip (con la prioridad puesta, solo los de esa prioridad)', panorama(todos, f({})).mencionanAmazon === 2 && pan.mencionanAmazon === 1 && panorama(todos, f({ mencionaAmazon: true })).mencionanAmazon === 2)

  console.log('\n  — un filtro sin nada que filtrar se quita solo —')
  ok('una prioridad que ya no tiene ningún partner (otra cartera) se quita', normalizarFiltros(f({ prioridad: 2 }), [vendedor]).prioridad === 'all')
  ok('una que sí tiene, se queda y es LA MISMA referencia', (() => { const fi = f({ prioridad: 2 }); return normalizarFiltros(fi, todos) === fi })())
  ok('una prioridad con valor imposible se quita', normalizarFiltros(f({ prioridad: 9 }), todos).prioridad === 'all')
  ok('«menciona Amazon» sin ningún partner en la cartera se apaga (si no, la pantalla se queda vacía sin explicar por qué)', normalizarFiltros(f({ mencionaAmazon: true }), [vendedor]).mencionaAmazon === false)
  ok('con partners se queda', normalizarFiltros(f({ mencionaAmazon: true }), todos).mencionaAmazon === true)

  console.log('\n  — hay filtros —')
  ok('la prioridad y el «menciona Amazon» cuentan como filtros', hayFiltros(f({ prioridad: 1 })) && hayFiltros(f({ mencionaAmazon: true })) && cuantosFiltros(f({ prioridad: 1, mencionaAmazon: true })) === 2)
  ok('y SIN_FILTROS no tiene ninguno', !hayFiltros(SIN_FILTROS) && cuantosFiltros(SIN_FILTROS) === 0)
}

console.log('\n=== una lista de ciclo tiene sus propias cajas (regla 7) ===')
{
  const LISTA = 'No Amazon V1 · Ciclo'
  const ciclo = (extra: Partial<ColdLead>) => tienda({ source_list: LISTA, ciclo_vuelta: 1, ...extra })
  const uno = ciclo({ store_name: 'Uno', status: 'pendiente' })
  const dos = ciclo({ store_name: 'Dos', status: 'no_contesta' }) // Rinkel lo puso al primer toque: sigue siendo la Fase 1
  const tres = ciclo({ store_name: 'Tres', status: 'no_contesta', ciclo_fase: 'f2', next_call_date: '2026-10-30' })
  const cuatro = ciclo({ store_name: 'Cuatro', status: 'no_contesta', ciclo_fase: 'f3' })
  const cinco = ciclo({ store_name: 'Cinco', status: 'no_contesta', ciclo_fase: 'sin_respuesta', next_call_date: '2027-01-05' })
  const seis = ciclo({ store_name: 'Seis', status: 'seguimiento' })
  const siete = ciclo({ store_name: 'Siete', status: 'programado', next_call_date: '2026-11-05' }) // «llámame el jueves»
  const ocho = ciclo({ store_name: 'Ocho', status: 'cita_cualificada' })
  const nueve = ciclo({ store_name: 'Nueve', status: 'no_interesa' })
  const vieja = lead({ store_name: 'Vieja', source_list: 'José V2', status: 'no_contesta' })
  const todos = [uno, dos, tres, cuatro, cinco, seis, siete, ocho, nueve, vieja]
  const enLista = { lista: LISTA }

  ok('con la lista de ciclo elegida es una vista de ciclo', esVistaDeCiclo(todos, LISTA))
  ok('con otra lista, o con «Todas las listas», no', !esVistaDeCiclo(todos, 'José V2') && !esVistaDeCiclo(todos, 'all'))
  ok('un lead suelto con la marca en una lista de siete NO cambia las cajas de esa lista', !esVistaDeCiclo([...Array.from({ length: 7 }, () => lead({ source_list: 'Otra', status: 'no_contesta' })), lead({ source_list: 'Otra', ciclo_vuelta: 1 })], 'Otra'))

  const p = panorama(todos, f(enLista))
  const cuenta = (e: string) => p.porEstado.get(e as never) ?? 0
  ok('los chips cuentan por caja: 2 Sin contactar, 1 Fase 2, 1 Fase 3, 1 No responde, 2 En seguimiento, 1 Cita, 1 No le interesa', cuenta('pendiente') === 2 && cuenta('fase_2') === 1 && cuenta('fase_3') === 1 && cuenta('no_responde') === 1 && cuenta('seguimiento') === 2 && cuenta('cita_cualificada') === 1 && cuenta('no_interesa') === 1, JSON.stringify([...p.porEstado]))
  ok('y suman todos los de la lista: ningún lead se queda sin chip', [...p.porEstado.values()].reduce((a, b) => a + b, 0) === 9 && p.totalSinEstado === 9 && p.modoCiclo)
  ok('«No contesta» y «Rellamada programada» no existen como chip en una lista de ciclo', !p.porEstado.has('no_contesta') && !p.porEstado.has('programado') && !p.porEstado.has('email_enviado'))
  ok('pulsar Fase 2 deja los de la Fase 2', ids(filtrar(todos, f({ ...enLista, estado: 'fase_2' }), true)) === 'Tres')
  ok('pulsar Sin contactar deja a los de la Fase 1, con o sin el «No contesta» de Rinkel', ids(filtrar(todos, f({ ...enLista, estado: 'pendiente' }), true)) === 'Uno · Dos')
  ok('pulsar En seguimiento incluye al que pidió «llámame el jueves»', ids(filtrar(todos, f({ ...enLista, estado: 'seguimiento' }), true)) === 'Seis · Siete')
  ok('pulsar No responde deja al que pasó por las dos rellamadas', ids(filtrar(todos, f({ ...enLista, estado: 'no_responde' }), true)) === 'Cinco')
  ok('el resultado de pulsar un chip es exactamente lo que ese chip decía', (['pendiente', 'fase_2', 'fase_3', 'no_responde', 'seguimiento', 'cita_cualificada', 'no_interesa'] as const).every((e) => panorama(todos, f({ ...enLista, estado: e })).visibles.length === cuenta(e)))

  const q = panorama(todos, f({}))
  ok('en «Todas las listas» los chips son los de siempre y cada lead cuenta por su estado', !q.modoCiclo && q.porEstado.get('no_contesta') === 5 && q.porEstado.get('programado') === 1 && !q.porEstado.has('fase_2') && [...q.porEstado.values()].reduce((a, b) => a + b, 0) === 10, JSON.stringify([...q.porEstado]))
  ok('en una lista de las de siempre también', !panorama(todos, f({ lista: 'José V2' })).modoCiclo && panorama(todos, f({ lista: 'José V2' })).porEstado.get('no_contesta') === 1)
  ok('un «Fase 2» sin una lista de ciclo no deja pasar a nadie (no es un estado de verdad)', filtrar(todos, f({ estado: 'fase_2' })).length === 0)

  console.log('\n  — una caja que no existe en la vista se quita sola —')
  const f2 = f({ ...enLista, estado: 'fase_2' })
  ok('«Fase 2» en la lista de ciclo se queda, y es LA MISMA referencia', normalizarFiltros(f2, todos) === f2)
  ok('«Fase 2» recordado y una lista de las de siempre: se quita (si no, la pantalla se queda vacía sin explicar por qué)', normalizarFiltros(f({ lista: 'José V2', estado: 'fase_2' }), todos).estado === 'all' && normalizarFiltros(f({ estado: 'no_responde' }), todos).estado === 'all')
  ok('«No contesta» dentro de la lista de ciclo se quita: ya no es un chip de esa vista', normalizarFiltros(f({ ...enLista, estado: 'no_contesta' }), todos).estado === 'all' && normalizarFiltros(f({ ...enLista, estado: 'programado' }), todos).estado === 'all')
  ok('«No contesta» en «Todas las listas» se queda', (() => { const fi = f({ estado: 'no_contesta' }); return normalizarFiltros(fi, todos) === fi })())
  ok('«En seguimiento» vale en las dos vistas', (() => { const a = f({ ...enLista, estado: 'seguimiento' }); const b = f({ estado: 'seguimiento' }); return normalizarFiltros(a, todos) === a && normalizarFiltros(b, todos) === b })())

  console.log('\n  — el desplegable de listas con un estado puesto —')
  ok('las listas de ciclo que hay son solo la del ejemplo', [...listasDeCiclo(todos)].join() === LISTA)
  const sinFiltro = panorama(todos, f(enLista)).listas
  ok('sin estado puesto cuenta todos los leads de cada lista', sinFiltro.find(([n]) => n === LISTA)?.[1] === 9 && sinFiltro.find(([n]) => n === 'José V2')?.[1] === 1, JSON.stringify(sinFiltro))
  const conCaja = panorama(todos, f({ ...enLista, estado: 'no_responde' })).listas
  ok('con «No responde» puesto en la lista de ciclo, las demás listas SIGUEN en el desplegable con todos sus leads (el filtro se quita al elegirlas)', conCaja.find(([n]) => n === 'José V2')?.[1] === 1 && conCaja.find(([n]) => n === LISTA)?.[1] === 1, JSON.stringify(conCaja))
  const conViejo = panorama(todos, f({ estado: 'no_contesta' })).listas
  ok('con «No contesta» puesto en «Todas las listas», la lista de ciclo no se cuenta como si lo tuviera (no es un chip suyo) y la de siempre cuenta el suyo', conViejo.find(([n]) => n === LISTA)?.[1] === 9 && conViejo.find(([n]) => n === 'José V2')?.[1] === 1, JSON.stringify(conViejo))
  const conSeguimiento = panorama(todos, f({ estado: 'seguimiento' })).listas
  ok('un estado que existe en las dos vistas cuenta cada una con lo suyo: «En seguimiento» = Seis y Siete en la de ciclo, y ninguno en la vieja', conSeguimiento.find(([n]) => n === LISTA)?.[1] === 2 && !conSeguimiento.some(([n]) => n === 'José V2'), JSON.stringify(conSeguimiento))

  console.log('\n  — Fase 2, Fase 3 y No responde: los que toca llamar primero, los más antiguos antes —')
  {
    const fase2 = (nombre: string, dia: string | null, nivel: number) => ciclo({ store_name: nombre, status: 'no_contesta', ciclo_fase: 'f2', next_call_date: dia, nivel })
    const dosDias = fase2('Antigua', '2026-10-28', 3) // lleva dos días sin llamarse
    const ayer = fase2('Ayer', '2026-10-29', 2)
    const hoyDia = fase2('Hoy', '2026-10-30', 1)
    const manana = fase2('Mañana', '2026-10-31', 1)
    const lejos = fase2('Lejos', '2026-11-05', 1)
    const lista = [lejos, hoyDia, manana, dosDias, ayer]
    const verEn = (estado: FiltrosDeCartera['estado'], orden: FiltrosDeCartera['orden']) => ids(panorama(lista, f({ lista: LISTA, estado, orden })).visibles)
    ok('en Fase 2 salen primero los atrasados, el más antiguo antes, luego los de hoy y al final los que aún no han llegado a su día', verEn('fase_2', 'due_first') === 'Antigua · Ayer · Hoy · Mañana · Lejos', verEn('fase_2', 'due_first'))
    ok('y es así SEA CUAL SEA el orden que la persona tenga elegido (por nivel, por nombre…): si no, un atrasado de nivel 3 se perdería al final', verEn('fase_2', 'prioridad') === 'Antigua · Ayer · Hoy · Mañana · Lejos' && verEn('fase_2', 'name') === 'Antigua · Ayer · Hoy · Mañana · Lejos' && verEn('fase_2', 'revenue_desc') === 'Antigua · Ayer · Hoy · Mañana · Lejos')
    ok('lo mismo en Fase 3 y en «No responde»', ordenDeLaVista(f({ estado: 'fase_3', orden: 'name' }), true) === 'due_first' && ordenDeLaVista(f({ estado: 'no_responde', orden: 'name' }), true) === 'due_first')
    ok('pero con otra caja o con «Todos» manda el orden elegido', ordenDeLaVista(f({ estado: 'pendiente', orden: 'name' }), true) === 'name' && ordenDeLaVista(f({ estado: 'all', orden: 'prioridad' }), true) === 'prioridad' && ordenDeLaVista(f({ estado: 'seguimiento', orden: 'name' }), true) === 'name')
    ok('y fuera de una lista de ciclo, también (no existe esa caja)', ordenDeLaVista(f({ estado: 'fase_2', orden: 'name' }), false) === 'name' && ordenDeLaVista(f({ estado: 'no_contesta', orden: 'revenue_desc' }), false) === 'revenue_desc')
    ok('a igualdad de día, los que más facturan primero (como en cualquier rellamada)', ids(panorama([fase2('Pequeña', '2026-10-30', 3), { ...fase2('Grande', '2026-10-30', 1), ventas_estimadas_usd: 900_000 } as ColdLead], f({ lista: LISTA, estado: 'fase_2' })).visibles) === 'Grande · Pequeña')
  }

  console.log('\n  — las rellamadas no cambian —')
  const r = rellamadasDe(todos, '2026-10-30', '2026-10-30')
  ok('un lead en Fase 2 con la rellamada de hoy sale en «Para hoy», como cualquier rellamada', ids(r.delDia) === 'Tres')
  ok('y «No responde» no sale hasta su día', ids(rellamadasDe(todos, '2026-11-05', '2026-11-05').delDia) === 'Siete' && ids(rellamadasDe(todos, '2027-01-05', '2027-01-05').delDia).includes('Cinco'))
}

console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
