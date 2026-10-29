'use client'

import { CalendarClock, CalendarOff } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { diaConSemana } from '@/lib/cold-calling/fechas'
import { AVISO, BOTON, COLOR_ESTADO } from '@/lib/estilo/denso'
import { avisosDeLaFicha, bandaDeFestivos, comunidadesCompletas, marcaDeLista, notaDeUbicacion, textosDeLaBanda } from '@/lib/festivos/lead'
import { createClient } from '@/lib/supabase/client'
import type { ColdLead } from '@/lib/types/cold-leads'
import { tinte } from './ui'

/**
 * LOS FESTIVOS EN COLD CALLING.
 *
 * Un día festivo en la comunidad de un lead es un día en que su negocio casi seguro está cerrado: llamarle es perder la llamada, y quien vea «0 contesta» en una lista
 * entera no sabe que era por eso. Tres piezas, todas con lo que decide lib/festivos/lead.ts (con sus pruebas):
 *   · MarcaDeFestivo        una insignia en la fila del lead (lista y tablas), solo cuando el festivo es de una comunidad o una zona y no de toda España
 *   · AvisoDeFestivoDeLaFicha   encima de la ficha: «Hoy es festivo en Madrid», con el botón de pasar la rellamada al primer día que sí se puede llamar
 *   · BandaDeFestivos       sobre la lista: «Hoy es festivo en … y afecta a N leads de esta cartera», con «Ocultar»
 * Un lead sin comunidad (el proceso «Ubicación de los leads» no ha podido saberla) no recibe ningún aviso: no se inventa.
 */

/** La insignia de «festivo» de la fila de un lead, o nada */
export function MarcaDeFestivo({ lead, dia, hoy }: { lead: Pick<ColdLead, 'ccaa' | 'municipio_ine'>; dia: string; hoy: string }) {
  const texto = marcaDeLista(dia, hoy, lead)
  if (!texto) return null
  return (
    <span
      role="img"
      aria-label={texto}
      title={texto}
      className="inline-flex h-[17px] shrink-0 items-center gap-1 rounded-[4px] px-1.5 text-[10.5px] font-semibold leading-none"
      style={{ color: COLOR_ESTADO.ambar, background: tinte('ambar') }}
    >
      <CalendarOff className="h-[11px] w-[11px]" aria-hidden />
      Festivo
    </span>
  )
}

/* ------------------------------------------------------------------ */
/* El aviso de la ficha                                                */
/* ------------------------------------------------------------------ */

/** De dónde se dedujo la comunidad de cada lead: se pide una sola vez, y solo cuando va a hacer falta (la ficha tiene un aviso) */
const ORIGENES = new Map<string, { origen: string | null; confianza: string | null }>()

function useOrigenDeLaUbicacion(id: string, hace: boolean) {
  const [origen, setOrigen] = useState(() => ORIGENES.get(id) ?? null)
  useEffect(() => {
    if (!hace) return
    const guardado = ORIGENES.get(id)
    if (guardado) {
      setOrigen(guardado)
      return
    }
    setOrigen(null)
    let vivo = true
    createClient()
      .from('cold_leads')
      .select('ubicacion_origen, ubicacion_confianza')
      .eq('id', id)
      .single()
      .then(({ data, error }) => {
        // Sin la migración 263 no hay columnas y da error: no pasa nada, simplemente no hay advertencia que enseñar
        if (!vivo || error || !data) return
        const fila = data as { ubicacion_origen: string | null; ubicacion_confianza: string | null }
        const v = { origen: fila.ubicacion_origen ?? null, confianza: fila.ubicacion_confianza ?? null }
        ORIGENES.set(id, v)
        setOrigen(v)
      })
    return () => {
      vivo = false
    }
  }, [id, hace])
  return origen
}

interface PropsDelAviso {
  lead: ColdLead
  hoy: string
  /** ¿Puede cambiar la rellamada de este lead? Sin permiso, el aviso se ve pero sin el botón */
  canEdit: boolean
  /** Apunta la rellamada de este lead para ese día */
  onRellamar: (dia: string) => void
}

export function AvisoDeFestivoDeLaFicha({ lead, hoy, canEdit, onRellamar }: PropsDelAviso) {
  const avisos = useMemo(
    () => avisosDeLaFicha(lead, hoy),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lead.ccaa, lead.municipio_ine, lead.next_call_date, hoy]
  )
  const hayAviso = avisos.hoy !== null || avisos.rellamada !== null
  const origen = useOrigenDeLaUbicacion(lead.id, hayAviso)
  if (!hayAviso) return null
  const nota = notaDeUbicacion(origen?.origen, origen?.confianza)

  return (
    <div className="mx-4 mt-3 space-y-1.5" role="status">
      {avisos.hoy && (
        <div className={`${AVISO.base} ${AVISO.conTono} flex-wrap items-center`} style={{ borderLeftColor: COLOR_ESTADO.ambar }}>
          <CalendarOff className={`${AVISO.icono} !mt-0 text-[var(--ls-e-ambar)]`} aria-hidden />
          <p className="min-w-0 flex-1">
            <span className={AVISO.fuerte}>{avisos.hoy.titulo}.</span> {avisos.hoy.detalle}. Es muy probable que no contesten: mejor llamar otro día.
            {nota && <span className="mt-0.5 block text-[11px] text-[var(--ls-t4)]">{nota}</span>}
          </p>
          {canEdit && avisos.siguienteHabil && lead.next_call_date !== avisos.siguienteHabil && (
            <button type="button" onClick={() => onRellamar(avisos.siguienteHabil!)} className={`${BOTON.base} ${BOTON.secundario} shrink-0`}>
              <CalendarClock className="h-3 w-3" aria-hidden />
              {lead.next_call_date === hoy ? `Pasar la rellamada al ${diaConSemana(avisos.siguienteHabil)}` : `Rellamar el ${diaConSemana(avisos.siguienteHabil)}`}
            </button>
          )}
        </div>
      )}
      {avisos.rellamada && (
        <div className={`${AVISO.base} ${AVISO.conTono} flex-wrap items-center`} style={{ borderLeftColor: COLOR_ESTADO.ambar }}>
          <CalendarOff className={`${AVISO.icono} !mt-0 text-[var(--ls-e-ambar)]`} aria-hidden />
          <p className="min-w-0 flex-1">
            <span className={AVISO.fuerte}>La rellamada cae en festivo.</span> {avisos.rellamada.titulo}: {avisos.rellamada.detalle}.
            {!avisos.hoy && nota && <span className="mt-0.5 block text-[11px] text-[var(--ls-t4)]">{nota}</span>}
          </p>
          {canEdit && (
            <button type="button" onClick={() => onRellamar(avisos.rellamada!.siguienteHabil)} className={`${BOTON.base} ${BOTON.secundario} shrink-0`}>
              <CalendarClock className="h-3 w-3" aria-hidden />
              Pasarla al {diaConSemana(avisos.rellamada.siguienteHabil)}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* La banda de arriba                                                  */
/* ------------------------------------------------------------------ */

interface PropsDeLaBanda {
  /** TODA la cartera, también los ocultos: si no, al ocultarlos la banda se contaría a sí misma y desaparecería */
  leads: readonly ColdLead[]
  hoy: string
  ocultando: boolean
  onOcultar: (ocultar: boolean) => void
}

export function BandaDeFestivos({ leads, hoy, ocultando, onOcultar }: PropsDeLaBanda) {
  const banda = useMemo(() => bandaDeFestivos(leads, hoy), [leads, hoy])
  if (!banda) return null
  const { titulo, detalle } = textosDeLaBanda(banda, hoy)
  const n = banda.afectados.toLocaleString('es-ES')
  return (
    <div className={`${AVISO.base} ${AVISO.conTono} flex-wrap items-center`} style={{ borderLeftColor: COLOR_ESTADO.ambar }} role="status" title={comunidadesCompletas(banda)}>
      <CalendarOff className={`${AVISO.icono} !mt-0 text-[var(--ls-e-ambar)]`} aria-hidden />
      <p className="min-w-0 flex-1">
        <span className={AVISO.fuerte}>{titulo}.</span> {detalle}. {banda.nacional ? 'Es festivo para' : 'Afecta a'} <strong className="tabular-nums text-[var(--ls-t1)]">{n}</strong> {banda.afectados === 1 ? 'lead' : 'leads'} de esta cartera
        {banda.esHoy ? ' y casi seguro no contestan.' : '.'}
      </p>
      {banda.esHoy && (
        <button type="button" onClick={() => onOcultar(!ocultando)} aria-pressed={ocultando} className={`${BOTON.base} ${BOTON.secundario} shrink-0`}>
          {ocultando ? `Mostrar esos ${n}` : `Ocultar esos ${n} por hoy`}
        </button>
      )}
    </div>
  )
}
