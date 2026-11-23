import OpenAI from 'openai'
import { parametrosDeIa } from '@/lib/ia/modelo'
import { createServiceClient } from '@/lib/supabase/service'
import { claveDeBusqueda } from './embudo'

/**
 * SEO · LA IA DICE SI UNA PALABRA DE HELIUM 10 ES DE ESTE PRODUCTO. SOLO SERVIDOR.
 *
 * El Cerebro de Helium 10 trae todo aquello en lo que aparece el ASIN, también lo de otros productos («pegatinas nfc», «google fitbit», «google play 10 euros»)
 * y las marcas de la competencia («justap», «ondrela»). Como una oportunidad es justo una palabra que NO está en la ficha, la heurística de Búsquedas (palabras
 * que no están en la ficha) no sirve: las marcaría todas. Lo decide la IA con el título y las viñetas delante, y se guarda como la decisión de una persona en
 * seo_busquedas_decididas (migración 333, `created_by` NULL = la IA): «ajena» con otro producto o marca ajena, «nuestra» con relevante, ambas con confianza ≥ 0,8.
 * Las dudosas no se guardan (se quedan como oportunidad y se pueden marcar a mano). Una persona puede deshacer cualquiera desde la tabla.
 *
 * Coste: una llamada por producto con hasta 60 palabras sin decidir (~0,001 $ con el modelo de siempre). En memoria se recuerda lo ya preguntado para no volver a
 * preguntar las dudosas en cada visita.
 */
const CONFIANZA = 0.8
const MAX = 60
const yaPreguntadas = new Map<string, number>()
const OLVIDO_MS = 24 * 3_600_000

type Etiqueta = 'relevante' | 'otro_producto' | 'marca_ajena' | 'dudoso'

export async function revisarPalabrasConIa(
  c: { connectionId: string; marketplaceId: string },
  asin: string,
  producto: { titulo: string | null; bullets: readonly string[] },
  palabras: readonly string[],
): Promise<number> {
  const clave = process.env.OPENAI_API_KEY?.trim()
  if (!clave || !producto.titulo) return 0
  const ahora = Date.now()
  const pendientes = [...new Set(palabras.map((p) => p.trim().toLowerCase()).filter(Boolean))]
    .filter((p) => (yaPreguntadas.get(`${c.connectionId}~${c.marketplaceId}~${p}`) ?? 0) < ahora - OLVIDO_MS)
    .slice(0, MAX)
  if (pendientes.length === 0) return 0
  for (const p of pendientes) yaPreguntadas.set(`${c.connectionId}~${c.marketplaceId}~${p}`, ahora)

  const cliente = new OpenAI({ apiKey: clave, maxRetries: 1 })
  const r = await cliente.chat.completions.create({
    ...parametrosDeIa({ maxSalida: 6000, esfuerzo: 'low' }),
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content:
          'Eres analista de SEO de Amazon. Te doy un producto y una lista de búsquedas de Amazon. Para cada búsqueda decide si quien la escribe compraría ESTE producto. ' +
          'Etiquetas: "relevante" (busca este tipo de producto, aunque use otras palabras o idioma), "otro_producto" (busca otra cosa: otra categoría, otro formato, un accesorio, algo que este producto no es), ' +
          '"marca_ajena" (es el nombre de una marca o producto de la competencia, aunque sea del mismo tipo), "dudoso" (no está claro). ' +
          'Contesta SOLO JSON: {"palabras":[{"p":"<búsqueda tal cual>","e":"<etiqueta>","c":<confianza 0-1>}]}.',
      },
      {
        role: 'user',
        content: JSON.stringify({ producto: { titulo: producto.titulo, viñetas: producto.bullets.slice(0, 5).map((b) => b.slice(0, 300)) }, busquedas: pendientes }),
      },
    ],
  })
  let lista: Array<{ p?: unknown; e?: unknown; c?: unknown }> = []
  try {
    const j = JSON.parse(r.choices[0]?.message?.content ?? '{}') as { palabras?: unknown }
    if (Array.isArray(j.palabras)) lista = j.palabras as typeof lista
  } catch {
    return 0
  }
  const validas = new Set(pendientes)
  const filas = lista
    .flatMap((x) => {
      const p = typeof x.p === 'string' ? x.p.trim().toLowerCase() : ''
      const e = x.e as Etiqueta
      const conf = typeof x.c === 'number' ? x.c : Number(x.c)
      if (!validas.has(p) || !Number.isFinite(conf) || conf < CONFIANZA) return []
      const decision = e === 'otro_producto' || e === 'marca_ajena' ? 'ajena' : e === 'relevante' ? 'nuestra' : null
      if (!decision) return []
      const consulta = claveDeBusqueda(p)
      return consulta ? [{ connection_id: c.connectionId, marketplace_id: c.marketplaceId, consulta, texto: p.slice(0, 300), decision, asin, created_by: null }] : []
    })
  if (filas.length === 0) return 0
  // Sin pisar lo que haya decidido una persona: solo se insertan las que no tienen decisión
  const { error } = await createServiceClient().from('seo_busquedas_decididas').upsert(filas, { onConflict: 'connection_id,marketplace_id,consulta', ignoreDuplicates: true })
  if (error) throw new Error(error.message)
  return filas.length
}
