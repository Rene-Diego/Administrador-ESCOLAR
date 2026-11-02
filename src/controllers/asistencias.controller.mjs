import { asistenciasService } from '../services/asistencias.service.mjs';

export const asistenciasController = {
    async listar(req, res, next) {
        try {
            const { user } = req.query;
            res.json(await asistenciasService.getAll(user));
        } catch (err) {
            next(err);
        }
    },

    async obtenerUno(req, res, next) {
        try {
            const registro = await asistenciasService.getById(req.params.id);
            if (!registro) return res.status(404).json({ error: 'Registro de asistencia no encontrado' });
            res.json(registro);
        } catch (err) {
            next(err);
        }
    },

    async obtenerPorUser(req, res, next) {
        try {
            // Soporta parámetro para consultar solo los de hoy si se manda ?today=true, o todos por defecto
            const { today } = req.query;
            const registros = today === 'true' 
                ? await asistenciasService.getByUserAndToday(req.params.user)
                : await asistenciasService.getByUser(req.params.user);
            res.json(registros);
        } catch (err) {
            next(err);
        }
    },

    async crear(req, res, next) {
        try {
            res.status(201).json(await asistenciasService.create(req.body));
        } catch (err) {
            next(err);
        }
    },

    async actualizar(req, res, next) {
        try {
            res.json(await asistenciasService.update(req.params.id, req.body));
        } catch (err) {
            next(err);
        }
    },

    async eliminar(req, res, next) {
        try {
            res.json(await asistenciasService.remove(req.params.id));
        } catch (err) {
            next(err);
        }
    }
};