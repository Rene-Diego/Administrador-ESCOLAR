-- =====================================================================
-- MIGRACIÓN: separar por SEMESTRE (semestre_id) en lugar de por fechas
-- Base de datos: escuela_epo  (la que usa Server/src/middlewares/db.mjs)
--
-- Agrega la columna `semestre_id` a: docentes, materias, asignaciones, talleres
-- y asigna TODOS los registros que ya existen a un semestre.
--
-- ⚠️ EJECÚTALO UNA SOLA VEZ (si lo corres dos veces, MySQL dirá que la
--    columna ya existe y se detendrá sin dañar nada).
-- ⚠️ Haz un respaldo (Exportar en phpMyAdmin) antes de correrlo.
-- =====================================================================

USE escuela_epo;

-- ---------------------------------------------------------------------
-- 1) ¿A qué semestre pertenecen los registros que ya tienes?
--    Por defecto: el semestre ACTIVO (estado = 1); si no hay ninguno
--    activo, el semestre más reciente (mayor id).
--    Si quieres otro, cambia la línea de abajo por, por ejemplo:
--        SET @semestre_destino = 18;
-- ---------------------------------------------------------------------
SET @semestre_destino = COALESCE(
  (SELECT id FROM semestres WHERE estado = 1 ORDER BY id DESC LIMIT 1),
  (SELECT MAX(id) FROM semestres)
);

-- Para revisar a cuál se va a asignar, antes de continuar:
SELECT @semestre_destino AS semestre_destino, s.nombre
FROM semestres s WHERE s.id = @semestre_destino;

-- ---------------------------------------------------------------------
-- 2) Agregar la columna (primero permite NULL para poder rellenarla)
-- ---------------------------------------------------------------------
ALTER TABLE docentes     ADD COLUMN semestre_id INT NULL AFTER id;
ALTER TABLE materias     ADD COLUMN semestre_id INT NULL AFTER id;
ALTER TABLE asignaciones ADD COLUMN semestre_id INT NULL AFTER id;
ALTER TABLE talleres     ADD COLUMN semestre_id INT NULL AFTER id;

-- ---------------------------------------------------------------------
-- 3) Rellenar los registros existentes con el semestre destino
-- ---------------------------------------------------------------------
UPDATE docentes     SET semestre_id = @semestre_destino WHERE semestre_id IS NULL;
UPDATE materias     SET semestre_id = @semestre_destino WHERE semestre_id IS NULL;
UPDATE asignaciones SET semestre_id = @semestre_destino WHERE semestre_id IS NULL;
UPDATE talleres     SET semestre_id = @semestre_destino WHERE semestre_id IS NULL;

-- ---------------------------------------------------------------------
-- 4) Volver la columna obligatoria + llave foránea + índice
--    ON DELETE CASCADE: al borrar un semestre se borran también sus
--    docentes, materias, asignaciones y talleres.
-- ---------------------------------------------------------------------
ALTER TABLE docentes
  MODIFY semestre_id INT NOT NULL,
  ADD INDEX idx_docentes_semestre (semestre_id),
  ADD CONSTRAINT fk_docentes_semestre FOREIGN KEY (semestre_id) REFERENCES semestres(id) ON DELETE CASCADE;

ALTER TABLE materias
  MODIFY semestre_id INT NOT NULL,
  ADD INDEX idx_materias_semestre (semestre_id),
  ADD CONSTRAINT fk_materias_semestre FOREIGN KEY (semestre_id) REFERENCES semestres(id) ON DELETE CASCADE;

ALTER TABLE asignaciones
  MODIFY semestre_id INT NOT NULL,
  ADD INDEX idx_asignaciones_semestre (semestre_id),
  ADD CONSTRAINT fk_asignaciones_semestre FOREIGN KEY (semestre_id) REFERENCES semestres(id) ON DELETE CASCADE;

ALTER TABLE talleres
  MODIFY semestre_id INT NOT NULL,
  ADD INDEX idx_talleres_semestre (semestre_id),
  ADD CONSTRAINT fk_talleres_semestre FOREIGN KEY (semestre_id) REFERENCES semestres(id) ON DELETE CASCADE;

-- ---------------------------------------------------------------------
-- 5) Verificación rápida: cuántos registros tiene cada semestre
-- ---------------------------------------------------------------------
SELECT s.id, s.nombre, s.estado,
  (SELECT COUNT(*) FROM docentes     WHERE semestre_id = s.id) AS docentes,
  (SELECT COUNT(*) FROM materias     WHERE semestre_id = s.id) AS materias,
  (SELECT COUNT(*) FROM asignaciones WHERE semestre_id = s.id) AS asignaciones,
  (SELECT COUNT(*) FROM talleres     WHERE semestre_id = s.id) AS talleres
FROM semestres s
ORDER BY s.id;
