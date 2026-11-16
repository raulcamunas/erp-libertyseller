/**
 * Pruebas del servidor de envíos propuestos (lib/fba/envios-propuestos-servidor.ts): lo puro y, con una base
 * falsa en memoria, convertir, cambiar (PATCH) y seguir a la remesa (D19, D20, D21, D23).
 *   cd /Users/raulcamunas/Dev/ERP-remesas && npx tsx lib/fba/envios-propuestos-servidor.prueba.ts
 */
import type { SesionFba } from './acceso'
import { baseFalsa, type OpcionesBaseFalsa } from './base-falsa-prueba'
import {
  analisisDelPlan,
  cambiarEnvio,
  convertirEnRemesa,
  ErrorDeEnvio,
  estadosDeParametro,
  eventoDeCambioDeRemesa,
  fechaDeCierre,
  filaAGuardado,
  leerCambio,
  leerEnvios,
  skusAExcluirPorDescatalogada,
  lineasParaRemesa,
  nombreDeRemesaPropuesta,
  seguirARemesa,
  type FilaEnvioPropuesto,
} from './envios-propuestos-servidor'
import type { LineaPlan, PlazoEtapas, RitmoSku } from './plan-tipos'
import { AJUSTES_DE_PARTIDA } from './ajustes-reposicion'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}
const espera = async (n: string, f: () => Promise<unknown>, estado: number, texto?: RegExp) => {
  try {
    await f()
    ok(n, false, 'no lanzó')
  } catch (e) {
    const bien = e instanceof ErrorDeEnvio && e.estado === estado && (!texto || texto.test(e.message))
    ok(n, bien, e instanceof Error ? `${(e as { estado?: number }).estado} ${e.message}` : String(e))
  }
}

const HOY = '2026-11-15'
const CLIENTE = '11111111-1111-4111-8111-111111111111'
const PORTICO = '20c0b8fb-0f9f-4c72-a66f-b4331892611a'
const ENVIO = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
type Servicio = Parameters<typeof convertirEnRemesa>[0]

const sesion = (o: Partial<SesionFba> = {}): SesionFba => ({
  userId: 'u-empleado', role: 'employee', esAdmin: false, actor: 'agencia', clientesPermitidos: null, clientesEditables: null, ...o,
})
const EMPLEADO = sesion()
const ADMIN = sesion({ userId: 'u-admin', role: 'admin', esAdmin: true })

const ritmo = (o: Partial<RitmoSku> = {}): RitmoSku => ({
  base: 1, previsto: 1, factorEstacional: 1, perfilSemanal: null, origenPerfil: null, picoAnoPasado: null,
  r14: 1, r30: 1, r60: 1, r90: 1, diasConStock90: 80, ventas90: 90, ventas30: 30, ventas180: 180,
  tendencia: 'estable', confianza: 'alta', origen: 'sku', ultimoPeriodoHasta: null,
  pedidoGrande: false, serieDeStockFiable: true, anclajeEstimado: false, tasaDevolucionVendible: 0, mermaDiaria: 0, consumoNeto: 1,
  explicacion: '', ...o,
})
const linea = (sku: string, o: Partial<LineaPlan> = {}): LineaPlan => ({
  sku, asin: `B0${sku}`, fnsku: `X0${sku}`, nombre: `Producto ${sku}`, modelo: null, talla: null, precio: 20, moneda: 'EUR',
  vendibles: 10, deCamino: 0, comprometido: 0, reservadas: 0, entranteSinRemesa: 0, dudoso: 0,
  ritmo: ritmo(), coberturaDias: 10, coberturaConLoQueViene: 10, fechaRotura: '2026-11-25', fechaPrimerHueco: '2026-11-25',
  aLaVentaObjetivo: '2026-12-10', salirAntesDe: '2026-11-25', decidirAntesDe: '2026-11-20', vaTarde: false, diasSinStockInevitables: 0,
  coberturaEfectiva: 45, necesidad: 40, tope: 90, cantidad: 40, caja: null, cajas: null,
  eurosEnRiesgo: 300, eurosSiVaTarde: null, prioridad: 'esta_semana', fuera: null, avisos: [], adelantada: false,
  aLaVentaUrgente: null, porque: `${sku} vende 1 ud/día.`, ajusteIa: null, ...o,
})

const fila = (o: Partial<FilaEnvioPropuesto> = {}): FilaEnvioPropuesto => ({
  id: ENVIO, client_id: CLIENTE, connection_id: null, clave: `env:${CLIENTE}:x:2026-W48`, estado: 'nuevo', prioridad: 'esta_semana',
  confianza: 'alta', provisional: false, moneda: 'EUR', salir_antes_de: '2026-11-25', decidir_antes_de: '2026-11-20', a_la_venta: '2026-12-10',
  fecha_limite: '2026-11-20', responsable_id: null, unidades: 52, cajas_estimadas: 2, euros_en_riesgo: '300',
  porque: ['A vende 1 ud/día y se queda sin stock el 25 nov.'],
  lineas: [linea('A'), linea('B', { cantidad: 12, necesidad: 12 }), linea('C', { cantidad: 0, fuera: 'stock_de_sobra', porque: 'C tiene stock de sobra.' })],
  lineas_aceptadas: null, cambios_desde_ayer: null, plan_ya_no_lo_pide: false, ajustes_aplicados: [], ia: null, motivo_descarte: null,
  nota: null, remesa_id: null, esperando_desde: null, pasada_id: null, version: 3,
  creado_at: '2026-11-10T08:00:00Z', actualizado_at: '2026-11-10T08:00:00Z', estado_cambiado_at: '2026-11-10T08:00:00Z', ...o,
})

const PLAZO: PlazoEtapas = {
  preparacion: 3, transporte: 5, recepcion: 7, margen: 3,
  origen: { preparacion: 'partida', transporte: 'partida', recepcion: 'partida', margen: 'partida' },
  hastaLaVenta: 15, sinConfirmar: true, transporteUrgente: null,
}

const base = (o: Partial<OpcionesBaseFalsa> & { envio?: Partial<FilaEnvioPropuesto> } = {}) =>
  baseFalsa({
    unicos: { fba_remesas: [['envio_propuesto_id']] },
    ...o,
    tablas: {
      fba_envios_propuestos: [fila(o.envio) as unknown as Record<string, unknown>],
      amazon_clients: [{ id: CLIENTE, name: 'Opinas' }, { id: PORTICO, name: 'Portico LLC' }],
      profiles: [{ id: 'u-empleado', role: 'employee', full_name: 'Ana' }, { id: 'u-cliente', role: 'cliente', full_name: 'Pepe' }],
      amazon_connections: [{ id: 'con-1', client_id: CLIENTE, is_active: true, region: 'eu' }, { id: 'con-2', client_id: PORTICO, is_active: true, region: 'na' }],
      fba_remesas: [{ id: 'r-vieja', client_id: CLIENTE, estado: 'cerrada', marketplace_id: 'APJ6JRA9NG5V4', fecha_envio: '2026-10-01' }],
      fba_catalogo: [{ id: 'cat-a', client_id: CLIENTE, ref: 'F0047', nombre: 'BURDEOS', talla: '42', ean: '8400000000001', fnsku: 'XCATA', asin: 'BCATA', fbasku: 'A', cod_art: null, continuidad: true, precio: null, nota: null }],
      ...(o.tablas ?? {}),
    },
  })

async function main() {
  console.log('\n1) Lo puro')
  ok('estado vacío → null', estadosDeParametro(null) === null)
  ok('«activos» → los cuatro activos', JSON.stringify(estadosDeParametro('activos')) === JSON.stringify(['nuevo', 'hablado', 'esperando_cliente', 'en_preparacion']))
  ok('lista con basura → solo los que existen', JSON.stringify(estadosDeParametro('nuevo,patata,descartado')) === JSON.stringify(['nuevo', 'descartado']))
  ok('nombre de la remesa', nombreDeRemesaPropuesta('2026-12-13') === 'Reposición · semana 50 (sale antes del 13 dic)', nombreDeRemesaPropuesta('2026-12-13'))
  ok('remesa enviada → evento enviada', eventoDeCambioDeRemesa('lista', 'enviada') === 'enviada')
  ok('enviada → lista → vuelve_a_lista', eventoDeCambioDeRemesa('enviada', 'lista') === 'vuelve_a_lista')
  ok('enviada → cerrada → nada (ya estaba enviado)', eventoDeCambioDeRemesa('enviada', 'cerrada') === null)
  ok('borrador → aprobada → nada', eventoDeCambioDeRemesa('borrador', 'aprobada') === null)
  ok('cierre: el último Receipt si es posterior a la llegada', fechaDeCierre({ llegada_at: '2026-09-28T10:00:00Z', fecha_envio: '2026-09-23' }, '2026-11-05') === '2026-11-05')
  ok('cierre: sin recibos ni llegada, la fecha de envío (no updated_at)', fechaDeCierre({ llegada_at: null, fecha_envio: '2026-06-18' }, null) === '2026-06-18')

  {
    const g = filaAGuardado(fila({ fecha_limite: '2026-11-10', estado: 'hablado' }), { clientes: new Map([[CLIENTE, 'Opinas']]), personas: new Map() }, HOY)
    ok('fila → guardado: vencido si la fecha límite pasó y sigue por decidir', g.vencido && g.clienteNombre === 'Opinas' && g.eurosEnRiesgo === 300)
    const e = filaAGuardado(fila({ fecha_limite: '2026-11-10', estado: 'en_preparacion' }), { clientes: new Map(), personas: new Map() }, HOY)
    ok('…en preparación ya no vence', !e.vencido)
    const raro = filaAGuardado(fila({ estado: 'patata', prioridad: 'x', confianza: null }), { clientes: new Map(), personas: new Map() }, HOY)
    ok('valores desconocidos caen en algo con sentido', raro.estado === 'nuevo' && raro.prioridad === 'este_mes' && raro.confianza === 'media')
  }

  {
    const sinVersion = leerCambio({ estado: 'hablado' })
    ok('PATCH sin versión → error', !sinVersion.ok)
    const descarte = leerCambio({ version: 1, estado: 'descartado' })
    ok('descartar sin motivo → error', !descarte.ok && /motivo/.test(descarte.error))
    const nada = leerCambio({ version: 1 })
    ok('sin nada que cambiar → error', !nada.ok)
    const fecha = leerCambio({ version: 1, fechaLimite: '3/12/2026' })
    ok('fecha mal → error', !fecha.ok)
    const bien = leerCambio({ version: 2, estado: 'descartado', motivoDescarte: 'cliente_no_quiere', nota: '  no quiere  ' })
    ok('descarte bien formado', bien.ok && bien.cambio.motivoDescarte === 'cliente_no_quiere' && bien.cambio.nota === 'no quiere')
    const ajuste = leerCambio({ version: 2, aplicarAjuste: { tipo: 'factor_ritmo', sku: 'A', valor: 1.2, motivo: 'campaña' } })
    ok('ajuste de factor', ajuste.ok && ajuste.cambio.aplicarAjuste?.tipo === 'factor_ritmo')
    const ajusteMalo = leerCambio({ version: 2, aplicarAjuste: { tipo: 'subir_precio', sku: 'A' } })
    ok('ajuste sin forma → error', !ajusteMalo.ok)
  }

  {
    const cat = new Map([['A', { ref: 'F0047', nombre: 'BURDEOS', talla: '42', ean: '840', fnsku: 'XCAT', asin: null }]])
    const ls = lineasParaRemesa([linea('A', { cantidad: 10.4 }), linea('B', { cantidad: 0 }), linea('C', { cantidad: 5, talla: '38' }), linea('A', { cantidad: 2 })], cat)
    ok('fuera las de 0 y se suman las repetidas', ls.length === 2 && ls[0].unidades === 12)
    ok('lo del catálogo manda (ref, nombre, talla, EAN, FNSKU) y el ASIN cae al de la línea', ls[0].referencia === 'F0047' && ls[0].variante === '42' && ls[0].ean === '840' && ls[0].fnsku === 'XCAT' && ls[0].asin === 'B0A')
    ok('sin catálogo, el nombre y la talla del plan', ls[1].referencia === null && ls[1].nombre === 'Producto C' && ls[1].variante === '38')
  }

  {
    const g = filaAGuardado(fila(), { clientes: new Map(), personas: new Map() }, HOY)
    const a = analisisDelPlan(g, g.lineas, { plazo: PLAZO, ajustes: AJUSTES_DE_PARTIDA, ventasHasta: '2026-11-14' }, '2026-11-15T10:00:00Z')
    ok('análisis: una línea por referencia con unidades', Object.keys(a.lineas).join() === 'A,B' && a.lineas.A.origen === 'calculo' && a.lineas.A.propuestas === 40)
    ok('análisis: lo que quedó fuera va en descartadas con su porqué', a.descartadas.length === 1 && a.descartadas[0].sku === 'C' && a.descartadas[0].motivo === 'C tiene stock de sobra.')
    ok('análisis: plazo y ventas', a.parametros.plazoDias === 15 && a.ventasHasta === '2026-11-14' && a.usada === false)
  }

  console.log('\n2) Convertir en remesa (D20, D21)')
  {
    const db = base({ envio: { estado: 'hablado', lineas_aceptadas: [linea('A', { cantidad: 30 }), linea('B', { cantidad: 6 })] } })
    const r = await convertirEnRemesa(db.cliente as Servicio, EMPLEADO, ENVIO, HOY)
    const t = db.tablas()
    const remesa = t.fba_remesas.find((x) => x.id === r.remesaId)
    const env = t.fba_envios_propuestos[0]
    ok('crea la remesa en borrador', remesa?.estado === 'borrador' && !r.yaExistia)
    ok('con lo HABLADO (no con el plan de hoy)', t.fba_remesa_lineas.filter((l) => l.remesa_id === r.remesaId).map((l) => `${l.sku}:${l.unidades}`).join() === 'A:30,B:6')
    ok('rellena con el catálogo', t.fba_remesa_lineas.find((l) => l.sku === 'A')?.referencia === 'F0047' && t.fba_remesa_lineas.find((l) => l.sku === 'A')?.fnsku === 'XCATA')
    ok('mercado = el de su última remesa enviada o cerrada', remesa?.marketplace_id === 'APJ6JRA9NG5V4')
    ok('nombre y fecha prevista = salir antes de', remesa?.nombre === 'Reposición · semana 48 (sale antes del 25 nov)' && remesa?.fecha_envio === '2026-11-25')
    ok('enlaza las dos tablas', remesa?.envio_propuesto_id === ENVIO && env.remesa_id === r.remesaId)
    ok('el envío pasa a en_preparacion y sube la versión', env.estado === 'en_preparacion' && env.version === 4)
    ok('el análisis lo guarda un EMPLEADO de la agencia (D21)', r.analisisGuardado && (remesa?.analisis_ia as { origen?: string })?.origen === 'planificador')
    ok('historial del envío: convertir', (t.fba_envios_propuestos_historial ?? []).some((h) => h.accion === 'convertir' && h.a === 'en_preparacion'))
    ok('historial de la remesa: creada desde el planificador', (t.fba_remesa_historial ?? []).some((h) => h.remesa_id === r.remesaId && h.accion === 'creada'))
    const otra = await convertirEnRemesa(db.cliente as Servicio, EMPLEADO, ENVIO, HOY)
    ok('idempotente: la segunda vez devuelve la misma', otra.remesaId === r.remesaId && otra.yaExistia && db.tablas().fba_remesas.length === 2)
  }
  {
    // Portico: NA y sin remesas enviadas → Amazon.com, nunca el mercado de la lectura
    const db = base({ envio: { client_id: PORTICO }, tablas: { fba_remesas: [], fba_lecturas: [{ connection_id: 'con-2', marketplace_id: 'A2EUQ1WTGCTBG2' }] } })
    const r = await convertirEnRemesa(db.cliente as Servicio, ADMIN, ENVIO, HOY)
    ok('Portico sin enviadas → ATVPDKIKX0DER', db.tablas().fba_remesas.find((x) => x.id === r.remesaId)?.marketplace_id === 'ATVPDKIKX0DER')
    ok('…y no mira las lecturas', !db.operaciones.some((o) => o.tabla === 'fba_lecturas'))
    ok('sin lo hablado, las líneas del plan con unidades', db.tablas().fba_remesa_lineas.length === 2)
  }
  {
    // Reclamar antes de crear: el update condicional va primero
    const db = base()
    await convertirEnRemesa(db.cliente as Servicio, EMPLEADO, ENVIO, HOY)
    const iUpdate = db.operaciones.findIndex((o) => o.tabla === 'fba_envios_propuestos' && o.op === 'update')
    const iInsert = db.operaciones.findIndex((o) => o.tabla === 'fba_remesas' && o.op === 'insert')
    const reclamo = db.operaciones[iUpdate]
    ok('reclama la fila ANTES de crear la remesa', iUpdate >= 0 && iUpdate < iInsert)
    ok('…con estado por decidir y sin remesa', reclamo.filtros.some((f) => f.tipo === 'in' && f.columna === 'estado') && reclamo.filtros.some((f) => f.tipo === 'is' && f.columna === 'remesa_id'))
  }
  {
    // Si crear falla, se deshace el estado
    const db = base({ fallar: (q) => (q.tabla === 'fba_remesa_lineas' && q.op === 'insert' ? { code: '23514', message: 'check' } : null) })
    let lanzo = false
    try { await convertirEnRemesa(db.cliente as Servicio, EMPLEADO, ENVIO, HOY) } catch { lanzo = true }
    const env = db.tablas().fba_envios_propuestos[0]
    ok('si crear falla, lanza', lanzo)
    ok('…el envío vuelve a «nuevo» con su versión', env.estado === 'nuevo' && env.version === 3 && env.remesa_id === null)
    ok('…y no queda remesa a medias', db.tablas().fba_remesas.length === 1)
  }
  {
    // Otra persona lo reclamó entre medias (la fila ya no está en un estado por decidir)
    const db = base({ envio: { estado: 'descartado', motivo_descarte: 'otro' } })
    await espera('descartado → 409 con el motivo de puedeCambiar', () => convertirEnRemesa(db.cliente as Servicio, EMPLEADO, ENVIO, HOY), 409)
  }
  {
    const db = base({ envio: { lineas: [linea('A', { cantidad: 0 })] } })
    await espera('sin unidades → 409', () => convertirEnRemesa(db.cliente as Servicio, EMPLEADO, ENVIO, HOY), 409, /nada que convertir/)
  }
  {
    const db = base()
    await espera('cliente que no puede editar → 404', () => convertirEnRemesa(db.cliente as Servicio, sesion({ clientesEditables: [PORTICO] }), ENVIO, HOY), 404)
  }
  {
    const db = base({ sinTablas: ['fba_envios_propuestos'] })
    await espera('sin la 316 → 409 con el aviso', () => convertirEnRemesa(db.cliente as Servicio, EMPLEADO, ENVIO, HOY), 409, /migración 316/)
    const r = await leerEnvios(db.cliente as Servicio, { clientesPermitidos: null }, {}, HOY)
    ok('sin la 316, leer devuelve vacío y migracion316 = false', r.envios.length === 0 && r.migracion316 === false)
  }

  console.log('\n3) Cambiar (PATCH, D23)')
  {
    const db = base()
    await espera('versión vieja → 409', () => cambiarEnvio(db.cliente as Servicio, EMPLEADO, ENVIO, { version: 2, estado: 'hablado' }, HOY), 409, /cambiado/)
    const r = await cambiarEnvio(db.cliente as Servicio, EMPLEADO, ENVIO, { version: 3, estado: 'hablado' }, HOY)
    const env = db.tablas().fba_envios_propuestos[0]
    ok('nuevo → hablado congela lineas_aceptadas', Array.isArray(env.lineas_aceptadas) && (env.lineas_aceptadas as unknown[]).length === 3)
    ok('…sube la versión', env.version === 4 && r.envio.version === 4)
    ok('…y deja historial', (db.tablas().fba_envios_propuestos_historial ?? []).some((h) => h.accion === 'estado' && h.de === 'nuevo' && h.a === 'hablado'))
    await espera('a en_preparacion solo con convertir', () => cambiarEnvio(db.cliente as Servicio, EMPLEADO, ENVIO, { version: 4, estado: 'en_preparacion' }, HOY), 409, /Convertir/)
    await espera('asignar a otra persona sin ser admin → 403', () => cambiarEnvio(db.cliente as Servicio, EMPLEADO, ENVIO, { version: 4, responsableId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }, HOY), 403)
    await cambiarEnvio(db.cliente as Servicio, EMPLEADO, ENVIO, { version: 4, responsableId: 'u-empleado' }, HOY)
    ok('asignarse a uno mismo vale', db.tablas().fba_envios_propuestos[0].responsable_id === 'u-empleado')
    await espera('el admin no puede asignar a alguien de fuera del equipo', () => cambiarEnvio(db.cliente as Servicio, ADMIN, ENVIO, { version: 5, responsableId: 'u-cliente' }, HOY), 400)
    const f = await cambiarEnvio(db.cliente as Servicio, EMPLEADO, ENVIO, { version: 5, fechaLimite: '2026-11-24' }, HOY)
    ok('fecha límite después de decidir antes de → aviso', !!f.aviso && /rotura/.test(f.aviso))
  }
  {
    const db = base()
    await cambiarEnvio(db.cliente as Servicio, EMPLEADO, ENVIO, { version: 3, aplicarAjuste: { tipo: 'excluir', sku: 'B', motivo: 'el cliente no tiene' } }, HOY)
    const env = db.tablas().fba_envios_propuestos[0]
    const b = (env.lineas as LineaPlan[]).find((l) => l.sku === 'B')
    ok('ajuste «excluir»: la línea queda a 0 y las unidades se recalculan', b?.cantidad === 0 && env.unidades === 40)
    ok('…queda apuntado el ajuste', (env.ajustes_aplicados as unknown[]).length === 1)
  }
  {
    const db = base()
    const r = await cambiarEnvio(db.cliente as Servicio, EMPLEADO, ENVIO, { version: 3, aplicarAjuste: { tipo: 'factor_ritmo', sku: 'A', valor: 1.3, motivo: 'campaña de Navidad' } }, HOY)
    const a = r.envio.lineas.find((l) => l.sku === 'A')
    const h = (db.tablas().fba_envios_propuestos_historial ?? []).find((x) => x.accion === 'ajuste_ia')
    const datos = h?.datos as { antes: number; despues: number } | undefined
    ok('ajuste ×1,3 del ritmo: lo recalcula la aritmética y sube', !!a && a.cantidad > 40 && a.ajusteIa?.tipo === 'factor_ritmo', `${a?.cantidad}`)
    ok('…historial con antes y después', datos?.antes === 40 && datos?.despues === a?.cantidad)
  }
  {
    const db = base()
    await espera('ajuste con un factor fuera de rango → 422', () => cambiarEnvio(db.cliente as Servicio, EMPLEADO, ENVIO, { version: 3, aplicarAjuste: { tipo: 'factor_ritmo', sku: 'A', valor: 3, motivo: 'x' } }, HOY), 422)
    await espera('ajuste a una referencia que no está → 422', () => cambiarEnvio(db.cliente as Servicio, EMPLEADO, ENVIO, { version: 3, aplicarAjuste: { tipo: 'excluir', sku: 'ZZZ', motivo: 'x' } }, HOY), 422)
  }
  {
    const db = base()
    const r = await cambiarEnvio(db.cliente as Servicio, EMPLEADO, ENVIO, { version: 3, estado: 'descartado', motivoDescarte: 'descatalogada' }, HOY)
    const sku = db.tablas().fba_reposicion_sku ?? []
    ok('«descatalogada» en un envío de 2 referencias sin decir cuáles: no excluye ninguna', sku.length === 0, JSON.stringify(sku))
    ok('…y avisa de dónde excluirlas', !!r.aviso && /Reposición/.test(r.aviso), String(r.aviso))
    ok('…pero el envío queda descartado', r.envio.estado === 'descartado')
  }
  {
    const db = base()
    await cambiarEnvio(db.cliente as Servicio, EMPLEADO, ENVIO, { version: 3, estado: 'descartado', motivoDescarte: 'descatalogada', skusDescatalogados: ['A'] }, HOY)
    const sku = db.tablas().fba_reposicion_sku ?? []
    ok('diciendo cuál: solo esa se excluye (D8)', sku.length === 1 && sku[0].sku === 'A' && sku[0].excluir === true, JSON.stringify(sku))
  }
  {
    ok('una sola referencia: se excluye', skusAExcluirPorDescatalogada([{ sku: 'X', cantidad: 12, fuera: null }]).skus.join() === 'X')
    ok('todas «agotado hace mucho»: se excluyen', skusAExcluirPorDescatalogada([{ sku: 'X', cantidad: 0, fuera: 'agotado_largo' }, { sku: 'Y', cantidad: 0, fuera: 'agotado_largo' }]).skus.join() === 'X,Y')
    const v = leerCambio({ version: 1, estado: 'descartado', motivoDescarte: 'descatalogada', skusDescatalogados: ['A', 7] })
    ok('skusDescatalogados con algo que no es texto → error', !v.ok)
  }

  console.log('\n4) El envío sigue a su remesa (D19)')
  {
    const db = base({ envio: { estado: 'en_preparacion', remesa_id: 'r-1' } })
    const a = await seguirARemesa(db.cliente as Servicio, 'r-1', 'enviada', 'u-1')
    ok('remesa enviada → envío «enviado»', a?.a === 'enviado' && db.tablas().fba_envios_propuestos[0].estado === 'enviado')
    ok('…sin tocar la versión (lo hace el sistema)', db.tablas().fba_envios_propuestos[0].version === 3)
    const b = await seguirARemesa(db.cliente as Servicio, 'r-1', 'vuelve_a_lista', 'u-1')
    ok('enviada → lista → «en preparación»', b?.a === 'en_preparacion')
    const c = await seguirARemesa(db.cliente as Servicio, 'r-1', 'borrada', 'u-1', ENVIO)
    const env = db.tablas().fba_envios_propuestos[0]
    ok('remesa borrada → «hablado» y sin remesa', c?.a === 'hablado' && env.estado === 'hablado' && env.remesa_id === null)
    ok('…con la nota remesa_borrada', (db.tablas().fba_envios_propuestos_historial ?? []).some((h) => h.accion === 'remesa_borrada' && h.nota === 'remesa_borrada'))
  }
  {
    const db = base({ envio: { estado: 'en_preparacion', remesa_id: 'r-otra' } })
    const r = await seguirARemesa(db.cliente as Servicio, 'r-1', 'borrada', 'u-1', ENVIO)
    ok('un envío enlazado a OTRA remesa no se toca', r === null && db.tablas().fba_envios_propuestos[0].estado === 'en_preparacion')
  }
  {
    const db = base({ sinTablas: ['fba_envios_propuestos'] })
    ok('sin la 316 se ignora', (await seguirARemesa(db.cliente as Servicio, 'r-1', 'enviada', 'u-1')) === null)
  }

  console.log(`\n${comprobaciones - fallos}/${comprobaciones} comprobaciones bien`)
  if (fallos > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
