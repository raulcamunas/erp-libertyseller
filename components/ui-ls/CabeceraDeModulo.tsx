'use client'

import Link from 'next/link'
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ACENTO_2, colorDeAcento, mezcla, type Modulo } from './utilidades'

/**
 * CABECERA DE MÓDULO. La primera pieza de cada pantalla: icono en una baldosa con el degradado del acento del módulo, título, entradilla y las acciones a la derecha.
 * Migas opcionales encima y una ranura `debajo` para las pestañas.
 *
 * EN EL MÓVIL ES PEGAJOSA: al hacer scroll se queda arriba, compacta (sin entradilla) y con hueco a la izquierda para el botón del menú, que flota en esa esquina. Las
 * acciones bajan a una fila propia que se desplaza en horizontal, para que nada desborde en 375 px. En el ordenador no se pega (allí no hay barra arriba).
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
  const [pegada, setPegada] = useState(false)

  // Un centinela de 1 px justo encima: cuando sale de la vista, la cabecera está pegada. Sin escuchar el scroll.
  useEffect(() => {
    if (!pegajosa || !centinela.current || typeof IntersectionObserver === 'undefined') return
    // Solo por debajo de lg: en el ordenador la cabecera no se pega y no debe cambiar de forma al hacer scroll
    const movil = window.matchMedia('(max-width: 1023px)')
    const obs = new IntersectionObserver(([e]) => setPegada(!e.isIntersecting && movil.matches), { threshold: 0 })
    obs.observe(centinela.current)
    return () => obs.disconnect()
  }, [pegajosa])

  return (
    <>
      {pegajosa && <div ref={centinela} aria-hidden className="-mt-px h-px w-full" />}
      <header
        className={cn(
          'relative mb-5 lg:mb-6',
          pegajosa && 'sticky top-0 z-20 -mx-4 px-4 lg:static lg:mx-0 lg:px-0',
          pegajosa && pegada && 'border-b border-[var(--ls-linea)] bg-[color-mix(in_srgb,var(--ls-fondo)_86%,transparent)] py-2 pl-[3.9rem] shadow-[var(--ls-sombra-1)] backdrop-blur-xl lg:border-0 lg:bg-transparent lg:py-0 lg:pl-0 lg:shadow-none lg:backdrop-blur-none',
          className,
        )}
        style={{ ['--ls-acento' as string]: color }}
      >
        {/* El halo del acento detrás del icono: profundidad sin ruido */}
        <div aria-hidden className={cn('pointer-events-none absolute -left-10 -top-16 h-48 w-72 rounded-full blur-3xl transition-opacity', pegada && 'opacity-0 lg:opacity-100')} style={{ background: `radial-gradient(closest-side, ${mezcla(color, 16)}, transparent)` }} />

        {migas && migas.length > 0 && (
          <nav aria-label="Migas" className={cn('relative mb-2 flex min-w-0 items-center gap-1 text-[12px] text-[var(--ls-t4)]', pegada && 'hidden lg:flex')}>
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
              className={cn('relative flex shrink-0 items-center justify-center rounded-[12px] transition-all', pegada ? 'h-8 w-8 lg:h-11 lg:w-11' : 'h-10 w-10 lg:h-11 lg:w-11')}
              style={{
                background: `linear-gradient(140deg, ${mezcla(color, 34)}, ${mezcla(color2, 12)})`,
                boxShadow: `inset 0 1px 0 rgba(255,255,255,0.12), inset 0 0 0 1px ${mezcla(color, 40)}, 0 10px 26px -12px ${mezcla(color, 70)}`,
                color,
              }}
            >
              <Icono className={pegada ? 'h-4 w-4 lg:h-5 lg:w-5' : 'h-5 w-5'} strokeWidth={2} aria-hidden />
            </span>
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <h1 className={cn('truncate font-semibold tracking-[-0.025em] text-[var(--ls-t1)]', pegada ? 'text-[16px] lg:text-[24px]' : 'text-[20px] lg:text-[24px]')}>{titulo}</h1>
                {junto}
              </div>
              {subtitulo && <p className={cn('mt-[2px] line-clamp-2 text-[13px] text-[var(--ls-t3)]', pegada && 'hidden lg:block')}>{subtitulo}</p>}
            </div>
          </div>
          {acciones && (
            <div className={cn('ls-sin-barra -mx-4 flex w-[calc(100%+2rem)] items-center gap-2 overflow-x-auto px-4 pb-px sm:mx-0 sm:w-auto sm:overflow-visible sm:px-0', pegada && 'hidden sm:flex')}>
              {acciones}
            </div>
          )}
        </div>

        {debajo && <div className={cn('relative mt-4', pegada && 'mt-2 lg:mt-4')}>{debajo}</div>}

        {/* La línea de luz de debajo: del acento a nada */}
        {/* Con pestañas debajo no hace falta: ellas ya dibujan su línea */}
        {!pegada && !debajo && <div aria-hidden className="relative mt-5 h-px w-full" style={{ background: `linear-gradient(90deg, ${mezcla(color, 55)}, ${mezcla(color, 10)} 35%, transparent 80%)` }} />}
      </header>
    </>
  )
}
