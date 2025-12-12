/**
 * Parser robusto para números en formato europeo
 * Maneja: "1 200,50" -> 1200.50
 */
export const parseNum = (val: any): number => {
  if (!val && val !== 0) return 0
  
  let s = String(val)
    .replace(/\s/g, '') // Eliminar espacios
    .replace(/[^\d,.-]/g, '') // Solo números, comas, puntos y guiones
  
  // Si tiene ambos, punto es miles y coma es decimal
  if (s.includes(',') && s.includes('.')) {
    s = s.replace(/\./g, '').replace(',', '.')
  } 
  // Si solo tiene coma, es decimal
  else if (s.includes(',')) {
    s = s.replace(',', '.')
  }
  
  const parsed = parseFloat(s)
  return isNaN(parsed) ? 0 : parsed
}

/**
 * Busca un valor en un objeto usando múltiples candidatos (case insensitive y regex)
 */
export const getVal = (row: Record<string, any>, candidates: (string | RegExp)[]): any => {
  const keys = Object.keys(row)
  
  for (const candidate of candidates) {
    if (candidate instanceof RegExp) {
      const match = keys.find(k => candidate.test(k))
      if (match && row[match] !== undefined && row[match] !== null && row[match] !== '') {
        return row[match]
      }
    } else {
      // Buscar case insensitive
      const match = keys.find(k => k.toLowerCase() === candidate.toLowerCase())
      if (match && row[match] !== undefined && row[match] !== null && row[match] !== '') {
        return row[match]
      }
      // También intentar directamente
      if (row[candidate] !== undefined && row[candidate] !== null && row[candidate] !== '') {
        return row[candidate]
      }
    }
  }
  
  return null
}

/**
 * Detecta el delimitador del CSV (; o ,)
 */
export const detectDelimiter = (csvContent: string): string => {
  const firstLine = csvContent.split('\n')[0]
  const semicolonCount = (firstLine.match(/;/g) || []).length
  const commaCount = (firstLine.match(/,/g) || []).length
  
  return semicolonCount > commaCount ? ';' : ','
}

/**
 * Parsea CSV a array de objetos
 */
export const parseCSV = (csvContent: string): Record<string, any>[] => {
  const delimiter = detectDelimiter(csvContent)
  const lines = csvContent.split('\n').filter(line => line.trim())
  
  if (lines.length < 2) return []
  
  // Parsear headers
  const headers = lines[0]
    .split(delimiter)
    .map(h => h.trim().replace(/^"|"$/g, ''))
  
  // Parsear filas
  const rows: Record<string, any>[] = []
  
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i]
      .split(delimiter)
      .map(v => v.trim().replace(/^"|"$/g, ''))
    
    if (values.length !== headers.length) continue
    
    const row: Record<string, any> = {}
    headers.forEach((header, index) => {
      row[header] = values[index]
    })
    
    rows.push(row)
  }
  
  return rows
}

