import { Link2Off } from 'lucide-react'
import { Cabecera } from './Cabecera'
import { FUENTE_CUERPO, FUENTE_TITULO } from './marca'

/**
 * LO QUE VE QUIEN LLEGA CON UN ENLACE QUE NO VALE: inventado, desactivado o caducado.
 *
 * Le dice qué hacer —pedir uno nuevo— y NADA MÁS: no cuenta de qué envío era ni de qué cliente, y
 * desde fuera «caducado» y «desactivado» se leen igual de claro. De servidor: sin estado ni interacción.
 */
export function EnlaceNoValido({ texto }: { texto: string }) {
  return (
    <div className="min-h-screen bg-[#F7F5F2] text-[#141414]" style={{ fontFamily: FUENTE_CUERPO }}>
      <Cabecera titulo="Encaje del envío" cliente="Liberty Seller" />
      <main className="mx-auto max-w-[640px] px-5 pb-20 pt-10 sm:px-8">
        <div className="rounded-3xl border border-[#E5E1DB] bg-[#FFFFFF] px-6 py-12 text-center sm:px-12">
          <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-[#FBEFE8] text-[#F26212]">
            <Link2Off className="h-8 w-8" />
          </span>
          <h2 className="mt-5 text-[24px] leading-tight text-[#141414]" style={{ fontFamily: FUENTE_TITULO, fontWeight: 600 }}>
            Este enlace no se puede usar
          </h2>
          <p className="mx-auto mt-3 max-w-[440px] text-[14.5px] leading-relaxed text-[#5E5852]">{texto}</p>
        </div>
      </main>
    </div>
  )
}
