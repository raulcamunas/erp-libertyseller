'use client'

import { formatDistanceToNow } from 'date-fns'
import { es } from 'date-fns/locale'
import { AlertCircle, Ban, Check, Eye, Loader2, ShieldCheck, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Avatar, Esqueleto } from '@/components/rendimiento/ui'
import { paraBloquear, paraDesbloquear, type Bloqueo, type BuzonDeLaMatriz, type CambioDeLector, type CeldaDeAcceso, type DatosDeLaMatriz, type FilaDeLaMatriz } from '@/lib/correo/lectores'
import { enviarJson, pedir } from './api'
import { BOTON_ICONO } from './ui'

/**
 * «QUIÉN VE QUÉ»: UN ADMINISTRADOR («MANAGER») DECIDE QUÉ BUZONES LEE CADA PERSONA DEL EQUIPO.
 *
 * Una tabla de personas por buzón. Cada casilla es «esta persona lee este buzón»: se marca para abrírselo y se desmarca para cerrarlo (un solo buzón, una sola persona; nada se abre
 * por sorpresa). Es solo LECTURA y cada vez que alguien mira un buzón que no es suyo queda anotado: abrirlo no deja escribir desde él.
 *
 * Lo que ya abre un permiso de supervisión (Gestión de Usuarios) sale marcado (con el ojo): el permiso se quita allí, porque abre más cosas que el correo, pero ese buzón concreto
 * se puede BLOQUEAR aquí con un clic (migración 260): la persona conserva su permiso y deja de leer ese buzón. Un buzón bloqueado sale con el círculo tachado, y otro clic quita el
 * bloqueo. Sin la migración 260 el ojo no se puede pulsar y la pantalla avisa de qué fichero falta lanzar.
 *
 * Solo la ve un administrador (la ruta lo vuelve a comprobar y a cualquier otro le contesta «no existe»). Este fichero solo decide qué se pinta.
 */

const hace = (iso: string) => formatDistanceToNow(new Date(Math.min(Date.parse(iso), Date.now())), { locale: es, addSuffix: true })
const primerNombre = (n: string) => n.trim().split(/\s+/)[0] || n

interface Props {
  onCerrar: () => void
}

type Estado = { tipo: 'cargando' } | { tipo: 'error'; mensaje: string; faltaMigracion: boolean } | { tipo: 'listo'; datos: DatosDeLaMatriz }

export function PermisosDeBuzones({ onCerrar }: Props) {
  const [estado, setEstado] = useState<Estado>({ tipo: 'cargando' })
  // Las casillas que se están guardando ahora mismo («persona|buzón»), para no dejar pulsar dos veces
  const [guardando, setGuardando] = useState<ReadonlySet<string>>(new Set())

  const cargar = useCallback(async () => {
    const r = await pedir<DatosDeLaMatriz>('/api/correo/lectores')
    setEstado(r.ok ? { tipo: 'listo', datos: r.datos } : { tipo: 'error', mensaje: r.mensaje, faltaMigracion: r.estado === 503 })
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const cambiar = useCallback(
    async (lectorId: string, cambios: CambioDeLector[], avisar = true) => {
      const claves = cambios.map((c) => `${lectorId}|${c.buzonId}`)
      setGuardando((previas) => new Set([...previas, ...claves]))
      const r = await enviarJson<DatosDeLaMatriz & { concedidos: number; quitados: number; bloqueados: number; desbloqueados: number; rechazados: Array<{ motivo: string }> }>('/api/correo/lectores', 'POST', { lectorId, cambios })
      setGuardando((previas) => {
        const n = new Set(previas)
        for (const c of claves) n.delete(c)
        return n
      })
      if (!r.ok) {
        toast.error(r.mensaje)
        return
      }
      setEstado({ tipo: 'listo', datos: { matriz: r.datos.matriz, concesiones: r.datos.concesiones, bloqueos: r.datos.bloqueos, bloqueosDisponibles: r.datos.bloqueosDisponibles, recientes: r.datos.recientes } })
      if (r.datos.rechazados.length > 0) toast.warning(r.datos.rechazados[0].motivo)
      else if (avisar) {
        toast.success(
          r.datos.concedidos > 0
            ? 'Buzón abierto.'
            : r.datos.quitados > 0
              ? 'Buzón cerrado.'
              : r.datos.bloqueados > 0
                ? 'Buzón bloqueado: ya no lo lee.'
                : r.datos.desbloqueados > 0
                  ? 'Bloqueo quitado.'
                  : 'Sin cambios.'
        )
      }
    },
    []
  )

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/55 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onCerrar()} onKeyDown={(e) => e.key === 'Escape' && onCerrar()}>
      <div role="dialog" aria-modal="true" aria-label="Quién ve qué correo" className="flex max-h-[94dvh] w-full max-w-[min(96vw,1280px)] flex-col overflow-hidden rounded-t-[12px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] shadow-2xl shadow-black/50 sm:rounded-[12px]">
        <header className="flex items-center justify-between gap-3 border-b border-[var(--ls-linea)] px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[8px] bg-[var(--ls-acc-suave)] text-[var(--ls-acc)]">
              <ShieldCheck className="h-4 w-4" aria-hidden />
            </span>
            <div className="min-w-0">
              <h2 className="text-[13.5px] font-semibold text-[var(--ls-t1)]">Quién ve qué correo</h2>
              <p className="truncate text-[11.5px] text-[var(--ls-t4)]">Solo los administradores ven y cambian esto</p>
            </div>
          </div>
          <button type="button" onClick={onCerrar} className={BOTON_ICONO} aria-label="Cerrar">
            <X className="h-4 w-4" aria-hidden />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          <p className="max-w-[78ch] text-[12.5px] leading-snug text-[var(--ls-t3)]">
            Los administradores leen todos los buzones. Aquí abres, uno a uno, los que puede leer cada persona del equipo: <b className="font-semibold text-[var(--ls-t2)]">solo lectura</b> (nadie escribe desde un buzón que no es suyo) y cada
            vez que alguien mira uno queda anotado. Las filas son las personas del equipo con acceso a Correo y las columnas, los buzones conectados. ¿Falta una persona? Dale la casilla «Correo» en Gestión de Usuarios. ¿Falta un
            buzón? Aún no lo ha conectado su dueño.
          </p>
          <p className="max-w-[78ch] text-[12.5px] leading-snug text-[var(--ls-t3)]">
            ¿Alguien tiene un permiso de supervisión pero <b className="font-semibold text-[var(--ls-t2)]">no debe leer un buzón concreto</b>? Pulsa su ojo para <b className="font-semibold text-[var(--ls-t2)]">bloqueárselo</b>: conserva el permiso y
            deja de ver solo ese buzón (a un administrador no se le puede bloquear nada). Un buzón que se conecte más adelante no queda bloqueado solo: aparecerá como una columna nueva y lo bloqueas cuando quieras.
          </p>

          {estado.tipo === 'cargando' && (
            <div className="space-y-2" aria-busy="true" aria-label="Cargando">
              <Esqueleto className="h-9 w-full" />
              <Esqueleto className="h-9 w-full" />
              <Esqueleto className="h-9 w-full" />
            </div>
          )}

          {estado.tipo === 'error' && (
            <p className="flex items-start gap-2 rounded-[8px] border border-l-2 border-[var(--ls-linea)] border-l-[var(--ls-e-ambar)] bg-[var(--ls-sup2)] px-3 py-2.5 text-[12.5px] text-[var(--ls-t2)]" role="alert">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--ls-e-ambar)]" aria-hidden />
              <span>
                {estado.mensaje}
                {!estado.faltaMigracion && (
                  <button type="button" onClick={() => void cargar()} className="ml-2 font-medium text-[var(--ls-acc)] underline underline-offset-2">
                    Reintentar
                  </button>
                )}
              </span>
            </p>
          )}

          {estado.tipo === 'listo' && <Matriz datos={estado.datos} guardando={guardando} cambiar={cambiar} />}
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* La tabla                                                            */
/* ------------------------------------------------------------------ */

type Cambiar = (lectorId: string, cambios: CambioDeLector[], avisar?: boolean) => Promise<void>

const ETIQUETA_DE_VIA: Record<CeldaDeAcceso['via'], string> = {
  suyo: 'Es su buzón',
  permiso: 'Lo abre un permiso de supervisión',
  concedido: 'Abierto a mano',
  nada: 'No lo ve',
}

const ETIQUETA_DE_ACCION: Record<DatosDeLaMatriz['recientes'][number]['accion'], { texto: string; clase: string }> = {
  concedido: { texto: 'Abierto', clase: 'font-semibold text-[var(--ls-e-verde)]' },
  quitado: { texto: 'Cerrado', clase: 'font-semibold text-[var(--ls-e-ambar)]' },
  bloqueado: { texto: 'Bloqueado', clase: 'font-semibold text-[var(--ls-e-rojo)]' },
  desbloqueado: { texto: 'Desbloqueado', clase: 'font-semibold text-[var(--ls-e-verde)]' },
}

function Matriz({ datos, guardando, cambiar }: { datos: DatosDeLaMatriz; guardando: ReadonlySet<string>; cambiar: Cambiar }) {
  const { matriz, recientes, bloqueosDisponibles } = datos
  const comerciales = useMemo(() => matriz.buzones.filter((b) => b.dueno.esComercial === true), [matriz.buzones])
  const bloqueos = useMemo(() => new Map<string, Bloqueo>(datos.bloqueos.map((b) => [`${b.lectorId}|${b.buzonId}`, b])), [datos.bloqueos])
  // Quien tiene varios buzones (un administrador que añade los que quiere vigilar) saldría repetido en las columnas: esos se distinguen por el nombre del buzón o su dirección
  const duenosConVarios = useMemo(() => {
    const cuenta = new Map<string, number>()
    for (const b of matriz.buzones) cuenta.set(b.dueno.id, (cuenta.get(b.dueno.id) ?? 0) + 1)
    return new Set([...cuenta].filter(([, n]) => n > 1).map(([dueno]) => dueno))
  }, [matriz.buzones])
  const cabecera = useCallback(
    (b: BuzonDeLaMatriz) => {
      const rol = b.dueno.role === 'admin' ? 'administrador' : b.dueno.esComercial ? 'comercial' : 'equipo'
      return duenosConVarios.has(b.dueno.id)
        ? { principal: b.nombre?.trim() || b.direccion.split('@')[0], secundaria: `${primerNombre(b.dueno.nombre)} · ${rol}`, buzon: `el buzón ${b.direccion}` }
        : { principal: primerNombre(b.dueno.nombre), secundaria: rol, buzon: `el buzón de ${b.dueno.nombre}` }
    },
    [duenosConVarios]
  )

  if (matriz.buzones.length === 0) {
    return <p className="rounded-[8px] bg-[var(--ls-sup2)] px-3 py-4 text-center text-[12.5px] text-[var(--ls-t3)]">Todavía no hay ningún buzón conectado.</p>
  }
  if (matriz.filas.length === 0) {
    return <p className="rounded-[8px] bg-[var(--ls-sup2)] px-3 py-4 text-center text-[12.5px] text-[var(--ls-t3)]">No hay nadie más del equipo con la casilla «Correo». Dásela en Gestión de Usuarios a quien quieras que use o lea el correo.</p>
  }

  return (
    <>
      {!bloqueosDisponibles && (
        <p className="flex items-start gap-2 rounded-[8px] border border-l-2 border-[var(--ls-linea)] border-l-[var(--ls-e-ambar)] bg-[var(--ls-sup2)] px-3 py-2.5 text-[12.5px] text-[var(--ls-t2)]" role="status">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--ls-e-ambar)]" aria-hidden />
          <span>
            Para poder <b className="font-semibold">bloquear</b> buzones falta lanzar la migración <code className="text-[11.5px]">260_correo_buzones_bloqueados.sql</code> en el editor SQL de Supabase. Mientras tanto, abrir y cerrar buzones funciona como siempre.
          </span>
        </p>
      )}
      <div className="overflow-x-auto rounded-[10px] border border-[var(--ls-linea)]">
        <table className="w-full min-w-[640px] border-collapse text-[12.5px]">
          <thead>
            <tr className="bg-[var(--ls-sup2)] text-left align-bottom">
              <th scope="col" className="sticky left-0 z-10 min-w-[180px] bg-[var(--ls-sup2)] px-3 py-2 text-[10.5px] font-semibold uppercase tracking-[0.05em] text-[var(--ls-t3)]">
                Persona
              </th>
              {matriz.buzones.map((b) => {
                const c = cabecera(b)
                return (
                  <th key={b.id} scope="col" className="min-w-[84px] max-w-[128px] px-2 py-2 text-center font-normal">
                    <span className="block truncate text-[12px] font-semibold text-[var(--ls-t1)]" title={b.direccion}>
                      {c.principal}
                    </span>
                    <span className="block truncate text-[10.5px] text-[var(--ls-t4)]" title={b.direccion}>
                      {c.secundaria}
                    </span>
                  </th>
                )
              })}
              <th scope="col" className="w-[1%] whitespace-nowrap px-3 py-2 text-[10.5px] font-semibold uppercase tracking-[0.05em] text-[var(--ls-t3)]">
                Atajos
              </th>
            </tr>
          </thead>
          <tbody>
            {matriz.filas.map((f) => (
              <Fila key={f.persona.id} fila={f} buzones={matriz.buzones} comerciales={comerciales} bloqueos={bloqueos} puedeBloquear={bloqueosDisponibles} nombreDeBuzon={(b) => cabecera(b).buzon} guardando={guardando} cambiar={cambiar} />
            ))}
          </tbody>
        </table>
      </div>

      <ul aria-label="Qué significa cada casilla" className="flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-[var(--ls-t4)]">
        <li className="inline-flex items-center gap-1.5">
          <span className="inline-grid h-4 w-4 place-items-center rounded-[4px] border border-[var(--ls-acc-graf)] bg-[var(--ls-acc-relleno)] text-[var(--ls-acc-tinta)]">
            <Check className="h-3 w-3" strokeWidth={3} aria-hidden />
          </span>
          Abierto a mano
        </li>
        <li className="inline-flex items-center gap-1.5">
          <span className="inline-grid h-4 w-4 place-items-center rounded-[4px] border border-[var(--ls-linea2)] bg-[var(--ls-sup3)] text-[var(--ls-t3)]">
            <Eye className="h-3 w-3" aria-hidden />
          </span>
          Lo abre un permiso de supervisión{bloqueosDisponibles ? ' (púlsalo para bloquearlo)' : ''}
        </li>
        {(bloqueosDisponibles || datos.bloqueos.length > 0) && (
          <li className="inline-flex items-center gap-1.5">
            <span className="inline-grid h-4 w-4 place-items-center rounded-[4px] border border-[var(--ls-e-rojo)] bg-[color-mix(in_srgb,var(--ls-e-rojo)_12%,transparent)] text-[var(--ls-e-rojo)]">
              <Ban className="h-3 w-3" aria-hidden />
            </span>
            Bloqueado (no lo lee; púlsalo para quitar el bloqueo)
          </li>
        )}
      </ul>

      <section aria-label="Últimos cambios" className="space-y-1.5">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--ls-t3)]">Últimos cambios</h3>
        {recientes.length === 0 ? (
          <p className="text-[12px] text-[var(--ls-t4)]">Todavía no se ha abierto, cerrado ni bloqueado ningún buzón a mano.</p>
        ) : (
          <ul className="grid gap-1 text-[12px] text-[var(--ls-t3)]">
            {recientes.map((c, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-x-1.5">
                <span className={ETIQUETA_DE_ACCION[c.accion]?.clase ?? 'font-semibold text-[var(--ls-t2)]'}>{ETIQUETA_DE_ACCION[c.accion]?.texto ?? c.accion}</span>
                <span className="text-[var(--ls-t2)]">
                  {c.buzon} a {c.lector}
                </span>
                <span className="text-[var(--ls-t4)]">
                  · por {c.porQuien}, <span suppressHydrationWarning>{hace(c.cuando)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  )
}

const ATAJO = 'rounded-[6px] px-2 py-1 text-[11px] font-medium text-[var(--ls-t3)] transition-colors hover:bg-[var(--ls-sup3)] disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-[var(--ls-t3)]'

function Fila({
  fila,
  buzones,
  comerciales,
  bloqueos,
  puedeBloquear,
  nombreDeBuzon,
  guardando,
  cambiar,
}: {
  fila: FilaDeLaMatriz
  buzones: BuzonDeLaMatriz[]
  comerciales: BuzonDeLaMatriz[]
  bloqueos: ReadonlyMap<string, Bloqueo>
  puedeBloquear: boolean
  /** «el buzón de Ana» o, si su dueño tiene varios, «el buzón ventas@…» */
  nombreDeBuzon: (b: BuzonDeLaMatriz) => string
  guardando: ReadonlySet<string>
  cambiar: Cambiar
}) {
  const { persona, celdas } = fila
  const ocupada = buzones.some((b) => guardando.has(`${persona.id}|${b.id}`))

  // Los atajos: abrir los buzones de los comerciales que aún no lee, cerrar todo lo abierto a mano, bloquearle los de los administrativos que hoy lee o quitarle todos los bloqueos
  const porAbrir = comerciales.filter((b) => celdas[b.id]?.via === 'nada' && !celdas[b.id]?.bloqueado)
  const abiertosAMano = buzones.filter((b) => celdas[b.id]?.concedido)
  const porBloquear = puedeBloquear ? paraBloquear(fila, buzones, 'administrativos') : []
  const porDesbloquear = puedeBloquear ? paraDesbloquear(fila, buzones) : []

  return (
    <tr className="border-t border-[var(--ls-linea)] transition-colors hover:bg-[var(--ls-sup2)]">
      <th scope="row" className="sticky left-0 z-10 bg-[var(--ls-sup)] px-3 py-2 text-left font-normal">
        <span className="flex items-center gap-2">
          <Avatar id={persona.id} nombre={persona.nombre} tamano={24} />
          <span className="min-w-0">
            <span className="block truncate font-semibold text-[var(--ls-t1)]">{persona.nombre}</span>
            <span className="flex flex-wrap items-center gap-x-1.5 text-[10.5px] text-[var(--ls-t4)]">
              {persona.permisoEquipo && <span title="Tiene el permiso «Supervisión del equipo comercial»: lee los buzones de los comerciales">supervisa comerciales</span>}
              {persona.permisoCorreo && <span title="Tiene el permiso «Supervisión del correo»: lee los de todo el equipo menos los de los administradores">supervisa el correo</span>}
              {!persona.tieneCorreo && <span className="text-[var(--ls-e-ambar)]" title="Sin la casilla «Correo» no puede abrir la pantalla de Correo">sin la casilla Correo</span>}
              {fila.bloqueados > 0 && (
                <span className="text-[var(--ls-e-rojo)]" title="Buzones que se le han bloqueado: no los lee aunque su permiso se los abriera">
                  {fila.bloqueados === 1 ? '1 bloqueado' : `${fila.bloqueados} bloqueados`}
                </span>
              )}
            </span>
          </span>
        </span>
      </th>
      {buzones.map((b) => {
        const celda = celdas[b.id]
        const clave = `${persona.id}|${b.id}`
        if (celda.via === 'suyo') {
          return (
            <td key={b.id} className="px-2 py-2 text-center">
              <span className="text-[10.5px] text-[var(--ls-t4)]" title={ETIQUETA_DE_VIA.suyo}>
                suyo
              </span>
            </td>
          )
        }
        const modo: ModoDeCasilla = celda.bloqueado ? 'bloqueado' : celda.via === 'permiso' ? 'permiso' : celda.via === 'concedido' ? 'abierto' : 'nada'
        const bloqueo = bloqueos.get(clave)
        const titulo = {
          bloqueado: `Bloqueado${bloqueo?.por ? ` por ${bloqueo.por}` : ''}${bloqueo ? `, ${hace(bloqueo.desde)}` : ''}: ${persona.nombre} no lee este buzón${celda.via === 'permiso' ? ', aunque su permiso de supervisión se lo abriría' : celda.via === 'concedido' ? ', aunque está abierto a mano' : ''}. Púlsalo para quitar el bloqueo.`,
          permiso: `${ETIQUETA_DE_VIA.permiso}${celda.concedido ? ' (y además está abierto a mano)' : ''}.${puedeBloquear ? ' Púlsalo para bloquearle este buzón (conserva el permiso).' : ' Para quitárselo, quita el permiso en Gestión de Usuarios.'}`,
          abierto: `${ETIQUETA_DE_VIA.concedido}. Púlsalo para cerrarlo.`,
          nada: `${ETIQUETA_DE_VIA.nada}. Púlsalo para abrírselo.`,
        }[modo]
        const accion = { bloqueado: 'Quitar a', permiso: 'Bloquear a', abierto: 'Cerrar a', nada: 'Abrir a' }[modo]
        const cambio: CambioDeLector = { bloqueado: { buzonId: b.id, bloquear: false }, permiso: { buzonId: b.id, bloquear: true }, abierto: { buzonId: b.id, leer: false }, nada: { buzonId: b.id, leer: true } }[modo]
        return (
          <td key={b.id} className="px-2 py-2 text-center">
            <CasillaDeBuzon
              modo={modo}
              puedePulsar={modo !== 'permiso' || puedeBloquear}
              guardando={guardando.has(clave)}
              titulo={titulo}
              etiqueta={`${accion} ${persona.nombre}${modo === 'bloqueado' ? ` el bloqueo de ${nombreDeBuzon(b)}` : ` ${nombreDeBuzon(b)}`}`}
              alPulsar={() => void cambiar(persona.id, [cambio])}
            />
          </td>
        )
      })}
      <td className="whitespace-nowrap px-3 py-2 text-right">
        <span className="flex flex-col items-end gap-0.5">
          <span className="inline-flex items-center gap-1">
            {comerciales.length > 0 && (
              <button
                type="button"
                disabled={ocupada || porAbrir.length === 0}
                onClick={() => void cambiar(persona.id, porAbrir.map((b) => ({ buzonId: b.id, leer: true })), false)}
                className={`${ATAJO} hover:text-[var(--ls-acc)]`}
                title="Abrirle los buzones de todos los comerciales que aún no lee"
              >
                Comerciales
              </button>
            )}
            <button
              type="button"
              disabled={ocupada || abiertosAMano.length === 0}
              onClick={() => void cambiar(persona.id, abiertosAMano.map((b) => ({ buzonId: b.id, leer: false })), false)}
              className={`${ATAJO} hover:text-[var(--ls-e-ambar)]`}
              title="Cerrarle todo lo que se le ha abierto a mano (no quita lo que abre un permiso de supervisión)"
            >
              Quitar
            </button>
          </span>
          <span className="inline-flex items-center gap-1">
            <button
              type="button"
              disabled={ocupada || porBloquear.length === 0}
              onClick={() => void cambiar(persona.id, porBloquear.map((b) => ({ buzonId: b.id, bloquear: true })), false)}
              className={`${ATAJO} hover:text-[var(--ls-e-rojo)]`}
              title={
                puedeBloquear
                  ? 'Bloquearle los buzones de los administrativos (los de personas del equipo que no son comerciales ni administradores) que hoy lee. Conserva sus permisos'
                  : 'Falta lanzar la migración 260_correo_buzones_bloqueados.sql para poder bloquear'
              }
            >
              Bloquear administrativos
            </button>
            <button
              type="button"
              disabled={ocupada || porDesbloquear.length === 0}
              onClick={() => void cambiar(persona.id, porDesbloquear.map((b) => ({ buzonId: b.id, bloquear: false })), false)}
              className={`${ATAJO} hover:text-[var(--ls-acc)]`}
              title="Quitarle todos los bloqueos: vuelve a leer lo que sus permisos le abren"
            >
              Desbloquear
            </button>
          </span>
        </span>
      </td>
    </tr>
  )
}

type ModoDeCasilla = 'nada' | 'abierto' | 'permiso' | 'bloqueado'

function CasillaDeBuzon({ modo, puedePulsar, guardando, titulo, etiqueta, alPulsar }: { modo: ModoDeCasilla; puedePulsar: boolean; guardando: boolean; titulo: string; etiqueta: string; alPulsar: () => void }) {
  const marcada = modo === 'abierto' || modo === 'permiso'
  const aspecto =
    modo === 'bloqueado'
      ? 'border-[var(--ls-e-rojo)] bg-[color-mix(in_srgb,var(--ls-e-rojo)_12%,transparent)] text-[var(--ls-e-rojo)]'
      : modo === 'permiso'
        ? puedePulsar
          ? 'border-[var(--ls-linea2)] bg-[var(--ls-sup3)] text-[var(--ls-t3)] hover:border-[var(--ls-e-rojo)] hover:text-[var(--ls-e-rojo)]'
          : 'cursor-not-allowed border-[var(--ls-linea2)] bg-[var(--ls-sup3)] text-[var(--ls-t3)]'
        : modo === 'abierto'
          ? 'border-[var(--ls-acc-graf)] bg-[var(--ls-acc-relleno)] text-[var(--ls-acc-tinta)]'
          : 'border-[var(--ls-linea2)] bg-transparent text-transparent hover:border-[var(--ls-acc-graf)] hover:text-[var(--ls-t4)]'
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={marcada}
      aria-label={etiqueta}
      title={titulo}
      disabled={!puedePulsar || guardando}
      onClick={alPulsar}
      className={`inline-grid h-6 w-6 place-items-center rounded-[6px] border transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ls-acc-graf)] ${aspecto} ${guardando ? 'cursor-wait' : ''}`}
    >
      {guardando ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--ls-t3)]" aria-hidden />
      ) : modo === 'bloqueado' ? (
        <Ban className="h-3.5 w-3.5" aria-hidden />
      ) : modo === 'permiso' ? (
        <Eye className="h-3.5 w-3.5" aria-hidden />
      ) : (
        <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden />
      )}
    </button>
  )
}
