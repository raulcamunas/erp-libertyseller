import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'

// ============================================================================
// TIPOS Y INTERFACES
// ============================================================================

interface BulkRow {
  [key: string]: any
}

interface SearchTermRow {
  [key: string]: any
}

interface CandidateChange {
  type: 'UPDATE' | 'CREATE' | 'CREATE_NEGATIVE'
  entity: string
  operation: string
  campaignId: string
  adGroupId?: string
  keywordId?: string
  keywordText: string
  currentBid?: number
  proposedBid: number
  matchType: string
  product?: string
  reason: string
  confidence: 'HIGH' | 'MEDIUM' | 'LOW'
  needsAIReview: boolean
  metadata?: {
    acos?: number
    sales?: number
    spend?: number
    clicks?: number
    orders?: number
    impressions?: number
    cpc?: number
    roas?: number
    ctr?: number
  }
  origen?: string
}

interface AIValidationResult {
  status: 'APPROVE' | 'REJECT' | 'MODIFY'
  newBid?: number
  reasoning: string
  decisionMaker: 'ALGORITHM' | 'AI'
}

interface FinalChange {
  'Producto': string
  'Entidad': string
  'Operación': string
  'ID de la campaña': string
  'ID del grupo de anuncios': string
  'ID de palabra clave': string
  'Puja': number
  'Puja Original'?: number
  'Estado': string
  'Texto de palabra clave': string
  'Tipo de coincidencia': string
  'Decision Maker'?: 'ALGORITHM' | 'AI'
  'AI Reasoning'?: string
  'Gasto'?: number
  'ACOS'?: number
  'Clics'?: number
  'Ventas'?: number
  'Pedidos'?: number
  'CPC'?: number
  'ROAS'?: number
  'CTR'?: number
  'Origen'?: string
}

// ============================================================================
// UTILIDADES DE PARSING
// ============================================================================

/**
 * Normaliza las claves de un objeto eliminando espacios al inicio y final
 */
function normalizeKeys(obj: Record<string, any>): Record<string, any> {
  const normalized: Record<string, any> = {}
  for (const [key, value] of Object.entries(obj)) {
    normalized[key.trim()] = value
  }
  return normalized
}

/**
 * Busca la pestaña correcta en un libro Excel basándose en columnas clave o nombre de pestaña
 */
function findSheetByColumns(
  workbook: XLSX.WorkBook,
  requiredColumns: string[],
  preferredSheetNames?: string[]
): { sheetName: string; data: any[] } | null {
  // Primero intentar por nombre de pestaña preferido
  if (preferredSheetNames) {
    for (const preferredName of preferredSheetNames) {
      for (const sheetName of workbook.SheetNames) {
        if (sheetName.toLowerCase().includes(preferredName.toLowerCase())) {
          const sheet = workbook.Sheets[sheetName]
          const jsonData = XLSX.utils.sheet_to_json(sheet, { defval: '' })
          const normalizedData = jsonData.map((row: any) => normalizeKeys(row))
          console.log(`✅ [PARSING] Pestaña encontrada por nombre: "${sheetName}" con ${normalizedData.length} filas`)
          return { sheetName, data: normalizedData }
        }
      }
    }
  }

  // Si no se encontró por nombre, buscar por columnas
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName]
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as any[][]

    if (rows.length === 0) continue

    // Normalizar headers
    const headers = rows[0].map((h: any) => String(h).trim())

    // Verificar si todas las columnas requeridas existen
    const found = requiredColumns.every((requiredCol) =>
      headers.some((header: string) =>
        header.toLowerCase().includes(requiredCol.toLowerCase())
      )
    )

    if (found) {
      const jsonData = XLSX.utils.sheet_to_json(sheet, { defval: '' })
      const normalizedData = jsonData.map((row: any) => normalizeKeys(row))
      console.log(`✅ [PARSING] Pestaña encontrada por columnas: "${sheetName}" con ${normalizedData.length} filas`)
      return { sheetName, data: normalizedData }
    }
  }

  return null
}

/**
 * Obtiene un valor de un objeto con múltiples posibles claves (normalizado)
 */
function getValue(row: Record<string, any>, keys: string[]): any {
  for (const key of keys) {
    const normalizedKey = Object.keys(row).find(
      (k) => k.trim().toLowerCase() === key.trim().toLowerCase()
    )
    if (normalizedKey !== undefined && row[normalizedKey] !== undefined && row[normalizedKey] !== '') {
      return row[normalizedKey]
    }
  }
  return null
}

/**
 * Parsea un número de formato Amazon (puede tener comas, puntos, símbolos)
 */
function parseAmazonNumber(value: any): number {
  if (typeof value === 'number') return value
  if (!value) return 0

  const str = String(value)
    .replace(/[€$£,]/g, '')
    .replace(/\s/g, '')
    .replace('%', '')
    .trim()

  const hasComma = str.includes(',')
  const hasDot = str.includes('.')

  if (hasComma && hasDot) {
    const lastComma = str.lastIndexOf(',')
    const lastDot = str.lastIndexOf('.')
    if (lastComma > lastDot) {
      return parseFloat(str.replace(/\./g, '').replace(',', '.'))
    } else {
      return parseFloat(str.replace(/,/g, ''))
    }
  } else if (hasComma) {
    return parseFloat(str.replace(',', '.'))
  } else {
    return parseFloat(str) || 0
  }
}

// ============================================================================
// FASE 1: LECTURA INTELIGENTE (Smart Parsing)
// ============================================================================

async function parseBulkFile(file: File): Promise<{
  structureData: BulkRow[]
  searchTermsData: SearchTermRow[]
  campaignMap: Map<string, string>
}> {
  console.log('📖 [PHASE-1] Iniciando Smart Parsing...')
  
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array' })
  
  console.log('📖 [PHASE-1] Pestañas encontradas:', workbook.SheetNames)

  // Dataset A: Estructura/Pujas (buscar pestaña con Entidad, ID de la campaña, Puja)
  const structureSheet = findSheetByColumns(workbook, [
    'Entidad',
    'ID de la campaña',
    'Puja',
  ])

  if (!structureSheet) {
    throw new Error('No se encontró la pestaña con estructura de campañas (columnas: Entidad, ID de la campaña, Puja)')
  }

  const structureData: BulkRow[] = structureSheet.data as BulkRow[]
  console.log(`✅ [PHASE-1] Dataset A (Estructura): ${structureData.length} filas`)

  // Dataset B: Términos de búsqueda (buscar pestaña con nombre específico o columnas)
  const searchTermsSheet = findSheetByColumns(
    workbook,
    [
      'Término de búsqueda de cliente',
      'Pedidos totales',
    ],
    [
      'Inf. de Térm. de Búsq. de SP',
      'Informe de términos de búsqueda',
      'Search Terms',
      'Términos de búsqueda',
    ]
  )

  if (!searchTermsSheet) {
    console.warn('⚠️ [PHASE-1] No se encontró pestaña de términos de búsqueda, continuando sin harvesting')
    console.warn('⚠️ [PHASE-1] Pestañas disponibles:', workbook.SheetNames)
  }

  const searchTermsData: SearchTermRow[] = searchTermsSheet?.data || []
  console.log(`✅ [PHASE-1] Dataset B (Search Terms): ${searchTermsData.length} filas`)

  // Crear mapa de campañas: Nombre -> ID
  const campaignMap = new Map<string, string>()
  for (const row of structureData) {
    const entity = getValue(row, ['Entidad', 'Entity'])
    const campaignId = getValue(row, ['ID de la campaña', 'Campaign ID'])
    const campaignName = getValue(row, [
      'Nombre de la campaña',
      'Campaña',
      'Campaign',
      'Campaign Name',
    ])

    if (entity && (entity === 'Campaña' || entity === 'Campaign')) {
      if (campaignId && campaignName) {
        campaignMap.set(String(campaignName).trim(), String(campaignId).trim())
      }
    }
  }

  console.log(`✅ [PHASE-1] Mapa de campañas: ${campaignMap.size} campañas mapeadas`)

  return { structureData, searchTermsData, campaignMap }
}

// ============================================================================
// FASE 2A: PROPUESTAS MATEMÁTICAS (El "Becario")
// ============================================================================

function generateMathematicalProposals(
  structureData: BulkRow[],
  searchTermsData: SearchTermRow[],
  campaignMap: Map<string, string>,
  targetACOS: number
): CandidateChange[] {
  console.log('🧮 [PHASE-2A] Generando propuestas matemáticas...')
  
  const proposals: CandidateChange[] = []

  // 1. BLEEDERS: Gasto > 5€ y Ventas == 0 -> Bajar a 0.05€
  for (const row of structureData) {
    const entity = getValue(row, ['Entidad', 'Entity'])
    if (entity !== 'Palabra clave' && entity !== 'Keyword') continue

    const campaignId = getValue(row, ['ID de la campaña', 'Campaign ID'])
    const keywordText = getValue(row, ['Texto de palabra clave', 'Keyword Text'])
    if (!campaignId || !keywordText) continue

    const currentBid = parseAmazonNumber(getValue(row, ['Puja', 'Bid']))
    const ventas = parseAmazonNumber(getValue(row, ['Ventas', 'Sales', 'Revenue']))
    const clics = parseAmazonNumber(getValue(row, ['Clics', 'Clicks']))
    const impresiones = parseAmazonNumber(getValue(row, ['Impresiones', 'Impressions']))
    const gasto = parseAmazonNumber(
      getValue(row, ['Inversión', 'Gasto', 'Spend', 'Cost', 'Coste'])
    ) || (currentBid * clics || 0)
    const acosRaw = parseAmazonNumber(getValue(row, ['ACOS', 'Acos', 'ACOS total']))
    const acos = acosRaw > 1 ? acosRaw / 100 : acosRaw
    const cpc = parseAmazonNumber(getValue(row, ['CPC', 'Cost per click']))
    const roas = parseAmazonNumber(getValue(row, ['ROAS', 'Return on ad spend']))
    const ctrRaw = parseAmazonNumber(getValue(row, ['Índice de clics', 'CTR', 'Click-through rate']))
    const ctr = ctrRaw > 1 ? ctrRaw / 100 : ctrRaw

    // BLEEDERS: Clics > 15 y Ventas == 0 -> Puja = 0.05
    if (ventas === 0 && clics > 15 && gasto > 5) {
      proposals.push({
        type: 'UPDATE',
        entity: 'Palabra clave',
        operation: 'UPDATE',
        campaignId: String(campaignId),
        adGroupId: getValue(row, ['ID del grupo de anuncios', 'Ad Group ID']) || '',
        keywordId: getValue(row, ['ID de palabra clave', 'Keyword ID']) || '',
        keywordText: String(keywordText).trim(),
        currentBid,
        proposedBid: 0.05,
        matchType: getValue(row, ['Tipo de coincidencia', 'Match Type']) || 'exacta',
        product: getValue(row, ['Producto', 'Product', 'SKU']) || '',
        reason: `Bleeder: ${clics} clics, ${gasto.toFixed(2)}€ gasto, 0 ventas`,
        confidence: gasto > 10 ? 'MEDIUM' : 'HIGH',
        needsAIReview: gasto > 10, // Revisar si el gasto es muy alto
        metadata: { 
          acos: acos * 100, // Guardar como porcentaje
          sales: ventas, 
          spend: gasto, 
          clicks: clics,
          impressions: impresiones,
          cpc: cpc || (gasto / clics) || currentBid,
          roas: roas || (ventas / gasto) || 0,
          ctr: ctr * 100 || (clics / impresiones) * 100 || 0, // Guardar como porcentaje
        },
      })

      // Crear negativa también
      proposals.push({
        type: 'CREATE_NEGATIVE',
        entity: 'Palabra clave negativa',
        operation: 'CREATE',
        campaignId: String(campaignId),
        adGroupId: getValue(row, ['ID del grupo de anuncios', 'Ad Group ID']) || '',
        keywordText: String(keywordText).trim(),
        proposedBid: 0,
        matchType: 'exacta',
        product: getValue(row, ['Producto', 'Product', 'SKU']) || '',
        reason: `Negativa para bleeder: ${keywordText} (${clics} clics sin conversión)`,
        confidence: 'HIGH',
        needsAIReview: false,
      })
    }
    // WINNERS: ACOS < 10% -> Subir 20%
    else if (acos > 0 && acos < 0.10 && ventas > 0) {
      proposals.push({
        type: 'UPDATE',
        entity: 'Palabra clave',
        operation: 'UPDATE',
        campaignId: String(campaignId),
        adGroupId: getValue(row, ['ID del grupo de anuncios', 'Ad Group ID']) || '',
        keywordId: getValue(row, ['ID de palabra clave', 'Keyword ID']) || '',
        keywordText: String(keywordText).trim(),
        currentBid,
        proposedBid: currentBid * 1.2,
        matchType: getValue(row, ['Tipo de coincidencia', 'Match Type']) || 'exacta',
        product: getValue(row, ['Producto', 'Product', 'SKU']) || '',
        reason: `Winner: ACOS ${(acos * 100).toFixed(2)}%`,
        confidence: 'HIGH',
        needsAIReview: false,
        metadata: { 
          acos: acos * 100,
          sales: ventas, 
          spend: gasto, 
          clicks: clics,
          impressions: impresiones,
          cpc: cpc || (gasto / clics) || currentBid,
          roas: roas || (ventas / gasto) || 0,
          ctr: ctr * 100 || (clics / impresiones) * 100 || 0,
        },
      })
    }
    // CORRECTION: ACOS > 35% -> Bajar 20%
    else if (acos > 0.35 && ventas > 0) {
      proposals.push({
        type: 'UPDATE',
        entity: 'Palabra clave',
        operation: 'UPDATE',
        campaignId: String(campaignId),
        adGroupId: getValue(row, ['ID del grupo de anuncios', 'Ad Group ID']) || '',
        keywordId: getValue(row, ['ID de palabra clave', 'Keyword ID']) || '',
        keywordText: String(keywordText).trim(),
        currentBid,
        proposedBid: currentBid * 0.8,
        matchType: getValue(row, ['Tipo de coincidencia', 'Match Type']) || 'exacta',
        product: getValue(row, ['Producto', 'Product', 'SKU']) || '',
        reason: `Corrección: ACOS ${(acos * 100).toFixed(2)}% > objetivo`,
        confidence: 'HIGH',
        needsAIReview: false,
        metadata: { 
          acos: acos * 100,
          sales: ventas, 
          spend: gasto, 
          clicks: clics,
          impressions: impresiones,
          cpc: cpc || (gasto / clics) || currentBid,
          roas: roas || (ventas / gasto) || 0,
          ctr: ctr * 100 || (clics / impresiones) * 100 || 0,
        },
      })
    }
  }

  // 2. HARVESTING: Término vende y ACOS < 30% en AUTO -> Crear Exacta en Manual
  // 3. NEGATIVAS DE AUTO: Términos de AUTO que no convierten -> Negativizar en Manual
  for (const searchRow of searchTermsData) {
    const searchTerm = getValue(searchRow, [
      'Término de búsqueda de cliente',
      'Término de búsqueda',
      'Search Term',
    ])
    const pedidos = parseAmazonNumber(
      getValue(searchRow, [
        'Pedidos totales de 7 días (#)',
        'Pedidos',
        'Orders',
        'Total Orders',
      ])
    )
    const acosRaw = parseAmazonNumber(
      getValue(searchRow, [
        'Coste publicitario de las ventas (ACOS) total ',
        'Coste publicitario de las ventas (ACOS) total',
        'ACOS',
        'ACOS total',
      ])
    )
    const acos = acosRaw > 1 ? acosRaw / 100 : acosRaw
    const gasto = parseAmazonNumber(getValue(searchRow, ['Gasto', 'Spend', 'Cost', 'Coste']))
    const clics = parseAmazonNumber(getValue(searchRow, ['Clics', 'Clicks']))

    const campaignName = getValue(searchRow, [
      'Nombre de campaña',
      'Campaña',
      'Campaign',
    ])
    const campaignType = getValue(searchRow, [
      'Tipo de segmentación',
      'Tipo de campaña',
      'Campaign Type',
    ])

    // Detectar si es campaña automática (AUTO)
    const isAutoCampaign = campaignName?.toUpperCase().includes('AUTO') || 
                           campaignType?.toUpperCase().includes('AUTOMATIC') ||
                           campaignType?.toUpperCase().includes('AUTO')

    if (pedidos >= 1 && acos < 0.30 && searchTerm && campaignName) {
      // HARVESTING: Buscar campaña Manual equivalente
      const campaignId = campaignMap.get(String(campaignName).trim())
      if (campaignId) {
        // Buscar keyword base para obtener datos
        const baseKeyword = structureData.find(
          (r) =>
            getValue(r, ['ID de la campaña', 'Campaign ID']) === campaignId &&
            getValue(r, ['Entidad', 'Entity']) === 'Palabra clave'
        )

        const baseBid = baseKeyword
          ? parseAmazonNumber(getValue(baseKeyword, ['Puja', 'Bid']))
          : 0.5

        proposals.push({
          type: 'CREATE',
          entity: 'Palabra clave',
          operation: 'CREATE',
          campaignId: String(campaignId),
          adGroupId: baseKeyword
            ? (getValue(baseKeyword, ['ID del grupo de anuncios', 'Ad Group ID']) || '')
            : '',
          keywordText: String(searchTerm).trim(),
          proposedBid: baseBid,
          matchType: 'exacta',
          product: baseKeyword
            ? (getValue(baseKeyword, ['Producto', 'Product', 'SKU']) || '')
            : '',
          reason: `Harvesting: ${pedidos} pedidos, ACOS ${(acos * 100).toFixed(2)}% desde ${isAutoCampaign ? 'AUTO' : 'Manual'}`,
          confidence: 'MEDIUM',
          needsAIReview: true, // Siempre revisar harvesting
          metadata: { orders: pedidos, acos },
          origen: isAutoCampaign ? 'AUTO' : undefined, // Solo marcar si viene de AUTO
        })
      }
    }
    
    // NEGATIVAS DE AUTO: Si es AUTO y no convierte (pedidos = 0, gasto > 3€ o clics > 10)
    if (isAutoCampaign && pedidos === 0 && (gasto > 3 || clics > 10) && searchTerm) {
      // Buscar campaña Manual equivalente para negativizar
      const manualCampaignName = campaignName?.replace(/AUTO/gi, '').trim() || campaignName
      const campaignId = campaignMap.get(String(manualCampaignName).trim())
      
      if (campaignId) {
        proposals.push({
          type: 'CREATE_NEGATIVE',
          entity: 'Palabra clave negativa',
          operation: 'CREATE',
          campaignId: String(campaignId),
          keywordText: String(searchTerm).trim(),
          proposedBid: 0,
          matchType: 'exacta',
          reason: `Negativa desde AUTO: ${clics} clics, ${gasto.toFixed(2)}€ gasto, 0 pedidos`,
          confidence: 'HIGH',
          needsAIReview: false,
          metadata: { orders: pedidos, spend: gasto, clicks: clics },
        })
      }
    }
  }

  console.log(`✅ [PHASE-2A] ${proposals.length} propuestas generadas`)
  return proposals
}

// ============================================================================
// FASE 2B: FILTRO DE RELEVANCIA
// ============================================================================

function filterForAIReview(proposals: CandidateChange[]): CandidateChange[] {
  console.log('🔍 [PHASE-2B] Filtrando propuestas para revisión IA...')
  
  const filtered = proposals.filter((p) => {
    // Enviar a IA si:
    // 1. Está marcado como needsAIReview
    // 2. Es un bleeder con gasto alto
    // 3. Es harvesting (nuevo término)
    // 4. Contiene palabras que podrían ser marca/competencia
    if (p.needsAIReview) return true
    
    if (p.type === 'UPDATE' && p.metadata?.spend && p.metadata.spend > 10) return true
    
    if (p.type === 'CREATE') return true
    
    // Detectar posibles términos de marca/competencia
    const keywordLower = p.keywordText.toLowerCase()
    const brandKeywords = ['marca', 'competencia', 'vs', 'comparar', 'mejor']
    if (brandKeywords.some(bk => keywordLower.includes(bk))) return true
    
    return false
  })

  console.log(`✅ [PHASE-2B] ${filtered.length} propuestas seleccionadas para IA`)
  return filtered
}

// ============================================================================
// FASE 2C: DECISIÓN DE LA IA (GPT-4o-mini)
// ============================================================================

async function validateWithAI(
  proposals: CandidateChange[]
): Promise<Map<string, AIValidationResult>> {
  console.log('🧠 [PHASE-2C] Consultando IA para validación...')
  
  // Verificar API key antes de importar
  if (!process.env.OPENAI_API_KEY) {
    console.warn('⚠️ [PHASE-2C] OPENAI_API_KEY no configurada, usando decisiones matemáticas')
    return new Map()
  }

  // Lazy import para evitar errores de build
  let OpenAI: any
  try {
    const openaiModule = await import('openai')
    OpenAI = openaiModule.default
  } catch (error) {
    console.warn('⚠️ [PHASE-2C] OpenAI no disponible, usando decisiones matemáticas')
    return new Map()
  }

  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  })

  const results = new Map<string, AIValidationResult>()

  // Preparar payload para IA
  const payload = {
    proposals: proposals.map((p) => ({
      type: p.type,
      keyword: p.keywordText,
      current_bid: p.currentBid,
      proposed_bid: p.proposedBid,
      reason: p.reason,
      metadata: p.metadata,
    })),
  }

  const systemPrompt = `Eres el Director de PPC de la marca. Revisa las propuestas del algoritmo matemático.

REGLAS DE DECISIÓN:
1. **Semántica:** Si el algoritmo quiere crear la keyword 'b07x...' (un ASIN) o términos sin sentido, RECHÁZALO. Solo queremos términos reales.
2. **Estrategia:** Si el algoritmo quiere 'matar' (bajar puja) a una palabra clave que es el nombre de nuestra competencia principal, MODIFICA la decisión: Mantén la puja para estrategia de conquista.
3. **Sentido Común:** Si el término es 'gratis' o 'barato' y nuestro producto es premium, confirma la bajada de puja.
4. **Harvesting:** Valida que los nuevos términos sean relevantes y tengan intención de compra real.

Responde SOLO con un JSON válido con este formato:
{
  "decisions": [
    {
      "keyword": "término exacto",
      "status": "APPROVE" | "REJECT" | "MODIFY",
      "new_bid": número (solo si MODIFY),
      "reasoning": "explicación breve"
    }
  ]
}`

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 10000) // 10s timeout

    const completion = await openai.chat.completions.create(
      {
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: JSON.stringify(payload, null, 2) },
        ],
        temperature: 0.4,
        response_format: { type: 'json_object' },
        max_tokens: 2000,
      },
      { signal: controller.signal }
    )

    clearTimeout(timeoutId)

    const response = JSON.parse(completion.choices[0].message.content || '{}')
    
    if (response.decisions) {
      for (const decision of response.decisions) {
        results.set(decision.keyword, {
          status: decision.status,
          newBid: decision.new_bid,
          reasoning: decision.reasoning,
          decisionMaker: 'AI',
        })
      }
    }

    console.log(`✅ [PHASE-2C] IA procesó ${results.size} decisiones`)
  } catch (error: any) {
    if (error.name === 'AbortError') {
      console.warn('⏱️ [PHASE-2C] Timeout en consulta IA, usando decisiones matemáticas')
    } else {
      console.error('❌ [PHASE-2C] Error en consulta IA:', error.message)
    }
  }

  return results
}

// ============================================================================
// FASE 2D: FUSIÓN (Merge)
// ============================================================================

function mergeDecisions(
  proposals: CandidateChange[],
  aiResults: Map<string, AIValidationResult>
): FinalChange[] {
  console.log('🔄 [PHASE-2D] Fusionando decisiones...')
  
  const finalChanges: FinalChange[] = []

  for (const proposal of proposals) {
    const aiDecision = aiResults.get(proposal.keywordText)

    // Si la IA rechazó, saltar
    if (aiDecision?.status === 'REJECT') {
      console.log(`🚫 [PHASE-2D] IA rechazó: ${proposal.keywordText}`)
      continue
    }

    // Determinar puja final
    let finalBid = proposal.proposedBid
    let decisionMaker: 'ALGORITHM' | 'AI' = 'ALGORITHM'
    let aiReasoning: string | undefined

    if (aiDecision?.status === 'MODIFY' && aiDecision.newBid !== undefined) {
      finalBid = aiDecision.newBid
      decisionMaker = 'AI'
      aiReasoning = aiDecision.reasoning
    } else if (aiDecision?.status === 'APPROVE') {
      decisionMaker = 'AI'
      aiReasoning = aiDecision.reasoning
    }

    // Crear cambio final
    const finalChange: FinalChange = {
      'Producto': proposal.product || '',
      'Entidad': proposal.entity,
      'Operación': proposal.operation,
      'ID de la campaña': proposal.campaignId,
      'ID del grupo de anuncios': proposal.adGroupId || '',
      'ID de palabra clave': proposal.keywordId || '',
      'Puja': Math.round(finalBid * 100) / 100,
      'Estado': 'habilitado',
      'Texto de palabra clave': proposal.keywordText,
      'Tipo de coincidencia': proposal.matchType,
      'Decision Maker': decisionMaker,
    }

    if (proposal.currentBid !== undefined) {
      finalChange['Puja Original'] = proposal.currentBid
    }

    if (aiReasoning) {
      finalChange['AI Reasoning'] = aiReasoning
    }

    // Añadir metadata útil
    if (proposal.metadata) {
      if (proposal.metadata.spend !== undefined) {
        finalChange['Gasto'] = proposal.metadata.spend
      }
      if (proposal.metadata.acos !== undefined) {
        finalChange['ACOS'] = proposal.metadata.acos // Ya viene como porcentaje
      }
      if (proposal.metadata.clicks !== undefined) {
        finalChange['Clics'] = proposal.metadata.clicks
      }
      if (proposal.metadata.sales !== undefined) {
        finalChange['Ventas'] = proposal.metadata.sales
      }
      if (proposal.metadata.orders !== undefined) {
        finalChange['Pedidos'] = proposal.metadata.orders
      }
      if (proposal.metadata.cpc !== undefined) {
        finalChange['CPC'] = proposal.metadata.cpc
      }
      if (proposal.metadata.roas !== undefined) {
        finalChange['ROAS'] = proposal.metadata.roas
      }
      if (proposal.metadata.ctr !== undefined) {
        finalChange['CTR'] = proposal.metadata.ctr // Ya viene como porcentaje
      }
    }

    // Añadir origen si existe
    if (proposal.origen) {
      finalChange['Origen'] = proposal.origen
    }

    finalChanges.push(finalChange)
  }

  console.log(`✅ [PHASE-2D] ${finalChanges.length} cambios finales generados`)
  return finalChanges
}

// ============================================================================
// FASE 3: GENERACIÓN DE EXCEL
// ============================================================================

function generateExcelOutput(changes: FinalChange[]): Buffer {
  console.log('📊 [PHASE-3] Generando Excel de salida...')
  
  const outputWorkbook = XLSX.utils.book_new()
  
  // Filtrar y preparar datos para Excel (sin campos de metadata)
  const excelRows = changes.map((change) => {
    const { 'Decision Maker': _, 'AI Reasoning': __, ...excelRow } = change
    return excelRow
  })
  
  const outputSheet = XLSX.utils.json_to_sheet(excelRows)
  XLSX.utils.book_append_sheet(outputWorkbook, outputSheet, 'Optimización')

  const buffer = XLSX.write(outputWorkbook, { type: 'buffer', bookType: 'xlsx' })
  console.log(`✅ [PHASE-3] Excel generado con ${excelRows.length} filas`)
  
  return buffer
}

// ============================================================================
// ENDPOINT PRINCIPAL
// ============================================================================

export async function POST(request: NextRequest) {
  try {
    console.log('🚀 [DUAL-PROCESS] Iniciando pipeline AI-in-the-Loop...')
    
    const formData = await request.formData()
    const bulkFile = formData.get('bulkFile') as File
    const targetACOS = formData.get('targetACOS')
      ? parseFloat(formData.get('targetACOS') as string) / 100
      : 0.20

    if (!bulkFile) {
      return NextResponse.json(
        { error: 'Se requiere el archivo Bulk File' },
        { status: 400 }
      )
    }

    // FASE 1: Smart Parsing
    const { structureData, searchTermsData, campaignMap } = await parseBulkFile(bulkFile)

    // FASE 2A: Propuestas Matemáticas
    const proposals = generateMathematicalProposals(
      structureData,
      searchTermsData,
      campaignMap,
      targetACOS
    )

    // FASE 2B: Filtro de Relevancia
    const proposalsForAI = filterForAIReview(proposals)

    // FASE 2C: Decisión IA
    const aiResults = await validateWithAI(proposalsForAI)

    // FASE 2D: Fusión
    const finalChanges = mergeDecisions(proposals, aiResults)

    // FASE 3: Generar Excel (opcional, por ahora devolvemos JSON)
    // const excelBuffer = generateExcelOutput(finalChanges)

    // Estadísticas
    const stats = {
      total_proposals: proposals.length,
      ai_reviewed: proposalsForAI.length,
      ai_approved: Array.from(aiResults.values()).filter(r => r.status === 'APPROVE').length,
      ai_rejected: Array.from(aiResults.values()).filter(r => r.status === 'REJECT').length,
      ai_modified: Array.from(aiResults.values()).filter(r => r.status === 'MODIFY').length,
      final_changes: finalChanges.length,
    }

    console.log('✅ [DUAL-PROCESS] Pipeline completado:', stats)

    return NextResponse.json({
      success: true,
      changes: finalChanges,
      summary: {
        total_changes: finalChanges.length,
        updates: finalChanges.filter((r) => r['Operación'] === 'UPDATE').length,
        new_keywords: finalChanges.filter((r) => r['Operación'] === 'CREATE').length,
        negatives: finalChanges.filter((r) => r['Entidad'] === 'Palabra clave negativa').length,
      },
      stats,
    })
  } catch (error: any) {
    console.error('❌ [DUAL-PROCESS] Error:', error)
    return NextResponse.json(
      { error: error.message || 'Error al procesar el archivo' },
      { status: 500 }
    )
  }
}
