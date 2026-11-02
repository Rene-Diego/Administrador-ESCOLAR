import { maestrosService } from '../services/maestros.service.mjs';

export const maestrosController = {
  async listar(req, res, next) {
    try {
      res.json(await maestrosService.getAll(req.query.semestre_id));
    } catch (err) {
      next(err);
    }
  },

  async obtenerUno(req, res, next) {
    try {
      const docente = await maestrosService.getById(req.params.id);
      if (!docente) return res.status(404).json({ error: 'Docente no encontrado' });
      res.json(docente);
    } catch (err) {
      next(err);
    }
  },

  async crear(req, res, next) {
    try {
      if (!req.body.nombre) {
        return res.status(400).json({ error: 'El nombre es obligatorio' });
      }
      res.status(201).json(await maestrosService.create(req.body));
    } catch (err) {
      next(err);
    }
  },

  async actualizar(req, res, next) {
    try {
      res.json(await maestrosService.update(req.params.id, req.body));
    } catch (err) {
      next(err);
    }
  },

  async eliminar(req, res, next) {
    try {
      res.json(await maestrosService.remove(req.params.id));
    } catch (err) {
      next(err);
    }
  }
};