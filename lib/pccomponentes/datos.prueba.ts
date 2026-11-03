import { cuentaDeRespuesta, cuerpoDeOF24, eanValido, erroresDeOferta, importacionDeRespuesta, limpiarEan, ofertaDeRespuesta, productoDeRespuesta } from '@/lib/pccomponentes/datos'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

console.log('\n=== la cuenta no deja pasar nada sensible ===')
{
  const cruda = {
    shop_id: 2394, shop_name: 'EnTrAIS', shop_state: 'OPEN', channels: ['WEB_ES', 'WEB_PT'], currency_iso_code: 'EUR', offers_count: 1, orders_count: 7047, grade: 4.5, approval_rate: 0.9146,
    billing_info: { iban: 'ES0000000000000000000000', owner: 'Titular' },
    contact_informations: { email: 'alguien@x.com', phone: '600000000' },
    shop_additional_fields: [{ code: 'gprs', value: 'texto legal larguísimo' }],
    shippings: [{ shipping_type_label: 'Express (24-48 horas)', shipping_zone_label: 'España peninsular', shipping_free_amount: 50 }, { shipping_type_code: 'standard2-3', shipping_zone_code: 'baleares', shipping_free_amount: null }],
  }
  const c = cuentaDeRespuesta(cruda)
  const texto = JSON.stringify(c)
  ok('se queda con lo que se enseña', c.nombre === 'EnTrAIS' && c.estado === 'OPEN' && c.pedidos === 7047 && c.canales.length === 2 && c.tasaAprobacion === 0.9146)
  ok('el IBAN, el contacto y los textos legales NO están en el resultado', !texto.includes('ES0000') && !texto.includes('alguien@x.com') && !texto.includes('600000000') && !texto.includes('legal'))
  ok('los envíos llevan su zona y su envío gratis', c.envios[0].gratisDesde === 50 && c.envios[1].zona === 'baleares' && c.envios[1].gratisDesde === null)
  ok('una respuesta vacía no revienta', cuentaDeRespuesta(null).nombre === 'Sin nombre' && cuentaDeRespuesta('x').ofertas === 0)
}

console.log('\n=== una oferta de Mirakl ===')
{
  const o = ofertaDeRespuesta({
    offer_id: 298776454, shop_sku: 'x670eaorus', product_sku: 10595110, product_title: 'Gigabyte X670E AORUS XTREME', product_brand: 'Gigabyte', category_label: 'Placas Base',
    product_references: [{ reference: 'gigabyte_x670e-aorus-xtreme', reference_type: 'MPN' }, { reference: '4719331848774', reference_type: 'EAN' }],
    price: 729.0, applicable_pricing: { price: 729.0, unit_origin_price: 729.0 }, quantity: 1, state_code: '1', active: true, inactivity_reasons: [], channels: ['WEB_ES'],
    leadtime_to_ship: 0, logistic_class: { code: 'medio' }, offer_additional_fields: [{ code: 'canon', value: '0' }, { code: 'tipo-iva', value: '21' }],
  })
  ok('SKU, EAN, MPN y producto', o.sku === 'x670eaorus' && o.ean === '4719331848774' && o.mpn === 'gigabyte_x670e-aorus-xtreme' && o.productoId === '10595110')
  ok('precio, stock y estado', o.precio === 729 && o.cantidad === 1 && o.activa && o.estadoProducto === '1')
  ok('los campos propios de PcComponentes', o.adicionales['tipo-iva'] === '21' && o.adicionales.canon === '0' && o.claseLogistica === 'medio')
  const raro = ofertaDeRespuesta({ shop_sku: 'a', quantity: -3, price: '12,5', inactivity_reasons: [{ code: 'SIN_STOCK' }, 'OTRO'] })
  ok('una cantidad negativa se queda en 0, el precio con coma se lee y los motivos se aplanan', raro.cantidad === 0 && raro.precio === 12.5 && raro.motivosInactiva.join() === 'SIN_STOCK,OTRO')
}

console.log('\n=== un producto del catálogo ===')
{
  const p = productoDeRespuesta({ product_sku: 10595110, product_title: 'Gigabyte', product_references: [{ reference_type: 'EAN', reference: '4719331848774' }], offers: [{ total_price: 549.99 }, { price: 729 }] })
  ok('cuántas tiendas lo venden y el precio más bajo', p.ofertas === 2 && p.precioMinimo === 549.99 && p.ean === '4719331848774')
}

console.log('\n=== una importación ===')
{
  const i = importacionDeRespuesta({ import_id: 123, status: 'COMPLETE', lines_read: 1, lines_in_success: 0, lines_in_error: 1, offer_inserted: 0, has_error_report: true, reason_status: null })
  ok('terminada, con su error', i.id === '123' && i.terminada && i.lineasConError === 1 && i.hayInformeDeErrores)
  ok('una que sigue en marcha no está terminada', !importacionDeRespuesta({ import_id: 1, status: 'SENT' }).terminada)
}

console.log('\n=== el EAN ===')
{
  ok('un EAN-13 correcto pasa', eanValido('4719331848774'))
  ok('con el dígito de control mal, no', !eanValido('4719331848775'))
  ok('letras o longitud rara, no', !eanValido('47193318487AB') && !eanValido('12345'))
  ok('limpia espacios y el «.0» de Excel', limpiarEan(' 4719331848774.0 ') === '4719331848774' && limpiarEan('basura') === null && limpiarEan(null) === null)
}

console.log('\n=== lo que se manda (OF24) ===')
{
  const buena = { sku: 'x1', ean: '4719331848774', precio: 99.9, cantidad: 0 }
  ok('una oferta correcta no tiene errores', erroresDeOferta(buena).length === 0)
  ok('sin SKU, con EAN falso, precio 0, 3 decimales o cantidad con decimales, hay errores', erroresDeOferta({ ...buena, sku: ' ' }).length === 1 && erroresDeOferta({ ...buena, ean: '1234567890123' }).length === 1 && erroresDeOferta({ ...buena, precio: 0 }).length >= 1 && erroresDeOferta({ ...buena, precio: 10.123 }).length === 1 && erroresDeOferta({ ...buena, cantidad: 1.5 }).length === 1)
  const c = cuerpoDeOF24([{ ...buena, canon: 3.5, plazoEnvioDias: 2 }])
  const of = c.offers[0]
  ok('manda TODOS los campos que importan (Mirakl reinicia los que faltan)', of.shop_sku === 'x1' && of.product_id === '4719331848774' && of.product_id_type === 'EAN' && of.price === 99.9 && of.quantity === 0 && of.state_code === '1' && of.update_delete === 'update' && of.leadtime_to_ship === 2 && of.logistic_class === 'medio')
  ok('IVA y canon van como campos adicionales, con su valor en texto', JSON.stringify(of.offer_additional_fields) === JSON.stringify([{ code: 'tipo-iva', value: '21' }, { code: 'canon', value: '3.5' }]))
  let msg = ''
  try { cuerpoDeOF24([{ ...buena, ean: '1' }]) } catch (e) { msg = (e as Error).message }
  ok('una oferta mala aborta el envío entero, diciendo cuál', msg.startsWith('x1:') && msg.includes('EAN'), msg)
  let vacio = ''
  try { cuerpoDeOF24([]) } catch (e) { vacio = (e as Error).message }
  ok('no se manda un envío vacío', vacio.includes('ninguna'))
}

console.log(fallos === 0 ? '\nTODO BIEN' : `\n${fallos} FALLOS`)
process.exit(fallos === 0 ? 0 : 1)
