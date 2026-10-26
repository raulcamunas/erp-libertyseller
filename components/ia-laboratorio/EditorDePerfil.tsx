'use client'

import { RotateCcw, TriangleAlert } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { ESFUERZOS_DE_IA, type EsfuerzoDeIa } from '@/lib/ia/modelo'
import { costeDeUso, enCentimos } from '@/lib/ia/precios'
import type { ModeloVista } from '@/lib/whatsapp/ia-laboratorio-tipos'
import {
  EJEMPLOS_DE_SERIE,
  MODOS_DE_EJEMPLOS,
  MOMENTOS_DE_SERIE,
  SECCIONES_DE_WHATSAPP,
  MANDO_DE_EMOJIS,
  MANDO_DE_INSISTENCIA,
  MANDO_DE_LONGITUD,
  MANDO_DE_TONO,
  validarPerfilDeWhatsapp,
  type AjustesDeWhatsapp,
  type ClaveDeSeccionDeWhatsapp,
  type ModoDeEjemplos,
  type PerfilDeWhatsapp,
} from '@/lib/whatsapp/ia-perfil'
import { AYUDA_DE_SITUACION, ETIQUETA_DE_SITUACION, SITUACIONES_DE_WHATSAPP, type SituacionDeWhatsapp } from '@/lib/whatsapp/mensajes'
import { AYUDA, CAJA, ETIQUETA } from '../correo-laboratorio/ui'
import { Mandos } from './Mandos'
import { Tarjeta } from './ui'

/**
 * EL EDITOR DEL PERFIL DE LA IA DE WHATSAPP: cinco tarjetas que se pliegan.
 *
 *   1. Ajustes rápidos       los mandos (tono, longitud, insistencia, emojis, variar). Lo más cómodo: un clic y se lee la frase que se le dice a la IA.
 *   2. Cada momento          qué se espera del mensaje cuando es el primero, cuando no contesta y después de hablar.
 *   3. Textos                qué hacemos, cómo escribe, cómo persuade, cómo usa el historial y lo extra.
 *   4. Ejemplos de tono      los de serie (según el tono), los tuyos o ninguno.
 *   5. Modelo                qué modelo, cuánto razona y cuánto cuesta un mensaje con ello.
 *
 * Valida con la MISMA función que el servidor (ia-perfil.ts): lo que aquí se ve como aviso o error es lo que diría el servidor al guardar. Una versión que ya ha estado en producción no se
 * modifica nunca, pero eso no lo decide este editor: la pantalla de arriba (CalibradorDeWhatsapp) abre una copia al primer cambio, así que aquí siempre se puede escribir.
 */

interface Props {
  perfil: PerfilDeWhatsapp
  serie: PerfilDeWhatsapp
  modelos: ModeloVista[]
  /** Los campos se ven pero no se tocan. La pantalla no lo usa: al editar una versión que no se modifica abre una copia */
  deshabilitado?: boolean
  onCambio: (perfil: PerfilDeWhatsapp) => void
  /** Pedir que se abra y se enseñe una tarjeta (desde «editar» en las instrucciones). `n` cambia con cada petición para que repetir la misma funcione */
  abrir?: { id: string; n: number } | null
}

const TARJETAS = ['ajustes', 'momentos', 'textos', 'ejemplos', 'modelo'] as const
type IdDeTarjeta = (typeof TARJETAS)[number]

/** A qué tarjeta pertenece lo que escribe cada bloque de las instrucciones (el `editor` de ia-prompt.ts) */
export function tarjetaDelEditor(editor: string): IdDeTarjeta | null {
  if (editor === 'ajustes') return 'ajustes'
  if (editor === 'momentos') return 'momentos'
  if (editor === 'ejemplos') return 'ejemplos'
  if (editor === 'modelo') return 'modelo'
  if (['queHacemos', 'comoEscribes', 'comoPersuades', 'usoDelHistorial', 'extra'].includes(editor)) return 'textos'
  return null
}

function resumenDeAjustes(a: AjustesDeWhatsapp): string {
  const etiqueta = (m: { opciones: ReadonlyArray<{ valor: string; etiqueta: string }> }, v: string) => m.opciones.find((o) => o.valor === v)?.etiqueta ?? v
  return [etiqueta(MANDO_DE_TONO, a.tono), etiqueta(MANDO_DE_LONGITUD, a.longitud), `petición ${etiqueta(MANDO_DE_INSISTENCIA, a.insistencia).toLowerCase()}`, etiqueta(MANDO_DE_EMOJIS, a.emojis) === 'Ninguno' ? 'sin emojis' : 'un emoji', a.variar ? 'variando la forma' : 'sin variar'].join(' · ')
}

/** Tokens de una llamada normal de WhatsApp (medidos con la API real): unos 2.500 de entrada, de los que unos 2.000 van en caché, y lo que escribe y lo que piensa */
const ENTRADA_TIPICA = 2500
const CACHE_TIPICA = 2000
const SALIDA_SIN_PENSAR = 100
const SALIDA_PENSANDO: Record<EsfuerzoDeIa, number> = { none: 100, low: 300, medium: 700, high: 1500, xhigh: 3000 }

export function EditorDePerfil({ perfil, serie, modelos, deshabilitado = false, onCambio, abrir }: Props) {
  const [abiertas, setAbiertas] = useState<Set<IdDeTarjeta>>(new Set(['ajustes']))
  const validacion = useMemo(() => validarPerfilDeWhatsapp(perfil), [perfil])

  // Desde las instrucciones: «editar» abre la tarjeta que escribe ese bloque y baja hasta ella
  useEffect(() => {
    if (!abrir) return
    const t = tarjetaDelEditor(abrir.id)
    if (!t) return
    setAbiertas((a) => new Set(a).add(t))
    const espera = setTimeout(() => document.getElementById(abrir.id === 'ajustes' || abrir.id === 'momentos' || abrir.id === 'ejemplos' || abrir.id === 'modelo' ? `tarjeta-${t}` : `seccion-${abrir.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60)
    return () => clearTimeout(espera)
  }, [abrir])

  const alternar = (t: IdDeTarjeta) => setAbiertas((a) => {
    const n = new Set(a)
    if (n.has(t)) n.delete(t)
    else n.add(t)
    return n
  })
  const cambiar = (cambios: Partial<PerfilDeWhatsapp>) => onCambio({ ...perfil, ...cambios })
  const cambiarSeccion = (clave: ClaveDeSeccionDeWhatsapp, valor: string) => onCambio({ ...perfil, secciones: { ...perfil.secciones, [clave]: valor } })
  const cambiarMomento = (s: SituacionDeWhatsapp, valor: string) => onCambio({ ...perfil, momentos: { ...perfil.momentos, [s]: valor } })

  const modelo = perfil.modelo ?? modelos[0]?.id ?? 'gpt-6-luna'
  const esfuerzo: EsfuerzoDeIa = perfil.esfuerzo ?? 'none'
  const coste = costeDeUso(modelo, { entrada: ENTRADA_TIPICA, cache: CACHE_TIPICA, salida: SALIDA_PENSANDO[esfuerzo] })
  const costeFrio = costeDeUso(modelo, { entrada: ENTRADA_TIPICA, salida: SALIDA_PENSANDO[esfuerzo] })
  const momentosCambiados = SITUACIONES_DE_WHATSAPP.filter((s) => perfil.momentos[s].trim() !== MOMENTOS_DE_SERIE[s].trim()).length
  const textosCambiados = SECCIONES_DE_WHATSAPP.filter((s) => s.clave !== 'ejemplos' && perfil.secciones[s.clave].trim() !== serie.secciones[s.clave].trim()).length

  return (
    <div className="space-y-2.5">
      {validacion.ok
        ? validacion.avisos.map((a) => (
            <p key={a} role="status" className="flex items-start gap-1.5 text-[12px] leading-snug text-[var(--ls-e-ambar)]">
              <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden /> {a}
            </p>
          ))
        : !deshabilitado && (
            <p role="alert" className="flex items-start gap-1.5 text-[12px] leading-snug text-[var(--ls-e-rojo)]">
              <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden /> {validacion.error}
            </p>
          )}

      <Tarjeta id="tarjeta-ajustes" titulo="Ajustes rápidos" ayuda="Lo más cómodo para calibrar: un clic por mando, sin escribir. Debajo de cada uno ves la frase que se le dice a la IA." resumen={resumenDeAjustes(perfil.ajustes)} abierta={abiertas.has('ajustes')} onAlternar={() => alternar('ajustes')}>
        <Mandos ajustes={perfil.ajustes} serie={serie.ajustes} deshabilitado={deshabilitado} onCambio={(c) => cambiar({ ajustes: { ...perfil.ajustes, ...c } })} />
        {JSON.stringify(perfil.ajustes) !== JSON.stringify(serie.ajustes) && !deshabilitado && (
          <button type="button" onClick={() => cambiar({ ajustes: { ...serie.ajustes } })} className="inline-flex items-center gap-1 text-[11.5px] text-[var(--ls-t4)] hover:text-[var(--ls-t1)]">
            <RotateCcw className="h-3 w-3" aria-hidden /> Volver a los ajustes de serie
          </button>
        )}
      </Tarjeta>

      <Tarjeta
        id="tarjeta-momentos"
        titulo="Qué se espera en cada momento"
        ayuda="La IA recibe el momento del lead (sale de su estado) y esto es lo que se le pide para ese caso. Puedes cambiar una, o las tres."
        resumen={momentosCambiados === 0 ? 'De serie' : `${momentosCambiados} cambiado${momentosCambiados === 1 ? '' : 's'}`}
        abierta={abiertas.has('momentos')}
        onAlternar={() => alternar('momentos')}
      >
        {SITUACIONES_DE_WHATSAPP.map((s) => (
          <div key={s}>
            <div className="mb-1 flex items-center justify-between gap-2">
              <label htmlFor={`momento-${s}`} className="text-[11.5px] font-semibold text-[var(--ls-t3)]" title={AYUDA_DE_SITUACION[s]}>
                {ETIQUETA_DE_SITUACION[s]} <span className="font-normal text-[var(--ls-t4)]">· {AYUDA_DE_SITUACION[s].toLowerCase()}</span>
              </label>
              {!deshabilitado && perfil.momentos[s].trim() !== MOMENTOS_DE_SERIE[s].trim() && (
                <button type="button" onClick={() => cambiarMomento(s, MOMENTOS_DE_SERIE[s])} className="inline-flex shrink-0 items-center gap-1 text-[11px] text-[var(--ls-t4)] hover:text-[var(--ls-t1)]">
                  <RotateCcw className="h-3 w-3" aria-hidden /> Volver al de serie
                </button>
              )}
            </div>
            <textarea id={`momento-${s}`} value={perfil.momentos[s]} onChange={(e) => cambiarMomento(s, e.target.value)} rows={5} disabled={deshabilitado} spellCheck className={`${CAJA} font-[inherit]`} />
          </div>
        ))}
      </Tarjeta>

      <Tarjeta
        id="tarjeta-textos"
        titulo="Textos de la IA"
        ayuda="Con palabras: qué hacemos, cómo escribe, cómo persuade, cómo usa el historial y lo que quieras probar. Lo de tono, longitud, petición y emojis ya está en los ajustes."
        resumen={textosCambiados === 0 ? 'De serie' : `${textosCambiados} cambiado${textosCambiados === 1 ? '' : 's'}`}
        abierta={abiertas.has('textos')}
        onAlternar={() => alternar('textos')}
      >
        {SECCIONES_DE_WHATSAPP.filter((s) => s.clave !== 'ejemplos').map((s) => {
          const cambiada = perfil.secciones[s.clave].trim() !== serie.secciones[s.clave].trim()
          return (
            <div key={s.clave}>
              <div className="mb-1 flex items-center justify-between gap-2">
                <label htmlFor={`seccion-${s.clave}`} className="text-[11.5px] font-semibold text-[var(--ls-t3)]">
                  {s.titulo}
                </label>
                {!deshabilitado && cambiada && (
                  <button type="button" onClick={() => cambiarSeccion(s.clave, serie.secciones[s.clave])} className="inline-flex items-center gap-1 text-[11px] text-[var(--ls-t4)] hover:text-[var(--ls-t1)]">
                    <RotateCcw className="h-3 w-3" aria-hidden /> Volver al texto de serie
                  </button>
                )}
              </div>
              <textarea id={`seccion-${s.clave}`} value={perfil.secciones[s.clave]} onChange={(e) => cambiarSeccion(s.clave, e.target.value)} rows={s.filas} disabled={deshabilitado} placeholder={s.clave === 'extra' ? 'Vacío: no añade nada.' : undefined} spellCheck className={`${CAJA} font-[inherit]`} />
              <p className={AYUDA}>{s.ayuda}</p>
            </div>
          )
        })}
      </Tarjeta>

      <Tarjeta
        id="tarjeta-ejemplos"
        titulo="Ejemplos de tono"
        ayuda="Tres mensajes de empresas inventadas para que la IA aprenda el ritmo y la forma. No copia sus frases ni sus datos."
        resumen={perfil.ejemplosModo === 'serie' ? `De serie, en tono ${MANDO_DE_TONO.opciones.find((o) => o.valor === perfil.ajustes.tono)?.etiqueta.toLowerCase()}` : perfil.ejemplosModo === 'propios' ? 'Los tuyos' : 'Ninguno'}
        abierta={abiertas.has('ejemplos')}
        onAlternar={() => alternar('ejemplos')}
      >
        <div role="radiogroup" aria-label="Qué ejemplos de tono se le enseñan" className="grid gap-1.5 sm:grid-cols-3">
          {MODOS_DE_EJEMPLOS.map((m) => {
            const activa = perfil.ejemplosModo === m
            const [titulo, detalle] = m === 'serie' ? ['De serie', 'Los míos, según el tono elegido'] : m === 'propios' ? ['Los tuyos', 'Escribes los ejemplos'] : ['Ninguno', 'Solo las instrucciones']
            return (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={activa}
                disabled={deshabilitado}
                onClick={() => cambiar({ ejemplosModo: m as ModoDeEjemplos })}
                className={`flex flex-col items-start gap-0.5 rounded-[8px] border px-2.5 py-1.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${activa ? 'border-[var(--ls-acc-graf)] bg-[var(--ls-acc-suave)] shadow-[inset_0_0_0_1px_var(--ls-acc-graf)]' : 'border-[var(--ls-linea)] bg-[var(--ls-sup2)] hover:border-[var(--ls-linea2)]'}`}
              >
                <span className="text-[12.5px] font-medium text-[var(--ls-t1)]">{titulo}</span>
                <span className="text-[11px] text-[var(--ls-t4)]">{detalle}</span>
              </button>
            )
          })}
        </div>
        {perfil.ejemplosModo === 'serie' && <pre className="whitespace-pre-wrap rounded-[8px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] p-2.5 font-[inherit] text-[12px] leading-relaxed text-[var(--ls-t3)]">{EJEMPLOS_DE_SERIE[perfil.ajustes.tono]}</pre>}
        {perfil.ejemplosModo === 'propios' && (
          <div>
            <label htmlFor="seccion-ejemplos" className={ETIQUETA}>
              Tus ejemplos (uno por línea, empezando por [Primer contacto], [Te he llamado y no contesta] y [Después de hablar])
            </label>
            <textarea id="seccion-ejemplos" value={perfil.secciones.ejemplos} onChange={(e) => cambiarSeccion('ejemplos', e.target.value)} rows={8} disabled={deshabilitado} spellCheck className={`${CAJA} font-[inherit]`} />
            {!deshabilitado && (
              <button type="button" onClick={() => cambiarSeccion('ejemplos', EJEMPLOS_DE_SERIE[perfil.ajustes.tono])} className="mt-1 inline-flex items-center gap-1 text-[11.5px] text-[var(--ls-t4)] hover:text-[var(--ls-t1)]">
                <RotateCcw className="h-3 w-3" aria-hidden /> Empezar desde los de serie
              </button>
            )}
          </div>
        )}
      </Tarjeta>

      <Tarjeta
        id="tarjeta-modelo"
        titulo="Modelo y razonamiento"
        ayuda="Con qué modelo escribe y cuánto «piensa» antes. Para 40 palabras, pensar casi no mejora el resultado y duplica el tiempo."
        resumen={`${modelos.find((m) => m.id === modelo)?.nombre ?? modelo} · ${esfuerzo === 'none' ? 'sin razonar' : `razonando ${esfuerzo}`} · ${enCentimos(coste)} por mensaje`}
        abierta={abiertas.has('modelo')}
        onAlternar={() => alternar('modelo')}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="perfil-modelo" className={ETIQUETA}>
              Modelo
            </label>
            <select id="perfil-modelo" value={perfil.modelo ?? ''} onChange={(e) => cambiar({ modelo: e.target.value === '' ? null : e.target.value })} disabled={deshabilitado} className="h-8 w-full cursor-pointer rounded-[6px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-2 text-[12.5px] text-[var(--ls-t1)] outline-none hover:border-[var(--ls-linea2)] focus:border-[var(--ls-acc-graf)] disabled:cursor-not-allowed disabled:opacity-60">
              <option value="" className="bg-[var(--ls-sup)]">
                El de siempre ({modelos[0]?.nombre ?? 'luna'})
              </option>
              {modelos.map((m) => (
                <option key={m.id} value={m.id} className="bg-[var(--ls-sup)]">
                  {m.nombre} · {m.id}
                </option>
              ))}
            </select>
            <p className={AYUDA}>{modelos.find((m) => m.id === modelo)?.detalle}</p>
          </div>
          <div>
            <label htmlFor="perfil-esfuerzo" className={ETIQUETA}>
              Razonamiento
            </label>
            <select id="perfil-esfuerzo" value={perfil.esfuerzo ?? ''} onChange={(e) => cambiar({ esfuerzo: e.target.value === '' ? null : (e.target.value as EsfuerzoDeIa) })} disabled={deshabilitado} className="h-8 w-full cursor-pointer rounded-[6px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-2 text-[12.5px] text-[var(--ls-t1)] outline-none hover:border-[var(--ls-linea2)] focus:border-[var(--ls-acc-graf)] disabled:cursor-not-allowed disabled:opacity-60">
              <option value="" className="bg-[var(--ls-sup)]">
                El de siempre (sin razonar)
              </option>
              {ESFUERZOS_DE_IA.map((e) => (
                <option key={e} value={e} className="bg-[var(--ls-sup)]">
                  {e === 'none' ? 'Sin razonar' : e === 'low' ? 'Poco' : e === 'medium' ? 'Medio' : e === 'high' ? 'Mucho' : 'Muchísimo'} ({e})
                </option>
              ))}
            </select>
            <p className={AYUDA}>Más razonamiento = más tiempo y más coste. Medido: luna sin razonar tarda 2 s; razonando poco, 4 s, sin escribir mejor.</p>
          </div>
        </div>
        <p className="rounded-[8px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-2.5 py-2 text-[12px] leading-snug text-[var(--ls-t3)]">
          Un mensaje con esto cuesta unos <strong className="text-[var(--ls-t1)]">{enCentimos(coste)}</strong> si alguien ha usado la IA hace un rato (la mayor parte del encargo va en la caché de OpenAI) y hasta {enCentimos(costeFrio)} si no. El coste real de cada prueba sale debajo de cada mensaje.
        </p>
      </Tarjeta>
    </div>
  )
}
