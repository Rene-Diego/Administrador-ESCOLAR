import connect from '../middlewares/db.mjs';

export const recesosService = {
  // Devuelve la configuración de receso de los 3 grados (crea valores por defecto si faltan)
  async getAll() {
    const db = await connect();
    const [rows] = await db.query('SELECT grado, hora_inicio, duracion_minutos FROM recesos ORDER BY grado ASC');

    const porDefecto = {
      1: '10:30',
      2: '11:20',
      3: '12:10'
    };

    const mapa = {};
    [1, 2, 3].forEach(g => {
      const fila = rows.find(r => Number(r.grado) === g);
      mapa[g] = fila
        ? { grado: g, hora_inicio: fila.hora_inicio, duracion_minutos: fila.duracion_minutos }
        : { grado: g, hora_inicio: porDefecto[g], duracion_minutos: 30 };
    });

    return mapa;
  },

  // Guarda/actualiza el receso de un grado específico (upsert)
  async guardar(grado, hora_inicio, duracion_minutos = 30) {
    const db = await connect();
    const g = parseInt(grado, 10);

    if (![1, 2, 3].includes(g) || !hora_inicio) {
      throw new Error('Grado (1, 2 o 3) y hora de inicio son obligatorios.');
    }

    await db.query(
      `INSERT INTO recesos (grado, hora_inicio, duracion_minutos)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE hora_inicio = VALUES(hora_inicio), duracion_minutos = VALUES(duracion_minutos)`,
      [g, hora_inicio, duracion_minutos || 30]
    );

    return { grado: g, hora_inicio, duracion_minutos: duracion_minutos || 30 };
  }
};
