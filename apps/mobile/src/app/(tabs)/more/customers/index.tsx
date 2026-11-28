import { CustomerList } from '@/customers/customer-list';

/** Customers under More, when the store's Inbox tab takes the Customers tab's place. */
export default function MoreCustomersScreen() {
  return <CustomerList base="/more/customers" />;
}
