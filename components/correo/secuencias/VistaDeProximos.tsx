'use client'

import { CalendarRange } from 'lucide-react'
import type { CSSProperties } from 'react'
import { Avatar, CabeceraDePanel, PANEL, Revelar } from '@/components/rendimiento/ui'
import type { Tablero } from './datos'

/**
 * LOS PRÓXIMOS DÍAS: CUÁNTOS SEGUIMIENTOS SALEN CADA DÍA HÁBIL Y CUÁNTO CABE TODAVÍA.
 *
 * Una tarjeta por día. Dentro, una barra por buzón: lo ya programado frente al tope de ese día (la rampa de volumen, que cuenta también lo que la persona
 * manda a mano). Si un día se llena, el motor reparte el resto en los siguientes: aquí se ve de antemano.
 */

export function VistaDeProximos({ tablero }: { tablero: Tablero }) {
  const dias = tablero.proximos
  const total = dias.reduce((s, d) => s + d.total, 0)
  const buzones = new Map(tablero.buzones.map((b) => [b.id, b]))

  return (
    <section className={PANEL} aria-label="Próximos días">
      <CabeceraDePanel
        icono={<CalendarRange className="h-3.5 w-3.5" aria-hidden />}
        titulo="Próximos días"
        contexto={`· ${total} ${total === 1 ? 'correo programado' : 'correos programados'} en ${dias.length} días hábiles`}
      />
      {total === 0 && <p className="px-4 pt-6 text-center text-[12.5px] text-[var(--ls-t3)]">Todavía no hay nada programado para estos días.</p>}
      <div className="grid gap-2.5 p-3 md:grid-cols-2">
        {dias.map((d, i) => (
          <Revelar key={d.dia} i={i}>
            <article className={`rounded-[10px] border p-3 ${d.esHoy ? 'border-[var(--ls-acc-graf)] bg-[var(--ls-acc-suave)]' : 'border-[var(--ls-linea)] bg-[var(--ls-sup)]'}`}>
              <header className="mb-2 flex items-baseline justify-between gap-2">
                <h3 className="text-[12.5px] font-semibold text-[var(--ls-t1)]">{d.etiqueta}</h3>
                <span className="text-[11.5px] tabular-nums text-[var(--ls-t3)]">
                  <span className="font-semibold text-[var(--ls-t1)]">{d.total}</span> por salir
                </span>
              </header>
              <ul className="space-y-1.5">
                {d.porBuzon.map((b) => {
                  const buzon = buzones.get(b.buzonId)
                  const lleno = b.tope > 0 ? Math.min(100, (b.n / b.tope) * 100) : 0
                  const casi = b.libre <= 0
                  return (
                    <li key={b.buzonId} className="flex items-center gap-2" title={`${buzon?.propietario.nombre ?? 'Buzón'}: ${b.n} programados, tope del día ${b.tope}, caben ${b.libre} más`}>
                      <Avatar id={b.buzonId} nombre={buzon?.propietario.nombre ?? '?'} tamano={18} />
                      <span className="w-[74px] shrink-0 truncate text-[11.5px] text-[var(--ls-t2)]">{buzon?.propietario.nombre.split(' ')[0] ?? '—'}</span>
                      <span className="relative h-[7px] min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--ls-sup3)]">
                        <span className="sec-barra absolute inset-y-0 left-0 rounded-full" style={{ width: `${b.n > 0 ? Math.max(lleno, 3) : 0}%`, background: casi ? 'var(--ls-e-ambar)' : 'var(--ls-acc-graf)', '--d': i } as CSSProperties} />
                      </span>
                      <span className="w-[62px] shrink-0 text-right text-[11px] tabular-nums text-[var(--ls-t4)]">
                        <span className="font-semibold text-[var(--ls-t2)]">{b.n}</span> / {b.tope}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </article>
          </Revelar>
        ))}
      </div>
    </section>
  )
}
