'use client'

import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import { Activity, ArrowUpRight, CircleAlert, RefreshCw } from 'lucide-react'
import { COLOR_ESTADO } from '@/lib/estilo/denso'
import { TEXTO_ESTADO_CUENTA, type MetricaDeSalud } from '@/lib/cumplimiento/salud'
import type { SaludParaPantalla } from '@/lib/cumplimiento/salud-servidor'
import { urlSellerCentral } from '@/lib/cumplimiento/enlaces'
import { nombreDePais } from '@/lib/ads/paises'
import { AMAZON_MARKETPLACES } from '@/lib/types/amazon'
import { haceTiempo } from './comun'

/**
 * LA SALUD DE LA CUENTA (arriba de «No se venden»): el estado de la cuenta y cada métrica de rendimiento frente a su objetivo (pedidos defectuosos con su desglose,
 * envíos atrasados, cancelaciones, seguimiento, entregas a tiempo, facturas) y los recuentos de incidencias de políticas, del informe de rendimiento de Amazon
 * (lib/cumplimiento/salud*.ts). Lo que va mal, en rojo y delante. Se lee una vez al día solo; «Actualizar» lo pide a Amazon en ese momento (tarda uno o dos minutos).
 */

const pct = (x: number | null, d = 2) => (x == null ? '—' : `${(x * 100).toLocaleString('es-ES', { maximumFractionDigits: d })} %`)
const TONO = { verde: COLOR_ESTADO.verde, ambar: COLOR_ESTADO.ambar, rojo: COLOR_ESTADO.rojo }

async function pedir(cuerpo: Record<string, unknown>): Promise<{ disponible: boolean; salud: SaludParaPantalla[] }> {
  const r = await fetch('/api/cumplimiento', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error ?? `Error ${r.status}`)
  return j
}

export function SaludDeLaCuenta({ cliente, mercado }: { cliente: string; mercado: string }) {
  const [datos, setDatos] = useState<{ disponible: boolean; salud: SaludParaPantalla[] } | null>(null)
  const [pidiendo, setPidiendo] = useState(false)

  const cargar = useCallback(async (accion: 'salud' | 'salud-ahora' = 'salud') => {
    try {
      setDatos(await pedir({ accion, cliente, mercado }))
    } catch (e) {
      if (accion === 'salud-ahora') toast.error(e instanceof Error ? e.message : 'No se ha podido.')
    }
  }, [cliente, mercado])
  useEffect(() => {
    setDatos(null)
    void cargar()
  }, [cargar])

  // Mientras haya algún informe pedido, se vuelve a preguntar cada 20 s (el proceso horario o «Actualizar» lo terminan)
  const hayPedidos = datos?.salud.some((s) => s.estado === 'pedido')
  useEffect(() => {
    if (!hayPedidos) return
    const t = setInterval(() => void cargar(pidiendo ? 'salud-ahora' : 'salud'), 20_000)
    return () => clearInterval(t)
  }, [hayPedidos, cargar, pidiendo])

  if (!datos) return null
  if (!datos.disponible) return <p className="rounded-[14px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] px-4 py-3 text-[12.5px] text-[var(--ls-t3)]">La salud de la cuenta (pedidos defectuosos, envíos atrasados, incidencias de políticas…) llega al lanzar la migración 339 en Supabase.</p>

  async function actualizar() {
    setPidiendo(true)
    try {
      await cargar('salud-ahora')
      toast.success('Pedido a Amazon. Tarda uno o dos minutos: se pone al día solo.')
    } finally {
      setTimeout(() => setPidiendo(false), 120_000)
    }
  }

  // Con varios países, tarjeta entera solo para los que ya tienen datos; los que no (sin leer, pidiéndose o con error) van juntos en una sola caja
  const conPais = datos.salud.length > 1 || mercado === 'todos'
  const enteras = conPais ? datos.salud.filter((s) => s.datos) : datos.salud
  const resto = conPais ? datos.salud.filter((s) => !s.datos) : []
  return (
    <div className="flex flex-col gap-3">
      {enteras.map((s) => (
        <TarjetaDeSalud key={s.marketplaceId} s={s} conPais={conPais} actualizar={actualizar} pidiendo={pidiendo} />
      ))}
      {resto.length > 0 && <SinDatos salud={resto} actualizar={actualizar} pidiendo={pidiendo} />}
    </div>
  )
}

/** Los países sin datos todavía, en una sola caja: un renglón cada uno */
function SinDatos({ salud, actualizar, pidiendo }: { salud: SaludParaPantalla[]; actualizar: () => void; pidiendo: boolean }) {
  const nombre = (id: string) => {
    const p = AMAZON_MARKETPLACES.find((m) => m.id === id)
    return p ? nombreDePais(p.countryCode) : id
  }
  return (
    <section className="rounded-[14px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Activity className="h-[14px] w-[14px] text-[var(--ls-t4)]" />
        <span className="text-[12.5px] font-medium text-[var(--ls-t2)]">Salud de la cuenta sin datos en {salud.length} {salud.length === 1 ? 'país' : 'países'}</span>
        <button type="button" disabled={pidiendo} onClick={actualizar} className="ml-auto inline-flex items-center gap-1 rounded-[8px] px-2 py-1 text-[11.5px] text-[var(--ls-t4)] transition-colors hover:bg-[var(--ls-sup2)] hover:text-[var(--ls-t1)] disabled:opacity-60">
          <RefreshCw className={`h-3 w-3 ${pidiendo || salud.some((s) => s.estado === 'pedido') ? 'animate-spin' : ''}`} /> Pedir ahora
        </button>
      </div>
      <ul className="mt-2 flex flex-col gap-1">
        {salud.map((s) => (
          <li key={s.marketplaceId} className="flex flex-wrap items-baseline gap-x-2 text-[12px]">
            <span className="min-w-[110px] font-medium text-[var(--ls-t2)]">{nombre(s.marketplaceId)}</span>
            <span className="text-[var(--ls-t4)]" style={s.error ? { color: COLOR_ESTADO.ambar } : undefined}>
              {s.error ?? (s.estado === 'pedido' ? 'Amazon está preparando el informe.' : 'Todavía no se ha leído (se lee solo una vez al día).')}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function TarjetaDeSalud({ s, conPais, actualizar, pidiendo }: { s: SaludParaPantalla; conPais: boolean; actualizar: () => void; pidiendo: boolean }) {
  const pais = AMAZON_MARKETPLACES.find((m) => m.id === s.marketplaceId)
  const d = s.datos
  const estado = d?.estadoCuenta ? TEXTO_ESTADO_CUENTA[d.estadoCuenta] : null
  const urlSalud = urlSellerCentral(s.marketplaceId, '/performance/dashboard')
  const metricas = d ? [...d.metricas].sort((a, b) => Number(b.estado === 'mal') - Number(a.estado === 'mal')) : []
  return (
    <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="relative overflow-hidden rounded-[18px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] p-4">
      {estado && <span aria-hidden className="pointer-events-none absolute -left-16 -top-20 h-48 w-48 rounded-full opacity-20 blur-3xl" style={{ background: TONO[estado.tono] }} />}
      <div className="relative flex flex-wrap items-center gap-2">
        <Activity className="h-[16px] w-[16px] text-[var(--ls-t3)]" />
        <h3 className="text-[14px] font-semibold text-[var(--ls-t1)]">Salud de la cuenta{conPais && pais ? ` · ${nombreDePais(pais.countryCode)}` : ''}</h3>
        {estado && (
          <span className="rounded-full px-[9px] py-[2px] text-[11.5px] font-semibold" style={{ color: TONO[estado.tono], background: `color-mix(in srgb, ${TONO[estado.tono]} 14%, transparent)` }}>
            {estado.texto}
          </span>
        )}
        {d?.puntuacion != null && <span className="text-[12px] text-[var(--ls-t3)]">Nivel del estado de la cuenta: <b className="text-[var(--ls-t1)]">{d.puntuacion}</b></span>}
        {d?.nivel && d.puntuacion == null && <span className="text-[12px] text-[var(--ls-t4)]">Nivel: {d.nivel === 'GREAT' ? 'bueno' : d.nivel === 'WARNED' ? 'con avisos' : d.nivel}</span>}
        <span className="ml-auto flex items-center gap-3 text-[11.5px] text-[var(--ls-t4)]">
          {s.estado === 'pedido' ? <span>Pidiendo a Amazon…</span> : s.leidoAt ? <span>Leído {haceTiempo(s.leidoAt)}</span> : null}
          {urlSalud && (
            <a href={urlSalud} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[var(--ls-acc)] hover:underline">
              Seller Central <ArrowUpRight className="h-3 w-3" />
            </a>
          )}
          <button type="button" disabled={pidiendo} onClick={actualizar} className="inline-flex items-center gap-1 rounded-[8px] px-2 py-1 transition-colors hover:bg-[var(--ls-sup2)] hover:text-[var(--ls-t1)] disabled:opacity-60">
            <RefreshCw className={`h-3 w-3 ${pidiendo || s.estado === 'pedido' ? 'animate-spin' : ''}`} /> Actualizar
          </button>
        </span>
      </div>

      {s.error && (
        <p className="relative mt-3 flex items-start gap-2 text-[12.5px]" style={{ color: COLOR_ESTADO.ambar }}>
          <CircleAlert className="mt-[2px] h-[14px] w-[14px] shrink-0" /> {s.error}
        </p>
      )}
      {!d && !s.error && <p className="relative mt-3 text-[12.5px] text-[var(--ls-t3)]">{s.estado === 'pedido' ? 'Amazon está preparando el informe de rendimiento: tarda uno o dos minutos.' : 'Todavía no se ha leído. Se lee solo una vez al día; pulsa «Actualizar» para pedirlo ya.'}</p>}

      {d && (
        <>
          <div className="relative mt-3 grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(210px,1fr))]">
            {metricas.map((m, i) => (
              <Metrica key={m.id} m={m} i={i} />
            ))}
          </div>
          {d.politicas.length > 0 && (
            <div className="relative mt-3">
              <div className="mb-[6px] text-[12px] font-semibold text-[var(--ls-t1)]">Cumplimiento de políticas</div>
              <div className="flex flex-wrap gap-[6px]">
                {d.politicas.map((p) => (
                  <span key={p.id} className="inline-flex items-center gap-2 rounded-full border px-[10px] py-[3px] text-[12px]" style={p.defectos > 0 ? { borderColor: `color-mix(in srgb, ${COLOR_ESTADO.rojo} 45%, transparent)`, color: COLOR_ESTADO.rojo, background: `color-mix(in srgb, ${COLOR_ESTADO.rojo} 8%, transparent)` } : { borderColor: 'var(--ls-linea)', color: 'var(--ls-t4)' }}>
                    {p.nombre} <b className="tabular-nums">{p.defectos}</b>
                  </span>
                ))}
              </div>
              {d.politicas.some((p) => p.defectos > 0) && <p className="mt-2 text-[11.5px] text-[var(--ls-t4)]">Amazon solo da el recuento por API. Los listings afectados están abajo (si les ha quitado la oferta) o en «Estado de la cuenta → Cumplimiento de políticas» de Seller Central.</p>}
            </div>
          )}
        </>
      )}
    </motion.section>
  )
}

function Metrica({ m, i }: { m: MetricaDeSalud; i: number }) {
  const mal = m.estado === 'mal'
  // Amazon a veces la da por buena aunque no llegue al objetivo que él mismo pone (entregas a tiempo al 89 % con objetivo del 97 %): en ámbar, para no engañar
  const noLlega = m.valor != null && m.objetivo != null && (m.sentido === 'menos' ? m.valor >= m.objetivo : m.sentido === 'mas' ? m.valor < m.objetivo : false)
  const color = mal ? COLOR_ESTADO.rojo : noLlega ? COLOR_ESTADO.ambar : m.estado === 'bien' ? COLOR_ESTADO.verde : 'var(--ls-t3)'
  // La barra: cuánto del objetivo se gasta (en las de «menos de») o se cumple (en las de «más de»)
  const lleno = m.valor == null || m.objetivo == null ? 0 : m.sentido === 'menos' ? Math.min(1, m.valor / Math.max(m.objetivo, 0.0001)) : Math.min(1, m.valor)
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }} className="rounded-[12px] border p-3" style={{ borderColor: mal ? `color-mix(in srgb, ${COLOR_ESTADO.rojo} 40%, transparent)` : 'var(--ls-linea)', background: mal ? `color-mix(in srgb, ${COLOR_ESTADO.rojo} 6%, var(--ls-sup2))` : 'var(--ls-sup2)' }}>
      <div className="text-[11.5px] text-[var(--ls-t3)]">{m.nombre}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-[20px] font-bold tabular-nums tracking-[-0.02em]" style={{ color }}>{pct(m.valor)}</span>
        {m.objetivo != null && <span className="text-[11px] text-[var(--ls-t4)]">objetivo {m.sentido === 'menos' ? '<' : m.sentido === 'mas' ? '>' : ''} {pct(m.objetivo, 1)}</span>}
      </div>
      <div className="mt-2 h-[4px] overflow-hidden rounded-full bg-[var(--ls-sup3)]">
        <motion.div className="h-full rounded-full" style={{ background: color }} initial={{ width: 0 }} animate={{ width: `${lleno * 100}%` }} transition={{ type: 'spring', stiffness: 120, damping: 20, delay: 0.1 + i * 0.04 }} />
      </div>
      {m.detalle && <div className="mt-1 text-[11px] text-[var(--ls-t4)]">{m.detalle}{m.desde && m.hasta ? ` · del ${new Date(m.desde).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })} al ${new Date(m.hasta).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}` : ''}</div>}
      {m.partes && m.partes.some((p) => p.cantidad > 0) && (
        <div className="mt-1 flex flex-col gap-[1px] text-[11px]">
          {m.partes.filter((p) => p.cantidad > 0).map((p) => (
            <span key={p.nombre} style={{ color: p.estado === 'mal' ? COLOR_ESTADO.rojo : 'var(--ls-t3)' }}>
              {p.nombre}: <b className="tabular-nums">{p.cantidad}</b>
            </span>
          ))}
        </div>
      )}
    </motion.div>
  )
}
