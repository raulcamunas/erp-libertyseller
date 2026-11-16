/**
 * PRUEBAS DE LAS REGLAS DE LA PANTALLA DE ENVÍOS (reglas.ts).
 *
 *   cd /Users/raulcamunas/Dev/ERP-remesas && npx tsx components/remesas/envios/reglas.prueba.ts
 */
import type { LineaDePanel, RemesaDePanel } from '@/lib/fba/datos'
import {
  cuentasDeEnvio,
  esDelPlan,
  esDudoso,
  faltantesAlCerrar,
  nacioDePropuesta,
  nacioDePropuestaPorHistorial,
  ritmoDeReferencia,
  ritmosDelPlan,
  ventasDeLinea,
  ventasPorSku,
} from './reglas'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

function linea(p: Partial<LineaDePanel> = {}): LineaDePanel {
  return {
    sku: 'A',
    recibidas: null,
    nombre: null,
    variante: null,
    asin: null,
    referencia: null,
    fnsku: null,
    ean: null,
    enviadas: 10,
    consumidas: 0,
    devueltas: 0,
    quedan: 10,
    quedanVendibles: 10,
    retiradas: 0,
    mermas: 0,
    agotadaEl: null,
    porDia: {},
    ...p,
  }
}

function remesa(p: Partial<RemesaDePanel> = {}): RemesaDePanel {
  return {
    id: 'r1',
    nombre: null,
    fechaEnvio: '2026-09-20',
    llegadaAt: null,
    referenciaEnvio: 'FBA15MH74MQB',
    nota: null,
    estadoAmazon: 'IN_TRANSIT',
    seguimientoAt: null,
    seguimientoError: null,
    estado: 'enviada',
    aprobadaAt: null,
    creadaAt: null,
    actualizadaAt: null,
    version: 1,
    reabiertaAt: null,
    ultimaImpresion: null,
    analisisIa: null,
    envios: [],
    unidadesQueNoLlegaron: 0,
    lineas: [linea()],
    eventos: [],
    ventasPorDia: [],
    cuentaDesde: '2026-09-20',
    enviadas: 10,
    quedan: 10,
    consumidoPct: 0,
    agotadaEl: null,
    ...p,
  }
}

console.log('\n=== vendidas: solo ventas ===')
{
  const v = ventasDeLinea({ consumidas: 50, retiradas: 8, mermas: 2 })
  ok('consumidas 50, 8 retiradas y 2 mermas → 40 vendidas', v.ventas === 40 && v.retiradasYMermas === 10, JSON.stringify(v))
  const porSku = ventasPorSku([
    { sku: 'A', consumidas: 10, retiradas: 2, mermas: 0 },
    { sku: 'A', consumidas: 5, retiradas: 0, mermas: 1 },
    { sku: 'B', consumidas: 4, retiradas: 0, mermas: 0 },
  ])
  ok('por SKU, sumando líneas repetidas', porSku.get('A')?.ventas === 12 && porSku.get('A')?.retiradasYMermas === 3 && porSku.get('B')?.ventas === 4)
  const raro = ventasDeLinea({ consumidas: 3, retiradas: 5, mermas: 0 })
  ok('nunca negativas', raro.ventas === 0 && raro.retiradasYMermas === 5, JSON.stringify(raro))
  const c = cuentasDeEnvio(
    remesa({
      quedan: 30,
      lineas: [
        linea({ sku: 'A', enviadas: 60, recibidas: 58, consumidas: 40, retiradas: 5, mermas: 1, quedan: 18, devueltas: 2 }),
        linea({ sku: 'B', enviadas: 20, recibidas: 20, consumidas: 8, quedan: 12 }),
      ],
    })
  )
  ok('enviadas 80, recibidas 78', c.enviadas === 80 && c.recibidas === 78 && !c.sinPreguntar, JSON.stringify(c))
  ok('vendidas 42 (40 − 6 + 8) y retiradas y mermas 6 aparte', c.vendidas === 42 && c.retiradasYMermas === 6 && c.retiradas === 5 && c.mermas === 1, JSON.stringify(c))
  ok('base = lo recibido', c.base === 78)
  const sin = cuentasDeEnvio(remesa({ lineas: [linea({ enviadas: 12 })] }))
  ok('sin preguntar: base = lo enviado', sin.sinPreguntar && sin.base === 12 && sin.recibidas === 0)
  const vacia = cuentasDeEnvio(remesa({ lineas: [], quedan: 0 }))
  ok('sin líneas: base 1 (se puede dividir)', vacia.base === 1 && !vacia.sinPreguntar)
}

console.log('\n=== cerrado con faltantes (D18) ===')
{
  const opinas = remesa({ estadoAmazon: 'CLOSED', lineas: [linea({ enviadas: 162, recibidas: 37 })] })
  ok('Opinas: CLOSED 37 de 162 → 125 no llegaron', faltantesAlCerrar(opinas) === 125, String(faltantesAlCerrar(opinas)))
  ok('Creative Toys: CLOSED 0 de 30 → 30', faltantesAlCerrar(remesa({ estadoAmazon: 'CLOSED', lineas: [linea({ enviadas: 30, recibidas: 0 })] })) === 30)
  ok('faltan 2 de 300 (99 %) → no cuenta', faltantesAlCerrar(remesa({ estadoAmazon: 'CLOSED', lineas: [linea({ enviadas: 300, recibidas: 298 })] })) === null)
  ok('faltan 5 de 300 → sí (≥ 5 ud)', faltantesAlCerrar(remesa({ estadoAmazon: 'CLOSED', lineas: [linea({ enviadas: 300, recibidas: 295 })] })) === 5)
  ok('faltan 2 de 20 (90 %) → sí (< 95 %)', faltantesAlCerrar(remesa({ estadoAmazon: 'CLOSED', lineas: [linea({ enviadas: 20, recibidas: 18 })] })) === 2)
  ok('sin cerrar → no', faltantesAlCerrar(remesa({ estadoAmazon: 'RECEIVING', lineas: [linea({ enviadas: 20, recibidas: 0 })] })) === null)
  ok('cerrado sin preguntar las líneas → no', faltantesAlCerrar(remesa({ estadoAmazon: 'CLOSED', lineas: [linea({ enviadas: 20, recibidas: null })] })) === null)
}

console.log('\n=== envío dudoso (D3) ===')
{
  // FBA15MH74MQB: salió el 20 sep, IN_TRANSIT a 15 nov con 0 de 300 y transporte mediano 16 → 56 días > max(30, 40)
  const r = remesa({ estadoAmazon: 'IN_TRANSIT', fechaEnvio: '2026-09-20', lineas: [linea({ enviadas: 300, recibidas: 0 })] })
  ok('56 días en tránsito sin recibir nada → dudoso', esDudoso(r, '2026-11-15', 16))
  ok('con transporte mediano 30 (umbral 75) → todavía no', !esDudoso(r, '2026-11-15', 30))
  ok('Shoplamp SHIPPED desde el 31 ago → dudoso', esDudoso(remesa({ estadoAmazon: 'SHIPPED', fechaEnvio: '2026-08-31' }), '2026-11-15', null))
  ok('con algo recibido → no', !esDudoso(remesa({ lineas: [linea({ recibidas: 4 })] }), '2026-11-15', 16))
  ok('con la llegada vista en el libro → no', !esDudoso(remesa({ llegadaAt: '2026-10-01' }), '2026-11-15', 16))
  ok('cerrado → no (eso es «cerrado con faltantes»)', !esDudoso(remesa({ estadoAmazon: 'CLOSED' }), '2026-11-15', 16))
  ok('sin número FBA → no', !esDudoso(remesa({ referenciaEnvio: null }), '2026-11-15', 16))
  ok('reciente → no', !esDudoso(remesa({ fechaEnvio: '2026-11-01' }), '2026-11-15', 16))
}

console.log('\n=== de dónde nació ===')
{
  ok('importada (sin huellas) → no se sabe sin historial', !nacioDePropuesta(remesa()))
  ok('boceto reabierto → propuesta', nacioDePropuesta(remesa({ version: 2 })))
  ok('etiquetas impresas → propuesta', nacioDePropuesta(remesa({ ultimaImpresion: { version: 1, etiquetas: 40, impresoAt: '2026-10-01T10:00:00Z' } })))
  ok('aprobada → propuesta', nacioDePropuesta(remesa({ aprobadaAt: '2026-10-01T10:00:00Z' })))
  ok('con envio_propuesto_id (316) → propuesta', nacioDePropuesta({ ...remesa(), envioPropuestoId: 'ep1' } as RemesaDePanel))
  ok('historial con lista → enviada → propuesta', nacioDePropuestaPorHistorial([{ accion: 'estado', hasta: 'enviada' }, { accion: 'envio_amazon' }]))
  ok('historial vacío o solo de Amazon → no', !nacioDePropuestaPorHistorial([]) && !nacioDePropuestaPorHistorial([{ accion: 'envio_amazon' }]))
  ok('una importada que solo se cerró → no', !nacioDePropuestaPorHistorial([{ accion: 'estado', hasta: 'cerrada' }]))
  ok('«Del plan» por envio_propuesto_id', esDelPlan({ ...remesa(), envioPropuestoId: 'ep1' } as RemesaDePanel))
  ok('«Del plan» por el origen del análisis', esDelPlan(remesa({ analisisIa: { origen: 'planificador' } as unknown as RemesaDePanel['analisisIa'] })))
  ok('sin enlace ni origen → no es del plan', !esDelPlan(remesa()))
}

console.log('\n=== ritmo de la referencia ===')
{
  const plan = ritmosDelPlan([
    { sku: 'A', ritmo: { previsto: 2.1, base: 1.9 } },
    { sku: 'B', ritmo: { previsto: null, base: 0.4 } },
    { sku: 'C', ritmo: { previsto: 0, base: 0 } },
  ])
  ok('previsto, o base si no hay; los 0 fuera', plan.get('A') === 2.1 && plan.get('B') === 0.4 && !plan.has('C'))
  const r = ritmoDeReferencia(['A', 'B', 'D', 'A'], plan, [{ sku: 'D', velocidad: 1.5 }])
  ok('suma 2,1 + 0,4 + 1,5 (D del panel) = 4', r.total === 4 && r.origen === 'mixto', JSON.stringify({ t: r.total, o: r.origen }))
  const soloPlan = ritmoDeReferencia(['A'], plan, [])
  ok('solo plan', soloPlan.total === 2.1 && soloPlan.origen === 'plan')
  const nada = ritmoDeReferencia(['Z'], null, [{ sku: 'Z', velocidad: 0 }])
  ok('sin ritmo en ningún sitio → null', nada.total === null && nada.origen === null)
}

console.log(fallos === 0 ? '\nTodo bien.\n' : `\n${fallos} fallo(s).\n`)
if (fallos > 0) process.exit(1)
