import { CircleCheck, TriangleAlert } from 'lucide-react'

/**
 * LO QUE VE EL CLIENTE AL VOLVER DE AMAZON TRAS DAR ACCESO A SU PUBLICIDAD (enlace de «Enlace para el cliente» en Publicidad). Pública: no enseña nada de
 * nadie, solo si ha ido bien. El mensaje de error viene de nuestro callback.
 */
export const dynamic = 'force-dynamic'

export default function AdsConectado({ searchParams }: { searchParams: { ads_ok?: string; ads_error?: string } }) {
  const ok = Boolean(searchParams.ads_ok) && !searchParams.ads_error
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#F7F5F2] px-6 text-center">
      {ok ? <CircleCheck className="h-10 w-10 text-[#F26212]" /> : <TriangleAlert className="h-10 w-10 text-[#C0432E]" />}
      <h1 className="text-[22px] font-semibold text-[#141414]">{ok ? '¡Listo! Ya tenemos acceso a tu publicidad' : 'No se ha podido completar el acceso'}</h1>
      <p className="max-w-[460px] text-[14.5px] leading-relaxed text-[#5E5852]">
        {ok
          ? 'Gracias. Liberty Seller ya puede ver y gestionar tus campañas de Amazon Ads. Puedes cerrar esta pestaña.'
          : `${searchParams.ads_error ?? 'Algo ha fallado al volver de Amazon.'} Si el enlace ha caducado, pídenos uno nuevo.`}
      </p>
      <p className="text-[12px] text-[#B8AE9F]">Liberty Seller</p>
    </main>
  )
}
