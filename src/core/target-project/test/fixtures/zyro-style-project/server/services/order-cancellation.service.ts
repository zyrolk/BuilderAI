import type { SupplierOrder } from '../../src/shared/order-types';
import { validateCancellationRequest } from '../validation/order-cancellation.schema';

type JsonResponse = {
  status(code: number): JsonResponse;
  json(body: unknown): void;
};

type RequestLike = { readonly body: unknown };
type Handler = (request: RequestLike, response: JsonResponse) => void;

const orders: SupplierOrder[] = [{ id: 'order-1', supplierId: 'supplier-1', status: 'pending' }];

export const listSupplierOrdersHandler: Handler = (_request, response) => {
  response.status(200).json(orders);
};

export const cancelSupplierOrderHandler: Handler = (request, response) => {
  const payload = validateCancellationRequest(request.body);
  const orderIndex = orders.findIndex(({ id }) => id === payload.orderId);
  if (orderIndex < 0) {
    response.status(404).json({ message: 'Order not found' });
    return;
  }
  orders[orderIndex] = { ...orders[orderIndex]!, status: 'cancelled' };
  response.status(200).json(orders[orderIndex]);
};
