/**
 * Pruebas de ajustes-api.ts (paquete S6). `cd /Users/raulcamunas/Dev/ERP-remesas && npx tsx lib/fba/ajustes-api.prueba.ts`
 */
import assert from 'node:assert/strict'
import {
  TEXTO_FALTA_291,
  TEXTO_SIN_PLAZO_GUARDADO,
  cajasDelEncaje,
  cambiosConfigAlertas,
  cantidadesPorSku,
  configParaPlazo,
  etapasDeFila,
  filaSkuFusionada,
  medidasDesdeEnvios,
  recibosSinDuplicar,
  validarCambiosSku,
  type FilaConfigAlertas,
  type FilaReposicionSku,
} from './ajustes-api'
import { cajaDeducida } from './medidas-cliente'
import { plazoDelCliente } from './planificador'

let pasadas = 0
function prueba(nombre: string, fn: () => void) {
  try {
    fn()
    pasadas++
  } catch (e) {
    console.error(`✗ ${nombre}`)
    throw e
  }
}

const VIGENTES = { preparacion: 7, transporte: 6, recepcion: 4, margen: 7 }
const FILA_TOTAL: FilaConfigAlertas = { plazo_reposicion_dias: 45, antelacion_dias: 10, avisar: false, dias_preparacion: null, dias_transporte: null, dias_recepcion: null, margen_dias: null }
const FILA_ETAPAS: FilaConfigAlertas = { plazo_reposicion_dias: 30, antelacion_dias: 10, avisar: false, dias_preparacion: 10, dias_transporte: 10, dias_recepcion: 5, margen_dias: 5 }

/* ---------------- PUT parcial de la config de plazos ---------------- */

prueba('solo avisar con fila previa: no fuerza antelación 14 ni toca el plazo', () => {
  const r = cambiosConfigAlertas({ avisar: true }, FILA_TOTAL, { vigentes: null, sinMigrar291: false })
  assert.ok(r.ok)
  assert.deepEqual(r.cambios, { avisar: true })
})

prueba('solo antelación con fila previa', () => {
  const r = cambiosConfigAlertas({ antelacionDias: 20 }, FILA_ETAPAS, { vigentes: null, sinMigrar291: false })
  assert.ok(r.ok)
  assert.deepEqual(r.cambios, { antelacion_dias: 20 })
})

prueba('sin fila previa y solo avisar: se rechaza (guardaría 45 días como manuales)', () => {
  const r = cambiosConfigAlertas({ avisar: false }, null, { vigentes: null, sinMigrar291: false })
  assert.ok(!r.ok)
  assert.equal(r.status, 400)
  assert.equal(r.error, TEXTO_SIN_PLAZO_GUARDADO)
})

prueba('lo de PlazosDialog: etapas + antelación + avisar', () => {
  const r = cambiosConfigAlertas({ etapas: { preparacion: 5, transporte: 6, recepcion: 4, margen: 3 }, antelacionDias: 14, avisar: true }, null, { vigentes: null, sinMigrar291: false })
  assert.ok(r.ok)
  assert.deepEqual(r.cambios, { plazo_reposicion_dias: 18, dias_preparacion: 5, dias_transporte: 6, dias_recepcion: 4, margen_dias: 3, antelacion_dias: 14, avisar: true })
  assert.equal(r.confirmadas, null)
})

prueba('lo de PanelAlertas: plazoDias que no cuadra con las etapas las borra', () => {
  const r = cambiosConfigAlertas({ plazoDias: 40, antelacionDias: 14, avisar: true }, FILA_ETAPAS, { vigentes: null, sinMigrar291: false })
  assert.ok(r.ok)
  assert.equal(r.cambios?.plazo_reposicion_dias, 40)
  assert.equal(r.cambios?.dias_preparacion, null)
  assert.equal(r.cambios?.margen_dias, null)
})

prueba('plazoDias que cuadra con las etapas no las borra', () => {
  const r = cambiosConfigAlertas({ plazoDias: 30 }, FILA_ETAPAS, { vigentes: null, sinMigrar291: false })
  assert.ok(r.ok)
  assert.deepEqual(r.cambios, { plazo_reposicion_dias: 30 })
})

prueba('confirmarPlazos guarda las vigentes como manuales, sin tocar antelación ni aviso', () => {
  const r = cambiosConfigAlertas({ confirmarPlazos: true }, null, { vigentes: VIGENTES, sinMigrar291: false })
  assert.ok(r.ok)
  assert.deepEqual(r.cambios, { plazo_reposicion_dias: 24, dias_preparacion: 7, dias_transporte: 6, dias_recepcion: 4, margen_dias: 7 })
  assert.deepEqual(r.confirmadas, VIGENTES)
})

prueba('confirmarPlazos con etapas: mandan las etapas', () => {
  const r = cambiosConfigAlertas({ confirmarPlazos: true, etapas: { preparacion: 1, transporte: 2, recepcion: 3, margen: 4 } }, null, { vigentes: VIGENTES, sinMigrar291: false })
  assert.ok(r.ok)
  assert.equal(r.cambios?.plazo_reposicion_dias, 10)
  assert.equal(r.confirmadas, null)
})

prueba('confirmarPlazos sin la 291: 409', () => {
  const r = cambiosConfigAlertas({ confirmarPlazos: true }, null, { vigentes: VIGENTES, sinMigrar291: true })
  assert.ok(!r.ok)
  assert.equal(r.status, 409)
  assert.equal(r.error, TEXTO_FALTA_291)
})

prueba('confirmar y luego plazoDelCliente: las cuatro etapas manuales y sin la banda', () => {
  const medidas = { transporteMediano: 6, recepcionP75: 4, enviosMedidos: 3, cadenciaDias: 13, tamanoTipico: 110 }
  const antes = plazoDelCliente(null, medidas, '2026-06-15', { transporteUrgenteDias: null })
  assert.equal(antes.sinConfirmar, true)
  assert.equal(antes.origen.transporte, 'medido')
  const r = cambiosConfigAlertas({ confirmarPlazos: true }, null, { vigentes: antes, sinMigrar291: false })
  assert.ok(r.ok && r.cambios)
  const fila = { antelacion_dias: 14, avisar: true, ...r.cambios } as unknown as FilaConfigAlertas
  const despues = plazoDelCliente(configParaPlazo(fila), medidas, '2026-06-15', { transporteUrgenteDias: null })
  assert.equal(despues.sinConfirmar, false)
  assert.deepEqual(despues.origen, { preparacion: 'manual', transporte: 'manual', recepcion: 'manual', margen: 'manual' })
  assert.equal(despues.hastaLaVenta, antes.hastaLaVenta)
})

prueba('errores de validación', () => {
  // Fuera de rango se acota, como siempre (alertas.ts); lo que no es un número, error
  const acotada = cambiosConfigAlertas({ antelacionDias: 500 }, FILA_TOTAL, { vigentes: null, sinMigrar291: false })
  assert.ok(acotada.ok && acotada.cambios?.antelacion_dias === 120)
  const bad1 = cambiosConfigAlertas({ antelacionDias: 'mucha' }, FILA_TOTAL, { vigentes: null, sinMigrar291: false })
  assert.ok(!bad1.ok && bad1.status === 400)
  const bad2 = cambiosConfigAlertas({ avisar: 'si' }, FILA_TOTAL, { vigentes: null, sinMigrar291: false })
  assert.ok(!bad2.ok)
  const bad3 = cambiosConfigAlertas({ etapas: { preparacion: -1 } }, FILA_TOTAL, { vigentes: null, sinMigrar291: false })
  assert.ok(!bad3.ok)
  const bad4 = cambiosConfigAlertas({ plazoDias: 'x' }, FILA_TOTAL, { vigentes: null, sinMigrar291: false })
  assert.ok(!bad4.ok)
})

prueba('nada que tocar en la config (solo plazos por SKU): cambios null', () => {
  const r = cambiosConfigAlertas({ plazosSku: { A: 30 } }, null, { vigentes: null, sinMigrar291: false })
  assert.ok(r.ok)
  assert.equal(r.cambios, null)
})

prueba('etapasDeFila y configParaPlazo', () => {
  assert.equal(etapasDeFila(FILA_TOTAL), null)
  assert.deepEqual(etapasDeFila(FILA_ETAPAS), { preparacion: 10, transporte: 10, recepcion: 5, margen: 5 })
  assert.equal(configParaPlazo(null), null)
  assert.deepEqual(configParaPlazo(FILA_TOTAL), { diasPreparacion: null, diasTransporte: null, diasRecepcion: null, diasMargen: null, total: 45 })
})

/* ---------------- Receipts y medidas ---------------- */

prueba('recibosSinDuplicar: una copia por envío, la del mercado más completo', () => {
  const m = recibosSinDuplicar([
    { referencia: 'FBA1', marketplaceId: 'A1RKKUPIHCS9HS', fecha: '2026-11-06', cantidad: 50 },
    { referencia: 'FBA1', marketplaceId: 'A1RKKUPIHCS9HS', fecha: '2026-11-07', cantidad: 40 },
    { referencia: 'FBA1', marketplaceId: 'APJ6JRA9NG5V4', fecha: '2026-11-06', cantidad: 50 },
    { referencia: 'FBA1', marketplaceId: 'APJ6JRA9NG5V4', fecha: '2026-11-07', cantidad: 40 },
    { referencia: 'FBA1', marketplaceId: 'APJ6JRA9NG5V4', fecha: '2026-11-09', cantidad: 10 },
    { referencia: 'FBA2', marketplaceId: 'A13V1IB3VIYZZH', fecha: '2026-10-02', cantidad: 5 },
    { referencia: 'FBA2', marketplaceId: 'A1RKKUPIHCS9HS', fecha: '2026-10-02', cantidad: 5 },
    { referencia: 'FBA3', marketplaceId: 'A1RKKUPIHCS9HS', fecha: '2026-10-02', cantidad: -3 },
  ])
  assert.equal(m.get('FBA1')?.reduce((s, x) => s + x.cantidad, 0), 100) // APJ6 trae más, y no 190
  assert.equal(m.get('FBA2')?.length, 1) // empate: España
  assert.equal(m.has('FBA3'), false)
})

prueba('medidasDesdeEnvios: transporte, recepción y cadencia', () => {
  const recibos = new Map([
    ['A', [{ fecha: '2026-10-12', cantidad: 50 }, { fecha: '2026-10-16', cantidad: 50 }]],
    ['B', [{ fecha: '2026-10-27', cantidad: 100 }]],
    ['C', [{ fecha: '2026-11-04', cantidad: 60 }, { fecha: '2026-11-10', cantidad: 50 }]],
  ])
  const m = medidasDesdeEnvios(
    [
      { fechaEnvio: '2026-11-13', unidades: 110, referenciaEnvio: 'D' },
      { fechaEnvio: '2026-10-29', unidades: 110, referenciaEnvio: 'C' },
      { fechaEnvio: '2026-10-21', unidades: 100, referenciaEnvio: 'B' },
      { fechaEnvio: '2026-10-06', unidades: 100, referenciaEnvio: 'A' },
    ],
    recibos,
    '2026-11-15',
  )
  assert.equal(m.transporteMediano, 6) // 6, 6, 6
  assert.equal(m.enviosMedidos, 3)
  assert.equal(m.cadenciaDias, 13) // 15, 8, 15 → media 13 (caso 50)
  assert.equal(m.tamanoTipico, 105)
  assert.ok(m.recepcionP75 !== null && m.recepcionP75 >= 4)
})

prueba('medidasDesdeEnvios sin envíos: todo vacío', () => {
  const m = medidasDesdeEnvios([], new Map(), '2026-11-15')
  assert.deepEqual(m, { transporteMediano: null, recepcionP75: null, enviosMedidos: 0, cadenciaDias: null, tamanoTipico: null })
})

/* ---------------- Caja de la referencia ---------------- */

prueba('cantidadesPorSku: más reciente primero, suma por remesa y como mucho 6', () => {
  const remesas = Array.from({ length: 8 }, (_, i) => ({ id: `r${i}`, lineas: [{ sku: 'X', unidades: 90 * (i + 1) }] }))
  remesas[0].lineas.push({ sku: 'X', unidades: 10 }, { sku: 'Y', unidades: 18 })
  const m = cantidadesPorSku(remesas)
  assert.deepEqual(m.get('X'), [100, 180, 270, 360, 450, 540])
  assert.deepEqual(m.get('Y'), [18])
})

prueba('caja deducida (caso 49) sobre las cantidades', () => {
  assert.equal(cajaDeducida([90, 180, 270]), 90)
  assert.equal(cajaDeducida([18, 36]), 18)
  assert.equal(cajaDeducida([7, 11]), null)
})

prueba('cajasDelEncaje: cajas de una sola referencia, la cantidad que se repite', () => {
  const m = cajasDelEncaje([
    { contenido: [{ sku: 'A', unidades: 24 }] },
    { contenido: [{ sku: 'A', unidades: 24 }] },
    { contenido: [{ sku: 'A', unidades: 10 }] },
    { contenido: [{ sku: 'B', unidades: 12 }] },
    { contenido: [{ sku: 'C', unidades: 6 }, { sku: 'D', unidades: 6 }] },
    { contenido: [{ sku: 'C', unidades: 6 }, { sku: 'D', unidades: 6 }] },
  ])
  assert.equal(m.get('A'), 24)
  assert.equal(m.has('B'), false) // una sola caja no dice nada
  assert.equal(m.has('C'), false) // cajas mezcladas
  assert.equal(cajaDeducida([7, 11], m.get('A')), 24) // el encaje manda
})

/* ---------------- Ajustes por referencia ---------------- */

prueba('validarCambiosSku: una referencia y varias', () => {
  const uno = validarCambiosSku({ cliente: 'x', sku: ' WM40297 ', unidadesCaja: '18', excluir: false })
  assert.ok(uno.ok)
  assert.deepEqual(uno.cambios, [{ sku: 'WM40297', unidadesCaja: 18, excluir: false }])
  const varios = validarCambiosSku({ filas: [{ sku: 'A', guardarCajaDeducida: true }, { sku: 'B', coberturaDias: null, motivo: '  ' }] })
  assert.ok(varios.ok)
  assert.deepEqual(varios.cambios, [{ sku: 'A', guardarCajaDeducida: true }, { sku: 'B', coberturaDias: null, motivo: null }])
})

prueba('validarCambiosSku: errores', () => {
  const r = validarCambiosSku({ filas: [{ sku: 'A', unidadesCaja: 600 }, { sku: 'B', coberturaDias: 3 }, { sku: 'C' }, { sku: 'A', excluir: true }, { sku: 'D', excluir: 'si' }, { sku: 'E', guardarCajaDeducida: true, unidadesCaja: 12 }, { sku: '' }, { sku: 'F', unidadesCaja: 2.5 }] })
  assert.ok(!r.ok)
  assert.equal(r.errores.length, 8)
})

const AUTOR = { usuarioId: 'u1', ahora: '2026-11-15T10:00:00Z' }
const PREVIA: FilaReposicionSku = { client_id: 'c', sku: 'A', unidades_caja: 12, cobertura_dias: 60, excluir: true, motivo: 'la cambia de proveedor' }

prueba('filaSkuFusionada: parcial y con las mismas columnas siempre', () => {
  const r = filaSkuFusionada('c', PREVIA, { sku: 'A', coberturaDias: 30 }, null, AUTOR)
  assert.ok(r.ok)
  assert.deepEqual(r.fila, { client_id: 'c', sku: 'A', unidades_caja: 12, cobertura_dias: 30, excluir: true, motivo: 'la cambia de proveedor', actualizado_at: AUTOR.ahora, actualizado_por: 'u1' })
  const nueva = filaSkuFusionada('c', null, { sku: 'Z', excluir: true }, null, AUTOR)
  assert.ok(nueva.ok)
  assert.deepEqual(Object.keys(nueva.fila).sort(), Object.keys(r.fila).sort())
})

prueba('filaSkuFusionada: guardar caja deducida', () => {
  const r = filaSkuFusionada('c', null, { sku: 'A', guardarCajaDeducida: true }, 18, AUTOR)
  assert.ok(r.ok && r.fila.unidades_caja === 18 && !r.vacia)
  const sin = filaSkuFusionada('c', null, { sku: 'A', guardarCajaDeducida: true }, null, AUTOR)
  assert.ok(!sin.ok)
})

prueba('filaSkuFusionada: dejar de excluir borra el motivo; sin nada propio, vacía', () => {
  const r = filaSkuFusionada('c', { ...PREVIA, unidades_caja: null, cobertura_dias: null }, { sku: 'A', excluir: false }, null, AUTOR)
  assert.ok(r.ok)
  assert.equal(r.fila.motivo, null)
  assert.equal(r.vacia, true)
  const conMotivo = filaSkuFusionada('c', PREVIA, { sku: 'A', excluir: false, motivo: 'vuelve' }, null, AUTOR)
  assert.ok(conMotivo.ok && conMotivo.fila.motivo === 'vuelve' && !conMotivo.vacia)
})

console.log(`ajustes-api: ${pasadas} pruebas en verde`)
