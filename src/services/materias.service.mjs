import connect from '../middlewares/db.mjs';
import { resolverSemestreId, exigirSemestreId } from './semestres.service.mjs';
import { BadRequestException, ConflictException } from '../middlewares/exceptions.mjs';

// Validaciones básicas de una materia (datos válidos y sin duplicados en el semestre)
async function validarMateria(db, { id = null, semestre_id, grado, nombre, horas_semanales }) {
  const nombreLimpio = String(nombre ?? '').trim();
  if (!nombreLimpio) throw new BadRequestException('El nombre de la materia es requerido.');

  const g = parseInt(grado, 10);
  if (!Number.isInteger(g) || g < 1 || g > 9) throw new BadRequestException('El grado de la materia no es válido.');

  const h = parseInt(horas_semanales, 10);
  if (!Number.isInteger(h) || h < 1 || h > 10) {
    throw new BadRequestException('Las horas semanales deben ser un número entero entre 1 y 10.');
  }

  const params = [semestre_id, g, nombreLimpio];
  let filtro = '';
  if (id) { filtro = ' AND id <> ?'; params.push(parseInt(id, 10)); }
  const [dup] = await db.query(
    `SELECT id FROM materias WHERE semestre_id = ? AND grado = ? AND LOWER(TRIM(nombre)) = LOWER(?)${filtro}`, params);
  if (dup.length > 0) {
    throw new ConflictException(`Ya existe la materia "${nombreLimpio}" en ${g}° grado de este semestre.`);
  }
  return { grado: g, nombre: nombreLimpio, horas_semanales: h };
}

export const materiasService = {
  // Obtener las materias del semestre indicado (o del activo), ordenadas por grado
  async getAll(semestreId) {
    const db = await connect();
    const sid = await resolverSemestreId(semestreId);
    if (!sid) return [];
    const [rows] = await db.query(
      'SELECT id, semestre_id, grado, nombre, horas_semanales, requiere_bloque_doble, horario_preferente, DATE(created_at) AS creado_at FROM materias WHERE semestre_id = ? ORDER BY grado ASC, id ASC',
      [sid]
    );
    return rows;
  },

  // Obtener materia por ID
  async getById(id) {
    const db = await connect();
    const [rows] = await db.query(
      'SELECT id, semestre_id, grado, nombre, horas_semanales, requiere_bloque_doble, horario_preferente, DATE(created_at) AS creado_at FROM materias WHERE id = ?',
      [id]
    );
    return rows[0] || null;
  },

  // Crear materia
  async create(data) {
    const db = await connect();
    const {
      grado = 1,
      nombre,
      horas_semanales = 3,
      requiere_bloque_doble = 0,
      horario_preferente = 'indiferente'
    } = data;

    // La materia queda ligada al semestre activo (o al indicado en data.semestre_id)
    const semestre_id = await exigirSemestreId(data.semestre_id);
    await validarMateria(db, { semestre_id, grado, nombre, horas_semanales });

    const [result] = await db.query(
      `INSERT INTO materias (semestre_id, grado, nombre, horas_semanales, requiere_bloque_doble, horario_preferente) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [semestre_id, grado, nombre, horas_semanales, requiere_bloque_doble, horario_preferente]
    );

    const hoy = new Date().toISOString().split('T')[0];

    return {
      id: result.insertId,
      semestre_id,
      grado,
      nombre,
      horas_semanales,
      requiere_bloque_doble,
      horario_preferente,
      creado_at: hoy
    };
  },

  // Actualizar materia
  async update(id, data) {
    const db = await connect();
    const {
      grado,
      nombre,
      horas_semanales,
      requiere_bloque_doble,
      horario_preferente
    } = data;

    const actual = await this.getById(id);
    if (!actual) throw new BadRequestException('La materia no existe.');
    await validarMateria(db, { id, semestre_id: actual.semestre_id, grado, nombre, horas_semanales });

    await db.query(
      `UPDATE materias 
       SET grado = ?, nombre = ?, horas_semanales = ?, requiere_bloque_doble = ?, horario_preferente = ? 
       WHERE id = ?`,
      [grado, nombre, horas_semanales, requiere_bloque_doble, horario_preferente, id]
    );

    const materiaActual = await this.getById(id);

    return {
      id,
      semestre_id: materiaActual ? materiaActual.semestre_id : null,
      grado,
      nombre,
      horas_semanales,
      requiere_bloque_doble,
      horario_preferente,
      creado_at: materiaActual ? materiaActual.creado_at : null
    };
  },

  // Eliminar materia
  async remove(id) {
    const db = await connect();
    await db.query('DELETE FROM materias WHERE id = ?', [id]);
    return { message: 'Materia eliminada con éxito', id };
  }
};