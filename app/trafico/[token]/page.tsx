import { cookies } from 'next/headers'
import { Link2Off } from 'lucide-react'
import { PanelTrafico } from '@/components/trafico/PanelTrafico'
import { enlaceDelToken, nombreDeCookie, sesionValida } from '@/lib/trafico/servidor'

/**
 * LA PÁGINA DE TRÁFICO Y CONVERSIÓN DE UN CLIENTE: con el enlace se ve el nombre y se pide la clave; con la clave (cookie firmada de 30 días) se ve el panel. Los datos
 * los pide la propia página a /api/trafico/[token]/datos, que vuelve a comprobar la cookie en cada petición.
 */
export const dynamic = 'force-dynamic'

export default async function PaginaDeTrafico({ params }: { params: { token: string } }) {
  const e = await enlaceDelToken(params.token).catch(() => null)
  if (!e) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-3 bg-[#F7F5F2] px-6 text-center">
        <Link2Off className="h-8 w-8 text-[#F26212]" />
        <h1 className="text-[20px] font-semibold text-[#141414]">Este enlace no está activo</h1>
        <p className="max-w-[420px] text-[14px] text-[#5E5852]">Puede que se haya cambiado o desactivado. Pide a Liberty Seller el enlace nuevo.</p>
      </main>
    )
  }
  const autenticado = sesionValida(e, cookies().get(nombreDeCookie(e.id))?.value)
  return <PanelTrafico token={params.token} titulo={e.titulo} autenticado={autenticado} />
}
