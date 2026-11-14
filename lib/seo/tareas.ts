/**
 * SEO · «QUÉ HACER HOY» EN UNA CUENTA Y PAÍS. PURO (se prueba sin base de datos).
 *
 * Junta, producto a producto, todo lo que dicen los datos y lo convierte en una lista de tareas ordenada por impacto, cada una con QUIÉN la hace y QUÉ se hace según el SOP de la agencia:
 *   · la ficha fuera de las reglas de 2026 (título > 75, backend > 249 bytes, viñetas > 1.000 bytes…) — lo primero, porque Amazon reescribe o ignora lo que se pasa;
 *   · dónde se cae el embudo del producto (si es en clics, carrito o compra, NO es trabajo de SEO y se dice);
 *   · caídas de la cuota de compras frente al periodo anterior;
 *   · las búsquedas con más compras en juego donde se pierde en un escalón concreto;
 *   · las palabras que pesan en búsquedas DEL producto (no ruido ni falsos amigos) y no están en ninguna parte de la ficha;
 *   · las búsquedas INFRAEXPUESTAS (convierte de sobra y sale poco): trabajo de PPC, la vía rápida de exposición;
 *   · las búsquedas del producto con más compras en juego que no están enteras en el título (candidatas al próximo cambio: la oportunidad de SEO);
 *   · el VIGÍA DE TÍTULOS: si el título leído de Amazon cambió sin un cambio nuestro, puede ser la IA de Amazon reescribiéndolo (hay 14 días para revisarlo en «Review Listing Changes»);
 *   · lo que impide trabajar: productos sin SKU, fichas sin leer, sin búsquedas.
 *
 * LA VENTANA DE CAMBIO (SOP): máximo un cambio de título cada 30 días por producto y 21 días antes de juzgarlo. Si la ficha se cambió hace menos, las tareas que tocan el título salen marcadas
 * «no tocar hasta…» en vez de desaparecer: se ve el trabajo pendiente pero no se hace a destiempo.
 *
 * El «impacto» son compras al mes (o a la semana) de todo Amazon que todavía no son del producto, en las búsquedas a las que afecta la tarea. No es una promesa de ventas: sirve para ordenar.
 */

import { coberturaDe, tokens } from './cobertura'
import type { ConsultaGuardada, FichaGuardada, ProductoSeguido, PuntoDeEvolucion } from './datos'
import { diagnosticarTodas, embudoDelProducto, esRelevante, NOMBRE_DE_ETAPA, RESPONSABLE, RESPONSABLE_INFRAEXPUESTA, type BusquedaDiagnosticada, type Etapa } from './embudo'
import { promocionalesEn, revisarFicha, type Gravedad } from './norma'

export type TipoDeTarea = 'norma' | 'embudo' | 'caida' | 'fugas' | 'palabras' | 'oportunidad' | 'infraexpuesta' | 'reescrito' | 'datos' | 'ventana'

export interface Tarea {
  id: string
  asin: string | null
  tipo: TipoDeTarea
  gravedad: Gravedad
  titulo: string
  detalle: string
  accion: string
  quien: string
  impacto: number
  /** Adónde lleva el botón de la tarea */
  ir: 'ficha' | 'busquedas' | 'productos' | null
  /** Palabras o búsquedas concretas, para enseñarlas como etiquetas */
  etiquetas?: string[]
  /** Si toca el título y la ficha se cambió hace menos de 30 días: hasta cuándo no se toca */
  bloqueadaHasta?: string | null
}

/** Días que da Amazon para aceptar, editar o rechazar su reescritura de un título (Review Listing Changes) */
export const DIAS_REVISION_REESCRITURA = 14

export interface EntradaDeTareas {
  hoy: string
  lectura: { acceso: 'desconocido' | 'si' | 'no'; mesOk: string | null; semanaOk: string | null; fichaLeidaAt: string | null }
  productos: readonly ProductoSeguido[]
  fichas: readonly FichaGuardada[]
  consultas: { MONTH: readonly ConsultaGuardada[]; WEEK: readonly ConsultaGuardada[] }
  evolucion?: readonly PuntoDeEvolucion[]
  /** El precio del listing de cada ASIN (amazon_listings); si falta, se estima con lo que dice Brand Analytics */
  precios?: Readonly<Record<string, number | null>>
  /** Las propuestas de ficha aplicadas en Amazon (para la ventana de 30 días) */
  cambios?: ReadonlyArray<{ asin: string; aplicadaAt: string }>
}

const DIA = 86_400_000
export const DIAS_ENTRE_CAMBIOS = 30
export const DIAS_PARA_JUZGAR = 21

const fechaLarga = (d: string) => new Date(`${d.slice(0, 10)}T00:00:00Z`).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', timeZone: 'UTC' })
const sumarDias = (d: string, n: number) => new Date(Date.parse(`${d.slice(0, 10)}T00:00:00Z`) + n * DIA).toISOString().slice(0, 10)
const pct = (x: number) => `${(x * 100).toLocaleString('es-ES', { maximumFractionDigits: 1 })} %`
const ent = (x: number) => Math.round(x).toLocaleString('es-ES')

/** La ventana del SOP para un producto: desde cuándo se puede volver a cambiar el título y cuándo se juzga el último cambio */
export function ventanaDeCambio(cambios: ReadonlyArray<{ asin: string; aplicadaAt: string }>, asin: string, hoy: string): { ultimo: string; puedeDesde: string; juzgarDesde: string; bloqueada: boolean; juzgable: boolean } | null {
  const ultimo = cambios
    .filter((c) => c.asin === asin && c.aplicadaAt)
    .map((c) => c.aplicadaAt.slice(0, 10))
    .sort()
    .pop()
  if (!ultimo) return null
  const puedeDesde = sumarDias(ultimo, DIAS_ENTRE_CAMBIOS)
  const juzgarDesde = sumarDias(ultimo, DIAS_PARA_JUZGAR)
  return { ultimo, puedeDesde, juzgarDesde, bloqueada: hoy < puedeDesde, juzgable: hoy >= juzgarDesde }
}

/** Las búsquedas de un producto: las del mes si las hay (más estables), si no las de la semana */
export function consultasDelProducto(consultas: EntradaDeTareas['consultas'], asin: string): { filas: ConsultaGuardada[]; periodo: 'MONTH' | 'WEEK' } {
  const mes = consultas.MONTH.filter((c) => c.asin === asin)
  if (mes.length > 0) return { filas: mes, periodo: 'MONTH' }
  return { filas: consultas.WEEK.filter((c) => c.asin === asin), periodo: 'WEEK' }
}

export interface PalabraQuePesa {
  palabra: string
  /** Compras de todo Amazon en las búsquedas relevantes que la contienen */
  compras: number
  volumen: number
  busquedas: number
  enTitulo: boolean
  enBullets: boolean
  enBackend: boolean
}

/**
 * LAS PALABRAS QUE PESAN EN LAS BÚSQUEDAS DEL PRODUCTO, solo de las relevantes (fuera ruido y falsos amigos por precio: paso 3 del SOP, «descartar antes de elegir»), ordenadas por las compras
 * que mueven, y dónde está cada una en la ficha.
 */
export function palabrasQuePesan(diagnosticadas: ReadonlyArray<BusquedaDiagnosticada<ConsultaGuardada>>, ficha: FichaGuardada | null, max = 20): PalabraQuePesa[] {
  const set = (t: string | null | undefined) => new Set(tokens(t ?? '').map((x) => x.raiz))
  const enT = set(ficha?.titulo)
  const enB = set(ficha?.bullets.join(' '))
  const enK = set(ficha?.backend)
  const por = new Map<string, PalabraQuePesa>()
  for (const d of diagnosticadas) {
    if (!esRelevante(d.veredicto)) continue
    for (const [r, forma] of new Map(tokens(d.fila.consulta).map((x) => [x.raiz, x.forma]))) {
      // «oferta», «barato»… salen en búsquedas reales pero no se pueden poner en la ficha: no se proponen
      // y tampoco «amazon» (es la tienda, no el producto) ni un número suelto («100» de «100 tarjetas»), que solo tiene sentido junto a su palabra
      if (forma.length < 3 || /^\d+$/.test(forma) || forma === 'amazon' || promocionalesEn(forma).length > 0) continue
      const x = por.get(r) ?? { palabra: forma, compras: 0, volumen: 0, busquedas: 0, enTitulo: enT.has(r), enBullets: enB.has(r), enBackend: enK.has(r) }
      x.compras += d.fila.comprasTotal ?? 0
      x.volumen += d.fila.volumen ?? 0
      x.busquedas += 1
      por.set(r, x)
    }
  }
  return [...por.values()].sort((a, b) => b.compras - a.compras || b.volumen - a.volumen).slice(0, max)
}

/** TODAS LAS TAREAS DE LA CUENTA Y PAÍS, de la más urgente a la menos */
export function tareasDeLaCuenta(e: EntradaDeTareas): Tarea[] {
  const tareas: Tarea[] = []
  const nombreDe = (p: ProductoSeguido, f: FichaGuardada | null) => (p.nombre || f?.titulo || p.asin).slice(0, 80)

  for (const p of e.productos) {
    const ficha = e.fichas.find((f) => f.asin === p.asin) ?? null
    const nombre = nombreDe(p, ficha)
    const ventana = ventanaDeCambio(e.cambios ?? [], p.asin, e.hoy)
    const bloqueo = ventana?.bloqueada ? ventana.puedeDesde : null
    const { filas, periodo } = consultasDelProducto(e.consultas, p.asin)
    const unidad = periodo === 'MONTH' ? 'al mes' : 'a la semana'
    const { contexto, busquedas } = diagnosticarTodas(filas, e.precios?.[p.asin] ?? null)
    const producto = embudoDelProducto(busquedas, contexto)
    const enJuego = Math.max(0, (producto.suma.comprasTotal ?? 0) - (producto.suma.comprasAsin ?? 0))

    // ---------- lo que impide trabajar ----------
    if (!p.sku) tareas.push({ id: `${p.asin}:sin-sku`, asin: p.asin, tipo: 'datos', gravedad: 'atencion', titulo: `${nombre}: sin SKU no se puede leer la ficha`, detalle: 'El ERP lee la ficha de Amazon por el SKU y este producto no lo tiene apuntado.', accion: 'Quítalo y vuelve a añadirlo desde «Añadir productos» (elegido del catálogo trae su SKU).', quien: 'Quien lleva la cuenta', impacto: 0, ir: 'productos' })
    else if (!ficha && e.lectura.fichaLeidaAt) tareas.push({ id: `${p.asin}:sin-ficha`, asin: p.asin, tipo: 'datos', gravedad: 'info', titulo: `${nombre}: Amazon no ha devuelto la ficha`, detalle: 'Se ha intentado leer y no ha llegado nada con ese SKU en este país.', accion: 'Comprueba en Seller Central que el SKU existe y está activo en este marketplace.', quien: 'Quien lleva la cuenta', impacto: 0, ir: 'ficha' })
    if (filas.length === 0 && e.lectura.acceso === 'si' && e.lectura.mesOk && e.lectura.semanaOk)
      tareas.push({ id: `${p.asin}:sin-busquedas`, asin: p.asin, tipo: 'datos', gravedad: 'info', titulo: `${nombre}: Amazon no da búsquedas de este ASIN`, detalle: 'Brand Analytics no tiene búsquedas de este producto ni en el último mes ni en la última semana: producto nuevo, sin tráfico o de una marca que no es del cliente.', accion: 'Si vende, comprueba que la marca está en el Brand Registry del cliente.', quien: 'Quien lleva la cuenta', impacto: 0, ir: 'busquedas' })

    // ---------- la ventana de cambio ----------
    if (ventana && (ventana.bloqueada || !ventana.juzgable))
      tareas.push({
        id: `${p.asin}:ventana:${ventana.ultimo}`,
        asin: p.asin,
        tipo: 'ventana',
        gravedad: 'info',
        titulo: `${nombre}: ficha cambiada el ${fechaLarga(ventana.ultimo)}`,
        detalle: `El SOP pide 21 días antes de juzgar un cambio y como mucho un cambio de título cada 30 días.`,
        accion: `${ventana.juzgable ? 'Ya se puede juzgar' : `Se juzga a partir del ${fechaLarga(ventana.juzgarDesde)}`}; el título no se vuelve a tocar hasta el ${fechaLarga(ventana.puedeDesde)}.`,
        quien: 'SEO',
        impacto: 0,
        ir: 'ficha',
      })

    // ---------- la ficha fuera de las reglas de 2026 ----------
    if (ficha) {
      const { incidencias } = revisarFicha(ficha)
      const graves = incidencias.filter((i) => i.gravedad === 'grave')
      for (const i of graves)
        tareas.push({ id: `${p.asin}:norma:${i.id}`, asin: p.asin, tipo: 'norma', gravedad: 'grave', titulo: `${nombre}: ${i.resumen}`, detalle: i.texto, accion: i.accion, quien: 'SEO', impacto: enJuego, ir: 'ficha', bloqueadaHasta: i.campo === 'titulo' ? bloqueo : null })
      const resto = incidencias.filter((i) => i.gravedad === 'atencion')
      if (resto.length > 0)
        tareas.push({
          id: `${p.asin}:norma-avisos:${resto.map((i) => i.id).join(',')}`,
          asin: p.asin,
          tipo: 'norma',
          gravedad: 'atencion',
          titulo: `${nombre}: ${resto.map((i) => i.resumen).join(' · ')}`,
          detalle: resto.map((i) => i.texto).join(' '),
          accion: resto.map((i) => i.accion).join(' '),
          quien: 'SEO',
          impacto: enJuego * 0.3,
          ir: 'ficha',
          bloqueadaHasta: resto.some((i) => i.campo === 'titulo') ? bloqueo : null,
        })
    }

    if (filas.length === 0) continue

    // ---------- el embudo del producto: la puerta de salida del SOP ----------
    const v = producto.veredicto
    if (v?.tipo === 'fuga') {
      const r = RESPONSABLE[v.etapa]
      tareas.push({
        id: `${p.asin}:embudo:${v.etapa}`,
        asin: p.asin,
        tipo: 'embudo',
        gravedad: v.caida >= 0.7 ? 'grave' : 'atencion',
        titulo: `${nombre}: se pierde en ${NOMBRE_DE_ETAPA[v.etapa].toLowerCase()} — ${r.esSeo ? 'es SEO' : 'no es SEO'}`,
        detalle: `Sumando sus ${producto.relevantes} búsquedas relevantes: ${v.motivo}`,
        accion: r.accion,
        quien: r.quien,
        impacto: enJuego,
        ir: 'busquedas',
      })
    }

    // ---------- caída de la cuota de compras ----------
    const serie = (e.evolucion ?? []).filter((x) => x.asin === p.asin && x.periodo === periodo && x.cuotaCompras != null).sort((a, b) => a.desde.localeCompare(b.desde))
    if (serie.length >= 2) {
      const [antes, ahora] = serie.slice(-2)
      const a = antes.cuotaCompras as number
      const b = ahora.cuotaCompras as number
      const relativa = a > 0 ? (a - b) / a : 0
      if (antes.compras >= 5 && a - b >= 0.01 && relativa >= 0.2)
        tareas.push({
          id: `${p.asin}:caida:${ahora.desde}`,
          asin: p.asin,
          tipo: 'caida',
          gravedad: relativa >= 0.4 ? 'grave' : 'atencion',
          titulo: `${nombre}: la cuota de compras cae de ${pct(a)} a ${pct(b)}`,
          detalle: `${periodo === 'MONTH' ? 'Mes' : 'Semana'} del ${fechaLarga(ahora.desde)} frente al anterior: ${ent(ahora.compras)} compras frente a ${ent(antes.compras)}, con ${ent(ahora.volumen)} búsquedas frente a ${ent(antes.volumen)}.`,
          accion: 'Mira en «Búsquedas» qué búsquedas bajan (columna «vs anterior») y en qué escalón: si es la compra, revisa Buy Box y stock antes que la ficha.',
          quien: 'Quien lleva la cuenta',
          impacto: enJuego,
          ir: 'busquedas',
        })
    }

    // ---------- búsquedas concretas con fuga (por escalón) ----------
    const porEtapa = new Map<Etapa, Array<BusquedaDiagnosticada<ConsultaGuardada>>>()
    for (const d of busquedas) if (d.veredicto.tipo === 'fuga' && d.impacto > 0) porEtapa.set(d.veredicto.etapa, [...(porEtapa.get(d.veredicto.etapa) ?? []), d])
    for (const [etapa, lista] of porEtapa) {
      // Si el producto entero ya tiene la fuga en ese escalón, la tarea de arriba lo dice: aquí solo las búsquedas concretas
      const orden = [...lista].sort((x, y) => y.impacto - x.impacto)
      const total = orden.reduce((s, d) => s + d.impacto, 0)
      const r = RESPONSABLE[etapa]
      tareas.push({
        id: `${p.asin}:fugas:${etapa}`,
        asin: p.asin,
        tipo: 'fugas',
        gravedad: 'atencion',
        titulo: `${nombre}: ${orden.length} ${orden.length === 1 ? 'búsqueda pierde' : 'búsquedas pierden'} en ${NOMBRE_DE_ETAPA[etapa].toLowerCase()}`,
        detalle: `La que más pesa, «${orden[0].fila.consulta}»: ${orden[0].veredicto.motivo}`,
        accion: r.accion,
        quien: r.quien,
        impacto: total,
        ir: 'busquedas',
        etiquetas: orden.slice(0, 6).map((d) => d.fila.consulta),
      })
    }

    // ---------- palabras que pesan y no están en ninguna parte ----------
    if (ficha) {
      const faltan = palabrasQuePesan(busquedas, ficha, 40).filter((x) => !x.enTitulo && !x.enBullets && !x.enBackend && x.compras > 0)
      if (faltan.length > 0) {
        const top = faltan.slice(0, 8)
        tareas.push({
          id: `${p.asin}:palabras:${top.map((x) => x.palabra).join(',')}`,
          asin: p.asin,
          tipo: 'palabras',
          gravedad: 'atencion',
          titulo: `${nombre}: ${faltan.length} ${faltan.length === 1 ? 'palabra que pesa no está' : 'palabras que pesan no están'} en ninguna parte de la ficha`,
          detalle: `Salen en búsquedas del producto (sin contar ruido ni falsos amigos por precio) con ${ent(top.reduce((s, x) => s + x.compras, 0))} compras ${unidad}. Amazon indexa palabras sueltas: si no están en la ficha, no posiciona por ellas.`,
          accion: 'Comprueba que describen el producto (formato, marca ajena, falso amigo) y mételas: las de más demanda en título o Item Highlights, el resto en viñetas o backend.',
          quien: 'SEO',
          impacto: top.reduce((s, x) => s + x.compras, 0) * 0.5,
          ir: 'ficha',
          etiquetas: top.map((x) => x.palabra),
          bloqueadaHasta: bloqueo,
        })
      }

      // ---------- la oportunidad de SEO: búsquedas del producto que venden y no están enteras en el título ----------
      const oportunidades = busquedas
        .filter((d) => d.veredicto.tipo === 'visibilidad' && d.impacto > 0 && !coberturaDe(d.fila.consulta, ficha).titulo)
        .sort((x, y) => y.impacto - x.impacto)
      if (oportunidades.length > 0) {
        const top = oportunidades.slice(0, 6)
        tareas.push({
          id: `${p.asin}:oportunidad:${top.map((d) => d.fila.consulta).join('|')}`,
          asin: p.asin,
          tipo: 'oportunidad',
          gravedad: 'info',
          titulo: `${nombre}: ${oportunidades.length} ${oportunidades.length === 1 ? 'búsqueda del producto no está entera' : 'búsquedas del producto no están enteras'} en el título`,
          detalle: `El embudo no se cae en ellas: lo que falta es salir más. ${ent(top.reduce((s, d) => s + d.impacto, 0))} compras ${unidad} en juego en las primeras.`,
          accion: 'Candidatas para el título o los Item Highlights en el próximo cambio: primero la de más demanda que describa literalmente el producto (SOP, paso 4).',
          quien: 'SEO',
          impacto: top.reduce((s, d) => s + d.impacto, 0) * 0.4,
          ir: 'busquedas',
          etiquetas: top.map((d) => d.fila.consulta),
          bloqueadaHasta: bloqueo,
        })
      }

      // ---------- el vigía de títulos: ¿lo ha reescrito Amazon? ----------
      if (ficha.tituloAnterior && ficha.tituloCambiadoAt) {
        const dia = ficha.tituloCambiadoAt.slice(0, 10)
        const plazo = sumarDias(dia, DIAS_REVISION_REESCRITURA)
        // Si nosotros aplicamos un cambio en los 3 días anteriores, el título nuevo es el nuestro
        const nuestro = (e.cambios ?? []).some((c) => c.asin === p.asin && c.aplicadaAt.slice(0, 10) <= dia && sumarDias(c.aplicadaAt, 3) >= dia)
        if (!nuestro && e.hoy <= plazo)
          tareas.push({
            id: `${p.asin}:reescrito:${dia}`,
            asin: p.asin,
            tipo: 'reescrito',
            gravedad: 'grave',
            titulo: `${nombre}: el título ha cambiado en Amazon sin un cambio nuestro`,
            detalle: `Antes: «${ficha.tituloAnterior}». Ahora: «${ficha.titulo ?? ''}». Puede ser la IA de Amazon reescribiéndolo (lo hace con los títulos fuera de norma) o alguien desde Seller Central.`,
            accion: `Revísalo en Seller Central › Review Listing Changes y acéptalo, edítalo o recházalo antes del ${fechaLarga(plazo)} (14 días). Apúntalo en el Log.`,
            quien: 'SEO',
            impacto: enJuego,
            ir: 'ficha',
          })
      }
    }

    // ---------- infraexpuestas: convierte de sobra, sale poco → publicidad ----------
    const infra = busquedas.filter((d) => d.veredicto.tipo === 'infraexpuesta' && d.impacto > 0).sort((x, y) => y.impacto - x.impacto)
    if (infra.length > 0) {
      const top = infra.slice(0, 6)
      const fueraDelTitulo = ficha ? top.filter((d) => !coberturaDe(d.fila.consulta, ficha).titulo).length : 0
      tareas.push({
        id: `${p.asin}:infraexpuesta:${top.map((d) => d.fila.consulta).join('|')}`,
        asin: p.asin,
        tipo: 'infraexpuesta',
        gravedad: 'atencion',
        titulo: `${nombre}: ${infra.length} ${infra.length === 1 ? 'búsqueda infraexpuesta' : 'búsquedas infraexpuestas'} (convierte y sale poco)`,
        detalle: `${top[0].veredicto.motivo}${fueraDelTitulo > 0 ? ` ${fueraDelTitulo} de ellas no están enteras en el título.` : ''}`,
        accion: RESPONSABLE_INFRAEXPUESTA.accion,
        quien: RESPONSABLE_INFRAEXPUESTA.quien,
        impacto: top.reduce((s, d) => s + d.impacto, 0),
        ir: 'busquedas',
        etiquetas: top.map((d) => d.fila.consulta),
      })
    }
  }

  const peso: Record<Gravedad, number> = { grave: 0, atencion: 1, info: 2 }
  return tareas.sort((a, b) => peso[a.gravedad] - peso[b.gravedad] || b.impacto - a.impacto)
}
