'use client'

import { AlertTriangle, Loader2 } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { AlcanceDeAsignar, PersonaDelEquipo, ResumenDeLista } from '@/lib/cold-calling/listas'
import { fraseDeMover, leadsTexto } from '@/lib/cold-calling/listas-vista'
import { AVISO, BOTON, CAMPO, COLOR_ESTADO } from '@/lib/estilo/denso'
import { Selector, numero, type OpcionDeSelector } from './atomos'

/**
 * LAS VENTANAS DE LA PANTALLA DE LISTAS: crear y renombrar una lista, asignarla a una persona, mover o asignar unos leads y confirmar.
 *
 * Todas siguen el mismo patrón: la ventana no hace nada por sí misma, llama a `onGuardar`/`onConfirmar`, que devuelve `null` si fue bien (y la ventana se cierra) o la frase
 * del error (que se enseña dentro de la ventana, sin cerrarla, para poder corregir y reintentar). Mientras se guarda, los botones se apagan.
 */

/* ------------------------------------------------------------------ */
/* La ventana                                                          */
/* ------------------------------------------------------------------ */

function Ventana({ abierto, onCerrar, titulo, descripcion, children, ancho = 'max-w-md' }: { abierto: boolean; onCerrar: () => void; titulo: string; descripcion?: string; children: ReactNode; ancho?: string }) {
  return (
    <Dialog open={abierto} onOpenChange={(v) => !v && onCerrar()}>
      <DialogContent className={`max-h-[88vh] ${ancho} gap-3 overflow-y-auto rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] p-4 text-[var(--ls-t2)] sm:rounded-[10px]`}>
        <DialogHeader className="pr-6">
          <DialogTitle className="text-[15px] font-semibold tracking-[-0.012em] text-[var(--ls-t1)]">{titulo}</DialogTitle>
          {descripcion && <DialogDescription className="text-[11.5px] leading-[1.5] text-[var(--ls-t3)]">{descripcion}</DialogDescription>}
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  )
}

function AvisoDeError({ texto }: { texto: string }) {
  return (
    <div className={`${AVISO.base} ${AVISO.conTono}`} style={{ borderLeftColor: COLOR_ESTADO.rojo }} role="alert">
      <AlertTriangle className={`${AVISO.icono} text-[var(--ls-e-rojo)]`} aria-hidden />
      <p>{texto}</p>
    </div>
  )
}

function Pie({ onCerrar, guardando, textoDelBoton, desactivado }: { onCerrar: () => void; guardando: boolean; textoDelBoton: string; desactivado?: boolean }) {
  return (
    <div className="mt-1 flex items-center justify-end gap-2">
      <button type="button" onClick={onCerrar} disabled={guardando} className={`${BOTON.base} ${BOTON.secundario} ${BOTON.alto}`}>
        Cancelar
      </button>
      <button type="submit" disabled={guardando || desactivado} className={`${BOTON.base} ${BOTON.primario} ${BOTON.alto}`}>
        {guardando && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
        {textoDelBoton}
      </button>
    </div>
  )
}

/** Lo que tienen en común: guardar mientras se enseña «guardando», cerrar si fue bien, y enseñar el error si no */
function usarEnvio(onCerrar: () => void) {
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function enviar(e: FormEvent, accion: () => Promise<string | null>) {
    e.preventDefault()
    if (guardando) return
    setGuardando(true)
    setError(null)
    const fallo = await accion()
    setGuardando(false)
    if (fallo) setError(fallo)
    else onCerrar()
  }
  return { guardando, error, setError, enviar }
}

/** Las personas a las que se puede asignar algo, como opciones de un desplegable. Quien no puede entrar en Cold Calling lo dice en su nombre */
export function opcionesDePersonas(equipo: readonly PersonaDelEquipo[]): OpcionDeSelector[] {
  return equipo.map((p) => ({ valor: p.id, etiqueta: p.coldCalling ? p.nombre : `${p.nombre} (sin acceso a Cold Calling)` }))
}

const Etiqueta = ({ children, para }: { children: ReactNode; para?: string }) => (
  <label htmlFor={para} className={CAMPO.etiqueta}>
    {children}
  </label>
)

/* ------------------------------------------------------------------ */
/* Crear y renombrar una lista                                         */
/* ------------------------------------------------------------------ */

export function DialogoDeLista({
  abierto,
  onCerrar,
  modo,
  lista,
  equipo,
  onGuardar,
}: {
  abierto: boolean
  onCerrar: () => void
  modo: 'crear' | 'renombrar'
  lista?: ResumenDeLista | null
  equipo: readonly PersonaDelEquipo[]
  onGuardar: (d: { nombre: string; descripcion: string; responsable: string | null }) => Promise<string | null>
}) {
  const [nombre, setNombre] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [responsable, setResponsable] = useState('')
  const { guardando, error, setError, enviar } = usarEnvio(onCerrar)

  useEffect(() => {
    if (!abierto) return
    setNombre(modo === 'renombrar' ? (lista?.nombre ?? '') : '')
    setDescripcion('')
    setResponsable('')
    setError(null)
    // Solo al abrir: lo que se escribe después no se pisa
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto])

  const limpio = nombre.replace(/\s+/g, ' ').trim()
  const invalido = limpio === '' || limpio.length > 80 || (modo === 'renombrar' && limpio === lista?.nombre)

  return (
    <Ventana
      abierto={abierto}
      onCerrar={onCerrar}
      titulo={modo === 'crear' ? 'Nueva lista' : 'Renombrar la lista'}
      descripcion={
        modo === 'crear'
          ? 'Una lista agrupa leads. Se crea vacía; después se le añaden leads del banco o se mueven desde otras listas.'
          : `Cambia el nombre de «${lista?.nombre ?? ''}» y el de sus ${leadsTexto(lista?.total ?? 0)}. No se pierde nada.`
      }
    >
      <form onSubmit={(e) => enviar(e, () => onGuardar({ nombre: limpio, descripcion: descripcion.trim(), responsable: responsable || null }))} className="space-y-3">
        <div className={CAMPO.contenedor}>
          <Etiqueta para="lista-nombre">Nombre</Etiqueta>
          <input id="lista-nombre" autoFocus value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={80} placeholder="José V3" className={CAMPO.input} />
          <p className={CAMPO.nota}>Dos listas no pueden llamarse igual (sin mirar mayúsculas).</p>
        </div>
        {modo === 'crear' && (
          <>
            <div className={CAMPO.contenedor}>
              <Etiqueta para="lista-descripcion">Descripción (opcional)</Etiqueta>
              <input id="lista-descripcion" value={descripcion} onChange={(e) => setDescripcion(e.target.value)} maxLength={300} placeholder="Para qué es esta lista" className={CAMPO.input} />
            </div>
            <div className={CAMPO.contenedor}>
              <Etiqueta>Responsable (opcional)</Etiqueta>
              <Selector
                valor={responsable}
                onCambiar={setResponsable}
                rotulo="Responsable de la lista"
                ancho="w-full"
                opciones={[{ valor: '', etiqueta: 'Nadie por ahora' }, ...opcionesDePersonas(equipo)]}
              />
              <p className={CAMPO.nota}>El responsable es a quien está asignada la lista. Los leads que se añadan del banco pueden ser suyos directamente.</p>
            </div>
          </>
        )}
        {error && <AvisoDeError texto={error} />}
        <Pie onCerrar={onCerrar} guardando={guardando} desactivado={invalido} textoDelBoton={modo === 'crear' ? 'Crear lista' : 'Guardar nombre'} />
      </form>
    </Ventana>
  )
}

/* ------------------------------------------------------------------ */
/* Asignar una lista a una persona                                     */
/* ------------------------------------------------------------------ */

export function DialogoAsignarLista({
  abierto,
  onCerrar,
  lista,
  equipo,
  onAsignar,
}: {
  abierto: boolean
  onCerrar: () => void
  lista: ResumenDeLista | null
  equipo: readonly PersonaDelEquipo[]
  onAsignar: (dueno: string | null, alcance: AlcanceDeAsignar) => Promise<string | null>
}) {
  const [persona, setPersona] = useState('')
  const [alcance, setAlcance] = useState<AlcanceDeAsignar>('ninguno')
  const { guardando, error, setError, enviar } = usarEnvio(onCerrar)

  useEffect(() => {
    if (!abierto) return
    setPersona(lista?.responsable ?? '')
    setAlcance('ninguno')
    setError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto, lista?.id])

  const sinDueno = lista?.duenos.find((d) => d.id === null)?.n ?? 0
  const pendientes = lista?.estados.pendiente ?? 0
  const total = lista?.total ?? 0
  const elegida = equipo.find((p) => p.id === persona)
  const opciones: Array<{ valor: AlcanceDeAsignar; texto: string; n: number; cuidado?: boolean }> = [
    { valor: 'ninguno', texto: 'Solo apuntarla como suya. Los leads que se añadan después serán de esta persona; los que ya hay no se tocan.', n: 0 },
    { valor: 'sin_dueno', texto: 'Y pasarle los leads de la lista que no tienen dueño.', n: sinDueno },
    { valor: 'pendientes', texto: 'Y pasarle los que todavía no se han tocado («Sin contactar»), sean de quien sean.', n: pendientes },
    { valor: 'todos', texto: 'Y pasarle TODOS los de la lista, también los que ya está trabajando otra persona.', n: total, cuidado: true },
  ]
  const alcanceEfectivo = persona === '' ? 'ninguno' : alcance

  return (
    <Ventana abierto={abierto} onCerrar={onCerrar} titulo={`Asignar «${lista?.nombre ?? ''}»`} descripcion="Elige a quién se asigna la lista y si se le pasan también los leads que ya tiene.">
      <form onSubmit={(e) => enviar(e, () => onAsignar(persona || null, alcanceEfectivo))} className="space-y-3">
        <div className={CAMPO.contenedor}>
          <Etiqueta>Persona</Etiqueta>
          <Selector valor={persona} onCambiar={setPersona} rotulo="Persona a la que se asigna" ancho="w-full" opciones={[{ valor: '', etiqueta: 'Nadie (quitar el responsable)' }, ...opcionesDePersonas(equipo)]} />
        </div>

        {persona !== '' && (
          <fieldset className="space-y-1.5">
            <legend className={CAMPO.etiqueta}>Qué leads se le pasan</legend>
            {opciones.map((o) => (
              <label key={o.valor} className={`flex cursor-pointer items-start gap-2 rounded-[6px] border px-2 py-1.5 text-[12px] ${alcance === o.valor ? 'border-[var(--ls-acc-graf)] bg-[var(--ls-acc-suave)] text-[var(--ls-t1)]' : 'border-[var(--ls-linea)] text-[var(--ls-t2)] hover:bg-[var(--ls-sup2)]'}`}>
                <input type="radio" name="alcance" checked={alcance === o.valor} onChange={() => setAlcance(o.valor)} className="mt-[3px] accent-[var(--ls-acc-relleno)]" />
                <span className="flex-1">
                  {o.texto}
                  {o.valor !== 'ninguno' && (
                    <span className={`ml-1.5 whitespace-nowrap tabular-nums ${o.cuidado ? 'text-[var(--ls-e-ambar)]' : 'text-[var(--ls-t4)]'}`}>
                      ({o.n === 0 ? 'ninguno' : leadsTexto(o.n)})
                    </span>
                  )}
                </span>
              </label>
            ))}
          </fieldset>
        )}

        {elegida && !elegida.coldCalling && (
          <div className={`${AVISO.base} ${AVISO.conTono}`} style={{ borderLeftColor: COLOR_ESTADO.ambar }}>
            <AlertTriangle className={`${AVISO.icono} text-[var(--ls-e-ambar)]`} aria-hidden />
            <p>
              <span className={AVISO.fuerte}>{elegida.nombre} no tiene acceso a Cold Calling.</span> No verá estos leads hasta que se le dé la casilla en Gestión de usuarios.
            </p>
          </div>
        )}
        {error && <AvisoDeError texto={error} />}
        <Pie onCerrar={onCerrar} guardando={guardando} textoDelBoton={persona === '' ? 'Quitar el responsable' : alcanceEfectivo === 'ninguno' ? 'Asignar la lista' : 'Asignar lista y leads'} />
      </form>
    </Ventana>
  )
}

/* ------------------------------------------------------------------ */
/* Mover o asignar unos leads                                          */
/* ------------------------------------------------------------------ */

type CambioDeLista = 'no' | 'mover' | 'sacar'
type CambioDeDueno = 'no' | 'asignar' | 'ninguno'

export function DialogoMover({
  abierto,
  onCerrar,
  cuantos,
  listas,
  equipo,
  nombres,
  onConfirmar,
}: {
  abierto: boolean
  onCerrar: () => void
  cuantos: number
  /** Las listas a las que se puede mover: registradas y sin archivar */
  listas: readonly ResumenDeLista[]
  equipo: readonly PersonaDelEquipo[]
  nombres: Record<string, string>
  onConfirmar: (cambios: { lista?: string | null; dueno?: string | null }) => Promise<string | null>
}) {
  const [cLista, setCLista] = useState<CambioDeLista>('no')
  const [lista, setLista] = useState('')
  const [cDueno, setCDueno] = useState<CambioDeDueno>('no')
  const [dueno, setDueno] = useState('')
  const { guardando, error, setError, enviar } = usarEnvio(onCerrar)

  useEffect(() => {
    if (!abierto) return
    setCLista('no')
    setLista('')
    setCDueno('no')
    setDueno('')
    setError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto])

  const opcionesDeLista = useMemo<OpcionDeSelector[]>(() => [{ valor: '', etiqueta: 'Elige una lista…' }, ...listas.map((l) => ({ valor: l.nombre, etiqueta: l.nombre }))], [listas])
  const cambiaLista = cLista !== 'no'
  const cambiaDueno = cDueno !== 'no'
  const falta = (cLista === 'mover' && lista === '') || (cDueno === 'asignar' && dueno === '')
  const nombreDe = (id: string) => nombres[id] ?? 'esa persona'
  const frase = fraseDeMover({ n: cuantos, cambiaLista, lista: cLista === 'mover' ? lista : null, cambiaDueno, dueno: cDueno === 'asignar' ? dueno : null, nombreDe })
  const personaElegida = cDueno === 'asignar' ? equipo.find((p) => p.id === dueno) : undefined

  const radio = (name: string, valor: string, actual: string, onCambiar: () => void, texto: ReactNode) => (
    <label className="flex cursor-pointer items-center gap-2 text-[12px] text-[var(--ls-t2)]">
      <input type="radio" name={name} checked={actual === valor} onChange={onCambiar} className="accent-[var(--ls-acc-relleno)]" />
      {texto}
    </label>
  )

  return (
    <Ventana abierto={abierto} onCerrar={onCerrar} titulo={`Mover o asignar ${leadsTexto(cuantos)}`} descripcion="Cambia la lista, el dueño o las dos cosas. Queda apuntado en el historial y se puede deshacer.">
      <form
        onSubmit={(e) =>
          enviar(e, () => {
            const cambios: { lista?: string | null; dueno?: string | null } = {}
            if (cLista === 'mover') cambios.lista = lista
            else if (cLista === 'sacar') cambios.lista = null
            if (cDueno === 'asignar') cambios.dueno = dueno
            else if (cDueno === 'ninguno') cambios.dueno = null
            return onConfirmar(cambios)
          })
        }
        className="space-y-3"
      >
        <fieldset className="space-y-1.5 rounded-[6px] border border-[var(--ls-linea)] p-2.5">
          <legend className="px-1 text-[11px] font-semibold text-[var(--ls-t4)]">Lista</legend>
          {radio('cambio-lista', 'no', cLista, () => setCLista('no'), 'No cambiar la lista')}
          {radio(
            'cambio-lista',
            'mover',
            cLista,
            () => setCLista('mover'),
            <span className="flex flex-1 items-center gap-2">
              Mover a
              <Selector valor={lista} onCambiar={(v) => { setLista(v); setCLista('mover') }} rotulo="Lista de destino" ancho="w-[230px]" opciones={opcionesDeLista} />
            </span>
          )}
          {radio('cambio-lista', 'sacar', cLista, () => setCLista('sacar'), 'Sacarlos de toda lista')}
        </fieldset>

        <fieldset className="space-y-1.5 rounded-[6px] border border-[var(--ls-linea)] p-2.5">
          <legend className="px-1 text-[11px] font-semibold text-[var(--ls-t4)]">Dueño</legend>
          {radio('cambio-dueno', 'no', cDueno, () => setCDueno('no'), 'No cambiar el dueño')}
          {radio(
            'cambio-dueno',
            'asignar',
            cDueno,
            () => setCDueno('asignar'),
            <span className="flex flex-1 items-center gap-2">
              Asignar a
              <Selector
                valor={dueno}
                onCambiar={(v) => { setDueno(v); setCDueno('asignar') }}
                rotulo="Persona a la que se asignan"
                ancho="w-[230px]"
                opciones={[{ valor: '', etiqueta: 'Elige una persona…' }, ...opcionesDePersonas(equipo)]}
              />
            </span>
          )}
          {radio('cambio-dueno', 'ninguno', cDueno, () => setCDueno('ninguno'), 'Dejarlos sin dueño')}
        </fieldset>

        {personaElegida && !personaElegida.coldCalling && (
          <div className={`${AVISO.base} ${AVISO.conTono}`} style={{ borderLeftColor: COLOR_ESTADO.ambar }}>
            <AlertTriangle className={`${AVISO.icono} text-[var(--ls-e-ambar)]`} aria-hidden />
            <p>
              <span className={AVISO.fuerte}>{personaElegida.nombre} no tiene acceso a Cold Calling.</span> No verá estos leads hasta que se le dé la casilla en Gestión de usuarios.
            </p>
          </div>
        )}

        <p className="rounded-[6px] bg-[var(--ls-sup2)] px-2.5 py-2 text-[12px] font-medium text-[var(--ls-t1)]">{!cambiaLista && !cambiaDueno ? 'Elige qué cambiar.' : falta ? 'Falta elegir una opción de la lista.' : `${frase}.`}</p>
        {error && <AvisoDeError texto={error} />}
        <Pie onCerrar={onCerrar} guardando={guardando} desactivado={(!cambiaLista && !cambiaDueno) || falta} textoDelBoton={`Aplicar a ${numero(cuantos)}`} />
      </form>
    </Ventana>
  )
}

/* ------------------------------------------------------------------ */
/* Confirmar                                                           */
/* ------------------------------------------------------------------ */

export function DialogoDeConfirmar({
  abierto,
  onCerrar,
  titulo,
  frase,
  detalle,
  textoDelBoton,
  onConfirmar,
}: {
  abierto: boolean
  onCerrar: () => void
  titulo: string
  frase: string
  detalle?: string
  textoDelBoton: string
  onConfirmar: () => Promise<string | null>
}) {
  const { guardando, error, setError, enviar } = usarEnvio(onCerrar)
  useEffect(() => {
    if (abierto) setError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto])
  return (
    <Ventana abierto={abierto} onCerrar={onCerrar} titulo={titulo}>
      <form onSubmit={(e) => enviar(e, onConfirmar)} className="space-y-3">
        <p className="rounded-[6px] bg-[var(--ls-sup2)] px-2.5 py-2 text-[12.5px] font-medium text-[var(--ls-t1)]">{frase}.</p>
        {detalle && <p className="text-[11.5px] leading-[1.5] text-[var(--ls-t3)]">{detalle}</p>}
        {error && <AvisoDeError texto={error} />}
        <Pie onCerrar={onCerrar} guardando={guardando} textoDelBoton={textoDelBoton} />
      </form>
    </Ventana>
  )
}

