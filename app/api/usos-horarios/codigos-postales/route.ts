import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

export async function GET() {
  try {
    const filePath = path.join(process.cwd(), 'lista_codigos_postales.txt')
    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ codigos: [] }, { status: 200 })
    }
    const content = fs.readFileSync(filePath, 'utf-8')
    const codigos = content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => /^\d{5}$/.test(line))
    return NextResponse.json({ codigos })
  } catch (e) {
    console.error('Error reading codigos postales:', e)
    return NextResponse.json({ codigos: [] }, { status: 500 })
  }
}
