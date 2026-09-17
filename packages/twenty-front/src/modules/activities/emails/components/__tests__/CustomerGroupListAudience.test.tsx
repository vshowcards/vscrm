import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { CustomerGroupListAudience } from '@/activities/emails/components/CustomerGroupListAudience';
import { CUSTOMER_LIST_AUDIENCE_CHANGED } from '@/activities/emails/utils/notifyCustomerListAudienceChanged';

jest.mock('@linaria/react', () => ({
  styled: Object.fromEntries(
    ['section', 'div', 'select'].map((tag) => [tag, () => tag]),
  ),
}));
jest.mock('twenty-ui/input', () => ({
  Button: ({
    title,
    disabled,
    onClick,
  }: {
    title: string;
    disabled?: boolean;
    onClick?: () => void;
  }) => (
    <button disabled={disabled} onClick={onClick}>
      {title}
    </button>
  ),
}));
jest.mock('~/config', () => ({
  REACT_APP_SERVER_BASE_URL: 'http://localhost:3100',
}));
const originalFetch = global.fetch;

describe('customer group list audience controls', () => {
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('requires a fresh preview after changing groups and does not send campaigns', async () => {
    const changed = jest.fn();
    window.addEventListener(CUSTOMER_LIST_AUDIENCE_CHANGED, changed);
    global.fetch = jest.fn(
      async (url) =>
        ({
          ok: true,
          json: async () =>
            String(url).endsWith('/preview')
              ? {
                  matching: 2,
                  additions: 2,
                  removals: 0,
                  sample: [{ id: 'one', name: 'Example Contact' }],
                }
              : {
                  list: { id: 'list', name: 'Follow-up' },
                  rule: null,
                  groups: [
                    { value: 'TRIED_REGISTER', label: 'Tried Register' },
                    { value: 'PAID', label: 'Paid User' },
                  ],
                },
        }) as Response,
    );
    const user = userEvent.setup();
    render(
      <I18nProvider i18n={i18n}>
        <CustomerGroupListAudience listId="list" />
      </I18nProvider>,
    );
    await screen.findByText('Follow-up', { exact: false });
    expect(
      screen.getByRole('button', { name: 'Apply audience' }),
    ).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Preview audience' }));
    expect(await screen.findByText(/Example Contact/)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Apply audience' }),
    ).toBeEnabled();
    await user.selectOptions(screen.getByLabelText('Customer Group'), 'PAID');
    expect(
      screen.getByRole('button', { name: 'Apply audience' }),
    ).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Preview audience' }));
    await user.click(screen.getByRole('button', { name: 'Apply audience' }));
    await screen.findByText(/No emails were sent/);
    expect(changed).toHaveBeenCalledWith(
      expect.objectContaining({ detail: 'list' }),
    );
    window.removeEventListener(CUSTOMER_LIST_AUDIENCE_CHANGED, changed);
    expect(
      jest
        .mocked(global.fetch)
        .mock.calls.every(([url]) =>
          String(url).includes('/app/customer-sync/lists/list/audience'),
        ),
    ).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/apply'),
      expect.objectContaining({
        body: JSON.stringify({ group: 'PAID', automatic: true }),
      }),
    );
  });
});
