'use client'

import { Archive, ArchiveRestore, Copy, Loader2, Lock, RotateCcw, Save, Trophy } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { enviarJson } from '@/components/correo/api'
import type { EjemploVista, VersionVista } from '@/lib/correo/ia-laboratorio-tipos'
import {
  PRESENTACION_FIJA,
  REGLAS_FIJAS,
  REGLA_DE_INDICACIONES,
  SECCIONES_BASE,
  SECCIONES_DE_LA_VERSION,
  validarSecciones,
  type SeccionesDeInstrucciones,
} from '@/lib/correo/ia-prompt'
import { MODELOS_DEL_EDITOR, costeAproximado, repartoEnPorcentaje } from '@/lib/correo/ia-version'
import type { CasoVista } from '@/lib/whatsapp/ia-casos'
import { PanelDePruebaDeCorreo } from './PanelDePruebaDeCorreo'
import { AYUDA, BOTON_PRIMARIO, BOTON_SECUNDARIO, CAJA, ETIQUETA, LINEA, centimos } from './ui'

/**
 * EL EDITOR DE UNA VERSIÓN DE LA IA.
 *
 * Cada versión es un juego completo: las instrucciones (en secciones), los ejemplos que se le enseñan, si además aprende de los correos del
 * equipo con respuesta y el modelo, más su PESO en el reparto. Una versión nueva nace pausada: se escribe, se PRUEBA con un lead sin enviar
 * nada y, cuando convence, se pone en marcha con algo de peso.
 *
 * Lo que ya ha escrito algún borrador NO cambia de contenido (se duplica y se edita la copia): si cambiara a mitad, las respuestas de antes
 * y de después se mezclarían bajo el mismo nombre. La versión original tampoco: es el punto de comparación. Nombre, notas y reparto se pueden
 * tocar siempre.
 */

interface Props {
  /** null = una versión nueva, que parte de la original */
  version: VersionVista | null
  todas: VersionVista[]
  ejemplos: EjemploVista[]
  /** Las personas de prueba: leads inventados con los que se prueba lo que hay en el editor */
  casos: CasoVista[]
  /** Se ha guardado, creado o duplicado una versión: recargar y quedarse con ésta */
  onGuardada: (id: string) => Promise<void>
  /** Cambió algo que no mueve la selección (archivar, declarar ganadora) */
  onCambio: () => Promise<void>
}

export function EditorDeVersion({ version, todas, ejemplos, casos, onGuardada, onCambio }: Props) {
  const base = todas.find((v) => v.esBase)
  const origen = version ?? base
  const esNueva = version === null
  const esBase = version?.esBase === true
  /** Con borradores escritos (o la original): el contenido no se toca */
  const contenidoBloqueado = version?.usada === true

  const [nombre, setNombre] = useState(version ? version.nombre : 'Versión nueva')
  const [notas, setNotas] = useState(version?.notas ?? '')
  const [secciones, setSecciones] = useState<SeccionesDeInstrucciones>(origen?.secciones ?? SECCIONES_BASE)
  const [ejemplosIds, setEjemplosIds] = useState<string[]>(version?.ejemplosIds ?? [])
  const [usarGanadores, setUsarGanadores] = useState(version?.usarGanadores ?? true)
  const [modelo, setModelo] = useState<string | null>(version?.modelo ?? null)
  const [peso, setPeso] = useState(version?.peso ?? 0)
  const [activa, setActiva] = useState(version?.activa ?? false)
  const [guardando, setGuardando] = useState(false)
  const [confirmaGanadora, setConfirmaGanadora] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const validacion = useMemo(() => validarSecciones(secciones), [secciones])
  const avisos = validacion.ok ? validacion.avisos : []

  // El reparto que saldría con lo que se ha puesto aquí
  const reparto = useMemo(() => {
    const simuladas = todas.filter((v) => v.id !== version?.id).map((v) => ({ id: v.id, activa: v.activa, archivada: v.archivada, peso: v.peso }))
    simuladas.push({ id: version?.id ?? 'esta', activa, archivada: version?.archivada ?? false, peso })
    return repartoEnPorcentaje(simuladas)
  }, [todas, version, activa, peso])
  const miPorcentaje = reparto.get(version?.id ?? 'esta') ?? 0

  const costePorCorreo = costeAproximado(modelo ?? 'gpt-5.6-terra', { entrada: 3100, salida: 210 })

  function cambiarSeccion(clave: keyof SeccionesDeInstrucciones, valor: string) {
    setSecciones((s) => ({ ...s, [clave]: valor }))
  }

  function alternarEjemplo(id: string) {
    setEjemplosIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : ids.length >= 8 ? ids : [...ids, id]))
  }

  async function guardar() {
    if (guardando) return
    setError(null)
    if (!esBase && !contenidoBloqueado && !validacion.ok) return setError(validacion.error)
    setGuardando(true)
    const reparto = { peso, activa }
    const cuerpo = esBase ? reparto : contenidoBloqueado ? { nombre, notas, ...reparto } : { nombre, notas, secciones, ejemplosIds, usarGanadores, modelo, ...reparto }
    const r = esNueva
      ? await enviarJson<{ version: VersionVista; avisos: string[] }>('/api/correo/laboratorio/versiones', 'POST', cuerpo)
      : await enviarJson<{ version: VersionVista; avisos: string[] }>(`/api/correo/laboratorio/versiones/${version.id}`, 'PATCH', cuerpo)
    setGuardando(false)
    if (!r.ok) return setError(r.mensaje)
    for (const a of r.datos.avisos ?? []) toast.warning(a, { duration: 9000 })
    toast.success(esNueva ? 'Versión creada. Está pausada: pruébala y ponla en marcha cuando te convenza.' : 'Cambios guardados.')
    await onGuardada(r.datos.version.id)
  }

  async function duplicar() {
    if (!version || guardando) return
    setGuardando(true)
    const r = await enviarJson<{ version: VersionVista }>('/api/correo/laboratorio/versiones', 'POST', {
      nombre: `${version.nombre} (copia)`.slice(0, 80),
      notas: version.notas,
      secciones: version.secciones,
      ejemplosIds: version.ejemplosIds,
      usarGanadores: version.usarGanadores,
      modelo: version.modelo,
    })
    setGuardando(false)
    if (!r.ok) return setError(r.mensaje)
    toast.success('Copia creada, pausada y lista para editar.')
    await onGuardada(r.datos.version.id)
  }

  async function archivar(archivada: boolean) {
    if (!version || guardando) return
    setGuardando(true)
    const r = await enviarJson(`/api/correo/laboratorio/versiones/${version.id}`, 'PATCH', { archivada })
    setGuardando(false)
    if (!r.ok) return setError(r.mensaje)
    toast.success(archivada ? 'Versión archivada: ya no recibe correos.' : 'Versión restaurada (pausada).')
    await onCambio()
  }

  async function declararGanadora() {
    if (!version || guardando) return
    setGuardando(true)
    const r = await enviarJson(`/api/correo/laboratorio/versiones/${version.id}`, 'PATCH', { accion: 'ganadora' })
    setGuardando(false)
    setConfirmaGanadora(false)
    if (!r.ok) return setError(r.mensaje)
    toast.success(`«${version.nombre}» la usa ahora todo el equipo. Las demás están pausadas.`)
    await onCambio()
  }

  const camposDeTextoBloqueados = esBase || contenidoBloqueado

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.95fr)]">
      <div className="space-y-4">
        <a href="#panel-de-prueba-correo" className="inline-flex items-center gap-1 text-[12px] text-[var(--ls-t3)] underline underline-offset-2 hover:text-[var(--ls-t1)] lg:hidden">
          Ir a la prueba ↓
        </a>
        {(esBase || contenidoBloqueado) && (
          <div className="flex items-start gap-2 rounded-[8px] border border-[var(--ls-linea2)] bg-[var(--ls-sup2)] px-3 py-2 text-[12px] leading-snug text-[var(--ls-t3)]">
            <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--ls-t4)]" aria-hidden />
            <span>
              {esBase
                ? 'La versión original es la de siempre y no se edita: es el punto de comparación de las demás. Para cambiar algo, duplícala y edita la copia.'
                : 'Esta versión ya ha escrito borradores, así que sus instrucciones, ejemplos y modelo no se pueden cambiar (si cambiaran, las respuestas de antes y de después se mezclarían). Duplícala y edita la copia. El nombre, las notas y el reparto sí se pueden tocar.'}
            </span>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          <div>
            <label htmlFor="version-nombre" className={ETIQUETA}>
              Nombre
            </label>
            <input id="version-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={80} disabled={esBase} className={LINEA} />
          </div>
          <div>
            <label htmlFor="version-notas" className={ETIQUETA}>
              Qué estás probando con ella (para acordarte)
            </label>
            <input id="version-notas" value={notas} onChange={(e) => setNotas(e.target.value)} maxLength={1000} disabled={esBase} placeholder="Ej.: tratar de usted y proponer una llamada de 5 minutos" className={LINEA} />
          </div>
        </div>

        {/* El reparto */}
        <div className="rounded-[8px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] p-3">
          <h3 className="text-[13px] font-semibold text-[var(--ls-t1)]">Reparto</h3>
          <p className={AYUDA}>Cada vez que un comercial pulsa «Redactar con IA» se sortea una versión entre las que están en marcha, en proporción a su peso. El comercial no la elige ni la ve.</p>
          <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-2">
            <label className="flex cursor-pointer select-none items-center gap-2 text-[12.5px] text-[var(--ls-t2)]">
              <input type="checkbox" checked={activa} onChange={(e) => setActiva(e.target.checked)} className="h-3.5 w-3.5 accent-[var(--ls-acc-graf)]" /> En marcha
            </label>
            <label className="flex items-center gap-2 text-[12.5px] text-[var(--ls-t2)]">
              Peso
              <input type="number" min={0} max={100} value={peso} onChange={(e) => setPeso(Math.max(0, Math.min(100, Math.round(Number(e.target.value) || 0))))} className={`${LINEA} !h-7 !w-16 text-right tabular-nums`} aria-label="Peso de 0 a 100" />
            </label>
            <span className="text-[12.5px] text-[var(--ls-t3)]">
              {miPorcentaje > 0 ? (
                <>
                  Escribiría el <strong className="text-[var(--ls-t1)]">{miPorcentaje} %</strong> de los correos
                </>
              ) : (
                'No recibe correos ahora mismo (hace falta estar en marcha y tener peso)'
              )}
            </span>
          </div>
        </div>

        {/* Instrucciones por secciones */}
        <div className="space-y-3">
          <h3 className="text-[13px] font-semibold text-[var(--ls-t1)]">Instrucciones de la IA</h3>
          {SECCIONES_DE_LA_VERSION.map((s) => {
            const cambiada = secciones[s.clave] !== SECCIONES_BASE[s.clave]
            return (
              <div key={s.clave}>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <label htmlFor={`seccion-${s.clave}`} className="text-[11.5px] font-semibold text-[var(--ls-t3)]">
                    {s.titulo}
                  </label>
                  {!camposDeTextoBloqueados && cambiada && (
                    <button type="button" onClick={() => cambiarSeccion(s.clave, SECCIONES_BASE[s.clave])} className="inline-flex items-center gap-1 text-[11px] text-[var(--ls-t4)] hover:text-[var(--ls-t1)]">
                      <RotateCcw className="h-3 w-3" aria-hidden /> Volver al texto original
                    </button>
                  )}
                </div>
                <textarea
                  id={`seccion-${s.clave}`}
                  value={secciones[s.clave]}
                  onChange={(e) => cambiarSeccion(s.clave, e.target.value)}
                  rows={s.filas}
                  disabled={camposDeTextoBloqueados}
                  placeholder={s.clave === 'extra' ? 'Vacío: no añade nada.' : undefined}
                  spellCheck
                  className={`${CAJA} font-[inherit]`}
                />
                <p className={AYUDA}>{s.ayuda}</p>
              </div>
            )
          })}
          {avisos.map((a) => (
            <p key={a} className="text-[12px] leading-snug text-[var(--ls-e-ambar)]" role="alert">
              {a}
            </p>
          ))}
          <details className="rounded-[8px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-3 py-2 text-[12px] text-[var(--ls-t3)]">
            <summary className="cursor-pointer select-none font-medium text-[var(--ls-t2)]">Reglas que no se pueden quitar (van en todas las versiones)</summary>
            <p className="mt-2 text-[11.5px] text-[var(--ls-t4)]">La IA las recibe siempre, escribas lo que escribas arriba. Además, lo que devuelve se revisa: si habla de dinero se descarta.</p>
            <pre className="mt-2 whitespace-pre-wrap font-[inherit] text-[11.5px] leading-relaxed">{[PRESENTACION_FIJA, REGLAS_FIJAS, REGLA_DE_INDICACIONES].join('\n\n')}</pre>
          </details>
        </div>

        {/* Ejemplos */}
        <div>
          <h3 className="text-[13px] font-semibold text-[var(--ls-t1)]">Ejemplos que se le enseñan</h3>
          <p className={AYUDA}>Tus correos de «Mis ejemplos» que esta versión enseña a la IA (hasta 4 en cada correo; los tuyos van primero).</p>
          <div className="mt-2 space-y-1.5">
            {ejemplos.length === 0 ? (
              <p className="text-[12px] text-[var(--ls-t4)]">Todavía no has escrito ninguno: ve a «Mis ejemplos».</p>
            ) : (
              ejemplos.map((e) => (
                <label key={e.id} className={`flex items-start gap-2 rounded-[6px] px-2 py-1.5 text-[12.5px] ${camposDeTextoBloqueados ? 'opacity-70' : 'cursor-pointer hover:bg-[var(--ls-sup2)]'}`}>
                  <input
                    type="checkbox"
                    checked={ejemplosIds.includes(e.id)}
                    onChange={() => alternarEjemplo(e.id)}
                    disabled={camposDeTextoBloqueados}
                    className="mt-0.5 h-3.5 w-3.5 accent-[var(--ls-acc-graf)]"
                  />
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-[var(--ls-t1)]">{e.titulo}</span>
                    <span className="block truncate text-[11.5px] text-[var(--ls-t4)]">
                      {e.asunto} · {e.tipo === 'entrar' ? 'para quien aún no vende en Amazon' : e.tipo === 'optimizar' ? 'para quien ya vende' : 'para cualquiera'}
                      {e.activo ? '' : ' · desactivado'}
                    </span>
                  </span>
                </label>
              ))
            )}
          </div>
          <label className={`mt-2 flex items-start gap-2 text-[12.5px] text-[var(--ls-t2)] ${camposDeTextoBloqueados ? 'opacity-70' : 'cursor-pointer'}`}>
            <input type="checkbox" checked={usarGanadores} onChange={(e) => setUsarGanadores(e.target.checked)} disabled={camposDeTextoBloqueados} className="mt-0.5 h-3.5 w-3.5 accent-[var(--ls-acc-graf)]" />
            <span>
              Que además aprenda de los correos del equipo que consiguieron respuesta
              <span className="block text-[11.5px] text-[var(--ls-t4)]">Si lo quitas y no eliges ejemplos, la IA escribe solo con las instrucciones.</span>
            </span>
          </label>
        </div>

        {/* Modelo */}
        <div>
          <label htmlFor="version-modelo" className={ETIQUETA}>
            Modelo de IA
          </label>
          <select
            id="version-modelo"
            value={modelo ?? ''}
            onChange={(e) => setModelo(e.target.value === '' ? null : e.target.value)}
            disabled={camposDeTextoBloqueados}
            className="h-8 w-full max-w-sm cursor-pointer rounded-[6px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-2 text-[12.5px] text-[var(--ls-t1)] outline-none hover:border-[var(--ls-linea2)] focus:border-[var(--ls-acc-graf)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {MODELOS_DEL_EDITOR.map((m) => (
              <option key={m.id ?? 'defecto'} value={m.id ?? ''} className="bg-[var(--ls-sup)]">
                {m.nombre}
              </option>
            ))}
          </select>
          <p className={AYUDA}>Cuesta unos {centimos(costePorCorreo)} por correo (precios de rastreadores de terceros; compruébalos en tu cuenta de OpenAI).</p>
        </div>

        {error && (
          <p className="text-[12.5px] leading-snug text-[var(--ls-e-ambar)]" role="alert">
            {error}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2 border-t border-[var(--ls-linea)] pt-3">
          <button type="button" onClick={() => void guardar()} disabled={guardando} className={BOTON_PRIMARIO}>
            {guardando ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Save className="h-3.5 w-3.5" aria-hidden />}
            {esNueva ? 'Crear versión' : 'Guardar cambios'}
          </button>
          {!esNueva && (
            <button type="button" onClick={() => void duplicar()} disabled={guardando} className={BOTON_SECUNDARIO}>
              <Copy className="h-3.5 w-3.5" aria-hidden /> Duplicar
            </button>
          )}
          {!esNueva && !version.archivada && (
            confirmaGanadora ? (
              <span className="inline-flex items-center gap-2 text-[12.5px] text-[var(--ls-t2)]">
                Todo el equipo usará esta y las demás se pausan.
                <button type="button" onClick={() => void declararGanadora()} disabled={guardando} className={BOTON_PRIMARIO}>
                  Sí, que todos usen ésta
                </button>
                <button type="button" onClick={() => setConfirmaGanadora(false)} className="text-[12px] text-[var(--ls-t4)] hover:text-[var(--ls-t1)]">
                  Cancelar
                </button>
              </span>
            ) : (
              <button type="button" onClick={() => setConfirmaGanadora(true)} disabled={guardando} className={BOTON_SECUNDARIO} title="Pone esta versión en marcha con todo el reparto y pausa las demás">
                <Trophy className="h-3.5 w-3.5 text-[var(--ls-acc)]" aria-hidden /> Que todos usen ésta
              </button>
            )
          )}
          {!esNueva && !esBase && (
            <button type="button" onClick={() => void archivar(!version.archivada)} disabled={guardando} className={`${BOTON_SECUNDARIO} ml-auto`}>
              {version.archivada ? <ArchiveRestore className="h-3.5 w-3.5" aria-hidden /> : <Archive className="h-3.5 w-3.5" aria-hidden />}
              {version.archivada ? 'Restaurar' : 'Archivar'}
            </button>
          )}
        </div>
      </div>

      {/* La prueba, siempre a la vista mientras se edita */}
      <div id="panel-de-prueba-correo" className="scroll-mt-3 lg:sticky lg:top-3 lg:max-h-[calc(100vh-1.5rem)] lg:overflow-y-auto lg:pr-1">
        <PanelDePruebaDeCorreo casos={casos} configuracion={{ secciones, ejemplosIds, usarGanadores, modelo }} />
      </div>
    </div>
  )
}
