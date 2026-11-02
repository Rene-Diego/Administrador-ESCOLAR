import connect from '../middlewares/db.mjs';
import bcrypt from 'bcrypt';

const SALT_ROUNDS = 10;

export const usuariosService = {
    // Obtener todos los usuarios (sin revelar la contraseña)
    async getAll() {
        const db = await connect();
        const [rows] = await db.query(
            'SELECT id, nombre_usuario, rol, departamento, fecha_creacion FROM usuarios ORDER BY id ASC'
        );
        return rows;
    },

    // Obtener un usuario por ID
    async getById(id) {
        const db = await connect();
        const [rows] = await db.query(
            'SELECT id, nombre_usuario, rol, departamento, fecha_creacion FROM usuarios WHERE id = ?',
            [id]
        );
        return rows[0] || null;
    },

    // Crear un nuevo usuario administrativo/departamental
    async create(data) {
        const db = await connect();
        const { nombre_usuario, password, rol, departamento } = data;

        if (!nombre_usuario || !password || !departamento) {
            throw new Error('El nombre de usuario, la contraseña y el departamento son obligatorios.');
        }

        // Verificar si el usuario ya existe
        const [existente] = await db.query('SELECT id FROM usuarios WHERE nombre_usuario = ?', [nombre_usuario]);
        if (existente[0]) {
            throw new Error('El nombre de usuario ya está en uso.');
        }

        // Cifrar la contraseña
        const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

        const [result] = await db.query(
            'INSERT INTO usuarios (nombre_usuario, password, rol, departamento) VALUES (?, ?, ?, ?)',
            [nombre_usuario, hashedPassword, rol || 'departamento', departamento]
        );

        return {
            id: result.insertId,
            nombre_usuario,
            rol: rol || 'departamento',
            departamento
        };
    },

    // Actualizar usuario (opcionalmente la contraseña si se envía)
    async update(id, data) {
        const db = await connect();
        const { nombre_usuario, password, rol, departamento } = data;

        const usuarioExistente = await this.getById(id);
        if (!usuarioExistente) {
            throw new Error('El usuario no existe.');
        }

        let query = 'UPDATE usuarios SET nombre_usuario = ?, rol = ?, departamento = ?';
        let params = [
            nombre_usuario || usuarioExistente.nombre_usuario,
            rol || usuarioExistente.rol,
            departamento || usuarioExistente.departamento
        ];

        // Si mandan una nueva contraseña, la ciframos y la actualizamos
        if (password && password.trim() !== '') {
            const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
            query += ', password = ?';
            params.push(hashedPassword);
        }

        query += ' WHERE id = ?';
        params.push(id);

        await db.query(query, params);

        return {
            id: Number(id),
            nombre_usuario: nombre_usuario || usuarioExistente.nombre_usuario,
            rol: rol || usuarioExistente.rol,
            departamento: departamento || usuarioExistente.departamento
        };
    },

    // Eliminar usuario
    async remove(id) {
        const db = await connect();
        const usuarioExistente = await this.getById(id);
        if (!usuarioExistente) {
            throw new Error('El usuario no existe.');
        }

        await db.query('DELETE FROM usuarios WHERE id = ?', [id]);
        return { message: 'Usuario eliminado con éxito', id: Number(id) };
    },

    // Método extra para el Login (por si lo necesitas más adelante)
    async login(nombre_usuario, password) {
        const db = await connect();
        const [rows] = await db.query('SELECT * FROM usuarios WHERE nombre_usuario = ?', [nombre_usuario]);
        const usuario = rows[0];

        if (!usuario) {
            throw new Error('Credenciales inválidas.');
        }

        const passwordMatch = await bcrypt.compare(password, usuario.password);
        if (!passwordMatch) {
            throw new Error('Credenciales inválidas.');
        }

        return {
            id: usuario.id,
            nombre_usuario: usuario.nombre_usuario,
            rol: usuario.rol,
            departamento: usuario.departamento
        };
    }
};