import { horariosService } from '../services/horarios.service.mjs';
import { generarPDF } from '../services/generador.service.mjs';
import { auditarHorarioEnBD } from '../services/auditoria.service.mjs';

export const generadorController = {
  async ejecutarGeneracion(req, res, next) {
    try {
      const { restricciones, recesos, talleres } = req.body;
      const resultado = await horariosService.generar({ restricciones, recesos, talleres });
      
      // ✅ GUARDAMOS EL HORARIO GENERADO EN MEMORIA PARA QUE EL CHAT LO LEA AUTOMÁTICAMENTE
      global.ultimoHorarioGenerado = resultado;

      // Devolvemos el resultado asegurando la propiedad de éxito
      res.json({ exito: true, ...resultado });
    } catch (error) {
      console.error('Error al generar horarios:', error.message);
      // Capturamos cualquier error (como la falta de semestre activo) y se lo mandamos al frontend
      res.status(400).json({ exito: false, error: error.message });
    }
  },

  // Audita un horario (nuevo, guardado o editado a mano) contra las condiciones de la BD
  async auditarHorario(req, res) {
    try {
      const { horarios, semestre_id, excluidas } = req.body || {};
      if (!horarios || typeof horarios !== 'object' || Object.keys(horarios).length === 0) {
        return res.status(400).json({ exito: false, error: 'No se recibió ningún horario para auditar.' });
      }
      const resultado = await auditarHorarioEnBD(horarios, semestre_id, Array.isArray(excluidas) ? excluidas : []);
      res.json({ exito: true, ...resultado });
    } catch (error) {
      console.error('Error al auditar horario:', error.message);
      res.status(400).json({ exito: false, error: error.message });
    }
  }
};

export async function descargarPDFController(req, res) {
  try {
    const datosHorario = req.body; // El JSON con los horarios que envías desde el frontend

    // Invocar la lógica pesada en el servicio
    const pdfBuffer = await generarPDF(datosHorario);

    // Configurar cabeceras HTTP para forzar la descarga del PDF
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="Horarios_EPO219.pdf"');
    
    // Enviar el archivo binario
    res.status(200).send(pdfBuffer);
  } catch (error) {
    console.error('Error al generar PDF:', error);
    res.status(500).json({ error: 'Fallo interno al generar el documento PDF' });
  }
}