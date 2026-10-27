'use client'

import { CircleAlert, ExternalLink, Loader2, MailCheck, ShieldAlert, ShieldCheck } from 'lucide-react'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { CabeceraDePanel, PANEL } from '@/components/rendimiento/ui'
import { ETIQUETA_DE_POLITICA, type PoliticaDeDudosas } from '@/lib/correo/verificacion/pago'
import type { AjustesDeVerificacion as Ajustes } from '@/lib/correo/verificacion/pago-servidor'
import { enviarJson, pedir } from '../api'
import { BOTON_PRIMARIO, BOTON_SECUNDARIO, CAMPO } from '../ui'
import { cuando } from './datos'
import { Interruptor } from './Interruptor'

/**
 * LA VERIFICACIÓN DE DIRECCIONES — SOLO LA VE Y LA CAMBIA UN ADMINISTRADOR.
 *
 * Antes de enviar el primer correo a un lead, el ERP le pregunta a MillionVerifier si esa dirección existe. Si no existe, el correo no sale; si existe, se guarda la
 * respuesta y los seguimientos (que salen a la misma dirección) no vuelven a preguntar ni a pagar. Aquí se pega la clave de la API (se guarda cifrada y no vuelve a
 * verse), se enciende o se apaga, se elige qué hacer con las direcciones dudosas y se ve cuántos créditos quedan y si el servicio ha fallado.
 *
 * Un fallo del servicio nunca deja al equipo sin escribir: el correo sale sin comprobar y aquí (y en la campana de los administradores) queda el aviso.
 */

interface Conteos {
  buenas: number
  dudosas: number
  malas: number
  ultima: number | null
}

type Carga = { estado: 'cargando' } | { estado: 'error'; mensaje: string } | { estado: 'sin_migracion'; aviso: string } | { estado: 'lista'; ajustes: Ajustes; conteos: Conteos; ahora: number }

/** Lo que contesta «Comprobar una dirección» (lo mismo que el servidor devuelve en /api/correo/verificacion) */
type ResultadoDePrueba =
  | { direccion: string; tipo: 'sin_comprobar'; motivo: string; causa: string }
  | { direccion: string; tipo: 'veredicto'; nivel: 'buena' | 'dudosa' | 'mala'; motivo: string; sugerencia: string | null; origen: string; gastoUnCredito: boolean }

const POLITICAS: PoliticaDeDudosas[] = ['avisar', 'sin_seguimientos', 'bloquear']
const URL_DE_MILLIONVERIFIER = 'https://app.millionverifier.com'
const CREDITOS_PARA_AVISAR = 500

const creditosTexto = (n: number): string => `${n.toLocaleString('es-ES')} ${n === 1 ? 'crédito' : 'créditos'}`

const COLOR_DE_NIVEL = { buena: 'var(--ls-e-verde)', dudosa: 'var(--ls-e-ambar)', mala: 'var(--ls-e-rojo)' } as const
const NOMBRE_DE_NIVEL = { buena: 'Buena', dudosa: 'Dudosa', mala: 'No existe' } as const

function Aviso({ tono, children }: { tono: 'rojo' | 'ambar'; children: ReactNode }) {
  const color = tono === 'rojo' ? 'var(--ls-e-rojo)' : 'var(--ls-e-ambar)'
  return (
    <p className="flex items-start gap-2 rounded-[8px] border px-3 py-2 text-[11.5px] leading-snug text-[var(--ls-t1)]" style={{ borderColor: color, background: `color-mix(in srgb, ${color} 10%, transparent)` }} role="status">
      <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color }} aria-hidden />
      <span className="min-w-0">{children}</span>
    </p>
  )
}

export function AjustesDeVerificacion() {
  const [carga, setCarga] = useState<Carga>({ estado: 'cargando' })
  const [clave, setClave] = useState('')
  const [cambiandoClave, setCambiandoClave] = useState(false)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [confirmaQuitar, setConfirmaQuitar] = useState(false)
  const [direccion, setDireccion] = useState('')
  const [prueba, setPrueba] = useState<ResultadoDePrueba | null>(null)

  const cargar = useCallback(async () => {
    const r = await pedir<{ disponible: boolean; aviso?: string; ajustes?: Ajustes; conteos?: Conteos; ahora?: number }>('/api/correo/verificacion')
    if (!r.ok) return setCarga({ estado: 'error', mensaje: r.mensaje })
    const d = r.datos
    if (!d.disponible || !d.ajustes || !d.conteos) return setCarga({ estado: 'sin_migracion', aviso: d.aviso ?? '' })
    setCarga({ estado: 'lista', ajustes: d.ajustes, conteos: d.conteos, ahora: d.ahora ?? Date.now() })
  }, [])
  useEffect(() => {
    void cargar()
  }, [cargar])

  /** Una acción del servidor: un solo clic a la vez, el error se enseña tal cual (son frases fijas) y, si sale bien, se vuelve a leer todo */
  async function hacer<T extends object>(que: string, cuerpo: Record<string, unknown>, alTerminar: (datos: T) => void) {
    if (ocupado) return
    setOcupado(que)
    const r = await enviarJson<T>('/api/correo/verificacion', 'POST', cuerpo)
    setOcupado(null)
    if (!r.ok) return void toast.error(r.mensaje)
    alTerminar(r.datos)
    void cargar()
  }

  const guardarClave = () =>
    hacer<{ creditos: number; activada: boolean }>('clave', { accion: 'clave', clave: clave.trim() }, (d) => {
      setClave('')
      setCambiandoClave(false)
      toast.success(`Clave guardada: quedan ${creditosTexto(d.creditos)}${d.activada ? '. La verificación está encendida.' : '.'}`)
    })
  const cambiarActiva = (activa: boolean) => hacer('ajustes', { accion: 'ajustes', activa }, () => toast.success(activa ? 'Verificación encendida.' : 'Verificación apagada.'))
  const cambiarPolitica = (dudosas: PoliticaDeDudosas) => hacer('ajustes', { accion: 'ajustes', dudosas }, () => toast.success('Guardado.'))
  const probarClave = () => hacer<{ creditos: number }>('probar', { accion: 'probar_clave' }, (d) => toast.success(`La clave funciona: quedan ${creditosTexto(d.creditos)}.`))
  const quitarClave = () =>
    hacer('quitar', { accion: 'quitar_clave' }, () => {
      setConfirmaQuitar(false)
      toast.success('Clave quitada. La verificación queda apagada.')
    })
  const comprobar = () => hacer<ResultadoDePrueba>('comprobar', { accion: 'comprobar', direccion: direccion.trim() }, (d) => setPrueba(d))

  const cabecera = <CabeceraDePanel icono={<MailCheck className="h-3.5 w-3.5" aria-hidden />} titulo="Verificación de direcciones" contexto="· MillionVerifier" />

  if (carga.estado !== 'lista') {
    return (
      <section className={PANEL} aria-label="Verificación de direcciones">
        {cabecera}
        <div className="p-3">
          {carga.estado === 'cargando' && <p className="text-[12px] text-[var(--ls-t4)]">Cargando…</p>}
          {carga.estado === 'error' && (
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[12px] text-[var(--ls-e-rojo)]">{carga.mensaje}</p>
              <button type="button" onClick={() => void cargar()} className={BOTON_SECUNDARIO}>
                Reintentar
              </button>
            </div>
          )}
          {carga.estado === 'sin_migracion' && <Aviso tono="ambar">{carga.aviso}</Aviso>}
        </div>
      </section>
    )
  }

  const { ajustes: a, conteos, ahora } = carga
  const pocos = a.creditos !== null && a.creditos < CREDITOS_PARA_AVISAR
  const mostrarCampoDeClave = !a.hayClave || cambiandoClave
  const totalComprobadas = conteos.buenas + conteos.dudosas + conteos.malas

  return (
    <section className={PANEL} aria-label="Verificación de direcciones">
      {cabecera}
      <div className="space-y-4 p-3">
        <p className="text-[11.5px] leading-snug text-[var(--ls-t3)]">
          Antes de enviar el <strong className="font-semibold text-[var(--ls-t2)]">primer correo</strong> a un lead, el ERP le pregunta a MillionVerifier si esa dirección existe. Si no existe, el correo no sale (y no hay botón de «enviar igualmente»: si en realidad funciona, un administrador la libera en «Direcciones que no sirven», más abajo). Si existe, se guarda la respuesta: los seguimientos salen a la misma dirección sin volver a preguntar (ni a pagar). Si el servicio falla o no quedan créditos,{' '}
          <strong className="font-semibold text-[var(--ls-t2)]">el correo sale igual</strong> y aquí queda el aviso. Las respuestas y los reenvíos no se comprueban, ni las direcciones del propio equipo.
        </p>

        {a.claveIlegible && <Aviso tono="rojo">La clave guardada ya no se puede leer (ha cambiado la clave con la que el servidor cifra los secretos). Vuelve a pegarla abajo.</Aviso>}
        {a.fallo && (
          <Aviso tono="rojo">
            {a.fallo.texto} <span className="text-[var(--ls-t4)]">({cuando(a.fallo.en, ahora)})</span> Mientras tanto, los correos salen sin comprobar la dirección.
          </Aviso>
        )}
        {!a.fallo && pocos && (
          <Aviso tono="ambar">
            Quedan pocos créditos: {(a.creditos as number).toLocaleString('es-ES')}. Compra más en{' '}
            <a href={URL_DE_MILLIONVERIFIER} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
              app.millionverifier.com
            </a>{' '}
            antes de que se acaben.
          </Aviso>
        )}

        <Interruptor
          titulo="Comprobar la dirección antes de enviar"
          texto={a.hayClave ? (a.activa ? 'Encendida: cada primer correo se comprueba una vez.' : 'Apagada: los correos salen como siempre, sin comprobar.') : 'Primero hay que guardar la clave de MillionVerifier.'}
          activo={a.activa}
          desactivado={!a.hayClave || ocupado !== null}
          onCambio={(v) => void cambiarActiva(v)}
        />

        <div className="space-y-2">
          <p className="text-[12.5px] font-medium text-[var(--ls-t1)]">Clave de la API</p>
          {a.hayClave && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <span className="inline-flex items-center gap-1.5 rounded-[6px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-2 py-1 font-mono text-[12px] text-[var(--ls-t2)]">
                <ShieldCheck className="h-3.5 w-3.5 text-[var(--ls-e-verde)]" aria-hidden />
                {a.claveDe === 'entorno' ? 'Puesta en el servidor' : `···· ${a.claveTermina ?? ''}`}
              </span>
              {a.claveDe === 'ajustes' && a.clavePuestaAt !== null && <span className="text-[11.5px] text-[var(--ls-t4)]">guardada {cuando(a.clavePuestaAt, ahora)}</span>}
              {a.claveDe === 'entorno' && <span className="text-[11.5px] text-[var(--ls-t4)]">variable MILLIONVERIFIER_API_KEY; si guardas una aquí, manda esta</span>}
              <button type="button" disabled={ocupado !== null} onClick={() => void probarClave()} className={BOTON_SECUNDARIO}>
                {ocupado === 'probar' && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />} Probar la clave
              </button>
              {!cambiandoClave && (
                <button type="button" onClick={() => setCambiandoClave(true)} className={BOTON_SECUNDARIO}>
                  Cambiar
                </button>
              )}
              {a.claveDe === 'ajustes' &&
                (confirmaQuitar ? (
                  <span className="inline-flex items-center gap-2 text-[12px] text-[var(--ls-t3)]">
                    Se apagará la verificación.
                    <button type="button" disabled={ocupado !== null} onClick={() => void quitarClave()} className={`${BOTON_SECUNDARIO} border-[var(--ls-e-rojo)] text-[var(--ls-e-rojo)]`}>
                      {ocupado === 'quitar' && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />} Sí, quitarla
                    </button>
                    <button type="button" onClick={() => setConfirmaQuitar(false)} className="h-8 px-2 text-[12px] text-[var(--ls-t4)] hover:text-[var(--ls-t1)]">
                      No
                    </button>
                  </span>
                ) : (
                  <button type="button" disabled={ocupado !== null} onClick={() => setConfirmaQuitar(true)} className="text-[12px] text-[var(--ls-t4)] underline underline-offset-2 hover:text-[var(--ls-e-rojo)]">
                    Quitar
                  </button>
                ))}
            </div>
          )}
          {mostrarCampoDeClave && (
            <form
              className="flex flex-wrap items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                if (clave.trim() !== '') void guardarClave()
              }}
            >
              <input
                type="password"
                value={clave}
                onChange={(e) => setClave(e.target.value)}
                placeholder={a.hayClave ? 'La clave nueva' : 'Pega aquí la clave de la API'}
                aria-label="Clave de la API de MillionVerifier"
                autoComplete="new-password"
                spellCheck={false}
                data-1p-ignore
                data-lpignore="true"
                className={`${CAMPO} !w-72 max-w-full font-mono`}
              />
              <button type="submit" disabled={clave.trim() === '' || ocupado !== null} className={BOTON_PRIMARIO}>
                {ocupado === 'clave' && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />} Guardar y probar
              </button>
              {a.hayClave && (
                <button type="button" onClick={() => { setCambiandoClave(false); setClave('') }} className="h-8 px-2 text-[12px] text-[var(--ls-t4)] hover:text-[var(--ls-t1)]">
                  Cancelar
                </button>
              )}
            </form>
          )}
          {mostrarCampoDeClave && (
            <p className="text-[10.5px] leading-snug text-[var(--ls-t4)]">
              La clave está en{' '}
              <a href={`${URL_DE_MILLIONVERIFIER}/api`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 underline underline-offset-2">
                app.millionverifier.com/api <ExternalLink className="h-2.5 w-2.5" aria-hidden />
              </a>
              . Se comprueba con el servicio antes de guardarla (sin gastar créditos), se guarda cifrada y no vuelve a mostrarse. Si la clave se ha compartido por error (en una captura, en un mensaje…), crea otra en «Manage API keys» de MillionVerifier y borra la vieja.
            </p>
          )}
        </div>

        {a.hayClave && (
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1.5 rounded-[8px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-3 py-2">
            <div>
              <p className="text-[10.5px] uppercase tracking-wide text-[var(--ls-t4)]">Créditos</p>
              <p className="text-[18px] font-semibold tabular-nums leading-tight" style={{ color: a.creditos === 0 ? 'var(--ls-e-rojo)' : pocos ? 'var(--ls-e-ambar)' : 'var(--ls-t1)' }}>
                {a.creditos === null ? '—' : a.creditos.toLocaleString('es-ES')}
              </p>
              {a.creditosAt !== null && <p className="text-[10.5px] text-[var(--ls-t4)]">apuntados {cuando(a.creditosAt, ahora)}</p>}
            </div>
            <div>
              <p className="text-[10.5px] uppercase tracking-wide text-[var(--ls-t4)]">Direcciones comprobadas</p>
              <p className="text-[12.5px] tabular-nums text-[var(--ls-t2)]">
                <span style={{ color: COLOR_DE_NIVEL.buena }}>{conteos.buenas.toLocaleString('es-ES')} buenas</span> · <span style={{ color: COLOR_DE_NIVEL.dudosa }}>{conteos.dudosas.toLocaleString('es-ES')} dudosas</span> ·{' '}
                <span style={{ color: COLOR_DE_NIVEL.mala }}>{conteos.malas.toLocaleString('es-ES')} no existen</span>
              </p>
              <p className="text-[10.5px] text-[var(--ls-t4)]">{totalComprobadas === 0 ? 'Todavía ninguna.' : conteos.ultima !== null ? `la última, ${cuando(conteos.ultima, ahora)}` : ''}</p>
            </div>
            <a href={URL_DE_MILLIONVERIFIER} target="_blank" rel="noopener noreferrer" className="ml-auto inline-flex items-center gap-1 self-center text-[12px] text-[var(--ls-t3)] underline underline-offset-2 hover:text-[var(--ls-t1)]">
              Comprar créditos <ExternalLink className="h-3 w-3" aria-hidden />
            </a>
          </div>
        )}

        <div className="space-y-2">
          <p className="text-[12.5px] font-medium text-[var(--ls-t1)]">Si la dirección es dudosa</p>
          <p className="text-[11.5px] leading-snug text-[var(--ls-t3)]">Pasa con las empresas cuyo servidor acepta cualquier dirección: no se puede confirmar que el buzón exista, aunque casi siempre existe. No se cobra ese crédito.</p>
          <div className="grid gap-2 md:grid-cols-3" role="radiogroup" aria-label="Qué hacer con una dirección dudosa">
            {POLITICAS.map((p) => {
              const activa = a.dudosas === p
              return (
                <button
                  key={p}
                  type="button"
                  role="radio"
                  aria-checked={activa}
                  disabled={ocupado !== null}
                  onClick={() => !activa && void cambiarPolitica(p)}
                  className={`h-full rounded-[10px] border p-2.5 text-left transition-colors disabled:cursor-default ${activa ? 'border-[var(--ls-acc-graf)] bg-[var(--ls-acc-suave)]' : 'border-[var(--ls-linea)] bg-[var(--ls-sup)] hover:border-[var(--ls-linea2)]'}`}
                >
                  <span className="flex items-center gap-2 text-[12.5px] font-semibold text-[var(--ls-t1)]">
                    {ETIQUETA_DE_POLITICA[p].titulo}
                    {p === 'avisar' && <span className="rounded-[4px] bg-[var(--ls-sup3)] px-1.5 text-[10px] font-medium text-[var(--ls-t3)]">recomendado</span>}
                  </span>
                  <span className="mt-1 block text-[11px] leading-snug text-[var(--ls-t3)]">{ETIQUETA_DE_POLITICA[p].texto}</span>
                </button>
              )
            })}
          </div>
        </div>

        {a.hayClave && (
          <div className="space-y-2">
            <p className="text-[12.5px] font-medium text-[var(--ls-t1)]">Comprobar una dirección</p>
            <form
              className="flex flex-wrap items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                if (direccion.trim() !== '') void comprobar()
              }}
            >
              <input type="email" value={direccion} onChange={(e) => { setDireccion(e.target.value); setPrueba(null) }} placeholder="nombre@empresa.es" aria-label="Dirección que comprobar" spellCheck={false} autoComplete="off" className={`${CAMPO} !w-72 max-w-full`} />
              <button type="submit" disabled={direccion.trim() === '' || ocupado !== null} className={BOTON_SECUNDARIO}>
                {ocupado === 'comprobar' && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />} Comprobar
              </button>
              <span className="text-[11px] text-[var(--ls-t4)]">Gasta 1 crédito. Sirve para ver que todo funciona, también con la verificación apagada.</span>
            </form>
            {prueba && (
              <p
                className="flex items-start gap-2 rounded-[8px] border border-l-2 border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-2.5 py-1.5 text-[12px] leading-snug text-[var(--ls-t2)]"
                style={{ borderLeftColor: prueba.tipo === 'veredicto' ? COLOR_DE_NIVEL[prueba.nivel] : 'var(--ls-e-ambar)' }}
                role="status"
              >
                {prueba.tipo === 'veredicto' && prueba.nivel === 'buena' ? <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: COLOR_DE_NIVEL.buena }} aria-hidden /> : <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: prueba.tipo === 'veredicto' ? COLOR_DE_NIVEL[prueba.nivel] : 'var(--ls-e-ambar)' }} aria-hidden />}
                <span className="min-w-0">
                  <strong className="break-all font-medium text-[var(--ls-t1)]">{prueba.direccion}</strong>
                  {prueba.tipo === 'veredicto' ? (
                    <>
                      : <strong>{NOMBRE_DE_NIVEL[prueba.nivel]}.</strong> {prueba.motivo}
                      {prueba.sugerencia ? ` ¿Querías decir ${prueba.sugerencia}?` : ''}
                      <span className="text-[var(--ls-t4)]">{prueba.origen === 'servicio' ? (prueba.gastoUnCredito ? ' · ha costado 1 crédito' : ' · no ha costado crédito') : ' · ya estaba comprobada: no ha costado nada'}</span>
                    </>
                  ) : (
                    <>: no se ha podido comprobar. {prueba.motivo}</>
                  )}
                </span>
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
