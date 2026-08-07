import { NextResponse, type NextRequest } from 'next/server'
import { errorResponse, fail, readText, requireAmazonAdmin } from '@/lib/amazon/api'
import { createAmazonClient, loadAmazonData } from '@/lib/amazon/data'

/**
 * Alta de un cliente al que todavía no le hemos conectado nada.
 *
 * Hace falta antes de poder generar un enlace: la migración solo siembra la
 * cuenta propia de la agencia, que es la única autorizable mientras la
 * aplicación esté en borrador.
 *
 * Devuelve la vista entera, como el resto del ERP: quien acaba de escribir se
 * lleva el estado ya recargado y no tiene que pedirlo aparte.
 */
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session

    const body = (await request.json().catch(() => ({}))) as { name?: unknown }
    const name = readText(body.name, 120)
    if (!name) return fail(400, 'Hay que ponerle un nombre al cliente')

    const client = await createAmazonClient({ name })
    const data = await loadAmazonData()

    return NextResponse.json({ ...data, client, message: `Cliente «${client.name}» dado de alta` })
  } catch (error) {
    return errorResponse(error, 'Error dando de alta un cliente de Amazon')
  }
}
