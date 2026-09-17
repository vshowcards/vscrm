import { useEffect, useMemo, useState } from 'react';

import { styled } from '@linaria/react';
import { useLingui } from '@lingui/react/macro';

import { SettingsPageLayout } from '@/settings/components/layout/SettingsPageLayout';
import { Button } from 'twenty-ui/input';
import { Loader } from 'twenty-ui/feedback';
import { themeCssVariables } from 'twenty-ui/theme-constants';
import { REACT_APP_SERVER_BASE_URL } from '~/config';

type MemberResult = {
  memberId: number | null;
  sourceKey?: string;
  outcome: string;
  groups: string[];
  added: string[];
  removed: string[];
  issues: string[];
};
type Run = {
  id: string;
  mode: string;
  status: string;
  startedAt: string;
  finishedAt?: string;
  sourceReadAt?: string;
  unmatchedOrders?: number;
  error?: string;
  resultCount: number;
};
type ResultsPage = {
  runId: string;
  page: number;
  pageSize: number;
  total: number;
  counts: Record<string, number>;
  groupAdditions: number;
  groupRemovals: number;
  results: MemberResult[];
};
type SyncStatus = {
  workspaceId: string;
  paused: boolean;
  target: string;
  source: string;
  pilotMemberCount: number;
  allMembersEnabled: boolean;
  registrationsEnabled: boolean;
  maximumUpdatesPerRun: number;
  intervalMinutes: number;
  runs: Run[];
};

const StyledPage = styled.div`
  max-width: 1100px;
  overflow: auto;
  padding: 32px;
`;
const StyledCard = styled.section`
  border: 1px solid ${themeCssVariables.border.color.medium};
  border-radius: 8px;
  margin-bottom: 24px;
  padding: 20px;
`;
const StyledActions = styled.div`
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin: 16px 0;
`;
const StyledTable = styled.table`
  border-collapse: collapse;
  text-align: left;
  width: 100%;
  th,
  td {
    border-bottom: 1px solid ${themeCssVariables.border.color.medium};
    padding: 10px;
    vertical-align: top;
  }
`;
const StyledInput = styled.input`
  background: transparent;
  border: 1px solid ${themeCssVariables.border.color.medium};
  border-radius: 4px;
  color: inherit;
  padding: 8px;
`;
const StyledRunStatus = styled.span`
  align-items: center;
  display: inline-flex;
  gap: 8px;
`;

const request = async <TResult,>(
  path = '',
  body?: object,
  signal?: AbortSignal,
): Promise<TResult> => {
  const response = await fetch(
    `${REACT_APP_SERVER_BASE_URL}/app/customer-sync${path}`,
    {
      method: body ? 'POST' : 'GET',
      credentials: 'include',
      signal,
      headers: { 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    },
  );

  if (!response.ok) throw new Error(String(response.status));

  return response.json();
};

export const SettingsCustomerSync = () => {
  const { t } = useLingui();
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [memberId, setMemberId] = useState('');
  const [selectedRunId, setSelectedRunId] = useState('');
  const [exceptionsOnly, setExceptionsOnly] = useState(false);
  const [page, setPage] = useState(0);
  const [resultsPage, setResultsPage] = useState<ResultsPage | null>(null);
  const [resultsLoading, setResultsLoading] = useState(false);
  const [resultsError, setResultsError] = useState('');
  const refresh = useMemo(() => {
    let pending: Promise<void> | null = null;
    return () => {
      if (pending) return pending;
      pending = (async () => {
        try {
          setStatus(await request<SyncStatus>('/summary'));
          setError('');
        } catch {
          setError(
            t`Sync is unavailable. Check the local connection configuration and your administrator access.`,
          );
        }
      })().finally(() => {
        pending = null;
      });
      return pending;
    };
  }, [t]);
  const running =
    status?.runs.some((run) => ['queued', 'running'].includes(run.status)) ??
    false;

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (!document.hidden) await refresh();
      if (!cancelled && (running || status?.paused === false))
        timer = setTimeout(
          () => void poll(),
          document.hidden ? 30000 : running ? 3000 : 30000,
        );
    };
    const onFocus = () => {
      void refresh();
    };
    void poll();
    window.addEventListener('focus', onFocus);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [refresh, running, status?.paused]);

  const action = async (path: string, body: object) => {
    setBusy(true);
    setNotice('');
    try {
      await request(path, body);
      setNotice(t`Request accepted. Run progress appears below.`);
      setSelectedRunId('');
      setPage(0);
      await refresh();
    } catch {
      setError(
        t`The request could not be started. Check run history, configuration, and whether another operation is running.`,
      );
    } finally {
      setBusy(false);
    }
  };
  const disabled = busy || running || !status;
  const selected = status?.runs.find((run) => run.id === selectedRunId);
  useEffect(() => {
    if (!selected?.id) {
      setResultsPage(null);
      return;
    }
    const controller = new AbortController();
    setResultsLoading(true);
    setResultsError('');
    setResultsPage(null);
    void request<ResultsPage>(
      `/runs/${selected.id}/results?page=${page}&exceptionsOnly=${exceptionsOnly}`,
      undefined,
      controller.signal,
    )
      .then((data) => {
        if (!controller.signal.aborted) setResultsPage(data);
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setResultsError(
            t`Could not load run results. Refresh the page to retry.`,
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setResultsLoading(false);
      });
    return () => controller.abort();
  }, [
    selected?.id,
    selected?.status,
    selected?.resultCount,
    page,
    exceptionsOnly,
    t,
  ]);
  const results = resultsPage?.results ?? [];
  const count = (outcome: string) => resultsPage?.counts[outcome] ?? 0;
  const currentPage = resultsPage?.page ?? page;
  const totalPages = Math.max(1, Math.ceil((resultsPage?.total ?? 0) / 25));

  return (
    <SettingsPageLayout
      title={t`Sync Management`}
      links={[{ children: t`Workspace` }, { children: t`Sync Management` }]}
    >
      <StyledPage>
        {error && <p role="alert">{error}</p>}
        {notice && <p role="status">{notice}</p>}
        <StyledCard>
          <h2>{t`vShowcards customer sync`}</h2>
          <p>{t`Keep contact details and customer groups up to date from vShowcards.`}</p>
          <p>{t`Local testing only. Email, SMS, webhooks, and record-change automations are suppressed for sync writes.`}</p>
          {status && (
            <>
              <p>
                {status.source} → {status.target}
              </p>
              <p>
                {t`Member sync scope`}:{' '}
                <strong>
                  {status.allMembersEnabled
                    ? t`All members`
                    : t`${status.pilotMemberCount} selected members`}
                </strong>
              </p>
              <p>
                {t`Incomplete registrations`}:{' '}
                {status.registrationsEnabled
                  ? t`Enabled, all historical attempts`
                  : t`Preview only`}
              </p>
              <p>
                {t`Maximum contact changes per run`}:{' '}
                {status.maximumUpdatesPerRun}
              </p>
              <p>
                {t`Automatic reconciliation`}:{' '}
                {status.paused ? t`Paused` : t`Every five minutes`}
              </p>
            </>
          )}
          <StyledActions>
            <Button
              title={t`Prepare custom fields`}
              disabled={disabled}
              onClick={() => void action('/initialize', {})}
            />
            <Button
              title={t`Preview / Dry Run`}
              variant="primary"
              disabled={disabled}
              onClick={() => void action('/runs', { mode: 'preview' })}
            />
            <Button
              title={
                status?.paused
                  ? t`Resume automatic sync`
                  : t`Pause automatic sync`
              }
              disabled={busy || !status}
              onClick={() =>
                void action('/schedule', { paused: !status?.paused })
              }
            />
          </StyledActions>
          <StyledActions>
            <StyledInput
              aria-label={t`Member ID`}
              placeholder={t`Member ID`}
              type="number"
              min="1"
              value={memberId}
              onChange={(event) => setMemberId(event.target.value)}
            />
            <Button
              title={t`Sync one member`}
              disabled={
                disabled ||
                !Number.isSafeInteger(Number(memberId)) ||
                Number(memberId) < 1
              }
              onClick={() =>
                void action('/runs', {
                  mode: 'member',
                  memberId: Number(memberId),
                })
              }
            />
            <Button
              title={t`Sync changes`}
              disabled={disabled}
              onClick={() => void action('/runs', { mode: 'incremental' })}
            />
            <Button
              title={t`Full reconciliation`}
              disabled={disabled}
              onClick={() => void action('/runs', { mode: 'full' })}
            />
            <Button
              title={t`Retry exceptions`}
              disabled={disabled}
              onClick={() => void action('/runs', { mode: 'retry' })}
            />
          </StyledActions>
          <p>{t`Preview checks members and incomplete registrations without changing contacts. Writes follow the scope above. If a batch reaches its limit, run Sync changes again. Imported contacts with uncertain payment records show Needs Review; identity conflicts remain in the review report.`}</p>
        </StyledCard>
        <StyledCard>
          <h2>{t`Run history`}</h2>
          <Button title={t`Refresh history`} onClick={() => void refresh()} />
          {!status?.runs.length && (
            <p>{t`No runs yet. Prepare the fields, then start a preview.`}</p>
          )}
          <StyledTable>
            <thead>
              <tr>
                <th>{t`Started`}</th>
                <th>{t`Mode`}</th>
                <th>{t`Status`}</th>
                <th>{t`Checked`}</th>
                <th>{t`Details`}</th>
              </tr>
            </thead>
            <tbody>
              {status?.runs.map((run) => (
                <tr key={run.id}>
                  <td>{new Date(run.startedAt).toLocaleString()}</td>
                  <td>{run.mode}</td>
                  <td>
                    <StyledRunStatus role="status">
                      {['queued', 'running'].includes(run.status) && (
                        <span aria-hidden="true">
                          <Loader />
                        </span>
                      )}
                      {run.status === 'running'
                        ? t`Running`
                        : run.status === 'queued'
                          ? t`Queued`
                          : run.status}
                    </StyledRunStatus>
                  </td>
                  <td>{run.resultCount}</td>
                  <td>
                    <Button
                      title={t`View`}
                      onClick={() => {
                        setSelectedRunId(run.id);
                        setPage(0);
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </StyledTable>
        </StyledCard>
        {selected && (
          <StyledCard>
            <h2>
              {selected.mode === 'preview'
                ? t`Proposed changes`
                : t`Run results`}
            </h2>
            {selected.error && <p role="alert">{selected.error}</p>}
            {resultsLoading && (
              <StyledRunStatus role="status">
                <Loader />
                {t`Loading results`}
              </StyledRunStatus>
            )}
            {resultsError && <p role="alert">{resultsError}</p>}
            {resultsPage && (
              <>
                <p>
                  {t`Created`}: {count('created')} · {t`Updated`}:{' '}
                  {count('updated')} · {t`Unchanged`}: {count('unchanged')} ·{' '}
                  {t`Skipped`}: {count('skipped')} · {t`Needs review`}:{' '}
                  {count('review')} · {t`Failed`}: {count('failed')}
                </p>
                <p>
                  {t`Group additions`}: {resultsPage.groupAdditions} ·{' '}
                  {t`Group removals`}: {resultsPage.groupRemovals}
                </p>
                <p>
                  {t`Unmatched order rows`}: {selected.unmatchedOrders ?? 0}
                </p>
                <label>
                  <input
                    type="checkbox"
                    checked={exceptionsOnly}
                    onChange={(event) => {
                      setExceptionsOnly(event.target.checked);
                      setPage(0);
                    }}
                  />{' '}
                  {t`Show exceptions only`}
                </label>
                <StyledTable>
                  <thead>
                    <tr>
                      <th>{t`Member ID / Registration source`}</th>
                      <th>{t`Result`}</th>
                      <th>{t`Groups`}</th>
                      <th>{t`Review reason`}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((result) => (
                      <tr key={result.memberId ?? result.sourceKey}>
                        <td>{result.memberId ?? result.sourceKey}</td>
                        <td>{result.outcome}</td>
                        <td>{result.groups.join(', ')}</td>
                        <td>{result.issues.join(', ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </StyledTable>
                <StyledActions>
                  <Button
                    title={t`Previous`}
                    disabled={currentPage === 0}
                    onClick={() => setPage(currentPage - 1)}
                  />
                  <span>
                    {currentPage + 1} / {totalPages}
                  </span>
                  <Button
                    title={t`Next`}
                    disabled={currentPage + 1 >= totalPages}
                    onClick={() => setPage(currentPage + 1)}
                  />
                </StyledActions>
              </>
            )}
          </StyledCard>
        )}
      </StyledPage>
    </SettingsPageLayout>
  );
};
