import connect from '../middlewares/db.mjs';
import { resolverSemestreId } from './semestres.service.mjs';
import { talleresService } from './talleres.service.mjs';
import { recesosService } from './recesos.service.mjs';
import {
  DIAS,
  MAX_HORAS_MATERIA_POR_DIA,
  normalizarTexto,
  normalizarGrado,
  minutosDesdeHHMM,
  obtenerEstructuraHorario
} from './horarios.service.mjs';

// ---------------------------------------------------------------------
// AUDITORÍA COMPLETA DE UN HORARIO (generado, guardado o editado a mano)
//
// Revisa el horario contra las mismas condiciones con las que lo genera
// `horarios.service.mjs`, tomando como fuente de verdad la base de datos
// del semestre: asignaciones, materias (horas, bloque doble, horario
// preferente), docentes (días de trabajo), talleres y recesos.
// ---------------------------------------------------------------------

const NOMBRE_DIA = {
  lunes: 'lunes',
  martes: 'martes',
  miercoles: 'miércoles',
  jueves: 'jueves',
  viernes: 'viernes'
};

function leerCelda(fila, dia) {
  if (dia === 'miercoles') return fila.miercoles ?? fila['miércoles'] ?? '';
  return fila[dia] ?? '';
}

function minutos12(txt) {
  const m = String(txt || '').match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const mi = parseInt(m[2], 10);
  const suf = (m[3] || '').toUpperCase();
  if (suf === 'PM' && h !== 12) h += 12;
  if (suf === 'AM' && h === 12) h = 0;
  return h * 60 + mi;
}

function rangoFila(fila, idx) {
  if (Number.isFinite(fila.ini) && Number.isFinite(fila.fin)) {
    return { ini: fila.ini, fin: fila.fin };
  }
  const [a, b] = String(fila.hora || '').split('-');
  const ini = minutos12(a);
  const fin = minutos12(b);
  if (ini !== null && fin !== null) return { ini, fin };
  // Horarios muy antiguos sin horas legibles: módulos de 50 min desde las 8:00
  return { ini: 480 + idx * 50, fin: 480 + idx * 50 + 50 };
}

// Interpreta el texto de una celda: "Materia (Docente)", "Libre", "Receso", "TALLERES"
function parseCelda(raw) {
  const texto = String(raw ?? '').trim();
  const n = normalizarTexto(texto);
  if (!texto || n === 'libre') return { tipo: 'libre' };

  const m = texto.match(/^(.*)\(([^()]*)\)\s*$/);
  if (m && m[1].trim()) {
    return { tipo: 'clase', materia: m[1].trim(), docente: m[2].trim() };
  }
  if (n.includes('receso')) return { tipo: 'receso' };
  if (n.includes('taller')) return { tipo: 'taller' };
  return { tipo: 'otro', texto };
}

function listaDias(arr) {
  return DIAS.filter(d => arr.includes(d)).map(d => NOMBRE_DIA[d]).join(', ');
}

export function auditarHorarioContraBD(horarios, ctx = {}) {
  const problemas = [];
  let seq = 0;
  const add = (severidad, categoria, mensaje, celdas = [], grupo = null) => {
    problemas.push({ id: ++seq, severidad, categoria, mensaje, celdas, grupo: grupo || celdas[0]?.grupo || null });
  };

  const grupos = Object.keys(horarios || {}).filter(g => Array.isArray(horarios[g]));
  if (grupos.length === 0) {
    throw new Error('El horario no contiene grupos para auditar.');
  }

  // ---- Estructura (horas y receso) de cada grupo, tal como viene en el horario ----
  const estructura = {};
  grupos.forEach(g => {
    estructura[g] = horarios[g].map((fila, idx) => {
      const { ini, fin } = rangoFila(fila, idx);
      const todasReceso = DIAS.every(d => parseCelda(leerCelda(fila, d)).tipo === 'receso');
      return { ini, fin, hora: fila.hora || '', esReceso: fila.esReceso === true || todasReceso };
    });
  });

  const idxRecesoDe = g => estructura[g].findIndex(r => r.esReceso);
  const ultimoModuloDe = g => {
    for (let i = estructura[g].length - 1; i >= 0; i--) {
      if (!estructura[g][i].esReceso) return i;
    }
    return -1;
  };

  // ---- Datos de la BD ----
  const asignaciones = ctx.asignaciones || [];

  // Materias que el usuario decidió dejar fuera del horario (no se exigen sus horas)
  const excluidas = new Set(
    (ctx.excluidas || [])
      .filter(e => e && e.grupo && e.materia)
      .map(e => `${String(e.grupo).trim()}|${normalizarTexto(e.materia)}|${normalizarTexto(e.docente || '')}`)
  );

  const limiteDias = new Map();
  asignaciones.forEach(a => {
    const nd = normalizarTexto(a.docente);
    if (!limiteDias.has(nd)) limiteDias.set(nd, parseInt(a.dias, 10) || 5);
  });

  const talleres = (ctx.talleres || [])
    .filter(t => t.activo)
    .map(t => ({
      nombre: t.nombre,
      dia: normalizarTexto(t.dia),
      ini: minutosDesdeHHMM(t.hora_inicio),
      fin: minutosDesdeHHMM(t.hora_fin),
      hi: t.hora_inicio,
      hf: t.hora_fin,
      docente: t.docente_nombre || null,
      nd: t.docente_nombre ? normalizarTexto(t.docente_nombre) : null
    }))
    .filter(t => t.dia && t.ini !== null && t.fin !== null);

  // ---- Lo que EXIGE la BD: horas por grupo / materia / docente ----
  const requisitos = new Map();
  const claveReq = (g, materia, docente) =>
    `${g}|${normalizarTexto(materia)}|${normalizarTexto(docente)}`;

  const agregarRequisito = (g, a, horas, tipo) => {
    const k = claveReq(g, a.materia, a.docente);
    const pref = a.horario_preferente || 'indiferente';
    if (excluidas.has(k)) horas = 0;
    if (requisitos.has(k)) {
      requisitos.get(k).requeridas += horas;
      return;
    }
    requisitos.set(k, {
      grupo: g,
      materia: a.materia,
      docente: a.docente,
      nm: normalizarTexto(a.materia),
      nd: normalizarTexto(a.docente),
      grado: normalizarGrado(g),
      requeridas: horas,
      excluida: excluidas.has(k),
      colocadas: 0,
      celdas: [],
      tipo,
      pref,
      bloqueDoble: Number(a.requiere_bloque_doble) === 1 || a.requiere_bloque_doble === true
    });
  };

  const gruposSinHorario = new Set();
  asignaciones.forEach(a => {
    const esTodos = String(a.grupo || '').trim().toUpperCase() === 'TODOS';
    if (esTodos) {
      const grd = normalizarGrado(a.grado);
      grupos
        .filter(g => normalizarGrado(g) === grd)
        .forEach(g => agregarRequisito(g, a, 1, 'tutoria'));
      return;
    }
    const g = String(a.grupo || '').trim();
    if (!g) return;
    if (!estructura[g]) {
      gruposSinHorario.add(g);
      return;
    }
    const pref = a.horario_preferente || 'indiferente';
    let hrs = parseInt(a.horas_semanales, 10) || 0;
    if (pref === 'ultimo_modulo') hrs = parseInt(a.horas_semanales, 10) || 1;
    agregarRequisito(g, a, hrs, 'regular');
  });

  gruposSinHorario.forEach(g => {
    add('error', 'asignacion', `El grupo "${g}" tiene asignaciones en la base de datos pero no aparece en este horario.`);
  });

  // ---- Recorrido de todas las celdas ----
  const clases = [];
  grupos.forEach(g => {
    estructura[g].forEach((row, idx) => {
      DIAS.forEach(dia => {
        const raw = leerCelda(horarios[g][idx], dia);
        const c = parseCelda(raw);
        const ref = { grupo: g, dia, fila: idx };

        if (c.tipo === 'clase') {
          if (row.esReceso) {
            add('error', 'receso',
              `En ${g} el ${NOMBRE_DIA[dia]} hay "${raw}" dentro del horario de receso (${row.hora}).`, [ref]);
            return;
          }
          const req = requisitos.get(claveReq(g, c.materia, c.docente));
          if (!req) {
            add('error', 'asignacion',
              `En ${g} (${NOMBRE_DIA[dia]}, ${row.hora}) aparece "${raw}", pero esa combinación de materia, docente y grupo no existe en las asignaciones del semestre.`, [ref]);
          } else {
            req.colocadas++;
            req.celdas.push({ ...ref, ini: row.ini, fin: row.fin });
          }
          clases.push({
            g, dia, idx, ini: row.ini, fin: row.fin, hora: row.hora,
            materia: c.materia, docente: c.docente,
            nm: normalizarTexto(c.materia), nd: normalizarTexto(c.docente), req
          });
        } else if (c.tipo === 'otro' && !row.esReceso) {
          add('advertencia', 'asignacion',
            `En ${g} (${NOMBRE_DIA[dia]}, ${row.hora}) hay una celda con formato no reconocido: "${c.texto}". El formato esperado es "Materia (Docente)".`, [ref]);
        }
      });
    });
  });

  const quitarTiempos = cs => cs.map(({ grupo, dia, fila }) => ({ grupo, dia, fila }));

  // ---- 1. Horas semanales por materia ----
  const incumplimientosHoras = [];
  requisitos.forEach(r => {
    if (r.colocadas < r.requeridas) {
      const faltan = r.requeridas - r.colocadas;
      incumplimientosHoras.push({
        grupo: r.grupo,
        materia: r.materia,
        docente: r.docente,
        horasRequeridas: r.requeridas,
        horasColocadas: r.colocadas,
        horasFaltantes: faltan
      });
      add('error', 'horas',
        `Faltan ${faltan} h de "${r.materia}" (${r.docente}) en ${r.grupo}: tiene ${r.colocadas} de ${r.requeridas} h semanales.`,
        [], r.grupo);
    } else if (r.colocadas > r.requeridas) {
      add('error', 'horas',
        r.excluida
          ? `"${r.materia}" (${r.docente}) está marcada como "dejada fuera" en ${r.grupo}, pero aún tiene ${r.colocadas} h colocadas.`
          : `Sobran ${r.colocadas - r.requeridas} h de "${r.materia}" (${r.docente}) en ${r.grupo}: tiene ${r.colocadas} de ${r.requeridas} h semanales.`,
        quitarTiempos(r.celdas));
    }
  });

  // ---- 2. Máximo de horas de una misma materia por día / bloque doble / horario preferente ----
  requisitos.forEach(r => {
    if (r.tipo !== 'regular') return;

    const porDia = {};
    r.celdas.forEach(c => { (porDia[c.dia] = porDia[c.dia] || []).push(c); });

    // Máximo por día
    DIAS.forEach(dia => {
      const lista = porDia[dia] || [];
      if (lista.length > MAX_HORAS_MATERIA_POR_DIA) {
        add('error', 'carga',
          `"${r.materia}" (${r.grupo}) tiene ${lista.length} horas el ${NOMBRE_DIA[dia]}; el máximo permitido es ${MAX_HORAS_MATERIA_POR_DIA} por día.`,
          quitarTiempos(lista));
      }
    });

    // Bloque doble: las horas deben ir de 2 en 2, consecutivas
    if (r.bloqueDoble) {
      const sueltas = [];
      DIAS.forEach(dia => {
        const idxs = (porDia[dia] || []).map(c => c.fila).sort((a, b) => a - b);
        let i = 0;
        while (i < idxs.length) {
          let j = i;
          while (j + 1 < idxs.length && idxs[j + 1] === idxs[j] + 1) j++;
          const largo = j - i + 1;
          if (largo % 2 === 1) sueltas.push({ grupo: r.grupo, dia, fila: idxs[j] });
          i = j + 1;
        }
      });
      const permitidas = r.requeridas % 2;
      if (sueltas.length > permitidas) {
        add('error', 'bloque',
          `"${r.materia}" (${r.grupo}) requiere bloque doble (2 horas seguidas), pero tiene horas sueltas: ${sueltas.map(s => `${NOMBRE_DIA[s.dia]} ${estructura[r.grupo][s.fila].hora}`).join('; ')}.`,
          sueltas);
      }
    }

    // Horario preferente
    const idxReceso = idxRecesoDe(r.grupo);
    if (r.pref === 'primeras_horas' && idxReceso !== -1) {
      const malas = r.celdas.filter(c => c.fila > idxReceso);
      if (malas.length) {
        add('error', 'preferencia',
          `"${r.materia}" (${r.grupo}) debe impartirse en las primeras horas (antes del receso), pero hay ${malas.length} h después: ${malas.map(c => `${NOMBRE_DIA[c.dia]} ${estructura[r.grupo][c.fila].hora}`).join('; ')}.`,
          quitarTiempos(malas));
      }
    } else if (r.pref === 'ultimo_modulo') {
      const ult = ultimoModuloDe(r.grupo);
      const malas = r.celdas.filter(c => c.fila !== ult);
      if (malas.length) {
        add('error', 'preferencia',
          `"${r.materia}" (${r.grupo}) debe ir en el último módulo del día, pero hay ${malas.length} h en otro horario: ${malas.map(c => `${NOMBRE_DIA[c.dia]} ${estructura[r.grupo][c.fila].hora}`).join('; ')}.`,
          quitarTiempos(malas));
      }
    } else if (r.pref === 'ultimas_horas' && idxReceso !== -1) {
      const malas = r.celdas.filter(c => c.fila < idxReceso);
      if (malas.length) {
        add('advertencia', 'preferencia',
          `"${r.materia}" (${r.grupo}) prefiere las últimas horas (después del receso), pero hay ${malas.length} h antes del receso.`,
          quitarTiempos(malas));
      }
    }
  });

  // ---- 3. Tutorías / materias de todo el grado: mismo día y hora en todos los grupos ----
  const tutoriasPorGrado = new Map();
  requisitos.forEach(r => {
    if (r.tipo !== 'tutoria') return;
    const k = `${r.grado}|${r.nm}|${r.nd}`;
    if (!tutoriasPorGrado.has(k)) tutoriasPorGrado.set(k, []);
    tutoriasPorGrado.get(k).push(r);
  });
  tutoriasPorGrado.forEach(lista => {
    const posiciones = new Set();
    const todas = [];
    lista.forEach(r => r.celdas.forEach(c => {
      posiciones.add(`${c.dia}|${c.fila}`);
      todas.push(c);
    }));
    const ejemplo = lista[0];
    if (posiciones.size > 1) {
      add('error', 'tutoria',
        `"${ejemplo.materia}" (${ejemplo.docente}) es de todo el grado ${ejemplo.grado}° y debe ir el mismo día y a la misma hora en todos sus grupos; ahora está en horarios distintos.`,
        quitarTiempos(todas));
    }
    const noUltimo = todas.filter(c => c.fila !== ultimoModuloDe(c.grupo));
    if (noUltimo.length) {
      add('advertencia', 'tutoria',
        `"${ejemplo.materia}" del grado ${ejemplo.grado}° normalmente se coloca en el último módulo del día; ahora está en otra hora.`,
        quitarTiempos(noUltimo));
    }
  });

  // ---- 4. Choques de docentes entre grupos ----
  const porDocenteDia = new Map();
  clases.forEach(c => {
    if (!c.nd || c.nd === 'sin docente') return;
    const k = `${c.nd}|${c.dia}`;
    if (!porDocenteDia.has(k)) porDocenteDia.set(k, []);
    porDocenteDia.get(k).push(c);
  });
  porDocenteDia.forEach(lista => {
    for (let i = 0; i < lista.length; i++) {
      for (let j = i + 1; j < lista.length; j++) {
        const a = lista[i];
        const b = lista[j];
        if (a.g === b.g) continue;
        if (!(a.ini < b.fin && b.ini < a.fin)) continue;

        const ambasTutoria =
          a.req?.tipo === 'tutoria' && b.req?.tipo === 'tutoria' &&
          a.nm === b.nm && normalizarGrado(a.g) === normalizarGrado(b.g);
        if (ambasTutoria && a.ini === b.ini) continue;

        add('error', 'empalme',
          `Empalme: "${a.docente}" el ${NOMBRE_DIA[a.dia]} (${a.hora}) está en ${a.g} (${a.materia}) y en ${b.g} (${b.materia}) al mismo tiempo.`,
          [{ grupo: a.g, dia: a.dia, fila: a.idx }, { grupo: b.g, dia: b.dia, fila: b.idx }]);
      }
    }
  });

  // ---- 5. Talleres ----
  grupos.forEach(g => {
    estructura[g].forEach((row, idx) => {
      if (row.esReceso) return;
      DIAS.forEach(dia => {
        const raw = leerCelda(horarios[g][idx], dia);
        const c = parseCelda(raw);
        const ref = { grupo: g, dia, fila: idx };
        const taller = talleres.find(t => t.dia === dia && t.ini < row.fin && t.fin > row.ini);
        if (taller && c.tipo !== 'taller') {
          add('error', 'taller',
            `En ${g} el ${NOMBRE_DIA[dia]} (${row.hora}) debe estar el taller "${taller.nombre}" (${taller.hi}-${taller.hf}) y hay ${c.tipo === 'libre' ? 'una casilla libre' : `"${raw}"`}.`, [ref]);
        } else if (!taller && c.tipo === 'taller') {
          add('advertencia', 'taller',
            `En ${g} el ${NOMBRE_DIA[dia]} (${row.hora}) hay un bloque de taller, pero no existe un taller activo en ese horario.`, [ref]);
        }
      });
    });
  });

  // Docente con clase encimada a su propio taller
  clases.forEach(c => {
    if (!c.nd) return;
    talleres
      .filter(t => t.nd === c.nd && t.dia === c.dia && t.ini < c.fin && t.fin > c.ini)
      .forEach(t => {
        add('error', 'empalme',
          `"${c.docente}" tiene "${c.materia}" en ${c.g} el ${NOMBRE_DIA[c.dia]} (${c.hora}), que choca con su taller "${t.nombre}" (${t.hi}-${t.hf}).`,
          [{ grupo: c.g, dia: c.dia, fila: c.idx }]);
      });
  });

  // ---- 6. Días de trabajo de cada docente ----
  const diasClase = new Map(); // nd -> Map(dia -> celdas)
  clases.forEach(c => {
    if (!c.nd || c.nd === 'sin docente') return;
    if (!diasClase.has(c.nd)) diasClase.set(c.nd, new Map());
    const m = diasClase.get(c.nd);
    if (!m.has(c.dia)) m.set(c.dia, []);
    m.get(c.dia).push({ grupo: c.g, dia: c.dia, fila: c.idx });
  });
  const diasTaller = new Map();
  talleres.forEach(t => {
    if (!t.nd) return;
    if (!diasTaller.has(t.nd)) diasTaller.set(t.nd, new Set());
    diasTaller.get(t.nd).add(t.dia);
  });
  const nombreDe = new Map();
  clases.forEach(c => { if (c.nd && !nombreDe.has(c.nd)) nombreDe.set(c.nd, c.docente); });

  diasClase.forEach((mapaDias, nd) => {
    const dTaller = diasTaller.get(nd) || new Set();
    const todos = new Set([...mapaDias.keys(), ...dTaller]);
    const limite = limiteDias.get(nd) ?? 5;
    const nombre = nombreDe.get(nd) || nd;

    if (todos.size > limite) {
      // Marcamos los días con menos clases (los más fáciles de liberar)
      const candidatos = [...mapaDias.entries()]
        .filter(([d]) => !dTaller.has(d))
        .sort((a, b) => a[1].length - b[1].length);
      const celdas = candidatos.length ? candidatos[0][1] : [];
      add('error', 'dias',
        `"${nombre}" trabaja ${todos.size} días (${listaDias([...todos])}) y su límite es de ${limite}${dTaller.size ? ` (los días de taller también cuentan)` : ''}.`,
        celdas);
    }

  });

  // ---- 7. Receso contra la configuración actual ----
  if (ctx.recesos) {
    const vistos = new Set();
    grupos.forEach(g => {
      const grado = parseInt(normalizarGrado(g).charAt(0), 10);
      const conf = ctx.recesos[grado];
      if (!conf || !conf.hora_inicio) return;
      const esperado = obtenerEstructuraHorario(conf.hora_inicio, conf.duracion_minutos).find(s => s.esReceso);
      const real = estructura[g].find(r => r.esReceso);
      if (!esperado || !real) return;
      if (esperado.ini !== real.ini && !vistos.has(g)) {
        vistos.add(g);
        add('advertencia', 'receso',
          `El receso de ${g} está a las ${real.hora}, pero la configuración actual del grado ${grado}° es ${esperado.hora}.`);
      }
    });
  }

  // Errores primero
  problemas.sort((a, b) => (a.severidad === b.severidad ? a.id - b.id : a.severidad === 'error' ? -1 : 1));

  const errores = problemas.filter(p => p.severidad === 'error');
  const advertencias = problemas.filter(p => p.severidad === 'advertencia');

  return {
    valido: errores.length === 0,
    esMatematicamentePosible: errores.length === 0,
    resumen: { errores: errores.length, advertencias: advertencias.length, grupos: grupos.length },
    problemas,
    incumplimientosHoras,
    inconsistencias: errores.filter(p => p.categoria !== 'horas').map(p => p.mensaje)
  };
}

// Carga lo necesario de la BD (semestre indicado o activo) y audita el horario recibido
export async function auditarHorarioEnBD(horarios, semestreIdOpcional, excluidas = []) {
  const db = await connect();
  const semestreId = await resolverSemestreId(semestreIdOpcional);
  if (!semestreId) {
    throw new Error('No hay ningún semestre activo para auditar el horario.');
  }

  const [asignaciones] = await db.query(`
    SELECT
      a.id AS asignacion_id,
      COALESCE(d.nombre, 'Sin Docente') AS docente,
      m.nombre AS materia,
      a.grado,
      a.grupo,
      COALESCE(d.dias, 5) AS dias,
      COALESCE(m.horas_semanales, 3) AS horas_semanales,
      COALESCE(m.requiere_bloque_doble, 0) AS requiere_bloque_doble,
      COALESCE(m.horario_preferente, 'indiferente') AS horario_preferente
    FROM asignaciones a
    LEFT JOIN docentes d ON a.docente_id = d.id
    LEFT JOIN materias m ON a.materia_id = m.id
    WHERE a.semestre_id = ?
  `, [semestreId]);

  if (!asignaciones || asignaciones.length === 0) {
    throw new Error('El semestre no tiene asignaciones registradas, no hay contra qué auditar el horario.');
  }

  const [docentes] = await db.query(
    'SELECT id, nombre, dias, dias_preferentes FROM docentes WHERE semestre_id = ?',
    [semestreId]
  );

  const talleres = await talleresService.getAll(semestreId);
  const recesos = await recesosService.getAll();

  return auditarHorarioContraBD(horarios, { asignaciones, docentes, talleres, recesos, excluidas });
}
