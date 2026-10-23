'use client'

import { AlertTriangle, KeyRound, Loader2, RefreshCw, Sparkles } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Aviso, hace } from '@/components/plataforma/comun'
import { BOTON, COLOR_ESTADO, LINEA, RADIO, SUPERFICIE, TEXTO, TIPO, TITULO } from '@/lib/estilo/denso'
import { enDolares, type ResumenDeGasto } from '@/lib/ia-gasto/resumen'
import type { RespuestaDeGasto } from '@/lib/ia-gasto/servidor'

/**
 * CUÁNTO SE HA GASTADO EN IA, EN LA PANTALLA DE SISTEMA.
 *
 * La cifra es la que cobra OpenAI (se lee de su cuenta con una clave de administrador, lib/ia-gasto/), no una estimación del ERP: hoy, este mes y su
 * previsión, el mes anterior, los últimos 30 días y los 12 meses, un gráfico día a día, y el mes por modelo con para qué se usa habitualmente cada uno.
 *
 * El desglose es por MODELO y no por función porque OpenAI solo dice el modelo y varias funciones comparten uno (gpt-4o lo usan seis pantallas). Los
 * días son los de UTC, que es como los corta OpenAI, y el de hoy se va rellenando a lo largo del día.
 */

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const MESES_LARGOS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

/** «2026-10-23» -> «23 oct» */
const diaCorto = (dia: string) => `${Number(dia.slice(8))} ${MESES[Number(dia.slice(5, 7)) - 1]}`
/** «2026-10» -> «oct 26» */
const mesCorto = (mes: string) => `${MESES[Number(mes.slice(5, 7)) - 1]} ${mes.slice(2, 4)}`
const mesLargo = (mes: string) => MESES_LARGOS[Number(mes.slice(5, 7)) - 1]

/** Cada cuánto se vuelve a leer sola, con la pantalla abierta */
const CADA_MS = 5 * 60_000

function Cifra({ titulo, valor, nota }: { titulo: string; valor: string; nota?: string | null }) {
  return (
    <div className={`${SUPERFICIE.sup2} ${RADIO.r2} border ${LINEA.normal} px-[10px] py-[8px] min-w-0`}>
      <p className={`${TIPO.xs} ${TEXTO.t4}`}>{titulo}</p>
      <p className={`mt-[2px] text-[17px] font-semibold tracking-[-0.012em] ${TEXTO.t1} ${TIPO.num} truncate`}>{valor}</p>
      {nota && <p className={`${TIPO.s} ${TEXTO.t4} leading-[1.35]`}>{nota}</p>}
    </div>
  )
}

/** El gasto de cada uno de los últimos 30 días: barras finas pegadas a la base, la de hoy más apagada porque va a medias */
function GraficoDiario({ dias }: { dias: ResumenDeGasto['dias'] }) {
  const maximo = Math.max(...dias.map((d) => d.dolares), 0)
  return (
    <div>
      <div className="mb-[4px] flex items-baseline justify-between">
        <span className={`${TIPO.xs} ${TEXTO.t4}`}>Cada día, últimos 30</span>
        {maximo > 0 && <span className={`${TIPO.s} ${TEXTO.t4} ${TIPO.num}`}>máximo {enDolares(maximo)}</span>}
      </div>
      <div className="flex h-[76px] items-end gap-[2px]" role="img" aria-label="Gasto diario en IA de los últimos 30 días">
        {dias.map((d, i) => {
          const alto = d.dolares <= 0 || maximo <= 0 ? 0 : Math.max((d.dolares / maximo) * 100, 3)
          const esHoy = i === dias.length - 1
          return (
            <div key={d.dia} className="flex h-full min-w-0 flex-1 items-end" title={`${diaCorto(d.dia)}${esHoy ? ' (hoy, a medias)' : ''}: ${enDolares(d.dolares)}`}>
              {/* Un día sin gasto deja una raya de 1 px: se ve que hay día, sin parecer gasto */}
              <div
                className="w-full rounded-t-[3px]"
                style={{ height: alto === 0 ? '1px' : `${alto}%`, background: alto === 0 ? 'var(--ls-linea2)' : 'var(--ls-acc)', opacity: esHoy ? 0.55 : 1 }}
              />
            </div>
          )
        })}
      </div>
      <div className={`mt-[3px] flex justify-between ${TIPO.s} ${TEXTO.t4}`}>
        <span>{diaCorto(dias[0].dia)}</span>
        <span>{diaCorto(dias[dias.length - 1].dia)}</span>
      </div>
    </div>
  )
}

function PorModelo({ modelos, total }: { modelos: ResumenDeGasto['porModelo']; total: number }) {
  if (modelos.length === 0) return <p className={`${TIPO.s} ${TEXTO.t4}`}>Este mes todavía no hay gasto.</p>
  return (
    <ul className="space-y-[6px]">
      {modelos.map((m) => (
        <li key={m.modelo} className="min-w-0">
          <div className="flex items-baseline justify-between gap-2">
            <span className={`min-w-0 truncate ${TIPO.m} ${TEXTO.t1}`}>
              {m.modelo} <span className={`${TIPO.s} ${TEXTO.t4}`}>· {m.uso}</span>
            </span>
            <span className={`shrink-0 ${TIPO.m} ${TEXTO.t1} ${TIPO.num}`}>
              {enDolares(m.dolares)} <span className={`${TIPO.s} ${TEXTO.t4}`}>{total > 0 ? `${Math.round(m.parte * 100)} %` : ''}</span>
            </span>
          </div>
          <div className="mt-[3px] h-[3px] w-full overflow-hidden rounded-full bg-[var(--ls-sup3)]">
            <div className="h-full rounded-full" style={{ width: `${Math.round(m.parte * 100)}%`, background: 'var(--ls-acc)' }} />
          </div>
        </li>
      ))}
    </ul>
  )
}

function PorMes({ meses }: { meses: ResumenDeGasto['meses'] }) {
  const maximo = Math.max(...meses.map((m) => m.dolares), 0)
  // Los meses vacíos del principio no dicen nada: se empieza en el primero con gasto (y si no hay ninguno, solo el actual)
  const con = meses.findIndex((m) => m.dolares > 0)
  const visibles = meses.slice(con === -1 ? meses.length - 1 : con).reverse()
  return (
    <ul className="space-y-[4px]">
      {visibles.map((m) => (
        <li key={m.mes} className="flex items-center gap-2">
          <span className={`w-[44px] shrink-0 ${TIPO.s} ${TEXTO.t4}`}>{mesCorto(m.mes)}</span>
          <div className="h-[6px] min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--ls-sup3)]">
            <div className="h-full rounded-full" style={{ width: `${maximo > 0 ? Math.round((m.dolares / maximo) * 100) : 0}%`, background: 'var(--ls-acc)' }} />
          </div>
          <span className={`w-[70px] shrink-0 text-right ${TIPO.s} ${TEXTO.t2} ${TIPO.num}`}>{enDolares(m.dolares)}</span>
        </li>
      ))}
    </ul>
  )
}

/** Toda la cuenta de OpenAI: lo del ERP frente a lo de las demás claves (n8n, otras webs…) */
function PorClave({ claves, cuenta }: { claves: ResumenDeGasto['porClave']; cuenta: ResumenDeGasto['cuenta'] }) {
  if (claves.length === 0) return null
  const maximo = Math.max(...claves.map((k) => k.total), 0)
  return (
    <div className={`${SUPERFICIE.sup2} ${RADIO.r2} border ${LINEA.normal} px-[10px] py-[8px]`}>
      <div className="mb-[6px] flex flex-wrap items-baseline justify-between gap-x-3">
        <p className={`${TIPO.xs} ${TEXTO.t4}`}>Toda la cuenta de OpenAI, por clave de API (12 meses)</p>
        <p className={`${TIPO.s} ${TEXTO.t3} ${TIPO.num}`}>
          Este mes {enDolares(cuenta.esteMes)} · 12 meses {enDolares(cuenta.total)}
        </p>
      </div>
      <ul className="space-y-[5px]">
        {claves.map((k) => (
          <li key={k.id ?? 'sin-clave'} className="flex items-center gap-2">
            <span className={`w-[190px] shrink-0 truncate ${TIPO.m} ${k.esErp ? TEXTO.t1 : TEXTO.t2}`} title={k.nombre}>
              {k.nombre}
              {k.esErp && <span className={`ml-[6px] ${TIPO.s}`} style={{ color: COLOR_ESTADO.naranja }}>ERP</span>}
            </span>
            <div className="h-[5px] min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--ls-sup3)]">
              <div className="h-full rounded-full" style={{ width: `${maximo > 0 ? Math.max(Math.round((k.total / maximo) * 100), 1) : 0}%`, background: k.esErp ? 'var(--ls-acc)' : 'var(--ls-t4)' }} />
            </div>
            <span className={`w-[150px] shrink-0 text-right ${TIPO.s} ${TEXTO.t2} ${TIPO.num}`}>
              {enDolares(k.total)} <span className={TEXTO.t4}>· mes {enDolares(k.esteMes)}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function GastoEnIa() {
  const [datos, setDatos] = useState<RespuestaDeGasto | null>(null)
  const [falloDeRed, setFalloDeRed] = useState<string | null>(null)
  const [refrescando, setRefrescando] = useState(false)

  const cargar = useCallback(async (refrescar: boolean) => {
    if (refrescar) setRefrescando(true)
    try {
      const res = await fetch(`/api/sistema/gasto-ia${refrescar ? '?refrescar=1' : ''}`, { cache: 'no-store' })
      const cuerpo = (await res.json().catch(() => null)) as (RespuestaDeGasto & { error?: string }) | null
      if (!res.ok || !cuerpo || !('estado' in cuerpo)) throw new Error((cuerpo as { error?: string } | null)?.error ?? 'No se ha podido leer el gasto')
      setDatos(cuerpo)
      setFalloDeRed(null)
    } catch (e) {
      setFalloDeRed(e instanceof Error ? e.message : 'No se ha podido leer el gasto')
    } finally {
      setRefrescando(false)
    }
  }, [])

  useEffect(() => {
    void cargar(false)
    const t = setInterval(() => void cargar(false), CADA_MS)
    return () => clearInterval(t)
  }, [cargar])

  const cabecera = (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
      <div className="min-w-0">
        <div className="flex items-center gap-[6px]">
          <Sparkles className="h-[13px] w-[13px] shrink-0" style={{ color: COLOR_ESTADO.naranja }} aria-hidden />
          <h3 className={`${TITULO.seccion}`}>Gasto en IA</h3>
        </div>
        <p className={`${TIPO.s} ${TEXTO.t4}`}>
          {datos?.estado === 'ok' && datos.resumen.alcance.tipo === 'erp'
            ? `Lo que cobra OpenAI por la clave «${datos.resumen.alcance.nombre}», la de toda la IA del ERP: correos, remesas, llamadas, citas, auditor, marketing…`
            : 'Lo que cobra OpenAI por la IA: correos, remesas, llamadas, citas, auditor, marketing…'}
        </p>
      </div>
      {datos?.estado === 'ok' && (
        <div className="flex items-center gap-2">
          <span className={`${TIPO.s} ${TEXTO.t4}`}>Leído {hace(datos.actualizadoAt)}</span>
          <button type="button" onClick={() => void cargar(true)} disabled={refrescando} className={`${BOTON.base} ${BOTON.secundario}`} title="Volver a leer de OpenAI">
            {refrescando ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden />}
            Actualizar
          </button>
        </div>
      )}
    </div>
  )

  let cuerpo: React.ReactNode
  if (!datos && !falloDeRed) {
    cuerpo = (
      <p className={`flex items-center gap-[6px] ${TIPO.s} ${TEXTO.t4}`}>
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Leyendo el gasto de OpenAI…
      </p>
    )
  } else if (!datos) {
    cuerpo = (
      <Aviso tono="rojo" icono={AlertTriangle}>
        {falloDeRed}
      </Aviso>
    )
  } else if (datos.estado === 'sin_clave') {
    cuerpo = (
      <Aviso tono="ambar" icono={KeyRound}>
        {datos.mensaje}
      </Aviso>
    )
  } else if (datos.estado === 'error') {
    cuerpo = (
      <Aviso tono="rojo" icono={AlertTriangle}>
        <p>{datos.mensaje}</p>
        {datos.detalle && <p className={`mt-[2px] ${TEXTO.t3}`}>{datos.detalle}</p>}
      </Aviso>
    )
  } else {
    const r = datos.resumen
    const mesActual = r.meses[r.meses.length - 1].mes
    cuerpo = (
      <div className="space-y-[10px]">
        {datos.desactualizado && (
          <Aviso tono="ambar" icono={AlertTriangle}>
            No se ha podido actualizar ({datos.motivo}). Se enseña lo último que se leyó, {hace(datos.actualizadoAt)}.
          </Aviso>
        )}

        {r.alcance.tipo === 'cuenta' && (
          <Aviso tono="ambar" icono={AlertTriangle}>
            No se ha podido saber cuál es la clave del ERP, así que las cifras son las de TODA la cuenta de OpenAI (incluidas otras claves). Abajo se ve cuánto gasta cada clave.
          </Aviso>
        )}

        <div className="grid grid-cols-2 gap-[8px] md:grid-cols-5">
          <Cifra titulo="Hoy" valor={enDolares(r.hoy)} nota="se va rellenando" />
          <Cifra titulo={`Este mes (${mesLargo(mesActual)})`} valor={enDolares(r.esteMes)} nota={r.previsionDelMes !== null && r.esteMes > 0 ? `a este ritmo, ≈ ${enDolares(r.previsionDelMes)}` : null} />
          <Cifra titulo="Mes anterior" valor={enDolares(r.mesAnterior)} />
          <Cifra titulo="Últimos 30 días" valor={enDolares(r.ultimos30)} />
          <Cifra titulo="Últimos 12 meses" valor={enDolares(r.total)} nota={r.primerDia ? `desde el ${diaCorto(r.primerDia)}` : null} />
        </div>

        <GraficoDiario dias={r.dias} />

        <div className="grid gap-[14px] md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <div className="min-w-0">
            <p className={`mb-[6px] ${TIPO.xs} ${TEXTO.t4}`}>Este mes, por modelo</p>
            <PorModelo modelos={r.porModelo} total={r.esteMes} />
            {r.porProyecto.length > 0 && (
              <div className="mt-[10px]">
                <p className={`mb-[4px] ${TIPO.xs} ${TEXTO.t4}`}>Este mes, por proyecto de OpenAI</p>
                <ul className="space-y-[2px]">
                  {r.porProyecto.map((p) => (
                    <li key={p.id} className={`flex justify-between gap-2 ${TIPO.m} ${TEXTO.t2}`}>
                      <span className="min-w-0 truncate">{p.nombre ?? p.id}</span>
                      <span className={`shrink-0 ${TIPO.num}`}>{enDolares(p.dolares)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <div className="min-w-0">
            <p className={`mb-[6px] ${TIPO.xs} ${TEXTO.t4}`}>Mes a mes</p>
            <PorMes meses={r.meses} />
          </div>
        </div>

        <PorClave claves={r.porClave} cuenta={r.cuenta} />

        <p className={`${TIPO.s} ${TEXTO.t4} leading-[1.45]`}>
          Es la cifra de OpenAI, no una estimación. Solo deja mirar el último año; los días son los de UTC y puede tardar un rato en reflejar lo último. OpenAI solo
          dice el modelo, no la función: varias pantallas comparten modelo (gpt-4o lo usan el auditor, el listing, marketing, el tracker y el validador), así que
          «para qué se usa» es lo habitual y no una cuenta exacta.
        </p>
      </div>
    )
  }

  return (
    <section className={`${SUPERFICIE.sup} ${RADIO.r2} border ${LINEA.normal} p-[12px] space-y-[10px]`} aria-label="Gasto en IA">
      {cabecera}
      {cuerpo}
    </section>
  )
}
