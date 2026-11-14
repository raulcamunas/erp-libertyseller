'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Eye, EyeOff, KeyRound, LayoutGrid, Power, Save, ShieldCheck, Store, Trash2, Undo2, UserPlus, UserRound, Wand2 } from 'lucide-react'
import { toast } from 'sonner'
import { Boton, Confirmacion, Insignia, PanelDePestana, PanelLateral, Pestanas, haceCuanto } from '@/components/ui-ls'
import { CASILLAS, CASILLAS_GESTIONADAS } from '@/lib/usuarios/casillas'
import { esCorreoDelDueno } from '@/lib/usuarios/gestion'
import { contarCambios, generarContrasena, type DatosDeFicha, type UsuarioDeLista } from '@/lib/usuarios/filtros'
import { aplicarPuesto, esComercialDelPuesto, llevaListaPropia, opcionDeRol, rolYPuestoDe, type OpcionDeRol, type PuestoGuardado } from '@/lib/usuarios/puestos'
import { AccesosRemesas } from './AccesosRemesas'
import { EditorDeAccesos } from './EditorDeAccesos'
import { SelectorDeRol } from './SelectorDeRol'
import { CAMPO, Campo, InsigniaDeRol } from './piezas'

/**
 * LA FICHA DE UNA PERSONA: UN SOLO FORMULARIO PARA CREAR Y PARA EDITAR (antes dos modales casi idénticos, unas 250 líneas repetidas).
 *
 * Pestañas Perfil · Rol · Accesos · Cuentas FBA (esta solo para un cliente, en lugar de Accesos). Nada se guarda al tocar: abajo se cuentan los cambios y se guardan de una vez
 * (Ctrl/Cmd + S también). Cerrar con cambios pide confirmación.
 *
 * La barra de cambios va en el PIE del panel y no con BarraCambiosSinGuardar: el panel es un diálogo modal de Radix y todo lo que queda fuera (la barra va en otro portal) no
 * se puede pulsar mientras está abierto; un clic en ella cerraría el panel.
 */

export interface UsuarioGestionado extends UsuarioDeLista {
  is_comercial: boolean
}

type Pestana = 'perfil' | 'rol' | 'accesos' | 'cuentas'

interface Formulario extends DatosDeFicha {
  crear_lista: boolean
}

const vacio = (): Formulario => ({ email: '', full_name: '', password: '', role: 'employee', puesto: null, is_comercial: false, accesos: [], crear_lista: false })

const desdeUsuario = (u: UsuarioGestionado): Formulario => ({
  email: u.email,
  full_name: u.full_name ?? '',
  password: '',
  role: u.role,
  puesto: u.puesto ?? null,
  is_comercial: u.is_comercial,
  // Solo las que la pantalla conoce: el resto (permisos antiguos sin casilla) se conserva en el servidor, no se toca desde aquí
  accesos: u.accesos.filter((id) => CASILLAS.some((c) => c.id === id)),
  crear_lista: false,
})

export interface FichaDeUsuarioProps {
  abierto: boolean
  /** null = dar de alta a alguien */
  usuario: UsuarioGestionado | null
  /** Quien está usando la pantalla */
  actorId: string
  onCerrar: () => void
  /** Tras guardar: recargar la lista */
  onGuardado: () => void
  onCambiarEstado: (u: UsuarioGestionado, activo: boolean) => Promise<unknown>
  onBorrar: (u: UsuarioGestionado) => void
}

export function FichaDeUsuario({ abierto, usuario, actorId, onCerrar, onGuardado, onCambiarEstado, onBorrar }: FichaDeUsuarioProps) {
  const creando = usuario === null
  const inicial = useMemo(() => (usuario ? desdeUsuario(usuario) : vacio()), [usuario])
  const [form, setForm] = useState<Formulario>(inicial)
  const [pestana, setPestana] = useState<Pestana>('perfil')
  const [guardando, setGuardando] = useState(false)
  const [verContrasena, setVerContrasena] = useState(false)
  const [preguntarSalir, setPreguntarSalir] = useState(false)

  // Cada vez que se abre otra persona (o el alta), se parte de lo guardado
  useEffect(() => {
    setForm(inicial)
    setPestana('perfil')
    setVerContrasena(false)
  }, [inicial, abierto])

  const cambios = contarCambios(inicial, form)
  const sucio = creando ? form.email !== '' || form.full_name !== '' || form.password !== '' || form.accesos.length > 0 : cambios > 0

  const esUnoMismo = usuario?.id === actorId
  const esDueno = esCorreoDelDueno(usuario?.email)
  const rolBloqueado = esUnoMismo ? 'Es tu propia cuenta: no puedes cambiarte el rol desde aquí.' : esDueno ? 'Es la cuenta del dueño del ERP: su rol no se cambia.' : undefined
  const esCliente = form.role === 'cliente'
  const opcion = opcionDeRol(form.role, form.puesto)
  const marcadas = useMemo(() => new Set(form.accesos), [form.accesos])
  const nAccesos = form.accesos.filter((id) => CASILLAS_GESTIONADAS.has(id)).length

  // Si pasa a cliente estando en Accesos (o deja de serlo en Cuentas), se va a la pestaña que toca
  useEffect(() => {
    if (esCliente && pestana === 'accesos') setPestana('cuentas')
    if (!esCliente && pestana === 'cuentas') setPestana('accesos')
  }, [esCliente, pestana])

  /** Un puesto pre-marca sus casillas: al crear sustituye (no hay nada que conservar), al editar suma (cambiar de puesto no quita lo que ya tenía) */
  const cambiarOpcion = (o: OpcionDeRol) => {
    const { role, puesto } = rolYPuestoDe(o)
    setForm((f) => {
      const llama = esComercialDelPuesto(puesto, f.is_comercial) ?? f.is_comercial
      const casillas = aplicarPuesto(
        CASILLAS.map((c) => ({ app_id: c.id, can_access: f.accesos.includes(c.id) })),
        puesto,
        creando ? 'sustituir' : 'sumar',
      )
      return { ...f, role, puesto, is_comercial: llama, crear_lista: creando && llevaListaPropia(puesto, llama), accesos: casillas.filter((c) => c.can_access).map((c) => c.app_id) }
    })
  }

  const validar = (): string | null => {
    if (!form.full_name.trim()) return 'Falta el nombre.'
    if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) return 'El correo no parece válido.'
    if (creando && form.password.length < 6) return 'La contraseña tiene que tener al menos 6 caracteres.'
    if (!creando && form.password.length > 0 && form.password.length < 6) return 'La contraseña nueva tiene que tener al menos 6 caracteres.'
    return null
  }

  const guardar = useCallback(async () => {
    const error = validar()
    if (error) {
      toast.error(error)
      setPestana('perfil')
      return
    }
    setGuardando(true)
    try {
      // `is_comercial` lo fija el puesto; sin puesto no se manda (no se toca lo que la persona ya tenía)
      const puestoGuardado = form.puesto as PuestoGuardado | null
      const llama = puestoGuardado ? esComercialDelPuesto(puestoGuardado, form.is_comercial) : undefined
      const permissions = form.accesos.map((app_id) => ({ app_id, can_access: true }))
      const cuerpo = creando
        ? {
            email: form.email.trim(),
            password: form.password,
            full_name: form.full_name.trim(),
            role: form.role,
            puesto: form.puesto,
            is_comercial: llama,
            crear_lista: form.crear_lista && llevaListaPropia(puestoGuardado, form.is_comercial),
            permissions,
          }
        : {
            userId: usuario!.id,
            email: form.email.trim(),
            full_name: form.full_name.trim(),
            password: form.password || undefined,
            role: form.role,
            puesto: form.puesto,
            is_comercial: llama,
            permissions,
          }
      const res = await fetch(creando ? '/api/users/create' : '/api/users/update', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) })
      const datos = (await res.json().catch(() => null)) as { error?: string; lista?: string | null; avisos?: string[] } | null
      if (!res.ok) throw new Error(datos?.error || `Error ${res.status}`)
      toast.success(creando ? (datos?.lista ? `Usuario creado. Su lista «${datos.lista}» está creada y asignada.` : 'Usuario creado') : 'Cambios guardados')
      for (const aviso of datos?.avisos ?? []) toast.warning(aviso)
      onGuardado()
      onCerrar()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se ha podido guardar')
    } finally {
      setGuardando(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, creando, usuario])

  // Ctrl/Cmd + S guarda mientras haya cambios
  useEffect(() => {
    if (!abierto || !sucio) return
    const atajo = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        if (!guardando) void guardar()
      }
    }
    window.addEventListener('keydown', atajo)
    return () => window.removeEventListener('keydown', atajo)
  }, [abierto, sucio, guardando, guardar])

  const pedirCierre = (abrir: boolean) => {
    if (abrir) return
    if (sucio && !guardando) setPreguntarSalir(true)
    else onCerrar()
  }

  const opciones = [
    { id: 'perfil' as const, texto: 'Perfil', icono: UserRound },
    { id: 'rol' as const, texto: 'Rol', icono: ShieldCheck },
    esCliente ? { id: 'cuentas' as const, texto: 'Cuentas FBA', icono: Store } : { id: 'accesos' as const, texto: 'Accesos', icono: LayoutGrid, cuenta: nAccesos },
  ]

  const protegido = esUnoMismo || esDueno

  const pie = sucio || creando ? (
    <div className="flex w-full flex-wrap items-center gap-2">
      {!creando && (
        <span className="flex min-w-0 flex-1 items-center gap-2 text-[13px] font-medium text-[var(--ls-t1)]" aria-live="polite">
          <span className="relative flex h-2 w-2 shrink-0" aria-hidden>
            <span className="absolute inline-flex h-full w-full rounded-full bg-[var(--ls-e-ambar)] opacity-60 motion-safe:animate-ping" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--ls-e-ambar)]" />
          </span>
          {cambios} {cambios === 1 ? 'cambio sin guardar' : 'cambios sin guardar'}
        </span>
      )}
      <div className={creando ? 'ml-auto flex gap-2' : 'flex gap-2'}>
        <Boton variante="fantasma" icono={Undo2} onClick={() => (creando ? onCerrar() : setForm(inicial))} disabled={guardando}>
          {creando ? 'Cancelar' : 'Descartar'}
        </Boton>
        <Boton variante="primario" icono={creando ? UserPlus : Save} onClick={() => void guardar()} cargando={guardando}>
          {creando ? 'Crear usuario' : 'Guardar'}
        </Boton>
      </div>
    </div>
  ) : (
    <div className="flex w-full items-center gap-2">
      {!creando && usuario && !protegido && (
        <Boton variante="secundario" icono={Power} onClick={() => void onCambiarEstado(usuario, usuario.desactivado === true)}>
          {usuario.desactivado ? 'Reactivar' : 'Desactivar'}
        </Boton>
      )}
      <Boton variante="fantasma" className="ml-auto" onClick={onCerrar}>
        Cerrar
      </Boton>
    </div>
  )

  return (
    <>
      <PanelLateral
        abierto={abierto}
        onCambio={pedirCierre}
        ancho={560}
        acento="personas"
        icono={creando ? UserPlus : UserRound}
        titulo={creando ? 'Nuevo usuario' : usuario?.full_name || usuario?.email || 'Usuario'}
        descripcion={creando ? 'Datos, rol y accesos. Se guarda todo de una vez.' : usuario?.email}
        acciones={
          !creando && usuario ? (
            <span className="flex items-center gap-1">
              {usuario.desactivado && (
                <Insignia tono="rojo" tamano="sm">
                  Desactivado
                </Insignia>
              )}
              <InsigniaDeRol role={form.role} puesto={form.puesto} llama={form.is_comercial} />
            </span>
          ) : null
        }
        pie={pie}
      >
        <div className="-mt-1 flex flex-col gap-4">
          <Pestanas etiqueta="Secciones de la ficha" acento="personas" opciones={opciones} valor={pestana} onCambio={setPestana} idPanel="ficha-usuario" />

          <PanelDePestana id="ficha-usuario" key={pestana}>
            {pestana === 'perfil' && (
              <div className="flex flex-col gap-4">
                <Campo id="u-nombre" etiqueta="Nombre completo">
                  <input id="u-nombre" className={CAMPO} value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} placeholder="Ana Martínez" autoComplete="off" />
                </Campo>
                <Campo id="u-correo" etiqueta="Correo" ayuda={esDueno ? 'Es el correo del dueño: abre Gestión de Usuarios y no se cambia desde aquí.' : undefined}>
                  <input
                    id="u-correo"
                    type="email"
                    className={CAMPO}
                    value={form.email}
                    disabled={esDueno}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    placeholder="nombre@libertyseller.es"
                    autoComplete="off"
                  />
                </Campo>
                <Campo
                  id="u-clave"
                  etiqueta={creando ? 'Contraseña' : 'Contraseña nueva'}
                  ayuda={creando ? 'Mínimo 6 caracteres. Pásasela a la persona por un canal privado.' : 'Déjala vacía para no cambiarla.'}
                >
                  <div className="flex gap-2">
                    <div className="relative min-w-0 flex-1">
                      <input
                        id="u-clave"
                        type={verContrasena ? 'text' : 'password'}
                        className={`${CAMPO} pr-11`}
                        value={form.password}
                        onChange={(e) => setForm({ ...form, password: e.target.value })}
                        placeholder={creando ? 'Mínimo 6 caracteres' : 'Sin cambiar'}
                        autoComplete="new-password"
                      />
                      <button
                        type="button"
                        onClick={() => setVerContrasena((v) => !v)}
                        aria-label={verContrasena ? 'Ocultar la contraseña' : 'Ver la contraseña'}
                        className="absolute right-0 top-0 flex h-full w-11 items-center justify-center text-[var(--ls-t4)] hover:text-[var(--ls-t1)]"
                      >
                        {verContrasena ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    <Boton
                      variante="secundario"
                      icono={Wand2}
                      onClick={() => {
                        setForm({ ...form, password: generarContrasena() })
                        setVerContrasena(true)
                      }}
                    >
                      Generar
                    </Boton>
                  </div>
                </Campo>

                {!creando && usuario && (
                  <dl className="grid grid-cols-2 gap-2">
                    {[
                      ['Alta', new Date(usuario.created_at).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })],
                      ['Último acceso', usuario.ultimo_acceso ? haceCuanto(usuario.ultimo_acceso) : 'Nunca'],
                    ].map(([k, v]) => (
                      <div key={k} className="rounded-[12px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-3 py-[10px]">
                        <dt className="text-[11.5px] text-[var(--ls-t4)]">{k}</dt>
                        <dd className="mt-[2px] truncate text-[13.5px] font-semibold text-[var(--ls-t1)]">{v}</dd>
                      </div>
                    ))}
                  </dl>
                )}

                {!creando && usuario && !protegido && (
                  <details className="group rounded-[12px] border border-[var(--ls-linea)] px-3 py-2">
                    <summary className="flex min-h-[40px] cursor-pointer list-none items-center gap-2 text-[12.5px] font-medium text-[var(--ls-t3)] hover:text-[var(--ls-t1)]">
                      <KeyRound className="h-[14px] w-[14px]" aria-hidden />
                      Más opciones
                    </summary>
                    <div className="flex flex-col gap-2 pb-2 pt-1">
                      <p className="text-[12px] leading-snug text-[var(--ls-t4)]">
                        Lo normal es <strong className="text-[var(--ls-t2)]">desactivar</strong>: no puede entrar y se conservan sus horas, citas, leads y correos. Borrar es para siempre y
                        se lleva por delante lo que cuelga de su perfil.
                      </p>
                      <Boton variante="peligro" tamano="sm" icono={Trash2} className="self-start" onClick={() => onBorrar(usuario)}>
                        Borrar para siempre
                      </Boton>
                    </div>
                  </details>
                )}
              </div>
            )}

            {pestana === 'rol' && (
              <SelectorDeRol
                opcion={opcion}
                onCambiar={cambiarOpcion}
                llama={form.is_comercial}
                onLlama={(v) => setForm({ ...form, is_comercial: v, crear_lista: creando ? v : form.crear_lista })}
                crearLista={creando ? form.crear_lista : undefined}
                onCrearLista={creando ? (v) => setForm({ ...form, crear_lista: v }) : undefined}
                bloqueado={rolBloqueado}
              />
            )}

            {pestana === 'accesos' && !esCliente && (
              <>
                {form.role === 'admin' && form.puesto !== 'ceo' && (
                  <p className="mb-3 rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-3 py-2 text-[12.5px] text-[var(--ls-t3)]">
                    Un administrador entra a todas las aplicaciones sin casillas. Lo que marques aquí solo cuenta si un día deja de serlo.
                  </p>
                )}
                <EditorDeAccesos marcadas={marcadas} puesto={form.puesto} onCambiar={(s) => setForm({ ...form, accesos: Array.from(s) })} />
              </>
            )}

            {pestana === 'cuentas' && esCliente && (
              <div className="flex flex-col gap-3">
                <p className="text-[12.5px] leading-snug text-[var(--ls-t3)]">
                  Un cliente no tiene aplicaciones del ERP: entra solo en Remesas a FBA, a las cuentas de Amazon que se le den aquí.
                </p>
                {creando || !usuario ? (
                  <p className="rounded-[10px] border border-dashed border-[var(--ls-linea2)] px-3 py-3 text-[12.5px] text-[var(--ls-t4)]">
                    Crea primero al cliente; después ábrelo y dale sus cuentas aquí.
                  </p>
                ) : (
                  <AccesosRemesas usuarioId={usuario.id} />
                )}
              </div>
            )}
          </PanelDePestana>
        </div>
      </PanelLateral>

      <Confirmacion
        abierto={preguntarSalir}
        onCambio={setPreguntarSalir}
        palabra={null}
        tono="normal"
        titulo="¿Cerrar sin guardar?"
        descripcion={creando ? 'Se pierde lo que has escrito del alta.' : `Hay ${cambios} ${cambios === 1 ? 'cambio' : 'cambios'} sin guardar.`}
        textoConfirmar="Cerrar sin guardar"
        textoCancelar="Seguir editando"
        onConfirmar={() => {
          setPreguntarSalir(false)
          onCerrar()
        }}
      />
    </>
  )
}
