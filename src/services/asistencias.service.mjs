import connect from '../middlewares/db.mjs';

export const asistenciasService = {
    // Obtener todas las asistencias (permite filtrar por user con ?user=...)
    async getAll(user) {
        const db = await connect();
        if (user) {
            const [rows] = await db.query(
                'SELECT id, operacion, user, nombre, extra, `fecha-hora` FROM asistencias WHERE user = ? ORDER BY id DESC',
                [user]
            );
            return rows;
        }
        const [rows] = await db.query('SELECT id, operacion, user, nombre, extra, `fecha-hora` FROM asistencias ORDER BY id DESC');
        return rows;
    },

    // Obtener un registro específico por su ID
    async getById(id) {
        const db = await connect();
        const [rows] = await db.query(
            'SELECT id, operacion, user, nombre, extra, `fecha-hora` FROM asistencias WHERE id = ?', 
            [id]
        );
        return rows[0] || null;
    },

    // Obtener registros por el campo user (matrícula o identificador)
    async getByUser(user) {
        const db = await connect();
        const [rows] = await db.query(
            'SELECT id, operacion, user, nombre, extra, `fecha-hora` FROM asistencias WHERE user = ? ORDER BY id DESC',
            [user]
        );
        return rows;
    },

    // Obtener registros de un usuario filtrados específicamente para el día actual (YYYY-MM-DD)
    async getByUserAndToday(user) {
        const db = await connect();
        const [rows] = await db.query(
            'SELECT id, operacion, user, nombre, extra, `fecha-hora` FROM asistencias WHERE user = ? AND DATE(`fecha-hora`) = CURDATE() ORDER BY id DESC',
            [user]
        );
        return rows;
    },

    // Crear un nuevo registro de asistencia
    async create(data) {
        const db = await connect();
        const { operacion, user, nombre, extra, fecha_hora } = data;

        if (!operacion || !user || !nombre) {
            throw new Error('Operación, usuario (user) y nombre son obligatorios.');
        }

        const [result] = await db.query(
            'INSERT INTO asistencias (operacion, user, nombre, extra, `fecha-hora`) VALUES (?, ?, ?, ?, ?)',
            [operacion, user, nombre, extra || null, fecha_hora || new Date()]
        );

        return {
            id: result.insertId,
            operacion,
            user,
            nombre,
            extra: extra || null,
            'fecha-hora': fecha_hora || new Date()
        };
    },

    // Actualizar un registro de asistencia
    async update(id, data) {
        const db = await connect();
        const { operacion, user, nombre, extra, fecha_hora } = data;

        const registroExistente = await this.getById(id);
        if (!registroExistente) {
            throw new Error('El registro de asistencia no existe.');
        }

        await db.query(
            'UPDATE asistencias SET operacion = ?, user = ?, nombre = ?, extra = ?, `fecha-hora` = ? WHERE id = ?',
            [
                operacion || registroExistente.operacion,
                user || registroExistente.user,
                nombre || registroExistente.nombre,
                extra !== undefined ? extra : registroExistente.extra,
                fecha_hora || registroExistente['fecha-hora'],
                id
            ]
        );

        return {
            id: Number(id),
            operacion: operacion || registroExistente.operacion,
            user: user || registroExistente.user,
            nombre: nombre || registroExistente.nombre,
            extra: extra !== undefined ? extra : registroExistente.extra,
            'fecha-hora': fecha_hora || registroExistente['fecha-hora']
        };
    },

    // Eliminar un registro de asistencia
    async remove(id) {
        const db = await connect();
        const registroExistente = await this.getById(id);
        if (!registroExistente) {
            throw new Error('El registro de asistencia no existe.');
        }

        await db.query('DELETE FROM asistencias WHERE id = ?', [id]);
        return { message: 'Registro de asistencia eliminado con éxito', id: Number(id) };
    }
};