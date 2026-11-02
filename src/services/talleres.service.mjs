import connect from '../middlewares/db.mjs';
import { resolverSemestreId, exigirSemestreId } from './semestres.service.mjs';

export const talleresService = {
  // Lista los talleres del semestre indicado (o del activo), con el nombre y color del docente responsable (si tiene)
  async getAll(semestreId) {
    const db = await connect();
    const sid = await resolverSemestreId(semestreId);
    if (!sid) return [];
    const [rows] = await db.query(`
      SELECT
        t.id, t.semestre_id, t.nombre, t.dia, t.hora_inicio, t.hora_fin, t.activo,
        t.docente_id, d.nombre AS docente_nombre, d.color AS docente_color,
        DATE(t.created_at) AS creado_at
      FROM talleres t
      LEFT JOIN docentes d ON t.docente_id = d.id
      WHERE t.semestre_id = ?
      ORDER BY FIELD(t.dia, 'lunes','martes','miercoles','jueves','viernes'), t.hora_inicio ASC
    `, [sid]);
    return rows;
  },

  async getById(id) {
    const db = await connect();
    const [rows] = await db.query(`
      SELECT 
        t.id, t.semestre_id, t.nombre, t.dia, t.hora_inicio, t.hora_fin, t.activo,
        t.docente_id, DATE(t.created_at) AS creado_at
      FROM talleres t 
      WHERE t.id = ?
    `, [id]);
    return rows[0] || null;
  },

  async create(data) {
    const db = await connect();
    const { nombre, docente_id = null, dia, hora_inicio, hora_fin, activo = 1 } = data;

    if (!nombre || !dia || !hora_inicio || !hora_fin) {
      throw new Error('Nombre, día, hora de inicio y hora de fin son obligatorios para el taller.');
    }

    // El taller queda ligado al semestre activo (o al indicado en data.semestre_id)
    const semestre_id = await exigirSemestreId(data.semestre_id);

    // El docente (si se indica) debe pertenecer al mismo semestre
    if (docente_id) {
      const [doc] = await db.query('SELECT id FROM docentes WHERE id = ? AND semestre_id = ?', [docente_id, semestre_id]);
      if (doc.length === 0) {
        throw new Error('El docente seleccionado no pertenece al semestre activo.');
      }
    }

    const [result] = await db.query(
      'INSERT INTO talleres (semestre_id, nombre, docente_id, dia, hora_inicio, hora_fin, activo) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [semestre_id, nombre, docente_id || null, dia, hora_inicio, hora_fin, activo ? 1 : 0]
    );

    // Obtenemos la fecha actual en formato YYYY-MM-DD para el objeto de respuesta
    const hoy = new Date().toISOString().split('T')[0];

    return { 
      id: result.insertId, 
      semestre_id,
      nombre, 
      docente_id: docente_id || null, 
      dia, 
      hora_inicio, 
      hora_fin, 
      activo: !!activo, 
      creado_at: hoy 
    };
  },

  async update(id, data) {
    const db = await connect();
    const { nombre, docente_id = null, dia, hora_inicio, hora_fin, activo = 1 } = data;

    // El docente (si se indica) debe pertenecer al mismo semestre que el taller
    if (docente_id) {
      const [doc] = await db.query(
        'SELECT d.id FROM docentes d INNER JOIN talleres t ON t.semestre_id = d.semestre_id WHERE d.id = ? AND t.id = ?',
        [docente_id, id]
      );
      if (doc.length === 0) {
        throw new Error('El docente seleccionado no pertenece al semestre de este taller.');
      }
    }

    await db.query(
      'UPDATE talleres SET nombre = ?, docente_id = ?, dia = ?, hora_inicio = ?, hora_fin = ?, activo = ? WHERE id = ?',
      [nombre, docente_id || null, dia, hora_inicio, hora_fin, activo ? 1 : 0, id]
    );

    // Mantenemos la fecha del registro existente consultándola o conservándola
    const tallerActual = await this.getById(id);

    return { 
      id, 
      semestre_id: tallerActual ? tallerActual.semestre_id : null,
      nombre, 
      docente_id: docente_id || null, 
      dia, 
      hora_inicio, 
      hora_fin, 
      activo: !!activo, 
      creado_at: tallerActual ? tallerActual.creado_at : null 
    };
  },

  async remove(id) {
    const db = await connect();
    await db.query('DELETE FROM talleres WHERE id = ?', [id]);
    return { message: 'Taller eliminado con éxito', id };
  }
};