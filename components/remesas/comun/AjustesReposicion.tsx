'use client'

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { AlertTriangle, CalendarClock, CheckCheck, ChevronDown, Package, Plus, Settings2, Timer, Wand2, X } from 'lucide-react'
import { toast } from 'sonner'
import { Boton, TACTIL } from '@/components/ui-ls/Boton'
import { Insignia } from '@/components/ui-ls/Insignia'
import { Esqueleto } from '@/components/ui-ls/Esqueleto'
import { CAMPO, COLOR_ESTADO } from '@/lib/estilo/denso'
import { RANGOS_AJUSTES, esCampanaValida } from '@/lib/fba/ajustes-reposicion'
import { diaEnEspana } from '@/lib/fba/fechas'
import type { AjustesReposicion as Ajustes, MedidasCliente, OrigenEtapa, PlazoEtapas } from '@/lib/fba/plan-tipos'
import { CLAVES_DE_ETAPA, diasValidos, repartirTotal, totalDeEtapas, type EtapasDePlazo } from '@/lib/fba/plazos'
import { dias, entero, fechaCorta, sumarDias } from '../formato'
import { leerRespuesta } from './errores'
import { ORIGEN_ETAPA } from './estilo-plan'
import type { AjustesReposicionProps } from './tipos-ui'
import { cx } from './ui'
import { invalidarRemesas } from './useAgencia'

/**
 * LOS AJUSTES DE REPOSICIÓN DE UN CLIENTE, EN UN SOLO SITIO (spec remesas-pro §8, D10, D13 y D14).
 *
 * Une lo que hacían `PlazosDialog` (plazo por etapas con lo medido al lado) y la `FilaPlazo` de Alertas (total,
 * antelación, avisar y plazos por SKU), y añade los ajustes del planificador. Lo usan la cabecera de Reposición (C5)
 * y la pestaña Plazos de Alertas (C8, con `compacto`: una fila que se despliega).
 *
 *   Plazo hasta la venta   preparación · transporte · recepción · margen, cada una con su origen (puesto a mano,
 *                          medido, de partida) y lo medido al lado. «Usar lo medido» y «Confirmar plazos» (guarda
 *                          los vigentes como manuales: apaga la banda «plazo de partida»). Total y «a la venta el…».
 *                          Avisar en la campana, antelación y plazos propios por referencia.
 *                          → GET/PUT /api/fba/alertas/config (PUT PARCIAL: solo lo que cambia).
 *   Cuánto enviar          cobertura objetivo y máxima, caja, mínimos por referencia y por envío (con «medido: cada
 *                          9 días, ~110 ud»), ventana para agrupar y capacidad en Amazon.
 *   Temporada              tope de temporada, fin de campaña (MM-DD) y transporte urgente (avión).
 *   Avisos                 avisar en el chat y planificador activo.
 *                          → GET/PUT /api/fba/reposicion-config?cliente= (PUT PARCIAL; vacío = lo medido o de partida).
 *
 * Es un editor en línea (no un diálogo, D38): cabe en una página, en una tarjeta o en un panel. Los botones Guardar y
 * Descartar van al pie del propio bloque. Tras guardar: invalidarRemesas(clienteId) y `alGuardar()` (que suele ser el
 * `router.refresh()` de siempre).
 *
 * API
 *   <AjustesReposicion clienteId clienteNombre puedeEditar compacto? alGuardar? />   (AjustesReposicionProps, tipos-ui.ts)
 */

/* ------------------------------------------------------------------ */
/* Lo que contestan las rutas                                          */
/* ------------------------------------------------------------------ */

interface RespuestaConfig {
  configurado: boolean
  plazoDias: number
  antelacionDias: number
  avisar: boolean
  etapas: EtapasDePlazo | null
  sinMigrar291: boolean
  /** Plazos propios por referencia (si la ruta los da) */
  plazosSku?: Record<string, number>
}

interface RespuestaReposicion {
  ajustes: Ajustes
  medidas: MedidasCliente
  plazo: PlazoEtapas
  /** La fila tal cual (lo puesto a mano); si la ruta no la da, se edita sobre lo vigente */
  guardado?: Record<string, unknown> | null
  migracion316?: boolean
}

/* ------------------------------------------------------------------ */
/* Campos del planificador                                             */
/* ------------------------------------------------------------------ */

type ClaveNumerica = 'coberturaObjetivo' | 'coberturaMaxima' | 'multiploCaja' | 'minLinea' | 'minEnvio' | 'ventanaAgrupacion' | 'capacidadUnidades' | 'topeEstacional' | 'transporteUrgenteDias'
type ClaveCampo = ClaveNumerica | 'campanaHasta'
type Grupo = 'cuanto' | 'temporada'

interface DefCampo {
  clave: ClaveCampo
  columna: string
  grupo: Grupo
  titulo: string
  ayuda: string
  unidad: string
  /** Qué significa dejarlo vacío */
  vacio: string
}

const CAMPOS: DefCampo[] = [
  { clave: 'coberturaObjetivo', columna: 'cobertura_objetivo_dias', grupo: 'cuanto', titulo: 'Cobertura objetivo', unidad: 'días', ayuda: 'Días de venta que cubre cada envío desde que está a la venta.', vacio: '45 días' },
  { clave: 'coberturaMaxima', columna: 'cobertura_max_dias', grupo: 'cuanto', titulo: 'Cobertura máxima', unidad: 'días', ayuda: 'Nunca más que esto en Amazon: por encima, el almacenaje se come el margen.', vacio: '90 días' },
  { clave: 'multiploCaja', columna: 'multiplo_caja', grupo: 'cuanto', titulo: 'Unidades por caja', unidad: 'ud', ayuda: 'Se redondea a cajas enteras. Vacío: la caja de cada referencia o la deducida de sus envíos.', vacio: 'la de cada referencia' },
  { clave: 'minLinea', columna: 'min_unidades_linea', grupo: 'cuanto', titulo: 'Mínimo por referencia', unidad: 'ud', ayuda: 'Por debajo no se propone: cubre menos de una semana y saldrá cuando de verdad haga falta.', vacio: '3 ud' },
  { clave: 'minEnvio', columna: 'min_unidades_envio', grupo: 'cuanto', titulo: 'Mínimo por envío', unidad: 'ud', ayuda: 'Un envío más pequeño se junta con el siguiente (salvo que sea urgente).', vacio: 'lo medido o 30 ud' },
  { clave: 'ventanaAgrupacion', columna: 'ventana_agrupacion_dias', grupo: 'cuanto', titulo: 'Juntar en un envío lo que sale en', unidad: 'días', ayuda: 'Las referencias que tienen que salir con esta diferencia van en el mismo envío.', vacio: 'lo medido o 7 días' },
  { clave: 'capacidadUnidades', columna: 'capacidad_unidades', grupo: 'cuanto', titulo: 'Capacidad en Amazon', unidad: 'ud', ayuda: 'Las unidades que Amazon te deja tener. Si se pasa, se priorizan las urgentes.', vacio: 'sin límite conocido' },
  { clave: 'topeEstacional', columna: 'tope_estacional', grupo: 'temporada', titulo: 'Tope de temporada', unidad: '×', ayuda: 'Cuánto puede multiplicarse el ritmo en temporada alta como mucho (1,8 = hasta un 80 % más).', vacio: '1,8' },
  { clave: 'campanaHasta', columna: 'campana_hasta', grupo: 'temporada', titulo: 'Fin de la campaña', unidad: 'mes-día', ayuda: 'Lo que llegue después ya no vende como en campaña (p. ej. 12-18).', vacio: 'sin campaña' },
  { clave: 'transporteUrgenteDias', columna: 'transporte_urgente_dias', grupo: 'temporada', titulo: 'Transporte urgente (avión)', unidad: 'días', ayuda: 'Si existe, el plan enseña la alternativa cuando va tarde.', vacio: 'no hay' },
]

const TEXTO_ETAPA: Record<keyof EtapasDePlazo, { titulo: string; ayuda: string }> = {
  preparacion: { titulo: 'Preparación', ayuda: 'Desde que se avisa al cliente hasta que el envío sale.' },
  transporte: { titulo: 'Transporte', ayuda: 'Del envío hasta que Amazon empieza a recibirlo.' },
  recepcion: { titulo: 'Recepción en Amazon', ayuda: 'Hasta que se puede vender (el 90 % recibido).' },
  margen: { titulo: 'Margen', ayuda: 'Colchón para retrasos: aduanas, huelgas, una recepción atascada.' },
}

const aTexto = (v: unknown): string => (v === null || v === undefined ? '' : typeof v === 'number' ? String(v).replace('.', ',') : String(v))
const aNumero = (t: string): number | null => {
  const s = t.trim().replace(',', '.')
  if (s === '') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/** El error de un campo, o null. Vacío siempre vale (= lo medido o de partida) */
function errorDeCampo(def: DefCampo, texto: string): string | null {
  if (texto.trim() === '') return null
  if (def.clave === 'campanaHasta') return esCampanaValida(texto.trim()) ? null : 'Pon mes-día, como 12-18'
  const r = RANGOS_AJUSTES[def.columna as keyof typeof RANGOS_AJUSTES]
  const n = aNumero(texto)
  if (n === null) return 'Tiene que ser un número'
  if (r.entero && !Number.isInteger(n)) return 'Sin decimales'
  if (n < r.min || n > r.max) return `De ${aTexto(r.min)} a ${aTexto(r.max)}`
  return null
}

/* ------------------------------------------------------------------ */
/* El componente                                                       */
/* ------------------------------------------------------------------ */

export function AjustesReposicion({ clienteId, clienteNombre, puedeEditar, compacto = false, alGuardar }: AjustesReposicionProps) {
  const [abierto, setAbierto] = useState(!compacto)
  const [config, setConfig] = useState<RespuestaConfig | null>(null)
  const [errorConfig, setErrorConfig] = useState<string | null>(null)
  const [repo, setRepo] = useState<RespuestaReposicion | null>(null)
  const [errorRepo, setErrorRepo] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [confirmando, setConfirmando] = useState(false)
  const [version, setVersion] = useState(0)

  // Lo que se edita (textos) y lo que había al leer (para saber qué ha cambiado)
  const [etapas, setEtapas] = useState<Record<keyof EtapasDePlazo, string>>({ preparacion: '', transporte: '', recepcion: '', margen: '' })
  const [etapasIni, setEtapasIni] = useState<Record<keyof EtapasDePlazo, string>>({ preparacion: '', transporte: '', recepcion: '', margen: '' })
  const [total, setTotal] = useState('')
  const [antelacion, setAntelacion] = useState('14')
  const [avisar, setAvisar] = useState(true)
  const [porSku, setPorSku] = useState<Record<string, string>>({})
  const [nuevoSku, setNuevoSku] = useState('')
  const [nuevoPlazo, setNuevoPlazo] = useState('')
  const [valores, setValores] = useState<Record<ClaveCampo, string>>({} as Record<ClaveCampo, string>)
  const [valoresIni, setValoresIni] = useState<Record<ClaveCampo, string>>({} as Record<ClaveCampo, string>)
  const [activo, setActivo] = useState(true)
  const [avisarChat, setAvisarChat] = useState(true)

  const hoy = useMemo(() => diaEnEspana(), [])

  /* ---------------- leer ---------------- */

  useEffect(() => {
    let vivo = true
    setCargando(true)
    const pedirConfig = fetch(`/api/fba/alertas/config?clienteId=${encodeURIComponent(clienteId)}`, { cache: 'no-store' })
      .then((res) => leerRespuesta<RespuestaConfig>(res, 'No se han podido leer los plazos'))
      .catch(() => ({ ok: false as const, estado: 0, error: 'No hay conexión con el servidor', datos: null }))
    const pedirRepo = fetch(`/api/fba/reposicion-config?cliente=${encodeURIComponent(clienteId)}`, { cache: 'no-store' })
      .then((res) => leerRespuesta<RespuestaReposicion>(res, 'No se han podido leer los ajustes de reposición'))
      .catch(() => ({ ok: false as const, estado: 0, error: 'No hay conexión con el servidor', datos: null }))

    Promise.all([pedirConfig, pedirRepo]).then(([c, r]) => {
      if (!vivo) return
      const cfg = c.ok ? c.datos : null
      const rep = r.ok && r.datos && r.datos.ajustes ? r.datos : null
      setConfig(cfg)
      setErrorConfig(c.ok ? null : c.error)
      setRepo(rep)
      setErrorRepo(r.ok ? (rep ? null : 'La ruta de ajustes no ha devuelto los ajustes') : r.estado === 404 ? 'Los ajustes del planificador todavía no están disponibles en este servidor.' : r.error)

      // Etapas: las vigentes del plan (manual > medido > partida); si no, las guardadas; si no, el total repartido
      const e: EtapasDePlazo | null = rep?.plazo
        ? { preparacion: rep.plazo.preparacion, transporte: rep.plazo.transporte, recepcion: rep.plazo.recepcion, margen: rep.plazo.margen }
        : cfg?.etapas ?? (cfg ? repartirTotal(cfg.plazoDias) : null)
      if (e) {
        const t = { preparacion: String(e.preparacion), transporte: String(e.transporte), recepcion: String(e.recepcion), margen: String(e.margen) }
        setEtapas(t)
        setEtapasIni(t)
        setTotal(String(totalDeEtapas(e)))
      }
      if (cfg) {
        setAntelacion(String(cfg.antelacionDias))
        setAvisar(cfg.avisar)
        setPorSku(Object.fromEntries(Object.entries(cfg.plazosSku ?? {}).map(([k, v]) => [k, String(v)])))
      }
      if (rep) {
        // Con la fila guardada, cada casilla enseña lo PUESTO A MANO (vacío = medido o de partida, en gris detrás).
        // Sin ella, lo vigente: así nadie ve vacío algo que sí tiene valor
        const g = rep.guardado
        const v = {} as Record<ClaveCampo, string>
        for (const d of CAMPOS) v[d.clave] = g !== undefined ? aTexto(g?.[d.columna] ?? null) : aTexto(rep.ajustes[d.clave])
        setValores(v)
        setValoresIni(v)
        setActivo(rep.ajustes.activo)
        setAvisarChat(rep.ajustes.avisarChat)
      }
      setCargando(false)
    })
    return () => {
      vivo = false
    }
  }, [clienteId, version])

  /* ---------------- lo que ha cambiado ---------------- */

  const soloTotal = config?.sinMigrar291 === true
  const numEtapas = CLAVES_DE_ETAPA.map((k) => diasValidos(etapas[k]))
  const etapasBuenas: EtapasDePlazo | null = numEtapas.every((d) => d !== null)
    ? { preparacion: numEtapas[0] as number, transporte: numEtapas[1] as number, recepcion: numEtapas[2] as number, margen: numEtapas[3] as number }
    : null
  const totalNumero = soloTotal ? diasValidos(total) : etapasBuenas ? totalDeEtapas(etapasBuenas) : null
  const totalBueno = totalNumero !== null && totalNumero >= 1 && totalNumero <= 365
  const hastaLaVenta = etapasBuenas ? etapasBuenas.preparacion + etapasBuenas.transporte + etapasBuenas.recepcion : null

  const etapasCambiadas = CLAVES_DE_ETAPA.some((k) => etapas[k] !== etapasIni[k]) || (soloTotal && config !== null && total !== String(config.plazoDias))
  const antelacionCambiada = config !== null && antelacion !== String(config.antelacionDias)
  const avisarCambiado = config !== null && avisar !== config.avisar
  const skuIni = useMemo(() => Object.fromEntries(Object.entries(config?.plazosSku ?? {}).map(([k, v]) => [k, String(v)])), [config])
  const skuCambiado = JSON.stringify(porSku) !== JSON.stringify(skuIni)
  const camposCambiados = CAMPOS.filter((d) => (valores[d.clave] ?? '') !== (valoresIni[d.clave] ?? ''))
  const activoCambiado = repo !== null && activo !== repo.ajustes.activo
  const avisarChatCambiado = repo !== null && avisarChat !== repo.ajustes.avisarChat

  const cambiosPlazos = etapasCambiadas || antelacionCambiada || avisarCambiado || skuCambiado
  const cambiosRepo = camposCambiados.length > 0 || activoCambiado || avisarChatCambiado
  const hayCambios = cambiosPlazos || cambiosRepo

  const erroresCampos = Object.fromEntries(CAMPOS.map((d) => [d.clave, errorDeCampo(d, valores[d.clave] ?? '')])) as Record<ClaveCampo, string | null>
  const objetivoN = aNumero(valores.coberturaObjetivo ?? '') ?? repo?.ajustes.coberturaObjetivo ?? null
  const maximaN = aNumero(valores.coberturaMaxima ?? '') ?? repo?.ajustes.coberturaMaxima ?? null
  const errorCoberturas = objetivoN !== null && maximaN !== null && maximaN < objetivoN ? 'La cobertura máxima no puede ser menor que la objetivo' : null
  const antelacionBuena = diasValidos(antelacion)
  const hayErrores =
    Object.values(erroresCampos).some(Boolean) || !!errorCoberturas || (etapasCambiadas && !totalBueno) || (antelacionCambiada && (antelacionBuena === null || antelacionBuena > 120))

  /* ---------------- acciones ---------------- */

  const despuesDeGuardar = useCallback(() => {
    invalidarRemesas(clienteId)
    alGuardar?.()
    setVersion((v) => v + 1)
  }, [clienteId, alGuardar])

  function descartar() {
    setEtapas(etapasIni)
    if (etapasIni.preparacion !== '') setTotal(String(CLAVES_DE_ETAPA.reduce((s, k) => s + (Number(etapasIni[k]) || 0), 0)))
    if (config) {
      setAntelacion(String(config.antelacionDias))
      setAvisar(config.avisar)
    }
    setPorSku(skuIni)
    setValores(valoresIni)
    if (repo) {
      setActivo(repo.ajustes.activo)
      setAvisarChat(repo.ajustes.avisarChat)
    }
  }

  async function guardar() {
    if (!hayCambios || hayErrores) return
    setGuardando(true)
    const fallos: string[] = []
    try {
      if (cambiosPlazos) {
        const cuerpo: Record<string, unknown> = { clienteId }
        if (etapasCambiadas) {
          if (soloTotal) cuerpo.plazoDias = totalNumero
          else cuerpo.etapas = etapasBuenas
        }
        if (antelacionCambiada) cuerpo.antelacionDias = antelacionBuena
        if (avisarCambiado) cuerpo.avisar = avisar
        if (skuCambiado) {
          // Los que estaban y ya no están van como null: se quitan y vuelven al plazo del cliente
          const plazosSku: Record<string, number | null> = {}
          for (const k of Object.keys(skuIni)) plazosSku[k] = null
          for (const [k, v] of Object.entries(porSku)) plazosSku[k] = aNumero(v)
          cuerpo.plazosSku = plazosSku
        }
        const r = await fetch('/api/fba/alertas/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) })
          .then((res) => leerRespuesta<unknown>(res, 'No se han podido guardar los plazos'))
          .catch(() => ({ ok: false as const, estado: 0, error: 'No hay conexión con el servidor', datos: null }))
        if (!r.ok) fallos.push(r.error)
      }
      if (cambiosRepo) {
        const cuerpo: Record<string, unknown> = { clienteId }
        for (const d of camposCambiados) {
          const t = (valores[d.clave] ?? '').trim()
          cuerpo[d.clave] = t === '' ? null : d.clave === 'campanaHasta' ? t : aNumero(t)
        }
        if (activoCambiado) cuerpo.activo = activo
        if (avisarChatCambiado) cuerpo.avisarChat = avisarChat
        const r = await fetch(`/api/fba/reposicion-config?cliente=${encodeURIComponent(clienteId)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(cuerpo),
        })
          .then((res) => leerRespuesta<{ avisos?: string[] }>(res, 'No se han podido guardar los ajustes de reposición'))
          .catch(() => ({ ok: false as const, estado: 0, error: 'No hay conexión con el servidor', datos: null }))
        if (!r.ok) fallos.push(r.error)
        else for (const a of r.datos?.avisos ?? []) toast.message(a)
      }
      if (fallos.length > 0) {
        for (const f of fallos) toast.error(f)
        // Lo que sí se guardó también cuenta: se vuelve a leer igual
        if (fallos.length < Number(cambiosPlazos) + Number(cambiosRepo)) despuesDeGuardar()
        return
      }
      toast.success(`Ajustes de ${clienteNombre} guardados. El plan los usa en la próxima pasada.`)
      despuesDeGuardar()
    } finally {
      setGuardando(false)
    }
  }

  async function confirmarPlazos() {
    setConfirmando(true)
    try {
      const r = await fetch('/api/fba/alertas/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clienteId, confirmarPlazos: true }) })
        .then((res) => leerRespuesta<unknown>(res, 'No se han podido confirmar los plazos'))
        .catch(() => ({ ok: false as const, estado: 0, error: 'No hay conexión con el servidor', datos: null }))
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      toast.success(`Plazos de ${clienteNombre} confirmados`)
      despuesDeGuardar()
    } finally {
      setConfirmando(false)
    }
  }

  function usarLoMedido() {
    const m = repo?.medidas
    if (!m) return
    setEtapas((e) => ({
      ...e,
      ...(m.transporteMediano !== null ? { transporte: String(Math.round(m.transporteMediano)) } : null),
      ...(m.recepcionP75 !== null ? { recepcion: String(Math.round(m.recepcionP75)) } : null),
    }))
  }

  function anadirSku() {
    const sku = nuevoSku.trim()
    const d = aNumero(nuevoPlazo)
    if (sku === '' || d === null || d < 1 || d > 365) {
      toast.error('Hace falta la referencia (SKU) y un plazo entre 1 y 365 días')
      return
    }
    setPorSku((p) => ({ ...p, [sku]: String(Math.round(d)) }))
    setNuevoSku('')
    setNuevoPlazo('')
  }

  /* ---------------- pintar ---------------- */

  const plazo = repo?.plazo ?? null
  const medidas = repo?.medidas ?? null
  const sinConfirmar = plazo ? plazo.sinConfirmar : config ? !config.configurado : false
  const hayMedido = !!medidas && (medidas.transporteMediano !== null || medidas.recepcionP75 !== null)
  const medidoDistinto =
    hayMedido &&
    ((medidas!.transporteMediano !== null && String(Math.round(medidas!.transporteMediano)) !== etapas.transporte) ||
      (medidas!.recepcionP75 !== null && String(Math.round(medidas!.recepcionP75)) !== etapas.recepcion))
  const textoCadencia =
    medidas && (medidas.cadenciaDias !== null || medidas.tamanoTipico !== null)
      ? `medido: ${medidas.cadenciaDias !== null ? `cada ${entero(medidas.cadenciaDias)} días` : ''}${medidas.cadenciaDias !== null && medidas.tamanoTipico !== null ? ', ' : ''}${medidas.tamanoTipico !== null ? `~${entero(medidas.tamanoTipico)} ud` : ''}`
      : null
  const deshabilitado = !puedeEditar || guardando

  const resumen = (
    <span className="text-[12px] text-[var(--ls-t3)]">
      {totalBueno && hastaLaVenta !== null ? (
        <>
          <b className="font-semibold tabular-nums text-[var(--ls-t1)]">{hastaLaVenta} d</b> hasta la venta + {etapasBuenas?.margen ?? 0} d de margen
        </>
      ) : totalBueno ? (
        <>
          Plazo <b className="font-semibold tabular-nums text-[var(--ls-t1)]">{totalNumero} d</b>
        </>
      ) : (
        'Plazo sin poner'
      )}
      {repo && (
        <>
          {' '}
          · cubre {repo.ajustes.coberturaObjetivo} d{repo.ajustes.activo ? '' : ' · planificador apagado'}
        </>
      )}
    </span>
  )

  const cuerpo = cargando ? (
    <div className="space-y-3 p-4">
      <Esqueleto className="h-5 w-48" />
      <Esqueleto className="h-24 w-full" />
      <Esqueleto className="h-24 w-full" />
    </div>
  ) : (
    <div className="space-y-5 p-4">
      {/* ------------- Plazo hasta la venta ------------- */}
      <Seccion icono={Timer} titulo="Plazo hasta la venta" ayuda="Cuánto pasa desde que se avisa al cliente hasta que su mercancía se vende en Amazon. De aquí salen todas las fechas del plan y de las alertas.">
        {errorConfig && <Aviso tono="rojo">{errorConfig}</Aviso>}
        {config && (
          <>
            {sinConfirmar && (
              <Aviso tono="ambar">
                Hay plazos {plazo && CLAVES_DE_ETAPA.some((k) => plazo.origen[k] === 'partida') ? '«de partida»' : 'medidos'} que nadie ha confirmado. Si están bien, confírmalos; si no, cámbialos y guarda.
                {puedeEditar && (
                  <span className="mt-2 flex flex-wrap gap-2">
                    <Boton variante="secundario" tamano="sm" icono={CheckCheck} cargando={confirmando} disabled={confirmando || guardando || etapasCambiadas} onClick={() => void confirmarPlazos()} title={etapasCambiadas ? 'Has cambiado etapas: guarda en vez de confirmar' : undefined}>
                      Confirmar plazos
                    </Boton>
                  </span>
                )}
              </Aviso>
            )}
            {soloTotal ? (
              <>
                <Aviso tono="ambar">Falta lanzar la migración 291 en Supabase para guardar el plazo por etapas. Mientras, solo se puede poner el total.</Aviso>
                <CampoTexto id={`aj-${clienteId}-total`} titulo="Plazo total" unidad="días" valor={total} onCambio={setTotal} deshabilitado={deshabilitado} />
              </>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {CLAVES_DE_ETAPA.map((k) => {
                  const origen: OrigenEtapa | null = plazo ? plazo.origen[k] : null
                  const medido = k === 'transporte' ? medidas?.transporteMediano ?? null : k === 'recepcion' ? medidas?.recepcionP75 ?? null : null
                  return (
                    <CampoTexto
                      key={k}
                      id={`aj-${clienteId}-${k}`}
                      titulo={TEXTO_ETAPA[k].titulo}
                      ayuda={TEXTO_ETAPA[k].ayuda}
                      unidad="días"
                      valor={etapas[k]}
                      onCambio={(t) => setEtapas((e) => ({ ...e, [k]: t }))}
                      deshabilitado={deshabilitado}
                      error={etapas[k] !== '' && diasValidos(etapas[k]) === null ? 'De 0 a 365' : null}
                      insignia={origen ? <Insignia tamano="sm" tono={ORIGEN_ETAPA[origen].tono} variante={origen === 'partida' ? 'contorno' : 'suave'}>{ORIGEN_ETAPA[origen].texto}</Insignia> : null}
                      pista={
                        medido !== null
                          ? `medido: ${dias(medido)}${k === 'recepcion' ? ' (p75)' : ' (mediana)'}${medidas && medidas.enviosMedidos > 0 ? ` de ${medidas.enviosMedidos} envío${medidas.enviosMedidos === 1 ? '' : 's'}` : ''}`
                          : null
                      }
                    />
                  )
                })}
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-[var(--ls-linea2)] bg-[var(--ls-sup2)] px-3 py-[10px]">
              <div className="flex items-center gap-2">
                <CalendarClock className="h-4 w-4 text-[var(--ls-mod-remesas)]" aria-hidden />
                <span className="text-[12.5px] text-[var(--ls-t2)]">Total</span>
                <b className="text-[18px] font-semibold tabular-nums text-[var(--ls-t1)]">{totalBueno ? totalNumero : '—'}</b>
                <span className="text-[12px] text-[var(--ls-t4)]">días</span>
              </div>
              <p className="min-w-0 text-[12px] leading-[1.45] text-[var(--ls-t3)]">
                {hastaLaVenta !== null ? (
                  <>
                    Si avisas hoy, a la venta el <b className="text-[var(--ls-t1)]">{fechaCorta(sumarDias(hoy, hastaLaVenta), hoy)}</b>
                    {plazo?.transporteUrgente ? <> (en avión, el {fechaCorta(sumarDias(hoy, hastaLaVenta - (etapasBuenas?.transporte ?? 0) + plazo.transporteUrgente), hoy)})</> : null}
                  </>
                ) : totalBueno && totalNumero !== null ? (
                  <>Si avisas hoy, a la venta hacia el {fechaCorta(sumarDias(hoy, totalNumero), hoy)}</>
                ) : (
                  'Pon días en cada etapa'
                )}
              </p>
              {puedeEditar && !soloTotal && medidoDistinto && (
                <Boton variante="fantasma" tamano="sm" icono={Wand2} onClick={usarLoMedido} disabled={deshabilitado}>
                  Usar lo medido
                </Boton>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <CampoTexto
                id={`aj-${clienteId}-antelacion`}
                titulo="Avisar de «reponer pronto» con"
                ayuda="Días por encima del plazo con los que se avisa en las alertas."
                unidad="días"
                valor={antelacion}
                onCambio={setAntelacion}
                deshabilitado={deshabilitado}
                error={antelacion !== '' && (antelacionBuena === null || antelacionBuena > 120) ? 'De 0 a 120' : null}
              />
              <Casilla marcada={avisar} onCambio={setAvisar} deshabilitado={deshabilitado} titulo="Avisar en la campana" ayuda="Si no, las alertas se calculan y se ven, pero no suenan." />
            </div>

            <PlazosPorSku
              porSku={porSku}
              setPorSku={setPorSku}
              nuevoSku={nuevoSku}
              setNuevoSku={setNuevoSku}
              nuevoPlazo={nuevoPlazo}
              setNuevoPlazo={setNuevoPlazo}
              onAnadir={anadirSku}
              deshabilitado={deshabilitado}
              conLista={config.plazosSku !== undefined}
            />
          </>
        )}
      </Seccion>

      {/* ------------- Planificador ------------- */}
      {errorRepo && <Aviso tono="ambar">{errorRepo}</Aviso>}
      {repo && (
        <>
          {repo.migracion316 === false && <Aviso tono="ambar">Falta lanzar la migración 316 en Supabase: los ajustes del planificador se ven pero todavía no se pueden guardar.</Aviso>}
          <Seccion icono={Package} titulo="Cuánto enviar" ayuda="Vacío = lo medido en sus envíos o el valor de partida (en gris dentro de la casilla).">
            {errorCoberturas && <Aviso tono="rojo">{errorCoberturas}</Aviso>}
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {CAMPOS.filter((d) => d.grupo === 'cuanto').map((d) => (
                <CampoAjuste
                  key={d.clave}
                  def={d}
                  clienteId={clienteId}
                  valor={valores[d.clave] ?? ''}
                  vigente={repo.ajustes[d.clave]}
                  onCambio={(t) => setValores((v) => ({ ...v, [d.clave]: t }))}
                  error={erroresCampos[d.clave]}
                  deshabilitado={deshabilitado}
                  origen={d.clave === 'minEnvio' ? repo.ajustes.origen.minEnvio : d.clave === 'ventanaAgrupacion' ? repo.ajustes.origen.ventanaAgrupacion : null}
                  pista={d.clave === 'minEnvio' || d.clave === 'ventanaAgrupacion' ? textoCadencia : null}
                />
              ))}
            </div>
          </Seccion>

          <Seccion icono={CalendarClock} titulo="Temporada y transporte">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {CAMPOS.filter((d) => d.grupo === 'temporada').map((d) => (
                <CampoAjuste
                  key={d.clave}
                  def={d}
                  clienteId={clienteId}
                  valor={valores[d.clave] ?? ''}
                  vigente={repo.ajustes[d.clave]}
                  onCambio={(t) => setValores((v) => ({ ...v, [d.clave]: t }))}
                  error={erroresCampos[d.clave]}
                  deshabilitado={deshabilitado}
                  origen={null}
                  pista={null}
                />
              ))}
            </div>
          </Seccion>

          <Seccion icono={Settings2} titulo="Planificador y avisos">
            <div className="grid gap-3 sm:grid-cols-2">
              <Casilla
                marcada={activo}
                onCambio={setActivo}
                deshabilitado={deshabilitado}
                titulo="Planificador activo"
                ayuda="Apagado, este cliente no recibe propuestas de envío ni avisos del plan (su salud sale en gris)."
              />
              <Casilla marcada={avisarChat} onCambio={setAvisarChat} deshabilitado={deshabilitado} titulo="Avisar en el chat" ayuda="Resumen diario en #notificaciones-erp cuando algo va tarde o urgente." />
            </div>
          </Seccion>
        </>
      )}

      {puedeEditar && (hayCambios || guardando) && (
        <div className="sticky bottom-0 z-[1] -mx-4 -mb-4 flex flex-wrap items-center justify-end gap-2 border-t border-[var(--ls-linea)] bg-[var(--ls-sup)] px-4 py-3 pb-[max(12px,env(safe-area-inset-bottom))]">
          <span className="mr-auto text-[12px] text-[var(--ls-t3)]">{hayErrores ? 'Corrige lo marcado en rojo' : 'Hay cambios sin guardar'}</span>
          <Boton variante="secundario" onClick={descartar} disabled={guardando}>
            Descartar
          </Boton>
          <Boton variante="primario" onClick={() => void guardar()} cargando={guardando} disabled={guardando || hayErrores}>
            Guardar
          </Boton>
        </div>
      )}
      {!puedeEditar && <p className="text-[11.5px] text-[var(--ls-t4)]">Solo lectura: para cambiarlos hace falta permiso de edición en este cliente.</p>}
    </div>
  )

  if (!compacto) {
    return (
      <section className="relative min-w-0 rounded-[14px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] shadow-[var(--ls-sombra-1)]">
        <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[var(--ls-linea)] px-4 py-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-[color-mix(in_srgb,var(--ls-mod-remesas)_14%,transparent)] text-[var(--ls-mod-remesas)]">
            <Settings2 className="h-4 w-4" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-[13.5px] font-semibold leading-[1.35] text-[var(--ls-t1)]">Ajustes de reposición de {clienteNombre}</h3>
            {resumen}
          </div>
          {sinConfirmar && !cargando && <Insignia tono="ambar" tamano="sm">Plazos sin confirmar</Insignia>}
        </header>
        {cuerpo}
      </section>
    )
  }

  return (
    <section className="relative min-w-0 rounded-[14px] border border-[var(--ls-linea)] bg-[var(--ls-sup)]">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        className={cx('flex w-full min-w-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-[14px] px-4 py-3 text-left hover:bg-[var(--ls-sup2)]', TACTIL)}
      >
        <div className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold text-[var(--ls-t1)]">{clienteNombre}</span>
          {cargando ? <span className="text-[12px] text-[var(--ls-t4)]">Leyendo…</span> : resumen}
        </div>
        {sinConfirmar && !cargando && <Insignia tono="ambar" tamano="sm">Sin confirmar</Insignia>}
        {hayCambios && <Insignia tono="naranja" tamano="sm">Sin guardar</Insignia>}
        <ChevronDown className={cx('h-4 w-4 shrink-0 text-[var(--ls-t3)] transition-transform motion-reduce:transition-none', abierto && 'rotate-180')} aria-hidden />
      </button>
      {abierto && <div className="border-t border-[var(--ls-linea)]">{cuerpo}</div>}
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* Piezas                                                              */
/* ------------------------------------------------------------------ */

function Seccion({ icono: Icono, titulo, ayuda, children }: { icono: typeof Timer; titulo: string; ayuda?: string; children: ReactNode }) {
  return (
    <section className="min-w-0 space-y-3">
      <div className="flex items-start gap-2">
        <Icono className="mt-[2px] h-4 w-4 shrink-0 text-[var(--ls-mod-remesas)]" aria-hidden />
        <div className="min-w-0">
          <h4 className="text-[13px] font-semibold text-[var(--ls-t1)]">{titulo}</h4>
          {ayuda && <p className="text-[11.5px] leading-[1.45] text-[var(--ls-t4)]">{ayuda}</p>}
        </div>
      </div>
      {children}
    </section>
  )
}

function Aviso({ tono, children }: { tono: 'rojo' | 'ambar'; children: ReactNode }) {
  return (
    <div
      role={tono === 'rojo' ? 'alert' : undefined}
      className="flex items-start gap-2 rounded-[10px] border border-[var(--ls-linea2)] bg-[var(--ls-sup2)] px-3 py-[8px] text-[12px] leading-[1.5] text-[var(--ls-t2)]"
      style={{ borderLeft: `3px solid ${COLOR_ESTADO[tono]}` }}
    >
      <AlertTriangle className="mt-[2px] h-[14px] w-[14px] shrink-0" style={{ color: COLOR_ESTADO[tono] }} aria-hidden />
      <div className="min-w-0">{children}</div>
    </div>
  )
}

const INPUT = cx(CAMPO.input, CAMPO.numero, 'h-8 rounded-[10px]', TACTIL)

function CampoTexto({
  id,
  titulo,
  ayuda,
  unidad,
  valor,
  onCambio,
  deshabilitado,
  error,
  insignia,
  pista,
  placeholder,
  numerico = true,
}: {
  id: string
  titulo: string
  ayuda?: string
  unidad: string
  valor: string
  onCambio: (t: string) => void
  deshabilitado?: boolean
  error?: string | null
  insignia?: ReactNode
  pista?: string | null
  placeholder?: string
  numerico?: boolean
}) {
  return (
    <div className="min-w-0">
      <div className="mb-[3px] flex flex-wrap items-center gap-x-2 gap-y-1">
        <label htmlFor={id} className="text-[12px] font-medium text-[var(--ls-t1)]">
          {titulo}
        </label>
        {insignia}
      </div>
      <div className="flex items-center gap-2">
        <input
          id={id}
          inputMode={numerico ? 'decimal' : 'text'}
          value={valor}
          placeholder={placeholder}
          onChange={(e) => onCambio(e.target.value)}
          disabled={deshabilitado}
          aria-invalid={!!error || undefined}
          aria-describedby={`${id}-nota`}
          className={cx(INPUT, '!w-[128px] shrink-0', error && '!border-[var(--ls-e-rojo)]', deshabilitado && 'opacity-60')}
        />
        <span className="text-[11.5px] text-[var(--ls-t4)]">{unidad}</span>
      </div>
      <p id={`${id}-nota`} className="mt-[3px] text-[11px] leading-[1.45] text-[var(--ls-t4)]">
        {error ? <span style={{ color: COLOR_ESTADO.rojo }}>{error}</span> : pista ? <span className="text-[var(--ls-t3)]">{pista}</span> : null}
        {ayuda && <span className="block">{ayuda}</span>}
      </p>
    </div>
  )
}

function CampoAjuste({
  def,
  clienteId,
  valor,
  vigente,
  onCambio,
  error,
  deshabilitado,
  origen,
  pista,
}: {
  def: DefCampo
  clienteId: string
  valor: string
  vigente: unknown
  onCambio: (t: string) => void
  error: string | null
  deshabilitado: boolean
  origen: 'manual' | 'medido' | 'partida' | null
  pista: string | null
}) {
  // En gris dentro de la casilla vacía: lo que se usa si no se pone nada
  const placeholder = vigente === null || vigente === undefined ? def.vacio : aTexto(vigente)
  return (
    <CampoTexto
      id={`aj-${clienteId}-${def.clave}`}
      titulo={def.titulo}
      ayuda={def.ayuda}
      unidad={def.unidad}
      valor={valor}
      onCambio={onCambio}
      deshabilitado={deshabilitado}
      error={error}
      placeholder={placeholder}
      numerico={def.clave !== 'campanaHasta'}
      insignia={origen ? <Insignia tamano="sm" tono={ORIGEN_ETAPA[origen].tono} variante={origen === 'partida' ? 'contorno' : 'suave'}>{ORIGEN_ETAPA[origen].texto}</Insignia> : null}
      pista={pista}
    />
  )
}

function Casilla({ marcada, onCambio, deshabilitado, titulo, ayuda }: { marcada: boolean; onCambio: (v: boolean) => void; deshabilitado?: boolean; titulo: string; ayuda?: string }) {
  return (
    <label className={cx('flex min-w-0 cursor-pointer items-start gap-[10px] rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-3 py-[9px]', TACTIL, deshabilitado && 'cursor-default opacity-60')}>
      <input type="checkbox" checked={marcada} onChange={(e) => onCambio(e.target.checked)} disabled={deshabilitado} className="mt-[3px] h-4 w-4 shrink-0 accent-[var(--ls-mod-remesas)]" />
      <span className="min-w-0">
        <span className="block text-[12.5px] font-medium text-[var(--ls-t1)]">{titulo}</span>
        {ayuda && <span className="block text-[11.5px] leading-[1.45] text-[var(--ls-t4)]">{ayuda}</span>}
      </span>
    </label>
  )
}

function PlazosPorSku({
  porSku,
  setPorSku,
  nuevoSku,
  setNuevoSku,
  nuevoPlazo,
  setNuevoPlazo,
  onAnadir,
  deshabilitado,
  conLista,
}: {
  porSku: Record<string, string>
  setPorSku: (f: (p: Record<string, string>) => Record<string, string>) => void
  nuevoSku: string
  setNuevoSku: (t: string) => void
  nuevoPlazo: string
  setNuevoPlazo: (t: string) => void
  onAnadir: () => void
  deshabilitado: boolean
  /** La ruta da los plazos guardados: si no, solo se pueden añadir (los de antes no se ven) */
  conLista: boolean
}) {
  const [abierto, setAbierto] = useState(Object.keys(porSku).length > 0)
  const n = Object.keys(porSku).length
  return (
    <div className="rounded-[10px] border border-[var(--ls-linea)]">
      <button type="button" onClick={() => setAbierto((v) => !v)} aria-expanded={abierto} className={cx('flex w-full items-center gap-2 px-3 py-[9px] text-left text-[12.5px] text-[var(--ls-t2)] hover:bg-[var(--ls-sup2)]', TACTIL)}>
        <span className="min-w-0 flex-1">Plazo propio por referencia{n > 0 ? ` (${n})` : ''}</span>
        <ChevronDown className={cx('h-4 w-4 text-[var(--ls-t3)] transition-transform motion-reduce:transition-none', abierto && 'rotate-180')} aria-hidden />
      </button>
      {abierto && (
        <div className="space-y-2 border-t border-[var(--ls-linea)] px-3 py-3">
          <p className="text-[11.5px] leading-[1.45] text-[var(--ls-t3)]">
            Sustituye al plazo total del cliente para esa referencia (la que se fabrica en otro sitio o viaja por otra vía).
            {!conLista && ' Los plazos que ya tenga guardados no se ven aquí: los que añadas se suman a ellos.'}
          </p>
          {Object.entries(porSku).map(([sku, d]) => (
            <div key={sku} className="flex min-w-0 items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-[var(--ls-t1)]" title={sku}>
                {sku}
              </span>
              <input
                aria-label={`Días de ${sku}`}
                inputMode="numeric"
                value={d}
                onChange={(e) => setPorSku((p) => ({ ...p, [sku]: e.target.value }))}
                disabled={deshabilitado}
                className={cx(INPUT, '!w-[80px]')}
              />
              <span className="text-[11.5px] text-[var(--ls-t4)]">días</span>
              {!deshabilitado && (
                <Boton
                  variante="fantasma"
                  tamano="sm"
                  soloIcono
                  icono={X}
                  aria-label={`Quitar el plazo propio de ${sku}`}
                  title="Quitar: vuelve al plazo del cliente"
                  onClick={() =>
                    setPorSku((p) => {
                      const { [sku]: _quitado, ...resto } = p
                      return resto
                    })
                  }
                />
              )}
            </div>
          ))}
          {!deshabilitado && (
            <div className="flex flex-wrap items-end gap-2">
              <label className="min-w-[160px] flex-1">
                <span className={CAMPO.etiqueta}>Referencia (SKU)</span>
                <input value={nuevoSku} onChange={(e) => setNuevoSku(e.target.value)} className={cx(CAMPO.input, 'h-8 rounded-[10px]', TACTIL)} placeholder="Tal como sale en Amazon" />
              </label>
              <label>
                <span className={CAMPO.etiqueta}>Días</span>
                <input inputMode="numeric" value={nuevoPlazo} onChange={(e) => setNuevoPlazo(e.target.value)} className={cx(INPUT, '!w-[80px]')} />
              </label>
              <Boton variante="secundario" icono={Plus} onClick={onAnadir}>
                Añadir
              </Boton>
            </div>
          )}
          {n > 0 && <p className="text-[11px] text-[var(--ls-t4)]">Se guardan con «Guardar».</p>}
        </div>
      )}
    </div>
  )
}
