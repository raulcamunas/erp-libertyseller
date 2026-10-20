/**
 * DESDE QUÉ DÍA SE LEE EL LIBRO MAYOR.
 * ====================================
 * PURO. Se comprueba con ventana-lectura.prueba.ts. Lo usan la pasada de la noche
 * (app/api/fba/cron-remesas) y la lectura a mano (app/api/fba/sincronizar).
 *
 * Vivía en ledger.ts, que arrastra el cliente de la API de Amazon y por eso no se
 * puede importar desde una prueba. ledger.ts lo sigue exportando con los mismos nombres.
 */

/** Días que se releen siempre, por encima de lo que falte */
export const SOLAPE_DIAS = 14

/** La primera vez no hay nada: se trae un trimestre para tener contra qué cuadrar */
export const PRIMERA_LECTURA_DIAS = 90

/** Amazon guarda el libro mayor 18 meses. Más atrás no hay nada que pedir */
export const MAXIMO_HISTORICO_DIAS = 540

/**
 * Colchón, en días, ANTES de la fecha de un envío traído a mano.
 *
 * Esa fecha la escribe una persona, o la deduce el diálogo del nombre que Amazon le
 * pone al envío, y la entrada en el almacén es siempre POSTERIOR a ella: si se leyera
 * justo desde ahí, un error de unos días en la fecha dejaría la llegada fuera del
 * tramo leído y las ventas del envío saldrían a cero sin ningún aviso.
 */
export const HOLGURA_FECHA_DE_ENVIO_DIAS = 7

/**
 * Desde qué día hay que leer.
 *
 * LA PRIMERA VEZ SE VA A BUSCAR LA REMESA MÁS ANTIGUA, no 90 días fijos, y esto
 * es lo que decide si una migración de histórico sirve de algo:
 *
 * Al importar las diez remesas de ShoesF, cinco son de mayo —752 de las 1.279
 * unidades—. Con una ventana fija de 90 días la primera lectura empezaría el 20
 * de junio, o sea DESPUÉS de esos cinco envíos: no habría ni un movimiento que
 * los consumiera y el panel los pintaría intactos, como si no se hubiera vendido
 * un par de zapatillas desde mayo. El número sería falso y parecería cierto.
 *
 * Así que la primera vez manda la remesa más antigua, con el tope de lo que
 * Amazon conserva. Las siguientes pasadas ya van desde donde se quedaron.
 */
export function desdeCuandoLeer(
  leidoHasta: string | null,
  hoy: Date,
  remesaMasAntigua?: string | null
): Date {
  const limite = hoy.getTime() - MAXIMO_HISTORICO_DIAS * 86_400_000

  if (!leidoHasta) {
    const porDefecto = hoy.getTime() - PRIMERA_LECTURA_DIAS * 86_400_000
    if (!remesaMasAntigua) return new Date(Math.max(porDefecto, limite))
    // Un día antes de la remesa, para que su propia entrada quede dentro
    const desdeRemesa = Date.parse(`${remesaMasAntigua}T00:00:00Z`) - 86_400_000
    return new Date(Math.max(Math.min(porDefecto, desdeRemesa), limite))
  }

  const ultimo = Date.parse(`${leidoHasta}T00:00:00Z`)
  return new Date(Math.max(ultimo - SOLAPE_DIAS * 86_400_000, limite))
}

/**
 * LA VENTANA DE UNA LECTURA A MANO, la del botón «Leer ventas» de un envío.
 *
 * Parte de la de siempre y la ESTIRA hacia atrás hasta cubrir los envíos de la cuenta
 * cuya llegada el libro mayor todavía no ha confirmado, con HOLGURA_FECHA_DE_ENVIO_DIAS
 * de colchón. Es lo que hace que traer de Amazon un envío antiguo a una cuenta que ya se
 * leía todas las noches sirva de algo: la pasada de la noche relee solo desde donde se
 * quedó menos 14 días, y las ventas de un envío de julio quedarían fuera para siempre.
 *
 * Nunca empieza DESPUÉS de lo que ya habría leído la pasada normal, y no pasa del tope
 * de lo que Amazon conserva.
 *
 * `remesaMasAntigua` solo cuenta la primera vez (sin lectura previa), igual que en
 * desdeCuandoLeer, pero aquí con el colchón: la fecha de esa remesa también la puso
 * una persona. `fechasSinLlegada` son las fechas de envío de los envíos reales que
 * siguen sin día de llegada; con la llegada confirmada el libro ya lo tiene todo y no
 * hace falta ir más atrás.
 */
export function desdeParaLeerAhora(
  leidoHasta: string | null,
  hoy: Date,
  remesaMasAntigua: string | null,
  fechasSinLlegada: readonly string[]
): Date {
  const limite = hoy.getTime() - MAXIMO_HISTORICO_DIAS * 86_400_000
  const colchon = HOLGURA_FECHA_DE_ENVIO_DIAS * 86_400_000

  let desde = desdeCuandoLeer(leidoHasta, hoy, null).getTime()

  const fechas = [...fechasSinLlegada]
  if (!leidoHasta && remesaMasAntigua) fechas.push(remesaMasAntigua)
  for (const f of fechas) {
    const dia = Date.parse(`${f}T00:00:00Z`)
    if (Number.isFinite(dia)) desde = Math.min(desde, dia - colchon)
  }

  return new Date(Math.max(desde, limite))
}
