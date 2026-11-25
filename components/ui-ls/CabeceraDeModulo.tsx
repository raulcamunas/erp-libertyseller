'use client'

import Link from 'next/link'
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { LucideIcon } from 'lucide-react'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ACENTO_2, colorDeAcento, mezcla, type Modulo } from './utilidades'

/**
 * CABECERA DE MÓDULO. La primera pieza de cada pantalla: icono en una baldosa con el degradado del acento del módulo, título, entradilla y las acciones a la derecha.
 * Migas opcionales encima y una ranura `debajo` para las pestañas.
 *
 * EN EL MÓVIL, al pasarla haciendo scroll, aparece arriba una barra compacta fija (icono y título) con hueco a la izquierda para el botón del menú. La cabecera
 * en sí no cambia de tamaño nunca (si cambiara, el scroll rebotaría). Las acciones bajan a una fila propia que se desplaza en horizontal, para que nada desborde en 375 px.
 *
 *   <CabeceraDeModulo
 *     icono={Megaphone} acento="marketing" titulo="Marketing" subtitulo="Campañas y propuestas de todas las cuentas"
 *     migas={[{ texto: 'Cuentas', href: '/dashboard/cuentas' }, { texto: 'Marketing' }]}
 *     acciones={<><Boton …/><Boton variante="primario" …/></>}
 *     debajo={<Pestanas …/>}
 *   />
 */
export interface Miga {
  texto: string
  href?: string
}

export interface CabeceraDeModuloProps {
  icono: LucideIcon
  titulo: ReactNode
  subtitulo?: ReactNode
  acento?: Modulo | string
  acciones?: ReactNode
  migas?: Miga[]
  /** Debajo del título: pestañas, filtros… */
  debajo?: ReactNode
  /** Algo pequeño junto al título (una insignia de «Beta», el número de cuentas…) */
  junto?: ReactNode
  pegajosa?: boolean
  className?: string
}

export function CabeceraDeModulo({ icono: Icono, titulo, subtitulo, acento, acciones, migas, debajo, junto, pegajosa = true, className }: CabeceraDeModuloProps) {
  const color = colorDeAcento(acento)
  const color2 = (acento && ACENTO_2[acento as Modulo]) || color
  const centinela = useRef<HTMLDivElement>(null)
  const [compacta, setCompacta] = useState(false)
  const [montada, setMontada] = useState(false)

  // EN EL MÓVIL, al pasar la cabecera, aparece ENCIMA una barra compacta fija con el icono y el título. La cabecera de verdad NO cambia de tamaño ni se pega:
  // antes era `sticky` y encogía 90 px al pegarse; la página se acortaba, el navegador subía el scroll, se despegaba, volvía a crecer… y no dejaba bajar (15 nov 2026).
  // La barra va por portal al <body> y en `fixed`: no ocupa sitio en la página (nada se mueve) y no depende de los `transform` de los contenedores de la ruta.
  // El centinela está al PIE de la cabecera: la barra sale cuando la cabecera entera ha quedado por encima de la pantalla. Sin escuchar el scroll.
  useEffect(() => {
    setMontada(true)
    if (!pegajosa || !centinela.current || typeof IntersectionObserver === 'undefined') return
    const movil = window.matchMedia('(max-width: 1023px)')
    const obs = new IntersectionObserver(([e]) => setCompacta(!e.isIntersecting && e.boundingClientRect.top < 0 && movil.matches), { threshold: 0 })
    obs.observe(centinela.current)
    return () => obs.disconnect()
  }, [pegajosa])

  return (
    <>
      {pegajosa && montada && createPortal(
        <div
          aria-hidden={!compacta}
          className={cn(
            'cabecera-compacta fixed inset-x-0 top-0 z-40 flex h-[4.25rem] items-center gap-3 border-b border-[var(--ls-linea)] bg-[color-mix(in_srgb,var(--ls-fondo)_95%,transparent)] pl-[4.25rem] pr-4 shadow-[var(--ls-sombra-1)] transition-[transform,opacity] duration-200 lg:hidden motion-reduce:transition-none',
            compacta ? 'translate-y-0 opacity-100' : 'pointer-events-none -translate-y-full opacity-0',
          )}
          style={{ ['--ls-acento' as string]: color }}
        >
          <span
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px]"
            style={{ background: `linear-gradient(140deg, ${mezcla(color, 34)}, ${mezcla(color2, 12)})`, boxShadow: `inset 0 0 0 1px ${mezcla(color, 40)}`, color }}
          >
            <Icono className="h-4 w-4" strokeWidth={2} aria-hidden />
          </span>
          <span className="min-w-0 truncate text-[16px] font-semibold tracking-[-0.02em] text-[var(--ls-t1)]">{titulo}</span>
        </div>,
        document.body,
      )}
      <header
        className={cn('relative mb-5 lg:mb-6', className)}
        style={{ ['--ls-acento' as string]: color }}
      >
        {/* El halo del acento detrás del icono: profundidad sin ruido */}
        {/* Sin `blur` y sin salirse de la caja: el desenfoque pasaba por fuera y el borde de la zona con scroll lo cortaba en seco (una mancha recortada). El degradado
            radial ya se apaga solo antes de su borde */}
        <div aria-hidden className="pointer-events-none absolute -left-4 -top-6 h-44 w-80" style={{ background: `radial-gradient(closest-side, ${mezcla(color, 14)}, transparent)` }} />

        {migas && migas.length > 0 && (
          <nav aria-label="Migas" className="relative mb-2 flex min-w-0 items-center gap-1 text-[12px] text-[var(--ls-t4)]">
            {migas.map((m, i) => (
              <Fragment key={`${m.texto}-${i}`}>
                {i > 0 && <ChevronRight className="h-3 w-3 shrink-0 opacity-60" aria-hidden />}
                {m.href ? (
                  <Link href={m.href} className="truncate rounded-[4px] transition-colors hover:text-[var(--ls-t1)] focus-visible:outline-2 focus-visible:outline-[var(--ls-acc-graf)]">
                    {m.texto}
                  </Link>
                ) : (
                  <span className="truncate text-[var(--ls-t3)]" aria-current={i === migas.length - 1 ? 'page' : undefined}>
                    {m.texto}
                  </span>
                )}
              </Fragment>
            ))}
          </nav>
        )}

        <div className="relative flex flex-wrap items-center gap-x-4 gap-y-3">
          <div className="flex min-w-0 flex-1 items-center gap-3 lg:gap-4">
            <span
              className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] lg:h-11 lg:w-11"
              style={{
                background: `linear-gradient(140deg, ${mezcla(color, 34)}, ${mezcla(color2, 12)})`,
                boxShadow: `inset 0 1px 0 rgba(255,255,255,0.12), inset 0 0 0 1px ${mezcla(color, 40)}, 0 10px 26px -12px ${mezcla(color, 70)}`,
                color,
              }}
            >
              <Icono className="h-5 w-5" strokeWidth={2} aria-hidden />
            </span>
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <h1 className="truncate text-[20px] font-semibold tracking-[-0.025em] text-[var(--ls-t1)] lg:text-[24px]">{titulo}</h1>
                {junto}
              </div>
              {subtitulo && <p className="mt-[2px] line-clamp-2 text-[13px] text-[var(--ls-t3)]">{subtitulo}</p>}
            </div>
          </div>
          {acciones && (
            <div className="ls-sin-barra -mx-4 flex w-[calc(100%+2rem)] items-center gap-2 overflow-x-auto px-4 pb-px sm:mx-0 sm:w-auto sm:overflow-visible sm:px-0">
              {acciones}
            </div>
          )}
        </div>

        {debajo && <div className="relative mt-4">{debajo}</div>}

        {/* La línea de luz de debajo: del acento a nada */}
        {/* Con pestañas debajo no hace falta: ellas ya dibujan su línea */}
        {!debajo && <div aria-hidden className="relative mt-5 h-px w-full" style={{ background: `linear-gradient(90deg, ${mezcla(color, 55)}, ${mezcla(color, 10)} 35%, transparent 80%)` }} />}
      </header>
      {/* El centinela, al pie: cuando sale por arriba, la cabecera ya no se ve y aparece la barra compacta */}
      {pegajosa && <div ref={centinela} aria-hidden className="pointer-events-none -mt-5 mb-5 h-px w-full lg:-mt-6 lg:mb-6" />}
    </>
  )
}
