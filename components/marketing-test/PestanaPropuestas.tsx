'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { ArrowRight, Ban, CheckCircle2, ChevronDown, ChevronRight, CircleAlert, Lock, RefreshCw, Undo2 } from 'lucide-react'
import { AVISO, BOTON, COLOR_ESTADO, TEXTO, TIPO, TITULO } from '@/lib/estilo/denso'
import { CAJA as TARJETA } from './piezas'
import { Cargando } from '@/components/plataforma/comun'
import type { ModoDelMotor, Propuesta } from '@/lib/ads/motor'
import type { EstadoDeTerminos } from '@/lib/ads/terminos'
import { agruparPorProducto } from '@/lib/ads/productos-agrupar'
import { totalesDe } from '@/lib/ads/rendimiento-calculo'
import { decimal, dinero, entero, haceCuanto, porcentaje } from './formato'
import { llamar } from './llamar'
import { useProductosConocidos } from './useProductosConocidos'

interface Datos {
  modo: ModoDelMotor
  firmada: boolean
  terminos: EstadoDeTerminos
  propuestas: Propuesta[]
  aplicables: Record<string, string | null>
  topeAutopiloto: number
}

const MODOS: Array<{ id: ModoDelMotor; nombre: string; texto: string; aplica: boolean }> = [
  { id: 'apagado', nombre: 'Apagado', texto: 'El motor no hace nada en esta cuenta.', aplica: false },
  { id: 'sugiere', nombre: 'Solo sugiere', texto: 'Propone cambios y los enseña aquí. No toca nada en Amazon.', aplica: false },
  { id: 'aprueba', nombre: 'Aprueba y aplica', texto: 'Propone y, cuando tú pulsas «Aplicar», lo hace en Amazon. Todo se puede deshacer.', aplica: true },
  { id: 'autopiloto', nombre: 'Autopiloto de negativas', texto: 'Excluye solo los términos que gastan sin vender (tope diario). Promover keywords siempre pide tu aprobación.', aplica: true },
]

const ESTILO_ESTADO: Record<string, { texto: string; color: string }> = {
  aplicada: { texto: 'Aplicada', color: COLOR_ESTADO.verde },
  descartada: { texto: 'Descartada', color: COLOR_ESTADO.gris },
  deshecha: { texto: 'Deshecha', color: COLOR_ESTADO.gris },
  error: { texto: 'Error', color: COLOR_ESTADO.rojo },
  caducada: { texto: 'Caducada', color: COLOR_ESTADO.gris },
  aprobada: { texto: 'Aprobada', color: COLOR_ESTADO.azul },
  pendiente: { texto: 'Pendiente', color: COLOR_ESTADO.ambar },
}

/**
 * LAS PROPUESTAS DEL MOTOR DE OPTIMIZACIÓN: cada cambio que sugiere el SOP, con su motivo en una línea, y el interruptor de cuánto se le deja hacer. Lo que se aplica escribe en la cuenta del cliente y
 * se puede deshacer. El servidor vuelve a comprobar todos los candados (modo, ficha firmada, tope diario…) al aplicar: esta pantalla solo los enseña.
 */
export function PestanaPropuestas({ perfilId, moneda, irA }: { perfilId: string; moneda: string | null; irA: (pestana: string) => void }) {
  const [datos, setDatos] = useState<Datos | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [verHistorial, setVerHistorial] = useState(false)
  const conocidos = useProductosConocidos(perfilId)
  const vivo = useRef(true)

  const cargar = useCallback(async () => {
    try {
      const d = await llamar<Datos>(`/api/ads/cuenta/motor?perfilId=${perfilId}`)
      if (vivo.current) {
        setDatos(d)
        setError(null)
      }
    } catch (e) {
      if (vivo.current) setError(e instanceof Error ? e.message : 'No se ha podido cargar el motor.')
    }
  }, [perfilId])

  useEffect(() => {
    vivo.current = true
    void cargar()
    return () => {
      vivo.current = false
    }
  }, [cargar])

  // Mientras Amazon prepara el informe de términos, se vuelve a preguntar solo
  useEffect(() => {
    if (!datos?.terminos.sincronizando) return
    const t = setTimeout(() => void cargar(), 8000)
    return () => clearTimeout(t)
  }, [datos, cargar])

  async function accion(id: string | null, nombre: string, cuerpo: Record<string, unknown>, ok: string) {
    setOcupado(id ?? nombre)
    try {
      await llamar('/api/ads/cuenta/motor', { metodo: 'POST', cuerpo: { perfilId, ...cuerpo } })
      toast.success(ok)
      await cargar()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se ha podido completar.')
      await cargar()
    } finally {
      setOcupado(null)
    }
  }

  async function cambiarModo(modo: ModoDelMotor) {
    setOcupado('modo')
    try {
      await llamar('/api/ads/cuenta/motor', { metodo: 'PUT', cuerpo: { perfilId, modo } })
      toast.success(`Motor: ${MODOS.find((m) => m.id === modo)?.nombre.toLowerCase()}.`)
      await cargar()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se ha podido cambiar el modo.')
    } finally {
      setOcupado(null)
    }
  }

  const pendientes = useMemo(() => datos?.propuestas.filter((p) => p.estado === 'pendiente' || p.estado === 'error') ?? [], [datos])
  const historial = useMemo(() => datos?.propuestas.filter((p) => p.estado !== 'pendiente' && p.estado !== 'error') ?? [], [datos])
  const grupos = useMemo(() => {
    // Se agrupan por el producto de la campaña de origen (el ASIN que lleva su nombre)
    const filas = pendientes.map((p) => ({ ...p, nombre: p.campaignNombre, ...totalesDe([]) }))
    return agruparPorProducto(filas, new Map([...conocidos].map(([asin, c]) => [asin, c.resumen])))
  }, [pendientes, conocidos])

  if (error) return <p className={`${AVISO.base} ${AVISO.conTono}`} style={{ borderLeftColor: COLOR_ESTADO.rojo }}>{error}</p>
  if (!datos) return <Cargando />

  const { modo, firmada, terminos } = datos
  const modoActual = MODOS.find((m) => m.id === modo) ?? MODOS[0]
  const negativas = pendientes.filter((p) => p.tipo === 'negativizar').length

  return (
    <div className="flex max-w-[1080px] flex-col gap-3 pb-8">
      {/* ------- el interruptor ------- */}
      <section className={TARJETA.base}>
        <header className={TARJETA.cabecera}>
          <h2 className={TITULO.seccion}>Motor de optimización · cuánto se le deja hacer</h2>
        </header>
        <div className={`${TARJETA.cuerpo} flex flex-col gap-3`}>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {MODOS.map((m) => {
              const bloqueado = m.aplica && !firmada
              const activo = m.id === modo
              return (
                <button
                  key={m.id}
                  type="button"
                  disabled={ocupado !== null || bloqueado}
                  onClick={() => !activo && cambiarModo(m.id)}
                  title={bloqueado ? 'Para poder aplicar cambios, la ficha de cuenta tiene que estar firmada.' : undefined}
                  className={`rounded-[8px] border px-3 py-[9px] text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${activo ? 'border-[var(--ls-acc-borde)] bg-[var(--ls-acc-relleno)]' : 'border-[var(--ls-linea)] bg-[var(--ls-sup)] hover:bg-[var(--ls-sup2)]'}`}
                >
                  <div className="flex items-center gap-[6px] text-[12.5px] font-semibold" style={{ color: activo ? 'var(--ls-acc-tinta)' : 'var(--ls-t1)' }}>
                    {bloqueado && <Lock className="h-3 w-3" />} {m.nombre}
                  </div>
                  <div className={`mt-[2px] text-[11px] leading-[1.4] ${activo ? 'text-[var(--ls-acc-tinta)] opacity-80' : TEXTO.t3}`}>{m.texto}</div>
                </button>
              )
            })}
          </div>
          {!firmada && (
            <div className={`${AVISO.base} ${AVISO.conTono}`} style={{ borderLeftColor: COLOR_ESTADO.ambar }}>
              <CircleAlert className={AVISO.icono} />
              <span>
                La ficha de cuenta <span className={AVISO.fuerte}>no está firmada</span>: el motor puede proponer, pero no aplicar nada hasta que los umbrales estén firmados.{' '}
                <button type="button" className="underline" onClick={() => irA('ficha')}>Ir a la ficha</button>
              </span>
            </div>
          )}
          {modo === 'autopiloto' && (
            <p className={`${TIPO.s} ${TEXTO.t3}`}>
              El piloto excluye solo, como mucho <strong className={TEXTO.t1}>{datos.topeAutopiloto} términos al día</strong> en esta cuenta, y solo en campañas con la nomenclatura del SOP. Todo queda en el log y se puede deshacer desde aquí.
            </p>
          )}
        </div>
      </section>

      {modo === 'apagado' ? (
        <section className={`${TARJETA.base} ${TARJETA.cuerpo}`}>
          <h3 className={TITULO.seccion}>Cómo funciona</h3>
          <ul className={`mt-2 flex list-disc flex-col gap-1 pl-5 ${TIPO.s} ${TEXTO.t2}`}>
            <li>Una vez al día lee de Amazon los términos de búsqueda de los últimos 14 días de esta cuenta.</li>
            <li>Aplica las reglas del SOP con los umbrales de la ficha y el ACoS objetivo de cada producto: <strong>negativizar</strong> lo que gasta sin vender y <strong>promover</strong> de Automática a Amplia y de Amplia a Exacta lo que compra.</li>
            <li><strong>Pujas</strong>: sube la de lo que vende muy por debajo del objetivo, baja la de lo que vende por encima o gasta sin vender (el % de la ficha, con su cuarentena entre cambios). <strong>Presupuesto</strong>: lo sube en las campañas que cumplen el objetivo y se quedan cortas. Siempre con tu aprobación.</li>
            <li>Cada propuesta lleva su motivo. Empieza en «Solo sugiere» unos días para ver qué propondría, sin tocar nada.</li>
            <li>Necesita el <strong>ACoS objetivo de cada producto</strong> (lo fijas tú en la pestaña Productos) y su precio: de ahí sale lo que puede gastar un término sin vender. Sin él, no se le propone nada.</li>
          </ul>
        </section>
      ) : (
        <>
          {/* ------- estado de los datos ------- */}
          <div className="flex flex-wrap items-center gap-2">
            <span className={`${TIPO.s} ${TEXTO.t3}`}>
              {terminos.actualizadoAt ? (
                <>
                  Términos de los últimos 14 días ({entero(terminos.filas)} con señal) · actualizados {haceCuanto(Date.parse(terminos.actualizadoAt))}
                </>
              ) : terminos.sincronizando ? (
                'Amazon está preparando los términos de búsqueda (la primera vez puede tardar unos minutos)…'
              ) : (
                'Todavía no se han leído los términos de búsqueda.'
              )}
            </span>
            {terminos.error && <span className={TIPO.xs} style={{ color: COLOR_ESTADO.ambar }}>Última lectura fallida: {terminos.error}</span>}
            <span className="ml-auto flex gap-2">
              <button type="button" disabled={ocupado !== null || terminos.sincronizando} onClick={() => accion(null, 'terminos', { accion: 'actualizar-terminos' }, 'Pidiendo los términos a Amazon…')} className={`${BOTON.base} ${BOTON.secundario}`}>
                <RefreshCw className={`h-3 w-3 ${terminos.sincronizando ? 'animate-spin' : ''}`} /> Actualizar términos
              </button>
              <button type="button" disabled={ocupado !== null || terminos.filas === 0} onClick={() => accion(null, 'generar', { accion: 'generar' }, 'Propuestas revisadas.')} className={`${BOTON.base} ${BOTON.secundario}`}>
                Generar propuestas ahora
              </button>
            </span>
          </div>

          {/* ------- las propuestas pendientes ------- */}
          {pendientes.length === 0 ? (
            <section className={`${TARJETA.base} ${TARJETA.cuerpo}`}>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4" style={{ color: COLOR_ESTADO.verde }} />
                <span className={`${TIPO.s} ${TEXTO.t2}`}>
                  {terminos.filas === 0 ? 'Cuando lleguen los términos, las propuestas aparecerán aquí.' : 'No hay nada que proponer ahora mismo: ningún término cumple las reglas con la muestra suficiente.'}
                </span>
              </div>
              <p className={`mt-2 ${TIPO.xs} ${TEXTO.t4}`}>Los productos sin ACoS objetivo (pestaña Productos) no se evalúan. Los términos que ya se propusieron o se resolvieron hace menos de 14 días tampoco se repiten.</p>
            </section>
          ) : (
            <>
              <div className={`${TIPO.s} ${TEXTO.t3}`}>
                {pendientes.length} {pendientes.length === 1 ? 'propuesta pendiente' : 'propuestas pendientes'} · {negativas} de negativizar · {pendientes.filter((p) => p.tipo === 'promover').length} de promover · {pendientes.filter((p) => p.tipo === 'puja').length} de puja · {pendientes.filter((p) => p.tipo === 'presupuesto').length} de presupuesto
              </div>
              {grupos.map((g) => (
                <section key={g.clave} className={TARJETA.base}>
                  <header className={`${TARJETA.cabecera} justify-between`}>
                    <h3 className={`${TITULO.seccion} truncate`}>{g.titulo}</h3>
                    <span className={`${TIPO.xs} ${TEXTO.t4}`}>{g.asin ?? ''} · {g.campanas.length} {g.campanas.length === 1 ? 'propuesta' : 'propuestas'}</span>
                  </header>
                  <div className="divide-y divide-[var(--ls-linea)]">
                    {g.campanas.map((p) => (
                      <FilaDePropuesta key={p.id} p={p} moneda={moneda} bloqueo={datos.aplicables[p.id] ?? null} ocupado={ocupado === p.id} algoOcupado={ocupado !== null} aplicar={() => confirmarYAplicar(p)} descartar={() => accion(p.id, 'descartar', { accion: 'descartar', id: p.id }, 'Descartada.')} />
                    ))}
                  </div>
                </section>
              ))}
            </>
          )}

          {/* ------- el historial ------- */}
          {historial.length > 0 && (
            <section className={TARJETA.base}>
              <button type="button" onClick={() => setVerHistorial((v) => !v)} className={`${TARJETA.cabecera} w-full text-left`} aria-expanded={verHistorial}>
                {verHistorial ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                <h3 className={TITULO.seccion}>Historial · últimos 30 días</h3>
                <span className={`ml-auto ${TIPO.xs} ${TEXTO.t4}`}>{historial.length}</span>
              </button>
              {verHistorial && (
                <div className="divide-y divide-[var(--ls-linea)]">
                  {historial.map((p) => (
                    <FilaDePropuesta key={p.id} p={p} moneda={moneda} bloqueo={null} ocupado={ocupado === p.id} algoOcupado={ocupado !== null} historial deshacer={() => confirmarYDeshacer(p)} />
                  ))}
                </div>
              )}
            </section>
          )}
        </>
      )}
      <p className={`${TIPO.xs} ${TEXTO.t4}`}>Modo actual: <strong>{modoActual.nombre}</strong>. Las reglas y los umbrales son los de la ficha de cuenta (SOP, sección 05); cada cambio aplicado queda en el Log de cambios.</p>
    </div>
  )

  function confirmarYAplicar(p: Propuesta) {
    const que =
      p.tipo === 'negativizar'
        ? `excluir «${p.termino}» (coincidencia exacta negativa) de la campaña\n${p.campaignNombre}`
        : p.tipo === 'puja'
          ? `cambiar la puja de «${p.termino}» de ${p.valorActual?.toFixed(2)} a ${p.valorNuevo?.toFixed(2)} en\n${p.campaignNombre}`
          : p.tipo === 'presupuesto'
            ? `subir el presupuesto diario de ${p.valorActual?.toFixed(2)} a ${p.valorNuevo?.toFixed(2)} en\n${p.campaignNombre}`
            : `añadir «${p.termino}» a ${p.haciaCampaignNombre} y excluirlo de ${p.campaignNombre}`
    if (!window.confirm(`Se va a ${que}.\n\nSe escribe en la cuenta de Amazon Ads del cliente. Se puede deshacer desde el historial.\n\n${p.motivo}\n\n¿Aplicar?`)) return
    void accion(p.id, 'aplicar', { accion: 'aplicar', id: p.id }, 'Aplicada en Amazon.')
  }

  function confirmarYDeshacer(p: Propuesta) {
    if (!window.confirm(`Se va a quitar de Amazon lo que creó esta propuesta («${p.termino}»). ¿Deshacer?`)) return
    void accion(p.id, 'deshacer', { accion: 'deshacer', id: p.id }, 'Deshecha.')
  }
}

/** El color y el nombre de cada tipo: lo que sube gasto en verde, lo que lo recorta en rojo/ámbar */
const COLOR_DE_PROPUESTA = (p: Propuesta) =>
  p.tipo === 'negativizar' ? COLOR_ESTADO.rojo : p.tipo === 'promover' ? COLOR_ESTADO.verde : p.tipo === 'presupuesto' ? COLOR_ESTADO.azul : (p.valorNuevo ?? 0) >= (p.valorActual ?? 0) ? COLOR_ESTADO.verde : COLOR_ESTADO.ambar
const NOMBRE_DE_PROPUESTA = (p: Propuesta) =>
  p.tipo === 'negativizar' ? 'Negativizar' : p.tipo === 'promover' ? 'Promover' : p.tipo === 'presupuesto' ? 'Subir presupuesto' : (p.valorNuevo ?? 0) >= (p.valorActual ?? 0) ? 'Subir puja' : 'Bajar puja'

function FilaDePropuesta({ p, moneda, bloqueo, ocupado, algoOcupado, historial, aplicar, descartar, deshacer }: { p: Propuesta; moneda: string | null; bloqueo: string | null; ocupado: boolean; algoOcupado: boolean; historial?: boolean; aplicar?: () => void; descartar?: () => void; deshacer?: () => void }) {
  const m = p.metricas
  const estilo = ESTILO_ESTADO[p.estado]
  return (
    <div className="flex flex-wrap items-start gap-x-4 gap-y-2 px-[12px] py-[10px]">
      <div className="min-w-[260px] flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex h-[18px] items-center rounded-[4px] px-[6px] text-[10.5px] font-semibold" style={{ background: `color-mix(in srgb, ${COLOR_DE_PROPUESTA(p)} 18%, transparent)`, color: COLOR_DE_PROPUESTA(p) }}>
            {NOMBRE_DE_PROPUESTA(p)}
          </span>
          <span className="max-w-[460px] truncate text-[13px] font-semibold text-[var(--ls-t1)]" title={p.termino}>{p.tipo === 'presupuesto' ? 'Presupuesto diario' : p.termino}</span>
          {(p.tipo === 'puja' || p.tipo === 'presupuesto') && p.valorActual != null && p.valorNuevo != null && (
            <span className="inline-flex items-center gap-1 text-[12.5px] tabular-nums text-[var(--ls-t2)]">
              {dinero(p.valorActual, moneda)} <ArrowRight className="h-3 w-3" /> <strong style={{ color: COLOR_DE_PROPUESTA(p) }}>{dinero(p.valorNuevo, moneda)}</strong>
            </span>
          )}
          {historial && estilo && (
            <span className="inline-flex h-[17px] items-center rounded-full border px-[7px] text-[10.5px] font-medium" style={{ color: estilo.color, borderColor: estilo.color }}>
              {estilo.texto}
              {p.automatica ? ' · automática' : ''}
            </span>
          )}
        </div>
        <div className={`mt-[3px] flex flex-wrap items-center gap-[5px] ${TIPO.xs} ${TEXTO.t4}`}>
          <span className="max-w-[420px] truncate" title={p.campaignNombre}>{p.desdeRol ?? p.campaignNombre}</span>
          {p.tipo === 'promover' && (
            <>
              <ArrowRight className="h-3 w-3" />
              <span style={p.haciaCampaignId ? undefined : { color: COLOR_ESTADO.ambar }}>{p.haciaRol ?? '—'}{p.haciaCampaignId ? '' : ' (no existe)'}</span>
            </>
          )}
        </div>
        <p className={`mt-1 ${TIPO.s} ${TEXTO.t2}`}>{p.motivo}</p>
        {p.error && <p className={`mt-1 ${TIPO.xs}`} style={{ color: COLOR_ESTADO.rojo }}>{p.error}</p>}
        {bloqueo && !historial && <p className={`mt-1 ${TIPO.xs}`} style={{ color: COLOR_ESTADO.ambar }}>{bloqueo}</p>}
      </div>
      <div className="flex shrink-0 gap-4 text-right">
        {p.tipo === 'presupuesto' ? <Dato etiqueta="Uso" valor={m.usoPct == null ? '—' : `${m.usoPct} %`} /> : <Dato etiqueta="Clics" valor={entero(m.clics)} />}
        <Dato etiqueta={p.tipo === 'presupuesto' ? 'Gasto 7 d' : 'Gasto'} valor={dinero(m.gasto, moneda)} />
        {p.tipo === 'presupuesto' ? <Dato etiqueta="Ventas 7 d" valor={dinero(m.ventas, moneda)} /> : <Dato etiqueta="Pedidos" valor={entero(m.pedidos)} />}
        <Dato etiqueta="ACoS" valor={m.acosPct == null ? '—' : `${decimal(m.acosPct, 1)} %`} />
      </div>
      <div className="flex shrink-0 items-center gap-[6px]">
        {!historial && (
          <>
            <button type="button" disabled={algoOcupado || bloqueo !== null} onClick={aplicar} title={bloqueo ?? undefined} className={`${BOTON.base} ${BOTON.primario}`}>
              {ocupado ? 'Aplicando…' : 'Aplicar'}
            </button>
            <button type="button" disabled={algoOcupado} onClick={descartar} className={`${BOTON.base} ${BOTON.secundario}`} title="No volverá a proponerse en 14 días">
              <Ban className="h-3 w-3" /> Descartar
            </button>
          </>
        )}
        {historial && p.estado === 'aplicada' && (
          <button type="button" disabled={algoOcupado} onClick={deshacer} className={`${BOTON.base} ${BOTON.secundario}`}>
            <Undo2 className="h-3 w-3" /> Deshacer
          </button>
        )}
      </div>
    </div>
  )
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div>
      <div className={`${TIPO.xs} ${TEXTO.t4}`}>{etiqueta}</div>
      <div className="text-[13px] font-medium tabular-nums text-[var(--ls-t1)]">{valor}</div>
    </div>
  )
}
