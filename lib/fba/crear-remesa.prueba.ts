/**
 * Pruebas del alta de remesas (lib/fba/crear-remesa.ts), con una base falsa en memoria.
 *   cd /Users/raulcamunas/Dev/ERP-remesas && npx tsx lib/fba/crear-remesa.prueba.ts
 */
import type { SesionFba } from './acceso'
import { baseFalsa } from './base-falsa-prueba'
import { crearRemesa, ErrorDeRemesa, MAX_LINEAS_REMESA, puedeGuardarAnalisis, validarRemesaNueva, type RemesaNueva } from './crear-remesa'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

const CLIENTE = '11111111-1111-4111-8111-111111111111'
const OTRO = '22222222-2222-4222-8222-222222222222'
type Servicio = Parameters<typeof crearRemesa>[0]

const sesion = (o: Partial<SesionFba>): SesionFba => ({
  userId: 'u-1', role: 'employee', esAdmin: false, actor: 'agencia', clientesPermitidos: null, clientesEditables: null, ...o,
})
// Un empleado con la casilla `remesas` (D27): agencia, edita todos, NO es admin
const EMPLEADO_CON_CASILLA = sesion({ userId: 'u-empleado' })
const ADMIN = sesion({ userId: 'u-admin', role: 'admin', esAdmin: true })
const CLIENTE_EXTERNO = sesion({ userId: 'u-cliente', role: 'cliente', actor: 'cliente', clientesPermitidos: [CLIENTE], clientesEditables: [CLIENTE] })
const EMPLEADO_SOLO_LECTURA = sesion({ userId: 'u-lector', clientesPermitidos: [CLIENTE, OTRO], clientesEditables: [OTRO] })

const ANALISIS = {
  version: 1, generadaEn: '2026-11-15T10:00:00Z', ventasHasta: '2026-11-14', modelo: 'gpt-6-luna', usada: true, aviso: null,
  resumen: 'Repón lo que vende', estrategia: null, riesgos: [], dudas: [], notas: [],
  parametros: { coberturaObjetivo: 45, plazoDias: 21, margenDias: 3, multiplo: 1, minimoLinea: 3, topeUnidades: null, notas: '' },
  lineas: { 'SKU-1': { motivo: 'vende 2 al día', prioridad: 'alta', confianza: 'media', origen: 'calculo', base: 40, propuestas: 40 } },
  descartadas: [],
}

const cuerpo = (o: Record<string, unknown> = {}) => ({
  marketplaceId: 'A1RKKUPIHCS9HS', fechaEnvio: '2026-11-20', nombre: '  Reposición  ', nota: '',
  lineas: [{ sku: ' SKU-1 ', unidades: 40, nombre: 'Taza' }, { sku: 'SKU-2', unidades: '12' }],
  analisisIa: ANALISIS,
  ...o,
})

const datosValidos = (o: Record<string, unknown> = {}): RemesaNueva => {
  const r = validarRemesaNueva(cuerpo(o), CLIENTE)
  if (!r.ok) throw new Error(r.error)
  return r.datos
}

async function main() {
  console.log('\n1) Validación (los textos de siempre)')
  {
    const r = validarRemesaNueva(cuerpo(), CLIENTE)
    ok('cuerpo válido', r.ok)
    if (r.ok) {
      ok('limpia el SKU y el nombre', r.datos.lineas[0].sku === 'SKU-1' && r.datos.nombre === 'Reposición')
      ok('acepta unidades en texto si son enteras', r.datos.lineas[1].unidades === 12)
      ok('nota vacía = null', r.datos.nota === null)
    }
    const sinMercado = validarRemesaNueva(cuerpo({ marketplaceId: '' }), CLIENTE)
    ok('sin mercado → 400', !sinMercado.ok && sinMercado.estado === 400 && sinMercado.error === 'Falta el mercado de la remesa')
    const fecha = validarRemesaNueva(cuerpo({ fechaEnvio: '20/11/2026' }), CLIENTE)
    ok('fecha mal → texto de siempre', !fecha.ok && fecha.error.includes('2026-09-18'))
    const vacia = validarRemesaNueva(cuerpo({ lineas: [] }), CLIENTE)
    ok('sin líneas → no es una remesa', !vacia.ok && vacia.error.startsWith('Una remesa sin referencias'))
    const repetida = validarRemesaNueva(cuerpo({ lineas: [{ sku: 'A', unidades: 1 }, { sku: 'A', unidades: 2 }] }), CLIENTE)
    ok('SKU repetido → error', !repetida.ok && repetida.error.includes('El SKU A está dos veces'))
    const cero = validarRemesaNueva(cuerpo({ lineas: [{ sku: 'A', unidades: 0 }] }), CLIENTE)
    ok('unidades 0 → error', !cero.ok && cero.error.includes('mayor que cero'))
    const decimal = validarRemesaNueva(cuerpo({ lineas: [{ sku: 'A', unidades: 1.5 }] }), CLIENTE)
    ok('unidades con decimales → error', !decimal.ok)
    const sinSku = validarRemesaNueva(cuerpo({ lineas: [{ unidades: 3 }] }), CLIENTE)
    ok('línea sin SKU → dice cuál', !sinSku.ok && sinSku.error === 'La línea 1 no tiene SKU')
    const muchas = validarRemesaNueva(cuerpo({ lineas: Array.from({ length: MAX_LINEAS_REMESA + 1 }, (_, i) => ({ sku: `S${i}`, unidades: 1 })) }), CLIENTE)
    ok('más del máximo → error', !muchas.ok && muchas.error.includes(String(MAX_LINEAS_REMESA)))
    const basura = validarRemesaNueva(null, CLIENTE)
    ok('cuerpo nulo no revienta', !basura.ok)
  }

  console.log('\n2) Quién guarda el análisis de la IA (D21)')
  ok('empleado con la casilla (no admin) → sí', puedeGuardarAnalisis(EMPLEADO_CON_CASILLA, CLIENTE))
  ok('admin → sí', puedeGuardarAnalisis(ADMIN, CLIENTE))
  ok('cliente externo, aunque edite → no', !puedeGuardarAnalisis(CLIENTE_EXTERNO, CLIENTE))
  ok('empleado de solo lectura en ese cliente → no', !puedeGuardarAnalisis(EMPLEADO_SOLO_LECTURA, CLIENTE))
  ok('…y en el que edita → sí', puedeGuardarAnalisis(EMPLEADO_SOLO_LECTURA, OTRO))

  console.log('\n3) Alta con la base falsa')
  {
    const db = baseFalsa({ tablas: { amazon_connections: [{ id: 'con-1', client_id: CLIENTE, is_active: true }] } })
    const r = await crearRemesa(db.cliente as Servicio, EMPLEADO_CON_CASILLA, datosValidos())
    ok('analisisGuardado = true para un empleado con la casilla (D21)', r.analisisGuardado === true, JSON.stringify(r))
    const cab = db.tablas().fba_remesas?.[0]
    ok('nace en borrador', cab?.estado === 'borrador')
    ok('con la conexión del cliente', cab?.connection_id === 'con-1')
    ok('created_by = quien la crea', cab?.created_by === 'u-empleado')
    ok('el análisis está en la fila', !!cab?.analisis_ia && (cab.analisis_ia as { resumen: string }).resumen === 'Repón lo que vende')
    ok('sin envío propuesto no escribe la columna', !('envio_propuesto_id' in (cab ?? {})))
    ok('dos líneas con su remesa', db.tablas().fba_remesa_lineas?.length === 2 && db.tablas().fba_remesa_lineas.every((l) => l.remesa_id === r.id))
    ok('devuelve el número de líneas', r.lineas === 2)
  }
  {
    const db = baseFalsa()
    const r = await crearRemesa(db.cliente as Servicio, CLIENTE_EXTERNO, datosValidos())
    ok('cliente externo: la remesa se crea pero sin análisis', r.analisisGuardado === false && !('analisis_ia' in (db.tablas().fba_remesas?.[0] ?? {})))
    ok('sin conexión (ShoesF) → connection_id null', db.tablas().fba_remesas?.[0]?.connection_id === null)
  }
  {
    const db = baseFalsa({ sinColumnas: { fba_remesas: ['analisis_ia'] } })
    const r = await crearRemesa(db.cliente as Servicio, ADMIN, datosValidos())
    ok('sin la 230: se crea igual y analisisGuardado = false', r.analisisGuardado === false && db.tablas().fba_remesas?.length === 1)
  }
  {
    const db = baseFalsa()
    const r = await crearRemesa(db.cliente as Servicio, ADMIN, datosValidos({ analisisIa: 'esto no es un análisis' }))
    ok('un análisis sin forma no se guarda', r.analisisGuardado === false)
  }
  {
    const db = baseFalsa()
    const r = await crearRemesa(db.cliente as Servicio, ADMIN, datosValidos(), { envioPropuestoId: 'env-1', extraAnalisis: { origen: 'planificador' } })
    const cab = db.tablas().fba_remesas?.[0]
    ok('con envío propuesto: enlaza la remesa', r.enlazadaAlEnvio && cab?.envio_propuesto_id === 'env-1')
    ok('el extra del análisis se añade', (cab?.analisis_ia as { origen?: string })?.origen === 'planificador')
  }
  {
    const db = baseFalsa({ sinColumnas: { fba_remesas: ['envio_propuesto_id'] } })
    const r = await crearRemesa(db.cliente as Servicio, ADMIN, datosValidos(), { envioPropuestoId: 'env-1' })
    ok('sin la 316: se crea sin el enlace y CON el análisis', !r.enlazadaAlEnvio && r.analisisGuardado && db.tablas().fba_remesas?.length === 1)
  }
  {
    const db = baseFalsa({ sinColumnas: { fba_remesas: ['envio_propuesto_id', 'analisis_ia'] } })
    const r = await crearRemesa(db.cliente as Servicio, ADMIN, datosValidos(), { envioPropuestoId: 'env-1' })
    ok('sin la 230 ni la 316: se crea pelada', !r.enlazadaAlEnvio && !r.analisisGuardado && db.tablas().fba_remesas?.length === 1)
  }
  {
    const db = baseFalsa({ tablas: { fba_remesas: [{ id: 'r-vieja', envio_propuesto_id: 'env-1' }] }, unicos: { fba_remesas: [['envio_propuesto_id']] } })
    let error: unknown = null
    try { await crearRemesa(db.cliente as Servicio, ADMIN, datosValidos(), { envioPropuestoId: 'env-1' }) } catch (e) { error = e }
    ok('segunda remesa del mismo envío propuesto → 409 «ya_convertido»', error instanceof ErrorDeRemesa && error.estado === 409 && error.codigo === 'ya_convertido')
    ok('…y no deja nada a medias', db.tablas().fba_remesas.length === 1 && (db.tablas().fba_remesa_lineas ?? []).length === 0)
  }
  {
    const db = baseFalsa({ fallar: (q) => (q.tabla === 'fba_remesa_lineas' && q.op === 'insert' ? { code: '23514', message: 'check violation' } : null) })
    let error: unknown = null
    try { await crearRemesa(db.cliente as Servicio, ADMIN, datosValidos()) } catch (e) { error = e }
    ok('si las líneas fallan, lanza el error de la base', !!error && (error as { code?: string }).code === '23514')
    ok('…y la cabecera se borra (el rescate)', (db.tablas().fba_remesas ?? []).length === 0)
  }

  console.log(`\n${comprobaciones - fallos}/${comprobaciones} comprobaciones bien`)
  if (fallos > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
