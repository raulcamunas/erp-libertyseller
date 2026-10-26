'use client'

import { FlaskConical, Loader2, Play } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { enviarJson } from '@/components/correo/api'
import { BuscadorDeLead, type LeadElegido } from '@/components/ia-laboratorio/BuscadorDeLead'
import { BOTON } from '@/lib/estilo/denso'
import type { CorreoDePrueba, RespuestaDePruebaConCasos } from '@/lib/correo/ia-laboratorio-tipos'
import type { SeccionesDeInstrucciones } from '@/lib/correo/ia-prompt'
import { costeAproximado } from '@/lib/correo/ia-version'
import { conLimite } from '@/lib/ia/concurrencia'
import { enCentimos } from '@/lib/ia/precios'
import type { CasoVista } from '@/lib/whatsapp/ia-casos'
import { AYUDA, CAJA, ETIQUETA } from './ui'
import { ResultadoDeCorreo } from './ResultadoDeCorreo'

/**
 * EL PANEL DE PRUEBA DEL CORREO: siempre a la vista a la derecha del editor.
 *
 * Se eligen las PERSONAS DE PRUEBA (diez leads inventados con su historial: sin Amazon, que ya vende, que no coge el teléfono, con una llamada de por medio, con una nota que intenta dar
 * órdenes…; son las mismas que usa la IA de WhatsApp, así que se puede comparar un canal con el otro), y si se quiere un lead real, y se pulsa «Probar»: sale un correo por persona con
 * lo que hay en el editor AHORA, aunque no esté guardado. No se envía ni se guarda nada. Con «también los seguimientos» sale además lo que saldría SOLO si no contesta, a los 3 y a los 7
 * días hábiles: el hilo entero de la secuencia, con todo lo que la IA sabe de cada persona.
 *
 * Cada persona se pide por separado y de tres en tres: los correos van saliendo según se escriben (con los seguimientos cada uno tarda medio minuto), y uno que falle no tumba a los demás.
 * Lo probado queda ligado al contenido del editor: si se cambia algo, los resultados se marcan como viejos hasta volver a probar.
 */

export interface ConfiguracionAProbar {
  secciones: SeccionesDeInstrucciones
  ejemplosIds: string[]
  usarGanadores: boolean
  modelo: string | null
}

const URL_DE_PRUEBA = '/api/correo/laboratorio/probar-casos'
const A_LA_VEZ = 3
/** Lo que gasta un correo normal con los datos de un lead (medido con las pruebas reales): unos 3.100 tokens de entrada y 210 de salida */
const ENTRADA_TIPICA = 3100
const SALIDA_TIPICA = 210

const media = (xs: number[]) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length)

export function PanelDePruebaDeCorreo({ casos, configuracion }: { casos: CasoVista[]; configuracion: ConfiguracionAProbar }) {
  const [seleccion, setSeleccion] = useState<string[]>(() => casos.slice(0, 3).map((c) => c.id))
  const [lead, setLead] = useState<LeadElegido | null>(null)
  const [indicaciones, setIndicaciones] = useState('')
  const [conSeguimientos, setConSeguimientos] = useState(false)
  const [resultados, setResultados] = useState<Record<string, CorreoDePrueba>>({})
  const [probando, setProbando] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [avisos, setAvisos] = useState<string[]>([])
  const [huellaProbada, setHuellaProbada] = useState<string | null>(null)
  const turno = useRef(0)

  const huella = useMemo(() => JSON.stringify([configuracion, indicaciones.trim(), conSeguimientos]), [configuracion, indicaciones, conSeguimientos])
  const viejo = huellaProbada !== null && huellaProbada !== huella
  const ocupado = probando.size > 0
  const nProbar = seleccion.length + (lead ? 1 : 0)
  const costePorCorreo = costeAproximado(configuracion.modelo ?? 'gpt-5.6-terra', { entrada: ENTRADA_TIPICA, salida: SALIDA_TIPICA })

  // Si las personas llegan después de montar el panel (la lista se lee de la base), se eligen las tres primeras una vez
  const primeraVez = useRef(true)
  useEffect(() => {
    if (primeraVez.current && casos.length > 0) {
      setSeleccion(casos.slice(0, 3).map((c) => c.id))
      primeraVez.current = false
    }
  }, [casos])

  const alternar = (id: string) => setSeleccion((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))

  async function probar(ids: string[], conLeadReal: boolean) {
    const claves = [...ids, ...(conLeadReal && lead ? ['lead'] : [])]
    if (claves.length === 0 || ocupado) return
    const mio = ++turno.current
    setProbando(new Set(claves))
    setError(null)
    // Si lo que hay en el editor ya no es lo que se probó, los de antes se tiran: no se mezclan dos versiones en la misma lista
    const nuevaHuella = huella !== huellaProbada
    if (nuevaHuella) setResultados({})
    setHuellaProbada(huella)
    setAvisos([])

    await conLimite(claves, A_LA_VEZ, async (clave) => {
      const cuerpo = { ...configuracion, ...(clave === 'lead' ? { leadId: lead?.id } : { casoIds: [clave] }), indicaciones: indicaciones.trim() || undefined, seguimientos: conSeguimientos }
      const r = await enviarJson<RespuestaDePruebaConCasos>(URL_DE_PRUEBA, 'POST', cuerpo)
      if (mio !== turno.current) return
      if (!r.ok) {
        setError(r.mensaje)
      } else {
        const resultado = r.datos.resultados[0]
        if (resultado) setResultados((rs) => ({ ...rs, [clave]: resultado }))
        setAvisos((a) => [...new Set([...a, ...r.datos.avisos])])
      }
      setProbando((p) => {
        const n = new Set(p)
        n.delete(clave)
        return n
      })
    })
  }

  const filas = casos.filter((c) => resultados[c.id] || probando.has(c.id))
  const rs = Object.values(resultados)
  const conCorreo = rs.filter((r) => r.ok)
  const coste = rs.reduce((s, r) => s + (r.coste ?? 0) + (r.seguimientosCoste ?? 0), 0)

  return (
    <section aria-label="Probar" className="space-y-3 rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] p-3">
      <div>
        <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-[var(--ls-t1)]">
          <FlaskConical className="h-3.5 w-3.5 text-[var(--ls-acc)]" aria-hidden /> Probar con personas de prueba
        </h3>
        <p className={AYUDA}>Escribe un correo por persona con lo que hay en el editor ahora mismo, aunque no esté guardado. No se envía ni se guarda nada.</p>
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <span className="text-[11.5px] font-semibold text-[var(--ls-t3)]">
            Personas ({seleccion.length} de {casos.length})
          </span>
          <span className="flex gap-2 text-[11.5px]">
            <button type="button" onClick={() => setSeleccion(casos.map((c) => c.id))} className="text-[var(--ls-t4)] hover:text-[var(--ls-t1)]">
              Todas
            </button>
            <button type="button" onClick={() => setSeleccion([])} className="text-[var(--ls-t4)] hover:text-[var(--ls-t1)]">
              Ninguna
            </button>
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Personas de prueba">
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
        <BuscadorDeLead lead={lead} onElegir={setLead} conCampo="email" />
      </div>

      <div>
        <label htmlFor="probar-indicaciones" className={ETIQUETA}>
          Qué le pides al correo (opcional)
        </label>
        <textarea id="probar-indicaciones" value={indicaciones} onChange={(e) => setIndicaciones(e.target.value.slice(0, 600))} rows={2} placeholder="Como haría un comercial: «más corto», «menciona la llamada»…" className={CAJA} />
      </div>

      <label className="flex cursor-pointer items-start gap-2 text-[12.5px] text-[var(--ls-t2)]">
        <input type="checkbox" checked={conSeguimientos} onChange={(e) => setConSeguimientos(e.target.checked)} className="mt-0.5 h-3.5 w-3.5 accent-[var(--ls-acc-graf)]" />
        <span>
          <span className="font-medium text-[var(--ls-t1)]">Escribir también los seguimientos</span>
          <span className="block text-[11.5px] text-[var(--ls-t4)]">Lo que saldría solo si no contesta, a los 3 y a los 7 días hábiles: el hilo entero de la secuencia para cada persona.</span>
        </span>
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => void probar(seleccion, lead !== null)} disabled={nProbar === 0 || ocupado} className={`${BOTON.base} ${BOTON.primario} !h-8 !px-3 !text-[12.5px]`}>
          {ocupado ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Play className="h-3.5 w-3.5" aria-hidden />}
          {ocupado ? `Escribiendo… (${nProbar - probando.size} de ${nProbar})` : nProbar === 0 ? 'Elige a quién escribir' : nProbar === 1 ? 'Probar 1 correo' : `Probar ${nProbar} correos`}
        </button>
        {!ocupado && nProbar > 0 && costePorCorreo !== null && (
          <span className="text-[11.5px] text-[var(--ls-t4)]">
            Unos {enCentimos(costePorCorreo * nProbar)}
            {conSeguimientos ? ' y algo más por los seguimientos' : ''}
          </span>
        )}
      </div>

      {error && (
        <p role="alert" className="text-[12px] leading-snug text-[var(--ls-e-ambar)]">
          {error}
        </p>
      )}

      {(rs.length > 0 || ocupado) && (
        <div className="space-y-2.5 border-t border-[var(--ls-linea)] pt-3">
          {viejo && (
            <p role="status" className="rounded-[8px] border border-[var(--ls-e-ambar)] px-2.5 py-1.5 text-[12px] leading-snug text-[var(--ls-e-ambar)]">
              Has cambiado algo desde esta prueba: estos correos son de antes. Vuelve a probar para ver cómo queda.
            </p>
          )}
          {rs.length > 0 && (
            <p className={`text-[12px] leading-snug text-[var(--ls-t3)] ${viejo ? 'opacity-60' : ''}`}>
              <strong className={conCorreo.length === rs.length ? 'text-[var(--ls-e-verde)]' : 'text-[var(--ls-e-ambar)]'}>
                {conCorreo.length} de {rs.length}
              </strong>{' '}
              con correo · {(media(rs.map((r) => r.ms)) / 1000).toLocaleString('es-ES', { maximumFractionDigits: 1 })} s de media · {enCentimos(coste)} en total
            </p>
          )}
          {avisos.map((a) => (
            <p key={a} className="text-[11.5px] leading-snug text-[var(--ls-e-ambar)]">
              {a}
            </p>
          ))}
          <div className={`space-y-2.5 ${viejo ? 'opacity-60' : ''}`}>
            {filas.map((c) => (
              <ResultadoDeCorreo key={c.id} caso={c} resultado={resultados[c.id]} probando={probando.has(c.id)} onRepetir={() => void probar([c.id], false)} />
            ))}
            {(resultados.lead || probando.has('lead')) && lead && (
              <ResultadoDeCorreo
                caso={{ etiqueta: resultados.lead?.etiqueta ?? lead.store_name, mirar: 'El lead real: lee lo que dice su historial y comprueba que el correo lo respeta.', descripcion: 'Un lead real de tu cartera' }}
                resultado={resultados.lead}
                probando={probando.has('lead')}
                onRepetir={() => void probar([], true)}
              />
            )}
          </div>
        </div>
      )}
    </section>
  )
}
