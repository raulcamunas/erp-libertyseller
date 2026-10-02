import { readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { LibroError, abrir, buscarHoja, cadenasCompartidas, decode, leerCelda } from '@/lib/fba/libro'
import { rellenarEmbalaje, type CajaParaPlantilla } from '@/lib/fba/embalaje'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/**
 * EL EMBALAJE, CONTRA LAS PLANTILLAS DE VERDAD Y DE VARIOS TAMAÑOS.
 *
 * Lo único que de verdad hay que demostrar aquí es que el generador encuentra el
 * bloque de peso y medidas EN CADA TAMAÑO de plantilla. Ese bloque se mueve con
 * el número de referencias —fila 9 con 1 SKU, 31 con 23, 58 con 50, 91 con 83— y
 * el procedimiento que se sigue a mano lo tiene clavado en la 31, así que falla
 * en todas menos en la de 23. Con una sola plantilla de prueba esto no se ve.
 */
const DESCARGAS = join(homedir(), 'Downloads')

function plantillasDeEmbalaje(): string[] {
  let ficheros: string[] = []
  try {
    ficheros = readdirSync(DESCARGAS).filter((f) => f.endsWith('.xlsx'))
  } catch {
    return []
  }
  const porTamano = new Map<number, string>()
  for (const f of ficheros) {
    try {
      const paquete = abrir(readFileSync(join(DESCARGAS, f)), f)
      const hoja = buscarHoja(paquete, ['Información de embalaje'])
      if (!hoja) continue
      const xml = decode(paquete[hoja.ruta])
      const compartidas = cadenasCompartidas(paquete)
      let n = 0
      while (leerCelda(xml, `A${6 + n}`, compartidas).trim()) n += 1
      // Una por tamaño distinto: lo que se prueba es la geometría, no el fichero
      if (n > 0 && !porTamano.has(n)) porTamano.set(n, f)
    } catch {
      /* no es una plantilla de embalaje */
    }
  }
  return [...porTamano.entries()].sort((a, b) => a[0] - b[0]).map(([n, f]) => `${n}|${f}`)
}

const encontradas = plantillasDeEmbalaje()
if (encontradas.length === 0) {
  console.log('\n  (saltada: no hay ninguna plantilla de embalaje en ~/Downloads)\n')
  process.exit(0)
}

console.log(`\n=== ${encontradas.length} tamaños distintos de plantilla ===`)
for (const entrada of encontradas) {
  const [nTexto, fichero] = entrada.split('|')
  const nSku = Number(nTexto)
  const bytes = readFileSync(join(DESCARGAS, fichero))

  // Los SKU de verdad de ESA plantilla, para que el cruce por nombre case
  const paquete = abrir(bytes, fichero)
  const hoja = buscarHoja(paquete, ['Información de embalaje'])!
  const xml = decode(paquete[hoja.ruta])
  const compartidas = cadenasCompartidas(paquete)
  const skus: Array<{ sku: string; previstas: number }> = []
  for (let i = 0; i < nSku; i += 1) {
    const f = 6 + i
    skus.push({
      sku: leerCelda(xml, `A${f}`, compartidas).trim(),
      previstas: Number(leerCelda(xml, `J${f}`, compartidas)) || 0,
    })
  }

  // Todo en una caja: lo que se prueba es la geometría, no el reparto
  const cajas: CajaParaPlantilla[] = [
    {
      numero: 1,
      pesoKg: 19.8,
      anchoCm: 40,
      largoCm: 60,
      altoCm: 60,
      contenido: skus.filter((s) => s.previstas > 0).map((s) => ({ sku: s.sku, unidades: s.previstas })),
    },
  ]

  try {
    const r = rellenarEmbalaje(bytes, cajas)
    const esperadas = skus.reduce((s, x) => s + x.previstas, 0)
    console.log(`\n  ${nSku} referencias — ${fichero.slice(0, 40)}`)
    console.log(`     peso/medidas en ${unidadesTexto(r)} · ${r.cajas} caja · ${r.unidades} unidades`)
    ok(`    ${nSku} SKU: cuadra con lo previsto`, r.descuadres.length === 0, JSON.stringify(r.descuadres.slice(0, 3)))
    ok(`    ${nSku} SKU: mete todas las unidades`, r.unidades === esperadas, `${r.unidades} de ${esperadas}`)
    ok(`    ${nSku} SKU: avisa de la caja de 19,8 kg`, r.pesadas.length === 1, JSON.stringify(r.pesadas))
    ok(`    ${nSku} SKU: el fichero tiene contenido`, r.xlsx.byteLength > 5000, `${r.xlsx.byteLength}`)
  } catch (e) {
    ok(`    ${nSku} SKU: se genera`, false, String(e))
  }
}

function unidadesTexto(r: { unidadPeso: string; unidadMedida: string }) {
  return `${r.unidadPeso}/${r.unidadMedida}`
}

console.log('\n=== se niega en vez de romper el fichero ===')
const [primero] = encontradas
const bytes = readFileSync(join(DESCARGAS, primero.split('|')[1]))
try {
  rellenarEmbalaje(bytes, [
    { numero: 1, pesoKg: 1, anchoCm: 1, largoCm: 1, altoCm: 1, contenido: [{ sku: 'NO-EXISTE/99', unidades: 2 }] },
  ])
  ok('un SKU que no está en la plantilla se rechaza', false)
} catch (e) {
  ok('un SKU que no está en la plantilla se rechaza', e instanceof LibroError, String(e).slice(0, 90))
}
try {
  rellenarEmbalaje(bytes, [{ numero: 1, pesoKg: 1, anchoCm: 1, largoCm: 1, altoCm: 1, contenido: [] }])
  ok('sin ninguna caja con contenido, se niega', false)
} catch (e) {
  ok('sin ninguna caja con contenido, se niega', e instanceof LibroError)
}
try {
  const muchas: CajaParaPlantilla[] = Array.from({ length: 60 }, (_, i) => ({
    numero: i + 1, pesoKg: 1, anchoCm: 1, largoCm: 1, altoCm: 1,
    contenido: [{ sku: 'x', unidades: 1 }],
  }))
  rellenarEmbalaje(bytes, muchas)
  ok('más cajas de las que caben, se niega', false)
} catch (e) {
  ok('más cajas de las que caben, se niega', e instanceof LibroError, String(e).slice(0, 80))
}

console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
