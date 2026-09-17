import { useEffect, useState } from 'react';
import { styled } from '@linaria/react';
import { useLingui } from '@lingui/react/macro';
import { Button } from 'twenty-ui/input';
import { themeCssVariables } from 'twenty-ui/theme-constants';
import { REACT_APP_SERVER_BASE_URL } from '~/config';
import { notifyCustomerListAudienceChanged } from '@/activities/emails/utils/notifyCustomerListAudienceChanged';

type AudienceStatus = {
  list: { id: string; name: string };
  rule: { group: string; automatic: boolean; lastReconciledAt: string } | null;
  groups: { value: string; label: string }[];
};
type Preview = {
  matching: number;
  additions: number;
  removals: number;
  sample: { id: string; name: string }[];
};

const StyledPanel = styled.section`
  border: 1px solid ${themeCssVariables.border.color.medium};
  border-radius: 8px;
  color: ${themeCssVariables.font.color.primary};
  font-size: ${themeCssVariables.font.size.sm};
  margin: 12px 0;
  padding: 16px;
`;
const StyledActions = styled.div`
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 12px;
`;
const StyledSelect = styled.select`
  background: ${themeCssVariables.background.secondary};
  border: 1px solid ${themeCssVariables.border.color.medium};
  border-radius: 4px;
  color: ${themeCssVariables.font.color.primary};
  padding: 8px;
`;

const request = async <TResult,>(
  listId: string,
  action = '',
  body?: object,
  signal?: AbortSignal,
): Promise<TResult> => {
  const response = await fetch(
    `${REACT_APP_SERVER_BASE_URL}/app/customer-sync/lists/${listId}/audience${action}`,
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

export const CustomerGroupListAudience = ({ listId }: { listId: string }) => {
  const { t } = useLingui();
  const [status, setStatus] = useState<AudienceStatus | null>(null);
  const [group, setGroup] = useState('');
  const [automatic, setAutomatic] = useState(true);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    setStatus(null);
    setPreview(null);
    setError('');
    setNotice('');
    request<AudienceStatus>(listId, '', undefined, controller.signal)
      .then((result) => {
        setStatus(result);
        setGroup(result.rule?.group ?? 'TRIED_REGISTER');
        setAutomatic(result.rule?.automatic ?? true);
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError(
            t`Group audiences are unavailable. Workspace administrator access and Sync Management configuration are required.`,
          );
      });
    return () => controller.abort();
  }, [listId, t]);

  useEffect(() => {
    if (!status?.rule?.automatic) return;
    const controller = new AbortController();
    let pending = false;
    const timer = setInterval(async () => {
      if (pending) return;
      pending = true;
      try {
        const current = await request<AudienceStatus>(
          listId,
          '',
          undefined,
          controller.signal,
        );
        if (!controller.signal.aborted) {
          setStatus(current);
          notifyCustomerListAudienceChanged(listId);
        }
      } catch {
        // Keep the current audience visible and retry on the next interval.
      } finally {
        pending = false;
      }
    }, 60000);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, [listId, status?.rule?.automatic]);

  const run = async (action: 'preview' | 'apply' | 'disable') => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      if (action === 'preview')
        setPreview(await request<Preview>(listId, '/preview', { group }));
      else {
        await request(
          listId,
          `/${action}`,
          action === 'disable' ? {} : { group, automatic },
        );
        setStatus(await request<AudienceStatus>(listId));
        setPreview(null);
        setNotice(
          action === 'disable'
            ? t`Automatic updates stopped. Existing list members were kept.`
            : t`List members updated. No emails were sent.`,
        );
      }
      notifyCustomerListAudienceChanged(listId);
    } catch {
      setError(
        t`Could not update the audience. Check your connection and administrator access, then try again.`,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <StyledPanel aria-label={t`Customer group audience`} aria-disabled={busy}>
      <strong>{t`Customer group audience`}</strong>
      {error && <p role="alert">{error}</p>}
      {!status && !error && <p role="status">{t`Loading audience…`}</p>}
      {status && (
        <>
          <p>
            {t`List:`} {status.list.name}
          </p>
          <p>
            {status.rule?.automatic
              ? t`Automatic updates are enabled (every minute).`
              : t`Automatic updates are off.`}
          </p>
          {status.rule && (
            <p>
              {t`Last updated:`}{' '}
              {new Date(status.rule.lastReconciledAt).toLocaleString()}
            </p>
          )}
          <StyledActions>
            <label>
              {t`Customer Group`}{' '}
              <StyledSelect
                aria-label={t`Customer Group`}
                value={group}
                disabled={busy}
                onChange={(event) => {
                  setGroup(event.target.value);
                  setPreview(null);
                  setNotice('');
                }}
              >
                {status.groups.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </StyledSelect>
            </label>
            <label>
              <input
                type="checkbox"
                checked={automatic}
                disabled={busy}
                onChange={(event) => {
                  setAutomatic(event.target.checked);
                  setPreview(null);
                }}
              />{' '}
              {t`Keep members updated automatically`}
            </label>
          </StyledActions>
          <p>{t`Applying replaces this list’s members with contacts in the selected group. Manually added contacts outside the group will be removed from the list, not deleted from CRM.`}</p>
          <p>{t`Uses current CRM data. Source sync stays paused if paused in Sync Management. No emails are sent.`}</p>
          {preview && (
            <div role="status">
              <p>
                {t`Matching contacts:`} {preview.matching} · {t`To add:`}{' '}
                {preview.additions} · {t`To remove:`} {preview.removals}
              </p>
              {preview.matching === 0 && (
                <p>{t`No contacts match. Applying will empty this list.`}</p>
              )}
              <p>
                {t`Sample (up to 10):`}{' '}
                {preview.sample
                  .map((person) => person.name || person.id)
                  .join(', ') || '—'}
              </p>
            </div>
          )}
          <StyledActions>
            <Button
              title={busy ? t`Working…` : t`Preview audience`}
              disabled={busy}
              onClick={() => void run('preview')}
            />
            <Button
              title={t`Apply audience`}
              disabled={busy || !preview}
              onClick={() => void run('apply')}
            />
            {status.rule?.automatic && (
              <Button
                title={t`Stop automatic updates`}
                disabled={busy}
                onClick={() => void run('disable')}
              />
            )}
          </StyledActions>
          {notice && <p role="status">{notice}</p>}
        </>
      )}
    </StyledPanel>
  );
};
