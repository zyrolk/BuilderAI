export interface CancellationRequest {
  readonly orderId: string;
  readonly reason: string;
}

export function validateCancellationRequest(value: unknown): CancellationRequest {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Cancellation request must be an object.');
  }
  const orderId = Reflect.get(value, 'orderId');
  const reason = Reflect.get(value, 'reason');
  if (typeof orderId !== 'string' || orderId.trim().length === 0) {
    throw new Error('orderId is required.');
  }
  if (typeof reason !== 'string' || reason.trim().length === 0) {
    throw new Error('reason is required.');
  }
  return { orderId: orderId.trim(), reason: reason.trim() };
}
