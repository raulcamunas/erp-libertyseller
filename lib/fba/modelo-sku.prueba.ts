/**
 * Pruebas de lib/fba/modelo-sku.ts (spec remesas-pro §11 D5.1).
 * cd /Users/raulcamunas/Dev/ERP-remesas && npx tsx lib/fba/modelo-sku.prueba.ts
 */
import { PATRONES_DE_PARTIDA, modeloDesdeSku, patronesDeCliente, normalizarNombreCliente } from '@/lib/fba/modelo-sku'

let fallos = 0
function comprobar(nombre: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado)
  if (!ok) fallos++
  console.log(`  ${ok ? 'OK  ' : 'FALLA'} ${nombre}${ok ? '' : `\n        esperado ${JSON.stringify(esperado)}\n        real     ${JSON.stringify(real)}`}`)
}

console.log('\n=== Cobo: «262 BURDEO/37 FBA» ===')
const cobo = PATRONES_DE_PARTIDA.cobo
comprobar('con « FBA» detrás', modeloDesdeSku('262 BURDEO/37 FBA', cobo), { modelo: '262 BURDEO', talla: '37' })
comprobar('sin nada detrás', modeloDesdeSku('262 BURDEO/37', cobo), { modelo: '262 BURDEO', talla: '37' })
comprobar('espacios alrededor de la barra', modeloDesdeSku('262 BURDEO / 38', cobo), { modelo: '262 BURDEO', talla: '38' })
comprobar('media talla con coma', modeloDesdeSku('262 BURDEO/37,5 FBA', cobo), { modelo: '262 BURDEO', talla: '37.5' })
comprobar('espacios dobles en el modelo', modeloDesdeSku('262  BURDEO/39', cobo), { modelo: '262 BURDEO', talla: '39' })
comprobar('sin talla: null', modeloDesdeSku('262 BURDEO FBA', cobo), null)
comprobar('talla de 3 cifras no es talla', modeloDesdeSku('CAJA/123', cobo), null)

console.log('\n=== ShoesF: «FBA<cod_art>-<talla>» ===')
const shoesf = PATRONES_DE_PARTIDA.shoesf
comprobar('FBA035188-38', modeloDesdeSku('FBA035188-38', shoesf), { modelo: 'FBA035188', talla: '38' })
comprobar('FBA047768-45', modeloDesdeSku('FBA047768-45', shoesf), { modelo: 'FBA047768', talla: '45' })
comprobar('media talla', modeloDesdeSku('FBA633372-40.5', shoesf), { modelo: 'FBA633372', talla: '40.5' })
comprobar('otra forma: null', modeloDesdeSku('FBA-UE-F14V-ZFQA', shoesf), null)
comprobar('con texto detrás: null', modeloDesdeSku('FBA035188-38-X', shoesf), null)
comprobar('vacío: null', modeloDesdeSku('', shoesf), null)
comprobar('sin patrones: null', modeloDesdeSku('FBA035188-38', []), null)

console.log('\n=== Patrones por nombre de cliente ===')
comprobar('normalizar «Cobo Family»', normalizarNombreCliente('Cobo Family'), 'cobofamily')
comprobar('«Cobo Family» usa los de cobo', patronesDeCliente('Cobo Family').length, 1)
comprobar('«ShoesF» usa los de shoesf', modeloDesdeSku('FBA035188-38', patronesDeCliente('ShoesF')), { modelo: 'FBA035188', talla: '38' })
comprobar('«Shoes F.» también', patronesDeCliente('Shoes F.').length, 1)
comprobar('«Opinas» no tiene', patronesDeCliente('Opinas').length, 0)
comprobar('sin nombre', patronesDeCliente(null).length, 0)
comprobar('el regex no guarda estado entre llamadas', [modeloDesdeSku('FBA1-38', shoesf), modeloDesdeSku('FBA1-38', shoesf)].every(Boolean), true)

console.log(`\n${fallos === 0 ? 'TODO OK' : `${fallos} FALLOS`}`)
process.exit(fallos === 0 ? 0 : 1)
