import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth/api'
import OpenAI from 'openai'
import { parseCSV, getVal, parseNum } from '@/lib/utils/csv-parser'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

const FORBIDDEN_TITLE_CHARS = ['!', '$', '?', '_', '{', '}', '^', '¬', '¦']

function normalizeSpaces(s: string) {
  return String(s || '').replace(/\s+/g, ' ').trim()
}

function tokenizeForRepeatCheck(s: string): string[] {
  return normalizeSpaces(s)
    .toLowerCase()
    .replace(/[\.,;:()\[\]"'¡¿]/g, ' ')
    .split(' ')
    .map(t => t.trim())
    .filter(Boolean)
}

function getRepeatedTokensOver2(s: string) {
  const tokens = tokenizeForRepeatCheck(s)
  const counts = new Map<string, number>()
  for (const t of tokens) counts.set(t, (counts.get(t) || 0) + 1)
  return Array.from(counts.entries())
    .filter(([, c]) => c > 2)
    .map(([token, count]) => ({ token, count }))
}

function byteLenUtf8(s: string) {
  return Buffer.byteLength(String(s || ''), 'utf8')
}

function findForbiddenChars(s: string) {
  const found = new Set<string>()
  for (const ch of FORBIDDEN_TITLE_CHARS) {
    if (String(s || '').includes(ch)) found.add(ch)
  }
  return Array.from(found)
}

function buildBasicTsvRow(params: {
  update_delete: string
  item_sku: string
  external_product_id: string
  external_product_id_type: string
  feed_product_type: string
  brand_name: string
  item_name: string
  bullet_point1: string
  bullet_point2: string
  bullet_point3: string
  bullet_point4: string
  bullet_point5: string
  product_description: string
  generic_keyword: string
}) {
  const headers = [
    'update_delete',
    'item_sku',
    'external_product_id',
    'external_product_id_type',
    'feed_product_type',
    'brand_name',
    'item_name',
    'bullet_point1',
    'bullet_point2',
    'bullet_point3',
    'bullet_point4',
    'bullet_point5',
    'product_description',
    'generic_keyword'
  ]

  const values = headers.map((h) => {
    const v = (params as any)[h] ?? ''
    return String(v).replace(/\t/g, ' ').replace(/\r?\n/g, ' ').trim()
  })

  return {
    headers,
    line: values.join('\t'),
  }
}

function extractTopKeywordsFromCerebro(csvText: string, max = 40): Array<{ keyword: string; score: number; volume: number }> {
  const rows = parseCSV(csvText)
  const candidates = rows
    .map((row) => {
      const keyword = String(getVal(row, ['Keyword', 'Search Term', 'Term', /keyword|term/i]) || '').trim()
      const iq = parseNum(getVal(row, ['Cerebro IQ Score', 'IQ Score', /iq/i]))
      const volume = parseNum(getVal(row, ['Search Volume', 'Volume', /volume/i]))
      if (!keyword) return null
      return { keyword, score: iq || volume, volume }
    })
    .filter(Boolean) as Array<{ keyword: string; score: number; volume: number }>

  candidates.sort((a, b) => (b.score || 0) - (a.score || 0))
  return candidates.slice(0, max)
}

export async function POST(request: NextRequest) {
  try {
    // QUÉ IMPIDE: que esta ruta le conteste a cualquiera de internet. No
    // comprobaba nada, y middleware.ts (línea 41) declara pública toda /api/,
    // así que bastaba un curl SIN cookie para dispararla. Ver lib/auth/api.ts,
    // donde está reproducido con el curl exacto.
    //
    // Sube ficheros Y llama a OpenAI con la clave de la empresa. La llama
    // app/dashboard/listing-builder/builder/page.tsx, con sesión.
    //
    // Se pide SESIÓN y nada más —ni rol ni permiso de módulo— a propósito: hoy
    // esta pantalla la abre cualquiera con sesión, y exigir un permiso que hoy
    // no se exige dejaría fuera a alguien que trabaja.
    const sesion = await requireSession()
    if (sesion instanceof NextResponse) return sesion

    const formData = await request.formData()

    const brandName = String(formData.get('brand_name') || '').trim()
    const itemSku = String(formData.get('item_sku') || '').trim()
    const externalProductId = String(formData.get('external_product_id') || '').trim()
    const externalProductIdType = String(formData.get('external_product_id_type') || '').trim()
    const feedProductType = String(formData.get('feed_product_type') || '').trim()
    const updateDelete = String(formData.get('update_delete') || 'PartialUpdate').trim()

    const cerebroFile = formData.get('cerebro_file') as File | null

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: 'Falta OPENAI_API_KEY en el servidor' }, { status: 500 })
    }

    if (!brandName || !itemSku || !externalProductId || !externalProductIdType || !feedProductType || !cerebroFile) {
      return NextResponse.json({ error: 'Faltan campos requeridos' }, { status: 400 })
    }

    const cerebroText = await cerebroFile.text()
    const topKeywords = extractTopKeywordsFromCerebro(cerebroText, 50)

    if (topKeywords.length === 0) {
      return NextResponse.json({ error: 'El CSV de Cerebro está vacío o no tiene columnas reconocibles' }, { status: 400 })
    }

    const keywordList = topKeywords.map(k => k.keyword).join(' | ')

    const systemPrompt = `Eres un especialista senior en Amazon Listings (COSMO/RUFUS 2025).

REGLAS INQUEBRANTABLES:
- Devuelve SOLO JSON válido.
- title: máximo 200 caracteres (incluye espacios).
- title: NO puede contener estos caracteres: ${FORBIDDEN_TITLE_CHARS.join(' ')}
- bullets: EXACTAMENTE 5 strings.
- bullets: suma total en UTF-8 <= 1000 bytes.
- backend_keywords: una sola línea, separada por espacios (NO comas), todo en minúsculas.
- backend_keywords: <= 250 bytes UTF-8.
- backend_keywords: NO debe repetir palabras ya usadas en title/bullets si es posible.
- Evita keyword stuffing: no repitas un token más de 2 veces en el title.

CONTEXTO PRODUCTO:
- Marca: ${brandName}
- feed_product_type: ${feedProductType}
- ID: ${externalProductIdType} ${externalProductId}

PALABRAS CLAVE (Helium10 Cerebro):
${keywordList}

Devuelve este JSON EXACTO:
{
  "title": "...",
  "bullets": ["...","...","...","...","..."],
  "description": "...",
  "backend_keywords": "..."
}`

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'system', content: systemPrompt }],
      temperature: 0.5,
      response_format: { type: 'json_object' },
    })

    const raw = completion.choices[0]?.message?.content || '{}'
    const parsed = JSON.parse(raw)

    const title = normalizeSpaces(parsed.title || '')
    const bullets = Array.isArray(parsed.bullets) ? parsed.bullets.map((b: any) => normalizeSpaces(b)) : []
    const description = String(parsed.description || '').trim()
    const backendKeywords = normalizeSpaces(parsed.backend_keywords || '').toLowerCase().replace(/,/g, ' ')

    if (!title || bullets.length !== 5 || !backendKeywords) {
      return NextResponse.json({ error: 'La IA devolvió un formato inválido' }, { status: 500 })
    }

    const titleChars = title.length
    const bulletsBytes = bullets.reduce((sum: number, b: string) => sum + byteLenUtf8(b), 0)
    const backendBytes = byteLenUtf8(backendKeywords)
    const forbiddenCharsFound = findForbiddenChars(title)
    const repeatedTokens = getRepeatedTokensOver2(title)

    const tsvRow = buildBasicTsvRow({
      update_delete: updateDelete,
      item_sku: itemSku,
      external_product_id: externalProductId,
      external_product_id_type: externalProductIdType,
      feed_product_type: feedProductType,
      brand_name: brandName,
      item_name: title,
      bullet_point1: bullets[0],
      bullet_point2: bullets[1],
      bullet_point3: bullets[2],
      bullet_point4: bullets[3],
      bullet_point5: bullets[4],
      product_description: description,
      generic_keyword: backendKeywords,
    })

    const tsvContent = [tsvRow.headers.join('\t'), tsvRow.line].join('\n')

    return NextResponse.json({
      title,
      bullets,
      description,
      backendKeywords,
      validations: {
        titleChars,
        bulletsBytes,
        backendBytes,
        forbiddenCharsFound,
        repeatedTokens,
      },
      tsv: {
        filename: `${itemSku}-listing.tsv`,
        content: tsvContent,
      },
    })
  } catch (error: any) {
    console.error('Error listing-builder/generate:', error)
    return NextResponse.json({ error: error?.message || 'Error interno' }, { status: 500 })
  }
}
