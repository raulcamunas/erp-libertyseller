'use client'

import { Ban, Bell, Eye, EyeOff, History, LockOpen, PenLine, ShieldCheck, UserCheck, UserMinus, Users, type LucideIcon } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { EstadoVacio, EsqueletoTexto, LineaDeTiempo, PanelDePestana, PanelLateral, Pestanas, type Hito } from '@/components/ui-ls'
import type { TonoEstado } from '@/lib/estilo/denso'
import type { DatosDeLaMatriz } from '@/lib/correo/lectores'
import { direccionCorta } from '@/lib/correo/marcas'
import { pedir } from './api'
import type { PestanaDeEquipo, PropsDeEquipoYPermisos } from './contratos'
import { PermisosDeBuzones } from './PermisosDeBuzones'
import { BandaDeAviso, PestanaAsignaciones } from './PestanaAsignaciones'

/**
 * «EQUIPO Y PERMISOS» (solo administradores). Sustituye al modal «Quién ve qué».
 * ==============================================================================
 * PanelLateral ancho (760 px; en el móvil, hoja inferior) con tres pestañas:
 *
 *   1. Asignaciones (por defecto): quién trabaja cada buzón (PestanaAsignaciones).
 *   2. Quién ve qué: la matriz de lectura, permisos y bloqueos (PermisosDeBuzones).
 *   3. Últimos cambios: el historial único (concedido, quitado, bloqueado, desbloqueado, asignado, desasignado, responde y solo avisos) en una LineaDeTiempo.
 *
 * Cada pestaña pide lo suyo al abrirse (se monta solo la visible), así que al pasar de una a otra se ve lo último. El historial sale de
 * GET /api/correo/asignaciones (con «detalle», 30 filas) y, sin la migración 318, de GET /api/correo/lectores (15 filas, el de siempre).
 */

/* ------------------------------------------------------------------ */
/* Lógica pura (con prueba en equipo.prueba.ts)                        */
/* ------------------------------------------------------------------ */

export interface CambioDelHistorial {
  accion: string
  buzon: string
  lector: string
  porQuien: string
  cuando: string
  detalle?: string | null
}

const ACCIONES: Record<string, { etiqueta: string; tono: TonoEstado; icono: LucideIcon; enlace: 'a' | 'para' }> = {
  concedido: { etiqueta: 'Abierto a mano', tono: 'verde', icono: Eye, enlace: 'para' },
  quitado: { etiqueta: 'Cerrado', tono: 'ambar', icono: EyeOff, enlace: 'para' },
  bloqueado: { etiqueta: 'Bloqueado', tono: 'rojo', icono: Ban, enlace: 'a' },
  desbloqueado: { etiqueta: 'Desbloqueado', tono: 'verde', icono: LockOpen, enlace: 'a' },
  asignado: { etiqueta: 'Asignado', tono: 'azul', icono: UserCheck, enlace: 'a' },
  desasignado: { etiqueta: 'Asignación quitada', tono: 'ambar', icono: UserMinus, enlace: 'a' },
  responde: { etiqueta: 'Ya puede responder', tono: 'naranja', icono: PenLine, enlace: 'a' },
  solo_avisos: { etiqueta: 'Solo avisos', tono: 'gris', icono: Bell, enlace: 'a' },
}

const DETALLES: Record<string, string> = {
  responde: 'Puede responder y enviar desde el buzón',
  solo_avisos: 'Solo lo lee y recibe sus avisos',
  asignado: 'Al asignarle el buzón',
}

/** Cómo se cuenta un cambio: «Asignado · stock@ a Patricia», con su tono, su icono y el detalle en palabras (si añade algo) */
export function textoDeCambio(c: CambioDelHistorial): { etiqueta: string; frase: string; tono: TonoEstado; icono: LucideIcon; detalle: string | null } {
  const a = ACCIONES[c.accion] ?? { etiqueta: c.accion, tono: 'gris' as TonoEstado, icono: History, enlace: 'a' as const }
  const crudo = typeof c.detalle === 'string' ? c.detalle.trim() : ''
  // «responde» con detalle «responde» no dice nada nuevo
  const detalle = !crudo || crudo === c.accion ? null : DETALLES[crudo] ?? `${crudo.charAt(0).toUpperCase()}${crudo.slice(1)}`
  return { etiqueta: a.etiqueta, frase: `${direccionCorta(c.buzon)} ${a.enlace} ${c.lector}`, tono: a.tono, icono: a.icono, detalle }
}

export function hitosDeCambios(cambios: readonly CambioDelHistorial[]): Hito[] {
  return cambios.map((c, i) => {
    const t = textoDeCambio(c)
    return {
      id: `${c.cuando}-${i}`,
      titulo: (
        <>
          <span className="font-semibold">{t.etiqueta}</span> <span className="font-normal text-[var(--ls-t2)]">· {t.frase}</span>
        </>
      ),
      descripcion: t.detalle ?? undefined,
      cuando: c.cuando,
      tono: t.tono,
      icono: t.icono,
      autor: c.porQuien ? `por ${c.porQuien}` : undefined,
    }
  })
}

/* ------------------------------------------------------------------ */
/* El panel                                                            */
/* ------------------------------------------------------------------ */

const PESTANAS: Array<{ id: PestanaDeEquipo; texto: string; icono: LucideIcon }> = [
  { id: 'asignaciones', texto: 'Asignaciones', icono: UserCheck },
  { id: 'quien-ve-que', texto: 'Quién ve qué', icono: Eye },
  { id: 'cambios', texto: 'Últimos cambios', icono: History },
]

export function EquipoYPermisos({ abierto, onCambio, pestanaInicial = 'asignaciones', yoId }: PropsDeEquipoYPermisos) {
  const [pestana, setPestana] = useState<PestanaDeEquipo>(pestanaInicial)

  // Cada vez que se abre, en la pestaña que pida quien lo abre
  useEffect(() => {
    if (abierto) setPestana(pestanaInicial)
  }, [abierto, pestanaInicial])

  return (
    <PanelLateral abierto={abierto} onCambio={onCambio} ancho={760} icono={ShieldCheck} titulo="Equipo y permisos" descripcion="Quién trabaja y quién lee cada buzón. Solo lo ven y lo cambian los administradores.">
      <div className="sticky -top-4 z-10 -mx-5 -mt-4 mb-4 bg-[var(--ls-sup)] px-5 pt-1">
        <Pestanas etiqueta="Secciones de Equipo y permisos" opciones={PESTANAS} valor={pestana} onCambio={setPestana} idPanel="correo-equipo-panel" />
      </div>
      <PanelDePestana id="correo-equipo-panel" key={pestana}>
        {pestana === 'asignaciones' && <PestanaAsignaciones yoId={yoId} />}
        {pestana === 'quien-ve-que' && <PermisosDeBuzones />}
        {pestana === 'cambios' && <UltimosCambios />}
      </PanelDePestana>
    </PanelLateral>
  )
}

type EstadoDeCambios = { tipo: 'cargando' } | { tipo: 'error'; mensaje: string; faltaMigracion: boolean } | { tipo: 'listo'; cambios: CambioDelHistorial[]; sin318: boolean }

function UltimosCambios() {
  const [estado, setEstado] = useState<EstadoDeCambios>({ tipo: 'cargando' })

  const cargar = useCallback(async () => {
    setEstado({ tipo: 'cargando' })
    const r = await pedir<{ cambios: CambioDelHistorial[] }>('/api/correo/asignaciones')
    if (r.ok) return setEstado({ tipo: 'listo', cambios: r.datos.cambios ?? [], sin318: false })
    if (r.estado !== 503) return setEstado({ tipo: 'error', mensaje: r.mensaje, faltaMigracion: false })
    // Sin la 318: el historial de siempre (abrir, cerrar, bloquear)
    const l = await pedir<DatosDeLaMatriz>('/api/correo/lectores')
    if (l.ok) setEstado({ tipo: 'listo', cambios: l.datos.recientes, sin318: true })
    else setEstado({ tipo: 'error', mensaje: l.mensaje, faltaMigracion: l.estado === 503 })
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  if (estado.tipo === 'cargando') return <EsqueletoTexto lineas={6} />
  if (estado.tipo === 'error') {
    return (
      <BandaDeAviso tono={estado.faltaMigracion ? 'ambar' : 'rojo'}>
        {estado.mensaje}
        {!estado.faltaMigracion && (
          <button type="button" onClick={() => void cargar()} className="ml-2 font-medium text-[var(--ls-acc)] underline underline-offset-2">
            Reintentar
          </button>
        )}
      </BandaDeAviso>
    )
  }
  return (
    <div className="space-y-4">
      {estado.sin318 && <BandaDeAviso>Falta lanzar la migración 318 para elegir, asignar y silenciar correos. Aquí salen solo los cambios de «Quién ve qué».</BandaDeAviso>}
      {estado.cambios.length === 0 ? (
        <EstadoVacio compacto icono={Users} titulo="Todavía no hay cambios" descripcion="Cuando abras, cierres, bloquees o asignes un buzón quedará anotado aquí, con quién lo hizo y cuándo." />
      ) : (
        <LineaDeTiempo eventos={hitosDeCambios(estado.cambios)} maximo={30} />
      )}
    </div>
  )
}
