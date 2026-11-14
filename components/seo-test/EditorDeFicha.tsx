'use client'

import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { toast } from 'sonner'
import { CircleAlert, CircleCheck, Clock, History, PencilLine, RotateCcw, Send, ShieldCheck, Sparkles, TriangleAlert, XCircle } from 'lucide-react'
import { Boton, Confirmacion, Insignia, LineaDeTiempo, Tarjeta, mezcla, ACENTO, type Hito } from '@/components/ui-ls'
import { COLOR_ESTADO, type TonoEstado } from '@/lib/estilo/denso'
import { bloqueosDeEdicion, camposCambiados, medidasDeEdicion, MAX_VINETAS, NOMBRE_DE_CAMPO, normalizarTexto, type CampoFicha, type TextosFicha } from '@/lib/seo/edicion'
import type { EdicionGuardada } from '@/lib/seo/edicion-servidor'
import type { FichaGuardada } from '@/lib/seo/datos'
import { trozosNuevos } from '@/lib/seo/propuesta'
import type { ventanaDeCambio } from '@/lib/seo/tareas'
import { useDelProducto } from './useDelProducto'

type Issue = { message?: string; code?: string; severity?: string }

/** Un POST que devuelve el JSON, o lanza con el motivo y las incidencias de Amazon */
async function enviar<T>(cuerpo: unknown): Promise<T> {
  const res = await fetch('/api/seo/ediciones', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo), cache: 'no-store' })
  const j = (await res.json().catch(() => ({}))) as T & { error?: string; issues?: Issue[] }
  if (!res.ok) throw Object.assign(new Error(j.error ?? `Error ${res.status}`), { issues: j.issues ?? [] })
  return j
}

const textosDeFicha = (f: FichaGuardada): TextosFicha => ({
  titulo: f.titulo ?? '',
  highlights: f.highlights ?? '',
  bullets: [...f.bullets, ...Array(Math.max(0, MAX_VINETAS - f.bullets.length)).fill('')].slice(0, MAX_VINETAS),
  descripcion: f.descripcion ?? '',
  backend: f.backend ?? '',
})

const ESTADO: Record<EdicionGuardada['estado'], { texto: string; tono: TonoEstado }> = {
  validada: { texto: 'Validada, sin mandar', tono: 'azul' },
  rechazada: { texto: 'Amazon no la acepta', tono: 'rojo' },
  enviada: { texto: 'Enviada · comprobando', tono: 'ambar' },
  aplicada: { texto: 'Aplicada en la ficha', tono: 'verde' },
  no_aplicada: { texto: 'No ha quedado', tono: 'rojo' },
  parcial: { texto: 'Aplicada a medias', tono: 'ambar' },
  error: { texto: 'Error al mandar', tono: 'rojo' },
}

/**
 * EL EDITOR DE FICHA. Título, Item Highlights, viñetas, descripción y backend con los contadores de la norma de 2026 en vivo, la diferencia antes/después
 * y dos pasos a propósito: «Validar en Amazon» (VALIDATION_PREVIEW: no cambia nada) y «Aplicar» con confirmación. Cada envío queda apuntado (quién,
 * cuándo, qué dijo Amazon) y, al releer la ficha, se comprueba si de verdad ha quedado.
 */
export function EditorDeFicha({ cuentaId, asin, ficha, ventana, onAplicada }: { cuentaId: string; asin: string; ficha: FichaGuardada; ventana: ReturnType<typeof ventanaDeCambio>; onAplicada?: () => void }) {
  const original = useMemo(() => textosDeFicha(ficha), [ficha])
  const [abierto, setAbierto] = useState(false)
  const [t, setT] = useState<TextosFicha>(original)
  const [validando, setValidando] = useState(false)
  const [validada, setValidada] = useState<{ id: string | null; huella: string; avisos: string[]; issues: Issue[]; ventanaCerrada: boolean } | null>(null)
  const [rechazo, setRechazo] = useState<{ motivo: string; issues: Issue[] } | null>(null)
  const [confirmar, setConfirmar] = useState(false)
  const [saltarVentana, setSaltarVentana] = useState(false)
  const historial = useDelProducto<{ ediciones: EdicionGuardada[]; sinMigracion: boolean }>(`/api/seo/ediciones?cuenta=${encodeURIComponent(cuentaId)}&asin=${asin}`)

  useEffect(() => setT(original), [original])

  const campos = useMemo(() => camposCambiados(original, t), [original, t])
  const { bloqueos, incidencias } = useMemo(() => bloqueosDeEdicion(t, campos), [t, campos])
  const medidas = useMemo(() => medidasDeEdicion(t), [t])
  const huella = JSON.stringify(t)
  // Si se toca algo después de validar, hay que volver a validar
  const vigente = validada && validada.huella === huella ? validada : null
  const tocaTitulo = campos.includes('titulo')

  const cambiar = <K extends keyof TextosFicha>(k: K, v: TextosFicha[K]) => {
    setT((x) => ({ ...x, [k]: v }))
    setRechazo(null)
  }

  async function validar() {
    setValidando(true)
    setRechazo(null)
    try {
      const r = await enviar<{ edicion: EdicionGuardada | null; avisos: string[]; issues: Issue[]; ventana: { bloqueada: boolean } | null }>({ cuenta: cuentaId, accion: 'validar', asin, despues: { ...t, bullets: t.bullets.filter((b) => normalizarTexto(b)) } })
      setValidada({ id: r.edicion?.id ?? null, huella, avisos: r.avisos, issues: r.issues, ventanaCerrada: Boolean(r.ventana?.bloqueada) })
      toast.success('Amazon lo acepta. Todavía no se ha cambiado nada.')
      void historial.recargar()
    } catch (e) {
      setValidada(null)
      setRechazo({ motivo: e instanceof Error ? e.message : 'No se ha podido validar.', issues: (e as { issues?: Issue[] }).issues ?? [] })
      void historial.recargar()
    } finally {
      setValidando(false)
    }
  }

  async function aplicar() {
    if (!vigente?.id) return
    try {
      const r = await enviar<{ avisos: string | null }>({ cuenta: cuentaId, accion: 'aplicar', id: vigente.id, saltarVentana })
      toast.success(r.avisos ? `Enviado a Amazon con avisos: ${r.avisos}` : 'Enviado a Amazon. En unos minutos se relee la ficha y se comprueba que ha quedado.')
      setValidada(null)
      void historial.recargar()
      onAplicada?.()
    } catch (e) {
      setRechazo({ motivo: e instanceof Error ? e.message : 'No se ha podido aplicar.', issues: (e as { issues?: Issue[] }).issues ?? [] })
      throw e
    }
  }

  const ediciones = historial.datos?.ediciones ?? []
  const ultimaPendiente = ediciones.find((e) => e.estado === 'enviada')

  return (
    <Tarjeta
      variante={abierto ? 'destacada' : 'normal'}
      acento="seo"
      icono={PencilLine}
      titulo="Editar la ficha en Amazon"
      subtitulo="Validas en Amazon sin cambiar nada y aplicas con tu confirmación. Queda apuntado quién y cuándo."
      acciones={
        <Boton variante={abierto ? 'fantasma' : 'secundario'} tamano="sm" icono={abierto ? XCircle : PencilLine} onClick={() => setAbierto((v) => !v)}>
          {abierto ? 'Cerrar' : 'Editar'}
        </Boton>
      }
    >
      {ultimaPendiente && (
        <p className="mb-3 flex items-start gap-2 rounded-[10px] px-3 py-2 text-[12.5px]" style={{ color: COLOR_ESTADO.ambar, background: mezcla(COLOR_ESTADO.ambar, 10) }}>
          <Clock className="mt-[2px] h-[13px] w-[13px] shrink-0" /> Hay un cambio enviado el {new Date(ultimaPendiente.enviadaAt ?? ultimaPendiente.createdAt).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} esperando a verse en la ficha. Se comprueba solo cada 20 minutos.
        </p>
      )}
      <AnimatePresence initial={false}>
        {abierto && (
          <motion.div key="editor" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }} className="overflow-hidden">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
              <div className="flex min-w-0 flex-col gap-4">
                <Campo etiqueta="Título" medida={medidas[0]} cambiado={campos.includes('titulo')}>
                  <textarea value={t.titulo} onChange={(e) => cambiar('titulo', e.target.value)} rows={2} className={CAMPO} />
                </Campo>
                <Campo etiqueta="Item Highlights" medida={medidas[1]} cambiado={campos.includes('highlights')} ayuda="Lo que no cabe en el título (formato, cantidad, duración). Se indexa como el título. Si el tipo de producto no lo admite, Amazon no lo recibe y se avisa.">
                  <textarea value={t.highlights ?? ''} onChange={(e) => cambiar('highlights', e.target.value)} rows={2} className={CAMPO} placeholder="Opcional" />
                </Campo>
                <Campo etiqueta="Viñetas" medida={medidas[2]} cambiado={campos.includes('bullets')} ayuda="Cinco, con un beneficio concreto delante. Se mandan todas: sustituyen a las que haya.">
                  <div className="flex flex-col gap-2">
                    {t.bullets.map((b, i) => (
                      <div key={i} className="flex items-start gap-2">
                        <span className="mt-[11px] w-4 shrink-0 text-right text-[11px] tabular-nums text-[var(--ls-t4)]">{i + 1}</span>
                        <textarea value={b} onChange={(e) => cambiar('bullets', t.bullets.map((x, k) => (k === i ? e.target.value : x)))} rows={3} className={CAMPO} />
                      </div>
                    ))}
                  </div>
                </Campo>
                <Campo etiqueta="Descripción" medida={medidas[3]} cambiado={campos.includes('descripcion')}>
                  <textarea value={t.descripcion ?? ''} onChange={(e) => cambiar('descripcion', e.target.value)} rows={5} className={CAMPO} />
                </Campo>
                <Campo etiqueta="Backend (palabras clave ocultas)" medida={medidas[4]} cambiado={campos.includes('backend')} ayuda="Sin comas y sin repetir lo que ya está arriba. Un byte de más y Amazon ignora el campo entero.">
                  <textarea value={t.backend} onChange={(e) => cambiar('backend', e.target.value)} rows={3} className={`${CAMPO} font-mono text-[12.5px]`} />
                </Campo>
              </div>

              <div className="flex min-w-0 flex-col gap-3 lg:sticky lg:top-24 lg:self-start">
                <div className="rounded-[14px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] p-3">
                  <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-[var(--ls-t1)]">
                    Antes y después
                    <span className="ml-auto text-[12px] font-normal text-[var(--ls-t4)]">{campos.length === 0 ? 'sin cambios' : `${campos.length} ${campos.length === 1 ? 'campo' : 'campos'}`}</span>
                  </div>
                  {campos.length === 0 ? (
                    <p className="text-[12.5px] text-[var(--ls-t3)]">Edita a la izquierda: aquí verás lo que entra (verde) y lo que sale (tachado).</p>
                  ) : (
                    <div className="flex flex-col gap-3">
                      {campos.map((c) => (
                        <Diferencia key={c} campo={c} antes={original} despues={t} />
                      ))}
                    </div>
                  )}
                </div>

                {(bloqueos.length > 0 || incidencias.length > 0) && (
                  <ul className="flex flex-col gap-[6px] rounded-[14px] border border-[var(--ls-linea)] p-3 text-[12.5px] leading-[1.45]">
                    {bloqueos.map((b) => (
                      <li key={b} className="flex items-start gap-2" style={{ color: COLOR_ESTADO.rojo }}>
                        <XCircle className="mt-[2px] h-[13px] w-[13px] shrink-0" /> {b}
                      </li>
                    ))}
                    {incidencias
                      .filter((i) => campos.includes(i.campo as CampoFicha))
                      .slice(0, 6)
                      .map((i) => (
                        <li key={i.id} className="flex items-start gap-2 text-[var(--ls-t2)]">
                          <TriangleAlert className="mt-[2px] h-[13px] w-[13px] shrink-0" style={{ color: i.gravedad === 'grave' ? COLOR_ESTADO.rojo : COLOR_ESTADO.ambar }} /> {i.resumen}
                        </li>
                      ))}
                  </ul>
                )}

                {rechazo && (
                  <div className="rounded-[14px] border px-3 py-[10px] text-[12.5px] leading-[1.5]" style={{ borderColor: mezcla(COLOR_ESTADO.rojo, 40), background: mezcla(COLOR_ESTADO.rojo, 6) }}>
                    <div className="flex items-center gap-2 font-semibold" style={{ color: COLOR_ESTADO.rojo }}>
                      <CircleAlert className="h-[14px] w-[14px]" /> No se ha mandado
                    </div>
                    <div className="mt-1 text-[var(--ls-t2)]">{rechazo.motivo}</div>
                    {rechazo.issues.slice(0, 6).map((i, k) => (
                      <div key={k} className="text-[12px] text-[var(--ls-t3)]">· {i.message ?? i.code}</div>
                    ))}
                  </div>
                )}

                {vigente && (
                  <div className="rounded-[14px] border px-3 py-[10px] text-[12.5px] leading-[1.5]" style={{ borderColor: mezcla(COLOR_ESTADO.verde, 40), background: mezcla(COLOR_ESTADO.verde, 6) }}>
                    <div className="flex items-center gap-2 font-semibold" style={{ color: COLOR_ESTADO.verde }}>
                      <ShieldCheck className="h-[14px] w-[14px]" /> Amazon lo acepta (validación sin guardar)
                    </div>
                    {[...vigente.avisos, ...vigente.issues.map((i) => i.message ?? '')].filter(Boolean).map((a) => (
                      <div key={a} className="mt-1 text-[12px] text-[var(--ls-t3)]">· {a}</div>
                    ))}
                    {!vigente.id && <div className="mt-1 text-[12px]" style={{ color: COLOR_ESTADO.ambar }}>Para aplicar desde aquí falta lanzar la migración 312 en Supabase (sin ella no se apunta quién cambia la ficha).</div>}
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  <Boton variante={vigente ? 'secundario' : 'primario'} icono={ShieldCheck} cargando={validando} disabled={campos.length === 0 || bloqueos.length > 0} onClick={validar}>
                    Validar en Amazon
                  </Boton>
                  <Boton variante="primario" icono={Send} disabled={!vigente?.id} onClick={() => setConfirmar(true)}>
                    Aplicar
                  </Boton>
                  <Boton variante="fantasma" icono={RotateCcw} disabled={campos.length === 0} onClick={() => { setT(original); setValidada(null); setRechazo(null) }}>
                    Deshacer
                  </Boton>
                </div>
                {ventana?.bloqueada && tocaTitulo && (
                  <p className="text-[12px] leading-[1.45]" style={{ color: COLOR_ESTADO.ambar }}>
                    El título se cambió el {ventana.ultimo}: el SOP pide 30 días entre cambios (desde el {ventana.puedeDesde}). Puedes mandarlo igual confirmándolo.
                  </p>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <Historial ediciones={ediciones} cargando={historial.cargando && !historial.datos} sinMigracion={Boolean(historial.datos?.sinMigracion)} />

      <Confirmacion
        abierto={confirmar}
        onCambio={(v) => {
          setConfirmar(v)
          if (!v) setSaltarVentana(false)
        }}
        titulo="¿Cambiar la ficha del cliente en Amazon?"
        descripcion={`Se mandan ${campos.map((c) => NOMBRE_DE_CAMPO[c].toLowerCase()).join(', ')}. Amazon lo procesa en unos minutos; después el ERP relee la ficha y comprueba que ha quedado.`}
        palabra={ventana?.bloqueada && tocaTitulo ? 'APLICAR' : null}
        tono="normal"
        textoConfirmar="Sí, cambiar la ficha"
        onConfirmar={async () => {
          if (ventana?.bloqueada && tocaTitulo && !saltarVentana) throw new Error('Marca la casilla del SOP')
          await aplicar()
        }}
      >
        {ventana?.bloqueada && tocaTitulo && (
          <label className="flex items-start gap-2 text-[12.5px] text-[var(--ls-t2)]">
            <input type="checkbox" checked={saltarVentana} onChange={(e) => setSaltarVentana(e.target.checked)} className="mt-[3px] h-4 w-4" />
            Sé que el título se cambió hace menos de 30 días y lo mando igual (queda apuntado).
          </label>
        )}
      </Confirmacion>
    </Tarjeta>
  )
}

const CAMPO = 'w-full resize-y rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-3 py-2 text-[13.5px] leading-[1.5] text-[var(--ls-t1)] outline-none transition-colors focus:border-[var(--ls-acc-graf)] [@media(pointer:coarse)]:text-[16px]'

function Campo({ etiqueta, medida, cambiado, ayuda, children }: { etiqueta: string; medida: ReturnType<typeof medidasDeEdicion>[number]; cambiado: boolean; ayuda?: string; children: React.ReactNode }) {
  const pct = Math.min(1, medida.valor / medida.limite)
  const color = medida.pasa ? COLOR_ESTADO.rojo : pct > 0.92 ? COLOR_ESTADO.ambar : ACENTO.seo
  return (
    <div className="flex flex-col gap-[6px]">
      <div className="flex items-center gap-2">
        <span className="text-[13px] font-semibold text-[var(--ls-t1)]">{etiqueta}</span>
        {cambiado && <Insignia tono="azul" tamano="sm">cambiado</Insignia>}
        <span className="ml-auto flex items-center gap-2">
          <span className="h-[5px] w-[64px] overflow-hidden rounded-full bg-[var(--ls-sup2)]">
            <motion.span className="block h-full rounded-full" animate={{ width: `${Math.max(medida.valor > 0 ? 3 : 0, pct * 100)}%` }} transition={{ duration: 0.2 }} style={{ background: color }} />
          </span>
          <span className="text-[12px] tabular-nums" style={{ color: medida.pasa ? COLOR_ESTADO.rojo : 'var(--ls-t3)' }}>
            {medida.valor.toLocaleString('es-ES')} / {medida.limite.toLocaleString('es-ES')} {medida.unidad}
          </span>
        </span>
      </div>
      {children}
      {ayuda && <p className="text-[12px] leading-[1.4] text-[var(--ls-t4)]">{ayuda}</p>}
    </div>
  )
}

/** Lo que había y lo nuevo de un campo: palabras nuevas en verde, las que salen tachadas */
function Diferencia({ campo, antes, despues }: { campo: CampoFicha; antes: TextosFicha; despues: TextosFicha }) {
  const valor = (x: TextosFicha) => (campo === 'bullets' ? x.bullets.map(normalizarTexto).filter(Boolean).join('\n') : normalizarTexto((x[campo] as string | null | undefined) ?? ''))
  const a = valor(antes)
  const d = valor(despues)
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11.5px] font-semibold uppercase tracking-[0.04em] text-[var(--ls-t4)]">{NOMBRE_DE_CAMPO[campo]}</span>
      <p className="whitespace-pre-line text-[12.5px] leading-[1.5] text-[var(--ls-t3)]">
        {a ? trozosNuevos(d, a).map((x, i) => (x.nuevo ? <del key={i} style={{ color: COLOR_ESTADO.rojo, textDecorationThickness: '1.5px' }}>{x.texto}</del> : <span key={i}>{x.texto}</span>)) : <span className="italic text-[var(--ls-t4)]">vacío</span>}
      </p>
      <p className="whitespace-pre-line rounded-[8px] px-2 py-1 text-[12.5px] leading-[1.5] text-[var(--ls-t1)]" style={{ background: mezcla(ACENTO.seo, 7) }}>
        {d ? trozosNuevos(a, d).map((x, i) => (x.nuevo ? <mark key={i} className="rounded-[3px] px-[1px] text-[var(--ls-t1)]" style={{ background: mezcla(COLOR_ESTADO.verde, 24) }}>{x.texto}</mark> : <span key={i}>{x.texto}</span>)) : <span className="italic text-[var(--ls-t4)]">vacío</span>}
      </p>
    </div>
  )
}

/** El registro: cada validación y cada envío, quién, cuándo, qué dijo Amazon y si ha quedado */
function Historial({ ediciones, cargando, sinMigracion }: { ediciones: EdicionGuardada[]; cargando: boolean; sinMigracion: boolean }) {
  if (sinMigracion) return <p className="mt-3 text-[12.5px]" style={{ color: COLOR_ESTADO.ambar }}>El registro de ediciones llega al lanzar la migración 312 en Supabase.</p>
  if (cargando || ediciones.length === 0) return null
  const hitos: Hito[] = ediciones.map((e) => {
    const est = ESTADO[e.estado]
    const camposTxt = e.campos.map((c) => NOMBRE_DE_CAMPO[c].toLowerCase()).join(', ')
    const quien = e.enviadoPor ?? e.creadoPor ?? undefined
    return {
      id: e.id,
      cuando: e.verificadaAt ?? e.enviadaAt ?? e.createdAt,
      tono: est.tono,
      icono: e.estado === 'aplicada' ? CircleCheck : e.estado === 'enviada' ? Clock : e.origen === 'ia' ? Sparkles : e.estado === 'validada' ? ShieldCheck : CircleAlert,
      autor: quien,
      titulo: (
        <span className="flex flex-wrap items-center gap-2">
          {est.texto}
          <span className="font-normal text-[var(--ls-t3)]">· {camposTxt || 'sin campos'}</span>
          {e.origen === 'ia' && <Insignia tono="violeta" tamano="sm">IA</Insignia>}
          {e.fueraDeVentana && <Insignia tono="ambar" tamano="sm">fuera de la ventana del SOP</Insignia>}
        </span>
      ),
      descripcion: e.verificacion?.explicacion ?? e.error ?? (e.avisos.length > 0 ? e.avisos.join(' ') : undefined),
    }
  })
  return (
    <div className="mt-4 border-t border-[var(--ls-linea)] pt-3">
      <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-[var(--ls-t1)]">
        <History className="h-[14px] w-[14px] text-[var(--ls-t3)]" /> Registro de cambios
      </div>
      <LineaDeTiempo eventos={hitos} maximo={8} />
    </div>
  )
}
