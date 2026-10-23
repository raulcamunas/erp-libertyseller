'use client'

import { FlaskConical, Loader2, RefreshCw, Sparkles, Workflow } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Esqueleto } from '@/components/rendimiento/ui'
import { textoSinFirma } from '@/lib/correo/plantillas'
import { diaCorto, sumarDiasHabiles } from '@/lib/correo/secuencias/fechas'
import { parecido, revisarSeguimientos, type ProblemaDeSeguimiento } from '@/lib/correo/secuencias/revision'
import { enviarJson, pedir } from '../api'
import { BOTON_SECUNDARIO } from '../ui'
import { direccionesDelCampo } from './ComprobacionDeCorreo'

/**
 * LOS SEGUIMIENTOS AUTOMÁTICOS DENTRO DEL CUADRO DE ESCRIBIR.
 *
 * Cuando el correo es el primero a un lead, el comercial ve aquí los dos seguimientos que saldrán solos si no contesta —escritos por la IA a partir del
 * correo, con su fecha aproximada—, los puede editar y los activa o no con un interruptor. Al enviar, el servidor los programa. Nada sale sin que la persona lo
 * haya visto: si lleva el interruptor encendido y aún no están escritos, el primer «Enviar» los escribe y se detiene para que se lean.
 *
 * Es información y ayuda, no una condición para enviar: si el servidor no contesta, o el motor está apagado, el bloque no aparece y el cuadro funciona igual.
 */

export interface EstadoDelCuadro {
  disponible: boolean
  mensaje: string | null
  activa: boolean
  ensayo: boolean
  pasos: Array<{ orden: number; dias: number; diaAprox: string }>
  diasHastaNoInteresa: number
  topeHoy: number
  enviadosHoy: number
}

export interface SeguimientoEditable {
  orden: number
  dias: number
  diaAprox: string
  asunto: string
  texto: string
}

interface RespuestaDeGenerar {
  seguimientos: SeguimientoEditable[]
  modelo: string
  aviso: string | null
}

export interface PeticionDeSeguimientos {
  leadId: string
  seguimientos: Array<{ texto: string; asunto?: string }>
  iaModelo: string | null
}

const CLAVE_ACTIVO = 'correo.seguimientos.activo'
/** Por debajo de este parecido entre el correo de ahora y aquel con el que se escribieron los seguimientos, se avisa de que ya no encajan */
const PARECIDO_MINIMO_CON_EL_CORREO = 0.75

const MENSAJE_BLOQUEANTE: Partial<Record<ProblemaDeSeguimiento, string>> = {
  dinero: 'habla de dinero o de facturación: quítalo',
  hueco: 'deja un hueco por rellenar ([…], {{…}} o <…>): complétalo',
  corto: 'es demasiado corto',
}

interface Entrada {
  buzonId: string
  leadId: string | null
  modo: string
  para: string
  cc: string
  asunto: string
  /** El texto del cuadro, con la firma */
  texto: string
  firma: string | null
  /** Sube cada vez que la IA acaba de escribir el correo: los seguimientos se escriben (o se reescriben) a partir del nuevo */
  disparo: number
}

export function useSeguimientos(p: Entrada) {
  const [estado, setEstado] = useState<EstadoDelCuadro | null>(null)
  const [activo, setActivoEstado] = useState(true)
  const [lista, setLista] = useState<SeguimientoEditable[] | null>(null)
  const [modelo, setModelo] = useState<string | null>(null)
  const [generando, setGenerando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [base, setBase] = useState<string | null>(null)
  const [editado, setEditado] = useState(false)
  const generacion = useRef(0)

  // El interruptor lo recuerda el navegador de cada persona (una comodidad: si no puede guardarlo, vuelve a empezar encendido)
  useEffect(() => {
    try {
      if (window.localStorage.getItem(CLAVE_ACTIVO) === '0') setActivoEstado(false)
    } catch {
      /* sin almacenamiento */
    }
  }, [])
  const setActivo = useCallback((v: boolean) => {
    setActivoEstado(v)
    try {
      window.localStorage.setItem(CLAVE_ACTIVO, v ? '1' : '0')
    } catch {
      /* sin almacenamiento */
    }
  }, [])

  // Qué hay en el servidor para este buzón. Solo se pregunta si el correo puede llevar seguimientos (primer correo, abierto desde la ficha de un lead)
  useEffect(() => {
    if (!p.leadId || p.modo !== 'nuevo') return
    let vivo = true
    void pedir<EstadoDelCuadro>(`/api/correo/secuencias/estado?buzonId=${encodeURIComponent(p.buzonId)}`).then((r) => {
      if (vivo && r.ok && r.datos.disponible) setEstado(r.datos)
    })
    return () => {
      vivo = false
    }
  }, [p.buzonId, p.leadId, p.modo])

  const cuerpo = textoSinFirma(p.texto, p.firma).trim()
  const destinos = direccionesDelCampo(p.para)
  const unSoloDestino = destinos.length === 1 && direccionesDelCampo(p.cc).length === 0
  const disponible = Boolean(estado?.disponible) && Boolean(p.leadId) && p.modo === 'nuevo'
  const elegible = disponible && unSoloDestino

  const generar = async (indicaciones?: string): Promise<boolean> => {
    if (!p.leadId || !disponible) return false
    if (cuerpo.length < 40) {
      setError('Escribe primero el correo: los seguimientos se escriben a partir de él.')
      return false
    }
    if (!p.asunto.trim()) {
      setError('Pon un asunto al correo antes de escribir los seguimientos.')
      return false
    }
    const mia = ++generacion.current
    setGenerando(true)
    setError(null)
    const r = await enviarJson<RespuestaDeGenerar>('/api/correo/secuencias/generar', 'POST', { leadId: p.leadId, buzonId: p.buzonId, asunto: p.asunto.trim(), texto: p.texto, indicaciones: indicaciones?.trim() || undefined })
    if (mia !== generacion.current) return false
    setGenerando(false)
    if (!r.ok) {
      setError(r.mensaje)
      return false
    }
    setLista(r.datos.seguimientos)
    setModelo(r.datos.modelo)
    setAviso(r.datos.aviso)
    setBase(cuerpo)
    setEditado(false)
    return true
  }

  // La IA acaba de escribir (o reescribir) el correo: los seguimientos se escriben a partir de él, salvo que la persona ya los haya tocado
  const disparoVisto = useRef(p.disparo)
  useEffect(() => {
    if (p.disparo === disparoVisto.current) return
    disparoVisto.current = p.disparo
    if (elegible && activo && (!lista || !editado)) void generar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.disparo])

  /**
   * La persona acaba de salir del texto del correo (pasó a otro campo o pulsó un botón): si ya hay un correo escrito y aún no hay seguimientos, se escriben
   * ahora, para que al enviar ya estén a la vista. Solo una vez por correo (si falló, no se insiste solo) y nunca sin asunto ni con un texto de tres líneas.
   */
  const alSalirDelTexto = () => {
    if (elegible && activo && !lista && !generando && !error && cuerpo.length >= 80 && p.asunto.trim()) void generar()
  }

  const editar = (orden: number, campos: Partial<Pick<SeguimientoEditable, 'asunto' | 'texto'>>) => {
    setLista((l) => (l ? l.map((s) => (s.orden === orden ? { ...s, ...campos } : s)) : l))
    setEditado(true)
  }

  const problemas = useMemo(() => (lista ? revisarSeguimientos(lista.map((x) => x.texto), cuerpo) : []), [lista, cuerpo])
  const desactualizado = Boolean(lista && base !== null && parecido(cuerpo, base) < PARECIDO_MINIMO_CON_EL_CORREO)

  /** Lo que impide enviar con los seguimientos tal como están (el servidor lo vuelve a comprobar, pero el correo ya habría salido) */
  const bloqueo = useMemo((): string | null => {
    if (!elegible || !activo || !lista) return null
    for (let i = 0; i < lista.length; i++) {
      for (const c of ['dinero', 'hueco', 'corto'] as const) {
        if (problemas[i]?.includes(c)) return `El seguimiento ${i + 1} ${MENSAJE_BLOQUEANTE[c]}, o desactiva los seguimientos automáticos para este correo.`
      }
    }
    return null
  }, [elegible, activo, lista, problemas])

  return {
    estado,
    disponible,
    elegible,
    unSoloDestino,
    activo,
    setActivo,
    lista,
    modelo,
    generando,
    error,
    aviso,
    problemas,
    desactualizado,
    bloqueo,
    cuerpo,
    generar,
    alSalirDelTexto,
    editar,
    /** Con el interruptor encendido y los seguimientos sin escribir, el primer «Enviar» los escribe y se detiene */
    pideEscribirlosAntes: elegible && activo && !lista,
    /** Lo que se manda al servidor con el correo, o null si no hay seguimientos que programar */
    paraEnviar: (): PeticionDeSeguimientos | null => {
      if (!elegible || !activo || !lista || !p.leadId) return null
      return { leadId: p.leadId, iaModelo: modelo, seguimientos: lista.map((s) => ({ texto: s.texto.trim(), ...(s.asunto.trim() ? { asunto: s.asunto.trim() } : {}) })) }
    },
  }
}

export type Seguimientos = ReturnType<typeof useSeguimientos>

/* ------------------------------------------------------------------ */
/* El bloque                                                           */
/* ------------------------------------------------------------------ */

const AVISO_DE_PROBLEMA: Record<ProblemaDeSeguimiento, { texto: string; grave: boolean }> = {
  dinero: { texto: 'Habla de dinero o de facturación: quítalo.', grave: true },
  hueco: { texto: 'Deja un hueco por rellenar ([…], {{…}} o <…>).', grave: true },
  corto: { texto: 'Es demasiado corto.', grave: true },
  largo: { texto: 'Es largo: conviene acortarlo.', grave: false },
  repite: { texto: 'Se parece mucho a otro correo de la secuencia.', grave: false },
}

function LineaDelTiempo({ seg }: { seg: Seguimientos }) {
  const e = seg.estado
  if (!e) return null
  const ultimo = e.pasos[e.pasos.length - 1]
  const fin = ultimo && e.diasHastaNoInteresa > 0 ? sumarDiasHabiles(ultimo.diaAprox, e.diasHastaNoInteresa, []) : null
  const nodos: Array<{ clave: string; titulo: string; fecha: string; tipo: 'ahora' | 'paso' | 'fin' }> = [
    { clave: 'hoy', titulo: 'Este correo', fecha: 'al enviar', tipo: 'ahora' },
    ...e.pasos.map((p) => ({ clave: `p${p.orden}`, titulo: `Seguimiento ${p.orden}`, fecha: `${diaCorto(p.diaAprox)} · +${p.dias} d`, tipo: 'paso' as const })),
    ...(fin ? [{ clave: 'fin', titulo: 'Sin respuesta', fecha: `«No interesa» · ${diaCorto(fin)}`, tipo: 'fin' as const }] : []),
  ]
  return (
    <ol className="flex items-start px-1 pt-1" aria-label="Calendario de los correos">
      {nodos.map((n, i) => {
        const color = n.tipo === 'fin' ? 'var(--ls-t4)' : 'var(--ls-acc-graf)'
        return (
          <li key={n.clave} className="relative flex min-w-0 flex-1 flex-col items-center px-0.5 text-center">
            {i > 0 && <span className="sec-tramo absolute right-1/2 top-[7px] h-[2px] w-full bg-[var(--ls-linea2)]" style={{ '--d': i } as CSSProperties} aria-hidden />}
            <span
              className="sec-nodo relative z-10 h-4 w-4 rounded-full border-2 bg-[var(--ls-sup)]"
              style={{ '--d': i, borderColor: color, background: n.tipo === 'ahora' ? color : undefined, borderStyle: e.ensayo && n.tipo === 'paso' ? 'dashed' : 'solid' } as CSSProperties}
              aria-hidden
            />
            <span className="mt-1 break-words text-[11px] font-medium leading-tight text-[var(--ls-t1)]">{n.titulo}</span>
            <span className="break-words text-[10.5px] leading-tight text-[var(--ls-t4)]">{n.fecha}</span>
          </li>
        )
      })}
    </ol>
  )
}

export function BloqueDeSeguimientos({ seg }: { seg: Seguimientos }) {
  const [pidiendo, setPidiendo] = useState(false)
  const [indicaciones, setIndicaciones] = useState('')
  if (!seg.disponible) return null
  const e = seg.estado as EstadoDelCuadro
  const llenoHoy = e.topeHoy > 0 && e.enviadosHoy >= e.topeHoy
  const palabras = (t: string) => t.trim().split(/\s+/).filter(Boolean).length

  return (
    <section className="sec-sube rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup)]" aria-label="Seguimientos automáticos">
      <header className="flex items-center gap-3 px-3 py-2.5">
        <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[7px] bg-[var(--ls-acc-suave)] text-[var(--ls-acc)]">
          <Workflow className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[12.5px] font-semibold text-[var(--ls-t1)]">Seguimientos automáticos</h3>
          <p className="truncate text-[11.5px] text-[var(--ls-t3)]">
            {!seg.unSoloDestino
              ? 'Solo se programan cuando el correo va a una única dirección.'
              : seg.activo
                ? `Si no contesta, salen solos ${e.pasos.length === 1 ? '1 correo' : `${e.pasos.length} correos`} más.`
                : 'No se programará ningún seguimiento para este correo.'}
          </p>
        </div>
        {seg.unSoloDestino && (
          <button
            type="button"
            role="switch"
            aria-checked={seg.activo}
            aria-label="Programar seguimientos automáticos"
            onClick={() => seg.setActivo(!seg.activo)}
            className={`relative h-5 w-9 shrink-0 rounded-full border transition-colors ${seg.activo ? 'border-[var(--ls-acc-graf)] bg-[var(--ls-acc-relleno)]' : 'border-[var(--ls-linea2)] bg-[var(--ls-sup3)]'}`}
          >
            <span className={`absolute left-0.5 top-0.5 h-3.5 w-3.5 rounded-full bg-white shadow transition-transform duration-200 ${seg.activo ? 'translate-x-4' : ''}`} aria-hidden />
          </button>
        )}
      </header>

      {seg.elegible && seg.activo && (
        <div className="space-y-2.5 border-t border-[var(--ls-linea)] px-3 py-3">
          {e.mensaje && (
            <p className="flex items-start gap-1.5 text-[11.5px] leading-snug text-[var(--ls-e-ambar)]">
              <FlaskConical className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden /> {e.mensaje}
            </p>
          )}
          <LineaDelTiempo seg={seg} />

          {seg.generando && (
            <div className="space-y-2" role="status" aria-busy="true">
              <p className="flex items-center gap-2 text-[12px] text-[var(--ls-t2)]">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--ls-acc)]" aria-hidden /> Escribiendo los seguimientos con IA…
              </p>
              <Esqueleto className="h-[88px] w-full" />
              <Esqueleto className="h-[88px] w-full" />
            </div>
          )}

          {!seg.generando && !seg.lista && (
            <div className="flex flex-wrap items-center gap-3 rounded-[8px] border border-dashed border-[var(--ls-linea2)] px-3 py-2.5">
              <p className="min-w-0 flex-1 text-[12px] leading-snug text-[var(--ls-t3)]">La IA escribe los seguimientos a partir de este correo. Los verás aquí antes de que salga nada.</p>
              <button type="button" onClick={() => void seg.generar()} className={BOTON_SECUNDARIO}>
                <Sparkles className="h-3.5 w-3.5 text-[var(--ls-acc)]" aria-hidden /> Escribir seguimientos
              </button>
            </div>
          )}

          {seg.error && (
            <p className="text-[12px] leading-snug text-[var(--ls-e-ambar)]" role="alert">
              {seg.error}
            </p>
          )}

          {!seg.generando && seg.lista && (
            <>
              {seg.desactualizado && (
                <p className="flex flex-wrap items-center gap-2 rounded-[8px] bg-[color-mix(in_srgb,var(--ls-e-ambar)_10%,transparent)] px-2.5 py-1.5 text-[11.5px] leading-snug text-[var(--ls-t2)]">
                  <span className="min-w-0 flex-1">Has cambiado bastante el correo desde que se escribieron estos seguimientos: puede que ya no encajen.</span>
                  <button type="button" onClick={() => void seg.generar()} className="inline-flex h-6 items-center gap-1 rounded-[5px] border border-[var(--ls-linea2)] px-2 font-medium text-[var(--ls-t1)] hover:bg-[var(--ls-sup3)]">
                    <RefreshCw className="h-3 w-3" aria-hidden /> Reescribirlos
                  </button>
                </p>
              )}
              <ul className="space-y-2">
                {seg.lista.map((s, i) => {
                  const problemas = seg.problemas[i] ?? []
                  return (
                    <li key={s.orden} className="sec-sube rounded-[8px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] p-2.5" style={{ '--d': i } as CSSProperties}>
                      <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-3">
                        <span className="text-[12px] font-semibold text-[var(--ls-t1)]">Seguimiento {s.orden}</span>
                        <span className="text-[11px] text-[var(--ls-t4)]">
                          a los {s.dias} días hábiles · hacia el {diaCorto(s.diaAprox)}
                        </span>
                      </div>
                      <input
                        value={s.asunto}
                        onChange={(ev) => seg.editar(s.orden, { asunto: ev.target.value })}
                        maxLength={300}
                        aria-label={`Asunto del seguimiento ${s.orden}`}
                        className="mb-1.5 h-7 w-full rounded-[5px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] px-2 text-[12px] text-[var(--ls-t2)] outline-none focus:border-[var(--ls-acc-graf)]"
                      />
                      <textarea
                        value={s.texto}
                        onChange={(ev) => seg.editar(s.orden, { texto: ev.target.value })}
                        rows={7}
                        aria-label={`Texto del seguimiento ${s.orden}`}
                        className="w-full resize-y rounded-[5px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] p-2 text-[12.5px] leading-relaxed text-[var(--ls-t1)] outline-none focus:border-[var(--ls-acc-graf)]"
                      />
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                        <span className="text-[10.5px] tabular-nums text-[var(--ls-t4)]">{palabras(s.texto)} palabras</span>
                        {problemas.map((c) => (
                          <span key={c} className="text-[11px]" style={{ color: AVISO_DE_PROBLEMA[c].grave ? 'var(--ls-e-rojo)' : 'var(--ls-e-ambar)' }}>
                            {AVISO_DE_PROBLEMA[c].texto}
                          </span>
                        ))}
                      </div>
                    </li>
                  )
                })}
              </ul>
              {seg.aviso && <p className="text-[11.5px] leading-snug text-[var(--ls-e-ambar)]">{seg.aviso}</p>}

              <div className="flex flex-wrap items-center gap-2">
                {pidiendo ? (
                  <>
                    <input
                      value={indicaciones}
                      onChange={(ev) => setIndicaciones(ev.target.value.slice(0, 600))}
                      onKeyDown={(ev) => {
                        // Intro reescribe (no envía el correo) y Escape cierra solo este campo
                        if (ev.key === 'Enter') {
                          ev.preventDefault()
                          ev.stopPropagation()
                          setPidiendo(false)
                          void seg.generar(indicaciones)
                        } else if (ev.key === 'Escape') {
                          ev.stopPropagation()
                          setPidiendo(false)
                        }
                      }}
                      placeholder="Qué quieres cambiar: más cortos, otro tono…"
                      aria-label="Indicaciones para reescribir los seguimientos"
                      autoFocus
                      className="h-8 min-w-[200px] flex-1 rounded-[6px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-2.5 text-[12px] text-[var(--ls-t1)] outline-none placeholder:text-[var(--ls-t4)] focus:border-[var(--ls-acc-graf)]"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setPidiendo(false)
                        void seg.generar(indicaciones)
                      }}
                      className={BOTON_SECUNDARIO}
                    >
                      <Sparkles className="h-3.5 w-3.5 text-[var(--ls-acc)]" aria-hidden /> Reescribir
                    </button>
                  </>
                ) : (
                  <button type="button" onClick={() => setPidiendo(true)} className={BOTON_SECUNDARIO}>
                    <RefreshCw className="h-3.5 w-3.5" aria-hidden /> Reescribir con IA
                  </button>
                )}
              </div>
            </>
          )}

          <p className="text-[11px] leading-snug text-[var(--ls-t4)]">
            Salen solos en horario de oficina (hora de Madrid), de lunes a viernes, con tu firma debajo. Se paran si el lead contesta, si lo llamas o si le escribes tú.
            {e.topeHoy > 0 && (
              <>
                {' '}
                <span style={llenoHoy ? { color: 'var(--ls-e-ambar)' } : undefined}>
                  Hoy este buzón lleva {e.enviadosHoy} de {e.topeHoy} correos
                  {llenoHoy ? ': los automáticos se repartirán en los días siguientes (los tuyos a mano salen siempre).' : '.'}
                </span>
              </>
            )}
          </p>
        </div>
      )}
    </section>
  )
}
