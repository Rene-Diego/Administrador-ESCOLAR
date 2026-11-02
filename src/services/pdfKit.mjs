// Utilidades para generar PDFs con pdf-lib (JavaScript puro: no necesita Chrome ni dependencias del sistema).
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import fs from 'fs';
import path from 'path';

// ---------- texto ----------
const EXTRAS_WINANSI = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ'.split(''));

// Las fuentes estándar solo soportan WinAnsi: se descartan emojis y símbolos raros para que no truene.
export function limpiar(t) {
  return String(t ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .split('')
    .map(c => (c.charCodeAt(0) <= 255 || EXTRAS_WINANSI.has(c) ? c : '?'))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

export function color(c, porDefecto = '#000000') {
  let s = String(c || porDefecto).trim();
  let m = s.match(/^#?([0-9a-f]{3})$/i);
  if (m) s = '#' + m[1].split('').map(x => x + x).join('');
  m = s.match(/^#?([0-9a-f]{6})$/i);
  if (m) {
    const n = parseInt(m[1], 16);
    return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
  }
  m = s.match(/^hsl\(\s*([\d.]+)[,\s]+([\d.]+)%[,\s]+([\d.]+)%\s*\)$/i);
  if (m) {
    const h = +m[1] / 360, sat = +m[2] / 100, l = +m[3] / 100;
    const q = l < 0.5 ? l * (1 + sat) : l + sat - l * sat, p = 2 * l - q;
    const f = t => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
    return rgb(f(h + 1 / 3), f(h), f(h - 1 / 3));
  }
  return color(porDefecto === s ? '#000000' : porDefecto);
}

export function ajustar(font, size, texto, maxW) {
  const palabras = limpiar(texto).split(' ').filter(Boolean);
  const lineas = [];
  let actual = '';
  const cabe = t => font.widthOfTextAtSize(t, size) <= maxW;
  for (let p of palabras) {
    while (!cabe(p) && p.length > 1) { // palabra más ancha que la celda: se parte
      let n = p.length - 1;
      while (n > 1 && !cabe(p.slice(0, n))) n--;
      if (actual) { lineas.push(actual); actual = ''; }
      lineas.push(p.slice(0, n));
      p = p.slice(n);
    }
    const prueba = actual ? `${actual} ${p}` : p;
    if (cabe(prueba)) actual = prueba;
    else { lineas.push(actual); actual = p; }
  }
  if (actual) lineas.push(actual);
  return lineas.length ? lineas : [''];
}

// ---------- documento ----------
export async function crearDocumento() {
  const doc = await PDFDocument.create();
  const fonts = {
    r: await doc.embedFont(StandardFonts.Helvetica),
    b: await doc.embedFont(StandardFonts.HelveticaBold)
  };
  let encabezado = null;
  try {
    const bytes = fs.readFileSync(path.resolve('img/encabesado.jpg'));
    encabezado = await doc.embedJpg(bytes);
  } catch (e) {
    console.error('No se pudo cargar img/encabesado.jpg:', e.message);
  }
  return { doc, fonts, encabezado };
}

// Texto centrado en un rango [x, x+w]
export function textoCentrado(page, font, size, texto, x, w, y, col = rgb(0, 0, 0)) {
  const t = limpiar(texto);
  const tw = font.widthOfTextAtSize(t, size);
  page.drawText(t, { x: x + (w - tw) / 2, y, size, font, color: col });
}

// Párrafo con segmentos en negrita/normal que se ajusta al ancho. Devuelve la y final.
export function parrafoRico(page, fonts, segmentos, x, y, maxW, size, interlineado, col = rgb(0.2, 0.2, 0.2)) {
  const palabras = [];
  segmentos.forEach(s => limpiar(s.t).split(' ').filter(Boolean).forEach(w => palabras.push({ w, b: !!s.b })));
  let linea = [], ancho = 0;
  const espacio = fonts.r.widthOfTextAtSize(' ', size);
  const volcar = () => {
    let cx = x;
    linea.forEach(p => {
      const f = p.b ? fonts.b : fonts.r;
      page.drawText(p.w, { x: cx, y, size, font: f, color: col });
      cx += f.widthOfTextAtSize(p.w, size) + espacio;
    });
    y -= interlineado; linea = []; ancho = 0;
  };
  palabras.forEach(p => {
    const pw = (p.b ? fonts.b : fonts.r).widthOfTextAtSize(p.w, size);
    if (linea.length && ancho + espacio + pw > maxW) volcar();
    ancho += (linea.length ? espacio : 0) + pw;
    linea.push(p);
  });
  if (linea.length) volcar();
  return y;
}

/**
 * Dibuja una tabla. ctx = { doc, page, y, margenInferior, nuevaPagina?: (ctx)=>void }
 * columnas: [{ ancho, titulo }]; filas: [[celda,...]] con celda = string | { t, bg, fg, bold, barra, align }
 * Devuelve la altura total ocupada si solo se mide (medir=true), o dibuja y deja ctx.y al final.
 */
export function tabla(ctx, fonts, x, columnas, filas, o = {}) {
  const fs = o.fs ?? 8, pad = o.pad ?? 3, borde = color(o.borde ?? '#d1d5db');
  const hFs = o.hFs ?? fs, hPad = o.hPad ?? pad;
  const lh = fs * 1.18;
  const medirFila = fila => Math.max(...fila.map((c, i) => {
    const cel = typeof c === 'object' ? c : { t: c };
    const lineas = ajustar(cel.bold ? fonts.b : fonts.r, fs, cel.mayus ? String(cel.t).toUpperCase() : cel.t, columnas[i].ancho - 2 * pad - (cel.barra ? 3 : 0));
    return lineas.length * lh + 2 * pad;
  }), fs * 1.18 + 2 * pad);
  const hHead = hFs * 1.18 + 2 * hPad;
  const alturas = filas.map(medirFila);
  if (o.medir) return hHead + alturas.reduce((a, b) => a + b, 0);

  const totalW = columnas.reduce((a, c) => a + c.ancho, 0);
  const dibujarCabecera = () => {
    let cx = x;
    columnas.forEach(c => {
      ctx.page.drawRectangle({ x: cx, y: ctx.y - hHead, width: c.ancho, height: hHead, color: color(o.headBg ?? '#7a1c34'), borderColor: borde, borderWidth: 0.5 });
      textoCentrado(ctx.page, fonts.b, hFs, c.titulo, cx, c.ancho, ctx.y - hHead + hPad + hFs * 0.2, rgb(1, 1, 1));
      cx += c.ancho;
    });
    ctx.y -= hHead;
  };
  dibujarCabecera();

  filas.forEach((fila, r) => {
    const h = alturas[r];
    if (ctx.y - h < (ctx.margenInferior ?? 30) && ctx.nuevaPagina) { ctx.nuevaPagina(ctx); dibujarCabecera(); }
    let cx = x;
    fila.forEach((c, i) => {
      const cel = typeof c === 'object' ? c : { t: c };
      const w = columnas[i].ancho;
      const bg = cel.bg ?? (o.cebra && r % 2 === 1 ? '#f9f9f9' : '#ffffff');
      ctx.page.drawRectangle({ x: cx, y: ctx.y - h, width: w, height: h, color: color(bg), borderColor: borde, borderWidth: 0.5 });
      if (cel.barra) ctx.page.drawRectangle({ x: cx, y: ctx.y - h, width: 3, height: h, color: color(cel.barra) });
      const font = cel.bold ? fonts.b : fonts.r;
      const off = cel.barra ? 3 : 0;
      const lineas = ajustar(font, fs, cel.mayus ? String(cel.t).toUpperCase() : cel.t, w - 2 * pad - off);
      const bloque = lineas.length * lh;
      let ty = ctx.y - (h - bloque) / 2 - fs * 0.92;
      lineas.forEach(l => {
        const lw = font.widthOfTextAtSize(l, fs);
        const tx = cel.align === 'left' ? cx + pad + off : cx + off + (w - off - lw) / 2;
        ctx.page.drawText(l, { x: tx, y: ty, size: fs, font, color: color(cel.fg ?? '#2b1b1f') });
        ty -= lh;
      });
      cx += w;
    });
    ctx.y -= h;
  });
  return totalW;
}
