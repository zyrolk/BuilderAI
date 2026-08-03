/** Transport-level abort classification passed from GeminiProvider to GeminiErrorMapper. */
export interface GeminiAbortContext {
  readonly cancellationReason?: string;
  /** True only when request.cancellation.subscribe invoked controller.abort(). */
  readonly callerInitiatedAbort: boolean;
}
