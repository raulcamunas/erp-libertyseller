'use client'

import { useEffect, useRef, useState } from 'react'
import { ArrowDownRight, ArrowUpRight, CalendarRange, Minus, Pause, Play, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { llamar } from './llamar'
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
/** Un periodo elegido a mano en el calendario (días AAAA-MM-DD, el último como tarde ayer) */
export interface Rango {
  desde: string
  hasta: string
}
export type Periodo = Dias | Rango
export const esRango = (p: Periodo): p is Rango => typeof p === 'object'
/** Lo que se pone en la URL para pedir las cifras de un periodo */
export const consultaDePeriodo = (p: Periodo): string => (esRango(p) ? `desde=${p.desde}&hasta=${p.hasta}` : `dias=${p}`)
const diaCorto = (d: string) => d.split('-').reverse().slice(0, 2).join('/')
const sumarDias = (dia: string, n: number) => new Date(Date.parse(`${dia}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)

/**
 * UN CONTROL SEGMENTADO: varias opciones excluyentes dentro de una sola pieza (como el selector de fechas de la consola de Amazon Ads). Se lee de un vistazo cuál está elegida y no compite con los
 * botones de acción, que es lo que pasaba con una fila de chips sueltos.
 */
export function Segmentado<T extends string | number>({ opciones, valor, cambiar, etiqueta }: { opciones: ReadonlyArray<{ id: T; texto: string; cuenta?: number }>; valor: T; cambiar: (v: T) => void; etiqueta: string }) {
  return (
    // Por debajo de lg no pasa del ancho de su fila y se desliza de lado dentro de sí: con opciones largas medía más que el teléfono y ensanchaba la
    // página entera (15 nov 2026: «Activas · Pausadas · Archivadas · Todas» en Campañas acababa en x=381 de 375 y el móvil alejaba la vista)
    <div role="radiogroup" aria-label={etiqueta} className="ls-sin-barra inline-flex shrink-0 items-center rounded-[9px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] p-[2px] max-lg:max-w-full max-lg:overflow-x-auto">
      {opciones.map((o) => {
        const activo = o.id === valor
        return (
          <button
            key={String(o.id)}
            type="button"
            role="radio"
            aria-checked={activo}
            onClick={() => cambiar(o.id)}
            className={`inline-flex h-[26px] shrink-0 items-center gap-[6px] whitespace-nowrap rounded-[7px] px-[10px] text-[12px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ls-acc-graf)] ${
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

/**
 * ELEGIR UN PERIODO A MANO: un botón con las fechas que abre dos calendarios (desde y hasta). Solo deja elegir días con datos guardados (los últimos 90) y hasta ayer, que es
 * donde acaban las cifras de Amazon. Atajos para lo más pedido (este mes, el mes pasado, 60 y 90 días).
 */
function ElegirRango({ rango, cambiar, primerDia }: { rango: Rango | null; cambiar: (r: Rango) => void; primerDia?: string | null }) {
  const [abierto, setAbierto] = useState(false)
  const hoy = new Date().toISOString().slice(0, 10)
  const ayer = sumarDias(hoy, -1)
  const minimo = primerDia && primerDia > sumarDias(hoy, -90) ? primerDia : sumarDias(hoy, -90)
  const [desde, setDesde] = useState(rango?.desde ?? sumarDias(ayer, -13))
  const [hasta, setHasta] = useState(rango?.hasta ?? ayer)
  const caja = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!abierto) return
    const fuera = (e: MouseEvent) => caja.current && !caja.current.contains(e.target as Node) && setAbierto(false)
    const tecla = (e: KeyboardEvent) => e.key === 'Escape' && setAbierto(false)
    document.addEventListener('mousedown', fuera)
    document.addEventListener('keydown', tecla)
    return () => {
      document.removeEventListener('mousedown', fuera)
      document.removeEventListener('keydown', tecla)
    }
  }, [abierto])
  const limitar = (d: string) => (d < minimo ? minimo : d > ayer ? ayer : d)
  const valido = desde && hasta && desde <= hasta && desde >= minimo && hasta <= ayer
  const aplicar = (r: Rango) => {
    cambiar({ desde: limitar(r.desde), hasta: limitar(r.hasta) })
    setAbierto(false)
  }
  const mes = hoy.slice(0, 7)
  const mesPasado = new Date(Date.UTC(Number(mes.slice(0, 4)), Number(mes.slice(5)) - 2, 1)).toISOString().slice(0, 7)
  const finDeMesPasado = sumarDias(`${mes}-01`, -1)
  const atajos: Array<{ texto: string; r: Rango }> = [
    ...(`${mes}-01` <= ayer ? [{ texto: 'Este mes', r: { desde: `${mes}-01`, hasta: ayer } }] : []),
    { texto: 'Mes pasado', r: { desde: `${mesPasado}-01`, hasta: finDeMesPasado } },
    { texto: '60 días', r: { desde: sumarDias(ayer, -59), hasta: ayer } },
    { texto: '90 días', r: { desde: sumarDias(ayer, -89), hasta: ayer } },
  ]
  const campo = 'h-[30px] rounded-[8px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-2 text-[12.5px] text-[var(--ls-t1)] outline-none [color-scheme:dark] focus:border-[var(--ls-acc-graf)]'
  return (
    <div ref={caja} className="relative">
      <button
        type="button"
        onClick={() => {
          setDesde(rango?.desde ?? desde)
          setHasta(rango?.hasta ?? hasta)
          setAbierto(!abierto)
        }}
        aria-expanded={abierto}
        aria-pressed={Boolean(rango)}
        className={`inline-flex h-[30px] items-center gap-[6px] rounded-[9px] border px-[10px] text-[12px] font-medium transition-colors ${rango ? 'border-[var(--ls-acc-graf)] bg-[var(--ls-acc-suave)] text-[var(--ls-t1)]' : 'border-[var(--ls-linea)] bg-[var(--ls-sup2)] text-[var(--ls-t3)] hover:text-[var(--ls-t1)]'}`}
        title="Elegir las fechas en un calendario"
      >
        <CalendarRange className="h-[13px] w-[13px]" />
        {rango ? `${diaCorto(rango.desde)} – ${diaCorto(rango.hasta)}` : 'Fechas…'}
      </button>
      {abierto && (
        <div role="dialog" aria-label="Elegir periodo" className="absolute left-0 top-[36px] z-30 w-[300px] rounded-[12px] border border-[var(--ls-linea2)] bg-[var(--ls-sup)] p-3 shadow-[0_12px_32px_rgba(0,0,0,0.45)]">
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-[11px] text-[var(--ls-t4)]">
              Desde
              <input type="date" value={desde} min={minimo} max={hasta || ayer} onChange={(e) => setDesde(e.target.value)} className={campo} />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-[var(--ls-t4)]">
              Hasta
              <input type="date" value={hasta} min={desde || minimo} max={ayer} onChange={(e) => setHasta(e.target.value)} className={campo} />
            </label>
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            {atajos.map((a) => (
              <button key={a.texto} type="button" onClick={() => aplicar(a.r)} className="rounded-[7px] border border-[var(--ls-linea)] px-2 py-[3px] text-[11.5px] text-[var(--ls-t2)] hover:bg-[var(--ls-sup2)] hover:text-[var(--ls-t1)]">
                {a.texto}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11px] leading-[1.4] text-[var(--ls-t4)]">Se guardan los últimos 90 días (desde el {diaCorto(minimo)}); las cifras acaban ayer. Se compara con el periodo anterior de la misma duración.</p>
          <div className="mt-2 flex justify-end gap-2">
            <button type="button" onClick={() => setAbierto(false)} className="h-[28px] rounded-[8px] px-3 text-[12px] text-[var(--ls-t3)] hover:text-[var(--ls-t1)]">Cancelar</button>
            <button type="button" disabled={!valido} onClick={() => aplicar({ desde, hasta })} className="h-[28px] rounded-[8px] bg-[var(--ls-acc)] px-3 text-[12px] font-semibold text-white disabled:opacity-40">Aplicar</button>
          </div>
        </div>
      )}
    </div>
  )
}

/** El periodo (7, 14 o 30 días, o unas fechas elegidas a mano si se pasa `conRango`), el botón de actualizar y de cuándo son los datos */
export function SelectorDePeriodo({ dias, cambiar, en, actualizar, cargando, conRango = false, primerDia }: { dias: Periodo; cambiar: (p: Periodo) => void; en?: number; actualizar: () => void; cargando: boolean; conRango?: boolean; primerDia?: string | null }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Segmentado
        etiqueta="Periodo"
        opciones={[
          { id: 7, texto: '7 días' },
          { id: 14, texto: '14 días' },
          { id: 30, texto: '30 días' },
        ]}
        valor={esRango(dias) ? (0 as Dias) : dias}
        cambiar={(d) => cambiar(d as Dias)}
      />
      {conRango && <ElegirRango rango={esRango(dias) ? dias : null} cambiar={cambiar} primerDia={primerDia} />}
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
    // En el móvil, de dos en dos (con 4-5 columnas en 327 px cada cifra se quedaba en «1…»); la impar del final ocupa la fila. Desde sm, todas en una fila como siempre
    <div className="grid grid-cols-2 overflow-hidden rounded-[12px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] sm:[grid-template-columns:repeat(var(--cifras),minmax(0,1fr))]" style={{ ['--cifras' as string]: cifras.length }}>
      {cifras.map((c, i) => (
        <div
          key={c.etiqueta}
          className={[
            'min-w-0 border-[var(--ls-linea)] px-4 py-3',
            i % 2 === 1 ? 'border-l' : i > 0 ? 'sm:border-l' : '',
            i >= 2 ? 'border-t sm:border-t-0' : '',
            cifras.length % 2 === 1 && i === cifras.length - 1 ? 'col-span-2 sm:col-span-1' : '',
          ].join(' ')}
        >
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

/**
 * PAUSAR O ACTIVAR UNA CAMPAÑA desde su fila, sin abrirla. Escribe en Amazon al momento y queda en el log de cambios. Al pausar sale un aviso con «Deshacer» por si fue sin querer.
 * Una campaña archivada (o sin estado) no se puede tocar: solo se enseña su punto.
 */
export function InterruptorDeCampana({ perfilId, campaignId, nombre, estado, alCambiar }: { perfilId: string; campaignId: string; nombre: string; estado: string | null; alCambiar: (estado: 'ENABLED' | 'PAUSED') => void }) {
  const [ocupado, setOcupado] = useState(false)
  if (estado !== 'ENABLED' && estado !== 'PAUSED') return <PuntoDeEstado estado={estado} />
  const activa = estado === 'ENABLED'
  const enviar = async (activar: boolean): Promise<boolean> => {
    setOcupado(true)
    try {
      const r = await llamar<{ ok: true; estado: 'ENABLED' | 'PAUSED' }>('/api/ads/cuenta/segmentaciones', { metodo: 'POST', cuerpo: { perfilId, campaignId, nombreCampana: nombre, accion: 'estado_campana', activar } })
      alCambiar(r.estado)
      return true
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Amazon no ha aceptado el cambio.')
      return false
    } finally {
      setOcupado(false)
    }
  }
  return (
    <button
      type="button"
      role="switch"
      aria-checked={activa}
      disabled={ocupado}
      title={activa ? 'Activa · pulsa para pausarla en Amazon' : 'Pausada · pulsa para activarla en Amazon'}
      aria-label={`${activa ? 'Pausar' : 'Activar'} la campaña ${nombre}`}
      onClick={async (e) => {
        e.stopPropagation()
        const ok = await enviar(!activa)
        if (ok && activa) toast.success('Campaña pausada en Amazon', { description: nombre.slice(0, 90), action: { label: 'Deshacer', onClick: () => void enviar(true) } })
        else if (ok) toast.success('Campaña activada en Amazon', { description: nombre.slice(0, 90) })
      }}
      className={`relative inline-flex h-[18px] w-[32px] shrink-0 items-center rounded-full border transition-colors disabled:opacity-50 ${activa ? 'border-transparent bg-[color-mix(in_srgb,var(--ls-e-verde)_75%,transparent)]' : 'border-[var(--ls-linea2)] bg-[var(--ls-sup2)]'}`}
    >
      <span className={`absolute flex h-[14px] w-[14px] items-center justify-center rounded-full bg-white shadow transition-[left] ${activa ? 'left-[15px]' : 'left-[1px]'}`}>
        {ocupado ? <RefreshCw className="h-[8px] w-[8px] animate-spin text-[#333]" /> : activa ? <Play className="h-[7px] w-[7px] fill-[#333] text-[#333]" /> : <Pause className="h-[7px] w-[7px] fill-[#666] text-[#666]" />}
      </span>
    </button>
  )
}
