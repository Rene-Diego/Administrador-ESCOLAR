import { asignacionesService } from '../services/asignaciones.service.mjs';

export const asignacionesController = {
  async listar(req, res, next) {
    try {
      res.json(await asignacionesService.getAll(req.query.semestre_id));
    } catch (err) {
      console.error('Error al listar asignaciones:', err.message);
      next(err);
    }
  },

  async crear(req, res, next) {
    try {
      const { docente_id, materia_id, grado, grupos, grupo } = req.body;
      const tieneGrupos = (Array.isArray(grupos) && grupos.length > 0) || grupo;

      if (!docente_id || !materia_id || !grado || !tieneGrupos) {
        return res.status(400).json({ error: 'Docente, materia, grado y grupos son requeridos' });
      }

      const resultado = await asignacionesService.create(req.body);
      res.status(201).json(resultado);
    } catch (err) {
      console.error('Error al crear asignación:', err.message);
      const validacion = err.name === 'BadRequestException' || err.name === 'ConflictException';
      res.status(err.name === 'ConflictException' ? 409 : validacion ? 400 : 500).json({ error: err.message, mensaje: err.message });
    }
  },

  async eliminar(req, res, next) {
    try {
      res.json(await asignacionesService.remove(req.params.id));
    } catch (err) {
      next(err);
    }
  },
  async actualizar(req, res, next) {
    try {
      const { id } = req.params;
      const asignacionActualizada = await asignacionesService.actualizar(id, req.body);
      res.json(asignacionActualizada);
    } catch (err) {
      next(err);
    }
  }
};