'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  ArrowRight,
  Calculator,
  CheckCircle2,
  FileSpreadsheet,
  Link2,
  Loader2,
  Upload,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  AVISO,
  BOTON,
  CAMPO,
  CIFRAS,
  LINEA,
  PANTALLA,
  RADIO,
  SUPERFICIE,
  TARJETA,
  TEXTO,
  TIPO,
  TITULO,
} from '@/lib/estilo/denso'
import { Aviso, Cargando, fechaCorta } from '@/components/plataforma/comun'
import {
  MESES,
  type CampoDeFichero,
  type CandidatoTesoreria,
  type EstadoDelMes,
  type GuardadoHecho,
  type PlanDeCalculo,
  esResultadoPorMarca,
  importeDeCalculo,
  mesEnLetra,
} from '@/lib/comisiones-puente/tipos'

/**
 * LIQUIDACIÓN: DEL FICHERO DEL DÍA 3 AL IMPORTE EN TESORERÍA.
 *
 * El día 4, en una pantalla: elegir cliente y mes, ver qué informe hay colgado,
 * calcular con la calculadora de siempre, MIRAR EL NÚMERO, validarlo, y que se
 * escriba en la fila de Tesorería de ese cliente. Lo que antes era abrir tres
 * pantallas y copiar una cifra a mano entre dos listas de clientes que no están
 * unidas por ninguna columna.
 *
 *
 * ============ POR QUÉ ESTA PANTALLA VIVE DENTRO DE COMISIONES ============
 *
 * No en Tax Reports: esa está abierta POR PERMISO DE APP a la persona que el día
 * 3 cuelga los ficheros, y aquí se ven el fee y la comisión de cada cliente.
 * No en Tesorería: esa pantalla ya lanza cinco consultas en paralelo y pinta una
 * rejilla de doce meses con sueldos y reparto entre socios; meterle subida de
 * ficheros y validación es darle un segundo trabajo a la pantalla más cargada
 * del ERP.
 * Aquí, porque el cliente, la regla de uno o dos ficheros y el desglose ya son
 * de este módulo — y porque en el menú Comisiones y Tesorería ya están juntas en
 * el grupo «Dinero».
 *
 *
 * ============ CALCULAR NO GUARDA ============
 *
 * Son dos botones y dos pasos, en ese orden, porque Raúl lo pidió así: «cuando
 * la tenga y la valide». Entre los dos hay un número a la vista y su desglose.
 *
 *
 * ============ EL FEE NO SE TOCA ============
 *
 * Ni aquí ni en la ruta de guardado. Se ENSEÑA el que hay puesto, para que se
 * vea que sigue ahí después de escribir la comisión, y no hay ningún campo para
 * cambiarlo: ese lo pone Raúl a mano en Tesorería.
 */

interface ClienteLista {
  id: string
  name: string
}

/** La forma suelta de lo que devuelve /api/commissions/process */
type ResultadoCalculo = Record<string, unknown>

/**
 * UN CÁLCULO NUNCA VIAJA SOLO: VIAJA CON EL CLIENTE Y EL MES DE LOS QUE SALIÓ.
 * ==========================================================================
 *
 * Es el arreglo de la peor forma que tenía esta pantalla de cobrarle de más a un
 * cliente, y conviene contarla entera porque no daba ningún error.
 *
 * `calcular()` tarda: firma enlaces, baja dos ficheros de Tax Reports y llama a
 * la calculadora con ellos. Son varios segundos. Si en ese rato quien está
 * delante cambia el desplegable de cliente —o el de mes—, el cálculo que sigue
 * en el aire TERMINA IGUAL y escribe su resultado en la pantalla. Y entonces:
 *
 *   · arriba pone «Lenobotics», porque es lo que hay elegido,
 *   · en grande sale la comisión de ShoesF, porque es la que terminó de calcular,
 *   · y «Validar y guardar» manda el `clienteId` de Lenobotics con el importe de
 *     ShoesF, que el servidor escribe obedientemente en la fila de Tesorería de
 *     Lenobotics — su pareja, la de verdad, la que él mismo comprueba.
 *
 * Ninguna de las comprobaciones del servidor lo ve: el cliente existe, tiene
 * pareja, el mes no está facturado y el importe es un número razonable. Sale una
 * factura con la cifra de otro. El `useEffect` que limpia al cambiar de cliente
 * NO lo impedía: limpia en el momento del cambio, y el cálculo escribe DESPUÉS.
 *
 * Por eso el resultado se guarda junto a de quién y de qué mes es, y todo lo de
 * abajo —lo que se pinta y lo que se manda a guardar— sale de este objeto o no
 * sale. Si no cuadra con lo que hay elegido, no hay número en pantalla: no se
 * puede validar lo que no se ve.
 */
interface CalculoEnPantalla {
  clienteId: string
  anio: number
  mes: number
  data: ResultadoCalculo
}

const EUROS = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' })

function euros(valor: number | null | undefined): string {
  if (valor == null || !Number.isFinite(valor)) return '—'
  return EUROS.format(valor)
}

/** El mes que se va a liquidar casi siempre: el anterior al de hoy */
export function mesPorDefecto(): { anio: number; mes: number } {
  const hoy = new Date()
  const m = hoy.getMonth() // 0-11, o sea que ya es «el mes pasado» en base 1
  return m === 0
    ? { anio: hoy.getFullYear() - 1, mes: 12 }
    : { anio: hoy.getFullYear(), mes: m }
}

/**
 * AHORA LA ELECCIÓN VIVE FUERA (en `PanelComisiones`, con la barra de clientes y el mes): esta pantalla recibe el cliente, el año y el
 * mes ya elegidos y se ocupa de lo de siempre —ver qué hay, calcular, validar, emparejar—. `onCambio` avisa al panel cuando se ha
 * escrito algo (una pareja o una comisión) para que la barra de la izquierda se refresque.
 */
export function PantallaLiquidacion({
  clienteId,
  anio,
  mes,
  onCambio,
}: {
  clienteId: string
  anio: number
  mes: number
  onCambio?: () => void
}) {

  const [estado, setEstado] = useState<EstadoDelMes | null>(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [tasaManual, setTasaManual] = useState('')
  const [tramoBeneficio, setTramoBeneficio] = useState<'0.15' | '0.35'>('0.15')
  const [ficheroAMano, setFicheroAMano] = useState<File | null>(null)

  const [calculando, setCalculando] = useState(false)
  const [calculo, setCalculo] = useState<CalculoEnPantalla | null>(null)

  const [guardando, setGuardando] = useState(false)
  const [conflicto, setConflicto] = useState<{ actual: number; nuevo: number; mensaje: string } | null>(
    null
  )
  const [guardado, setGuardado] = useState<GuardadoHecho | null>(null)

  const entradaManual = useRef<HTMLInputElement>(null)

  /**
   * LO QUE HAY ELEGIDO AHORA MISMO, LEÍBLE DESDE DENTRO DE UN `await`.
   *
   * Las funciones de abajo son `async` y sus variables se quedan congeladas en
   * el valor que tenían cuando empezaron: dentro de `calcular()`, `clienteId` es
   * el de cuando se pulsó el botón, aunque el desplegable ya diga otro. Este ref
   * es la única forma de preguntar «¿esto sigue siendo lo que hay elegido?»
   * después de una respuesta que ha tardado, y es lo que impide que una consulta
   * lenta de un cliente pinte su estado encima del de otro.
   */
  const seleccionViva = useRef({ clienteId, anio, mes })
  seleccionViva.current = { clienteId, anio, mes }

  const sigueSiendoLoElegido = useCallback(
    (c: string, a: number, m: number) =>
      seleccionViva.current.clienteId === c &&
      seleccionViva.current.anio === a &&
      seleccionViva.current.mes === m,
    []
  )

  /**
   * El resultado solo se enseña si es DE LO QUE HAY ELEGIDO. Un cálculo que
   * termina tarde, cuando ya se ha cambiado de cliente o de mes, se queda
   * guardado pero no se pinta ni se puede validar: no es de este mes.
   */
  const resultado = useMemo(
    () =>
      calculo && calculo.clienteId === clienteId && calculo.anio === anio && calculo.mes === mes
        ? calculo.data
        : null,
    [calculo, clienteId, anio, mes]
  )

  /* ---------- Leer el estado del mes ---------- */

  const cargar = useCallback(async () => {
    const mio = { clienteId, anio, mes }
    if (!clienteId) {
      setEstado(null)
      return
    }
    setCargando(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/comisiones-puente?clienteId=${encodeURIComponent(clienteId)}&anio=${anio}&mes=${mes}`,
        { cache: 'no-store' }
      )
      const payload = (await res.json().catch(() => null)) as (EstadoDelMes & { error?: string }) | null

      // Mientras esto viajaba se ha cambiado de cliente o de mes: esta respuesta
      // ya no habla de lo que hay en pantalla. Se tira. Sin esto, una consulta
      // lenta pinta el fee y la comisión de un cliente bajo el nombre de otro.
      if (!sigueSiendoLoElegido(mio.clienteId, mio.anio, mio.mes)) return

      if (!res.ok || !payload) {
        setEstado(null)
        setError(payload?.error ?? 'No se ha podido leer el estado de ese mes.')
        return
      }
      setEstado(payload)
    } catch {
      if (!sigueSiendoLoElegido(mio.clienteId, mio.anio, mio.mes)) return
      setEstado(null)
      setError('No hay conexión con el servidor. Inténtalo otra vez.')
    } finally {
      if (sigueSiendoLoElegido(mio.clienteId, mio.anio, mio.mes)) setCargando(false)
    }
  }, [clienteId, anio, mes, sigueSiendoLoElegido])

  // Al cambiar de cliente o de mes, lo de antes deja de valer. Ojo: esto limpia
  // en el momento del cambio y NO basta por sí solo — un cálculo que siga en el
  // aire escribirá su resultado después. Lo que de verdad impide validar el
  // número de un cliente teniendo otro elegido es que `resultado` solo deja ver
  // el cálculo cuyo cliente y mes coinciden con los de arriba.
  useEffect(() => {
    setCalculo(null)
    setGuardado(null)
    setConflicto(null)
    setFicheroAMano(null)
    if (entradaManual.current) entradaManual.current.value = ''
    void cargar()
  }, [cargar])

  /* ---------- Emparejar con Tesorería ---------- */

  async function emparejar(treasuryClientId: string | null) {
    if (!clienteId) return
    const mio = { clienteId, anio, mes }
    const res = await fetch('/api/comisiones-puente/enlace', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clienteId, treasuryClientId, anio, mes }),
    })
    const payload = (await res.json().catch(() => null)) as
      | { ok?: boolean; estado?: EstadoDelMes | null; error?: string }
      | null

    if (!res.ok) {
      toast.error(payload?.error ?? 'No se ha podido guardar la pareja')
      return
    }
    // La pareja se ha guardado igual —es del cliente, no del mes—, pero su
    // estado solo se pinta si ese cliente sigue siendo el de la pantalla.
    if (sigueSiendoLoElegido(mio.clienteId, mio.anio, mio.mes) && payload?.estado) {
      setEstado(payload.estado)
    } else {
      void cargar()
    }
    toast.success(treasuryClientId ? 'Pareja guardada' : 'Pareja deshecha')
    onCambio?.()
  }

  /* ---------- Calcular ---------- */

  async function calcular() {
    if (!estado || !clienteId) return

    /**
     * DE QUIÉN Y DE QUÉ MES ES ESTE CÁLCULO. Se apunta ANTES de la primera
     * espera y ya no cambia: lo que salga de aquí se etiqueta con esto, no con
     * lo que haya en el desplegable cuando termine.
     */
    const mio = { clienteId, anio, mes }

    setCalculando(true)
    setError(null)
    setCalculo(null)
    setGuardado(null)
    setConflicto(null)

    try {
      /**
       * PASO 1: el servidor comprueba y firma. Aquí no se decide qué fichero
       * vale ni en qué campo va: eso lo dice el plan, que es quien ha mirado la
       * base.
       */
      const resPlan = await fetch('/api/comisiones-puente/calcular', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clienteId: mio.clienteId,
          anio: mio.anio,
          mes: mio.mes,
          tasaManual: tasaManual.trim() || null,
          tramoBeneficio,
        }),
      })
      const datosPlan = (await resPlan.json().catch(() => null)) as
        | { plan: PlanDeCalculo; estado: EstadoDelMes; error?: string }
        | null

      // Se ha cambiado de cliente o de mes mientras el servidor firmaba los
      // enlaces. Se para AQUÍ: seguir significaría bajar los ficheros de un
      // cliente y calcular con la pantalla enseñando otro.
      if (!sigueSiendoLoElegido(mio.clienteId, mio.anio, mio.mes)) return

      if (!resPlan.ok || !datosPlan?.plan) {
        setError(datosPlan?.error ?? 'No se ha podido preparar el cálculo.')
        return
      }

      const plan = datosPlan.plan
      setEstado(datosPlan.estado)

      const formulario = new FormData()
      formulario.append('clientId', plan.clientId)

      /**
       * PASO 2: bajar los ficheros con los enlaces firmados —60 segundos, uno
       * por fichero— y volver a mandarlos al cálculo de siempre. Es el mismo
       * camino que hoy hace una persona con el botón «Descargar» de Tax Reports
       * y el de subir de la calculadora; lo único que cambia es que no hay que
       * acordarse de cuál era.
       */
      for (const descarga of plan.descargas) {
        const respuesta = await fetch(descarga.url)
        if (!respuesta.ok) {
          setError(
            `No se ha podido bajar «${descarga.nombre}» de Tax Reports. El enlace caduca en 60 ` +
              'segundos: vuelve a pulsar Calcular.'
          )
          return
        }
        const contenido = await respuesta.blob()
        formulario.append(
          descarga.campo,
          new File([contenido], descarga.nombre, { type: contenido.type || 'text/csv' })
        )
      }

      for (const campo of plan.aMano) {
        if (!ficheroAMano) {
          setError(textoDelCampoAMano(campo))
          return
        }
        formulario.append(campo, ficheroAMano)
      }

      for (const [clave, valor] of Object.entries(plan.extras)) {
        formulario.append(clave, valor)
      }

      /**
       * PASO 3: LA CALCULADORA DE SIEMPRE, SIN TOCARLE UNA LÍNEA.
       *
       * Mismo endpoint, mismo FormData y mismo contrato que
       * components/commissions/CommissionsCalculator.tsx. Si esta pantalla se
       * cae, esa sigue funcionando exactamente igual que hoy.
       */
      const resCalculo = await fetch('/api/commissions/process', {
        method: 'POST',
        body: formulario,
      })
      const datosCalculo = (await resCalculo.json().catch(() => null)) as
        | { success?: boolean; data?: ResultadoCalculo; error?: string; details?: string }
        | null

      if (!resCalculo.ok || !datosCalculo?.success || !datosCalculo.data) {
        if (sigueSiendoLoElegido(mio.clienteId, mio.anio, mio.mes)) {
          setError(datosCalculo?.error ?? 'El cálculo no ha podido terminar.')
        }
        return
      }

      // Etiquetado con de quién es. Si ya se ha cambiado de cliente, esto se
      // guarda pero `resultado` no lo dejará ver ni validar: no es de este mes.
      setCalculo({ ...mio, data: datosCalculo.data })
    } catch {
      if (sigueSiendoLoElegido(mio.clienteId, mio.anio, mio.mes)) {
        setError('No hay conexión con el servidor. Inténtalo otra vez.')
      }
    } finally {
      // Este sí se apaga siempre, aunque el cálculo ya no sea del cliente que
      // hay elegido: es lo que tiene desactivado el botón «Calcular», y dejarlo
      // encendido dejaría la pantalla sin poder calcular hasta recargarla.
      setCalculando(false)
    }
  }

  /* ---------- Validar y guardar ---------- */

  const importe = useMemo(() => importeDeCalculo(resultado), [resultado])

  async function guardar(confirmar: boolean) {
    if (importe == null) return

    /**
     * EL IMPORTE Y SU DESTINO SALEN DEL MISMO OBJETO, NO DE LOS DESPLEGABLES.
     *
     * `calculo` lleva dentro el cliente y el mes de los que salió el número, así
     * que mandando esos tres juntos es imposible escribir la comisión de uno en
     * la fila de otro: o van los tres del mismo cálculo, o no va ninguno.
     *
     * La comprobación de que además coinciden con lo que hay elegido es la que
     * impide validar a ciegas: si no cuadraran, `resultado` sería null y no
     * habría número en pantalla, pero se dice en voz alta por si algún día
     * alguien llama a esto desde otro sitio.
     */
    if (
      !calculo ||
      calculo.clienteId !== clienteId ||
      calculo.anio !== anio ||
      calculo.mes !== mes
    ) {
      toast.error(
        'Ese cálculo es de otro cliente o de otro mes. Vuelve a pulsar Calcular con lo que tienes elegido.'
      )
      return
    }

    setGuardando(true)
    try {
      const res = await fetch('/api/comisiones-puente/guardar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clienteId: calculo.clienteId,
          anio: calculo.anio,
          mes: calculo.mes,
          importe,
          confirmar,
        }),
      })
      const payload = (await res.json().catch(() => null)) as {
        guardado?: GuardadoHecho
        estado?: EstadoDelMes | null
        error?: string
        conflicto?: { actual: number; nuevo: number } | null
      } | null

      if (res.status === 409 && payload?.conflicto) {
        setConflicto({
          actual: payload.conflicto.actual,
          nuevo: payload.conflicto.nuevo,
          mensaje: payload.error ?? '',
        })
        return
      }
      if (!res.ok || !payload?.guardado) {
        toast.error(payload?.error ?? 'No se ha podido guardar en Tesorería')
        return
      }

      // Se ha escrito, y eso no se deshace: el aviso sale siempre. Lo que solo
      // se pinta si no se ha cambiado de cliente entretanto es el estado, para
      // no enseñar el fee y la comisión de un cliente bajo el nombre de otro.
      toast.success('Comisión guardada en Tesorería')
      onCambio?.()

      if (!sigueSiendoLoElegido(calculo.clienteId, calculo.anio, calculo.mes)) return

      setConflicto(null)
      setGuardado(payload.guardado)
      if (payload.estado) setEstado(payload.estado)
    } catch {
      toast.error('No hay conexión con el servidor. Inténtalo otra vez.')
    } finally {
      setGuardando(false)
    }
  }

  /* ---------- Pintado ---------- */

  const perfil = estado?.cliente.perfil
  const necesitaAMano = (estado?.aMano.length ?? 0) > 0
  const listoParaCalcular =
    Boolean(estado?.puedeCalcular) && (!necesitaAMano || ficheroAMano != null)

  return (
    <div className={`${PANTALLA.cuerpo} max-w-[980px]`} data-liquidacion>
      {cargando && (
        <div className="flex justify-end">
          <Loader2 className={`h-3 w-3 animate-spin ${TEXTO.t4}`} />
        </div>
      )}

      {error && (
        <Aviso tono="rojo" icono={AlertTriangle}>
          {error}
        </Aviso>
      )}

      {estado?.faltaMigracion && (
        <Aviso tono="ambar" icono={AlertTriangle}>
          <span className={AVISO.fuerte}>Falta lanzar una migración.</span> Abre el editor SQL de
          Supabase y pega{' '}
          <code className={TEXTO.t1}>
            {estado.faltaMigracion === '200'
              ? 'supabase/migrations/200_tax_reports.sql'
              : 'supabase/migrations/201_puente_comision_tesoreria.sql'}
          </code>{' '}
          entero. Hasta entonces esta pantalla no puede{' '}
          {estado.faltaMigracion === '200' ? 'encontrar los informes' : 'guardar nada en Tesorería'}.
        </Aviso>
      )}

      {estado && (
        <>
          {/* ---------- La pareja en Tesorería ---------- */}
          <ParejaTesoreria
            estado={estado}
            onElegir={(id) => void emparejar(id)}
          />

          {/* ---------- Los ficheros ---------- */}
          <div className={TARJETA.base}>
            <div className={TARJETA.cabecera}>
              <FileSpreadsheet className={`h-[13px] w-[13px] ${TEXTO.t4}`} />
              <span className={TITULO.seccion}>El informe de {mesEnLetra(anio, mes)}</span>
            </div>
            <div className={`${TARJETA.cuerpo} space-y-[9px]`}>
              <FilaFichero
                rotulo={perfil?.dosFicheros ? `Año actual (${anio})` : 'Informe del mes'}
                fichero={estado.ficheroActual}
              />

              {perfil?.dosFicheros && (
                <>
                  <FilaFichero rotulo={`Año anterior (${anio - 1})`} fichero={estado.ficheroAnterior} />
                  {estado.aMano.includes('filePreviousYear') && (
                    <Aviso tono="ambar" icono={Upload}>
                      <span className={AVISO.fuerte}>
                        Este cliente compara el mismo mes de dos años
                      </span>{' '}
                      y el del año pasado no está en Tax Reports. Es lo normal y no es un fallo: ahí
                      solo cabe un fichero por mes y los informes se retiran a los seis meses, porque
                      llevan datos de los compradores. Súbelo tú aquí.
                      <input
                        ref={entradaManual}
                        type="file"
                        accept=".csv,.xlsx,.xls"
                        className={`mt-[6px] block ${TIPO.s} ${TEXTO.t3}`}
                        onChange={(e) => setFicheroAMano(e.target.files?.[0] ?? null)}
                      />
                    </Aviso>
                  )}
                </>
              )}

              {/*
                Si lo que falta es una migración, ya lo dice el aviso de arriba
                con el nombre del .sql: repetirlo aquí con un enlace a Tax
                Reports mandaría a mirar una pantalla que tampoco funciona.
              */}
              {!estado.faltaMigracion &&
                estado.faltan.map((frase) => (
                <Aviso key={frase} tono="rojo" icono={AlertTriangle}>
                  {frase}{' '}
                  <Link href="/dashboard/tax-reports" className="underline">
                    Ir a Tax Reports
                  </Link>
                </Aviso>
              ))}

              {/* Lo que este cliente necesita además del fichero */}
              {(perfil?.admiteTasaManual || perfil?.pideTramoBeneficio) && (
                <div className={CAMPO.rejilla}>
                  {perfil?.admiteTasaManual && (
                    <div className={CAMPO.contenedor}>
                      <label className={CAMPO.etiqueta}>Tasa manual, en % (opcional)</label>
                      <input
                        className={`${CAMPO.input} ${CAMPO.numero}`}
                        inputMode="decimal"
                        placeholder="3"
                        value={tasaManual}
                        onChange={(e) => setTasaManual(e.target.value)}
                      />
                      <p className={CAMPO.nota}>
                        En porcentaje, como en la calculadora: «3» son el 3 %. Vacío = la tasa
                        pactada del cliente.
                      </p>
                    </div>
                  )}
                  {perfil?.pideTramoBeneficio && (
                    <div className={CAMPO.contenedor}>
                      <label className={CAMPO.etiqueta}>Tramo sobre beneficio</label>
                      <select
                        className={CAMPO.input}
                        value={tramoBeneficio}
                        onChange={(e) => setTramoBeneficio(e.target.value === '0.35' ? '0.35' : '0.15')}
                      >
                        <option value="0.15">15 %</option>
                        <option value="0.35">35 %</option>
                      </select>
                      <p className={CAMPO.nota}>
                        Se elige antes de calcular: la diferencia entre los dos tramos no es un
                        matiz.
                      </p>
                    </div>
                  )}
                </div>
              )}

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={!listoParaCalcular || calculando}
                  onClick={() => void calcular()}
                  className={`${BOTON.base} ${BOTON.alto} ${BOTON.primario}`}
                >
                  {calculando ? (
                    <Loader2 className="h-[13px] w-[13px] animate-spin" />
                  ) : (
                    <Calculator className="h-[13px] w-[13px]" />
                  )}
                  Calcular
                </button>
                <span className={`${TIPO.s} ${TEXTO.t4}`}>Calcular no guarda nada.</span>
              </div>
            </div>
          </div>

          {/* ---------- El resultado ---------- */}
          {resultado && (
            <Resultado
              resultado={resultado}
              importe={importe}
              estado={estado}
              guardando={guardando}
              guardado={guardado}
              conflicto={conflicto}
              onGuardar={(confirmar) => void guardar(confirmar)}
              onCancelarConflicto={() => setConflicto(null)}
            />
          )}
        </>
      )}

      {clienteId && !estado && !cargando && !error && <Cargando />}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* La pareja con Tesorería                                             */
/* ------------------------------------------------------------------ */

/**
 * SE PROPONE LA MÁS PARECIDA. NO SE ELIGE SOLA.
 *
 * De once clientes de comisiones, solo cinco se llaman igual que su fila de
 * Tesorería. Los otros seis no se parecen en nada —Lenobotics es «Ocio Global
 * Import S.L»—, así que al lado de cada candidata van sus últimos importes: es
 * lo único que deja reconocerla de un vistazo.
 */
function ParejaTesoreria({
  estado,
  onElegir,
}: {
  estado: EstadoDelMes
  onElegir: (id: string | null) => void
}) {
  const { candidatos, treasuryClientId, nombre } = estado.enlace

  const ordenados = useMemo(() => {
    return [...candidatos].sort((a, b) => {
      if (a.seParece !== b.seParece) return a.seParece ? -1 : 1
      if (a.activo !== b.activo) return a.activo ? -1 : 1
      return a.nombre.localeCompare(b.nombre, 'es')
    })
  }, [candidatos])

  const sugerida = ordenados.find((c) => c.seParece && !c.ocupadoPor)

  return (
    <div className={TARJETA.base}>
      <div className={TARJETA.cabecera}>
        <Link2 className={`h-[13px] w-[13px] ${TEXTO.t4}`} />
        <span className={TITULO.seccion}>Cliente de Tesorería</span>
        {treasuryClientId && (
          <span className={`${TIPO.s} ${TEXTO.t3} ml-auto truncate`}>{nombre}</span>
        )}
      </div>
      <div className={`${TARJETA.cuerpo} space-y-[7px]`}>
        {!treasuryClientId && (
          <Aviso tono="ambar" icono={AlertTriangle}>
            <span className={AVISO.fuerte}>Este cliente no tiene pareja en Tesorería todavía</span>,
            así que no hay dónde escribir la comisión. Elígela aquí: se guarda una vez y ya no se
            vuelve a preguntar.
            {sugerida && (
              <>
                {' '}
                Se parece a <span className={AVISO.fuerte}>{sugerida.nombre}</span>, pero
                compruébalo: hay seis clientes cuyo nombre no se parece en nada al de su sociedad.
              </>
            )}
          </Aviso>
        )}

        <select
          className={`${CAMPO.input} max-w-[420px]`}
          value={treasuryClientId ?? ''}
          onChange={(e) => onElegir(e.target.value || null)}
        >
          <option value="">— Sin emparejar —</option>
          {ordenados.map((c) => (
            <option key={c.id} value={c.id} disabled={c.ocupadoPor != null}>
              {etiquetaCandidato(c)}
            </option>
          ))}
        </select>

        <p className={CAMPO.nota}>
          Una fila de Tesorería solo puede tener un cliente de comisiones: solo hay una celda de
          comisión por mes, y la segunda borraría a la primera. Por eso las que ya están cogidas
          salen en gris con el nombre de quien las tiene.
        </p>
      </div>
    </div>
  )
}

function etiquetaCandidato(c: CandidatoTesoreria): string {
  const partes: string[] = [c.nombre]
  if (c.seParece) partes.push('· se llama igual')
  if (!c.activo) partes.push('· inactivo')
  if (c.ocupadoPor) partes.push(`· ya es de ${c.ocupadoPor}`)
  if (c.ultimosMeses.length > 0) {
    const ultimo = c.ultimosMeses[0]
    partes.push(
      `· ${ultimo.period.slice(0, 7)}: fee ${ultimo.fee ?? '—'} / com ${ultimo.commission ?? '—'}`
    )
  }
  return partes.join(' ')
}

/* ------------------------------------------------------------------ */
/* Una línea de fichero                                                */
/* ------------------------------------------------------------------ */

function FilaFichero({
  rotulo,
  fichero,
}: {
  rotulo: string
  fichero: EstadoDelMes['ficheroActual']
}) {
  return (
    <div className={`flex items-center gap-2 ${TIPO.s}`}>
      <span className={`${TITULO.rotulo} w-[130px] shrink-0`}>{rotulo}</span>
      {fichero && !fichero.purgado ? (
        <span className={`${TEXTO.t2} truncate`}>
          {fichero.nombreOriginal}{' '}
          <span className={TEXTO.t4}>· subido el {fechaCorta(fichero.subidoAt)}</span>
        </span>
      ) : (
        <span className={TEXTO.t4}>{fichero?.purgado ? 'retirado a los seis meses' : 'no está'}</span>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* El resultado y la validación                                        */
/* ------------------------------------------------------------------ */

function Resultado({
  resultado,
  importe,
  estado,
  guardando,
  guardado,
  conflicto,
  onGuardar,
  onCancelarConflicto,
}: {
  resultado: ResultadoCalculo
  importe: number | null
  estado: EstadoDelMes
  guardando: boolean
  guardado: GuardadoHecho | null
  conflicto: { actual: number; nuevo: number; mensaje: string } | null
  onGuardar: (confirmar: boolean) => void
  onCancelarConflicto: () => void
}) {
  const porMarca = esResultadoPorMarca(resultado)
  const yaFacturado = estado.tesoreria?.facturado === true
  const sinPareja = !estado.enlace.treasuryClientId

  return (
    <div className={TARJETA.base}>
      <div className={TARJETA.cabecera}>
        <Calculator className={`h-[13px] w-[13px] ${TEXTO.t4}`} />
        <span className={TITULO.seccion}>
          Comisión de {mesEnLetra(estado.anio, estado.mes)}
        </span>
      </div>

      <div className={`${TARJETA.cuerpo} space-y-[9px]`}>
        <div className={CIFRAS.tira}>
          <span className={CIFRAS.celda}>
            <span className={CIFRAS.valor}>{euros(importe)}</span>
            <span className={CIFRAS.rotulo}>comisión calculada</span>
          </span>
          <span className={CIFRAS.celda}>
            <span className={CIFRAS.valor}>{euros(estado.tesoreria?.fee ?? null)}</span>
            <span className={CIFRAS.rotulo}>fee en Tesorería (no se toca)</span>
          </span>
          <span className={CIFRAS.celda}>
            <span className={CIFRAS.valor}>{euros(estado.tesoreria?.commission ?? null)}</span>
            <span className={CIFRAS.rotulo}>comisión apuntada hoy</span>
          </span>
        </div>

        {importe == null && (
          <Aviso tono="rojo" icono={AlertTriangle}>
            <span className={AVISO.fuerte}>El cálculo ha terminado pero no se reconoce el
            importe.</span>{' '}
            No se puede guardar a ciegas: antes que escribir un cero en el mes que se va a facturar,
            se prefiere no escribir nada. Cópialo a mano en Tesorería y avisa.
          </Aviso>
        )}

        {porMarca ? <DesglosePorMarcaSimple resultado={resultado} /> : <DesgloseNormal resultado={resultado} />}

        {/* ---------- Validar ---------- */}
        {guardado ? (
          <Aviso tono="verde" icono={CheckCircle2}>
            <span className={AVISO.fuerte}>
              {euros(guardado.commission)} escritos en «{guardado.clienteTesoreria}»
            </span>{' '}
            para {mesEnLetra(estado.anio, estado.mes)} ({guardado.period}).{' '}
            {guardado.creada ? 'Ese mes no tenía fila y se ha creado. ' : ''}
            El fee ({euros(guardado.fee)}) no se ha tocado: ese lo pones tú.{' '}
            <Link href="/dashboard/tesoreria" className="underline">
              Ver en Tesorería
            </Link>
          </Aviso>
        ) : conflicto ? (
          <Aviso tono="ambar" icono={AlertTriangle}>
            <span className={AVISO.fuerte}>Ese mes ya tenía otra comisión apuntada.</span>{' '}
            {conflicto.mensaje}
            <div className="mt-[7px] flex items-center gap-2">
              <button
                type="button"
                disabled={guardando}
                onClick={() => onGuardar(true)}
                className={`${BOTON.base} ${BOTON.primario}`}
              >
                Sí, poner {euros(conflicto.nuevo)}
              </button>
              <button
                type="button"
                onClick={onCancelarConflicto}
                className={`${BOTON.base} ${BOTON.secundario}`}
              >
                Dejar {euros(conflicto.actual)}
              </button>
            </div>
          </Aviso>
        ) : (
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={guardando || importe == null || sinPareja || yaFacturado}
              onClick={() => onGuardar(false)}
              className={`${BOTON.base} ${BOTON.alto} ${BOTON.primario}`}
            >
              {guardando ? (
                <Loader2 className="h-[13px] w-[13px] animate-spin" />
              ) : (
                <ArrowRight className="h-[13px] w-[13px]" />
              )}
              Validar y guardar en Tesorería
            </button>
            <span className={`${TIPO.s} ${TEXTO.t4}`}>
              {sinPareja
                ? 'Falta elegir el cliente de Tesorería.'
                : yaFacturado
                  ? `${mesEnLetra(estado.anio, estado.mes)} ya está facturado${
                      estado.tesoreria?.numeroFactura ? ` (${estado.tesoreria.numeroFactura})` : ''
                    }.`
                  : `Se escribe en «${estado.enlace.nombre}», solo la comisión.`}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

/** El desglose de Keslem: dos bloques y lo que se ha quedado sin ubicar */
function DesglosePorMarcaSimple({ resultado }: { resultado: ResultadoCalculo }) {
  const bloques = (resultado.bloques ?? []) as {
    etiqueta: string
    anterior: number
    actual: number
    excedente: number
    tasa: number
    comision: number
  }[]
  const sinUbicar = resultado.sinUbicar as { total?: number } | undefined

  return (
    <div className={`${RADIO.r2} border ${LINEA.normal} ${SUPERFICIE.sup} overflow-hidden`}>
      <table className="w-full border-separate border-spacing-0 text-[12.5px]">
        <thead>
          <tr>
            {['Bloque', 'Año anterior', 'Año actual', 'Excedente', 'Tasa', 'Comisión'].map((t) => (
              <th
                key={t}
                className="h-[26px] px-2 text-left text-[11px] font-semibold text-[var(--ls-t4)] border-b border-[var(--ls-linea2)]"
              >
                {t}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {bloques.map((b) => (
            <tr key={b.etiqueta}>
              <td className="h-7 px-2 text-[var(--ls-t2)] border-b border-[var(--ls-linea)]">
                {b.etiqueta}
              </td>
              <td className="h-7 px-2 text-right tabular-nums text-[var(--ls-t2)] border-b border-[var(--ls-linea)]">
                {euros(b.anterior)}
              </td>
              <td className="h-7 px-2 text-right tabular-nums text-[var(--ls-t2)] border-b border-[var(--ls-linea)]">
                {euros(b.actual)}
              </td>
              <td className="h-7 px-2 text-right tabular-nums text-[var(--ls-t2)] border-b border-[var(--ls-linea)]">
                {euros(b.excedente)}
              </td>
              <td className="h-7 px-2 text-right tabular-nums text-[var(--ls-t2)] border-b border-[var(--ls-linea)]">
                {(b.tasa * 100).toFixed(2)} %
              </td>
              <td className="h-7 px-2 text-right tabular-nums text-[var(--ls-t1)] border-b border-[var(--ls-linea)]">
                {euros(b.comision)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {sinUbicar?.total ? (
        <p className={`px-2 py-[7px] ${TIPO.s} ${TEXTO.t3}`}>
          {sinUbicar.total} referencias sin ubicar en el catálogo: su facturación no ha entrado en
          ninguno de los dos bloques. Si son muchas, el catálogo del cliente está viejo.
        </p>
      ) : null}
    </div>
  )
}

/** El desglose del camino normal: lo que hay en `summary` */
function DesgloseNormal({ resultado }: { resultado: ResultadoCalculo }) {
  const summary = (resultado.summary ?? {}) as Record<string, unknown>

  const lineas: { etiqueta: string; valor: string }[] = []
  const num = (clave: string): number | null => {
    const v = summary[clave]
    return typeof v === 'number' && Number.isFinite(v) ? v : null
  }

  if (num('previousYearNetBase') != null || num('currentYearNetBase') != null) {
    lineas.push({ etiqueta: 'Base neta año anterior', valor: euros(num('previousYearNetBase')) })
    lineas.push({ etiqueta: 'Base neta año actual', valor: euros(num('currentYearNetBase')) })
    lineas.push({ etiqueta: 'Excedente', valor: euros(num('excessAmount')) })
  } else {
    lineas.push({ etiqueta: 'Ventas', valor: euros(num('totalSales')) })
    lineas.push({ etiqueta: 'Devoluciones', valor: euros(num('totalRefunds')) })
    lineas.push({ etiqueta: 'Base sin IVA', valor: euros(num('netBase')) })
  }

  const tasa = num('commissionRateUsed') ?? num('averageCommissionRate')
  if (tasa != null) {
    lineas.push({ etiqueta: 'Tasa aplicada', valor: `${(tasa * 100).toFixed(2)} %` })
  }
  const pedidos = num('totalOrders')
  if (pedidos != null) lineas.push({ etiqueta: 'Pedidos', valor: String(pedidos) })

  return (
    <div className={`${RADIO.r2} border ${LINEA.normal} ${SUPERFICIE.sup} px-[10px] py-[7px]`}>
      <dl className="grid gap-x-[14px] gap-y-[4px] [grid-template-columns:repeat(auto-fit,minmax(200px,1fr))]">
        {lineas.map((l) => (
          <div key={l.etiqueta} className="flex items-baseline justify-between gap-2">
            <dt className={`${TIPO.s} ${TEXTO.t3}`}>{l.etiqueta}</dt>
            <dd className={`${TIPO.s} ${TEXTO.t1} tabular-nums`}>{l.valor}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

function textoDelCampoAMano(campo: CampoDeFichero): string {
  if (campo === 'filePreviousYear') {
    return 'Falta el informe del año anterior: este cliente compara el mismo mes de dos años. Súbelo en el recuadro de arriba.'
  }
  return 'Falta un fichero por subir.'
}
