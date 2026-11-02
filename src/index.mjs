import 'dotenv/config';
import express from 'express';
import crypto from 'crypto';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import { crearDocumento, textoCentrado, tabla, color } from './services/pdfKit.mjs';

import { generadorController } from './controllers/generador.controller.mjs';
import { maestrosController } from './controllers/maestros.controller.mjs';
import { materiasController } from './controllers/materias.controller.mjs';
import { asignacionesController } from './controllers/asignaciones.controller.mjs';
import { talleresController } from './controllers/talleres.controller.mjs';
import { recesosController } from './controllers/recesos.controller.mjs';
import { descargarPDFController } from './controllers/generador.controller.mjs';
import { alumnosController } from './controllers/alumnos.controller.mjs'; 
import { adeudosController } from './controllers/adeudos.controller.mjs';
import { usuariosController } from './controllers/usuarios.controller.mjs';
import { adeudosPdfController } from './controllers/adeudosPdf.controller.mjs';
import { asistenciasController } from './controllers/asistencias.controller.mjs';

import { semestresService } from './services/semestres.service.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Render está detrás de un proxy: así req.protocol devuelve 'https' y no 'http'
app.set('trust proxy', 1);

// El front vive en Netlify (otro dominio): se permiten sus peticiones y se expone Content-Disposition
app.use(cors({ origin: true, exposedHeaders: ['Content-Disposition'] }));
// El horario completo viaja en el body (chat y PDF); el límite por defecto (100 KB) lo rechazaba con 413
app.use(express.json({ limit: '25mb' }));
app.use(cookieParser());

// Health-check para Render
app.get('/', (req, res) => res.json({ ok: true, servicio: 'API Administrador Escolar EPO 219' }));
app.get('/api/health', (req, res) => res.json({ ok: true }));

// ---------------------------------------------------------------------------
// PDFs temporales del chat. Se guardan en memoria (el disco de Render es efímero
// y no es accesible desde Netlify con una ruta relativa).
// ---------------------------------------------------------------------------
const PDFS_TEMPORALES = new Map();
const VIDA_PDF_MS = 30 * 60 * 1000;

function guardarPdfTemporal(buffer, nombreDescarga) {
  const id = crypto.randomUUID();
  PDFS_TEMPORALES.set(id, { buffer, nombreDescarga, expira: Date.now() + VIDA_PDF_MS });
  return id;
}

setInterval(() => {
  const ahora = Date.now();
  for (const [id, pdf] of PDFS_TEMPORALES) {
    if (pdf.expira < ahora) PDFS_TEMPORALES.delete(id);
  }
}, 5 * 60 * 1000).unref();

app.get('/api/horario-pdf/:id', (req, res) => {
  const pdf = PDFS_TEMPORALES.get(req.params.id);
  if (!pdf) {
    return res.status(404).send('El PDF ya no está disponible. Pídeselo de nuevo al asistente.');
  }
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${pdf.nombreDescarga}"`);
  res.send(pdf.buffer);
});

function verificarSesionYNoCache(req, res, next) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    const token = req.cookies.token_sesion; 
    
    if (!token) {
        return res.status(401).json({ error: 'Acceso no autorizado. Inicia sesión nuevamente.' });
    }

    next();
}

app.post('/api/logout', (req, res) => {
    res.clearCookie('token_sesion');
    res.json({ success: true, message: 'Sesión cerrada correctamente' });
});

app.post('/api/generar-horarios', generadorController.ejecutarGeneracion);
app.post('/api/auditar-horario', generadorController.auditarHorario);


function listarDocentes(datosHorario) {
  const horariosGrupos = datosHorario.horarios || datosHorario;
  const docentesSet = new Set();
  
  for (const [grupo, filasArray] of Object.entries(horariosGrupos)) {
    if (!Array.isArray(filasArray)) continue;
    filasArray.forEach(fila => {
      ['lunes', 'martes', 'miercoles', 'miércoles', 'jueves', 'viernes'].forEach(dia => {
        const celda = fila[dia] || '';
        const match = celda.match(/\(([^)]+)\)/);
        if (match) docentesSet.add(match[1].trim());
      });
    });
  }

  return [...docentesSet].sort((a, b) => a.localeCompare(b, 'es'));
}

function obtenerNombreOficialDocente(busqueda, datosHorario) {
  const docentesSet = new Set(listarDocentes(datosHorario));

  const busquedaClean = (busqueda || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  const palabrasBusqueda = busquedaClean.split(/\s+/).filter(p => p.length > 2);

  if (palabrasBusqueda.length === 0) return null;

  let mejorCandidato = null;
  let maxCoincidencias = 0;

  for (const docente of docentesSet) {
    const docenteClean = docente.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const coincidencias = palabrasBusqueda.filter(p => docenteClean.includes(p)).length;
    if (coincidencias > maxCoincidencias) {
      maxCoincidencias = coincidencias;
      mejorCandidato = docente;
    }
  }

  if (maxCoincidencias < 2 && palabrasBusqueda.length > 1) {
    return null;
  }

  return mejorCandidato;
}

const BLOQUES_OFICIALES = [
  "08:00 AM - 08:50 AM",
  "08:50 AM - 09:40 AM",
  "09:40 AM - 10:30 AM",
  "10:30 AM - 11:20 AM",
  "11:20 AM - 12:10 PM",
  "11:00 AM - 11:50 AM",
  "11:50 AM - 12:40 PM",
  "12:40 PM - 01:30 PM",
  "01:30 PM - 02:20 PM",
  "02:20 PM - 03:10 PM"
];

function construirHorarioDocenteParaPdf(nombreDocenteBuscado, datosHorario) {
  let filasPorHora = {};
  
  BLOQUES_OFICIALES.forEach(hora => {
    filasPorHora[hora] = { hora, lunes: '', martes: '', miercoles: '', jueves: '', viernes: '' };
  });

  const filaExtraKey = "Otras Horas / Adicionales";
  filasPorHora[filaExtraKey] = { hora: filaExtraKey, lunes: '', martes: '', miercoles: '', jueves: '', viernes: '' };

  const nombreOficial = obtenerNombreOficialDocente(nombreDocenteBuscado, datosHorario);
  if (!nombreOficial) return [];

  const horariosGrupos = datosHorario.horarios || datosHorario;

  for (const [grupo, filasArray] of Object.entries(horariosGrupos)) {
    if (!Array.isArray(filasArray)) continue;

    filasArray.forEach(fila => {
      const horaFila = (fila.hora || "").trim();
      
      if (horaFila.toLowerCase().includes("receso")) return;

      const matchHora = horaFila.match(/([0-9]{1,2}:[0-9]{2})/);
      if (!matchHora) return;
      
      const horaInicioFila = matchHora[1];
      const horaInicioNormalizada = horaInicioFila.length === 4 ? "0" + horaInicioFila : horaInicioFila;

      const bloqueEncontrado = BLOQUES_OFICIALES.find(b => {
        const matchBloque = b.match(/([0-9]{2}:[0-9]{2})/);
        return matchBloque && matchBloque[1] === horaInicioNormalizada;
      });

      const destinoKey = bloqueEncontrado || filaExtraKey;
      const dias = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'miércoles'];

      dias.forEach(diaKey => {
        const keyAlternativa = diaKey === 'miercoles' ? 'miércoles' : diaKey;
        const contenidoCelda = fila[diaKey] || fila[keyAlternativa] || '';
        
        const matchParentesis = contenidoCelda.match(/\(([^)]+)\)/);
        if (!matchParentesis) return;

        const docenteEnCelda = matchParentesis[1].trim();

        if (docenteEnCelda === nombreOficial) {
          const nombreMateria = contenidoCelda.split('(')[0].trim();
          const textoClase = `${nombreMateria} (${grupo})`;

          if (filasPorHora[destinoKey][diaKey]) {
            if (!filasPorHora[destinoKey][diaKey].includes(grupo)) {
              filasPorHora[destinoKey][diaKey] += ` / ${textoClase}`;
            }
          } else {
            filasPorHora[destinoKey][diaKey] = textoClase;
          }
        }
      });
    });
  }

  const resultadoOrdenadoYFiltrado = BLOQUES_OFICIALES
    .map(hora => filasPorHora[hora])
    .filter(fila => {
      return ['lunes', 'martes', 'miercoles', 'jueves', 'viernes'].some(dia => fila[dia] !== '');
    });

  if (filasPorHora[filaExtraKey] && ['lunes', 'martes', 'miercoles', 'jueves', 'viernes'].some(dia => filasPorHora[filaExtraKey][dia] !== '')) {
    resultadoOrdenadoYFiltrado.push(filasPorHora[filaExtraKey]);
  }

  return resultadoOrdenadoYFiltrado;
}

function obtenerHorarioDesglosadoParaChat(nombreDocenteBuscado, datosHorario) {
  const nombreOficial = obtenerNombreOficialDocente(nombreDocenteBuscado, datosHorario);
  if (!nombreOficial) return [];

  let listaClases = [];
  const horariosGrupos = datosHorario.horarios || datosHorario;

  for (const [grupo, filasArray] of Object.entries(horariosGrupos)) {
    if (!Array.isArray(filasArray)) continue;

    filasArray.forEach(fila => {
      const horaFila = (fila.hora || "").trim();
      if (horaFila.includes("10:30 AM - 11:00 AM") || horaFila.includes("RECESO")) return;

      const dias = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'miércoles'];

      dias.forEach(diaKey => {
        const contenidoCelda = fila[diaKey] || '';
        const matchParentesis = contenidoCelda.match(/\(([^)]+)\)/);
        if (!matchParentesis) return;

        const docenteEnCelda = matchParentesis[1].trim();

        if (docenteEnCelda === nombreOficial) {
          const nombreMateria = contenidoCelda.split('(')[0].trim();
          listaClases.push({
            dia: diaKey.charAt(0).toUpperCase() + diaKey.slice(1),
            hora: horaFila,
            materia: nombreMateria,
            grupo: grupo
          });
        }
      });
    });
  }

  return listaClases;
}


function formatearCelda(contenido) {
  if (!contenido) return '';
  const partes = contenido.split('/').map(p => p.trim());
  const mapaMaterias = {};
  
  partes.forEach(parte => {
    const match = parte.match(/^(.*?)\s*\(([^)]+)\)$/);
    if (match) {
      const nombreBase = match[1].trim();
      const grupo = match[2].trim();
      if (!mapaMaterias[nombreBase]) {
        mapaMaterias[nombreBase] = [];
      }
      mapaMaterias[nombreBase].push(grupo);
    } else {
      if (!mapaMaterias[parte]) {
        mapaMaterias[parte] = [];
      }
    }
  });

  return Object.entries(mapaMaterias).map(([nombre, grupos]) => {
    if (grupos.length > 0) {
      return `${nombre} (${grupos.join(', ')})`;
    }
    return nombre;
  }).join(' / ');
}

async function generarPdfHorarioDocente({ docente, horarioDocente }) {
  const W = 612, H = 792, M = 28; // Letter vertical
  const { doc, fonts, encabezado } = await crearDocumento();
  const page = doc.addPage([W, H]);
  const ctx = { doc, page, y: H - 20, margenInferior: 30, nuevaPagina: c => { c.page = doc.addPage([W, H]); c.y = H - 30; } };

  if (encabezado) {
    const alto = 56, ancho = Math.min(W - 2 * M, alto * (encabezado.width / encabezado.height));
    page.drawImage(encabezado, { x: (W - ancho) / 2, y: ctx.y - alto, width: ancho, height: alto });
    ctx.y -= alto + 10;
  }
  ctx.y -= 10;
  textoCentrado(page, fonts.b, 11, '“2026. Año del Humanismo Mexicano en el Estado de México”.', 0, W, ctx.y);
  ctx.y -= 8;
  ['ESCUELA PREPARATORIA OFICIAL NÚM. 219', '“LIC. RICARDO FLORES MAGÓN”', 'C.C.T 15EBH0407D', 'SALTO LA VENTA, SAN JOSÉ DEL RINCÓN, MÉXICO.']
    .forEach(t => { ctx.y -= 11; textoCentrado(page, fonts.b, 9, t, 0, W, ctx.y); });
  ctx.y -= 26;
  textoCentrado(page, fonts.b, 12, `HORARIO OFICIAL DEL DOCENTE: ${docente}`.toUpperCase(), 0, W, ctx.y, color('#8B0000'));
  ctx.y -= 14;

  const anchoT = W - 2 * M, wHora = anchoT * 0.21, wDia = (anchoT - wHora) / 5;
  const columnas = [{ ancho: wHora, titulo: 'HORA' }, ...['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes'].map(t => ({ ancho: wDia, titulo: t }))];
  const filas = horarioDocente.map(f => [
    { t: f.hora, bold: true, bg: '#f8f9fa' },
    formatearCelda(f.lunes), formatearCelda(f.martes), formatearCelda(f.miercoles), formatearCelda(f.jueves), formatearCelda(f.viernes)
  ]);
  tabla(ctx, fonts, M, columnas, filas, { fs: 9, pad: 7, hFs: 9, hPad: 7, headBg: '#8B0000', borde: '#dddddd', cebra: true });

  return Buffer.from(await doc.save());
}

app.post('/api/chat-horario', async (req, res) => {
  try {
    const { pregunta, horario } = req.body;
    const datosDelHorarioActual = horario || global.ultimoHorarioGenerado;
    
    if (!datosDelHorarioActual || Object.keys(datosDelHorarioActual).length === 0) {
      return res.status(200).send("Primero debes generar un horario para que pueda responder tus dudas.");
    }
    
    const preguntaLower = (pregunta || "").toLowerCase();
    const preguntaClean = preguntaLower.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

    const palabrasIgnoradas = new Set([
      'genera', 'generar', 'en', 'pdf', 'descargar', 'imprimir', 
      'horario', 'del', 'de', 'la', 'el', 'los', 'las', 'profe', 
      'profesor', 'maestro', 'profra', 'dame', 'imprime', 'al', 'un',
      'que', 'cual', 'es', 'tiene', 'clases', 'trabaja', 'a', 'por', 'favor',
      'quien', 'le', 'da', 'grupo', 'materias', 'horarios', 'docente',
      'docentes', 'maestra', 'profesora', 'profa', 'mtro', 'mtra', 'lic',
      'ing', 'prof', 'para', 'me', 'mi', 'quiero', 'necesito', 'puedes',
      'puede', 'pdf', 'archivo', 'del', 'su', 'se', 'y', 'o', 'oficial',
      'hay', 'tienes', 'dar', 'darme', 'mandame', 'pasame', 'ver', 'muestrame'
    ]);

    let nombreProfesorQuery = preguntaClean
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter(p => !palabrasIgnoradas.has(p))
      .join(' ');

    const nombreOficialEncontrado = obtenerNombreOficialDocente(nombreProfesorQuery, datosDelHorarioActual);

    const pidePdf = (preguntaClean.includes('pdf') || preguntaClean.includes('descargar') || preguntaClean.includes('imprimir'));

    if (pidePdf && !nombreOficialEncontrado) {
      const docentes = listarDocentes(datosDelHorarioActual);
      const lista = docentes.length
        ? `<br><br>Docentes en el horario actual:<br>• ${docentes.join('<br>• ')}`
        : '';
      return res.status(200).send(`No pude identificar a qué docente te refieres. Escribe su nombre y apellido tal como aparece en el horario.${lista}`);
    }

    if (pidePdf && nombreOficialEncontrado) {
      const horarioEstructurado = construirHorarioDocenteParaPdf(nombreOficialEncontrado, datosDelHorarioActual);

      const bufferPdf = await generarPdfHorarioDocente({
        docente: nombreOficialEncontrado.toUpperCase(),
        horarioDocente: horarioEstructurado
      });

      const nombreSeguro = nombreOficialEncontrado.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '');
      const id = guardarPdfTemporal(bufferPdf, `Horario_${nombreSeguro || 'docente'}.pdf`);

      // URL ABSOLUTA hacia Render: una ruta relativa ("/archivo.pdf") apuntaría a Netlify y daría 404
      const enlace = `${req.protocol}://${req.get('host')}/api/horario-pdf/${id}`;

      const enlaceHtml = `¡Listo! He generado el horario oficial en PDF para el profesor(a) <b>${nombreOficialEncontrado.toUpperCase()}</b>.<br><br><a href="${enlace}" target="_blank" rel="noopener" style="background-color: #8B0000; color: white; padding: 10px 15px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">📥 Descargar PDF del Horario</a>`;
      return res.status(200).send(enlaceHtml);
    }

    const esPreguntaGeneralOGrupo = preguntaClean.includes('grupo') || 
                                     preguntaClean.includes('materia') || 
                                     preguntaClean.includes('quien') || 
                                     preguntaClean.includes('imparte') ||
                                     preguntaClean.includes('seguimiento') || 
                                     preguntaClean.includes('egresados') || 
                                     !nombreOficialEncontrado;

    let datosAEnviar = "";
    if (nombreOficialEncontrado && !esPreguntaGeneralOGrupo) {
      const clasesDesglosadas = obtenerHorarioDesglosadoParaChat(nombreOficialEncontrado, datosDelHorarioActual);
      datosAEnviar = JSON.stringify({ profesor: nombreOficialEncontrado, clases: clasesDesglosadas }, null, 2);
    } else {
      datosAEnviar = JSON.stringify(datosDelHorarioActual, null, 2);
    }

    const promptSistema = `Eres el asistente virtual oficial de la escuela EPO 219. Responde de forma breve, clara y directa a la pregunta del usuario basándote EXCLUSIVAMENTE en la siguiente información del horario escolar:\n\n${datosAEnviar}`;

    if (!process.env.OPENROUTER_API_KEY) {
      console.error('Falta la variable de entorno OPENROUTER_API_KEY en Render');
      return res.status(200).send('El asistente no está configurado en el servidor (falta OPENROUTER_API_KEY).');
    }

    let maxIntentos = 3;
    let intentoActual = 0;
    let dataApi = null;
    let responseOk = false;

    while (intentoActual < maxIntentos && !responseOk) {
      intentoActual++;
      try {
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          signal: AbortSignal.timeout(30000),
          headers: {
            Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
            'HTTP-Referer': req.get('origin') || 'https://escuela-proyec.netlify.app',
            'X-Title': 'Asistente EPO 219',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'deepseek/deepseek-chat',
            messages: [
              { role: 'system', content: promptSistema },
              { role: 'user', content: pregunta || 'Hola' }
            ],
            temperature: 0.1,
            max_tokens: 400
          })
        });

        dataApi = await response.json();

        if (response.ok && dataApi.choices) {
          responseOk = true;
        } else {
          console.warn(`⚠️ Intento ${intentoActual} fallido en OpenRouter. Reintentando en 2 segundos...`, dataApi);
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      } catch (err) {
        console.warn(`⚠️ Error de red en el intento ${intentoActual}:`, err.message);
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    if (!responseOk || !dataApi?.choices) {
      console.error("❌ Todos los reintentos fallaron en OpenRouter:", dataApi);
      return res.status(200).send("El servicio está experimentando alta demanda en este momento. Por favor, intenta formular tu pregunta nuevamente.");
    }

    return res.status(200).send(dataApi.choices[0].message.content);

  } catch (error) {
    console.error("🔴 Error crítico en /api/chat-horario:", error);
    return res.status(200).send("Ocurrió un error inesperado al procesar tu solicitud.");
  }
});


app.get('/api/semestres', async (req, res) => {
  try {
    const lista = await semestresService.getAll();
    res.json(lista);
  } catch (err) {
    console.error("Error al obtener semestres:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/semestres/activo', async (req, res) => {
  try {
    res.json(await semestresService.getActivo());
  } catch (err) {
    console.error("Error al obtener el semestre activo:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/semestres/:id', async (req, res) => {
  try {
    const semestre = await semestresService.getById(req.params.id);
    if (!semestre) {
      return res.status(404).json({ error: 'Semestre no encontrado' });
    }
    res.json(semestre);
  } catch (err) {
    console.error("Error al obtener el semestre por ID:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/semestres', async (req, res) => {
  try {
    const nuevo = await semestresService.create(req.body);
    res.json({ exito: true, ...nuevo });
  } catch (err) {
    console.error("Error al crear semestre:", err);
    res.status(400).json({ exito: false, error: err.message });
  }
});

app.put('/api/semestres/:id', async (req, res) => {
  try {
    const actualizado = await semestresService.update(req.params.id, req.body);
    res.json({ exito: true, ...actualizado });
  } catch (err) {
    console.error("Error al actualizar semestre:", err);
    res.status(400).json({ exito: false, error: err.message });
  }
});

app.delete('/api/semestres/:id', async (req, res) => {
  try {
    const resultado = await semestresService.remove(req.params.id);
    res.json({ exito: true, ...resultado });
  } catch (err) {
    console.error("Error al eliminar semestre:", err);
    res.status(500).json({ error: err.message });
  }
});

// CRUD de usuarios
app.get('/api/usuarios', usuariosController.listar);
app.get('/api/usuarios/:id', usuariosController.obtenerUno);
app.post('/api/usuarios', usuariosController.crear);
app.put('/api/usuarios/:id', usuariosController.actualizar);
app.delete('/api/usuarios/:id', usuariosController.eliminar);
app.post('/api/usuarios/login', usuariosController.login);

// CRUD Alumnos
app.get('/api/alumnos', alumnosController.listar);
app.get('/api/alumnos/:matricula', alumnosController.obtenerPorMatricula);
app.post('/api/alumnos', alumnosController.crear); 
app.put('/api/alumnos/:matricula', alumnosController.actualizar);
app.delete('/api/alumnos/:matricula', alumnosController.eliminar);

// CRUD Adeudos 
app.get('/api/adeudos', adeudosController.listar);
app.get('/api/adeudos/:id', adeudosController.obtenerUno);
app.post('/api/adeudos', adeudosController.crear);
app.put('/api/adeudos/:id', adeudosController.actualizar);
app.delete('/api/adeudos/:id', adeudosController.eliminar);

// CRUD Maestros
app.get('/api/maestros', maestrosController.listar);
app.get('/api/maestros/:id', maestrosController.obtenerUno);
app.post('/api/maestros', maestrosController.crear);
app.put('/api/maestros/:id', maestrosController.actualizar);
app.delete('/api/maestros/:id', maestrosController.eliminar);

// Rutas para Materias
app.get('/api/materias', materiasController.listar);
app.get('/api/materias/:id', materiasController.obtenerUno);
app.post('/api/materias', materiasController.crear);
app.put('/api/materias/:id', materiasController.actualizar);
app.delete('/api/materias/:id', materiasController.eliminar);

// Rutas para Asignaciones
app.get('/api/asignaciones', asignacionesController.listar);
app.post('/api/asignaciones', asignacionesController.crear);
app.delete('/api/asignaciones/:id', asignacionesController.eliminar);
app.put('/api/asignaciones/:id', asignacionesController.actualizar);

// CRUD Talleres
app.get('/api/talleres', talleresController.listar);
app.get('/api/talleres/:id', talleresController.obtenerUno);
app.post('/api/talleres', talleresController.crear);
app.put('/api/talleres/:id', talleresController.actualizar);
app.delete('/api/talleres/:id', talleresController.eliminar);
// CRUD recesos
app.get('/api/recesos', recesosController.listar);
app.post('/api/recesos', recesosController.guardar);

// Generación de PDFs
app.post('/api/descargar-pdf-adeudos', adeudosPdfController.descargarPdfAdeudo);
app.post('/api/descargar-certificado-cero-adeudos', adeudosPdfController.descargarPdfAdeudo);
app.post('/api/descargar-pdf', descargarPDFController);

// CRUD de asistencias
app.get('/api/asistencias', asistenciasController.listar);
app.get('/api/asistencias/:id', asistenciasController.obtenerUno);
app.get('/api/asistencias/usuario/:user', asistenciasController.obtenerPorUser);
app.post('/api/asistencias', asistenciasController.crear);
app.put('/api/asistencias/:id', asistenciasController.actualizar);
app.delete('/api/asistencias/:id', asistenciasController.eliminar);

app.use((err, req, res, next) => {
    console.error(" Error en el servidor:", err.message);
    res.status(500).json({ error: err.message });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor corriendo en el puerto ${PORT}`);
});