'use client'

import { Check, ChevronDown, Copy, Link2, ShieldAlert } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { NOMBRE_DEL_CONECTOR, PASO_DE_LA_RUTINA } from '@/lib/briefing/rutina'
import type { EstadoDelConector } from '@/lib/briefing/tipos'
import { HaceCuanto, PANEL } from './ui'

/**
 * «CONEXIÓN CON CLAUDE»: LO QUE HACE FALTA PARA QUE LA RUTINA PUBLIQUE AQUÍ. SOLO ADMINISTRADORES.
 * ================================================================================================
 * Crea (o anula) el enlace secreto del conector que solo sirve para publicar el briefing, lo enseña UNA vez para copiarlo y cuenta los pasos para añadirlo en Claude.
 * El enlace entero solo existe en esta pantalla mientras no se sale de ella: en la base solo queda su huella, así que no se puede volver a ver, solo crear otro.
 */

type Confirmando = 'ninguno' | 'reemplazar' | 'anular'

const BOTON = 'inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-[7px] border px-3 text-[12.5px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50'
const BOTON_PRIMARIO = `${BOTON} border-transparent bg-[var(--ls-acc-relleno)] text-[var(--ls-acc-tinta)] hover:brightness-110`
const BOTON_SECUNDARIO = `${BOTON} border-[var(--ls-linea2)] bg-[var(--ls-sup2)] text-[var(--ls-t1)] hover:bg-[var(--ls-sup3)]`

async function copiar(texto: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texto)
    return true
  } catch {
    return false
  }
}

function BotonCopiar({ texto, etiqueta = 'Copiar', alCopiar }: { texto: string; etiqueta?: string; alCopiar?: () => void }) {
  const [copiado, setCopiado] = useState(false)
  return (
    <button
      type="button"
      className={BOTON_SECUNDARIO}
      onClick={async () => {
        if (await copiar(texto)) {
          setCopiado(true)
          alCopiar?.()
          window.setTimeout(() => setCopiado(false), 2200)
        } else {
          toast.error('El navegador no ha dejado copiar. Selecciónalo y copia con Ctrl+C.')
        }
      }}
    >
      {copiado ? <Check className="h-3.5 w-3.5 text-[var(--ls-e-verde)]" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
      {copiado ? 'Copiado' : etiqueta}
    </button>
  )
}

function Paso({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="grid grid-cols-[22px_minmax(0,1fr)] items-start gap-2.5">
      <span className="mt-px inline-flex h-[22px] w-[22px] items-center justify-center rounded-full bg-[var(--ls-sup3)] text-[11.5px] font-bold tabular-nums text-[var(--ls-t2)]">{n}</span>
      <div className="min-w-0 text-[13px] leading-snug text-[var(--ls-t2)]">{children}</div>
    </li>
  )
}

export function PanelConector({ estadoInicial, abiertoDeInicio }: { estadoInicial: EstadoDelConector; abiertoDeInicio: boolean }) {
  const [estado, setEstado] = useState(estadoInicial)
  const [abierto, setAbierto] = useState(abiertoDeInicio)
  const [enlace, setEnlace] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [confirmando, setConfirmando] = useState<Confirmando>('ninguno')

  async function crear() {
    setOcupado(true)
    try {
      const r = await fetch('/api/briefing/conector', { method: 'POST' })
      const j = (await r.json().catch(() => null)) as { url?: string; creadoAt?: string; error?: string } | null
      if (!r.ok || !j?.url) throw new Error(j?.error ?? 'No se ha podido crear el enlace.')
      setEnlace(j.url)
      setEstado({ hayEnlace: true, creadoAt: j.creadoAt ?? new Date().toISOString(), ultimoUsoAt: null })
      setConfirmando('ninguno')
      toast.success('Enlace creado. Cópialo ahora: no se vuelve a enseñar.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se ha podido crear el enlace.')
    } finally {
      setOcupado(false)
    }
  }

  async function anular() {
    setOcupado(true)
    try {
      const r = await fetch('/api/briefing/conector', { method: 'DELETE' })
      const j = (await r.json().catch(() => null)) as { ok?: boolean; error?: string } | null
      if (!r.ok || !j?.ok) throw new Error(j?.error ?? 'No se ha podido anular el enlace.')
      setEnlace(null)
      setEstado({ hayEnlace: false, creadoAt: null, ultimoUsoAt: null })
      setConfirmando('ninguno')
      toast.success('Enlace anulado. La rutina ya no puede publicar.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se ha podido anular el enlace.')
    } finally {
      setOcupado(false)
    }
  }

  const estadoTexto = !estado.hayEnlace ? 'Sin conectar' : estado.ultimoUsoAt ? 'Conectado' : 'Enlace creado, aún sin usar'
  const colorDelPunto = !estado.hayEnlace ? 'bg-[var(--ls-t4)]' : estado.ultimoUsoAt ? 'bg-[var(--ls-e-verde)]' : 'bg-[var(--ls-e-ambar)]'

  // El reloj del «hace cuánto» lo pone PanelBriefing, que es quien monta esto
  return (
    <>
      <section className={`${PANEL} rend-aparece`} aria-label="Conexión con Claude">
        <button type="button" onClick={() => setAbierto(!abierto)} aria-expanded={abierto} className="flex w-full items-center justify-between gap-3 px-3.5 py-3 text-left">
          <span className="flex min-w-0 items-center gap-2.5">
            <Link2 className="h-4 w-4 shrink-0 text-[var(--ls-t3)]" aria-hidden />
            <span className="min-w-0">
              <span className="block text-[13.5px] font-semibold text-[var(--ls-t1)]">Conexión con Claude</span>
              <span className="block text-[12px] text-[var(--ls-t4)]">Para que la rutina de la mañana deje aquí el briefing</span>
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-2.5">
            <span className="inline-flex items-center gap-1.5 text-[12px] text-[var(--ls-t3)]">
              <span className={`h-2 w-2 rounded-full ${colorDelPunto}`} aria-hidden />
              <span className="hidden sm:inline">{estadoTexto}</span>
            </span>
            <ChevronDown className={`h-4 w-4 text-[var(--ls-t4)] transition-transform duration-200 ${abierto ? 'rotate-180' : ''}`} aria-hidden />
          </span>
        </button>

        {abierto ? (
          <div className="space-y-4 border-t border-[var(--ls-linea)] px-3.5 pb-4 pt-3.5">
            <p className="max-w-[78ch] text-[13px] leading-snug text-[var(--ls-t3)]">
              La rutina publica el briefing llamando a una herramienta de un conector. Este conector <b className="font-semibold text-[var(--ls-t2)]">solo sirve para eso</b>: no lee nada del ERP, ni clientes, ni cuentas de Amazon, ni leads.
              Quien tenga el enlace puede escribir un briefing y nada más; si alguna vez se filtra, se anula aquí y deja de valer.
            </p>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-[8px] bg-[var(--ls-sup2)] px-3 py-2 text-[12.5px] text-[var(--ls-t2)]">
              <span className="inline-flex items-center gap-1.5 font-semibold text-[var(--ls-t1)]">
                <span className={`h-2 w-2 rounded-full ${colorDelPunto}`} aria-hidden />
                {estadoTexto}
              </span>
              {estado.creadoAt ? (
                <span className="text-[var(--ls-t3)]">
                  Creado <HaceCuanto iso={estado.creadoAt} />
                </span>
              ) : null}
              {estado.hayEnlace ? (
                <span className="text-[var(--ls-t3)]">{estado.ultimoUsoAt ? <>Último uso <HaceCuanto iso={estado.ultimoUsoAt} /></> : 'Todavía nadie lo ha usado'}</span>
              ) : null}
            </div>

            {enlace ? (
              <div className="space-y-2 rounded-[8px] border border-[var(--ls-acc-graf)] bg-[var(--ls-acc-suave)] p-3">
                <div className="flex items-start gap-2 text-[12.5px] font-semibold text-[var(--ls-t1)]">
                  <ShieldAlert className="mt-px h-4 w-4 shrink-0 text-[var(--ls-acc)]" aria-hidden />
                  Cópialo ahora. Es la llave del conector y no se vuelve a enseñar: si lo pierdes, se crea otro.
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    readOnly
                    value={enlace}
                    onFocus={(e) => e.currentTarget.select()}
                    aria-label="Enlace del conector"
                    spellCheck={false}
                    className="h-8 min-w-0 flex-1 basis-[260px] rounded-[7px] border border-[var(--ls-linea2)] bg-[var(--ls-sup)] px-2.5 font-mono text-[12px] text-[var(--ls-t1)] outline-none focus:border-[var(--ls-acc-graf)]"
                  />
                  <BotonCopiar texto={enlace} etiqueta="Copiar enlace" />
                </div>
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              {confirmando === 'reemplazar' ? (
                <>
                  <span className="text-[12.5px] text-[var(--ls-t2)]">El enlace de ahora dejará de valer y la rutina no publicará hasta que pegues el nuevo en Claude.</span>
                  <button type="button" className={BOTON_PRIMARIO} onClick={crear} disabled={ocupado}>
                    Sí, crear uno nuevo
                  </button>
                  <button type="button" className={BOTON_SECUNDARIO} onClick={() => setConfirmando('ninguno')} disabled={ocupado}>
                    Cancelar
                  </button>
                </>
              ) : confirmando === 'anular' ? (
                <>
                  <span className="text-[12.5px] text-[var(--ls-t2)]">La rutina dejará de poder publicar aquí hasta que crees otro enlace.</span>
                  <button type="button" className={BOTON_PRIMARIO} onClick={anular} disabled={ocupado}>
                    Sí, anularlo
                  </button>
                  <button type="button" className={BOTON_SECUNDARIO} onClick={() => setConfirmando('ninguno')} disabled={ocupado}>
                    Cancelar
                  </button>
                </>
              ) : estado.hayEnlace ? (
                <>
                  <button type="button" className={BOTON_SECUNDARIO} onClick={() => setConfirmando('reemplazar')} disabled={ocupado}>
                    Crear un enlace nuevo
                  </button>
                  <button type="button" className={BOTON_SECUNDARIO} onClick={() => setConfirmando('anular')} disabled={ocupado}>
                    Anular el enlace
                  </button>
                </>
              ) : (
                <button type="button" className={BOTON_PRIMARIO} onClick={crear} disabled={ocupado}>
                  {ocupado ? 'Creando…' : 'Crear el enlace'}
                </button>
              )}
            </div>

            <div>
              <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--ls-t3)]">Cómo se conecta</h3>
              <ol className="grid gap-2.5">
                <Paso n={1}>
                  Crea el enlace aquí arriba y cópialo.
                </Paso>
                <Paso n={2}>
                  En Claude, abre <b className="font-semibold text-[var(--ls-t1)]">Ajustes → Conectores → Añadir conector personalizado</b>. Ponle de nombre{' '}
                  <b className="font-semibold text-[var(--ls-t1)]">{NOMBRE_DEL_CONECTOR}</b> y pega el enlace como dirección. No pide inicio de sesión.
                </Paso>
                <Paso n={3}>
                  Si Claude pregunta por el permiso de la herramienta <code className="rounded bg-[var(--ls-sup3)] px-1 py-px text-[12px]">publicar_briefing</code>, elige <b className="font-semibold text-[var(--ls-t1)]">permitir siempre</b>: la rutina corre sin nadie delante.
                </Paso>
                <Paso n={4}>
                  Añade el conector a la rutina «Briefing diario Liberty Seller» y pega este paso al final de sus instrucciones, después de publicar el artefacto:
                  <div className="mt-2 space-y-2">
                    <p className="whitespace-pre-wrap rounded-[8px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] p-2.5 text-[12px] leading-relaxed text-[var(--ls-t2)]">{PASO_DE_LA_RUTINA}</p>
                    <BotonCopiar texto={PASO_DE_LA_RUTINA} etiqueta="Copiar el paso" />
                  </div>
                </Paso>
                <Paso n={5}>
                  Lanza la rutina una vez a mano. Cuando publique, esta pantalla se llena sola y aquí arriba dirá «Conectado».
                </Paso>
              </ol>
            </div>
          </div>
        ) : null}
      </section>
    </>
  )
}
