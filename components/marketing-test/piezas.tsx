'use client'

import { ArrowDownRight, ArrowUpRight, Minus, RefreshCw } from 'lucide-react'
import { BOTON, COLOR_ESTADO, TEXTO, TIPO } from '@/lib/estilo/denso'
import { variacion } from '@/lib/ads/rendimiento-calculo'
import { haceCuanto } from './formato'

/** Las piezas visuales compartidas por las pestañas de Marketing Test */

/**
 * LAS CAJAS DE MARKETING TEST. Más aire y esquinas más redondas que la tarjeta densa del resto del ERP (lib/estilo/denso.ts): aquí se lee un panel de cifras, no una tabla de cientos de filas, y el
 * espacio ayuda a separar un bloque de otro sin tener que poner más líneas.
 */
export const CAJA = {
  base: 'min-w-0 overflow-hidden rounded-[14px] border border-[var(--ls-linea)] bg-[var(--ls-sup)]',
  cabecera: 'flex min-h-[46px] items-center gap-2 border-b border-[var(--ls-linea)] px-4 py-2',
  cuerpo: 'px-4 py-[14px]',
} as const

export type Dias = 7 | 14 | 30

/**
 * UN CONTROL SEGMENTADO: varias opciones excluyentes dentro de una sola pieza (como el selector de fechas de la consola de Amazon Ads). Se lee de un vistazo cuál está elegida y no compite con los
 * botones de acción, que es lo que pasaba con una fila de chips sueltos.
 */
export function Segmentado<T extends string | number>({ opciones, valor, cambiar, etiqueta }: { opciones: ReadonlyArray<{ id: T; texto: string; cuenta?: number }>; valor: T; cambiar: (v: T) => void; etiqueta: string }) {
  return (
    <div role="radiogroup" aria-label={etiqueta} className="inline-flex shrink-0 items-center rounded-[9px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] p-[2px]">
      {opciones.map((o) => {
        const activo = o.id === valor
        return (
          <button
            key={String(o.id)}
            type="button"
            role="radio"
            aria-checked={activo}
            onClick={() => cambiar(o.id)}
            className={`inline-flex h-[26px] items-center gap-[6px] whitespace-nowrap rounded-[7px] px-[10px] text-[12px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ls-acc-graf)] ${
              activo ? 'bg-[var(--ls-sup)] text-[var(--ls-t1)] shadow-[0_1px_2px_rgba(0,0,0,0.25)] ring-1 ring-[var(--ls-linea2)]' : 'text-[var(--ls-t3)] hover:text-[var(--ls-t1)]'
            }`}
          >
            {o.texto}
            {o.cuenta != null && <span className={`tabular-nums text-[11px] ${activo ? 'text-[var(--ls-acc)]' : 'text-[var(--ls-t4)]'}`}>{o.cuenta}</span>}
          </button>
        )
      })}
    </div>
  )
}

/** El periodo (7, 14 o 30 días), el botón de actualizar y de cuándo son los datos */
export function SelectorDePeriodo({ dias, cambiar, en, actualizar, cargando }: { dias: Dias; cambiar: (d: Dias) => void; en?: number; actualizar: () => void; cargando: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Segmentado
        etiqueta="Periodo"
        opciones={[
          { id: 7, texto: '7 días' },
          { id: 14, texto: '14 días' },
          { id: 30, texto: '30 días' },
        ]}
        valor={dias}
        cambiar={(d) => cambiar(d as Dias)}
      />
      <button type="button" onClick={actualizar} disabled={cargando} title="Volver a pedirle los datos a Amazon" className="inline-flex h-[30px] items-center gap-[6px] rounded-[9px] px-[10px] text-[12px] font-medium text-[var(--ls-t2)] transition-colors hover:bg-[var(--ls-sup2)] hover:text-[var(--ls-t1)] disabled:opacity-50">
        <RefreshCw className={`h-[13px] w-[13px] ${cargando ? 'animate-spin' : ''}`} /> Actualizar
      </button>
      {(en || cargando) && (
        <span className={`inline-flex items-center gap-[6px] ${TIPO.xs} ${TEXTO.t4}`}>
          <span className={`h-[6px] w-[6px] rounded-full ${cargando ? 'animate-pulse' : ''}`} style={{ background: cargando ? COLOR_ESTADO.ambar : COLOR_ESTADO.verde }} />
          {cargando ? 'Actualizando…' : `Datos ${haceCuanto(en as number)}`}
        </span>
      )}
    </div>
  )
}

/** Una tira de cifras con separadores, como la de arriba de la consola de Amazon Ads */
export function TiraDeCifras({ cifras }: { cifras: ReadonlyArray<{ etiqueta: string; valor: string; nota?: string; color?: string }> }) {
  return (
    <div className="grid overflow-hidden rounded-[12px] border border-[var(--ls-linea)] bg-[var(--ls-sup)]" style={{ gridTemplateColumns: `repeat(${cifras.length}, minmax(0, 1fr))` }}>
      {cifras.map((c, i) => (
        <div key={c.etiqueta} className={`min-w-0 px-4 py-3 ${i > 0 ? 'border-l border-[var(--ls-linea)]' : ''}`}>
          <div className={`truncate ${TIPO.xs} ${TEXTO.t4}`}>{c.etiqueta}</div>
          <div className="mt-[2px] truncate text-[19px] font-semibold leading-[1.2] tracking-[-0.02em] tabular-nums" style={{ color: c.color ?? 'var(--ls-t1)' }}>
            {c.valor}
          </div>
          {c.nota && <div className={`truncate ${TIPO.xs} ${TEXTO.t4}`}>{c.nota}</div>}
        </div>
      ))}
    </div>
  )
}

/** La bandera de un país a partir de su código («UK» en Ads es «GB»). En los sistemas que no pintan banderas sale el código, que también se entiende */
export function bandera(codigo: string): string {
  const c = (codigo === 'UK' ? 'GB' : codigo).toUpperCase()
  if (!/^[A-Z]{2}$/.test(c)) return ''
  return String.fromCodePoint(...[...c].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65))
}

/**
 * La variación frente al periodo anterior. `mejor` dice qué dirección es buena: en el gasto o las ventas sube = verde, pero en el ACoS o el CPC subir es malo. `neutro` no juzga (el gasto, por
 * ejemplo, no es bueno ni malo por sí solo).
 */
export function Variacion({ actual, anterior, mejor }: { actual: number | null; anterior: number | null; mejor: 'sube' | 'baja' | 'neutro' }) {
  const v = variacion(actual, anterior)
  if (v === null) return <span className={`${TIPO.xs} ${TEXTO.t4}`}>sin comparar</span>
  const sube = v > 0.0005
  const baja = v < -0.0005
  const bueno = mejor === 'neutro' ? null : mejor === 'sube' ? sube : baja
  const color = !sube && !baja ? COLOR_ESTADO.gris : bueno === null ? COLOR_ESTADO.azul : bueno ? COLOR_ESTADO.verde : COLOR_ESTADO.rojo
  const Icono = sube ? ArrowUpRight : baja ? ArrowDownRight : Minus
  return (
    <span className="inline-flex items-center gap-[2px] text-[11.5px] font-medium tabular-nums" style={{ color }} title="Frente al periodo anterior de la misma duración">
      <Icono className="h-3 w-3" />
      {Math.abs(v * 100).toLocaleString('es-ES', { maximumFractionDigits: 1 })} %
    </span>
  )
}

/** Una línea pequeña con la evolución de una cifra a lo largo del periodo */
export function Chispa({ valores, color }: { valores: readonly number[]; color: string }) {
  if (valores.length < 2) return <div className="h-[28px]" />
  const max = Math.max(...valores)
  const min = Math.min(...valores, 0)
  const alto = max - min || 1
  const puntos = valores.map((v, i) => `${(i / (valores.length - 1)) * 100},${26 - ((v - min) / alto) * 24}`)
  return (
    <svg viewBox="0 0 100 28" preserveAspectRatio="none" className="h-[28px] w-full" aria-hidden>
      <polygon points={`0,28 ${puntos.join(' ')} 100,28`} fill={color} opacity="0.12" />
      <polyline points={puntos.join(' ')} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  )
}

export function Kpi({ etiqueta, valor, actual, anterior, mejor, serie, color, cargando }: { etiqueta: string; valor: string; actual: number | null; anterior: number | null; mejor: 'sube' | 'baja' | 'neutro'; serie: readonly number[]; color: string; cargando: boolean }) {
  return (
    <div className="min-w-0 rounded-[14px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] px-4 pb-3 pt-[12px] transition-colors hover:border-[var(--ls-linea2)]">
      <div className={`${TIPO.s} ${TEXTO.t3}`}>{etiqueta}</div>
      {cargando ? (
        <div className="mt-2 flex flex-col gap-2">
          <div className="h-[26px] w-24 animate-pulse rounded bg-[var(--ls-sup3)]" />
          <div className="h-[28px] w-full animate-pulse rounded bg-[var(--ls-sup2)]" />
        </div>
      ) : (
        <>
          <div className="mt-[2px] flex items-baseline gap-2">
            <span className="text-[23px] font-semibold leading-[1.15] tracking-[-0.02em] tabular-nums text-[var(--ls-t1)]">{valor}</span>
            <Variacion actual={actual} anterior={anterior} mejor={mejor} />
          </div>
          <div className="mt-1">
            <Chispa valores={serie} color={color} />
          </div>
        </>
      )}
    </div>
  )
}

const ESTILOS_DE_ESTADO: Record<string, { texto: string; color: string }> = {
  ENABLED: { texto: 'Activa', color: COLOR_ESTADO.verde },
  PAUSED: { texto: 'Pausada', color: COLOR_ESTADO.ambar },
  ARCHIVED: { texto: 'Archivada', color: COLOR_ESTADO.gris },
}

export function PuntoDeEstado({ estado }: { estado: string | null }) {
  const e = ESTILOS_DE_ESTADO[estado ?? ''] ?? { texto: 'Sin datos de estado', color: COLOR_ESTADO.gris }
  return <span className="inline-block h-[8px] w-[8px] shrink-0 rounded-full" style={{ background: e.color }} title={e.texto} />
}

export const textoDeEstado = (estado: string | null): string => ESTILOS_DE_ESTADO[estado ?? '']?.texto ?? '—'

/** El tipo de campaña como una etiqueta pequeña */
export function EtiquetaDeTipo({ tipo }: { tipo: string }) {
  return <span className="inline-flex h-[17px] items-center rounded-[4px] border border-[var(--ls-linea2)] bg-[var(--ls-sup2)] px-[5px] text-[10.5px] font-medium text-[var(--ls-t3)]">{tipo === 'Otras' ? 'Sin nomenclatura' : tipo.replace('MANUAL ', '').replace('MANUAL EXACTA / ', 'EXACTA · ')}</span>
}

/** Los colores de cada tipo de campaña en los gráficos */
export const COLOR_DE_TIPO: Record<string, string> = {
  'AUTO RADAR': COLOR_ESTADO.cian,
  'MANUAL AMPLIA': COLOR_ESTADO.azul,
  'MANUAL EXACTA / DOMINIO': COLOR_ESTADO.violeta,
  'MANUAL EXACTA / ESTABILIDAD': COLOR_ESTADO.magenta,
  'ATAQUE ASIN': COLOR_ESTADO.naranja,
  Otras: COLOR_ESTADO.gris,
}
