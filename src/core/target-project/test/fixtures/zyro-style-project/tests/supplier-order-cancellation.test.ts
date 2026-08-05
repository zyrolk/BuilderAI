import assert from 'node:assert/strict';

import { validateCancellationRequest } from '../server/validation/order-cancellation.schema';

const valid = validateCancellationRequest({ orderId: 'order-1', reason: 'supplier unavailable' });
assert.equal(valid.orderId, 'order-1');
