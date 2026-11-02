import { generarPdfAdeudosOSinAdeudos } from '../services/adeudosPdf.service.mjs';


export const adeudosPdfController = {
  async descargarPdfAdeudo(req, res, next) {
    try {
      const { matricula, adeudos } = req.body;

      if (!matricula) {
        return res.status(400).json({ error: 'La matrícula es obligatoria para generar el documento.' });
      }

      
      let alumnoInfo = req.body.alumnoInfo || null;

      if (!alumnoInfo) {
        try {
       
        } catch (dbError) {
          console.warn('No se pudo consultar el alumno en BD, usando datos básicos:', dbError);
        }
      }

      // Invocar la lógica del servicio con la información completa
      const pdfBuffer = await generarPdfAdeudosOSinAdeudos({ 
        matricula, 
        adeudos, 
        alumnoInfo 
      });

      const tieneAdeudos = adeudos && adeudos.some(a => {
        const estatus = a.estatus ? a.estatus.toLowerCase() : 'pendiente';
        return estatus === 'pendiente';
      });

      const nombreArchivo = tieneAdeudos ? 'Reporte_Adeudos_EPO219.pdf' : 'Certificado_Cero_Adeudos_EPO219.pdf';

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${nombreArchivo}"`);
      res.status(200).send(pdfBuffer);

    } catch (error) {
      console.error('Error al generar PDF de adeudos/certificado:', error);
      next(error);
    }
  }
};