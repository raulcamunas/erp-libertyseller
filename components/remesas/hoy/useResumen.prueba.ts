/**
 * Pruebas de las cuentas puras de la vista «Hoy» (components/remesas/hoy/useResumen.ts).
 *   cd /Users/raulcamunas/Dev/ERP-remesas && npx tsx components/remesas/hoy/useResumen.prueba.ts
 */
import type { CalidadDatos, ResumenPlan, TareaPendiente } from '@/lib/fba/plan-tipos'
import type { SesionRemesas } from '../comun/tipos-ui'
import {
  CLAVE_OTROS, accionDePendiente, accionesSecundarias, avisosDeHoy, cuentaAtras, cuentaPorTono, etiquetaSemana, ordenarClientes,
  puedeEditarCliente, seriesDeSalidas, type ClienteDeResumen,
} from './useResumen'

let fallos = 0
function ok(nombre: string, cond: boolean, extra?: unknown) {
  if (cond) console.log(`  ✓ ${nombre}`)
  else {
    fallos++
    console.log(`  ✗ ${nombre}`, extra ?? '')
  }
}

const HOY = '2026-11-15'

const resumen = (eur: number, moneda = 'EUR'): ResumenPlan => ({
  referencias: 10, conPropuesta: 2, fuera: {}, roturas14: 1, roturas30: 2, eurosEnRiesgo: eur, moneda, unidadesPropuestas: 40,
  primeraRotura: '2026-11-20', coberturaMediana: 30, agotadosConVentas: 0, vendibles: 100, deCamino: 20,
})
const calidad = (c: Partial<CalidadDatos>): CalidadDatos => ({
  libro: 'ok', leidoHasta: HOY, leidoDesde: '2025-06-01', diasAtraso: 0, ultimoError: null, mercado: 'A1RKKUPIHCS9HS', mercadoRemesa: null,
  sinConexion: false, conexionesActivas: 1, plazoDePartida: false, sinPrecio: 0, provisional: false, refsFueraDeCatalogo: 0, pctMerma90: null,
  calculadoAt: null, horasDesdeCalculo: null, avisos: [], ...c,
})
const cliente = (id: string, nombre: string, tono: ClienteDeResumen['salud']['tono'], eur: number | null, cal: Partial<CalidadDatos> = {}): ClienteDeResumen => ({
  clienteId: id, nombre, salud: { tono, motivo: '' }, resumen: eur === null ? null : resumen(eur), calidad: calidad(cal), proximoEnvio: null, chispa30: [],
})

console.log('ordenarClientes')
{
  const o = ordenarClientes([
    cliente('g', 'Entrais', 'gris', 0),
    cliente('v', 'Verde', 'verde', 50),
    cliente('a', 'Ambar', 'ambar', 10),
    cliente('r1', 'Cobo', 'rojo', 877),
    cliente('r2', 'Creative Toys', 'rojo', 9865),
    cliente('r3', 'Sin resumen', 'rojo', null),
  ]).map((c) => c.clienteId)
  ok('rojo por € → ámbar → verde → gris al final', o.join(',') === 'r2,r1,r3,a,v,g', o)
  const n = cuentaPorTono([cliente('a', 'a', 'rojo', 1), cliente('b', 'b', 'rojo', 1), cliente('c', 'c', 'gris', 1)])
  ok('cuenta por tono', n.rojo === 2 && n.gris === 1 && n.verde === 0)
}

console.log('seriesDeSalidas')
{
  const nombres: Record<string, string> = { a: 'Opinas', b: 'Cobo', c: 'ShoesF' }
  const { datos, series, total } = seriesDeSalidas(
    [
      { semana: '2026-11-09', porCliente: { a: 100, b: 20 } },
      { semana: '2026-11-16', porCliente: { a: 50, c: 0 } },
    ],
    nombres
  )
  ok('solo clientes con unidades, el mayor primero', series.map((s) => s.clave).join(',') === 'a,b', series)
  ok('total', total === 170)
  ok('fila con ceros donde no hay', datos[1].b === 0 && datos[1].a === 50 && datos[0].semana === '2026-11-09')
  ok('color estable por nombre', series[0].color === seriesDeSalidas([{ semana: 'x', porCliente: { z: 1 } }], { z: 'Opinas' }).series[0].color)

  const muchos: Record<string, number> = {}
  const nom: Record<string, string> = {}
  for (let i = 0; i < 9; i++) {
    muchos[`c${i}`] = (i + 1) * 10
    nom[`c${i}`] = `Cliente ${i}`
  }
  const r = seriesDeSalidas([{ semana: '2026-11-16', porCliente: muchos }], nom)
  ok('más de 6 clientes → 5 + «Otros»', r.series.length === 6 && r.series[5].clave === CLAVE_OTROS, r.series.map((s) => s.clave))
  ok('«Otros» suma los 4 menores (10+20+30+40)', r.datos[0][CLAVE_OTROS] === 100 && r.series[5].nombre === 'Otros (4)', r.datos[0])
  ok('vacío sin salidas', seriesDeSalidas([], {}).series.length === 0)
}

console.log('etiquetaSemana')
ok('esta semana', etiquetaSemana('2026-11-09', HOY) === 'Esta semana')
ok('próxima', etiquetaSemana('2026-11-16', HOY) === 'Próxima')
ok('más adelante', etiquetaSemana('2026-11-23', HOY) === '23 nov')

console.log('avisosDeHoy')
{
  const a = avisosDeHoy(
    [
      cliente('ct', 'Creative Toys', 'rojo', 1, { leidoHasta: '2026-11-06', diasAtraso: 9 }),
      cliente('op', 'Opinas', 'ambar', 1, { leidoHasta: '2026-11-11', diasAtraso: 4, plazoDePartida: true }),
      cliente('co', 'Cobo', 'ambar', 1, { plazoDePartida: true }),
      cliente('so', 'Solter', 'gris', 0, { libro: 'sin_leer', leidoHasta: null, diasAtraso: null }),
      cliente('sh', 'Shoplamp', 'rojo', 1, { ultimoError: 'No dio tiempo en la pasada del 14 nov' }),
    ],
    'Falta lanzar la migración 316',
    HOY
  )
  ok('orden: fallo, provisional, atraso, plazos, servidor', a.map((x) => x.id).join(',') === 'fallo,provisional,atraso,plazos,servidor', a.map((x) => x.id))
  ok('provisional nombra a Creative Toys con fecha y días', /Creative Toys hasta el 6 nov \(9 días\)/.test(a[1].texto), a[1].texto)
  ok('plazos agrupa 2 clientes y lleva a uno', /^2 clientes con plazos/.test(a[3].texto) && a[3].clienteId === 'op' && a[3].accion === 'plazos', a[3])
  ok('sin leer no sale (tiene su tarjeta gris)', !a.some((x) => /Solter/.test(x.texto)))
  ok('nada que decir → sin avisos', avisosDeHoy([cliente('x', 'X', 'verde', 0)], null, HOY).length === 0)
}

console.log('acciones de pendientes')
{
  const yo: SesionRemesas = { usuarioId: 'u1', rol: 'employee', actor: 'agencia', esAgencia: true, esAdmin: false, clientesPermitidos: null, editables: null }
  const t = (tipo: TareaPendiente['tipo']) => ({ tipo, clienteId: 'c1', envioPropuestoId: 'e1' })
  ok('sin responsable → Asignarme', accionDePendiente(t('sin_responsable'), { estado: 'nuevo', responsableId: null }, yo) === 'asignarme')
  ok('sin responsable pero ya es mío → Hablado', accionDePendiente(t('sin_responsable'), { estado: 'nuevo', responsableId: 'u1' }, yo) === 'hablado')
  ok('vencido nuevo → Hablado', accionDePendiente(t('envio_vencido'), { estado: 'nuevo', responsableId: 'u1' }, yo) === 'hablado')
  ok('vence esta semana hablado → Convertir', accionDePendiente(t('vence_esta_semana'), { estado: 'hablado', responsableId: null }, yo) === 'convertir')
  ok('esperando al cliente → Convertir', accionDePendiente(t('esperando_cliente'), { estado: 'esperando_cliente', responsableId: null }, yo) === 'convertir')
  ok('en preparación → Abrir', accionDePendiente(t('envio_vencido'), { estado: 'en_preparacion', responsableId: null }, yo) === 'abrir')
  ok('entrante sin remesa → Importar', accionDePendiente(t('entrante_sin_remesa'), null, yo) === 'importar')
  ok('cerrado con faltantes → Reclamar', accionDePendiente(t('cerrado_con_faltantes'), null, yo) === 'reclamar')
  ok('envío dudoso → Reclamar', accionDePendiente(t('envio_dudoso'), null, yo) === 'reclamar')
  ok('remesa parada → Abrir', accionDePendiente(t('remesa_parada'), null, yo) === 'abrir')

  const soloVer: SesionRemesas = { ...yo, clientesPermitidos: ['c1'], editables: [] }
  ok('sin permiso de editar → Abrir', accionDePendiente(t('envio_vencido'), { estado: 'nuevo', responsableId: null }, soloVer) === 'abrir')
  ok('sin permiso tampoco Importar', accionDePendiente(t('entrante_sin_remesa'), null, soloVer) === 'abrir')
  ok('puedeEditarCliente: cliente fuera de los permitidos', !puedeEditarCliente({ ...yo, clientesPermitidos: ['c2'] }, 'c1'))
  ok('cliente externo nunca edita aquí', !puedeEditarCliente({ ...yo, esAgencia: false }, 'c1'))

  const sec = accionesSecundarias('hablado', t('envio_vencido'), { estado: 'nuevo', responsableId: null }, yo)
  ok('menú «⋯»: abrir, ver envío, asignarme, convertir, ver cliente (sin repetir Hablado)', sec.join(',') === 'abrir,ver_envio,asignarme,convertir,ver_cliente', sec)
  const sec2 = accionesSecundarias('convertir', t('vence_esta_semana'), { estado: 'hablado', responsableId: 'u1' }, yo)
  ok('hablado: «Esperando al cliente» en el menú', sec2.includes('esperando') && !sec2.includes('convertir') && !sec2.includes('asignarme'), sec2)
}

console.log('cuentaAtras')
ok('sin cuenta atrás', cuentaAtras({ tipo: 'remesa_parada', diasRestantes: null }) === null)
ok('vencido', cuentaAtras({ tipo: 'envio_vencido', diasRestantes: -3 })?.texto === 'Vencido hace 3 días')
ok('vence hoy en rojo', cuentaAtras({ tipo: 'vence_esta_semana', diasRestantes: 0 })?.tono === 'rojo')
ok('quedan 2 días en naranja', cuentaAtras({ tipo: 'vence_esta_semana', diasRestantes: 2 })?.tono === 'naranja')
ok('reclamar: días para reclamar', cuentaAtras({ tipo: 'cerrado_con_faltantes', diasRestantes: 41 })?.texto === 'Quedan 41 días para reclamar')

if (fallos) {
  console.log(`\n${fallos} prueba(s) fallida(s)`)
  process.exit(1)
}
console.log('\nTodo bien')
