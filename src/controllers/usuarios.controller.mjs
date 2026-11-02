import { usuariosService } from '../services/usuarios.service.mjs';

export const usuariosController = {
    async listar(req, res, next) {
        try {
            res.json(await usuariosService.getAll());
        } catch (err) {
            next(err);
        }
    },

    async obtenerUno(req, res, next) {
        try {
            const usuario = await usuariosService.getById(req.params.id);
            if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });
            res.json(usuario);
        } catch (err) {
            next(err);
        }
    },

    async crear(req, res, next) {
        try {
            res.status(201).json(await usuariosService.create(req.body));
        } catch (err) {
            next(err);
        }
    },

    async actualizar(req, res, next) {
        try {
            res.json(await usuariosService.update(req.params.id, req.body));
        } catch (err) {
            next(err);
        }
    },

    async eliminar(req, res, next) {
        try {
            res.json(await usuariosService.remove(req.params.id));
        } catch (err) {
            next(err);
        }
    },

    async login(req, res, next) {
        try {
            const { nombre_usuario, password } = req.body;
            if (!nombre_usuario || !password) {
                return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
            }
            const resultado = await usuariosService.login(nombre_usuario, password);
            res.json({ mensaje: 'Login exitoso', usuario: resultado });
        } catch (err) {
            res.status(401).json({ error: err.message });
        }
    }
};