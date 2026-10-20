import { FUENTE_TITULO, fechaLarga, n0 } from './marca'

/**
 * LA BANDA DE ARRIBA: LA MARCA, EL ENVÍO Y PARA QUIÉN ES.
 *
 * La misma de los Excel y los PDF que se le entregan al cliente: la franja naranja, la banda oscura con
 * el logo, el título en Sora. Lo primero que ve quien abre el enlace tiene que decirle dos cosas sin
 * leer nada: que es de Liberty Seller y de qué envío se trata.
 *
 * Sin estado ni interacción: es un componente de servidor.
 */
export function Cabecera({
  titulo,
  cliente,
  referencias,
  unidades,
  fechaEnvio,
}: {
  titulo: string
  cliente: string
  referencias?: number
  unidades?: number
  fechaEnvio?: string
}) {
  const datos = [
    referencias !== undefined ? `${n0(referencias)} referencia${referencias === 1 ? '' : 's'}` : null,
    unidades !== undefined ? `${n0(unidades)} unidad${unidades === 1 ? '' : 'es'}` : null,
    fechaEnvio ? `para el ${fechaLarga(fechaEnvio)}` : null,
  ].filter(Boolean)

  return (
    <header className="bg-[#0E0E0E]">
      <div className="h-[5px] bg-[#F26212]" />
      <div className="mx-auto max-w-[1180px] px-5 pb-7 pt-5 sm:px-8 sm:pb-9">
        <div className="flex items-center justify-between gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logos/logo.png" alt="Liberty Seller" className="h-[26px] w-auto" />
          <span className="text-[10.5px] font-semibold uppercase tracking-[0.2em] text-[#F26212]">Encaje del envío</span>
        </div>
        <h1 className="mt-7 text-[27px] leading-[1.15] text-[#FFFFFF] sm:text-[36px]" style={{ fontFamily: FUENTE_TITULO, fontWeight: 600 }}>
          {titulo}
        </h1>
        <p className="mt-1.5 text-[15px] text-[#F26212] sm:text-[17px]" style={{ fontFamily: FUENTE_TITULO, fontWeight: 600 }}>
          {cliente}
        </p>
        {datos.length > 0 && <p className="mt-3 text-[13px] text-[#EDE6DC]">{datos.join('  ·  ')}</p>}
      </div>
    </header>
  )
}
