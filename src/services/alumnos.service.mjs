import connect from '../middlewares/db.mjs';

export const alumnosService = {
    // Obtener todos los alumnos o buscar por matrícula, nombre o apellido
    async obtenerAlumnos(busqueda) {
        const db = await connect();
        if (busqueda) {
            const [rows] = await db.query(
                'SELECT id, matricula, nombre, apellido, grado, grupo FROM alumnos WHERE matricula LIKE ? OR nombre LIKE ? OR apellido LIKE ? ORDER BY id ASC',
                [`%${busqueda}%`, `%${busqueda}%`, `%${busqueda}%`]
            );
            return rows;
        }
        const [rows] = await db.query('SELECT id, matricula, nombre, apellido, grado, grupo FROM alumnos ORDER BY id ASC');
        return rows;
    },

    // Obtener un alumno específico por su matrícula única
    async obtenerPorMatricula(matricula) {
        const db = await connect();
        const [rows] = await db.query(
            'SELECT id, matricula, nombre, apellido, grado, grupo FROM alumnos WHERE matricula = ?', 
            [matricula]
        );
        return rows[0] || null;
    },

    // Registrar un nuevo alumno
    async crearAlumno(data) {
        const db = await connect();
        const { matricula, nombre, apellido, grado, grupo } = data;

        if (!matricula || !nombre || !apellido || !grado || !grupo) {
            throw new Error('Todos los campos (matrícula, nombre, apellido, grado y grupo) son obligatorios.');
        }

        // Verificar si ya existe un alumno con esa matrícula
        const alumnoExistente = await this.obtenerPorMatricula(matricula);
        if (alumnoExistente) {
            throw new Error('La matrícula ya se encuentra registrada.');
        }

        const [result] = await db.query(
            'INSERT INTO alumnos (matricula, nombre, apellido, grado, grupo) VALUES (?, ?, ?, ?, ?)',
            [matricula, nombre, apellido, grado, grupo]
        );

        return {
            id: result.insertId,
            matricula,
            nombre,
            apellido,
            grado,
            grupo
        };
    },

    // Actualizar un alumno por su matrícula
    async actualizarAlumno(matricula, data) {
        const db = await connect();
        const { nombre, apellido, grado, grupo } = data;

        if (!nombre || !apellido || !grado || !grupo) {
            throw new Error('Todos los campos de actualización son obligatorios.');
        }

        const alumnoExistente = await this.obtenerPorMatricula(matricula);
        if (!alumnoExistente) {
            throw new Error('El alumno no existe.');
        }

        await db.query(
            'UPDATE alumnos SET nombre = ?, apellido = ?, grado = ?, grupo = ? WHERE matricula = ?',
            [nombre, apellido, grado, grupo, matricula]
        );

        return {
            matricula,
            nombre,
            apellido,
            grado,
            grupo
        };
    },

    // Eliminar un alumno por su matrícula
    async eliminarAlumno(matricula) {
        const db = await connect();
        const alumnoExistente = await this.obtenerPorMatricula(matricula);
        if (!alumnoExistente) {
            throw new Error('El alumno no existe.');
        }

        await db.query('DELETE FROM alumnos WHERE matricula = ?', [matricula]);
        return { message: 'Alumno eliminado con éxito', matricula };
    }
};