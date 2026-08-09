'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ChevronRight,
  CircleAlert,
  Eye,
  EyeOff,
  Folder,
  FolderOpen,
  KeyRound,
  Loader2,
  Lock,
  Mail,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { deleteAmazon, getAmazon, postAmazon, type PerfilesVista } from '@/lib/amazon/client'
import type {
  ComprobarResponse,
  CredencialResponse,
  ExplorarResponse,
} from '@/lib/stock-sync/origenes/respuestas'
import type {
  CandidatoOrigen,
  EstadoOrigen,
  ListadoOrigen,
} from '@/lib/stock-sync/origenes/tipos'
import type { StockReadProfile } from '@/lib/types/stock-sync'
import {
  AVISO,
  BOTON,
  CAMPO,
  COLOR_ESTADO,
  LINEA,
  RADIO,
  SUPERFICIE,
  TARJETA,
  TEXTO,
  TEXTO_ESTADO,
  TIPO,
  TITULO,
} from '@/lib/estilo/denso'

/**
 * EL EXPLORADOR DE ORÍGENES: la pantalla con la que se da de alta un cliente.
 *
 * Lo que pidió el usuario, literal: «si acordamos que el cliente lo va a dejar
 * en X carpeta en el drive, que en una interfaz podamos ver nuestro drive y
 * seleccionar la carpeta que va a mirar cada x momento. O si nos va a dar acceso
 * a su ftp, una interfaz que nos permita conectarnos, que pongamos el usuario y
 * la contraseña y podamos navegar entre sus diferentes carpetas hasta que
 * encontremos el archivo que queremos leer cada 15 minutos.»
 *
 *
 * ============ LAS DOS COSAS QUE ENSEÑA A LA VEZ, Y POR QUÉ ============
 *
 * 1. QUÉ HAY AHORA en la carpeta.
 * 2. CUÁL SE COGERÍA con el patrón que está escrito ahora mismo.
 *
 * Sin lo segundo, el patrón se configura a ciegas. Y en un SFTP el patrón no es
 * un detalle: el fichero se llama STOCK_2026-08-09.csv y mañana se llama otra
 * cosa, así que «el fichero» no existe — existe «el más reciente que empiece por
 * STOCK_». Un explorador que solo listara nombres dejaría el trabajo a medias y
 * el fallo aparecería mañana, en el ciclo automático, sin nadie delante.
 *
 *
 * ============ ESTA PANTALLA NACE CON LA ESTÉTICA NUEVA ============
 *
 * Todo lo de aquí sale de lib/estilo/denso.ts: filas de 28 px, cuatro niveles de
 * texto, superficies opacas escalonadas. Los veinte módulos que ya existen NO se
 * tocan —cambiarles el espaciado cuesta una semana de trabajo más lento para
 * quien los usa ocho horas al día— pero una pantalla nueva no tiene memoria
 * muscular que romper, así que estrena la densidad. Es la muestra de cómo va a
 * quedar el ERP entero.
 *
 *
 * ============ LA CONTRASEÑA NO ESTÁ AQUÍ ============
 *
 * Este componente NUNCA recibe una credencial del servidor: `estadoCredencial`
 * solo dice si hay una, de qué tipo y de cuándo. El cajetín de contraseña
 * siempre nace vacío, incluso con una guardada, y eso no es un descuido: si
 * pudiera rellenarse con lo guardado, es que lo guardado habría viajado hasta
 * aquí.
 */

type Conector = PerfilesVista['conectores'][number]

export function PanelOrigen({
  perfil,
  conector,
  config,
  driveEmail,
  driveConfigurado,
  onElegirCarpeta,
}: {
  perfil: StockReadProfile
  conector: Conector
  /** Lo que hay EN PANTALLA, que puede no estar guardado todavía */
  config: Record<string, unknown>
  driveEmail: string | null
  driveConfigurado: boolean
  /** Escribe la carpeta elegida en el campo que el conector declare */
  onElegirCarpeta: (clave: string, valor: string) => void
}) {
  /**
   * La contraseña recién tecleada y todavía sin guardar.
   *
   * Vive en el padre y no dentro del panel de credencial porque el explorador la
   * necesita: es lo que permite escribir la contraseña, pulsar «Conectar»,
   * navegar hasta la carpeta y guardarla al final, en vez de tener que guardar a
   * ciegas una contraseña que a lo mejor está mal.
   */
  const [secretoBorrador, setSecretoBorrador] = useState<{
    tipo: 'password' | 'clave_privada'
    valor: string
    passphrase: string
  } | null>(null)

  const identidadDrive = typeof config.identidad === 'string' ? config.identidad : 'servicio'
  const mostrarCorreoDrive =
    conector.id === 'drive' && identidadDrive !== 'propia' && Boolean(driveEmail)

  return (
    <div className="mt-2 space-y-2">
      {/* El dato que hace falta ANTES de que nada funcione. Se enseña aquí y no
          se pide por chat cada vez: es cómo se pierde media tarde. */}
      {mostrarCorreoDrive && (
        <Aviso tono="azul" icono={ShieldCheck}>
          El cliente tiene que compartir su carpeta con este correo, con permiso de{' '}
          <span className={AVISO.fuerte}>Lector</span>:
          <br />
          <code className={`${TEXTO.acento} text-[11px] break-all`}>{driveEmail}</code>
        </Aviso>
      )}

      {conector.id === 'drive' && !driveConfigurado && (
        <Aviso tono="ambar" icono={CircleAlert}>
          El servidor no tiene configurada la cuenta de servicio de Google
          (GOOGLE_SA_CLIENT_EMAIL y GOOGLE_SA_PRIVATE_KEY). Sin ella no se puede abrir ninguna
          carpeta de Drive.
        </Aviso>
      )}

      {conector.secreto && (
        <PanelCredencial
          perfilId={perfil.id}
          declaracion={conector.secreto}
          borrador={secretoBorrador}
          onBorrador={setSecretoBorrador}
        />
      )}

      {conector.explorador && (
        <Explorador
          perfil={perfil}
          conector={conector}
          config={config}
          secreto={secretoBorrador}
          onElegirCarpeta={onElegirCarpeta}
        />
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* La credencial                                                       */
/* ------------------------------------------------------------------ */

/**
 * EL CAJETÍN DE LA CONTRASEÑA.
 *
 * Tres estados y ninguno enseña el valor:
 *   · no hay ninguna guardada          → cajetín vacío
 *   · hay una y no se está cambiando   → «hay una guardada», su huella y cuándo
 *   · se está cambiando                → cajetín vacío otra vez
 *
 * La huella son ocho caracteres del sha256 del valor YA CIFRADO. No lleva a
 * ningún sitio y no se puede deshacer; sirve para una sola cosa, que es poder
 * ver de un vistazo que la credencial ha cambiado después de tocarla.
 */
function PanelCredencial({
  perfilId,
  declaracion,
  borrador,
  onBorrador,
}: {
  perfilId: string
  declaracion: NonNullable<Conector['secreto']>
  borrador: { tipo: 'password' | 'clave_privada'; valor: string; passphrase: string } | null
  onBorrador: (
    v: { tipo: 'password' | 'clave_privada'; valor: string; passphrase: string } | null
  ) => void
}) {
  const [estado, setEstado] = useState<CredencialResponse['credencial'] | null>(null)
  const [editando, setEditando] = useState(false)
  const [verValor, setVerValor] = useState(false)
  const [guardando, setGuardando] = useState(false)

  const tipo = borrador?.tipo ?? declaracion.tipos[0].valor
  const esClave = tipo === 'clave_privada'

  useEffect(() => {
    let vivo = true
    getAmazon<CredencialResponse>(`/api/stock-sync/perfiles/${perfilId}/credencial`).then((res) => {
      // La respuesta de un perfil que ya no se está mirando no se pinta: saltar
      // entre dos clientes deprisa dejaría el estado del primero encima del
      // segundo, y en una pantalla que dice «hay contraseña guardada» eso es
      // mentir sobre un dato importante.
      if (vivo && res.ok) setEstado(res.data.credencial)
    })
    return () => {
      vivo = false
    }
  }, [perfilId])

  // Cambiar de perfil cierra la edición y tira el borrador: arrastrar la
  // contraseña de un cliente al formulario de otro es el peor error posible aquí.
  useEffect(() => {
    setEditando(false)
    setVerValor(false)
    onBorrador(null)
    // onBorrador viene del padre y es estable en la práctica; incluirla en las
    // dependencias volvería a vaciar el borrador en cada render del padre, o
    // sea mientras se escribe la contraseña.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perfilId])

  const hay = estado?.hay ?? false
  const abierto = editando || !hay

  async function guardar() {
    if (!borrador?.valor) {
      toast.error('Escribe la contraseña antes de guardarla')
      return
    }
    setGuardando(true)
    const res = await postAmazon<CredencialResponse>(
      `/api/stock-sync/perfiles/${perfilId}/credencial`,
      { tipo: borrador.tipo, valor: borrador.valor, passphrase: borrador.passphrase || null }
    )
    setGuardando(false)

    if (!res.ok) {
      toast.error(res.error)
      return
    }
    setEstado(res.data.credencial)
    setEditando(false)
    setVerValor(false)
    // El borrador se tira en cuanto está guardado: a partir de aquí el valor
    // vive cifrado en la base y no tiene ninguna razón para seguir en memoria
    // del navegador.
    onBorrador(null)
    toast.success('Credencial guardada y cifrada')
  }

  async function quitar() {
    setGuardando(true)
    const res = await deleteAmazon<CredencialResponse>(
      `/api/stock-sync/perfiles/${perfilId}/credencial`
    )
    setGuardando(false)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    setEstado(res.data.credencial)
    onBorrador(null)
    toast.success('Credencial borrada')
  }

  return (
    <div className={TARJETA.base}>
      <div className={TARJETA.cabecera}>
        <KeyRound className="h-[13px] w-[13px] text-[var(--ls-t4)]" />
        <span className={TITULO.seccion}>{declaracion.etiqueta}</span>
        {hay && !editando && (
          <span className={`${TEXTO_ESTADO.verde} ml-auto text-[11px] font-medium`}>guardada</span>
        )}
      </div>

      <div className={`${TARJETA.cuerpo} space-y-[9px]`}>
        <p className={CAMPO.nota}>{declaracion.ayuda}</p>

        {estado && !estado.cifradoConfigurado && (
          <Aviso tono="rojo" icono={CircleAlert}>
            Falta <span className={AVISO.fuerte}>AMAZON_TOKEN_KEY</span> en el servidor. Es la clave
            con la que se cifran las credenciales; sin ella no se guarda ninguna contraseña, que es
            lo correcto.
          </Aviso>
        )}

        {hay && !editando && (
          <div className="flex flex-wrap items-center gap-2">
            <span className={`${TIPO.s} ${TEXTO.t2} inline-flex items-center gap-[5px]`}>
              <Lock className="h-3 w-3 text-[var(--ls-e-verde)]" />
              Hay {estado?.tipo === 'clave_privada' ? 'una clave privada' : 'una contraseña'}{' '}
              guardada
              {estado?.huella && <span className={TEXTO.t4}> · {estado.huella}</span>}
              {estado?.actualizadaAt && (
                <span className={TEXTO.t4}>
                  {' '}
                  · {new Date(estado.actualizadaAt).toLocaleDateString('es-ES', {
                    day: 'numeric',
                    month: 'short',
                  })}
                </span>
              )}
            </span>
            <button
              type="button"
              className={`${BOTON.base} ${BOTON.secundario}`}
              onClick={() => {
                setEditando(true)
                onBorrador({ tipo: estado?.tipo ?? 'password', valor: '', passphrase: '' })
              }}
            >
              <RefreshCw className="h-3 w-3" />
              Cambiar
            </button>
            <button
              type="button"
              className={`${BOTON.base} ${BOTON.secundario}`}
              onClick={quitar}
              disabled={guardando}
            >
              <Trash2 className="h-3 w-3" />
              Quitar
            </button>
          </div>
        )}

        {abierto && (
          <>
            {declaracion.tipos.length > 1 && (
              <div className="flex flex-wrap gap-[6px]">
                {declaracion.tipos.map((t) => (
                  <button
                    key={t.valor}
                    type="button"
                    aria-pressed={tipo === t.valor}
                    className={`${BOTON.chip} ${tipo === t.valor ? BOTON.chipEncendido : ''}`}
                    onClick={() =>
                      onBorrador({
                        tipo: t.valor,
                        valor: borrador?.valor ?? '',
                        passphrase: borrador?.passphrase ?? '',
                      })
                    }
                  >
                    {t.etiqueta}
                  </button>
                ))}
              </div>
            )}

            <div className={CAMPO.contenedor}>
              <label className={CAMPO.etiqueta}>
                {esClave ? 'Clave privada' : 'Contraseña'}
                <span className={CAMPO.obligatorio}> *</span>
              </label>

              {esClave ? (
                <textarea
                  // Sin `value` guardado del servidor NUNCA: nace vacío siempre.
                  value={borrador?.valor ?? ''}
                  onChange={(e) =>
                    onBorrador({
                      tipo,
                      valor: e.target.value,
                      passphrase: borrador?.passphrase ?? '',
                    })
                  }
                  rows={4}
                  spellCheck={false}
                  autoComplete="off"
                  placeholder={'-----BEGIN OPENSSH PRIVATE KEY-----\n…\n-----END OPENSSH PRIVATE KEY-----'}
                  className={`${CAMPO.input} h-auto py-[5px] font-mono text-[11px] leading-[1.45] resize-y`}
                />
              ) : (
                <div className="flex items-center gap-[6px]">
                  <input
                    type={verValor ? 'text' : 'password'}
                    value={borrador?.valor ?? ''}
                    onChange={(e) =>
                      onBorrador({
                        tipo,
                        valor: e.target.value,
                        passphrase: borrador?.passphrase ?? '',
                      })
                    }
                    spellCheck={false}
                    // Sin autocompletar: el gestor de contraseñas del navegador
                    // ofrecería guardar la del cliente en el perfil de quien
                    // está configurando, que es sacarla del ERP sin querer.
                    autoComplete="new-password"
                    className={CAMPO.input}
                  />
                  <button
                    type="button"
                    className={BOTON.icono}
                    onClick={() => setVerValor((v) => !v)}
                    title={verValor ? 'Ocultar' : 'Ver lo que he escrito'}
                  >
                    {verValor ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
              )}
            </div>

            {esClave && declaracion.admitePassphrase && (
              <div className={CAMPO.contenedor}>
                <label className={CAMPO.etiqueta}>Frase de paso de la clave</label>
                <input
                  type="password"
                  value={borrador?.passphrase ?? ''}
                  onChange={(e) =>
                    onBorrador({ tipo, valor: borrador?.valor ?? '', passphrase: e.target.value })
                  }
                  autoComplete="new-password"
                  className={CAMPO.input}
                />
                <p className={CAMPO.nota}>
                  Solo si la clave la pide. Se guarda cifrada igual: una clave protegida por una
                  frase guardada al lado en claro es una clave sin proteger.
                </p>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className={`${BOTON.base} ${BOTON.primario}`}
                onClick={guardar}
                disabled={guardando || !borrador?.valor}
              >
                {guardando ? <Loader2 className="h-3 w-3 animate-spin" /> : <Lock className="h-3 w-3" />}
                Guardar cifrada
              </button>
              {hay && (
                <button
                  type="button"
                  className={`${BOTON.base} ${BOTON.secundario}`}
                  onClick={() => {
                    setEditando(false)
                    setVerValor(false)
                    onBorrador(null)
                  }}
                >
                  Cancelar
                </button>
              )}
              <span className={`${TIPO.s} ${TEXTO.t3}`}>
                También puedes escribirla y pulsar «Conectar» aquí abajo para probarla sin guardarla
                todavía.
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* El explorador                                                       */
/* ------------------------------------------------------------------ */

function Explorador({
  perfil,
  conector,
  config,
  secreto,
  onElegirCarpeta,
}: {
  perfil: StockReadProfile
  conector: Conector
  config: Record<string, unknown>
  secreto: { tipo: 'password' | 'clave_privada'; valor: string; passphrase: string } | null
  onElegirCarpeta: (clave: string, valor: string) => void
}) {
  const [listado, setListado] = useState<ListadoOrigen | null>(null)
  const [estado, setEstado] = useState<EstadoOrigen | null>(null)
  const [cargando, setCargando] = useState<'nada' | 'explorar' | 'comprobar'>('nada')
  const [error, setError] = useState<string | null>(null)

  const porMensajes = conector.explorador === 'mensajes'
  const campoRuta = conector.campoRuta
  const rutaGuardada = campoRuta && typeof config[campoRuta] === 'string' ? String(config[campoRuta]) : ''

  /**
   * Se manda lo que hay EN LOS CAMPOS, no lo que hay en la base.
   *
   * Es lo que permite pegar el servidor, escribir el usuario y pulsar
   * «Conectar» sin haber guardado nada. El motivo largo está en la cabecera de
   * la ruta: con campos no controlados, el mousedown del botón dispara el
   * onBlur del input y el click dispara la petición, que llegaría antes de que
   * el PATCH hubiera escrito.
   */
  const cuerpo = useMemo(
    () => ({
      config,
      ...(secreto?.valor
        ? {
            secreto: {
              tipo: secreto.tipo,
              valor: secreto.valor,
              passphrase: secreto.passphrase || null,
            },
          }
        : {}),
    }),
    [config, secreto]
  )

  const explorar = useCallback(
    async (ruta: string) => {
      setCargando('explorar')
      setError(null)
      setEstado(null)

      const res = await postAmazon<ExplorarResponse>(
        `/api/stock-sync/perfiles/${perfil.id}/explorar`,
        { ...cuerpo, accion: 'explorar', ruta }
      )
      setCargando('nada')

      if (!res.ok) {
        setError(res.error)
        return
      }
      setListado(res.data.listado)
    },
    [cuerpo, perfil.id]
  )

  async function comprobar() {
    setCargando('comprobar')
    setError(null)

    const res = await postAmazon<ComprobarResponse>(
      `/api/stock-sync/perfiles/${perfil.id}/explorar`,
      { ...cuerpo, accion: 'comprobar' }
    )
    setCargando('nada')

    if (!res.ok) {
      setError(res.error)
      return
    }
    setEstado(res.data.estado)
  }

  // Al cambiar de perfil se cierra todo. Dejar en pantalla las carpetas del
  // cliente anterior mientras se configura el siguiente es cómo se elige la
  // carpeta equivocada.
  useEffect(() => {
    setListado(null)
    setEstado(null)
    setError(null)
  }, [perfil.id])

  const elegida = campoRuta && listado?.ruta === rutaGuardada && rutaGuardada !== ''

  return (
    <div className={TARJETA.base}>
      <div className={TARJETA.cabecera}>
        {porMensajes ? (
          <Mail className="h-[13px] w-[13px] text-[var(--ls-t4)]" />
        ) : (
          <FolderOpen className="h-[13px] w-[13px] text-[var(--ls-t4)]" />
        )}
        <span className={TITULO.seccion}>
          {porMensajes ? 'Qué correos encajan' : 'Buscar la carpeta'}
        </span>
      </div>

      <div className={`${TARJETA.cuerpo} space-y-[9px]`}>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={`${BOTON.base} ${BOTON.alto} ${BOTON.primario}`}
            onClick={() => explorar(porMensajes ? '' : rutaGuardada)}
            disabled={cargando !== 'nada'}
          >
            {cargando === 'explorar' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : porMensajes ? (
              <Mail className="h-3.5 w-3.5" />
            ) : (
              <FolderOpen className="h-3.5 w-3.5" />
            )}
            {porMensajes ? 'Ver los correos' : listado ? 'Volver a mirar' : 'Conectar y ver carpetas'}
          </button>

          <button
            type="button"
            className={`${BOTON.base} ${BOTON.alto} ${BOTON.secundario}`}
            onClick={comprobar}
            disabled={cargando !== 'nada'}
          >
            {cargando === 'comprobar' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ShieldCheck className="h-3.5 w-3.5" />
            )}
            Comprobar lo configurado
          </button>
        </div>

        {error && (
          <Aviso tono="rojo" icono={CircleAlert}>
            {error}
          </Aviso>
        )}

        {estado && (
          <>
            <Aviso tono={estado.ok ? 'verde' : 'ambar'} icono={estado.ok ? ShieldCheck : CircleAlert}>
              {estado.mensaje}
            </Aviso>
            {estado.candidatos.length > 0 && <ListaFicheros ficheros={estado.candidatos} />}
          </>
        )}

        {listado && (
          <>
            {listado.aviso && (
              <Aviso tono="ambar" icono={CircleAlert}>
                {listado.aviso}
              </Aviso>
            )}

            {!porMensajes && <Migas migas={listado.migas} onIr={explorar} />}

            {!porMensajes && (
              <div className={`${RADIO.r2} border ${LINEA.normal} ${SUPERFICIE.sup} overflow-hidden`}>
                {listado.carpetas.length === 0 ? (
                  <p className={`${TIPO.s} ${TEXTO.t4} px-[9px] py-[7px]`}>
                    Aquí dentro no hay más carpetas.
                  </p>
                ) : (
                  listado.carpetas.map((c) => (
                    <button
                      key={c.ruta}
                      type="button"
                      onClick={() => explorar(c.ruta)}
                      className={
                        'flex h-7 w-full items-center gap-[7px] px-[9px] text-left ' +
                        'border-b border-[var(--ls-linea)] last:border-b-0 ' +
                        'hover:bg-[var(--ls-sup3)]'
                      }
                    >
                      <Folder className="h-[13px] w-[13px] shrink-0 text-[var(--ls-t4)]" />
                      <span className={`${TIPO.m} ${TEXTO.t2} truncate`}>{c.nombre}</span>
                      {c.detalle && <span className={`${TIPO.s} ${TEXTO.t4}`}>{c.detalle}</span>}
                      <ChevronRight className="ml-auto h-3 w-3 shrink-0 text-[var(--ls-t4)]" />
                    </button>
                  ))
                )}
              </div>
            )}

            <div className="space-y-[5px]">
              <p className={TITULO.rotulo}>
                {porMensajes
                  ? 'Correos que encajan, y cuál se cogería'
                  : 'Ficheros de esta carpeta, y cuál se cogería'}
              </p>
              <ListaFicheros ficheros={listado.ficheros} />
            </div>

            {!porMensajes && campoRuta && listado.seleccionable && (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className={`${BOTON.base} ${BOTON.alto} ${elegida ? BOTON.secundario : BOTON.primario}`}
                  onClick={() => {
                    onElegirCarpeta(campoRuta, listado.ruta)
                    toast.success('Carpeta elegida')
                  }}
                  disabled={Boolean(elegida)}
                >
                  <Folder className="h-3.5 w-3.5" />
                  {elegida ? 'Es la carpeta de este perfil' : 'Usar esta carpeta'}
                </button>
                <span className={`${TIPO.s} ${TEXTO.t3} min-w-0 break-all`}>{listado.ruta}</span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Piezas                                                              */
/* ------------------------------------------------------------------ */

function Migas({
  migas,
  onIr,
}: {
  migas: { nombre: string; ruta: string }[]
  onIr: (ruta: string) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-[3px]">
      {migas.map((m, i) => (
        <span key={`${m.ruta}-${i}`} className="flex items-center gap-[3px]">
          {i > 0 && <ChevronRight className="h-3 w-3 shrink-0 text-[var(--ls-t4)]" />}
          <button
            type="button"
            onClick={() => onIr(m.ruta)}
            className={
              i === migas.length - 1
                ? `${TIPO.s} ${TEXTO.t1} font-medium`
                : `${TIPO.s} ${TEXTO.t3} hover:text-[var(--ls-t1)] underline decoration-transparent hover:decoration-inherit`
            }
          >
            {m.nombre}
          </button>
        </span>
      ))}
    </div>
  )
}

/**
 * LOS FICHEROS, CON EL ELEGIDO MARCADO Y EL MOTIVO DE CADA DESCARTE.
 *
 * El motivo del descarte es la mitad del valor de esta lista: «no encaja
 * ninguno» sin decir por qué obliga a adivinar entre el patrón y la extensión, y
 * son las dos cosas que se acaban de escribir arriba.
 *
 * El estado va por GLIFO (● / ○) y por PALABRA, no solo por color: tapando el
 * color con la mano la lista se sigue leyendo.
 */
function ListaFicheros({ ficheros }: { ficheros: CandidatoOrigen[] }) {
  if (ficheros.length === 0) {
    return (
      <p className={`${TIPO.s} ${TEXTO.t4} px-[9px] py-[7px] ${RADIO.r2} border ${LINEA.normal}`}>
        No hay ningún fichero aquí.
      </p>
    )
  }

  return (
    <div className={`${RADIO.r2} border ${LINEA.normal} ${SUPERFICIE.sup} overflow-hidden`}>
      {ficheros.slice(0, 25).map((f, i) => (
        <div
          key={`${f.idExterno ?? f.nombre}-${i}`}
          className={
            'flex h-7 items-center gap-[7px] px-[9px] border-b border-[var(--ls-linea)] last:border-b-0 ' +
            (f.elegido ? 'bg-[var(--ls-sel)]' : '')
          }
        >
          <span
            className="shrink-0 text-[11px] leading-none"
            style={{ color: f.elegido ? COLOR_ESTADO.verde : COLOR_ESTADO.gris }}
            title={f.elegido ? 'Este es el que se procesaría' : 'Descartado'}
          >
            {f.elegido ? '●' : '○'}
          </span>
          <span
            className={`${TIPO.m} ${f.elegido ? TEXTO.t1 : TEXTO.t3} truncate`}
            title={f.nombre}
          >
            {f.nombre}
          </span>
          {f.elegido && (
            <span className={`${TEXTO_ESTADO.verde} shrink-0 text-[11px] font-medium`}>
              se cogería este
            </span>
          )}
          {/* Por qué este y no el otro, cuando la elección no era evidente: hoy
              solo el empate de fecha del SFTP. Sin la frase, una elección
              correcta y una arbitraria se ven exactamente igual. */}
          {f.nota && (
            <span
              className={`${TIPO.s} shrink-0`}
              style={{ color: COLOR_ESTADO.ambar }}
              title={f.nota}
            >
              · desempatado por nombre
            </span>
          )}
          {f.descarte && (
            <span className={`${TIPO.s} ${TEXTO.t4} truncate`} title={f.descarte}>
              — {f.descarte}
            </span>
          )}
          <span className={`${TIPO.s} ${TEXTO.t4} ml-auto shrink-0 tabular-nums`}>
            {fecha(f.modificadoAt)}
            {f.tamano !== null && f.tamano !== undefined ? ` · ${peso(f.tamano)}` : ''}
          </span>
        </div>
      ))}
      {ficheros.length > 25 && (
        <p className={`${TIPO.s} ${TEXTO.t4} px-[9px] py-[5px]`}>
          y {ficheros.length - 25} más. Afina el patrón para no depender del orden.
        </p>
      )}
    </div>
  )
}

function Aviso({
  tono,
  icono: Icono,
  children,
}: {
  tono: 'verde' | 'ambar' | 'rojo' | 'azul'
  icono: typeof CircleAlert
  children: React.ReactNode
}) {
  return (
    <div
      className={`${AVISO.base} ${AVISO.conTono} whitespace-pre-line`}
      style={{ borderLeftColor: COLOR_ESTADO[tono] }}
    >
      <Icono className={AVISO.icono} style={{ color: COLOR_ESTADO[tono] }} />
      <div className="min-w-0">{children}</div>
    </div>
  )
}

/* ------------------------------------------------------------------ */

function fecha(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('es-ES', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Bytes en algo que se pueda leer de un vistazo */
function peso(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toLocaleString('es-ES', { maximumFractionDigits: 1 })} MB`
}
