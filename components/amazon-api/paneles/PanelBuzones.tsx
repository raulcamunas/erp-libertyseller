'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  CircleAlert,
  FlaskConical,
  Info,
  Loader2,
  Mailbox,
  Pencil,
  Plus,
  Power,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { deleteAmazon, getAmazon, patchAmazon, postAmazon } from '@/lib/amazon/client'
import { PanelCredencial } from '@/components/amazon/ExploradorOrigen'
import type { AltaBuzon, BuzonAdmin, TransporteBuzon } from '@/lib/stock-sync/buzones'
import type { CandidatoOrigen, SecretoDeclarado } from '@/lib/stock-sync/origenes/tipos'
import {
  AVISO,
  BOTON,
  CAMPO,
  CELDA,
  COLOR_ESTADO,
  LINEA,
  PANTALLA,
  RADIO,
  SUPERFICIE,
  TABLA,
  TEXTO,
  TEXTO_ESTADO,
  TIPO,
} from '@/lib/estilo/denso'
import { Aviso, Cargando, Dialogo, Vacio, fechaHora, hace } from '@/components/plataforma/comun'
import { ListaInfo, SeccionInfo } from '@/components/ui/BotonInfo'
import type { PropsPanel } from '../tipos'

/**
 * PESTAÑA «BUZONES» — DE QUÉ CORREOS SE SACAN LOS FICHEROS DE STOCK.
 *
 * Es el catálogo que alimenta el desplegable «de qué buzón se lee» de la pestaña
 * Origen. Un buzón se da de alta UNA VEZ y lo eligen los perfiles de los
 * clientes que hagan falta.
 *
 *
 * ============ ESTA PESTAÑA NO VA POR CLIENTE, Y ES LA ÚNICA ============
 *
 * Las demás pestañas del módulo enseñan lo del cliente que se haya elegido. Esta
 * enseña TODOS los buzones, también los que tienen dueño, y por eso lo primero
 * que se lee dentro es un aviso que lo dice. Sin él, quien venga de Catálogo con
 * un cliente elegido va a leer esta tabla como si fuera suya, y entonces «este
 * cliente tiene cuatro buzones» es exactamente lo contrario de la verdad.
 *
 * El dueño no es cosmético: un buzón con `client_id` SOLO lo pueden elegir los
 * perfiles de ese cliente, y hay dos triggers en la base (migración 198) que lo
 * impiden aunque alguien lo intente desde el editor SQL. Es lo que separa el
 * fichero de stock de un cliente del de otro.
 *
 *
 * ============ LA ÚLTIMA PRUEBA SE ENSEÑA SIEMPRE CON SU FECHA ============
 *
 * Un «bien» de hace tres semanas, con la contraseña caducada ayer, es una
 * mentira; y sin la fecha al lado no hay forma de verlo. Así que el resultado y
 * la fecha van juntos, nunca el resultado solo.
 *
 *
 * ============ «PROBAR» ES LO QUE DE VERDAD IMPORTA DE ESTA PANTALLA =========
 *
 * No contesta «bien»: enseña QUÉ CORREOS ENCAJAN y CUÁL SE COGERÍA. Un «bien»
 * solo dice que la contraseña entra, que es la mitad fácil; el fallo de verdad
 * es un filtro que encaja con el mensaje equivocado, y eso solo se ve con la
 * lista delante.
 */
export function PanelBuzones({ perfiles }: PropsPanel) {
  const [buzones, setBuzones] = useState<BuzonAdmin[] | null>(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /** null = cerrado; { buzon: null } = alta; { buzon } = edición */
  const [editando, setEditando] = useState<{ buzon: BuzonAdmin | null } | null>(null)
  const [borrando, setBorrando] = useState<BuzonAdmin | null>(null)
  const [trabajando, setTrabajando] = useState<string | null>(null)
  const [prueba, setPrueba] = useState<{ buzon: BuzonAdmin; resultado: Prueba | null } | null>(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    const res = await getAmazon<RespuestaBuzones>(RUTA)
    setCargando(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setError(null)
    setBuzones(res.data.buzones)
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  /**
   * De quién es cada buzón, por NOMBRE.
   *
   * Los clientes salen de los del módulo de sincronismo y no de los de Amazon:
   * `client_id` apunta a `stock_clients`, y usar la otra lista pintaría «—» en
   * un buzón que sí tiene dueño, que es justo el dato que no se puede perder.
   */
  const clientes = useMemo(() => perfiles?.clientes ?? [], [perfiles])
  const nombreCliente = useCallback(
    (id: string | null) => {
      if (!id) return null
      return clientes.find((c) => c.id === id)?.name ?? 'Un cliente que ya no está'
    },
    [clientes]
  )

  /** Los buzones agrupados por dueño: la agencia primero y los clientes detrás */
  const grupos = useMemo(() => {
    const porDuenyo = new Map<string, { titulo: string; filas: BuzonAdmin[] }>()
    for (const b of buzones ?? []) {
      const clave = b.clientId ?? ''
      const titulo = b.clientId ? (nombreCliente(b.clientId) ?? '') : 'De la agencia'
      const grupo = porDuenyo.get(clave) ?? { titulo, filas: [] }
      grupo.filas.push(b)
      porDuenyo.set(clave, grupo)
    }
    const agencia = porDuenyo.get('')
    const resto = [...porDuenyo.entries()]
      .filter(([clave]) => clave !== '')
      .map(([, grupo]) => grupo)
      .sort((a, b) => a.titulo.localeCompare(b.titulo, 'es'))
    return agencia ? [agencia, ...resto] : resto
  }, [buzones, nombreCliente])

  async function alternarActivo(b: BuzonAdmin) {
    setTrabajando(b.id)
    const res = await patchAmazon<RespuestaBuzones>(`${RUTA}/${b.id}`, { activo: !b.activo })
    setTrabajando(null)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    setBuzones(res.data.buzones)
    toast.success(
      b.activo
        ? `«${b.nombre}» queda apagado. Los perfiles que lo tuvieran elegido dejan de leer de él.`
        : `«${b.nombre}» queda encendido.`
    )
  }

  async function borrar(b: BuzonAdmin) {
    setTrabajando(b.id)
    const res = await deleteAmazon<RespuestaBuzones>(`${RUTA}/${b.id}`)
    setTrabajando(null)
    setBorrando(null)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    setBuzones(res.data.buzones)
    toast.success(`«${b.nombre}» borrado.`)
  }

  async function probar(b: BuzonAdmin) {
    setPrueba({ buzon: b, resultado: null })
    const res = await postAmazon<Prueba>(`${RUTA}/${b.id}/probar`, {})
    if (!res.ok) {
      setPrueba({ buzon: b, resultado: { ok: false, mensaje: res.error, candidatos: [] } })
      // La prueba queda anotada en el buzón, con su fecha, la salga bien o mal:
      // por eso se recarga también cuando falla. Sin esto, la columna «última
      // prueba» seguiría diciendo lo de la semana pasada.
      void cargar()
      return
    }
    setPrueba({ buzon: b, resultado: res.data })
    void cargar()
  }

  return (
    <div className={`${PANTALLA.cuerpo} h-full`}>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setEditando({ buzon: null })}
          className={`${BOTON.base} ${BOTON.primario}`}
        >
          <Plus className="h-[13px] w-[13px]" />
          Dar de alta un buzón
        </button>
        {cargando && buzones !== null && <Cargando texto="Actualizando…" />}
      </div>

      {/* Lo primero que se lee, y no está detrás del botón de información a
          propósito: quien llega aquí viene de una pestaña donde había elegido un
          cliente, y leería esta tabla como si fuera la de ese cliente. */}
      <div className="shrink-0">
        <Aviso tono="azul" icono={Info}>
          <span className={AVISO.fuerte}>Este apartado es de toda la agencia</span>, no depende del
          cliente que tengas elegido en las demás pestañas. Un buzón se da de alta una vez y lo
          eligen los perfiles que hagan falta, en Amazon API › Origen. Los que tienen dueño solo los
          pueden elegir los perfiles de ese cliente.
        </Aviso>
      </div>

      {error && (
        <div className="shrink-0">
          <Aviso tono="rojo" icono={AlertTriangle}>
            <span className={AVISO.fuerte}>No se han podido leer los buzones.</span> {error}
          </Aviso>
        </div>
      )}

      {buzones === null ? (
        cargando ? (
          <Cargando texto="Leyendo los buzones…" />
        ) : null
      ) : buzones.length === 0 ? (
        <Vacio
          icono={<Mailbox />}
          titulo="Todavía no hay ningún buzón dado de alta"
          accion={
            <button
              type="button"
              onClick={() => setEditando({ buzon: null })}
              className={`${BOTON.base} ${BOTON.primario}`}
            >
              <Plus className="h-[13px] w-[13px]" />
              Dar de alta el primero
            </button>
          }
        >
          Mientras no haya ninguno, los perfiles que leen de correo usan la cuenta de siempre del
          ERP. Da de alta aquí el buzón de la agencia, o el que te haya dado un cliente.
        </Vacio>
      ) : (
        <div className={TABLA.caja}>
          <table className={TABLA.tabla}>
            <thead>
              <tr>
                <th scope="col" className={TABLA.cabecera}>
                  Nombre
                </th>
                <th scope="col" className={TABLA.cabecera}>
                  Dirección
                </th>
                <th scope="col" className={TABLA.cabecera}>
                  Cómo se lee
                </th>
                <th scope="col" className={TABLA.cabecera}>
                  Contraseña
                </th>
                <th scope="col" className={TABLA.cabecera}>
                  Última prueba
                </th>
                <th scope="col" className={TABLA.cabecera}>
                  En uso por
                </th>
                <th scope="col" className={TABLA.cabecera}>
                  Activo
                </th>
                <th scope="col" className={TABLA.cabecera}>
                  <span className="sr-only">Acciones</span>
                </th>
              </tr>
            </thead>

            {grupos.map((grupo) => (
              <tbody key={grupo.titulo}>
                <tr>
                  <td colSpan={8} className={`${TABLA.celda} ${TEXTO.t4} ${TIPO.xs} uppercase`}>
                    {grupo.titulo}
                  </td>
                </tr>
                {grupo.filas.map((b) => (
                  <tr key={b.id} className={TABLA.fila}>
                    <td className={TABLA.celda}>
                      <span className={b.activo ? 'text-[var(--ls-t1)]' : TEXTO.t3}>{b.nombre}</span>
                      {b.notas && (
                        <span className={`ml-[6px] ${TIPO.s} ${TEXTO.t4}`} title={b.notas}>
                          · con notas
                        </span>
                      )}
                    </td>
                    <td className={`${TABLA.celda} ${TEXTO.t2}`}>{b.direccion}</td>
                    <td className={TABLA.celda}>
                      <ComoSeLee buzon={b} />
                    </td>
                    <td className={TABLA.celda}>
                      <Contrasena buzon={b} />
                    </td>
                    <td className={TABLA.celda}>
                      <UltimaPrueba buzon={b} />
                    </td>
                    <td className={TABLA.celda}>
                      {b.enUsoPor.length === 0 ? (
                        <span className={CELDA.vacia}>nadie</span>
                      ) : (
                        <span title={b.enUsoPor.join(', ')}>
                          {b.enUsoPor.length === 1
                            ? b.enUsoPor[0]
                            : `${b.enUsoPor[0]} y ${b.enUsoPor.length - 1} más`}
                        </span>
                      )}
                    </td>
                    <td className={TABLA.celda}>
                      <button
                        type="button"
                        onClick={() => void alternarActivo(b)}
                        disabled={trabajando === b.id}
                        className={`${BOTON.chip} ${b.activo ? BOTON.chipEncendido : ''}`}
                        title={
                          b.activo
                            ? 'Apagarlo. Los perfiles que lo tengan elegido dejarán de leer de él'
                            : 'Encenderlo para que se pueda elegir en un perfil'
                        }
                      >
                        <Power className="h-[13px] w-[13px]" />
                        {b.activo ? 'Sí' : 'No'}
                      </button>
                    </td>
                    <td className={`${TABLA.celda} whitespace-nowrap`}>
                      <span className="flex items-center gap-[4px]">
                        <button
                          type="button"
                          onClick={() => void probar(b)}
                          className={BOTON.chip}
                          title="Entrar en el buzón y enseñar qué correos encajan"
                        >
                          <FlaskConical className="h-[13px] w-[13px]" />
                          Probar
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditando({ buzon: b })}
                          className={BOTON.icono}
                          aria-label={`Editar ${b.nombre}`}
                        >
                          <Pencil className="h-[13px] w-[13px]" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setBorrando(b)}
                          className={BOTON.icono}
                          aria-label={`Borrar ${b.nombre}`}
                        >
                          <Trash2 className="h-[13px] w-[13px]" />
                        </button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      )}

      {editando && (
        <DialogoBuzon
          buzon={editando.buzon}
          clientes={clientes}
          onCerrar={() => setEditando(null)}
          onGuardado={(lista) => {
            setBuzones(lista)
            setEditando(null)
          }}
        />
      )}

      {borrando && (
        <DialogoBorrar
          buzon={borrando}
          trabajando={trabajando === borrando.id}
          onCerrar={() => setBorrando(null)}
          onBorrar={() => void borrar(borrando)}
        />
      )}

      {prueba && (
        <DialogoPrueba
          buzon={prueba.buzon}
          resultado={prueba.resultado}
          onCerrar={() => setPrueba(null)}
        />
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Las celdas que dicen algo                                           */
/* ------------------------------------------------------------------ */

function ComoSeLee({ buzon }: { buzon: BuzonAdmin }) {
  if (buzon.transporte === 'google') {
    return (
      <span className={TEXTO.t2} title="Nuestro Workspace, por delegación de dominio">
        Workspace (Gmail)
      </span>
    )
  }
  return (
    <span className={TEXTO.t2}>
      IMAP
      <span className={TEXTO.t4}>
        {' · '}
        {buzon.host ?? 'sin servidor'}
        {buzon.puerto ? `:${buzon.puerto}` : ''}
        {buzon.seguro ? '' : ' · sin cifrar'}
      </span>
    </span>
  )
}

/**
 * Los de Google NO tienen contraseña y eso NO es un problema: entran por
 * delegación de dominio. Pintarles «falta la contraseña» mandaría a buscar una
 * contraseña que no existe, que es peor que no decir nada.
 */
function Contrasena({ buzon }: { buzon: BuzonAdmin }) {
  if (buzon.transporte === 'google') {
    return (
      <span className={CELDA.vacia} title="No lleva: entra por delegación de dominio">
        no lleva
      </span>
    )
  }
  if (buzon.tieneContrasena) {
    return <span className={TEXTO_ESTADO.verde}>guardada</span>
  }
  return (
    <span className={TEXTO_ESTADO.rojo} title="Sin ella este buzón no puede abrir ningún correo">
      falta
    </span>
  )
}

/**
 * EL RESULTADO Y LA FECHA, SIEMPRE JUNTOS.
 *
 * Un «bien» suelto es el dato más engañoso de esta pantalla: el de un buzón
 * probado hace tres semanas, con la contraseña caducada ayer, se lee igual que
 * el de uno probado hace diez minutos. La fecha es lo que los separa.
 */
function UltimaPrueba({ buzon }: { buzon: BuzonAdmin }) {
  if (!buzon.ultimaPruebaAt) {
    return <span className={CELDA.vacia}>sin probar</span>
  }
  const ok = buzon.ultimaPruebaOk === true
  return (
    <span
      className="inline-flex items-center gap-[5px]"
      title={buzon.ultimaPruebaError ?? (ok ? 'Entró sin problema' : undefined)}
    >
      <span className={ok ? TEXTO_ESTADO.verde : TEXTO_ESTADO.rojo}>{ok ? 'bien' : 'falló'}</span>
      <span className={`${TIPO.s} ${TEXTO.t3}`}>{fechaHora(buzon.ultimaPruebaAt)}</span>
      <span className={`${TIPO.s} ${TEXTO.t4}`}>({hace(buzon.ultimaPruebaAt)})</span>
    </span>
  )
}

/* ------------------------------------------------------------------ */
/* El alta y la edición                                                */
/* ------------------------------------------------------------------ */

/**
 * EL FORMULARIO CAMBIA SEGÚN EL TRANSPORTE, Y NO ES UNA COMODIDAD.
 *
 * Los buzones de nuestro Workspace TIENEN que ir con host y puerto a null: lo
 * exige el CHECK `stock_buzones_google_ok` de la migración 198. Si esos dos
 * campos se pintaran siempre, se rellenarían siempre —están ahí, invitando— y el
 * alta se rechazaría con un error de Postgres que no dice qué sobra.
 *
 * Y al revés: un IMAP sin host lo rechaza el otro CHECK. Por eso el host solo se
 * pide cuando hace falta, y entonces es obligatorio.
 */
function DialogoBuzon({
  buzon,
  clientes,
  onCerrar,
  onGuardado,
}: {
  buzon: BuzonAdmin | null
  clientes: { id: string; name: string }[]
  onCerrar: () => void
  onGuardado: (buzones: BuzonAdmin[]) => void
}) {
  const [nombre, setNombre] = useState(buzon?.nombre ?? '')
  const [direccion, setDireccion] = useState(buzon?.direccion ?? '')
  const [transporte, setTransporte] = useState<TransporteBuzon>(buzon?.transporte ?? 'google')
  const [clientId, setClientId] = useState<string | null>(buzon?.clientId ?? null)
  const [host, setHost] = useState(buzon?.host ?? '')
  const [puerto, setPuerto] = useState(buzon?.puerto ? String(buzon.puerto) : '993')
  const [usuario, setUsuario] = useState(buzon?.usuario ?? '')
  const [carpeta, setCarpeta] = useState(buzon?.carpeta ?? 'INBOX')
  const [seguro, setSeguro] = useState(buzon?.seguro ?? true)
  const [notas, setNotas] = useState(buzon?.notas ?? '')

  const [guardando, setGuardando] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)

  /**
   * La contraseña tecleada en el alta, que todavía no tiene dónde guardarse: la
   * ruta que cifra cuelga del id del buzón y el buzón aún no existe.
   *
   * En la EDICIÓN no se usa: ahí manda PanelCredencial, que es el mismo cajetín
   * del perfil y guarda contra la ruta que cifra sin pasar por este formulario.
   */
  const [secretoNuevo, setSecretoNuevo] = useState('')
  const [credencialBorrador, setCredencialBorrador] = useState<{
    tipo: 'password' | 'clave_privada'
    valor: string
    passphrase: string
  } | null>(null)
  const [probando, setProbando] = useState(false)
  const [pruebaPrevia, setPruebaPrevia] = useState<Prueba | null>(null)

  /**
   * UN AVISO QUE YA NO ES VERDAD SE TIENE QUE IR SOLO.
   *
   * `aviso` solo se limpiaba dentro de guardar() y de probar(). O sea que esta
   * secuencia, que es la que hace cualquiera, dejaba dos mentiras en pantalla:
   *
   *   1. Cambias el buzón a IMAP con el servidor todavía vacío y le das a
   *      Guardar  ->  «Un buzón de otro proveedor necesita el servidor IMAP».
   *   2. Escribes imap.hostinger.com.                   (el aviso sigue ahí)
   *   3. Le das a «Guardar cifrada» en vez de a Guardar  ->  y encima se suma
   *      el error de la contraseña.
   *
   * Y acabas mirando un recuadro rojo que te pide un dato que tienes escrito
   * justo debajo. Un error que no se corresponde con lo que hay en pantalla es
   * peor que ningún error: enseña a no leerlos.
   *
   * Tocar cualquier campo lo borra. Si sigue faltando algo, Guardar lo vuelve a
   * decir — y entonces sí será verdad.
   */
  useEffect(() => {
    setAviso(null)
  }, [nombre, direccion, transporte, clientId, host, puerto, usuario, carpeta, seguro])

  const esGoogle = transporte === 'google'

  /** Lo que se manda, ya con las reglas de los dos CHECK de la 198 aplicadas */
  function datos(): AltaBuzon {
    return {
      nombre: nombre.trim(),
      direccion: direccion.trim().toLowerCase(),
      transporte,
      clientId,
      host: esGoogle ? null : host.trim() || null,
      puerto: esGoogle ? null : puerto.trim() === '' ? null : Number(puerto),
      usuario: usuario.trim() || null,
      carpeta: carpeta.trim() || null,
      seguro,
      notas: notas.trim() || null,
    }
  }

  /** Qué falta, dicho en una frase que diga QUÉ hacer. null = se puede mandar */
  function queFalta(): string | null {
    if (nombre.trim() === '') return 'Ponle un nombre: es lo que se lee en el desplegable del perfil.'
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(direccion.trim())) {
      return 'La dirección de correo no parece completa. Escríbela entera, con su @ y su dominio.'
    }
    if (!esGoogle) {
      if (host.trim() === '') {
        return 'Un buzón de otro proveedor necesita el servidor IMAP. En Hostinger es imap.hostinger.com.'
      }
      const p = Number(puerto)
      if (!Number.isInteger(p) || p < 1 || p > 65535) {
        return 'El puerto tiene que ser un número entre 1 y 65535. Con cifrado casi siempre es el 993.'
      }
    }
    return null
  }

  async function guardar() {
    const falta = queFalta()
    if (falta) {
      setAviso(falta)
      return
    }
    setAviso(null)
    setGuardando(true)

    const res = buzon
      ? await patchAmazon<RespuestaBuzones>(`${RUTA}/${buzon.id}`, datos())
      : await postAmazon<RespuestaBuzones>(RUTA, datos())

    if (!res.ok) {
      setGuardando(false)
      setAviso(res.error)
      return
    }

    /**
     * La contraseña del alta se guarda en un segundo viaje, contra la ruta que
     * cifra, y nunca dentro del cuerpo del buzón: en `stock_buzones` no hay
     * ninguna columna donde pudiera caer, y meterla ahí aunque fuera de paso es
     * cómo una contraseña acaba en un log de la base.
     */
    if (!buzon && !esGoogle && secretoNuevo !== '') {
      /**
       * Se busca por las TRES cosas —nombre, dirección y dueño— y no solo por la
       * dirección: la misma dirección puede estar dada de alta dos veces, una de
       * la agencia y otra de un cliente, y quedarse con la primera que aparezca
       * guardaría la contraseña de un cliente en el buzón de otro. Eso no daría
       * ningún error: la guardaría y ya está.
       *
       * Si no se encuentra —que no debería pasar— no se guarda nada y se dice,
       * en vez de escribir a ciegas.
       */
      const nuevo = datos()
      const creado = res.data.buzones.find(
        (b) =>
          b.direccion === nuevo.direccion &&
          b.nombre === nuevo.nombre &&
          b.clientId === nuevo.clientId
      )
      if (!creado) {
        setGuardando(false)
        setAviso(
          'El buzón se ha creado, pero no se ha podido identificar para guardarle la contraseña. Ciérralo, ábrelo con el lápiz y escríbela ahí.'
        )
        onGuardado(res.data.buzones)
        return
      }
      const guardado = await postAmazon(`${RUTA}/${creado.id}/credencial`, {
        valor: secretoNuevo,
      })
      if (!guardado.ok) {
        setGuardando(false)
        // El buzón SÍ está creado: decirlo, o se dará de alta otra vez.
        setAviso(
          `El buzón se ha creado, pero la contraseña no: ${guardado.error} Ciérralo, ábrelo con el lápiz y vuelve a escribirla.`
        )
        onGuardado(res.data.buzones)
        return
      }
    }

    setGuardando(false)
    // Se vuelve a leer la lista: la contraseña recién guardada cambia la columna
    // «contraseña» y el payload de la creación se escribió antes que ella.
    const fresco = await getAmazon<RespuestaBuzones>(RUTA)
    onGuardado(fresco.ok ? fresco.data.buzones : res.data.buzones)
    toast.success(buzon ? 'Buzón actualizado.' : 'Buzón dado de alta.')
  }

  /**
   * Probar ANTES de guardar, que es el momento en que se necesita.
   *
   * Sin esto hay que crear el buzón, cerrarlo, abrirlo otra vez, escribir la
   * contraseña y recién entonces probar — y si el host estaba mal, deshacer todo
   * eso. Aquí se teclea, se prueba y se guarda cuando entra.
   */
  async function probarAntes() {
    const falta = queFalta()
    if (falta) {
      setAviso(falta)
      return
    }
    setAviso(null)
    setProbando(true)
    const res = await postAmazon<Prueba>(`${RUTA}/probar`, {
      config: datos(),
      secreto: secretoNuevo,
    })
    setProbando(false)
    setPruebaPrevia(
      res.ok ? res.data : { ok: false, mensaje: res.error, candidatos: [] }
    )
  }

  return (
    <Dialogo
      titulo={buzon ? `Buzón «${buzon.nombre}»` : 'Dar de alta un buzón'}
      entradilla={
        buzon
          ? 'Los cambios afectan a todos los perfiles que lo tengan elegido.'
          : 'Se da de alta una vez y lo eligen los perfiles que hagan falta.'
      }
      onCerrar={onCerrar}
      ancho="max-w-[620px]"
      pie={
        <>
          <button
            type="button"
            onClick={() => void guardar()}
            disabled={guardando}
            className={`${BOTON.base} ${BOTON.primario}`}
          >
            {guardando && <Loader2 className="h-[13px] w-[13px] animate-spin" />}
            {buzon ? 'Guardar' : 'Dar de alta'}
          </button>
          <button type="button" onClick={onCerrar} className={`${BOTON.base} ${BOTON.secundario}`}>
            Cancelar
          </button>
        </>
      }
    >
      {aviso && (
        <Aviso tono="rojo" icono={CircleAlert}>
          {aviso}
        </Aviso>
      )}

      <div className={CAMPO.rejilla}>
        <div className={CAMPO.contenedor}>
          <label className={CAMPO.etiqueta}>
            Nombre<span className={CAMPO.obligatorio}> *</span>
          </label>
          <input
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Stock de la agencia"
            className={CAMPO.input}
          />
          <p className={CAMPO.nota}>Es lo que se lee en el desplegable del perfil.</p>
        </div>

        <div className={CAMPO.contenedor}>
          <label className={CAMPO.etiqueta}>
            Dirección<span className={CAMPO.obligatorio}> *</span>
          </label>
          <input
            value={direccion}
            onChange={(e) => setDireccion(e.target.value)}
            placeholder="stock@libertyseller.es"
            spellCheck={false}
            className={CAMPO.input}
          />
        </div>
      </div>

      <div className={CAMPO.contenedor}>
        <label className={CAMPO.etiqueta}>Cómo se entra</label>
        <div className="flex flex-wrap gap-[6px]">
          {TRANSPORTES.map((t) => (
            <button
              key={t.valor}
              type="button"
              aria-pressed={transporte === t.valor}
              onClick={() => setTransporte(t.valor)}
              className={`${BOTON.chip} ${transporte === t.valor ? BOTON.chipEncendido : ''}`}
            >
              {t.etiqueta}
            </button>
          ))}
        </div>
        <p className={CAMPO.nota}>
          {esGoogle
            ? 'Solo para direcciones de nuestro Workspace: se entra por delegación de dominio y no lleva contraseña.'
            : 'Para el correo del cliente o el de un hosting. Necesita servidor, puerto y contraseña propios.'}
        </p>
      </div>

      <div className={CAMPO.contenedor}>
        <label className={CAMPO.etiqueta}>De quién es</label>
        <select
          value={clientId ?? ''}
          onChange={(e) => setClientId(e.target.value || null)}
          className={`${CAMPO.input} [color-scheme:dark]`}
        >
          <option value="">De la agencia — lo puede elegir cualquier perfil</option>
          {clientes.map((c) => (
            <option key={c.id} value={c.id}>
              Solo de {c.name}
            </option>
          ))}
        </select>
        <p className={CAMPO.nota}>
          Un buzón con dueño SOLO lo pueden elegir los perfiles de ese cliente. Es lo que impide que
          el fichero de stock de uno acabe publicado en la cuenta de Amazon de otro.
        </p>
      </div>

      {!esGoogle && (
        <>
          <div className={CAMPO.rejilla}>
            <div className={CAMPO.contenedor}>
              <label className={CAMPO.etiqueta}>
                Servidor IMAP<span className={CAMPO.obligatorio}> *</span>
              </label>
              <input
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="imap.hostinger.com"
                spellCheck={false}
                className={CAMPO.input}
              />
            </div>

            <div className={CAMPO.contenedor}>
              <label className={CAMPO.etiqueta}>
                Puerto<span className={CAMPO.obligatorio}> *</span>
              </label>
              <input
                value={puerto}
                onChange={(e) => setPuerto(e.target.value)}
                inputMode="numeric"
                placeholder="993"
                className={`${CAMPO.input} ${CAMPO.numero}`}
              />
            </div>

            <div className={CAMPO.contenedor}>
              <label className={CAMPO.etiqueta}>Usuario</label>
              <input
                value={usuario}
                onChange={(e) => setUsuario(e.target.value)}
                placeholder="el mismo que la dirección"
                spellCheck={false}
                className={CAMPO.input}
              />
              <p className={CAMPO.nota}>
                Solo si el login no es la dirección entera. Casi ningún proveedor lo pide.
              </p>
            </div>

            <div className={CAMPO.contenedor}>
              <label className={CAMPO.etiqueta}>Carpeta</label>
              <input
                value={carpeta}
                onChange={(e) => setCarpeta(e.target.value)}
                placeholder="INBOX"
                spellCheck={false}
                className={CAMPO.input}
              />
              <p className={CAMPO.nota}>
                INBOX salvo que el cliente tenga una regla que mueva sus correos a otra.
              </p>
            </div>
          </div>

          <label className="flex items-start gap-[7px]">
            <input
              type="checkbox"
              checked={seguro}
              onChange={(e) => setSeguro(e.target.checked)}
              className="mt-[2px] h-[13px] w-[13px] cursor-pointer accent-[var(--ls-acc-relleno)]"
            />
            <span className={`${TIPO.s} ${TEXTO.t2}`}>
              Conexión cifrada (TLS)
              <span className={`block ${TEXTO.t3}`}>
                Déjalo marcado. Desmarcarlo manda la contraseña del cliente en claro por la red, y
                solo tiene sentido contra un servidor de pruebas.
              </span>
            </span>
          </label>
        </>
      )}

      {/* La contraseña: en la edición manda el cajetín de siempre, que guarda
          contra la ruta que cifra; en el alta todavía no hay id contra el que
          guardarla, así que se teclea aquí y viaja en un segundo paso. */}

      {/*
        EL CAMBIO A IMAP TIENE QUE ESTAR GUARDADO ANTES DE PEDIR LA CONTRASEÑA.

        `PanelCredencial` guarda contra la RUTA, y la ruta mira la fila GRABADA,
        no este formulario. Así que en un buzón que está en la base como Gmail y
        que aquí acaba de cambiarse a IMAP, escribir la contraseña y darle a
        guardar devuelve «este buzón se lee por la API de Gmail, cámbialo a
        IMAP» — con el botón de IMAP marcado delante. El aviso tiene razón y es
        inútil a la vez, y la culpa no es de la ruta: es de esta pantalla, que
        deja teclear una contraseña contra un estado que todavía no existe.

        Se enseña la razón y se manda a Guardar, que es lo único que desbloquea.
      */}
      {!esGoogle && buzon && buzon.transporte !== 'imap' ? (
        <Aviso tono="ambar" icono={AlertTriangle}>
          Para ponerle la contraseña hay que guardar antes el cambio a IMAP. La contraseña se guarda
          contra lo que hay grabado, y ahí todavía pone que este buzón se lee por Gmail. Dale a
          «Guardar», vuelve a abrirlo y el cajetín estará esperándote.
        </Aviso>
      ) : null}

      {!esGoogle &&
        !(buzon && buzon.transporte !== 'imap') &&
        (buzon ? (
          <PanelCredencial
            id={buzon.id}
            ruta={RUTA}
            declaracion={SECRETO_BUZON}
            borrador={credencialBorrador}
            onBorrador={setCredencialBorrador}
          />
        ) : (
          <div className={CAMPO.contenedor}>
            <label className={CAMPO.etiqueta}>Contraseña</label>
            <input
              type="password"
              value={secretoNuevo}
              onChange={(e) => setSecretoNuevo(e.target.value)}
              // Sin autocompletar: el gestor del navegador ofrecería guardar la
              // del cliente en el perfil de quien está configurando, que es
              // sacarla del ERP sin querer.
              autoComplete="new-password"
              spellCheck={false}
              className={CAMPO.input}
            />
            <p className={CAMPO.nota}>
              Se guarda cifrada en cuanto se da de alta el buzón y no vuelve a salir a pantalla
              nunca, ni para quien la metió. Se puede reemplazar; no se puede leer.
            </p>
          </div>
        ))}

      {!esGoogle && !buzon && (
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => void probarAntes()}
            disabled={probando}
            className={`${BOTON.base} ${BOTON.secundario}`}
          >
            {probando ? (
              <Loader2 className="h-[13px] w-[13px] animate-spin" />
            ) : (
              <FlaskConical className="h-[13px] w-[13px]" />
            )}
            Probar antes de guardar
          </button>
          {pruebaPrevia && <ResultadoPrueba resultado={pruebaPrevia} />}
        </div>
      )}

      <div className={CAMPO.contenedor}>
        <label className={CAMPO.etiqueta}>Notas</label>
        <textarea
          value={notas}
          onChange={(e) => setNotas(e.target.value)}
          rows={2}
          placeholder="Quién nos lo dio, a quién pedirle la contraseña cuando caduque…"
          className={`${CAMPO.input} h-auto resize-y py-[5px]`}
        />
      </div>
    </Dialogo>
  )
}

/* ------------------------------------------------------------------ */
/* Borrar                                                              */
/* ------------------------------------------------------------------ */

/**
 * BORRAR UN BUZÓN EN USO NO SE OFRECE SIQUIERA.
 *
 * El servidor lo rechaza con un 409 y la lista de perfiles, y la base lo
 * rechazaría igual por la clave ajena. Pero un botón que se pulsa y contesta que
 * no obliga a adivinar quién lo está usando: aquí están los nombres delante,
 * que es lo que hace falta para poder quitarlo de esos perfiles primero.
 */
function DialogoBorrar({
  buzon,
  trabajando,
  onCerrar,
  onBorrar,
}: {
  buzon: BuzonAdmin
  trabajando: boolean
  onCerrar: () => void
  onBorrar: () => void
}) {
  const enUso = buzon.enUsoPor.length > 0

  return (
    <Dialogo
      titulo={`Borrar «${buzon.nombre}»`}
      entradilla={buzon.direccion}
      onCerrar={onCerrar}
      pie={
        <>
          {!enUso && (
            <button
              type="button"
              onClick={onBorrar}
              disabled={trabajando}
              className={`${BOTON.base} ${BOTON.primario}`}
            >
              {trabajando && <Loader2 className="h-[13px] w-[13px] animate-spin" />}
              Borrarlo
            </button>
          )}
          <button type="button" onClick={onCerrar} className={`${BOTON.base} ${BOTON.secundario}`}>
            {enUso ? 'Entendido' : 'Cancelar'}
          </button>
        </>
      }
    >
      {enUso ? (
        <>
          <Aviso tono="ambar" icono={AlertTriangle}>
            <span className={AVISO.fuerte}>No se puede borrar: lo están usando.</span> Quítalo
            primero de estos perfiles en Amazon API › Origen, o apágalo si lo que quieres es que
            dejen de leer de él.
          </Aviso>
          <ul className={`${TIPO.s} ${TEXTO.t2} list-disc pl-5`}>
            {buzon.enUsoPor.map((nombre) => (
              <li key={nombre}>{nombre}</li>
            ))}
          </ul>
        </>
      ) : (
        <p className={`${TIPO.s} ${TEXTO.t2}`}>
          Se borra el buzón y su contraseña. No lo usa ningún perfil, así que nadie deja de leer por
          esto. Si solo quieres que no se pueda elegir, apágalo y se queda con su configuración.
        </p>
      )}
    </Dialogo>
  )
}

/* ------------------------------------------------------------------ */
/* La prueba                                                           */
/* ------------------------------------------------------------------ */

function DialogoPrueba({
  buzon,
  resultado,
  onCerrar,
}: {
  buzon: BuzonAdmin
  resultado: Prueba | null
  onCerrar: () => void
}) {
  return (
    <Dialogo
      titulo={`Prueba de «${buzon.nombre}»`}
      entradilla={buzon.direccion}
      onCerrar={onCerrar}
      ancho="max-w-[620px]"
      pie={
        <button type="button" onClick={onCerrar} className={`${BOTON.base} ${BOTON.secundario}`}>
          Cerrar
        </button>
      }
    >
      {resultado === null ? (
        <Cargando texto="Entrando en el buzón y mirando qué hay…" />
      ) : (
        <ResultadoPrueba resultado={resultado} />
      )}
    </Dialogo>
  )
}

/**
 * LO QUE HACE ÚTIL A ESTA PANTALLA: no un «bien», sino qué correos encajan y
 * cuál se cogería.
 *
 * Un «bien» solo dice que la contraseña entra, que es la mitad fácil. El fallo
 * que de verdad cuesta una tarde es un filtro que encaja con el mensaje
 * equivocado —el de la semana pasada, o el de otro cliente— y eso se ve
 * únicamente con la lista delante y la marca en el que se llevaría.
 */
function ResultadoPrueba({ resultado }: { resultado: Prueba }) {
  return (
    <div className="space-y-2">
      <Aviso tono={resultado.ok ? 'verde' : 'rojo'} icono={resultado.ok ? Info : CircleAlert}>
        {resultado.mensaje}
      </Aviso>

      {resultado.candidatos.length === 0 ? (
        <p className={`${TIPO.s} ${TEXTO.t3}`}>
          {resultado.ok
            ? 'Se ha entrado sin problema, pero ahí dentro no hay ningún correo que encaje con lo que buscan los perfiles. Revisa el remitente, el asunto y los días hacia atrás en el perfil que lo use.'
            : 'No se ha llegado a mirar el contenido.'}
        </p>
      ) : (
        <div className={`${RADIO.r2} overflow-hidden border ${LINEA.normal} ${SUPERFICIE.sup}`}>
          {resultado.candidatos.slice(0, 25).map((c, i) => (
            <div
              key={`${c.idExterno ?? c.nombre}-${i}`}
              className={`flex h-7 items-center gap-[7px] border-b border-[var(--ls-linea)] px-[9px] last:border-b-0 ${
                c.elegido ? 'bg-[var(--ls-sel)]' : ''
              }`}
            >
              <span
                className="shrink-0 text-[11px] leading-none"
                style={{ color: c.elegido ? COLOR_ESTADO.verde : COLOR_ESTADO.gris }}
                aria-hidden="true"
              >
                {c.elegido ? '●' : '○'}
              </span>
              <span
                className={`${TIPO.m} ${c.elegido ? TEXTO.t1 : TEXTO.t3} truncate`}
                title={c.nombre}
              >
                {c.nombre}
              </span>
              {c.elegido && (
                <span className={`${TEXTO_ESTADO.verde} shrink-0 text-[11px] font-medium`}>
                  se cogería este
                </span>
              )}
              {c.descarte && (
                <span className={`${TIPO.s} ${TEXTO.t4} truncate`} title={c.descarte}>
                  — {c.descarte}
                </span>
              )}
              <span className={`${TIPO.s} ${TEXTO.t4} ml-auto shrink-0 tabular-nums`}>
                {fechaHora(c.modificadoAt)}
              </span>
            </div>
          ))}
          {resultado.candidatos.length > 25 && (
            <p className={`${TIPO.s} ${TEXTO.t4} px-[9px] py-[5px]`}>
              y {resultado.candidatos.length - 25} más. Afina el filtro del perfil para no depender
              del orden.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */

const RUTA = '/api/stock-sync/buzones'

interface RespuestaBuzones {
  buzones: BuzonAdmin[]
}

/** Lo que contesta «Probar». `candidatos` es lo que vale de esta respuesta */
interface Prueba {
  ok: boolean
  mensaje: string
  candidatos: CandidatoOrigen[]
}

const TRANSPORTES: { valor: TransporteBuzon; etiqueta: string }[] = [
  { valor: 'google', etiqueta: 'Nuestro Workspace (Gmail)' },
  { valor: 'imap', etiqueta: 'Otro proveedor (IMAP)' },
]

/**
 * Lo que el cajetín de contraseña necesita saber. Una sola forma —contraseña— y
 * sin frase de paso: IMAP no admite claves privadas, así que la pantalla no
 * pregunta nada.
 */
const SECRETO_BUZON: SecretoDeclarado = {
  etiqueta: 'Contraseña del buzón',
  ayuda:
    'La del correo, o la contraseña de aplicación si el proveedor la pide. Se guarda cifrada y no vuelve a salir a pantalla nunca.',
  tipos: [{ valor: 'password', etiqueta: 'Contraseña' }],
  admitePassphrase: false,
}

/* ------------------------------------------------------------------ */

export function InfoBuzones() {
  return (
    <>
      <SeccionInfo titulo="Qué se configura aquí">
        <p>
          Los buzones de correo de los que el ERP saca ficheros de stock. Se da de alta{' '}
          <strong>uno una vez</strong> y lo eligen los perfiles que hagan falta, en la pestaña{' '}
          <strong>Origen</strong>.
        </p>
        <p>
          Es <strong>de toda la agencia</strong> y no del cliente que tengas elegido en las demás
          pestañas: es la única pantalla del módulo que no va por cliente.
        </p>
      </SeccionInfo>

      <SeccionInfo titulo="Ya no hay que elegir entre Gmail e IMAP">
        <p>
          Quien configura un perfil elige un buzón, y es el buzón el que sabe por dentro cómo se
          entra. Era justo esa elección la que hacía equivocarse y dejar un cliente sin leer.
        </p>
        <ListaInfo>
          <li>
            <strong>Nuestro Workspace (Gmail)</strong> — direcciones nuestras. Se entra por
            delegación de dominio, sin contraseña y sin servidor que poner.
          </li>
          <li>
            <strong>Otro proveedor (IMAP)</strong> — el correo del cliente o el de un hosting.
            Necesita servidor, puerto y contraseña. En Hostinger, imap.hostinger.com y el 993.
          </li>
        </ListaInfo>
      </SeccionInfo>

      <SeccionInfo titulo="El dueño es lo que separa a un cliente de otro">
        <p>
          Un buzón <strong>de la agencia</strong> lo puede elegir cualquier perfil. Uno{' '}
          <strong>con dueño</strong> solo lo pueden elegir los perfiles de ese cliente, y la base lo
          impide con dos comprobaciones propias aunque alguien lo intente por otro camino.
        </p>
        <p>
          No es burocracia: si el buzón de un cliente queda elegible en el perfil de otro, el fichero
          de stock de uno acaba publicado en la cuenta de Amazon del otro, y eso{' '}
          <strong>no da ningún error</strong> — se publica y ya está.
        </p>
      </SeccionInfo>

      <SeccionInfo titulo="«Probar» enseña los correos, no un «bien»">
        <p>
          Entrar en el buzón es la mitad fácil. Lo que rompe un cliente es un filtro que encaja con
          el correo equivocado, así que la prueba enseña <strong>qué mensajes encajan</strong> y{' '}
          <strong>cuál se cogería</strong>.
        </p>
        <p>
          El resultado de la última prueba se guarda con su <strong>fecha</strong>, y se enseña
          siempre con ella: un «bien» de hace tres semanas, con la contraseña caducada ayer, se lee
          igual que uno de hace diez minutos si no se ve cuándo fue.
        </p>
      </SeccionInfo>

      <SeccionInfo titulo="Apagar y borrar no son lo mismo">
        <p>
          <strong>Apagar</strong> deja el buzón con toda su configuración pero fuera del desplegable:
          los perfiles que lo tuvieran elegido dejan de leer de él. <strong>Borrar</strong> solo se
          puede si no lo usa ningún perfil, y se lleva también su contraseña.
        </p>
      </SeccionInfo>

      <SeccionInfo titulo="Las contraseñas no se enseñan">
        <p>
          Se guardan cifradas y no vuelven a salir a pantalla nunca, ni siquiera para quien las
          metió. Se pueden reemplazar; no se pueden leer.
        </p>
      </SeccionInfo>
    </>
  )
}
