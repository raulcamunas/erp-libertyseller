import { clicsParaCortar, juntar, semillasDeCerebro, semillasDeLaCuenta, semillasDelGrabber, MAX_EXACTA, type EntradaDeSemillas } from './semillas'
import type { FilaDeTermino } from './terminos'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/** CON QUÉ ARRANCAN LAS CAMPAÑAS DE UN PRODUCTO */
const t = (termino: string, clics: number, compras: number, gasto = clics * 0.5, keyword: string | null = 'jamon', matchType = 'BROAD'): FilaDeTermino => ({ termino, campaignId: 'c', campaignName: 'B0AAAAAAAA | SKU | JAMON | MANUAL AMPLIA', adGroupId: 'g', keyword, matchType, impresiones: clics * 30, clics, gasto, compras, ventas: compras * 90 })
const base: EntradaDeSemillas = { asin: 'B0AAAAAAAA', propios: new Set(['B0AAAAAAAA', 'B0PROPIO01']), terminos: [], busquedas: [], competencia: [], pujaBase: 0.5, cvr: 0.1 }

const r = semillasDeLaCuenta({
  ...base,
  terminos: [t('jamon iberico', 40, 5), t('jamon serrano', 20, 1), t('jamon de juguete', 35, 0), t('b0rival001', 10, 2), t('b0malo0001', 40, 0), t('jamon', 50, 0, 25, 'jamon'), t('jamon bellota', 12, 3, 6, 'jamon bellota', 'EXACT')],
  busquedas: [{ consulta: 'jamon iberico', volumen: 9000, cuotaCompras: 0.05, comprasAsin: 4, relevante: true }, { consulta: 'paleta iberica', volumen: 5000, cuotaCompras: 0, comprasAsin: 0, relevante: true }, { consulta: 'jamon york', volumen: 20000, cuotaCompras: 0, comprasAsin: 0, relevante: false }],
  competencia: [{ asin: 'B0COMP0001', consulta: 'jamon iberico', cuotaClics: 0.2 }, { asin: 'B0COMP0001', consulta: 'paleta iberica', cuotaClics: 0.1 }, { asin: 'B0PROPIO01', consulta: 'x', cuotaClics: 0.3 }],
})
const de = (d: string) => r.filter((s) => s.destino === d).map((s) => s.texto)
ok('lo que vende 2+ veces va a exacta', de('exacta').includes('jamon iberico'), JSON.stringify(de('exacta')))
ok('una exacta que ya es suya no se repite', !de('exacta').includes('jamon bellota'))
ok('lo que vendió una vez va a frase', de('frase').includes('jamon serrano'))
ok('la búsqueda del producto con volumen va a frase; la de otro producto no', de('frase').includes('paleta iberica') && !de('frase').includes('jamon york'))
ok('una palabra en exacta no va también a frase', !de('frase').includes('jamon iberico'))
ok('gasto sin venta por encima del corte → negativa', de('negativa').includes('jamon de juguete'), JSON.stringify(de('negativa')))
ok('la propia keyword que gasta NO se negativiza (se arregla con la puja)', !de('negativa').includes('jamon'))
ok('un ASIN que vendió → atacar; uno que gastó sin vender → excluir', de('asin').includes('b0rival001') && de('negativa-asin').includes('b0malo0001'))
ok('la competencia de Brand Analytics se ataca; los propios nunca', de('asin').includes('b0comp0001') && !de('asin').includes('b0propio01'))
ok('el corte de clics sale de la conversión y tiene suelo y techo', clicsParaCortar(0.1) === 30 && clicsParaCortar(0.5) === 8 && clicsParaCortar(0.01) === 40 && clicsParaCortar(null) === 10)

const muchas = semillasDeLaCuenta({ ...base, terminos: Array.from({ length: 12 }, (_, i) => t(`termino ${i}`, 30, 3)) })
ok(`como mucho ${MAX_EXACTA} exactas de día 1`, muchas.filter((s) => s.destino === 'exacta').length === MAX_EXACTA)

const cer = semillasDeCerebro({ exacta: [{ texto: 'Jamon Iberico', volumen: 9000, puja: 0.9, motivo: 'núcleo' }], frase: [{ texto: 'jamon', volumen: 50000, puja: null }], negativas: [{ texto: 'jamon de juguete', familia: 'Otra categoría' }] }, 0.5)
const j = juntar(r, cer)
ok('al juntar no se repite lo mismo dos veces', j.filter((s) => s.texto === 'jamon iberico' && s.destino === 'exacta').length === 1 && j.filter((s) => s.texto === 'jamon de juguete').length === 1)
ok('ante la misma palabra manda la de la cuenta (tiene datos propios)', j.find((s) => s.texto === 'jamon iberico' && s.destino === 'exacta')?.fuente === 'terminos')

const g = semillasDelGrabber([
  { asin: 'B0CARO0001', marca: 'Otra', precio: 120, valoracion: 4.6, resenas: 300 },
  { asin: 'B0MALO0001', marca: 'Otra', precio: 80, valoracion: 3.9, resenas: 120 },
  { asin: 'B0FAMOSO01', marca: 'Otra', precio: 120, valoracion: 3.8, resenas: 9000 },
  { asin: 'B0MIA00001', marca: 'MiMarca', precio: 150, valoracion: 3.0, resenas: 10 },
  { asin: 'B0IGUAL001', marca: 'Otra', precio: 95, valoracion: 4.7, resenas: 50 },
], { asin: 'B0AAAAAAAA', marca: 'mimarca', precio: 100, propios: new Set() }, 0.5)
ok('Grabber: más caros o peor valorados; ni la propia marca, ni los de miles de reseñas, ni los iguales', g.map((s) => s.texto).join() === 'b0caro0001,b0malo0001', g.map((s) => s.texto).join())

const conTitulo = semillasDeLaCuenta({ ...base, descripcion: 'Jamonero giratorio profesional de madera', terminos: [t('jamonero giratorio', 40, 0, 20, 'soporte'), t('jamoneros giratorios', 40, 0, 20, 'soporte'), t('cuchillo jamonero', 40, 0, 20, 'soporte')] })
ok('lo que describe el propio producto (también en plural) nunca es negativa', !conTitulo.some((s) => s.texto.startsWith('jamonero')) && conTitulo.some((s) => s.texto === 'cuchillo jamonero' && s.destino === 'negativa'), JSON.stringify(conTitulo.map((s) => s.texto)))
const genericas = semillasDeLaCuenta({ ...base, busquedas: [{ consulta: 'tarjeta', volumen: 9000, cuotaCompras: 0, comprasAsin: 0, relevante: true }, { consulta: 'nfc', volumen: 900, cuotaCompras: 0.1, comprasAsin: 1, relevante: true }] })
ok('una búsqueda de una sola palabra no va a frase salvo que ya te compren por ella', !genericas.some((s) => s.texto === 'tarjeta') && genericas.some((s) => s.texto === 'nfc'))

console.log(fallos ? `\n${fallos} FALLOS\n` : '\nTodo bien\n')
if (fallos) process.exit(1)
