import { proponerUbicaciones, ubicacionDeInforme, type CampanaParaUbicaciones } from './ubicaciones-calculo'

let fallos = 0
const ok = (nombre: string, cond: boolean, extra?: unknown) => {
  if (!cond) {
    fallos++
    console.error('✗', nombre, extra ?? '')
  } else console.log('✓', nombre)
}

ok('top', ubicacionDeInforme('Top of Search on-Amazon') === 'PLACEMENT_TOP')
ok('detalle', ubicacionDeInforme('Detail Page on-Amazon') === 'PLACEMENT_PRODUCT_PAGE')
ok('resto', ubicacionDeInforme('Other on-Amazon') === 'PLACEMENT_REST_OF_SEARCH')
ok('rest of search', ubicacionDeInforme('Rest Of Search') === 'PLACEMENT_REST_OF_SEARCH')
ok('fuera', ubicacionDeInforme('Off Amazon') === null)

const base: CampanaParaUbicaciones = { campaignId: 'c1', campaignName: 'X', asin: 'B0', acosObjetivoPct: 30, cvr: 0.1, ajustes: {}, metricas: {} }

// Arriba de la búsqueda muy rentable: sube (×1,25 máx, de 0 a 25)
let r = proponerUbicaciones([{ ...base, metricas: { PLACEMENT_TOP: { clics: 60, gasto: 30, ventas: 300, pedidos: 8 } } }], 20)
ok('sube top', r.length === 1 && r[0].direccion === 'subir' && r[0].pctNuevo === 25, r)

// Con ajuste de 100 y ACoS 20 (objetivo 30): ×min(1,25; 27/20=1,35) = 1,25 → 2 × 1,25 = 2,5 → 150
r = proponerUbicaciones([{ ...base, ajustes: { PLACEMENT_TOP: 100 }, metricas: { PLACEMENT_TOP: { clics: 60, gasto: 60, ventas: 300, pedidos: 8 } } }], 20)
ok('sube de 100 a 150', r[0]?.pctNuevo === 150, r)

// Tope 200 arriba
r = proponerUbicaciones([{ ...base, ajustes: { PLACEMENT_TOP: 190 }, metricas: { PLACEMENT_TOP: { clics: 60, gasto: 20, ventas: 300, pedidos: 8 } } }], 20)
ok('tope 200', r[0]?.pctNuevo === 200, r)

// Sin subidas: no sube
r = proponerUbicaciones([{ ...base, sinSubidas: true, metricas: { PLACEMENT_TOP: { clics: 60, gasto: 30, ventas: 300, pedidos: 8 } } }], 20)
ok('sin subidas', r.length === 0, r)

// Páginas de producto caras con ajuste 50: baja (ACoS 60 vs 30 → ×0,5 limitado a ×0,75 → 1,5 × 0,75 = 1,125 → 13)
r = proponerUbicaciones([{ ...base, ajustes: { PLACEMENT_PRODUCT_PAGE: 50 }, metricas: { PLACEMENT_PRODUCT_PAGE: { clics: 60, gasto: 120, ventas: 200, pedidos: 3 } } }], 20)
ok('baja producto', r[0]?.direccion === 'bajar' && r[0]?.pctNuevo === 13, r)

// Sin ajuste no se baja (no hay de dónde)
r = proponerUbicaciones([{ ...base, metricas: { PLACEMENT_PRODUCT_PAGE: { clics: 60, gasto: 120, ventas: 200, pedidos: 3 } } }], 20)
ok('sin ajuste no baja', r.length === 0, r)

// Poca muestra: nada
r = proponerUbicaciones([{ ...base, metricas: { PLACEMENT_TOP: { clics: 10, gasto: 5, ventas: 100, pedidos: 3 } } }], 20)
ok('poca muestra', r.length === 0, r)

// Sin pedidos con ajuste 40 y 25 clics (2 ÷ 0,1 = 20): baja a 1,4 × 0,75 = 1,05 → 5
r = proponerUbicaciones([{ ...base, ajustes: { PLACEMENT_REST_OF_SEARCH: 40 }, metricas: { PLACEMENT_REST_OF_SEARCH: { clics: 25, gasto: 15, ventas: 0, pedidos: 0 } } }], 20)
ok('sin pedidos baja', r[0]?.pctNuevo === 5, r)

// Bloqueada (cuarentena)
r = proponerUbicaciones([{ ...base, metricas: { PLACEMENT_TOP: { clics: 60, gasto: 30, ventas: 300, pedidos: 8 } } }], 20, new Set(['c1:PLACEMENT_TOP']))
ok('cuarentena', r.length === 0, r)

if (fallos) {
  console.error(`${fallos} fallos`)
  process.exit(1)
}
