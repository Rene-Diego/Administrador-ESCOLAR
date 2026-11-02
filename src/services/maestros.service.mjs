import connect from '../middlewares/db.mjs';
import { resolverSemestreId, exigirSemestreId } from './semestres.service.mjs';
import { BadRequestException, ConflictException } from '../middlewares/exceptions.mjs';

// Módulos de clase disponibles por día (sin contar el receso), según la
// estructura de horario usada en horarios.service.mjs (08:00 - 15:10 con 1 receso).
export const MODULOS_POR_DIA = 8;

const DIAS_VALIDOS = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes'];

function normalizarDiasPreferentes(valor) {
  let lista = [];

  if (Array.isArray(valor)) {
    lista = valor;
  } else if (typeof valor === 'string' && valor.trim() !== '') {
    lista = valor.split(',');
  }

  return lista
    .map(d => String(d).trim().toLowerCase())
    .filter(d => DIAS_VALIDOS.includes(d));
}

function diasPreferentesADb(lista) {
  return lista.length > 0 ? lista.join(',') : null;
}

function diasPreferentesDesdeDb(valor) {
  return normalizarDiasPreferentes(valor);
}

function validarCupoDiario(horasAsignadas, diasNumero) {
  const horas = parseInt(horasAsignadas, 10) || 0;
  const numDias = parseInt(diasNumero, 10) || 5;
  const cupoMaximo = numDias * MODULOS_POR_DIA;

  if (horas > cupoMaximo) {
    throw new Error(
      `El docente tiene ${numDias} día(s) asignado(s) (máx. ${MODULOS_POR_DIA} módulos por día = ${cupoMaximo}h), ` +
      `pero se intentaron asignar ${horas}h semanales. Reduce las horas o agrega más días.`
    );
  }
}

// Validaciones básicas de un docente (datos válidos y sin duplicados en el semestre)
async function validarDocente(db, { id = null, semestre_id, nombre, horas_asignadas, dias }) {
  const nombreLimpio = String(nombre ?? '').trim();
  if (!nombreLimpio) throw new BadRequestException('El nombre del docente es obligatorio.');

  const horas = parseInt(horas_asignadas, 10);
  if (!Number.isInteger(horas) || horas < 0) {
    throw new BadRequestException('Las horas asignadas deben ser un número entero mayor o igual a 0.');
  }
  const numDias = parseInt(dias, 10);
  if (!Number.isInteger(numDias) || numDias < 1 || numDias > 5) {
    throw new BadRequestException('Los días de trabajo deben estar entre 1 y 5.');
  }

  const params = [semestre_id, nombreLimpio];
  let filtro = '';
  if (id) { filtro = ' AND id <> ?'; params.push(parseInt(id, 10)); }
  const [dup] = await db.query(
    `SELECT id FROM docentes WHERE semestre_id = ? AND LOWER(TRIM(nombre)) = LOWER(?)${filtro}`, params);
  if (dup.length > 0) {
    throw new ConflictException(`Ya existe un docente llamado "${nombreLimpio}" en este semestre.`);
  }
}

function colorPorDefecto(id) {
  const paleta = [
    '#2563eb', '#16a34a', '#d97706', '#dc2626', '#7c3aed',
    '#0891b2', '#c2410c', '#4d7c0f', '#be185d', '#0f766e',
    '#9333ea', '#ca8a04', '#0284c7', '#b91c1c', '#15803d'
  ];
  return paleta[(id || 0) % paleta.length];
}

export const maestrosService = {
  // Obtener los docentes del semestre indicado (o del activo)
  async getAll(semestreId) {
    const db = await connect();
    const sid = await resolverSemestreId(semestreId);
    if (!sid) return [];
    const [rows] = await db.query(
      'SELECT id, semestre_id, nombre, horas_asignadas, dias, dias_preferentes, color, DATE(created_at) AS creado_at FROM docentes WHERE semestre_id = ? ORDER BY id ASC',
      [sid]
    );
    return rows.map(r => ({
      ...r,
      dias_preferentes: diasPreferentesDesdeDb(r.dias_preferentes),
      color: r.color || colorPorDefecto(r.id)
    }));
  },

  // Obtener un docente por ID
  async getById(id) {
    const db = await connect();
    const [rows] = await db.query(
      'SELECT id, semestre_id, nombre, horas_asignadas, dias, dias_preferentes, color, DATE(created_at) AS creado_at FROM docentes WHERE id = ?', [id]
    );
    if (!rows[0]) return null;
    return {
      ...rows[0],
      dias_preferentes: diasPreferentesDesdeDb(rows[0].dias_preferentes),
      color: rows[0].color || colorPorDefecto(rows[0].id)
    };
  },

  // Crear docente con horas, días y días preferentes
  async create(data) {
    const db = await connect();
    const { nombre, horas_asignadas = 0, dias = 5, dias_preferentes, color } = data;

    const listaDiasPreferentes = normalizarDiasPreferentes(dias_preferentes);
    const diasFinal = parseInt(dias, 10) || 5; // Respeta el total de días seleccionados en el select

    validarCupoDiario(horas_asignadas, diasFinal);

    // El docente queda ligado al semestre activo (o al indicado en data.semestre_id)
    const semestre_id = await exigirSemestreId(data.semestre_id);
    await validarDocente(db, { semestre_id, nombre, horas_asignadas, dias: diasFinal });

    const [result] = await db.query(
      'INSERT INTO docentes (semestre_id, nombre, horas_asignadas, dias, dias_preferentes, color) VALUES (?, ?, ?, ?, ?, ?)',
      [semestre_id, nombre, horas_asignadas, diasFinal, diasPreferentesADb(listaDiasPreferentes), color || colorPorDefecto(0)]
    );

    // Si no se envió un color explícito, asignamos uno determinístico según el id real
    const colorFinal = color || colorPorDefecto(result.insertId);
    if (!color) {
      await db.query('UPDATE docentes SET color = ? WHERE id = ?', [colorFinal, result.insertId]);
    }

    const hoy = new Date().toISOString().split('T')[0];

    return {
      id: result.insertId,
      semestre_id,
      nombre,
      horas_asignadas,
      dias: diasFinal,
      dias_preferentes: listaDiasPreferentes,
      color: colorFinal,
      creado_at: hoy
    };
  },

  // Actualizar docente
  async update(id, data) {
    const db = await connect();
    const { nombre, horas_asignadas, dias, dias_preferentes, color } = data;

    const listaDiasPreferentes = normalizarDiasPreferentes(dias_preferentes);
    const diasFinal = parseInt(dias, 10) || 5; // Respeta el total de días seleccionados

    validarCupoDiario(horas_asignadas, diasFinal);

    const actual = await this.getById(id);
    if (!actual) throw new BadRequestException('El docente no existe.');
    await validarDocente(db, { id, semestre_id: actual.semestre_id, nombre, horas_asignadas, dias: diasFinal });

    await db.query(
      'UPDATE docentes SET nombre = ?, horas_asignadas = ?, dias = ?, dias_preferentes = ?, color = ? WHERE id = ?',
      [nombre, horas_asignadas, diasFinal, diasPreferentesADb(listaDiasPreferentes), color || colorPorDefecto(id), id]
    );

    const docenteActual = await this.getById(id);

    return { 
      id, 
      semestre_id: docenteActual ? docenteActual.semestre_id : null,
      nombre, 
      horas_asignadas, 
      dias: diasFinal, 
      dias_preferentes: listaDiasPreferentes, 
      color: color || colorPorDefecto(id),
      creado_at: docenteActual ? docenteActual.creado_at : null
    };
  },

  // Eliminar docente
  async remove(id) {
    const db = await connect();
    await db.query('DELETE FROM docentes WHERE id = ?', [id]);
    return { message: 'Docente eliminado con éxito', id };
  }
};