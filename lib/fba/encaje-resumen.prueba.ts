import { KG_DE_CARGA_PESADA, cajaCompleta, leerMedida, numeroDeCajaNueva, resumirEncaje, type CajaEnEdicion, type LineaParaEncajar } from '@/lib/fba/encaje-resumen'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/**
 * EL RESUMEN DEL ENCAJE: QUÉ FALTA PARA PODER TERMINAR.
 *
 * Es lo que la página del cliente recalcula a cada toque y lo que el servidor vuelve a mirar. Se
 * comprueba con el envío real de Cobo: 24 referencias, 100 unidades y, de partida, ninguna caja.
 */

const linea = (sku: string, unidades: number): LineaParaEncajar => ({ sku, nombre: `Producto ${sku}`, variante: null, referencia: null, unidades })
const caja = (numero: number, contenido: Array<[string, number]>, medidas: Partial<CajaEnEdicion> = {}): CajaEnEdicion => ({
  numero,
  largoCm: 40,
  anchoCm: 30,
  altoCm: 20,
  pesoKg: 8,
  contenido: contenido.map(([sku, unidades]) => ({ sku, unidades })),
  ...medidas,
})

const veinticuatro = Array.from({ length: 24 }, (_, i) => linea(`SKU-${i + 1}`, i < 4 ? 5 : 4))

console.log('\n=== al empezar: ninguna caja ===')
{
  const r = resumirEncaje(veinticuatro, [])
  ok('100 unidades declaradas, 0 encajadas, 100 pendientes', r.declaradas === 100 && r.encajadas === 0 && r.pendientes === 100 && r.sobrantes === 0, JSON.stringify([r.declaradas, r.encajadas, r.pendientes]))
  ok('no se puede terminar y el motivo es UNO, no 25', !r.listo && r.motivos.length === 1 && r.motivos[0] === 'No hay ninguna caja: añade una y reparte las 100 unidades', r.motivos.join(' | '))
  ok('por SKU: cada uno tiene todo pendiente', r.porSku['SKU-1'].restantes === 5 && r.porSku['SKU-24'].restantes === 4)
}

console.log('\n=== a medias ===')
{
  const r = resumirEncaje(veinticuatro, [caja(1, [['SKU-1', 5], ['SKU-2', 2]], { pesoKg: null }), caja(2, [])])
  ok('encajadas 7, pendientes 93', r.encajadas === 7 && r.pendientes === 93, `${r.encajadas}/${r.pendientes}`)
  ok('la caja 1 sin peso y la 2 —que además de vacía tiene todas las medidas— solo la 1 está sin medidas', r.sinMedidas.join() === '1', r.sinMedidas.join())
  ok('la caja 2 está vacía', r.vacias.join() === '2')
  ok('no se puede terminar y lo que falta sale resumido, no una línea por referencia', !r.listo && r.motivos.length === 3 && r.motivos.some((m) => /^Faltan 93 unidades por encajar en 23 referencias$/.test(m)), r.motivos.join(' | '))
  ok('SKU-1 completo (5 de 5) y SKU-2 a medias (2 de 5, le restan 3)', r.porSku['SKU-1'].restantes === 0 && r.porSku['SKU-2'].encajadas === 2 && r.porSku['SKU-2'].restantes === 3)
}

console.log('\n=== todo en su sitio ===')
{
  const una = [linea('A', 6), linea('B', 4)]
  const r = resumirEncaje(una, [caja(1, [['A', 4], ['B', 4]]), caja(2, [['A', 2]], { pesoKg: 16.2 })])
  ok('cuadra: se puede terminar y no queda ningún motivo', r.listo && r.motivos.length === 0 && r.pendientes === 0 && r.sobrantes === 0)
  ok('el peso total son 24,2 kg', r.pesoTotalKg === 24.2, String(r.pesoTotalKg))
  ok(`la caja 2 pasa de ${KG_DE_CARGA_PESADA} kg: carga pesada (aviso, no impide terminar)`, r.pesadas.join() === '2' && r.listo)
  ok('el estado de cajas que lee puedeAvanzar', r.estadoDeCajas.cajas === 2 && r.estadoDeCajas.sinMedidas === 0 && r.estadoDeCajas.vacias === 0)
}

console.log('\n=== de más y SKU que no son del envío ===')
{
  const r = resumirEncaje([linea('A', 2)], [caja(1, [['A', 3], ['ZZ', 1]])])
  ok('sobran 2 en total (1 de A y 1 de ZZ que no está declarado)', r.sobrantes === 2 && r.pendientes === 0, `${r.sobrantes}/${r.pendientes}`)
  ok('no se puede terminar', !r.listo)
  ok('el SKU ajeno aparece con 0 declaradas', r.porSku['ZZ']?.declaradas === 0 && r.porSku['ZZ']?.restantes === -1)
}

console.log('\n=== pequeñas cuentas ===')
{
  ok('una caja necesita las tres medidas y el peso', cajaCompleta({ largoCm: 1, anchoCm: 1, altoCm: 1, pesoKg: 1 }) && !cajaCompleta({ largoCm: 1, anchoCm: 1, altoCm: null, pesoKg: 1 }) && !cajaCompleta({ largoCm: 1, anchoCm: 1, altoCm: 1, pesoKg: 0 }))
  ok('la caja nueva es la siguiente de la mayor, aunque falte alguna del medio', numeroDeCajaNueva([{ numero: 1 }, { numero: 4 }]) === 5 && numeroDeCajaNueva([]) === 1)
  ok('«12,5» con coma es 12,5', leerMedida('12,5') === 12.5)
  ok('«12.5» con punto también', leerMedida('12.5') === 12.5)
  ok('lo vacío, el cero, lo negativo y lo que no es número son null', leerMedida('') === null && leerMedida('0') === null && leerMedida('-3') === null && leerMedida('abc') === null && leerMedida('  ') === null)
  ok('más de dos decimales se redondea: 8,456 son 8,46', leerMedida('8,456') === 8.46)
}

console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
