import { saludCliente, compararSalud, FRASE_SIN_DATOS, FRASE_CLIENTE_NUEVO, FRASE_INACTIVO, type OpcionesSalud } from '@/lib/fba/salud'
import type { CalidadDatos, ResumenPlan, SaludCliente } from '@/lib/fba/plan-tipos'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/**
 * EL PUNTO DE SALUD (spec §6.2 y §11 D42; caso 60).
 */

const resumen = (r: Partial<ResumenPlan> = {}): ResumenPlan => ({
  referencias: 52, conPropuesta: 0, fuera: {}, roturas14: 0, roturas30: 0, eurosEnRiesgo: 0, moneda: 'EUR', unidadesPropuestas: 0,
  primeraRotura: null, coberturaMediana: 34, agotadosConVentas: 0, vendibles: 3138, deCamino: 2079, ...r,
})
const calidad = (c: Partial<CalidadDatos> = {}): CalidadDatos => ({
  libro: 'ok', leidoHasta: '2026-11-14', leidoDesde: '2025-06-01', diasAtraso: 1, ultimoError: null, mercado: 'A1RKKUPIHCS9HS', mercadoRemesa: 'A1RKKUPIHCS9HS',
  sinConexion: false, conexionesActivas: 1, plazoDePartida: false, sinPrecio: 0, provisional: false, refsFueraDeCatalogo: 0, pctMerma90: null,
  calculadoAt: '2026-11-15T06:00:00Z', horasDesdeCalculo: 2, avisos: [], ...c,
})
const op = (o: Partial<OpcionesSalud> = {}): OpcionesSalud => ({ activo: true, movimientos90: 800, primerEnvio: false, ...o })

console.log('\n=== caso 60: gris ===')
{
  const g = saludCliente(resumen(), calidad({ libro: 'sin_leer', leidoHasta: null, diasAtraso: null }), op())
  ok('libro sin leer → gris', g.tono === 'gris')
  ok('…con «No hay ventas leídas: no se puede planificar»', g.motivo === FRASE_SIN_DATOS, g.motivo)
  ok('0 movimientos en 90 días → gris', saludCliente(resumen(), calidad(), op({ movimientos90: 0 })).tono === 'gris')
  ok('sin resumen (sin pasada) → gris', saludCliente(null, calidad(), op()).tono === 'gris')
  ok('planificador apagado → gris', saludCliente(resumen({ agotadosConVentas: 3 }), calidad(), op({ activo: false })).motivo === FRASE_INACTIVO)
  const nuevo = saludCliente(null, null, op({ primerEnvio: true, movimientos90: 0 }))
  ok('cliente sin envíos enviados (Solter) → gris con la frase del cliente nuevo', nuevo.tono === 'gris' && nuevo.motivo === FRASE_CLIENTE_NUEVO, nuevo.motivo)
  ok('el gris manda sobre las roturas de un libro sin leer', saludCliente(resumen({ roturas14: 5 }), calidad({ libro: 'sin_leer' }), op()).tono === 'gris')

  const lista: Array<SaludCliente & { n: string }> = [
    { n: 'verde', tono: 'verde', motivo: '' },
    { n: 'gris', tono: 'gris', motivo: '' },
    { n: 'ambar', tono: 'ambar', motivo: '' },
    { n: 'rojo', tono: 'rojo', motivo: '' },
  ]
  const orden = [...lista].sort(compararSalud).map((x) => x.n).join(',')
  ok('gris se ordena detrás de rojo y ámbar (y delante de verde)', orden === 'rojo,ambar,gris,verde', orden)
  ok('sin salud, al final', [null, lista[0]].sort(compararSalud)[0] === lista[0])
}

console.log('\n=== rojo ===')
{
  const r = saludCliente(resumen({ roturas14: 11, primeraRotura: '2026-11-20' }), calidad(), op())
  ok('roturas en 14 días → rojo', r.tono === 'rojo')
  ok('…con cifras y fecha', r.motivo.includes('11 referencias') && r.motivo.includes('20 nov'), r.motivo)
  const a = saludCliente(resumen({ agotadosConVentas: 1 }), calidad(), op())
  ok('agotadas con ventas → rojo, en singular', a.tono === 'rojo' && a.motivo.startsWith('1 referencia agotada'), a.motivo)
  const p = saludCliente(resumen({ roturas14: 0 }), calidad(), op({ prioridades: { tarde: 2, urgente: 1 } }))
  ok('con recuento por prioridad: tarde/urgente → rojo', p.tono === 'rojo' && p.motivo.includes('2 referencias ya van tarde'), p.motivo)
  const pRot = saludCliente(resumen({ roturas14: 4 }), calidad(), op({ prioridades: { este_mes: 4 } }))
  ok('con recuento por prioridad manda el recuento (roturas14 sin urgentes no es rojo)', pRot.tono === 'verde', pRot.tono)
  ok('el rojo pasa por delante del ámbar', saludCliente(resumen({ roturas14: 1 }), calidad({ diasAtraso: 9 }), op()).tono === 'rojo')
}

console.log('\n=== ámbar ===')
{
  const s = saludCliente(resumen({ roturas30: 3 }), calidad(), op())
  ok('roturas en 30 días → ámbar', s.tono === 'ambar', s.motivo)
  const e = saludCliente(resumen(), calidad(), op({ prioridades: { esta_semana: 2 } }))
  ok('algo sale esta semana → ámbar', e.tono === 'ambar' && e.motivo.includes('esta semana'), e.motivo)
  const at = saludCliente(resumen(), calidad({ leidoHasta: '2026-11-06', diasAtraso: 9 }), op())
  ok('libro 9 días atrasado → ámbar, con la fecha', at.tono === 'ambar' && at.motivo.includes('6 nov') && at.motivo.startsWith('V'), at.motivo)
  ok('libro 3 días atrasado → no es ámbar', saludCliente(resumen(), calidad({ diasAtraso: 3 }), op()).tono === 'verde')
  const pl = saludCliente(resumen(), calidad({ plazoDePartida: true }), op())
  ok('plazo de partida → ámbar', pl.tono === 'ambar' && pl.motivo.includes('de partida'), pl.motivo)
}

console.log('\n=== verde ===')
{
  const v = saludCliente(resumen({ primeraRotura: '2027-01-10' }), calidad(), op())
  ok('nada de lo anterior → verde', v.tono === 'verde')
  ok('…con la cobertura y la primera rotura', v.motivo.includes('34 días') && v.motivo.includes('10 ene'), v.motivo)
}

console.log(fallos ? `\n${fallos} FALLOS` : '\nTodo bien')
if (fallos) process.exit(1)
