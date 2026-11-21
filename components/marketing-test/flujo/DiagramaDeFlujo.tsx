'use client'

import { useId, useMemo, type KeyboardEvent } from 'react'
import { ArrowRight, Ban, ChevronRight, TrendingDown, TrendingUp, Wallet } from 'lucide-react'
import { COLOR_ESTADO } from '@/lib/estilo/denso'
import { SUMIDERO, type FlechaDeFlujo, type Flujo, type NodoDeFlujo } from '@/lib/ads/flujo-calculo'
import { decimal } from '../formato'
import { useEsEscritorio } from '../useEsEscritorio'
import { COLOR_DE_FLECHA, colorDeRol, cuentasDeFlecha, nombreDeFlecha, nombreDeNodo, type Seleccion } from './comun'

/* ------------------------------------------------------------------ */
/* Geometría                                                           */
/* ------------------------------------------------------------------ */

const ANCHO = 1000
const MARGEN = 16
const ALTO_NODO = 104
const HUECO = 30
const ARRIBA = 70
const ALTO_SUMIDERO = 48

/** Columna de cada papel: AUTO → AMPLIA → EXACTA (las dos apiladas) y ATAQUE ASIN aparte */
const COLUMNA: Record<string, number> = { 'AUTO RADAR': 0, 'MANUAL AMPLIA': 1, 'MANUAL EXACTA / DOMINIO': 2, 'MANUAL EXACTA / ESTABILIDAD': 2, 'ATAQUE ASIN': 3 }

interface Caja {
  nodo: NodoDeFlujo
  col: number
  x: number
  y: number
  w: number
  h: number
}

interface Punto {
  x: number
  y: number
}

type ClaseDeTrazo = 'hecho' | 'propuesto' | 'deshecho' | 'fallido'

const grosor = (n: number, clase: ClaseDeTrazo) => (clase === 'fallido' ? 1.5 : Math.min(14, 2 + 2 * Math.sqrt(Math.max(1, n))))

/** Los trazos de una flecha (uno por clase que tenga), del más importante al menos */
function trazosDe(f: FlechaDeFlujo, conPropuestas: boolean): Array<{ clase: ClaseDeTrazo; n: number }> {
  const t: Array<{ clase: ClaseDeTrazo; n: number }> = []
  if (f.hechos) t.push({ clase: 'hecho', n: f.hechos })
  // Lo propuesto y lo que se quedó sin aplicar (caducado, descartado) se dibujan igual, discontinuo; la etiqueta los distingue
  if (conPropuestas && f.propuestos + f.sinAplicar) t.push({ clase: 'propuesto', n: f.propuestos + f.sinAplicar })
  if (f.deshechos) t.push({ clase: 'deshecho', n: f.deshechos })
  if (f.fallidos) t.push({ clase: 'fallido', n: f.fallidos })
  return t
}

/** Las posiciones de las campañas y del sumidero */
function colocar(flujo: Flujo) {
  const campanas = flujo.nodos.filter((n) => n.id !== SUMIDERO)
  const columnas = [...new Set(campanas.map((n) => COLUMNA[n.rol] ?? 1))].sort((a, b) => a - b)
  const nCol = Math.max(columnas.length, 1)
  const anchoCol = (ANCHO - 2 * MARGEN) / nCol
  const w = Math.min(236, anchoCol - 58)
  const cajas = new Map<string, Caja>()
  const porColumna = new Map<number, NodoDeFlujo[]>()
  for (const n of campanas) {
    const c = COLUMNA[n.rol] ?? 1
    porColumna.set(c, [...(porColumna.get(c) ?? []), n])
  }
  let fondo = ARRIBA
  for (const [c, lista] of porColumna) {
    const i = columnas.indexOf(c)
    // DOMINIO encima de ESTABILIDAD; las que todavía no existen, al final
    lista.sort((a, b) => Number(Boolean(a.hipotetica)) - Number(Boolean(b.hipotetica)) || a.rol.localeCompare(b.rol))
    lista.forEach((n, j) => {
      const y = ARRIBA + j * (ALTO_NODO + HUECO)
      cajas.set(n.id, { nodo: n, col: i, x: MARGEN + i * anchoCol + (anchoCol - w) / 2, y, w, h: ALTO_NODO })
      fondo = Math.max(fondo, y + ALTO_NODO)
    })
  }
  const ySumidero = fondo + 96
  const sumidero = flujo.nodos.find((n) => n.id === SUMIDERO)
  if (sumidero) cajas.set(SUMIDERO, { nodo: sumidero, col: -1, x: MARGEN, y: ySumidero, w: ANCHO - 2 * MARGEN, h: ALTO_SUMIDERO })
  const separador = columnas.includes(3) && nCol > 1 ? MARGEN + columnas.indexOf(3) * anchoCol : null
  return { cajas, alto: ySumidero + ALTO_SUMIDERO + MARGEN, separador }
}

/** El camino (curva) de una flecha, desplazado `d` px para dibujar trazos en paralelo, y su punto medio */
function camino(f: FlechaDeFlujo, a: Caja, b: Caja, d: number): { d: string; medio: Punto } {
  const cubica = (p0: Punto, p1: Punto, p2: Punto, p3: Punto) => ({
    d: `M ${p0.x} ${p0.y} C ${p1.x} ${p1.y}, ${p2.x} ${p2.y}, ${p3.x} ${p3.y}`,
    medio: { x: (p0.x + 3 * p1.x + 3 * p2.x + p3.x) / 8, y: (p0.y + 3 * p1.y + 3 * p2.y + p3.y) / 8 },
  })
  if (f.tipo === 'negativa') {
    const x = a.x + a.w / 2 + d
    const y0 = a.y + a.h
    const y1 = b.y - 2
    const r = cubica({ x, y: y0 }, { x, y: y0 + 20 }, { x, y: y1 - 20 }, { x, y: y1 })
    return { d: r.d, medio: { x, y: y0 + 26 } }
  }
  const ca = a.col
  const cb = b.col
  if (cb === ca + 1) {
    const p0 = { x: a.x + a.w, y: a.y + a.h / 2 + d }
    const p3 = { x: b.x - 2, y: b.y + b.h / 2 + d }
    const dx = (p3.x - p0.x) / 2
    const r = cubica(p0, { x: p0.x + dx, y: p0.y }, { x: p3.x - dx, y: p3.y }, p3)
    // El hueco entre columnas es estrecho: la cifra va encima de la flecha para no taparla
    return { d: r.d, medio: { x: r.medio.x, y: Math.min(p0.y, p3.y) - 22 } }
  }
  if (cb === ca) {
    const p0 = { x: a.x + a.w, y: a.y + a.h / 2 + d }
    const p3 = { x: b.x + b.w + 2, y: b.y + b.h / 2 + d }
    const fuera = 54 + Math.abs(d)
    return cubica(p0, { x: p0.x + fuera, y: p0.y }, { x: p3.x + fuera, y: p3.y }, p3)
  }
  // Por encima: saltan columnas (AUTO → EXACTA, → ATAQUE ASIN) o van hacia atrás
  const p0 = { x: a.x + a.w / 2 + d, y: a.y }
  const p3 = { x: b.x + b.w / 2 + d, y: b.y - 2 }
  const alto = Math.max(8, Math.min(a.y, b.y) - 58 - Math.abs(cb - ca) * 6)
  return cubica(p0, { x: p0.x, y: alto }, { x: p3.x, y: alto }, p3)
}

/* ------------------------------------------------------------------ */
/* El dibujo                                                           */
/* ------------------------------------------------------------------ */

function alTeclear(e: KeyboardEvent, hacer: () => void) {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    hacer()
  }
}

function Chip({ icono: Icono, texto, color }: { icono: typeof Ban; texto: string; color: string }) {
  return (
    <span className="inline-flex items-center gap-[3px] whitespace-nowrap rounded-[6px] px-[5px] py-[1px] text-[11px] font-medium tabular-nums" style={{ color, background: `color-mix(in srgb, ${color} 12%, transparent)` }}>
      <Icono className="h-[11px] w-[11px]" aria-hidden />
      {texto}
    </span>
  )
}

/** Los chips de una campaña: negativas, pujas y presupuesto de → a */
export function ChipsDeNodo({ n, moneda }: { n: NodoDeFlujo; moneda: string | null }) {
  const simbolo = moneda === 'EUR' || !moneda ? ' €' : ` ${moneda}`
  return (
    <>
      {n.negativas > 0 && <Chip icono={Ban} texto={`${n.negativas} neg.`} color={COLOR_ESTADO.ambar} />}
      {n.pujas.suben > 0 && <Chip icono={TrendingUp} texto={`${n.pujas.suben} puja${n.pujas.suben === 1 ? '' : 's'}`} color={COLOR_ESTADO.verde} />}
      {n.pujas.bajan > 0 && <Chip icono={TrendingDown} texto={`${n.pujas.bajan} puja${n.pujas.bajan === 1 ? '' : 's'}`} color={COLOR_ESTADO.azul} />}
      {n.presupuesto && <Chip icono={Wallet} texto={`${decimal(n.presupuesto.de)} → ${decimal(n.presupuesto.a)}${simbolo}`} color={n.presupuesto.a >= n.presupuesto.de ? COLOR_ESTADO.verde : COLOR_ESTADO.azul} />}
    </>
  )
}

function NodoSvg({ c, moneda, elegir }: { c: Caja; moneda: string | null; elegir: (s: Seleccion) => void }) {
  const n = c.nodo
  const color = colorDeRol(n.rol)
  const sku = n.nombre.split('|')[1]?.trim()
  const abrir = () => elegir({ tipo: 'nodo', id: n.id })
  return (
    <foreignObject x={c.x} y={c.y} width={c.w} height={c.h}>
      <div
        role="button"
        tabIndex={0}
        onClick={abrir}
        onKeyDown={(e) => alTeclear(e, abrir)}
        aria-label={`${nombreDeNodo(n)}: ver sus términos`}
        title={n.nombre}
        className="flex h-full w-full cursor-pointer flex-col gap-1 overflow-hidden rounded-[12px] border bg-[var(--ls-sup)] px-3 py-2 text-left shadow-[var(--ls-sombra-1)] transition-[box-shadow,transform] hover:-translate-y-px hover:shadow-[var(--ls-sombra-2)] focus-visible:outline focus-visible:outline-2"
        style={{ borderColor: `color-mix(in srgb, ${color} ${n.hipotetica ? 30 : 45}%, var(--ls-linea))`, borderStyle: n.hipotetica ? 'dashed' : 'solid', opacity: n.hipotetica ? 0.75 : 1, outlineColor: color }}
      >
        <div className="flex items-center gap-[6px]">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} aria-hidden />
          <span className="truncate text-[12px] font-semibold text-[var(--ls-t1)]">{nombreDeNodo(n)}</span>
        </div>
        <div className="truncate text-[11px] text-[var(--ls-t4)]">{n.hipotetica ? 'Todavía no existe' : sku ? `SKU ${sku}` : n.nombre}</div>
        <div className="flex items-center gap-2 text-[11px] tabular-nums text-[var(--ls-t3)]">
          {n.entran > 0 && <span title="Términos que han entrado (cosechados)">⇢ {n.entran} entran</span>}
          {n.salen > 0 && <span title="Términos que han salido a otra campaña">{n.salen} salen ⇢</span>}
        </div>
        <div className="mt-auto flex flex-wrap gap-1">
          <ChipsDeNodo n={n} moneda={moneda} />
        </div>
      </div>
    </foreignObject>
  )
}

function FlechaSvg({ f, a, b, conPropuestas, ids, elegir }: { f: FlechaDeFlujo; a: Caja; b: Caja; conPropuestas: boolean; ids: Record<string, string>; elegir: (s: Seleccion) => void }) {
  const trazos = trazosDe(f, conPropuestas)
  if (trazos.length === 0) return null
  const anchos = trazos.map((t) => grosor(t.n, t.clase))
  const total = anchos.reduce((s, w) => s + w, 0) + (anchos.length - 1) * 3
  let acumulado = -total / 2
  const desplazamientos = anchos.map((w) => {
    const d = acumulado + w / 2
    acumulado += w + 3
    return d
  })
  const base = camino(f, a, b, 0)
  const color = COLOR_DE_FLECHA[f.tipo]
  const abrir = () => elegir({ tipo: 'flecha', id: f.id })
  const principal = trazos[0]
  const etiqueta = trazos.map((t) => (t.clase === 'hecho' ? `${t.n}` : t.clase === 'propuesto' ? (f.propuestos ? `${t.n} propuesto${t.n === 1 ? '' : 's'}` : `${t.n} sin aplicar`) : t.clase === 'deshecho' ? `${t.n} deshecho${t.n === 1 ? '' : 's'}` : `${t.n} fallo${t.n === 1 ? '' : 's'}`)).join(' · ')
  const anchoEtiqueta = etiqueta.length * 6.4 + 14
  return (
    <g role="button" tabIndex={0} aria-label={`${nombreDeFlecha(f, { nodos: [a.nodo, b.nodo], flechas: [], terminos: [] })}: ${cuentasDeFlecha(f)}`} onClick={abrir} onKeyDown={(e) => alTeclear(e, abrir)} className="cursor-pointer outline-none [&:focus-visible_.ls-halo]:opacity-30 [&:hover_.ls-halo]:opacity-20">
      <path d={base.d} fill="none" stroke={color} strokeWidth={total + 14} strokeLinecap="round" className="ls-halo opacity-0 transition-opacity" />
      {trazos.map((t, i) => {
        const c = camino(f, a, b, desplazamientos[i])
        const tono = t.clase === 'deshecho' ? COLOR_DE_FLECHA.deshecho : t.clase === 'fallido' ? COLOR_DE_FLECHA.fallido : color
        const punta = t.clase === 'deshecho' ? ids.gris : t.clase === 'fallido' ? ids.rojo : f.tipo === 'cosecha' ? ids.verde : ids.ambar
        return <path key={t.clase} d={c.d} fill="none" stroke={tono} strokeWidth={anchos[i]} strokeDasharray={t.clase === 'propuesto' ? '7 6' : t.clase === 'fallido' ? '2 4' : undefined} strokeOpacity={t.clase === 'propuesto' ? 0.6 : 0.9} strokeLinecap={t.clase === 'propuesto' ? 'butt' : 'round'} markerEnd={`url(#${punta})`} />
      })}
      <path d={base.d} fill="none" stroke="transparent" strokeWidth={Math.max(20, total + 10)} />
      <g transform={`translate(${base.medio.x - anchoEtiqueta / 2}, ${base.medio.y - 10})`}>
        <rect width={anchoEtiqueta} height={20} rx={10} fill="var(--ls-sup)" stroke={principal.clase === 'hecho' ? color : 'var(--ls-linea2)'} strokeWidth={1} />
        <text x={anchoEtiqueta / 2} y={14} textAnchor="middle" fontSize={11.5} fontWeight={600} fill="var(--ls-t1)" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {etiqueta}
        </text>
      </g>
    </g>
  )
}

/**
 * EL DIAGRAMA DEL FLUJO: las campañas de un producto en columnas (AUTO RADAR → MANUAL AMPLIA → EXACTA, y ATAQUE ASIN aparte) y abajo, a todo lo ancho, las
 * «Negativizadas». Las flechas verdes son cosechas (un término pasa de una campaña a otra) y las ámbar, negativas; continua = hecho, discontinua = propuesto,
 * gris = deshecho y roja fina = fallido. El grosor crece con el número de términos. Clic en una flecha o una campaña: sus términos. En el móvil, una lista.
 */
export function DiagramaDeFlujo({ flujo, conPropuestas, moneda, elegir }: { flujo: Flujo; conPropuestas: boolean; moneda: string | null; elegir: (s: Seleccion) => void }) {
  const escritorio = useEsEscritorio()
  const base = useId().replace(/:/g, '')
  const ids = { verde: `${base}-v`, ambar: `${base}-a`, gris: `${base}-g`, rojo: `${base}-r` }
  const { cajas, alto, separador } = useMemo(() => colocar(flujo), [flujo])
  const visibles = flujo.flechas.filter((f) => trazosDe(f, conPropuestas).length > 0)

  if (!escritorio) return <FlujoEnLista flujo={flujo} conPropuestas={conPropuestas} moneda={moneda} elegir={elegir} />

  const sumidero = cajas.get(SUMIDERO)
  const negativas = flujo.flechas.filter((f) => f.tipo === 'negativa')
  const totalNeg = negativas.reduce((s, f) => s + f.hechos, 0)
  const propNeg = negativas.reduce((s, f) => s + f.propuestos, 0)

  return (
    <div className="flex flex-col gap-2">
      <svg viewBox={`0 0 ${ANCHO} ${alto}`} className="h-auto w-full" role="group" aria-label="Flujo de términos entre las campañas del producto">
        <defs>
          {(
            [
              ['verde', COLOR_DE_FLECHA.cosecha],
              ['ambar', COLOR_DE_FLECHA.negativa],
              ['gris', COLOR_DE_FLECHA.deshecho],
              ['rojo', COLOR_DE_FLECHA.fallido],
            ] as const
          ).map(([k, c]) => (
            <marker key={k} id={ids[k]} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="11" markerHeight="11" markerUnits="userSpaceOnUse" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill={c} />
            </marker>
          ))}
        </defs>

        {separador != null && <line x1={separador} x2={separador} y1={ARRIBA - 24} y2={(sumidero?.y ?? alto) - 30} stroke="var(--ls-linea2)" strokeDasharray="3 5" />}

        {/* Las flechas debajo de las cajas */}
        {visibles.map((f) => {
          const a = cajas.get(f.desde)
          const b = cajas.get(f.hacia)
          if (!a || !b) return null
          return <FlechaSvg key={f.id} f={f} a={a} b={b} conPropuestas={conPropuestas} ids={ids} elegir={elegir} />
        })}

        {[...cajas.values()]
          .filter((c) => c.nodo.id !== SUMIDERO)
          .map((c) => (
            <NodoSvg key={c.nodo.id} c={c} moneda={moneda} elegir={elegir} />
          ))}

        {sumidero && (
          <g role="button" tabIndex={0} aria-label="Negativizadas: ver todos los términos negativizados" className="cursor-pointer outline-none [&:hover_rect]:opacity-100" onClick={() => elegir({ tipo: 'nodo', id: SUMIDERO })} onKeyDown={(e) => alTeclear(e, () => elegir({ tipo: 'nodo', id: SUMIDERO }))}>
            <rect x={sumidero.x} y={sumidero.y} width={sumidero.w} height={sumidero.h} rx={12} fill={`color-mix(in srgb, ${COLOR_ESTADO.ambar} 10%, var(--ls-sup))`} stroke={`color-mix(in srgb, ${COLOR_ESTADO.ambar} 45%, var(--ls-linea))`} className="opacity-90 transition-opacity" />
            <text x={sumidero.x + 16} y={sumidero.y + 29} fontSize={13.5} fontWeight={600} fill="var(--ls-t1)">
              Negativizadas
              <tspan fill="var(--ls-t3)" fontWeight={500}>
                {`  ·  ${totalNeg} ${totalNeg === 1 ? 'término excluido' : 'términos excluidos'}${conPropuestas && propNeg ? ` · ${propNeg} propuestos` : ''}`}
              </tspan>
            </text>
          </g>
        )}
      </svg>
      <Leyenda conPropuestas={conPropuestas} />
    </div>
  )
}

function Leyenda({ conPropuestas }: { conPropuestas: boolean }) {
  const muestra = (color: string, dash?: string, ancho = 4) => (
    <svg width="30" height="10" aria-hidden className="shrink-0">
      <line x1="2" y1="5" x2="28" y2="5" stroke={color} strokeWidth={ancho} strokeDasharray={dash} strokeLinecap="butt" />
    </svg>
  )
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-[12px] text-[var(--ls-t3)]">
      <span className="inline-flex items-center gap-[6px]">{muestra(COLOR_DE_FLECHA.cosecha)}Cosecha (pasa a otra campaña)</span>
      <span className="inline-flex items-center gap-[6px]">{muestra(COLOR_DE_FLECHA.negativa)}Negativa (se excluye)</span>
      {conPropuestas && <span className="inline-flex items-center gap-[6px]">{muestra('var(--ls-t3)', '7 6')}Propuesto, sin aplicar</span>}
      <span className="inline-flex items-center gap-[6px]">{muestra(COLOR_DE_FLECHA.deshecho)}Deshecho</span>
      <span className="inline-flex items-center gap-[6px]">{muestra(COLOR_DE_FLECHA.fallido, '2 4', 1.5)}Falló en Amazon</span>
      <span className="text-[var(--ls-t4)]">Más gruesa = más términos. Pulsa una flecha o una campaña.</span>
    </div>
  )
}

/** En el móvil: una fila por flecha («AUTO RADAR → EXACTA · 3 términos») y debajo las campañas con sus chips */
function FlujoEnLista({ flujo, conPropuestas, moneda, elegir }: { flujo: Flujo; conPropuestas: boolean; moneda: string | null; elegir: (s: Seleccion) => void }) {
  const flechas = flujo.flechas.filter((f) => trazosDe(f, conPropuestas).length > 0)
  const campanas = flujo.nodos.filter((n) => n.id !== SUMIDERO).sort((a, b) => (COLUMNA[a.rol] ?? 1) - (COLUMNA[b.rol] ?? 1) || a.rol.localeCompare(b.rol))
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-2">
        {flechas.length === 0 && <li className="text-[13px] text-[var(--ls-t3)]">En estos días ningún término ha pasado de una campaña a otra ni se ha negativizado.</li>}
        {flechas.map((f) => {
          const n = f.hechos + (conPropuestas ? f.propuestos + f.sinAplicar : 0) + f.deshechos + f.fallidos
          const color = f.hechos ? COLOR_DE_FLECHA[f.tipo] : 'var(--ls-t4)'
          return (
            <li key={f.id}>
              <button type="button" onClick={() => elegir({ tipo: 'flecha', id: f.id })} className="flex min-h-[48px] w-full items-center gap-3 rounded-[12px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] px-3 py-2 text-left">
                <span className="h-8 w-[5px] shrink-0 rounded-full" style={{ background: color, opacity: f.hechos ? 1 : 0.5 }} aria-hidden />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="flex flex-wrap items-center gap-x-1 text-[13.5px] font-semibold text-[var(--ls-t1)]">
                    {nombreDeNodo(flujo.nodos.find((x) => x.id === f.desde))}
                    <ArrowRight className="h-[13px] w-[13px] shrink-0 text-[var(--ls-t4)]" aria-hidden />
                    {nombreDeNodo(flujo.nodos.find((x) => x.id === f.hacia))}
                  </span>
                  <span className="text-[12px] text-[var(--ls-t3)]">
                    {f.tipo === 'cosecha' ? 'Cosecha' : 'Negativa'} · {n} {n === 1 ? 'término' : 'términos'} ({cuentasDeFlecha({ ...f, propuestos: conPropuestas ? f.propuestos : 0, sinAplicar: conPropuestas ? f.sinAplicar : 0 })})
                  </span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-[var(--ls-t4)]" aria-hidden />
              </button>
            </li>
          )
        })}
      </ul>
      <div className="grid gap-2 sm:grid-cols-2">
        {campanas.map((n) => (
          <button key={n.id} type="button" onClick={() => elegir({ tipo: 'nodo', id: n.id })} className="flex min-h-[48px] flex-col gap-1 rounded-[12px] border bg-[var(--ls-sup)] px-3 py-2 text-left" style={{ borderColor: `color-mix(in srgb, ${colorDeRol(n.rol)} 40%, var(--ls-linea))`, borderStyle: n.hipotetica ? 'dashed' : 'solid' }}>
            <span className="flex items-center gap-[6px] text-[13px] font-semibold text-[var(--ls-t1)]">
              <span className="h-2 w-2 rounded-full" style={{ background: colorDeRol(n.rol) }} aria-hidden />
              {nombreDeNodo(n)}
              {(n.entran > 0 || n.salen > 0) && <span className="text-[11.5px] font-normal text-[var(--ls-t3)]">· {n.entran} entran · {n.salen} salen</span>}
            </span>
            <span className="flex flex-wrap gap-1">
              <ChipsDeNodo n={n} moneda={moneda} />
            </span>
          </button>
        ))}
        {flujo.nodos.some((n) => n.id === SUMIDERO) && (
          <button type="button" onClick={() => elegir({ tipo: 'nodo', id: SUMIDERO })} className="flex min-h-[48px] items-center gap-2 rounded-[12px] border border-dashed bg-[var(--ls-sup)] px-3 py-2 text-left text-[13px] font-semibold text-[var(--ls-t1)]" style={{ borderColor: `color-mix(in srgb, ${COLOR_DE_FLECHA.negativa} 45%, var(--ls-linea))` }}>
            <span className="h-2 w-2 rounded-full" style={{ background: COLOR_DE_FLECHA.negativa }} aria-hidden />
            Negativizadas · {flujo.terminos.filter((t) => flujo.flechas.find((f) => f.id === t.flechaId)?.tipo === 'negativa').length} términos
          </button>
        )}
      </div>
    </div>
  )
}
