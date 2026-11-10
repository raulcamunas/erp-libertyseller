import { fichaDesdeCuerpo, productoDesdeCuerpo } from './validar'
import { FICHA_DE_ARRANQUE } from './cuenta'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

console.log('\n=== ficha ===')
{
  const r = fichaDesdeCuerpo(FICHA_DE_ARRANQUE)
  ok('los valores de arranque del SOP son válidos', r.ok, r.ok ? '' : r.error)
  ok('fase inventada → error', !fichaDesdeCuerpo({ ...FICHA_DE_ARRANQUE, fase: 'otra' }).ok)
  ok('ACoS 0 → error', !fichaDesdeCuerpo({ ...FICHA_DE_ARRANQUE, acosMaduroX: 0 }).ok)
  ok('horas entre subidas con decimales → error', !fichaDesdeCuerpo({ ...FICHA_DE_ARRANQUE, horasEntreSubidas: 72.5 }).ok)
  ok('subida de presupuesto > 100 → error', !fichaDesdeCuerpo({ ...FICHA_DE_ARRANQUE, subidaPresupuestoPct: 150 }).ok)
  ok('texto en un número → error', !fichaDesdeCuerpo({ ...FICHA_DE_ARRANQUE, tacosObjetivoPct: 'abc' }).ok)
  const coma = fichaDesdeCuerpo({ ...FICHA_DE_ARRANQUE, acosLanzamientoX: '1,5', presupuestoMensual: '1.200,5' })
  ok('acepta «1,5» con coma', coma.ok && coma.campos.acosLanzamientoX === 1.5, JSON.stringify(coma))
  const vacio = fichaDesdeCuerpo({ ...FICHA_DE_ARRANQUE, presupuestoMensual: '' })
  ok('presupuesto mensual vacío = null', vacio.ok && vacio.campos.presupuestoMensual === null)
  ok('presupuesto mensual negativo → error', !fichaDesdeCuerpo({ ...FICHA_DE_ARRANQUE, presupuestoMensual: -5 }).ok)
  ok('cuerpo vacío → error, no excepción', !fichaDesdeCuerpo(null).ok && !fichaDesdeCuerpo('x').ok)
}

console.log('\n=== producto ===')
{
  const buena = { asin: 'b0h5f7rj5f', sku: ' HATBOX-COWBOY ', resumen: 'hat box', precio: '24,20', costeProducto: 6 }
  const r = productoDesdeCuerpo(buena)
  ok('válido: ASIN en mayúsculas, SKU recortado, resumen en mayúsculas', r.ok && r.campos.asin === 'B0H5F7RJ5F' && r.campos.sku === 'HATBOX-COWBOY' && r.campos.resumen === 'HAT BOX', JSON.stringify(r))
  ok('precio con coma → 24,2', r.ok && r.campos.precio === 24.2)
  ok('valores por defecto: IVA 21, comisión 15', r.ok && r.campos.ivaPct === 21 && r.campos.comisionPct === 15)
  ok('ASIN de 9 caracteres → error', !productoDesdeCuerpo({ ...buena, asin: 'B0H5F7RJ5' }).ok)
  ok('sin SKU → error', !productoDesdeCuerpo({ ...buena, sku: '' }).ok)
  ok('sin resumen → error', !productoDesdeCuerpo({ ...buena, resumen: '  ' }).ok)
  ok('resumen con «|» se limpia en vez de romper el nombre', (() => { const x = productoDesdeCuerpo({ ...buena, resumen: 'HAT | BOX' }); return x.ok && !x.campos.resumen.includes('|') })())
  ok('resumen de más de 40 caracteres → error', !productoDesdeCuerpo({ ...buena, resumen: 'A'.repeat(41) }).ok)
  ok('coste negativo → error', !productoDesdeCuerpo({ ...buena, costeProducto: -1 }).ok)
  ok('precio y coste pueden quedar vacíos (se rellenan después)', productoDesdeCuerpo({ asin: 'B0H5F7RJ5F', sku: 'X', resumen: 'A' }).ok)
  ok('IVA 50 → error', !productoDesdeCuerpo({ ...buena, ivaPct: 50 }).ok)
}

console.log(fallos === 0 ? '\nTODO OK' : `\n${fallos} FALLOS`)
process.exit(fallos === 0 ? 0 : 1)
