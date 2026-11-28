'use client'

import { useMemo, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { AlertTriangle, ArrowRight, ArrowUpDown, ChevronLeft, ClipboardCheck, LayoutGrid, Megaphone, Rows3, Search, SearchCheck, Truck } from 'lucide-react'
import { CabeceraDeModulo, Segmentado } from '@/components/ui-ls'

/** El icono va por nombre: un componente no puede viajar del servidor (la página) al navegador */
const ICONOS = { ppc: Megaphone, seo: SearchCheck, remesas: Truck, cumplimiento: ClipboardCheck } as const
export type IconoDelPanel = keyof typeof ICONOS

/**
 * EL PANEL DE TODOS LOS CLIENTES DE UN MÓDULO («vista de pájaro», como «Todas las cuentas» de Ventas). Lo usan SEO, PPC, Remesas y Cumplimiento
 * como pantalla de inicio: una tarjeta por cliente con las cifras de ESE módulo, un resumen arriba, buscador, orden y tarjetas o tabla. Pulsar un
 * cliente abre el módulo en ese cliente (`href`). Solo pinta: cada módulo calcula sus cifras en el servidor y las pasa ya hechas.
 *
 * Móvil primero: una columna de tarjetas compactas y todo en el ancho; desde md, 2–4 columnas o la tabla.
 */

export type Tono = 'verde' | 'ambar' | 'rojo' | 'azul' | 'violeta' | 'gris' | 'naranja'
const COLOR: Record<Tono, string> = { verde: '#34D399', ambar: '#F5B942', rojo: '#F87171', azul: '#38BDF8', violeta: '#A78BFA', gris: 'var(--ls-t2)', naranja: '#FF8A3D' }

export interface CifraDeCliente {
  /** Rótulo corto (cabe en 1/3 de una tarjeta de móvil): «Ventas 7 d», «ACOS», «Bloqueos» */
  texto: string
  /** Ya formateado: «1.234,56 €», «23 %», «4» */
  valor: string
  tono?: Tono
  /** Para ordenar por esta cifra (si falta, no se ordena por ella) */
  orden?: number
  /** Ayuda al pasar el ratón */
  ayuda?: string
}

export interface ClienteDelPanel {
  /** Clave única (slug o id) */
  id: string
  nombre: string
  /** Línea pequeña debajo del nombre: «3 países · ES, DE, FR» */
  sub?: string
  /** Emoji del cliente (si lo hay) o se pintan sus iniciales */
  emoji?: string | null
  /** A dónde lleva pulsar la tarjeta: el módulo abierto en este cliente */
  href: string
  /** La cifra grande de la tarjeta */
  principal?: CifraDeCliente
  /** 2 a 4 cifras pequeñas debajo */
  cifras: CifraDeCliente[]
  /** Aviso (lo que hay que mirar ya): sale en rojo/ámbar arriba de la tarjeta y lo cuenta el resumen */
  aviso?: { texto: string; tono: 'rojo' | 'ambar' } | null
  /** Sin datos todavía (sin cuenta conectada, sin lecturas…): la tarjeta sale apagada con este texto */
  sinDatos?: string | null
}

export interface ResumenDelPanel {
  texto: string
  valor: string
  tono?: Tono
}

const iniciales = (n: string) =>
  n
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('')

export function PanelDeClientes({
  titulo,
  subtitulo,
  icono,
  clientes,
  resumen = [],
  acciones,
  vacio = 'Ningún cliente tiene datos en este módulo todavía.',
  incrustado = false,
}: {
  titulo: string
  subtitulo?: string
  icono: IconoDelPanel
  clientes: ClienteDelPanel[]
  /** Las cifras de arriba (todas las cuentas juntas): 2 a 5 */
  resumen?: ResumenDelPanel[]
  acciones?: ReactNode
  vacio?: string
  /** Dentro de un módulo que ya pinta su cabecera (Remesas): sin la suya */
  incrustado?: boolean
}) {
  const [q, setQ] = useState('')
  const [orden, setOrden] = useState<string>('aviso')
  const [vista, setVista] = useState<'tarjetas' | 'tabla'>('tarjetas')
  const columnasOrden = useMemo(() => {
    const vistos = new Map<string, string>()
    for (const c of clientes) for (const x of [c.principal, ...c.cifras]) if (x && x.orden != null && !vistos.has(x.texto)) vistos.set(x.texto, x.texto)
    return [...vistos.keys()]
  }, [clientes])
  const conAviso = clientes.filter((c) => c.aviso).length

  const lista = useMemo(() => {
    const t = q.trim().toLowerCase()
    const valor = (c: ClienteDelPanel) => [c.principal, ...c.cifras].find((x) => x?.texto === orden)?.orden ?? -Infinity
    return clientes
      .filter((c) => !t || c.nombre.toLowerCase().includes(t) || (c.sub ?? '').toLowerCase().includes(t))
      .sort((a, b) => {
        if (orden === 'nombre') return a.nombre.localeCompare(b.nombre, 'es')
        if (orden === 'aviso') return Number(Boolean(b.aviso)) - Number(Boolean(a.aviso)) || (b.aviso?.tono === 'rojo' ? 1 : 0) - (a.aviso?.tono === 'rojo' ? 1 : 0) || Number(Boolean(a.sinDatos)) - Number(Boolean(b.sinDatos)) || a.nombre.localeCompare(b.nombre, 'es')
        return valor(b) - valor(a) || a.nombre.localeCompare(b.nombre, 'es')
      })
  }, [clientes, q, orden])

  return (
    <div className="w-full min-w-0 pb-8 lg:px-1">
      <div className={incrustado ? 'hidden' : 'hidden sm:block'}>
        <CabeceraDeModulo icono={ICONOS[icono]} acento="marca" titulo={titulo} subtitulo={subtitulo} acciones={acciones} />
      </div>
      {acciones && <div className="mb-2 flex justify-end sm:hidden">{acciones}</div>}

      {/* El resumen de todos */}
      {resumen.length > 0 && (
        <div className="mt-1 grid grid-cols-2 gap-2 sm:mt-4 sm:grid-cols-3 sm:gap-3 lg:grid-cols-5">
          {resumen.map((r, i) => (
            <div key={r.texto} className={`min-w-0 rounded-[16px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] px-3 py-2.5 sm:px-4 sm:py-3 ${i === 0 && resumen.length % 2 === 1 ? 'max-sm:col-span-2' : ''}`}>
              <div className="truncate text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--ls-t4)]">{r.texto}</div>
              <div className="mt-1 truncate text-[19px] font-semibold tabular-nums sm:text-[22px]" style={{ color: r.tono ? COLOR[r.tono] : 'var(--ls-t1)' }}>
                {r.valor}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Buscar, ordenar y vista: una fila */}
      <div className="mt-3 flex items-center gap-2 sm:mt-4">
        <label className="relative flex h-10 min-w-0 flex-1 items-center rounded-[12px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] sm:max-w-[320px]">
          <Search className="pointer-events-none absolute left-3 h-4 w-4 text-[var(--ls-t4)]" aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Buscar entre ${clientes.length} clientes`} aria-label="Buscar cliente" className="h-full w-full bg-transparent pl-9 pr-3 text-[16px] text-[var(--ls-t1)] outline-none placeholder:text-[var(--ls-t4)] sm:text-[13px]" />
        </label>
        <label className="relative inline-flex h-10 shrink-0 items-center gap-1.5 rounded-[12px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] px-2.5 text-[12.5px] text-[var(--ls-t2)]">
          <ArrowUpDown className="h-[14px] w-[14px] text-[var(--ls-t4)]" aria-hidden />
          <select value={orden} onChange={(e) => setOrden(e.target.value)} aria-label="Ordenar" className="max-w-[120px] bg-transparent text-[16px] outline-none sm:max-w-none sm:text-[12.5px]">
            <option value="aviso">Lo urgente primero</option>
            {columnasOrden.map((c) => (
              <option key={c} value={c}>
                Más {c.toLowerCase()}
              </option>
            ))}
            <option value="nombre">Por nombre</option>
          </select>
        </label>
        <Segmentado
          etiqueta="Vista"
          tamano="sm"
          className="hidden shrink-0 md:inline-flex"
          valor={vista}
          onCambio={setVista}
          opciones={[
            { id: 'tarjetas', texto: 'Tarjetas', icono: LayoutGrid },
            { id: 'tabla', texto: 'Tabla', icono: Rows3 },
          ]}
        />
      </div>
      {conAviso > 0 && orden === 'aviso' && !q && (
        <p className="mt-2 flex items-center gap-1.5 text-[12px] text-[var(--ls-t3)]">
          <AlertTriangle className="h-3.5 w-3.5 text-[#F5B942]" aria-hidden /> {conAviso} {conAviso === 1 ? 'cliente necesita' : 'clientes necesitan'} que les mires algo: van primero.
        </p>
      )}

      {lista.length === 0 ? (
        <p className="py-16 text-center text-[13px] text-[var(--ls-t4)]">{clientes.length ? 'Ningún cliente se llama así.' : vacio}</p>
      ) : vista === 'tabla' ? (
        <TablaDeClientes lista={lista} />
      ) : (
        <div className="mt-3 grid grid-cols-1 gap-2.5 sm:gap-3 md:grid-cols-2 xl:grid-cols-3 min-[1500px]:grid-cols-4">
          {lista.map((c, i) => (
            <TarjetaDeCliente key={c.id} c={c} i={i} />
          ))}
        </div>
      )}
    </div>
  )
}

function Insignia({ c }: { c: ClienteDelPanel }) {
  return c.emoji ? (
    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[12px] bg-[var(--ls-sup2)] text-[20px]">{c.emoji}</span>
  ) : (
    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[12px] bg-[color-mix(in_srgb,#F26212_16%,var(--ls-sup2))] text-[13px] font-bold text-[#FF8A3D]">{iniciales(c.nombre) || '·'}</span>
  )
}

function TarjetaDeCliente({ c, i }: { c: ClienteDelPanel; i: number }) {
  const acento = c.aviso ? COLOR[c.aviso.tono] : '#F26212'
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, delay: Math.min(i, 12) * 0.03, ease: [0.2, 0.8, 0.2, 1] }}>
      <Link
        href={c.href}
        className={`group relative block overflow-hidden rounded-[18px] border bg-[var(--ls-sup)] p-3.5 transition-transform duration-200 hover:-translate-y-[2px] sm:p-4 ${c.sinDatos ? 'opacity-60' : ''}`}
        style={{ borderColor: c.aviso ? `color-mix(in srgb, ${acento} 45%, var(--ls-linea))` : 'var(--ls-linea)' }}
      >
        <div aria-hidden className="pointer-events-none absolute -right-10 -top-16 h-[140px] w-[220px] rounded-full opacity-[0.1] blur-[50px] transition-opacity group-hover:opacity-[0.2]" style={{ background: acento }} />
        <div className="flex items-center gap-3">
          <Insignia c={c} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[14px] font-semibold text-[var(--ls-t1)]">{c.nombre}</div>
            {c.sub && <div className="truncate text-[11.5px] text-[var(--ls-t4)]">{c.sub}</div>}
          </div>
          <ArrowRight className="h-4 w-4 shrink-0 text-[var(--ls-t4)] transition-transform group-hover:translate-x-0.5" aria-hidden />
        </div>
        {c.aviso && (
          <div className="mt-2.5 flex items-start gap-1.5 rounded-[10px] px-2.5 py-1.5 text-[12px] font-medium" style={{ background: `color-mix(in srgb, ${acento} 13%, transparent)`, color: acento }}>
            <AlertTriangle className="mt-[1px] h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="line-clamp-2">{c.aviso.texto}</span>
          </div>
        )}
        {c.sinDatos ? (
          <p className="mt-3 text-[12px] text-[var(--ls-t4)]">{c.sinDatos}</p>
        ) : (
          <>
            {c.principal && (
              <div className="mt-3">
                <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--ls-t4)]">{c.principal.texto}</div>
                <div className="truncate text-[22px] font-semibold leading-tight tracking-[-0.02em] tabular-nums" style={{ color: c.principal.tono ? COLOR[c.principal.tono] : 'var(--ls-t1)' }} title={c.principal.ayuda}>
                  {c.principal.valor}
                </div>
              </div>
            )}
            {c.cifras.length > 0 && (
              <div className={`mt-2.5 grid divide-x divide-[color-mix(in_srgb,var(--ls-t1)_7%,transparent)] rounded-[11px] border border-[color-mix(in_srgb,var(--ls-t1)_6%,transparent)] bg-[color-mix(in_srgb,var(--ls-sup2)_72%,transparent)] py-[6px] ${c.cifras.length >= 4 ? 'grid-cols-4' : c.cifras.length === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
                {c.cifras.slice(0, 4).map((x) => (
                  <div key={x.texto} className="min-w-0 px-2" title={x.ayuda}>
                    <div className="truncate text-[9px] font-semibold uppercase tracking-[0.08em] text-[var(--ls-t4)]">{x.texto}</div>
                    <div className="truncate text-[12.5px] font-semibold tabular-nums" style={{ color: x.tono ? COLOR[x.tono] : 'var(--ls-t1)' }}>
                      {x.valor}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </Link>
    </motion.div>
  )
}

function TablaDeClientes({ lista }: { lista: ClienteDelPanel[] }) {
  const columnas = [...new Set(lista.flatMap((c) => [c.principal?.texto, ...c.cifras.map((x) => x.texto)].filter((x): x is string => Boolean(x))))]
  return (
    <div className="mt-3 overflow-x-auto rounded-[18px] border border-[var(--ls-linea)] bg-[var(--ls-sup)]">
      <table className="w-full min-w-[760px] text-[13px]">
        <thead className="border-b border-[var(--ls-linea)]">
          <tr>
            <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--ls-t4)]">Cliente</th>
            {columnas.map((c) => (
              <th key={c} className="px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-[var(--ls-t4)]">
                {c}
              </th>
            ))}
            <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--ls-t4)]">Aviso</th>
          </tr>
        </thead>
        <tbody>
          {lista.map((c) => {
            const todas = [c.principal, ...c.cifras].filter((x): x is CifraDeCliente => Boolean(x))
            return (
              <tr key={c.id} className="border-b border-[var(--ls-linea)] last:border-0 hover:bg-[color-mix(in_srgb,var(--ls-sup2)_70%,transparent)]">
                <td className="px-3 py-2">
                  <Link href={c.href} className="flex items-center gap-2.5">
                    <Insignia c={c} />
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-[var(--ls-t1)]">{c.nombre}</span>
                      {c.sub && <span className="block truncate text-[11px] text-[var(--ls-t4)]">{c.sub}</span>}
                    </span>
                  </Link>
                </td>
                {columnas.map((col) => {
                  const x = todas.find((y) => y.texto === col)
                  return (
                    <td key={col} className="px-3 text-right tabular-nums" style={{ color: x?.tono ? COLOR[x.tono] : 'var(--ls-t2)' }} title={x?.ayuda}>
                      {c.sinDatos ? '—' : (x?.valor ?? '—')}
                    </td>
                  )
                })}
                <td className="max-w-[260px] truncate px-3 text-[12px]" style={{ color: c.aviso ? COLOR[c.aviso.tono] : 'var(--ls-t4)' }}>
                  {c.aviso?.texto ?? (c.sinDatos ? c.sinDatos : '')}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** «‹ Todos los clientes»: encima del módulo cuando se está en un cliente, para volver al panel */
export function VolverATodos({ href }: { href: string }) {
  return (
    <Link href={href} className="mb-2 inline-flex h-8 w-fit shrink-0 items-center gap-1 rounded-[10px] px-2 text-[12.5px] font-medium text-[var(--ls-t3)] transition-colors hover:bg-[var(--ls-sup2)] hover:text-[var(--ls-t1)]">
      <ChevronLeft className="h-4 w-4" aria-hidden /> Todos los clientes
    </Link>
  )
}
