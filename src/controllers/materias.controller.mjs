import { materiasService } from '../services/materias.service.mjs';

export const materiasController = {
  async listar(req, res, next) {
    try {
      res.json(await materiasService.getAll(req.query.semestre_id));
    } catch (err) {
      next(err);
    }
  },

  async obtenerUno(req, res, next) {
    try {
      const materia = await materiasService.getById(req.params.id);
      if (!materia) return res.status(404).json({ error: 'Materia no encontrada' });
      res.json(materia);
    } catch (err) {
      next(err);
    }
  },

  async crear(req, res, next) {
    try {
      if (!req.body.nombre) {
        return res.status(400).json({ error: 'El nombre de la materia es requerido' });
      }
      res.status(201).json(await materiasService.create(req.body));
    } catch (err) {
      next(err);
    }
  },

  async actualizar(req, res, next) {
    try {
      res.json(await materiasService.update(req.params.id, req.body));
    } catch (err) {
      next(err);
    }
  },

  async eliminar(req, res, next) {
    try {
      res.json(await materiasService.remove(req.params.id));
    } catch (err) {
      next(err);
    }
  }
};