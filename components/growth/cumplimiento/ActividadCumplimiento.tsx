'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Bot, Loader2, MessageSquare, RefreshCw, RotateCcw, SendHorizontal, Tag, Trash2, Wrench, History, Play } from 'lucide-react'
import { Avatar, cuandoFue, PanelLateral } from '@/components/ui-ls'
import { ImagenDeProducto } from '@/components/productos/ImagenDeProducto'
import { COLOR_ESTADO } from '@/lib/estilo/denso'
import { nombreMarketplace } from '@/components/plataforma/comun'
import type { EntradaRegistro, TipoRegistro } from '@/lib/cumplimiento/registro-servidor'

/**
 * CUMPLIMIENTO · ACTIVIDAD Y COMENTARIOS (migración 343). Decisión de Raúl (26 nov 2026): «que se pueda justificar por qué lo ha quitado del seguimiento y unos logs de acciones».
 *
 *   ActividadDelListing   dentro de una fila abierta: lo que se ha hecho con ESE listing (quién, cuándo, por qué) y los comentarios, con su caja para escribir.
 *   PanelDeActividad      el panel lateral con todo lo hecho en el cliente, por días, con la foto de cada producto y filtro por persona.
 *   MotivoParaQuitar      el campo obligatorio del diálogo «Eliminar del seguimiento», con motivos de un clic.
 */

export type Llamar = <T>(accion: string, extra?: Record<string, unknown>) => Promise<T>
type RespuestaRegistro = { registro: EntradaRegistro[]; faltaMigracion: boolean; yo: string }

const ICONO: Record<TipoRegistro, typeof Bot> = { comentario: MessageSquare, descartar: Trash2, recuperar: RotateCcw, revisar: RefreshCw, 'revisar-todo': Play, corregir: Wrench, precio: Tag }
const TONO: Record<TipoRegistro, string> = {
  comentario: COLOR_ESTADO.azul,
  descartar: COLOR_ESTADO.rojo,
  recuperar: COLOR_ESTADO.verde,
  revisar: 'var(--ls-t3)',
  'revisar-todo': 'var(--ls-t3)',
  corregir: COLOR_ESTADO.violeta ?? COLOR_ESTADO.azul,
  precio: COLOR_ESTADO.ambar,
}
const ACCION: Record<TipoRegistro, string> = {
  comentario: 'comentó',
  descartar: 'lo quitó del seguimiento',
  recuperar: 'lo volvió a seguir',
  revisar: 'lo revisó de nuevo en Amazon',
  'revisar-todo': 'lanzó una revisión de todo el cliente',
  corregir: 'corrigió la ficha desde el ERP',
  precio: 'tocó el precio',
}

export const MOTIVOS_RAPIDOS = ['No es nuestro producto', 'Ya no lo vendemos', 'Amazon no deja recuperarlo', 'Es un duplicado de otro SKU', 'Lo gestiona el cliente']

/* ------------------------------------------------------------------ */
/* Una entrada: cara, quién, qué, cuándo y el texto                   */
/* ------------------------------------------------------------------ */

function Cara({ e, tamano }: { e: EntradaRegistro; tamano: number }) {
  const Icono = ICONO[e.tipo]
  const tono = TONO[e.tipo]
  return (
    <span className="relative shrink-0">
      {e.autor ? (
        <Avatar nombre={e.autor} tamano={tamano} />
      ) : (
        <span className="flex items-center justify-center rounded-full bg-[var(--ls-sup3)] text-[var(--ls-t2)]" style={{ width: tamano, height: tamano }} title="Lo hizo el ERP solo">
          <Bot className="h-[45%] w-[45%]" />
        </span>
      )}
      {e.tipo !== 'comentario' && (
        <span className="absolute -bottom-[3px] -right-[4px] flex h-[16px] w-[16px] items-center justify-center rounded-full ring-2 ring-[var(--ls-sup)]" style={{ background: `color-mix(in srgb, ${tono} 24%, var(--ls-sup))`, color: tono }}>
          <Icono className="h-[9px] w-[9px]" />
        </span>
      )}
    </span>
  )
}

function Entrada({ e, yo, alBorrar, conProducto, mkt }: { e: EntradaRegistro; yo: string | null; alBorrar?: (id: string) => void; conProducto?: boolean; mkt?: string | null }) {
  const comentario = e.tipo === 'comentario'
  return (
    <li className="group flex items-start gap-[10px] py-[7px]">
      <Cara e={e} tamano={30} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-[6px]">
          <span className="text-[12.5px] font-semibold text-[var(--ls-t1)]">{e.autor ?? 'El ERP'}</span>
          {!comentario && <span className="text-[12.5px] text-[var(--ls-t2)]">{ACCION[e.tipo]}</span>}
          <span className="text-[11px] text-[var(--ls-t4)]" title={new Date(e.at).toLocaleString('es-ES')}>
            {cuandoFue(e.at)}
          </span>
          {comentario && e.autorId === yo && alBorrar && (
            <button type="button" onClick={() => alBorrar(e.id)} className="ml-auto opacity-0 transition-opacity focus:opacity-100 group-hover:opacity-100" aria-label="Borrar mi comentario" title="Borrar mi comentario">
              <Trash2 className="h-[12px] w-[12px] text-[var(--ls-t4)] hover:text-[var(--ls-t2)]" />
            </button>
          )}
        </div>
        {conProducto && e.sku && (
          <div className="mt-[5px] inline-flex max-w-full items-center gap-2 rounded-[9px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] py-[4px] pl-[4px] pr-[10px]">
            <span className="shrink-0 rounded-[6px] bg-white p-[2px]">
              <ImagenDeProducto asin={e.asin} mkt={e.mercado ?? mkt} lado={32} redondeo={5} />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[11.5px] font-medium text-[var(--ls-t1)]">{e.sku}</span>
              <span className="block text-[10.5px] text-[var(--ls-t4)]">
                {e.mercado ? nombreMarketplace(e.mercado) : ''}
                {e.asin ? ` · ${e.asin}` : ''}
              </span>
            </span>
          </div>
        )}
        {e.texto && (
          <p
            className={`mt-[3px] whitespace-pre-wrap break-words text-[12.5px] leading-[1.5] ${comentario || e.tipo === 'descartar' || e.tipo === 'recuperar' ? 'rounded-[10px] rounded-tl-[3px] bg-[var(--ls-sup)] px-3 py-[7px] text-[var(--ls-t2)]' : 'text-[var(--ls-t3)]'}`}
            style={e.tipo === 'descartar' ? { boxShadow: `inset 3px 0 0 ${COLOR_ESTADO.rojo}` } : undefined}
          >
            {e.tipo === 'descartar' && <span className="font-semibold text-[var(--ls-t1)]">Motivo: </span>}
            {e.texto}
          </p>
        )}
        {e.tipo === 'descartar' && !e.texto && <p className="mt-[2px] text-[11.5px] italic text-[var(--ls-t4)]">Sin motivo (se quitó antes de que se pidiera)</p>}
      </div>
    </li>
  )
}

/* ------------------------------------------------------------------ */
/* Dentro de una fila abierta                                          */
/* ------------------------------------------------------------------ */

export function ActividadDelListing({ llamar, mercado, sku, asin, alCambiarComentarios }: { llamar: Llamar; mercado: string; sku: string; asin: string | null; alCambiarComentarios?: (n: number) => void }) {
  const [datos, setDatos] = useState<RespuestaRegistro | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [texto, setTexto] = useState('')
  const [enviando, setEnviando] = useState(false)
  const caja = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    let vivo = true
    llamar<RespuestaRegistro>('registro', { mercado, sku })
      .then((r) => vivo && setDatos(r))
      .catch((e) => vivo && setError(e instanceof Error ? e.message : 'No se ha podido leer la actividad.'))
    return () => {
      vivo = false
    }
  }, [llamar, mercado, sku])

  const lista = useMemo(() => (datos?.registro ?? []).slice().sort((a, b) => a.at.localeCompare(b.at)), [datos])
  const avisar = useCallback((l: EntradaRegistro[]) => alCambiarComentarios?.(l.filter((e) => e.tipo === 'comentario').length), [alCambiarComentarios])

  const enviar = async () => {
    const t = texto.trim()
    if (!t || enviando || !datos) return
    setEnviando(true)
    setError(null)
    try {
      const r = await llamar<{ comentario: EntradaRegistro }>('comentar', { mercado, sku, asin, texto: t })
      const nuevo = [r.comentario, ...datos.registro]
      setDatos({ ...datos, registro: nuevo })
      avisar(nuevo)
      setTexto('')
      caja.current?.focus()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se ha podido guardar el comentario.')
    } finally {
      setEnviando(false)
    }
  }
  const borrar = async (id: string) => {
    if (!datos) return
    try {
      await llamar('borrar-comentario', { id })
      const nuevo = datos.registro.filter((e) => e.id !== id)
      setDatos({ ...datos, registro: nuevo })
      avisar(nuevo)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se ha podido borrar.')
    }
  }

  return (
    <div className="flex min-w-0 flex-col rounded-[12px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] p-3">
      <div className="flex items-center gap-2">
        <History className="h-[13px] w-[13px] text-[var(--ls-t3)]" />
        <span className="text-[12.5px] font-semibold text-[var(--ls-t1)]">Actividad y comentarios</span>
        {datos && <span className="text-[11px] text-[var(--ls-t4)]">{lista.length === 0 ? 'nada todavía' : `${lista.length} ${lista.length === 1 ? 'entrada' : 'entradas'}`}</span>}
      </div>
      {!datos && !error && (
        <p className="mt-2 flex items-center gap-2 text-[12px] text-[var(--ls-t4)]">
          <Loader2 className="h-3 w-3 animate-spin" /> Cargando…
        </p>
      )}
      {datos?.faltaMigracion && <p className="mt-2 text-[12px] text-[var(--ls-t4)]">La actividad y los comentarios estarán en cuanto se lance la migración 343.</p>}
      {datos && !datos.faltaMigracion && (
        <>
          {lista.length === 0 && <p className="mt-2 text-[12px] text-[var(--ls-t4)]">Nadie ha hecho nada con este listing desde el ERP. Deja una nota: qué se ha pedido, a quién, qué falta…</p>}
          <ol className="mt-1 flex max-h-[320px] flex-col overflow-y-auto">
            {lista.map((e) => (
              <Entrada key={e.id} e={e} yo={datos.yo} alBorrar={(id) => void borrar(id)} />
            ))}
          </ol>
          <div className="mt-2 flex items-end gap-2">
            <textarea
              ref={caja}
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  void enviar()
                }
              }}
              rows={Math.min(5, Math.max(1, texto.split('\n').length))}
              maxLength={2000}
              placeholder="Escribe un comentario…  (Intro para enviar)"
              className="min-h-[34px] flex-1 resize-none rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-3 py-[7px] text-[12.5px] text-[var(--ls-t1)] outline-none placeholder:text-[var(--ls-t4)] focus:border-[color-mix(in_srgb,var(--ls-acento,var(--ls-acc))_55%,var(--ls-linea))]"
            />
            <button type="button" onClick={() => void enviar()} disabled={!texto.trim() || enviando} aria-label="Enviar comentario" className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] text-[#141414] transition-opacity disabled:opacity-40" style={{ background: 'var(--ls-acento, var(--ls-acc))' }}>
              {enviando ? <Loader2 className="h-[14px] w-[14px] animate-spin" /> : <SendHorizontal className="h-[14px] w-[14px]" />}
            </button>
          </div>
        </>
      )}
      {error && <p className="mt-2 text-[12px]" style={{ color: COLOR_ESTADO.rojo }}>{error}</p>}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* El panel lateral con todo lo hecho en el cliente                    */
/* ------------------------------------------------------------------ */

type FiltroPanel = '' | 'comentario' | 'descartar' | 'cambios'

export function PanelDeActividad({ abierto, onCambio, llamar, nombre, mercado }: { abierto: boolean; onCambio: (a: boolean) => void; llamar: Llamar; nombre: string; mercado: string }) {
  const [datos, setDatos] = useState<RespuestaRegistro | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [persona, setPersona] = useState('')
  const [tipo, setTipo] = useState<FiltroPanel>('')

  useEffect(() => {
    if (!abierto) return
    let vivo = true
    setError(null)
    llamar<RespuestaRegistro>('registro', { mercado: mercado === 'todos' ? undefined : mercado })
      .then((r) => vivo && setDatos(r))
      .catch((e) => vivo && setError(e instanceof Error ? e.message : 'No se ha podido leer la actividad.'))
    return () => {
      vivo = false
    }
  }, [abierto, llamar, mercado])

  const todos = useMemo(() => datos?.registro ?? [], [datos])
  const equipo = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of todos) if (e.autor) m.set(e.autor, (m.get(e.autor) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [todos])
  const visibles = todos.filter(
    (e) => (!persona || e.autor === persona) && (!tipo || (tipo === 'cambios' ? e.tipo === 'corregir' || e.tipo === 'precio' : tipo === 'descartar' ? e.tipo === 'descartar' || e.tipo === 'recuperar' : e.tipo === tipo)),
  )
  const dias = useMemo(() => {
    const m = new Map<string, EntradaRegistro[]>()
    for (const e of visibles) {
      const k = new Date(e.at).toLocaleDateString('sv-SE')
      m.set(k, [...(m.get(k) ?? []), e])
    }
    return [...m.entries()]
  }, [visibles])
  const hoy = new Date().toLocaleDateString('sv-SE')
  const ayer = new Date(Date.now() - 86_400_000).toLocaleDateString('sv-SE')
  const rotuloDia = (k: string, at: string) => (k === hoy ? 'Hoy' : k === ayer ? 'Ayer' : new Date(at).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }).replace(/^./, (l) => l.toUpperCase()))

  const CHIPS: Array<[FiltroPanel, string]> = [
    ['', 'Todo'],
    ['comentario', 'Comentarios'],
    ['descartar', 'Quitados y recuperados'],
    ['cambios', 'Correcciones y precios'],
  ]

  return (
    <PanelLateral abierto={abierto} onCambio={onCambio} titulo="Actividad del equipo" descripcion={`Quién ha hecho qué en ${nombre} y por qué`} icono={History} acento="cumplimiento" ancho={560}>
      <div className="flex flex-col gap-3">
        {equipo.length > 0 && (
          <div className="flex flex-wrap items-center gap-[6px]">
            {equipo.map(([n, k]) => (
              <button
                key={n}
                type="button"
                onClick={() => setPersona(persona === n ? '' : n)}
                title={`${n} · ${k} ${k === 1 ? 'acción' : 'acciones'}`}
                className="inline-flex items-center gap-[6px] rounded-full border py-[3px] pl-[3px] pr-[10px] text-[12px] transition-colors"
                style={persona === n ? { borderColor: 'var(--ls-acento, var(--ls-acc))', background: 'color-mix(in srgb, var(--ls-acento, var(--ls-acc)) 12%, transparent)', color: 'var(--ls-t1)' } : { borderColor: 'var(--ls-linea)', color: 'var(--ls-t2)', opacity: persona ? 0.55 : 1 }}
              >
                <Avatar nombre={n} tamano={22} /> {n.split(' ')[0]} <span className="tabular-nums text-[var(--ls-t4)]">{k}</span>
              </button>
            ))}
          </div>
        )}
        <div className="flex flex-wrap gap-[6px]">
          {CHIPS.map(([v, t]) => (
            <button key={v || 'todo'} type="button" onClick={() => setTipo(v)} className="h-7 rounded-full border px-3 text-[12px]" style={tipo === v ? { borderColor: 'var(--ls-acento, var(--ls-acc))', color: 'var(--ls-t1)', background: 'color-mix(in srgb, var(--ls-acento, var(--ls-acc)) 12%, transparent)' } : { borderColor: 'var(--ls-linea)', color: 'var(--ls-t3)' }}>
              {t}
            </button>
          ))}
        </div>
        {!datos && !error && (
          <p className="flex items-center gap-2 text-[12.5px] text-[var(--ls-t4)]">
            <Loader2 className="h-3 w-3 animate-spin" /> Cargando la actividad…
          </p>
        )}
        {error && <p className="text-[12.5px]" style={{ color: COLOR_ESTADO.rojo }}>{error}</p>}
        {datos?.faltaMigracion && <p className="text-[12.5px] text-[var(--ls-t4)]">Falta lanzar la migración 343 en Supabase: hasta entonces no se guarda la actividad.</p>}
        {datos && !datos.faltaMigracion && visibles.length === 0 && <p className="text-[12.5px] text-[var(--ls-t4)]">Nada registrado con estos filtros.</p>}
        {dias.map(([k, lista]) => (
          <section key={k}>
            <div className="sticky top-0 z-[1] flex items-center gap-2 bg-[var(--ls-sup)] py-1">
              <span className="text-[12px] font-semibold text-[var(--ls-t1)]">{rotuloDia(k, lista[0].at)}</span>
              <span className="h-px flex-1 bg-[var(--ls-linea)]" />
              <span className="text-[11px] text-[var(--ls-t4)]">{lista.length}</span>
            </div>
            <ol className="flex flex-col">
              {lista.map((e) => (
                <Entrada key={e.id} e={e} yo={datos?.yo ?? null} conProducto mkt={mercado === 'todos' ? null : mercado} />
              ))}
            </ol>
          </section>
        ))}
      </div>
    </PanelLateral>
  )
}

/* ------------------------------------------------------------------ */
/* El motivo obligatorio para quitar del seguimiento                   */
/* ------------------------------------------------------------------ */

export function MotivoParaQuitar({ motivo, setMotivo }: { motivo: string; setMotivo: (m: string) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <label className="text-[12.5px] font-semibold text-[var(--ls-t1)]" htmlFor="motivo-quitar">
        ¿Por qué? <span className="font-normal text-[var(--ls-t4)]">(obligatorio: queda en la actividad con tu nombre)</span>
      </label>
      <div className="flex flex-wrap gap-[6px]">
        {MOTIVOS_RAPIDOS.map((m) => (
          <button key={m} type="button" onClick={() => setMotivo(m)} className="h-7 rounded-full border px-3 text-[12px]" style={motivo === m ? { borderColor: 'var(--ls-acento, var(--ls-acc))', color: 'var(--ls-t1)', background: 'color-mix(in srgb, var(--ls-acento, var(--ls-acc)) 12%, transparent)' } : { borderColor: 'var(--ls-linea)', color: 'var(--ls-t2)' }}>
            {m}
          </button>
        ))}
      </div>
      <textarea
        id="motivo-quitar"
        value={motivo}
        onChange={(e) => setMotivo(e.target.value)}
        rows={3}
        maxLength={2000}
        placeholder="Explica el motivo: qué se ha comprobado, con quién se ha hablado…"
        className="resize-none rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-3 py-2 text-[12.5px] text-[var(--ls-t1)] outline-none placeholder:text-[var(--ls-t4)] focus:border-[color-mix(in_srgb,var(--ls-acento,var(--ls-acc))_55%,var(--ls-linea))]"
      />
    </div>
  )
}
