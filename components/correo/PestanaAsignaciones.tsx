'use client'

import * as Menu from '@radix-ui/react-dropdown-menu'
import * as Popover from '@radix-ui/react-popover'
import { AnimatePresence, motion, MotionConfig } from 'framer-motion'
import { AlertCircle, ArrowLeft, Check, Eye, Inbox, Loader2, Lock, PenLine, Search, ShieldAlert, Trash2, UserPlus, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Avatar, Boton, Confirmacion, EstadoVacio, EsqueletoTarjeta, FOCO, Insignia, Segmentado, TACTIL } from '@/components/ui-ls'
import { personasParaAsignar, type AccionDeAsignacion, type BuzonConAsignaciones, type PersonaAsignable, type VistaDeAsignaciones } from '@/lib/correo/asignaciones'
import { direccionCorta } from '@/lib/correo/marcas'
import { cn } from '@/lib/utils'
import { enviarJson, pedir } from './api'
import { PuntoDeBuzon } from './piezas'

/**
 * «ASIGNACIONES»: LA PESTAÑA POR DEFECTO DE «EQUIPO Y PERMISOS» (solo administradores).
 * =====================================================================================
 * Una tarjeta por buzón con quién lo trabaja. Asignar un buzón a alguien le da lectura, avisos y «Mis correos»; con «Puede responder y enviar» (marcada por
 * defecto) además envía desde él, y queda anotado que lo envió esa persona. Se asigna a un employee o a un admin, también a uno mismo («Yo» sale arriba del
 * selector); nunca a un partner ni al dueño (eso ya lo filtra `personasParaAsignar`, y la ruta lo vuelve a comprobar).
 *
 *   · [+ Asignar] abre el selector. Elegida la persona, la casilla y los avisos: «Lo que envíe saldrá desde X y quedará anotado que lo envió Y» y, si tiene
 *     ese buzón bloqueado, «Asignar quita el bloqueo». Si el buzón es de OTRO administrador, se pide confirmación (Confirmacion palabra={null}).
 *   · Pulsar un chip: cambiar entre «responde» y «solo avisos», o «Quitar asignación». Cada cambio se deshace con un clic desde el aviso.
 *   · Arriba, el buscador «Buscar buzón o persona» y el filtro «Solo con asignaciones».
 *   · Sin la migración 318, la ruta contesta 503: sale la banda y nada más.
 *
 * GET y POST /api/correo/asignaciones. Este fichero solo pinta; la regla vive en lib/correo/asignaciones.ts.
 */

/* ------------------------------------------------------------------ */
/* Lógica pura (con prueba en equipo.prueba.ts)                        */
/* ------------------------------------------------------------------ */

export const FALTA_LA_318 = 'Falta lanzar la migración 318 para elegir, asignar y silenciar correos.'

/** Para buscar sin mirar mayúsculas ni tildes */
export function normalizar(texto: string | null | undefined): string {
  return (texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

export type FiltroDeAsignaciones = 'todos' | 'con'

/** Los buzones que salen con la búsqueda (dirección, nombre del buzón, dueño o quien lo trabaja) y el filtro «Solo con asignaciones» */
export function filtrarBuzones(buzones: readonly BuzonConAsignaciones[], texto: string, filtro: FiltroDeAsignaciones): BuzonConAsignaciones[] {
  const q = normalizar(texto)
  return buzones.filter((b) => {
    if (filtro === 'con' && b.asignaciones.length === 0) return false
    if (!q) return true
    return [b.direccion, b.nombre, b.dueno.nombre, ...b.asignaciones.map((a) => a.nombre)].some((x) => normalizar(x).includes(q))
  })
}

/** El selector de personas con su búsqueda: «Yo» arriba (ya viene así de personasParaAsignar) */
export function filtrarPersonas(personas: readonly PersonaAsignable[], texto: string): PersonaAsignable[] {
  const q = normalizar(texto)
  if (!q) return [...personas]
  return personas.filter((p) => normalizar(p.nombre).includes(q) || (p.esYo && 'yo'.startsWith(q)))
}

const primerNombre = (n: string) => n.trim().split(/\s+/)[0] || n

/** Los avisos que salen antes de pulsar «Asignar» */
export function avisosDeAsignar(e: { persona: PersonaAsignable; buzon: Pick<BuzonConAsignaciones, 'id' | 'direccion'>; puedeResponder: boolean }): Array<{ id: 'remitente' | 'bloqueo' | 'lectura'; texto: string }> {
  const quien = e.persona.esYo ? 'tú' : primerNombre(e.persona.nombre)
  const avisos: Array<{ id: 'remitente' | 'bloqueo' | 'lectura'; texto: string }> = []
  if (e.puedeResponder) {
    avisos.push({
      id: 'remitente',
      texto: e.persona.esYo
        ? `Lo que envíes saldrá desde ${e.buzon.direccion} y quedará anotado que lo enviaste tú.`
        : `Lo que envíe saldrá desde ${e.buzon.direccion} y quedará anotado que lo envió ${quien}.`,
    })
  } else {
    avisos.push({ id: 'lectura', texto: `${e.persona.esYo ? 'Lo leerás' : `${quien} lo leerá`} y le llegarán los avisos, pero no podrá enviar desde él.` })
  }
  if (e.persona.bloqueados.includes(e.buzon.id)) avisos.push({ id: 'bloqueo', texto: `${e.persona.esYo ? 'Tienes' : 'Tiene'} este buzón bloqueado: asignar quita el bloqueo.` })
  return avisos
}

/** ¿Hay que confirmar? Solo si el buzón es de OTRO administrador (el propio no) */
export function pideConfirmacion(buzon: Pick<BuzonConAsignaciones, 'deAdmin' | 'dueno'>, yoId: string): boolean {
  return buzon.deAdmin && buzon.dueno.id !== yoId
}

/** La pregunta de la confirmación: «Vas a dejar que Patricia escriba como daniela@liberty…» */
export function textoDeConfirmacion(persona: PersonaAsignable, direccion: string, puedeResponder: boolean): string {
  const quien = persona.esYo ? 'tú' : persona.nombre
  if (persona.esYo) return puedeResponder ? `Vas a escribir como ${direccion}` : `Vas a leer ${direccion}`
  return puedeResponder ? `Vas a dejar que ${quien} escriba como ${direccion}` : `Vas a dejar que ${quien} lea ${direccion}`
}

/** El aviso tras un cambio, y la acción que lo deshace */
export function despuesDeCambiar(accion: AccionDeAsignacion, nombre: string, direccion: string, puedeResponderAntes: boolean | null): { texto: string; deshacer: { accion: AccionDeAsignacion; puedeResponder?: boolean } | null } {
  const corta = direccionCorta(direccion)
  switch (accion) {
    case 'asignar':
      return { texto: `${corta} asignado a ${nombre}.`, deshacer: { accion: 'quitar' } }
    case 'quitar':
      return { texto: `${nombre} ya no trabaja ${corta}.`, deshacer: { accion: 'asignar', puedeResponder: puedeResponderAntes !== false } }
    case 'responde':
      return { texto: `${nombre} ya puede responder desde ${corta}.`, deshacer: { accion: 'solo_avisos' } }
    case 'solo_avisos':
      return { texto: `${nombre} solo lee ${corta} y le avisa.`, deshacer: { accion: 'responde' } }
  }
}

/* ------------------------------------------------------------------ */
/* La pestaña                                                          */
/* ------------------------------------------------------------------ */

type Vista = VistaDeAsignaciones<unknown>

type Estado = { tipo: 'cargando' } | { tipo: 'falta318' } | { tipo: 'error'; mensaje: string } | { tipo: 'listo'; vista: Vista }

type RespuestaDePost = Partial<Vista> & { ok: true; cambiado: boolean; accion: AccionDeAsignacion; puedeResponder: boolean | null; desbloqueado: boolean }

export interface PropsDePestanaAsignaciones {
  /** Quien mira: «Yo» arriba del selector y sin confirmación en sus propios buzones */
  yoId: string
  /** Se ha cambiado algo (Últimos cambios y Quién ve qué se releen) */
  onCambiado?: () => void
}

const PUESTO: Record<string, string> = { comercial: 'comercial', manager_comercial: 'manager comercial', comercial_autonomo: 'comercial autónomo', gestion_administrativa: 'administración' }
const rolDe = (role: string | null, puesto: string | null) => (role === 'admin' ? 'administrador' : (puesto ? PUESTO[puesto] : undefined) ?? 'equipo')

export function PestanaAsignaciones({ yoId, onCambiado }: PropsDePestanaAsignaciones) {
  const [estado, setEstado] = useState<Estado>({ tipo: 'cargando' })
  const [texto, setTexto] = useState('')
  const [filtro, setFiltro] = useState<FiltroDeAsignaciones>('todos')
  // «buzón|persona» que se están guardando
  const [guardando, setGuardando] = useState<ReadonlySet<string>>(new Set())

  const cargar = useCallback(async () => {
    const r = await pedir<Vista>('/api/correo/asignaciones')
    if (r.ok) setEstado({ tipo: 'listo', vista: r.datos })
    else if (r.estado === 503) setEstado({ tipo: 'falta318' })
    else setEstado({ tipo: 'error', mensaje: r.mensaje })
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const cambiar = useCallback(
    async (buzon: BuzonConAsignaciones, persona: { id: string; nombre: string }, accion: AccionDeAsignacion, opciones: { puedeResponder?: boolean; puedeResponderAntes?: boolean | null; sinDeshacer?: boolean } = {}): Promise<boolean> => {
      const clave = `${buzon.id}|${persona.id}`
      setGuardando((p) => new Set([...p, clave]))
      try {
        const r = await enviarJson<RespuestaDePost>('/api/correo/asignaciones', 'POST', {
          buzonId: buzon.id,
          personaId: persona.id,
          accion,
          ...(accion === 'asignar' && opciones.puedeResponder !== undefined ? { puedeResponder: opciones.puedeResponder } : {}),
        })
        if (!r.ok) {
          if (r.estado === 503) setEstado({ tipo: 'falta318' })
          toast.error(r.mensaje)
          return false
        }
        if (r.datos.buzones && r.datos.personas) setEstado({ tipo: 'listo', vista: { buzones: r.datos.buzones, personas: r.datos.personas, cambios: r.datos.cambios ?? [] } })
        else void cargar()
        onCambiado?.()
        if (!r.datos.cambiado) {
          toast.message('Ya estaba así.')
          return true
        }
        const d = despuesDeCambiar(accion, primerNombre(persona.nombre), buzon.direccion, opciones.puedeResponderAntes ?? null)
        const extra = r.datos.desbloqueado ? ' Se le ha quitado el bloqueo.' : ''
        const deshacer = d.deshacer
        toast.success(`${d.texto}${extra}`, {
          action:
            deshacer && !opciones.sinDeshacer
              ? { label: 'Deshacer', onClick: () => void cambiar(buzon, persona, deshacer.accion, { puedeResponder: deshacer.puedeResponder, sinDeshacer: true }) }
              : undefined,
        })
        return true
      } finally {
        setGuardando((p) => {
          const n = new Set(p)
          n.delete(clave)
          return n
        })
      }
    },
    [cargar, onCambiado]
  )

  if (estado.tipo === 'cargando') {
    return (
      <div className="space-y-3" aria-busy="true" aria-label="Cargando">
        <EsqueletoTarjeta alto={92} />
        <EsqueletoTarjeta alto={92} />
        <EsqueletoTarjeta alto={92} />
      </div>
    )
  }
  if (estado.tipo === 'falta318') return <BandaDeAviso>{FALTA_LA_318} Hasta entonces, «Quién ve qué» funciona como siempre.</BandaDeAviso>
  if (estado.tipo === 'error') {
    return (
      <BandaDeAviso tono="rojo">
        {estado.mensaje}
        <button type="button" onClick={() => void cargar()} className="ml-2 font-medium text-[var(--ls-acc)] underline underline-offset-2">
          Reintentar
        </button>
      </BandaDeAviso>
    )
  }

  const { vista } = estado
  const visibles = filtrarBuzones(vista.buzones, texto, filtro)
  const conAsignaciones = vista.buzones.filter((b) => b.asignaciones.length > 0).length

  return (
    <MotionConfig reducedMotion="user">
      <div className="space-y-4">
        <p className="text-[12.5px] leading-relaxed text-[var(--ls-t3)]">
          Quien trabaja un buzón lo lee, recibe sus avisos y lo tiene en «Mis correos». Si además <b className="font-semibold text-[var(--ls-t2)]">responde</b>, envía desde él y queda anotado quién envió cada correo.
        </p>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">Buscar buzón o persona</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ls-t4)]" aria-hidden />
            <input
              type="search"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder="Buscar buzón o persona"
              className={cn(
                'h-11 w-full rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] pl-9 pr-3 text-base text-[var(--ls-t1)] placeholder:text-[var(--ls-t4)] hover:border-[var(--ls-linea2)] lg:h-9 lg:text-[13.5px]',
                FOCO
              )}
            />
          </label>
          <Segmentado
            etiqueta="Qué buzones se ven"
            tamano="sm"
            valor={filtro}
            onCambio={setFiltro}
            opciones={[
              { id: 'todos', texto: 'Todos', cuenta: vista.buzones.length },
              { id: 'con', texto: 'Solo con asignaciones', cuenta: conAsignaciones },
            ]}
          />
        </div>

        {vista.buzones.length === 0 ? (
          <EstadoVacio compacto icono={Inbox} titulo="Todavía no hay ningún buzón conectado" descripcion="Cuando alguien conecte su correo podrás asignárselo a otras personas." />
        ) : visibles.length === 0 ? (
          <EstadoVacio
            compacto
            icono={Search}
            titulo={filtro === 'con' && !texto ? 'Ningún buzón tiene asignaciones' : `Nada con «${texto}»`}
            accion={{
              texto: 'Quitar filtros',
              onClick: () => {
                setTexto('')
                setFiltro('todos')
              },
            }}
          />
        ) : (
          <ul className="space-y-3">
            {visibles.map((b) => (
              <TarjetaDeBuzon key={b.id} buzon={b} vista={vista} yoId={yoId} guardando={guardando} cambiar={cambiar} />
            ))}
          </ul>
        )}
      </div>
    </MotionConfig>
  )
}

export function BandaDeAviso({ tono = 'ambar', children }: { tono?: 'ambar' | 'rojo'; children: ReactNode }) {
  const color = tono === 'rojo' ? 'var(--ls-e-rojo)' : 'var(--ls-e-ambar)'
  return (
    <p className="flex items-start gap-2 rounded-[10px] border border-l-2 border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-3 py-2.5 text-[12.5px] text-[var(--ls-t2)]" style={{ borderLeftColor: color }} role={tono === 'rojo' ? 'alert' : 'status'}>
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" style={{ color }} aria-hidden />
      <span>{children}</span>
    </p>
  )
}

type Cambiar = (buzon: BuzonConAsignaciones, persona: { id: string; nombre: string }, accion: AccionDeAsignacion, opciones?: { puedeResponder?: boolean; puedeResponderAntes?: boolean | null }) => Promise<boolean>

function TarjetaDeBuzon({ buzon, vista, yoId, guardando, cambiar }: { buzon: BuzonConAsignaciones; vista: Vista; yoId: string; guardando: ReadonlySet<string>; cambiar: Cambiar }) {
  const esMio = buzon.dueno.id === yoId
  return (
    <li className="rounded-[14px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] p-3 sm:p-4">
      <div className="flex items-start gap-2.5">
        <PuntoDeBuzon direccion={buzon.direccion} className="mt-[6px]" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-semibold text-[var(--ls-t1)]" title={buzon.direccion}>
            {buzon.direccion}
          </p>
          <p className="truncate text-[12px] text-[var(--ls-t3)]">
            de {esMio ? 'ti' : buzon.dueno.nombre} · {rolDe(buzon.dueno.role, buzon.dueno.puesto)}
            {buzon.nombre?.trim() ? ` · «${buzon.nombre.trim()}»` : ''}
          </p>
        </div>
        {buzon.deAdmin && !esMio && (
          <Insignia tono="ambar" icono={ShieldAlert} tamano="sm" title="Es el buzón de otro administrador: asignarlo pide confirmación">
            de un admin
          </Insignia>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 sm:pl-[18px]">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ls-t3)]">Lo trabajan</span>
        <AnimatePresence initial={false}>
          {buzon.asignaciones.map((a) => (
            <motion.span
              key={a.personaId}
              layout
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.6 }}
              transition={{ type: 'spring', stiffness: 420, damping: 28 }}
            >
              <ChipDeAsignacion buzon={buzon} asignacion={a} esYo={a.personaId === yoId} guardando={guardando.has(`${buzon.id}|${a.personaId}`)} cambiar={cambiar} />
            </motion.span>
          ))}
        </AnimatePresence>
        {buzon.asignaciones.length === 0 && <span className="text-[12.5px] text-[var(--ls-t4)]">Nadie más que su dueño</span>}
        <SelectorDePersona buzon={buzon} vista={vista} yoId={yoId} guardando={guardando} cambiar={cambiar} />
      </div>
    </li>
  )
}

function ChipDeAsignacion({ buzon, asignacion, esYo, guardando, cambiar }: { buzon: BuzonConAsignaciones; asignacion: BuzonConAsignaciones['asignaciones'][number]; esYo: boolean; guardando: boolean; cambiar: Cambiar }) {
  const persona = { id: asignacion.personaId, nombre: asignacion.nombre }
  const nombre = esYo ? 'Yo' : primerNombre(asignacion.nombre)
  const detalle = `${asignacion.nombre}${asignacion.puedeResponder ? ' responde y envía' : ' solo lee y recibe avisos'}${asignacion.asignadoPor ? ` · asignado por ${asignacion.asignadoPor}` : ''}`
  return (
    <Menu.Root modal={false}>
      <Menu.Trigger asChild disabled={guardando}>
        <button
          type="button"
          title={detalle}
          aria-label={`${detalle}. Cambiar`}
          className={cn(
            'inline-flex h-11 items-center gap-1.5 rounded-full border border-[var(--ls-linea)] bg-[var(--ls-sup)] py-1 pl-1 pr-2.5 text-[12.5px] transition-colors hover:border-[var(--ls-linea2)] hover:bg-[var(--ls-sup3)] data-[state=open]:bg-[var(--ls-sup3)] lg:h-8',
            FOCO
          )}
        >
          {guardando ? <Loader2 className="h-6 w-6 animate-spin p-1 text-[var(--ls-t3)]" aria-hidden /> : <Avatar nombre={asignacion.nombre} tamano={24} />}
          <span className="font-medium text-[var(--ls-t1)]">{nombre}</span>
          {asignacion.puedeResponder ? (
            <span className="inline-flex items-center gap-0.5 text-[11px] text-[var(--ls-acc)]">
              <PenLine className="h-3 w-3" aria-hidden /> responde
            </span>
          ) : (
            <span className="inline-flex items-center gap-0.5 text-[11px] text-[var(--ls-t3)]">
              <Eye className="h-3 w-3" aria-hidden /> solo avisos
            </span>
          )}
        </button>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          side="bottom"
          align="start"
          sideOffset={6}
          collisionPadding={16}
          className="z-[80] w-[min(calc(100vw-32px),300px)] rounded-[14px] border border-[var(--ls-linea2)] bg-[var(--ls-sup)] p-1.5 shadow-[var(--ls-sombra-3)] motion-safe:data-[state=open]:animate-in motion-safe:data-[state=open]:fade-in-0 motion-safe:data-[state=open]:zoom-in-95"
        >
          <Menu.Label className="px-2.5 pb-1 pt-1.5">
            <span className="block truncate text-[12.5px] font-semibold text-[var(--ls-t1)]">{asignacion.nombre}</span>
            <span className="block truncate text-[11.5px] text-[var(--ls-t4)]">{direccionCorta(buzon.direccion)}</span>
          </Menu.Label>
          <Menu.Separator className="my-1 h-px bg-[var(--ls-linea)]" />
          <Menu.Item className={OPCION} disabled={asignacion.puedeResponder} onSelect={() => void cambiar(buzon, persona, 'responde')}>
            <PenLine className="h-4 w-4 shrink-0 text-[var(--ls-acc)]" aria-hidden />
            <span className="flex-1">
              Puede responder y enviar
              <span className="block text-[11.5px] text-[var(--ls-t4)]">Envía desde el buzón; queda anotado</span>
            </span>
            {asignacion.puedeResponder && <Check className="h-4 w-4 text-[var(--ls-acc)]" aria-label="Actual" />}
          </Menu.Item>
          <Menu.Item className={OPCION} disabled={!asignacion.puedeResponder} onSelect={() => void cambiar(buzon, persona, 'solo_avisos')}>
            <Eye className="h-4 w-4 shrink-0 text-[var(--ls-t3)]" aria-hidden />
            <span className="flex-1">
              Solo avisos
              <span className="block text-[11.5px] text-[var(--ls-t4)]">Lo lee y le avisa, sin enviar</span>
            </span>
            {!asignacion.puedeResponder && <Check className="h-4 w-4 text-[var(--ls-acc)]" aria-label="Actual" />}
          </Menu.Item>
          <Menu.Separator className="my-1 h-px bg-[var(--ls-linea)]" />
          <Menu.Item className={cn(OPCION, 'text-[var(--ls-e-rojo)]')} onSelect={() => void cambiar(buzon, persona, 'quitar', { puedeResponderAntes: asignacion.puedeResponder })}>
            <Trash2 className="h-4 w-4 shrink-0" aria-hidden />
            <span className="flex-1">Quitar asignación</span>
          </Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  )
}

const OPCION =
  'flex min-h-[44px] cursor-pointer select-none items-center gap-2.5 rounded-[10px] px-2.5 py-1.5 text-[13px] text-[var(--ls-t1)] outline-none data-[highlighted]:bg-[var(--ls-sup2)] data-[disabled]:cursor-default data-[disabled]:opacity-100 lg:min-h-[36px]'

function SelectorDePersona({ buzon, vista, yoId, guardando, cambiar }: { buzon: BuzonConAsignaciones; vista: Vista; yoId: string; guardando: ReadonlySet<string>; cambiar: Cambiar }) {
  const [abierto, setAbierto] = useState(false)
  const [busqueda, setBusqueda] = useState('')
  const [elegida, setElegida] = useState<PersonaAsignable | null>(null)
  const [responde, setResponde] = useState(true)
  // Lo que se va a asignar a un buzón de otro administrador, mientras se confirma (el popover ya se ha cerrado)
  const [pendiente, setPendiente] = useState<{ persona: PersonaAsignable; responde: boolean } | null>(null)

  const candidatas = useMemo(() => personasParaAsignar(vista, buzon.id), [vista, buzon.id])
  const lista = filtrarPersonas(candidatas, busqueda)
  const ocupada = elegida ? guardando.has(`${buzon.id}|${elegida.id}`) : false

  const reiniciar = () => {
    setBusqueda('')
    setElegida(null)
    setResponde(true)
  }

  const asignar = async (persona: PersonaAsignable, conRespuesta: boolean) => {
    const ok = await cambiar(buzon, persona, 'asignar', { puedeResponder: conRespuesta })
    if (!ok) throw new Error('no asignado')
    setAbierto(false)
    reiniciar()
  }

  return (
    <>
      <Popover.Root
        open={abierto}
        onOpenChange={(a) => {
          setAbierto(a)
          if (!a) reiniciar()
        }}
      >
        <Popover.Trigger asChild>
          <Boton variante="fantasma" tamano="sm" icono={UserPlus} disabled={candidatas.length === 0} title={candidatas.length === 0 ? 'No queda nadie más del equipo a quien asignarlo' : undefined} className="text-[var(--ls-acc)]">
            Asignar
          </Boton>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            side="bottom"
            align="start"
            sideOffset={6}
            collisionPadding={16}
            className="z-[80] w-[min(calc(100vw-32px),340px)] rounded-[14px] border border-[var(--ls-linea2)] bg-[var(--ls-sup)] p-2 shadow-[var(--ls-sombra-3)] outline-none motion-safe:data-[state=open]:animate-in motion-safe:data-[state=open]:fade-in-0 motion-safe:data-[state=open]:zoom-in-95"
          >
            {!elegida ? (
              <div>
                <p className="px-1.5 pb-2 pt-1 text-[12.5px] text-[var(--ls-t3)]">
                  ¿Quién trabaja <b className="font-semibold text-[var(--ls-t1)]">{direccionCorta(buzon.direccion)}</b>?
                </p>
                {candidatas.length > 6 && (
                  <label className="relative mb-1.5 block">
                    <span className="sr-only">Buscar persona</span>
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ls-t4)]" aria-hidden />
                    <input
                      autoFocus
                      value={busqueda}
                      onChange={(e) => setBusqueda(e.target.value)}
                      placeholder="Buscar persona"
                      className={cn('h-11 w-full rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] pl-8 pr-3 text-base text-[var(--ls-t1)] placeholder:text-[var(--ls-t4)] lg:h-9 lg:text-[13.5px]', FOCO)}
                    />
                  </label>
                )}
                <ul className="max-h-[min(50dvh,320px)] space-y-0.5 overflow-y-auto" role="listbox" aria-label="Personas">
                  {lista.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={false}
                        onClick={() => setElegida(p)}
                        className={cn('flex min-h-[44px] w-full items-center gap-2.5 rounded-[10px] px-2 py-1.5 text-left transition-colors hover:bg-[var(--ls-sup2)] lg:min-h-[40px]', FOCO)}
                      >
                        <Avatar nombre={p.nombre} tamano={28} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-medium text-[var(--ls-t1)]">{p.esYo ? `Yo · ${p.nombre}` : p.nombre}</span>
                          <span className="block truncate text-[11.5px] text-[var(--ls-t4)]">{rolDe(p.role, p.puesto)}</span>
                        </span>
                        {p.bloqueados.includes(buzon.id) && <Lock className="h-3.5 w-3.5 shrink-0 text-[var(--ls-e-rojo)]" aria-label="Lo tiene bloqueado" />}
                      </button>
                    </li>
                  ))}
                  {lista.length === 0 && <li className="px-2 py-3 text-center text-[12.5px] text-[var(--ls-t4)]">Nadie con «{busqueda}»</li>}
                </ul>
              </div>
            ) : (
              <div className="space-y-3 p-1">
                <div className="flex items-center gap-2">
                  <Boton variante="fantasma" soloIcono tamano="sm" icono={ArrowLeft} aria-label="Elegir a otra persona" onClick={() => setElegida(null)} />
                  <Avatar nombre={elegida.nombre} tamano={28} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold text-[var(--ls-t1)]">{elegida.esYo ? `Yo · ${elegida.nombre}` : elegida.nombre}</span>
                    <span className="block truncate text-[11.5px] text-[var(--ls-t4)]">{direccionCorta(buzon.direccion)}</span>
                  </span>
                </div>
                <label className={cn('flex min-h-[44px] cursor-pointer items-center gap-2.5 rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-3 py-2', TACTIL)}>
                  <input type="checkbox" checked={responde} onChange={(e) => setResponde(e.target.checked)} className="h-4 w-4 shrink-0 accent-[var(--ls-acc)]" />
                  <span className="text-[13px] font-medium text-[var(--ls-t1)]">Puede responder y enviar</span>
                </label>
                <ul className="space-y-1.5">
                  {avisosDeAsignar({ persona: elegida, buzon, puedeResponder: responde }).map((a) => (
                    <li key={a.id} className="flex items-start gap-1.5 text-[12px] leading-snug text-[var(--ls-t3)]">
                      {a.id === 'bloqueo' ? <Lock className="mt-[2px] h-3.5 w-3.5 shrink-0 text-[var(--ls-e-rojo)]" aria-hidden /> : <AlertCircle className="mt-[2px] h-3.5 w-3.5 shrink-0 text-[var(--ls-e-ambar)]" aria-hidden />}
                      <span>{a.texto}</span>
                    </li>
                  ))}
                </ul>
                <div className="flex justify-end gap-2">
                  <Boton variante="fantasma" tamano="sm" icono={X} onClick={() => setAbierto(false)}>
                    Cancelar
                  </Boton>
                  <Boton
                    variante="primario"
                    tamano="sm"
                    icono={UserPlus}
                    cargando={ocupada}
                    onClick={() => {
                      if (pideConfirmacion(buzon, yoId)) {
                        // El popover se cierra (quedaría encima del diálogo) sin olvidar lo elegido
                        setPendiente({ persona: elegida, responde })
                        setAbierto(false)
                      } else void asignar(elegida, responde).catch(() => {})
                    }}
                  >
                    Asignar
                  </Boton>
                </div>
              </div>
            )}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>

      <Confirmacion
        abierto={pendiente !== null}
        onCambio={(a) => {
          if (!a) {
            setPendiente(null)
            reiniciar()
          }
        }}
        palabra={null}
        tono="normal"
        titulo={pendiente ? textoDeConfirmacion(pendiente.persona, buzon.direccion, pendiente.responde) : ''}
        descripcion={`Es el buzón de ${buzon.dueno.nombre}, que es administrador. Le llegará un aviso y quedará anotado en el historial.`}
        textoConfirmar="Sí, asignar"
        onConfirmar={() => (pendiente ? asignar(pendiente.persona, pendiente.responde) : undefined)}
      />
    </>
  )
}
