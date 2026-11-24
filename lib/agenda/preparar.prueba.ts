import { fichaDeCita, guionDeArranque, limpiarPreparacion, type CitaParaFicha } from '@/lib/agenda/preparar'
import { cuandoEs, hojaDeReunionPdf } from '@/lib/agenda/preparar-pdf'

let fallos = 0
const ok = (n: string, bien: boolean, d: unknown = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien ? '' : ` -> ${JSON.stringify(d)}`}`)
}
const cita: CitaParaFicha = {
  lead_name: 'Fusian', lead_company: 'TOP CELULAR', lead_email: null, lead_phone: '+346', start_time: '2026-11-24T15:00:00Z', end_time: '2026-11-24T16:00:00Z',
  notes: null, google_meet_link: null, vende_en_amazon: 'sin_comprobar', revenue_amount: 9789, amazon_link: null, razon_social: null, cif: null, sector: null,
  ciudad: 'MADRID', plataforma: null, n_productos: null, anos_tienda: null, web: null, transcription_summary: null, comercial: { full_name: 'Maoli' },
}
console.log('\n=== La ficha ===')
{
  const f = fichaDeCita({ cita, lead: { decisor: 'Fusian Sechargui' }, llamadas: [{ fecha: '2026-11-20T10:00:00Z', resumen: 'Ha parado las ventas y quiere volver a empezar cuando encuentre mercancía con margen suficiente para competir en Amazon con los grandes vendedores de móviles', siguiente_paso: 'Reunión', interes: null }], notas: [], reuniones: [], analisis: { informe: { cifras: { productos: 1, buyBox: 100 }, oportunidades: [{ titulo: 'Roturas de stock', cifra: '1 de 1' }] } } })
  ok('sin comprobar, pero con la cuenta analizada: vende', f.vendeEnAmazon === 'si', f.vendeEnAmazon)
  ok('contacto con el decisor', f.datos.some((d) => d.etiqueta === 'Contacto' && d.valor.startsWith('Fusian')), f.datos)
  ok('facturación con miles', f.datos.some((d) => d.etiqueta === 'Facturación' && d.valor === '9.789 €/mes'), f.datos)
  ok('cifras de Amazon', !!f.amazon?.cifras.some((c) => c.etiqueta === 'Buy Box' && c.valor === '100 %'), f.amazon)
  const g = guionDeArranque(f)
  ok('el guion de un vendedor de Amazon pregunta por sus ventas en Amazon', g.preguntas[0].includes('Amazon'), g.preguntas[0])
  ok('el primer punto retoma lo último sin cortar a media palabra', g.puntos[0].startsWith('Retomar lo último') && g.puntos[0].endsWith('…') && !/\s…$/.test(g.puntos[0]), g.puntos[0])
  ok('acaba con el siguiente paso', g.puntos[g.puntos.length - 1].startsWith('Siguiente paso'))
}
console.log('\n=== Lo que se guarda ===')
{
  const l = limpiarPreparacion({ objetivo: '  x  ', puntos: ['a', '', '  b  ', 3], preguntas: Array.from({ length: 20 }, (_, i) => `p${i}`), notas: 'n' })
  ok('quita los vacíos y lo que no es texto', JSON.stringify(l?.puntos) === '["a","b"]', l?.puntos)
  ok('como mucho 12 preguntas', l?.preguntas.length === 12)
  ok('algo que no es un objeto: null', limpiarPreparacion('x') === null)
}
console.log('\n=== El PDF: siempre una hoja ===')
{
  ok('la hora es la de Madrid', cuandoEs('2026-11-24T15:00:00Z', '2026-11-24T16:00:00Z') === 'martes 24 de noviembre · 16:00–17:00', cuandoEs('2026-11-24T15:00:00Z', '2026-11-24T16:00:00Z'))
  const f = fichaDeCita({ cita, lead: null, llamadas: [], notas: [], reuniones: [], analisis: null })
  const mucho = { objetivo: 'o '.repeat(200), puntos: Array.from({ length: 12 }, () => 'punto '.repeat(40)), preguntas: Array.from({ length: 12 }, () => 'pregunta '.repeat(30)), notas: 'nota '.repeat(800) }
  const bytes = hojaDeReunionPdf({ ficha: f, ...mucho, preparadoEl: 'hoy' })
  const texto = Buffer.from(bytes).toString('latin1')
  const paginas = (texto.match(/\/Type\s*\/Page[^s]/g) ?? []).length
  ok('con todo al máximo, una sola página', paginas === 1, paginas)
}
console.log(fallos === 0 ? '\nTODO OK\n' : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
