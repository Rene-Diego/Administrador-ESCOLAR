import { adeudosService } from '../services/adeudos.service.mjs';

export const adeudosController = {
    async listar(req, res, next) {
        try {
            const { matricula } = req.query;
            res.json(await adeudosService.getAll(matricula));
        } catch (err) {
            next(err);
        }
    },

    async obtenerUno(req, res, next) {
        try {
            const adeudo = await adeudosService.getById(req.params.id);
            if (!adeudo) return res.status(404).json({ error: 'Adeudo no encontrado' });
            res.json(adeudo);
        } catch (err) {
            next(err);
        }
    },

    async crear(req, res, next) {
        try {
            res.status(201).json(await adeudosService.create(req.body));
        } catch (err) {
            next(err);
        }
    },

    async actualizar(req, res, next) {
        try {
            res.json(await adeudosService.update(req.params.id, req.body));
        } catch (err) {
            next(err);
        }
    },

    async eliminar(req, res, next) {
        try {
            res.json(await adeudosService.remove(req.params.id));
        } catch (err) {
            next(err);
        }
    }
};