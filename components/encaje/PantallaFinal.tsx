'use client'

import { CircleCheck } from 'lucide-react'
import type { CajaEnEdicion, LineaParaEncajar, ResumenDeEncaje } from '@/lib/fba/encaje-resumen'
import { unidadesDeCaja } from '@/lib/fba/encaje-resumen'
import { FUENTE_TITULO, n0, n1 } from './marca'

/**
 * LO QUE SE VE CUANDO YA SE HA TERMINADO.
 *
 * Dos veces: justo al pulsar «He terminado» —ahí es un «gracias»— y cada vez que se vuelve a abrir el
 * enlace mientras el envío está en «Lista para enviar». Lo que se enseña es lo que se ha mandado, en una
 * tabla de solo lectura: por si el cliente quiere comprobar qué dejó en cada caja, y por si hay que
 * corregir algo, que se le dice a quién avisar en vez de dejarle sin salida.
 */
export function PantallaFinal({ recien, resumen, cajas, lineas }: { recien: boolean; resumen: ResumenDeEncaje; cajas: CajaEnEdicion[]; lineas: LineaParaEncajar[] }) {
  const porSku = new Map(lineas.map((l) => [l.sku, l]))
  return (
    <main className="mx-auto max-w-[760px] px-5 pb-20 pt-10 sm:px-8">
      <div className="rounded-3xl border border-[#E5E1DB] bg-[#FFFFFF] px-6 py-10 text-center sm:px-12">
        <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-[#E4F3EA] text-[#2F9657]">
          <CircleCheck className="h-9 w-9" />
        </span>
        <h2 className="mt-5 text-[26px] leading-tight text-[#141414]" style={{ fontFamily: FUENTE_TITULO, fontWeight: 600 }}>
          {recien ? '¡Listo! Has terminado de encajar' : 'Ya has terminado de encajar este envío'}
        </h2>
        <p className="mx-auto mt-3 max-w-[520px] text-[14.5px] leading-relaxed text-[#5E5852]">
          {recien ? 'Liberty Seller ya tiene tus cajas y se encarga del resto: preparar el envío en Amazon. No tienes que hacer nada más.' : 'Liberty Seller ya tiene tus cajas y está preparando el envío en Amazon.'} Si hay que corregir algo, avísanos y te volvemos a abrir las cajas.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2.5 text-[13px]">
          <Dato>
            <b>{n0(resumen.cajas)}</b> caja{resumen.cajas === 1 ? '' : 's'}
          </Dato>
          <Dato>
            <b>{n0(resumen.encajadas)}</b> unidades
          </Dato>
          <Dato>
            <b>{n1(resumen.pesoTotalKg)}</b> kg en total
          </Dato>
        </div>
      </div>

      <section className="mt-6 rounded-2xl border border-[#E5E1DB] bg-[#FFFFFF]">
        <h3 className="px-5 pb-1 pt-4 text-[15px] text-[#141414]" style={{ fontFamily: FUENTE_TITULO, fontWeight: 600 }}>
          Lo que has mandado
        </h3>
        <ul className="divide-y divide-[#EFEBE5]">
          {cajas.map((c) => (
            <li key={c.numero} className="px-5 py-3.5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-[14px] font-semibold text-[#141414]">Caja {c.numero}</span>
                <span className="text-[12.5px] text-[#5E5852]">
                  {n1(c.largoCm ?? 0)} × {n1(c.anchoCm ?? 0)} × {n1(c.altoCm ?? 0)} cm · {n1(c.pesoKg ?? 0)} kg · {n0(unidadesDeCaja(c))} unidades
                </span>
              </div>
              <ul className="mt-1.5 space-y-0.5">
                {c.contenido.map((x) => {
                  const l = porSku.get(x.sku)
                  return (
                    <li key={x.sku} className="flex items-baseline gap-2 text-[12.5px] text-[#5E5852]">
                      <span className="w-8 shrink-0 text-right font-semibold tabular-nums text-[#141414]">{n0(x.unidades)}</span>
                      <span className="shrink-0 whitespace-nowrap font-medium text-[#141414]">{x.sku}</span>
                      {l?.variante && <span className="shrink-0 whitespace-nowrap">{l.variante}</span>}
                      {l?.nombre && <span className="min-w-0 flex-1 truncate text-[#8C857C]">{l.nombre}</span>}
                    </li>
                  )
                })}
              </ul>
            </li>
          ))}
        </ul>
      </section>
    </main>
  )
}

function Dato({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full bg-[#F7F5F2] px-3.5 py-1.5 text-[#5E5852] [&_b]:font-semibold [&_b]:text-[#141414]">{children}</span>
}
