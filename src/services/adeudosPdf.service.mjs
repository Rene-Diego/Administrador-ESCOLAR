import { rgb } from 'pdf-lib';
import { crearDocumento, textoCentrado, parrafoRico, tabla, color, limpiar } from './pdfKit.mjs';

const W = 595, H = 842, M = 42; // A4 vertical

export async function generarPdfAdeudosOSinAdeudos({ matricula, adeudos, alumnoInfo }) {
  const { doc, fonts } = await crearDocumento();
  const rojo = color('#8B0000');
  let page = doc.addPage([W, H]);
  const ctx = { doc, page, y: H - M, margenInferior: M + 20, nuevaPagina: c => { c.page = doc.addPage([W, H]); c.y = H - M; } };

  const pendientes = (adeudos || []).filter(a => (a.estatus ? a.estatus.toLowerCase() : 'pendiente') === 'pendiente');
  const tieneAdeudos = pendientes.length > 0;
  const nombre = alumnoInfo ? `${alumnoInfo.nombre || ''} ${alumnoInfo.apellido || ''}`.trim() : '';
  const fecha = new Date().toLocaleDateString('es-MX', { timeZone: 'America/Mexico_City' });

  // Encabezado
  textoCentrado(ctx.page, fonts.b, 16, 'ESCUELA PREPARATORIA OFICIAL NÚM. 219', 0, W, ctx.y - 12, rojo);
  textoCentrado(ctx.page, fonts.r, 10, 'SISTEMA DE CONTROL ESCOLAR Y GESTIÓN DE ADEUDOS', 0, W, ctx.y - 28, rgb(0.33, 0.33, 0.33));
  ctx.page.drawLine({ start: { x: M, y: ctx.y - 38 }, end: { x: W - M, y: ctx.y - 38 }, thickness: 1.5, color: rojo });
  ctx.y -= 62;

  // Datos del alumno
  const datos = [['Nombre del Alumno:', nombre || 'Estudiante'], ['Matrícula:', String(matricula)]];
  if (alumnoInfo) datos.push(['Grado y Grupo:', `${alumnoInfo.grado}° "${alumnoInfo.grupo}"`]);
  datos.push(['Fecha de Emisión:', fecha]);
  const altoCaja = datos.length * 16 + 14;
  ctx.page.drawRectangle({ x: M, y: ctx.y - altoCaja, width: W - 2 * M, height: altoCaja, color: color('#f9f9f9'), borderColor: color('#dddddd'), borderWidth: 0.8 });
  datos.forEach(([k, v], i) => {
    const yy = ctx.y - 18 - i * 16;
    ctx.page.drawText(limpiar(k), { x: M + 10, y: yy, size: 10, font: fonts.b, color: rgb(0.2, 0.2, 0.2) });
    ctx.page.drawText(limpiar(v), { x: M + 10 + fonts.b.widthOfTextAtSize(limpiar(k), 10) + 5, y: yy, size: 10, font: fonts.r, color: rgb(0.2, 0.2, 0.2) });
  });
  ctx.y -= altoCaja + 26;

  if (tieneAdeudos) {
    textoCentrado(ctx.page, fonts.b, 13, `REPORTE DE ADEUDOS PENDIENTES - ${matricula}`, 0, W, ctx.y, rojo);
    ctx.y -= 18;
    ctx.y = parrafoRico(ctx.page, fonts, [{ t: 'El alumno cuenta con los siguientes adeudos registrados en las diferentes áreas de la institución:' }], M, ctx.y, W - 2 * M, 10, 13, rgb(0.33, 0.33, 0.33)) - 6;
    const anchoT = W - 2 * M;
    const cols = [
      { ancho: anchoT * 0.22, titulo: 'Departamento' }, { ancho: anchoT * 0.33, titulo: 'Concepto' },
      { ancho: anchoT * 0.14, titulo: 'Cantidad' }, { ancho: anchoT * 0.17, titulo: 'Fecha' }, { ancho: anchoT * 0.14, titulo: 'Estatus' }
    ];
    tabla(ctx, fonts, M, cols, pendientes.map(a => [
      { t: a.departamento || '-', align: 'left' }, { t: a.concepto || '-', align: 'left' },
      { t: `$${parseFloat(a.cantidad || 0).toFixed(2)}` }, { t: a.fecha ? String(a.fecha).split('T')[0] : '-' },
      { t: 'PENDIENTE', fg: '#d9534f', bold: true }
    ]), { fs: 9, pad: 6, hFs: 9, hPad: 6, headBg: '#8B0000', borde: '#dddddd' });
    ctx.y -= 24;
    textoCentrado(ctx.page, fonts.r, 9, 'Nota: Favor de acudir al departamento correspondiente para realizar su aclaración o pago.', 0, W, ctx.y, rgb(0.47, 0.47, 0.47));
  } else {
    // Constancia de no adeudo
    const top = ctx.y, alto = 330, x = M, w = W - 2 * M;
    ctx.page.drawRectangle({ x, y: top - alto, width: w, height: alto, borderColor: rojo, borderWidth: 2 });
    textoCentrado(ctx.page, fonts.b, 15, `CONSTANCIA DE NO ADEUDO - ${matricula}`, x, w, top - 34, rojo);
    ctx.page.drawText('A quien corresponda:', { x: x + 28, y: top - 70, size: 11.5, font: fonts.r, color: rgb(0.2, 0.2, 0.2) });
    const grado = alumnoInfo ? `${alumnoInfo.grado}° grado, grupo "${alumnoInfo.grupo}"` : '---';
    parrafoRico(ctx.page, fonts, [
      { t: 'La Dirección y los Departamentos Administrativos de la Escuela Preparatoria Oficial Núm. 219, ' },
      { t: 'HACE CONSTAR', b: true }, { t: ' que el/la alumno(a) ' },
      { t: (nombre || 'mencionado(a)') + ',', b: true }, { t: 'con número de matrícula' },
      { t: String(matricula) + ',', b: true }, { t: 'perteneciente al' }, { t: grado + ',', b: true },
      { t: 'NO PRESENTA ADEUDO ALGUNO', b: true },
      { t: ' de carácter financiero, material o documental en ninguna de las áreas de esta institución educativa al día de la fecha.' }
    ], x + 28, top - 96, w - 56, 11.5, 17);
    ctx.y = top - 215;
    parrafoRico(ctx.page, fonts, [{ t: 'Se extiende la presente constancia a petición de la parte interesada para los fines legales y académicos que a su derecho convengan.' }], x + 28, ctx.y, w - 56, 11.5, 17);
    const fy = top - alto + 52;
    ctx.page.drawLine({ start: { x: x + w / 2 - 125, y: fy }, end: { x: x + w / 2 + 125, y: fy }, thickness: 0.8, color: rgb(0, 0, 0) });
    textoCentrado(ctx.page, fonts.b, 10, 'COORDINACIÓN ESCOLAR / ADMINISTRACIÓN', x, w, fy - 14);
  }
  return Buffer.from(await doc.save());
}
