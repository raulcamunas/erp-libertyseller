import {
  PASOS_VISIBLES,
  TRANSICIONES,
  puedeAvanzar,
  puedeEditarCajas,
  puedeEditarLineas,
  puedeImprimirEtiquetas,
  siguientesPasos,
  type Cuadre,
  type EstadoDeCajas,
  type EstadoRemesa,
} from './flujo'

let fallos = 0
const ok = (n: string, real: unknown, esp: unknown) => {
  const bien = JSON.stringify(real) === JSON.stringify(esp)
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK  ' : 'FALLA'} ${n}${bien ? '' : ` -> esperado ${JSON.stringify(esp)}, real ${JSON.stringify(real)}`}`)
}

const cuadraBien: Cuadre = {
  descuadres: [{ sku: 'A', declaradas: 10, encajadas: 10, diferencia: 0 }],
  cuadra: true,
}
const cajasOk: EstadoDeCajas = { cajas: 2, sinMedidas: 0, vacias: 0 }

console.log('\n=== QUIEN PUEDE QUE ===')
ok('el cliente aprueba', puedeAvanzar('borrador', 'aprobada', 'cliente', { lineas: 3 }).puede, true)
ok('el cliente NO marca como enviada',
  puedeAvanzar('lista', 'enviada', 'cliente', { cuadre: cuadraBien, cajas: cajasOk }).puede, false)
ok('  y se le dice de quien es',
  puedeAvanzar('lista', 'enviada', 'cliente', { cuadre: cuadraBien, cajas: cajasOk }).motivos[0].texto,
  'Este paso lo tiene que dar Liberty Seller')
ok('la agencia SI la marca',
  puedeAvanzar('lista', 'enviada', 'agencia', { cuadre: cuadraBien, cajas: cajasOk, referencia: 'FBA15ML7ZSVQ' }).puede, true)
ok('el cliente NO devuelve a borrador', puedeAvanzar('aprobada', 'borrador', 'cliente', {}).puede, false)

console.log('\n=== SALTOS IMPOSIBLES ===')
ok('sin nº de envío FBA no se marca como enviada',
  puedeAvanzar('lista', 'enviada', 'agencia', { cuadre: cuadraBien, cajas: cajasOk }).puede, false)
ok('y el motivo dice que falta el número',
  puedeAvanzar('lista', 'enviada', 'agencia', { cuadre: cuadraBien, cajas: cajasOk, referencia: '   ' }).motivos
    .some((m) => m.texto.includes('nº de envío FBA')), true)
ok('con el número y todo lo demás en orden, sí',
  puedeAvanzar('lista', 'enviada', 'agencia', { cuadre: cuadraBien, cajas: cajasOk, referencia: 'FBA15ML7ZSVQ' }).motivos.length, 0)
ok('los demás pasos NO piden el número',
  puedeAvanzar('borrador', 'aprobada', 'agencia', { lineas: 3 }).puede, true)
ok('de borrador a enviada directo',
  puedeAvanzar('borrador', 'enviada', 'agencia', { cuadre: cuadraBien, cajas: cajasOk }).puede, false)
ok('de cerrada a cualquier sitio', puedeAvanzar('cerrada', 'enviada', 'agencia', {}).puede, false)
// Volver atras desde 'enviada' SI se puede ahora: se marca por error y todavia
// no ha salido. Lo que no se puede es saltarse pasos hacia delante.
ok('de enviada se vuelve a lista', puedeAvanzar('enviada', 'lista', 'agencia', {}).puede, true)
ok('de cerrada no se vuelve', puedeAvanzar('cerrada', 'lista', 'agencia', {}).puede, false)

console.log('\n=== LO QUE FALTA SE DICE TODO JUNTO ===')
{
  const p = puedeAvanzar('encajando', 'lista', 'cliente', {
    cuadre: { descuadres: [{ sku: 'FBA633372-41', declaradas: 4, encajadas: 2, diferencia: 2 }], cuadra: false },
    cajas: { cajas: 3, sinMedidas: 2, vacias: 1 },
  })
  ok('no puede', p.puede, false)
  ok('tres motivos, no uno', p.motivos.length, 3)
  console.log('     ' + p.motivos.map((m) => m.texto).join('\n     '))
}

console.log('\n=== EL CUADRE EN LOS DOS SENTIDOS ===')
ok('faltan por encajar',
  puedeAvanzar('encajando', 'lista', 'cliente', {
    cuadre: { descuadres: [{ sku: 'A', declaradas: 10, encajadas: 7, diferencia: 3 }], cuadra: false },
    cajas: cajasOk,
  }).motivos[0].texto,
  'A: faltan 3 unidades por encajar de las 10 declaradas')
ok('sobran en las cajas',
  puedeAvanzar('encajando', 'lista', 'cliente', {
    cuadre: { descuadres: [{ sku: 'A', declaradas: 10, encajadas: 12, diferencia: -2 }], cuadra: false },
    cajas: cajasOk,
  }).motivos[0].texto,
  'A: hay 2 unidades de más en las cajas (declaradas 10)')

console.log('\n=== SIN PARED DE AVISOS: LO MISMO DICHO UNA VEZ ===')
{
  // La pantalla real: Cobo Family, 24 referencias, 100 unidades, y todavía ninguna caja. Salían 25 líneas casi iguales
  const veinticuatro = Array.from({ length: 24 }, (_, i) => ({ sku: `SKU-${i + 1}`, declaradas: i < 4 ? 5 : 4, encajadas: 0, diferencia: i < 4 ? 5 : 4 }))
  const total = veinticuatro.reduce((s, d) => s + d.declaradas, 0)
  const sinCajas = puedeAvanzar('encajando', 'lista', 'cliente', {
    cuadre: { descuadres: veinticuatro, cuadra: false },
    cajas: { cajas: 0, sinMedidas: 0, vacias: 0 },
  })
  ok('sin ninguna caja, UN solo motivo (no 25)', sinCajas.motivos.length, 1)
  ok('  y dice qué hacer y cuántas unidades son', sinCajas.motivos[0].texto, `No hay ninguna caja: añade una y reparte las ${total} unidades`)
  ok('sin el cuadre a mano, el motivo es el de siempre',
    puedeAvanzar('encajando', 'lista', 'cliente', { cajas: { cajas: 0, sinMedidas: 0, vacias: 0 } }).motivos[0].texto, 'No hay ninguna caja')

  // Con una caja ya empezada, las 24 faltan: una sola línea con el total, no una por referencia
  const conCaja = puedeAvanzar('encajando', 'lista', 'cliente', {
    cuadre: { descuadres: veinticuatro, cuadra: false },
    cajas: { cajas: 1, sinMedidas: 1, vacias: 1 },
  })
  ok('con una caja: las 24 que faltan salen en UNA línea', conCaja.motivos.filter((m) => /Faltan/.test(m.texto)).map((m) => m.texto), [`Faltan ${total} unidades por encajar en 24 referencias`])
  ok('  y el resto de motivos (vacía, sin medidas) siguen', conCaja.motivos.length, 3)

  // Hasta tres referencias se dicen una a una: saber cuáles es lo útil
  const tres = veinticuatro.slice(0, 3)
  const detalle = puedeAvanzar('encajando', 'lista', 'cliente', { cuadre: { descuadres: tres, cuadra: false }, cajas: cajasOk })
  ok('con tres, una línea por referencia', detalle.motivos.length, 3)
  const cuatro = veinticuatro.slice(0, 4)
  ok('con cuatro ya se resume: «Faltan 20 unidades… en 4 referencias»',
    puedeAvanzar('encajando', 'lista', 'cliente', { cuadre: { descuadres: cuatro, cuadra: false }, cajas: cajasOk }).motivos.map((m) => m.texto),
    ['Faltan 20 unidades por encajar en 4 referencias'])

  // Faltan unas y sobran otras: cada sentido con su línea
  const mezcla = [
    ...veinticuatro.slice(0, 5),
    { sku: 'X-1', declaradas: 2, encajadas: 3, diferencia: -1 },
    { sku: 'X-2', declaradas: 2, encajadas: 3, diferencia: -1 },
    { sku: 'X-3', declaradas: 2, encajadas: 4, diferencia: -2 },
    { sku: 'X-4', declaradas: 2, encajadas: 3, diferencia: -1 },
  ]
  ok('faltan 5 referencias y sobran 4: una línea de cada',
    puedeAvanzar('encajando', 'lista', 'cliente', { cuadre: { descuadres: mezcla, cuadra: false }, cajas: cajasOk }).motivos.map((m) => m.texto),
    ['Faltan 24 unidades por encajar en 5 referencias', 'Hay 5 unidades de más en las cajas, en 4 referencias'])
  ok('una sola unidad de más no se resume: sale con su SKU',
    puedeAvanzar('encajando', 'lista', 'cliente', { cuadre: { descuadres: [{ sku: 'X-1', declaradas: 2, encajadas: 3, diferencia: -1 }], cuadra: false }, cajas: cajasOk }).motivos[0].texto,
    'X-1: hay 1 unidad de más en las cajas (declaradas 2)')
  ok('y una que falta: «falta 1 unidad»',
    puedeAvanzar('encajando', 'lista', 'cliente', { cuadre: { descuadres: [{ sku: 'Y-1', declaradas: 4, encajadas: 3, diferencia: 1 }], cuadra: false }, cajas: cajasOk }).motivos[0].texto,
    'Y-1: falta 1 unidad por encajar de las 4 declaradas')
}

console.log('\n=== REMESA VACIA ===')
ok('no se aprueba sin referencias', puedeAvanzar('borrador', 'aprobada', 'cliente', { lineas: 0 }).puede, false)

console.log('\n=== QUE SE PUEDE TOCAR EN CADA ESTADO ===')
const estados: EstadoRemesa[] = ['borrador','aprobada','encajando','lista','enviada','cerrada']
ok('etiquetas: en todos menos borrador',
  estados.filter(puedeImprimirEtiquetas), ['aprobada','encajando','lista','enviada','cerrada'])
ok('cajas: solo encajando', estados.filter(puedeEditarCajas), ['encajando'])
ok('lineas: solo borrador', estados.filter(puedeEditarLineas), ['borrador'])

console.log('\n=== COHERENCIA DEL GRAFO ===')
{
  // Desde borrador se llega a todos los estados visibles siguiendo transiciones
  const alcanzables = new Set<EstadoRemesa>(['borrador'])
  let creció = true
  while (creció) {
    creció = false
    for (const t of TRANSICIONES) {
      if (alcanzables.has(t.desde) && !alcanzables.has(t.hasta)) {
        alcanzables.add(t.hasta); creció = true
      }
    }
  }
  ok('todos los pasos son alcanzables desde borrador',
    PASOS_VISIBLES.every((e) => alcanzables.has(e)), true)
  ok('y cerrada tambien', alcanzables.has('cerrada'), true)

  // Cada estado que no sea final ofrece algo a alguien
  const sinSalida = estados.filter(
    (e) => e !== 'cerrada' && siguientesPasos(e, 'agencia').length === 0 && siguientesPasos(e, 'cliente').length === 0
  )
  ok('ningun estado deja a los dos sin nada que hacer', sinSalida, [])

  // Ninguna transicion se define dos veces
  const claves = TRANSICIONES.map((t) => `${t.desde}->${t.hasta}`)
  ok('sin transiciones duplicadas', claves.length, new Set(claves).size)
}

console.log(fallos === 0 ? '\n  TODO CORRECTO\n' : `\n  ${fallos} FALLOS\n`)
process.exit(fallos === 0 ? 0 : 1)
