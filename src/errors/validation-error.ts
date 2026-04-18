export type ValidationErrorDetail = {
  field: string;
  message: string;
};

export type ValidationErrorPayload = {
  error: "validation_failed";
  message: string;
  details: ValidationErrorDetail[];
};

export class ValidationError extends Error {
  readonly code = "validation_failed";

  constructor(
    message: string,
    readonly details: ValidationErrorDetail[]
  ) {
    super(message);
    this.name = "ValidationError";
  }

  toPayload(): ValidationErrorPayload {
    return {
      error: this.code,
      message: this.message,
      details: this.details
    };
  }
}

export function singleValidationError(field: string, message: string): ValidationError {
  return new ValidationError("frontmatter validation failed", [{ field, message }]);
}

