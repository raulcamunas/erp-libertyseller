import { NextResponse, type NextRequest } from 'next/server'
import { firmaDeAvisoValida } from '@/lib/zadarma/api'
import { guardarFinDeLlamada, guardarGrabacion } from '@/lib/zadarma/servidor'

/**
 * LOS AVISOS DE LA CENTRALITA DE ZADARMA (webhook). Se configura en Zadarma (Integraciones y API → Notificaciones, o por la API) con esta dirección.
 *
 *   GET ?zd_echo=…   Zadarma comprueba la dirección al guardarla: hay que devolver el mismo texto.
 *   POST (formulario) NOTIFY_OUT_END (saliente) y NOTIFY_END (entrante) guardan la llamada en rinkel_llamadas; NOTIFY_RECORD le pone la grabación.
 *
 * Solo vale si trae la firma correcta (HMAC con el secreto de la API) o viene de las IP de Zadarma (185.45.152.40/30). Contesta 200 siempre que sea de Zadarma,
 * aunque no haya nada que guardar, para que no reintente.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const eco = request.nextUrl.searchParams.get('zd_echo')
  return new NextResponse(eco ?? 'ok', { headers: { 'Content-Type': 'text/plain' } })
}

const deZadarma = (ip: string | null): boolean => {
  const m = /^185\.45\.152\.(\d+)$/.exec((ip ?? '').split(',')[0].trim())
  return Boolean(m && Number(m[1]) >= 40 && Number(m[1]) <= 43)
}

export async function POST(request: NextRequest) {
  let campos: Record<string, string>
  try {
    const f = await request.formData()
    campos = Object.fromEntries([...f.entries()].map(([k, v]) => [k, String(v)]))
  } catch {
    return NextResponse.json({ error: 'Formato no válido' }, { status: 400 })
  }
  const evento = campos.event ?? ''
  const ip = request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip')
  if (!firmaDeAvisoValida(evento, campos, request.headers.get('signature')) && !deZadarma(ip)) {
    console.warn('[zadarma] aviso rechazado: sin firma válida', { evento, ip })
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }
  try {
    if (evento === 'NOTIFY_OUT_END' || evento === 'NOTIFY_END') {
      const r = await guardarFinDeLlamada(evento, campos)
      if (r !== 'guardada') console.warn('[zadarma] llamada sin guardar', { evento, motivo: r, internal: campos.internal ?? null })
    } else if (evento === 'NOTIFY_RECORD') {
      await guardarGrabacion(campos)
    }
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[zadarma] aviso', evento, e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'No se ha podido guardar' }, { status: 500 })
  }
}
