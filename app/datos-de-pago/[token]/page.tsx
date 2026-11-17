import { Link2Off } from 'lucide-react'
import { Cabecera } from '@/components/encaje/Cabecera'
import { FUENTE_CUERPO, FUENTE_TITULO } from '@/components/encaje/marca'
import { FormularioDatosDePago } from '@/components/datos-de-pago/FormularioDatosDePago'
import { anotarApertura, resolverEnlace } from '@/lib/empleados/enlace-pago'

/**
 * EL FORMULARIO DE DATOS DE PAGO QUE ABRE UN EMPLEADO CON SU ENLACE. El token se comprueba aquí; a la pantalla solo llega su nombre de pila para el
 * saludo. Un enlace que no vale enseña qué hacer y nada más.
 */
export const dynamic = 'force-dynamic'

export default async function PaginaDatosDePago({ params }: { params: { token: string } }) {
  let r: Awaited<ReturnType<typeof resolverEnlace>>
  try {
    r = await resolverEnlace(params.token)
  } catch {
    r = { ok: false, motivo: 'no-existe' }
  }
  if (!r.ok) {
    return (
      <div className="min-h-screen bg-[#F7F5F2] text-[#141414]" style={{ fontFamily: FUENTE_CUERPO }}>
        <Cabecera titulo="Datos de pago" cliente="Liberty Seller" etiqueta="Datos de pago" />
        <main className="mx-auto max-w-[640px] px-5 pb-20 pt-10 sm:px-8">
          <div className="rounded-3xl border border-[#E5E1DB] bg-[#FFFFFF] px-6 py-12 text-center sm:px-12">
            <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-[#FBEFE8] text-[#F26212]">
              <Link2Off className="h-8 w-8" />
            </span>
            <h2 className="mt-5 text-[24px] leading-tight" style={{ fontFamily: FUENTE_TITULO, fontWeight: 600 }}>
              Este enlace no se puede usar
            </h2>
            <p className="mx-auto mt-3 max-w-[440px] text-[14.5px] leading-relaxed text-[#5E5852]">
              {r.motivo === 'usado' ? 'Tus datos ya se enviaron con este enlace. Si necesitas cambiarlos, pide uno nuevo.' : 'El enlace ha caducado o no es correcto. Pide uno nuevo a quien te lo envió.'}
            </p>
          </div>
        </main>
      </div>
    )
  }
  await anotarApertura(r.enlace)
  return <FormularioDatosDePago token={params.token} nombre={r.nombre.split(' ')[0] ?? ''} />
}
