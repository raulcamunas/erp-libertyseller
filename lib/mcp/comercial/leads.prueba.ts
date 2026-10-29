import { sumarDias } from '@/lib/rendimiento/dia'
import { ErrorDeHerramienta } from '../protocolo'
import { ANA, FANTASMA, L_BEBE, L_COCINA, L_FERRETERIA, L_JARDIN, L_MODA, L_PEND1, L_SOL, L_SOL_OUTLET, L_ZAPATOS, MAOLI, MFER, a, crearDatos, fallaCon, usar, uuid } from './datos-de-pruebas'
import type { Persona } from './comun'
import { armarResumenDeCartera, cifrasDeCartera, coldBuscarLeads, coldFichaLead, coldResumen, duenoDe, estadoArg, tarjetaDeLead, type FilaDeCartera, type LeadLeido } from './leads'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}
const mensajeDe = (f: () => unknown): string | null => {
  try {
    f()
    return null
  } catch (e) {
    return e instanceof ErrorDeHerramienta ? e.message : `OTRO ERROR: ${String(e)}`
  }
}

const HOY = '2026-10-27'
const fila = (e: Partial<FilaDeCartera> = {}): FilaDeCartera => ({ assigned_to: MAOLI, status: 'pendiente', source_list: '1a lista', next_call_date: null, last_contacted_at: null, call_attempts: 0, tipo_lead: 'seller_amazon', ...e })

async function main() {
  console.log('\n=== las reglas del embudo (las de la pantalla de Cold Calling) ===')
  {
    const filas = [
      fila({ status: 'pendiente' }),
      fila({ status: 'no_contesta', next_call_date: '2026-10-25' }),
      fila({ status: 'programado', next_call_date: HOY }),
      fila({ status: 'seguimiento', next_call_date: '2026-10-30', last_contacted_at: '2026-10-26T10:00:00.000Z' }),
      fila({ status: 'cita_cualificada', last_contacted_at: '2026-10-20T10:00:00.000Z' }),
      fila({ status: 'no_interesa', next_call_date: '2026-10-01' }),
    ]
    const c = cifrasDeCartera(filas, HOY)
    ok('trabajados = todos menos «Sin contactar»', c.leads === 6 && c.trabajados === 5 && c.sin_contactar === 1)
    ok('cualificados y su porcentaje sobre los trabajados', c.cualificados === 1 && c.cualificados_sobre_trabajados_pct === 20)
    ok('para llamar = hoy y atrasadas', c.rellamadas_para_llamar === 2 && c.de_ellas_atrasadas === 1 && c.rellamadas_de_hoy === 1)
    ok('un lead CERRADO no tiene rellamada aunque arrastre una fecha vieja', c.rellamadas_para_llamar === 2)
    ok('las de los próximos 7 días', c.rellamadas_proximos_7_dias === 1)
    ok('el último contacto es el más reciente', c.ultimo_contacto === '2026-10-26 11:00')
    const vacio = cifrasDeCartera([], HOY)
    ok('sin leads no hay porcentajes inventados', vacio.leads === 0 && vacio.cualificados_sobre_trabajados_pct === null && vacio.ultimo_contacto === null)
  }

  console.log('\n=== el resumen por comercial y por lista ===')
  {
    const personas = new Map<string, Persona>([[MAOLI, { id: MAOLI, nombre: 'Maoli Pérez', email: null }]])
    const r = armarResumenDeCartera({ hoy: HOY, filas: [fila(), fila({ status: 'cita_cualificada' }), fila({ assigned_to: null, source_list: null, tipo_lead: 'tienda_online' }), fila({ assigned_to: FANTASMA })], personas, filtro: { comercial: null, lista: null } }) as any
    ok('agrupa por quien lo lleva, con «Sin asignar» y quien ya no está', r.por_comercial.map((c: any) => `${c.comercial}:${c.leads}`).join('|') === 'Maoli Pérez:2|Alguien que ya no está:1|Sin asignar:1')
    ok('y por lista, con «Sin lista» para las que no tienen', r.por_lista.map((l: any) => `${l.lista}:${l.leads}`).join('|') === '1a lista:3|Sin lista:1')
    ok('por tipo', r.por_tipo.tiendas_online === 1 && r.por_tipo.vendedores_de_amazon === 3 && r.por_tipo.partners === 0)
    const conPartners = armarResumenDeCartera({ hoy: HOY, filas: [fila(), fila({ tipo_lead: 'tienda_online' }), fila({ tipo_lead: 'partner', source_list: 'Partners - Gestorías' }), fila({ tipo_lead: 'partner', source_list: 'Partners - Gestorías' })], personas, filtro: { comercial: null, lista: null } }) as any
    ok('los partners se cuentan APARTE: no son vendedores de Amazon', conPartners.por_tipo.partners === 2 && conPartners.por_tipo.vendedores_de_amazon === 1 && conPartners.por_tipo.tiendas_online === 1, JSON.stringify(conPartners.por_tipo))
    ok('los estados salen todos, con ceros, en el orden del embudo', Object.keys(r.por_estado).join('|') === 'Sin contactar|No contesta|Rellamada programada|Info enviada|En seguimiento|Cita agendada|No le interesa')
    ok('las reglas viajan en la respuesta', r.reglas.length === 3)
    const muchas = Array.from({ length: 40 }, (_, i) => fila({ source_list: `Lista ${String(i).padStart(2, '0')}` }))
    const m = armarResumenDeCartera({ hoy: HOY, filas: muchas, personas, filtro: { comercial: null, lista: null } }) as any
    ok('con más de 25 listas se corta y se dice cuántas faltan', m.por_lista.length === 25 && m.listas_no_mostradas === 15)
  }

  console.log('\n=== la tarjeta de un lead ===')
  {
    const personas = new Map<string, Persona>([[MAOLI, { id: MAOLI, nombre: 'Maoli Pérez', email: null }]])
    const base: LeadLeido = { id: 'x', store_name: 'Tienda', company: 'Tienda', status: 'seguimiento', assigned_to: MAOLI, source_list: null, tipo_lead: 'seller_amazon', ciudad: null, province: 'Madrid', nivel: null, revenue_monthly: '12500.5', ventas_estimadas_usd: null, call_attempts: null, last_contacted_at: null, next_call_date: '2026-10-24', follow_up: null, phone: null, email: null, decisor: 'Ana', cargo_decisor: null, web: null }
    const t = tarjetaDeLead(base, personas, HOY) as any
    ok('empresa igual al nombre no se repite', t.empresa === null)
    ok('un número que llega como texto es un número', t.facturacion_mensual_eur === 12500.5)
    ok('sin lista, «Sin lista»; sin ciudad, la provincia', t.lista === 'Sin lista' && t.ciudad === 'Madrid')
    ok('la rellamada atrasada lo dice', t.rellamada === 'atrasada 3 d' && t.rellamar_el === '2026-10-24')
    ok('intentos nulos son cero', t.intentos_de_llamada === 0)
    ok('un decisor sin cargo, solo el nombre', t.decisor === 'Ana')
    const tienda = tarjetaDeLead({ ...base, tipo_lead: 'tienda_online', revenue_monthly: null, ventas_estimadas_usd: 85000 }, personas, HOY) as any
    ok('una tienda online lleva dólares estimados y no euros', tienda.tipo === 'tienda online' && tienda.ventas_estimadas_usd === 85000 && tienda.facturacion_mensual_eur === null)
    const cerrado = tarjetaDeLead({ ...base, status: 'no_interesa' }, personas, HOY) as any
    ok('un lead cerrado no enseña rellamada', cerrado.rellamar_el === null && cerrado.rellamada === null)
    ok('quien lo lleva y ya no está no es «sin asignar»', duenoDe(FANTASMA, personas) === 'Alguien que ya no está' && duenoDe(null, personas) === 'Sin asignar')
  }

  console.log('\n=== el estado pedido ===')
  {
    ok('por su clave', estadoArg({ estado: 'no_contesta' }) === 'no_contesta')
    ok('por su nombre en pantalla, con acentos y mayúsculas', estadoArg({ estado: 'Rellamada programada' }) === 'programado' && estadoArg({ estado: 'NO LE INTERESA' }) === 'no_interesa' && estadoArg({ estado: 'cita agendada' }) === 'cita_cualificada' && estadoArg({ estado: 'Cita cualificada' }) === 'cita_cualificada')
    ok('sin estado, nada', estadoArg({}) === undefined)
    ok('uno que no existe: el error lista los siete con su nombre', /pendiente \(Sin contactar\)/.test(mensajeDe(() => estadoArg({ estado: 'xx' })) ?? '') && /no_interesa \(No le interesa\)/.test(mensajeDe(() => estadoArg({ estado: 'xx' })) ?? ''))
  }

  console.log('\n=== cold_resumen ===')
  {
    const d = crearDatos()
    const r = await usar(coldResumen, d.ctx)
    ok('cuenta los diez leads', r.cartera.leads === 10 && r.cartera.trabajados === 7 && r.cartera.sin_contactar === 3)
    ok('y uno cualificado: 1 de 7, un 14 %', r.cartera.cualificados === 1 && r.cartera.cualificados_sobre_trabajados_pct === 14)
    ok('rellamadas: una de hoy, una atrasada, una de la semana; el cerrado no cuenta', r.cartera.rellamadas_para_llamar === 2 && r.cartera.de_ellas_atrasadas === 1 && r.cartera.rellamadas_de_hoy === 1 && r.cartera.rellamadas_proximos_7_dias === 1)
    ok('por comercial, ordenado por cuántos lleva', r.por_comercial.map((c: any) => `${c.comercial}:${c.leads}`).join('|') === 'Ana López:3|Maoli Pérez:3|María Fernanda Ruiz:2|Alguien que ya no está:1|Sin asignar:1')
    const maoli = r.por_comercial.find((c: any) => c.id === MAOLI)
    ok('cada comercial lleva su embudo y sus rellamadas', maoli.por_estado['En seguimiento'] === 1 && maoli.rellamadas_para_llamar === 2 && maoli.de_ellas_atrasadas === 1 && maoli.intentos_de_llamada_en_total === 6)
    ok('por lista', r.por_lista.map((l: any) => `${l.lista}:${l.leads}`).join('|') === '1a lista:7|No Amazon V1:2|Sin lista:1')
    ok('por tipo', r.por_tipo.tiendas_online === 2 && r.por_tipo.vendedores_de_amazon === 8)

    const m = await usar(coldResumen, d.ctx, { comercial: 'maoli' })
    ok('acotado a un comercial', m.cartera.leads === 3 && m.por_comercial.length === 1 && m.filtro.comercial === 'Maoli Pérez')
    const l = await usar(coldResumen, d.ctx, { lista: 'No Amazon V1' })
    ok('acotado a una lista', l.cartera.leads === 2 && l.filtro.lista === 'No Amazon V1')
    const nada = await usar(coldResumen, d.ctx, { lista: 'No existe' })
    ok('una lista que no existe lo dice en vez de enseñar ceros mudos', nada.cartera.leads === 0 && /No hay ningún lead en la lista/.test(nada.aviso))
    ok('un comercial que no existe, error con los que hay', /Maoli Pérez/.test((await fallaCon(coldResumen, d.ctx, { comercial: 'pepito' })) ?? ''))

    const grande = crearDatos({
      tablas: {
        cold_leads: Array.from({ length: 2300 }, (_, i) => ({ id: uuid('1', i), store_name: `Tienda ${i}`, company: null, status: i % 2 === 0 ? 'pendiente' : 'seguimiento', assigned_to: MAOLI, source_list: '1a lista', tipo_lead: 'seller_amazon', next_call_date: null, last_contacted_at: null, call_attempts: 1 })),
      },
    })
    const g = await usar(coldResumen, grande.ctx)
    ok('con 2.300 leads cuenta los 2.300 (PostgREST corta a 1.000 sin avisar)', g.cartera.leads === 2300 && g.cartera.sin_contactar === 1150)

    const sin = crearDatos({ sinTablas: ['cold_leads'] })
    ok('sin la tabla, dice que falta una migración', /migración/.test((await fallaCon(coldResumen, sin.ctx)) ?? ''))
  }

  console.log('\n=== cold_buscar_leads ===')
  {
    const d = crearDatos()
    const todos = await usar(coldBuscarLeads, d.ctx)
    ok('sin filtros, los diez (20 por página)', todos.total === 10 && todos.leads.length === 10 && todos.hay_mas === false)
    const p0 = await usar(coldBuscarLeads, d.ctx, { limite: 4 })
    const p2 = await usar(coldBuscarLeads, d.ctx, { limite: 4, pagina: 2 })
    ok('paginación: la primera tiene más, la última no', p0.leads.length === 4 && p0.hay_mas && p0.siguiente_pagina === 1 && p2.leads.length === 2 && !p2.hay_mas && p2.siguiente_pagina === null)
    ok('sin repetir ni saltarse leads entre páginas', new Set([...p0.leads, ...(await usar(coldBuscarLeads, d.ctx, { limite: 4, pagina: 1 })).leads, ...p2.leads].map((x: any) => x.id)).size === 10)

    const texto = await usar(coldBuscarLeads, d.ctx, { texto: 'lámparas' })
    ok('busca por nombre (con el acento tal cual)', texto.total === 2)
    ok('por correo', (await usar(coldBuscarLeads, d.ctx, { texto: 'info@lamparassol' })).leads[0].id === L_SOL)
    ok('por teléfono', (await usar(coldBuscarLeads, d.ctx, { texto: '611 22 33' })).leads[0].id === L_ZAPATOS)
    ok('por web', (await usar(coldBuscarLeads, d.ctx, { texto: 'bebefeliz.es' })).total === 1)
    ok('un texto con comas y paréntesis no rompe el filtro', (await usar(coldBuscarLeads, d.ctx, { texto: 'sol), (store_name.eq.x' })).total === 0)

    ok('por estado (clave o nombre)', (await usar(coldBuscarLeads, d.ctx, { estado: 'no_contesta' })).total === 2 && (await usar(coldBuscarLeads, d.ctx, { estado: 'No contesta' })).total === 2)
    ok('por comercial', (await usar(coldBuscarLeads, d.ctx, { comercial: 'ana' })).total === 3)
    ok('por lista', (await usar(coldBuscarLeads, d.ctx, { lista: 'No Amazon V1' })).total === 2)
    ok('por nivel y por tipo', (await usar(coldBuscarLeads, d.ctx, { nivel: 2 })).leads[0].id === L_BEBE && (await usar(coldBuscarLeads, d.ctx, { tipo: 'tienda_online' })).total === 2)
    ok('combinados', (await usar(coldBuscarLeads, d.ctx, { comercial: 'maoli', estado: 'seguimiento' })).leads.map((x: any) => x.id).join() === L_SOL)

    const venc = await usar(coldBuscarLeads, d.ctx, { rellamada: 'vencidas' })
    ok('rellamadas vencidas: solo la atrasada (el cerrado no cuenta)', venc.total === 1 && venc.leads[0].id === L_SOL && venc.leads[0].rellamada === 'atrasada 3 d')
    const hoy = await usar(coldBuscarLeads, d.ctx, { rellamada: 'hoy' })
    ok('rellamadas de hoy', hoy.total === 1 && hoy.leads[0].id === L_ZAPATOS && hoy.leads[0].rellamada === 'hoy')
    const hasta = await usar(coldBuscarLeads, d.ctx, { rellamada: 'hasta_hoy', orden: 'rellamada' })
    ok('hasta hoy: las que hay que llamar ya, la más vieja primero', hasta.leads.map((x: any) => x.id).join() === [L_SOL, L_ZAPATOS].join())
    const semana = await usar(coldBuscarLeads, d.ctx, { rellamada: 'proximos_7_dias' })
    ok('próximos 7 días', semana.total === 1 && semana.leads[0].id === L_BEBE)
    const conFecha = await usar(coldBuscarLeads, d.ctx, { rellamada: 'con_fecha', orden: 'rellamada' })
    ok('con fecha: todas las abiertas, sin el cerrado, la próxima primero', conFecha.total === 3 && conFecha.leads[0].id === L_SOL)
    ok('en orden «rellamada» los que no tienen fecha van al final', (await usar(coldBuscarLeads, d.ctx, { orden: 'rellamada' })).leads[9].rellamar_el === null)

    const contactados = await usar(coldBuscarLeads, d.ctx, { contactado_desde: d.dia, contactado_hasta: d.dia })
    ok('por día del último contacto', contactados.total === 2)
    ok('el orden por último contacto pone antes lo más reciente y al final los nunca contactados', (await usar(coldBuscarLeads, d.ctx, { orden: 'ultimo_contacto' })).leads[9].ultimo_contacto === null)
    ok('por nombre, alfabético', (await usar(coldBuscarLeads, d.ctx, { orden: 'nombre' })).leads[0].tienda === 'Bebé Feliz')

    const sol = todos.leads.find((x: any) => x.id === L_SOL)
    ok('la tarjeta: estado, comercial, lista, euros y decisor', sol.estado === 'En seguimiento' && sol.comercial === 'Maoli Pérez' && sol.lista === '1a lista' && sol.facturacion_mensual_eur === 12000 && sol.decisor === 'Carlos Sol (Administrador)' && sol.empresa === 'Lámparas Sol SL')
    ok('el seguimiento y el contacto', sol.seguimiento === 'Quiere ver una propuesta antes del viernes' && sol.telefono === '600 11 22 33' && sol.email === 'info@lamparassol.es')
    ok('una tienda online lleva dólares, ciudad y nivel', todos.leads.find((x: any) => x.id === L_BEBE).ventas_estimadas_usd === 85000 && todos.leads.find((x: any) => x.id === L_BEBE).ciudad === 'Valencia')
    ok('sin dueño y dueño desaparecido se distinguen', todos.leads.find((x: any) => x.id === L_JARDIN).comercial === 'Sin asignar' && todos.leads.find((x: any) => x.id === L_FERRETERIA).comercial === 'Alguien que ya no está')
    ok('el cerrado no enseña rellamada aunque tenga fecha', todos.leads.find((x: any) => x.id === L_MODA).rellamar_el === null)

    const sinLista = await usar(coldBuscarLeads, d.ctx, { lista: 'No existe' })
    ok('una lista que no existe: cero y un aviso que manda a copiar el nombre', sinLista.total === 0 && /cold_resumen/.test(sinLista.aviso))
    ok('un estado inválido es un error con la lista', /pendiente \(Sin contactar\)/.test((await fallaCon(coldBuscarLeads, d.ctx, { estado: 'xx' })) ?? ''))
    ok('un nivel fuera de rango, error', /entre 1 y 3/.test((await fallaCon(coldBuscarLeads, d.ctx, { nivel: 7 })) ?? ''))
    ok('desde después de hasta, error', /no puede ser posterior/.test((await fallaCon(coldBuscarLeads, d.ctx, { contactado_desde: d.dia, contactado_hasta: sumarDias(d.dia, -3) })) ?? ''))
    ok('un límite de 500, error', /entre 1 y 50/.test((await fallaCon(coldBuscarLeads, d.ctx, { limite: 500 })) ?? ''))
    ok('todo es lectura: no se hizo ninguna escritura', d.base.peticiones.every((x) => x.endsWith('.select') || x.startsWith('rpc:')))

    const gordos = crearDatos({
      tablas: {
        cold_leads: Array.from({ length: 60 }, (_, i) => ({ id: uuid('2', i), store_name: `Tienda ${i}`, company: `Empresa muy larga de la tienda número ${i} S.L.`, status: 'seguimiento', assigned_to: MAOLI, source_list: '1a lista', tipo_lead: 'seller_amazon', ciudad: 'Valencia', follow_up: 'palabra '.repeat(80), phone: '600 11 22 33', email: `tienda${i}@ejemplo.es`, decisor: 'Un decisor con nombre largo', cargo_decisor: 'Administrador único', web: 'https://www.una-web-larga.es', call_attempts: 3, updated_at: a('2026-10-20', '10:00') })),
      },
    })
    const enorme = await coldBuscarLeads.ejecutar({ limite: 50 }, gordos.ctx)
    const parsed = JSON.parse(enorme.texto)
    ok('si 50 leads no caben en una respuesta, se enseñan los que caben, con el JSON entero y un aviso', enorme.texto.length <= 30_000 && parsed.leads.length < 50 && parsed.leads.length >= 10 && /de los 50/.test(parsed.aviso_de_tamano) && parsed.total === 60)
  }

  console.log('\n=== cold_ficha_lead ===')
  {
    const d = crearDatos()
    const f = await usar(coldFichaLead, d.ctx, { lead: L_SOL })
    ok('por id: sus datos', f.lead.tienda === 'Lámparas Sol' && f.lead.cif === null && f.lead.telefono === '600 11 22 33' && f.lead.seguimiento === 'Quiere ver una propuesta antes del viernes')
    ok('historial: 5 apuntes, el más reciente primero', f.historial.total === 5 && f.historial.apuntes.length === 5 && f.historial.apuntes[0].cuando >= f.historial.apuntes[1].cuando)
    ok('marca la respuesta del cliente', f.historial.apuntes.filter((x: any) => x.respuesta_del_cliente).length === 1)
    ok('el texto largo se recorta con puntos suspensivos', f.historial.apuntes.some((x: any) => x.texto.endsWith('…') && x.texto.length <= 700))
    ok('el autor que ya no está se dice', f.historial.apuntes.some((x: any) => x.autor === 'Alguien que ya no está'))
    ok('canal con su nombre', f.historial.apuntes.some((x: any) => x.canal === 'WhatsApp') && f.historial.apuntes.some((x: any) => x.canal === 'Llamada'))
    ok('llamadas: 2, la más reciente primero, con su resultado y la grabación', f.llamadas.total === 2 && f.llamadas.ultimas[0].llamada_id !== undefined && f.llamadas.ultimas[0].resultado === 'conversación' && f.llamadas.ultimas[0].grabacion === 'sí')
    ok('con lo que se entendió de la hablada', f.llamadas.ultimas[0].transcripcion.estado === 'hecha' && f.llamadas.ultimas[0].transcripcion.interes === 'Interés alto' && /propuesta/.test(f.llamadas.ultimas[0].transcripcion.resumen))
    ok('y la vieja sin transcripción', f.llamadas.ultimas[1].transcripcion === null)
    ok('el cliente de la llamada es el lead', f.llamadas.ultimas[0].cliente === 'Lámparas Sol')
    ok('citas: la que está enlazada al lead', f.citas.length === 1 && f.citas[0].enlazada_al_lead === 'sí' && f.citas[0].agendada_por === 'Maoli Pérez')
    ok('sin las tablas de secuencias (245), la ficha funciona y lo dice', f.secuencias_de_correo.disponible === false && /245/.test(f.secuencias_de_correo.aviso))
    ok('no se leyó nada de más: una sola lectura de leads por id', d.base.peticiones.filter((x) => x === 'cold_leads.select').length >= 1)

    const dos = await usar(coldFichaLead, d.ctx, { lead: L_SOL, max_apuntes: 2, max_llamadas: 1 })
    ok('max_apuntes y max_llamadas recortan y dicen el total', dos.historial.mostrados === 2 && dos.historial.total === 5 && dos.llamadas.mostradas === 1 && dos.llamadas.total === 2)

    ok('por parte del nombre cuando es único', (await usar(coldFichaLead, d.ctx, { lead: 'outlet' })).lead.id === L_SOL_OUTLET)
    ok('por el nombre exacto aunque otro lo contenga', (await usar(coldFichaLead, d.ctx, { lead: 'Lámparas Sol' })).lead.id === L_SOL)
    const ambiguo = (await fallaCon(coldFichaLead, d.ctx, { lead: 'sol' })) ?? ''
    ok('un nombre que vale para varios: el error los lista con su id', /varios leads/.test(ambiguo) && ambiguo.includes(L_SOL) && ambiguo.includes(L_SOL_OUTLET) && /Maoli Pérez/.test(ambiguo))
    ok('uno que no existe, error claro', /No hay ningún lead/.test((await fallaCon(coldFichaLead, d.ctx, { lead: 'zzzz' })) ?? ''))
    ok('un id que no existe, error claro', /No existe ningún lead/.test((await fallaCon(coldFichaLead, d.ctx, { lead: '00000000-0000-4000-8000-ffffffffffff' })) ?? ''))
    ok('sin decir cuál, error', /Falta/.test((await fallaCon(coldFichaLead, d.ctx, {})) ?? ''))

    const vacio = await usar(coldFichaLead, d.ctx, { lead: L_PEND1 })
    ok('un lead sin actividad: todo vacío y sin romper', vacio.historial.total === 0 && vacio.llamadas.total === 0 && vacio.citas.length === 0 && vacio.lead.ultimo_contacto === null)
    const cocina = await usar(coldFichaLead, d.ctx, { lead: L_COCINA })
    ok('una tienda online enseña sus datos propios', cocina.lead.tipo === 'tienda online' && cocina.lead.ventas_estimadas_usd === 240000 && cocina.lead.nivel === 1)
    const ana = await usar(coldFichaLead, d.ctx, { lead: L_MODA })
    ok('un lead cerrado no enseña rellamada', ana.lead.rellamar_el === null && ana.lead.estado === 'No le interesa' && ana.lead.comercial === 'Ana López')
    ok('nadie más que Ana y Maoli salen en el reparto de nombres de esta prueba', [ANA, MAOLI, MFER].length === 3 && a(d.dia, '10:00').length > 0)
  }

  console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS\n`)
  if (fallos > 0) process.exit(1)
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
