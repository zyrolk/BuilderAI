import {
  cancelSupplierOrderHandler,
  listSupplierOrdersHandler,
} from '../services/order-cancellation.service';

export function createSupplierOrderRoutes() {
  return {
    get: [{ path: '/supplier-orders', handler: listSupplierOrdersHandler }],
    post: [{ path: '/supplier-orders/:orderId/cancel', handler: cancelSupplierOrderHandler }],
  };
}
