import connect from '../middlewares/db.mjs';

export const semestresService = {
  // 0. Semestre activo (estado = 1). Devuelve null si no hay ninguno.
  async getActivo() {
    const db = await connect();
    const [rows] = await db.query(
      'SELECT id, estado, nombre, fecha_inicio, fecha_fin FROM semestres WHERE estado = 1 ORDER BY id DESC LIMIT 1'
    );
    return rows[0] || null;
  },

  // 1. Listar todos los semestres
  async getAll() {
    const db = await connect();
    const [rows] = await db.query(`
      SELECT id, estado, nombre, fecha_inicio, fecha_fin, horario, creado_at 
      FROM semestres 
      ORDER BY creado_at DESC
    `);
    
    return rows.map(registro => {
      if (typeof registro.horario === 'string') {
        try {
          registro.horario = JSON.parse(registro.horario);
        } catch (e) {
          registro.horario = null;
        }
      }
      return registro;
    });
  },

  // 2. Buscar un semestre por su ID
  async getById(id) {
    const db = await connect();
    const [rows] = await db.query('SELECT * FROM semestres WHERE id = ?', [id]);
    if (rows.length === 0) return null;
    
    const registro = rows[0];
    if (typeof registro.horario === 'string') {
      try {
        registro.horario = JSON.parse(registro.horario);
      } catch (e) {
        registro.horario = null;
      }
    }
    return registro;
  },

  // 3. Crear un nuevo semestre
  async create(data) {
    const db = await connect();
    const { nombre, fecha_inicio, fecha_fin, horario = {}, estado = 0 } = data;

    if (!nombre) {
      throw new Error('El nombre del semestre es obligatorio.');
    }

    const horarioJson = typeof horario === 'object' && horario !== null ? JSON.stringify(horario) : horario;

    // Si se activa este, desactivar los demás
    if (Number(estado) === 1) {
      await db.query('UPDATE semestres SET estado = 0');
    }

    const [result] = await db.query(
      'INSERT INTO semestres (estado, nombre, fecha_inicio, fecha_fin, horario) VALUES (?, ?, ?, ?, ?)',
      [estado, nombre, fecha_inicio || null, fecha_fin || null, horarioJson]
    );

    return { id: result.insertId, estado, nombre, fecha_inicio, fecha_fin, horario };
  },

  // 4. Actualizar un semestre existente (preservando fechas si no se envían)
  async update(id, data) {
    const db = await connect();
    
    // Primero consultamos el semestre actual para no perder valores existentes si vienen vacíos
    const [actualRows] = await db.query('SELECT * FROM semestres WHERE id = ?', [id]);
    if (actualRows.length === 0) {
      throw new Error('Semestre no encontrado.');
    }
    const semestreActual = actualRows.shift();

    const nombre = data.nombre !== undefined ? data.nombre : semestreActual.nombre;
    
    // Si envían una cadena vacía explícita la limpiamos, si no mandan fecha mantenemos la anterior
    const fecha_inicio = data.fecha_inicio !== undefined ? (data.fecha_inicio || null) : semestreActual.fecha_inicio;
    const fecha_fin = data.fecha_fin !== undefined ? (data.fecha_fin || null) : semestreActual.fecha_fin;
    
    const estado = data.estado !== undefined ? data.estado : semestreActual.estado;
    const horario = data.horario !== undefined ? data.horario : semestreActual.horario;

    if (!nombre) {
      throw new Error('El nombre del semestre es obligatorio.');
    }

    // Si se va a actualizar el estado a 1 (activo), primero ponemos todos los semestres en 0
    if (data.estado !== undefined && Number(estado) === 1) {
      await db.query('UPDATE semestres SET estado = 0');
    }

    let query = 'UPDATE semestres SET nombre = ?, fecha_inicio = ?, fecha_fin = ?';
    let params = [nombre, fecha_inicio, fecha_fin];

    if (data.estado !== undefined) {
      query += ', estado = ?';
      params.push(estado);
    }

    if (data.horario !== undefined) {
      const horarioJson = typeof horario === 'object' && horario !== null ? JSON.stringify(horario) : horario;
      query += ', horario = ?';
      params.push(horarioJson);
    }

    query += ' WHERE id = ?';
    params.push(id);

    await db.query(query, params);
    return { id, estado, nombre, fecha_inicio, fecha_fin, horario };
  },

  // 5. Eliminar un semestre por su ID
  async remove(id) {
    const db = await connect();
    await db.query('DELETE FROM semestres WHERE id = ?', [id]);
    return { message: 'Semestre eliminado con éxito', id };
  }
};

// ---------------------------------------------------------------------
// Helpers para que materias, docentes, asignaciones y talleres queden
// separados por semestre (columna `semestre_id`).
// ---------------------------------------------------------------------

// Para LISTAR: usa el semestre indicado (?semestre_id=) o, si no se manda,
// el semestre activo. Devuelve null si no hay ninguno (la lista queda vacía).
export async function resolverSemestreId(valor) {
  if (valor !== undefined && valor !== null && valor !== '') {
    const n = parseInt(valor, 10);
    if (!Number.isInteger(n) || n <= 0) {
      throw new Error('semestre_id inválido.');
    }
    return n;
  }
  const activo = await semestresService.getActivo();
  return activo ? activo.id : null;
}

// Para CREAR: igual que arriba, pero si no hay semestre se rechaza la operación.
export async function exigirSemestreId(valor) {
  const id = await resolverSemestreId(valor);
  if (!id) {
    throw new Error('No hay ningún semestre activo. Activa uno en la sección de Semestres antes de agregar registros.');
  }
  return id;
}
