import { DatabaseWorkerError, errorFromWorker, OperationCancelledError } from "../errors";
import type { WorkerRequest, WorkerResponse, WorkerResultMap } from "./protocol";

type RequestType = WorkerRequest["type"];
type PayloadFor<T extends RequestType> = Extract<WorkerRequest, { type: T }>["payload"];

export class DatabaseWorkerClient {
  private readonly worker: Worker;
  private readonly workerUrl: string;
  private readonly pending = new Map<string, {
    resolve: (value: any) => void;
    reject: (error: unknown) => void;
    onProgress?: (progress: { phase: string; completed: number; total: number }) => void;
  }>();

  constructor(workerUrl: string) {
    this.workerUrl = workerUrl;
    this.worker = new Worker(workerUrl);
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const pending = this.pending.get(event.data.id);
      if (!pending) return;
      if ("progress" in event.data) {
        pending.onProgress?.(event.data.progress);
        return;
      }
      this.pending.delete(event.data.id);
      if (event.data.ok) pending.resolve(event.data.result);
      else pending.reject(errorFromWorker(
        event.data.error.code,
        event.data.error.message,
        event.data.error.details
      ));
    };
    this.worker.onerror = (event) => {
      const error = new DatabaseWorkerError(event.message);
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
    };
  }

  request<T extends RequestType>(
    type: T,
    payload: PayloadFor<T>,
    transfer: Transferable[] = [],
    options: {
      signal?: AbortSignal;
      onProgress?: (progress: { phase: string; completed: number; total: number }) => void;
    } = {}
  ): Promise<WorkerResultMap[T]> {
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const { signal } = options;
      const abort = () => {
        if (!this.pending.delete(id)) return;
        this.worker.postMessage({ id: crypto.randomUUID(), type: "cancel", payload: { requestId: id } });
        reject(new OperationCancelledError({ requestId: id }));
      };
      if (signal?.aborted) {
        reject(new OperationCancelledError({ requestId: id }));
        return;
      }
      this.pending.set(id, {
        resolve: (value) => {
          signal?.removeEventListener("abort", abort);
          resolve(value);
        },
        reject: (error) => {
          signal?.removeEventListener("abort", abort);
          reject(error);
        },
        onProgress: options.onProgress
      });
      signal?.addEventListener("abort", abort, { once: true });
      this.worker.postMessage({ id, type, payload } as WorkerRequest, transfer);
    }) as Promise<WorkerResultMap[T]>;
  }

  terminate(): void {
    const error = new DatabaseWorkerError("Database worker was terminated.");
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    this.worker.terminate();
    URL.revokeObjectURL(this.workerUrl);
  }
}
