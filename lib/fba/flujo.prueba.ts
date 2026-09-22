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
ok('el cliente NO crea el envio en Amazon',
  puedeAvanzar('lista', 'en_amazon', 'cliente', { cuadre: cuadraBien, cajas: cajasOk }).puede, false)
ok('  y se le dice de quien es',
  puedeAvanzar('lista', 'en_amazon', 'cliente', { cuadre: cuadraBien, cajas: cajasOk }).motivos[0].texto,
  'Este paso lo tiene que dar Liberty Seller')
ok('la agencia SI lo crea',
  puedeAvanzar('lista', 'en_amazon', 'agencia', { cuadre: cuadraBien, cajas: cajasOk }).puede, true)
ok('el cliente NO devuelve a borrador', puedeAvanzar('aprobada', 'borrador', 'cliente', {}).puede, false)

console.log('\n=== SALTOS IMPOSIBLES ===')
ok('de borrador a Amazon directo',
  puedeAvanzar('borrador', 'en_amazon', 'agencia', { cuadre: cuadraBien, cajas: cajasOk }).puede, false)
ok('de cerrada a cualquier sitio', puedeAvanzar('cerrada', 'enviada', 'agencia', {}).puede, false)
ok('de en_amazon hacia atras', puedeAvanzar('en_amazon', 'lista', 'agencia', {}).puede, false)

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

console.log('\n=== REMESA VACIA ===')
ok('no se aprueba sin referencias', puedeAvanzar('borrador', 'aprobada', 'cliente', { lineas: 0 }).puede, false)

console.log('\n=== QUE SE PUEDE TOCAR EN CADA ESTADO ===')
const estados: EstadoRemesa[] = ['borrador','aprobada','encajando','lista','en_amazon','enviada','cerrada']
ok('etiquetas: en todos menos borrador',
  estados.filter(puedeImprimirEtiquetas), ['aprobada','encajando','lista','en_amazon','enviada','cerrada'])
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
