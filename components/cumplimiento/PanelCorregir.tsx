'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion, MotionConfig } from 'framer-motion'
import { AlertTriangle, CheckCircle2, ChevronRight, FileWarning, History, Info, Plus, RefreshCw, Send, ShieldCheck, Trash2, Wrench, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { Boton, Confirmacion, Esqueleto, EsqueletoTexto, EstadoVacio, Insignia, LineaDeTiempo, PanelLateral, TACTIL, type Hito } from '@/components/ui-ls'
import { COLOR_ESTADO } from '@/lib/estilo/denso'
import { nombreMarketplace } from '@/components/plataforma/comun'
import { clasificarTema } from '@/lib/cumplimiento/incidencias'
import { clasificar } from '@/lib/cumplimiento/acciones'
import {
  ROTULO_CORRECCION,
  corregibleDesdeErp,
  erroresDeFila,
  type CampoDeAtributo,
  type CorreccionRegistrada,
  type DefinicionDeAtributo,
  type FilaDeFormulario,
  type Formulario,
  type IssueLegible,
} from '@/lib/cumplimiento/correccion'
import type { CorreccionPreparada, ResultadoDeCorreccion } from '@/lib/cumplimiento/correccion-servidor'
import type { FilaCumplimiento } from '@/lib/cumplimiento/tipos'

/** Qué listing y qué incidencia se corrige */
export interface ObjetivoDeCorreccion {
  mercado: string
  sku: string
  codigo: string | null
  /** Los atributos que nombra la incidencia guardada (el servidor añade los que Amazon nombre ahora) */
  atributos: string[]
  /** Lo que dice Amazon, para tenerlo delante mientras se corrige */
  mensaje?: string
  titulo?: string | null
}

/** Una tarea de «Hoy»: se elige primero el listing */
export interface TareaACorregir {
  titulo: string
  codigos: string[]
  mercado: string
}

async function pedir<T>(cuerpo: Record<string, unknown>): Promise<T & { ok: boolean; error?: string; errores?: string[] }> {
  // Sin red, fetch lanza: se convierte en un fallo normal para que la pantalla no se quede «trabajando» para siempre
  const res = await fetch('/api/cumplimiento', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) }).catch(() => null)
  if (!res) return { ok: false, error: 'Sin conexión con el ERP: vuelve a intentarlo.' } as T & { ok: boolean; error?: string }
  const json = (await res.json().catch(() => ({}))) as T & { ok?: boolean; error?: string; errores?: string[] }
  if (!res.ok) return { ...json, ok: false, error: json.error ?? `El servidor ha contestado ${res.status}` }
  return { ...json, ok: json.ok !== false }
}

/**
 * EL PANEL «CORREGIR». Un formulario generado desde el esquema de Amazon con SOLO los atributos de la incidencia, los
 * valores que tiene ahora la ficha, «Validar» (Amazon lo comprueba sin guardar nada) y «Enviar» (con confirmación; solo
 * tras validar exactamente lo mismo). Al enviar se vuelve a leer el listing y se puede «Revisar de nuevo».
 *
 * Con `tarea` (desde «Hoy») primero se elige el listing de esa tarea; con `objetivo` (desde la lista) se va directo.
 */
export function PanelCorregir({
  abierto,
  onCambio,
  cliente,
  objetivo: objetivoInicial,
  tarea,
  alTerminar,
}: {
  abierto: boolean
  onCambio: (abierto: boolean) => void
  cliente: string
  objetivo?: ObjetivoDeCorreccion | null
  tarea?: TareaACorregir | null
  /** Tras un envío aceptado o una revisión: para refrescar lo de debajo */
  alTerminar?: () => void
}) {
  const [objetivo, setObjetivo] = useState<ObjetivoDeCorreccion | null>(objetivoInicial ?? null)
  useEffect(() => {
    if (abierto) setObjetivo(objetivoInicial ?? null)
  }, [abierto, objetivoInicial])

  return (
    <PanelLateral
      abierto={abierto}
      onCambio={onCambio}
      ancho={620}
      acento="cumplimiento"
      icono={Wrench}
      titulo={objetivo ? `Corregir ${objetivo.sku}` : (tarea?.titulo ?? 'Corregir')}
      descripcion={objetivo ? `${nombreMarketplace(objetivo.mercado)}${objetivo.codigo ? ` · incidencia ${objetivo.codigo}` : ''}` : 'Elige el listing que quieres corregir'}
    >
      <MotionConfig reducedMotion="user">
        {objetivo ? (
          <FormularioDeCorreccion key={`${objetivo.mercado}|${objetivo.sku}|${objetivo.codigo}`} cliente={cliente} objetivo={objetivo} volver={tarea ? () => setObjetivo(null) : undefined} alTerminar={alTerminar} />
        ) : tarea ? (
          <ElegirListing cliente={cliente} tarea={tarea} elegir={setObjetivo} />
        ) : null}
      </MotionConfig>
    </PanelLateral>
  )
}

/* ------------------------------------------------------------------ */
/* Elegir el listing de una tarea                                      */
/* ------------------------------------------------------------------ */

function ElegirListing({ cliente, tarea, elegir }: { cliente: string; tarea: TareaACorregir; elegir: (o: ObjetivoDeCorreccion) => void }) {
  const [filas, setFilas] = useState<FilaCumplimiento[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    void pedir<{ filas?: FilaCumplimiento[] }>({
      accion: 'filas',
      cliente,
      pagina: 0,
      filtros: { mercado: tarea.mercado, gravedad: 'cualquiera', tema: 'todos', soloStock: false, busca: '', codigos: tarea.codigos },
    }).then((r) => {
      if (!vivo) return
      if (!r.ok) setError(r.error ?? 'No se ha podido leer la lista.')
      else setFilas((r.filas ?? []).slice().sort((a, b) => Number(b.con_stock) - Number(a.con_stock)))
    })
    return () => {
      vivo = false
    }
  }, [cliente, tarea.mercado, tarea.codigos])

  const ahora = useMemo(() => new Date(), [])
  if (error) return <EstadoVacio compacto icono={FileWarning} acento="cumplimiento" titulo="No se ha podido leer la lista" descripcion={error} />
  if (!filas)
    return (
      <div className="flex flex-col gap-2" aria-busy="true">
        {Array.from({ length: 6 }, (_, i) => (
          <Esqueleto key={i} className="h-[58px] rounded-[12px]" />
        ))}
      </div>
    )
  if (filas.length === 0) return <EstadoVacio compacto icono={CheckCircle2} acento="cumplimiento" titulo="Ya no queda ningún listing con esta incidencia" descripcion="Amazon la ha quitado en la última revisión." />

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[12.5px] text-[var(--ls-t3)]">
        {filas.length >= 100 ? 'Los 100 primeros' : filas.length} {filas.length === 1 ? 'listing' : 'listings'}, los que tienen stock primero.
      </p>
      <ul className="flex flex-col gap-2">
        {filas.slice(0, 100).map((f) => {
          const inc = f.incidencias.find((i) => tarea.codigos.includes(i.codigo)) ?? f.incidencias[0]
          const accion = inc ? clasificar({ ...inc, tema: clasificarTema(inc) }, ahora).accion : null
          const corregible = !!inc && !!accion && corregibleDesdeErp(inc, accion)
          return (
            <li key={`${f.marketplace_id}|${f.sku}`}>
              <button
                type="button"
                disabled={!corregible}
                onClick={() => inc && elegir({ mercado: f.marketplace_id, sku: f.sku, codigo: inc.codigo, atributos: inc.atributos, mensaje: inc.mensaje, titulo: f.titulo })}
                className={`ls-elevar group flex w-full items-center gap-3 rounded-[12px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-3 py-[10px] text-left transition-colors hover:border-[var(--ls-linea2)] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:transform-none ${TACTIL}`}
              >
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-[13px] font-semibold text-[var(--ls-t1)]">{f.sku}</span>
                    {f.con_stock && <Insignia tamano="sm" tono="verde">Con stock</Insignia>}
                    {tarea.mercado === 'todos' && <span className="text-[11.5px] text-[var(--ls-t4)]">{nombreMarketplace(f.marketplace_id)}</span>}
                  </span>
                  <span className="mt-[2px] block truncate text-[12px] text-[var(--ls-t3)]">{f.titulo ?? '—'}</span>
                  {inc && inc.atributos.length > 0 && <span className="mt-[2px] block truncate text-[11.5px] text-[var(--ls-t4)]">Dato: {inc.atributos.join(', ')}</span>}
                </span>
                {corregible ? (
                  <ChevronRight className="h-4 w-4 shrink-0 text-[var(--ls-t4)] transition-transform group-hover:translate-x-[2px]" />
                ) : (
                  <span className="shrink-0 text-[11.5px] text-[var(--ls-t4)]">Amazon no dice qué dato</span>
                )}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* El formulario                                                       */
/* ------------------------------------------------------------------ */

type Paso =
  | { tipo: 'cargando' }
  | { tipo: 'error'; mensaje: string }
  | { tipo: 'listo' }

function FormularioDeCorreccion({ cliente, objetivo, volver, alTerminar }: { cliente: string; objetivo: ObjetivoDeCorreccion; volver?: () => void; alTerminar?: () => void }) {
  const [paso, setPaso] = useState<Paso>({ tipo: 'cargando' })
  const [prep, setPrep] = useState<CorreccionPreparada | null>(null)
  const [formulario, setFormulario] = useState<Formulario>({})
  const [validacion, setValidacion] = useState<{ firma: string; r: ResultadoDeCorreccion } | null>(null)
  const [envio, setEnvio] = useState<ResultadoDeCorreccion | null>(null)
  const [erroresServidor, setErroresServidor] = useState<string[]>([])
  const [trabajando, setTrabajando] = useState<'validar' | 'enviar' | 'revisar' | null>(null)
  const [confirmar, setConfirmar] = useState(false)
  const [historial, setHistorial] = useState<CorreccionRegistrada[] | null>(null)

  const base = useMemo(() => ({ cliente, mercado: objetivo.mercado, sku: objetivo.sku, codigo: objetivo.codigo }), [cliente, objetivo])

  const cargar = useCallback(async () => {
    setPaso({ tipo: 'cargando' })
    setValidacion(null)
    setEnvio(null)
    const r = await pedir<CorreccionPreparada>({ accion: 'corregir-preparar', ...base, atributos: objetivo.atributos })
    if (!r.ok) {
      setPaso({ tipo: 'error', mensaje: r.error ?? 'No se ha podido leer el listing de Amazon.' })
      return
    }
    setPrep(r)
    setFormulario(r.formulario)
    setHistorial(r.historial)
    setPaso({ tipo: 'listo' })
  }, [base, objetivo.atributos])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const firma = JSON.stringify(formulario)
  const validado = validacion && validacion.firma === firma && validacion.r.estado === 'valido' ? validacion.r : null
  const editables = prep?.definiciones.filter((d) => d.soportado) ?? []
  const noEditables = prep?.definiciones.filter((d) => !d.soportado) ?? []
  const erroresLocales = editables.flatMap((d) => (formulario[d.nombre] ?? []).flatMap((f) => Object.values(erroresDeFila(d, f))))

  const accion = async (modo: 'validar' | 'enviar') => {
    setTrabajando(modo)
    setErroresServidor([])
    const r = await pedir<ResultadoDeCorreccion>({ accion: modo === 'validar' ? 'corregir-validar' : 'corregir-enviar', ...base, formulario })
    setTrabajando(null)
    if (!r.ok) {
      setErroresServidor(r.errores ?? [])
      toast.error(r.error ?? 'No se ha podido hacer.')
      if (modo === 'enviar') throw new Error(r.error)
      return
    }
    if (r.historial) setHistorial(r.historial)
    if (modo === 'validar') {
      setValidacion({ firma, r })
      if (r.estado === 'valido') toast.success('Amazon acepta el cambio. Ya puedes enviarlo.')
      else toast.error('Amazon no acepta el cambio: mira los motivos.')
    } else {
      setEnvio(r)
      if (r.estado === 'aceptado') {
        toast.success('Enviado a Amazon.')
        alTerminar?.()
      } else toast.error('Amazon ha rechazado el envío.')
    }
  }

  const revisar = async () => {
    setTrabajando('revisar')
    const r = await pedir<{ encontrado?: boolean }>({ accion: 'sku', cliente, mercado: objetivo.mercado, sku: objetivo.sku })
    setTrabajando(null)
    if (!r.ok) toast.error(r.error ?? 'No se ha podido revisar.')
    else {
      toast.success('Revisado de nuevo: la lista ya tiene lo que dice Amazon ahora.')
      alTerminar?.()
    }
  }

  if (paso.tipo === 'cargando')
    return (
      <div className="flex flex-col gap-4" aria-busy="true" aria-label="Leyendo el listing en Amazon">
        <Esqueleto className="h-[74px] rounded-[12px]" />
        <EsqueletoTexto lineas={2} />
        <Esqueleto className="h-[140px] rounded-[14px]" />
        <Esqueleto className="h-[90px] rounded-[14px]" />
      </div>
    )
  if (paso.tipo === 'error')
    return (
      <EstadoVacio
        compacto
        icono={FileWarning}
        acento="cumplimiento"
        titulo="No se puede corregir desde aquí"
        descripcion={paso.mensaje}
        accion={{ texto: 'Volver a intentarlo', icono: RefreshCw, onClick: () => void cargar() }}
        accionSecundaria={volver ? { texto: 'Elegir otro listing', onClick: volver } : undefined}
      />
    )
  if (!prep) return null

  const enviado = envio?.estado === 'aceptado'

  return (
    <div className="flex flex-col gap-4 pb-2">
      {volver && (
        <button type="button" onClick={volver} className="-mt-1 self-start text-[12px] font-medium text-[var(--ls-t3)] hover:text-[var(--ls-t1)]">
          ← Elegir otro listing
        </button>
      )}

      {/* Lo que dice Amazon, delante */}
      <div className="rounded-[12px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-[var(--ls-t1)]">{prep.titulo ?? objetivo.titulo ?? prep.sku}</span>
          {prep.sigueAbierta ? <Insignia tamano="sm" tono="ambar">Amazon la sigue dando</Insignia> : <Insignia tamano="sm" tono="verde">Amazon ya no la da</Insignia>}
        </div>
        <p className="mt-1 text-[11.5px] text-[var(--ls-t4)]">
          Tipo de producto {prep.productType}
          {prep.asin && <> · ASIN {prep.asin}</>} · idioma {prep.languageTag}
        </p>
        {objetivo.mensaje && <p className="mt-2 line-clamp-4 text-[12.5px] leading-[1.5] text-[var(--ls-t2)]">«{objetivo.mensaje}»</p>}
      </div>

      {editables.length === 0 && (
        <EstadoVacio compacto icono={Info} acento="cumplimiento" titulo="No hay nada que se pueda editar aquí" descripcion="Los datos de esta incidencia tienen una forma que el formulario no entiende: corrígelos en Seller Central y pulsa «Revisar de nuevo»." />
      )}

      {/* Un bloque por atributo */}
      {editables.map((d, i) => (
        <BloqueDeAtributo
          key={d.nombre}
          indice={i}
          d={d}
          filas={formulario[d.nombre] ?? []}
          bloqueado={enviado || trabajando !== null}
          cambiar={(filas) => setFormulario((f) => ({ ...f, [d.nombre]: filas }))}
          issues={(validacion?.r.issues ?? []).filter((x) => x.atributos.some((a) => a.nombre === d.nombre))}
        />
      ))}

      {noEditables.length > 0 && (
        <div className="rounded-[12px] border border-dashed border-[var(--ls-linea2)] px-4 py-3 text-[12px] text-[var(--ls-t3)]">
          {noEditables.map((d) => (
            <p key={d.nombre}>
              <strong className="text-[var(--ls-t2)]">{d.titulo}</strong>: {d.motivo}
            </p>
          ))}
        </div>
      )}

      {erroresServidor.length > 0 && (
        <ul className="rounded-[12px] border px-4 py-3 text-[12.5px]" style={{ borderColor: `color-mix(in srgb, ${COLOR_ESTADO.rojo} 35%, transparent)`, color: COLOR_ESTADO.rojo }}>
          {erroresServidor.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}

      {/* Lo que contesta Amazon */}
      <AnimatePresence mode="popLayout">
        {validacion && !envio && (
          <motion.div key={`v-${validacion.r.estado}-${validacion.firma.length}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <Veredicto
              tono={validacion.r.estado === 'valido' ? 'verde' : 'rojo'}
              titulo={validacion.firma !== firma ? 'Has cambiado algo después de validar: vuelve a validar' : validacion.r.estado === 'valido' ? 'Amazon acepta el cambio (no se ha guardado nada todavía)' : 'Amazon no lo aceptaría'}
              issues={validacion.r.issues}
              apagado={validacion.firma !== firma}
            />
          </motion.div>
        )}
        {envio && (
          <motion.div key={`e-${envio.estado}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            <Veredicto
              tono={envio.estado === 'aceptado' ? 'verde' : 'rojo'}
              titulo={envio.estado === 'aceptado' ? 'Enviado a Amazon' : 'Amazon ha rechazado el envío'}
              issues={envio.issues}
              pie={
                envio.estado === 'aceptado' ? (
                  <>
                    <p className="text-[12px] text-[var(--ls-t3)]">
                      Amazon tarda unos minutos en aplicarlo.{' '}
                      {envio.issuesDespues == null
                        ? 'No se ha podido volver a leer el listing.'
                        : envio.issuesDespues.length === 0
                          ? 'Al volver a leerlo ya no tiene ninguna incidencia.'
                          : `Al volver a leerlo aún tiene ${envio.issuesDespues.length} ${envio.issuesDespues.length === 1 ? 'incidencia' : 'incidencias'} (puede ser que no haya dado tiempo).`}
                      {!envio.registrado && <strong style={{ color: COLOR_ESTADO.ambar }}> No se ha podido apuntar en el registro.</strong>}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Boton variante="primario" tamano="sm" icono={RefreshCw} cargando={trabajando === 'revisar'} onClick={() => void revisar()}>
                        Revisar de nuevo
                      </Boton>
                      <Boton variante="secundario" tamano="sm" onClick={() => void cargar()}>
                        Volver a leer la ficha
                      </Boton>
                    </div>
                  </>
                ) : null
              }
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Acciones (en el cuerpo, para que en el móvil queden a mano bajo el formulario) */}
      {!enviado && editables.length > 0 && (
        <div className="sticky bottom-[-16px] -mx-5 flex flex-wrap items-center justify-end gap-2 border-t border-[var(--ls-linea)] bg-[var(--ls-sup)] px-5 py-3">
          <span className="mr-auto text-[11.5px] text-[var(--ls-t4)]">{validado ? 'Validado. La validación vale 30 minutos.' : 'Primero se valida: Amazon lo comprueba sin guardar nada.'}</span>
          <Boton variante={validado ? 'secundario' : 'primario'} icono={ShieldCheck} cargando={trabajando === 'validar'} disabled={erroresLocales.length > 0 || trabajando !== null} onClick={() => void accion('validar')}>
            Validar
          </Boton>
          <Boton variante={validado ? 'primario' : 'secundario'} icono={Send} disabled={!validado || trabajando !== null || historial === null} title={historial === null ? 'Falta lanzar la migración 313: sin registro no se envía nada' : undefined} onClick={() => setConfirmar(true)}>
            Enviar
          </Boton>
        </div>
      )}
      {historial === null && (
        <p className="text-[11.5px]" style={{ color: COLOR_ESTADO.ambar }}>
          Falta lanzar la migración 313 (registro de correcciones): se puede validar, pero no enviar.
        </p>
      )}

      <Historial historial={historial} />

      <Confirmacion
        abierto={confirmar}
        onCambio={setConfirmar}
        palabra={null}
        tono="normal"
        titulo="¿Enviar el cambio a Amazon?"
        descripcion={`Se cambia la ficha de ${prep.sku} en ${nombreMarketplace(prep.marketplaceId)}. Amazon lo ha validado y queda apuntado quién lo envía y qué había antes.`}
        textoConfirmar="Enviar a Amazon"
        onConfirmar={() => accion('enviar')}
      >
        <ul className="mt-1 text-[12.5px] text-[var(--ls-t2)]">
          {validado?.atributos.map((a) => (
            <li key={a}>· {editables.find((d) => d.nombre === a)?.titulo ?? a}</li>
          ))}
        </ul>
      </Confirmacion>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Un atributo y sus campos                                            */
/* ------------------------------------------------------------------ */

function BloqueDeAtributo({ d, filas, cambiar, bloqueado, issues, indice }: { d: DefinicionDeAtributo; filas: FilaDeFormulario[]; cambiar: (f: FilaDeFormulario[]) => void; bloqueado: boolean; issues: IssueLegible[]; indice: number }) {
  const [ayuda, setAyuda] = useState(false)
  const conError = issues.some((i) => i.gravedad === 'error')
  return (
    <section
      className="ls-aparecer rounded-[14px] border bg-[var(--ls-sup)] shadow-[var(--ls-sombra-1)]"
      style={{ ['--ls-i' as string]: indice, borderColor: conError ? `color-mix(in srgb, ${COLOR_ESTADO.rojo} 45%, transparent)` : 'var(--ls-linea)' }}
      aria-label={d.titulo}
    >
      <header className="flex items-start gap-3 border-b border-[var(--ls-linea)] px-4 py-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-[13.5px] font-semibold text-[var(--ls-t1)]">
            {d.titulo}
            {d.obligatorio && <span className="ml-1 text-[var(--ls-e-rojo)]">*</span>}
          </h3>
          <p className="text-[11.5px] text-[var(--ls-t4)]">{d.nombre}</p>
        </div>
        {d.descripcion && (
          <button type="button" onClick={() => setAyuda((v) => !v)} aria-expanded={ayuda} className={`shrink-0 rounded-[8px] px-2 text-[12px] font-medium text-[var(--ls-t3)] hover:bg-[var(--ls-sup2)] hover:text-[var(--ls-t1)] ${TACTIL}`}>
            {ayuda ? 'Ocultar ayuda' : 'Qué pide Amazon'}
          </button>
        )}
      </header>
      {ayuda && d.descripcion && <p className="border-b border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-4 py-2 text-[12px] leading-[1.5] text-[var(--ls-t3)]">{d.descripcion}</p>}

      <div className="flex flex-col gap-4 px-4 py-3">
        {filas.map((fila, n) => {
          const errores = erroresDeFila(d, fila)
          return (
            <div key={n} className={filas.length > 1 ? 'rounded-[10px] border border-[var(--ls-linea)] p-3' : ''}>
              {filas.length > 1 && (
                <div className="mb-2 flex items-center justify-between text-[11.5px] text-[var(--ls-t4)]">
                  <span>Valor {n + 1}</span>
                  <button type="button" disabled={bloqueado} onClick={() => cambiar(filas.filter((_, i) => i !== n))} aria-label={`Quitar el valor ${n + 1}`} className={`inline-flex items-center gap-1 rounded-[6px] px-2 hover:text-[var(--ls-e-rojo)] ${TACTIL}`}>
                    <Trash2 className="h-3 w-3" /> Quitar
                  </button>
                </div>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                {d.campos.map((c) => (
                  <Campo key={c.clave} c={c} valor={fila[c.clave] ?? ''} error={errores[c.clave]} bloqueado={bloqueado} ancho={d.campos.length === 1 || c.tipo === 'textoLargo'} cambiar={(v) => cambiar(filas.map((f, i) => (i === n ? { ...f, [c.clave]: v } : f)))} />
                ))}
              </div>
            </div>
          )
        })}
        {filas.length < d.maxElementos && (
          <button
            type="button"
            disabled={bloqueado}
            onClick={() => cambiar([...filas, Object.fromEntries(d.campos.map((c) => [c.clave, '']))])}
            className={`inline-flex items-center gap-1 self-start rounded-[8px] px-2 text-[12px] font-medium text-[var(--ls-t3)] hover:bg-[var(--ls-sup2)] hover:text-[var(--ls-t1)] ${TACTIL}`}
          >
            <Plus className="h-3 w-3" /> Añadir otro valor ({filas.length} de {d.maxElementos})
          </button>
        )}
        {issues.length > 0 && <ListaDeIssues issues={issues} />}
      </div>
    </section>
  )
}

const CONTROL = `w-full rounded-[10px] border bg-[var(--ls-sup2)] px-3 text-[13px] text-[var(--ls-t1)] outline-none transition-colors placeholder:text-[var(--ls-t4)] focus:border-[var(--ls-acc-graf)] disabled:opacity-60 ${TACTIL}`

function Campo({ c, valor, error, cambiar, bloqueado, ancho }: { c: CampoDeAtributo; valor: string; error?: string; cambiar: (v: string) => void; bloqueado: boolean; ancho: boolean }) {
  const id = `campo-${c.clave.replace(/\./g, '-')}-${Math.abs(hash(c.clave + c.titulo))}`
  const borde = { borderColor: error ? COLOR_ESTADO.rojo : 'var(--ls-linea2)' }
  const listaId = c.libre ? `${id}-lista` : undefined
  return (
    <div className={ancho ? 'sm:col-span-2' : ''}>
      <label htmlFor={id} className="mb-1 flex items-baseline justify-between gap-2 text-[12px] font-medium text-[var(--ls-t2)]">
        <span className="truncate" title={c.descripcion}>
          {c.titulo}
          {c.obligatorio && <span className="ml-[2px] text-[var(--ls-e-rojo)]">*</span>}
        </span>
        {c.maxLength != null && (c.tipo === 'texto' || c.tipo === 'textoLargo') && <span className="shrink-0 tabular-nums text-[11px] text-[var(--ls-t4)]">{valor.length}/{c.maxLength}</span>}
      </label>
      {c.tipo === 'textoLargo' ? (
        <textarea id={id} value={valor} disabled={bloqueado} onChange={(e) => cambiar(e.target.value)} rows={4} className={`${CONTROL} py-2`} style={borde} placeholder={c.ejemplo} aria-invalid={!!error} />
      ) : (c.tipo === 'opcion' && !c.libre) || c.tipo === 'booleano' ? (
        <select id={id} value={valor} disabled={bloqueado} onChange={(e) => cambiar(e.target.value)} className={`${CONTROL} h-9`} style={borde} aria-invalid={!!error}>
          <option value="">—</option>
          {c.opciones?.map((o) => (
            <option key={o.valor} value={o.valor}>
              {o.texto}
            </option>
          ))}
          {valor && !c.opciones?.some((o) => o.valor === valor) && <option value={valor}>{valor} (no está en la lista)</option>}
        </select>
      ) : (
        <>
          <input
            id={id}
            value={valor}
            disabled={bloqueado}
            onChange={(e) => cambiar(e.target.value)}
            inputMode={c.tipo === 'numero' ? 'decimal' : c.tipo === 'entero' ? 'numeric' : undefined}
            list={listaId}
            className={`${CONTROL} h-9`}
            style={borde}
            placeholder={c.ejemplo}
            aria-invalid={!!error}
          />
          {listaId && (
            <datalist id={listaId}>
              {c.opciones?.map((o) => (
                <option key={o.valor} value={o.valor}>
                  {o.texto}
                </option>
              ))}
            </datalist>
          )}
        </>
      )}
      {error && <p className="mt-1 text-[11.5px]" style={{ color: COLOR_ESTADO.rojo }}>{error}</p>}
    </div>
  )
}

function hash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return h
}

/* ------------------------------------------------------------------ */
/* Lo que dice Amazon y el historial                                   */
/* ------------------------------------------------------------------ */

function ListaDeIssues({ issues }: { issues: readonly IssueLegible[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {issues.map((i, n) => {
        const Icono = i.gravedad === 'error' ? XCircle : i.gravedad === 'aviso' ? AlertTriangle : Info
        const color = i.gravedad === 'error' ? COLOR_ESTADO.rojo : i.gravedad === 'aviso' ? COLOR_ESTADO.ambar : COLOR_ESTADO.azul
        return (
          <li key={`${i.codigo}-${n}`} className="flex gap-2 text-[12.5px] leading-[1.5] text-[var(--ls-t2)]">
            <Icono className="mt-[3px] h-[14px] w-[14px] shrink-0" style={{ color }} aria-label={i.gravedad} />
            <span className="min-w-0">
              {i.mensaje}
              {(i.atributos.length > 0 || i.codigo) && (
                <span className="block text-[11.5px] text-[var(--ls-t4)]">
                  {i.atributos.map((a) => a.titulo).join(', ')}
                  {i.atributos.length > 0 && i.codigo && ' · '}
                  {i.codigo && `código ${i.codigo}`}
                </span>
              )}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

function Veredicto({ tono, titulo, issues, pie, apagado }: { tono: 'verde' | 'rojo'; titulo: string; issues: readonly IssueLegible[]; pie?: React.ReactNode; apagado?: boolean }) {
  const color = COLOR_ESTADO[apagado ? 'ambar' : tono]
  const Icono = apagado ? AlertTriangle : tono === 'verde' ? CheckCircle2 : XCircle
  return (
    <div className="rounded-[14px] border px-4 py-3" style={{ borderColor: `color-mix(in srgb, ${color} 40%, transparent)`, background: `linear-gradient(160deg, color-mix(in srgb, ${color} 12%, transparent), transparent 70%)` }} role="status">
      <p className="flex items-center gap-2 text-[13.5px] font-semibold" style={{ color }}>
        <Icono className="h-4 w-4" /> {titulo}
      </p>
      {issues.length > 0 && (
        <div className="mt-2">
          <ListaDeIssues issues={issues} />
        </div>
      )}
      {pie && <div className="mt-2">{pie}</div>}
    </div>
  )
}

function Historial({ historial }: { historial: CorreccionRegistrada[] | null }) {
  if (!historial || historial.length === 0) return null
  const hitos: Hito[] = historial.map((h) => ({
    id: h.id,
    titulo: ROTULO_CORRECCION[h.modo][h.estado],
    descripcion: [h.atributos.join(', '), h.mensaje].filter(Boolean).join(' · ') || undefined,
    cuando: h.creadoAt,
    tono: h.estado === 'aceptado' ? 'verde' : h.estado === 'valido' ? 'azul' : 'rojo',
    icono: h.modo === 'enviar' ? Send : ShieldCheck,
    autor: h.creadoPor ?? undefined,
  }))
  return (
    <section aria-label="Historial de correcciones" className="mt-2">
      <h3 className="mb-3 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.05em] text-[var(--ls-t4)]">
        <History className="h-[13px] w-[13px]" /> Historial de este listing
      </h3>
      <LineaDeTiempo eventos={hitos} maximo={12} />
    </section>
  )
}

