import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { type ReactNode } from 'react';

import { SettingsCustomerSync } from '~/pages/settings/customer-sync/SettingsCustomerSync';

jest.mock('@linaria/react', () => ({
  styled: Object.fromEntries(
    ['div', 'section', 'table', 'input', 'span'].map((tag) => [tag, () => tag]),
  ),
}));
jest.mock('@/settings/components/layout/SettingsPageLayout', () => ({
  SettingsPageLayout: ({ children }: { children: ReactNode }) => (
    <>{children}</>
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
jest.mock('twenty-ui/feedback', () => ({ Loader: () => <span>Loading</span> }));
jest.mock('~/config', () => ({
  REACT_APP_SERVER_BASE_URL: 'http://localhost:3100',
}));

const summary = {
  paused: true,
  source: 'source',
  target: 'local',
  allMembersEnabled: true,
  registrationsEnabled: true,
  maximumUpdatesPerRun: 5000,
  runs: [
    {
      id: 'run-one',
      mode: 'preview',
      status: 'completed',
      startedAt: '2026-09-16T00:00:00Z',
      resultCount: 63,
    },
  ],
};
const originalFetch = global.fetch;

describe('Sync Management request volume', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      return {
        ok: true,
        json: async () =>
          url.pathname.endsWith('/summary')
            ? summary
            : {
                runId: 'run-one',
                page: Number(url.searchParams.get('page')),
                pageSize: 25,
                total: 63,
                counts: { created: 63 },
                groupAdditions: 63,
                groupRemovals: 0,
                results: [],
              },
      } as Response;
    });
  });
  afterEach(() => {
    jest.useRealTimers();
    global.fetch = originalFetch;
  });

  it('does not poll idle paused runs and only fetches selected pages when opened', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    await act(async () => {
      render(
        <I18nProvider i18n={i18n}>
          <SettingsCustomerSync />
        </I18nProvider>,
      );
    });
    const fetchMock = jest.mocked(global.fetch);
    expect(
      fetchMock.mock.calls.every(([url]) => String(url).endsWith('/summary')),
    ).toBe(true);
    fetchMock.mockClear();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(60000);
    });
    expect(fetchMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'View' }));
    expect(fetchMock).toHaveBeenLastCalledWith(
      expect.stringContaining(
        '/runs/run-one/results?page=0&exceptionsOnly=false',
      ),
      expect.anything(),
    );
    expect(await screen.findByText('1 / 3')).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(fetchMock).toHaveBeenLastCalledWith(
      expect.stringContaining('page=1&exceptionsOnly=false'),
      expect.anything(),
    );
    await screen.findByText('2 / 3');
    await user.click(
      screen.getByRole('checkbox', { name: 'Show exceptions only' }),
    );
    expect(fetchMock).toHaveBeenLastCalledWith(
      expect.stringContaining('page=0&exceptionsOnly=true'),
      expect.anything(),
    );
  });
});
