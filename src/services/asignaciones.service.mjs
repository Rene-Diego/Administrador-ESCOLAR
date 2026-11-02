import connect from '../middlewares/db.mjs';
import { resolverSemestreId, exigirSemestreId } from './semestres.service.mjs';
import { BadRequestException, ConflictException } from '../middlewares/exceptions.mjs';

// ---------------------------------------------------------------------
// VALIDACIONES DE ASIGNACIONES
//  - docente y materia deben existir y ser del mismo semestre
//  - la materia debe corresponder al grado, y el grupo al grado
//  - no repetir docente + materia + grado + grupo
//  - una materia no puede tener dos docentes distintos en el mismo grupo
//  - "TODOS" (todo el grado) no se mezcla con grupos individuales de la misma materia
//  - el docente no puede pasar de sus horas disponibles
// ---------------------------------------------------------------------

const limpiarGrado = g => String(g ?? '').replace('°', '').trim();

function normalizarGrupo(g) {
  const t = String(g ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
  if (t === 'TODOS' || t === 'TODO EL GRADO') return 'TODOS';
  return t;
}

// Una fila puede traer varios grupos separados por coma ("1° I, 1° II")
function listaDeGrupos(valor) {
  const crudos = Array.isArray(valor) ? valor : String(valor ?? '').split(',');
  const vistos = new Set();
  const lista = [];
  crudos.forEach(g => {
    const n = normalizarGrupo(g);
    if (n && !vistos.has(n)) {
      vistos.add(n);
      lista.push({ original: String(g).trim().replace(/\s+/g, ' '), norm: n });
    }
  });
  return lista;
}

function horasDeFila(horasMateria, grupos) {
  const h = Number(horasMateria) || 0;
  return grupos.some(g => g === 'TODOS') ? h : h * Math.max(grupos.length, 1);
}

async function validarAsignacion(db, { excluirId = null, semestreId, docenteId, materiaId, grado, grupos }) {
  if (!Number.isInteger(docenteId) || docenteId <= 0) throw new BadRequestException('Debes seleccionar un docente válido.');
  if (!Number.isInteger(materiaId) || materiaId <= 0) throw new BadRequestException('Debes seleccionar una materia válida.');
  if (!/^[1-9]$/.test(grado)) throw new BadRequestException('El grado indicado no es válido.');
  if (grupos.length === 0) throw new BadRequestException('No se especificó ningún grupo para asignar.');

  // Docente y materia del mismo semestre
  const [docs] = await db.query(
    'SELECT id, nombre, horas_asignadas FROM docentes WHERE id = ? AND semestre_id = ?', [docenteId, semestreId]);
  if (docs.length === 0) {
    throw new BadRequestException('El docente seleccionado no pertenece al semestre de esta asignación.');
  }
  const [mats] = await db.query(
    'SELECT id, nombre, grado, horas_semanales FROM materias WHERE id = ? AND semestre_id = ?', [materiaId, semestreId]);
  if (mats.length === 0) {
    throw new BadRequestException('La materia seleccionada no pertenece al semestre de esta asignación.');
  }
  const docente = docs[0];
  const materia = mats[0];

  // La materia es de un grado concreto
  if (String(materia.grado) !== grado) {
    throw new BadRequestException(
      `"${materia.nombre}" es una materia de ${materia.grado}° grado y no se puede asignar a ${grado}° grado.`);
  }

  // Los grupos deben pertenecer al grado (o ser "TODOS")
  const esTodos = grupos.some(g => g.norm === 'TODOS');
  if (esTodos && grupos.length > 1) {
    throw new BadRequestException('No se puede combinar "Todo el grado" con grupos individuales en la misma asignación.');
  }
  grupos.forEach(g => {
    if (g.norm !== 'TODOS' && !g.norm.startsWith(`${grado}°`)) {
      throw new BadRequestException(`El grupo "${g.original}" no pertenece al ${grado}° grado.`);
    }
  });

  // Duplicados y conflictos con asignaciones existentes de la misma materia y grado
  const params = [semestreId, materiaId, grado];
  let filtroId = '';
  if (excluirId) { filtroId = ' AND a.id <> ?'; params.push(excluirId); }
  const [existentes] = await db.query(
    `SELECT a.id, a.docente_id, a.grupo, d.nombre AS docente_nombre
       FROM asignaciones a
       INNER JOIN docentes d ON d.id = a.docente_id
      WHERE a.semestre_id = ? AND a.materia_id = ? AND a.grado = ?${filtroId}`,
    params
  );

  for (const g of grupos) {
    const etiqueta = g.norm === 'TODOS' ? `todo el ${grado}° grado` : `el grupo ${g.original}`;
    for (const fila of existentes) {
      for (const e of listaDeGrupos(fila.grupo)) {
        if (e.norm === g.norm) {
          if (Number(fila.docente_id) === docenteId) {
            throw new ConflictException(
              `${docente.nombre} ya tiene asignada la materia "${materia.nombre}" en ${etiqueta}. No se puede asignar dos veces.`);
          }
          throw new ConflictException(
            `La materia "${materia.nombre}" ya está asignada a ${fila.docente_nombre} en ${etiqueta}. Una materia solo puede tener un docente por grupo.`);
        }
        if (g.norm === 'TODOS' && e.norm !== 'TODOS') {
          throw new ConflictException(
            `"${materia.nombre}" ya está asignada en el grupo ${e.original} (${fila.docente_nombre}). Elimina esa asignación antes de asignarla a todo el grado.`);
        }
        if (g.norm !== 'TODOS' && e.norm === 'TODOS') {
          throw new ConflictException(
            `"${materia.nombre}" ya está asignada a todo el ${grado}° grado (${fila.docente_nombre}), por lo que no se puede asignar al grupo ${g.original}.`);
        }
      }
    }
  }

  // Cupo de horas del docente
  const paramsDoc = [semestreId, docenteId];
  let filtroDoc = '';
  if (excluirId) { filtroDoc = ' AND a.id <> ?'; paramsDoc.push(excluirId); }
  const [delDocente] = await db.query(
    `SELECT a.grupo, m.horas_semanales
       FROM asignaciones a
       INNER JOIN materias m ON m.id = a.materia_id
      WHERE a.semestre_id = ? AND a.docente_id = ?${filtroDoc}`,
    paramsDoc
  );
  const ocupadas = delDocente.reduce(
    (suma, r) => suma + horasDeFila(r.horas_semanales, listaDeGrupos(r.grupo).map(x => x.norm)), 0);
  const nuevas = horasDeFila(materia.horas_semanales, grupos.map(x => x.norm));
  const cupo = Number(docente.horas_asignadas) || 0;
  if (ocupadas + nuevas > cupo) {
    throw new ConflictException(
      `Límite excedido para ${docente.nombre}: intentas asignar ${nuevas} h, pero solo le quedan ${Math.max(0, cupo - ocupadas)} h libres (cupo ${cupo} h).`);
  }

  return { docente, materia };
}

export const asignacionesService = {
  async getAll(semestreId) {
    const db = await connect();
    const sid = await resolverSemestreId(semestreId);
    if (!sid) return [];
    const query = `
      SELECT 
        a.id, a.semestre_id, a.grado, a.grupo,
        d.id AS docente_id, d.nombre AS docente_nombre,
        m.id AS materia_id, m.nombre AS materia_nombre, m.horas_semanales,
        DATE(a.created_at) AS creado_at
      FROM asignaciones a
      INNER JOIN docentes d ON a.docente_id = d.id
      INNER JOIN materias m ON a.materia_id = m.id
      WHERE a.semestre_id = ?
      ORDER BY a.grado ASC, a.grupo ASC, m.nombre ASC
    `;
    const [rows] = await db.query(query, [sid]);
    return rows;
  },

  async create(data) {
    const db = await connect();
    const { docente_id, materia_id, grado, grupos, grupo } = data;

    // Acepta tanto un arreglo de grupos como un grupo individual
    let crudos = [];
    if (Array.isArray(grupos) && grupos.length > 0) {
      crudos = grupos;
    } else if (grupo) {
      crudos = [grupo];
    }
    const lista = listaDeGrupos(crudos);
    if (lista.length === 0) {
      throw new BadRequestException('No se especificó ningún grupo para asignar.');
    }

    // La asignación queda ligada al semestre activo (o al indicado en data.semestre_id)
    const semestre_id = await exigirSemestreId(data.semestre_id);
    const docenteId = parseInt(docente_id, 10);
    const materiaId = parseInt(materia_id, 10);
    const gradoLimpio = limpiarGrado(grado);

    // Se valida TODO antes de insertar algo: si un grupo falla, no se guarda ninguno
    await validarAsignacion(db, {
      semestreId: semestre_id, docenteId, materiaId, grado: gradoLimpio, grupos: lista
    });

    const insertados = [];
    const hoy = new Date().toISOString().split('T')[0];

    for (const g of lista) {
      const [result] = await db.query(
        'INSERT INTO asignaciones (semestre_id, docente_id, materia_id, grado, grupo) VALUES (?, ?, ?, ?, ?)',
        [semestre_id, docenteId, materiaId, gradoLimpio, g.norm === 'TODOS' ? 'TODOS' : g.original]
      );
      insertados.push({
        id: result.insertId,
        semestre_id,
        docente_id: docenteId,
        materia_id: materiaId,
        grado: gradoLimpio,
        grupo: g.norm === 'TODOS' ? 'TODOS' : g.original,
        creado_at: hoy
      });
    }

    return insertados;
  },

  async remove(id) {
    const db = await connect();
    await db.query('DELETE FROM asignaciones WHERE id = ?', [id]);
    return { message: 'Asignación eliminada', id };
  },

  async actualizar(id, data) {
    const db = await connect();
    const { docente_id, materia_id, grado, grupo } = data;

    const [actual] = await db.query('SELECT semestre_id FROM asignaciones WHERE id = ?', [parseInt(id, 10)]);
    if (actual.length === 0) {
      throw new BadRequestException('No se encontró la asignación o no se realizaron cambios.');
    }

    const docenteId = parseInt(docente_id, 10);
    const materiaId = parseInt(materia_id, 10);
    const gradoLimpio = limpiarGrado(grado);
    const lista = listaDeGrupos(grupo);

    // Docente, materia, grado, grupos, duplicados y cupo (sin contarse a sí misma)
    await validarAsignacion(db, {
      excluirId: parseInt(id, 10),
      semestreId: actual[0].semestre_id,
      docenteId, materiaId, grado: gradoLimpio, grupos: lista
    });

    const grupoFinal = lista.map(g => (g.norm === 'TODOS' ? 'TODOS' : g.original)).join(', ');

    const [result] = await db.query(
      `UPDATE asignaciones 
       SET docente_id = ?, materia_id = ?, grado = ?, grupo = ? 
       WHERE id = ?`,
      [docenteId, materiaId, gradoLimpio, grupoFinal, parseInt(id, 10)]
    );

    if (result.affectedRows === 0) {
      throw new BadRequestException('No se encontró la asignación o no se realizaron cambios.');
    }

    // Obtenemos la asignación actualizada para conservar su fecha original de creación
    const [rows] = await db.query('SELECT DATE(created_at) AS creado_at FROM asignaciones WHERE id = ?', [id]);
    const creado_at = rows[0] ? rows[0].creado_at : null;

    return {
      id: parseInt(id, 10),
      semestre_id: actual[0].semestre_id,
      docente_id: docenteId,
      materia_id: materiaId,
      grado: gradoLimpio,
      grupo: grupoFinal,
      creado_at
    };
  },
};
