import { NextResponse } from 'next/server'
import { idDeLaVersion } from '@/lib/sistema/version'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** La versión del ERP que está funcionando ahora. No es secreto (es un identificador de construcción). Lo pregunta cada pestaña para avisar de que hay una versión nueva */
export async function GET() {
  return NextResponse.json({ id: idDeLaVersion() }, { headers: { 'Cache-Control': 'no-store, max-age=0' } })
}
