'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { AlertOctagon, Bot, CalendarClock, FastForward, Hand, OctagonX, Play, Power, ShieldAlert, ShieldCheck, Siren } from 'lucide-react'
import { Boton, Confirmacion, Insignia, mezcla, Segmentado, Tarjeta, TACTIL } from '@/components/ui-ls'
import { COLOR_ESTADO, type TonoEstado } from '@/lib/estilo/denso'
import { motorFueraDeModoAgente } from '@/lib/ads/agente/pasos-calculo'
import { AGENTE, RAMPA, type ClaseDeCambio, type EstadoDelAgente, type FaseDeEvento, type MotivoDeFreno, type PanelDelAgente } from '@/lib/ads/agente/tipos'

/* ============================================================================================================================
 * PIEZAS COMUNES DE LA PESTAÑA «AGENTE» (las usan todas las tarjetas de components/marketing-test/agente/)
 * ========================================================================================================================== */

/** Un error de la API del agente con su código HTTP: «reanudar» devuelve 409 cuando el motivo del freno sigue */
export class ErrorDeAccion extends Error {
  constructor(
    mensaje: string,
    readonly estado: number,
  ) {
    super(mensaje)
  }
}

/**
 * Lo que las tarjetas piden a la pestaña: un PUT o un POST a /api/ads/cuenta/agente (el perfilId lo pone la pestaña). Si va bien, enseña `exito` y relee el panel; si falla, enseña el
 * error y LANZA (así la Confirmacion no se cierra). Quien necesita el código (reanudar → 409) lo lee de ErrorDeAccion.estado; con `callar409` ese error no se enseña.
 */
export type Accion = (metodo: 'PUT' | 'POST', cuerpo: Record<string, unknown>, opciones?: { exito?: string; callar409?: boolean }) => Promise<void>

/** El nombre de cada clase de cambio, en plural, como se cuenta en los topes y los resultados */
export const NOMBRE_DE_CLASE: Record<ClaseDeCambio, string> = {
  negativizar: 'Negativas',
  promover: 'Promover a exacta',
  puja_subir: 'Subidas de puja',
  puja_bajar: 'Bajadas de puja',
  puja_bajar_sin_pedidos: 'Bajadas de puja (sin pedidos)',
  pausar: 'Pausas de segmentaciones',
  presupuesto_subir: 'Subidas de presupuesto',
  presupuesto_bajar: 'Bajadas de presupuesto',
  pausar_campana: 'Pausas de campaña (sin stock)',
}

export const TEXTO_MOTIVO_FRENO: Record<MotivoDeFreno, string> = {
  gasto_disparado: 'el gasto de hoy se ha disparado',
  acos_cuenta: 'el ACoS de la cuenta ha empeorado mucho',
  errores_amazon: 'errores seguidos de Amazon',
  datos_viejos: 'los datos de Amazon están viejos',
  ventas_caidas: 'las ventas totales se han hundido',
  manual: 'lo ha frenado una persona',
}

export const ESTADO_DEL_AGENTE: Record<EstadoDelAgente, { texto: string; tono: TonoEstado }> = {
  apagado: { texto: 'Apagado', tono: 'gris' },
  ensayo: { texto: 'En ensayo', tono: 'cian' },
  activo: { texto: 'Activo', tono: 'verde' },
  frenado: { texto: 'Frenado', tono: 'rojo' },
}

export const FASE_DE_EVENTO: Record<FaseDeEvento, string> = {
  previo: 'empieza en 2 días',
  durante: 'en curso',
  posterior: 'los 7 días de después',
}

/** 25 → «25,0 %» (las cifras «Pct» del agente ya vienen en tanto por cien) */
export const pct = (n: number | null | undefined, decimales = 1): string => (n == null || Number.isNaN(n) ? '—' : `${n.toLocaleString('es-ES', { minimumFractionDigits: decimales, maximumFractionDigits: decimales })} %`)

/** Un instante ISO → «15/11» */
export const diaYMes = (iso: string | null | undefined): string => {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Madrid' }) : '—'
}

/** '2026-12-03' (o un ISO) → «3 dic» */
export const fechaCorta = (f: string | null | undefined): string => {
  if (!f) return '—'
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(f) ? `${f}T12:00:00Z` : f)
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : f
}

/** Campo de formulario de la pestaña: 36 px con ratón y 44 px con el dedo */
export const CAMPO_AGENTE =
  'h-9 w-full min-w-0 rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-3 text-[13px] text-[var(--ls-t1)] outline-none placeholder:text-[var(--ls-t4)] hover:border-[var(--ls-linea2)] focus:border-[var(--ls-acc-graf)] focus:shadow-[inset_0_0_0_1px_var(--ls-acc-graf)] disabled:opacity-55 [@media(pointer:coarse)]:min-h-[44px]'

/** Un aviso de color dentro de una tarjeta (parada general, freno, veda…) */
export function Aviso({ tono, icono: Icono, titulo, children, acciones }: { tono: TonoEstado; icono: typeof Bot; titulo: React.ReactNode; children?: React.ReactNode; acciones?: React.ReactNode }) {
  const color = COLOR_ESTADO[tono]
  return (
    <div className="rounded-[12px] border px-3 py-[10px]" style={{ borderColor: mezcla(color, 40), background: mezcla(color, 9) }} role={tono === 'rojo' ? 'alert' : undefined}>
      <div className="flex min-w-0 gap-[10px]">
        <Icono className="mt-[2px] h-4 w-4 shrink-0" style={{ color }} aria-hidden />
        <div className="min-w-0 flex-1 text-[12.5px] leading-[1.5] text-[var(--ls-t2)]">
          <div className="font-semibold text-[var(--ls-t1)]">{titulo}</div>
          {children}
          {acciones && <div className="mt-2 flex flex-wrap gap-2">{acciones}</div>}
        </div>
      </div>
    </div>
  )
}

/** El texto de la rampa de hoy: «Día 2 de 7: sin subidas de presupuesto, topes al 50 %» */
export function textoDeRampa(r: NonNullable<PanelDelAgente['rampa']>): string {
  const indice = Math.max(0, r.dia - 1)
  const tramo = [...RAMPA].reverse().find((t) => indice >= t.desdeDia)
  const que = r.soloBajadas ? 'solo negativas y bajadas' : tramo?.sinPresupuestoSubir ? 'sin subidas de presupuesto' : 'todo tipo de cambios'
  return `Día ${r.dia} de ${r.de}: ${que}, topes al ${Math.round(r.factor * 100)} %`
}

/* ============================================================================================================================
 * LA TARJETA DE ESTADO
 * ========================================================================================================================== */

type Dialogo = null | 'encender' | 'apagar' | 'saltar' | 'frenar' | 'reanudar' | 'reanudar-ignorando' | 'parar-todo' | 'quitar-parada'

/**
 * EL ESTADO DEL AGENTE: si está apagado, ensayando, activo o frenado, y por qué; la rampa, la veda de Black Friday, el evento de temporada y si la cuenta es pequeña. Un administrador lo enciende,
 * lo frena, lo reanuda o lo apaga; todo pasa por una confirmación porque el agente ESCRIBE en la cuenta del cliente.
 */
export function TarjetaDeEstado({ panel, accion, irA }: { panel: PanelDelAgente; accion: Accion; irA: (pestana: string) => void }) {
  const [dialogo, setDialogo] = useState<Dialogo>(null)
  const [firmarFicha, setFirmarFicha] = useState(false)
  const [modoAlApagar, setModoAlApagar] = useState<'aprueba' | 'sugiere'>('aprueba')
  const [motivoParada, setMotivoParada] = useState('')
  /** El 409 de «reanudar»: el motivo sigue y la API ofrece reanudar ignorándolo 24 h */
  const [rechazo, setRechazo] = useState<string | null>(null)

  const c = panel.config
  const estado: EstadoDelAgente = c?.estado ?? 'apagado'
  const info = ESTADO_DEL_AGENTE[estado]
  const esAdmin = panel.esAdmin
  const parada = panel.paradaGeneral

  // Por qué no se puede saltar el ensayo (si no se puede): la API lo comprueba igual, esto es para que se vea antes de pulsar
  const porQueNoSaltar = panel.veda
    ? `Estamos en la veda de ${panel.veda.nombre} (hasta el ${fechaCorta(panel.veda.hasta)}): el agente no pasa a activo hasta que acabe.`
    : !panel.puedeSaltarEnsayo
      ? 'La primera cuenta del agente tiene que pasar el ensayo: todavía no ha escrito en Amazon en ninguna cuenta.'
      : null

  const cerrar = (abierto: boolean) => {
    if (!abierto) setDialogo(null)
  }

  async function encender() {
    if (!panel.fichaFirmada && !firmarFicha) {
      const texto = 'Para encender el agente, la ficha de cuenta tiene que estar firmada: marca «Firmar la ficha de cuenta ahora» o fírmala en la pestaña Ficha.'
      toast.error(texto)
      throw new ErrorDeAccion(texto, 400)
    }
    await accion('PUT', { accion: 'encender', saltarEnsayo: true, firmarFicha: !panel.fichaFirmada && firmarFicha }, { exito: 'Agente encendido y activo: ya optimiza.' })
  }

  async function reanudar(ignorarMotivo: boolean) {
    try {
      await accion('PUT', { accion: 'reanudar', ignorarMotivo }, { exito: ignorarMotivo ? 'Reanudado ignorando ese motivo 24 h (rampa desde el día 2).' : 'Agente reanudado (rampa desde el día 2).', callar409: !ignorarMotivo })
      setRechazo(null)
    } catch (e) {
      // 409: el motivo sigue. No es un fallo de la pantalla: se cierra el diálogo y se ofrece reanudar ignorándolo
      if (!ignorarMotivo && e instanceof ErrorDeAccion && e.estado === 409) {
        setRechazo(e.message)
        return
      }
      throw e
    }
  }

  return (
    <Tarjeta
      variante="destacada"
      acento="marketing"
      icono={Bot}
      titulo="Agente PPC"
      subtitulo="Vigila el gasto de hoy, decide y aplica solo, mide lo que hace y avisa en #notificaciones-erp."
      acciones={
        <Insignia tono={info.tono} vivo={estado === 'activo' || estado === 'ensayo'} variante="suave">
          {info.texto}
        </Insignia>
      }
    >
      <div className="flex flex-col gap-3">
        {/* ---- parada general: manda sobre todo ---- */}
        {parada.parado && (
          <Aviso
            tono="rojo"
            icono={Siren}
            titulo="Parada general: el agente no da ningún paso en ninguna cuenta"
            acciones={
              esAdmin && !parada.porEntorno ? (
                <Boton variante="secundario" tamano="sm" icono={Play} onClick={() => setDialogo('quitar-parada')}>
                  Quitar la parada general
                </Boton>
              ) : undefined
            }
          >
            {parada.motivo && <p>Motivo: {parada.motivo}</p>}
            {parada.porEntorno && <p>La ha puesto el servidor (variable ADS_AGENTE_PARADO): solo se quita allí.</p>}
          </Aviso>
        )}

        {/* ---- el estado en palabras ---- */}
        <p className="text-[14px] font-medium leading-[1.45] text-[var(--ls-t1)]">{panel.estadoTexto}</p>

        {estado === 'frenado' && c && (
          <Aviso tono="rojo" icono={OctagonX} titulo={`Frenado${c.frenoMotivo ? `: ${TEXTO_MOTIVO_FRENO[c.frenoMotivo]}` : ''}`}>
            {c.frenoDetalle && <p>{c.frenoDetalle}</p>}
            <p className="text-[var(--ls-t3)]">Mientras está frenado solo vigila, mide y avisa; el motor ha vuelto a «Aprueba y aplica».{c.frenadoAt ? ` Desde el ${diaYMes(c.frenadoAt)}.` : ''}</p>
          </Aviso>
        )}

        {/* ---- en marcha en la base, pero el motor no está en «agente»: el bucle no la recorre (ni vigila, ni frena, ni avisa) ---- */}
        {motorFueraDeModoAgente(estado, panel.modoDelMotor) && (
          <Aviso tono="rojo" icono={AlertOctagon} titulo="El motor no está en modo agente: el agente no está corriendo">
            <p>
              El agente figura como «{estado === 'ensayo' ? 'En ensayo' : 'Activo'}», pero el motor automático está en «{panel.modoDelMotor || 'sin modo'}». Así no vigila el gasto, no frena
              ni avisa. Apágalo y vuelve a encenderlo para que el motor vuelva al modo «agente».
            </p>
          </Aviso>
        )}

        {rechazo && estado === 'frenado' && (
          <Aviso
            tono="ambar"
            icono={AlertOctagon}
            titulo="No se ha reanudado"
            acciones={
              esAdmin ? (
                <Boton variante="secundario" tamano="sm" icono={Play} onClick={() => setDialogo('reanudar-ignorando')}>
                  Reanudar ignorando este motivo 24 h
                </Boton>
              ) : undefined
            }
          >
            <p>{rechazo}</p>
          </Aviso>
        )}

        {/* ---- las circunstancias de hoy ---- */}
        {(panel.rampa || panel.veda || panel.evento || panel.cuentaPequena || panel.retenidas > 0) && (
          <div className="flex flex-col gap-2">
            {panel.rampa && (
              <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-[var(--ls-t2)]">
                <Insignia tono="cian" tamano="sm" icono={FastForward}>
                  Rampa
                </Insignia>
                <span>{textoDeRampa(panel.rampa)}.</span>
              </div>
            )}
            {panel.veda && (
              <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-[var(--ls-t2)]">
                <Insignia tono="ambar" tamano="sm" icono={CalendarClock}>
                  Veda · {panel.veda.nombre}
                </Insignia>
                <span>Hasta el {fechaCorta(panel.veda.hasta)} el agente puede ensayar, pero no pasa a activo.</span>
              </div>
            )}
            {panel.evento && (
              <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-[var(--ls-t2)]">
                <Insignia tono="ambar" tamano="sm" icono={CalendarClock}>
                  {panel.evento.nombre} · {FASE_DE_EVENTO[panel.evento.fase]}
                </Insignia>
                <span>
                  {panel.evento.fase === 'posterior'
                    ? 'No sube nada basándose en días del evento.'
                    : `Freno de gasto más holgado (${AGENTE.FRENO_GASTO_EVENTO_X.toLocaleString('es-ES')}×) y sin recortes por ritmo del mes.`}
                </span>
              </div>
            )}
            {panel.cuentaPequena && (
              <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-[var(--ls-t2)]">
                <Insignia tono="violeta" tamano="sm" icono={ShieldAlert}>
                  Modo defensivo
                </Insignia>
                <span>
                  Cuenta pequeña (menos de {AGENTE.CUENTA_PEQUENA_GASTO30.toLocaleString('es-ES')} de gasto en 30 días): negativas y bajadas; sube como mucho {AGENTE.CUENTA_PEQUENA_TOPE_SUBIR} pujas al día y no sube presupuestos.
                </span>
              </div>
            )}
            {panel.retenidas > 0 && (
              <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-[var(--ls-t2)]">
                <Insignia tono="ambar" tamano="sm" icono={Hand}>
                  {panel.retenidas} {panel.retenidas === 1 ? 'retenida' : 'retenidas'}
                </Insignia>
                <span>
                  {panel.retenidas === 1 ? 'Una propuesta espera' : 'Propuestas que esperan'} a una persona.{' '}
                  <button type="button" className={`underline underline-offset-2 ${TACTIL}`} onClick={() => irA('propuestas')}>
                    Verlas en Propuestas
                  </button>
                </span>
              </div>
            )}
          </div>
        )}

        {!panel.fichaFirmada && estado === 'apagado' && (
          <p className="text-[12.5px]" style={{ color: COLOR_ESTADO.ambar }}>
            La ficha de cuenta no está firmada: al encender puedes firmarla, o hazlo antes en la{' '}
            <button type="button" className={`underline underline-offset-2 ${TACTIL}`} onClick={() => irA('ficha')}>
              Ficha de cuenta
            </button>
            .
          </p>
        )}

        {/* ---- los mandos (solo administradores) ---- */}
        {esAdmin ? (
          <div className="flex flex-col gap-2 border-t border-[var(--ls-linea)] pt-3">
            <div className="flex flex-wrap gap-2">
              {estado === 'apagado' && (
                <Boton variante="primario" icono={Power} disabled={parada.parado} onClick={() => { setFirmarFicha(!panel.fichaFirmada); setDialogo('encender') }}>
                  Encender el agente
                </Boton>
              )}
              {estado === 'ensayo' && (
                <Boton variante="secundario" icono={FastForward} disabled={porQueNoSaltar !== null} title={porQueNoSaltar ?? 'Pasa a activo ya, con la rampa de 7 días'} onClick={() => setDialogo('saltar')}>
                  Saltar el ensayo
                </Boton>
              )}
              {estado === 'frenado' && (
                <Boton variante="primario" icono={Play} disabled={parada.parado} onClick={() => setDialogo('reanudar')}>
                  Reanudar
                </Boton>
              )}
              {(estado === 'ensayo' || estado === 'activo') && (
                <Boton variante="peligro" icono={OctagonX} onClick={() => setDialogo('frenar')}>
                  Frenar ahora
                </Boton>
              )}
              {estado !== 'apagado' && (
                <Boton variante="fantasma" icono={Power} onClick={() => setDialogo('apagar')}>
                  Apagar
                </Boton>
              )}
              {!parada.parado && (
                <Boton variante="fantasma" icono={Siren} onClick={() => { setMotivoParada(''); setDialogo('parar-todo') }} title="Para el agente en TODAS las cuentas">
                  Parada general
                </Boton>
              )}
            </div>
            {estado === 'ensayo' && porQueNoSaltar && <p className="text-[12px] text-[var(--ls-t3)]">No se puede saltar el ensayo: {porQueNoSaltar}</p>}
          </div>
        ) : (
          <p className="flex items-center gap-[6px] border-t border-[var(--ls-linea)] pt-3 text-[12px] text-[var(--ls-t3)]">
            <ShieldCheck className="h-3 w-3 shrink-0" aria-hidden /> Encender, frenar o apagar el agente es cosa de un administrador. Tú puedes deshacer sus cambios desde la línea de tiempo.
          </p>
        )}
      </div>

      {/* ---- confirmaciones ---- */}
      <Confirmacion
        abierto={dialogo === 'encender'}
        onCambio={cerrar}
        titulo="¿Encender el agente PPC en esta cuenta?"
        descripcion="El agente aplicará cambios en Amazon desde ya, sin pedir permiso: negativas, pujas, presupuestos y pausas. Sin ensayo, sin rampa y sin frenos automáticos: solo lo para un administrador."
        palabra="ENCENDER"
        tono="normal"
        textoConfirmar="Encender"
        onConfirmar={encender}
      >
        <div className="mt-3 flex flex-col gap-2 text-[12.5px] text-[var(--ls-t2)]">
          {!panel.fichaFirmada && (
            <label className={`flex cursor-pointer items-start gap-2 ${TACTIL}`}>
              <input type="checkbox" className="mt-[3px] h-4 w-4 shrink-0" checked={firmarFicha} onChange={(e) => setFirmarFicha(e.target.checked)} />
              <span>
                Firmar la ficha de cuenta ahora
                <span className="block text-[var(--ls-t4)]">Sin la ficha firmada no se puede aplicar nada en Amazon.</span>
              </span>
            </label>
          )}
        </div>
      </Confirmacion>

      <Confirmacion
        abierto={dialogo === 'saltar'}
        onCambio={cerrar}
        titulo="¿Saltar el ensayo?"
        descripcion="El agente pasa a activo ya y empieza a escribir en Amazon, con la rampa de 7 días: hoy solo negativas y bajadas, con los topes al 25 %."
        palabra={null}
        tono="normal"
        textoConfirmar="Saltar el ensayo"
        onConfirmar={() => accion('PUT', { accion: 'saltar-ensayo' }, { exito: 'Ensayo saltado: activo, con la rampa de 7 días.' })}
      />

      <Confirmacion
        abierto={dialogo === 'frenar'}
        onCambio={cerrar}
        titulo="¿Frenar el agente ahora?"
        descripcion="Deja de aplicar cambios y el motor vuelve a «Aprueba y aplica». Seguirá vigilando y midiendo. Para que vuelva a aplicar, hay que reanudarlo."
        palabra={null}
        textoConfirmar="Frenar"
        onConfirmar={() => accion('PUT', { accion: 'frenar' }, { exito: 'Agente frenado.' })}
      />

      <Confirmacion
        abierto={dialogo === 'reanudar'}
        onCambio={cerrar}
        titulo="¿Reanudar el agente?"
        descripcion="Antes de reanudar se comprueba que el motivo del freno ya no se da. Vuelve a aplicar cambios con la rampa desde el día 2."
        palabra={null}
        tono="normal"
        textoConfirmar="Reanudar"
        onConfirmar={() => reanudar(false)}
      />

      <Confirmacion
        abierto={dialogo === 'reanudar-ignorando'}
        onCambio={cerrar}
        titulo="¿Reanudar ignorando este motivo 24 h?"
        descripcion={`El motivo del freno sigue ahí. Durante 24 h el agente no volverá a frenarse por él (sí por cualquier otro). ${rechazo ?? ''}`.trim()}
        palabra="REANUDAR"
        textoConfirmar="Reanudar igualmente"
        onConfirmar={() => reanudar(true)}
      />

      <Confirmacion
        abierto={dialogo === 'apagar'}
        onCambio={cerrar}
        titulo="¿Apagar el agente?"
        descripcion="Deja de vigilar y de aplicar. Lo que ya ha aplicado se queda como está (se puede deshacer desde la línea de tiempo). Elige en qué modo queda el motor:"
        palabra={null}
        textoConfirmar="Apagar"
        onConfirmar={() => accion('PUT', { accion: 'apagar', modo: modoAlApagar }, { exito: `Agente apagado: el motor queda en «${modoAlApagar === 'aprueba' ? 'Aprueba y aplica' : 'Solo sugiere'}».` })}
      >
        <div className="mt-3">
          <Segmentado
            etiqueta="Modo del motor al apagar"
            anchoCompleto
            opciones={[
              { id: 'aprueba', texto: 'Aprueba y aplica' },
              { id: 'sugiere', texto: 'Solo sugiere' },
            ]}
            valor={modoAlApagar}
            onCambio={(v) => setModoAlApagar(v as 'aprueba' | 'sugiere')}
          />
        </div>
      </Confirmacion>

      <Confirmacion
        abierto={dialogo === 'parar-todo'}
        onCambio={cerrar}
        titulo="¿Parada general del agente?"
        descripcion="El agente deja de dar pasos en TODAS las cuentas hasta que un administrador quite la parada. No deshace nada de lo aplicado."
        palabra="PARAR"
        textoConfirmar="Parar en todas las cuentas"
        onConfirmar={() => accion('PUT', { accion: 'parada-general', parar: true, motivo: motivoParada.trim() || null }, { exito: 'Parada general puesta: el agente no da ningún paso.' })}
      >
        <label className="mt-3 block text-[12px] text-[var(--ls-t3)]">
          Motivo (opcional)
          <input className={`${CAMPO_AGENTE} mt-1`} value={motivoParada} maxLength={200} onChange={(e) => setMotivoParada(e.target.value)} placeholder="Ej.: revisión del Black Friday" />
        </label>
      </Confirmacion>

      <Confirmacion
        abierto={dialogo === 'quitar-parada'}
        onCambio={cerrar}
        titulo="¿Quitar la parada general?"
        descripcion="El agente vuelve a trabajar en las cuentas donde está encendido, en su próxima pasada (cada 5 minutos)."
        palabra={null}
        tono="normal"
        textoConfirmar="Quitar la parada"
        onConfirmar={() => accion('PUT', { accion: 'parada-general', parar: false }, { exito: 'Parada general quitada.' })}
      />
    </Tarjeta>
  )
}
