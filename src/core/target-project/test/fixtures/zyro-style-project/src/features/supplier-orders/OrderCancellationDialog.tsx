'use client';

import { cancelSupplierOrder } from './supplier-order-client';

export function OrderCancellationDialog({ orderId }: { readonly orderId: string }) {
  return (
    <dialog open>
      <p>Cancel supplier order {orderId}?</p>
      <button type="button" onClick={() => cancelSupplierOrder(orderId)}>
        Confirm cancellation
      </button>
    </dialog>
  );
}
