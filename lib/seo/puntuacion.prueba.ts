/**
 * PRUEBAS DE LA PUNTUACIÓN DEL LISTING (lib/seo/puntuacion.ts).
 *   npx tsx lib/seo/puntuacion.prueba.ts
 */
import type { ConsultaGuardada } from './datos'
import type { BusquedaDiagnosticada, Veredicto } from './embudo'
import { puntuarListing } from './puntuacion'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}
const b = (consulta: string, compras: number, v: Veredicto = { tipo: 'visibilidad', motivo: '', fuerza: 1 }): BusquedaDiagnosticada<ConsultaGuardada> =>
  ({ fila: { asin: 'A', periodo: 'MONTH', desde: '', hasta: '', consulta, puntuacion: null, volumen: compras * 20, cuotaImpresiones: 0.01, cuotaClics: 0.01, cuotaCarritos: 0.01, cuotaCompras: 0.01, comprasAsin: 1, comprasTotal: compras, clicsAsin: null, impresionesAsin: null, impresionesTotal: null, clicsTotal: null, carritosTotal: null, carritosAsin: null, precioMedianoTotal: null, precioMedianoAsin: null }, veredicto: v, impacto: 0, compras: 0, posibleAjena: false }) as BusquedaDiagnosticada<ConsultaGuardada>
const busq = [b('zapatillas casa mujer', 500), b('zapatillas estar por casa', 300), b('zapatillas casa hombre', 200), b('ideas regalo', 900, { tipo: 'ruido', motivo: '' })]
const vinetas = Array(5).fill('Suela de goma antideslizante que agarra en cualquier suelo de la casa, con plantilla acolchada que no se deforma con el uso diario y lavable a máquina.')

const vacia = puntuarListing({ titulo: '', bullets: [], descripcion: null, backend: '', highlights: '' }, busq)
ok('vacía: casi 0', vacia.total <= 5, String(vacia.total))
ok('el ruido no cuenta', !vacia.busquedas.some((x) => x.consulta === 'ideas regalo'))

const buena = puntuarListing(
  { titulo: 'Cobo Zapatillas de Casa Mujer y Hombre para Estar por Casa, Suela Goma', bullets: vinetas, descripcion: null, backend: 'pantuflas chanclas invierno abiertas cerradas comodas calentitas lana borreguito talla grande mayores ancianos regalo madre padre abuela antideslizantes ortopedicas memory foam lavables', highlights: 'Plantilla viscoelástica, lavables a máquina' },
  busq
)
ok('buena: 90 o más', buena.total >= 90, `${buena.total} ${JSON.stringify(buena.bloques.map((x) => [x.id, x.puntos]))}`)
ok('las tres búsquedas en el título', buena.busquedas.every((x) => x.enTitulo))

const larga = puntuarListing({ titulo: 'Cobo Zapatillas de Casa Mujer y Hombre para Estar por Casa, Suela de Goma Antideslizante, Ligeras', bullets: vinetas, descripcion: null, backend: '', highlights: '' }, busq)
ok('título largo: la norma lo pide lo primero', larga.bloques.find((x) => x.id === 'norma')!.siguiente!.includes('Recorta el título'))
ok('siguientes ordenados por puntos', larga.siguientes.length > 0 && larga.siguientes.every((s, i, a) => i === 0 || a[i - 1].puntos >= s.puntos))

const sinBA = puntuarListing({ titulo: 'Cobo Zapatillas de Casa Mujer y Hombre para Estar por Casa, Suela Goma', bullets: vinetas, descripcion: null, backend: 'pantuflas chanclas invierno abiertas cerradas comodas calentitas lana borreguito talla grande mayores ancianos regalo madre padre abuela ortopedicas memory foam suaves calidas', highlights: 'Plantilla viscoelástica' }, [])
ok('sin búsquedas: se escala a 100 con lo medible', sinBA.sinBusquedas && sinBA.total >= 95, String(sinBA.total))

console.log(fallos ? `\n${fallos} FALLOS` : '\nTodo bien')
process.exit(fallos ? 1 : 0)
