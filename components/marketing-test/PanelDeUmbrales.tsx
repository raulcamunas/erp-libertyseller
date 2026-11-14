'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { ChevronDown, ChevronRight, RotateCcw, SlidersHorizontal } from 'lucide-react'
import { BOTON, CAMPO, COLOR_ESTADO, TEXTO, TIPO, TITULO } from '@/lib/estilo/denso'
import { DESCRIPCION_DE_UMBRALES, sonDePartida, UMBRALES_DE_PARTIDA, type UmbralesEstimados } from '@/lib/ads/umbrales'
import { CAJA } from './piezas'
import { llamar } from './llamar'

export interface DatosDeFichaParaMotor {
  comprasParaExacta: number
  muestraMinimaClics: number
  diasEntreCambiosPuja: number
  subidaPresupuestoPct: number
  horasEntreSubidas: number
}

const GRUPOS = ['Negativizar', 'Cosechar', 'Pujas', 'Presupuesto', 'Datos'] as const

/**
 * LAS REGLAS Y SUS NÚMEROS, a la vista: los que vienen de la ficha de cuenta (SOP, firmados: se cambian en la ficha) y los que el SOP no fija, marcados como ESTIMACIÓN y editables aquí por cuenta.
 * Plegado por defecto: el administrativo no tiene que tocarlo, pero tiene que poder ver por qué el motor propone lo que propone.
 */
export function PanelDeUmbrales({ perfilId, umbrales, guardables, ficha, alGuardar, irA }: { perfilId: string; umbrales: UmbralesEstimados; guardables: boolean; ficha: DatosDeFichaParaMotor; alGuardar: () => void; irA: (p: string) => void }) {
  const [abierto, setAbierto] = useState(false)
  const [borrador, setBorrador] = useState<Record<string, string>>({})
  const [guardando, setGuardando] = useState(false)
  const valor = (k: keyof UmbralesEstimados) => borrador[k] ?? String(umbrales[k]).replace('.', ',')
  const cambiado = Object.keys(borrador).some((k) => borrador[k] !== String(umbrales[k as keyof UmbralesEstimados]).replace('.', ','))

  async function guardar(nuevos: Record<string, string | number>) {
    setGuardando(true)
    try {
      await llamar('/api/ads/cuenta/motor', { metodo: 'PUT', cuerpo: { perfilId, umbrales: nuevos } })
      toast.success('Umbrales guardados. Se usan desde la próxima vez que el motor proponga (o al pulsar «Revisar ahora»).')
      setBorrador({})
      alGuardar()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se han podido guardar los umbrales.')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <section className={CAJA.base}>
      <button type="button" onClick={() => setAbierto((v) => !v)} className={`${CAJA.cabecera} w-full text-left`} aria-expanded={abierto}>
        {abierto ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <SlidersHorizontal className="h-[14px] w-[14px] text-[var(--ls-t3)]" />
        <h3 className={TITULO.seccion}>Reglas y umbrales del motor</h3>
        <span className={`ml-auto ${TIPO.xs} ${TEXTO.t4}`}>{sonDePartida(umbrales) ? 'Valores de partida' : 'Ajustados para esta cuenta'}</span>
      </button>
      {abierto && (
        <div className={`${CAJA.cuerpo} flex flex-col gap-4`}>
          <div>
            <div className={`${TITULO.rotulo} mb-1`}>DE LA FICHA DE CUENTA (SOP, FIRMADOS)</div>
            <p className={`${TIPO.s} ${TEXTO.t2}`}>
              Muestra mínima <strong>{ficha.muestraMinimaClics} clics</strong> antes de tocar una puja · cosecha con <strong>{ficha.comprasParaExacta} pedidos</strong> si además hay ≥ 1 ÷ CVR clics · <strong>{ficha.diasEntreCambiosPuja} días</strong> entre cambios de puja de una misma segmentación · presupuesto <strong>+{ficha.subidaPresupuestoPct} %</strong>, como mucho cada {ficha.horasEntreSubidas} h.{' '}
              <button type="button" className="underline" onClick={() => irA('ficha')}>Cambiar en la ficha</button>
            </p>
          </div>
          {!guardables && (
            <p className={`${TIPO.s}`} style={{ color: COLOR_ESTADO.ambar }}>
              Falta lanzar la migración 305: se usan los valores de partida y no se pueden cambiar todavía.
            </p>
          )}
          {GRUPOS.map((g) => (
            <div key={g}>
              <div className={`${TITULO.rotulo} mb-2`}>{g.toUpperCase()}</div>
              {/* Rejilla fija (no auto-fit): un grupo de un solo umbral no puede estirar su campo a todo el ancho */}
              <div className="grid gap-x-[14px] gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
                {(Object.keys(DESCRIPCION_DE_UMBRALES) as Array<keyof UmbralesEstimados>)
                  .filter((k) => DESCRIPCION_DE_UMBRALES[k].grupo === g)
                  .map((k) => {
                    const d = DESCRIPCION_DE_UMBRALES[k]
                    const estimacion = /Estimación/.test(d.fuente)
                    return (
                      <label key={k} className={CAMPO.contenedor}>
                        <span className={`${CAMPO.etiqueta} flex items-center gap-[6px]`}>
                          {d.nombre}
                          <span className="rounded-[4px] px-[5px] text-[10px] font-semibold" style={{ background: `color-mix(in srgb, ${estimacion ? COLOR_ESTADO.ambar : COLOR_ESTADO.azul} 16%, transparent)`, color: estimacion ? COLOR_ESTADO.ambar : COLOR_ESTADO.azul }} title={d.fuente}>
                            {estimacion ? 'Estimación' : 'Investigación'}
                          </span>
                        </span>
                        <span className="flex items-center gap-2">
                          <span className="w-[84px] shrink-0">
                            <input
                              inputMode="decimal"
                              disabled={!guardables || guardando}
                              value={valor(k)}
                              onChange={(e) => setBorrador((b) => ({ ...b, [k]: e.target.value }))}
                              className={`${CAMPO.input} ${CAMPO.numero}`}
                              aria-label={d.nombre}
                            />
                          </span>
                          <span className={`${TIPO.s} ${TEXTO.t3}`}>{d.unidad}</span>
                          {umbrales[k] !== UMBRALES_DE_PARTIDA[k] && <span className={`${TIPO.xs} ${TEXTO.t4}`}>(partida: {String(UMBRALES_DE_PARTIDA[k]).replace('.', ',')})</span>}
                        </span>
                        <span className={CAMPO.nota}>{d.nota}</span>
                      </label>
                    )
                  })}
              </div>
            </div>
          ))}
          {guardables && (
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={!cambiado || guardando} onClick={() => guardar({ ...umbrales, ...Object.fromEntries(Object.entries(borrador).map(([k, v]) => [k, v.replace(',', '.')])) })} className={`${BOTON.base} ${BOTON.primario}`}>
                {guardando ? 'Guardando…' : 'Guardar umbrales'}
              </button>
              {cambiado && (
                <button type="button" onClick={() => setBorrador({})} className={`${BOTON.base} ${BOTON.secundario}`}>
                  Deshacer cambios
                </button>
              )}
              {!sonDePartida(umbrales) && (
                <button type="button" disabled={guardando} onClick={() => guardar({ ...UMBRALES_DE_PARTIDA })} className={`${BOTON.base} ${BOTON.secundario}`}>
                  <RotateCcw className="h-3 w-3" /> Volver a los de partida
                </button>
              )}
              <span className={`${TIPO.s} ${TEXTO.t4}`}>Un valor fuera de sus límites se ignora y se queda el de partida.</span>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
