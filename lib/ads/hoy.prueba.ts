import { filtroDe, resumenDeHoy, type EstadoParaHoy, type PropuestaParaHoy } from './hoy'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/** «QUÉ HACER HOY»: lo que bloquea va antes que las propuestas, y las propuestas por lo que más dinero mueven */

const AHORA = Date.parse('2026-11-14T09:00:00Z')
const E: EstadoParaHoy = { modo: 'sugiere', firmada: true, terminos: { actualizadoAt: '2026-11-14T06:00:00Z', filas: 40, sincronizando: false, error: null }, sinAcos: [], sinPrecio: [], conPrecioEstimado: [] }
const p = (o: Partial<PropuestaParaHoy> & { tipo: PropuestaParaHoy['tipo'] }): PropuestaParaHoy => ({ estado: 'pendiente', valorActual: null, valorNuevo: null, haciaCampaignId: null, haciaRol: null, metricas: { gasto: 10, ventas: 0, pedidos: 0 }, ...o })
const ids = (r: ReturnType<typeof resumenDeHoy>) => r.tareas.map((t) => t.id).join(',')

console.log('\n=== filtros ===')
ok('una puja que sube y una que baja van a filtros distintos', filtroDe(p({ tipo: 'puja', valorActual: 0.5, valorNuevo: 0.6 })) === 'subir-puja' && filtroDe(p({ tipo: 'puja', valorActual: 0.5, valorNuevo: 0.4 })) === 'bajar-puja')
ok('lo que falló va a «error» sea del tipo que sea', filtroDe(p({ tipo: 'negativizar', estado: 'error' })) === 'error')

console.log('\n=== qué sale ===')
{
  const r = resumenDeHoy([], E, AHORA)
  ok('sin nada pendiente → «Todo al día»', ids(r) === 'al-dia', ids(r))
  ok('apagado → solo el aviso de encenderlo', ids(resumenDeHoy([p({ tipo: 'negativizar' })], { ...E, modo: 'apagado' }, AHORA)) === 'apagado')
}
{
  const r = resumenDeHoy(
    [p({ tipo: 'negativizar', metricas: { gasto: 12.5, ventas: 0, pedidos: 0 } }), p({ tipo: 'negativizar', metricas: { gasto: 7.5, ventas: 0, pedidos: 0 } }), p({ tipo: 'pausar', metricas: { gasto: 30, ventas: 0, pedidos: 0 } }), p({ tipo: 'promover', metricas: { gasto: 9, ventas: 78, pedidos: 3 } }), p({ tipo: 'puja', valorActual: 0.5, valorNuevo: 0.6 })],
    E,
    AHORA
  )
  ok('primero lo que pierde dinero (excluir, pausar), luego lo que mejora', ids(r) === 'negativizar,pausar,promover,subir-puja', ids(r))
  ok('el gasto sin venta recuperable suma excluir + pausar (50,00)', r.gastoSinVentaRecuperable === 50)
  ok('el texto de excluir lleva el dinero', /20,00 gastados/.test(r.tareas[0].detalle), r.tareas[0].detalle)
  ok('cada tarea lleva a su filtro', JSON.stringify(r.tareas[0].ir) === JSON.stringify({ filtro: 'negativizar' }))
  ok('cuenta las pendientes', r.pendientes === 5)
}
{
  const r = resumenDeHoy([p({ tipo: 'promover', metricas: { gasto: 9, ventas: 78, pedidos: 3 } })], E, AHORA)
  ok('cosechar sin campaña de destino lo dice', /no tiene campaña de destino/.test(r.tareas[0].detalle), r.tareas[0].detalle)
}

console.log('\n=== lo que bloquea ===')
{
  const r = resumenDeHoy([p({ tipo: 'negativizar' })], { ...E, sinAcos: [{ asin: 'B0A', resumen: 'JAMONERO' }], sinPrecio: [{ asin: 'B0B', resumen: 'SOPORTE' }] }, AHORA)
  ok('productos sin ACoS objetivo y sin precio van los primeros, con su nombre', ids(r).startsWith('sin-acos,sin-precio') && /JAMONERO/.test(r.tareas[0].detalle) && /SOPORTE/.test(r.tareas[1].detalle), ids(r))
  ok('… y llevan a Productos', JSON.stringify(r.tareas[0].ir) === JSON.stringify({ pestana: 'productos' }))
}
{
  const viejos = resumenDeHoy([], { ...E, terminos: { ...E.terminos, actualizadoAt: '2026-11-12T06:00:00Z' } }, AHORA)
  ok('términos de hace más de 36 h → pedirlos (con los días)', ids(viejos) === 'terminos' && /2 días/.test(viejos.tareas[0].titulo), viejos.tareas[0].titulo)
  ok('nunca leídos → lo dice', /Todavía no/.test(resumenDeHoy([], { ...E, terminos: { ...E.terminos, actualizadoAt: null } }, AHORA).tareas[0].titulo))
  ok('mientras Amazon los prepara, no se pide otra vez', resumenDeHoy([], { ...E, terminos: { ...E.terminos, actualizadoAt: null, sincronizando: true } }, AHORA).tareas[0].id === 'al-dia')
}
{
  const r = resumenDeHoy([p({ tipo: 'negativizar' })], { ...E, firmada: false, conPrecioEstimado: [{ asin: 'B0C', resumen: 'JAMON ENTERO', precio: 109.08 }] }, AHORA)
  ok('precio estimado y ficha sin firmar salen como aviso, después de las propuestas', ids(r) === 'negativizar,precio-estimado,firma', ids(r))
  ok('el precio estimado se enseña', /JAMON ENTERO \(109,08\)/.test(r.tareas[1].detalle), r.tareas[1].detalle)
}
ok('producto con campañas que no está en Productos → el primero de todo', ids(resumenDeHoy([p({ tipo: 'negativizar' })], { ...E, sinFicha: ['B0GV4HNVYG'], sinAcos: [{ asin: 'B0A', resumen: 'X' }] }, AHORA)).startsWith('sin-ficha,sin-acos'))
ok('falta la migración 305 → se avisa', ids(resumenDeHoy([], { ...E, faltaMigracionPausas: true }, AHORA)) === 'migracion-305')

console.log(fallos === 0 ? '\nTODO OK' : `\n${fallos} FALLOS`)
process.exit(fallos === 0 ? 0 : 1)
