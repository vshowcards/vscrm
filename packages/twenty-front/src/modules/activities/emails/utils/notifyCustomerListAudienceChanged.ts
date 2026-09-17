export const CUSTOMER_LIST_AUDIENCE_CHANGED = 'customer-list-audience-changed';

export const notifyCustomerListAudienceChanged = (listId: string) => {
  window.dispatchEvent(
    new CustomEvent<string>(CUSTOMER_LIST_AUDIENCE_CHANGED, { detail: listId }),
  );
};
