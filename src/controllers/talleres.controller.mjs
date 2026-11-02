import { talleresService } from '../services/talleres.service.mjs';

export const talleresController = {
  async listar(req, res, next) {
    try {
      res.json(await talleresService.getAll(req.query.semestre_id));
    } catch (err) {
      next(err);
    }
  },

  async obtenerUno(req, res, next) {
    try {
      const taller = await talleresService.getById(req.params.id);
      if (!taller) return res.status(404).json({ error: 'Taller no encontrado' });
      res.json(taller);
    } catch (err) {
      next(err);
    }
  },

  async crear(req, res, next) {
    try {
      res.status(201).json(await talleresService.create(req.body));
    } catch (err) {
      next(err);
    }
  },

  async actualizar(req, res, next) {
    try {
      res.json(await talleresService.update(req.params.id, req.body));
    } catch (err) {
      next(err);
    }
  },

  async eliminar(req, res, next) {
    try {
      res.json(await talleresService.remove(req.params.id));
    } catch (err) {
      next(err);
    }
  }
};
