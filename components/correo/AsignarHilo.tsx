'use client'

import { Check, Eye, PenLine, Search, UserMinus, UserPlus } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Avatar, Boton, Esqueleto, EstadoVacio, Insignia, PanelLateral, TACTIL } from '@/components/ui-ls'
import { cn } from '@/lib/utils'
import { enviarJson, pedir } from './api'
import type { PropsDeAsignarHilo } from './contratos'
import { CAMPO } from './ui'

/**
 * «ENCÁRGATE TÚ»: ELEGIR QUIÉN LLEVA UNA CONVERSACIÓN.
 *
 * Al abrirse pide GET /api/correo/hilos/[id]/encargables: las personas que ya LEEN el buzón (a quien no es administrador, solo el dueño y las
 * personas con el buzón asignado, sin decir por qué lo leen). Cada una dice si además puede responder. «Yo» sale arriba.
 *
 * Guardar hace PATCH /api/correo/hilos/[id] con { asignar: { personaId, nota } } (nota opcional, 280 caracteres como mucho); «Quitar encargo»
 * manda personaId null. La persona recibe un aviso en la campana (salvo si se lo asigna a sí misma: lo decide el servidor).
 * Sin la migración 318 la ruta contesta 503 y aquí sale la banda de siempre.
 */

export interface Encargable {
  id: string
  nombre: string
  puedeResponder: boolean
}

export const NOTA_MAXIMA = 280

/** «Yo» primero y el resto por nombre (como llegan del servidor). PURO (en hilo.prueba.ts) */
export function ordenarEncargables(lista: readonly Encargable[], yoId: string): Encargable[] {
  const yo = lista.filter((p) => p.id === yoId)
  const resto = lista.filter((p) => p.id !== yoId).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
  return [...yo, ...resto]
}

/** Filtra por nombre sin mirar tildes ni mayúsculas. PURO */
export function filtrarEncargables(lista: readonly Encargable[], busqueda: string): Encargable[] {
  const limpia = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
  const q = limpia(busqueda)
  return q ? lista.filter((p) => limpia(p.nombre).includes(q)) : [...lista]
}

const SIN_LA_318 = 'Falta lanzar la migración 318 para elegir, asignar y silenciar correos.'

export function AsignarHilo({ abierto, onCambio, hiloId, buzonId, actual, yoId, onAsignado }: PropsDeAsignarHilo) {
  const [personas, setPersonas] = useState<Encargable[] | null>(null)
  const [errorCarga, setErrorCarga] = useState<string | null>(null)
  const [elegida, setElegida] = useState<string | null>(actual?.personaId ?? null)
  const [nota, setNota] = useState('')
  const [busqueda, setBusqueda] = useState('')
  const [guardando, setGuardando] = useState<'asignar' | 'quitar' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [faltaMigracion, setFaltaMigracion] = useState(false)

  // Cada vez que se abre: la lista de nuevo (quién lee el buzón cambia) y lo elegido, el de ahora
  useEffect(() => {
    if (!abierto) return
    let vigente = true
    setPersonas(null)
    setErrorCarga(null)
    setError(null)
    setFaltaMigracion(false)
    setBusqueda('')
    setNota('')
    setElegida(actual?.personaId ?? null)
    void pedir<Encargable[]>(`/api/correo/hilos/${encodeURIComponent(hiloId)}/encargables`).then((r) => {
      if (!vigente) return
      if (!r.ok) return setErrorCarga(r.mensaje)
      setPersonas(Array.isArray(r.datos) ? r.datos : [])
    })
    return () => {
      vigente = false
    }
    // actual: se lee al abrir; si cambia con el panel abierto no se pisa lo que se está eligiendo
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto, hiloId, buzonId])

  const ordenadas = useMemo(() => (personas ? ordenarEncargables(personas, yoId) : []), [personas, yoId])
  const visibles = useMemo(() => filtrarEncargables(ordenadas, busqueda), [ordenadas, busqueda])
  const elegidaPersona = ordenadas.find((p) => p.id === elegida) ?? null
  const notaLarga = nota.length > NOTA_MAXIMA
  const sinCambios = !elegida || (elegida === actual?.personaId && !nota.trim())

  async function guardar(personaId: string | null) {
    if (guardando) return
    if (personaId && notaLarga) return setError(`La nota no puede pasar de ${NOTA_MAXIMA} caracteres.`)
    setGuardando(personaId ? 'asignar' : 'quitar')
    setError(null)
    const notaLimpia = nota.trim() || undefined
    const r = await enviarJson<{ ok: boolean; asignacion?: { personaId: string; nombre: string; nota: string | null } | null }>(
      `/api/correo/hilos/${encodeURIComponent(hiloId)}`,
      'PATCH',
      { asignar: { personaId, ...(personaId && notaLimpia ? { nota: notaLimpia } : {}) } },
    )
    setGuardando(null)
    if (!r.ok) {
      if (r.estado === 503) setFaltaMigracion(true)
      return setError(r.estado === 503 ? SIN_LA_318 : r.mensaje)
    }
    if (personaId) {
      const nombre = r.datos.asignacion?.nombre ?? ordenadas.find((p) => p.id === personaId)?.nombre ?? 'Alguien'
      onAsignado({ personaId, nombre, nota: r.datos.asignacion?.nota ?? notaLimpia ?? null })
    } else {
      onAsignado(null)
    }
    onCambio(false)
  }

  const textoDelBoton = !elegidaPersona ? 'Encargar' : elegidaPersona.id === yoId ? 'Me lo quedo' : `Encargar a ${elegidaPersona.nombre.split(' ')[0]}`

  return (
    <PanelLateral
      abierto={abierto}
      onCambio={onCambio}
      titulo="¿Quién lleva esta conversación?"
      descripcion="Solo salen las personas que ya leen este buzón. Le llegará un aviso a su campana."
      icono={UserPlus}
      acento="marca"
      ancho={440}
      pie={
        <>
          {actual && (
            <Boton variante="fantasma" icono={UserMinus} onClick={() => void guardar(null)} cargando={guardando === 'quitar'} disabled={!!guardando || faltaMigracion} className="mr-auto">
              Quitar encargo
            </Boton>
          )}
          <Boton onClick={() => onCambio(false)} disabled={!!guardando}>
            Cancelar
          </Boton>
          <Boton variante="primario" icono={Check} onClick={() => elegida && void guardar(elegida)} cargando={guardando === 'asignar'} disabled={sinCambios || notaLarga || !!guardando || faltaMigracion}>
            {textoDelBoton}
          </Boton>
        </>
      }
    >
      {faltaMigracion && (
        <p className="mb-3 rounded-[10px] border border-[color-mix(in_srgb,var(--ls-e-ambar)_40%,transparent)] bg-[color-mix(in_srgb,var(--ls-e-ambar)_10%,transparent)] px-3 py-2 text-[12.5px] text-[var(--ls-e-ambar)]" role="status">
          {SIN_LA_318}
        </p>
      )}

      {errorCarga ? (
        <EstadoVacio compacto titulo="No se ha podido cargar quién lee este buzón" descripcion={errorCarga} acento="marca" />
      ) : personas === null ? (
        <div role="status" aria-label="Cargando personas" className="space-y-1.5">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="flex items-center gap-3 rounded-[10px] px-2 py-2">
              <Esqueleto redondo className="h-8 w-8" />
              <Esqueleto className={cn('h-[11px]', i % 2 ? 'w-1/3' : 'w-1/2')} />
            </div>
          ))}
        </div>
      ) : ordenadas.length === 0 ? (
        <EstadoVacio compacto titulo="Nadie más lee este buzón" descripcion="Un administrador puede asignarlo a alguien desde «Equipo y permisos»." acento="marca" />
      ) : (
        <>
          {ordenadas.length > 7 && (
            <label className="relative mb-2 block">
              <span className="sr-only">Buscar persona</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ls-t4)]" aria-hidden />
              <input type="search" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar persona…" className={cn(CAMPO, 'pl-9')} />
            </label>
          )}

          <div role="radiogroup" aria-label="Persona encargada" className="space-y-1">
            {visibles.map((p) => {
              const activa = p.id === elegida
              const esYo = p.id === yoId
              return (
                <button
                  key={p.id}
                  type="button"
                  role="radio"
                  aria-checked={activa}
                  onClick={() => setElegida(p.id)}
                  className={cn(
                    'flex min-h-11 w-full items-center gap-3 rounded-[10px] border px-2.5 py-1.5 text-left transition-colors lg:min-h-10',
                    'outline-none focus-visible:ring-2 focus-visible:ring-[var(--ls-acc-graf)]',
                    activa ? 'border-[var(--ls-acc-borde)] bg-[var(--ls-acc-suave)]' : 'border-transparent hover:bg-[var(--ls-sup2)]',
                    TACTIL,
                  )}
                >
                  <Avatar nombre={p.nombre} tamano={30} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-medium text-[var(--ls-t1)] lg:text-[13.5px]">
                      {esYo ? 'Yo' : p.nombre}
                      {esYo && <span className="ml-1.5 text-[12px] font-normal text-[var(--ls-t4)]">({p.nombre})</span>}
                    </span>
                    {actual?.personaId === p.id && <span className="block text-[11.5px] text-[var(--ls-t3)]">La lleva ahora</span>}
                  </span>
                  {p.puedeResponder ? (
                    <Insignia tono="verde" icono={PenLine} tamano="sm" title="Puede contestar desde este buzón">
                      responde
                    </Insignia>
                  ) : (
                    <Insignia tono="gris" icono={Eye} tamano="sm" title="Lo lee, pero no puede contestar desde este buzón">
                      solo lee
                    </Insignia>
                  )}
                  <span
                    aria-hidden
                    className={cn(
                      'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border',
                      activa ? 'border-[var(--ls-acc-borde)] bg-[var(--ls-acc-relleno)] text-[var(--ls-acc-tinta)]' : 'border-[var(--ls-linea2)]',
                    )}
                  >
                    {activa && <Check className="h-3 w-3" />}
                  </span>
                </button>
              )
            })}
            {visibles.length === 0 && <p className="px-2 py-4 text-center text-[13px] text-[var(--ls-t3)]">Nadie con «{busqueda}».</p>}
          </div>

          {elegidaPersona && !elegidaPersona.puedeResponder && (
            <p className="mt-2 rounded-[10px] bg-[var(--ls-sup2)] px-3 py-2 text-[12px] text-[var(--ls-t3)]">
              {elegidaPersona.id === yoId ? 'Tú' : elegidaPersona.nombre} puede leerla, pero no contestar desde este buzón: tendrá que pedir que le respondan.
            </p>
          )}

          <label className="mt-4 block">
            <span className="mb-1 flex items-baseline justify-between text-[12px] font-medium text-[var(--ls-t2)]">
              Nota (opcional)
              <span className={cn('tabular-nums', notaLarga ? 'text-[var(--ls-e-rojo)]' : 'text-[var(--ls-t4)]')} aria-live="polite">
                {nota.length}/{NOTA_MAXIMA}
              </span>
            </span>
            <textarea
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              rows={3}
              maxLength={NOTA_MAXIMA + 40}
              placeholder="Por ejemplo: «Llámale antes de contestar»"
              className={cn(CAMPO, 'h-auto min-h-[84px] resize-y py-2 leading-snug lg:h-auto')}
              aria-invalid={notaLarga || undefined}
            />
          </label>
        </>
      )}

      {error && !faltaMigracion && (
        <p className="mt-3 text-[12.5px] text-[var(--ls-e-rojo)]" role="alert">
          {error}
        </p>
      )}
    </PanelLateral>
  )
}
