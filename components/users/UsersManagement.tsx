'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Building2, ChevronRight, Crown, PhoneCall, RefreshCw, Search, Store, UserPlus, UserRoundX, UsersRound } from 'lucide-react'
import { toast } from 'sonner'
import {
  Avatar,
  Boton,
  CabeceraDeModulo,
  Confirmacion,
  FilaDeKpis,
  Insignia,
  Kpi,
  Segmentado,
  TablaAdaptable,
  haceCuanto,
  type Columna,
} from '@/components/ui-ls'
import { CASILLA_POR_ID, CASILLAS_GESTIONADAS } from '@/lib/usuarios/casillas'
import { ETIQUETA_DE_CATEGORIA, filtrarUsuarios, resumir, type Filtro } from '@/lib/usuarios/filtros'
import { esAdminPleno } from '@/lib/usuarios/gestion'
import { FichaDeUsuario, type UsuarioGestionado } from './FichaDeUsuario'
import { CAMPO, InsigniaDeRol } from './piezas'

/**
 * GESTIÓN DE USUARIOS (/dashboard/users). Solo la abre el dueño del ERP (lib/usuarios/gestion.ts), y sus rutas exigen lo mismo.
 *
 * Arriba, el resumen (personas activas con su curva de altas, dirección, comercial, administración y clientes). Debajo, buscador y filtros por rol o puesto, y la lista: cada
 * persona con su avatar, su rol y los iconos de las apps que tiene (en el móvil, una tarjeta por persona). Al pulsar a alguien se abre su ficha en un panel lateral
 * (FichaDeUsuario: Perfil · Rol · Accesos · Cuentas FBA), que es también el formulario de alta.
 *
 * Antes era una tabla de 49 columnas (una casilla por app) que escribía en user_app_permissions desde el navegador a cada clic. Ahora todo pasa por /api/users, que comprueba
 * quién llama y lo que no se puede hacer nunca. Lo normal para dar de baja es DESACTIVAR (se conserva el historial); borrar queda escondido en la ficha y pide escribir BORRAR.
 */

interface RespuestaLista {
  usuarios?: Array<Omit<UsuarioGestionado, 'accesos'> & { permissions: Array<{ app_id: string; can_access: boolean }> }>
  sinEstado?: boolean
  error?: string
}

const OPCIONES_FILTRO: ReadonlyArray<{ id: Filtro; texto: string }> = [
  { id: 'todos', texto: 'Todos' },
  { id: 'direccion', texto: ETIQUETA_DE_CATEGORIA.direccion },
  { id: 'comercial', texto: ETIQUETA_DE_CATEGORIA.comercial },
  { id: 'administracion', texto: ETIQUETA_DE_CATEGORIA.administracion },
  { id: 'empleado', texto: 'Sin puesto' },
  { id: 'cliente', texto: ETIQUETA_DE_CATEGORIA.cliente },
  { id: 'desactivados', texto: 'Desactivados' },
]

/** Cuántos iconos de apps se enseñan en la fila antes del «+N» */
const ICONOS_EN_FILA = 6

export function UsersManagement({ actorId }: { actorId: string }) {
  const [usuarios, setUsuarios] = useState<UsuarioGestionado[]>([])
  const [cargando, setCargando] = useState(true)
  const [sinEstado, setSinEstado] = useState(false)
  const [filtro, setFiltro] = useState<Filtro>('todos')
  const [busqueda, setBusqueda] = useState('')
  const [fichaAbierta, setFichaAbierta] = useState(false)
  const [seleccionado, setSeleccionado] = useState<UsuarioGestionado | null>(null)
  const [aBorrar, setABorrar] = useState<UsuarioGestionado | null>(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    try {
      const res = await fetch('/api/users/lista', { cache: 'no-store' })
      const datos = (await res.json().catch(() => null)) as RespuestaLista | null
      if (!res.ok || !datos?.usuarios) throw new Error(datos?.error || 'No se han podido cargar los usuarios')
      const lista: UsuarioGestionado[] = datos.usuarios.map(({ permissions, ...u }) => ({
        ...u,
        is_comercial: u.is_comercial === true,
        accesos: permissions.filter((p) => p.can_access).map((p) => p.app_id),
      }))
      setUsuarios(lista)
      setSinEstado(datos.sinEstado === true)
      // Si la ficha de alguien está abierta, se refresca con lo nuevo
      setSeleccionado((s) => (s ? (lista.find((u) => u.id === s.id) ?? null) : s))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se han podido cargar los usuarios')
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const resumen = useMemo(() => resumir(usuarios), [usuarios])
  const visibles = useMemo(() => filtrarUsuarios(usuarios, filtro, busqueda), [usuarios, filtro, busqueda])
  const cuentaDe = (f: Filtro) => (f === 'todos' ? resumen.activos : f === 'desactivados' ? resumen.desactivados : resumen.porCategoria[f])
  const adminsPlenos = useMemo(() => usuarios.filter((u) => !u.desactivado && esAdminPleno(u.role, u.puesto ?? null)).length, [usuarios])

  const abrir = (u: UsuarioGestionado | null) => {
    setSeleccionado(u)
    setFichaAbierta(true)
  }

  const cambiarEstado = async (u: UsuarioGestionado, activo: boolean) => {
    const res = await fetch('/api/users/estado', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: u.id, activo }) })
    const datos = (await res.json().catch(() => null)) as { error?: string } | null
    if (!res.ok) {
      toast.error(datos?.error || 'No se ha podido cambiar el estado')
      return
    }
    toast.success(activo ? `${u.full_name || u.email} vuelve a poder entrar` : `${u.full_name || u.email} ya no puede entrar. Su historial se conserva.`)
    await cargar()
  }

  const borrar = async () => {
    if (!aBorrar) return
    const res = await fetch('/api/users/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: aBorrar.id }) })
    const datos = (await res.json().catch(() => null)) as { error?: string } | null
    if (!res.ok) {
      toast.error(datos?.error || 'No se ha podido borrar')
      throw new Error(datos?.error || 'No se ha podido borrar')
    }
    toast.success('Usuario borrado')
    setABorrar(null)
    setFichaAbierta(false)
    setSeleccionado(null)
    await cargar()
  }

  const columnas: Columna<UsuarioGestionado>[] = [
    {
      id: 'persona',
      cabecera: 'Persona',
      movil: 'titulo',
      ordenar: (u) => (u.full_name || u.email).toLowerCase(),
      celda: (u) => (
        <span className="flex min-w-0 items-center gap-3">
          <Avatar nombre={u.full_name || u.email} tamano={34} estado={u.desactivado ? 'rojo' : undefined} />
          <span className="min-w-0">
            <span className={`block truncate text-[13.5px] font-semibold ${u.desactivado ? 'text-[var(--ls-t3)] line-through decoration-[var(--ls-t4)]' : 'text-[var(--ls-t1)]'}`}>
              {u.full_name || 'Sin nombre'}
              {u.id === actorId && <span className="ml-2 text-[11px] font-medium text-[var(--ls-t4)]">(tú)</span>}
            </span>
            <span className="block truncate text-[12px] text-[var(--ls-t4)]">{u.email}</span>
          </span>
        </span>
      ),
    },
    {
      id: 'rol',
      cabecera: 'Rol',
      movil: 'insignia',
      ordenar: (u) => `${u.role}-${u.puesto ?? ''}`,
      celda: (u) => (
        <span className="inline-flex flex-wrap items-center gap-1">
          <InsigniaDeRol role={u.role} puesto={u.puesto} llama={u.is_comercial} />
          {u.desactivado && (
            <Insignia tono="rojo" tamano="sm">
              Desactivado
            </Insignia>
          )}
        </span>
      ),
    },
    {
      id: 'accesos',
      cabecera: 'Accesos',
      rotuloMovil: 'Accesos',
      ordenar: (u) => u.accesos.filter((id) => CASILLAS_GESTIONADAS.has(id)).length,
      celda: (u) => <IconosDeAccesos usuario={u} />,
    },
    {
      id: 'acceso',
      cabecera: 'Último acceso',
      rotuloMovil: 'Último acceso',
      alinear: 'derecha',
      ordenar: (u) => (u.ultimo_acceso ? Date.parse(u.ultimo_acceso) : 0),
      celda: (u) => <span className="text-[12.5px] text-[var(--ls-t3)]">{u.ultimo_acceso ? haceCuanto(u.ultimo_acceso) : sinEstado ? '—' : 'Nunca'}</span>,
    },
    {
      id: 'alta',
      cabecera: 'Alta',
      movil: 'oculto',
      alinear: 'derecha',
      ordenar: (u) => Date.parse(u.created_at),
      celda: (u) => <span className="text-[12.5px] tabular-nums text-[var(--ls-t3)]">{new Date(u.created_at).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: '2-digit' })}</span>,
    },
  ]

  return (
    <div className="mx-auto w-full max-w-[1280px]">
      <CabeceraDeModulo
        icono={UsersRound}
        acento="personas"
        titulo="Gestión de Usuarios"
        subtitulo="Quién entra al ERP, con qué rol y a qué aplicaciones."
        acciones={
          <>
            <Boton variante="secundario" icono={RefreshCw} soloIcono aria-label="Recargar la lista" onClick={() => void cargar()} cargando={cargando} />
            <Boton variante="primario" icono={UserPlus} onClick={() => abrir(null)}>
              Nuevo usuario
            </Boton>
          </>
        }
      />

      <FilaDeKpis className="mt-1">
        <Kpi
          indice={0}
          etiqueta="Personas activas"
          icono={UsersRound}
          acento="personas"
          valor={cargando && usuarios.length === 0 ? null : resumen.activos}
          serie={resumen.altasAcumuladas}
          nota={resumen.altasRecientes > 0 ? `${resumen.altasRecientes} ${resumen.altasRecientes === 1 ? 'alta' : 'altas'} en 30 días` : `${resumen.desactivados} desactivadas`}
          cargando={cargando && usuarios.length === 0}
          onClick={() => setFiltro('todos')}
        />
        <Kpi
          indice={1}
          etiqueta="Dirección"
          icono={Crown}
          acento="personas"
          valor={resumen.porCategoria.direccion}
          nota={resumen.ceos > 0 ? `Incluye ${resumen.ceos} CEO` : 'Admins y partners'}
          cargando={cargando && usuarios.length === 0}
          onClick={() => setFiltro('direccion')}
        />
        <Kpi
          indice={2}
          etiqueta="Equipo comercial"
          icono={PhoneCall}
          acento="personas"
          valor={resumen.porCategoria.comercial}
          nota="Comerciales y managers"
          cargando={cargando && usuarios.length === 0}
          onClick={() => setFiltro('comercial')}
        />
        <Kpi
          indice={3}
          etiqueta="Administración"
          icono={Building2}
          acento="personas"
          valor={resumen.porCategoria.administracion}
          nota={`${resumen.porCategoria.empleado} sin puesto`}
          cargando={cargando && usuarios.length === 0}
          onClick={() => setFiltro('administracion')}
        />
        <Kpi
          indice={4}
          etiqueta="Clientes"
          icono={Store}
          acento="personas"
          valor={resumen.porCategoria.cliente}
          nota="Solo Remesas a FBA"
          cargando={cargando && usuarios.length === 0}
          onClick={() => setFiltro('cliente')}
        />
      </FilaDeKpis>

      <div className="mt-5 flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative lg:w-[320px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ls-t4)]" aria-hidden />
          <input
            type="search"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por nombre o correo…"
            aria-label="Buscar por nombre o correo"
            className={`${CAMPO} pl-9`}
          />
        </div>
        <Segmentado
          etiqueta="Filtrar por rol o puesto"
          tamano="sm"
          valor={filtro}
          onCambio={setFiltro}
          opciones={OPCIONES_FILTRO.map((o) => ({ ...o, cuenta: cuentaDe(o.id) }))}
        />
      </div>

      {sinEstado && (
        <p className="mt-3 text-[12px] text-[var(--ls-e-ambar)]">No se ha podido leer el sistema de acceso: no se ve quién está desactivado ni el último acceso.</p>
      )}

      <TablaAdaptable
        className="mt-4"
        etiqueta="Usuarios del ERP"
        columnas={columnas}
        filas={visibles}
        claveDe={(u) => u.id}
        alPulsarFila={abrir}
        filaActiva={fichaAbierta ? (seleccionado?.id ?? null) : null}
        ordenInicial={{ id: 'persona', sentido: 'asc' }}
        porPagina={25}
        cargando={cargando}
        acciones={(u) => (
          <Boton variante="fantasma" tamano="sm" soloIcono icono={ChevronRight} aria-label={`Abrir la ficha de ${u.full_name || u.email}`} onClick={() => abrir(u)} />
        )}
        vacio={
          usuarios.length === 0
            ? { icono: UsersRound, titulo: 'Todavía no hay usuarios', descripcion: 'Da de alta a la primera persona del equipo.', acento: 'personas', accion: { texto: 'Nuevo usuario', icono: UserPlus, onClick: () => abrir(null) } }
            : {
                icono: UserRoundX,
                titulo: 'Nadie coincide',
                descripcion: busqueda ? `Nadie se llama «${busqueda}» con este filtro.` : 'No hay nadie en este grupo.',
                acento: 'personas',
                accion: {
                  texto: 'Quitar filtros',
                  onClick: () => {
                    setBusqueda('')
                    setFiltro('todos')
                  },
                },
              }
        }
      />

      <FichaDeUsuario
        abierto={fichaAbierta}
        usuario={seleccionado}
        actorId={actorId}
        onCerrar={() => setFichaAbierta(false)}
        onGuardado={() => void cargar()}
        onCambiarEstado={cambiarEstado}
        onBorrar={setABorrar}
      />

      <Confirmacion
        abierto={aBorrar != null}
        onCambio={(a) => !a && setABorrar(null)}
        titulo={`¿Borrar a ${aBorrar?.full_name || aBorrar?.email || 'esta persona'} para siempre?`}
        descripcion={
          adminsPlenos <= 1 && aBorrar && esAdminPleno(aBorrar.role, aBorrar.puesto ?? null)
            ? 'Es el último administrador: el servidor no lo dejará borrar.'
            : 'Se borra su cuenta y, en cascada, lo que cuelga de su perfil. No se puede deshacer. Si solo quieres que no entre, desactívala.'
        }
        palabra="BORRAR"
        textoConfirmar="Borrar para siempre"
        onConfirmar={borrar}
      />
    </div>
  )
}

/** Los iconos de las apps que tiene (las primeras seis y «+N»), con el nombre al pasar el ratón */
function IconosDeAccesos({ usuario }: { usuario: UsuarioGestionado }) {
  if (usuario.role === 'cliente') return <span className="text-[12px] text-[var(--ls-t4)]">Cuentas de Remesas</span>
  if (esAdminPleno(usuario.role, usuario.puesto ?? null)) return <span className="text-[12px] text-[var(--ls-t3)]">Todo (administrador)</span>
  const ids = usuario.accesos.filter((id) => CASILLAS_GESTIONADAS.has(id))
  if (ids.length === 0) return <span className="text-[12px] text-[var(--ls-t4)]">{usuario.role === 'partner' ? 'Casi todo (socio)' : 'Sin accesos'}</span>
  const vistos = ids.slice(0, ICONOS_EN_FILA)
  return (
    <span className="inline-flex flex-wrap items-center gap-1" aria-label={`${ids.length} accesos: ${ids.map((id) => CASILLA_POR_ID.get(id)?.nombre ?? id).join(', ')}`}>
      {vistos.map((id) => {
        const c = CASILLA_POR_ID.get(id)
        if (!c) return null
        const Icono = c.icono
        return (
          <span
            key={id}
            title={c.nombre}
            className="flex h-6 w-6 items-center justify-center rounded-[7px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] text-[var(--ls-mod-personas)]"
            aria-hidden
          >
            <Icono className="h-[13px] w-[13px]" />
          </span>
        )
      })}
      {ids.length > ICONOS_EN_FILA && <span className="ml-1 text-[11.5px] font-medium tabular-nums text-[var(--ls-t3)]">+{ids.length - ICONOS_EN_FILA}</span>}
    </span>
  )
}
