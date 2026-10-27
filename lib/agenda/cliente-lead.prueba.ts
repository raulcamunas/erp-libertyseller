import {
  camposDelEnlace,
  contactoDelLead,
  datosDeLaCitaDesdeLead,
  enlaceDesdeLead,
  idDelLeadEnlazado,
  pareceEmpresa,
  type LeadParaLaCita,
} from './cliente-lead'
import { camposDeUnaCita, cuerpoDeLosCampos, traerDatosDelLead } from './formulario'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/** Un lead vacío al que se le ponen solo los campos que importan en cada prueba */
const lead = (campos: Partial<LeadParaLaCita> = {}): LeadParaLaCita => ({
  id: 'l1', store_name: 'Casa Luz', company: null, phone: null, email: null, decisor: null, directors: null, web: null, seller_url: null, ciudad: null, province: null,
  category: null, plataforma: null, n_productos: null, anos_tienda: null, cif: null, revenue_monthly: null, tipo_lead: 'tienda_online', vende_en_amazon: 'sin_comprobar',
  status: 'pendiente', source_list: null, assigned_to: null, nivel: null, telefonos_extra: null, emails_extra: null, ...campos,
})

console.log('\n=== a quién se llama: el nombre del contacto ===')
{
  ok('tienda online con decisor: el decisor, con mayúsculas legibles', contactoDelLead(lead({ decisor: 'PEDRO LUIS REDONDO CARRILERO' })) === 'Pedro Luis Redondo Carrilero')
  ok('tienda sin decisor (seis de cada diez): el nombre de la tienda', contactoDelLead(lead({ decisor: null })) === 'Casa Luz')
  ok('un decisor vacío o con espacios cuenta como ninguno', contactoDelLead(lead({ decisor: '   ' })) === 'Casa Luz')
  ok('si quien figura es otra empresa, la tienda', contactoDelLead(lead({ decisor: 'INVERSIONES NORTE SL' })) === 'Casa Luz')
  ok('vendedor de Amazon: el primer directivo', contactoDelLead(lead({ tipo_lead: 'seller_amazon', directors: 'NARRO GARCIA JULIAN (Administrador solidario); VALERO NAVARRO JUAN JOSE (Administrador solidario)' })) === 'Narro Garcia Julian')
  ok('vendedor cuyo directivo es una sociedad: la tienda', contactoDelLead(lead({ tipo_lead: 'seller_amazon', directors: 'GRUPO ROCA SLU (Administrador único)' })) === 'Casa Luz')
  ok('sin tienda ni persona, la razón social', contactoDelLead(lead({ store_name: '', company: 'Luz del Sur SL' })) === 'Luz del Sur SL')
  ok('reconoce las formas societarias', pareceEmpresa('Hermanos Pérez CB') && pareceEmpresa('Foo S.L.') && pareceEmpresa('Foo Ltd') && !pareceEmpresa('Ana Solís') && !pareceEmpresa('SL'))
}

console.log('\n=== lo que el lead aporta a la cita ===')
{
  const d = datosDeLaCitaDesdeLead(
    lead({
      decisor: 'ANA SOLIS', company: 'Luz del Sur SL', phone: '600 11 22 33', email: 'info@casaluz.es', web: 'https://casaluz.es', plataforma: 'PrestaShop', n_productos: 112.4, anos_tienda: 7.7,
      category: 'Hogar', ciudad: 'Albacete', cif: 'B12345678', vende_en_amazon: 'no_vende',
    })
  )
  ok('nombre, empresa, teléfono y correo', d.lead_name === 'Ana Solis' && d.lead_company === 'Casa Luz' && d.lead_phone === '600 11 22 33' && d.lead_email === 'info@casaluz.es', JSON.stringify(d))
  ok('razón social y CIF', d.razon_social === 'Luz del Sur SL' && d.cif === 'B12345678')
  ok('los datos de la tienda, con los mismos nombres que la cita', d.web === 'https://casaluz.es' && d.plataforma === 'PrestaShop' && d.n_productos === 112 && d.anos_tienda === 7.7 && d.sector === 'Hogar' && d.ciudad === 'Albacete')
  ok('una tienda que NO vende conserva esa respuesta', d.vende_en_amazon === 'no_vende')
  ok('el lead no sabía el link de Amazon ni la facturación: no aparecen', !('amazon_link' in d) && !('revenue_amount' in d))
}
{
  const d = datosDeLaCitaDesdeLead(lead({ tipo_lead: 'seller_amazon', seller_url: 'https://www.amazon.es/sp?seller=A1', revenue_monthly: 42500, province: 'Madrid', directors: 'ROY LOPEZ ANA (Administrador único)' }))
  ok('un vendedor de Amazon vende en Amazon (aunque el campo diga «sin comprobar»)', d.vende_en_amazon === 'vende')
  ok('trae su facturación y el enlace a su tienda de Amazon', d.revenue_amount === 42500 && d.amazon_link === 'https://www.amazon.es/sp?seller=A1')
  ok('y la provincia como ciudad cuando no hay ciudad', d.ciudad === 'Madrid')
}
{
  const d = datosDeLaCitaDesdeLead(lead({ province: 'Europe' }))
  ok('«Europe» no es una provincia: no se trae como ciudad', !('ciudad' in d))
  ok('una facturación de 0 no se trae (0 no es un dato)', !('revenue_amount' in datosDeLaCitaDesdeLead(lead({ revenue_monthly: 0 }))))
  const e = datosDeLaCitaDesdeLead(lead({ phone: '', telefonos_extra: '611 22 33 44; 91 000 00 00', email: null, emails_extra: 'b@x.es, c@x.es' }))
  ok('sin teléfono principal, el primero de los extra', e.lead_phone === '611 22 33 44')
  ok('sin correo principal, el primero de los extra', e.lead_email === 'b@x.es')
  ok('solo lo que sabe: un lead casi vacío trae nombre, empresa y la respuesta de Amazon', Object.keys(datosDeLaCitaDesdeLead(lead())).sort().join() === 'lead_company,lead_name,vende_en_amazon')
}

console.log('\n=== traer los datos a la ficha ===')
{
  const vacia = camposDeUnaCita(null)
  const t = traerDatosDelLead(vacia, datosDeLaCitaDesdeLead(lead({ decisor: 'ANA SOLIS', phone: '600 11 22 33', revenue_monthly: 12500.5, n_productos: 40, anos_tienda: 3.5, vende_en_amazon: 'no_vende' })))
  ok('rellena los campos de la ficha', t.campos.leadName === 'Ana Solis' && t.campos.leadPhone === '600 11 22 33' && t.campos.vendeEnAmazon === 'no_vende')
  ok('los números llegan como texto de campo', t.campos.revenueAmount === '12500.5' && t.campos.nProductos === '40' && t.campos.anosTienda === '3.5', JSON.stringify(t.campos))
  ok('dice qué ha traído', t.cambiados.includes('Teléfono') && t.cambiados.includes('Facturación') && t.cambiados.includes('¿Vende en Amazon?'), t.cambiados.join())
  ok('no toca lo que el lead no sabe (las notas siguen vacías, el estado igual)', t.campos.notes === '' && t.campos.status === 'scheduled')

  const escrita = { ...vacia, leadEmail: 'otro@correo.es', notes: 'Pidió que le llamen por la tarde', vendeEnAmazon: 'vende' as const }
  const t2 = traerDatosDelLead(escrita, datosDeLaCitaDesdeLead(lead({ email: null, vende_en_amazon: 'sin_comprobar' })))
  ok('un lead sin correo no borra el que ya estaba escrito', t2.campos.leadEmail === 'otro@correo.es')
  ok('las notas de la cita no se tocan nunca', t2.campos.notes === 'Pidió que le llamen por la tarde')
  ok('«sin comprobar» no pisa una respuesta ya dada', t2.campos.vendeEnAmazon === 'vende')
  const t3 = traerDatosDelLead(escrita, datosDeLaCitaDesdeLead(lead({ email: 'info@casaluz.es' })))
  ok('un correo que el lead sí tiene pisa el escrito (se eligió ese lead)', t3.campos.leadEmail === 'info@casaluz.es')
  const t4 = traerDatosDelLead(t.campos, datosDeLaCitaDesdeLead(lead({ decisor: 'ANA SOLIS', phone: '600 11 22 33', revenue_monthly: 12500.5, n_productos: 40, anos_tienda: 3.5, vende_en_amazon: 'no_vende' })))
  ok('traerlo otra vez no cambia nada y no dice que haya cambiado nada', t4.cambiados.length === 0)
}

console.log('\n=== lo que se manda al guardar (igual que antes) ===')
{
  const c = cuerpoDeLosCampos({ ...camposDeUnaCita(null), leadName: '  Casa Luz ', revenueAmount: '12,5', nProductos: '40', anosTienda: '7,7', web: ' ', cif: ' B1 ' })
  ok('el nombre sin espacios sobrantes', c.lead_name === 'Casa Luz')
  ok('los vacíos son null y no cadenas vacías', c.lead_email === null && c.web === null && c.notes === null && c.call_date === null)
  ok('la coma decimal pasa a punto', c.revenue_amount === 12.5 && c.anos_tienda === 7.7 && c.n_productos === 40)
  ok('el CIF sin espacios', c.cif === 'B1')
  ok('«sin comprobar» por defecto (nunca «no vende» sin que nadie lo haya mirado)', c.vende_en_amazon === 'sin_comprobar')
  ok('los datos de la tienda se mandan siempre', 'razon_social' in c && 'plataforma' in c && 'sector' in c && 'ciudad' in c)
}
{
  const cita: any = { lead_name: 'X', lead_email: 'a@b.es', revenue_amount: 100, n_productos: 5, anos_tienda: 2.5, vende_en_amazon: 'no_vende', status: 'confirmed', call_date: '2026-10-28', notes: 'n' }
  const f = camposDeUnaCita(cita)
  ok('los campos de una cita existente se leen tal cual', f.leadName === 'X' && f.revenueAmount === '100' && f.nProductos === '5' && f.anosTienda === '2.5' && f.status === 'confirmed' && f.callDate === '2026-10-28')
  ok('y se vuelven a mandar tal cual (ida y vuelta sin cambios)', JSON.stringify({ a: cuerpoDeLosCampos(f).revenue_amount, b: cuerpoDeLosCampos(f).anos_tienda }) === JSON.stringify({ a: 100, b: 2.5 }))
}

console.log('\n=== el enlace de la cita con el lead ===')
{
  ok('una cita enlazada a Cold Calling devuelve el id del lead', idDelLeadEnlazado({ lead_source: 'cold_calling', lead_ref_id: 'l1' }) === 'l1')
  ok('una de la web NO: su lead_ref_id es de otra tabla', idDelLeadEnlazado({ lead_source: 'web', lead_ref_id: 'w9' }) === null)
  ok('ni una manual sin id', idDelLeadEnlazado({ lead_source: 'manual', lead_ref_id: null }) === null && idDelLeadEnlazado({}) === null)
  ok('cita nueva con lead: lo marca', JSON.stringify(camposDelEnlace(null, 'l1')) === JSON.stringify({ lead_source: 'cold_calling', lead_ref_id: 'l1' }))
  ok('cita nueva sin lead: no manda nada (la ruta pone «manual»)', JSON.stringify(camposDelEnlace(null, null)) === '{}')
  ok('enlazada y sin tocar: no manda nada', JSON.stringify(camposDelEnlace('l1', 'l1')) === '{}')
  ok('cambiada de lead: el nuevo', JSON.stringify(camposDelEnlace('l1', 'l2')) === JSON.stringify({ lead_source: 'cold_calling', lead_ref_id: 'l2' }))
  ok('desenlazada: vuelve a manual y sin id', JSON.stringify(camposDelEnlace('l1', null)) === JSON.stringify({ lead_source: 'manual', lead_ref_id: null }))
  const e = enlaceDesdeLead({ id: 'l1', store_name: 'Casa Luz', company: 'X SL', status: 'seguimiento', source_list: 'No Amazon V1', assigned_to: 'u1' })
  ok('el enlace guarda lo que se enseña: tienda, estado, lista y responsable', e.nombre === 'Casa Luz' && e.estado === 'seguimiento' && e.lista === 'No Amazon V1' && e.responsable === 'u1')
}

console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
