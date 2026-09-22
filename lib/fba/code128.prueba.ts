import { anchoEnModulos, code128B, type Modulo } from '@/lib/fba/code128'

let fallos = 0
const ok = (n: string, real: unknown, esp: unknown) => {
  const bien = JSON.stringify(real) === JSON.stringify(esp)
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK  ' : 'FALLA'} ${n}${bien ? '' : ` -> esperado ${JSON.stringify(esp)}, real ${JSON.stringify(real)}`}`)
}

/**
 * UN DECODIFICADOR, escrito aparte y a mano.
 *
 * Es la unica forma de comprobar de verdad la tabla de patrones sin meter otra
 * libreria: si un patron estuviera mal copiado, el codificador seguiria siendo
 * coherente consigo mismo y las pruebas de tamano pasarian igual. Decodificando
 * se ve.
 */
const PATRONES = [
  '212222','222122','222221','121223','121322','131222','122213','122312','132212','221213',
  '221312','231212','112232','122132','122231','113222','123122','123221','223211','221132',
  '221231','213212','223112','312131','311222','321122','321221','312212','322112','322211',
  '212123','212321','232121','111323','131123','131321','112313','132113','132311','211313',
  '231113','231311','112133','112331','132131','113123','113321','133121','313121','211331',
  '231131','213113','213311','213131','311123','311321','331121','312113','312311','332111',
  '314111','221411','431111','111224','111422','121124','121421','141122','141221','112214',
  '112412','122114','122411','142112','142211','241211','221114','413111','241112','134111',
  '111242','121142','121241','114212','124112','124211','411212','421112','421211','212141',
  '214121','412121','111143','111341','131141','114113','114311','411113','411311','113141',
  '114131','311141','411131','211412','211214','211232','2331112',
]

function decodificar(mods: Modulo[]): { texto: string; controlOk: boolean } | null {
  // De vuelta a cadenas de seis (el stop son siete)
  const anchos = mods.map((m) => m.ancho)
  const simbolos: number[] = []
  let i = 0
  while (i < anchos.length) {
    const largo = anchos.length - i === 7 ? 7 : 6
    const patron = anchos.slice(i, i + largo).join('')
    const v = PATRONES.indexOf(patron)
    if (v < 0) return null
    simbolos.push(v)
    i += largo
  }
  if (simbolos.length < 4) return null
  const inicio = simbolos[0]
  const parada = simbolos[simbolos.length - 1]
  const control = simbolos[simbolos.length - 2]
  const datos = simbolos.slice(1, -2)
  if (inicio !== 104 || parada !== 106) return null

  let suma = inicio
  datos.forEach((v, idx) => { suma += v * (idx + 1) })
  return {
    texto: datos.map((v) => String.fromCharCode(v + 32)).join(''),
    controlOk: suma % 103 === control,
  }
}

for (const texto of ['X002I7R3N3', 'A', 'FBA047768-40', 'X002KHV0LH', 'B09VPSQPDC', '8434656152967']) {
  const m = code128B(texto)
  if (!m) { fallos++; console.log(`  FALLA no codifica ${texto}`); continue }
  const d = decodificar(m)
  ok(`ida y vuelta de «${texto}»`, d?.texto, texto)
  ok(`  suma de control de «${texto}»`, d?.controlOk, true)
  ok(`  ancho = 11*(n+2)+13 de «${texto}»`, anchoEnModulos(m), 11 * (texto.length + 2) + 13)
}

ok('rechaza acentos', code128B('ÑOÑO'), null)
ok('rechaza vacio', code128B(''), null)

console.log(fallos === 0 ? '\n  TODO CORRECTO\n' : `\n  ${fallos} FALLOS\n`)
process.exit(fallos === 0 ? 0 : 1)
