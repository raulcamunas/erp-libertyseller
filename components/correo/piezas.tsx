'use client'

import * as Menu from '@radix-ui/react-dropdown-menu'
import { motion, useReducedMotion } from 'framer-motion'
import { AlertTriangle, Bell, BellOff, BellRing, Bot, CalendarDays, Check, Clock, Infinity as Siempre, Moon } from 'lucide-react'
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { iniciales, mezcla, tonoEstable } from '@/components/ui-ls/utilidades'
import { COLOR_ESTADO } from '@/lib/estilo/denso'
import { colorDeBuzon } from '@/lib/correo/marcas'
import type { Duracion } from '@/lib/correo/tipos'
import { cn } from '@/lib/utils'

/**
 * PIEZAS VISUALES DE CORREO: lo pequeño que se repite en la barra, la lista, el hilo y los ajustes.
 *
 * - `AvatarDeRemitente`: iniciales con color estable por la DIRECCIÓN (la misma persona sale igual aunque firme distinto);
 *   un robot si el hilo es automático, un triángulo ámbar si es un rebote, y el minipunto del buzón en la bandeja unificada.
 * - `PuntoDeBuzon`: el punto de color del buzón (`colorDeBuzon`).
 * - `Kbd`: una tecla en los tooltips y en la chuleta de atajos.
 * - `InsigniaSilenciado`: la campana tachada de lo silenciado.
 * - `MenuDeSilencio`: el menú de 8 h · mañana 8:00 · 1 semana · siempre (y «Quitar silencio»). Radix: teclado, foco y portal.
 * - `FilaEsqueleto` / `FilasEsqueleto`: la forma de una fila mientras carga.
 *
 * Solo tokens `--ls-*` y `--viz-*`. Las animaciones respetan «reducir movimiento».
 */

/* ------------------------------------------------------------------ */
/* Lógica pura (con prueba en piezas.prueba.ts)                        */
/* ------------------------------------------------------------------ */

/** Las duraciones en el orden en que salen en el menú */
export const DURACIONES: readonly Duracion[] = ['8h', 'manana', 'semana', 'siempre']

export const ETIQUETA_DE_DURACION: Record<Duracion, string> = {
  '8h': '8 horas',
  manana: 'Hasta mañana a las 8:00',
  semana: '1 semana',
  siempre: 'Siempre',
}

const ZONA = 'Europe/Madrid'

/** Día del calendario (en la zona dada) como número comparable: 2026-11-16 → 20261116 */
function diaDe(fecha: Date, zona: string): number {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: zona, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(fecha)
  const v = (t: string) => p.find((x) => x.type === t)?.value ?? '0'
  return Number(`${v('year')}${v('month')}${v('day')}`)
}

/** Días de calendario entre dos fechas (en la zona dada), sin líos con el cambio de hora */
function diasEntre(desde: Date, hasta: Date, zona: string): number {
  const aUtc = (n: number) => Date.UTC(Math.floor(n / 10000), Math.floor((n % 10000) / 100) - 1, n % 100)
  return Math.round((aUtc(diaDe(hasta, zona)) - aUtc(diaDe(desde, zona))) / 86_400_000)
}

/**
 * Cómo se cuenta un silencio, en una frase corta.
 *   no silenciado → «Sin silenciar» · null → «Silenciado para siempre» · hoy → «Silenciado hasta las 16:30»
 *   mañana → «Silenciado hasta mañana a las 8:00» · esta semana → «Silenciado hasta el lunes a las 9:00» · más → «Silenciado hasta el 30 nov»
 */
export function textoDeSilencio(silenciado: boolean, hasta: string | null | undefined, ahora: number = Date.now(), zona: string = ZONA): string {
  if (!silenciado) return 'Sin silenciar'
  if (!hasta) return 'Silenciado para siempre'
  const fin = new Date(hasta)
  if (Number.isNaN(fin.getTime())) return 'Silenciado'
  const hora = new Intl.DateTimeFormat('es-ES', { timeZone: zona, hour: 'numeric', minute: '2-digit' }).format(fin)
  const dias = diasEntre(new Date(ahora), fin, zona)
  if (dias <= 0) return `Silenciado hasta las ${hora}`
  if (dias === 1) return `Silenciado hasta mañana a las ${hora}`
  if (dias < 7) {
    const dia = new Intl.DateTimeFormat('es-ES', { timeZone: zona, weekday: 'long' }).format(fin)
    return `Silenciado hasta el ${dia} a las ${hora}`
  }
  const fecha = new Intl.DateTimeFormat('es-ES', { timeZone: zona, day: 'numeric', month: 'short' }).format(fin).replace('.', '')
  return `Silenciado hasta el ${fecha}`
}

/* ------------------------------------------------------------------ */
/* Avatar del remitente                                                */
/* ------------------------------------------------------------------ */

export interface AvatarDeRemitenteProps {
  /** Nombre de la contraparte (si no hay, se sacan las iniciales de la dirección) */
  nombre: string | null | undefined
  /** Dirección de la contraparte: de aquí sale el color, para que sea estable */
  direccion: string | null | undefined
  /** Hilo automático (newsletter, notificación): robot sobre --ls-sup2 */
  automatico?: boolean
  /** Rebote: triángulo ámbar. Manda sobre `automatico` */
  rebote?: boolean
  /** Color del buzón (de `colorDeBuzon`): minipunto de 10 px abajo a la derecha, para la bandeja unificada */
  buzonColor?: string | null
  /** Lado en px (36 por defecto) */
  tamano?: number
  className?: string
}

export function AvatarDeRemitente({ nombre, direccion, automatico, rebote, buzonColor, tamano = 36, className }: AvatarDeRemitenteProps) {
  const quien = (nombre ?? '').trim() || (direccion ?? '').trim() || null
  const icono = Math.round(tamano * 0.46)
  let cara: ReactNode
  let estilo: CSSProperties
  let etiqueta: string

  if (rebote) {
    estilo = { background: mezcla('var(--ls-e-ambar)', 16), boxShadow: `inset 0 0 0 1px ${mezcla('var(--ls-e-ambar)', 36)}`, color: 'var(--ls-e-ambar)' }
    cara = <AlertTriangle aria-hidden style={{ width: icono, height: icono }} />
    etiqueta = 'Correo no entregado'
  } else if (automatico) {
    estilo = { background: 'var(--ls-sup2)', boxShadow: 'inset 0 0 0 1px var(--ls-linea)', color: 'var(--ls-t3)' }
    cara = <Bot aria-hidden style={{ width: icono, height: icono }} />
    etiqueta = `Automático${quien ? `: ${quien}` : ''}`
  } else {
    // El mismo dibujo que el Avatar del kit, pero con el color por la dirección (el kit lo saca del nombre)
    const color = COLOR_ESTADO[tonoEstable((direccion ?? '').trim() || quien)]
    estilo = {
      color,
      background: `linear-gradient(140deg, ${mezcla(color, 26)}, ${mezcla(color, 10)})`,
      boxShadow: `inset 0 0 0 1px ${mezcla(color, 34)}`,
      fontSize: Math.max(10, Math.round(tamano * 0.38)),
    }
    cara = iniciales(quien)
    etiqueta = quien ?? 'Sin nombre'
  }

  return (
    <span
      role="img"
      aria-label={etiqueta}
      title={direccion && direccion !== quien ? `${quien ?? ''} <${direccion}>`.trim() : (quien ?? undefined)}
      className={cn('relative inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold tracking-[-0.01em]', className)}
      style={{ width: tamano, height: tamano, ...estilo }}
    >
      {cara}
      {buzonColor && (
        <span
          aria-hidden
          className="absolute -bottom-0.5 -right-0.5 h-[10px] w-[10px] rounded-full ring-2 ring-[var(--ls-sup)]"
          style={{ background: buzonColor }}
        />
      )}
    </span>
  )
}

/* ------------------------------------------------------------------ */
/* Punto de buzón, tecla e insignia de silencio                        */
/* ------------------------------------------------------------------ */

/** El punto de color de un buzón (8 px por defecto). Decorativo: el nombre del buzón va al lado en texto */
export function PuntoDeBuzon({ direccion, tamano = 8, className }: { direccion: string | null | undefined; tamano?: number; className?: string }) {
  const color = colorDeBuzon(direccion)
  return (
    <span
      aria-hidden
      className={cn('inline-block shrink-0 rounded-full', className)}
      style={{ width: tamano, height: tamano, background: color, boxShadow: `0 0 0 3px ${mezcla(color, 16)}` }}
    />
  )
}

/** Una tecla: `<Kbd>j</Kbd>`, `<Kbd>⌘</Kbd><Kbd>↵</Kbd>` */
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        'inline-flex h-[20px] min-w-[20px] items-center justify-center rounded-[5px] border border-[var(--ls-linea2)] bg-[var(--ls-sup2)] px-1',
        'font-mono text-[11px] font-medium leading-none text-[var(--ls-t2)] shadow-[inset_0_-1px_0_var(--ls-linea2)]',
        className,
      )}
    >
      {children}
    </kbd>
  )
}

/** La campana tachada de lo silenciado. Con `texto` sale también la palabra (en la cabecera del hilo, en Ajustes) */
export function InsigniaSilenciado({
  hasta,
  texto = false,
  ahora,
  className,
}: {
  /** Hasta cuándo (null = siempre); solo para el título al pasar el ratón */
  hasta?: string | null
  texto?: boolean
  ahora?: number
  className?: string
}) {
  const frase = textoDeSilencio(true, hasta ?? null, ahora)
  if (!texto) {
    return (
      <span role="img" aria-label={frase} title={frase} className={cn('inline-flex shrink-0 items-center text-[var(--ls-t4)]', className)}>
        <BellOff className="h-3.5 w-3.5" aria-hidden />
      </span>
    )
  }
  return (
    <span
      title={frase}
      className={cn(
        'inline-flex h-[20px] shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-[var(--ls-sup3)] px-2 text-[11px] font-medium text-[var(--ls-t3)]',
        className,
      )}
    >
      <BellOff className="h-3 w-3" aria-hidden />
      Silenciado
    </span>
  )
}

/* ------------------------------------------------------------------ */
/* Menú de silencio                                                    */
/* ------------------------------------------------------------------ */

const ICONO_DE_DURACION: Record<Duracion, typeof Clock> = { '8h': Clock, manana: Moon, semana: CalendarDays, siempre: Siempre }

const FOCO =
  'outline-none focus-visible:ring-2 focus-visible:ring-[var(--ls-acc-graf)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--ls-fondo)]'

const OPCION =
  'flex min-h-11 cursor-pointer select-none items-center gap-2.5 rounded-[8px] px-2.5 text-[14px] text-[var(--ls-t1)] outline-none ' +
  'data-[highlighted]:bg-[var(--ls-sup3)] data-[disabled]:pointer-events-none data-[disabled]:opacity-40 lg:min-h-9 lg:text-[13px]'

export interface MenuDeSilencioProps {
  /** Silenciado AHORA para quien mira */
  silenciado: boolean
  /** Hasta cuándo (null = siempre) */
  hasta: string | null
  onElegir: (eleccion: Duracion | 'quitar') => void
  /** Qué se silencia, para el título del menú y el nombre accesible: «este hilo», «a ana@tienda.com», «este buzón» */
  que?: string
  /** Deshabilita el botón (por ejemplo, mientras se guarda o si falta la migración 318) */
  disabled?: boolean
  /** Botón propio en lugar de la campana (con `asChild`): un elemento que acepte ref y props */
  disparador?: ReactNode
  /** Lado del menú respecto al botón */
  lado?: 'top' | 'right' | 'bottom' | 'left'
  alinear?: 'start' | 'center' | 'end'
  className?: string
}

export function MenuDeSilencio({
  silenciado,
  hasta,
  onElegir,
  que = 'esto',
  disabled,
  disparador,
  lado = 'bottom',
  alinear = 'end',
  className,
}: MenuDeSilencioProps) {
  const reducir = useReducedMotion()
  // La campana tiembla una vez cuando pasa a silenciado (no al montar)
  const [temblor, setTemblor] = useState(0)
  const antes = useRef(silenciado)
  useEffect(() => {
    if (silenciado && !antes.current) setTemblor((n) => n + 1)
    antes.current = silenciado
  }, [silenciado])

  const frase = textoDeSilencio(silenciado, hasta)
  const etiqueta = silenciado ? `Silencio de ${que}: ${frase.toLowerCase()}` : `Silenciar ${que}`

  return (
    <Menu.Root modal={false}>
      <Menu.Trigger asChild disabled={disabled}>
        {disparador ?? (
          <button
            type="button"
            aria-label={etiqueta}
            title={silenciado ? frase : `Silenciar ${que}`}
            className={cn(
              'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] transition-colors hover:bg-[var(--ls-sup3)] hover:text-[var(--ls-t1)]',
              'disabled:cursor-not-allowed disabled:opacity-40 data-[state=open]:bg-[var(--ls-sup3)] lg:h-8 lg:w-8',
              silenciado ? 'text-[var(--ls-t2)]' : 'text-[var(--ls-t3)]',
              FOCO,
              className,
            )}
          >
            <motion.span
              key={temblor}
              className="inline-flex"
              initial={false}
              animate={temblor && !reducir ? { rotate: [0, -12, 12, -8, 0] } : { rotate: 0 }}
              transition={{ duration: 0.3, ease: 'easeInOut' }}
            >
              {silenciado ? <BellOff className="h-4 w-4" aria-hidden /> : <Bell className="h-4 w-4" aria-hidden />}
            </motion.span>
          </button>
        )}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          side={lado}
          align={alinear}
          sideOffset={6}
          collisionPadding={16}
          className={cn(
            'z-[80] w-[min(calc(100vw-32px),264px)] rounded-[14px] border border-[var(--ls-linea2)] bg-[var(--ls-sup)] p-1.5 shadow-[var(--ls-sombra-3)]',
            'motion-safe:data-[state=open]:animate-in motion-safe:data-[state=open]:fade-in-0 motion-safe:data-[state=open]:zoom-in-95',
          )}
        >
          <Menu.Label className="px-2.5 pb-1 pt-1.5">
            <span className="block text-[11px] font-semibold uppercase tracking-wide text-[var(--ls-t3)]">
              {silenciado ? 'Silenciado' : 'Silenciar'} {que}
            </span>
            <span className="mt-0.5 block text-[12px] leading-snug text-[var(--ls-t4)]">
              {silenciado ? frase : 'No avisa ni suma en el número. Sigue a la vista, atenuado.'}
            </span>
          </Menu.Label>
          <Menu.Separator className="my-1 h-px bg-[var(--ls-linea)]" />
          {DURACIONES.map((d) => {
            const Icono = ICONO_DE_DURACION[d]
            return (
              <Menu.Item key={d} className={OPCION} onSelect={() => onElegir(d)}>
                <Icono className="h-4 w-4 shrink-0 text-[var(--ls-t3)]" aria-hidden />
                <span className="flex-1">{ETIQUETA_DE_DURACION[d]}</span>
                {silenciado && d === 'siempre' && !hasta && <Check className="h-4 w-4 text-[var(--ls-acc)]" aria-label="Actual" />}
              </Menu.Item>
            )
          })}
          {silenciado && (
            <>
              <Menu.Separator className="my-1 h-px bg-[var(--ls-linea)]" />
              <Menu.Item className={cn(OPCION, 'font-medium')} onSelect={() => onElegir('quitar')}>
                <BellRing className="h-4 w-4 shrink-0 text-[var(--ls-acc)]" aria-hidden />
                <span className="flex-1">Quitar silencio</span>
              </Menu.Item>
            </>
          )}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  )
}

/* ------------------------------------------------------------------ */
/* Esqueletos                                                          */
/* ------------------------------------------------------------------ */

/** La forma de una fila de la lista mientras carga: avatar redondo, remitente, asunto y fecha */
export function FilaEsqueleto({ indice = 0, className }: { indice?: number; className?: string }) {
  // Anchos que varían un poco por fila para que no parezca una rejilla
  const anchos = [
    ['w-2/5', 'w-4/5'],
    ['w-1/3', 'w-3/5'],
    ['w-1/2', 'w-2/3'],
  ][indice % 3]
  return (
    <div aria-hidden className={cn('flex items-start gap-3 rounded-[10px] px-3 py-3', className)}>
      <div className="ls-esqueleto h-9 w-9 shrink-0 rounded-full" />
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="flex items-center gap-3">
          <div className={cn('ls-esqueleto h-[12px] rounded-[6px]', anchos[0])} />
          <div className="ls-esqueleto ml-auto h-[10px] w-10 shrink-0 rounded-[6px]" />
        </div>
        <div className={cn('ls-esqueleto mt-2 h-[10px] rounded-[6px]', anchos[1])} />
        <div className="ls-esqueleto mt-1.5 h-[10px] w-11/12 rounded-[6px] opacity-60" />
      </div>
    </div>
  )
}

/** Varias filas de carga, con su anuncio para lectores de pantalla */
export function FilasEsqueleto({ cuantas = 8, className }: { cuantas?: number; className?: string }) {
  return (
    <div role="status" aria-label="Cargando correos" className={cn('flex flex-col', className)}>
      {Array.from({ length: cuantas }, (_, i) => (
        <FilaEsqueleto key={i} indice={i} />
      ))}
    </div>
  )
}
