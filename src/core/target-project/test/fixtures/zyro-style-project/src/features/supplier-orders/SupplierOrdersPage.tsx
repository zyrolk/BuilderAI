'use client';

import { fetchSupplierOrders } from './supplier-order-client';
import { OrderCancellationDialog } from './OrderCancellationDialog';

export { OrderCancellationDialog };

export function SupplierOrdersPage() {
  return (
    <section>
      <h1>Supplier Orders</h1>
      <button type="button" onClick={() => fetchSupplierOrders()}>
        Refresh orders
      </button>
    </section>
  );
}
