'use client'

import { Minus, TrendingDown, TrendingUp } from 'lucide-react'
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { Variacion } from '@/lib/rendimiento/comparativa'
import { COLOR_ESTADO } from '@/lib/estilo/denso'

/**
 * LAS PIEZAS COMUNES DE «MI RENDIMIENTO»: panel, cifra que cuenta, cambio, barritas, esqueleto.
 *
 * Todo el módulo se pinta con los tokens de superficie, texto y estado del ERP (`--ls-*`, ver lib/estilo/denso.ts y
 * app/globals.css), así que se ve igual en el tema oscuro y en el claro y no hay colores sueltos. Los radios van en
 * valor arbitrario (6 · 10 px) porque en este repositorio `rounded-lg` son 24 px.
 *
 * EL MOVIMIENTO es CSS (las clases `rend-*` de app/globals.css) más una sola cosa de JavaScript: la cifra que cuenta
 * desde su valor anterior hasta el nuevo. Nada se anima si el sistema pide «reducir movimiento».
 */

/* ------------------------------------------------------------------ */
/* Estilos                                                             */
/* ------------------------------------------------------------------ */

/** La tarjeta del módulo: superficie opaca, filo fino y 10 px de radio */
export const PANEL = 'min-w-0 rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup)]'
/** La cabecera de un panel: una fila de 36 px que, si no cabe, baja a dos */
export const CABECERA_DE_PANEL = 'flex min-h-9 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-[var(--ls-linea)] px-3 py-1.5'
export const TITULO_DE_PANEL = 'flex items-center gap-2 text-[12.5px] font-semibold tracking-[-0.006em] text-[var(--ls-t1)]'
export const NOTA_DE_PANEL = 'text-[11px] text-[var(--ls-t4)]'

/* ------------------------------------------------------------------ */
/* La cifra que cuenta                                                 */
/* ------------------------------------------------------------------ */

const sinMovimiento = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * Lleva un número de su valor anterior al nuevo en `ms` milisegundos, frenando al final. La primera vez parte del
 * propio valor (no anima: servidor y navegador pintan lo mismo); cuando llegan los datos, o cambia el periodo, sí.
 */
export function useNumeroAnimado(objetivo: number, ms = 650): number {
  const [mostrado, setMostrado] = useState(objetivo)
  const desde = useRef(objetivo)

  useEffect(() => {
    if (desde.current === objetivo) return
    if (ms <= 0 || sinMovimiento()) {
      desde.current = objetivo
      setMostrado(objetivo)
      return
    }
    const origen = desde.current
    const inicio = performance.now()
    let cuadro = 0
    const paso = (t: number) => {
      const p = Math.min(1, (t - inicio) / ms)
      const v = p >= 1 ? objetivo : origen + (objetivo - origen) * (1 - Math.pow(1 - p, 3))
      desde.current = v
      setMostrado(v)
      if (p < 1) cuadro = requestAnimationFrame(paso)
    }
    cuadro = requestAnimationFrame(paso)
    return () => cancelAnimationFrame(cuadro)
  }, [objetivo, ms])

  return mostrado
}

const enteros = (n: number) => Math.round(n).toLocaleString('es-ES')

/** Un número que cuenta hasta su valor. `formato` recibe el valor intermedio (p. ej. segundos → «1 h 05 min») */
export function Numero({ valor, formato = enteros, ms = 650 }: { valor: number; formato?: (n: number) => string; ms?: number }) {
  const v = useNumeroAnimado(valor, ms)
  return <>{formato(v)}</>
}

/* ------------------------------------------------------------------ */
/* Entrada escalonada y esqueletos                                     */
/* ------------------------------------------------------------------ */

/** Hace entrar a su contenido con un ligero ascenso; `i` es el escalón (0, 1, 2…) y cada uno llega 45 ms después */
export function Revelar({ i = 0, className = '', children }: { i?: number; className?: string; children: ReactNode }) {
  return (
    <div className={`rend-aparece ${className}`} style={{ '--d': i } as CSSProperties}>
      {children}
    </div>
  )
}

/** Un hueco con brillo que pasa por encima: lo que se enseña mientras llegan los datos */
export function Esqueleto({ className = '' }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`rend-brillo block rounded-[6px] bg-[linear-gradient(90deg,var(--ls-sup2)_0%,var(--ls-sup3)_50%,var(--ls-sup2)_100%)] ${className}`}
    />
  )
}

/** La rayita que recorre el borde de abajo mientras se leen datos nuevos */
export function BarraDeCarga({ activa }: { activa: boolean }) {
  return (
    <span aria-hidden className={`pointer-events-none absolute inset-x-0 bottom-0 h-[2px] overflow-hidden transition-opacity duration-300 ${activa ? 'opacity-100' : 'opacity-0'}`}>
      <span className="rend-carga block h-full w-2/5 rounded-full bg-[var(--ls-acc-graf)]" />
    </span>
  )
}

/* ------------------------------------------------------------------ */
/* El cambio frente a la referencia                                    */
/* ------------------------------------------------------------------ */

/**
 * Lo que ha cambiado una cifra, en una píldora: forma (flecha), palabra (+12 %) y por último color. Verde si sube,
 * rojo si baja y gris si es lo de siempre; en estas cifras más es siempre mejor. Sin referencia se dice, no se inventa.
 */
export function Delta({ v, contra }: { v: Variacion | null; contra: string }) {
  if (!v) return null
  if (v.sentido === 'sinBase') {
    return (
      <span title={`Sin referencia: no hay actividad con la que comparar (${contra})`} className="whitespace-nowrap text-[10.5px] text-[var(--ls-t4)]">
        sin referencia
      </span>
    )
  }
  const color = v.sentido === 'sube' ? COLOR_ESTADO.verde : v.sentido === 'baja' ? COLOR_ESTADO.rojo : COLOR_ESTADO.gris
  const Icono = v.sentido === 'sube' ? TrendingUp : v.sentido === 'baja' ? TrendingDown : Minus
  return (
    <span
      title={`Comparado con ${contra}`}
      className="inline-flex h-[18px] items-center gap-[3px] whitespace-nowrap rounded-[5px] px-1.5 text-[10.5px] font-semibold tabular-nums"
      style={{ color, background: `color-mix(in srgb, ${color} ${v.sentido === 'igual' ? 10 : 15}%, transparent)` }}
    >
      <Icono className="h-2.5 w-2.5" aria-hidden /> {v.texto}
    </span>
  )
}

/* ------------------------------------------------------------------ */
/* Iconos y cabeceras                                                  */
/* ------------------------------------------------------------------ */

/** El icono de una cifra o de un panel, en una cajita con el naranja de marca en suave */
export function IconoEnCaja({ children, tono = 'acento' }: { children: ReactNode; tono?: 'acento' | 'neutro' }) {
  return (
    <span
      className={`inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[6px] ${
        tono === 'acento' ? 'bg-[var(--ls-acc-suave)] text-[var(--ls-acc)]' : 'bg-[var(--ls-sup3)] text-[var(--ls-t3)]'
      }`}
    >
      {children}
    </span>
  )
}

interface PropsDeCabecera {
  icono?: ReactNode
  titulo: ReactNode
  /** Contexto pequeño junto al título («· Hoy, jueves 22 de octubre») */
  contexto?: ReactNode
  /** Lo que va a la derecha: una nota, un chip, un indicador de carga */
  derecha?: ReactNode
}

/** La cabecera de un panel: icono + título + contexto a la izquierda, y lo que haga falta a la derecha */
export function CabeceraDePanel({ icono, titulo, contexto, derecha }: PropsDeCabecera) {
  return (
    <div className={CABECERA_DE_PANEL}>
      <h2 className={TITULO_DE_PANEL}>
        {icono && <span className="text-[var(--ls-acc)]">{icono}</span>}
        {titulo}
        {contexto && <span className="font-normal text-[var(--ls-t4)]">{contexto}</span>}
      </h2>
      {derecha && <div className="flex min-w-0 items-center gap-2">{derecha}</div>}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Avatar                                                              */
/* ------------------------------------------------------------------ */

/** Cada persona, su color: siempre el mismo, sale de su id */
const PALETA_DE_PERSONAS = [COLOR_ESTADO.azul, COLOR_ESTADO.violeta, COLOR_ESTADO.cian, COLOR_ESTADO.verde, COLOR_ESTADO.ambar, COLOR_ESTADO.magenta, COLOR_ESTADO.naranja] as const

export function colorDePersona(id: string): string {
  let h = 0
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return PALETA_DE_PERSONAS[h % PALETA_DE_PERSONAS.length]
}

const inicialesDe = (nombre: string) =>
  nombre
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('')

/** Las iniciales de una persona en un círculo de su color */
export function Avatar({ id, nombre, tamano = 22 }: { id: string; nombre: string; tamano?: number }) {
  const color = colorDePersona(id)
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold"
      style={{ width: tamano, height: tamano, fontSize: Math.round(tamano * 0.45), color, background: `color-mix(in srgb, ${color} 18%, transparent)` }}
    >
      {inicialesDe(nombre)}
    </span>
  )
}

/* ------------------------------------------------------------------ */
/* Chips de filtro                                                     */
/* ------------------------------------------------------------------ */

/** El botón de filtro de las listas: apagado, encendido (naranja suave y filo naranja) o sin nada que filtrar */
export function ChipDeFiltro({ activo, deshabilitado = false, onClick, children, ayuda }: { activo: boolean; deshabilitado?: boolean; onClick: () => void; children: ReactNode; ayuda?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={activo}
      title={ayuda}
      disabled={deshabilitado}
      className={`inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-[6px] border px-2 text-[11.5px] transition-colors disabled:opacity-35 ${
        activo
          ? 'border-[var(--ls-acc-graf)] bg-[var(--ls-acc-suave)] text-[var(--ls-t1)]'
          : 'border-[var(--ls-linea)] bg-[var(--ls-sup)] text-[var(--ls-t3)] hover:bg-[var(--ls-sup3)] hover:text-[var(--ls-t1)]'
      }`}
    >
      {children}
    </button>
  )
}

/* ------------------------------------------------------------------ */
/* Barritas de siete días                                              */
/* ------------------------------------------------------------------ */

interface PropsDeBarras {
  valores: ReadonlyArray<number | null>
  /** Los mismos días de la semana anterior, al lado, apagados. Solo en el informe */
  anteriores?: ReadonlyArray<number | null>
  /** Qué barra va en naranja: por defecto, la última que tenga valor */
  resaltar?: number
  /** Cómo se escribe un valor, para el texto que sale al pasar el ratón */
  formato?: (n: number) => string
  /** Alto de la zona de barras, en píxeles */
  alto?: number
  /** Qué se dibuja, para los lectores de pantalla: «llamadas» */
  nombre: string
  /** Etiqueta de cada barra para el texto de ayuda («lun 19») */
  etiquetas?: ReadonlyArray<string>
}

/**
 * Una barrita por día. Todas comparten escala (la del valor mayor de las dos series) y crecen desde su base. Un día
 * que no tiene valor (todavía no ha llegado) es un hueco punteado, no un cero.
 */
export function MiniBarras({ valores, anteriores, resaltar, formato = enteros, alto = 24, nombre, etiquetas }: PropsDeBarras) {
  const maximo = Math.max(1, ...valores.map((v) => v ?? 0), ...(anteriores ?? []).map((v) => v ?? 0))
  const px = (v: number | null | undefined) => (v === null || v === undefined || v <= 0 ? 0 : Math.max(2, Math.round((v / maximo) * alto)))
  // Con una sola serie va en naranja la barra del último día; con dos (esta semana y la anterior) van en naranja todas las de esta semana
  const ultimoConValor = anteriores ? -2 : (resaltar ?? valores.reduce<number>((u, v, i) => (v !== null ? i : u), -1))
  const resumen = valores.map((v, i) => `${etiquetas?.[i] ?? i + 1}: ${v === null ? 'todavía no ha llegado' : formato(v)}`).join('. ')

  return (
    <div role="img" aria-label={`${nombre}, día a día. ${resumen}`} title={resumen} className="flex shrink-0 items-end gap-[3px]" style={{ height: alto }}>
      {valores.map((v, i) => (
        <span key={i} className="flex items-end gap-px" style={{ height: alto }}>
          {anteriores && <span className="block w-[3px] rounded-t-[2px] bg-[var(--ls-linea2)]" style={{ height: px(anteriores[i]) }} />}
          {v === null ? (
            <span className="block w-[5px] rounded-t-[2px] border border-dashed border-[var(--ls-linea2)]" style={{ height: 5 }} />
          ) : (
            <span
              className={`rend-crece-y block w-[5px] rounded-t-[2px] transition-[height,background-color] duration-500 ${i === ultimoConValor || anteriores ? 'bg-[var(--ls-acc-graf)]' : 'bg-[color-mix(in_srgb,var(--ls-t4)_55%,transparent)]'}`}
              style={{ height: px(v), '--d': i } as CSSProperties}
            />
          )}
        </span>
      ))}
    </div>
  )
}
