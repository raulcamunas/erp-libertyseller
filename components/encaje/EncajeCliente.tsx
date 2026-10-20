'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Info, Loader2, Package, Plus, TriangleAlert } from 'lucide-react'
import { sinRespuestaDe } from '@/components/remesas/comun/errores'
import type { DatosDeEncaje } from '@/lib/fba/encaje-enlace'
import { anadirCaja, duplicarCaja, meterPendientes, meterTodoLoPendiente, moverLinea, ponerMedida, ponerUnidades, quitarCaja } from '@/lib/fba/encaje-operaciones'
import { porQueNoSePuedeEncajar, resumirEncaje, type CajaEnEdicion, type ResumenDeEncaje } from '@/lib/fba/encaje-resumen'
import { BarraDeProgreso } from './BarraDeProgreso'
import { Cabecera } from './Cabecera'
import { ListaPorEncajar } from './ListaPorEncajar'
import { PantallaFinal } from './PantallaFinal'
import { TarjetaCaja } from './TarjetaCaja'
import { FUENTE_CUERPO, FUENTE_TITULO, cx, n0, n1 } from './marca'
import { useAutoguardado } from './useAutoguardado'

/**
 * LA PÁGINA DONDE EL CLIENTE ENCAJA SU ENVÍO, SIN ENTRAR AL ERP.
 *
 * Le llega con un enlace, sin cuenta ni contraseña (lib/fba/encaje-enlace.ts). Reparte las unidades
 * del envío en cajas, mide y pesa cada una y pulsa «He terminado de encajar»: el mismo paso que daría
 * en el ERP, con las mismas comprobaciones, pero sin esperar a que nadie le abra una cuenta.
 *
 * TODO LO QUE SE PUEDE HACER CON LAS CAJAS está en lib/fba/encaje-operaciones.ts, que es puro y está
 * probado: aquí solo se enseña el resultado. Las operaciones no dejan nunca las cajas en un estado
 * que el servidor rechazaría, así que lo único que puede fallar al guardar es la conexión.
 */
export function EncajeCliente({ token, inicial }: { token: string; inicial: DatosDeEncaje }) {
  const { lineas } = inicial
  const [cajas, setCajas] = useState<CajaEnEdicion[]>(inicial.cajas)
  const [activa, setActiva] = useState<number | null>(inicial.cajas[0]?.numero ?? null)
  const [terminada, setTerminada] = useState(false)
  const [arrastrando, setArrastrando] = useState(false)
  const [confirmando, setConfirmando] = useState(false)
  const [terminando, setTerminando] = useState(false)
  const [motivosAlTerminar, setMotivosAlTerminar] = useState<string[] | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [verAyuda, setVerAyuda] = useState(inicial.cajas.length === 0)
  const temporizadorDelAviso = useRef<ReturnType<typeof setTimeout> | null>(null)

  const yaTerminada = inicial.estado === 'lista' || terminada
  const editable = inicial.editable && !terminada
  const resumen = useMemo(() => resumirEncaje(lineas, cajas), [lineas, cajas])
  const guardado = useAutoguardado(token, cajas, editable)
  const totalUnidades = useMemo(() => lineas.reduce((s, l) => s + l.unidades, 0), [lineas])

  // La ayuda se pliega sola al empezar a trabajar: ya no hace falta y empuja las cajas hacia abajo
  const yaHabiaCajas = useRef(inicial.cajas.length > 0)
  useEffect(() => {
    if (cajas.length > 0 && !yaHabiaCajas.current) {
      yaHabiaCajas.current = true
      setVerAyuda(false)
    }
  }, [cajas.length])

  const avisar = useCallback((texto: string, ms = 2400) => {
    setAviso(texto)
    if (temporizadorDelAviso.current) clearTimeout(temporizadorDelAviso.current)
    temporizadorDelAviso.current = setTimeout(() => setAviso(null), ms)
  }, [])

  /* ---------- lo que se hace con las cajas ---------- */
  // Todas las operaciones actualizan sobre lo MÁS RECIENTE (`prev`), no sobre las cajas de este render: dos
  // pulsaciones seguidas —un doble clic en «+»— se ven con el mismo `cajas` y la segunda pisaría a la primera

  /** A dónde va lo que se mete desde la lista: la caja abierta, la primera si no hay ninguna abierta o una nueva si no hay cajas */
  function destinoDe(prev: CajaEnEdicion[]): { cajas: CajaEnEdicion[]; numero: number } {
    if (activa !== null && prev.some((c) => c.numero === activa)) return { cajas: prev, numero: activa }
    if (prev.length > 0) return { cajas: prev, numero: prev[0].numero }
    const nuevas = anadirCaja(prev)
    return { cajas: nuevas, numero: nuevas[0].numero }
  }

  function anadir(copiarMedidasDe?: number) {
    setCajas((prev) => anadirCaja(prev, copiarMedidasDe))
    setActiva(Math.max(0, ...cajas.map((c) => c.numero)) + 1)
  }

  /** «Otra igual»: una caja nueva con las mismas medidas, el mismo peso y lo mismo dentro, en lo que quede por encajar */
  function duplicar(numero: number) {
    const r = duplicarCaja(cajas, lineas, numero)
    if (r.nueva === null) return
    setCajas((prev) => duplicarCaja(prev, lineas, numero).cajas)
    setActiva(r.nueva)
    if (r.sinCopiar === 0) {
      avisar(r.copiadas > 0 ? `Caja ${r.nueva}: igual que la ${numero}, con sus ${n0(r.copiadas)} unidades` : `Caja ${r.nueva}: con las mismas medidas que la ${numero}`)
    } else if (r.copiadas > 0) {
      // No se puede mentir con un «copiada»: el envío tiene las unidades que tiene
      avisar(`Caja ${r.nueva}: copiadas ${n0(r.copiadas)} de las ${n0(r.copiadas + r.sinCopiar)} unidades de la caja ${numero}. De las demás ya no quedaba por encajar. Revisa el peso.`, 6000)
    } else {
      avisar(`Caja ${r.nueva}: con las mismas medidas, pero vacía: ya no queda nada por encajar de lo que llevaba la caja ${numero}.`, 5000)
    }
  }

  function meterDeLaLista(sku: string) {
    const numero = destinoDe(cajas).numero
    setCajas((prev) => {
      const d = destinoDe(prev)
      return meterPendientes(d.cajas, lineas, d.numero, sku)
    })
    setActiva(numero)
    avisar(`${sku} → caja ${numero}`)
  }

  function quitar(numero: number) {
    setCajas((prev) => quitarCaja(prev, numero))
    const quedan = cajas.length - 1
    setActiva(quedan <= 0 ? null : Math.min(numero, quedan))
  }

  /** Lo que se suelta encima de una caja: «ref:SKU» desde la lista o «item:SKU:CAJA» desde otra caja */
  function soltarEn(numero: number, dato: string) {
    setArrastrando(false)
    if (dato.startsWith('ref:')) {
      const sku = dato.slice(4)
      if (meterPendientes(cajas, lineas, numero, sku) === cajas) return avisar(`${sku} ya está toda encajada`)
      setCajas((prev) => meterPendientes(prev, lineas, numero, sku))
      setActiva(numero)
      avisar(`${sku} → caja ${numero}`)
    } else if (dato.startsWith('item:')) {
      const cuerpo = dato.slice(5)
      const corte = cuerpo.lastIndexOf(':')
      const sku = cuerpo.slice(0, corte)
      const origen = Number(cuerpo.slice(corte + 1))
      if (origen === numero) return
      setCajas((prev) => moverLinea(prev, sku, origen, numero))
      setActiva(numero)
      avisar(`${sku}: de la caja ${origen} a la ${numero}`)
    }
  }

  /* ---------- terminar ---------- */

  async function terminar() {
    setTerminando(true)
    setMotivosAlTerminar(null)
    try {
      // Antes de dar el paso, lo último que hay en pantalla tiene que estar en el servidor
      const guardadoOk = await guardado.sincronizar()
      if (!guardadoOk) {
        setMotivosAlTerminar(['No se han podido guardar las cajas. Revisa la conexión y vuelve a probar.'])
        return
      }
      const res = await fetch(`/api/publico/encajar/${token}/terminar`, { method: 'POST' })
      const cuerpo = (await res.json().catch(() => null)) as { error?: string; motivos?: string[] } | null
      if (!res.ok) {
        setMotivosAlTerminar(cuerpo?.motivos ?? [cuerpo?.error ?? sinRespuestaDe('No se ha podido terminar', res.status)])
        return
      }
      setTerminada(true)
      setConfirmando(false)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch {
      setMotivosAlTerminar(['Se ha cortado la conexión. Revisa tu conexión y vuelve a probar.'])
    } finally {
      setTerminando(false)
    }
  }

  // La rejilla de abajo lleva `grid-cols-1`, que es minmax(0,1fr): sin eso la columna se ensancha con el nombre más largo —que no se
  // parte— y empuja la caja fuera de la pantalla del móvil
  return (
    <div className="min-h-screen bg-[#F7F5F2] text-[#141414]" style={{ fontFamily: FUENTE_CUERPO }}>
      <Cabecera titulo={inicial.titulo} cliente={inicial.cliente} referencias={lineas.length} unidades={totalUnidades} fechaEnvio={inicial.fechaEnvio} />

      {yaTerminada ? (
        <PantallaFinal recien={terminada} resumen={resumen} cajas={cajas} lineas={lineas} />
      ) : (
        <>
          <BarraDeProgreso
            resumen={resumen}
            guardado={guardado.estado}
            motivoDelFallo={guardado.motivo}
            editable={editable}
            terminando={terminando}
            onTerminar={() => {
              setMotivosAlTerminar(null)
              setConfirmando(true)
            }}
          />

          <main className="mx-auto max-w-[1180px] px-5 pb-32 pt-6 sm:px-8">
            {!editable && (
              <p className="mb-6 flex items-start gap-3 rounded-2xl border border-[#E0B43A]/50 bg-[#FBF0D2] px-4 py-3.5 text-[14px] leading-snug text-[#5E4A08]">
                <Info className="mt-0.5 h-4 w-4 shrink-0" />
                {porQueNoSePuedeEncajar(inicial.estado)}
              </p>
            )}

            {editable && <Ayuda abierta={verAyuda} onAlternar={() => setVerAyuda((v) => !v)} />}

            {lineas.length === 0 ? (
              <p className="mt-6 rounded-2xl border border-[#E5E1DB] bg-[#FFFFFF] px-6 py-10 text-center text-[14px] text-[#5E5852]">Este envío todavía no tiene ninguna referencia que encajar.</p>
            ) : (
              <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(300px,380px)_minmax(0,1fr)] lg:items-start">
                <div className="order-2 min-w-0 lg:sticky lg:top-[112px] lg:order-1">
                  <ListaPorEncajar lineas={lineas} resumen={resumen} editable={editable} cajaActiva={activa} onMeter={meterDeLaLista} onArrastrar={setArrastrando} />
                </div>

                <section className="order-1 min-w-0 space-y-4 lg:order-2" aria-label="Tus cajas">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h2 className="text-[19px] text-[#141414]" style={{ fontFamily: FUENTE_TITULO, fontWeight: 600 }}>
                      Tus cajas
                    </h2>
                    {editable && cajas.length > 0 && resumen.pendientes > 0 && cajas.length === 1 && (
                      <button
                        type="button"
                        onClick={() => {
                          setCajas((prev) => (prev.length > 0 ? meterTodoLoPendiente(prev, lineas, prev[0].numero) : prev))
                          avisar('Todo lo que faltaba, en la caja 1')
                        }}
                        className="text-[13px] font-medium text-[#F26212] hover:underline"
                      >
                        Meter todo en esta caja
                      </button>
                    )}
                  </div>

                  {cajas.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-[#B8AE9F] bg-[#FFFFFF]/60 px-6 py-12 text-center">
                      <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[#FBEFE8] text-[#F26212]">
                        <Package className="h-7 w-7" />
                      </span>
                      <p className="mt-4 text-[16px] text-[#141414]" style={{ fontFamily: FUENTE_TITULO, fontWeight: 600 }}>
                        Todavía no hay ninguna caja
                      </p>
                      <p className="mx-auto mt-1.5 max-w-[420px] text-[13.5px] leading-relaxed text-[#5E5852]">Añade una por cada caja que vayas a mandar y reparte dentro las unidades.</p>
                      {editable && (
                        <button type="button" onClick={() => anadir()} className="mt-5 inline-flex h-11 items-center gap-2 rounded-xl bg-[#F26212] px-5 text-[14px] font-semibold text-[#FFFFFF] shadow-[0_8px_20px_-8px_rgba(242,98,18,0.7)] transition hover:bg-[#E0560C]">
                          <Plus className="h-4 w-4" />
                          Añadir la primera caja
                        </button>
                      )}
                    </div>
                  ) : (
                    cajas.map((c) => (
                      <TarjetaCaja
                        key={c.numero}
                        caja={c}
                        lineas={lineas}
                        cajas={cajas}
                        resumen={resumen}
                        editable={editable}
                        activa={c.numero === activa}
                        arrastrando={arrastrando}
                        puedeQuitar={cajas.length > 0}
                        onActivar={() => setActiva(c.numero)}
                        onMedida={(campo, valor) => setCajas((prev) => ponerMedida(prev, c.numero, campo, valor))}
                        onUnidades={(sku, n) => setCajas((prev) => ponerUnidades(prev, lineas, c.numero, sku, n))}
                        onAnadirReferencia={(sku) => {
                          setCajas((prev) => meterPendientes(prev, lineas, c.numero, sku))
                          setActiva(c.numero)
                        }}
                        onMeterPendientes={() => {
                          setCajas((prev) => meterTodoLoPendiente(prev, lineas, c.numero))
                          setActiva(c.numero)
                          avisar(`Todo lo que faltaba, en la caja ${c.numero}`)
                        }}
                        onQuitar={() => quitar(c.numero)}
                        onNuevaIgual={() => duplicar(c.numero)}
                        onSoltar={(dato) => soltarEn(c.numero, dato)}
                      />
                    ))
                  )}

                  {editable && cajas.length > 0 && (
                    <button
                      type="button"
                      onClick={() => anadir()}
                      className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-[#B8AE9F] text-[14px] font-medium text-[#5E5852] transition hover:border-[#F26212] hover:bg-[#FBEFE8] hover:text-[#F26212]"
                    >
                      <Plus className="h-4 w-4" />
                      Añadir otra caja
                    </button>
                  )}
                </section>
              </div>
            )}
          </main>
        </>
      )}

      {confirmando && <Confirmacion resumen={resumen} terminando={terminando} motivos={motivosAlTerminar} onCancelar={() => setConfirmando(false)} onConfirmar={() => void terminar()} />}

      {aviso && (
        <div role="status" className="pointer-events-none fixed bottom-6 left-1/2 z-40 -translate-x-1/2 rounded-full bg-[#141414] px-4 py-2.5 text-[13px] font-medium text-[#FFFFFF] shadow-[0_12px_30px_-10px_rgba(20,20,20,0.6)]">
          {aviso}
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Piezas                                                              */
/* ------------------------------------------------------------------ */

function Ayuda({ abierta, onAlternar }: { abierta: boolean; onAlternar: () => void }) {
  return (
    <section className="rounded-2xl border border-[#E5E1DB] bg-[#FFFFFF]">
      <button type="button" onClick={onAlternar} aria-expanded={abierta} className="flex w-full items-center justify-between gap-3 px-5 py-3.5 text-left">
        <span className="flex items-center gap-2.5 text-[14px] font-semibold text-[#141414]">
          <Info className="h-4 w-4 text-[#F26212]" />
          Cómo funciona
        </span>
        <ChevronDown className={cx('h-4 w-4 text-[#8C857C] transition', abierta && 'rotate-180')} />
      </button>
      {abierta && (
        <ol className="grid gap-4 border-t border-[#EFEBE5] px-5 py-4 text-[13.5px] leading-relaxed text-[#5E5852] sm:grid-cols-3">
          {[
            ['1', 'Añade una caja por cada caja física', 'que vayas a mandar a Amazon.'],
            ['2', 'Reparte dentro las referencias', 'con «Añadir referencia», con el «+» de la lista o arrastrándolas encima de la caja.'],
            ['3', 'Mide y pesa cada caja', 'y pulsa «He terminado de encajar». Lo que haces se guarda solo.'],
          ].map(([n, titulo, resto]) => (
            <li key={n} className="flex gap-3">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#141414] text-[13px] font-semibold text-[#FFFFFF]" style={{ fontFamily: FUENTE_TITULO }}>
                {n}
              </span>
              <span>
                <b className="font-semibold text-[#141414]">{titulo}</b> {resto}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

function Confirmacion({ resumen, terminando, motivos, onCancelar, onConfirmar }: { resumen: ResumenDeEncaje; terminando: boolean; motivos: string[] | null; onCancelar: () => void; onConfirmar: () => void }) {
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !terminando) onCancelar()
    }
    document.addEventListener('keydown', tecla)
    return () => document.removeEventListener('keydown', tecla)
  }, [onCancelar, terminando])

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[#0E0E0E]/60 p-4" role="dialog" aria-modal="true" aria-labelledby="titulo-confirmar">
      <div className="w-full max-w-[470px] rounded-2xl bg-[#FFFFFF] p-6 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.6)]">
        <h2 id="titulo-confirmar" className="text-[21px] leading-tight text-[#141414]" style={{ fontFamily: FUENTE_TITULO, fontWeight: 600 }}>
          ¿Has terminado de encajar?
        </h2>
        <p className="mt-2 text-[14px] leading-relaxed text-[#5E5852]">Vas a avisar a Liberty Seller de que estas cajas están listas:</p>
        <div className="mt-3 flex flex-wrap gap-2 text-[13px]">
          <span className="rounded-full bg-[#F7F5F2] px-3 py-1.5 text-[#5E5852]">
            <b className="font-semibold text-[#141414]">{n0(resumen.cajas)}</b> caja{resumen.cajas === 1 ? '' : 's'}
          </span>
          <span className="rounded-full bg-[#F7F5F2] px-3 py-1.5 text-[#5E5852]">
            <b className="font-semibold text-[#141414]">{n0(resumen.encajadas)}</b> unidades
          </span>
          <span className="rounded-full bg-[#F7F5F2] px-3 py-1.5 text-[#5E5852]">
            <b className="font-semibold text-[#141414]">{n1(resumen.pesoTotalKg)}</b> kg en total
          </span>
        </div>
        <p className="mt-3 text-[13px] leading-relaxed text-[#5E5852]">Después ya no podrás cambiarlas desde aquí. Si te equivocas, avísanos y te las volvemos a abrir.</p>

        {motivos && motivos.length > 0 && (
          <ul className="mt-4 space-y-1.5 rounded-xl bg-[#FBE3E0] px-3.5 py-3 text-[13px] text-[#7A2424]" role="alert">
            {motivos.map((m) => (
              <li key={m} className="flex items-start gap-2">
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {m}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-6 flex flex-wrap justify-end gap-2.5">
          <button type="button" onClick={onCancelar} disabled={terminando} className="h-11 rounded-xl px-5 text-[14px] font-medium text-[#5E5852] transition hover:bg-[#F7F5F2] disabled:opacity-50">
            Revisar otra vez
          </button>
          <button type="button" onClick={onConfirmar} disabled={terminando} className="flex h-11 items-center gap-2 rounded-xl bg-[#F26212] px-5 text-[14px] font-semibold text-[#FFFFFF] shadow-[0_8px_20px_-8px_rgba(242,98,18,0.7)] transition hover:bg-[#E0560C] disabled:opacity-60">
            {terminando && <Loader2 className="h-4 w-4 animate-spin" />}
            Sí, he terminado
          </button>
        </div>
      </div>
    </div>
  )
}
