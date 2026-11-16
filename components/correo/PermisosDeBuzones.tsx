'use client'

import * as Menu from '@radix-ui/react-dropdown-menu'
import * as Popover from '@radix-ui/react-popover'
import { AlertCircle, Ban, BookOpenCheck, Check, ChevronDown, Eye, EyeOff, Loader2, Lock, LockOpen, MoreHorizontal, PenLine, Undo2, Users } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Avatar, Boton, EstadoVacio, Esqueleto, FOCO, Segmentado, TACTIL, type Opcion } from '@/components/ui-ls'
import { hace } from '@/lib/correo/fechas'
import {
  MAX_CAMBIOS_POR_PETICION,
  QUITALO_EN_ASIGNACIONES,
  paraBloquear,
  paraDesbloquear,
  type Bloqueo,
  type BuzonDeLaMatriz,
  type CambioDeLector,
  type CeldaDeAcceso,
  type DatosDeLaMatriz,
  type FilaDeLaMatriz,
} from '@/lib/correo/lectores'
import { direccionCorta } from '@/lib/correo/marcas'
import { cn } from '@/lib/utils'
import { enviarJson, pedir } from './api'
import { PuntoDeBuzon } from './piezas'

/**
 * «QUIÉN VE QUÉ»: LA PESTAÑA DE «EQUIPO Y PERMISOS» DONDE UN ADMINISTRADOR DECIDE QUÉ BUZONES LEE CADA PERSONA.
 * ==========================================================================================================
 * Antes era un modal propio; ahora es el contenido de una pestaña (lo monta EquipoYPermisos dentro de su PanelLateral). La regla no cambia:
 *
 *   · Las filas son las personas del equipo con Correo y las columnas, los buzones conectados (lib/correo/lectores.ts → armarMatriz).
 *   · Cada celda dice por dónde lo lee: ✓ Suyo, 👁 Por permiso (supervisión), 👁 Abierto (a mano), ✎ Asignado (migración 318) o ⛔ Bloqueado (260).
 *   · Al pulsarla sale un popover con un Segmentado de tres estados: «No ve» / «Lee» / «Bloqueado». Lo que no se puede hacer desde aquí sale desactivado y
 *     dice por qué: una asignación se quita en Asignaciones («Quítalo en Asignaciones»), un permiso de supervisión en Gestión de Usuarios. Bloquear a quien
 *     lo tiene asignado sí se puede: el servidor quita antes la asignación (queda «desasignado» en el historial).
 *   · El menú ⋯ de cada fila son los cuatro atajos de siempre, con la MISMA lógica (paraBloquear / paraDesbloquear de lectores.ts) y textos completos.
 *   · En el móvil no hay matriz: se elige una persona y sale la lista de sus buzones, con el Segmentado en cada fila.
 *   · Máximo 50 cambios por petición (MAX_CAMBIOS_POR_PETICION): los atajos grandes se mandan en tandas. Sin la 255, la ruta contesta 503 y se dice qué
 *     migración falta. Sin la 260, no se ofrece bloquear.
 *
 * Solo la ve un administrador (la ruta lo vuelve a comprobar y a cualquier otro le contesta «no existe»). Este fichero solo decide qué se pinta.
 */

/* ------------------------------------------------------------------ */
/* Lógica pura (con prueba en equipo.prueba.ts)                        */
/* ------------------------------------------------------------------ */

export type EstadoDeCelda = 'no' | 'lee' | 'bloqueado'

export const TEXTO_DE_ESTADO: Record<EstadoDeCelda, string> = { no: 'No ve', lee: 'Lee', bloqueado: 'Bloqueado' }

/** Lo que significa hoy una celda: bloqueada (gana siempre), la lee (por cualquier vía) o no la ve */
export function estadoDeCelda(c: CeldaDeAcceso): EstadoDeCelda {
  if (c.via === 'suyo') return 'lee'
  if (c.bloqueado) return 'bloqueado'
  return c.via === 'nada' ? 'no' : 'lee'
}

export type TipoDeCelda = 'suyo' | 'permiso' | 'abierto' | 'asignado' | 'bloqueado' | 'nada'

/** El icono y el texto corto de la celda: ✓ Suyo, 👁 Por permiso, 👁 Abierto, ✎ Asignado, ⛔ Bloqueado, o nada */
export function aspectoDeCelda(c: CeldaDeAcceso): { tipo: TipoDeCelda; texto: string } {
  if (c.via === 'suyo') return { tipo: 'suyo', texto: 'Suyo' }
  if (c.bloqueado) return { tipo: 'bloqueado', texto: 'Bloqueado' }
  if (c.via === 'permiso') return { tipo: 'permiso', texto: 'Por permiso' }
  if (c.via === 'concedido') return { tipo: 'abierto', texto: 'Abierto' }
  if (c.via === 'asignado' || c.asignado) return { tipo: 'asignado', texto: 'Asignado' }
  return { tipo: 'nada', texto: 'No ve' }
}

export const FALTA_LA_260 = 'Para bloquear falta lanzar la migración 260_correo_buzones_bloqueados.sql.'
export const LO_ABRE_UN_PERMISO = 'Lo abre un permiso de supervisión: bloquéaselo o quítale el permiso en Gestión de Usuarios.'

export type PasosDeCelda = { ok: true; pasos: CambioDeLector[][]; aviso: string | null } | { ok: false; motivo: string }

/**
 * Qué peticiones hacen falta para llevar una celda a `destino`. Cada elemento de `pasos` es UNA petición (un mismo buzón no puede salir dos veces en la
 * misma: la ruta lo rechaza), y van en orden: lo que QUITA antes que lo que DA (nunca un momento con un acceso de más).
 */
export function pasosHacia(c: CeldaDeAcceso, buzonId: string, destino: EstadoDeCelda, puedeBloquear: boolean): PasosDeCelda {
  if (c.via === 'suyo') return { ok: false, motivo: 'Es su propio buzón: siempre lo lee.' }
  const ahora = estadoDeCelda(c)
  if (ahora === destino) return { ok: true, pasos: [], aviso: null }

  if (destino === 'bloqueado') {
    if (!puedeBloquear) return { ok: false, motivo: FALTA_LA_260 }
    return { ok: true, pasos: [[{ buzonId, bloquear: true }]], aviso: c.asignado ? 'Bloquear le quita antes la asignación (queda anotado).' : null }
  }

  if (destino === 'lee') {
    if (ahora === 'bloqueado') {
      // Al quitar el bloqueo vuelve a leerlo por lo que ya tenía (un permiso o lo abierto a mano). Si no tenía nada, además hay que abrírselo
      return c.via === 'nada' ? { ok: true, pasos: [[{ buzonId, bloquear: false }], [{ buzonId, leer: true }]], aviso: null } : { ok: true, pasos: [[{ buzonId, bloquear: false }]], aviso: null }
    }
    return { ok: true, pasos: [[{ buzonId, leer: true }]], aviso: null }
  }

  // destino 'no'
  if (c.asignado) return { ok: false, motivo: QUITALO_EN_ASIGNACIONES }
  if (c.via === 'permiso') return { ok: false, motivo: ahora === 'bloqueado' ? 'Lo abre un permiso de supervisión: para que no lo vea, déjalo bloqueado.' : LO_ABRE_UN_PERMISO }
  if (ahora === 'bloqueado') {
    // Bloqueado y abierto a mano: primero se cierra lo abierto (quita) y luego se quita el bloqueo; así no lo lee en ningún momento
    return c.via === 'concedido' ? { ok: true, pasos: [[{ buzonId, leer: false }], [{ buzonId, bloquear: false }]], aviso: null } : { ok: true, pasos: [[{ buzonId, bloquear: false }]], aviso: null }
  }
  return { ok: true, pasos: [[{ buzonId, leer: false }]], aviso: null }
}

/** Las tres opciones del Segmentado de una celda, con las que no se pueden elegir desactivadas y su motivo */
export function opcionesDeCelda(c: CeldaDeAcceso, buzonId: string, puedeBloquear: boolean): Array<{ id: EstadoDeCelda; texto: string; desactivada: boolean; motivo: string | null }> {
  return (['no', 'lee', 'bloqueado'] as const).map((id) => {
    const p = pasosHacia(c, buzonId, id, puedeBloquear)
    return { id, texto: TEXTO_DE_ESTADO[id], desactivada: !p.ok, motivo: p.ok ? p.aviso : p.motivo }
  })
}

/** Parte una lista en tandas del máximo que admite la ruta (50) */
export function enTandas<T>(lista: readonly T[], tamano: number = MAX_CAMBIOS_POR_PETICION): T[][] {
  const salida: T[][] = []
  for (let i = 0; i < lista.length; i += tamano) salida.push(lista.slice(i, i + tamano))
  return salida
}

export interface AtajoDeFila {
  id: 'comerciales' | 'quitar' | 'bloquear' | 'desbloquear'
  texto: string
  cambios: CambioDeLector[]
  tono: 'normal' | 'peligro'
}

/** Los cuatro atajos de una fila, con la misma lógica de siempre (paraBloquear y paraDesbloquear) */
export function atajosDeFila(fila: FilaDeLaMatriz, buzones: readonly BuzonDeLaMatriz[], puedeBloquear: boolean): AtajoDeFila[] {
  const comerciales = buzones.filter((b) => b.dueno.esComercial === true)
  const porAbrir = comerciales.filter((b) => fila.celdas[b.id]?.via === 'nada' && !fila.celdas[b.id]?.bloqueado)
  const abiertosAMano = buzones.filter((b) => fila.celdas[b.id]?.concedido)
  const porBloquear = puedeBloquear ? paraBloquear(fila, buzones, 'administrativos') : []
  const porDesbloquear = puedeBloquear ? paraDesbloquear(fila, buzones) : []
  return [
    { id: 'comerciales', texto: 'Dejarle leer los buzones de los comerciales', cambios: porAbrir.map((b) => ({ buzonId: b.id, leer: true })), tono: 'normal' },
    { id: 'quitar', texto: 'Quitar lo que abrí a mano', cambios: abiertosAMano.map((b) => ({ buzonId: b.id, leer: false })), tono: 'normal' },
    { id: 'bloquear', texto: 'Bloquearle los buzones de administración', cambios: porBloquear.map((b) => ({ buzonId: b.id, bloquear: true })), tono: 'peligro' },
    { id: 'desbloquear', texto: 'Quitar todos sus bloqueos', cambios: porDesbloquear.map((b) => ({ buzonId: b.id, bloquear: false })), tono: 'normal' },
  ]
}

/** Lo que se cuenta al terminar un cambio (la ruta devuelve cuántos de cada) */
export function textoDeResultado(r: { concedidos: number; quitados: number; bloqueados: number; desbloqueados: number; desasignados?: number }): string {
  const partes: string[] = []
  const n = (x: number, uno: string, varios: string) => (x === 1 ? uno : `${x} ${varios}`)
  if (r.desasignados) partes.push(n(r.desasignados, 'asignación quitada', 'asignaciones quitadas'))
  if (r.bloqueados) partes.push(n(r.bloqueados, 'buzón bloqueado', 'buzones bloqueados'))
  if (r.quitados) partes.push(n(r.quitados, 'buzón cerrado', 'buzones cerrados'))
  if (r.desbloqueados) partes.push(n(r.desbloqueados, 'bloqueo quitado', 'bloqueos quitados'))
  if (r.concedidos) partes.push(n(r.concedidos, 'buzón abierto', 'buzones abiertos'))
  if (partes.length === 0) return 'Sin cambios.'
  const frase = partes.join(' · ')
  return `${frase.charAt(0).toUpperCase()}${frase.slice(1)}.`
}

/* ------------------------------------------------------------------ */
/* La pestaña                                                          */
/* ------------------------------------------------------------------ */

// Cómo se nombra el puesto de cada dueño bajo su nombre en las columnas (corto: la columna es estrecha)
const PUESTO_CORTO: Record<string, string> = { comercial: 'comercial', manager_comercial: 'manager', comercial_autonomo: 'autónomo', gestion_administrativa: 'administrativo' }
const primerNombre = (n: string) => n.trim().split(/\s+/)[0] || n

type Estado = { tipo: 'cargando' } | { tipo: 'error'; mensaje: string; faltaMigracion: boolean } | { tipo: 'listo'; datos: DatosDeLaMatriz }

type RespuestaDeCambio = DatosDeLaMatriz & { concedidos: number; quitados: number; bloqueados: number; desbloqueados: number; desasignados?: number; rechazados: Array<{ motivo: string }> }

export interface PropsDePermisosDeBuzones {
  /** Se ha cambiado algo (para que quien lo monta relea lo suyo, p. ej. Últimos cambios) */
  onCambiado?: () => void
  /** @deprecated Antes era un modal con su botón de cerrar. Ahora es el contenido de una pestaña de EquipoYPermisos y no se usa */
  onCerrar?: () => void
}

export function PermisosDeBuzones({ onCambiado }: PropsDePermisosDeBuzones) {
  const [estado, setEstado] = useState<Estado>({ tipo: 'cargando' })
  // Las celdas que se están guardando («persona|buzón»), para no dejar pulsar dos veces
  const [guardando, setGuardando] = useState<ReadonlySet<string>>(new Set())
  const [explicacion, setExplicacion] = useState(false)

  const cargar = useCallback(async () => {
    const r = await pedir<DatosDeLaMatriz>('/api/correo/lectores')
    setEstado(r.ok ? { tipo: 'listo', datos: r.datos } : { tipo: 'error', mensaje: r.mensaje, faltaMigracion: r.estado === 503 })
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  /** Manda las peticiones en orden (cada una de ≤ 50 cambios); para en la primera que falla */
  const cambiar = useCallback(
    async (lectorId: string, peticiones: CambioDeLector[][], avisar = true) => {
      const claves = peticiones.flat().map((c) => `${lectorId}|${c.buzonId}`)
      if (claves.length === 0) return
      setGuardando((previas) => new Set([...previas, ...claves]))
      const total = { concedidos: 0, quitados: 0, bloqueados: 0, desbloqueados: 0, desasignados: 0 }
      let aviso: string | null = null
      try {
        for (const cambios of peticiones.flatMap((p) => enTandas(p))) {
          const r = await enviarJson<RespuestaDeCambio>('/api/correo/lectores', 'POST', { lectorId, cambios })
          if (!r.ok) {
            toast.error(r.mensaje)
            return
          }
          setEstado({ tipo: 'listo', datos: { matriz: r.datos.matriz, concesiones: r.datos.concesiones, bloqueos: r.datos.bloqueos, bloqueosDisponibles: r.datos.bloqueosDisponibles, recientes: r.datos.recientes, asignaciones: r.datos.asignaciones, asignacionesDisponibles: r.datos.asignacionesDisponibles } })
          total.concedidos += r.datos.concedidos
          total.quitados += r.datos.quitados
          total.bloqueados += r.datos.bloqueados
          total.desbloqueados += r.datos.desbloqueados
          total.desasignados += r.datos.desasignados ?? 0
          if (r.datos.rechazados.length > 0) aviso = r.datos.rechazados[0].motivo
        }
        if (aviso) toast.warning(aviso)
        else if (avisar || Object.values(total).some((x) => x > 0)) toast.success(textoDeResultado(total))
        onCambiado?.()
      } finally {
        setGuardando((previas) => {
          const n = new Set(previas)
          for (const c of claves) n.delete(c)
          return n
        })
      }
    },
    [onCambiado]
  )

  return (
    <div className="space-y-4">
      <div className="text-[12.5px] leading-relaxed text-[var(--ls-t3)]">
        <p>
          Qué buzones lee cada persona del equipo y por qué. Solo lectura: nadie escribe desde un buzón ajeno salvo que se lo asignes.{' '}
          <button type="button" onClick={() => setExplicacion((v) => !v)} aria-expanded={explicacion} className={cn('inline-flex items-center gap-0.5 rounded-[6px] font-medium text-[var(--ls-acc)] underline-offset-2 hover:underline', FOCO)}>
            ¿Cómo funciona?
            <ChevronDown className={cn('h-3.5 w-3.5 transition-transform motion-reduce:transition-none', explicacion && 'rotate-180')} aria-hidden />
          </button>
        </p>
        {explicacion && (
          <div className="mt-2 space-y-2 rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-3 py-2.5 text-[12.5px] text-[var(--ls-t3)]">
            <p>
              Los administradores leen todos los buzones. Aquí abres, uno a uno, los que puede leer cada persona: cada vez que alguien mira un buzón que no es suyo queda anotado. Las filas son las personas con la casilla «Correo» y las
              columnas, los buzones conectados. ¿Falta alguien? Dale la casilla en Gestión de Usuarios. ¿Falta un buzón? Aún no lo ha conectado su dueño.
            </p>
            <p>
              ¿Alguien tiene un permiso de supervisión pero <b className="font-semibold text-[var(--ls-t2)]">no debe leer un buzón concreto</b>? Bloquéaselo: conserva el permiso y deja de ver solo ese buzón. Un buzón que se conecte más adelante
              no queda bloqueado solo. Lo que está <b className="font-semibold text-[var(--ls-t2)]">asignado</b> se cambia en la pestaña Asignaciones.
            </p>
          </div>
        )}
      </div>

      {estado.tipo === 'cargando' && (
        <div className="space-y-2" aria-busy="true" aria-label="Cargando">
          <Esqueleto className="h-10 w-full" />
          <Esqueleto className="h-10 w-full" />
          <Esqueleto className="h-10 w-full" />
          <Esqueleto className="h-10 w-2/3" />
        </div>
      )}

      {estado.tipo === 'error' && (
        <Banda tono={estado.faltaMigracion ? 'ambar' : 'rojo'}>
          {estado.mensaje}
          {!estado.faltaMigracion && (
            <button type="button" onClick={() => void cargar()} className="ml-2 font-medium text-[var(--ls-acc)] underline underline-offset-2">
              Reintentar
            </button>
          )}
        </Banda>
      )}

      {estado.tipo === 'listo' && <Contenido datos={estado.datos} guardando={guardando} cambiar={cambiar} />}
    </div>
  )
}

function Banda({ tono, children }: { tono: 'ambar' | 'rojo'; children: ReactNode }) {
  const color = tono === 'rojo' ? 'var(--ls-e-rojo)' : 'var(--ls-e-ambar)'
  return (
    <p className="flex items-start gap-2 rounded-[10px] border border-l-2 border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-3 py-2.5 text-[12.5px] text-[var(--ls-t2)]" style={{ borderLeftColor: color }} role={tono === 'rojo' ? 'alert' : 'status'}>
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" style={{ color }} aria-hidden />
      <span>{children}</span>
    </p>
  )
}

type Cambiar = (lectorId: string, peticiones: CambioDeLector[][], avisar?: boolean) => Promise<void>

function Contenido({ datos, guardando, cambiar }: { datos: DatosDeLaMatriz; guardando: ReadonlySet<string>; cambiar: Cambiar }) {
  const { matriz, bloqueosDisponibles } = datos
  const bloqueos = useMemo(() => new Map<string, Bloqueo>(datos.bloqueos.map((b) => [`${b.lectorId}|${b.buzonId}`, b])), [datos.bloqueos])
  // Quien tiene varios buzones saldría repetido en las columnas: esos se distinguen por el nombre del buzón o su dirección
  const duenosConVarios = useMemo(() => {
    const cuenta = new Map<string, number>()
    for (const b of matriz.buzones) cuenta.set(b.dueno.id, (cuenta.get(b.dueno.id) ?? 0) + 1)
    return new Set([...cuenta].filter(([, n]) => n > 1).map(([dueno]) => dueno))
  }, [matriz.buzones])
  const cabecera = useCallback(
    (b: BuzonDeLaMatriz) => {
      const rol = b.dueno.role === 'admin' ? 'administrador' : (b.dueno.puesto ? PUESTO_CORTO[b.dueno.puesto] : undefined) ?? (b.dueno.esComercial ? 'comercial' : 'equipo')
      return duenosConVarios.has(b.dueno.id)
        ? { principal: b.nombre?.trim() || direccionCorta(b.direccion), secundaria: `${primerNombre(b.dueno.nombre)} · ${rol}`, buzon: `el buzón ${b.direccion}` }
        : { principal: primerNombre(b.dueno.nombre), secundaria: rol, buzon: `el buzón de ${b.dueno.nombre}` }
    },
    [duenosConVarios]
  )

  if (matriz.buzones.length === 0) return <EstadoVacio compacto icono={BookOpenCheck} titulo="Todavía no hay ningún buzón conectado" descripcion="Cuando alguien conecte su correo aparecerá aquí como una columna." />
  if (matriz.filas.length === 0) {
    return <EstadoVacio compacto icono={Users} titulo="No hay nadie más del equipo con Correo" descripcion="Dale la casilla «Correo» en Gestión de Usuarios a quien quieras que use o lea el correo." />
  }

  const comun = { buzones: matriz.buzones, bloqueos, puedeBloquear: bloqueosDisponibles, cabecera, guardando, cambiar }
  return (
    <>
      {!bloqueosDisponibles && (
        <Banda tono="ambar">
          Para poder <b className="font-semibold">bloquear</b> buzones falta lanzar la migración <code className="text-[11.5px]">260_correo_buzones_bloqueados.sql</code> en el editor SQL de Supabase. Mientras tanto, abrir y cerrar buzones funciona como siempre.
        </Banda>
      )}
      {datos.asignacionesDisponibles === false && (
        <Banda tono="ambar">Falta lanzar la migración 318 para elegir, asignar y silenciar correos. La matriz funciona igual, sin asignaciones.</Banda>
      )}
      <div className="hidden lg:block">
        <Matriz filas={matriz.filas} {...comun} />
      </div>
      <div className="lg:hidden">
        <PorPersona filas={matriz.filas} {...comun} />
      </div>
    </>
  )
}

interface Comun {
  buzones: BuzonDeLaMatriz[]
  bloqueos: ReadonlyMap<string, Bloqueo>
  puedeBloquear: boolean
  cabecera: (b: BuzonDeLaMatriz) => { principal: string; secundaria: string; buzon: string }
  guardando: ReadonlySet<string>
  cambiar: Cambiar
}

/* ------------------------------------------------------------------ */
/* Escritorio: la matriz                                               */
/* ------------------------------------------------------------------ */

const ICONO_DE_TIPO: Record<TipoDeCelda, typeof Check> = { suyo: Check, permiso: Eye, abierto: Eye, asignado: PenLine, bloqueado: Ban, nada: EyeOff }

const CLASE_DE_TIPO: Record<TipoDeCelda, string> = {
  suyo: 'text-[var(--ls-t4)]',
  permiso: 'border-[var(--ls-linea2)] bg-[var(--ls-sup2)] text-[var(--ls-t2)]',
  abierto: 'border-[var(--ls-acc-graf)] bg-[var(--ls-acc-suave)] text-[var(--ls-acc)]',
  asignado: 'border-[color-mix(in_srgb,var(--ls-e-azul)_45%,transparent)] bg-[color-mix(in_srgb,var(--ls-e-azul)_12%,transparent)] text-[var(--ls-e-azul)]',
  bloqueado: 'border-[color-mix(in_srgb,var(--ls-e-rojo)_45%,transparent)] bg-[color-mix(in_srgb,var(--ls-e-rojo)_12%,transparent)] text-[var(--ls-e-rojo)]',
  nada: 'border-dashed border-[var(--ls-linea)] text-[var(--ls-t4)] opacity-70',
}

function MarcaDeCelda({ tipo, texto }: { tipo: TipoDeCelda; texto: string }) {
  const Icono = ICONO_DE_TIPO[tipo]
  if (tipo === 'suyo') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-[var(--ls-t4)]">
        <Check className="h-3 w-3" aria-hidden /> Suyo
      </span>
    )
  }
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-[2px] text-[11px] font-medium', CLASE_DE_TIPO[tipo])}>
      <Icono className="h-3 w-3 shrink-0" aria-hidden />
      <span className="truncate">{texto}</span>
    </span>
  )
}

function Leyenda({ puedeBloquear }: { puedeBloquear: boolean }) {
  const items: Array<{ tipo: TipoDeCelda; texto: string }> = [
    { tipo: 'suyo', texto: 'Suyo' },
    { tipo: 'permiso', texto: 'Por permiso' },
    { tipo: 'abierto', texto: 'Abierto a mano' },
    { tipo: 'asignado', texto: 'Asignado' },
    ...(puedeBloquear ? [{ tipo: 'bloqueado' as const, texto: 'Bloqueado' }] : []),
  ]
  return (
    <ul aria-label="Qué significa cada celda" className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {items.map((i) => (
        <li key={i.tipo}>
          <MarcaDeCelda tipo={i.tipo} texto={i.texto} />
        </li>
      ))}
      <li className="text-[11px] text-[var(--ls-t4)]">· pulsa una celda para cambiarla</li>
    </ul>
  )
}

function Matriz({ filas, ...comun }: Comun & { filas: FilaDeLaMatriz[] }) {
  const { buzones, cabecera, puedeBloquear } = comun
  return (
    <div className="overflow-hidden rounded-[14px] border border-[var(--ls-linea)]">
      <div className="border-b border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-3 py-2">
        <Leyenda puedeBloquear={puedeBloquear} />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr className="text-left align-bottom">
              <th scope="col" className="sticky left-0 z-10 min-w-[170px] bg-[var(--ls-sup)] px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--ls-t3)]">
                Persona
              </th>
              {buzones.map((b) => {
                const c = cabecera(b)
                return (
                  <th key={b.id} scope="col" className="min-w-[92px] max-w-[120px] px-1.5 py-2 text-center font-normal">
                    <span className="flex items-center justify-center gap-1.5" title={b.direccion}>
                      <PuntoDeBuzon direccion={b.direccion} tamano={7} />
                      <span className="truncate text-[12px] font-semibold text-[var(--ls-t1)]">{c.principal}</span>
                    </span>
                    <span className="block truncate text-[10.5px] text-[var(--ls-t4)]" title={b.direccion}>
                      {c.secundaria}
                    </span>
                  </th>
                )
              })}
              <th scope="col" className="w-[1%] px-2 py-2">
                <span className="sr-only">Acciones rápidas</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => (
              <tr key={f.persona.id} className="group border-t border-[var(--ls-linea)] transition-colors hover:bg-[var(--ls-sup2)]">
                <th scope="row" className="sticky left-0 z-10 bg-[var(--ls-sup)] px-3 py-2 text-left font-normal group-hover:bg-[var(--ls-sup2)]">
                  <Persona fila={f} />
                </th>
                {buzones.map((b) => (
                  <td key={b.id} className="px-1.5 py-1.5 text-center">
                    <CeldaConPopover fila={f} buzon={b} {...comun} />
                  </td>
                ))}
                <td className="px-2 py-1.5 text-right">
                  <MenuDeAtajos fila={f} {...comun} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Persona({ fila }: { fila: FilaDeLaMatriz }) {
  const { persona } = fila
  return (
    <span className="flex items-center gap-2">
      <Avatar nombre={persona.nombre} tamano={26} />
      <span className="min-w-0">
        <span className="block truncate font-semibold text-[var(--ls-t1)]">{persona.nombre}</span>
        <span className="flex flex-wrap items-center gap-x-1.5 text-[10.5px] text-[var(--ls-t4)]">
          {persona.permisoEquipo && <span title="Tiene el permiso «Supervisión del equipo comercial»: lee los buzones de los comerciales">supervisa comerciales</span>}
          {persona.permisoCorreo && <span title="Tiene el permiso «Supervisión del correo»: lee los de todo el equipo menos los de los administradores">supervisa el correo</span>}
          {!persona.tieneCorreo && (
            <span className="text-[var(--ls-e-ambar)]" title="Sin la casilla «Correo» no puede abrir la pantalla de Correo">
              sin la casilla Correo
            </span>
          )}
          {fila.bloqueados > 0 && <span className="text-[var(--ls-e-rojo)]">{fila.bloqueados === 1 ? '1 bloqueado' : `${fila.bloqueados} bloqueados`}</span>}
          {!persona.permisoEquipo && !persona.permisoCorreo && persona.tieneCorreo && fila.bloqueados === 0 && <span>{fila.leidos === 1 ? 'lee 1 buzón ajeno' : `lee ${fila.leidos} buzones ajenos`}</span>}
        </span>
      </span>
    </span>
  )
}

/** Explica en una frase por dónde lo lee hoy (para el popover y el título de la celda) */
function explicacion(c: CeldaDeAcceso, nombre: string, bloqueo: Bloqueo | undefined): string {
  if (c.via === 'suyo') return `Es el buzón de ${nombre}.`
  if (c.bloqueado) {
    const por = bloqueo?.por ? ` por ${bloqueo.por}` : ''
    const cuando = bloqueo ? `, ${hace(bloqueo.desde)}` : ''
    const aunque = c.via === 'permiso' ? ', aunque su permiso de supervisión se lo abriría' : c.via === 'concedido' ? ', aunque está abierto a mano' : ''
    return `Bloqueado${por}${cuando}: no lo lee${aunque}.`
  }
  if (c.via === 'permiso') return `Lo lee por un permiso de supervisión${c.concedido ? ' (y además está abierto a mano)' : ''}${c.asignado ? '; además lo tiene asignado' : ''}.`
  if (c.via === 'concedido') return `Se lo abrieron a mano${c.asignado ? '; además lo tiene asignado' : ''}.`
  if (c.via === 'asignado') return c.puedeResponder ? 'Lo tiene asignado: lo lee, le avisa y responde desde él.' : 'Lo tiene asignado en «solo avisos»: lo lee y le avisa.'
  return 'No lo lee.'
}

function CeldaConPopover({ fila, buzon, bloqueos, puedeBloquear, cabecera, guardando, cambiar }: Comun & { fila: FilaDeLaMatriz; buzon: BuzonDeLaMatriz }) {
  const [abierto, setAbierto] = useState(false)
  const celda = fila.celdas[buzon.id]
  if (!celda) return null
  if (celda.via === 'suyo') return <MarcaDeCelda tipo="suyo" texto="Suyo" />
  const aspecto = aspectoDeCelda(celda)

  const clave = `${fila.persona.id}|${buzon.id}`
  const ocupada = guardando.has(clave)
  const frase = explicacion(celda, fila.persona.nombre, bloqueos.get(clave))
  const etiqueta = `${fila.persona.nombre} · ${cabecera(buzon).buzon}: ${aspecto.texto}. Cambiar`

  return (
    <Popover.Root open={abierto} onOpenChange={setAbierto}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={etiqueta}
          title={frase}
          disabled={ocupada}
          className={cn('inline-flex min-h-[30px] max-w-full items-center justify-center rounded-[10px] px-1 transition-colors hover:bg-[var(--ls-sup3)] data-[state=open]:bg-[var(--ls-sup3)]', FOCO, ocupada && 'cursor-wait')}
        >
          {ocupada ? <Loader2 className="h-4 w-4 animate-spin text-[var(--ls-t3)]" aria-hidden /> : <MarcaDeCelda tipo={aspecto.tipo} texto={aspecto.texto} />}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="center"
          sideOffset={6}
          collisionPadding={16}
          className="z-[80] w-[min(calc(100vw-32px),300px)] rounded-[14px] border border-[var(--ls-linea2)] bg-[var(--ls-sup)] p-3 shadow-[var(--ls-sombra-3)] outline-none motion-safe:data-[state=open]:animate-in motion-safe:data-[state=open]:fade-in-0 motion-safe:data-[state=open]:zoom-in-95"
        >
          <EditorDeCelda
            celda={celda}
            buzon={buzon}
            persona={fila.persona.nombre}
            nombreDeBuzon={cabecera(buzon).buzon}
            frase={frase}
            puedeBloquear={puedeBloquear}
            ocupada={ocupada}
            alElegir={(pasos) => {
              setAbierto(false)
              void cambiar(fila.persona.id, pasos)
            }}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

/** El Segmentado de tres estados y el porqué de lo que no se puede (en el popover del escritorio y en cada fila del móvil) */
function EditorDeCelda({
  celda,
  buzon,
  persona,
  nombreDeBuzon,
  frase,
  puedeBloquear,
  ocupada,
  alElegir,
  compacto,
}: {
  celda: CeldaDeAcceso
  buzon: BuzonDeLaMatriz
  persona: string
  nombreDeBuzon: string
  frase: string
  puedeBloquear: boolean
  ocupada: boolean
  alElegir: (pasos: CambioDeLector[][]) => void
  compacto?: boolean
}) {
  const opciones = opcionesDeCelda(celda, buzon.id, puedeBloquear)
  const valor = estadoDeCelda(celda)
  // Sin la 260 no se ofrece bloquear: la opción no sale (salvo que ya estuviera bloqueado, que no pasa sin la tabla)
  const visibles: Opcion<EstadoDeCelda>[] = opciones.filter((o) => o.id !== 'bloqueado' || puedeBloquear || valor === 'bloqueado').map((o) => ({ id: o.id, texto: o.texto, desactivada: o.desactivada || ocupada }))
  const motivos = opciones.filter((o) => o.id !== valor && o.motivo && (o.id !== 'bloqueado' || puedeBloquear)).map((o) => ({ id: o.id, texto: o.motivo as string, bloqueo: o.desactivada }))
  return (
    <div className="space-y-2">
      {!compacto && (
        <div>
          <p className="truncate text-[12.5px] font-semibold text-[var(--ls-t1)]">
            {persona} · <span className="font-normal text-[var(--ls-t3)]">{nombreDeBuzon}</span>
          </p>
          <p className="mt-0.5 text-[12px] leading-snug text-[var(--ls-t3)]">{frase}</p>
        </div>
      )}
      <Segmentado
        etiqueta={`Qué ve ${persona} de ${nombreDeBuzon}`}
        opciones={visibles}
        valor={valor}
        tamano="sm"
        anchoCompleto
        onCambio={(destino) => {
          const p = pasosHacia(celda, buzon.id, destino, puedeBloquear)
          if (p.ok && p.pasos.length > 0) alElegir(p.pasos)
        }}
      />
      {motivos.length > 0 && (
        <ul className="space-y-1">
          {motivos.map((m) => (
            <li key={m.id} className="flex items-start gap-1.5 text-[11.5px] leading-snug text-[var(--ls-t4)]">
              {m.bloqueo ? <Lock className="mt-[2px] h-3 w-3 shrink-0" aria-hidden /> : <AlertCircle className="mt-[2px] h-3 w-3 shrink-0 text-[var(--ls-e-ambar)]" aria-hidden />}
              <span>
                <b className="font-medium text-[var(--ls-t3)]">{TEXTO_DE_ESTADO[m.id]}:</b> {m.texto}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

const ICONO_DE_ATAJO: Record<AtajoDeFila['id'], typeof Check> = { comerciales: Eye, quitar: Undo2, bloquear: Lock, desbloquear: LockOpen }

function MenuDeAtajos({ fila, buzones, puedeBloquear, guardando, cambiar, boton }: Comun & { fila: FilaDeLaMatriz; boton?: ReactNode }) {
  const atajos = atajosDeFila(fila, buzones, puedeBloquear)
  const ocupada = buzones.some((b) => guardando.has(`${fila.persona.id}|${b.id}`))
  const hayComerciales = buzones.some((b) => b.dueno.esComercial === true)
  const visibles = atajos.filter((a) => (a.id === 'comerciales' ? hayComerciales : a.id === 'quitar' || puedeBloquear))
  return (
    <Menu.Root modal={false}>
      <Menu.Trigger asChild disabled={ocupada}>
        {boton ?? (
          <button
            type="button"
            aria-label={`Acciones rápidas para ${fila.persona.nombre}`}
            title="Acciones rápidas"
            className={cn('inline-flex h-8 w-8 items-center justify-center rounded-[10px] text-[var(--ls-t3)] transition-colors hover:bg-[var(--ls-sup3)] hover:text-[var(--ls-t1)] data-[state=open]:bg-[var(--ls-sup3)]', TACTIL, FOCO)}
          >
            {ocupada ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <MoreHorizontal className="h-4 w-4" aria-hidden />}
          </button>
        )}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          side="bottom"
          align="end"
          sideOffset={6}
          collisionPadding={16}
          className="z-[80] w-[min(calc(100vw-32px),320px)] rounded-[14px] border border-[var(--ls-linea2)] bg-[var(--ls-sup)] p-1.5 shadow-[var(--ls-sombra-3)] motion-safe:data-[state=open]:animate-in motion-safe:data-[state=open]:fade-in-0 motion-safe:data-[state=open]:zoom-in-95"
        >
          <Menu.Label className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--ls-t3)]">Acciones rápidas · {primerNombre(fila.persona.nombre)}</Menu.Label>
          <Menu.Separator className="my-1 h-px bg-[var(--ls-linea)]" />
          {visibles.map((a) => {
            const Icono = ICONO_DE_ATAJO[a.id]
            const n = a.cambios.length
            return (
              <Menu.Item
                key={a.id}
                disabled={n === 0}
                onSelect={() => void cambiar(fila.persona.id, [a.cambios], false)}
                className={cn(
                  'flex min-h-[44px] cursor-pointer select-none items-center gap-2.5 rounded-[10px] px-2.5 text-[13px] outline-none lg:min-h-[36px]',
                  'data-[highlighted]:bg-[var(--ls-sup2)] data-[disabled]:cursor-not-allowed data-[disabled]:opacity-40',
                  a.tono === 'peligro' ? 'text-[var(--ls-e-rojo)]' : 'text-[var(--ls-t1)]'
                )}
              >
                <Icono className="h-4 w-4 shrink-0 opacity-80" aria-hidden />
                <span className="flex-1">{a.texto}</span>
                <span className="text-[11px] tabular-nums text-[var(--ls-t4)]">{n === 0 ? 'nada' : n}</span>
              </Menu.Item>
            )
          })}
          {!puedeBloquear && <p className="px-2.5 pb-1.5 pt-1 text-[11.5px] leading-snug text-[var(--ls-t4)]">{FALTA_LA_260}</p>}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  )
}

/* ------------------------------------------------------------------ */
/* Móvil: por persona                                                  */
/* ------------------------------------------------------------------ */

function PorPersona({ filas, ...comun }: Comun & { filas: FilaDeLaMatriz[] }) {
  const { buzones, bloqueos, puedeBloquear, cabecera, guardando, cambiar } = comun
  const [personaId, setPersonaId] = useState<string>(filas[0]?.persona.id ?? '')
  const fila = filas.find((f) => f.persona.id === personaId) ?? filas[0]
  if (!fila) return null
  return (
    <div className="space-y-3">
      <div>
        <label htmlFor="correo-permisos-persona" className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[var(--ls-t3)]">
          Persona
        </label>
        <span className="flex items-center gap-2">
          <select
            id="correo-permisos-persona"
            value={fila.persona.id}
            onChange={(e) => setPersonaId(e.target.value)}
            className={cn('h-11 min-w-0 flex-1 rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-3 text-base text-[var(--ls-t1)]', FOCO)}
          >
            {filas.map((f) => (
              <option key={f.persona.id} value={f.persona.id}>
                {f.persona.nombre}
              </option>
            ))}
          </select>
          <MenuDeAtajos fila={fila} {...comun} boton={<Boton soloIcono icono={MoreHorizontal} aria-label={`Acciones rápidas para ${fila.persona.nombre}`} />} />
        </span>
      </div>
      <div className="rounded-[14px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-3 py-2.5">
        <Persona fila={fila} />
      </div>
      <div className="rounded-[10px] bg-[var(--ls-sup2)] px-3 py-2">
        <Leyenda puedeBloquear={puedeBloquear} />
      </div>
      <ul className="divide-y divide-[var(--ls-linea)] overflow-hidden rounded-[14px] border border-[var(--ls-linea)]">
        {buzones.map((b) => {
          const celda = fila.celdas[b.id]
          if (!celda) return null
          const clave = `${fila.persona.id}|${b.id}`
          const aspecto = aspectoDeCelda(celda)
          const c = cabecera(b)
          return (
            <li key={b.id} className="space-y-2 px-3 py-3">
              <div className="flex items-center gap-2">
                <PuntoDeBuzon direccion={b.direccion} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-medium text-[var(--ls-t1)]">{c.principal}</span>
                  <span className="block truncate text-[12px] text-[var(--ls-t4)]">
                    {direccionCorta(b.direccion)} · {c.secundaria}
                  </span>
                </span>
                {guardando.has(clave) ? <Loader2 className="h-4 w-4 animate-spin text-[var(--ls-t3)]" aria-hidden /> : <MarcaDeCelda tipo={aspecto.tipo} texto={aspecto.texto} />}
              </div>
              {celda.via !== 'suyo' && (
                <EditorDeCelda
                  compacto
                  celda={celda}
                  buzon={b}
                  persona={fila.persona.nombre}
                  nombreDeBuzon={c.buzon}
                  frase={explicacion(celda, fila.persona.nombre, bloqueos.get(clave))}
                  puedeBloquear={puedeBloquear}
                  ocupada={guardando.has(clave)}
                  alElegir={(pasos) => void cambiar(fila.persona.id, pasos)}
                />
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
