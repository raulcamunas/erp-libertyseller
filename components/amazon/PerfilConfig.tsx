'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  FlaskConical,
  Loader2,
  Upload,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  subirAmazon,
  type PerfilesVista,
  type PruebaResponse,
} from '@/lib/amazon/client'
import { marketplaceLabel } from '@/lib/types/amazon'
import { PanelOrigen } from './ExploradorOrigen'
import {
  STOCK_PRICE_MODE_LABELS,
  type StockPriceMode,
  type StockReadProfile,
} from '@/lib/types/stock-sync'
import {
  cardShell,
  fieldInput,
  formatImporte,
  formatInt,
  ghostButton,
  infoBox,
  primaryButton,
  warnBox,
} from './shared'

/**
 * LA CONFIGURACIÓN DE UN PERFIL: aquí vive «cada cliente es un mundo».
 *
 * SIN BOTÓN DE GUARDAR. Cada campo se guarda solo al salir de él, comparando
 * antes contra el valor actual para no escribir por nada. Es el patrón de la
 * ficha de empleado, y aquí importa más: un formulario de cincuenta campos con
 * un botón al final es un formulario que se pierde entero cuando alguien cierra
 * la pestaña a medias.
 *
 * Y EL BOTÓN DE «PROBAR», que es lo que hace que esto se pueda configurar. Lee
 * el fichero con lo que hay puesto AHORA y enseña qué ha entendido: la hoja, la
 * fila de cabecera, qué columna real se ha llevado cada campo y las primeras
 * filas ya interpretadas. Sin él se rellenan diez campos a ciegas y el fallo
 * aparece al procesar, como un «no ha casado nada» del que no se sale.
 */
export function PerfilConfig({
  perfil,
  data,
  onPatch,
  guardando,
}: {
  perfil: StockReadProfile
  data: PerfilesVista
  onPatch: (patch: Record<string, unknown>) => void
  guardando: boolean
}) {
  const conexion = data.conexiones.find((c) => c.id === perfil.connection_id)

  /** Los frenos que este cliente tiene sin límite: sin él, ese freno no existe */
  const frenosVacios = [
    perfil.freno_pct_a_cero === null && 'referencias a cero',
    perfil.freno_variacion_precio_pct === null && 'variación de precio',
    perfil.freno_caida_lineas_pct === null && 'caída de líneas',
    perfil.freno_caida_unidades_pct === null && 'caída de unidades',
    perfil.freno_max_cambios === null && 'máximo de cambios',
    perfil.lineas_referencia === null && 'líneas de un día normal',
  ].filter((x): x is string => typeof x === 'string')

  return (
    <div className="space-y-3 pb-6">
      {guardando && (
        <p className="text-[11px] text-white/40 flex items-center gap-1.5">
          <Loader2 className="h-3 w-3 animate-spin" />
          Guardando…
        </p>
      )}

      {/* ---------------- Identidad ---------------- */}
      <Seccion titulo="El perfil" hint="Qué fichero es y de qué cliente">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <Campo label="Nombre">
            <input
              key={`name-${perfil.id}`}
              defaultValue={perfil.name}
              onBlur={(e) => {
                const v = e.target.value.trim()
                if (v && v !== perfil.name) onPatch({ name: v })
              }}
              className={fieldInput}
            />
          </Campo>

          <Campo label="Qué trae este fichero">
            <Opciones
              valor={perfil.tipo}
              opciones={[
                { valor: 'stock', etiqueta: 'Stock (y precio)' },
                { valor: 'ean', etiqueta: 'Códigos de barras' },
              ]}
              onChange={(v) => onPatch({ tipo: v })}
            />
            <Nota>
              {perfil.tipo === 'stock'
                ? 'El volcado principal: referencia, unidades y, si lo trae, precio.'
                : 'El índice de códigos de barras del ERP. No se envía a Amazon: alimenta la vía de cruce por EAN, que es la que desempata las referencias que solo se diferencian en los ceros.'}
            </Nota>
          </Campo>
        </div>

        <Interruptor
          valor={perfil.is_active}
          etiqueta="Perfil activo"
          onChange={(v) => onPatch({ is_active: v })}
          nota="Apagado, ni se lee ni se procesa. El historial se conserva."
        />
      </Seccion>

      {/* ---------------- Origen ---------------- */}
      <Origen perfil={perfil} data={data} onPatch={onPatch} />

      {/* ---------------- Dónde están los datos ---------------- */}
      <Seccion
        titulo="Dónde están los datos dentro del fichero"
        hint="Hoja, cabecera y formato"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <Campo label="Hoja (por nombre)">
            <input
              key={`hoja-${perfil.id}`}
              defaultValue={perfil.hoja ?? ''}
              placeholder="Vacío = se reconoce por las columnas"
              onBlur={(e) => {
                const v = e.target.value.trim() || null
                if (v !== perfil.hoja) onPatch({ hoja: v })
              }}
              className={fieldInput}
            />
            <Nota>
              Lo preferido: sobrevive a que el cliente reordene el libro. Si no encaja, se prueban
              las demás hojas por sus columnas.
            </Nota>
          </Campo>

          <Campo label="Hoja (por posición)">
            <input
              key={`hoja-i-${perfil.id}`}
              defaultValue={perfil.hoja_indice ?? ''}
              inputMode="numeric"
              placeholder="Último recurso"
              onBlur={(e) => guardarEntero(e.target.value, perfil.hoja_indice, (v) =>
                onPatch({ hoja_indice: v })
              )}
              className={`${fieldInput} text-right tabular-nums`}
            />
            <Nota>
              Empezando en 1, y solo si no hay nombre: un libro cuya primera hoja cambia de sitio
              leería otra cosa sin avisar.
            </Nota>
          </Campo>

          <Campo label="Fila de la cabecera">
            <input
              key={`fc-${perfil.id}`}
              defaultValue={perfil.fila_cabecera ?? ''}
              inputMode="numeric"
              placeholder="Vacío = se busca sola"
              onBlur={(e) => guardarEntero(e.target.value, perfil.fila_cabecera, (v) =>
                onPatch({ fila_cabecera: v })
              )}
              className={`${fieldInput} text-right tabular-nums`}
            />
            <Nota>Vacío = se busca en las primeras 20 filas la primera con dos celdas llenas.</Nota>
          </Campo>

          <Campo label="Primera fila de datos">
            <input
              key={`fd-${perfil.id}`}
              defaultValue={perfil.fila_datos ?? ''}
              inputMode="numeric"
              placeholder="Vacío = la siguiente a la cabecera"
              onBlur={(e) => guardarEntero(e.target.value, perfil.fila_datos, (v) =>
                onPatch({ fila_datos: v })
              )}
              className={`${fieldInput} text-right tabular-nums`}
            />
          </Campo>

          <Campo label="Separador del CSV">
            <input
              key={`sep-${perfil.id}`}
              defaultValue={perfil.csv_separador ?? ''}
              placeholder="Vacío = automático"
              maxLength={3}
              onBlur={(e) => {
                const v = e.target.value || null
                if (v !== perfil.csv_separador) onPatch({ csv_separador: v })
              }}
              className={fieldInput}
            />
            <Nota>Solo para CSV. Normalmente «;» en los ficheros españoles.</Nota>
          </Campo>

          <Campo label="Codificación del CSV">
            <select
              key={`cod-${perfil.id}`}
              defaultValue={perfil.csv_codificacion ?? ''}
              onChange={(e) => onPatch({ csv_codificacion: e.target.value || null })}
              className={`${fieldInput} [color-scheme:dark]`}
            >
              <option value="">Automática (utf-8)</option>
              <option value="utf-8">utf-8</option>
              <option value="latin1">latin1</option>
              <option value="windows-1252">windows-1252</option>
            </select>
            <Nota>
              Si las tildes salen como símbolos raros en la prueba, es latin1 o windows-1252.
            </Nota>
          </Campo>
        </div>
      </Seccion>

      {/* ---------------- Columnas ---------------- */}
      <Seccion
        titulo="Las columnas"
        hint="Por nombre, nunca por posición"
      >
        <div className={infoBox}>
          Se busca <strong className="text-white/75">por nombre</strong> y se aceptan varias
          alternativas por campo, separadas por comas. No distingue tildes, mayúsculas ni
          puntuación: «Artículo», «ARTICULO» y «Cód.Artículo» casan solas. Ir por posición
          escribiría el dato en el sitio equivocado el día que el cliente añade una columna, y
          <strong className="text-white/75"> sin dar ningún error</strong>.
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <Alias
            perfil={perfil}
            campo="col_referencia"
            label="Referencia del artículo *"
            nota="Obligatoria siempre. Es la identidad del artículo en el ERP del cliente."
            onPatch={onPatch}
          />
          {perfil.tipo === 'stock' ? (
            <>
              <Alias
                perfil={perfil}
                campo="col_stock"
                label="Unidades en stock *"
                nota="Obligatoria en un perfil de stock."
                onPatch={onPatch}
              />
              <Alias
                perfil={perfil}
                campo="col_precio"
                label="Precio"
                nota="Solo hace falta si el precio sale de una columna."
                onPatch={onPatch}
              />
              <Alias
                perfil={perfil}
                campo="col_precio_respaldo"
                label="Precio de respaldo"
                nota="Se mira SOLO si la columna de precio viene vacía en esa fila."
                onPatch={onPatch}
              />
              <Alias
                perfil={perfil}
                campo="col_coste"
                label="Coste"
                nota="Solo hace falta si el precio se calcula por margen."
                onPatch={onPatch}
              />
              <Alias
                perfil={perfil}
                campo="col_descripcion"
                label="Descripción"
                nota="Para reconocer la línea en pantalla. No se envía a Amazon."
                onPatch={onPatch}
              />
              <Alias
                perfil={perfil}
                campo="col_familia"
                label="Familia"
                nota="Hace falta para poder excluir familias enteras."
                onPatch={onPatch}
              />
              <Alias
                perfil={perfil}
                campo="col_ean"
                label="Código de barras"
                nota="Si el volcado de stock ya lo trae."
                onPatch={onPatch}
              />
            </>
          ) : (
            <>
              <Alias
                perfil={perfil}
                campo="col_ean"
                label="Código de barras *"
                nota="Obligatoria en un perfil de códigos de barras."
                onPatch={onPatch}
              />
              <Alias
                perfil={perfil}
                campo="col_tipo"
                label="Tipo de código"
                nota="Solo si el fichero mezcla EAN-13 con códigos internos del ERP."
                onPatch={onPatch}
              />
              <Campo label="Quedarse solo con el tipo">
                <input
                  key={`tipo-${perfil.id}`}
                  defaultValue={perfil.ean_solo_tipo ?? ''}
                  inputMode="numeric"
                  placeholder="Vacío = todos"
                  onBlur={(e) => guardarEntero(e.target.value, perfil.ean_solo_tipo, (v) =>
                    onPatch({ ean_solo_tipo: v })
                  )}
                  className={`${fieldInput} text-right tabular-nums`}
                />
                <Nota>
                  En Shoplamp es 1. Colar códigos internos no es cosmético: dos artículos distintos
                  pueden casar por un código parecido y el stock acaba en el listing equivocado.
                </Nota>
              </Campo>
            </>
          )}
        </div>
      </Seccion>

      {perfil.tipo === 'stock' && (
        <>
          {/* ---------------- Reglas ---------------- */}
          <Seccion titulo="Reglas de negocio" hint="Lo que de verdad distingue a un cliente de otro">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <Campo label="Unidades reservadas">
                <input
                  key={`res-${perfil.id}`}
                  defaultValue={perfil.reserva_unidades}
                  inputMode="numeric"
                  onBlur={(e) => guardarEntero(e.target.value, perfil.reserva_unidades, (v) =>
                    onPatch({ reserva_unidades: v ?? 0 })
                  )}
                  className={`${fieldInput} text-right tabular-nums`}
                />
                <Nota>
                  Las últimas N no se venden en Amazon: se guardan para la tienda física o como
                  colchón contra el desfase con el almacén.
                </Nota>
              </Campo>

              <Campo label="Umbral mínimo">
                <input
                  key={`min-${perfil.id}`}
                  defaultValue={perfil.stock_minimo}
                  inputMode="numeric"
                  onBlur={(e) => guardarEntero(e.target.value, perfil.stock_minimo, (v) =>
                    onPatch({ stock_minimo: v ?? 0 })
                  )}
                  className={`${fieldInput} text-right tabular-nums`}
                />
                <Nota>
                  Por debajo de N unidades (ya descontada la reserva) se publica 0. No es lo mismo
                  que la reserva: esto es «con tan pocas no salgo a vender».
                </Nota>
              </Campo>

              <div className="sm:col-span-2">
                <Campo label="De dónde sale el precio">
                  <Opciones
                    valor={perfil.precio_modo}
                    opciones={(Object.keys(STOCK_PRICE_MODE_LABELS) as StockPriceMode[]).map(
                      (m) => ({ valor: m, etiqueta: STOCK_PRICE_MODE_LABELS[m] })
                    )}
                    onChange={(v) => onPatch({ precio_modo: v })}
                  />
                </Campo>
              </div>

              {perfil.precio_modo === 'margen' && (
                <>
                  <Campo label="Margen sobre el coste (%)">
                    <input
                      key={`margen-${perfil.id}`}
                      defaultValue={perfil.margen_porcentaje ?? ''}
                      inputMode="decimal"
                      onBlur={(e) => guardarDecimal(e.target.value, perfil.margen_porcentaje, (v) =>
                        onPatch({ margen_porcentaje: v })
                      )}
                      className={`${fieldInput} text-right tabular-nums`}
                    />
                    <Nota>35 = coste × 1,35.</Nota>
                  </Campo>

                  <Campo label="IVA a añadir (%)">
                    <input
                      key={`iva-${perfil.id}`}
                      defaultValue={perfil.iva_porcentaje ?? ''}
                      inputMode="decimal"
                      placeholder="Vacío = el coste ya lo lleva"
                      onBlur={(e) => guardarDecimal(e.target.value, perfil.iva_porcentaje, (v) =>
                        onPatch({ iva_porcentaje: v })
                      )}
                      className={`${fieldInput} text-right tabular-nums`}
                    />
                    <Nota>
                      Amazon publica el precio CON impuestos. Si el cliente da el coste sin IVA y
                      esto se deja vacío, se publica un 21% barato.
                    </Nota>
                  </Campo>
                </>
              )}

              <Campo label="Precio mínimo">
                <input
                  key={`pmin-${perfil.id}`}
                  defaultValue={perfil.precio_minimo ?? ''}
                  inputMode="decimal"
                  placeholder="Sin suelo"
                  onBlur={(e) => guardarDecimal(e.target.value, perfil.precio_minimo, (v) =>
                    onPatch({ precio_minimo: v })
                  )}
                  className={`${fieldInput} text-right tabular-nums`}
                />
              </Campo>

              <Campo label="Precio máximo">
                <input
                  key={`pmax-${perfil.id}`}
                  defaultValue={perfil.precio_maximo ?? ''}
                  inputMode="decimal"
                  placeholder="Sin techo"
                  onBlur={(e) => guardarDecimal(e.target.value, perfil.precio_maximo, (v) =>
                    onPatch({ precio_maximo: v })
                  )}
                  className={`${fieldInput} text-right tabular-nums`}
                />
                <Nota>
                  Fuera de rango se DESCARTA la línea, no se ajusta al límite: recortar un precio
                  disparatado lo convierte en uno plausible y lo publica.
                </Nota>
              </Campo>

              <ListaTexto
                perfil={perfil}
                campo="familias_excluidas"
                label="Familias excluidas"
                nota="Familias enteras que no se tocan. Sin tildes ni mayúsculas."
                onPatch={onPatch}
              />
              <ListaTexto
                perfil={perfil}
                campo="referencias_excluidas"
                label="Referencias excluidas"
                nota="Referencias sueltas que no se tocan. Vale con o sin ceros a la izquierda."
                onPatch={onPatch}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
              <Interruptor
                valor={perfil.enviar_stock}
                etiqueta="Mandar stock"
                onChange={(v) => onPatch({ enviar_stock: v })}
              />
              <Interruptor
                valor={perfil.enviar_precio}
                etiqueta="Mandar precio"
                onChange={(v) => onPatch({ enviar_precio: v })}
                nota="La escritura de precio contra Amazon todavía no se ha validado con una cuenta real."
              />
            </div>
          </Seccion>

          {/* ---------------- Destino ---------------- */}
          <Seccion titulo="A qué cuenta de Amazon" hint="El puente entre los dos mundos">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <Campo label="Conexión">
                <select
                  key={`conn-${perfil.id}`}
                  defaultValue={perfil.connection_id ?? ''}
                  onChange={(e) => onPatch({ connection_id: e.target.value || null })}
                  className={`${fieldInput} [color-scheme:dark]`}
                >
                  <option value="">Sin conexión (solo simulacro)</option>
                  {data.conexiones.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {c.status === 'activa' && c.is_active ? '' : ' (no está conectada)'}
                    </option>
                  ))}
                </select>
                <Nota>
                  Sin conexión el simulacro funciona igual, pero no hay contra qué contrastar: no
                  se puede saber qué cambia de verdad.
                </Nota>
              </Campo>

              <Campo label="País">
                <select
                  key={`mkt-${perfil.id}`}
                  defaultValue={perfil.marketplace_id ?? ''}
                  onChange={(e) => onPatch({ marketplace_id: e.target.value || null })}
                  className={`${fieldInput} [color-scheme:dark]`}
                  disabled={!conexion}
                >
                  <option value="">El de entrada de la conexión</option>
                  {(conexion?.marketplace_ids ?? []).map((m) => (
                    <option key={m} value={m}>
                      {marketplaceLabel(m)}
                    </option>
                  ))}
                </select>
                <Nota>
                  Un cliente europeo vende el mismo SKU en varios países con precio distinto: el
                  espejo del catálogo se guarda por país.
                </Nota>
              </Campo>

              <Campo label="Moneda">
                <input
                  key={`mon-${perfil.id}`}
                  defaultValue={perfil.moneda}
                  maxLength={3}
                  onBlur={(e) => {
                    const v = e.target.value.trim().toUpperCase()
                    if (v && v !== perfil.moneda) onPatch({ moneda: v })
                  }}
                  className={fieldInput}
                />
              </Campo>
            </div>
          </Seccion>

          {/* ---------------- Frenos ---------------- */}
          <Seccion
            titulo="Frenos"
            hint="Si salta uno, no se manda nada"
          >
            <div className={infoBox}>
              Un fichero mal exportado un martes por la noche{' '}
              <strong className="text-white/75">
                no puede vaciar el inventario de un cliente quince minutos después
              </strong>{' '}
              sin que nadie lo vea. Los límites son por cliente: uno con 400 referencias y otro con
              40.000 no toleran lo mismo.
            </div>

            {/*
              Dejar una casilla vacía apaga ese freno, y hasta ahora eso no lo
              decía nadie: un freno sin umbral salía como «no ha saltado» y
              contaba como permiso para enviar. Ahora la base no deja encender el
              envío automático así, pero conviene verlo ANTES de intentarlo.
            */}
            {frenosVacios.length > 0 && (
              <div className={warnBox}>
                {frenosVacios.length === 1
                  ? 'Hay un freno sin límite puesto, así que está apagado: '
                  : `Hay ${frenosVacios.length} frenos sin límite puesto, así que están apagados: `}
                {frenosVacios.join(', ')}. Con el envío automático encendido, un freno que no se
                puede comprobar impide mandar — y la base no deja encenderlo hasta que estén los
                cinco y las líneas de referencia.
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <Campo label="Máximo del catálogo que puede irse a cero (%)">
                <input
                  key={`f1-${perfil.id}`}
                  defaultValue={perfil.freno_pct_a_cero ?? ''}
                  inputMode="decimal"
                  placeholder="Vacío = no se evalúa"
                  onBlur={(e) => guardarDecimal(e.target.value, perfil.freno_pct_a_cero, (v) =>
                    onPatch({ freno_pct_a_cero: v })
                  )}
                  className={`${fieldInput} text-right tabular-nums`}
                />
              </Campo>

              <Campo label="Variación máxima de precio de una línea (%)">
                <input
                  key={`f2-${perfil.id}`}
                  defaultValue={perfil.freno_variacion_precio_pct ?? ''}
                  inputMode="decimal"
                  placeholder="Vacío = no se evalúa"
                  onBlur={(e) =>
                    guardarDecimal(e.target.value, perfil.freno_variacion_precio_pct, (v) =>
                      onPatch({ freno_variacion_precio_pct: v })
                    )
                  }
                  className={`${fieldInput} text-right tabular-nums`}
                />
                <Nota>Se mira la línea peor, no la media.</Nota>
              </Campo>

              <Campo label="Caída máxima de líneas del fichero (%)">
                <input
                  key={`f3-${perfil.id}`}
                  defaultValue={perfil.freno_caida_lineas_pct ?? ''}
                  inputMode="decimal"
                  placeholder="Vacío = no se evalúa"
                  onBlur={(e) =>
                    guardarDecimal(e.target.value, perfil.freno_caida_lineas_pct, (v) =>
                      onPatch({ freno_caida_lineas_pct: v })
                    )
                  }
                  className={`${fieldInput} text-right tabular-nums`}
                />
                <Nota>
                  Un fichero con 8.000 líneas menos es un volcado a medias, no un almacén vacío.
                </Nota>
              </Campo>

              <Campo label="Caída máxima de unidades publicadas (%)">
                <input
                  key={`f6-${perfil.id}`}
                  defaultValue={perfil.freno_caida_unidades_pct ?? ''}
                  inputMode="decimal"
                  placeholder="Vacío = no se evalúa"
                  onBlur={(e) =>
                    guardarDecimal(e.target.value, perfil.freno_caida_unidades_pct, (v) =>
                      onPatch({ freno_caida_unidades_pct: v })
                    )
                  }
                  className={`${fieldInput} text-right tabular-nums`}
                />
                <Nota>
                  El único que ve un derrumbe de stock que NO llega a cero: un fichero con todas sus
                  líneas y las cantidades divididas por mil no mueve ninguno de los otros.
                </Nota>
              </Campo>

              <Campo label="Máximo de SKU que pueden cambiar de golpe">
                <input
                  key={`f4-${perfil.id}`}
                  defaultValue={perfil.freno_max_cambios ?? ''}
                  inputMode="numeric"
                  placeholder="Vacío = no se evalúa"
                  onBlur={(e) => guardarEntero(e.target.value, perfil.freno_max_cambios, (v) =>
                    onPatch({ freno_max_cambios: v })
                  )}
                  className={`${fieldInput} text-right tabular-nums`}
                />
              </Campo>

              <Campo label="Líneas que trae este fichero un día normal">
                <input
                  key={`f5-${perfil.id}`}
                  defaultValue={perfil.lineas_referencia ?? ''}
                  inputMode="numeric"
                  placeholder="Todavía sin fijar"
                  onBlur={(e) => guardarEntero(e.target.value, perfil.lineas_referencia, (v) =>
                    onPatch({ lineas_referencia: v })
                  )}
                  className={`${fieldInput} text-right tabular-nums`}
                />
                <Nota>
                  Es la referencia del freno de caída. Mientras esté vacío, ese freno queda
                  declarado pero NO PUEDE SALTAR: no hay con qué comparar. Rellénalo con el número
                  de líneas de una ejecución que hayas dado por buena.
                </Nota>
              </Campo>
            </div>
          </Seccion>

          {/* ---------------- Interruptor ---------------- */}
          <Seccion titulo="Envío automático" hint="Nace apagado, y hay que encenderlo a conciencia">
            <Interruptor
              valor={perfil.envio_automatico}
              etiqueta="Enviar solo, sin que nadie mire"
              onChange={(v) => onPatch({ envio_automatico: v })}
              peligroso
            />
            {perfil.envio_automatico ? (
              <div className={warnBox}>
                Con esto encendido, el proceso manda a Amazon lo que salga del fichero sin que nadie
                lo revise, salvo que salte un freno. Comprueba antes el simulacro y que los frenos
                están puestos.
              </div>
            ) : (
              <Nota>
                Apagado, el ciclo entero corre igual y se queda en simulacro: qué se mandaría,
                cuántos SKU cambian y cuántos se irían a cero. Eso solo ya sirve para dar de alta a
                un cliente.
              </Nota>
            )}

            <Campo label="Cada cuántos minutos se mira el origen">
              <input
                key={`cad-${perfil.id}`}
                defaultValue={perfil.cadencia_minutos}
                inputMode="numeric"
                onBlur={(e) => guardarEntero(e.target.value, perfil.cadencia_minutos, (v) =>
                  onPatch({ cadencia_minutos: v ?? 15 })
                )}
                className={`${fieldInput} text-right tabular-nums`}
              />
              <Nota>Mínimo 5. El ciclo que ya existe va cada 15.</Nota>
            </Campo>
          </Seccion>
        </>
      )}

      {/* ---------------- Probar ---------------- */}
      <Probar perfil={perfil} />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* El origen                                                           */
/* ------------------------------------------------------------------ */

/**
 * DE DÓNDE SALE EL FICHERO, Y EL BOTÓN QUE COMPRUEBA QUE SE LLEGA.
 *
 * Los campos del conector son ESTADO CONTROLADO y no `defaultValue`, y esa es
 * toda la razón de que esto sea un componente aparte.
 *
 * El flujo real del alta de un cliente es: se pega el identificador de la
 * carpeta de Drive y se pulsa «Comprobar». Con campos no controlados, el
 * mousedown del botón dispara el onBlur del input —que lanza un PATCH
 * asíncrono— y el click dispara acto seguido la comprobación, que releía el
 * perfil de la base y lo más probable era que leyera la fila ANTERIOR al PATCH.
 * Resultado: «este perfil no tiene puesto el identificador de la carpeta» para
 * una carpeta que se acababa de escribir, y el mensaje se quedaba en pantalla.
 *
 * La ruta ya aceptaba la configuración en el cuerpo justo para esto, y no la
 * usaba nadie. Ahora se manda lo que hay EN PANTALLA, así que la primera
 * pulsación contesta sobre lo que se acaba de escribir — que es el fallo que va
 * a pasar la primera vez con cada cliente.
 */
function Origen({
  perfil,
  data,
  onPatch,
}: {
  perfil: StockReadProfile
  data: PerfilesVista
  onPatch: (patch: Record<string, unknown>) => void
}) {
  const conector = data.conectores.find((c) => c.id === perfil.origen)
  const guardada = useMemo(
    () => (perfil.origen_config ?? {}) as Record<string, unknown>,
    [perfil.origen_config]
  )

  const [borrador, setBorrador] = useState<Record<string, unknown>>(guardada)

  // Cuando llega el perfil actualizado del servidor —o se cambia de perfil— el
  // borrador vuelve a ser lo guardado. Sin esto, editar un cliente y saltar a
  // otro arrastraría el identificador de carpeta del primero.
  useEffect(() => {
    setBorrador(guardada)
  }, [guardada, perfil.id])

  return (
    <Seccion titulo="De dónde sale el fichero" hint="El conector">
      <div className="flex flex-wrap gap-1.5">
        {data.conectores.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => onPatch({ origen: c.id })}
            aria-pressed={perfil.origen === c.id}
            title={c.construido ? c.descripcion : `${c.descripcion} (todavía no está construido)`}
            className={`px-2.5 py-1.5 rounded-lg text-[11px] font-medium border transition-colors ${
              perfil.origen === c.id
                ? 'border-[#FF6600]/50 bg-[#FF6600]/[0.1] text-white'
                : 'border-white/10 bg-white/[0.02] text-white/45 hover:text-white hover:border-white/20'
            } ${c.construido ? '' : 'opacity-50'}`}
          >
            {c.etiqueta}
            {!c.construido && <span className="ml-1 text-white/35">· en obras</span>}
          </button>
        ))}
      </div>

      {conector && <Nota>{conector.descripcion}</Nota>}

      {conector && !conector.construido && (
        <div className={warnBox}>
          Este origen está previsto pero todavía no está construido. Puedes dejarlo elegido para que
          conste cómo lo dará este cliente, pero el proceso solo funcionará subiendo el fichero a
          mano.
        </div>
      )}

      {/* Los campos los declara el CONECTOR, no esta pantalla: añadir un
          origen nuevo no obliga a tocar este formulario. */}
      {conector && conector.campos.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {conector.campos.map((campo) => {
            const actual = borrador[campo.clave]

            if (campo.tipo === 'booleano') {
              return (
                <div key={campo.clave} className="sm:col-span-2">
                  <Interruptor
                    valor={actual === true}
                    etiqueta={campo.etiqueta}
                    onChange={(v) => {
                      const siguiente = { ...borrador, [campo.clave]: v }
                      setBorrador(siguiente)
                      onPatch({ origen_config: siguiente })
                    }}
                    nota={campo.ayuda}
                  />
                </div>
              )
            }

            /**
             * Botonera en vez de cajetín. La usa el Drive para elegir DE QUIÉN
             * es la carpeta, que es una decisión de dos valores: escrita a mano
             * se escribe mal, y elegir mal ahí da un «no existe la carpeta»
             * para una carpeta que se ve perfectamente en el navegador.
             *
             * La primera opción es la de fábrica: un perfil que todavía no ha
             * guardado nada tiene que verse igual que se comporta.
             */
            if (campo.tipo === 'opcion' && campo.opciones && campo.opciones.length > 0) {
              const elegida =
                typeof actual === 'string' && actual ? actual : campo.opciones[0].valor
              return (
                <Campo key={campo.clave} label={campo.etiqueta}>
                  <Opciones
                    valor={elegida}
                    opciones={campo.opciones.map((o) => ({
                      valor: o.valor,
                      etiqueta: o.etiqueta,
                    }))}
                    onChange={(v) => {
                      const siguiente = { ...borrador, [campo.clave]: v }
                      setBorrador(siguiente)
                      onPatch({ origen_config: siguiente })
                    }}
                  />
                  <Nota>{campo.ayuda}</Nota>
                </Campo>
              )
            }

            return (
              <Campo key={campo.clave} label={campo.etiqueta + (campo.requerido ? ' *' : '')}>
                <input
                  value={typeof actual === 'string' ? actual : ''}
                  placeholder={campo.ejemplo ?? ''}
                  onChange={(e) => setBorrador({ ...borrador, [campo.clave]: e.target.value })}
                  onBlur={(e) => {
                    const v = e.target.value.trim()
                    const previo = typeof guardada[campo.clave] === 'string' ? guardada[campo.clave] : ''
                    if (v === previo) return
                    onPatch({ origen_config: { ...borrador, [campo.clave]: v } })
                  }}
                  className={fieldInput}
                />
                <Nota>{campo.ayuda}</Nota>
              </Campo>
            )
          })}
        </div>
      )}

      {/**
        * EL EXPLORADOR, PINTADO POR LO QUE EL CONECTOR DECLARA.
        *
        * Aquí había un `perfil.origen === 'drive'` escrito a mano, y con tres
        * conectores más ese `if` habría sido una lista de orígenes que hay que
        * acordarse de ampliar. Ahora el conector dice si sabe enseñar lo que hay
        * dentro (`explorador`) y si necesita contraseña (`secreto`), y esta
        * pantalla se limita a obedecer: un origen nuevo no la toca.
        *
        * 'manual' se queda fuera por definición: no hay nada que explorar en un
        * fichero que sube una persona desde su ordenador.
        */}
      {conector && conector.construido && perfil.origen !== 'manual' && (
        <PanelOrigen
          perfil={perfil}
          conector={conector}
          config={borrador}
          driveEmail={data.driveEmail}
          driveConfigurado={data.driveConfigurado}
          onElegirCarpeta={(clave, valor) => {
            const siguiente = { ...borrador, [clave]: valor }
            setBorrador(siguiente)
            onPatch({ origen_config: siguiente })
          }}
        />
      )}
    </Seccion>
  )
}

/* ------------------------------------------------------------------ */
/* Probar                                                              */
/* ------------------------------------------------------------------ */

function Probar({ perfil }: { perfil: StockReadProfile }) {
  const [fichero, setFichero] = useState<File | null>(null)
  const [prueba, setPrueba] = useState<PruebaResponse['prueba'] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(false)

  const manual = perfil.origen === 'manual'

  async function probar() {
    if (manual && !fichero) {
      toast.error('Elige el fichero del cliente para poder probarlo')
      return
    }
    setCargando(true)
    setError(null)
    setPrueba(null)

    const form = new FormData()
    if (fichero) form.append('fichero', fichero)

    const res = await subirAmazon<PruebaResponse>(
      `/api/amazon/perfiles/${perfil.id}/probar`,
      form
    )
    setCargando(false)

    if (!res.ok) {
      setError(res.error)
      return
    }
    setPrueba(res.data.prueba)
    toast.success(
      `Leídas ${res.data.prueba.totalLineas.toLocaleString('es-ES')} líneas de la hoja «${res.data.prueba.hoja}»`
    )
  }

  return (
    <Seccion titulo="Probar" hint="Qué entiende el perfil con este fichero">
      <div className="flex flex-wrap items-center gap-2">
        <label
          className={`${ghostButton} cursor-pointer ${cargando ? 'opacity-50' : ''}`}
          title="Elegir el fichero del cliente"
        >
          <Upload className="h-3.5 w-3.5" />
          {fichero ? 'Cambiar fichero' : 'Elegir fichero'}
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => {
              setFichero(e.target.files?.[0] ?? null)
              // Se limpia para que volver a elegir el MISMO fichero dispare el
              // change: sin esto, corregirlo y volver a elegirlo no hace nada.
              e.target.value = ''
            }}
          />
        </label>

        {fichero && (
          <span className="text-[11px] text-white/55 truncate max-w-[240px]">{fichero.name}</span>
        )}

        <button type="button" onClick={probar} disabled={cargando} className={primaryButton}>
          {cargando ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <FlaskConical className="h-3.5 w-3.5" />
          )}
          Probar
        </button>

        {!manual && (
          <span className="text-[11px] text-white/40">
            Sin fichero se prueba con el que haya ahora mismo en el origen.
          </span>
        )}
      </div>

      {error && (
        <div className={warnBox}>
          <p className="whitespace-pre-line">{error}</p>
        </div>
      )}

      {prueba && <ResultadoPrueba prueba={prueba} moneda={perfil.moneda} />}
    </Seccion>
  )
}

function ResultadoPrueba({
  prueba,
  moneda,
}: {
  prueba: PruebaResponse['prueba']
  /** La del perfil: la tabla se compara contra el Excel del cliente, que va en formato español */
  moneda: string
}) {
  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-white/55">
        <span>
          Hoja <strong className="text-white">{prueba.hoja}</strong>
        </span>
        <span>
          Cabecera en la fila <strong className="text-white">{prueba.filaCabecera}</strong>
        </span>
        <span>
          <strong className="text-white tabular-nums">
            {prueba.totalLineas.toLocaleString('es-ES')}
          </strong>{' '}
          {prueba.tipo === 'ean' ? 'códigos' : 'líneas'}
        </span>
        {prueba.tipo === 'ean' && (
          <span>
            <strong className="text-white tabular-nums">
              {prueba.totalArticulos.toLocaleString('es-ES')}
            </strong>{' '}
            artículos
          </span>
        )}
        <span className="truncate max-w-[220px]">{prueba.fichero.nombre}</span>
      </div>

      {/* Qué columna se ha llevado cada campo. Es el dato que se viene a ver */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
        {prueba.columnas.map((c) => (
          /**
           * TRES ESTADOS Y NO DOS, y el del medio es el que importa.
           *
           * Una columna que casa solo porque EMPIEZA IGUAL que uno de los
           * nombres apuntados se pintaba en verde con un tick, exactamente
           * igual que un acierto exacto. Así es como un perfil nuevo acaba
           * leyendo «Stock value» —un importe en euros— creyendo que son las
           * unidades: devuelve el catálogo entero a cero, no da ningún error y
           * la pantalla que existe para comprobarlo dice que está bien.
           */
          <div
            key={c.campo}
            className={`rounded-lg border px-2 py-1.5 text-[11px] ${
              c.indice < 0
                ? 'border-red-500/25 bg-red-500/[0.05]'
                : c.exacta
                  ? 'border-green-400/25 bg-green-400/[0.05]'
                  : 'border-yellow-500/25 bg-yellow-400/[0.06]'
            }`}
          >
            <div className="flex items-center gap-1.5 min-w-0">
              {c.indice < 0 ? (
                <XCircle className="h-3 w-3 text-red-400 flex-shrink-0" />
              ) : c.exacta ? (
                <CheckCircle2 className="h-3 w-3 text-green-400 flex-shrink-0" />
              ) : (
                <AlertTriangle className="h-3 w-3 text-yellow-400 flex-shrink-0" />
              )}
              <span className="text-white/70 truncate">{c.etiqueta}</span>
            </div>
            <p className={`mt-0.5 ${c.indice >= 0 && !c.exacta ? 'text-yellow-300/90' : 'text-white/45'}`}>
              {c.indice < 0 ? (
                <>no encontrada · se buscaba {c.alias.map((a) => `«${a}»`).join(', ')}</>
              ) : c.exacta ? (
                <>
                  columna <strong className="text-white">«{c.cabecera}»</strong>
                </>
              ) : (
                <>
                  columna <strong className="text-yellow-200">«{c.cabecera}»</strong>, que no es
                  ninguno de los nombres apuntados sino uno que empieza igual. Compruébalo.
                </>
              )}
            </p>
          </div>
        ))}
      </div>

      {prueba.avisos.length > 0 && (
        <div className={warnBox}>
          <ul className="space-y-1">
            {prueba.avisos.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Las primeras filas ya interpretadas */}
      {prueba.muestra.length > 0 && (
        <div className="overflow-x-auto min-w-0 rounded-xl border border-white/10">
          <table className="w-full min-w-[720px] text-[11px] border-collapse">
            <thead>
              <tr className="bg-white/[0.03]">
                <Th>Fila</Th>
                <Th>Artículo</Th>
                <Th>Descripción</Th>
                <Th className="text-right">Stock leído</Th>
                <Th className="text-right">Se publicaría</Th>
                <Th className="text-right">Precio leído</Th>
                <Th className="text-right">Precio final</Th>
                <Th>EAN</Th>
              </tr>
            </thead>
            <tbody>
              {prueba.muestra.map((f) => (
                <tr
                  key={f.fila}
                  className={`border-t border-white/[0.06] ${f.descarte ? 'opacity-50' : ''}`}
                  title={f.descarte ?? undefined}
                >
                  <Td className="text-white/35 tabular-nums">{f.fila}</Td>
                  <Td className="text-white font-medium">{f.articulo}</Td>
                  <Td className="text-white/55 max-w-[220px] truncate">{f.descripcion || '—'}</Td>
                  <Td className="text-right tabular-nums text-white/55">
                    {formatInt(f.stockLeido)}
                  </Td>
                  <Td
                    className={`text-right tabular-nums font-semibold ${
                      f.stockPublicable !== f.stockLeido ? 'text-yellow-300' : 'text-white'
                    }`}
                  >
                    {f.descarte ? '—' : formatInt(f.stockPublicable)}
                  </Td>
                  <Td className="text-right tabular-nums text-white/55">
                    {formatImporte(f.precioLeido, moneda)}
                  </Td>
                  <Td className="text-right tabular-nums text-white">
                    {formatImporte(f.precioFinal, moneda)}
                  </Td>
                  <Td className="text-white/45">{f.ean || '—'}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {prueba.muestraEan.length > 0 && (
        <div className="overflow-x-auto min-w-0 rounded-xl border border-white/10">
          <table className="w-full min-w-[380px] text-[11px] border-collapse">
            <thead>
              <tr className="bg-white/[0.03]">
                <Th>Artículo</Th>
                <Th>Códigos de barras</Th>
              </tr>
            </thead>
            <tbody>
              {prueba.muestraEan.map((f) => (
                <tr key={f.articulo} className="border-t border-white/[0.06]">
                  <Td className="text-white font-medium">{f.articulo}</Td>
                  <Td className="text-white/55">{f.codigos.join(', ')}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[10px] text-white/35">
        Se enseñan las primeras filas del fichero, con las reglas ya aplicadas. Las que aparecen
        atenuadas las descartan las reglas: pasa el ratón por encima para ver por qué.
      </p>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Piezas                                                              */
/* ------------------------------------------------------------------ */

function Seccion({
  titulo,
  hint,
  children,
}: {
  titulo: string
  hint?: string
  children: React.ReactNode
}) {
  /**
   * EL SUBTÍTULO NO SE PINTA: va al `title` de la sección.
   *
   * Eran once renglones de contexto —«Qué fichero es y de qué cliente», «El
   * conector», «Hoja, cabecera y formato»— repitiendo con otras palabras lo que
   * ya decía el título de encima, en un formulario que ya es largo de por sí. Es
   * el texto de en medio que se ha pedido quitar, y el que menos cuesta: no
   * informa de nada que no esté a la vista.
   *
   * La explicación de fondo —qué hace cada origen, por qué existen los frenos,
   * qué pasa si un cliente deja de sincronizar— está detrás del botón de
   * información de la cabecera, en InfoOrigen.
   */
  return (
    <section className={`${cardShell} p-3 space-y-2.5 min-w-0`} title={hint}>
      <h3 className="text-[12px] font-semibold text-white min-w-0">{titulo}</h3>
      {children}
    </section>
  )
}

/**
 * La etiqueta de un campo.
 *
 * En caja normal y no en `uppercase tracking-wider`: a diez píxeles las
 * mayúsculas espaciadas son la forma más lenta de leer una palabra, y estos son
 * los nombres de los cincuenta campos que hay que rellenar para que a un cliente
 * no se le vacíe el inventario. Mismo criterio que CAMPO.etiqueta de denso.ts,
 * escrito aquí con los tokens de este módulo para no mezclar dos sistemas dentro
 * del mismo formulario.
 */
function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <label className="block text-[11px] font-semibold text-white/45 mb-1">{label}</label>
      {children}
    </div>
  )
}

function Nota({ children }: { children: React.ReactNode }) {
  return <p className="mt-1 text-[10px] text-white/35 leading-relaxed">{children}</p>
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      className={`px-2 py-1.5 text-left text-[10px] font-semibold text-white/40 uppercase tracking-wider whitespace-nowrap ${className}`}
    >
      {children}
    </th>
  )
}

function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-2 py-1 ${className}`}>{children}</td>
}

/** Botones en vez de un `select` cuando las opciones son dos o tres */
function Opciones<T extends string>({
  valor,
  opciones,
  onChange,
}: {
  valor: T
  opciones: Array<{ valor: T; etiqueta: string }>
  onChange: (v: T) => void
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {opciones.map((o) => (
        <button
          key={o.valor}
          type="button"
          onClick={() => valor !== o.valor && onChange(o.valor)}
          aria-pressed={valor === o.valor}
          className={`flex-1 min-w-[110px] px-2 py-1.5 rounded-lg text-[11px] font-medium border transition-colors ${
            valor === o.valor
              ? 'border-[#FF6600]/50 bg-[#FF6600]/[0.1] text-white'
              : 'border-white/10 bg-white/[0.02] text-white/45 hover:text-white hover:border-white/20'
          }`}
        >
          {o.etiqueta}
        </button>
      ))}
    </div>
  )
}

function Interruptor({
  valor,
  etiqueta,
  onChange,
  nota,
  peligroso,
}: {
  valor: boolean
  etiqueta: string
  onChange: (v: boolean) => void
  nota?: string
  peligroso?: boolean
}) {
  return (
    <div className="min-w-0">
      <button
        type="button"
        onClick={() => onChange(!valor)}
        aria-pressed={valor}
        className={`w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg border text-[11px] font-medium transition-colors ${
          valor
            ? peligroso
              ? 'border-yellow-500/40 bg-yellow-400/[0.08] text-yellow-300'
              : 'border-[#FF6600]/50 bg-[#FF6600]/[0.1] text-white'
            : 'border-white/10 bg-white/[0.02] text-white/45 hover:text-white hover:border-white/20'
        }`}
      >
        <span className="truncate">{etiqueta}</span>
        <span
          className={`flex-shrink-0 w-8 h-4 rounded-full border transition-colors relative ${
            valor ? 'border-transparent bg-[#FF6600]' : 'border-white/20 bg-white/[0.05]'
          }`}
        >
          {/*
            LA BOLITA VA EN VARIABLES DEL TEMA, NO EN BLANCO FIJO.
            Con `bg-white` y el interruptor APAGADO, en tema claro la pista pasa
            a un gris casi blanco y la bolita se quedaba blanca encima: contraste
            de 1,1 a 1, así que «envío automático apagado» y «encendido» se
            distinguían solo por el color de la pista. Es el interruptor más
            delicado del ERP y tiene que leerse de un vistazo en los dos temas.
          */}
          <span
            className={`absolute top-0.5 h-2.5 w-2.5 rounded-full transition-all ${
              valor ? 'left-4' : 'left-0.5'
            }`}
            style={{ backgroundColor: valor ? 'var(--surface, #fff)' : 'var(--text-primary, #fff)' }}
          />
        </span>
      </button>
      {nota && <Nota>{nota}</Nota>}
    </div>
  )
}

/**
 * Los nombres alternativos de una columna, separados por comas.
 *
 * Se teclean como se leen del Excel. El orden importa poco —se prueba primero
 * la coincidencia exacta de todos y solo después «empieza por»— pero se
 * conserva porque es el orden en el que la persona los ha ido encontrando.
 */
function Alias({
  perfil,
  campo,
  label,
  nota,
  onPatch,
}: {
  perfil: StockReadProfile
  campo: keyof StockReadProfile
  label: string
  nota: string
  onPatch: (patch: Record<string, unknown>) => void
}) {
  const actual = (perfil[campo] as string[] | null) ?? []

  return (
    <Campo label={label}>
      <input
        key={`${String(campo)}-${perfil.id}`}
        defaultValue={actual.join(', ')}
        placeholder="Nombre1, Nombre2…"
        onBlur={(e) => {
          const lista = e.target.value
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
          if (lista.join('\x00') === actual.join('\x00')) return
          onPatch({ [campo]: lista })
        }}
        className={fieldInput}
      />
      <Nota>{nota}</Nota>
    </Campo>
  )
}

/** Igual que Alias pero para las listas de exclusión, que no son columnas */
function ListaTexto({
  perfil,
  campo,
  label,
  nota,
  onPatch,
}: {
  perfil: StockReadProfile
  campo: keyof StockReadProfile
  label: string
  nota: string
  onPatch: (patch: Record<string, unknown>) => void
}) {
  const actual = (perfil[campo] as string[] | null) ?? []

  return (
    <Campo label={label}>
      <input
        key={`${String(campo)}-${perfil.id}`}
        defaultValue={actual.join(', ')}
        placeholder="Vacío = no se excluye nada"
        onBlur={(e) => {
          const lista = e.target.value
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
          if (lista.join('\x00') === actual.join('\x00')) return
          onPatch({ [campo]: lista })
        }}
        className={fieldInput}
      />
      <Nota>{nota}</Nota>
    </Campo>
  )
}

/* ------------------------------------------------------------------ */
/* Lectura de números                                                  */
/* ------------------------------------------------------------------ */

/**
 * Coma o punto, los dos valen: se teclea con el teclado que se tenga.
 * `null` = campo vacío a propósito; `undefined` = no es un número, así que se
 * descarta la edición sin guardar nada. Mismo criterio que empleados.
 */
function parseDecimal(raw: string): number | null | undefined {
  const v = raw.trim()
  if (v === '') return null
  const n = Number(v.replace(',', '.'))
  return Number.isFinite(n) ? n : undefined
}

function guardarDecimal(
  raw: string,
  actual: number | null,
  guardar: (v: number | null) => void
): void {
  const parsed = parseDecimal(raw)
  if (parsed === undefined) return
  if (parsed !== null && parsed < 0) return
  if ((actual ?? null) === parsed) return
  guardar(parsed)
}

function guardarEntero(
  raw: string,
  actual: number | null,
  guardar: (v: number | null) => void
): void {
  const parsed = parseDecimal(raw)
  if (parsed === undefined) return
  if (parsed !== null && (parsed < 0 || !Number.isInteger(parsed))) return
  if ((actual ?? null) === parsed) return
  guardar(parsed)
}
