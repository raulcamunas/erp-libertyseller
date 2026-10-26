'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { enviarJson, pedir } from '@/components/correo/api'
import { Aviso } from '@/components/correo/ui'
import { Esqueleto } from '@/components/rendimiento/ui'
import { cambiosDelPerfil } from '@/lib/whatsapp/ia-cambios'
import type { RespuestaDeVersionesDeWhatsapp, VersionDeWhatsappVista } from '@/lib/whatsapp/ia-laboratorio-tipos'
import { copiaDelPerfil, perfilesIguales, validarPerfilDeWhatsapp, type PerfilDeWhatsapp } from '@/lib/whatsapp/ia-perfil'
import { fechaCorta } from '../correo-laboratorio/ui'
import { BarraDeVersion, NUEVA } from './BarraDeVersion'
import { EditorDePerfil } from './EditorDePerfil'
import { PanelDePrueba } from './PanelDePrueba'

/**
 * CALIBRAR LA IA DE WHATSAPP: el editor a la izquierda y la prueba siempre a la vista a la derecha.
 *
 * El recorrido es AJUSTAR → PROBAR → PUBLICAR:
 *   · Se ajusta en el editor (mandos, textos, momentos, ejemplos, modelo).
 *   · Se prueba con los casos de prueba o con un lead real, sin guardar y sin enviar nada: sale el mensaje de cada uno y, si se quiere, a su lado el de la versión que usa el equipo.
 *   · Se guarda como borrador y, cuando una prueba de lo que hay en el editor ha salido bien, se publica: desde ese momento lo usa todo el equipo.
 *
 * La versión que usa el equipo y las que ya estuvieron en producción NUNCA se modifican: al primer cambio, esta pantalla abre una versión nueva a partir de ella (sin guardar) y es esa la
 * que se edita. Así no se estropea lo que está funcionando, y el historial sigue diciendo qué se le pidió a la IA cada día.
 *
 * Si falta la migración 250 la pantalla sigue sirviendo para PROBAR (con la configuración de serie), no para guardar ni publicar.
 */

const URL_VERSIONES = '/api/correo/laboratorio/whatsapp/versiones'

/** Lo que hay en el editor: el perfil, el nombre y las notas de la versión */
interface Contenido {
  perfil: PerfilDeWhatsapp
  nombre: string
  notas: string
}

interface RespuestaDeGuardado {
  version: VersionDeWhatsappVista
  avisos?: string[]
}

type Mensaje = { tipo: 'ok' | 'error'; texto: string; detalles?: string[] }

const contenidoDe = (v: VersionDeWhatsappVista): Contenido => ({ perfil: copiaDelPerfil(v.perfil), nombre: v.nombre, notas: v.notas ?? '' })
const mismoContenido = (a: Contenido, b: Contenido) => a.nombre.trim() === b.nombre.trim() && a.notas.trim() === b.notas.trim() && perfilesIguales(a.perfil, b.perfil)
const nombreDeCopia = (nombre: string) => `${nombre.replace(/ \(copia\)$/, '')} (copia)`.slice(0, 80)
const nombreNuevo = () => `Prueba del ${fechaCorta(new Date().toISOString())}`

export function CalibradorDeWhatsapp() {
  const [datos, setDatos] = useState<RespuestaDeVersionesDeWhatsapp | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [seleccion, setSeleccion] = useState<string>(NUEVA)
  const [editor, setEditor] = useState<Contenido | null>(null)
  /** Con lo que se compara el editor para saber si hay cambios sin guardar */
  const [base, setBase] = useState<Contenido | null>(null)
  /** Si lo que hay en el editor es una versión nueva nacida de otra, el nombre de esa */
  const [parteDe, setParteDe] = useState<string | null>(null)
  const [probado, setProbado] = useState<{ huella: string; todoBien: boolean } | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [mensaje, setMensaje] = useState<Mensaje | null>(null)
  const [abrir, setAbrir] = useState<{ id: string; n: number } | null>(null)

  const versiones = datos?.versiones ?? []
  const sinBase = datos?.faltaMigracion != null
  const version = seleccion === NUEVA ? null : (versiones.find((v) => v.id === seleccion) ?? null)
  const produccion = versiones.find((v) => v.enProduccion) ?? null
  const sucio = editor !== null && base !== null && !mismoContenido(editor, base)

  const empezarDeNuevo = useCallback((serie: PerfilDeWhatsapp) => {
    const c: Contenido = { perfil: copiaDelPerfil(serie), nombre: nombreNuevo(), notas: '' }
    setSeleccion(NUEVA)
    setEditor(c)
    setBase(c)
    setParteDe(null)
  }, [])

  const abrirVersion = useCallback((v: VersionDeWhatsappVista) => {
    setSeleccion(v.id)
    setEditor(contenidoDe(v))
    setBase(contenidoDe(v))
    setParteDe(null)
  }, [])

  const cargar = useCallback(async () => {
    const r = await pedir<RespuestaDeVersionesDeWhatsapp>(URL_VERSIONES)
    if (!r.ok) {
      setError(r.mensaje)
      return
    }
    setDatos(r.datos)
    setError(null)
    // Lo primero que se ve es lo que usa el equipo: es contra lo que se compara todo lo demás
    const inicial = r.datos.versiones.find((v) => v.enProduccion) ?? r.datos.versiones.find((v) => !v.archivada)
    if (inicial) abrirVersion(inicial)
    else empezarDeNuevo(r.datos.serie)
  }, [abrirVersion, empezarDeNuevo])

  useEffect(() => {
    void cargar()
  }, [cargar])

  // Cerrar la pestaña con cambios sin guardar: el navegador avisa
  useEffect(() => {
    if (!sucio) return
    const avisar = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', avisar)
    return () => window.removeEventListener('beforeunload', avisar)
  }, [sucio])

  const referencia = produccion?.perfil ?? datos?.serie ?? null
  const cambios = useMemo(() => (editor && referencia ? cambiosDelPerfil(editor.perfil, referencia) : []), [editor, referencia])
  const huella = editor ? JSON.stringify(editor.perfil) : ''
  const prueba: 'sin' | 'mal' | 'bien' = probado === null || probado.huella !== huella ? 'sin' : probado.todoBien ? 'bien' : 'mal'
  // La misma validación que hará el servidor al guardar: así no se intenta guardar ni publicar algo que se va a rechazar
  const errorDelPerfil = useMemo(() => {
    if (!editor) return null
    const v = validarPerfilDeWhatsapp(editor.perfil)
    return v.ok ? null : v.error
  }, [editor])

  const confirmarSiHayCambios = () => !sucio || window.confirm('Tienes cambios sin guardar. Si sigues, se pierden. ¿Seguir?')

  const elegir = (id: string) => {
    if (!datos || (id === seleccion && id !== NUEVA)) return
    if (!confirmarSiHayCambios()) return
    setMensaje(null)
    if (id === NUEVA) {
      empezarDeNuevo(datos.serie)
      return
    }
    const v = versiones.find((x) => x.id === id)
    if (v) abrirVersion(v)
  }

  /** Abre una versión nueva (sin guardar) con este perfil. `comoBase` es lo que cuenta como «sin cambios»: lo de la versión de la que nace, o el propio perfil si es un duplicado exacto */
  const bifurcar = (perfil: PerfilDeWhatsapp, comoBase: PerfilDeWhatsapp) => {
    if (!editor) return
    const nombre = nombreDeCopia(editor.nombre)
    setParteDe(version?.nombre ?? editor.nombre)
    setSeleccion(NUEVA)
    setBase({ perfil: copiaDelPerfil(comoBase), nombre, notas: '' })
    setEditor({ perfil, nombre, notas: '' })
    setMensaje(null)
  }

  const cambiarPerfil = (perfil: PerfilDeWhatsapp) => {
    if (!editor) return
    // La que usa el equipo y las que ya estuvieron en producción no se tocan: el primer cambio abre una versión nueva a partir de ella
    if (version && (version.bloqueada || version.archivada)) {
      bifurcar(perfil, version.perfil)
      return
    }
    setEditor({ ...editor, perfil })
  }

  const alGuardar = (v: VersionDeWhatsappVista, nuevaLista: VersionDeWhatsappVista[], texto: string, detalles?: string[]) => {
    setDatos((d) => (d ? { ...d, versiones: nuevaLista } : d))
    setSeleccion(v.id)
    // El editor no se toca (y por tanto la prueba que se hizo sigue valiendo, y lo que se escriba mientras se guarda no se pierde); lo que se mandó a guardar es lo que cuenta como «sin cambios»
    if (editor) setBase({ perfil: editor.perfil, nombre: v.nombre, notas: v.notas ?? '' })
    setParteDe(null)
    setMensaje({ tipo: 'ok', texto, detalles })
  }

  const guardar = async () => {
    if (!editor || ocupado) return
    const nombre = editor.nombre.trim()
    if (nombre === '') {
      setMensaje({ tipo: 'error', texto: 'Ponle un nombre a la versión.' })
      return
    }
    setOcupado(true)
    setMensaje(null)
    const cuerpo = { nombre, notas: editor.notas, perfil: editor.perfil }
    const esNueva = seleccion === NUEVA
    const r = esNueva ? await enviarJson<RespuestaDeGuardado>(URL_VERSIONES, 'POST', cuerpo) : await enviarJson<RespuestaDeGuardado>(`${URL_VERSIONES}/${seleccion}`, 'PATCH', cuerpo)
    setOcupado(false)
    if (!r.ok) {
      setMensaje({ tipo: 'error', texto: r.mensaje })
      return
    }
    const v = r.datos.version
    alGuardar(v, esNueva ? [...versiones, v] : versiones.map((x) => (x.id === v.id ? v : x)), esNueva ? 'Guardada como borrador. Todavía no la usa nadie: pruébala y, cuando te guste, publícala.' : 'Cambios guardados.', r.datos.avisos)
  }

  const publicar = async () => {
    if (!version || ocupado) return
    setOcupado(true)
    setMensaje(null)
    const r = await enviarJson<{ versiones: VersionDeWhatsappVista[] }>(`${URL_VERSIONES}/${version.id}`, 'PATCH', { accion: 'publicar' })
    setOcupado(false)
    if (!r.ok) {
      setMensaje({ tipo: 'error', texto: r.mensaje })
      void pedir<RespuestaDeVersionesDeWhatsapp>(URL_VERSIONES).then((lista) => lista.ok && setDatos(lista.datos))
      return
    }
    setDatos((d) => (d ? { ...d, versiones: r.datos.versiones } : d))
    const publicada = r.datos.versiones.find((v) => v.id === version.id)
    if (publicada) abrirVersion(publicada)
    setMensaje({ tipo: 'ok', texto: 'Publicada. La usa todo el equipo desde ya (a los que ya tengan abierto el desplegable les llega en menos de medio minuto).' })
  }

  const archivar = async (archivada: boolean) => {
    if (!version || ocupado) return
    setOcupado(true)
    setMensaje(null)
    const r = await enviarJson<RespuestaDeGuardado>(`${URL_VERSIONES}/${version.id}`, 'PATCH', { archivada })
    setOcupado(false)
    if (!r.ok) {
      setMensaje({ tipo: 'error', texto: r.mensaje })
      return
    }
    const nueva = versiones.map((x) => (x.id === r.datos.version.id ? r.datos.version : x))
    setDatos((d) => (d ? { ...d, versiones: nueva } : d))
    if (archivada) {
      // Una archivada no se queda en pantalla: se vuelve a lo que usa el equipo
      const vuelta = nueva.find((v) => v.enProduccion) ?? nueva.find((v) => !v.archivada)
      if (vuelta) abrirVersion(vuelta)
      else if (datos) empezarDeNuevo(datos.serie)
      setMensaje({ tipo: 'ok', texto: `«${r.datos.version.nombre}» archivada. Está en «Archivadas» por si quieres recuperarla.` })
    } else {
      abrirVersion(r.datos.version)
      setMensaje({ tipo: 'ok', texto: 'Recuperada.' })
    }
  }

  const alProbar = useCallback((h: string, todoBien: boolean) => setProbado({ huella: h, todoBien }), [])
  const alEditar = useCallback((clave: string) => setAbrir((a) => ({ id: clave, n: (a?.n ?? 0) + 1 })), [])

  if (error) {
    return (
      <Aviso titulo="No se ha podido abrir la configuración de WhatsApp">
        {error}{' '}
        <button type="button" onClick={() => void cargar()} className="underline underline-offset-2 hover:text-[var(--ls-t1)]">
          Volver a probar
        </button>
      </Aviso>
    )
  }

  if (!datos || !editor) {
    return (
      <div className="space-y-3" aria-busy="true" aria-label="Cargando">
        <Esqueleto className="h-32" />
        <div className="grid gap-3 lg:grid-cols-2">
          <Esqueleto className="h-80" />
          <Esqueleto className="h-80" />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {sinBase && (
        <Aviso titulo="Falta un paso para poder guardar y publicar">{datos.faltaMigracion}</Aviso>
      )}

      <BarraDeVersion
        versiones={versiones}
        seleccion={seleccion}
        onElegir={elegir}
        version={version}
        parteDe={parteDe}
        nombre={editor.nombre}
        notas={editor.notas}
        onNombre={(nombre) => setEditor({ ...editor, nombre })}
        onNotas={(notas) => setEditor({ ...editor, notas })}
        sucio={sucio}
        ocupado={ocupado}
        sinBase={sinBase}
        prueba={prueba}
        error={errorDelPerfil}
        cambios={cambios}
        cambiosContra={produccion || !sinBase ? 'la que usa el equipo' : 'la configuración de serie, que es la que usa el equipo ahora'}
        onGuardar={() => void guardar()}
        onPublicar={() => void publicar()}
        onDuplicar={() => bifurcar(editor.perfil, editor.perfil)}
        onArchivar={(a) => void archivar(a)}
      />

      {mensaje && (
        <div role={mensaje.tipo === 'error' ? 'alert' : 'status'} className={`rounded-[8px] border px-3 py-2 text-[12.5px] leading-snug ${mensaje.tipo === 'error' ? 'border-[var(--ls-e-rojo)] text-[var(--ls-e-rojo)]' : 'border-[var(--ls-e-verde)] text-[var(--ls-t1)]'}`}>
          <p>{mensaje.texto}</p>
          {mensaje.detalles?.map((d) => (
            <p key={d} className="mt-1 text-[11.5px] text-[var(--ls-e-ambar)]">
              {d}
            </p>
          ))}
        </div>
      )}

      <div className="grid items-start gap-3 lg:grid-cols-2">
        <div className="space-y-2">
          <a href="#panel-de-prueba" className="inline-flex items-center gap-1 text-[12px] text-[var(--ls-t3)] underline underline-offset-2 hover:text-[var(--ls-t1)] lg:hidden">
            Ir a la prueba ↓
          </a>
          <EditorDePerfil perfil={editor.perfil} serie={datos.serie} modelos={datos.modelos} onCambio={cambiarPerfil} abrir={abrir} />
        </div>
        <div id="panel-de-prueba" className="scroll-mt-3 lg:sticky lg:top-3 lg:max-h-[calc(100vh-1.5rem)] lg:overflow-y-auto lg:pr-1">
          <PanelDePrueba
            casos={datos.casos}
            perfil={editor.perfil}
            produccion={produccion ? { id: produccion.id, nombre: produccion.nombre } : sinBase ? { id: 'serie', nombre: 'La configuración de serie' } : null}
            esLaDeProduccion={version?.enProduccion === true || (sinBase && perfilesIguales(editor.perfil, datos.serie))}
            onProbado={alProbar}
            onEditar={alEditar}
          />
        </div>
      </div>
    </div>
  )
}
