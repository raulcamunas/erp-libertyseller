'use client'

import { useMemo, useState } from 'react'
import {
  Activity,
  Boxes,
  CalendarClock,
  CheckCircle2,
  Download,
  Euro,
  FileWarning,
  Layers,
  LayoutGrid,
  ListChecks,
  Megaphone,
  MousePointerClick,
  Package,
  PackageCheck,
  Palette,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldAlert,
  ShoppingCart,
  Sparkles,
  Table2,
  Target,
  Trash2,
  Truck,
  Users,
} from 'lucide-react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { toast } from 'sonner'
import {
  ACENTO,
  Avatar,
  BarraCambiosSinGuardar,
  BarraDeProgreso,
  Boton,
  CabeceraDeModulo,
  Confirmacion,
  EsqueletoTarjeta,
  EsqueletoTexto,
  EstadoVacio,
  FilaDeKpis,
  GrupoDeAvatares,
  Insignia,
  InsigniaDeEstado,
  Kpi,
  LineaDeTiempo,
  PanelDePestana,
  PanelLateral,
  Pestanas,
  Segmentado,
  TablaAdaptable,
  Tarjeta,
  TONO_DE_ESTADO,
  VIZ,
  formatoEntero,
  formatoEuros,
  formatoPorcentaje,
  type Columna,
  type Hito,
  type Modulo,
} from '@/components/ui-ls'
import { COLOR_ESTADO, type TonoEstado } from '@/lib/estilo/denso'

/** El muestrario del kit (app/dashboard/kit). Todo con datos de mentira y sin tocar la base. */

type Seccion = 'resumen' | 'tabla' | 'historial' | 'acciones' | 'paleta'

const MODULOS: { id: Modulo; texto: string; icono: typeof Megaphone }[] = [
  { id: 'marketing', texto: 'Marketing', icono: Megaphone },
  { id: 'seo', texto: 'SEO', icono: Search },
  { id: 'cumplimiento', texto: 'Cumplimiento', icono: ShieldAlert },
  { id: 'remesas', texto: 'Remesas', icono: Truck },
  { id: 'personas', texto: 'Personas', icono: Users },
  { id: 'cuentas', texto: 'Cuentas', icono: Layers },
]

/** Una serie de mentira pero con forma de verdad (tendencia + ruido), estable entre renders */
function serie(semilla: number, n: number, base: number, tendencia: number): number[] {
  let x = semilla
  const azar = () => {
    x = (x * 9301 + 49297) % 233280
    return x / 233280
  }
  return Array.from({ length: n }, (_, i) => Math.max(0, base + tendencia * i + (azar() - 0.5) * base * 0.35))
}

interface Envio {
  id: string
  nombre: string
  cliente: string
  estado: keyof typeof TONO_DE_ESTADO
  unidades: number
  cajas: number
  valor: number
  fecha: Date
  responsable: string
}

const CLIENTES = ['Shoplamp', 'Entrais', 'ShoesF', 'Portico', 'Opinas', 'Cobo']
const PERSONAS = ['Ana Martín', 'Jhanna Pérez', 'Daniela Ruiz', 'Alejandro Gil', 'Raúl Camuñas']
const ESTADOS: (keyof typeof TONO_DE_ESTADO)[] = ['borrador', 'pendiente', 'en_curso', 'en_revision', 'hecho', 'bloqueado']

function enviosDeMentira(): Envio[] {
  const ahora = Date.parse('2026-11-14T10:00:00Z')
  return Array.from({ length: 64 }, (_, i) => {
    const uds = ((i * 137) % 900) + 40
    return {
      id: `env-${i + 1}`,
      nombre: `FBA${(15_000 + i * 37).toString(36).toUpperCase()}`,
      cliente: CLIENTES[i % CLIENTES.length],
      estado: ESTADOS[(i * 7) % ESTADOS.length],
      unidades: uds,
      cajas: Math.ceil(uds / 40),
      valor: uds * (8 + ((i * 3) % 17)),
      fecha: new Date(ahora - i * 31 * 3_600_000),
      responsable: PERSONAS[i % PERSONAS.length],
    }
  })
}

export function Muestrario() {
  const [modulo, setModulo] = useState<Modulo>('marketing')
  const [seccion, setSeccion] = useState<Seccion>('resumen')
  const [periodo, setPeriodo] = useState<7 | 14 | 30>(30)
  const [cargando, setCargando] = useState(false)
  const [abierto, setAbierto] = useState<Envio | null>(null)
  const [confirmar, setConfirmar] = useState(false)
  const [nombre, setNombre] = useState('Shoplamp')
  const [guardado, setGuardado] = useState('Shoplamp')
  const [guardando, setGuardando] = useState(false)
  const [vacia, setVacia] = useState(false)

  const icono = MODULOS.find((m) => m.id === modulo)?.icono ?? Megaphone
  const envios = useMemo(enviosDeMentira, [])
  const ventas = useMemo(() => serie(7, periodo, 1400, 22), [periodo])
  const gasto = useMemo(() => serie(11, periodo, 380, 3), [periodo])
  const pedidos = useMemo(() => serie(5, periodo, 46, 0.6), [periodo])
  const acos = useMemo(() => ventas.map((v, i) => gasto[i] / Math.max(1, v)), [ventas, gasto])
  const suma = (a: number[]) => a.reduce((s, v) => s + v, 0)
  const grafico = useMemo(
    () =>
      ventas.map((v, i) => ({
        dia: new Date(Date.parse('2026-11-14') - (ventas.length - 1 - i) * 86_400_000).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }),
        ventas: Math.round(v),
        gasto: Math.round(gasto[i]),
      })),
    [ventas, gasto],
  )

  const recargar = () => {
    setCargando(true)
    setTimeout(() => setCargando(false), 1400)
  }

  const columnas: Columna<Envio>[] = [
    { id: 'nombre', cabecera: 'Envío', celda: (e) => <span className="font-mono text-[12.5px]">{e.nombre}</span>, ordenar: (e) => e.nombre, movil: 'titulo', ancho: '140px' },
    { id: 'cliente', cabecera: 'Cliente', celda: (e) => e.cliente, ordenar: (e) => e.cliente, movil: 'subtitulo' },
    { id: 'estado', cabecera: 'Estado', celda: (e) => <InsigniaDeEstado estado={e.estado} tamano="sm" />, ordenar: (e) => e.estado, movil: 'insignia' },
    { id: 'unidades', cabecera: 'Unidades', celda: (e) => formatoEntero(e.unidades), ordenar: (e) => e.unidades, alinear: 'derecha' },
    { id: 'cajas', cabecera: 'Cajas', celda: (e) => e.cajas, ordenar: (e) => e.cajas, alinear: 'derecha', movil: 'oculto' },
    { id: 'valor', cabecera: 'Valor', celda: (e) => formatoEuros(e.valor), ordenar: (e) => e.valor, alinear: 'derecha' },
    {
      id: 'responsable',
      cabecera: 'Responsable',
      celda: (e) => (
        <span className="inline-flex items-center gap-2">
          <Avatar nombre={e.responsable} tamano={22} />
          <span className="truncate">{e.responsable.split(' ')[0]}</span>
        </span>
      ),
      ordenar: (e) => e.responsable,
    },
    { id: 'fecha', cabecera: 'Fecha', celda: (e) => e.fecha.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }), ordenar: (e) => e.fecha, alinear: 'derecha', movil: 'oculto' },
  ]

  const historial: Hito[] = [
    { id: 'h1', titulo: 'Envío recibido en Amazon', cuando: Date.now() - 12 * 60_000, tono: 'verde', icono: PackageCheck, autor: 'Amazon · BCN2' },
    { id: 'h2', titulo: 'Etiquetas impresas', descripcion: '12 cajas · 480 unidades · FNSKU pedidos a Amazon al imprimir', cuando: Date.now() - 5 * 3_600_000, tono: 'azul', icono: Package, autor: 'Ana Martín' },
    { id: 'h3', titulo: 'Cambio de plazo', descripcion: 'Del 18 al 21 de noviembre: el transportista no recoge el lunes.', cuando: Date.now() - 27 * 3_600_000, tono: 'ambar', icono: CalendarClock, autor: 'Jhanna Pérez' },
    { id: 'h4', titulo: 'Bloqueado por falta de stock', cuando: Date.now() - 3 * 86_400_000, tono: 'rojo', icono: FileWarning, autor: 'Sistema' },
    { id: 'h5', titulo: 'Borrador creado', cuando: Date.now() - 6 * 86_400_000, tono: 'gris', autor: 'Raúl Camuñas' },
  ]

  return (
    <div className="mx-auto w-full max-w-[1280px]">
      <CabeceraDeModulo
        icono={icono}
        acento={modulo}
        titulo="Kit visual"
        junto={<Insignia tono="violeta" tamano="sm" icono={Sparkles}>Muestrario</Insignia>}
        subtitulo="Todas las piezas de components/ui-ls con datos de mentira. Cambia el módulo para ver su acento."
        migas={[{ texto: 'Inicio', href: '/dashboard' }, { texto: 'Sistema' }, { texto: 'Kit visual' }]}
        acciones={
          <>
            <Segmentado etiqueta="Periodo" tamano="sm" opciones={[{ id: 7, texto: '7 d' }, { id: 14, texto: '14 d' }, { id: 30, texto: '30 d' }]} valor={periodo} onCambio={setPeriodo} />
            <Boton variante="secundario" icono={RefreshCw} onClick={recargar} cargando={cargando}>
              Recargar
            </Boton>
            <Boton variante="primario" icono={Plus} onClick={() => toast.success('Esto en un módulo crearía algo')}>
              Nuevo
            </Boton>
          </>
        }
        debajo={
          <Pestanas
            etiqueta="Secciones del muestrario"
            acento={modulo}
            idPanel="kit-panel"
            valor={seccion}
            onCambio={setSeccion}
            opciones={[
              { id: 'resumen', texto: 'Resumen', icono: LayoutGrid },
              { id: 'tabla', texto: 'Tabla', icono: Table2, cuenta: envios.length },
              { id: 'historial', texto: 'Historial', icono: Activity },
              { id: 'acciones', texto: 'Acciones', icono: MousePointerClick },
              { id: 'paleta', texto: 'Paleta', icono: Palette },
            ]}
          />
        }
      />

      {/* Selector de módulo: cambia el acento de todo el muestrario */}
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <span className="text-[12.5px] text-[var(--ls-t4)]">Acento del módulo</span>
        <Segmentado etiqueta="Módulo" valor={modulo} onCambio={setModulo} opciones={MODULOS.map((m) => ({ id: m.id, texto: m.texto, icono: m.icono }))} />
      </div>

      <PanelDePestana id="kit-panel" key={seccion}>
        {seccion === 'resumen' && (
          <div className="flex flex-col gap-5">
            <FilaDeKpis>
              <Kpi indice={0} etiqueta="Ventas" icono={Euro} acento={modulo} valor={suma(ventas)} formato={(n) => formatoEuros(n)} anterior={suma(ventas) * 0.88} mejor="sube" serie={ventas} nota={`vs ${periodo} días anteriores`} cargando={cargando} />
              <Kpi indice={1} etiqueta="Gasto en anuncios" icono={Target} acento={modulo} valor={suma(gasto)} formato={(n) => formatoEuros(n)} anterior={suma(gasto) * 0.95} mejor="neutro" serie={gasto} cargando={cargando} />
              <Kpi indice={2} etiqueta="ACoS" icono={Activity} acento={modulo} valor={suma(gasto) / suma(ventas)} formato={(n) => formatoPorcentaje(n)} anterior={(suma(gasto) / suma(ventas)) * 1.12} mejor="baja" serie={acos} cargando={cargando} />
              <Kpi indice={3} etiqueta="Pedidos" icono={ShoppingCart} acento={modulo} valor={suma(pedidos)} anterior={suma(pedidos) * 1.04} mejor="sube" serie={pedidos} cargando={cargando} />
            </FilaDeKpis>

            <div className="grid gap-4 lg:grid-cols-3">
              <Tarjeta
                className="lg:col-span-2"
                indice={4}
                titulo="Ventas y gasto"
                subtitulo={`Últimos ${periodo} días · colores --viz-1 y --viz-2`}
                icono={Activity}
                acento={modulo}
                acciones={<Boton variante="fantasma" tamano="sm" soloIcono icono={Download} aria-label="Descargar CSV" onClick={() => toast('Descargaría el CSV')} />}
              >
                {cargando ? (
                  <EsqueletoTexto lineas={6} />
                ) : (
                  <div className="h-[240px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={grafico} margin={{ top: 8, right: 4, bottom: 0, left: -12 }}>
                        <defs>
                          {[VIZ[0], VIZ[1]].map((c, i) => (
                            <linearGradient key={i} id={`kit-g${i}`} x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor={c} stopOpacity={0.35} />
                              <stop offset="100%" stopColor={c} stopOpacity={0} />
                            </linearGradient>
                          ))}
                        </defs>
                        <CartesianGrid vertical={false} stroke="var(--ls-linea)" strokeDasharray="3 4" />
                        <XAxis dataKey="dia" tick={{ fill: 'var(--ls-t4)', fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={24} />
                        <YAxis tick={{ fill: 'var(--ls-t4)', fontSize: 11 }} tickLine={false} axisLine={false} width={48} />
                        <Tooltip
                          contentStyle={{ background: 'var(--ls-sup2)', border: '1px solid var(--ls-linea2)', borderRadius: 10, boxShadow: 'var(--ls-sombra-2)', fontSize: 12 }}
                          labelStyle={{ color: 'var(--ls-t3)' }}
                          itemStyle={{ color: 'var(--ls-t1)' }}
                          cursor={{ stroke: 'var(--ls-linea2)' }}
                        />
                        <Area type="monotone" dataKey="ventas" name="Ventas" stroke={VIZ[0]} strokeWidth={2} fill="url(#kit-g0)" />
                        <Area type="monotone" dataKey="gasto" name="Gasto" stroke={VIZ[1]} strokeWidth={2} fill="url(#kit-g1)" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </Tarjeta>

              <Tarjeta indice={5} variante="destacada" acento={modulo} titulo="Ciclo de la semana" subtitulo="Semana 3 de 4" icono={ListChecks} pie={<span>Lo siguiente: informe al cliente el jueves</span>}>
                <div className="flex flex-col gap-4">
                  <BarraDeProgreso valor={3} maximo={4} etiqueta="Pasos hechos" detalle="3 / 4" acento={modulo} />
                  <BarraDeProgreso valor={0.62} etiqueta="Presupuesto del mes" mostrarPorcentaje umbrales={{ ambar: 0.75, rojo: 0.92 }} />
                  <BarraDeProgreso valor={0.81} etiqueta="Capacidad del almacén" mostrarPorcentaje umbrales={{ ambar: 0.75, rojo: 0.92 }} />
                  <BarraDeProgreso valor={0.95} etiqueta="Fichas revisadas" mostrarPorcentaje umbrales={{ ambar: 0.75, rojo: 0.92 }} tamano="sm" />
                  <div className="flex items-center justify-between border-t border-[var(--ls-linea)] pt-3">
                    <span className="text-[12.5px] text-[var(--ls-t3)]">Equipo</span>
                    <GrupoDeAvatares nombres={PERSONAS} max={4} />
                  </div>
                </div>
              </Tarjeta>
            </div>

            <div>
              <h2 className="mb-3 text-[13px] font-semibold text-[var(--ls-t2)]">Tarjetas interactivas (pasa el ratón)</h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {cargando
                  ? Array.from({ length: 3 }, (_, i) => <EsqueletoTarjeta key={i} />)
                  : CLIENTES.slice(0, 3).map((c, i) => (
                      <Tarjeta key={c} indice={6 + i} variante="interactiva" acento={modulo} onClick={() => toast(`Abriría la cuenta de ${c}`)} aria-label={`Abrir ${c}`}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-center gap-3">
                            <Avatar nombre={c} tamano={38} />
                            <div>
                              <div className="text-[14px] font-semibold text-[var(--ls-t1)]">{c}</div>
                              <div className="text-[12px] text-[var(--ls-t4)]">{PERSONAS[i]}</div>
                            </div>
                          </div>
                          <InsigniaDeEstado estado={ESTADOS[i + 1]} tamano="sm" />
                        </div>
                        <div className="mt-4 grid grid-cols-3 gap-2 text-[12px]">
                          {[
                            ['Gasto', formatoEuros(1200 + i * 340)],
                            ['ACoS', formatoPorcentaje(0.18 + i * 0.04)],
                            ['Fichas', String(12 + i * 5)],
                          ].map(([k, v]) => (
                            <div key={k} className="rounded-[10px] bg-[var(--ls-sup2)] px-[10px] py-2">
                              <div className="text-[var(--ls-t4)]">{k}</div>
                              <div className="mt-[2px] font-semibold tabular-nums text-[var(--ls-t1)]">{v}</div>
                            </div>
                          ))}
                        </div>
                      </Tarjeta>
                    ))}
              </div>
            </div>
          </div>
        )}

        {seccion === 'tabla' && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <Segmentado etiqueta="Datos de la tabla" tamano="sm" valor={vacia ? 'vacia' : 'llena'} onCambio={(v) => setVacia(v === 'vacia')} opciones={[{ id: 'llena', texto: 'Con filas' }, { id: 'vacia', texto: 'Vacía' }]} />
              <span className="text-[12.5px] text-[var(--ls-t4)]">Pulsa una fila para abrir el panel lateral (en el móvil, hoja inferior). Cambia el ancho de la ventana: por debajo de 1024 px son tarjetas.</span>
            </div>
            <TablaAdaptable
              etiqueta="Envíos de prueba"
              columnas={columnas}
              filas={vacia ? [] : envios}
              claveDe={(e) => e.id}
              alPulsarFila={setAbierto}
              filaActiva={abierto?.id ?? null}
              ordenInicial={{ id: 'fecha', sentido: 'desc' }}
              porPagina={12}
              cargando={cargando}
              acciones={(e) => <Boton variante="fantasma" tamano="sm" soloIcono icono={Trash2} aria-label={`Borrar ${e.nombre}`} onClick={() => setConfirmar(true)} />}
              vacio={{ icono: Boxes, titulo: 'Aún no hay envíos', descripcion: 'Cuando prepares el primero aparecerá aquí con su estado.', acento: modulo, accion: { texto: 'Nuevo envío', icono: Plus, onClick: () => setVacia(false) } }}
            />
          </div>
        )}

        {seccion === 'historial' && (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
            <Tarjeta titulo="Historial del envío" subtitulo="LineaDeTiempo" icono={Activity} acento={modulo}>
              <LineaDeTiempo eventos={historial} />
            </Tarjeta>
            <div className="flex flex-col gap-4">
              <Tarjeta titulo="Avatares" subtitulo="Color estable por nombre" icono={Users} acento={modulo}>
                <div className="flex flex-col gap-3">
                  {PERSONAS.map((p, i) => (
                    <div key={p} className="flex items-center gap-3">
                      <Avatar nombre={p} tamano={34} estado={i % 2 ? undefined : 'verde'} />
                      <div className="min-w-0">
                        <div className="truncate text-[13px] font-medium text-[var(--ls-t1)]">{p}</div>
                        <div className="text-[12px] text-[var(--ls-t4)]">{i % 2 ? 'Desconectada' : 'Conectada'}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </Tarjeta>
              <Tarjeta sinRelleno>
                <EstadoVacio compacto icono={CheckCircle2} acento="cuentas" titulo="Nada pendiente" descripcion="Todo lo de hoy está hecho." />
              </Tarjeta>
            </div>
          </div>
        )}

        {seccion === 'acciones' && (
          <div className="grid gap-4 lg:grid-cols-2">
            <Tarjeta titulo="Botones" subtitulo="Cuatro variantes, 44 px con el dedo" icono={MousePointerClick} acento={modulo}>
              <div className="flex flex-wrap gap-2">
                <Boton variante="primario" icono={Plus}>Primario</Boton>
                <Boton variante="secundario" icono={Download}>Secundario</Boton>
                <Boton variante="fantasma" icono={Settings2}>Fantasma</Boton>
                <Boton variante="peligro" icono={Trash2} onClick={() => setConfirmar(true)}>Peligro</Boton>
                <Boton variante="secundario" cargando>Cargando</Boton>
                <Boton variante="secundario" disabled>Desactivado</Boton>
              </div>
            </Tarjeta>

            <Tarjeta titulo="Cambios sin guardar" subtitulo="Escribe algo: sube la barra de abajo (Ctrl/Cmd + S guarda)" icono={Settings2} acento={modulo}>
              <label className="text-[12.5px] text-[var(--ls-t3)]" htmlFor="kit-nombre">
                Nombre de la cuenta
              </label>
              <input
                id="kit-nombre"
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                className="mt-2 h-10 w-full rounded-[10px] border border-[var(--ls-linea2)] bg-[var(--ls-sup2)] px-3 text-[13.5px] text-[var(--ls-t1)] outline-none transition-colors focus-visible:border-[var(--ls-acc-graf)] [@media(pointer:coarse)]:min-h-[44px]"
              />
            </Tarjeta>

            <Tarjeta titulo="Confirmación irreversible" subtitulo="Hay que escribir la palabra" icono={Trash2} acento="cumplimiento">
              <p className="mb-4 text-[13px] text-[var(--ls-t3)]">Para borrar, enviar a un cliente o lanzar algo que no se deshace.</p>
              <Boton variante="peligro" icono={Trash2} onClick={() => setConfirmar(true)}>
                Borrar envío de prueba
              </Boton>
            </Tarjeta>

            <Tarjeta sinRelleno titulo="Estado vacío" subtitulo="Siempre con una acción" icono={Boxes} acento={modulo}>
              <EstadoVacio icono={Package} acento={modulo} titulo="Aún no hay remesas" descripcion="Crea la primera y verás aquí su plazo, sus cajas y lo que ha recibido Amazon." accion={{ texto: 'Nueva remesa', icono: Plus, onClick: () => toast('Abriría el editor') }} accionSecundaria={{ texto: 'Importar', onClick: () => toast('Importaría un Excel') }} />
            </Tarjeta>
          </div>
        )}

        {seccion === 'paleta' && (
          <div className="flex flex-col gap-4">
            <Tarjeta titulo="Acentos por módulo" subtitulo="--ls-mod-*: icono, filo y gráficos; nunca texto largo" icono={Palette} acento={modulo}>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                {MODULOS.map((m) => (
                  <div key={m.id} className="overflow-hidden rounded-[12px] border border-[var(--ls-linea)]">
                    <div className="h-14" style={{ background: `linear-gradient(135deg, ${ACENTO[m.id]}, color-mix(in srgb, ${ACENTO[m.id]} 35%, transparent))` }} />
                    <div className="px-3 py-2 text-[12.5px] font-medium text-[var(--ls-t1)]">{m.texto}</div>
                  </div>
                ))}
              </div>
            </Tarjeta>
            <Tarjeta titulo="Gráficos" subtitulo="--viz-1..6: el color sigue a la entidad" icono={Activity} acento={modulo}>
              <div className="flex flex-wrap gap-3">
                {VIZ.map((c, i) => (
                  <div key={c} className="flex items-center gap-2 text-[12.5px] text-[var(--ls-t2)]">
                    <span className="h-4 w-8 rounded-[5px]" style={{ background: c }} />
                    --viz-{i + 1}
                  </div>
                ))}
              </div>
            </Tarjeta>
            <Tarjeta titulo="Insignias de estado" subtitulo="TONO_DE_ESTADO y los nueve tonos de COLOR_ESTADO" icono={ListChecks} acento={modulo}>
              <div className="flex flex-wrap gap-2">
                {Object.keys(TONO_DE_ESTADO).map((e) => (
                  <InsigniaDeEstado key={e} estado={e} />
                ))}
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {(Object.keys(COLOR_ESTADO) as TonoEstado[]).map((t) => (
                  <Insignia key={t} tono={t} variante="solida">
                    {t}
                  </Insignia>
                ))}
                {(Object.keys(COLOR_ESTADO) as TonoEstado[]).slice(0, 4).map((t) => (
                  <Insignia key={`c-${t}`} tono={t} variante="contorno" tamano="sm">
                    contorno
                  </Insignia>
                ))}
              </div>
            </Tarjeta>
          </div>
        )}
      </PanelDePestana>

      <PanelLateral
        abierto={abierto != null}
        onCambio={(a) => !a && setAbierto(null)}
        titulo={abierto?.nombre ?? ''}
        descripcion={abierto ? `${abierto.cliente} · ${formatoEntero(abierto.unidades)} unidades` : undefined}
        icono={Truck}
        acento={modulo}
        acciones={abierto ? <InsigniaDeEstado estado={abierto.estado} tamano="sm" /> : null}
        pie={
          <>
            <Boton variante="secundario" onClick={() => setAbierto(null)}>
              Cerrar
            </Boton>
            <Boton variante="primario" icono={CheckCircle2} onClick={() => toast.success('Guardado (de mentira)')}>
              Marcar recibido
            </Boton>
          </>
        }
      >
        {abierto && (
          <div className="flex flex-col gap-5">
            <div className="grid grid-cols-2 gap-2">
              {[
                ['Cajas', String(abierto.cajas)],
                ['Valor', formatoEuros(abierto.valor)],
                ['Responsable', abierto.responsable],
                ['Fecha', abierto.fecha.toLocaleDateString('es-ES')],
              ].map(([k, v]) => (
                <div key={k} className="rounded-[12px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-3 py-[10px]">
                  <div className="text-[11.5px] text-[var(--ls-t4)]">{k}</div>
                  <div className="mt-[2px] truncate text-[13.5px] font-semibold text-[var(--ls-t1)]">{v}</div>
                </div>
              ))}
            </div>
            <BarraDeProgreso valor={0.7} etiqueta="Recibido por Amazon" mostrarPorcentaje acento={modulo} />
            <div>
              <h3 className="mb-3 text-[12.5px] font-semibold text-[var(--ls-t2)]">Historial</h3>
              <LineaDeTiempo eventos={historial.slice(0, 3)} />
            </div>
          </div>
        )}
      </PanelLateral>

      <Confirmacion
        abierto={confirmar}
        onCambio={setConfirmar}
        titulo="¿Borrar este envío?"
        descripcion="Se borran sus cajas y etiquetas. No se puede deshacer."
        palabra="BORRAR"
        textoConfirmar="Borrar para siempre"
        onConfirmar={() => new Promise((r) => setTimeout(r, 900)).then(() => toast.success('Borrado (de mentira)'))}
      />

      <BarraCambiosSinGuardar
        visible={nombre !== guardado}
        cuantos={1}
        guardando={guardando}
        onDescartar={() => setNombre(guardado)}
        onGuardar={() => {
          setGuardando(true)
          setTimeout(() => {
            setGuardado(nombre)
            setGuardando(false)
            toast.success('Guardado (de mentira)')
          }, 800)
        }}
      />
    </div>
  )
}
