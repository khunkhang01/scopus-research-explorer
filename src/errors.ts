export class ResearchExplorerError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class UnsupportedDatabaseRuntimeError extends ResearchExplorerError {
  constructor(message: string, details?: unknown) {
    super("UNSUPPORTED_DATABASE_RUNTIME", message, details);
    this.name = "UnsupportedDatabaseRuntimeError";
  }
}

export class CapabilityUnavailableError extends ResearchExplorerError {
  constructor(feature: string, reason: string, requiredData: string[]) {
    super("CAPABILITY_UNAVAILABLE", `${feature}: ${reason}`, {
      feature,
      reason,
      requiredData
    });
    this.name = "CapabilityUnavailableError";
  }
}

export class SourceChangedError extends ResearchExplorerError {
  constructor(path: string) {
    super("SOURCE_CHANGED", `Source file changed after preflight: ${path}`, { path });
    this.name = "SourceChangedError";
  }
}

export class ValidationError extends ResearchExplorerError {
  constructor(message: string, details?: unknown) {
    super("VALIDATION_ERROR", message, details);
    this.name = "ValidationError";
  }
}

export class DatabaseWorkerError extends ResearchExplorerError {
  constructor(message: string, details?: unknown) {
    super("DATABASE_WORKER_ERROR", message, details);
    this.name = "DatabaseWorkerError";
  }
}

export class OperationCancelledError extends ResearchExplorerError {
  constructor(details?: unknown) {
    super("OPERATION_CANCELLED", "The operation was cancelled.", details);
    this.name = "OperationCancelledError";
  }
}

export class IdentifierConflictError extends ResearchExplorerError {
  constructor(message: string, details?: unknown) {
    super("IDENTIFIER_CONFLICT", message, details);
    this.name = "IdentifierConflictError";
  }
}

export class PreflightNotFoundError extends ResearchExplorerError {
  constructor(message = "Preflight expired or was not found.", details?: unknown) {
    super("PREFLIGHT_NOT_FOUND", message, details);
    this.name = "PreflightNotFoundError";
  }
}

export function errorFromWorker(
  code: string,
  message: string,
  details?: unknown
): ResearchExplorerError {
  if (code === "CAPABILITY_UNAVAILABLE") {
    const value = details as { feature?: string; reason?: string; requiredData?: string[] } | undefined;
    return new CapabilityUnavailableError(
      value?.feature ?? "feature",
      value?.reason ?? message,
      value?.requiredData ?? []
    );
  }
  if (code === "SOURCE_CHANGED") {
    const value = details as { path?: string } | undefined;
    return new SourceChangedError(value?.path ?? "unknown");
  }
  if (code === "VALIDATION_ERROR") return new ValidationError(message, details);
  if (code === "UNSUPPORTED_DATABASE_RUNTIME") {
    return new UnsupportedDatabaseRuntimeError(message, details);
  }
  if (code === "OPERATION_CANCELLED") return new OperationCancelledError(details);
  if (code === "IDENTIFIER_CONFLICT") return new IdentifierConflictError(message, details);
  if (code === "PREFLIGHT_NOT_FOUND") return new PreflightNotFoundError(message, details);
  if (code === "DATABASE_WORKER_ERROR") return new DatabaseWorkerError(message, details);
  return new ResearchExplorerError(code, message, details);
}
