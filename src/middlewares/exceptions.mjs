// errores personalizados
export class TokenException extends Error {
  constructor(args) {
    super(args);
    this.name = "TokenException";
  }
}

export class FileException extends Error {
  constructor(args) {
    super(args);
    this.name = "FileException";
  }
}

export class NotFoundException extends Error {
  constructor(args) {
    super(args);
    this.name = "NotFoundException";
  }
}

export class ForbiddenException extends Error {
  constructor(args) {
    super(args);
    this.name = "ForbiddenException";
  }
}

export class BadRequestException extends Error {
  constructor(args) {
    super(args);
    this.name = "BadRequestException";
  }
}

export class ConflictException extends Error {
  constructor(args) {
    super(args);
    this.name = "ConflictException";
  }
}

export class UnprocessableEntityException extends Error {
  constructor(args) {
    super(args);
    this.name = "UnprocessableEntityException";
  }
}

export class PartialException extends Error {
  constructor(args) {
    super(args)
    this.name = "PartialException";
  }
}
