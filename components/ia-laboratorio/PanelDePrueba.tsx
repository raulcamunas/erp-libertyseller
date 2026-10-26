'use client'

import { ChevronDown, FlaskConical, GitCompareArrows, Loader2, Play } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { enviarJson } from '@/components/correo/api'
import { BOTON } from '@/lib/estilo/denso'
import { enCentimos } from '@/lib/ia/precios'
import type { CasoVista } from '@/lib/whatsapp/ia-casos'
import type { RespuestaDePrueba, ResultadoDePrueba } from '@/lib/whatsapp/ia-laboratorio-tipos'
import type { PerfilDeWhatsapp } from '@/lib/whatsapp/ia-perfil'
import type { BloqueDelEncargo } from '@/lib/whatsapp/ia-prompt'
import { ETIQUETA_DE_SITUACION, SITUACIONES_DE_WHATSAPP, type SituacionDeWhatsapp } from '@/lib/whatsapp/mensajes'
import { AYUDA } from '../correo-laboratorio/ui'
import { Anatomia, LeyendaDePrioridad } from './Anatomia'
import { BuscadorDeLead, type LeadElegido } from './BuscadorDeLead'
import { ResultadoDeCaso } from './ResultadoDeCaso'

/**
 * EL PANEL DE PRUEBA: la mitad de la pantalla que siempre está a la vista mientras se edita.
 *
 * Se eligen los casos (los diez de prueba, o los que se quieran, y si se quiere un lead real), se pulsa «Probar» y cada uno sale con el mensaje que escribiría la IA con lo que hay en
 * el editor AHORA, aunque no esté guardado. No se envía ni se guarda nada. Con «Comparar» sale a su lado el mensaje de la versión que usa el equipo, que es la forma más rápida de saber
 * si lo que se ha tocado mejora o empeora: los mismos casos, las dos versiones.
 *
 * Lo probado queda ligado al contenido del editor (`huella`): en cuanto se cambia algo, los resultados se marcan como viejos hasta volver a probar, y el padre sabe si la última prueba de
 * lo que hay ahora salió bien (para pedirla antes de publicar: una configuración que la API rechaza dejaría a todo el equipo sin mensajes).
 */

const URL_DE_PRUEBA = '/api/correo/laboratorio/whatsapp/probar'

interface Props {
  casos: CasoVista[]
  perfil: PerfilDeWhatsapp
  /** La versión que usa el equipo, para comparar. null si no se conoce. Si cambia (se publica otra), lo comparado hasta entonces ya no vale */
  produccion: { id: string; nombre: string } | null
  /** Lo que hay en el editor ES la versión que usa el equipo: comparar con ella misma no dice nada */
  esLaDeProduccion: boolean
  /** Se ha probado lo que hay en el editor: su huella y si todos los casos probados salieron con mensaje */
  onProbado: (huella: string, todoBien: boolean) => void
  onEditar: (editor: string) => void
}

const media = (xs: number[]) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length)
const segundos = (ms: number) => (ms / 1000).toLocaleString('es-ES', { maximumFractionDigits: 1 })

function Resumen({ titulo, rs }: { titulo?: string; rs: ResultadoDePrueba[] }) {
  if (rs.length === 0) return null
  const conMensaje = rs.filter((r) => r.ok)
  const conAviso = conMensaje.filter((r) => r.aviso).length
  const coste = rs.reduce((s, r) => s + (r.coste ?? 0), 0)
  const costeMax = rs.reduce((s, r) => s + (r.costeMaximo ?? 0), 0)
  return (
    <p className="text-[12px] leading-snug text-[var(--ls-t3)]">
      {titulo && <span className="mr-1.5 font-semibold text-[var(--ls-t2)]">{titulo}:</span>}
      <strong className={conMensaje.length === rs.length ? 'text-[var(--ls-e-verde)]' : 'text-[var(--ls-e-ambar)]'}>
        {conMensaje.length} de {rs.length}
      </strong>{' '}
      con mensaje · {segundos(media(rs.map((r) => r.ms)))} s de media · {conMensaje.length > 0 ? Math.round(media(conMensaje.map((r) => r.palabras))) : 0} palabras de media · {enCentimos(coste)} en total (hasta {enCentimos(costeMax)} sin caché)
      {conAviso > 0 ? ` · ${conAviso} con aviso` : ''}
    </p>
  )
}

export function PanelDePrueba({ casos, perfil, produccion, esLaDeProduccion, onProbado, onEditar }: Props) {
  const [seleccion, setSeleccion] = useState<string[]>(() => casos.map((c) => c.id))
  const [lead, setLead] = useState<LeadElegido | null>(null)
  const [momentoDelLead, setMomentoDelLead] = useState<SituacionDeWhatsapp | null>(null)
  const [comparar, setComparar] = useState(false)
  const [resultados, setResultados] = useState<Record<string, ResultadoDePrueba>>({})
  const [deProduccion, setDeProduccion] = useState<Record<string, ResultadoDePrueba>>({})
  const [sistema, setSistema] = useState<BloqueDelEncargo[]>([])
  const [probando, setProbando] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [avisos, setAvisos] = useState<string[]>([])
  const [verInstrucciones, setVerInstrucciones] = useState(false)
  /** El contenido del editor con el que se probó lo que se ve */
  const [huellaProbada, setHuellaProbada] = useState<string | null>(null)
  const turno = useRef(0)

  const huella = useMemo(() => JSON.stringify(perfil), [perfil])
  const viejo = huellaProbada !== null && huellaProbada !== huella
  const puedeComparar = produccion !== null && !esLaDeProduccion

  // Al publicar otra versión, lo que se comparó era contra la anterior: se tira para no enseñarlo como «la que usa el equipo»
  const idDeProduccion = produccion?.id ?? null
  useEffect(() => {
    setDeProduccion({})
  }, [idDeProduccion])

  // Si los casos cambian (llegan de la base), se eligen todos otra vez; una vez elegidos a mano, se respeta
  const primeraVez = useRef(true)
  useEffect(() => {
    if (primeraVez.current && casos.length > 0) {
      setSeleccion(casos.map((c) => c.id))
      primeraVez.current = false
    }
  }, [casos])

  const alternar = (id: string) => setSeleccion((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))

  const probar = useCallback(
    async (ids: string[], conLead: boolean) => {
      if ((ids.length === 0 && !conLead) || probando.size > 0) return
      const mio = ++turno.current
      const claves = [...ids, ...(conLead ? ['lead'] : [])]
      setProbando(new Set(claves))
      setError(null)
      // Si lo que hay en el editor ya no es lo que se probó, los resultados de antes se tiran: no se mezclan dos versiones
      const nuevaHuella = huella !== huellaProbada
      if (nuevaHuella) setResultados({})
      const base = { casoIds: ids, ...(conLead && lead ? { leadId: lead.id, ...(momentoDelLead ? { situacion: momentoDelLead } : {}) } : {}) }
      const [mia, suya] = await Promise.all([
        enviarJson<RespuestaDePrueba>(URL_DE_PRUEBA, 'POST', { ...base, perfil }),
        comparar && puedeComparar ? enviarJson<RespuestaDePrueba>(URL_DE_PRUEBA, 'POST', { ...base, enProduccion: true }) : Promise.resolve(null),
      ])
      if (mio !== turno.current) return
      setProbando(new Set())
      if (!mia.ok) {
        setError(mia.mensaje)
        return
      }
      const clave = (r: ResultadoDePrueba) => (r.real ? 'lead' : r.id)
      const nuevos = Object.fromEntries(mia.datos.resultados.map((r) => [clave(r), r]))
      const juntos = { ...(nuevaHuella ? {} : resultados), ...nuevos }
      setResultados(juntos)
      setSistema(mia.datos.sistema)
      setAvisos(mia.datos.avisos)
      setHuellaProbada(huella)
      if (suya) {
        if (suya.ok) setDeProduccion((d) => ({ ...d, ...Object.fromEntries(suya.datos.resultados.map((r) => [clave(r), r])) }))
        else setError(`No se ha podido probar la versión que usa el equipo: ${suya.mensaje}`)
      }
      const todos = Object.values(juntos)
      onProbado(huella, todos.length > 0 && todos.every((r) => r.ok))
    },
    [huella, huellaProbada, lead, momentoDelLead, comparar, puedeComparar, perfil, probando.size, resultados, onProbado]
  )

  const visibles = casos.filter((c) => resultados[c.id] || probando.has(c.id) || seleccion.includes(c.id))
  const filas = [...visibles.filter((c) => seleccion.includes(c.id) || resultados[c.id])]
  const hayResultados = Object.keys(resultados).length > 0
  const nProbar = seleccion.length + (lead ? 1 : 0)
  const ocupado = probando.size > 0
  const rsMios = Object.values(resultados)
  const rsSuyos = comparar && puedeComparar ? Object.values(deProduccion).filter((r) => resultados[r.real ? 'lead' : r.id]) : []

  return (
    <section aria-label="Probar" className="space-y-3 rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] p-3">
      <div>
        <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-[var(--ls-t1)]">
          <FlaskConical className="h-3.5 w-3.5 text-[var(--ls-acc)]" aria-hidden /> Probar
        </h3>
        <p className={AYUDA}>Escribe un mensaje por cada caso con lo que hay en el editor ahora mismo, aunque no esté guardado. No se envía ni se guarda nada.</p>
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <span className="text-[11.5px] font-semibold text-[var(--ls-t3)]">Casos de prueba ({seleccion.length} de {casos.length})</span>
          <span className="flex gap-2 text-[11.5px]">
            <button type="button" onClick={() => setSeleccion(casos.map((c) => c.id))} className="text-[var(--ls-t4)] hover:text-[var(--ls-t1)]">
              Todos
            </button>
            <button type="button" onClick={() => setSeleccion([])} className="text-[var(--ls-t4)] hover:text-[var(--ls-t1)]">
              Ninguno
            </button>
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Casos de prueba">
          {casos.map((c) => {
            const marcado = seleccion.includes(c.id)
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => alternar(c.id)}
                aria-pressed={marcado}
                title={`${c.descripcion}\n\nQué mirar: ${c.mirar}`}
                className={`inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-[6px] border px-2 text-[11.5px] transition-colors ${
                  marcado ? 'border-[var(--ls-acc-graf)] bg-[var(--ls-acc-suave)] text-[var(--ls-t1)]' : 'border-[var(--ls-linea)] bg-[var(--ls-sup2)] text-[var(--ls-t4)] hover:text-[var(--ls-t2)]'
                }`}
              >
                {c.etiqueta}
              </button>
            )
          })}
        </div>
      </div>

      <div className="space-y-1.5">
        <span className="text-[11.5px] font-semibold text-[var(--ls-t3)]">Y, si quieres, un lead real</span>
        <BuscadorDeLead lead={lead} onElegir={(l) => { setLead(l); setMomentoDelLead(null) }} />
        {lead && (
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="En qué momento está este lead">
            <span className="text-[11.5px] text-[var(--ls-t4)]">Momento:</span>
            {[null, ...SITUACIONES_DE_WHATSAPP].map((m) => (
              <button
                key={m ?? 'auto'}
                type="button"
                onClick={() => setMomentoDelLead(m)}
                aria-pressed={momentoDelLead === m}
                className={`${BOTON.chip} !h-6 ${momentoDelLead === m ? BOTON.chipEncendido : ''}`}
              >
                {m ? ETIQUETA_DE_SITUACION[m] : 'El de su estado'}
              </button>
            ))}
          </div>
        )}
      </div>

      {puedeComparar && (
        <label className="flex cursor-pointer items-start gap-2 text-[12.5px] text-[var(--ls-t2)]">
          <input type="checkbox" checked={comparar} onChange={(e) => setComparar(e.target.checked)} className="mt-0.5 h-3.5 w-3.5 accent-[var(--ls-acc-graf)]" />
          <span>
            <span className="inline-flex items-center gap-1 font-medium text-[var(--ls-t1)]">
              <GitCompareArrows className="h-3.5 w-3.5" aria-hidden /> Comparar con la versión que usa el equipo
            </span>
            <span className="block text-[11.5px] text-[var(--ls-t4)]">«{produccion?.nombre}»: los mismos casos con las dos, lado a lado.</span>
          </span>
        </label>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => void probar(seleccion, lead !== null)} disabled={nProbar === 0 || ocupado} className={`${BOTON.base} ${BOTON.primario} !h-8 !px-3 !text-[12.5px]`}>
          {ocupado ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Play className="h-3.5 w-3.5" aria-hidden />}
          {ocupado ? 'Escribiendo…' : nProbar === 0 ? 'Elige algo que probar' : nProbar === 1 ? 'Probar 1 caso' : `Probar ${nProbar} casos`}
        </button>
        {ocupado && <span className="text-[11.5px] text-[var(--ls-t4)]">Unos segundos: se escriben de cuatro en cuatro.</span>}
      </div>

      {error && (
        <p role="alert" className="text-[12px] leading-snug text-[var(--ls-e-ambar)]">
          {error}
        </p>
      )}

      {hayResultados && (
        <div className="space-y-2.5 border-t border-[var(--ls-linea)] pt-3">
          {viejo && (
            <p role="status" className="rounded-[8px] border border-[var(--ls-e-ambar)] px-2.5 py-1.5 text-[12px] leading-snug text-[var(--ls-e-ambar)]">
              Has cambiado algo desde esta prueba: estos mensajes son de antes. Vuelve a probar para ver cómo queda.
            </p>
          )}
          <div className={`space-y-1 ${viejo ? 'opacity-60' : ''}`}>
            <Resumen titulo={comparar && rsSuyos.length > 0 ? 'Esta versión' : undefined} rs={rsMios} />
            {comparar && rsSuyos.length > 0 && <Resumen titulo="La que usa el equipo" rs={rsSuyos} />}
          </div>
          {avisos.map((a) => (
            <p key={a} className="text-[11.5px] leading-snug text-[var(--ls-e-ambar)]">
              {a}
            </p>
          ))}
          <div className={`space-y-2.5 ${viejo ? 'opacity-60' : ''}`}>
            {filas.map((c) => (
              <ResultadoDeCaso
                key={c.id}
                caso={c}
                resultado={resultados[c.id]}
                produccion={deProduccion[c.id]}
                comparando={comparar && puedeComparar}
                probando={probando.has(c.id)}
                onRepetir={() => void probar([c.id], false)}
                onEditar={onEditar}
              />
            ))}
            {resultados.lead && lead && (
              <ResultadoDeCaso
                caso={{ etiqueta: resultados.lead.etiqueta, mirar: 'El lead real: lee lo que dice su historial y comprueba que el mensaje lo respeta.', descripcion: 'Un lead real de tu cartera' }}
                resultado={resultados.lead}
                produccion={deProduccion.lead}
                comparando={comparar && puedeComparar}
                probando={probando.has('lead')}
                onRepetir={() => void probar([], true)}
                onEditar={onEditar}
              />
            )}
          </div>

          {sistema.length > 0 && (
            <div>
              <button type="button" onClick={() => setVerInstrucciones((v) => !v)} aria-expanded={verInstrucciones} className="inline-flex items-center gap-1 text-[12px] font-medium text-[var(--ls-t3)] hover:text-[var(--ls-t1)]">
                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${verInstrucciones ? '' : '-rotate-90'}`} aria-hidden /> Todas las instrucciones que recibió la IA
              </button>
              {verInstrucciones && (
                <div className="mt-2 space-y-2.5">
                  <LeyendaDePrioridad />
                  <Anatomia bloques={sistema} onEditar={onEditar} titulo="Instrucciones (las mismas en todos los mensajes)" ayuda="Es lo primero que lee la IA. Se compone de lo fijo, de tus textos y de lo que sale de los ajustes." />
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
