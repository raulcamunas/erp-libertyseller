'use client'

import * as Menu from '@radix-ui/react-dropdown-menu'
import { LayoutGroup, MotionConfig, motion } from 'framer-motion'
import {
  AlertTriangle,
  BellOff,
  BellRing,
  ChevronDown,
  ChevronRight,
  Eye,
  Hourglass,
  Inbox,
  KeyRound,
  ListMinus,
  ListPlus,
  MoreHorizontal,
  PenSquare,
  Pencil,
  Plus,
  Settings,
  ShieldCheck,
  Star,
  Unplug,
  UserCheck,
  Users,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import { useCallback, useEffect, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { CifraAnimada, FOCO, mezcla } from '@/components/ui-ls'
import { colorDeBuzon, direccionCorta, inicialDeBuzon } from '@/lib/correo/marcas'
import type { BuzonVisible, Carpeta, Duracion, VistaDeCorreo } from '@/lib/correo/tipos'
import { cn } from '@/lib/utils'
import type { PropsDeBarraDeBuzones, VarianteDeBarra } from './contratos'
import { DURACIONES, ETIQUETA_DE_DURACION, PuntoDeBuzon, textoDeSilencio } from './piezas'

/**
 * BARRA DE BUZONES (spec 1.2, 1.3, 1.4 y 9.8). La columna 1 de Correo en el ordenador, un carril de iconos de 64 px en la tableta y el
 * nivel «Carpetas» en el móvil. No pide datos: todo llega por props (PropsDeBarraDeBuzones de contratos.ts).
 *
 *   · Accesos fijos: «Mis correos», «Asignados a mí» (solo si hay alguno) y, si llega `onVista`, «Destacados» y «Pendientes» (filtros sobre Mis correos).
 *   · «Mis buzones» (los que tienen enMisCorreos) con el lápiz «Elegir»; «Equipo» (el resto que se puede leer), plegable y recordado en localStorage.
 *   · Cada buzón: punto de color, dirección corta, sin leer (hilosSinLeerMios, ya sin lo silenciado), UserCheck si está asignado, BellOff y 55 % si está
 *     silenciado. El ⚠ de contraseña rechazada o desconectado va SIN atenuar y por encima del silencio.
 *   · Menú ⋯ (o clic derecho, o la tecla de menú / ⇧F10): abrir, quitar de / añadir a Mis correos, silenciar…, ajustes del buzón.
 *   · La píldora de la carpeta activa se desliza con layoutId="correo-carpeta" (cada variante en su LayoutGroup para que no salte entre ellas).
 */

/** Lo que la barra admite además del contrato (todo OPCIONAL; ver «desviaciones» en el informe del paquete W3-BARRA) */
export interface ExtrasDeBarra {
  /** La vista puesta en «Mis correos»: marca «Destacados» o «Pendientes» como activos */
  vista?: VistaDeCorreo
  /** Con esto salen «Destacados» y «Pendientes»: abren Mis correos con esa vista. Sin él, no se enseñan */
  onVista?: (vista: VistaDeCorreo) => void
  /** El ✎ de la cabecera del móvil (en el móvil no hay FAB). Sin él, no sale */
  onRedactar?: () => void
}

export const AVISO_FALTA_318 = 'Falta lanzar la migración 318 para elegir, asignar y silenciar correos'

/** Dónde se recuerda si «Equipo» está plegado */
export const CLAVE_EQUIPO_PLEGADO = 'correo:barra:equipo-plegado'

/* ------------------------------------------------------------------ */
/* Lógica pura (con prueba en BarraDeBuzones.prueba.ts)                 */
/* ------------------------------------------------------------------ */

const porDireccion = (a: BuzonVisible, b: BuzonVisible) => a.direccion.localeCompare(b.direccion, 'es')

/** Orden de «Mis buzones»: el que ha puesto la persona (sin orden, al final), luego los propios, los asignados y por dirección */
export function ordenarMisBuzones(a: BuzonVisible, b: BuzonVisible): number {
  const oa = a.orden ?? Number.POSITIVE_INFINITY
  const ob = b.orden ?? Number.POSITIVE_INFINITY
  if (oa !== ob) return oa < ob ? -1 : 1
  if (a.esMio !== b.esMio) return a.esMio ? -1 : 1
  if (a.asignado !== b.asignado) return a.asignado ? -1 : 1
  return porDireccion(a, b)
}

/** Reparte los buzones entre «Mis buzones» (enMisCorreos) y «Equipo» (el resto), ya ordenados */
export function repartirBuzones(buzones: readonly BuzonVisible[]): { mios: BuzonVisible[]; equipo: BuzonVisible[] } {
  const mios = buzones.filter((b) => b.enMisCorreos).sort(ordenarMisBuzones)
  const equipo = buzones
    .filter((b) => !b.enMisCorreos)
    .sort((a, b) => (a.propietario.nombre || '').localeCompare(b.propietario.nombre || '', 'es') || porDireccion(a, b))
  return { mios, equipo }
}

/** El número de «Mis correos» cuando no llega `sinLeerMios`: los de Mis correos sin silenciar */
export function sumarSinLeerMios(buzones: readonly BuzonVisible[]): number {
  return buzones.reduce((n, b) => (b.enMisCorreos && !b.silenciado ? n + Math.max(0, b.hilosSinLeerMios || 0) : n), 0)
}

export type AlertaDeBuzon = 'contrasena' | 'desconectado' | null

/** ⚠ de un buzón: la contraseña rechazada manda sobre «desconectado» */
export function alertaDeBuzon(b: Pick<BuzonVisible, 'conectado' | 'credencialesInvalidas'>): AlertaDeBuzon {
  if (b.credencialesInvalidas) return 'contrasena'
  if (!b.conectado) return 'desconectado'
  return null
}

const TEXTO_DE_ALERTA: Record<Exclude<AlertaDeBuzon, null>, string> = {
  contrasena: 'La contraseña ha dejado de valer',
  desconectado: 'Desconectado',
}

/** Qué entrada de la barra está activa: 'mios' | 'destacados' | 'pendientes' | 'asignados' | 'equipo' | 'secuencias' | 'buzon:<id>' */
export function claveActiva(carpeta: Carpeta, vista?: VistaDeCorreo): string {
  switch (carpeta.tipo) {
    case 'mios':
      return vista === 'destacados' ? 'destacados' : vista === 'pendientes' ? 'pendientes' : 'mios'
    case 'buzon':
      return `buzon:${carpeta.buzonId}`
    default:
      return carpeta.tipo
  }
}

/* ------------------------------------------------------------------ */
/* Piezas                                                              */
/* ------------------------------------------------------------------ */

const ROTULO = 'text-[11px] font-semibold uppercase tracking-wide text-[var(--ls-t3)]'

const OPCION =
  'flex min-h-11 cursor-pointer select-none items-center gap-2.5 rounded-[8px] px-2.5 text-[14px] text-[var(--ls-t1)] outline-none ' +
  'data-[highlighted]:bg-[var(--ls-sup3)] data-[state=open]:bg-[var(--ls-sup3)] data-[disabled]:pointer-events-none data-[disabled]:opacity-40 lg:min-h-9 lg:text-[13px]'

const CONTENIDO_MENU =
  'z-[80] w-[min(calc(100vw-32px),272px)] rounded-[14px] border border-[var(--ls-linea2)] bg-[var(--ls-sup)] p-1.5 shadow-[var(--ls-sombra-3)] ' +
  'motion-safe:data-[state=open]:animate-in motion-safe:data-[state=open]:fade-in-0 motion-safe:data-[state=open]:zoom-in-95'

/** La píldora de la carpeta activa (una por LayoutGroup) */
function Pildora() {
  return (
    <motion.span
      layoutId="correo-carpeta"
      aria-hidden
      className="absolute inset-0 rounded-[10px] bg-[var(--ls-acc-suave)] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--ls-acc)_28%,transparent)]"
      transition={{ type: 'spring', stiffness: 520, damping: 40 }}
    />
  )
}

/** El número de sin leer (nada si es 0) */
function Cuenta({ valor, activo, className }: { valor: number; activo?: boolean; className?: string }) {
  if (!valor) return null
  return (
    <span className={cn('ml-auto shrink-0 text-[12px] font-semibold tabular-nums', activo ? 'text-[var(--ls-acc)]' : 'text-[var(--ls-t2)]', className)}>
      <CifraAnimada valor={valor} duracion={0.6} />
    </span>
  )
}

/**
 * La insignia de número del carril (arriba a la derecha del icono). En los accesos se ancla por la IZQUIERDA en el borde derecho del icono, para
 * que con dos cifras crezca hacia fuera y no tape el icono de 18 px; con «99+» sigue cabiendo en el carril de 64 px
 */
function InsigniaDeCarril({ valor, pequena = false }: { valor: number; pequena?: boolean }) {
  if (!valor) return null
  return (
    <span
      aria-hidden
      className={cn(
        'absolute inline-flex items-center justify-center rounded-full bg-[var(--ls-acc-relleno)] font-bold tabular-nums leading-none text-[var(--ls-acc-tinta)] ring-2 ring-[var(--ls-fondo)]',
        // En un buzón, más pequeña y más afuera: no tapa el círculo con la inicial
        pequena ? '-right-2 -top-2 h-[14px] min-w-[14px] px-[3px] text-[9px]' : 'left-[calc(100%-6px)] -top-2 h-[17px] min-w-[17px] px-1 text-[10px]',
      )}
    >
      {valor > 99 ? '99+' : valor}
    </span>
  )
}

interface EntradaProps {
  icono: LucideIcon
  texto: string
  activo: boolean
  onClick: () => void
  variante: VarianteDeBarra
  cuenta?: number
  /** Texto extra para el nombre accesible y el tooltip (p. ej. «12 sin leer») */
  detalle?: string
}

/** Un acceso fijo o del pie (Mis correos, Asignados a mí, Secuencias…) */
function Entrada({ icono: Icono, texto, activo, onClick, variante, cuenta = 0, detalle }: EntradaProps) {
  const nombre = cuenta ? `${texto}, ${cuenta} sin leer` : texto
  if (variante === 'carril') {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={nombre}
        aria-current={activo ? 'page' : undefined}
        title={detalle ? `${texto} · ${detalle}` : cuenta ? `${texto} · ${cuenta} sin leer` : texto}
        className={cn('relative mx-auto flex h-11 w-11 items-center justify-center rounded-[10px] transition-colors hover:bg-[var(--ls-sup2)]', FOCO)}
      >
        {activo && <Pildora />}
        <span className={cn('relative', activo ? 'text-[var(--ls-acc)]' : 'text-[var(--ls-t2)]')}>
          <Icono className="h-[18px] w-[18px]" aria-hidden />
          <InsigniaDeCarril valor={cuenta} />
        </span>
      </button>
    )
  }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={nombre}
      aria-current={activo ? 'page' : undefined}
      className={cn(
        'relative flex w-full items-center gap-2.5 rounded-[10px] px-2.5 text-left transition-colors hover:bg-[var(--ls-sup2)]',
        variante === 'movil' ? 'min-h-11 text-[15px]' : 'min-h-11 text-[13.5px] lg:min-h-[34px]',
        FOCO,
      )}
    >
      {activo && <Pildora />}
      <Icono className={cn('relative h-4 w-4 shrink-0', activo ? 'text-[var(--ls-acc)]' : 'text-[var(--ls-t3)]')} aria-hidden />
      <span className={cn('relative min-w-0 flex-1 truncate', activo ? 'font-semibold text-[var(--ls-t1)]' : 'font-medium text-[var(--ls-t2)]')}>{texto}</span>
      <Cuenta valor={cuenta} activo={activo} className="relative" />
    </button>
  )
}

/* ------------------------------------------------------------------ */
/* Menú de un buzón (⋯ o clic derecho)                                  */
/* ------------------------------------------------------------------ */

interface MenuDeBuzonProps {
  buzon: BuzonVisible
  abierto: boolean
  onAbierto: (v: boolean) => void
  disparador: ReactNode
  puedeAjustes: boolean
  onAbrir: () => void
  onAlternarMisCorreos: () => void
  onSilenciar: (d: Duracion | 'quitar') => void
  onAjustes: () => void
  /** false = falta la 318: «Silenciar…» y «Quitar de / añadir a» enseñan la banda */
  disponible: boolean
  onFalta318: () => void
}

function MenuDeBuzon({ buzon, abierto, onAbierto, disparador, puedeAjustes, onAbrir, onAlternarMisCorreos, onSilenciar, onAjustes, disponible, onFalta318 }: MenuDeBuzonProps) {
  const frase = textoDeSilencio(buzon.silenciado, buzon.silenciadoHasta)
  return (
    <Menu.Root modal={false} open={abierto} onOpenChange={onAbierto}>
      <Menu.Trigger asChild>{disparador}</Menu.Trigger>
      <Menu.Portal>
        <Menu.Content side="right" align="start" sideOffset={6} collisionPadding={16} className={CONTENIDO_MENU}>
          <Menu.Label className="px-2.5 pb-1 pt-1.5">
            <span className="block truncate text-[12.5px] font-semibold text-[var(--ls-t1)]">{buzon.direccion}</span>
            <span className="mt-0.5 block truncate text-[11.5px] text-[var(--ls-t4)]">
              {buzon.esMio ? 'Tu buzón' : `De ${buzon.propietario.nombre || 'otra persona'}`}
              {buzon.asignado ? ' · asignado a ti' : ''}
            </span>
          </Menu.Label>
          <Menu.Separator className="my-1 h-px bg-[var(--ls-linea)]" />
          <Menu.Item className={OPCION} onSelect={onAbrir}>
            <Eye className="h-4 w-4 shrink-0 text-[var(--ls-t3)]" aria-hidden />
            <span className="flex-1">{buzon.puedeResponder ? 'Abrir' : 'Abrir en solo lectura'}</span>
          </Menu.Item>
          <Menu.Item className={OPCION} onSelect={() => (disponible ? onAlternarMisCorreos() : onFalta318())}>
            {buzon.enMisCorreos ? (
              <ListMinus className="h-4 w-4 shrink-0 text-[var(--ls-t3)]" aria-hidden />
            ) : (
              <ListPlus className="h-4 w-4 shrink-0 text-[var(--ls-t3)]" aria-hidden />
            )}
            <span className="flex-1">{buzon.enMisCorreos ? 'Quitar de Mis correos' : 'Añadir a Mis correos'}</span>
          </Menu.Item>
          {disponible ? (
            <Menu.Sub>
              <Menu.SubTrigger className={OPCION}>
                <BellOff className="h-4 w-4 shrink-0 text-[var(--ls-t3)]" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block">{buzon.silenciado ? 'Silenciado' : 'Silenciar…'}</span>
                  {buzon.silenciado && <span className="block truncate text-[11.5px] text-[var(--ls-t4)]">{frase}</span>}
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-[var(--ls-t4)]" aria-hidden />
              </Menu.SubTrigger>
              <Menu.Portal>
                <Menu.SubContent sideOffset={4} collisionPadding={16} className={CONTENIDO_MENU}>
                  <Menu.Label className="px-2.5 pb-1 pt-1.5 text-[12px] leading-snug text-[var(--ls-t4)]">
                    Solo para ti. No avisa ni suma en el número; sigue a la vista, atenuado.
                  </Menu.Label>
                  {DURACIONES.map((d) => (
                    <Menu.Item key={d} className={OPCION} onSelect={() => onSilenciar(d)}>
                      <span className="flex-1">{ETIQUETA_DE_DURACION[d]}</span>
                    </Menu.Item>
                  ))}
                  {buzon.silenciado && (
                    <>
                      <Menu.Separator className="my-1 h-px bg-[var(--ls-linea)]" />
                      <Menu.Item className={cn(OPCION, 'font-medium')} onSelect={() => onSilenciar('quitar')}>
                        <BellRing className="h-4 w-4 shrink-0 text-[var(--ls-acc)]" aria-hidden />
                        <span className="flex-1">Quitar silencio</span>
                      </Menu.Item>
                    </>
                  )}
                </Menu.SubContent>
              </Menu.Portal>
            </Menu.Sub>
          ) : (
            <Menu.Item className={OPCION} onSelect={onFalta318}>
              <BellOff className="h-4 w-4 shrink-0 text-[var(--ls-t3)]" aria-hidden />
              <span className="flex-1">Silenciar…</span>
            </Menu.Item>
          )}
          {puedeAjustes && (
            <>
              <Menu.Separator className="my-1 h-px bg-[var(--ls-linea)]" />
              <Menu.Item className={OPCION} onSelect={onAjustes}>
                <Settings className="h-4 w-4 shrink-0 text-[var(--ls-t3)]" aria-hidden />
                <span className="flex-1">Ajustes del buzón</span>
              </Menu.Item>
            </>
          )}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  )
}

/* ------------------------------------------------------------------ */
/* Fila de un buzón                                                     */
/* ------------------------------------------------------------------ */

interface FilaDeBuzonProps {
  buzon: BuzonVisible
  activo: boolean
  variante: VarianteDeBarra
  /** En «Equipo»: punto hueco e insignia «lee» */
  delEquipo: boolean
  esAdmin: boolean
  disponible: boolean
  onCarpeta: (c: Carpeta) => void
  onSilenciar: (buzonId: string, d: Duracion | 'quitar') => void
  onAlternarMisCorreos: (buzonId: string) => void
  onAjustes: (buzonId: string) => void
  onFalta318: () => void
}

function FilaDeBuzon({ buzon, activo, variante, delEquipo, esAdmin, disponible, onCarpeta, onSilenciar, onAlternarMisCorreos, onAjustes, onFalta318 }: FilaDeBuzonProps) {
  const [menu, setMenu] = useState(false)
  const alerta = alertaDeBuzon(buzon)
  const corta = direccionCorta(buzon.direccion)
  const cuenta = Math.max(0, buzon.hilosSinLeerMios || 0)
  const abrir = () => onCarpeta({ tipo: 'buzon', buzonId: buzon.id })

  const partes = [
    buzon.direccion,
    buzon.esMio ? null : `de ${buzon.propietario.nombre || 'otra persona'}`,
    cuenta ? `${cuenta} sin leer` : null,
    buzon.asignado ? 'asignado a ti' : null,
    buzon.silenciado ? textoDeSilencio(true, buzon.silenciadoHasta).toLowerCase() : null,
    alerta ? TEXTO_DE_ALERTA[alerta].toLowerCase() : null,
    !buzon.puedeResponder ? 'solo lectura' : null,
  ].filter(Boolean)
  const nombre = partes.join(', ')

  // Clic derecho o la tecla de menú abren el mismo menú que ⋯
  const alMenuContextual = (e: MouseEvent) => {
    e.preventDefault()
    setMenu(true)
  }
  const alTecla = (e: KeyboardEvent) => {
    if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
      e.preventDefault()
      setMenu(true)
    }
  }

  const menuProps = {
    buzon,
    abierto: menu,
    onAbierto: setMenu,
    puedeAjustes: buzon.esMio || esAdmin,
    onAbrir: abrir,
    onAlternarMisCorreos: () => onAlternarMisCorreos(buzon.id),
    onSilenciar: (d: Duracion | 'quitar') => onSilenciar(buzon.id, d),
    onAjustes: () => onAjustes(buzon.id),
    disponible,
    onFalta318,
  }

  const punto = delEquipo ? (
    <span
      aria-hidden
      className="inline-block h-2 w-2 shrink-0 rounded-full"
      style={{ boxShadow: `inset 0 0 0 1.5px ${colorDeBuzon(buzon.direccion)}`, background: mezcla(colorDeBuzon(buzon.direccion), 18) }}
    />
  ) : (
    <PuntoDeBuzon direccion={buzon.direccion} />
  )

  const iconoDeAlerta = alerta && (
    <span
      role="img"
      aria-label={TEXTO_DE_ALERTA[alerta]}
      title={TEXTO_DE_ALERTA[alerta]}
      className={cn('relative z-[1] inline-flex shrink-0', alerta === 'contrasena' ? 'text-[var(--ls-e-rojo)]' : 'text-[var(--ls-e-ambar)]')}
    >
      <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
    </span>
  )

  if (variante === 'carril') {
    return (
      <div className="relative" onContextMenu={alMenuContextual}>
        <button
          type="button"
          onClick={abrir}
          onKeyDown={alTecla}
          aria-label={nombre}
          aria-current={activo ? 'page' : undefined}
          title={`${corta}${cuenta ? ` · ${cuenta} sin leer` : ''}${buzon.silenciado ? ' · silenciado' : ''}${alerta ? ` · ${TEXTO_DE_ALERTA[alerta]}` : ''}`}
          className={cn('relative mx-auto flex h-11 w-11 items-center justify-center rounded-[10px] transition-colors hover:bg-[var(--ls-sup2)]', FOCO)}
        >
          {activo && <Pildora />}
          <motion.span className="relative inline-flex" initial={false} animate={{ opacity: buzon.silenciado ? 0.55 : 1 }} transition={{ duration: 0.2 }}>
            {/* La inicial del buzón en un círculo de su color (lleno si es de «Mis correos», solo el anillo si es del equipo): sin ella no se sabe cuál es cuál */}
            <span
              aria-hidden
              className="inline-flex h-[22px] w-[22px] items-center justify-center rounded-full text-[11px] font-bold leading-none"
              style={
                delEquipo
                  ? { boxShadow: `inset 0 0 0 1.5px ${colorDeBuzon(buzon.direccion)}`, color: colorDeBuzon(buzon.direccion) }
                  : { boxShadow: `inset 0 0 0 1.5px ${colorDeBuzon(buzon.direccion)}`, background: mezcla(colorDeBuzon(buzon.direccion), 22), color: 'var(--ls-t1)' }
              }
            >
              {inicialDeBuzon(buzon.direccion)}
            </span>
            {!buzon.silenciado && <InsigniaDeCarril valor={cuenta} pequena />}
          </motion.span>
          {buzon.silenciado && !alerta && (
            <BellOff aria-hidden className="absolute bottom-1 right-1 h-3 w-3 text-[var(--ls-t4)]" />
          )}
          {alerta && <span className="absolute bottom-0.5 right-0.5">{iconoDeAlerta}</span>}
        </button>
        {/* Ancla del menú contextual en el carril (no hay ⋯ a la vista): un punto a la derecha del icono */}
        <MenuDeBuzon
          {...menuProps}
          disparador={<span aria-hidden tabIndex={-1} className="pointer-events-none absolute right-0 top-1/2 h-px w-px" />}
        />
      </div>
    )
  }

  const movil = variante === 'movil'
  return (
    <div className="group relative" onContextMenu={alMenuContextual}>
      <button
        type="button"
        onClick={abrir}
        onKeyDown={alTecla}
        aria-label={nombre}
        aria-current={activo ? 'page' : undefined}
        title={buzon.nombre ? `${buzon.nombre} <${buzon.direccion}>` : buzon.direccion}
        className={cn(
          'relative flex w-full items-center gap-2.5 rounded-[10px] pl-2.5 pr-12 text-left transition-colors hover:bg-[var(--ls-sup2)]',
          movil ? 'min-h-11 py-1.5 text-[15px]' : 'min-h-11 py-1 text-[13.5px] lg:min-h-[34px] lg:pr-9',
          FOCO,
        )}
      >
        {activo && <Pildora />}
        {/* Lo que se atenúa al silenciar (el ⚠ va fuera, sin atenuar) */}
        <motion.span
          className="relative flex min-w-0 flex-1 items-center gap-2.5"
          initial={false}
          animate={{ opacity: buzon.silenciado ? 0.55 : 1 }}
          transition={{ duration: 0.2 }}
        >
          {punto}
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className={cn('truncate', activo ? 'font-semibold text-[var(--ls-t1)]' : cuenta ? 'font-medium text-[var(--ls-t1)]' : 'text-[var(--ls-t2)]')}>
                {corta}
              </span>
              {buzon.asignado && <UserCheck className="h-3.5 w-3.5 shrink-0 text-[var(--viz-1)]" aria-hidden />}
              {delEquipo && !buzon.puedeResponder && (
                <span className="shrink-0 rounded-full bg-[var(--ls-sup3)] px-1.5 text-[10.5px] font-medium leading-[16px] text-[var(--ls-t3)]">lee</span>
              )}
              {buzon.silenciado && <BellOff className="h-3.5 w-3.5 shrink-0 text-[var(--ls-t4)]" aria-hidden />}
            </span>
            {delEquipo && buzon.propietario.nombre && !alerta && (
              <span className="block truncate text-[11.5px] text-[var(--ls-t4)]">{buzon.propietario.nombre}</span>
            )}
          </span>
          <Cuenta valor={cuenta} activo={activo} />
        </motion.span>
        {alerta && (
          <span className="absolute right-12 top-1/2 z-[1] -translate-y-1/2 lg:right-9">{iconoDeAlerta}</span>
        )}
      </button>
      {/* La banda del ⚠: sin atenuar, debajo de la fila */}
      {alerta && (
        <button
          type="button"
          onClick={abrir}
          className={cn(
            'mb-0.5 ml-[26px] mt-0.5 flex min-h-8 items-center gap-1.5 rounded-[8px] px-2 text-left text-[11.5px] font-medium',
            alerta === 'contrasena'
              ? 'bg-[color-mix(in_srgb,var(--ls-e-rojo)_12%,transparent)] text-[var(--ls-e-rojo)]'
              : 'bg-[color-mix(in_srgb,var(--ls-e-ambar)_12%,transparent)] text-[var(--ls-e-ambar)]',
            FOCO,
          )}
        >
          {alerta === 'contrasena' ? <KeyRound className="h-3.5 w-3.5 shrink-0" aria-hidden /> : <Unplug className="h-3.5 w-3.5 shrink-0" aria-hidden />}
          <span className="truncate">{alerta === 'contrasena' ? 'Contraseña rechazada' : 'Desconectado'}</span>
        </button>
      )}
      <MenuDeBuzon
        {...menuProps}
        disparador={
          <button
            type="button"
            aria-label={`Más opciones de ${buzon.direccion}`}
            className={cn(
              'absolute right-0.5 top-0 inline-flex h-11 w-11 items-center justify-center rounded-[10px] text-[var(--ls-t3)] transition-[opacity,background-color] hover:bg-[var(--ls-sup3)] hover:text-[var(--ls-t1)]',
              'data-[state=open]:bg-[var(--ls-sup3)] data-[state=open]:opacity-100 lg:top-[1px] lg:h-8 lg:w-8',
              // En el ordenador solo aparece al pasar el ratón o con el foco; en el táctil, siempre
              'lg:opacity-0 lg:focus-visible:opacity-100 lg:group-hover:opacity-100 [@media(pointer:coarse)]:opacity-100',
              FOCO,
            )}
          >
            <MoreHorizontal className="h-4 w-4" aria-hidden />
          </button>
        }
      />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* La barra                                                             */
/* ------------------------------------------------------------------ */

export function BarraDeBuzones(props: PropsDeBarraDeBuzones & ExtrasDeBarra) {
  const {
    buzones,
    carpeta,
    onCarpeta,
    sinLeerAsignados,
    supervisa,
    esAdmin,
    verSecuencias,
    onElegir,
    onSilenciar,
    onAlternarMisCorreos,
    onAjustes,
    onConectar,
    onResumen,
    onEquipoYPermisos,
    variante,
    sinLeerMios,
    preferenciasDisponibles = true,
    vista,
    onVista,
    onRedactar,
  } = props

  const { mios, equipo } = repartirBuzones(buzones)
  const cuentaMios = sinLeerMios ?? sumarSinLeerMios(buzones)
  const activa = claveActiva(carpeta, vista)
  const verAsignados = sinLeerAsignados > 0 || carpeta.tipo === 'asignados'

  // «Equipo» plegado, recordado en este navegador (si el almacenamiento falla, sale desplegado)
  const [plegado, setPlegado] = useState(false)
  useEffect(() => {
    try {
      setPlegado(window.localStorage.getItem(CLAVE_EQUIPO_PLEGADO) === '1')
    } catch {
      /* sin almacenamiento: desplegado */
    }
  }, [])
  const alternarPlegado = useCallback(() => {
    setPlegado((antes) => {
      const nuevo = !antes
      try {
        window.localStorage.setItem(CLAVE_EQUIPO_PLEGADO, nuevo ? '1' : '0')
      } catch {
        /* no pasa nada: solo no se recuerda */
      }
      return nuevo
    })
  }, [])

  // La banda «Falta lanzar la migración 318» (al pulsar Elegir, Silenciar o Quitar/añadir sin la 318)
  const [falta318, setFalta318] = useState(false)
  const avisarFalta318 = useCallback(() => setFalta318(true), [])
  const elegir = () => (preferenciasDisponibles ? onElegir() : avisarFalta318())

  const abrirMios = (v: VistaDeCorreo | null) => {
    onCarpeta({ tipo: 'mios' })
    if (onVista) onVista(v ?? 'todos')
  }

  const filaComun = {
    variante,
    esAdmin,
    disponible: preferenciasDisponibles,
    onCarpeta,
    onSilenciar,
    onAlternarMisCorreos,
    onAjustes,
    onFalta318: avisarFalta318,
  }

  const banda = falta318 && (
    <div
      role="status"
      className={cn(
        'flex items-start gap-2 rounded-[10px] border border-[color-mix(in_srgb,var(--ls-e-ambar)_30%,transparent)] bg-[color-mix(in_srgb,var(--ls-e-ambar)_10%,transparent)] text-[var(--ls-e-ambar)]',
        variante === 'carril' ? 'mx-1 p-1.5' : 'mx-1 mb-1 px-2.5 py-2',
      )}
      title={variante === 'carril' ? AVISO_FALTA_318 : undefined}
    >
      <AlertTriangle className="mt-[1px] h-3.5 w-3.5 shrink-0" aria-hidden />
      {variante === 'carril' ? (
        <span className="sr-only">{AVISO_FALTA_318}</span>
      ) : (
        <span className="min-w-0 flex-1 text-[12px] leading-snug">{AVISO_FALTA_318}.</span>
      )}
      <button
        type="button"
        onClick={() => setFalta318(false)}
        aria-label="Cerrar el aviso"
        className={cn('-m-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] hover:bg-[var(--ls-sup3)]', variante === 'carril' && 'hidden', FOCO)}
      >
        <X className="h-3.5 w-3.5" aria-hidden />
      </button>
    </div>
  )

  /* ---------- Carril de iconos (tableta) ---------- */
  if (variante === 'carril') {
    return (
      <MotionConfig reducedMotion="user">
        <LayoutGroup id="correo-barra-carril">
          {/* Lo de arriba se desplaza; el pie (Secuencias, Resumen, Equipo y permisos, Conectar) queda siempre a la vista, aunque la tableta sea baja */}
          <nav aria-label="Buzones de correo" className="flex h-full w-16 shrink-0 flex-col">
            {/* Barra fina VISIBLE (no `ls-sin-barra`): en una ventana baja (1100×800) los últimos buzones (y la «contraseña rechazada» de uno) quedaban bajo el pie sin ninguna pista de que se pudiera desplazar */}
            <div className="flex min-h-0 flex-1 flex-col items-stretch gap-1 overflow-y-auto overflow-x-hidden py-2 [scrollbar-width:thin] [scrollbar-color:var(--ls-linea2)_transparent] [&>*]:shrink-0">
              <Entrada variante="carril" icono={Inbox} texto="Mis correos" activo={activa === 'mios'} onClick={() => abrirMios(null)} cuenta={cuentaMios} />
              {verAsignados && (
                <Entrada variante="carril" icono={UserCheck} texto="Asignados a mí" activo={activa === 'asignados'} onClick={() => onCarpeta({ tipo: 'asignados' })} cuenta={sinLeerAsignados} />
              )}
              {onVista && (
                <>
                  <Entrada variante="carril" icono={Star} texto="Destacados" activo={activa === 'destacados'} onClick={() => abrirMios('destacados')} />
                  <Entrada variante="carril" icono={Hourglass} texto="Pendientes" activo={activa === 'pendientes'} onClick={() => abrirMios('pendientes')} />
                </>
              )}
              <div aria-hidden className="mx-3 my-1 h-px bg-[var(--ls-linea)]" />
              {banda}
              {mios.map((b) => (
                <FilaDeBuzon key={b.id} buzon={b} activo={activa === `buzon:${b.id}`} delEquipo={false} {...filaComun} />
              ))}
              <button
                type="button"
                onClick={elegir}
                aria-label="Elegir mis correos"
                title="Elegir mis correos"
                className={cn('mx-auto flex h-9 w-11 items-center justify-center rounded-[10px] text-[var(--ls-t3)] hover:bg-[var(--ls-sup2)] hover:text-[var(--ls-t1)]', FOCO)}
              >
                <Pencil className="h-3.5 w-3.5" aria-hidden />
              </button>
              {equipo.length > 0 && (
                <>
                  <button
                    type="button"
                    onClick={alternarPlegado}
                    aria-expanded={!plegado}
                    aria-label={plegado ? `Enseñar los buzones del equipo (${equipo.length})` : 'Plegar los buzones del equipo'}
                    title={`Equipo · ${equipo.length}`}
                    className={cn('mx-auto mt-1 flex h-8 w-11 items-center justify-center gap-0.5 rounded-[10px] text-[var(--ls-t4)] hover:bg-[var(--ls-sup2)] hover:text-[var(--ls-t2)]', FOCO)}
                  >
                    <Users className="h-3.5 w-3.5" aria-hidden />
                    <ChevronDown className={cn('h-3 w-3 transition-transform', plegado && '-rotate-90')} aria-hidden />
                  </button>
                  {!plegado && equipo.map((b) => <FilaDeBuzon key={b.id} buzon={b} activo={activa === `buzon:${b.id}`} delEquipo {...filaComun} />)}
                </>
              )}
            </div>
            <div className="flex shrink-0 flex-col gap-1 border-t border-[var(--ls-linea)] py-2">
              {verSecuencias && <Entrada variante="carril" icono={Zap} texto="Secuencias" activo={activa === 'secuencias'} onClick={() => onCarpeta({ tipo: 'secuencias' })} />}
              {supervisa && <Entrada variante="carril" icono={Users} texto="Resumen del equipo" activo={activa === 'equipo'} onClick={onResumen} />}
              {esAdmin && <Entrada variante="carril" icono={ShieldCheck} texto="Equipo y permisos" activo={false} onClick={onEquipoYPermisos} />}
              <Entrada variante="carril" icono={Plus} texto="Conectar buzón" activo={false} onClick={onConectar} />
            </div>
          </nav>
        </LayoutGroup>
      </MotionConfig>
    )
  }

  /* ---------- Columna (ordenador) y nivel «Carpetas» (móvil) ---------- */
  const movil = variante === 'movil'

  const accesos = (
    <div className={cn('flex flex-col gap-0.5', movil && 'rounded-[14px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] p-1 shadow-[var(--ls-sombra-1)]')}>
      <Entrada variante={variante} icono={Inbox} texto="Mis correos" activo={activa === 'mios'} onClick={() => abrirMios(null)} cuenta={cuentaMios} />
      {verAsignados && (
        <Entrada variante={variante} icono={UserCheck} texto="Asignados a mí" activo={activa === 'asignados'} onClick={() => onCarpeta({ tipo: 'asignados' })} cuenta={sinLeerAsignados} />
      )}
      {onVista && (
        <>
          <Entrada variante={variante} icono={Star} texto="Destacados" activo={activa === 'destacados'} onClick={() => abrirMios('destacados')} />
          <Entrada variante={variante} icono={Hourglass} texto="Pendientes" activo={activa === 'pendientes'} onClick={() => abrirMios('pendientes')} />
        </>
      )}
    </div>
  )

  const cuerpo = (
    <>
      {accesos}

      {/* MIS BUZONES */}
      <section aria-labelledby={`correo-mis-buzones-${variante}`} className="mt-4">
        <div className="flex min-h-9 items-center justify-between pl-2.5 pr-0.5">
          <h2 id={`correo-mis-buzones-${variante}`} className={ROTULO}>
            Mis buzones
          </h2>
          <button
            type="button"
            onClick={elegir}
            aria-label="Elegir mis correos"
            title="Elegir mis correos"
            className={cn(
              'inline-flex h-11 items-center gap-1.5 rounded-[10px] px-2.5 text-[12.5px] font-medium text-[var(--ls-t3)] transition-colors hover:bg-[var(--ls-sup2)] hover:text-[var(--ls-t1)] lg:h-7 lg:px-2',
              FOCO,
            )}
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden />
            <span>Elegir</span>
          </button>
        </div>
        {banda}
        {mios.length === 0 ? (
          <p className="px-2.5 py-2 text-[12.5px] leading-snug text-[var(--ls-t4)]">
            Aún no has elegido tus correos.{' '}
            <button type="button" onClick={elegir} className={cn('font-medium text-[var(--ls-acc)] underline-offset-2 hover:underline', FOCO)}>
              Elegir
            </button>
          </p>
        ) : (
          <div className="flex flex-col gap-0.5">
            {mios.map((b) => (
              <FilaDeBuzon key={b.id} buzon={b} activo={activa === `buzon:${b.id}`} delEquipo={false} {...filaComun} />
            ))}
          </div>
        )}
      </section>

      {/* EQUIPO (plegable) */}
      {equipo.length > 0 && (
        <section aria-labelledby={`correo-equipo-${variante}`} className="mt-3">
          <button
            type="button"
            onClick={alternarPlegado}
            aria-expanded={!plegado}
            aria-controls={`correo-equipo-lista-${variante}`}
            className={cn('flex min-h-11 w-full items-center justify-between rounded-[10px] pl-2.5 pr-2 hover:bg-[var(--ls-sup2)] lg:min-h-9', FOCO)}
          >
            <h2 id={`correo-equipo-${variante}`} className={ROTULO}>
              Equipo <span className="ml-1 font-medium normal-case tracking-normal text-[var(--ls-t4)]">{equipo.length}</span>
            </h2>
            <ChevronDown className={cn('h-4 w-4 text-[var(--ls-t4)] transition-transform duration-200', plegado && '-rotate-90')} aria-hidden />
          </button>
          {!plegado && (
            <motion.div
              id={`correo-equipo-lista-${variante}`}
              className="flex flex-col gap-0.5"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.16 }}
            >
              {equipo.map((b) => (
                <FilaDeBuzon key={b.id} buzon={b} activo={activa === `buzon:${b.id}`} delEquipo {...filaComun} />
              ))}
            </motion.div>
          )}
        </section>
      )}

      {/* PIE */}
      <div className={cn('flex flex-col gap-0.5 border-t border-[var(--ls-linea)] pt-2', movil ? 'mt-5' : 'mt-auto pt-3')}>
        {verSecuencias && <Entrada variante={variante} icono={Zap} texto="Secuencias" activo={activa === 'secuencias'} onClick={() => onCarpeta({ tipo: 'secuencias' })} />}
        {supervisa && <Entrada variante={variante} icono={Users} texto="Resumen del equipo" activo={activa === 'equipo'} onClick={onResumen} />}
        {esAdmin && <Entrada variante={variante} icono={ShieldCheck} texto="Equipo y permisos" activo={false} onClick={onEquipoYPermisos} />}
        <Entrada variante={variante} icono={Plus} texto="Conectar buzón" activo={false} onClick={onConectar} />
      </div>
    </>
  )

  if (movil) {
    return (
      <MotionConfig reducedMotion="user">
        <LayoutGroup id="correo-barra-movil">
          <nav aria-label="Buzones de correo" className="flex flex-col">
            {/* Cabecera pegajosa: el hueco de la hamburguesa fija (.lat-hamburguesa) con pl-14 */}
            <div className="sticky top-[var(--cab-hueco,0px)] z-20 -mx-1 flex h-14 items-center gap-2 bg-[color-mix(in_srgb,var(--ls-fondo)_92%,transparent)] pl-1 pr-1 lg:top-0 backdrop-blur-md lg:pl-0">
              <h1 className="flex min-w-0 flex-1 items-center gap-2 text-[18px] font-semibold tracking-[-0.015em] text-[var(--ls-t1)]">
                Correo
              </h1>
              {onRedactar && (
                <button
                  type="button"
                  onClick={onRedactar}
                  aria-label="Redactar"
                  className={cn(
                    'inline-flex h-11 w-11 items-center justify-center rounded-[10px] border border-[var(--ls-acc-borde)] bg-[var(--ls-acc-relleno)] text-[var(--ls-acc-tinta)] shadow-[inset_0_1px_0_rgba(255,255,255,0.22)]',
                    FOCO,
                  )}
                >
                  <PenSquare className="h-[18px] w-[18px]" aria-hidden />
                </button>
              )}
            </div>
            <div className="flex flex-col pb-6 pt-1">{cuerpo}</div>
          </nav>
        </LayoutGroup>
      </MotionConfig>
    )
  }

  return (
    <MotionConfig reducedMotion="user">
      <LayoutGroup id="correo-barra-columna">
        <nav aria-label="Buzones de correo" className="flex h-full min-h-0 w-full flex-col overflow-y-auto overscroll-contain px-2 py-2 ls-sin-barra">
          {cuerpo}
        </nav>
      </LayoutGroup>
    </MotionConfig>
  )
}

export default BarraDeBuzones
