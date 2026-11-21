'use client'

import { useMemo, useState } from 'react'
import { Ban, CalendarDays, ChevronDown, CircleDollarSign, CircleX, History, MessageSquareText, Pause, Play, Rocket, Sprout, TrendingDown, TrendingUp, Undo2, type LucideIcon } from 'lucide-react'
import { Insignia } from '@/components/ui-ls'
import { COLOR_ESTADO, type TonoEstado } from '@/lib/estilo/denso'
import { resumenDelDia, rolCorto, type AccionDelDia, type ClaseDeAccion, type DiaDelDiario, type ResumenDelDia } from '@/lib/ads/flujo-calculo'
import { colorDeRol } from './comun'

/** Los mismos iconos que la línea del agente (components/marketing-test/agente/LineaDelAgente.tsx) */
const ICONO_DE_CLASE: Record<ClaseDeAccion, LucideIcon> = {
  negativa: Ban,
  cosecha: Sprout,
  puja_sube: TrendingUp,
  puja_baja: TrendingDown,
  presupuesto_sube: CircleDollarSign,
  presupuesto_baja: CircleDollarSign,
  pausa: Pause,
  activa: Play,
  deshacer: Undo2,
  descartada: CircleX,
  crear: Rocket,
  otro: History,
}

const TONO_DE_CLASE: Record<ClaseDeAccion, TonoEstado> = {
  negativa: 'ambar',
  cosecha: 'verde',
  puja_sube: 'verde',
  puja_baja: 'azul',
  presupuesto_sube: 'verde',
  presupuesto_baja: 'azul',
  pausa: 'naranja',
  activa: 'azul',
  deshacer: 'gris',
  descartada: 'gris',
  crear: 'violeta',
  otro: 'gris',
}

/** Los filtros por papel; EXACTA junta DOMINIO y ESTABILIDAD */
const FILTROS = [
  { id: 'todo', texto: 'Todo' },
  { id: 'AUTO RADAR', texto: 'AUTO' },
  { id: 'MANUAL AMPLIA', texto: 'AMPLIA' },
  { id: 'EXACTA', texto: 'EXACTA' },
  { id: 'ATAQUE ASIN', texto: 'ATAQUE' },
] as const
type IdFiltro = (typeof FILTROS)[number]['id']

const encajaRol = (rol: string | null, f: IdFiltro) => f === 'todo' || (f === 'EXACTA' ? (rol ?? '').includes('EXACTA') : rol === f)

const MAX_POR_DIA = 40

/** Los chips de resumen de un día: «↑ 12 pujas · ↓ 8 pujas · 5 negativas · 3 cosechas · Presupuesto: 2 suben, 3 bajan · 1 deshecho» */
function ChipsDeResumen({ r }: { r: ResumenDelDia }) {
  const chips: Array<{ texto: string; tono: TonoEstado }> = []
  if (r.pujasSuben) chips.push({ texto: `↑ ${r.pujasSuben} ${r.pujasSuben === 1 ? 'puja' : 'pujas'}`, tono: 'verde' })
  if (r.pujasBajan) chips.push({ texto: `↓ ${r.pujasBajan} ${r.pujasBajan === 1 ? 'puja' : 'pujas'}`, tono: 'azul' })
  if (r.negativas) chips.push({ texto: `${r.negativas} ${r.negativas === 1 ? 'negativa' : 'negativas'}`, tono: 'ambar' })
  if (r.cosechas) chips.push({ texto: `${r.cosechas} ${r.cosechas === 1 ? 'cosecha' : 'cosechas'}`, tono: 'verde' })
  if (r.pausas) chips.push({ texto: `${r.pausas} ${r.pausas === 1 ? 'pausa' : 'pausas'}`, tono: 'naranja' })
  if (r.presupuestosSuben || r.presupuestosBajan) {
    const p = [r.presupuestosSuben ? `${r.presupuestosSuben} ${r.presupuestosSuben === 1 ? 'sube' : 'suben'}` : '', r.presupuestosBajan ? `${r.presupuestosBajan} ${r.presupuestosBajan === 1 ? 'baja' : 'bajan'}` : ''].filter(Boolean).join(', ')
    chips.push({ texto: `Presupuesto: ${p}`, tono: 'azul' })
  }
  if (r.deshechos) chips.push({ texto: `${r.deshechos} ${r.deshechos === 1 ? 'deshecho' : 'deshechos'}`, tono: 'gris' })
  if (r.fallidos) chips.push({ texto: `${r.fallidos} ${r.fallidos === 1 ? 'fallido' : 'fallidos'}`, tono: 'rojo' })
  if (r.ensayos) chips.push({ texto: `${r.ensayos} en ensayo`, tono: 'cian' })
  if (chips.length === 0) return <span className="text-[12px] text-[var(--ls-t4)]">Sin cambios de pujas, negativas ni presupuestos</span>
  return (
    <span className="flex flex-wrap gap-1">
      {chips.map((c) => (
        <Insignia key={c.texto} tono={c.tono} tamano="sm">
          {c.texto}
        </Insignia>
      ))}
    </span>
  )
}

function LineaDeAccion({ a, conProducto }: { a: AccionDelDia; conProducto: boolean }) {
  const Icono = ICONO_DE_CLASE[a.clase]
  const color = COLOR_ESTADO[!a.ok ? 'rojo' : a.deshecho || a.ensayo ? 'gris' : TONO_DE_CLASE[a.clase]]
  return (
    <li className="flex gap-3 py-2">
      <span className="w-[42px] shrink-0 pt-[3px] text-[12px] tabular-nums text-[var(--ls-t4)]">{a.hora}</span>
      <span className="mt-[1px] flex h-[24px] w-[24px] shrink-0 items-center justify-center rounded-[8px]" style={{ color, background: `color-mix(in srgb, ${color} 13%, transparent)` }} aria-hidden>
        <Icono className="h-[13px] w-[13px]" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className={`flex flex-wrap items-center gap-x-2 gap-y-1 text-[13.5px] leading-[1.4] ${a.ok ? 'text-[var(--ls-t1)]' : 'text-[var(--ls-e-rojo)]'} ${a.deshecho ? 'line-through decoration-[var(--ls-t4)]' : ''}`}>
          <span className="min-w-0 break-words">{a.frase}</span>
          {a.de != null && a.a != null && (
            <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-[7px] bg-[var(--ls-sup2)] px-[6px] py-[1px] text-[12.5px] font-semibold tabular-nums no-underline" style={{ textDecoration: 'none' }}>
              <span className="text-[var(--ls-t3)]">{a.de}</span>
              <span className="text-[var(--ls-t4)]">→</span>
              <span style={{ color }}>{a.a}</span>
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {!a.ensayo && (
            <Insignia tono={a.quien.startsWith('Agente') ? 'verde' : a.quien.startsWith('Motor') ? 'naranja' : 'azul'} tamano="sm" variante="contorno">
              {a.quien || 'Sistema'}
            </Insignia>
          )}
          {a.rol && (
            <span className="inline-flex items-center gap-1 text-[11.5px] text-[var(--ls-t3)]">
              <span className="h-[6px] w-[6px] rounded-full" style={{ background: colorDeRol(a.rol) }} aria-hidden />
              {rolCorto(a.rol)}
              {conProducto && a.asin ? ` · ${a.asin}` : ''}
            </span>
          )}
          {a.deshecho && (
            <Insignia tono="gris" tamano="sm">
              Deshecho
            </Insignia>
          )}
          {a.ensayo && (
            <Insignia tono="cian" tamano="sm">
              Ensayo (no se hizo en Amazon)
            </Insignia>
          )}
          {!a.ok && (
            <Insignia tono="rojo" tamano="sm">
              Falló
            </Insignia>
          )}
        </div>
        {a.motivo && (
          <p className={`${a.ok ? 'line-clamp-2' : ''} break-words text-[12px] leading-[1.45] text-[var(--ls-t3)]`} title={a.motivo ?? undefined}>
            {a.motivo}
          </p>
        )}
      </div>
    </li>
  )
}

function Plegable({ titulo, icono: Icono, n, children }: { titulo: string; icono: LucideIcon; n: number; children: React.ReactNode }) {
  if (n === 0) return null
  return (
    <details className="group rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)]/40">
      <summary className="flex min-h-[40px] cursor-pointer list-none items-center gap-2 px-3 text-[13px] font-medium text-[var(--ls-t2)] [&::-webkit-details-marker]:hidden">
        <Icono className="h-[14px] w-[14px] text-[var(--ls-t4)]" aria-hidden />
        {titulo} ({n})
        <ChevronDown className="ml-auto h-4 w-4 text-[var(--ls-t4)] transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="border-t border-[var(--ls-linea)] px-3 py-2">{children}</div>
    </details>
  )
}

function BloqueDeDia({ d, conProducto }: { d: DiaDelDiario; conProducto: boolean }) {
  const [todas, setTodas] = useState(false)
  const visibles = todas ? d.acciones : d.acciones.slice(0, MAX_POR_DIA)
  const fecha = new Date(`${d.dia}T12:00:00Z`).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
  return (
    <section className="flex flex-col gap-2" aria-label={`${d.etiqueta}: ${fecha}`}>
      <header className="flex flex-col gap-2 border-b-2 pb-2" style={{ borderColor: d.etiqueta === 'Hoy' ? 'var(--ls-acc)' : 'var(--ls-linea2)' }}>
        <div className="flex flex-wrap items-baseline gap-2">
          <h3 className="text-[17px] font-semibold tracking-[-0.01em] text-[var(--ls-t1)]">{d.etiqueta}</h3>
          {(d.etiqueta === 'Hoy' || d.etiqueta === 'Ayer') && <span className="text-[12.5px] text-[var(--ls-t4)]">{fecha}</span>}
          <span className="ml-auto text-[12px] text-[var(--ls-t4)]">
            {d.acciones.length} {d.acciones.length === 1 ? 'cambio' : 'cambios'}
          </span>
        </div>
        <ChipsDeResumen r={d.resumen} />
      </header>
      {d.acciones.length > 0 ? (
        <ul className="divide-y divide-[var(--ls-linea)]">
          {visibles.map((a) => (
            <LineaDeAccion key={a.id} a={a} conProducto={conProducto} />
          ))}
        </ul>
      ) : (
        <p className="py-1 text-[12.5px] text-[var(--ls-t4)]">Ese día no se tocó nada en Amazon.</p>
      )}
      {!todas && d.acciones.length > MAX_POR_DIA && (
        <button type="button" onClick={() => setTodas(true)} className="min-h-[40px] self-start rounded-[10px] px-3 text-[13px] font-medium text-[var(--ls-acc)] hover:bg-[var(--ls-sup2)]">
          Ver los {d.acciones.length - MAX_POR_DIA} cambios restantes
        </button>
      )}
      <div className="flex flex-col gap-2">
        <Plegable titulo="No se ha hecho" icono={CircleX} n={d.noHechas.length}>
          <ul className="flex flex-col gap-2">
            {d.noHechas.slice(0, 100).map((x) => (
              <li key={x.id} className="text-[12.5px] leading-[1.45]">
                <span className="font-medium text-[var(--ls-t1)]">{x.tipo === 'promover' ? 'Cosechar' : x.tipo === 'negativizar' ? 'Negativizar' : x.tipo.charAt(0).toUpperCase() + x.tipo.slice(1)}</span>
                {x.termino && <span className="text-[var(--ls-t2)]"> «{x.termino}»</span>}
                {x.rol && <span className="text-[var(--ls-t4)]"> en {rolCorto(x.rol)}</span>}
                <span className="text-[var(--ls-t3)]"> — {x.motivo}</span>
              </li>
            ))}
            {d.noHechas.length > 100 && <li className="text-[12px] text-[var(--ls-t4)]">Y {d.noHechas.length - 100} más (están en «Propuestas»).</li>}
          </ul>
        </Plegable>
        <Plegable titulo="Notas del agente (de toda la cuenta)" icono={MessageSquareText} n={d.notas.length}>
          <ul className="flex flex-col gap-2">
            {d.notas.map((x) => (
              <li key={x.id} className="flex gap-2 text-[12.5px] leading-[1.45]">
                <span className="w-[42px] shrink-0 tabular-nums text-[var(--ls-t4)]">{x.hora}</span>
                <span className="min-w-0">
                  <span className="text-[var(--ls-t1)]">{x.titulo}</span>
                  {x.detalle && <span className="block text-[var(--ls-t3)]">{x.detalle}</span>}
                </span>
              </li>
            ))}
          </ul>
        </Plegable>
      </div>
    </section>
  )
}

/**
 * EL DIARIO POR DÍAS: un bloque por día bien marcado («Hoy», «Ayer», «mié 18 nov») con el resumen en chips y, debajo, una línea por cosa hecha (hora, icono, quién, de → a y
 * por qué). Lo deshecho sale tachado, los ensayos marcados y lo fallido en rojo. Plegados: lo que NO se ha hecho (y por qué) y las notas del agente. Sirve para un producto
 * (pestaña «Flujo») o para toda la cuenta (Log → «Por días»).
 */
export function DiarioPorDias({ diario, conProducto = false }: { diario: readonly DiaDelDiario[]; conProducto?: boolean }) {
  const [filtro, setFiltro] = useState<IdFiltro>('todo')
  const filtrado = useMemo(
    () =>
      filtro === 'todo'
        ? diario
        : diario
            .map((d) => {
              const acciones = d.acciones.filter((a) => encajaRol(a.rol, filtro))
              return { ...d, acciones, noHechas: d.noHechas.filter((x) => encajaRol(x.rol, filtro)), resumen: resumenDelDia(acciones) }
            })
            .filter((d) => d.acciones.length > 0 || d.noHechas.length > 0),
    [diario, filtro],
  )

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Filtrar por campaña">
        {FILTROS.map((f) => {
          const activo = f.id === filtro
          const color = f.id === 'todo' ? 'var(--ls-acc)' : colorDeRol(f.id === 'EXACTA' ? 'MANUAL EXACTA / DOMINIO' : f.id)
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => setFiltro(f.id)}
              aria-pressed={activo}
              className="inline-flex min-h-[32px] items-center gap-[6px] rounded-full border px-3 text-[12.5px] font-medium transition-colors [@media(pointer:coarse)]:min-h-[40px]"
              style={{ borderColor: activo ? color : 'var(--ls-linea)', color: activo ? color : 'var(--ls-t3)', background: activo ? `color-mix(in srgb, ${color} 12%, transparent)` : 'transparent' }}
            >
              {f.id !== 'todo' && <span className="h-[7px] w-[7px] rounded-full" style={{ background: color }} aria-hidden />}
              {f.texto}
            </button>
          )
        })}
      </div>
      {filtrado.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-8 text-center text-[13px] text-[var(--ls-t3)]">
          <CalendarDays className="h-6 w-6 text-[var(--ls-t4)]" aria-hidden />
          {filtro === 'todo' ? 'En estos días no se ha hecho nada.' : 'En estos días no se ha hecho nada en esta campaña.'}
        </div>
      ) : (
        filtrado.map((d) => <BloqueDeDia key={d.dia} d={d} conProducto={conProducto} />)
      )}
    </div>
  )
}
