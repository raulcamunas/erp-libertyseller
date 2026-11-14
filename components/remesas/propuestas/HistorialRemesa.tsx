'use client'

import { useCallback, useEffect, useState } from 'react'
import { ArrowRightLeft, Boxes, CheckCircle2, ClipboardList, Eye, FileSpreadsheet, History, Link2, Link2Off, PenLine, RefreshCw, Send, Tags, Truck, Undo2, type LucideIcon } from 'lucide-react'
import { Boton, EsqueletoTexto, EstadoVacio, LineaDeTiempo, Tarjeta, type Hito } from '@/components/ui-ls'
import type { TonoEstado } from '@/lib/estilo/denso'
import { quienLoHizo, tituloDeEvento, tonoDeEvento, type AccionDeHistorial, type EventoDeHistorial, type TonoDeEvento } from '@/lib/fba/historial'

/**
 * LA LÍNEA DE TIEMPO DE UNA REMESA: QUIÉN HIZO QUÉ.
 *
 * Lee /api/fba/remesas/[id]/historial (fba_remesa_historial, migración 309) UNA vez al abrir y al pulsar
 * «Actualizar»: nada de sondeos cada pocos segundos. Distingue la agencia (con el nombre de quien fue), el
 * cliente con usuario y el cliente desde su enlace (con la IP, solo para la agencia).
 */

const ICONO: Record<AccionDeHistorial, LucideIcon> = {
  creada: ClipboardList,
  estado: ArrowRightLeft,
  lineas: PenLine,
  cajas: Boxes,
  enlace_creado: Link2,
  enlace_revocado: Link2Off,
  enlace_abierto: Eye,
  propuesta_enviada: Send,
  propuesta_cliente: PenLine,
  propuesta_aceptada: CheckCircle2,
  propuesta_devuelta: Undo2,
  etiquetas: Tags,
  manifiesto: FileSpreadsheet,
  embalaje: FileSpreadsheet,
  encaje_terminado: CheckCircle2,
  envio_amazon: Truck,
  transporte_aceptado: CheckCircle2,
}

const TONO: Record<TonoDeEvento, TonoEstado> = { info: 'cian', ok: 'verde', aviso: 'ambar', peligro: 'rojo', neutro: 'gris' }

export function HistorialRemesa({ remesaId, abierto = false }: { remesaId: string; abierto?: boolean }) {
  const [ver, setVer] = useState(abierto)
  const [eventos, setEventos] = useState<EventoDeHistorial[] | null>(null)
  const [sinMigrar, setSinMigrar] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(false)

  const cargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    try {
      const res = await fetch(`/api/fba/remesas/${remesaId}/historial`, { cache: 'no-store' })
      const p = (await res.json().catch(() => null)) as { eventos?: EventoDeHistorial[]; sinMigrar?: boolean; error?: string } | null
      if (!res.ok || !p) throw new Error(p?.error ?? `No se ha podido leer el historial (código ${res.status})`)
      setEventos(p.eventos ?? [])
      setSinMigrar(!!p.sinMigrar)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setCargando(false)
    }
  }, [remesaId])

  // Solo se pide al desplegarlo: una remesa cerrada que nadie mira no gasta una consulta
  useEffect(() => {
    if (ver && eventos === null) void cargar()
  }, [ver, eventos, cargar])

  const hitos: Hito[] = (eventos ?? []).map((e) => ({
    id: e.id,
    titulo: tituloDeEvento(e),
    cuando: e.at,
    tono: TONO[tonoDeEvento(e)],
    icono: ICONO[e.accion] ?? History,
    autor: [quienLoHizo(e), e.ip && e.actor === 'enlace' ? `IP ${e.ip}` : null].filter(Boolean).join(' · '),
    descripcion: typeof e.detalle?.comentario === 'string' && e.detalle.comentario ? `«${e.detalle.comentario}»` : undefined,
  }))

  return (
    <Tarjeta
      icono={History}
      acento="remesas"
      titulo={
        <button type="button" onClick={() => setVer((v) => !v)} className="text-left" aria-expanded={ver}>
          Historial
        </button>
      }
      subtitulo="Quién ha hecho qué en esta remesa: la agencia, el cliente y su enlace"
      acciones={
        ver ? (
          <Boton variante="fantasma" tamano="sm" icono={RefreshCw} cargando={cargando} onClick={() => void cargar()}>
            Actualizar
          </Boton>
        ) : (
          <Boton variante="fantasma" tamano="sm" onClick={() => setVer(true)}>
            Ver
          </Boton>
        )
      }
    >
      {ver &&
        (eventos === null && !error ? (
          <EsqueletoTexto lineas={4} />
        ) : error ? (
          <p className="text-[13px] text-[var(--ls-e-rojo)]">{error}</p>
        ) : sinMigrar ? (
          <p className="text-[13px] text-[var(--ls-t3)]">Falta lanzar la migración 309 en Supabase: hasta entonces no se guarda el historial.</p>
        ) : hitos.length === 0 ? (
          <EstadoVacio compacto icono={History} acento="remesas" titulo="Todavía no hay nada apuntado" descripcion="A partir de ahora, cada cambio de paso, guardado, enlace o descarga queda aquí con quién lo hizo." />
        ) : (
          <LineaDeTiempo eventos={hitos} maximo={30} />
        ))}
    </Tarjeta>
  )
}
