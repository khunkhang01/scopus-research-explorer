import { describe, expect, it } from "vitest";
import {
  CapabilityUnavailableError,
  errorFromWorker,
  IdentifierConflictError,
  OperationCancelledError,
  PreflightNotFoundError,
  SourceChangedError
} from "../src/errors";

describe("typed runtime errors", () => {
  it("reconstructs capability errors without depending on minified class names", () => {
    const error = errorFromWorker("CAPABILITY_UNAVAILABLE", "Unavailable", {
      feature: "references",
      reason: "No resolved references",
      requiredData: ["References"]
    });
    expect(error).toBeInstanceOf(CapabilityUnavailableError);
    expect(error.name).toBe("CapabilityUnavailableError");
  });

  it("reconstructs source-change and cancellation errors", () => {
    expect(errorFromWorker("SOURCE_CHANGED", "changed", { path: "source.csv" }))
      .toBeInstanceOf(SourceChangedError);
    expect(errorFromWorker("OPERATION_CANCELLED", "cancelled"))
      .toBeInstanceOf(OperationCancelledError);
  });

  it("reconstructs import lifecycle errors", () => {
    expect(errorFromWorker("IDENTIFIER_CONFLICT", "conflict"))
      .toBeInstanceOf(IdentifierConflictError);
    expect(errorFromWorker("PREFLIGHT_NOT_FOUND", "expired"))
      .toBeInstanceOf(PreflightNotFoundError);
  });
});
