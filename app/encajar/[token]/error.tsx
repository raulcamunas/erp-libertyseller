'use client'

import { Cabecera } from '@/components/encaje/Cabecera'
import { FUENTE_CUERPO, FUENTE_TITULO } from '@/components/encaje/marca'

/**
 * SI LA PÁGINA SE CAE (la base no contesta, un fallo inesperado): una pantalla con la marca que dice qué
 * hacer, no la de error del framework. Lo que falló no se enseña: este error no es de quien lo ve.
 */
export default function ErrorDeEncaje({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="min-h-screen bg-[#F7F5F2] text-[#141414]" style={{ fontFamily: FUENTE_CUERPO }}>
      <Cabecera titulo="Encaje del envío" cliente="Liberty Seller" />
      <main className="mx-auto max-w-[640px] px-5 pb-20 pt-10 sm:px-8">
        <div className="rounded-3xl border border-[#E5E1DB] bg-[#FFFFFF] px-6 py-12 text-center sm:px-12">
          <h2 className="text-[24px] leading-tight text-[#141414]" style={{ fontFamily: FUENTE_TITULO, fontWeight: 600 }}>
            No hemos podido abrir tu envío
          </h2>
          <p className="mx-auto mt-3 max-w-[440px] text-[14.5px] leading-relaxed text-[#5E5852]">Ha habido un fallo por nuestra parte. Vuelve a probar en un momento; si sigue igual, avisa a Liberty Seller. Lo que ya habías encajado está guardado.</p>
          <button type="button" onClick={reset} className="mt-6 h-11 rounded-xl bg-[#141414] px-6 text-[14px] font-semibold text-[#FFFFFF] transition hover:bg-[#F26212]">
            Volver a probar
          </button>
        </div>
      </main>
    </div>
  )
}
