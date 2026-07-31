export interface ExecutionCancellationToken {
  readonly cancelled: boolean;
  readonly reason?: string;
  subscribe(listener: (reason?: string) => void): () => void;
}
