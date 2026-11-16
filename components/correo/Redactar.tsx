'use client'

import { AlertCircle, ChevronDown, Loader2, Maximize2, Minimize2, Paperclip, Send, Sparkles, Trash2, UserCheck, X } from 'lucide-react'
import { MotionConfig, motion, useReducedMotion } from 'framer-motion'
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { toast } from 'sonner'
import { Boton, Confirmacion, FOCO, Insignia, TACTIL, useAltoDelTeclado } from '@/components/ui-ls'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { tamanoLegible } from '@/lib/correo/formato'
import { SUGERENCIAS_DE_CAMBIO, cuerpoEscrito, hayCuerpoEscrito, ponerBorradorIa, sumarIndicacion, type RespuestaDeRedactar } from '@/lib/correo/ia-cliente'
import { direccionCorta } from '@/lib/correo/marcas'
import { camposSinRellenar, insertarPlantilla, rellenarPlantilla, textoSinFirma, type PlantillaDeCorreo } from '@/lib/correo/plantillas'
import { buzonesDeEnvio, cambiarFirma, hayQueElegirDe } from '@/lib/correo/redactar-de'
import type { BorradorDeCorreo } from '@/lib/correo/redactar'
import { PISTA_PARA_LIBERAR } from '@/lib/correo/verificacion/pago'
import { cn } from '@/lib/utils'
import { enviarJson, pedir } from './api'
import type { DetalleDeEnvio, PropsDeRedactar } from './contratos'
import { Kbd, PuntoDeBuzon } from './piezas'
import { BloqueDeSeguimientos, useSeguimientos } from './secuencias/BloqueDeSeguimientos'
import { ComprobacionDeCorreo, comprobarAhora, direccionesDelCampo, direccionesQueBloquean, hayDireccionMala, useComprobacion, type VeredictoCliente } from './secuencias/ComprobacionDeCorreo'
import { SelectorDePlantillas } from './SelectorDePlantillas'

/**
 * ESCRIBIR, CONTESTAR O REENVIAR UN CORREO (rediseño Correo Pro, spec 1.8).
 *
 * Un cuadro encima de la pantalla (en el móvil, una hoja a pantalla completa que sube con el teclado), con el buzón desde el que sale a la vista
 * (nunca se envía desde otra dirección). Si quien escribe puede enviar desde 2 o más buzones (`buzonesParaEnviar`), en un mensaje NUEVO sale el
 * «De:» y la firma cambia con el buzón (lib/correo/redactar-de.ts). Al contestar o reenviar, el buzón es el del mensaje original.
 *
 * El texto es texto plano: sale también en HTML sencillo, con los enlaces pulsables, y al contestar el servidor cita debajo el mensaje original. Los
 * adjuntos van en la misma petición (hasta 10 ficheros y 15 MB entre todos).
 *
 * Una dirección que no vale NO se descarta en silencio: la ruta devuelve cuál falla y se enseña aquí.
 *
 * Se queda en su `fixed inset-0 z-[60]`: el portal (`createPortal(…, document.body)`) lo pone quien lo monta (PanelCorreo, CorreoRapido).
 * La API pública (Props y DetalleDeEnvio) es la de antes más dos props OPCIONALES: CorreoRapido y EnviarAnalisisPorCorreo no cambian.
 */

const MAX_BYTES_ADJUNTOS = 15 * 1024 * 1024
const MAX_ADJUNTOS = 10

export type { DetalleDeEnvio }

interface RespuestaDeEnvio {
  ok: boolean
  hiloId: string
  copiadoAEnviados: boolean
  rechazados: string[]
  /** Qué pasó con los seguimientos automáticos, si se pidieron (el correo ya ha salido pase lo que pase aquí) */
  secuencia?: { ok: true; aviso: string | null; pasos: Array<{ orden: number; etiqueta: string; programadoAt: number | null }> } | { ok: false; mensaje: string }
  /** Lo que dijo la verificación de direcciones y el correo salió igualmente: una dirección dudosa, o que esta vez no se pudo comprobar */
  avisosDeVerificacion?: string[]
}

const TITULO: Record<BorradorDeCorreo['modo'], string> = {
  nuevo: 'Nuevo mensaje',
  responder: 'Responder',
  'responder-todos': 'Responder a todos',
  reenviar: 'Reenviar',
}

/** Una fila de campo (De, Para, Cc, Asunto): sin caja, con la raya de abajo que se pone naranja al escribir */
const FILA = 'flex min-h-[48px] items-center gap-3 border-b border-[var(--ls-linea)] px-4 transition-colors focus-within:border-[var(--ls-acc-graf)] lg:min-h-[42px]'
const ROTULO = 'w-14 shrink-0 text-[12.5px] text-[var(--ls-t3)]'
/** 16 px en el móvil (Safari no amplía la pantalla) y 13.5 px desde lg */
const ENTRADA = 'h-11 min-w-0 flex-1 bg-transparent text-base text-[var(--ls-t1)] outline-none placeholder:text-[var(--ls-t4)] lg:h-10 lg:text-[13.5px]'

const etiquetaDeBuzon = (b: { nombre: string | null; direccion: string }) => (b.nombre ? `${b.nombre} · ${b.direccion}` : b.direccion)

export function Redactar({ buzon, yoId, esAdmin, borrador, onCerrar, onEnviado, sinAvisoDeExito = false, buzonesParaEnviar, onCambiarBuzon }: PropsDeRedactar) {
  // Desde qué buzón sale. Sin `buzonesParaEnviar` es siempre `buzon` (lo de antes)
  const opciones = useMemo(() => buzonesDeEnvio(buzon, buzonesParaEnviar), [buzon, buzonesParaEnviar])
  const [buzonId, setBuzonId] = useState(buzon.id)
  const actual = opciones.find((b) => b.id === buzonId) ?? buzon
  const conDe = hayQueElegirDe(opciones.length, borrador.modo)
  // Los seguimientos automáticos solo se programan desde el buzón propio (el servidor ignora la secuencia de quien no es el dueño)
  const conSeguimientos = actual.esMio

  const [para, setPara] = useState(borrador.para)
  const [cc, setCc] = useState(borrador.cc)
  const [mostrarCc, setMostrarCc] = useState(borrador.cc !== '')
  const [asunto, setAsunto] = useState(borrador.asunto)
  const [texto, setTexto] = useState(borrador.texto)
  // El texto con el que se abrió (con la firma del buzón elegido): lo que no cuenta como «escrito»
  const [textoInicial, setTextoInicial] = useState(borrador.texto)
  const [conCita, setConCita] = useState(borrador.conCita)
  const [adjuntos, setAdjuntos] = useState<File[]>([])
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmaCerrar, setConfirmaCerrar] = useState(false)
  const [ampliado, setAmpliado] = useState(false)
  // Redactar con IA: solo si el mensaje se abrió desde la ficha de un lead (hay a quién conocer). El borrador es una ayuda: se edita antes de enviar
  const [iaAbierta, setIaAbierta] = useState(false)
  const [iaPide, setIaPide] = useState('')
  const [iaRedactando, setIaRedactando] = useState(false)
  const [iaBorrador, setIaBorrador] = useState<{ id: string | null; versionId: string | null; ejemplos: number; aviso: string | null } | null>(null)
  const iaArrancada = useRef(false)
  // Sube cada vez que la IA acaba de escribir el correo: los seguimientos automáticos se escriben (o se reescriben) a partir del nuevo
  const [disparoIa, setDisparoIa] = useState(0)
  // Hay una dirección que parece incorrecta y se está pidiendo confirmación para enviar igualmente
  const [confirmaMala, setConfirmaMala] = useState(false)
  const [esMac, setEsMac] = useState(false)
  const bloqueSeguimientos = useRef<HTMLDivElement>(null)
  const entradaPara = useRef<HTMLInputElement>(null)
  const entradaTexto = useRef<HTMLTextAreaElement>(null)
  const entradaFicheros = useRef<HTMLInputElement>(null)
  // En el móvil el teclado tapa la página sin encogerla: la hoja se acorta lo que tape, y el pie (Enviar) queda a la vista
  const teclado = useAltoDelTeclado(true)
  const sinMovimiento = useReducedMotion()

  useEffect(() => {
    setEsMac(typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent))
  }, [])

  // Si ya se sabe a quién va, el cursor cae en el texto (al principio, encima de la firma); si no, en «Para».
  // SE INSISTE UNOS CUADROS: un mensaje que se abre desde otra aplicación (el chip del email de un lead, un aviso de correo nuevo) se monta
  // mientras Correo todavía está oculto —el cambio de pantalla llega un instante después— y un elemento oculto no admite el foco.
  useEffect(() => {
    const objetivo = borrador.para ? entradaTexto : entradaPara
    let intentos = 0
    let cuadro = 0
    const intentar = () => {
      const el = objetivo.current
      if (!el) return
      el.focus()
      if (borrador.para) el.setSelectionRange(0, 0)
      if (document.activeElement !== el && intentos++ < 40) cuadro = requestAnimationFrame(intentar)
    }
    intentar()
    return () => cancelAnimationFrame(cuadro)
  }, [borrador.para])

  // Desde un buzón que no es mío no hay seguimientos: sin lead, el cuadro no se ofrece y no se manda ninguna secuencia (BloqueDeSeguimientos ni se monta)
  const seg = useSeguimientos({ buzonId: actual.id, leadId: conSeguimientos ? (borrador.lead?.id ?? null) : null, modo: borrador.modo, para, cc, asunto, texto, firma: actual.firma, disparo: disparoIa })
  // ¿Es un buen correo? Direcciones y texto, solo en un correo nuevo (al contestar, la dirección ya es la de la conversación)
  const cuerpoSinFirma = cuerpoEscrito(texto, actual.firma)
  const comprobacion = useComprobacion({ direcciones: direccionesDelCampo(`${para},${cc}`), asunto, texto: cuerpoSinFirma, esRespuesta: false, activa: borrador.modo === 'nuevo' })
  // Tocar las direcciones retira la pregunta de «¿enviar igualmente?»
  useEffect(() => setConfirmaMala(false), [para, cc])

  const bytes = adjuntos.reduce((suma, f) => suma + f.size, 0)
  const tocado = texto !== textoInicial || para !== borrador.para || cc !== borrador.cc || asunto !== borrador.asunto || adjuntos.length > 0

  function cerrar() {
    if (enviando) return
    if (tocado) {
      setConfirmaCerrar(true)
      return
    }
    onCerrar()
  }

  /** Cambia el «De:». La firma del final se cambia por la del nuevo buzón si sigue tal cual; si se ha editado, no se pisa y se avisa */
  function cambiarDe(id: string) {
    const nuevo = opciones.find((b) => b.id === id)
    if (!nuevo || nuevo.id === actual.id) return
    const r = cambiarFirma(texto, actual.firma, nuevo.firma)
    if (r.cambiada) {
      setTexto(r.texto)
      if (texto === textoInicial) setTextoInicial(r.texto)
    } else {
      toast.info('Has cambiado la firma a mano, así que no la he tocado: revísala antes de enviar.')
    }
    if (actual.esMio && !nuevo.esMio && seg.elegible && seg.lista) toast.info('Desde este buzón no se programan seguimientos automáticos: se han quitado.')
    setBuzonId(nuevo.id)
    setError(null)
    onCambiarBuzon?.(nuevo.id)
  }

  /** Lo que se sabe para rellenar los campos de una plantilla. {{nombre}} no está: lo escribe quien envía (ver lib/correo/plantillas.ts) */
  const datosDeRelleno = { empresa: borrador.lead?.empresa || borrador.lead?.nombre || null, mi_nombre: actual.nombre || null, mi_correo: actual.direccion }

  /**
   * Le pide a la IA el borrador de este lead y lo pone en el mensaje (asunto y cuerpo, con la firma del buzón debajo). Si ya hay un
   * borrador suyo, o algo escrito, parte de ello: «más corto» cambia lo que hay, no lo tira. Sin indicaciones sobre un borrador suyo se le pide
   * una versión distinta (si el comercial pulsa «Volver a redactar» sin más, es que esa no le valía).
   */
  async function redactarConIa(indicaciones: string) {
    if (!borrador.lead || iaRedactando || enviando) return
    setError(null)
    setIaAbierta(false)
    setIaRedactando(true)
    const hayBase = hayCuerpoEscrito(texto, actual.firma)
    const pide = indicaciones.trim() || (iaBorrador && hayBase ? 'Escribe una versión distinta, con otro enfoque.' : '')
    const r = await enviarJson<RespuestaDeRedactar>('/api/correo/redactar-ia', 'POST', {
      leadId: borrador.lead.id,
      buzonId: actual.id,
      indicaciones: pide || undefined,
      // La misma versión de la IA que escribió el primer borrador de este correo (no se enseña ni se elige: ver app/api/correo/redactar-ia/route.ts)
      versionId: iaBorrador?.versionId ?? undefined,
      anterior: hayBase ? { asunto: asunto.trim() || '(sin asunto)', texto: cuerpoEscrito(texto, actual.firma) } : undefined,
    })
    setIaRedactando(false)
    if (!r.ok) return setError(r.mensaje)
    // El asunto solo se cambia en un mensaje nuevo: al contestar se queda el «Re: …» de la conversación
    if (borrador.modo === 'nuevo') setAsunto(r.datos.asunto)
    setTexto(ponerBorradorIa(actual.firma, r.datos.texto))
    setIaBorrador({ id: r.datos.id, versionId: r.datos.versionId ?? iaBorrador?.versionId ?? null, ejemplos: r.datos.ejemplos, aviso: r.datos.aviso })
    setDisparoIa((n) => n + 1)
    setIaPide('')
    requestAnimationFrame(() => {
      const el = entradaTexto.current
      el?.focus()
      el?.setSelectionRange(0, 0)
      el?.scrollTo({ top: 0 })
    })
  }

  // Desde el chip «Correo con IA» de la ficha el mensaje se abre y el borrador ya se está pidiendo. Una sola vez aunque React monte dos veces
  useEffect(() => {
    if (!borrador.generarIa || iaArrancada.current) return
    iaArrancada.current = true
    void redactarConIa('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function aplicarPlantilla(p: PlantillaDeCorreo) {
    // El asunto solo se cambia en un mensaje nuevo: al contestar se queda el «Re: …» de la conversación
    if (borrador.modo === 'nuevo' && p.asunto.trim()) setAsunto(rellenarPlantilla(p.asunto, datosDeRelleno))
    const el = entradaTexto.current
    const r = insertarPlantilla(texto, textoInicial, rellenarPlantilla(p.texto, datosDeRelleno), el?.selectionStart ?? texto.length)
    setTexto(r.texto)
    setError(null)
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(r.cursor, r.cursor)
    })
  }

  function insertarCampo(campo: string) {
    const el = entradaTexto.current
    const inicio = el?.selectionStart ?? texto.length
    const fin = el?.selectionEnd ?? inicio
    setTexto(texto.slice(0, inicio) + campo + texto.slice(fin))
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(inicio + campo.length, inicio + campo.length)
    })
  }

  function añadir(ficheros: FileList | null) {
    if (!ficheros) return
    const nuevos = [...adjuntos, ...Array.from(ficheros)]
    if (entradaFicheros.current) entradaFicheros.current.value = ''
    if (nuevos.length > MAX_ADJUNTOS) return setError(`Se pueden adjuntar como mucho ${MAX_ADJUNTOS} ficheros.`)
    if (nuevos.reduce((s, f) => s + f.size, 0) > MAX_BYTES_ADJUNTOS) return setError(`Los adjuntos no pueden pasar de ${tamanoLegible(MAX_BYTES_ADJUNTOS)} en total.`)
    setError(null)
    setAdjuntos(nuevos)
  }

  /** Cambia una dirección por la que se propone (una errata clara: «gmial.com» por «gmail.com») en «Para» y en «Cc» */
  function usarSugerencia(de: string, a: string) {
    const exacta = new RegExp(de.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
    setPara((p) => p.replace(exacta, a))
    setCc((c) => c.replace(exacta, a))
  }

  /** Un solo envío a la vez: entre la revisión de la dirección y el envío hay esperas, y un segundo clic no debe lanzar otro */
  const envioEnCurso = useRef(false)
  async function enviar(e?: FormEvent, aunqueSeaMala = false) {
    e?.preventDefault()
    if (envioEnCurso.current) return
    envioEnCurso.current = true
    try {
      await prepararYEnviar(aunqueSeaMala)
    } finally {
      envioEnCurso.current = false
    }
  }

  async function prepararYEnviar(aunqueSeaMala: boolean) {
    if (enviando || iaRedactando || seg.generando) return
    if (!para.trim()) return setError('Falta al menos un destinatario.')
    if (!asunto.trim() && borrador.modo === 'nuevo') return setError('Escribe un asunto.')
    if (!texto.trim() && adjuntos.length === 0) return setError('El mensaje está vacío.')
    // Un campo de plantilla sin rellenar («Hola {{nombre}}») NO sale: es el error que no se puede deshacer una vez enviado
    const pendientes = camposSinRellenar(`${asunto}\n${texto}`)
    if (pendientes.length > 0) return setError(`Quedan campos sin rellenar: ${pendientes.join(', ')}. Escríbelos, o bórralos, antes de enviar.`)

    // ¿Es un buen correo? Una dirección que seguramente no existe hace rebotar el correo, y los rebotes dañan la reputación del buzón: se pregunta antes.
    // Si lo escrito cambió hace un instante y la revisión aún no ha llegado, se pide ahora (con un máximo de espera: nunca debe impedir enviar)
    if (borrador.modo === 'nuevo' && !aunqueSeaMala) {
      let veredicto = comprobacion.vigente ? comprobacion.resultado : null
      if (!comprobacion.vigente) {
        veredicto = await Promise.race([comprobarAhora({ direcciones: direccionesDelCampo(`${para},${cc}`), asunto, texto: cuerpoSinFirma, esRespuesta: false }), new Promise<null>((fin) => setTimeout(() => fin(null), 3500))])
        comprobacion.fijar(veredicto)
      }
      // Una dirección que el servicio de verificación ya dio por inexistente: el servidor no deja enviar, así que no se ofrece «enviar igualmente»
      const bloqueadas = direccionesQueBloquean(veredicto)
      if (bloqueadas.length > 0) {
        setConfirmaMala(false)
        return setError(`No se enviará: ${bloqueadas.map((d) => `«${d.direccion}»: ${d.motivo}${d.sugerencia ? ` ¿Querías decir «${d.sugerencia}»?` : ''}`).join(' ')} Corrígela, o escribe a otra dirección. ${PISTA_PARA_LIBERAR}`)
      }
      if (hayDireccionMala(veredicto).length > 0) {
        setError(null)
        setConfirmaMala(true)
        return
      }
    }

    // Los seguimientos automáticos: con el interruptor encendido y sin escribir, este primer «Enviar» los escribe y se detiene para que se lean.
    // Si la IA no ha podido (hay un error), el correo se puede enviar igualmente, sin seguimientos
    if (!aunqueSeaMala && seg.pideEscribirlosAntes && !seg.error) {
      setError(null)
      if (await seg.generar()) {
        toast.info('Revisa los seguimientos y pulsa Enviar otra vez.')
        requestAnimationFrame(() => bloqueSeguimientos.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }))
      }
      return
    }
    if (!aunqueSeaMala && seg.bloqueo) return setError(seg.bloqueo)

    setError(null)
    setEnviando(true)
    const f = new FormData()
    f.set('buzonId', actual.id)
    f.set('para', para)
    f.set('cc', cc)
    f.set('asunto', asunto)
    f.set('texto', texto)
    if (borrador.respondeA) {
      f.set('respondeA', borrador.respondeA)
      f.set('modo', borrador.modo === 'reenviar' ? 'reenviar' : 'responder')
      if (!conCita) f.set('sinCita', '1')
    }
    // Si el mensaje sale de un borrador de la IA se apunta lo que salió de verdad (editado), para medir si funciona
    if (iaBorrador?.id) f.set('iaId', iaBorrador.id)
    // Los seguimientos van con el correo; si se envía a una dirección que parece mala, o no es mi buzón, no se programa ninguno
    const secuenciaPedida = aunqueSeaMala || !conSeguimientos ? null : seg.paraEnviar()
    if (secuenciaPedida) f.set('secuencia', JSON.stringify(secuenciaPedida))
    for (const a of adjuntos) f.append('adjuntos', a, a.name)

    const r = await pedir<RespuestaDeEnvio>('/api/correo/enviar', { method: 'POST', body: f })
    setEnviando(false)
    if (!r.ok) {
      // El servicio de verificación dice que una dirección no existe: el correo NO ha salido. Se enseñan las direcciones (con la corrección que propone) en la revisión de arriba
      if (r.extra.codigo === 'direccion_no_valida' && Array.isArray(r.extra.direcciones)) {
        comprobacion.fijar({ direcciones: r.extra.direcciones as VeredictoCliente[], contenido: comprobacion.resultado?.contenido ?? null })
        setConfirmaMala(false)
      }
      return setError(r.mensaje)
    }

    const avisosDeVerificacion = r.datos.avisosDeVerificacion ?? []
    const conAviso = r.datos.rechazados.length > 0 || !r.datos.copiadoAEnviados || avisosDeVerificacion.length > 0
    if (r.datos.rechazados.length > 0) toast.warning(`Enviado, pero el servidor no ha entregado a: ${r.datos.rechazados.join(', ')}`)
    else if (!r.datos.copiadoAEnviados) toast.warning('Enviado. No se ha podido guardar la copia en la carpeta Enviados del webmail.')
    else if (!sinAvisoDeExito) toast.success('Mensaje enviado.')
    for (const aviso of avisosDeVerificacion) toast.warning(aviso, { duration: 12000 })
    if (r.datos.secuencia?.ok) {
      toast.success(`Seguimientos programados: ${r.datos.secuencia.pasos.map((x) => x.etiqueta).join(' y ')}${seg.estado?.ensayo ? ' (en pruebas: todavía no salen).' : '.'}`, { duration: 9000 })
      if (r.datos.secuencia.aviso) toast.warning(r.datos.secuencia.aviso, { duration: 9000 })
    } else if (r.datos.secuencia) toast.warning(r.datos.secuencia.mensaje, { duration: 12000 })
    else if (!secuenciaPedida && seg.elegible && seg.activo) toast.warning('El correo se ha enviado sin seguimientos automáticos.', { duration: 9000 })
    onEnviado(r.datos.hiloId, asunto.trim(), { para: para.trim(), texto, conAviso })
  }

  function teclas(e: KeyboardEvent) {
    // La confirmación de descartar va por portal, pero sus teclas suben por React hasta aquí: Esc y ⌘↵ son suyas
    if (confirmaCerrar) return
    if (e.key === 'Escape') {
      e.stopPropagation()
      cerrar()
    } else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      void enviar()
    }
  }

  const ocupado = enviando || iaRedactando || seg.generando
  const textoDeEnviar = enviando ? 'Enviando…' : seg.generando ? 'Escribiendo seguimientos…' : seg.pideEscribirlosAntes && !seg.error ? 'Revisar y enviar' : 'Enviar'
  // A 375 px el pie no cabe con la frase larga: en el móvil, «Escribiendo…»
  const textoDeEnviarCorto = seg.generando && !enviando ? 'Escribiendo…' : textoDeEnviar
  const tecla = esMac ? '⌘' : 'Ctrl'

  return (
    <MotionConfig reducedMotion="user">
      <div
        className="fixed inset-x-0 top-0 z-[60] flex items-stretch justify-center sm:items-center sm:bg-[rgba(6,7,9,0.6)] sm:p-4 sm:backdrop-blur-[2px]"
        style={{ bottom: teclado }}
        onMouseDown={(e) => e.target === e.currentTarget && cerrar()}
        onKeyDown={teclas}
      >
        <motion.form
          onSubmit={enviar}
          role="dialog"
          aria-modal="true"
          aria-label={TITULO[borrador.modo]}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18, ease: [0.22, 0.8, 0.3, 1] }}
          className={cn(
            'flex h-full w-full flex-col overflow-hidden bg-[var(--ls-sup)] sm:h-auto sm:rounded-[14px] sm:border sm:border-[var(--ls-linea2)] sm:shadow-[var(--ls-sombra-3)]',
            ampliado ? 'sm:h-[min(94dvh,1000px)] sm:max-w-[1100px]' : 'sm:max-h-[min(90dvh,860px)] sm:max-w-[760px]',
          )}
        >
          {/* Cabecera */}
          <header className="flex shrink-0 items-center gap-2 border-b border-[var(--ls-linea)] py-2 pl-4 pr-2 pt-[max(0.5rem,env(safe-area-inset-top))] sm:pt-2">
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-[15px] font-semibold tracking-[-0.01em] text-[var(--ls-t1)] lg:text-[14px]">{TITULO[borrador.modo]}</h2>
              {!conDe && (
                <p className="flex min-w-0 items-center gap-1.5 text-[12px] text-[var(--ls-t3)]">
                  <PuntoDeBuzon direccion={actual.direccion} tamano={7} />
                  <span className="truncate">Desde {etiquetaDeBuzon(actual)}</span>
                </p>
              )}
            </div>
            {!actual.esMio && (
              <Insignia tono="azul" icono={UserCheck} tamano="sm" className="hidden md:inline-flex" title="Lo que envías desde este buzón queda anotado con tu nombre">
                Asignado a ti · queda anotado
              </Insignia>
            )}
            <Boton
              variante="fantasma"
              soloIcono
              icono={ampliado ? Minimize2 : Maximize2}
              onClick={() => setAmpliado((a) => !a)}
              className="hidden sm:inline-flex"
              aria-label={ampliado ? 'Reducir' : 'Ampliar'}
              title={ampliado ? 'Reducir' : 'Ampliar'}
            />
            <Boton variante="fantasma" soloIcono icono={X} onClick={cerrar} aria-label="Cerrar sin enviar" title="Cerrar (Esc)" />
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {/* De, Para, Cc y Asunto */}
            {conDe && (
              <div className={FILA}>
                <span className={ROTULO}>De</span>
                <label className={cn('relative flex min-w-0 flex-1 items-center gap-2 rounded-[10px] py-1', TACTIL)}>
                  <PuntoDeBuzon direccion={actual.direccion} />
                  <span className="min-w-0 flex-1 truncate text-base text-[var(--ls-t1)] lg:text-[13.5px]">
                    {actual.nombre ? <span className="font-medium">{actual.nombre} </span> : null}
                    <span className={actual.nombre ? 'text-[var(--ls-t3)]' : ''}>{actual.nombre ? `<${actual.direccion}>` : actual.direccion}</span>
                  </span>
                  {!actual.esMio && <UserCheck className="h-3.5 w-3.5 shrink-0 text-[var(--ls-e-azul)]" aria-label="Asignado a ti" />}
                  <ChevronDown className="h-4 w-4 shrink-0 text-[var(--ls-t3)]" aria-hidden />
                  {/* El selector nativo, encima y transparente: en el móvil abre la rueda del sistema y con el teclado se maneja como siempre */}
                  <select
                    value={actual.id}
                    onChange={(e) => cambiarDe(e.target.value)}
                    disabled={ocupado}
                    aria-label="Enviar desde"
                    className="absolute inset-0 h-full w-full cursor-pointer appearance-none opacity-0 disabled:cursor-not-allowed"
                  >
                    {opciones.map((b) => (
                      <option key={b.id} value={b.id}>
                        {etiquetaDeBuzon(b)}
                        {b.esMio ? '' : ` (de ${b.propietario.nombre || direccionCorta(b.direccion)})`}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}
            <div className={FILA}>
              <label htmlFor="redactar-para" className={ROTULO}>
                Para
              </label>
              <input
                id="redactar-para"
                ref={entradaPara}
                value={para}
                onChange={(e) => setPara(e.target.value)}
                placeholder="nombre@cliente.es, otra@cliente.es"
                spellCheck={false}
                autoComplete="off"
                inputMode="email"
                className={ENTRADA}
              />
              {!mostrarCc && (
                <button type="button" onClick={() => setMostrarCc(true)} className={cn('shrink-0 rounded-[8px] px-2 text-[12.5px] font-medium text-[var(--ls-t3)] hover:bg-[var(--ls-sup2)] hover:text-[var(--ls-t1)]', TACTIL, FOCO)}>
                  Cc
                </button>
              )}
            </div>
            {mostrarCc && (
              <div className={FILA}>
                <label htmlFor="redactar-cc" className={ROTULO}>
                  Cc
                </label>
                <input id="redactar-cc" value={cc} onChange={(e) => setCc(e.target.value)} spellCheck={false} autoComplete="off" inputMode="email" className={ENTRADA} />
              </div>
            )}
            <div className={FILA}>
              <label htmlFor="redactar-asunto" className={ROTULO}>
                Asunto
              </label>
              <input id="redactar-asunto" value={asunto} onChange={(e) => setAsunto(e.target.value)} maxLength={500} className={cn(ENTRADA, 'font-medium')} />
            </div>

            <div className="space-y-3 px-4 pb-4 pt-3">
              {/* El cuerpo. Mientras la IA escribe: solo lectura con un brillo y la línea de arriba; el texto se sigue viendo */}
              {iaRedactando && (
                <p className="flex items-start gap-2 text-[12.5px] leading-snug text-[var(--ls-t2)]" role="status">
                  <Loader2 className="mt-px h-4 w-4 shrink-0 animate-spin text-[var(--ls-acc)] motion-reduce:animate-none" aria-hidden />
                  <span>
                    <span className="font-medium text-[var(--ls-t1)]">Redactando con IA…</span>{' '}
                    <span className="text-[var(--ls-t3)]">Suele tardar unos segundos; si acabas de colgar, puede esperar hasta un minuto a que se transcriba la llamada. Después lo puedes editar.</span>
                  </span>
                </p>
              )}
              <div className="relative">
                <textarea
                  ref={entradaTexto}
                  value={texto}
                  onChange={(e) => setTexto(e.target.value)}
                  onBlur={seg.alSalirDelTexto}
                  readOnly={iaRedactando}
                  rows={ampliado ? 22 : 12}
                  aria-label="Mensaje"
                  aria-busy={iaRedactando}
                  placeholder="Escribe tu mensaje…"
                  className={cn(
                    'block min-h-[200px] w-full resize-y rounded-[10px] border bg-[var(--ls-sup2)] p-3 text-base leading-relaxed text-[var(--ls-t1)] outline-none transition-[border-color,box-shadow] placeholder:text-[var(--ls-t4)] lg:text-[13.5px]',
                    'border-[var(--ls-linea)] hover:border-[var(--ls-linea2)] focus:border-[var(--ls-acc-graf)] focus-visible:shadow-[0_0_0_3px_color-mix(in_srgb,var(--ls-acc-graf)_22%,transparent)]',
                    iaRedactando && 'cursor-progress border-[color-mix(in_srgb,var(--ls-acc)_45%,transparent)] text-[var(--ls-t2)]',
                  )}
                />
                {iaRedactando && (
                  <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden rounded-[10px]">
                    {sinMovimiento ? (
                      <div className="absolute inset-0 bg-[color-mix(in_srgb,var(--ls-acc)_6%,transparent)]" />
                    ) : (
                      <motion.div
                        className="absolute inset-y-0 w-1/2"
                        style={{ background: 'linear-gradient(90deg, transparent, color-mix(in srgb, var(--ls-acc) 12%, transparent), transparent)' }}
                        initial={{ x: '-100%' }}
                        animate={{ x: '220%' }}
                        transition={{ duration: 1.6, ease: 'linear', repeat: Infinity }}
                      />
                    )}
                  </div>
                )}
              </div>
              {iaBorrador && !iaRedactando && (
                <p className="flex items-start gap-2 text-[12px] leading-snug text-[var(--ls-t3)]">
                  <Sparkles className="mt-px h-3.5 w-3.5 shrink-0 text-[var(--ls-acc)]" aria-hidden />
                  <span>
                    Borrador de la IA: léelo y edítalo antes de enviar.
                    {iaBorrador.ejemplos > 0 ? ` Se ha basado en ${iaBorrador.ejemplos} ${iaBorrador.ejemplos === 1 ? 'correo' : 'correos'} del equipo que obtuvieron respuesta.` : ''}
                    {iaBorrador.aviso ? <span className="text-[var(--ls-e-ambar)]"> {iaBorrador.aviso}</span> : null}
                  </span>
                </p>
              )}

              <ComprobacionDeCorreo resultado={comprobacion.resultado} onUsarSugerencia={usarSugerencia} />
              {confirmaMala && (
                <div
                  className="sec-sube flex flex-wrap items-center gap-2 rounded-[10px] border border-[var(--ls-e-rojo)] bg-[color-mix(in_srgb,var(--ls-e-rojo)_8%,transparent)] px-3 py-2"
                  role="alertdialog"
                  aria-label="Confirmar el envío a una dirección que seguramente no existe"
                >
                  <p className="min-w-0 flex-1 basis-[220px] text-[12.5px] leading-snug text-[var(--ls-t1)]">
                    <strong className="font-semibold">¿Seguro?</strong> Hay una dirección que seguramente no existe. Este correo te lo ha tenido que dar alguien para que lo puedas enviar.
                    {seg.elegible && seg.activo ? ' Si lo envías, no se programarán seguimientos.' : ''}
                  </p>
                  <Boton variante="peligro" tamano="sm" onClick={() => void enviar(undefined, true)} disabled={enviando}>
                    Sí, me lo han dado: enviar
                  </Boton>
                  <Boton variante="fantasma" tamano="sm" onClick={() => setConfirmaMala(false)}>
                    Corregir
                  </Boton>
                </div>
              )}
              {conSeguimientos && (
                <div ref={bloqueSeguimientos}>
                  <BloqueDeSeguimientos seg={seg} />
                </div>
              )}

              {borrador.respondeA &&
                (borrador.modo === 'reenviar' ? (
                  <p className="text-[12.5px] text-[var(--ls-t3)]">El mensaje original va debajo. Los adjuntos del original no se reenvían.</p>
                ) : (
                  <label className={cn('flex w-fit cursor-pointer select-none items-center gap-2 text-[12.5px] text-[var(--ls-t3)]', TACTIL)}>
                    <input type="checkbox" checked={conCita} onChange={(e) => setConCita(e.target.checked)} className="h-4 w-4 accent-[var(--ls-acc-graf)]" />
                    Citar el mensaje original debajo
                  </label>
                ))}

              {adjuntos.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[11.5px] text-[var(--ls-t4)]">
                    {adjuntos.length} {adjuntos.length === 1 ? 'adjunto' : 'adjuntos'} · {tamanoLegible(bytes)} de {tamanoLegible(MAX_BYTES_ADJUNTOS)}
                  </p>
                  <ul className="flex flex-wrap gap-2" aria-label="Adjuntos">
                    {adjuntos.map((a, i) => (
                      <li key={`${a.name}-${i}`} className="inline-flex max-w-full items-center gap-2 rounded-full border border-[var(--ls-linea)] bg-[var(--ls-sup2)] py-1 pl-3 pr-1 text-[12.5px] text-[var(--ls-t2)] sm:max-w-[280px]">
                        <Paperclip className="h-3.5 w-3.5 shrink-0 text-[var(--ls-t4)]" aria-hidden />
                        <span className="min-w-0 truncate">{a.name}</span>
                        <span className="shrink-0 text-[11px] tabular-nums text-[var(--ls-t4)]">{tamanoLegible(a.size)}</span>
                        <button
                          type="button"
                          onClick={() => setAdjuntos(adjuntos.filter((_, j) => j !== i))}
                          aria-label={`Quitar ${a.name}`}
                          className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[var(--ls-t4)] hover:bg-[var(--ls-sup3)] hover:text-[var(--ls-t1)] [@media(pointer:coarse)]:h-9 [@media(pointer:coarse)]:w-9', FOCO)}
                        >
                          <X className="h-3.5 w-3.5" aria-hidden />
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {error && (
                <p className="flex items-start gap-2 rounded-[10px] border border-[color-mix(in_srgb,var(--ls-e-ambar)_35%,transparent)] bg-[color-mix(in_srgb,var(--ls-e-ambar)_8%,transparent)] px-3 py-2 text-[12.5px] leading-snug text-[var(--ls-e-ambar)]" role="alert">
                  <AlertCircle className="mt-px h-4 w-4 shrink-0" aria-hidden /> <span className="min-w-0">{error}</span>
                </p>
              )}
            </div>
          </div>

          {/* Pie: Adjuntar, Plantillas, IA … Descartar, Enviar */}
          <footer className="flex shrink-0 items-center gap-1 border-t border-[var(--ls-linea)] bg-[var(--ls-sup)] px-3 py-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] sm:px-4">
            <input ref={entradaFicheros} type="file" multiple onChange={(e) => añadir(e.target.files)} className="sr-only" tabIndex={-1} aria-hidden />
            <Boton variante="fantasma" icono={Paperclip} onClick={() => entradaFicheros.current?.click()} disabled={enviando} aria-label="Adjuntar" title={`Adjuntar (hasta ${MAX_ADJUNTOS} ficheros y ${tamanoLegible(MAX_BYTES_ADJUNTOS)})`} className="px-2.5 [@media(pointer:coarse)]:min-w-[44px]">
              <span className="hidden md:inline">Adjuntar</span>
            </Boton>
            <SelectorDePlantillas yoId={yoId} esAdmin={esAdmin} actual={{ asunto, texto: textoSinFirma(texto, actual.firma) }} onAplicar={aplicarPlantilla} onInsertarCampo={insertarCampo} conAsunto={borrador.modo === 'nuevo'} />
            {borrador.lead && (
              <Popover open={iaAbierta && !iaRedactando} onOpenChange={setIaAbierta}>
                <PopoverTrigger asChild>
                  <Boton
                    variante="fantasma"
                    icono={Sparkles}
                    cargando={iaRedactando}
                    disabled={enviando}
                    aria-label={iaRedactando ? 'Redactando con IA' : iaBorrador ? 'Volver a redactar con IA' : 'Redactar con IA'}
                    title="La IA escribe el correo con los datos y el historial de este lead (sin facturación)"
                    className="px-2.5 text-[var(--ls-t1)] [@media(pointer:coarse)]:min-w-[44px] [&>svg:first-child]:text-[var(--ls-acc)]"
                  >
                    <span className="hidden md:inline">{iaRedactando ? 'Redactando…' : iaBorrador ? 'Volver a redactar' : 'IA'}</span>
                  </Boton>
                </PopoverTrigger>
                <PopoverContent
                  align="start"
                  side="top"
                  sideOffset={8}
                  collisionPadding={12}
                  className="z-[80] w-[min(360px,calc(100vw-1.5rem))] space-y-2.5 rounded-[14px] border border-[var(--ls-linea2)] bg-[var(--ls-sup)] p-3 text-[var(--ls-t2)] shadow-[var(--ls-sombra-3)]"
                  onOpenAutoFocus={(e) => {
                    e.preventDefault()
                    document.getElementById('ia-indicaciones')?.focus()
                  }}
                  // Lo que se teclea aquí no es del mensaje: Ctrl+Intro redacta (no envía) y Escape cierra solo este cuadro
                  onKeyDown={(e) => e.stopPropagation()}
                >
                  <p className="text-[12.5px] leading-snug text-[var(--ls-t3)]">
                    {hayCuerpoEscrito(texto, actual.firma) ? 'Parte de lo que hay escrito y lo sustituye por el nuevo borrador.' : 'Escribe el correo con los datos y el historial de este lead.'} No dirá nada de facturación.
                  </p>
                  <textarea
                    id="ia-indicaciones"
                    value={iaPide}
                    onChange={(e) => setIaPide(e.target.value.slice(0, 600))}
                    onKeyDown={(e) => {
                      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                        e.preventDefault()
                        void redactarConIa(iaPide)
                      }
                    }}
                    rows={3}
                    placeholder="Opcional: qué quieres que diga o cambie…"
                    aria-label="Indicaciones para la IA"
                    className="w-full resize-none rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] p-2.5 text-base leading-snug text-[var(--ls-t1)] outline-none transition-colors placeholder:text-[var(--ls-t4)] focus:border-[var(--ls-acc-graf)] lg:text-[12.5px]"
                  />
                  <div className="flex flex-wrap gap-1.5">
                    {SUGERENCIAS_DE_CAMBIO.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setIaPide(sumarIndicacion(iaPide, s))}
                        className={cn('inline-flex h-7 items-center rounded-full border border-[var(--ls-linea)] px-2.5 text-[12px] text-[var(--ls-t3)] transition-colors hover:border-[var(--ls-linea2)] hover:text-[var(--ls-t1)]', TACTIL, FOCO)}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="hidden items-center gap-1 text-[11px] text-[var(--ls-t4)] md:inline-flex">
                      <Kbd>{tecla}</Kbd>
                      <Kbd>↵</Kbd>
                    </span>
                    <Boton variante="primario" tamano="sm" icono={Sparkles} onClick={() => void redactarConIa(iaPide)} className="ml-auto">
                      {iaBorrador ? 'Volver a redactar' : 'Redactar'}
                    </Boton>
                  </div>
                </PopoverContent>
              </Popover>
            )}

            <span className="ml-auto flex items-center gap-1 sm:gap-1.5">
              <Boton variante="fantasma" soloIcono icono={Trash2} onClick={cerrar} disabled={enviando} aria-label="Descartar" title="Descartar" className="hover:text-[var(--ls-e-rojo)]" />
              <Boton type="submit" variante="primario" disabled={iaRedactando} cargando={enviando || seg.generando} icono={Send} title={`Enviar (${tecla} + Intro)`}>
                <span className="sm:hidden">{textoDeEnviarCorto}</span>
                <span className="hidden sm:inline">{textoDeEnviar}</span>
                <span className="ml-0.5 hidden items-center gap-0.5 opacity-75 md:inline-flex" aria-hidden>
                  <kbd className="font-sans text-[11px]">{tecla}</kbd>
                  <kbd className="font-sans text-[11px]">↵</kbd>
                </span>
              </Boton>
            </span>
          </footer>
        </motion.form>
      </div>

      <Confirmacion
        abierto={confirmaCerrar}
        onCambio={setConfirmaCerrar}
        titulo="¿Descartar lo escrito?"
        descripcion="El mensaje no se ha enviado y no se guarda como borrador."
        palabra={null}
        textoConfirmar="Sí, descartar"
        textoCancelar="Seguir escribiendo"
        onConfirmar={() => onCerrar()}
      />
    </MotionConfig>
  )
}
