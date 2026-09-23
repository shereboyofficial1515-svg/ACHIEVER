import { AppError } from '../../utils/AppError.js';

const notConfigured = () => {
  throw AppError.unavailable(
    'Bill payments are not yet available. A bill-payment provider has not been configured.',
    'BILL_PROVIDER_NOT_CONFIGURED',
  );
};

/** Used when BILL_PROVIDER=disabled. Customers are never charged. */
export const disabledProvider = {
  name: 'disabled',
  enabled: false,
  catalog: () => ({ airtime: [], data: [], electricity: [] }),
  listVariations: notConfigured,
  verifyCustomer: notConfigured,
  purchase: notConfigured,
  requery: notConfigured,
};
