import type { SupplierOrder } from '../../shared/order-types';

export async function fetchSupplierOrders(): Promise<readonly SupplierOrder[]> {
  const response = await fetch('/api/supplier-orders');
  return (await response.json()) as readonly SupplierOrder[];
}

export async function cancelSupplierOrder(orderId: string): Promise<void> {
  await fetch(`/api/supplier-orders/${orderId}/cancel`, { method: 'POST' });
}
