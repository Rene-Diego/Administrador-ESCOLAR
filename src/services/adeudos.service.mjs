import connect from '../middlewares/db.mjs';

export const adeudosService = {
    // Obtener todos los adeudos (permite filtrar por matrícula con ?matricula=...)
    async getAll(matricula) {
        const db = await connect();
        if (matricula) {
            const [rows] = await db.query(
                'SELECT id, matricula, departamento, concepto, cantidad, fecha, estatus FROM adeudos WHERE matricula = ? ORDER BY id DESC',
                [matricula]
            );
            return rows;
        }
        const [rows] = await db.query('SELECT id, matricula, departamento, concepto, cantidad, fecha, estatus FROM adeudos ORDER BY id DESC');
        return rows;
    },

    // Obtener un adeudo específico por su ID
    async getById(id) {
        const db = await connect();
        const [rows] = await db.query(
            'SELECT id, matricula, departamento, concepto, cantidad, fecha, estatus FROM adeudos WHERE id = ?', 
            [id]
        );
        return rows[0] || null;
    },

    // Crear un nuevo adeudo
    async create(data) {
        const db = await connect();
        const { matricula, departamento, concepto, cantidad, fecha, estatus } = data;

        if (!matricula || !departamento || !concepto || cantidad === undefined || !fecha) {
            throw new Error('Matrícula, departamento, concepto, cantidad y fecha son obligatorios.');
        }

        // Validar que el alumno exista previamente
        const [alumnoRows] = await db.query('SELECT matricula FROM alumnos WHERE matricula = ?', [matricula]);
        if (!alumnoRows[0]) {
            throw new Error('El alumno con esa matrícula no existe en la base de datos.');
        }

        const [result] = await db.query(
            'INSERT INTO adeudos (matricula, departamento, concepto, cantidad, fecha, estatus) VALUES (?, ?, ?, ?, ?, ?)',
            [matricula, departamento, concepto, cantidad, fecha, estatus || 'pendiente']
        );

        return {
            id: result.insertId,
            matricula,
            departamento,
            concepto,
            cantidad,
            fecha,
            estatus: estatus || 'pendiente'
        };
    },

    // Actualizar un adeudo
    async update(id, data) {
        const db = await connect();
        const { departamento, concepto, cantidad, fecha, estatus } = data;

        const adeudoExistente = await this.getById(id);
        if (!adeudoExistente) {
            throw new Error('El adeudo no existe.');
        }

        await db.query(
            'UPDATE adeudos SET departamento = ?, concepto = ?, cantidad = ?, fecha = ?, estatus = ? WHERE id = ?',
            [
                departamento || adeudoExistente.departamento,
                concepto || adeudoExistente.concepto,
                cantidad !== undefined ? cantidad : adeudoExistente.cantidad,
                fecha || adeudoExistente.fecha,
                estatus || adeudoExistente.estatus,
                id
            ]
        );

        return {
            id: Number(id),
            matricula: adeudoExistente.matricula,
            departamento: departamento || adeudoExistente.departamento,
            concepto: concepto || adeudoExistente.concepto,
            cantidad: cantidad !== undefined ? cantidad : adeudoExistente.cantidad,
            fecha: fecha || adeudoExistente.fecha,
            estatus: estatus || adeudoExistente.estatus
        };
    },

    // Eliminar un adeudo
    async remove(id) {
        const db = await connect();
        const adeudoExistente = await this.getById(id);
        if (!adeudoExistente) {
            throw new Error('El adeudo no existe.');
        }

        await db.query('DELETE FROM adeudos WHERE id = ?', [id]);
        return { message: 'Adeudo eliminado con éxito', id: Number(id) };
    }
};