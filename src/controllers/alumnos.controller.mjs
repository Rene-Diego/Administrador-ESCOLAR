import { alumnosService } from '../services/alumnos.service.mjs';

export const alumnosController = {
    // Listar todos los alumnos (o filtrar por búsqueda)
    async listar(req, res) {
        try {
            const { busqueda } = req.query;
            const alumnos = await alumnosService.obtenerAlumnos(busqueda);
            res.json(alumnos);
        } catch (error) {
            console.error('Error al obtener alumnos:', error);
            res.status(500).json({ error: error.message || 'Error al obtener la lista de alumnos' });
        }
    },

    // Obtener un alumno por matrícula
    async obtenerPorMatricula(req, res) {
        try {
            const { matricula } = req.params;
            const alumno = await alumnosService.obtenerPorMatricula(matricula);
            if (!alumno) {
                return res.status(404).json({ error: 'Alumno no encontrado' });
            }
            res.json(alumno);
        } catch (error) {
            console.error('Error al buscar alumno:', error);
            res.status(500).json({ error: error.message || 'Error al buscar el alumno' });
        }
    },

    // Registrar un nuevo alumno
    async crear(req, res) {
        try {
            const { matricula, nombre, apellido, grado, grupo } = req.body;
            const nuevoAlumno = await alumnosService.crearAlumno({
                matricula,
                nombre,
                apellido,
                grado,
                grupo
            });
            res.status(201).json(nuevoAlumno);
        } catch (error) {
            console.error('Error al crear alumno:', error);
            res.status(400).json({ error: error.message || 'Error al registrar el alumno' });
        }
    },

    // Actualizar un alumno existente
    async actualizar(req, res) {
        try {
            const { matricula } = req.params;
            const { nombre, apellido, grado, grupo } = req.body;
            
            const alumnoActualizado = await alumnosService.actualizarAlumno(matricula, {
                nombre,
                apellido,
                grado,
                grupo
            });
            res.json(alumnoActualizado);
        } catch (error) {
            console.error('Error al actualizar alumno:', error);
            res.status(400).json({ error: error.message || 'Error al actualizar el alumno' });
        }
    },

    // Eliminar un alumno
    async eliminar(req, res) {
        try {
            const { matricula } = req.params;
            const resultado = await alumnosService.eliminarAlumno(matricula);
            res.json(resultado);
        } catch (error) {
            console.error('Error al eliminar alumno:', error);
            res.status(400).json({ error: error.message || 'Error al eliminar el alumno' });
        }
    }
};