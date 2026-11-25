/**
 * SEO · LA PROPUESTA DE FICHA CON IA: PEDIRLA, GUARDARLA Y —SOLO CON EL OK DE UNA PERSONA— APLICARLA EN AMAZON. SOLO SERVIDOR.
 *
 *   proponer   lee la ficha y las búsquedas del producto, pide la propuesta a la IA (modelo de lib/ia/modelo.ts; el gasto lo cuenta la tarjeta «Gasto en IA» de Sistema, que lee la factura real
 *              de OpenAI) y la guarda «pendiente». NO toca Amazon.
 *   aplicar    ESCRIBE EN LA FICHA DEL CLIENTE. Solo desde el botón «Aplicar en Amazon», con confirmación. Va por lib/seo/edicion-servidor.ts (la misma puerta que
 *              el editor a mano): valida en Amazon sin guardar nada (VALIDATION_PREVIEW), manda también los Item Highlights y apunta quién y cuándo.
 *   descartar  la deja como descartada.
 *
 * Dos frenos (fallos 13 y 14):
 *   · Marcas ajenas: antes de la IA se quitan las búsquedas, palabras de Helium 10 y términos de publicidad con marcas de los rivales seguidos; después `vigilarPropuesta` (propuesta.ts) las
 *     quita del backend y avisa en rojo si salen arriba. Los avisos se guardan con la propuesta y, si hay alguno rojo, aplicar exige que la persona los haya confirmado (`aceptarAvisos`).
 *   · Propuesta vieja: se aplica con `{ esperado: p.antes }`. Si la ficha viva ya no es la de entonces no se manda nada y la propuesta queda descartada. Y a los 7 días caduca (decisión del dueño).
 */

import OpenAI from 'openai'
import { createServiceClient } from '@/lib/supabase/service'
import { AmazonApiError, type AmazonIssue } from '@/lib/amazon/errors'
import { parametrosDeIa } from '@/lib/ia/modelo'
import { AMAZON_MARKETPLACES } from '@/lib/types/amazon'
import { coberturaDe } from './cobertura'
import { cambiosAplicados, consultasGuardadas, fichasGuardadas, preciosDeListings, type FichaGuardada } from './datos'
import { diagnosticarTodas, embudoDelProducto, esDelProducto, NOMBRE_DE_ETAPA, RESPONSABLE } from './embudo'
import { decisionesDeBusquedas } from './ajenas-servidor'
import { isMissingSchema } from '@/lib/plataforma/eventos'
import { avisosRojos, cambiosDesdeLaPropuesta, IDIOMA_DE_MARKETPLACE, instruccionesDeSistema, limpiarPropuesta, marcasAjenasDe, mensajeDeDatos, motivoFichaCambiada, propuestaCaducada, sinMarcasAjenas, vigilarPropuesta, DIAS_DE_VALIDEZ_PROPUESTA, type AvisoDeVigilancia, type CampoComparado, type PropuestaLimpia, type Razonamiento, type TextosPropuestos } from './propuesta'
import { perfilesAdsDe, terminosDeAdsDelAsin } from './publicidad'
import { terminosQueFaltanEnLaFicha } from './publicidad-calculo'
import { palabrasQueFaltanEnElTitulo } from './resumen'
import { DIAS_ENTRE_CAMBIOS, ventanaDeCambio } from './tareas'
import { validarYAplicar } from './edicion-servidor'
import { heliumDe } from './helium-servidor'
import { oportunidadesParaLaIa } from './helium'

export interface PropuestaGuardada {
  id: string
  asin: string
  sku: string | null
  estado: 'pendiente' | 'aplicada' | 'descartada' | 'error'
  antes: TextosPropuestos
  propuesta: TextosPropuestos
  razonamiento: Razonamiento & { avisos?: string[]; vigilancia?: AvisoDeVigilancia[] }
  modelo: string | null
  /** Pendiente de hace más de 7 días: ya no se aplica (se calcula al leer; en la base sigue «pendiente») */
  caducada: boolean
  /** Solo en la pendiente que se enseña: lo que ha cambiado en la ficha guardada de hoy desde que se pidió. Si hay algo, «Aplicar» se desactiva */
  fichaCambiada?: CampoComparado[]
  creadaAt: string
  aplicadaAt: string | null
  resultado: { submissionId?: string | null; edicionId?: string | null; issues?: AmazonIssue[]; mensaje?: string | null; verificacion?: { estado: 'aplicada' | 'no_aplicada' | 'parcial' | 'pendiente'; explicacion?: string | null; campos?: Record<string, string> } } | null
  error: string | null
}

const COLUMNAS = 'id, asin, sku, estado, antes, propuesta, razonamiento, modelo, creada_at, aplicada_at, resultado, error'

function deFila(r: Record<string, unknown>): PropuestaGuardada {
  return {
    id: String(r.id),
    asin: String(r.asin),
    sku: (r.sku as string | null) ?? null,
    estado: r.estado as PropuestaGuardada['estado'],
    antes: r.antes as TextosPropuestos,
    propuesta: r.propuesta as TextosPropuestos,
    razonamiento: (r.razonamiento ?? { resumen: '', cambios: [], palabrasNuevas: [] }) as PropuestaGuardada['razonamiento'],
    modelo: (r.modelo as string | null) ?? null,
    caducada: propuestaCaducada(String(r.estado), String(r.creada_at)),
    creadaAt: String(r.creada_at),
    aplicadaAt: (r.aplicada_at as string | null) ?? null,
    resultado: (r.resultado as PropuestaGuardada['resultado']) ?? null,
    error: (r.error as string | null) ?? null,
  }
}

export async function propuestasDe(connectionId: string, marketplaceId: string, asin: string): Promise<PropuestaGuardada[]> {
  const { data, error } = await createServiceClient().from('seo_propuestas').select(COLUMNAS).eq('connection_id', connectionId).eq('marketplace_id', marketplaceId).eq('asin', asin).order('creada_at', { ascending: false }).limit(10)
  if (error) throw error
  return ((data ?? []) as Array<Record<string, unknown>>).map(deFila)
}

/**
 * Las marcas de los rivales que se siguen para este producto (y los de la cuenta sin producto asignado), de sus fotos. Sin la migración 312 o si falla la lectura, ninguna: la propuesta
 * se sigue pidiendo, solo con la regla del prompt.
 */
export async function marcasDeRivales(c: { connectionId: string; marketplaceId: string }, asin: string): Promise<string[]> {
  try {
    const service = createServiceClient()
    const { data, error } = await service.from('seo_competidores').select('id').eq('connection_id', c.connectionId).eq('marketplace_id', c.marketplaceId).or(`asin_propio.eq.${asin},asin_propio.is.null`).limit(500)
    if (error) throw error
    const ids = ((data ?? []) as Array<{ id: string }>).map((r) => r.id)
    const marcas = new Set<string>()
    for (let i = 0; i < ids.length; i += 50) {
      const { data: fotos, error: e } = await service.from('seo_competidores_fotos').select('marca').in('competidor_id', ids.slice(i, i + 50)).not('marca', 'is', null).order('fecha', { ascending: false }).limit(1000)
      if (e) throw e
      for (const f of (fotos ?? []) as Array<{ marca: string | null }>) if (f.marca?.trim()) marcas.add(f.marca.trim())
    }
    return [...marcas]
  } catch (e) {
    if (!isMissingSchema(e)) console.error('SEO: marcas de los rivales:', e instanceof Error ? e.message : e)
    return []
  }
}

/** Los avisos de una propuesta: los guardados al pedirla; las de antes de la vigilancia se repasan ahora solo con las marcas (sin las descartadas de entonces) */
async function vigilanciaDe(c: { connectionId: string; marketplaceId: string }, p: PropuestaGuardada, marcas?: string[]): Promise<AvisoDeVigilancia[]> {
  if (Array.isArray(p.razonamiento.vigilancia)) return p.razonamiento.vigilancia
  const ajenas = marcasAjenasDe(marcas ?? (await marcasDeRivales(c, p.asin)), p.antes.titulo)
  return vigilarPropuesta(p.propuesta, { fichaActual: p.antes, consultasRelevantes: [], descartadas: [], marcasAjenas: ajenas }).avisos.filter((a) => a.campo !== 'backend')
}

/** Para la pantalla: las propuestas y, en la pendiente de arriba, sus avisos y si la ficha guardada de hoy ya no es la de entonces */
export async function propuestasParaVer(c: { connectionId: string; marketplaceId: string }, asin: string): Promise<PropuestaGuardada[]> {
  const lista = await propuestasDe(c.connectionId, c.marketplaceId, asin)
  const actual = lista[0]
  if (!actual || actual.estado !== 'pendiente' || actual.caducada) return lista
  const [fichas, vigilancia] = await Promise.all([fichasGuardadas(c.connectionId, c.marketplaceId).catch(() => [] as FichaGuardada[]), vigilanciaDe(c, actual)])
  const hoy = fichas.find((f) => f.asin === asin)
  const fichaCambiada = hoy?.titulo ? cambiosDesdeLaPropuesta(actual.antes, textosDe(hoy)) : []
  lista[0] = { ...actual, razonamiento: { ...actual.razonamiento, vigilancia }, fichaCambiada }
  return lista
}

const textosDe = (f: FichaGuardada): TextosPropuestos => ({ titulo: f.titulo ?? '', ...(f.highlights ? { highlights: f.highlights } : {}), bullets: f.bullets, backend: f.backend ?? '' })

/** Pide la propuesta a la IA y la guarda pendiente. Tarda unos segundos (la IA piensa) */
export async function proponerFicha(c: { connectionId: string; marketplaceId: string; clientId: string }, asin: string, userId: string): Promise<PropuestaGuardada> {
  const clave = process.env.OPENAI_API_KEY?.trim()
  if (!clave) throw new Error('La IA no está configurada en el servidor (falta OPENAI_API_KEY).')
  const [fichas, mes, semana] = await Promise.all([fichasGuardadas(c.connectionId, c.marketplaceId), consultasGuardadas(c.connectionId, c.marketplaceId, 'MONTH'), consultasGuardadas(c.connectionId, c.marketplaceId, 'WEEK')])
  const ficha = fichas.find((f) => f.asin === asin)
  if (!ficha || !ficha.titulo) throw new Error('Todavía no se ha leído la ficha de este producto: pulsa «Actualizar» y espera a que salga.')
  const delMes = mes.filter((x) => x.asin === asin)
  const consultas = delMes.length > 0 ? delMes : semana.filter((x) => x.asin === asin)
  if (consultas.length === 0) throw new Error('Este producto aún no tiene búsquedas de Brand Analytics: sin ellas la IA no sabría qué palabras pesan.')

  const pais = AMAZON_MARKETPLACES.find((m) => m.id === c.marketplaceId)?.countryCode ?? c.marketplaceId
  const idioma = IDIOMA_DE_MARKETPLACE[c.marketplaceId]?.nombre ?? 'el idioma del marketplace'
  const perfiles = await perfilesAdsDe(c.clientId, pais).catch(() => [])
  // Las marcas de la competencia: las de los rivales seguidos y las de la lista de la cuenta (migración 338)
  const decisiones = await decisionesDeBusquedas(c.connectionId, c.marketplaceId).catch(() => ({ ajenas: [] as string[], nuestras: [] as string[], marcas: [] as Array<{ clave: string; texto: string; origen: string }> }))
  const marcasAjenas = marcasAjenasDe([...(await marcasDeRivales(c, asin)), ...decisiones.marcas.map((m) => m.texto)], ficha.titulo)
  // Fuera lo que lleva una marca de un rival ANTES de pedir nada (fallo 13): la IA no puede proponer lo que no ve
  const ads = sinMarcasAjenas(terminosQueFaltanEnLaFicha(await terminosDeAdsDelAsin(perfiles, asin).catch(() => []), ficha, 40), (t) => t.termino, marcasAjenas).quedan.slice(0, 20)

  // Paso 2 y 3 del SOP: diagnosticar el embudo y descartar antes de elegir (ruido y búsquedas que compran a otro precio no llegan a la IA como candidatas)
  const precioListing = (await preciosDeListings(c.connectionId, c.marketplaceId, [asin]).catch(() => ({}) as Record<string, number | null>))[asin] ?? null
  // Las búsquedas que pueden ser de otro producto («lego», «murdoku»…) o marcadas como ajenas no llegan a la IA como candidatas
  const { contexto, busquedas } = diagnosticarTodas(consultas, precioListing, { ficha, ajenas: decisiones.ajenas, nuestras: decisiones.nuestras, marcas: decisiones.marcas })
  const producto = embudoDelProducto(busquedas, contexto)
  const v = producto.veredicto
  const embudo = !v ? null : v.tipo === 'fuga' ? `Se pierde en ${NOMBRE_DE_ETAPA[v.etapa].toLowerCase()} (${RESPONSABLE[v.etapa].quien}): ${v.motivo}` : v.motivo
  // Las de posible marca ajena (A5: `posibleAjena`, cuando esté) y las que llevan la marca de un rival pasan a descartadas
  const posibleAjena = (d: (typeof busquedas)[number]) => (d as { posibleAjena?: boolean }).posibleAjena === true
  const conMarca = new Map(sinMarcasAjenas(busquedas, (d) => d.fila.consulta, marcasAjenas).fuera.map((x) => [x.item, x.marca]))
  const fueraPorMarca = (d: (typeof busquedas)[number]) => posibleAjena(d) || conMarca.has(d)
  const relevantes = busquedas.filter((d) => esDelProducto(d) && !fueraPorMarca(d))
  const descartadas = busquedas
    .filter((d) => !esDelProducto(d) || fueraPorMarca(d))
    .sort((a, b) => (b.fila.volumen ?? 0) - (a.fila.volumen ?? 0))
    .map((d) => ({ consulta: d.fila.consulta, porQue: conMarca.has(d) ? `marca ajena (${conMarca.get(d)})` : posibleAjena(d) && esDelProducto(d) ? 'posible marca ajena' : d.veredicto.motivo }))
  const helium = sinMarcasAjenas(oportunidadesParaLaIa((await heliumDe(c, asin).catch(() => null))?.palabras ?? [], 200), (k) => k.keyword, marcasAjenas).quedan.slice(0, 25)
  const diagnostico = (d: (typeof busquedas)[number]) => (d.veredicto.tipo === 'fuga' ? `se pierde en ${NOMBRE_DE_ETAPA[d.veredicto.etapa].toLowerCase()}` : d.veredicto.tipo === 'visibilidad' ? ((d.veredicto.fuerza ?? 0) >= 1.2 ? 'convierte bien, sale poco' : 'falta salir más') : d.veredicto.tipo === 'lider' ? 'ya manda' : '')

  const datos = {
    idioma,
    pais,
    precio: contexto.precioPropio,
    ficha: { titulo: ficha.titulo, bullets: ficha.bullets, descripcion: ficha.descripcion?.slice(0, 2000) ?? null, backend: ficha.backend },
    embudo,
    busquedas: [...relevantes]
      .sort((a, b) => (b.fila.comprasTotal ?? 0) - (a.fila.comprasTotal ?? 0) || (b.fila.volumen ?? 0) - (a.fila.volumen ?? 0))
      .slice(0, 40)
      .map((d) => ({ consulta: d.fila.consulta, volumen: d.fila.volumen, comprasTotal: d.fila.comprasTotal, cuotaComprasTuya: d.fila.cuotaCompras, enLaFicha: coberturaDe(d.fila.consulta, ficha).faltan.length === 0, diagnostico: diagnostico(d) })),
    descartadas: descartadas.slice(0, 25),
    palabrasQueFaltan: sinMarcasAjenas(palabrasQueFaltanEnElTitulo(relevantes.map((d) => d.fila), ficha, 40, 20), (p) => p.palabra, marcasAjenas).quedan.map((p) => ({ palabra: p.palabra, peso: p.peso })),
    terminosDeAds: ads.map((t) => ({ termino: t.termino, pedidos: t.pedidos })),
    // Helium 10 (migración 312): lo que tiene volumen y aún no sale en Brand Analytics, sin marcas de rivales. Sin CSV subido o sin la migración, nada
    palabrasDeHelium10: helium,
  }

  const params = parametrosDeIa({ maxSalida: 16000, esfuerzo: 'medium' })
  const cliente = new OpenAI({ apiKey: clave, maxRetries: 1 })
  const respuesta = await cliente.chat.completions.create({
    ...params,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: instruccionesDeSistema(idioma) },
      { role: 'user', content: mensajeDeDatos(datos) },
    ],
  })
  const contenido = respuesta.choices[0]?.message?.content ?? ''
  let crudo: unknown
  try {
    crudo = JSON.parse(contenido)
  } catch {
    throw new Error('La IA ha contestado algo que no es la propuesta. Vuelve a intentarlo.')
  }
  const limpia = limpiarPropuesta(crudo)
  if ('error' in limpia) throw new Error(limpia.error)
  const vigilada = vigilarPropuesta(limpia, {
    fichaActual: { titulo: ficha.titulo, highlights: ficha.highlights ?? null, bullets: ficha.bullets, descripcion: ficha.descripcion, backend: ficha.backend },
    consultasRelevantes: relevantes.map((d) => d.fila.consulta),
    // Todas las descartadas (no solo las 25 que ve la IA): ninguna puede salir entera
    descartadas: descartadas.map((d) => d.consulta),
    heliumKeywords: helium.map((k) => k.keyword),
    terminosAds: ads.map((t) => t.termino),
    marcasAjenas,
  })
  return guardarPropuesta(c, asin, ficha, vigilada.propuesta, vigilada.avisos, params.model, userId)
}

async function guardarPropuesta(c: { connectionId: string; marketplaceId: string }, asin: string, ficha: FichaGuardada, p: PropuestaLimpia, vigilancia: AvisoDeVigilancia[], modelo: string, userId: string): Promise<PropuestaGuardada> {
  const { data, error } = await createServiceClient()
    .from('seo_propuestas')
    .insert({
      connection_id: c.connectionId,
      marketplace_id: c.marketplaceId,
      asin,
      sku: ficha.sku,
      estado: 'pendiente',
      antes: textosDe(ficha),
      propuesta: { titulo: p.titulo, highlights: p.highlights, bullets: p.bullets, backend: p.backend },
      razonamiento: { ...p.razonamiento, avisos: p.avisos, vigilancia },
      modelo,
      creada_por: userId,
    })
    .select(COLUMNAS)
    .single()
  if (error) throw error
  return deFila(data as Record<string, unknown>)
}

export async function descartarPropuesta(c: { connectionId: string; marketplaceId: string }, id: string): Promise<void> {
  const { error } = await createServiceClient().from('seo_propuestas').update({ estado: 'descartada' }).eq('id', id).eq('connection_id', c.connectionId).eq('marketplace_id', c.marketplaceId).eq('estado', 'pendiente')
  if (error) throw error
}

/** Lo que necesita `aplicarPropuesta` de fuera (base de datos y Amazon). Se cambia en las pruebas para simular validarYAplicar sin tocar nada */
export interface DepsDeAplicar {
  leer: (c: { connectionId: string; marketplaceId: string }, id: string) => Promise<PropuestaGuardada | null>
  actualizar: (id: string, cambios: Record<string, unknown>) => Promise<void>
  ventana: (c: { connectionId: string; marketplaceId: string }, asin: string) => Promise<ReturnType<typeof ventanaDeCambio>>
  vigilancia: (c: { connectionId: string; marketplaceId: string }, p: PropuestaGuardada) => Promise<AvisoDeVigilancia[]>
  validarYAplicar: typeof validarYAplicar
}

const DEPS: DepsDeAplicar = {
  async leer(c, id) {
    const { data, error } = await createServiceClient().from('seo_propuestas').select(COLUMNAS).eq('id', id).eq('connection_id', c.connectionId).eq('marketplace_id', c.marketplaceId).maybeSingle()
    if (error) throw error
    return data ? deFila(data as Record<string, unknown>) : null
  },
  async actualizar(id, cambios) {
    await createServiceClient().from('seo_propuestas').update(cambios).eq('id', id)
  },
  ventana: async (c, asin) => ventanaDeCambio(await cambiosAplicados(c.connectionId, c.marketplaceId), asin, new Date().toISOString().slice(0, 10)),
  vigilancia: (c, p) => vigilanciaDe(c, p),
  validarYAplicar,
}

/**
 * APLICA LA PROPUESTA EN AMAZON. Escribe en la ficha del cliente. Devuelve lo que dijo Amazon.
 *
 * Pasa por la misma puerta que el editor a mano (lib/seo/edicion-servidor.ts): lee el listing (el «antes», ahora CON los Item Highlights), valida en
 * Amazon, manda título, Item Highlights (con el atributo del tipo de producto; si no lo tiene, se avisa), viñetas y backend, apunta la edición y, al
 * releer la ficha, comprueba que de verdad ha quedado.
 *
 * Antes de mandar nada: que no haya caducado (7 días), que los avisos rojos (marcas ajenas, descartadas, título sin marca) estén confirmados por la persona
 * (`aceptarAvisos`), la ventana del SOP y que la ficha viva sea la de cuando se pidió (`esperado: p.antes`). Si no lo es, la propuesta queda descartada.
 */
export async function aplicarPropuesta(
  c: { connectionId: string; marketplaceId: string },
  id: string,
  userId: string,
  opciones: { aceptarAvisos?: boolean } = {},
  deps: DepsDeAplicar = DEPS
): Promise<{ ok: true; submissionId: string | null; avisos: string | null } | { ok: false; motivo: string; issues: AmazonIssue[]; fichaCambiada?: CampoComparado[]; avisosRojos?: AvisoDeVigilancia[] }> {
  const p = await deps.leer(c, id)
  if (!p) return { ok: false, motivo: 'Esa propuesta no existe.', issues: [] }
  if (p.estado !== 'pendiente') return { ok: false, motivo: `Esa propuesta ya está ${p.estado}.`, issues: [] }
  if (p.caducada) return { ok: false, motivo: `Esta propuesta tiene más de ${DIAS_DE_VALIDEZ_PROPUESTA} días y ha caducado: pide una nueva.`, issues: [] }
  const rojos = avisosRojos(await deps.vigilancia(c, p))
  if (rojos.length > 0 && !opciones.aceptarAvisos) return { ok: false, motivo: `La propuesta tiene ${rojos.length === 1 ? 'un aviso rojo' : `${rojos.length} avisos rojos`}: revísalos y confírmalos antes de aplicarla.`, issues: [], avisosRojos: rojos }
  // SOP: como mucho un cambio de título cada 30 días por producto (y 21 días para juzgarlo). Si no, el resultado no se puede atribuir a ningún cambio
  const ventana = await deps.ventana(c, p.asin)
  if (ventana?.bloqueada) return { ok: false, motivo: `La ficha de este producto se cambió el ${ventana.ultimo}: el SOP no deja volver a cambiarla antes de ${DIAS_ENTRE_CAMBIOS} días (desde el ${ventana.puedeDesde}).`, issues: [] }
  if (!p.sku) return { ok: false, motivo: 'No se sabe el SKU de este producto: sin él no se puede cambiar la ficha.', issues: [] }

  try {
    const r = await deps.validarYAplicar(
      c,
      { asin: p.asin, sku: p.sku, despues: { titulo: p.propuesta.titulo, highlights: p.propuesta.highlights ?? null, bullets: p.propuesta.bullets, backend: p.propuesta.backend }, propuestaId: id, userId },
      { esperado: { titulo: p.antes.titulo, highlights: p.antes.highlights ?? null, bullets: p.antes.bullets, backend: p.antes.backend } }
    )
    if (!r.ok) {
      if (r.fichaCambiada && r.fichaCambiada.length > 0) {
        // No se ha mandado nada: la propuesta se escribió sobre otra ficha. Se descarta para que nadie la vuelva a intentar
        const motivo = motivoFichaCambiada(r.fichaCambiada)
        await deps.actualizar(id, { estado: 'descartada', error: motivo, resultado: { issues: [], mensaje: motivo } })
        return { ok: false, motivo, issues: [], fichaCambiada: r.fichaCambiada }
      }
      await deps.actualizar(id, { error: r.motivo.slice(0, 1000), resultado: { issues: r.issues, mensaje: r.motivo } })
      return r
    }
    const avisos = [r.avisos, ...(r.avisosPlan ?? [])].filter(Boolean).join(' ') || null
    await deps.actualizar(id, {
      estado: 'aplicada',
      aplicada_por: userId,
      aplicada_at: new Date().toISOString(),
      error: null,
      // El «antes» de verdad, leído al aplicar (con los Item Highlights, que la lectura diaria no siempre trae)
      ...(r.antes ? { antes: { titulo: r.antes.titulo, highlights: r.antes.highlights ?? '', bullets: r.antes.bullets, backend: r.antes.backend } } : {}),
      resultado: { submissionId: r.submissionId, edicionId: r.edicion?.id ?? null, campos: r.campos ?? [], issues: [], mensaje: avisos, ...(rojos.length > 0 ? { avisosAceptados: rojos.map((a) => a.texto) } : {}) },
    })
    return { ok: true, submissionId: r.submissionId, avisos }
  } catch (e) {
    if (!(e instanceof AmazonApiError)) throw e
    await deps.actualizar(id, { error: (e.humanMessage ?? e.message).slice(0, 1000) })
    return { ok: false, motivo: e.humanMessage ?? e.message, issues: e.issues ?? [] }
  }
}
