import { avanceDeLaPropuesta, LIMITES_DEL_PLAN, leerPlan, planDesdeAnalisis, planEstaVacio, planVacio, VARIABLE_POR_DEFECTO } from './propuesta'
import { leerAnalisis } from './gemini/analisis'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

const ANALISIS = leerAnalisis(
  JSON.stringify({
    resumen: 'Una tienda de cosmética que quiere expandirse.',
    propuesta: {
      enfoque: 'Ordenar España y abrir Alemania.',
      servicios: [
        { nombre: 'Gestión de Amazon Ads', motivo: 'El ACOS está alto.', prioridad: 'alta' },
        { nombre: 'Expansión a Europa', motivo: 'Quiere vender en Alemania.', prioridad: 'media' },
      ],
      datos_clave: [{ valor: '20.000 €/mes', etiqueta: 'facturación actual' }],
      fase_setup: [
        { titulo: 'Auditoría', detalle: 'Revisamos la cuenta.' },
        { titulo: 'Listings', detalle: 'Reescribimos las fichas.' },
      ],
      fase_crecimiento: [{ titulo: 'Alemania', detalle: 'Abrimos el mercado.' }],
      riesgos: ['La inversión en inventario'],
    },
  })
)!

console.log('\n=== el plan vacío ===')
{
  const p = planVacio()
  ok('nace sin origen, sin importes y sin editar', p.origen === null && p.variable_pct === null && p.editado_en === null && p.version === 1)
  ok('y cuenta como vacío', planEstaVacio(p))
  ok('el variable de siempre es el 3 %', VARIABLE_POR_DEFECTO === 3)
}

console.log('\n=== leer lo guardado ===')
{
  ok('el valor por defecto de la columna ({}) da un plan vacío', planEstaVacio(leerPlan({})))
  ok('null, un número o un array, también', planEstaVacio(leerPlan(null)) && planEstaVacio(leerPlan(5)) && planEstaVacio(leerPlan([1, 2])) && planEstaVacio(leerPlan('x')))

  const p = leerPlan({
    origen: 'manual',
    nota_id: 'abc',
    enfoque: '  Algo  ',
    servicios: [{ nombre: 'A', motivo: 'b', prioridad: 'alta' }, { nombre: '', motivo: 'sin nombre' }, { nombre: 'C', prioridad: 'urgente' }, 'texto'],
    datos_clave: [{ valor: '1', etiqueta: 'uno' }, { valor: '', etiqueta: '' }],
    fase_setup: [{ titulo: 'T', detalle: '' }, { titulo: '', detalle: 'solo detalle' }, { titulo: '', detalle: '' }],
    fase_crecimiento: 'no es una lista',
    riesgos: ['r1', '', 5, 'r2'],
    variable_pct: 3.456,
    notas: 'nota',
    editado_en: '2026-10-27T10:00:00Z',
  })
  ok('lee lo que vale', p.origen === 'manual' && p.nota_id === 'abc' && p.enfoque === 'Algo' && p.notas === 'nota' && p.editado_en === '2026-10-27T10:00:00Z')
  ok('un servicio sin nombre se descarta y una prioridad rara cae a «media»', p.servicios.length === 2 && p.servicios[1].prioridad === 'media')
  ok('un paso a medias vale (se está escribiendo), uno vacío no', p.fase_setup.length === 2)
  ok('una lista que no es lista queda vacía', p.fase_crecimiento.length === 0)
  ok('los riesgos vacíos o que no son texto se van', p.riesgos.join('|') === 'r1|r2')
  ok('el % se redondea a dos decimales', p.variable_pct === 3.46)
  ok('un dato clave vacío por completo se descarta', p.datos_clave.length === 1)

  ok('un % fuera de 0–100 o que no es un número no vale', leerPlan({ variable_pct: 150 }).variable_pct === null && leerPlan({ variable_pct: -1 }).variable_pct === null && leerPlan({ variable_pct: '3' }).variable_pct === null && leerPlan({ variable_pct: NaN }).variable_pct === null)
  ok('y el 0 % sí (puede pactarse sin variable)', leerPlan({ variable_pct: 0 }).variable_pct === 0)
  ok('un origen o una fecha que no valen se ignoran', leerPlan({ origen: 'robot', editado_en: 'ayer' }).origen === null && leerPlan({ editado_en: 'ayer' }).editado_en === null)

  const desbocado = leerPlan({
    enfoque: 'x'.repeat(5000),
    servicios: Array.from({ length: 20 }, (_, i) => ({ nombre: `S${i}` })),
    fase_setup: Array.from({ length: 20 }, (_, i) => ({ titulo: `P${i}` })),
    datos_clave: Array.from({ length: 9 }, (_, i) => ({ valor: `${i}`, etiqueta: 'e' })),
    riesgos: Array.from({ length: 30 }, (_, i) => `r${i}`),
    notas: 'n'.repeat(9000),
  })
  ok('lo que llega del navegador se acota', desbocado.enfoque.length <= LIMITES_DEL_PLAN.enfoque && desbocado.servicios.length === LIMITES_DEL_PLAN.servicios && desbocado.fase_setup.length === LIMITES_DEL_PLAN.pasos && desbocado.datos_clave.length === LIMITES_DEL_PLAN.datos && desbocado.riesgos.length === LIMITES_DEL_PLAN.riesgos && desbocado.notas.length <= LIMITES_DEL_PLAN.notas)
  ok('leer dos veces da lo mismo (es idempotente)', JSON.stringify(leerPlan(JSON.parse(JSON.stringify(p)))) === JSON.stringify(p))
  ok('un campo desconocido (de una versión futura) no estorba ni se cuela', !('campo_nuevo' in leerPlan({ campo_nuevo: 'x', enfoque: 'a' })))
}

console.log('\n=== el plan que sugiere el análisis ===')
{
  const p = planDesdeAnalisis(ANALISIS, 'nota-1')
  ok('copia las páginas de la propuesta', p.enfoque === 'Ordenar España y abrir Alemania.' && p.servicios.length === 2 && p.servicios[0].prioridad === 'alta' && p.fase_setup.length === 2 && p.fase_crecimiento.length === 1 && p.riesgos.length === 1 && p.datos_clave[0].valor === '20.000 €/mes')
  ok('apunta de dónde sale', p.origen === 'ia' && p.nota_id === 'nota-1')
  ok('sin importes ni %: los pone una persona', p.variable_pct === null && p.editado_en === null)
  ok('sin nota de origen, también vale', planDesdeAnalisis(ANALISIS, null).nota_id === null)
  ok('no está vacío', !planEstaVacio(p))
  ok('un análisis sin propuesta da un plan vacío en contenido (pero con origen)', planEstaVacio({ ...planDesdeAnalisis(leerAnalisis(JSON.stringify({ resumen: 'Solo esto.' }))!, null), origen: null }))
}

console.log('\n=== qué le falta a la propuesta ===')
{
  const sin = avanceDeLaPropuesta(planVacio(), { setup: null, cuota: null })
  ok('un plan vacío: faltan las seis cosas, avance 0', sin.faltan.length === 6 && sin.hechas.length === 0 && sin.avance === 0)
  const p = planDesdeAnalisis(ANALISIS, null)
  const casi = avanceDeLaPropuesta(p, { setup: null, cuota: null })
  ok('con el plan del análisis, solo faltan los importes', casi.faltan.join() === 'Importes' && Math.abs(casi.avance - 5 / 6) < 1e-9)
  ok('con setup pero sin cuota, siguen faltando los importes', avanceDeLaPropuesta(p, { setup: 1500, cuota: null }).faltan.join() === 'Importes' && avanceDeLaPropuesta(p, { setup: 1500, cuota: 0 }).faltan.join() === 'Importes')
  const completo = avanceDeLaPropuesta(p, { setup: 1500, cuota: 700 })
  ok('con los dos importes está todo', completo.faltan.length === 0 && completo.avance === 1)
}

console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
