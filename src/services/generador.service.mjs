import { rgb } from 'pdf-lib';
import { crearDocumento, textoCentrado, tabla, color, limpiar, ajustar } from './pdfKit.mjs';

const FIRMAS = [
  ['MTRA. ERIKA MORENO CONCEPCION', 'SUBDIRECTORA ESCOLAR'],
  ['LIA. ISMAEL MARTINEZ GARCIA', 'SECRETARIO ESCOLAR'],
  ['PROFR. LUCIO GARCIA SANCHEZ', 'DIRECTOR ESCOLAR'],
  ['LIC. MARIA DEL CARMEN NARCIZO BOTHI', 'ORIENTADORA ESCOLAR'],
  ['ING. EDUARDO GARCIA ARELLANO', 'TUTOR']
];

const W = 792, H = 612, M = 28; // Letter horizontal

export async function generarPDF(datosHorario) {
  const horarios = datosHorario.horarios || {};
  const coloresDocentes = datosHorario.coloresDocentes || {};
  const { doc, fonts, encabezado } = await crearDocumento();

  for (const grupo of Object.keys(horarios)) {
    const filas = horarios[grupo] || [];
    const page = doc.addPage([W, H]);
    const ctx = { doc, page, y: H - 14, margenInferior: 20 };

    // Encabezado institucional
    if (encabezado) {
      const alto = 46, ancho = Math.min(W - 2 * M, alto * (encabezado.width / encabezado.height));
      page.drawImage(encabezado, { x: (W - ancho) / 2, y: ctx.y - alto, width: ancho, height: alto });
      ctx.y -= alto + 6;
    }
    ['ESCUELA PREPARATORIA OFICIAL NÚM. 219', '“LIC. RICARDO FLORES MAGÓN”', 'C.C.T 15EBH0407D', 'SALTO LA VENTA, SAN JOSÉ DEL RINCÓN, MÉXICO.']
      .forEach(t => { ctx.y -= 8.5; textoCentrado(page, fonts.b, 7, t, 0, W, ctx.y); });
    ctx.y -= 14;
    textoCentrado(page, fonts.b, 10, `HORARIO DE CLASES DEL ${grupo} DEL CICLO ESCOLAR 2026-2027`.toUpperCase(), 0, W, ctx.y, color('#7a1c34'));
    ctx.y -= 7;

    // Celdas + resumen de materias
    const resumen = {};
    const celda = texto => {
      const val = texto || '';
      const low = val.toLowerCase();
      if (low.includes('receso')) return { t: val, bg: '#fffbeb', fg: '#92400e', bold: true, mayus: true };
      if (low.includes('taller')) return { t: val, bg: '#fef3c7', fg: '#b45309', bold: true, mayus: true };
      const m = val.match(/\(([^)]+)\)/);
      let barra;
      if (m) {
        const docente = m[1].trim();
        barra = coloresDocentes[docente];
        const materia = val.split('(')[0].trim();
        if (materia) {
          resumen[materia] = resumen[materia] || { hrs: 0, docente };
          resumen[materia].hrs += 1;
        }
      }
      return { t: val, barra };
    };
    const filasTabla = filas.map(f => [
      { t: f.hora || '', bg: '#f8fafc', bold: true },
      celda(f.lunes), celda(f.martes), celda(f.miercoles || f['miércoles']), celda(f.jueves), celda(f.viernes)
    ]);
    const anchoTotal = W - 2 * M;
    const wHora = anchoTotal * 0.12, wDia = (anchoTotal - wHora) / 5;
    const columnas = [{ ancho: wHora, titulo: 'HORA' }, ...['LUNES', 'MARTES', 'MIÉRCOLES', 'JUEVES', 'VIERNES'].map(t => ({ ancho: wDia, titulo: t }))];

    // Zona inferior (resumen a la izquierda, firmas a la derecha)
    const materias = Object.entries(resumen);
    const altoFirmas = 3 * 33;
    const wRes = 330;
    const colRes = [{ ancho: wRes * 0.48, titulo: 'MATERIA' }, { ancho: wRes * 0.12, titulo: 'HRS' }, { ancho: wRes * 0.40, titulo: 'DOCENTE' }];
    const filasRes = materias.map(([mat, i]) => [
      { t: mat, align: 'left' }, { t: String(i.hrs), bold: true }, { t: i.docente, align: 'left', barra: coloresDocentes[i.docente] || '#cccccc' }
    ]);
    const optRes = fs => ({ fs, pad: 2, hFs: 7.5, hPad: 2, headBg: '#555555', borde: '#9ca3af' });

    // Reduce la tipografía hasta que tabla + resumen/firmas quepan en la página
    let fsT = 8, fsR = 7.5, altoResumen = 0;
    for (; fsT >= 5; fsT -= 0.5) {
      fsR = Math.min(7.5, fsT);
      altoResumen = tabla(ctx, fonts, M, colRes, filasRes, { ...optRes(fsR), medir: true });
      const hTabla = tabla(ctx, fonts, M, columnas, filasTabla, { fs: fsT, pad: 3, hFs: 8, hPad: 3, medir: true });
      if (ctx.y - hTabla - 10 - Math.max(altoFirmas, altoResumen) >= 20) break;
    }
    fsT = Math.max(fsT, 5);

    tabla(ctx, fonts, M, columnas, filasTabla, { fs: fsT, pad: 3, hFs: 8, hPad: 3 });

    // Zona inferior anclada al fondo de la página
    const base = 20 + Math.max(altoFirmas, altoResumen);
    const ctxRes = { doc, page, y: base };
    tabla(ctxRes, fonts, M, colRes, filasRes, optRes(fsR));

    // Firmas
    const x0 = M + wRes + 26, wTotal = W - M - x0, wF = (wTotal - 16) / 2;
    FIRMAS.forEach(([nombre, cargo], i) => {
      const fila = Math.floor(i / 2);
      const ultima = i === 4;
      const fx = ultima ? x0 + (wTotal - wF) / 2 : x0 + (i % 2) * (wF + 16);
      const fy = base - fila * 33 - 18;
      page.drawLine({ start: { x: fx, y: fy }, end: { x: fx + wF, y: fy }, thickness: 0.8, color: rgb(0.07, 0.07, 0.07) });
      textoCentrado(page, fonts.b, 6.8, nombre, fx, wF, fy - 8);
      textoCentrado(page, fonts.b, 6.8, cargo, fx, wF, fy - 15.5);
    });
  }

  if (!Object.keys(horarios).length) doc.addPage([W, H]);
  return Buffer.from(await doc.save());
}
