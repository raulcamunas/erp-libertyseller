/**
 * Pruebas del diagnóstico de SEO Test: el embudo de Brand Analytics, la norma de 2026 de la ficha, la propuesta limpia y «qué hacer hoy».
 * Se corre con: npx tsx lib/seo/diagnostico.prueba.ts
 *
 * Las búsquedas de ejemplo son las REALES de Opinas (tarjetas NFC de reseñas, octubre de 2026, ASIN B0GV4FLP99, precio 29,90 €): así se comprueba que el diagnóstico dice lo que diría una persona
 * que conoce el SOP mirando esos mismos números.
 */
import { coberturaDe, LIMITE_BACKEND_BYTES, LIMITE_TITULO_CARACTERES, raiz, bytesDe } from './cobertura'
import { diagnosticar, diagnosticarTodas, embudoDelProducto, sumarEmbudo, contextoDe, type FilaDeEmbudo } from './embudo'
import { backendRepetido, revisarFicha } from './norma'
import { limpiarPropuesta, recortarBullets } from './propuesta'
import { resumenDeProducto } from './resumen'
import { palabrasQuePesan, tareasDeLaCuenta, ventanaDeCambio } from './tareas'
import type { ConsultaGuardada, FichaGuardada } from './datos'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/** Una fila con los recuentos de Brand Analytics: [volumen, imp total, imp tuyas, clics total, tuyos, carritos total, tuyos, compras total, tuyas, precio mediano total, tuyo] */
function fila(consulta: string, n: Array<number | null>): ConsultaGuardada {
  const [volumen, it, ia, ct, ca, kt, ka, pt, pa, pmt, pma] = n
  const c = (a: number | null, t: number | null) => (a != null && t ? a / t : null)
  return {
    asin: 'B0GV4FLP99', periodo: 'MONTH', desde: '2026-10-01', hasta: '2026-10-31', consulta, puntuacion: null, volumen,
    impresionesTotal: it, impresionesAsin: ia, cuotaImpresiones: c(ia, it), clicsTotal: ct, clicsAsin: ca, cuotaClics: c(ca, ct), carritosTotal: kt, carritosAsin: ka, cuotaCarritos: c(ka, kt),
    comprasTotal: pt, comprasAsin: pa, cuotaCompras: c(pa, pt), precioMedianoTotal: pmt, precioMedianoAsin: pma,
  }
}

const OPINAS: ConsultaGuardada[] = [
  fila('google', [7653, 197755, 173, 1618, 0, 136, 0, 14, 0, 26.99, null]),
  fila('nfc', [6987, 201252, 134, 2872, 1, 752, 0, 241, 0, 8.88, null]),
  fila('tarjetas nfc', [6704, 196124, 2638, 2752, 45, 329, 5, 68, 3, 10.95, 29.9]),
  fila('nfc google', [3557, 105211, 2141, 1197, 64, 108, 1, 18, 1, 19.99, 29.9]),
  fila('tarjetas nfc reseñas google', [2938, 77387, 2454, 1248, 88, 102, 6, 12, 1, 20.9, 29.9]),
  fila('etiquetas nfc', [2242, 68287, 75, 1043, 2, 277, 0, 96, 0, 7.99, null]),
  fila('tarjeta reseñas google nfc', [1296, 41345, 1060, 454, 65, 38, 4, 6, 1, 29.9, 29.9]),
  fila('reseñas google', [1275, 34814, 969, 443, 17, 77, 4, 30, 0, 21.99, null]),
  fila('mis reseñas', [963, 22706, 213, 4, 0, 0, 0, 0, 0, null, null]),
  fila('placa reseñas google', [1029, 32721, 461, 305, 3, 36, 0, 8, 0, 21.9, null]),
  fila('tarjeta para reseñas google', [457, 11475, 461, 135, 10, 7, 1, 1, 0, 29.9, null]),
]
const FICHA: FichaGuardada = {
  asin: 'B0GV4FLP99', sku: '12-CDXR-I4TN', titulo: 'OPINAS Tarjetas NFC compatibles con Reseñas Google y Código QR - Pack 5',
  bullets: ['CADA EMPLEADO CON SU PROPIA TARJETA: cinco tarjetas NFC para que el camarero pida la reseña.', 'PUBLICA EN SEGUNDOS: el cliente acerca el teléfono a la tarjeta NFC o escanea el código QR.'],
  descripcion: null, backend: 'placa cartel review card restaurante bar hotel tarjetas', leidaAt: '2026-11-13T22:46:03Z',
}

console.log('\n=== raíz y cobertura ===')
{
  ok('singular y plural de lo que acaba en vocal casan (cable/cables, llave/llaves, noche/noches)', raiz('cable') === raiz('cables') && raiz('llave') === raiz('llaves') && raiz('noche') === raiz('noches'), [raiz('cable'), raiz('cables')].join('/'))
  ok('y los de consonante también (jamón/jamones, box/boxes, glass/glasses)', raiz('jamon') === raiz('jamones') && raiz('box') === raiz('boxes') && raiz('glass') === raiz('glasses'))
  const c = coberturaDe('cables usb', { titulo: 'Cable USB-C trenzado', bullets: [], descripcion: null, backend: null })
  ok('«cables» está aunque el título diga «cable» (antes salía «falta: cable»)', c.titulo && c.faltan.length === 0, JSON.stringify(c))
  const d = coberturaDe('soportes jamoneros', { titulo: 'Tabla de cortar', bullets: [], descripcion: null, backend: null })
  ok('lo que falta se enseña tal cual se buscó, no la raíz interna', d.faltan.join() === 'soportes,jamoneros', d.faltan.join())
}

console.log('\n=== el embudo (SOP: quién arregla qué) ===')
{
  const { contexto, busquedas } = diagnosticarTodas(OPINAS, 29.9)
  const v = (q: string) => busquedas.find((b) => b.fila.consulta === q)!.veredicto
  ok('el precio propio sale del listing (29,90)', contexto.precioPropio === 29.9)
  ok('«google»: casi nadie compra → ruido', v('google').tipo === 'ruido', JSON.stringify(v('google')))
  ok('«mis reseñas»: ninguna compra → ruido', v('mis reseñas').tipo === 'ruido')
  ok('«nfc»: el sector compra a 8,88 € y vendemos a 29,90 → otro precio (falso amigo: pegatinas)', v('nfc').tipo === 'otro-precio', JSON.stringify(v('nfc')))
  ok('«etiquetas nfc» (7,99 €) → otro precio', v('etiquetas nfc').tipo === 'otro-precio')
  ok('«tarjetas nfc» (10,95 €) también: el sector compra a menos de la mitad', v('tarjetas nfc').tipo === 'otro-precio')
  const ng = v('nfc google')
  ok('«nfc google»: 5,3 % de clics pero 1 carrito de ~6 esperados → se pierde en el carrito (no es SEO)', ng.tipo === 'fuga' && ng.etapa === 'carrito', JSON.stringify(ng))
  const tr = v('tarjeta reseñas google nfc')
  ok('«tarjeta reseñas google nfc»: 2,6 % de impresiones y 14 % de clics → visibilidad, y convierte por encima de la media', tr.tipo === 'visibilidad' && (tr.fuerza ?? 0) > 1.2, JSON.stringify(tr))
  ok('«placa reseñas google»: 3 clics de 4,3 esperados (×0,70, por debajo del umbral 0,7) → pierde en clics', v('placa reseñas google').tipo === 'fuga', JSON.stringify(v('placa reseñas google')))
  ok('con el umbral viejo del SOP (0,5) la misma búsqueda no se caía: el umbral se puede cambiar', diagnosticar(OPINAS[9], { ...contexto, umbrales: { caida: 0.5 } }).tipo === 'visibilidad')
  ok('«tarjeta reseñas google nfc»: una sola compra no basta para llamarla infraexpuesta', tr.tipo === 'visibilidad')
  const infra = diagnosticar(fila('z', [2000, 50000, 1000, 1500, 60, 200, 12, 100, 8, null, null]), { precioPropio: null, tasaMediana: null })
  ok('2 % de impresiones y 8 % de compras (×4) con 8 compras → INFRAEXPUESTA (trabajo de PPC)', infra.tipo === 'infraexpuesta' && Math.abs(infra.fuerza - 4) < 1e-9, JSON.stringify(infra))
  const muchaExposicion = diagnosticar(fila('w', [2000, 50000, 12000, 1500, 400, 200, 60, 100, 28, null, null]), { precioPropio: null, tasaMediana: null })
  ok('con el 24 % de impresiones ya no es infraexpuesta (pasa del 20 %)', muchaExposicion.tipo !== 'infraexpuesta', JSON.stringify(muchaExposicion))
  ok('el ruido no pesa al ordenar', busquedas.find((b) => b.fila.consulta === 'google')!.impacto === 0)
  ok('una búsqueda sin datos suficientes no se juzga como fuga (0 de 1 esperado es azar)', diagnosticar(fila('x', [100, 1000, 10, 100, 0, 10, 0, 5, 0, null, null]), { precioPropio: null, tasaMediana: null }).tipo === 'visibilidad')
  const lider = diagnosticar(fila('y', [1000, 10000, 2000, 500, 200, 100, 40, 50, 20, null, null]), { precioPropio: null, tasaMediana: null })
  ok('con el 40 % de las compras y sin caídas → líder (mantener)', lider.tipo === 'lider', JSON.stringify(lider))
  const sinPrecio = diagnosticar(OPINAS[1], { precioPropio: null, tasaMediana: null })
  ok('sin precio propio no se descarta por precio', sinPrecio.tipo !== 'otro-precio')
  ok('sin precio del listing, se estima con el mediano al que nos compran', contextoDe(OPINAS, null).precioPropio === 29.9)
}

console.log('\n=== el embudo del producto entero (la puerta de salida) ===')
{
  const { contexto, busquedas } = diagnosticarTodas(OPINAS, 29.9)
  const p = embudoDelProducto(busquedas, contexto)
  ok('suma solo lo relevante (fuera ruido y otro precio: 5 descartadas)', p.relevantes === 6 && p.descartadas === 5, `${p.relevantes}/${p.descartadas}`)
  // Sumadas, las 6 relevantes: 2,5 % de impresiones → 6,5 % de clics → 16 carritos de 24 esperados (×0,67, por debajo de 0,7): el producto pierde en el carrito
  ok('sumado, el producto pierde en el carrito: la puerta de salida dice que reescribir el título no es lo primero', p.veredicto?.tipo === 'fuga' && p.veredicto.etapa === 'carrito', JSON.stringify(p.veredicto))
  const conFuga = embudoDelProducto(diagnosticarTodas([fila('a', [5000, 100000, 3000, 2000, 10, 200, 1, 50, 0, null, null]), fila('b', [3000, 60000, 2000, 1500, 5, 150, 0, 40, 0, null, null])], null).busquedas, { precioPropio: null, tasaMediana: null })
  ok('un producto que sale (3 %) pero nadie pincha → fuga en clics: la puerta de salida dice «no es SEO»', conFuga.veredicto?.tipo === 'fuga' && conFuga.veredicto.etapa === 'clics', JSON.stringify(conFuga.veredicto))
  const s = sumarEmbudo([OPINAS[3], OPINAS[4]])
  ok('la suma de dos búsquedas: cuotas = suma ÷ suma', s.impresionesAsin === 4595 && Math.abs((s.cuotaClics as number) - 152 / 2445) < 1e-12)
}

console.log('\n=== norma de 2026 ===')
{
  ok('los límites son los de 2026', LIMITE_TITULO_CARACTERES === 75 && LIMITE_BACKEND_BYTES === 249)
  const largo = revisarFicha({ titulo: 'Marca Jamón Ibérico de Cebo Entero 7-8 kg Curado 24 Meses Ideal para Regalo de Navidad y Empresa', bullets: ['a', 'b', 'c', 'd', 'e'], descripcion: null, backend: 'x' })
  ok('título de 96 caracteres → grave, con el recuento calculado', largo.incidencias[0].id === 'titulo-largo' && largo.incidencias[0].gravedad === 'grave' && largo.medidas.tituloCaracteres === 96, JSON.stringify(largo.incidencias[0]))
  const malo = revisarFicha({ titulo: 'Jamón jamón JAMÓN oferta 29,90 € ¡ya!', bullets: [], descripcion: null, backend: '' })
  const ids = malo.incidencias.map((i) => i.id)
  ok('palabras 3 veces, promocional, precio, símbolos, sin viñetas y backend vacío', ['titulo-repetidas', 'titulo-promocional', 'titulo-precio', 'titulo-simbolos', 'bullets-vacios', 'backend-vacio'].every((x) => ids.includes(x)), ids.join())
  const bytes = revisarFicha({ titulo: 'Corto', bullets: Array.from({ length: 5 }, () => 'á'.repeat(110)), descripcion: null, backend: 'ñ'.repeat(130) })
  ok('viñetas de 1.100 bytes (las tildes cuentan doble) → grave', bytes.incidencias.some((i) => i.id === 'bullets-largos') && bytes.medidas.bulletsBytes === 1100)
  ok('backend de 260 bytes → grave (Amazon lo ignora entero)', bytes.incidencias.some((i) => i.id === 'backend-largo' && i.gravedad === 'grave'))
  const rep = backendRepetido('tarjetas placa nfc placa qr', 'Tarjeta NFC con código QR')
  ok('backend: «tarjetas», «nfc» y «qr» ya están arriba y «placa» se repite → 4 palabras y sus bytes', rep.palabras.join() === 'tarjetas,nfc,placa,qr' && rep.bytes === 9 + 4 + 6 + 3, JSON.stringify(rep))
  const opinas = revisarFicha(FICHA)
  ok('la ficha real de Opinas: título de 71 (cabe), 2 viñetas, backend con «tarjetas» repetida', opinas.medidas.tituloCaracteres === 71 && !opinas.incidencias.some((i) => i.id === 'titulo-largo') && opinas.incidencias.some((i) => i.id === 'bullets-pocos') && opinas.medidas.backendRepetidas.includes('tarjetas'), JSON.stringify(opinas.medidas))
}

console.log('\n=== la propuesta limpia (recuentos con código) ===')
{
  const r = limpiarPropuesta({
    titulo: 'OPINAS Tarjetas NFC Reseñas Google con Código QR, Pack de 5 Tarjetas para Negocio y Restaurante',
    highlights: 'Pack de 5 tarjetas NFC y QR para pedir reseñas en Google a tus clientes sin app, compatibles con iPhone y Android, para bares, clínicas y tiendas',
    bullets: Array.from({ length: 5 }, (_, i) => `VIÑETA ${i}: ` + 'texto con tilde á '.repeat(14)),
    backend: 'tarjetas placa cartel review card resenas',
    razonamiento: { resumen: 'x', cambios: [{ campo: 'highlights', que: 'nuevo', porQue: 'y' }], palabrasNuevas: [], descartado: [{ termino: 'nfc', porQue: 'otro precio' }] },
  })
  if ('error' in r) ok('sin error', false, r.error)
  else {
    ok('título ≤ 75', [...r.titulo].length <= 75, `${[...r.titulo].length}: ${r.titulo}`)
    ok('highlights ≤ 125', [...(r.highlights ?? '')].length <= 125, String(r.highlights?.length))
    ok('viñetas ≤ 1.000 bytes sumando las cinco', r.bullets.reduce((s, b) => s + bytesDe(b), 0) <= 1000, String(r.bullets.reduce((s, b) => s + bytesDe(b), 0)))
    ok('backend sin palabras que ya están arriba («tarjetas», «resenas»)', !r.backend.split(' ').includes('tarjetas') && !r.backend.split(' ').includes('resenas'), r.backend)
    ok('lo descartado y el campo «highlights» del razonamiento pasan', r.razonamiento.descartado?.[0]?.termino === 'nfc' && r.razonamiento.cambios[0].campo === 'highlights')
    ok('dice que ha recortado título, highlights y viñetas', r.avisos.length >= 3, JSON.stringify(r.avisos))
  }
  const rb = recortarBullets(['a'.repeat(600), 'b'.repeat(300), 'c'.repeat(200)])
  ok('recortar viñetas quita de la más larga y deja las cortas', rb.bullets.reduce((s, b) => s + bytesDe(b), 0) <= 1000 && rb.bullets[2].length === 200, rb.bullets.map((b) => b.length).join())
}

console.log('\n=== resumen: la cuota de impresiones es suma ÷ suma (como la evolución) ===')
{
  const r = resumenDeProducto([OPINAS[3], OPINAS[4]], null)
  ok('(2141 + 2454) / (105211 + 77387)', Math.abs((r.cuotaImpresiones as number) - 4595 / 182598) < 1e-12, String(r.cuotaImpresiones))
}

console.log('\n=== qué hacer hoy ===')
{
  const { busquedas } = diagnosticarTodas(OPINAS, 29.9)
  const pq = palabrasQuePesan(busquedas, FICHA)
  ok('las palabras se eligen solo de búsquedas del producto: ni «etiquetas» (falso amigo) ni «mis» (ruido)', !pq.some((p) => p.palabra === 'etiquetas' || p.palabra === 'mis'), pq.map((p) => p.palabra).join())
  ok('«placa» pesa y está en el backend, no en el título', pq.some((p) => p.palabra === 'placa' && p.enBackend && !p.enTitulo))

  const v = ventanaDeCambio([{ asin: 'A', aplicadaAt: '2026-11-01T10:00:00Z' }], 'A', '2026-11-14')
  ok('cambiada el 1 nov: no se toca hasta el 1 dic y se juzga desde el 22 nov', v?.bloqueada === true && v.puedeDesde === '2026-12-01' && v.juzgarDesde === '2026-11-22' && !v.juzgable, JSON.stringify(v))
  ok('sin cambios aplicados: no hay ventana', ventanaDeCambio([], 'A', '2026-11-14') === null)

  const base = {
    hoy: '2026-11-14',
    lectura: { acceso: 'si' as const, mesOk: '2026-10-01', semanaOk: '2026-11-01', fichaLeidaAt: '2026-11-13T00:00:00Z' },
    productos: [{ id: '1', asin: 'B0GV4FLP99', sku: '12-CDXR-I4TN', nombre: 'Tarjetas NFC' }, { id: '2', asin: 'B0SINSKU01', sku: null, nombre: 'Placa' }],
    fichas: [{ ...FICHA, titulo: `${FICHA.titulo} para Restaurantes Bares Hoteles y Clínicas` }],
    consultas: { MONTH: OPINAS, WEEK: [] },
    evolucion: [
      { asin: 'B0GV4FLP99', periodo: 'MONTH' as const, desde: '2026-09-01', hasta: '2026-09-30', busquedas: 100, volumen: 57195, compras: 58, cuotaCompras: 58 / 614, cuotaImpresiones: 0.03 },
      { asin: 'B0GV4FLP99', periodo: 'MONTH' as const, desde: '2026-10-01', hasta: '2026-10-31', busquedas: 100, volumen: 54227, compras: 12, cuotaCompras: 12 / 725, cuotaImpresiones: 0.012 },
    ],
    precios: { B0GV4FLP99: 29.9 },
    cambios: [{ asin: 'B0GV4FLP99', aplicadaAt: '2026-11-01T10:00:00Z' }],
  }
  const t = tareasDeLaCuenta(base)
  const tipos = t.map((x) => `${x.gravedad}:${x.tipo}`)
  ok('lo grave va primero', t[0].gravedad === 'grave' && t.findIndex((x) => x.gravedad !== 'grave') > 0, tipos.join(' '))
  ok('título de 113 caracteres → tarea grave de norma, bloqueada por la ventana hasta el 1 dic', t.some((x) => x.id.endsWith('norma:titulo-largo') && x.bloqueadaHasta === '2026-12-01'), JSON.stringify(t.find((x) => x.tipo === 'norma')))
  ok('la caída de la cuota de compras (9,4 % → 1,7 %) sale como grave', t.some((x) => x.tipo === 'caida' && x.gravedad === 'grave'))
  ok('el embudo del producto (carrito) sale como tarea «no es SEO», y «nfc google» entre las búsquedas que pierden en el carrito', t.some((x) => x.tipo === 'embudo' && x.titulo.includes('no es SEO') && x.quien === 'Bullets, A+ o precio') && t.some((x) => x.id === 'B0GV4FLP99:fugas:carrito' && x.etiquetas?.includes('nfc google')), JSON.stringify(t.filter((x) => x.tipo === 'fugas' || x.tipo === 'embudo').map((x) => x.titulo)))
  ok('si las búsquedas que no se caen ya están enteras en el título, no hay «oportunidad» que proponer', !t.some((x) => x.tipo === 'oportunidad'))
  const sinNfc = tareasDeLaCuenta({ ...base, fichas: [{ ...FICHA, titulo: 'OPINAS Tarjetas de Reseñas Google con Código QR - Pack 5' }] })
  ok('con un título sin «NFC», «tarjeta reseñas google nfc» es candidata al título (oportunidad de SEO)', sinNfc.some((x) => x.tipo === 'oportunidad' && x.etiquetas?.includes('tarjeta reseñas google nfc')), JSON.stringify(sinNfc.find((x) => x.tipo === 'oportunidad')))
  const conInfra = tareasDeLaCuenta({ ...base, consultas: { MONTH: [...OPINAS, { ...fila('tarjetas google review', [2000, 50000, 1000, 1500, 60, 200, 12, 100, 8, 25, 29.9]) }], WEEK: [] } })
  ok('una búsqueda infraexpuesta sale como tarea de PPC, no de SEO, y sin bloqueo de la ventana', conInfra.some((x) => x.tipo === 'infraexpuesta' && x.quien === 'PPC' && !x.bloqueadaHasta && x.etiquetas?.includes('tarjetas google review')))

  // El vigía de títulos
  const reescrito = { ...FICHA, tituloAnterior: 'OPINAS Tarjetas NFC Reseñas Google', tituloCambiadoAt: '2026-11-10T03:00:00Z' }
  const conVigia = tareasDeLaCuenta({ ...base, cambios: [], fichas: [reescrito] })
  ok('título cambiado el 10 nov sin propuesta aplicada → grave, revisar antes del 24 nov', conVigia.some((x) => x.tipo === 'reescrito' && x.gravedad === 'grave' && x.accion.includes('24 de noviembre')), JSON.stringify(conVigia.find((x) => x.tipo === 'reescrito')))
  const nuestro = tareasDeLaCuenta({ ...base, cambios: [{ asin: 'B0GV4FLP99', aplicadaAt: '2026-11-09T10:00:00Z' }], fichas: [reescrito] })
  ok('si lo cambiamos nosotros el día antes, no hay aviso', !nuestro.some((x) => x.tipo === 'reescrito'))
  ok('pasados los 14 días, el aviso ya no sale', !tareasDeLaCuenta({ ...base, hoy: '2026-11-30', cambios: [], fichas: [reescrito] }).some((x) => x.tipo === 'reescrito'))
  ok('el producto sin SKU tiene su tarea', t.some((x) => x.id === 'B0SINSKU01:sin-sku'))
  ok('la ventana de cambio se avisa', t.some((x) => x.tipo === 'ventana'))
  ok('sin productos, sin tareas', tareasDeLaCuenta({ ...base, productos: [] }).length === 0)
}

console.log(fallos === 0 ? '\nTODO OK' : `\n${fallos} FALLOS`)
process.exit(fallos === 0 ? 0 : 1)
