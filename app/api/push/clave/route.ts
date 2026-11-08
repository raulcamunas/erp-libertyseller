import { NextResponse } from 'next/server'
import { usuarioDeLaSesion, sinSesion } from '@/lib/push/sesion'
import { clavesDelServidor, misDispositivos } from '@/lib/push/servidor'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** La clave PÚBLICA con la que el navegador se suscribe y los dispositivos de esta persona. Si falta la migración 280, `disponible: false` */
export async function GET() {
  const usuario = await usuarioDeLaSesion()
  if (!usuario) return sinSesion()
  try {
    const k = await clavesDelServidor()
    if (!k) return NextResponse.json({ disponible: false, clave: null, dispositivos: [] })
    return NextResponse.json({ disponible: true, clave: k.publica, dispositivos: await misDispositivos(usuario) })
  } catch (e) {
    console.error('Push: no se ha podido leer la clave:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'No se ha podido preparar los avisos. Inténtalo otra vez.' }, { status: 500 })
  }
}
