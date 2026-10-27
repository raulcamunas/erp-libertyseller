'use client'

import { formatDistanceToNow } from 'date-fns'
import { es } from 'date-fns/locale'
import { AlertCircle, Check, Eye, Loader2, ShieldCheck, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Avatar, Esqueleto } from '@/components/rendimiento/ui'
import type { BuzonDeLaMatriz, CeldaDeAcceso, DatosDeLaMatriz, FilaDeLaMatriz } from '@/lib/correo/lectores'
import { enviarJson, pedir } from './api'
import { BOTON_ICONO } from './ui'

/**
 * «QUIÉN VE QUÉ»: UN ADMINISTRADOR («MANAGER») DECIDE QUÉ BUZONES LEE CADA PERSONA DEL EQUIPO.
 *
 * Una tabla de personas por buzón. Cada casilla es «esta persona lee este buzón»: se marca para abrírselo y se desmarca para cerrarlo (un solo buzón, una sola persona; nada se abre
 * por sorpresa). Es solo LECTURA y cada vez que alguien mira un buzón que no es suyo queda anotado: abrirlo no deja escribir desde él.
 *
 * Lo que ya abre un permiso de supervisión (Gestión de Usuarios) sale marcado y bloqueado, con el permiso que lo abre: se quita allí, porque abre más cosas que el correo.
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
    async (lectorId: string, cambios: Array<{ buzonId: string; leer: boolean }>, quitaLasCasillas = true) => {
      const claves = cambios.map((c) => `${lectorId}|${c.buzonId}`)
      setGuardando((previas) => new Set([...previas, ...claves]))
      const r = await enviarJson<DatosDeLaMatriz & { concedidos: number; quitados: number; rechazados: Array<{ motivo: string }> }>('/api/correo/lectores', 'POST', { lectorId, cambios })
      setGuardando((previas) => {
        const n = new Set(previas)
        for (const c of claves) n.delete(c)
        return n
      })
      if (!r.ok) {
        toast.error(r.mensaje)
        return
      }
      setEstado({ tipo: 'listo', datos: { matriz: r.datos.matriz, concesiones: r.datos.concesiones, recientes: r.datos.recientes } })
      if (r.datos.rechazados.length > 0) toast.warning(r.datos.rechazados[0].motivo)
      else if (quitaLasCasillas) toast.success(r.datos.concedidos > 0 ? 'Buzón abierto.' : r.datos.quitados > 0 ? 'Buzón cerrado.' : 'Sin cambios.')
    },
    []
  )

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/55 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onCerrar()} onKeyDown={(e) => e.key === 'Escape' && onCerrar()}>
      <div role="dialog" aria-modal="true" aria-label="Quién ve qué correo" className="flex max-h-[94dvh] w-full max-w-[980px] flex-col overflow-hidden rounded-t-[12px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] shadow-2xl shadow-black/50 sm:rounded-[12px]">
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

type Cambiar = (lectorId: string, cambios: Array<{ buzonId: string; leer: boolean }>, avisar?: boolean) => Promise<void>

const ETIQUETA_DE_VIA: Record<CeldaDeAcceso['via'], string> = {
  suyo: 'Es su buzón',
  permiso: 'Lo abre un permiso de supervisión',
  concedido: 'Abierto a mano',
  nada: 'No lo ve',
}

function Matriz({ datos, guardando, cambiar }: { datos: DatosDeLaMatriz; guardando: ReadonlySet<string>; cambiar: Cambiar }) {
  const { matriz, recientes } = datos
  const comerciales = useMemo(() => matriz.buzones.filter((b) => b.dueno.esComercial === true), [matriz.buzones])

  if (matriz.buzones.length === 0) {
    return <p className="rounded-[8px] bg-[var(--ls-sup2)] px-3 py-4 text-center text-[12.5px] text-[var(--ls-t3)]">Todavía no hay ningún buzón conectado.</p>
  }
  if (matriz.filas.length === 0) {
    return <p className="rounded-[8px] bg-[var(--ls-sup2)] px-3 py-4 text-center text-[12.5px] text-[var(--ls-t3)]">No hay nadie más del equipo con la casilla «Correo». Dásela en Gestión de Usuarios a quien quieras que use o lea el correo.</p>
  }

  return (
    <>
      <div className="overflow-x-auto rounded-[10px] border border-[var(--ls-linea)]">
        <table className="w-full min-w-[640px] border-collapse text-[12.5px]">
          <thead>
            <tr className="bg-[var(--ls-sup2)] text-left align-bottom">
              <th scope="col" className="sticky left-0 z-10 min-w-[180px] bg-[var(--ls-sup2)] px-3 py-2 text-[10.5px] font-semibold uppercase tracking-[0.05em] text-[var(--ls-t3)]">
                Persona
              </th>
              {matriz.buzones.map((b) => (
                <th key={b.id} scope="col" className="min-w-[96px] px-2 py-2 text-center font-normal">
                  <span className="block truncate text-[12px] font-semibold text-[var(--ls-t1)]" title={b.direccion}>
                    {primerNombre(b.dueno.nombre)}
                  </span>
                  <span className="block truncate text-[10.5px] text-[var(--ls-t4)]" title={b.direccion}>
                    {b.dueno.role === 'admin' ? 'administrador' : b.dueno.esComercial ? 'comercial' : 'equipo'}
                  </span>
                </th>
              ))}
              <th scope="col" className="w-[1%] whitespace-nowrap px-3 py-2 text-[10.5px] font-semibold uppercase tracking-[0.05em] text-[var(--ls-t3)]">
                Atajos
              </th>
            </tr>
          </thead>
          <tbody>
            {matriz.filas.map((f) => (
              <Fila key={f.persona.id} fila={f} buzones={matriz.buzones} comerciales={comerciales} guardando={guardando} cambiar={cambiar} />
            ))}
          </tbody>
        </table>
      </div>

      <section aria-label="Últimos cambios" className="space-y-1.5">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--ls-t3)]">Últimos cambios</h3>
        {recientes.length === 0 ? (
          <p className="text-[12px] text-[var(--ls-t4)]">Todavía no se ha abierto ni cerrado ningún buzón a mano.</p>
        ) : (
          <ul className="grid gap-1 text-[12px] text-[var(--ls-t3)]">
            {recientes.map((c, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-x-1.5">
                <span className={c.accion === 'concedido' ? 'font-semibold text-[var(--ls-e-verde)]' : 'font-semibold text-[var(--ls-e-ambar)]'}>{c.accion === 'concedido' ? 'Abierto' : 'Cerrado'}</span>
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

function Fila({ fila, buzones, comerciales, guardando, cambiar }: { fila: FilaDeLaMatriz; buzones: BuzonDeLaMatriz[]; comerciales: BuzonDeLaMatriz[]; guardando: ReadonlySet<string>; cambiar: Cambiar }) {
  const { persona, celdas } = fila
  const ocupada = buzones.some((b) => guardando.has(`${persona.id}|${b.id}`))

  // Los atajos: abrir los buzones de los comerciales que aún no lee, o cerrar todo lo abierto a mano
  const porAbrir = comerciales.filter((b) => celdas[b.id]?.via === 'nada')
  const abiertosAMano = buzones.filter((b) => celdas[b.id]?.concedido)

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
            </span>
          </span>
        </span>
      </th>
      {buzones.map((b) => {
        const celda = celdas[b.id]
        const clave = `${persona.id}|${b.id}`
        return (
          <td key={b.id} className="px-2 py-2 text-center">
            {celda.via === 'suyo' ? (
              <span className="text-[10.5px] text-[var(--ls-t4)]" title={ETIQUETA_DE_VIA.suyo}>
                suyo
              </span>
            ) : (
              <CasillaDeBuzon
                marcada={celda.via !== 'nada'}
                bloqueada={celda.via === 'permiso'}
                guardando={guardando.has(clave)}
                titulo={celda.via === 'permiso' ? `${ETIQUETA_DE_VIA.permiso}${celda.concedido ? ' (y además está abierto a mano)' : ''}` : ETIQUETA_DE_VIA[celda.via]}
                etiqueta={`${celda.via === 'nada' ? 'Abrir' : 'Cerrar'} a ${persona.nombre} el buzón de ${b.dueno.nombre}`}
                alPulsar={() => void cambiar(persona.id, [{ buzonId: b.id, leer: celda.via === 'nada' }])}
              />
            )}
          </td>
        )
      })}
      <td className="whitespace-nowrap px-3 py-2 text-right">
        <span className="inline-flex items-center gap-1">
          {comerciales.length > 0 && (
            <button
              type="button"
              disabled={ocupada || porAbrir.length === 0}
              onClick={() => void cambiar(persona.id, porAbrir.map((b) => ({ buzonId: b.id, leer: true })), false)}
              className="rounded-[6px] px-2 py-1 text-[11px] font-medium text-[var(--ls-t3)] transition-colors hover:bg-[var(--ls-sup3)] hover:text-[var(--ls-acc)] disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-[var(--ls-t3)]"
              title="Abrirle los buzones de todos los comerciales que aún no lee"
            >
              Comerciales
            </button>
          )}
          <button
            type="button"
            disabled={ocupada || abiertosAMano.length === 0}
            onClick={() => void cambiar(persona.id, abiertosAMano.map((b) => ({ buzonId: b.id, leer: false })), false)}
            className="rounded-[6px] px-2 py-1 text-[11px] font-medium text-[var(--ls-t3)] transition-colors hover:bg-[var(--ls-sup3)] hover:text-[var(--ls-e-ambar)] disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-[var(--ls-t3)]"
            title="Cerrarle todo lo que se le ha abierto a mano (no quita lo que abre un permiso de supervisión)"
          >
            Quitar
          </button>
        </span>
      </td>
    </tr>
  )
}

function CasillaDeBuzon({ marcada, bloqueada, guardando, titulo, etiqueta, alPulsar }: { marcada: boolean; bloqueada: boolean; guardando: boolean; titulo: string; etiqueta: string; alPulsar: () => void }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={marcada}
      aria-label={etiqueta}
      title={titulo}
      disabled={bloqueada || guardando}
      onClick={alPulsar}
      className={`inline-grid h-6 w-6 place-items-center rounded-[6px] border transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ls-acc-graf)] ${
        marcada
          ? bloqueada
            ? 'cursor-not-allowed border-[var(--ls-linea2)] bg-[var(--ls-sup3)] text-[var(--ls-t3)]'
            : 'border-[var(--ls-acc-graf)] bg-[var(--ls-acc-relleno)] text-[var(--ls-acc-tinta)]'
          : 'border-[var(--ls-linea2)] bg-transparent text-transparent hover:border-[var(--ls-acc-graf)] hover:text-[var(--ls-t4)]'
      } ${guardando ? 'cursor-wait' : ''}`}
    >
      {guardando ? <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--ls-t3)]" aria-hidden /> : bloqueada ? <Eye className="h-3.5 w-3.5" aria-hidden /> : <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden />}
    </button>
  )
}
