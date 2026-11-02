// Configuarcion general de errores

// en caso de que sudeda un error, este archivo se encarga de procesarlo, dependiendo del tipo de error que regrese

import { NotFoundException, ForbiddenException, TokenException, FileException, ConflictException, BadRequestException, UnprocessableEntityException, PartialException } from "./exceptions.mjs";

function errorHandler(err, req, res, next) {
  // Las vistas del cliente leen `error`; el resto del sistema usa `mensaje`. Enviamos ambos.
  const jsonOriginal = res.json.bind(res);
  res.json = (body) => jsonOriginal(
    body && body.mensaje && !body.error ? { ...body, error: body.mensaje } : body
  );

  if (typeof err === "string") {
    return res.status(400).json({ mensaje: err });
  }

  if (err.name === "ValidationError" || err instanceof BadRequestException) {
    return res.status(400).json({ mensaje: err.message });
  }

  if (err.name === "UnauthorizedError" || err instanceof TokenException) {
    return res.status(401).json({ mensaje: "BAD_TOKEN" });
  }

  if (err instanceof ForbiddenException) {
    return res.status(403).json({ mensaje: "Permisos insuficientes." });
  }

  if (err instanceof NotFoundException) {
    return res.status(404).json({ mensaje: err.message });
  }

  if (err instanceof FileException || err instanceof ConflictException) {
    return res.status(409).json({ mensaje: err.message });
  }

  if (err instanceof UnprocessableEntityException) {
    return res.status(422).json({ mensaje: err.message });
  }

  if (err instanceof PartialException) {
    return res.status(200).json({ mensaje: err.message, esParcial: true });
  }

  if (err.message.includes("File too large")) {
    return res
      .status(409)
      .json({ mensaje: "Tamaño máximo de archivo excedido." });
  }

  return res.status(500).json({ mensaje: err.message });
}

export default errorHandler;
