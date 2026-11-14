/**
 * LAS KEYWORDS DE CEREBRO (HELIUM 10), CLASIFICADAS POR LA IA CON LAS REGLAS DE LA SKILL «ppc-arranque-frase-exacta». SOLO SERVIDOR.
 *
 * Decidir si una palabra describe el producto es criterio, no aritmética («whisky» no vale para una hidromiel aunque el precio encaje): por eso lo
 * hace la IA leyendo la ficha, y el administrativo revisa la lista antes de aplicarla. La IA solo puede elegir keywords que están en el fichero
 * (lo demás se descarta), y no decide pujas: salen de la sugerida de Helium 10 o de la puja base.
 */
import OpenAI from 'openai'
import { parametrosDeIa } from '@/lib/ia/modelo'
import type { FilaCerebro } from './helium10'
import { MAX_EXACTA, MAX_FRASE } from './semillas'

export interface CerebroClasificado {
  frase: Array<{ texto: string; volumen: number | null; puja: number | null }>
  exacta: Array<{ texto: string; volumen: number | null; puja: number | null; motivo: string }>
  negativas: Array<{ texto: string; familia: string }>
}

const FAMILIAS = ['Formato incompatible', 'Otra categoría o falso amigo', 'Segmento equivocado', 'Aparatos o servicios', 'Marca competidora', 'Producto ajeno', 'Fármaco o regulado', 'Intención no comercial']

const ESQUEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['frase', 'exacta', 'negativas'],
  properties: {
    frase: { type: 'array', items: { type: 'string' } },
    exacta: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['keyword', 'motivo'], properties: { keyword: { type: 'string' }, motivo: { type: 'string' } } } },
    negativas: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['keyword', 'familia'], properties: { keyword: { type: 'string' }, familia: { type: 'string', enum: FAMILIAS } } } },
  },
} as const

export async function clasificarCerebro(producto: { titulo: string; detalles: string | null }, filas: readonly FilaCerebro[]): Promise<{ ok: true; resultado: CerebroClasificado } | { ok: false; error: string }> {
  const clave = process.env.OPENAI_API_KEY
  if (!clave) return { ok: false, error: 'La IA no está configurada en el servidor.' }
  const top = [...filas].sort((a, b) => (b.volumen ?? 0) - (a.volumen ?? 0)).slice(0, 250)
  const porTexto = new Map(top.map((f) => [f.keyword, f]))
  const tabla = top.map((f) => `${f.keyword} | vol ${f.volumen ?? '?'} | compiten ${f.competidores ?? '?'} | densidad ${f.densidad ?? '?'}${f.rankingOrganico ? ` | orgánico #${f.rankingOrganico}` : ''}`).join('\n')

  const system = [
    'Eres especialista en Amazon Ads de una agencia española. Clasificas las keywords de un export de Helium 10 Cerebro para arrancar las campañas de UN producto.',
    `FRASE (campaña de descubrimiento, coincidencia de frase): casi todo lo relevante, entre 20 y ${MAX_FRASE}. Que describa ESTE producto (mismo formato y uso), no solo el beneficio.`,
    `EXACTA de día 1: como MUCHO ${MAX_EXACTA}. Solo si cumple las tres: encaja literalmente con el formato y el producto; competencia abordable (pocos productos compitiendo o densidad de título baja); y el producto ya está indexado ahí (orgánico) o la keyword lo describe sin ambigüedad. Mejor 2 seguras que 6 dudosas. Una keyword en EXACTA no va en FRASE.`,
    'NEGATIVAS: lo que NO es este producto aunque comparta palabras: otro formato, otra categoría (falsos amigos), otro público, aparatos o servicios, marcas de la competencia, productos ajenos, fármacos, búsquedas sin intención de compra. Pon solo la keyword tal cual aparece en el listado.',
    'Si dudas de si una keyword es del producto, no la pongas en ninguna lista. Que no haya exactas es un resultado válido.',
    'Usa EXACTAMENTE el texto de las keywords del listado, sin cambiarlo.',
  ].join('\n')
  const usuario = `PRODUCTO\nTítulo: ${producto.titulo}\n${producto.detalles ? `Detalles: ${producto.detalles.slice(0, 1500)}\n` : ''}\nKEYWORDS (keyword | volumen mensual | productos compitiendo | densidad de título | posición orgánica):\n${tabla}`

  try {
    const cliente = new OpenAI({ apiKey: clave, maxRetries: 1, timeout: 90_000 })
    const r = await cliente.chat.completions.create({
      ...parametrosDeIa({ maxSalida: 9000, esfuerzo: 'low' }),
      response_format: { type: 'json_schema', json_schema: { name: 'cerebro_clasificado', strict: true, schema: ESQUEMA } },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: usuario },
      ],
    })
    const o = JSON.parse(r.choices?.[0]?.message?.content ?? '{}') as { frase?: string[]; exacta?: Array<{ keyword: string; motivo: string }>; negativas?: Array<{ keyword: string; familia: string }> }
    // Solo lo que está en el fichero: si la IA inventa o cambia una keyword, se descarta
    const exacta = (o.exacta ?? []).filter((x) => porTexto.has(x.keyword)).slice(0, MAX_EXACTA)
    const enExacta = new Set(exacta.map((x) => x.keyword))
    const frase = (o.frase ?? []).filter((k) => porTexto.has(k) && !enExacta.has(k)).slice(0, MAX_FRASE)
    const negativas = (o.negativas ?? []).filter((x) => porTexto.has(x.keyword) && !enExacta.has(x.keyword) && !frase.includes(x.keyword))
    return {
      ok: true,
      resultado: {
        exacta: exacta.map((x) => ({ texto: x.keyword, volumen: porTexto.get(x.keyword)?.volumen ?? null, puja: porTexto.get(x.keyword)?.pujaSugerida ?? null, motivo: x.motivo.slice(0, 160) })),
        frase: frase.map((k) => ({ texto: k, volumen: porTexto.get(k)?.volumen ?? null, puja: porTexto.get(k)?.pujaSugerida ?? null })),
        negativas: negativas.map((x) => ({ texto: x.keyword, familia: x.familia })),
      },
    }
  } catch (e) {
    const x = e as { status?: number; code?: string }
    console.error('[semillas] la IA no ha clasificado Cerebro', { estado: x?.status ?? null, codigo: x?.code ?? null })
    return { ok: false, error: 'La IA no ha contestado. Vuelve a probar en un momento.' }
  }
}
