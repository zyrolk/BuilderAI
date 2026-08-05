export type SupplierOrderType = 'pending' | 'cancelled' | 'fulfilled';

export interface SupplierOrder {
  readonly id: string;
  readonly supplierId: string;
  readonly status: SupplierOrderType;
}
