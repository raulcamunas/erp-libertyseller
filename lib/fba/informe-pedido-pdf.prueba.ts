import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { LineaDePanel, RemesaDePanel } from '@/lib/fba/datos'
import { informeDePedido } from '@/lib/fba/informe-pedido'
import { pdfDeInforme, soportado } from '@/lib/fba/informe-pedido-pdf'
import { FUENTES_SHA256, fuentesDeMarca } from '@/lib/fba/pdf/fuentes-marca'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/**
 * EL PDF DEL PEDIDO, ABIERTO DE VUELTA.
 *
 * Igual que con los Excel: no basta con que el PDF se genere. Se abre con poppler (pdfinfo,
 * pdffonts, pdftotext), que es otro lector, y se comprueba que lleve las tipografías de marca
 * dentro, que las páginas salgan numeradas, que la tabla repita la cabecera al cambiar de página
 * y que un nombre de Amazon con «™», emojis o letras de otro alfabeto no rompa nada.
 */

const HOY = '2026-10-20'
const CARPETA = mkdtempSync(join(tmpdir(), 'informe-pedido-'))

function linea(sobre: Partial<LineaDePanel> & { sku: string; enviadas: number }): LineaDePanel {
  return {
    recibidas: sobre.enviadas,
    nombre: `Producto ${sobre.sku}`,
    variante: null,
    asin: null,
    referencia: null,
    fnsku: null,
    ean: null,
    consumidas: 0,
    devueltas: 0,
    quedan: sobre.enviadas - (sobre.consumidas ?? 0),
    quedanVendibles: sobre.enviadas - (sobre.consumidas ?? 0),
    retiradas: 0,
    mermas: 0,
    agotadaEl: null,
    porDia: {},
    ...sobre,
  }
}

function remesa(lineas: LineaDePanel[], sobre: Partial<RemesaDePanel> = {}): RemesaDePanel {
  const porDia = new Map<string, number>()
  for (const l of lineas) for (const [f, v] of Object.entries(l.porDia)) porDia.set(f, (porDia.get(f) ?? 0) + v)
  const llegadaAt = sobre.llegadaAt === undefined ? '2026-10-01T09:00:00Z' : sobre.llegadaAt
  return {
    id: 'r1',
    nombre: 'Reposición de octubre',
    fechaEnvio: '2026-09-28',
    llegadaAt,
    referenciaEnvio: 'FBA15ABC',
    nota: null,
    estadoAmazon: 'CLOSED',
    seguimientoAt: null,
    seguimientoError: null,
    estado: 'cerrada',
    aprobadaAt: null,
    creadaAt: null,
    actualizadaAt: null,
    version: 1,
    reabiertaAt: null,
    ultimaImpresion: null,
    analisisIa: null,
    envios: [],
    unidadesQueNoLlegaron: 0,
    lineas,
    eventos: [
      { vistoAt: '2026-10-02T08:00:00Z', estadoAmazon: 'SHIPPED', enviadas: 100, recibidas: 0 },
      { vistoAt: '2026-10-05T08:00:00Z', estadoAmazon: 'DELIVERED', enviadas: 100, recibidas: 0 },
      { vistoAt: '2026-10-07T08:00:00Z', estadoAmazon: 'RECEIVING', enviadas: 100, recibidas: 80 },
    ],
    ventasPorDia: [...porDia.entries()].sort().map(([fecha, vendidas]) => ({ fecha, vendidas })),
    cuentaDesde: (llegadaAt ?? sobre.fechaEnvio ?? '2026-09-28').slice(0, 10),
    enviadas: lineas.reduce((s, l) => s + l.enviadas, 0),
    quedan: lineas.reduce((s, l) => s + l.quedan, 0),
    consumidoPct: 0,
    agotadaEl: null,
    ...sobre,
  }
}

/** n referencias con ventas repartidas por los días desde el 1 de octubre, siempre las mismas */
function muchas(n: number): LineaDePanel[] {
  return Array.from({ length: n }, (_, k) => {
    const enviadas = 10 + (k % 7) * 5
    const porDia: Record<string, number> = {}
    let vendidas = 0
    for (let d = 1; d <= 19; d += 1) {
      const v = (k + d) % 5 === 0 ? 1 + ((k + d) % 3) : 0
      if (v > 0 && vendidas + v <= enviadas) {
        porDia[`2026-10-${String(d).padStart(2, '0')}`] = v
        vendidas += v
      }
    }
    return linea({ sku: `SKU-${String(k + 1).padStart(3, '0')}`, nombre: `Zapatillas modelo ${k + 1} de casa para mujer con suela de caucho antideslizante y forro cálido`, variante: `Talla ${36 + (k % 8)}`, enviadas, recibidas: k % 11 === 0 ? enviadas - 2 : enviadas, consumidas: vendidas, quedan: enviadas - vendidas, porDia })
  })
}

/** Abre el PDF con poppler. null = no hay poppler en esta máquina */
function poppler(pdf: Uint8Array, nombre: string): { paginas: number; fuentes: string; texto: (p: number) => string } | null {
  const ruta = join(CARPETA, nombre)
  writeFileSync(ruta, pdf)
  try {
    const info = execFileSync('pdfinfo', [ruta], { encoding: 'utf8' })
    const fuentes = execFileSync('pdffonts', [ruta], { encoding: 'utf8' })
    console.log(`  (para verlo: ${ruta})`)
    return {
      paginas: Number(/Pages:\s+(\d+)/.exec(info)?.[1] ?? 0),
      fuentes,
      texto: (p) => execFileSync('pdftotext', ['-f', String(p), '-l', String(p), '-layout', ruta, '-'], { encoding: 'utf8' }),
    }
  } catch (e) {
    if (/ENOENT/.test(String(e))) {
      console.log('  (no hay poppler: se salta la lectura del PDF)')
      return null
    }
    ok('poppler abre el PDF', false, String(e).split('\n')[0])
    return null
  }
}

console.log('\n=== las fuentes de marca van empotradas y son las que son ===')
{
  const f = fuentesDeMarca()
  const sha = (b64: string) => createHash('sha256').update(Buffer.from(b64, 'base64')).digest('hex')
  ok('Sora SemiBold: los bytes coinciden con el SHA-256 apuntado', sha(f.soraSemibold) === FUENTES_SHA256.sora_semibold)
  ok('Inter Regular: los bytes coinciden con el SHA-256 apuntado', sha(f.interRegular) === FUENTES_SHA256.inter_regular)
  ok('Inter SemiBold: los bytes coinciden con el SHA-256 apuntado', sha(f.interSemibold) === FUENTES_SHA256.inter_semibold)
  ok('son TrueType de verdad (empiezan por 0x00010000)', [f.soraSemibold, f.interRegular, f.interSemibold].every((b) => Buffer.from(b, 'base64').readUInt32BE(0) === 0x00010000))
}

console.log('\n=== el texto que no tienen las fuentes se cambia o se quita ===')
{
  ok('«™» y los emojis se quitan; las tildes, «ñ», comillas, «€» y rayas se quedan', soportado('Zapatillas™ 🔥 Ñandú — “Edición” 20 €') === 'Zapatillas Ñandú — “Edición” 20 €', soportado('Zapatillas™ 🔥 Ñandú — “Edición” 20 €'))
  ok('las flechas y «≈» se cambian por su parecido', soportado('A → B ≈ C') === 'A -> B ~ C', soportado('A → B ≈ C'))
  ok('letras de otros alfabetos se quitan y no dejan huecos dobles', soportado('Cómoda 拖鞋 talla 39') === 'Cómoda talla 39', soportado('Cómoda 拖鞋 talla 39'))
  ok('saltos de línea y tabuladores son un espacio', soportado('uno\ndos\t tres') === 'uno dos tres')
}

console.log('\n=== un pedido cerrado con 60 referencias: varias páginas ===')
{
  const L = muchas(60)
  const r = remesa(L, { quedan: L.reduce((s, l) => s + l.quedan, 0) })
  const informe = informeDePedido({ cliente: 'ShoesF', remesa: r, skus: [], hoy: HOY, ventasHasta: '2026-10-19' })
  const out = pdfDeInforme(informe)
  ok('empieza por %PDF- y acaba por %%EOF', Buffer.from(out.pdf.slice(0, 5)).toString() === '%PDF-' && Buffer.from(out.pdf.slice(-8)).toString().includes('%%EOF'))
  ok('pesa menos de 200 KB con tres fuentes dentro', out.pdf.byteLength < 200_000, `${(out.pdf.byteLength / 1024).toFixed(0)} KB`)
  ok('el nombre del fichero es ASCII, con el cliente, el pedido y el día', out.nombreFichero === 'informe-pedido-shoesf-reposicion-de-octubre-2026-10-20.pdf', out.nombreFichero)
  ok('con 60 referencias salen entre 4 y 7 páginas', out.paginas >= 4 && out.paginas <= 7, String(out.paginas))
  const p = poppler(out.pdf, 'cerrado.pdf')
  if (p) {
    ok('poppler cuenta las mismas páginas', p.paginas === out.paginas, `${p.paginas} / ${out.paginas}`)
    ok('Sora e Inter van incrustadas (emb = yes), no sustituidas por Helvetica', /Sora\s+CID TrueType\s+Identity-H\s+yes/.test(p.fuentes) && (p.fuentes.match(/Inter\s+CID TrueType\s+Identity-H\s+yes/g) ?? []).length === 2, p.fuentes.split('\n').filter((x) => /Sora|Inter/.test(x)).join(' | '))
    const t1 = p.texto(1)
    ok('1ª página: el título, el cliente y la fecha', /Reposición de octubre/.test(t1) && /ShoesF/.test(t1) && /20 de octubre de 2026/.test(t1))
    ok('1ª página: dice hasta cuándo están leídas las ventas', /ventas leídas hasta el 19 de octubre de 2026/.test(t1))
    ok('1ª página: las siete cifras', ['ENVIADAS', 'RECIBIDAS', 'VENDIDAS', 'EN EL ALMACÉN', 'VELOCIDAD DE VENTA', 'EL STOCK DURA', 'EN EL ALMACÉN DESDE'].every((x) => t1.includes(x)))
    ok('1ª página: el recorrido en Amazon con sus pasos', ['Creado', 'En tránsito', 'Entregado', 'Registrado', 'Recibiendo', 'Cerrado'].every((x) => t1.includes(x)) && /02\/10\/2026/.test(t1))
    ok('1ª página: el resumen en palabras', /EN RESUMEN/.test(t1) && /Se enviaron \d+ unidades de 60 referencias/.test(t1.replace(/\s+/g, ' ')))
    ok('1ª página: el pie con «Página 1 de N»', new RegExp(`Página 1 de ${out.paginas}`).test(t1))
    const todas = Array.from({ length: out.paginas }, (_, k) => p.texto(k + 1))
    ok('cada página lleva su número', todas.every((t, k) => new RegExp(`Página ${k + 1} de ${out.paginas}`).test(t)))
    const conTabla = todas.filter((t) => /PRODUCTO/.test(t) && /ROTACIÓN/.test(t))
    ok('la tabla repite su cabecera en cada página que la lleva (al menos 3)', conTabla.length >= 3, String(conTabla.length))
    ok('salen las 60 referencias, ni una más ni una menos', new Set(todas.join('\n').match(/SKU-\d{3}/g)).size === 60, String(new Set(todas.join('\n').match(/SKU-\d{3}/g)).size))
    ok('«lo que no llegó» sale con su título y sus faltas (6 referencias con 2 de menos)', /LO QUE AMAZON NO HA RECIBIDO/.test(todas.join('\n')) && /Faltan 12 unidades en 6 referencias/.test(todas.join('\n').replace(/\s+/g, ' ')))
    ok('las notas van al final', /A TENER EN CUENTA/.test(todas[todas.length - 1]) && /orden de llegada/.test(todas[todas.length - 1].replace(/\s+/g, ' ')))
  }
}

console.log('\n=== un pedido que va de camino: sin gráficos ni ventas inventadas ===')
{
  const L = [linea({ sku: 'A-1', enviadas: 50, recibidas: 0, quedan: 50 }), linea({ sku: 'B-2', enviadas: 40, recibidas: 0, quedan: 40 })]
  const r = remesa(L, { estadoAmazon: 'IN_TRANSIT', llegadaAt: null, fechaEnvio: '2026-10-18', eventos: [{ vistoAt: '2026-10-19T08:00:00Z', estadoAmazon: 'IN_TRANSIT', enviadas: 90, recibidas: 0 }] })
  const out = pdfDeInforme(informeDePedido({ cliente: 'Cobo Family', remesa: r, skus: [], hoy: HOY }))
  const p = poppler(out.pdf, 'en-camino.pdf')
  ok('una o dos páginas', out.paginas <= 2, String(out.paginas))
  if (p) {
    const t = p.texto(1).replace(/\s+/g, ' ')
    ok('dice que va de camino y no enseña «faltan»', /Todavía no han llegado/.test(t) && !/faltan/i.test(t) && /va de camino/.test(t), t.slice(0, 200))
    ok('no hay gráficos de ventas ni «en qué ha quedado»: solo el aviso de que va de camino', !/Ventas por día/.test(t) && /Las 90 unidades van de camino/.test(t))
    ok('la tabla no inventa rotación: «En camino» y no «Sin ventas»', /En camino/.test(t) && !/Sin ventas/.test(t), t.slice(-300))
  }
}

console.log('\n=== nombres de Amazon con símbolos que las fuentes no tienen ===')
{
  const L = [
    linea({ sku: 'X-1', nombre: 'Zapatillas™ 🔥 Ñandú — “Edición” 20 € → nuevas 拖鞋', variante: 'Talla 39 ★', enviadas: 10, consumidas: 4, quedan: 6, porDia: { '2026-10-18': 4 } }),
    linea({ sku: 'X-2', nombre: null, variante: null, enviadas: 5, consumidas: 0, quedan: 5 }),
  ]
  const out = pdfDeInforme(informeDePedido({ cliente: 'Yo By Yolanda', remesa: remesa(L), skus: [], hoy: HOY }))
  const p = poppler(out.pdf, 'simbolos.pdf')
  if (p) {
    const t = p.texto(1) + p.texto(2 <= p.paginas ? 2 : 1)
    ok('el nombre sale sin los símbolos y con sus tildes', /Zapatillas Ñandú — “Edición” 20 € -> nuevas/.test(t.replace(/\s+/g, ' ')) && !/🔥|™|拖/.test(t), t.replace(/\s+/g, ' ').match(/Zapatillas[^|]{0,60}/)?.[0] ?? '')
    ok('un producto sin nombre sale con su SKU y un guion, sin reventar', /X-2/.test(t))
  }
}

console.log('\n=== retiradas, mermas, devoluciones y cantidades grandes ===')
{
  const L = [
    linea({ sku: 'G-1', enviadas: 12_000, recibidas: 11_800, consumidas: 9_000, devueltas: 100, retiradas: 120, mermas: 30, quedan: 2_800, porDia: { '2026-10-10': 4_500, '2026-10-17': 4_500 } }),
    linea({ sku: 'G-2', enviadas: 500, consumidas: 500, quedan: 0, agotadaEl: '2026-10-15', porDia: { '2026-10-15': 500 } }),
  ]
  const informe = informeDePedido({ cliente: 'ShoesF', remesa: remesa(L), skus: [], hoy: HOY })
  const out = pdfDeInforme(informe)
  const p = poppler(out.pdf, 'grande.pdf')
  ok('el embudo tiene las cuatro partes (ventas reales, retiradas y mermas, almacén, sin llegar)', informe.embudo.every((x) => x.unidades > 0), informe.embudo.map((x) => x.unidades).join())
  if (p) {
    const t = p.texto(1) + p.texto(Math.min(2, p.paginas))
    const plano = t.replace(/\s+/g, ' ')
    // En español los números de cuatro cifras no llevan punto («9500»): es la regla de toLocaleString('es-ES') y la misma de la pantalla
    ok('las cifras grandes no se salen: «12.500» enviadas y «9500» vendidas, como en la pantalla', /12\.500/.test(plano) && /\b9500\b/.test(plano), plano.slice(0, 300))
    ok('explica las no ventas en las notas', /incluye 150 unidades que no son ventas/.test(plano))
    ok('las cuatro partes del embudo con su leyenda', ['Vendidas', 'Retiradas y mermas', 'En el almacén', 'No han llegado'].every((x) => plano.includes(x)))
  }
}

console.log('\n=== títulos y clientes larguísimos ===')
{
  const largo = 'Reposición de temporada de invierno para todas las tallas de mujer y de hombre incluyendo los modelos nuevos de la colección de otoño y los que quedaron pendientes del envío anterior'
  const L = [linea({ sku: 'A-1', enviadas: 10, quedan: 10 })]
  const cliente = 'Comercializadora Internacional de Calzado y Complementos de la Península Ibérica Sociedad Limitada Unipersonal'
  const out = pdfDeInforme(informeDePedido({ cliente, remesa: remesa(L, { nombre: largo }), skus: [], hoy: HOY }))
  const p = poppler(out.pdf, 'largo.pdf')
  if (p) {
    const t = p.texto(1).replace(/\s+/g, ' ')
    ok('el título largo acaba en «…» en vez de perder el resto en silencio', /Reposición de temporada de invierno .*…/.test(t) && !/envío anterior/.test(t), t.slice(0, 260))
    ok('el cliente larguísimo se recorta con «…» y no se sale de la página', /Comercializadora Internacional .*…/.test(t))
  }
  ok('el nombre del fichero sigue siendo corto y ASCII', out.nombreFichero.length < 110 && /^[a-z0-9.-]+$/.test(out.nombreFichero), out.nombreFichero)
}

console.log('\n=== un ritmo ínfimo: «+365 días», no miles ===')
{
  const L = [linea({ sku: 'L', enviadas: 2001, consumidas: 1, quedan: 2000, porDia: { '2026-10-19': 1 } })]
  const out = pdfDeInforme(informeDePedido({ cliente: 'C', remesa: remesa(L), skus: [], hoy: HOY }))
  const p = poppler(out.pdf, 'lento.pdf')
  if (p) {
    const t = p.texto(1).replace(/\s+/g, ' ')
    ok('la tarjeta dice «+365 días» y el resumen «más de un año»', /\+365/.test(t) && /más de un año/.test(t), t.slice(0, 400))
  }
}

console.log('\n=== un pedido de hoy, sin ventas ===')
{
  const L = [linea({ sku: 'A-1', enviadas: 30, quedan: 30 })]
  const r = remesa(L, { llegadaAt: '2026-10-20T07:00:00Z', fechaEnvio: '2026-10-15', eventos: [] })
  const informe = informeDePedido({ cliente: 'C', remesa: r, skus: [], hoy: HOY })
  ok('la serie tiene un solo día y no revienta', informe.serie.length === 1)
  const out = pdfDeInforme(informe)
  const p = poppler(out.pdf, 'hoy.pdf')
  if (p) {
    const t = p.texto(1).replace(/\s+/g, ' ')
    ok('sin ventas dice «Sin ventas todavía» en el gráfico', /Sin ventas todavía/.test(t))
    ok('el recorrido en Amazon sale entero aunque no se haya visto ningún paso', /Creado/.test(t) && /Cerrado/.test(t))
  }
}

console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
