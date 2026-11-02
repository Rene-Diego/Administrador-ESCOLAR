import { recesosService } from '../services/recesos.service.mjs';

export const recesosController = {
  async listar(req, res, next) {
    try {
      res.json(await recesosService.getAll());
    } catch (err) {
      next(err);
    }
  },

  async guardar(req, res, next) {
    try {
      const { grado, hora_inicio, duracion_minutos } = req.body;
      res.json(await recesosService.guardar(grado, hora_inicio, duracion_minutos));
    } catch (err) {
      next(err);
    }
  }
};
