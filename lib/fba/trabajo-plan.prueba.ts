import type { CalidadDatos, EnvioPropuestoGuardado, LineaPlan, RitmoSku } from './plan-tipos'
import {
  avisoDatosChat,
  avisosQueTocan,
  avisoTardeChat,
  efectoDeRemesa,
  esVencido,
  pendientes,
  puedeCambiar,
  resumenDiarioChat,
  TRANSICIONES_PLAN,
  urlDeEnvioPropuesto,
  type ClienteParaPendientes,
  type EnvioParaAvisar,
  type RemesaParaPendientes,
} from './trabajo-plan'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

const HOY = '2026-11-15'

const ritmo = (o: Partial<RitmoSku> = {}): RitmoSku => ({
  base: 1, previsto: 1, factorEstacional: 1, perfilSemanal: null, origenPerfil: null, picoAnoPasado: null,
  r14: 1, r30: 1, r60: 1, r90: 1, diasConStock90: 80, ventas90: 90, ventas30: 30, ventas180: 180,
  tendencia: 'estable', confianza: 'alta', origen: 'sku', ultimoPeriodoHasta: null,
  pedidoGrande: false, serieDeStockFiable: true, anclajeEstimado: false, tasaDevolucionVendible: 0, mermaDiaria: 0, consumoNeto: 1,
  explicacion: '', ...o,
})

const linea = (sku: string, o: Partial<LineaPlan> = {}): LineaPlan => ({
  sku, asin: null, fnsku: null, nombre: null, modelo: null, talla: null, precio: 20, moneda: 'EUR',
  vendibles: 50, deCamino: 0, comprometido: 0, reservadas: 0, entranteSinRemesa: 0, dudoso: 0,
  ritmo: ritmo(), coberturaDias: 50, coberturaConLoQueViene: 50, fechaRotura: null, fechaPrimerHueco: null,
  aLaVentaObjetivo: null, salirAntesDe: null, decidirAntesDe: null, vaTarde: false, diasSinStockInevitables: 0,
  coberturaEfectiva: 45, necesidad: 0, tope: 0, cantidad: 0, caja: null, cajas: null,
  eurosEnRiesgo: null, eurosSiVaTarde: null, prioridad: 'este_mes', fuera: null, avisos: [], adelantada: false,
  aLaVentaUrgente: null, porque: '', ajusteIa: null, ...o,
})

const envio = (id: string, o: Partial<EnvioPropuestoGuardado> = {}): EnvioPropuestoGuardado => ({
  id, clienteId: 'c1', clienteNombre: 'Opinas', connectionId: null, clave: `env:c1:x:2026-W49`,
  estado: 'nuevo', prioridad: 'esta_semana', confianza: 'alta', provisional: false, moneda: 'EUR',
  salirAntesDe: '2026-11-25', decidirAntesDe: '2026-11-20', aLaVenta: '2026-12-05', fechaLimite: '2026-11-20',
  responsableId: null, responsableNombre: null, unidades: 412, cajasEstimadas: 9, eurosEnRiesgo: 1900,
  porque: ['80-HGPJ-1F82 vende 2,1 ud/día y se queda sin stock el 30 dic.'],
  lineas: [linea('80-HGPJ-1F82', { cantidad: 412 })], lineasAceptadas: null, cambiosDesdeAyer: null,
  planYaNoLoPide: false, ajustesAplicados: [], ia: null, motivoDescarte: null, nota: null,
  remesaId: null, esperandoDesde: null, pasadaId: null, version: 0,
  creadoAt: '2026-11-10T08:00:00Z', actualizadoAt: '2026-11-10T08:00:00Z', estadoCambiadoAt: '2026-11-10T08:00:00Z',
  vencido: false, ...o,
})

const paraAvisar = (o: Partial<EnvioParaAvisar> = {}): EnvioParaAvisar => ({ ...envio('e1'), prioridadAvisada: null, vencidoAvisadoAt: null, ...o })

const remesa = (id: string, o: Partial<RemesaParaPendientes> = {}): RemesaParaPendientes => ({
  id, clienteId: 'c1', clienteNombre: 'Opinas', nombre: `Remesa ${id}`, referenciaEnvio: `FBA${id}`, estado: 'enviada',
  estadoAmazon: 'RECEIVING', fechaEnvio: '2026-11-01', actualizadaAt: '2026-11-10T10:00:00Z', estadoAmazonDesde: null,
  propuestaEnviadaAt: null, clienteAceptoAt: null, enviadas: 100, recibidas: 0, moneda: 'EUR', ...o,
})

const calidad = (o: Partial<CalidadDatos> = {}): CalidadDatos => ({
  libro: 'ok', leidoHasta: HOY, leidoDesde: '2025-06-01', diasAtraso: 0, ultimoError: null, mercado: 'A1RKKUPIHCS9HS', mercadoRemesa: null,
  sinConexion: false, conexionesActivas: 1, plazoDePartida: false, sinPrecio: 0, provisional: false,
  refsFueraDeCatalogo: 0, pctMerma90: null, calculadoAt: null, horasDesdeCalculo: null, avisos: [], ...o,
})

const cliente = (o: Partial<ClienteParaPendientes> = {}): ClienteParaPendientes => ({
  clienteId: 'c1', clienteNombre: 'Opinas', calidad: calidad(), lineas: [], transporteMediano: 16, moneda: 'EUR', ...o,
})

/* ============================================================================================= */
console.log('\n=== transiciones ===')
{
  ok('nuevo → hablado lo hace la agencia', puedeCambiar('nuevo', 'hablado', 'agencia').ok)
  ok('hablado ⇄ esperando_cliente', puedeCambiar('hablado', 'esperando_cliente', 'agencia').ok && puedeCambiar('esperando_cliente', 'hablado', 'agencia').ok)
  ok('convertir desde nuevo, hablado y esperando', (['nuevo', 'hablado', 'esperando_cliente'] as const).every((d) => puedeCambiar(d, 'en_preparacion', 'agencia').ok))
  const r = puedeCambiar('en_preparacion', 'enviado', 'agencia')
  ok('en_preparacion → enviado no lo hace una persona', !r.ok && /sistema/.test(r.ok ? '' : r.motivo), r.ok ? '' : r.motivo)
  ok('en_preparacion → enviado lo hace el sistema', puedeCambiar('en_preparacion', 'enviado', 'sistema').ok)
  ok('desenlazar (en_preparacion → hablado) agencia y sistema', puedeCambiar('en_preparacion', 'hablado', 'agencia').ok && puedeCambiar('en_preparacion', 'hablado', 'sistema').ok)
  ok('descartar desde activos por decidir', (['nuevo', 'hablado', 'esperando_cliente'] as const).every((d) => puedeCambiar(d, 'descartado', 'agencia').ok))
  ok('no se descarta lo que ya está en preparación', !puedeCambiar('en_preparacion', 'descartado', 'agencia').ok)
  ok('recuperar descartado → nuevo', puedeCambiar('descartado', 'nuevo', 'agencia').ok)
  ok('caducar solo lo pone la pasada', !puedeCambiar('nuevo', 'caducado', 'agencia').ok && puedeCambiar('nuevo', 'caducado', 'sistema').ok)
  ok('el cliente externo no mueve nada', !puedeCambiar('nuevo', 'hablado', 'cliente').ok)
  ok('mismo estado no es transición', !puedeCambiar('hablado', 'hablado', 'agencia').ok)
  ok('caducado no vuelve solo a nuevo', !puedeCambiar('caducado', 'nuevo', 'agencia').ok)
  ok('cada transición tiene quien y texto', TRANSICIONES_PLAN.every((t) => t.quien.length > 0 && t.accion.length > 0))
}

console.log('\n=== caso 57 · transiciones de vuelta (D19) ===')
{
  ok('remesa enviada ⇒ en_preparacion pasa a enviado', efectoDeRemesa('enviada', 'en_preparacion') === 'enviado')
  ok('remesa enviada no toca un hablado', efectoDeRemesa('enviada', 'hablado') === null)
  ok('remesa vuelve a lista ⇒ enviado pasa a en_preparacion', efectoDeRemesa('vuelve_a_lista', 'enviado') === 'en_preparacion')
  ok('vuelve a lista no toca otros estados', efectoDeRemesa('vuelve_a_lista', 'en_preparacion') === null)
  ok('remesa borrada ⇒ en_preparacion vuelve a hablado', efectoDeRemesa('borrada', 'en_preparacion') === 'hablado')
  ok('remesa borrada ⇒ enviado vuelve a hablado', efectoDeRemesa('borrada', 'enviado') === 'hablado')
  ok('remesa borrada no toca un descartado', efectoDeRemesa('borrada', 'descartado') === null)
  ok('los efectos son transiciones válidas del sistema',
    puedeCambiar('enviado', 'en_preparacion', 'sistema').ok && puedeCambiar('enviado', 'hablado', 'sistema').ok)
}

console.log('\n=== vencido ===')
{
  ok('nuevo con límite ayer → vencido', esVencido({ estado: 'nuevo', fechaLimite: '2026-11-14' }, HOY))
  ok('límite hoy → todavía no', !esVencido({ estado: 'nuevo', fechaLimite: HOY }, HOY))
  ok('en_preparacion no vence', !esVencido({ estado: 'en_preparacion', fechaLimite: '2026-11-01' }, HOY))
  ok('descartado no vence', !esVencido({ estado: 'descartado', fechaLimite: '2026-11-01' }, HOY))
}

console.log('\n=== url ===')
{
  ok('url con cliente', urlDeEnvioPropuesto('e1', 'c1') === '/dashboard/remesas?vista=plan&envio=e1&cliente=c1', urlDeEnvioPropuesto('e1', 'c1'))
  ok('url sin cliente', urlDeEnvioPropuesto('e1') === '/dashboard/remesas?vista=plan&envio=e1')
}

/* ============================================================================================= */
console.log('\n=== avisos sin spam ===')
{
  const a = avisosQueTocan(paraAvisar({ prioridad: 'urgente' }), HOY, { avisar: true })
  ok('aparece urgente → un aviso fba_plan:<id>:urgente', a.length === 1 && a[0].clave === 'fba_plan:e1:urgente', JSON.stringify(a.map((x) => x.clave)))
  ok('sin responsable va al grupo', a[0]?.destino === 'grupo')
  ok('url al envío propuesto', a[0]?.url === urlDeEnvioPropuesto('e1', 'c1'))
  ok('el cuerpo dice qué, por qué con cifras y cuándo', /412 ud/.test(a[0]?.cuerpo ?? '') && /1\.900 €/.test(a[0]?.cuerpo ?? '') && /20 nov/.test(a[0]?.cuerpo ?? ''), a[0]?.cuerpo)
  ok('con responsable va al responsable', avisosQueTocan(paraAvisar({ prioridad: 'urgente', responsableId: 'p1' }), HOY, { avisar: true })[0]?.destino === 'responsable')

  ok('el mismo nivel no avisa dos veces', avisosQueTocan(paraAvisar({ prioridad: 'urgente', prioridadAvisada: 'urgente' }), HOY, { avisar: true }).length === 0)
  ok('bajar no avisa (avisado urgente, ahora esta_semana)', avisosQueTocan(paraAvisar({ prioridad: 'esta_semana', prioridadAvisada: 'urgente' }), HOY, { avisar: true }).length === 0)
  const sube = avisosQueTocan(paraAvisar({ prioridad: 'tarde', prioridadAvisada: 'urgente' }), HOY, { avisar: true })
  ok('subir a tarde sí avisa, con su clave', sube.length === 1 && sube[0].clave === 'fba_plan:e1:tarde')
  ok('proximas_2 y este_mes no avisan',
    avisosQueTocan(paraAvisar({ prioridad: 'proximas_2' }), HOY, { avisar: true }).length === 0 &&
    avisosQueTocan(paraAvisar({ prioridad: 'este_mes' }), HOY, { avisar: true }).length === 0)
  ok('avisar = false → nada', avisosQueTocan(paraAvisar({ prioridad: 'tarde' }), HOY, { avisar: false }).length === 0)
  ok('en preparación no avisa', avisosQueTocan(paraAvisar({ prioridad: 'tarde', estado: 'en_preparacion' }), HOY, { avisar: true }).length === 0)

  ok('provisional sin agotados → nada',
    avisosQueTocan(paraAvisar({ prioridad: 'urgente', provisional: true }), HOY, { avisar: true }).length === 0)
  const agotada = linea('X', { vendibles: 0, ritmo: ritmo({ ventas30: 6 }) })
  ok('provisional con un agotado que vende → avisa',
    avisosQueTocan(paraAvisar({ prioridad: 'urgente', provisional: true, lineas: [agotada] }), HOY, { avisar: true }).length === 1)
  const agotadaSinVentas = linea('Y', { vendibles: 0, ritmo: ritmo({ ventas30: 0 }) })
  ok('provisional con agotado SIN ventas recientes → nada',
    avisosQueTocan(paraAvisar({ prioridad: 'urgente', provisional: true, lineas: [agotadaSinVentas] }), HOY, { avisar: true }).length === 0)

  const v = avisosQueTocan(paraAvisar({ prioridad: 'este_mes', fechaLimite: '2026-11-12' }), HOY, { avisar: true })
  ok('al vencer, un aviso fba_plan_vencido:<id>', v.length === 1 && v[0].clave === 'fba_plan_vencido:e1', JSON.stringify(v.map((x) => x.clave)))
  ok('vencido ya avisado → no repite', avisosQueTocan(paraAvisar({ prioridad: 'este_mes', fechaLimite: '2026-11-12', vencidoAvisadoAt: '2026-11-13T07:00:00Z' }), HOY, { avisar: true }).length === 0)
  const ambos = avisosQueTocan(paraAvisar({ prioridad: 'tarde', fechaLimite: '2026-11-12' }), HOY, { avisar: true })
  ok('tarde y vencido a la vez → dos claves distintas', ambos.length === 2 && new Set(ambos.map((x) => x.clave)).size === 2)

  ok('chat inmediato al pasar a tarde', avisoTardeChat(paraAvisar({ prioridad: 'tarde', prioridadAvisada: 'urgente' }), { avisarChat: true })?.clave === 'fba_plan_tarde:e1')
  ok('chat de tarde no se repite', avisoTardeChat(paraAvisar({ prioridad: 'tarde', prioridadAvisada: 'tarde' }), { avisarChat: true }) === null)
  ok('chat de tarde respeta avisarChat', avisoTardeChat(paraAvisar({ prioridad: 'tarde' }), { avisarChat: false }) === null)
  const datos = avisoDatosChat({ clienteId: 'c1', clienteNombre: 'Creative Toys', avisarChat: true }, { diasAtraso: 9, leidoHasta: '2026-11-06' }, HOY)
  ok('libro > 7 días atrasado → aviso semanal fba_datos:<cliente>:<año-W>', datos?.clave === 'fba_datos:c1:2026-W46' && /6 nov/.test(datos.cuerpo), datos?.clave)
  ok('libro 5 días atrasado → nada', avisoDatosChat({ clienteId: 'c1', clienteNombre: 'X', avisarChat: true }, { diasAtraso: 5, leidoHasta: '2026-11-10' }, HOY) === null)
}

console.log('\n=== resumen diario del chat ===')
{
  const cl = [{ clienteId: 'c1', avisarChat: true }, { clienteId: 'c2', avisarChat: true }, { clienteId: 'c3', avisarChat: false }]
  ok('sin tarde, urgentes ni vencidos → nada', resumenDiarioChat([envio('a', { prioridad: 'esta_semana' })], cl, HOY) === null)
  const envios = [
    envio('a', { prioridad: 'urgente', eurosEnRiesgo: 3200, clienteNombre: 'Creative Toys', salirAntesDe: '2026-11-30' }),
    envio('b', { prioridad: 'tarde', eurosEnRiesgo: 500 }),
    envio('c', { prioridad: 'este_mes', fechaLimite: '2026-11-10', eurosEnRiesgo: 100 }), // vencido
    envio('d', { clienteId: 'c2', clienteNombre: 'Portico', prioridad: 'urgente', moneda: 'USD', eurosEnRiesgo: 1200 }),
    envio('e', { clienteId: 'c3', prioridad: 'tarde' }), // sin chat
    envio('f', { prioridad: 'urgente', provisional: true }), // provisional sin agotados
    envio('g', { prioridad: 'urgente', estado: 'en_preparacion' }),
  ]
  const r = resumenDiarioChat(envios, cl, HOY)
  ok('clave fba_plan_dia:<fecha>', r?.clave === `fba_plan_dia:${HOY}`)
  const lineas = (r?.cuerpo ?? '').split('\n').filter((l) => l.startsWith('•'))
  ok('4 envíos (sin el de otro cliente sin chat, ni provisional, ni en preparación)', lineas.length === 4, r?.cuerpo)
  ok('primero lo que va tarde', /ya va tarde/.test(lineas[0] ?? ''), lineas[0])
  ok('formato «**Creative Toys** · tiene que salir antes del **30 nov** · 412 ud · 3.200 € en juego»',
    lineas.some((l) => l.includes('**Creative Toys** · tiene que salir antes del **30 nov** · 412 ud · 3.200 € en juego')), lineas.join(' | '))
  ok('€ por moneda sin convertir', /3\.800 € \+ 1\.200 \$/.test(r?.cuerpo ?? ''), r?.cuerpo.split('\n')[0])
  ok('enlace al plan', (r?.cuerpo ?? '').includes('/dashboard/remesas?vista=plan'))

  const muchos = Array.from({ length: 12 }, (_, i) => envio(`m${i}`, { prioridad: 'urgente', eurosEnRiesgo: 100 + i }))
  const r2 = resumenDiarioChat(muchos, cl, HOY)
  const l2 = (r2?.cuerpo ?? '').split('\n').filter((l) => l.startsWith('•'))
  ok('como mucho 8 líneas, la última «y N más»', l2.length === 8 && /y 5 envíos más/.test(l2[7]), l2[7])
}

/* ============================================================================================= */
console.log('\n=== pendientes de envíos propuestos ===')
{
  const t = pendientes({
    hoy: HOY,
    envios: [
      envio('venc', { fechaLimite: '2026-11-12', prioridad: 'este_mes', eurosEnRiesgo: 900 }),
      envio('urg', { prioridad: 'urgente', fechaLimite: '2026-11-30' }),
      envio('sem', { prioridad: 'esta_semana', responsableId: 'p1', fechaLimite: '2026-11-19', eurosEnRiesgo: 300 }),
      envio('esp', { estado: 'esperando_cliente', esperandoDesde: '2026-11-10', fechaLimite: '2026-12-10', prioridad: 'este_mes', responsableId: 'p1' }),
      envio('tranq', { prioridad: 'este_mes', fechaLimite: '2026-12-10', responsableId: 'p1' }),
      envio('prep', { estado: 'en_preparacion', fechaLimite: '2026-11-01' }),
    ],
    remesas: [],
    clientes: [],
  })
  const tipos = Object.fromEntries(t.map((x) => [x.envioPropuestoId, x.tipo]))
  ok('vencido', tipos.venc === 'envio_vencido')
  ok('urgente sin responsable', tipos.urg === 'sin_responsable')
  ok('vence esta semana', tipos.sem === 'vence_esta_semana')
  ok('esperando ≥ 3 días → «Recuérdaselo»', tipos.esp === 'esperando_cliente' && /Recuérdaselo/.test(t.find((x) => x.envioPropuestoId === 'esp')?.titulo ?? ''))
  ok('lo tranquilo y lo que está en preparación no dan tarea', !tipos.tranq && !tipos.prep)
  ok('un envío da una sola tarea', new Set(t.map((x) => x.envioPropuestoId)).size === t.length)
  ok('van al plan con el envío abierto', t.every((x) => x.ir.vista === 'plan' && x.ir.params?.envio === x.envioPropuestoId))
  ok('ordenado por gravedad: altas primero', t.findIndex((x) => x.gravedad === 'media') > t.findLastIndex((x) => x.gravedad === 'alta'))
  const v = t.find((x) => x.tipo === 'envio_vencido')
  ok('vencido dice qué hacer, cifras y cuenta atrás negativa', /Habla con Opinas/.test(v?.titulo ?? '') && /412 ud/.test(v?.detalle ?? '') && v?.diasRestantes === -3, `${v?.titulo} / ${v?.detalle}`)
}

console.log('\n=== caso 23 bis · envío dudoso (SHIPPED e IN_TRANSIT) ===')
{
  const t = pendientes({
    hoy: HOY,
    envios: [],
    remesas: [
      remesa('it', { estadoAmazon: 'IN_TRANSIT', fechaEnvio: '2026-09-20', enviadas: 300, recibidas: 0 }), // 56 días, transporte 16 → dudoso
      remesa('sh', { estadoAmazon: 'SHIPPED', fechaEnvio: '2026-08-31', enviadas: 29, recibidas: null, clienteId: 'c2', clienteNombre: 'Shoplamp' }),
      remesa('nuevo', { estadoAmazon: 'IN_TRANSIT', fechaEnvio: '2026-10-25', enviadas: 50, recibidas: 0 }), // 21 días: aún no
      remesa('rec', { estadoAmazon: 'RECEIVING', fechaEnvio: '2026-09-01', enviadas: 50, recibidas: 0 }),
    ],
    clientes: [cliente(), cliente({ clienteId: 'c2', clienteNombre: 'Shoplamp', transporteMediano: null })],
  })
  const d = t.filter((x) => x.tipo === 'envio_dudoso').map((x) => x.remesaId).sort()
  ok('IN_TRANSIT 56 días con 0 recibidas y transporte 16 → dudoso', d.includes('it'), d.join())
  ok('SHIPPED desde el 31 ago → dudoso', d.includes('sh'))
  ok('IN_TRANSIT de 21 días → todavía no', !d.includes('nuevo'))
  ok('RECEIVING no es dudoso', !d.includes('rec'))
  const it = t.find((x) => x.remesaId === 'it')
  ok('«Pregunta a Amazon…» con días y unidades', /Pregunta a Amazon/.test(it?.titulo ?? '') && /56 días/.test(it?.detalle ?? '') && /300 ud/.test(it?.detalle ?? ''), it?.detalle)
}

console.log('\n=== caso 58 · cerrado con faltantes ===')
{
  const t = pendientes({
    hoy: HOY,
    envios: [],
    remesas: [
      remesa('op', {
        estado: 'enviada', estadoAmazon: 'CLOSED', referenciaEnvio: 'FBA15MJ18ZCC', enviadas: 162, recibidas: 37,
        estadoAmazonDesde: '2026-11-01',
        lineas: [{ sku: 'A', unidades: 100, recibidas: 20, precio: 30 }, { sku: 'B', unidades: 62, recibidas: 17, precio: null }],
      }),
      remesa('casi', { estado: 'cerrada', estadoAmazon: 'CLOSED', enviadas: 200, recibidas: 199, estadoAmazonDesde: '2026-11-01' }),
      remesa('viejo', { estado: 'cerrada', estadoAmazon: 'CLOSED', enviadas: 30, recibidas: 0, estadoAmazonDesde: '2026-06-18' }),
    ],
    clientes: [cliente()],
  })
  const f = t.find((x) => x.remesaId === 'op')
  ok('CLOSED 37/162 → Pendiente «cerrado con faltantes»', f?.tipo === 'cerrado_con_faltantes')
  ok('con € a precio actual (80 × 30 = 2.400 €)', f?.euros === 2400 && f?.moneda === 'EUR' && /2\.400 €/.test(f?.detalle ?? ''), f?.detalle)
  ok('con cuenta atrás (60 − 14 = 46 días)', f?.diasRestantes === 46 && /46 días para reclamar/.test(f?.detalle ?? ''), String(f?.diasRestantes))
  ok('dice cuántas faltan y el porcentaje', /125 ud/.test(f?.titulo ?? '') && /37 de 162 ud recibidas \(23 %\)/.test(f?.detalle ?? ''), `${f?.titulo} / ${f?.detalle}`)
  ok('y como sigue «enviada», que lo cierre después; sin tarea «cerrar» aparte', /ciérralo/.test(f?.detalle ?? '') && !t.some((x) => x.remesaId === 'op' && x.tipo === 'cerrar_envio'))
  ok('199 de 200 (1 ud, 99,5 %) no es faltante', !t.some((x) => x.remesaId === 'casi'))
  ok('fuera del plazo de reclamación no se enseña', !t.some((x) => x.remesaId === 'viejo'))
}

console.log('\n=== cerrar envío, remesas paradas y «Acepto» sin revisar ===')
{
  const t = pendientes({
    hoy: HOY,
    envios: [],
    remesas: [
      remesa('cer', { estado: 'enviada', estadoAmazon: 'CLOSED', enviadas: 50, recibidas: 50, estadoAmazonDesde: '2026-09-28' }),
      remesa('cer2', { estado: 'enviada', estadoAmazon: 'CLOSED', enviadas: 50, recibidas: 50, estadoAmazonDesde: '2026-11-12' }),
      remesa('enc', { estado: 'encajando', estadoAmazon: null, actualizadaAt: '2026-10-30T09:00:00Z', referenciaEnvio: null }),
      remesa('apr', { estado: 'aprobada', estadoAmazon: null, actualizadaAt: '2026-11-12T09:00:00Z', referenciaEnvio: null }),
      remesa('bor', { estado: 'borrador', estadoAmazon: null, actualizadaAt: '2026-10-02T09:00:00Z', referenciaEnvio: null }),
      remesa('acp', { estado: 'borrador', estadoAmazon: null, propuestaEnviadaAt: '2026-11-10T09:00:00Z', clienteAceptoAt: '2026-11-12T09:00:00Z', actualizadaAt: '2026-11-12T09:00:00Z', referenciaEnvio: null }),
    ],
    clientes: [cliente()],
  })
  const de = (id: string) => t.filter((x) => x.remesaId === id).map((x) => x.tipo)
  ok('CLOSED hace 48 días y en el ERP enviada → «Cerrar envío»', de('cer').join() === 'cerrar_envio')
  ok('CLOSED hace 3 días → aún no', de('cer2').length === 0)
  ok('encajando parada 16 días → remesa parada alta', de('enc').join() === 'remesa_parada' && t.find((x) => x.remesaId === 'enc')?.gravedad === 'alta')
  ok('aprobada parada 3 días → nada', de('apr').length === 0)
  ok('borrador parado 44 días → remesa parada baja (no cuenta como comprometido)', de('bor').join() === 'remesa_parada' && /no lo cuenta/.test(t.find((x) => x.remesaId === 'bor')?.detalle ?? ''))
  ok('«Acepto» del cliente sin revisar', de('acp').join() === 'acepto_sin_revisar')
}

console.log('\n=== entrante sin remesa, modelo agotado, agotados largos, merma y calidad ===')
{
  const lineas = [
    linea('T7-0CG9-DSP7', { entranteSinRemesa: 600 }),
    linea('WM50531', { entranteSinRemesa: 222 }),
    linea('MINI', { entranteSinRemesa: 2 }),
    linea('262 BURDEO/37', { modelo: '262 BURDEO', talla: '37', vendibles: 0, ritmo: ritmo({ base: 0.3, ventas90: 10 }), eurosEnRiesgo: 120 }),
    linea('262 BURDEO/38', { modelo: '262 BURDEO', talla: '38', vendibles: 0, ritmo: ritmo({ base: 0.4, ventas90: 14 }), eurosEnRiesgo: 160 }),
    linea('262 NEGRO/37', { modelo: '262 NEGRO', talla: '37', vendibles: 0, ritmo: ritmo({ ventas90: 5 }) }),
    linea('262 NEGRO/38', { modelo: '262 NEGRO', talla: '38', vendibles: 4, ritmo: ritmo({ ventas90: 5 }) }),
    linea('VIEJO-1', { fuera: 'agotado_largo', vendibles: 0, precio: 25, ritmo: ritmo({ base: 1, origen: 'ultimo_periodo', ultimoPeriodoHasta: '2026-08-03' }) }),
    linea('VIEJO-2', { fuera: 'agotado_largo', vendibles: 0, precio: 10, ritmo: ritmo({ base: 0.5 }) }),
  ]
  const t = pendientes({
    hoy: HOY,
    envios: [],
    remesas: [],
    clientes: [cliente({ clienteNombre: 'Cobo', lineas, calidad: calidad({ pctMerma90: 13.6, diasAtraso: 9, leidoHasta: '2026-11-06', provisional: true, plazoDePartida: true }) })],
  })
  const ent = t.find((x) => x.tipo === 'entrante_sin_remesa')
  ok('entrante sin remesa agrupado por cliente (las de < 5 ud no cuentan)', !!ent && /822 ud/.test(ent.detalle) && /2 referencias/.test(ent.detalle) && !/MINI/.test(ent.detalle), ent?.detalle)
  ok('abre Importar pedidos', ent?.ir.seccion === 'envios' && ent?.ir.params?.importar === '1')
  const mod = t.filter((x) => x.tipo === 'modelo_agotado')
  ok('modelo agotado en todas sus tallas (y no el que tiene una talla con stock)', mod.length === 1 && /262 BURDEO/.test(mod[0].titulo), mod.map((x) => x.titulo).join(' | '))
  ok('modelo agotado sin nada de camino → alta, con € (280)', mod[0]?.gravedad === 'alta' && mod[0]?.euros === 280)
  const ag = t.find((x) => x.tipo === 'agotado_se_repone')
  ok('agotados largos: pregunta al cliente con potencial (25×1×30 + 10×0,5×30 = 900 €)', /Pregunta a Cobo si repone 2 referencias/.test(ag?.titulo ?? '') && ag?.euros === 900 && /3 ago/.test(ag?.detalle ?? ''), `${ag?.titulo} / ${ag?.detalle}`)
  const m = t.find((x) => x.tipo === 'merma_alta')
  ok('merma 13,6 % → revisar embalaje y reclamar (alta)', m?.gravedad === 'alta' && /13,6 %/.test(m?.detalle ?? ''), m?.detalle)
  const q = t.find((x) => x.tipo === 'calidad_datos')
  ok('calidad: 9 días de atraso → alta, «provisional», y el plazo de partida en la misma tarea', q?.gravedad === 'alta' && /6 nov/.test(q?.detalle ?? '') && /provisional/.test(q?.detalle ?? '') && /de partida/.test(q?.detalle ?? ''), q?.detalle)
  ok('una sola tarea de calidad por cliente', t.filter((x) => x.tipo === 'calidad_datos').length === 1)
  const sinNada = pendientes({ hoy: HOY, envios: [], remesas: [], clientes: [cliente()] })
  ok('cliente sano → sin tareas', sinNada.length === 0, sinNada.map((x) => x.tipo).join())
}

console.log('\n=== orden global ===')
{
  const t = pendientes({
    hoy: HOY,
    envios: [envio('barato', { fechaLimite: '2026-11-12', eurosEnRiesgo: 100 }), envio('caro', { fechaLimite: '2026-11-12', eurosEnRiesgo: 5000 })],
    remesas: [remesa('cer', { estado: 'enviada', estadoAmazon: 'CLOSED', enviadas: 50, recibidas: 50, estadoAmazonDesde: '2026-09-28' })],
    clientes: [cliente()],
  })
  ok('dentro de la misma gravedad, más € primero', t[0].envioPropuestoId === 'caro' && t[1].envioPropuestoId === 'barato')
  ok('lo de gravedad baja al final', t[t.length - 1].gravedad === 'baja')
}

console.log('\n=== «dudoso» con la regla del plan (Portico: transporte manual 45 d, sin medida) ===')
{
  // IN_TRANSIT desde hace 35 días sin nada recibido. El plan (umbral max(30, 2,5 × 45) = 112) lo cuenta como stock que llega
  const portico = remesa('po', { clienteId: 'c3', clienteNombre: 'Portico', estadoAmazon: 'IN_TRANSIT', fechaEnvio: '2026-10-11', enviadas: 120, recibidas: 0 })
  const conPlan = pendientes({ hoy: HOY, envios: [], remesas: [portico], clientes: [cliente({ clienteId: 'c3', clienteNombre: 'Portico', transporteMediano: null, transportePlazo: 45 })] })
  ok('con pasada: «Hoy» no lo da por dudoso (lo mismo que el plan)', !conPlan.some((x) => x.tipo === 'envio_dudoso'), conPlan.map((x) => x.tipo).join())
  const sinPlan = pendientes({ hoy: HOY, envios: [], remesas: [portico], clientes: [], transporteSinPlan: { c3: 45 } })
  ok('sin pasada: el plazo manual también manda (regla de respaldo)', !sinPlan.some((x) => x.tipo === 'envio_dudoso'))
  const sinNada = pendientes({ hoy: HOY, envios: [], remesas: [portico], clientes: [] })
  const d = sinNada.find((x) => x.tipo === 'envio_dudoso')
  ok('sin plazo ninguno: umbral 30 → dudoso', !!d)
  ok('sin pasada no se dice «el plan no lo cuenta» (no hay plan)', !!d && !/El plan no lo cuenta/.test(d.detalle), d?.detalle)
  const viejo = pendientes({ hoy: HOY, envios: [], remesas: [remesa('po2', { clienteId: 'c3', estadoAmazon: 'IN_TRANSIT', fechaEnvio: '2026-07-01', enviadas: 10, recibidas: 0 })], clientes: [cliente({ clienteId: 'c3', transporteMediano: null, transportePlazo: 45 })] })
  const v = viejo.find((x) => x.tipo === 'envio_dudoso')
  ok('a los 137 días (> 112) sí es dudoso, y lo dice con el transporte del plazo', !!v && /lo normal son 45 días/.test(v.detalle) && /El plan no lo cuenta/.test(v.detalle), v?.detalle)
}

console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS de ${comprobaciones} comprobaciones\n`)
if (fallos > 0) process.exit(1)
