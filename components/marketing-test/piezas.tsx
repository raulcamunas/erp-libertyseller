'use client'

import { ArrowDownRight, ArrowUpRight, Minus, RefreshCw } from 'lucide-react'
import { BOTON, COLOR_ESTADO, TEXTO, TIPO } from '@/lib/estilo/denso'
import { variacion } from '@/lib/ads/rendimiento-calculo'
import { haceCuanto } from './formato'

/** Las piezas visuales compartidas por «Resumen» y «Campañas» */

export type Dias = 7 | 14 | 30

export function SelectorDePeriodo({ dias, cambiar, en, actualizar, cargando }: { dias: Dias; cambiar: (d: Dias) => void; en?: number; actualizar: () => void; cargando: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-[6px]">
      {([7, 14, 30] as const).map((d) => (
        <button key={d} type="button" onClick={() => cambiar(d)} className={`${BOTON.chip} ${dias === d ? BOTON.chipEncendido : ''}`}>
          Últimos {d} días
        </button>
      ))}
      <button type="button" onClick={actualizar} disabled={cargando} className={`${BOTON.base} ${BOTON.secundario}`} title="Volver a pedirle los datos a Amazon">
        <RefreshCw className={`h-3 w-3 ${cargando ? 'animate-spin' : ''}`} /> Actualizar
      </button>
      {en && !cargando && <span className={`${TIPO.xs} ${TEXTO.t4}`}>Datos {haceCuanto(en)}</span>}
    </div>
  )
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
    <div className="min-w-0 rounded-[8px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] px-3 pb-2 pt-[10px]">
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
