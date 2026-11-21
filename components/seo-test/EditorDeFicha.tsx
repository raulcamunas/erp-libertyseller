'use client'

import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { toast } from 'sonner'
import { ChevronDown, CircleAlert, CircleCheck, Clock, DownloadCloud, History, Languages, PencilLine, RotateCcw, Send, ShieldCheck, Sparkles, TriangleAlert, X, XCircle } from 'lucide-react'
import { Boton, Confirmacion, Insignia, LineaDeTiempo, Tarjeta, mezcla, ACENTO, type Hito } from '@/components/ui-ls'
import { COLOR_ESTADO, type TonoEstado } from '@/lib/estilo/denso'
import { bloqueosDeEdicion, camposCambiados, medidasDeEdicion, MAX_VINETAS, NOMBRE_DE_CAMPO, normalizarTexto, valorDeCampo, vinetasQueSalen, type CampoFicha, type TextosFicha } from '@/lib/seo/edicion'
import type { EdicionGuardada } from '@/lib/seo/edicion-servidor'
import type { FichaGuardada } from '@/lib/seo/datos'
import { trozosNuevos } from '@/lib/seo/propuesta'
import type { ventanaDeCambio } from '@/lib/seo/tareas'
import { useDelProducto } from './useDelProducto'

type Issue = { message?: string; code?: string; severity?: string }

/** Lo que acompaña a un rechazo del servidor: la ficha viva, los campos que cambiaron en Amazon y, si es bilingüe, sus idiomas */
type Rechazo = { motivo: string; issues: Issue[]; viva?: TextosFicha | null; cambiadosEnAmazon?: CampoFicha[]; idiomas?: string[] | null }

/** Un POST que devuelve el JSON, o lanza con el motivo, las incidencias de Amazon y lo que el servidor haya leído de la ficha */
async function enviar<T>(cuerpo: unknown): Promise<T> {
  const res = await fetch('/api/seo/ediciones', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo), cache: 'no-store' })
  const j = (await res.json().catch(() => ({}))) as T & { error?: string; issues?: Issue[]; antes?: TextosFicha | null; camposCambiadosEnAmazon?: CampoFicha[]; idiomas?: string[] | null }
  if (!res.ok) throw Object.assign(new Error(j.error ?? `Error ${res.status}`), { issues: j.issues ?? [], viva: j.antes ?? null, cambiadosEnAmazon: j.camposCambiadosEnAmazon ?? [], idiomas: j.idiomas ?? null })
  return j
}

const rechazoDe = (e: unknown, porDefecto: string): Rechazo => {
  const x = e as Partial<Rechazo>
  return { motivo: e instanceof Error ? e.message : porDefecto, issues: x.issues ?? [], viva: x.viva ?? null, cambiadosEnAmazon: x.cambiadosEnAmazon ?? [], idiomas: x.idiomas ?? null }
}

/** Para el editor: las viñetas se rellenan hasta 5 huecos, pero NUNCA se recortan (una ficha con 7 las enseña todas) */
const paraEditor = (t: { titulo?: string | null; highlights?: string | null; bullets?: string[] | null; descripcion?: string | null; backend?: string | null }): TextosFicha => {
  const bullets = t.bullets ?? []
  return {
    titulo: t.titulo ?? '',
    highlights: t.highlights ?? '',
    bullets: bullets.length >= MAX_VINETAS ? [...bullets] : [...bullets, ...Array(MAX_VINETAS - bullets.length).fill('')],
    descripcion: t.descripcion ?? '',
    backend: t.backend ?? '',
  }
}

const textosDeFicha = (f: FichaGuardada): TextosFicha => paraEditor(f)

/** La ficha viva como base, con lo que la persona ha tocado encima (lo que no ha tocado queda como está ahora en Amazon) */
function sobreLaViva(viva: TextosFicha, tocados: readonly CampoFicha[], actual: TextosFicha): TextosFicha {
  const r: TextosFicha = { ...viva, bullets: [...viva.bullets] }
  for (const c of tocados) {
    if (c === 'bullets') r.bullets = [...actual.bullets]
    else r[c] = actual[c] ?? ''
  }
  return r
}

const nombres = (campos: readonly CampoFicha[]) => campos.map((c) => NOMBRE_DE_CAMPO[c].toLowerCase()).join(', ')

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
  // El «original» es la ficha guardada (hasta 24 h) hasta que se valida: desde ahí, la que Amazon tiene en ese momento
  const [original, setOriginal] = useState<TextosFicha>(() => textosDeFicha(ficha))
  const [vivaLeida, setVivaLeida] = useState(false)
  const [abierto, setAbierto] = useState(false)
  const [t, setT] = useState<TextosFicha>(original)
  const [validando, setValidando] = useState(false)
  const [validada, setValidada] = useState<{ id: string | null; huella: string; campos: CampoFicha[]; avisos: string[]; issues: Issue[]; ventanaCerrada: boolean } | null>(null)
  const [rechazo, setRechazo] = useState<Rechazo | null>(null)
  const [bilingue, setBilingue] = useState<string[] | null>(null)
  const [confirmar, setConfirmar] = useState(false)
  const [saltarVentana, setSaltarVentana] = useState(false)
  const historial = useDelProducto<{ ediciones: EdicionGuardada[]; sinMigracion: boolean }>(`/api/seo/ediciones?cuenta=${encodeURIComponent(cuentaId)}&asin=${asin}`)

  // Ficha nueva (otro producto o se ha vuelto a leer): se empieza de cero sobre ella
  useEffect(() => {
    const o = textosDeFicha(ficha)
    setOriginal(o)
    setT(o)
    setVivaLeida(false)
    setValidada(null)
    setRechazo(null)
    setBilingue(null)
  }, [ficha])

  const campos = useMemo(() => camposCambiados(original, t), [original, t])
  const { bloqueos, incidencias } = useMemo(() => bloqueosDeEdicion(t, campos), [t, campos])
  const medidas = useMemo(() => medidasDeEdicion(t), [t])
  const huella = JSON.stringify(t)
  // Si se toca algo después de validar, hay que volver a validar
  const vigente = validada && validada.huella === huella ? validada : null
  // Lo que se va a mandar es lo que dijo el servidor al validar (no lo que calcula el navegador)
  const camposAMandar = vigente?.campos ?? campos
  const tocaTitulo = camposAMandar.includes('titulo')
  const vinetasLlenas = t.bullets.filter((b) => normalizarTexto(b)).length
  const salen = useMemo(() => (camposAMandar.includes('bullets') ? vinetasQueSalen(original, t) : []), [camposAMandar, original, t])

  const cambiar = <K extends keyof TextosFicha>(k: K, v: TextosFicha[K]) => {
    setT((x) => ({ ...x, [k]: v }))
    setRechazo(null)
  }

  /** Pone como base la ficha que Amazon tiene ahora, con lo tocado encima. Devuelve el nuevo texto del editor */
  function adoptarViva(vivaCruda: TextosFicha, tocados: readonly CampoFicha[]): TextosFicha {
    const viva = paraEditor(vivaCruda)
    const nuevo = sobreLaViva(viva, tocados, t)
    const fuera = camposCambiados(original, viva).filter((c) => !tocados.includes(c))
    if (fuera.length > 0) toast.info(`En Amazon han cambiado ${nombres(fuera)} desde la última lectura. No los has tocado: se quedan como están ahora en Amazon.`)
    setOriginal(viva)
    setT(nuevo)
    setVivaLeida(true)
    return nuevo
  }

  async function validar() {
    setValidando(true)
    setRechazo(null)
    const tocados = campos
    // Solo los campos tocados y lo que había en ellos al empezar: el servidor no pisa lo que haya cambiado en Amazon
    const antes = Object.fromEntries(tocados.map((c) => [c, original[c]]))
    try {
      const r = await enviar<{ edicion: EdicionGuardada | null; campos: CampoFicha[]; antes: TextosFicha; avisos: string[]; issues: Issue[]; ventana: { bloqueada: boolean } | null }>({ cuenta: cuentaId, accion: 'validar', asin, despues: { ...t, bullets: t.bullets.filter((b) => normalizarTexto(b)) }, campos: tocados, antes })
      const nuevo = r.antes ? adoptarViva(r.antes, tocados) : t
      setValidada({ id: r.edicion?.id ?? null, huella: JSON.stringify(nuevo), campos: r.campos ?? tocados, avisos: r.avisos, issues: r.issues, ventanaCerrada: Boolean(r.ventana?.bloqueada) })
      toast.success('Amazon lo acepta. Todavía no se ha cambiado nada.')
      void historial.recargar()
    } catch (e) {
      setValidada(null)
      const x = rechazoDe(e, 'No se ha podido validar.')
      if (x.idiomas && x.idiomas.length > 1) setBilingue(x.idiomas)
      setRechazo(x)
      void historial.recargar()
    } finally {
      setValidando(false)
    }
  }

  /** Tras «ha cambiado en Amazon»: la ficha de ahora como base y tus cambios encima, para que veas qué pisas antes de volver a validar */
  function traerLaViva() {
    if (!rechazo?.viva) return
    adoptarViva(rechazo.viva, campos)
    setRechazo(null)
    setValidada(null)
  }

  /** «Cargar esta versión en el editor» (Historial): lo que había antes de esa edición, solo en sus campos. Luego, el flujo de siempre */
  function cargarVersion(e: EdicionGuardada) {
    const antes = paraEditor(e.antes)
    const nuevo: TextosFicha = { ...original, bullets: [...original.bullets] }
    const vacios: CampoFicha[] = []
    for (const c of e.campos) {
      if (!valorDeCampo(antes, c)) {
        vacios.push(c)
        continue
      }
      if (c === 'bullets') nuevo.bullets = [...antes.bullets]
      else nuevo[c] = antes[c] ?? ''
    }
    setT(nuevo)
    setValidada(null)
    setRechazo(null)
    setAbierto(true)
    if (vacios.length > 0) toast.info(`Antes de ese cambio ${nombres(vacios)} estaba vacío: desde el ERP no se deja un campo vacío. Si hace falta, bórralo en Seller Central.`)
    else toast.success('Versión cargada en el editor. Valídala en Amazon antes de aplicarla.')
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
      setRechazo(rechazoDe(e, 'No se ha podido aplicar.'))
      setValidada(null)
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
            {bilingue ? (
              <div className="flex items-start gap-3 rounded-[14px] border px-4 py-3 text-[12.5px] leading-[1.5]" style={{ borderColor: mezcla(COLOR_ESTADO.ambar, 40), background: mezcla(COLOR_ESTADO.ambar, 6) }}>
                <Languages className="mt-[2px] h-[15px] w-[15px] shrink-0" style={{ color: COLOR_ESTADO.ambar }} />
                <div className="min-w-0">
                  <div className="text-[13px] font-semibold text-[var(--ls-t1)]">Esta ficha está en dos idiomas ({bilingue.join(' y ')}) en este país</div>
                  <div className="mt-[2px] text-[var(--ls-t3)]">Edítala en Seller Central. Desde aquí se mandaría un solo idioma y Amazon borraría el otro. Los textos que ves en la pestaña son los de {bilingue[0]}.</div>
                </div>
              </div>
            ) : (
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
              <div className="flex min-w-0 flex-col gap-4">
                <Campo etiqueta="Título" medida={medidas[0]} cambiado={campos.includes('titulo')}>
                  <textarea value={t.titulo} onChange={(e) => cambiar('titulo', e.target.value)} rows={2} className={CAMPO} />
                </Campo>
                <Campo etiqueta="Item Highlights" medida={medidas[1]} cambiado={campos.includes('highlights')} ayuda="Lo que no cabe en el título (formato, cantidad, duración). Se indexa como el título. Si el tipo de producto no lo admite, Amazon no lo recibe y se avisa.">
                  <textarea value={t.highlights ?? ''} onChange={(e) => cambiar('highlights', e.target.value)} rows={2} className={CAMPO} placeholder="Opcional" />
                </Campo>
                <Campo etiqueta="Viñetas" medida={medidas[2]} cambiado={campos.includes('bullets')} ayuda="Cinco, con un beneficio concreto delante. Solo se mandan si las cambias, y entonces todas: sustituyen a las que haya.">
                  <div className="flex flex-col gap-2">
                    {original.bullets.filter((b) => normalizarTexto(b)).length > MAX_VINETAS && (
                      <p className="flex items-start gap-2 rounded-[10px] px-3 py-2 text-[12px] leading-[1.45]" style={{ color: COLOR_ESTADO.ambar, background: mezcla(COLOR_ESTADO.ambar, 10) }}>
                        <TriangleAlert className="mt-[2px] h-[13px] w-[13px] shrink-0" />
                        <span>
                          Esta ficha tiene {original.bullets.filter((b) => normalizarTexto(b)).length} viñetas y el ERP trabaja con {MAX_VINETAS}. Si solo cambias otros campos, las viñetas no se tocan. Para cambiarlas, quita antes a mano las que sobren (×){vinetasLlenas > MAX_VINETAS ? `: sobran ${vinetasLlenas - MAX_VINETAS}.` : '.'}
                        </span>
                      </p>
                    )}
                    {t.bullets.map((b, i) => (
                      <div key={i} className="flex items-start gap-2">
                        <span className="mt-[11px] w-4 shrink-0 text-right text-[11px] tabular-nums text-[var(--ls-t4)]">{i + 1}</span>
                        <textarea value={b} onChange={(e) => cambiar('bullets', t.bullets.map((x, k) => (k === i ? e.target.value : x)))} rows={3} className={CAMPO} />
                        {t.bullets.length > MAX_VINETAS && (
                          <button type="button" aria-label={`Quitar la viñeta ${i + 1}`} title="Quitar esta viñeta" onClick={() => cambiar('bullets', t.bullets.filter((_, k) => k !== i))} className="mt-[6px] grid h-[28px] w-[28px] shrink-0 place-items-center rounded-[8px] text-[var(--ls-t3)] transition-colors hover:bg-[var(--ls-sup2)] hover:text-[var(--ls-t1)]">
                            <X className="h-[14px] w-[14px]" />
                          </button>
                        )}
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
                  <p className="mb-2 text-[11.5px] text-[var(--ls-t4)]">{vivaLeida ? '«Antes» es lo que Amazon tiene ahora mismo (leído al validar).' : `«Antes» es la ficha leída ${new Date(ficha.leidaAt).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}. Al validar se compara con la de ahora.`}</p>
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
                    {rechazo.viva && (rechazo.cambiadosEnAmazon?.length ?? 0) > 0 && (
                      <div className="mt-2">
                        <Boton variante="secundario" tamano="sm" icono={DownloadCloud} onClick={traerLaViva}>
                          Traer la ficha de Amazon y mantener mis cambios
                        </Boton>
                        <p className="mt-1 text-[11.5px] text-[var(--ls-t4)]">Verás a la derecha qué hay ahora en Amazon y qué lo sustituiría. Luego vuelve a validar.</p>
                      </div>
                    )}
                  </div>
                )}

                {vigente && (
                  <div className="rounded-[14px] border px-3 py-[10px] text-[12.5px] leading-[1.5]" style={{ borderColor: mezcla(COLOR_ESTADO.verde, 40), background: mezcla(COLOR_ESTADO.verde, 6) }}>
                    <div className="flex items-center gap-2 font-semibold" style={{ color: COLOR_ESTADO.verde }}>
                      <ShieldCheck className="h-[14px] w-[14px]" /> Amazon lo acepta (validación sin guardar)
                    </div>
                    <div className="mt-1 text-[var(--ls-t2)]">Se mandará: {nombres(vigente.campos)}. El resto de la ficha no se toca.</div>
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
                  <Boton variante="fantasma" icono={RotateCcw} disabled={campos.length === 0} onClick={() => { setT({ ...original, bullets: [...original.bullets] }); setValidada(null); setRechazo(null) }}>
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
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <Historial ediciones={ediciones} cargando={historial.cargando && !historial.datos} sinMigracion={Boolean(historial.datos?.sinMigracion)} onCargar={bilingue ? undefined : cargarVersion} />

      <Confirmacion
        abierto={confirmar}
        onCambio={(v) => {
          setConfirmar(v)
          if (!v) setSaltarVentana(false)
        }}
        titulo="¿Cambiar la ficha del cliente en Amazon?"
        descripcion={`Se mandan ${nombres(camposAMandar)} (lo que Amazon ha validado; el resto de la ficha no se toca). Amazon lo procesa en unos minutos; después el ERP relee la ficha y comprueba que ha quedado.`}
        palabra={ventana?.bloqueada && tocaTitulo ? 'APLICAR' : null}
        tono="normal"
        textoConfirmar="Sí, cambiar la ficha"
        onConfirmar={async () => {
          if (ventana?.bloqueada && tocaTitulo && !saltarVentana) throw new Error('Marca la casilla del SOP')
          await aplicar()
        }}
      >
        {salen.length > 0 && (
          <div className="mb-2 rounded-[10px] px-3 py-2 text-[12.5px] leading-[1.45]" style={{ color: 'var(--ls-t2)', background: mezcla(COLOR_ESTADO.rojo, 7) }}>
            <div className="font-semibold" style={{ color: COLOR_ESTADO.rojo }}>
              Se {salen.length === 1 ? 'borra esta viñeta' : `borran estas ${salen.length} viñetas`} de la ficha:
            </div>
            {salen.map((b, i) => (
              <div key={i} className="mt-1 line-clamp-2 text-[12px] text-[var(--ls-t3)]">· {b}</div>
            ))}
          </div>
        )}
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

/** Las ediciones que llegaron a la ficha: se pueden desplegar para ver qué cambiaron y volver a lo de antes */
const VUELVE: ReadonlySet<EdicionGuardada['estado']> = new Set(['aplicada', 'enviada', 'parcial'])

/** Una edición desplegable: lo que cambió y «Cargar esta versión en el editor» (lo de antes de esa edición, por el flujo normal: validar, confirmar y aplicar) */
function VersionDesplegable({ e, texto, onCargar }: { e: EdicionGuardada; texto?: string; onCargar?: (e: EdicionGuardada) => void }) {
  const [ver, setVer] = useState(false)
  const antes = paraEditor(e.antes ?? {})
  const despues = paraEditor(e.despues ?? {})
  return (
    <div className="flex flex-col gap-1">
      {texto && <span>{texto}</span>}
      <button type="button" onClick={() => setVer((v) => !v)} aria-expanded={ver} className="flex w-fit items-center gap-1 text-[12px] font-medium text-[var(--ls-t2)] hover:text-[var(--ls-t1)]">
        <ChevronDown className="h-[13px] w-[13px] transition-transform" style={{ transform: ver ? 'rotate(180deg)' : undefined }} /> {ver ? 'Ocultar el cambio' : 'Ver qué cambió'}
      </button>
      <AnimatePresence initial={false}>
        {ver && (
          <motion.div key="v" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
            <div className="mt-1 flex flex-col gap-3 rounded-[12px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] p-3">
              {e.campos.map((c) => (
                <Diferencia key={c} campo={c} antes={antes} despues={despues} />
              ))}
              {onCargar && (
                <div className="flex flex-wrap items-center gap-2">
                  <Boton variante="secundario" tamano="sm" icono={RotateCcw} onClick={() => onCargar(e)}>
                    Cargar esta versión en el editor
                  </Boton>
                  <span className="text-[11.5px] text-[var(--ls-t4)]">Pone lo de antes de este cambio. No se manda nada hasta que valides y apliques.</span>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/** El registro: cada validación y cada envío, quién, cuándo, qué dijo Amazon y si ha quedado */
function Historial({ ediciones, cargando, sinMigracion, onCargar }: { ediciones: EdicionGuardada[]; cargando: boolean; sinMigracion: boolean; onCargar?: (e: EdicionGuardada) => void }) {
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
      descripcion: (() => {
        const texto = e.verificacion?.explicacion ?? e.error ?? (e.avisos.length > 0 ? e.avisos.join(' ') : undefined)
        return VUELVE.has(e.estado) && e.campos.length > 0 && e.antes ? <VersionDesplegable e={e} texto={texto ?? undefined} onCargar={onCargar} /> : texto
      })(),
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
