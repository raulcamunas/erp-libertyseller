'use client'

import { ArrowRight, MapPin, PlayCircle, Sparkles } from 'lucide-react'
import { PANEL } from '@/components/rendimiento/ui'
import { GUION_DE_LA_DEMO, NOVEDADES, type EtiquetaDeNovedad } from '@/lib/novedades/desde-el-jueves'

/**
 * LO NUEVO DESDE EL JUEVES: LA PRIMERA PESTAÑA DE LA DEMOSTRACIÓN DE SECUENCIAS.
 *
 * Para el briefing: arriba, cómo recorrer la demostración; debajo, todo lo que ha cambiado en el ERP desde el jueves 22 de octubre, agrupado y explicado para el equipo (qué es, qué cambia
 * y dónde se ve). Los textos viven en lib/novedades/desde-el-jueves.ts; aquí solo se pintan.
 */

const COLOR: Record<EtiquetaDeNovedad, string> = { Nuevo: 'var(--ls-acc)', Mejora: 'var(--ls-e-verde)', Arreglo: 'var(--ls-e-ambar)' }

export function NovedadesDelJueves() {
  const nuevas = NOVEDADES.filter((n) => n.etiqueta === 'Nuevo').length
  return (
    <div className="space-y-3">
      <section className={`${PANEL} p-4`} aria-label="Cómo recorrer la demostración">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold tracking-[-0.01em] text-[var(--ls-t1)]">
          <Sparkles className="h-4 w-4 text-[var(--ls-acc)]" aria-hidden /> Lo nuevo desde el jueves 22
        </h2>
        <p className="mt-1 max-w-3xl text-[12.5px] leading-relaxed text-[var(--ls-t3)]">
          Cinco días, más de cincuenta cambios y {nuevas} cosas nuevas. Abajo está todo explicado. Y esta pantalla es una demostración con personas y correos inventados: el motor es el de verdad, pero no sale
          nada ni se guarda nada. Recórrela así:
        </p>
        <ol className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {GUION_DE_LA_DEMO.map((p, i) => (
            <li key={p.titulo} className="flex items-start gap-2.5 rounded-[8px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] p-2.5">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--ls-acc-suave)] text-[11px] font-semibold text-[var(--ls-t1)]">{i + 1}</span>
              <span className="min-w-0 text-[12px] leading-snug text-[var(--ls-t3)]">
                <strong className="block text-[12.5px] text-[var(--ls-t1)]">{p.titulo}</strong>
                {p.texto}
              </span>
            </li>
          ))}
        </ol>
      </section>

      <div className="grid gap-3 lg:grid-cols-2">
        {NOVEDADES.map((n) => (
          <article key={n.id} className={`${PANEL} space-y-2.5 p-4`} aria-label={n.titulo}>
            <header className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="rounded-[5px] px-1.5 py-px text-[10.5px] font-semibold" style={{ color: COLOR[n.etiqueta], background: `color-mix(in srgb, ${COLOR[n.etiqueta]} 14%, transparent)` }}>
                {n.etiqueta}
              </span>
              <h3 className="min-w-0 flex-1 text-[13.5px] font-semibold leading-snug text-[var(--ls-t1)]">{n.titulo}</h3>
              <span className="text-[11px] tabular-nums text-[var(--ls-t4)]">{n.cuando}</span>
            </header>
            <p className="text-[12.5px] leading-relaxed text-[var(--ls-t2)]">{n.queEs}</p>
            <ul className="space-y-1.5">
              {n.puntos.map((p) => (
                <li key={p} className="flex items-start gap-2 text-[12px] leading-snug text-[var(--ls-t3)]">
                  <ArrowRight className="mt-[3px] h-3 w-3 shrink-0 text-[var(--ls-t4)]" aria-hidden />
                  <span>{p}</span>
                </li>
              ))}
            </ul>
            <p className="flex items-start gap-1.5 border-t border-[var(--ls-linea)] pt-2 text-[11.5px] text-[var(--ls-t4)]">
              <MapPin className="mt-px h-3 w-3 shrink-0" aria-hidden /> <span>{n.donde}</span>
            </p>
          </article>
        ))}
      </div>

      <p className="flex items-center gap-2 px-1 text-[11.5px] text-[var(--ls-t4)]">
        <PlayCircle className="h-3.5 w-3.5" aria-hidden /> Cuando quieras, pasa a «Hoy» y empieza por ahí.
      </p>
    </div>
  )
}
