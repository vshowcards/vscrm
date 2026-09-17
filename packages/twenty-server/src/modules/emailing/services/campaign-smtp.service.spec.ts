import { createHash } from 'crypto';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConnectedAccountProvider } from 'twenty-shared/types';

import { CampaignSmtpService } from 'src/modules/emailing/services/campaign-smtp.service';
import { ConnectedAccountEntity } from 'src/engine/metadata-modules/connected-account/entities/connected-account.entity';
import { SmtpClientProvider } from 'src/modules/messaging/message-import-manager/drivers/smtp/providers/smtp-client.provider';
import { UnsubscribeContentService } from 'src/engine/core-modules/emailing-domain/services/unsubscribe-content.service';
import { UnsubscribeTokenService } from 'src/engine/core-modules/emailing-domain/services/unsubscribe-token.service';
import { SecureHttpClientService } from 'src/engine/core-modules/secure-http-client/secure-http-client.service';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { type EmailingDomainEntity } from 'src/engine/core-modules/emailing-domain/emailing-domain.entity';
import { UnsubscribeHostnameStatus } from 'src/engine/core-modules/emailing-domain/drivers/types/unsubscribe-hostname-status.type';
import { type EmailingDomainSendEmailRequest } from 'src/engine/core-modules/emailing-domain/drivers/types/emailing-domain-send-email-input.type';

describe('Campaign SMTP transport (no network)', () => {
  let service: CampaignSmtpService;
  const findOne = jest.fn();
  const sendMail = jest.fn();
  const close = jest.fn();
  const getClient = jest.fn();
  const get = jest.fn();
  const configuration: Record<string, string> = {};
  const account = {
    id: 'smtp-account',
    workspaceId: 'workspace',
    handle: 'admin@example.com',
    provider: ConnectedAccountProvider.IMAP_SMTP_CALDAV,
    connectionParameters: { SMTP: { host: 'smtp.example.com' } },
  } as ConnectedAccountEntity;
  const domain = {
    workspaceId: 'workspace',
    domain: 'example.com',
    unsubscribeHostname: 'unsubscribe.example.com',
    unsubscribeHostnameStatus: UnsubscribeHostnameStatus.ACTIVE,
  } as EmailingDomainEntity;
  const request: EmailingDomainSendEmailRequest = {
    workspaceId: 'workspace',
    domain: 'example.com',
    emailingDomain: domain,
    from: 'admin@example.com',
    to: ['one@example.com'],
    sendKind: 'MARKETING',
    subject: 'Welcome',
    text: 'Hello',
    html: '<p>Hello</p>',
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    configuration.CAMPAIGN_SMTP_CONNECTED_ACCOUNT_ID = 'smtp-account';
    configuration.CAMPAIGN_UNSUBSCRIBE_BASE_URL = '';
    findOne.mockResolvedValue(account);
    sendMail.mockResolvedValue({
      messageId: 'message-1',
      accepted: ['one@example.com'],
      rejected: [],
    });
    getClient.mockResolvedValue({ sendMail, close });
    get.mockResolvedValue({
      data: {
        challenge: createHash('sha256').update('preview-token').digest('hex'),
      },
    });
    const module = await Test.createTestingModule({
      providers: [
        CampaignSmtpService,
        UnsubscribeContentService,
        {
          provide: getRepositoryToken(ConnectedAccountEntity),
          useValue: { findOne },
        },
        { provide: SmtpClientProvider, useValue: { getClient } },
        {
          provide: UnsubscribeTokenService,
          useValue: {
            sign: jest.fn(({ emailAddress }) =>
              emailAddress === 'readiness@example.invalid'
                ? 'preview-token'
                : `token-${emailAddress}`,
            ),
          },
        },
        {
          provide: TwentyConfigService,
          useValue: { get: (key: string) => configuration[key] },
        },
        {
          provide: SecureHttpClientService,
          useValue: { getHttpClient: () => ({ get }) },
        },
      ],
    }).compile();
    service = module.get(CampaignSmtpService);
  });

  it('is opt-in and does not query accounts when disabled', async () => {
    configuration.CAMPAIGN_SMTP_CONNECTED_ACCOUNT_ID = '';
    expect(await service.findAccount('workspace', account.handle!)).toBeNull();
    expect(findOne).not.toHaveBeenCalled();
  });

  it('scopes credentials to the workspace, exact sender, provider and configured account', async () => {
    expect(await service.findAccount('workspace', 'ADMIN@example.com')).toBe(
      account,
    );
    expect(findOne).toHaveBeenCalledWith({
      where: {
        id: account.id,
        workspaceId: 'workspace',
        provider: account.provider,
      },
    });
    expect(
      await service.findAccount('workspace', 'other@example.com'),
    ).toBeNull();
    findOne.mockResolvedValue(null);
    await expect(
      service.findAccount('other-workspace', account.handle!),
    ).rejects.toThrow();
    expect(getClient).not.toHaveBeenCalled();
  });

  it('adds recipient-specific unsubscribe links and one-click headers', async () => {
    await service.sendEmail(account, request);
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: ['one@example.com'],
        text: expect.stringContaining(
          'https://unsubscribe.example.com/emailing/unsubscribe?t=token-one@example.com',
        ),
        headers: expect.arrayContaining([
          { key: 'List-Unsubscribe-Post', value: 'List-Unsubscribe=One-Click' },
        ]),
      }),
    );
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('blocks unverified unsubscribe endpoints before opening SMTP', async () => {
    await expect(
      service.sendEmail(account, {
        ...request,
        emailingDomain: {
          ...domain,
          unsubscribeHostnameStatus: null,
        } as EmailingDomainEntity,
      }),
    ).rejects.toThrow();
    expect(getClient).not.toHaveBeenCalled();
  });

  it.each([
    'http://localhost:3100',
    'https://example.com/path',
    'https://user:pass@example.com',
    'https://example.com?x=1',
  ])('rejects unsafe unsubscribe origin %s', async (url) => {
    configuration.CAMPAIGN_UNSUBSCRIBE_BASE_URL = url;
    await expect(service.sendEmail(account, request)).rejects.toThrow();
    expect(getClient).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });

  it('requires a verified preview challenge from the public HTTPS endpoint', async () => {
    configuration.CAMPAIGN_UNSUBSCRIBE_BASE_URL = 'https://public.example.com';
    await service.sendEmail(account, request);
    expect(get).toHaveBeenCalledWith(
      'https://public.example.com/emailing/unsubscribe/verify',
      { params: { t: 'preview-token' } },
    );
    expect(sendMail.mock.calls[0][0].text).toContain(
      'https://public.example.com/emailing/unsubscribe',
    );
  });

  it('rejects a wrong installation or unavailable public route', async () => {
    configuration.CAMPAIGN_UNSUBSCRIBE_BASE_URL = 'https://public.example.com';
    get.mockResolvedValue({ data: { challenge: 'wrong' } });
    await expect(service.sendEmail(account, request)).rejects.toThrow();
    get.mockRejectedValue(new Error('unreachable'));
    await expect(service.sendEmail(account, request)).rejects.toThrow();
    expect(getClient).not.toHaveBeenCalled();
  });

  it('rejects multiple marketing recipients', async () => {
    await expect(
      service.sendEmail(account, {
        ...request,
        to: ['one@example.com', 'two@example.com'],
      }),
    ).rejects.toThrow();
    expect(getClient).not.toHaveBeenCalled();
  });

  it('sends personalized individual messages and preserves partial successes', async () => {
    sendMail
      .mockResolvedValueOnce({
        messageId: 'accepted-1',
        accepted: ['one@example.com'],
        rejected: [],
      })
      .mockRejectedValueOnce(new Error('secret provider details'));
    const result = await service.sendEmailBatch(account, {
      ...request,
      template: {
        subject: 'Hi {{first}}',
        text: 'Welcome {{first}}',
        html: '<p>{{first}}</p>',
      },
      recipients: [
        { email: 'one@example.com', replacements: { first: 'Alice' } },
        { email: 'two@example.com', replacements: { first: 'Bob' } },
      ],
    });
    expect(sendMail).toHaveBeenCalledTimes(2);
    expect(sendMail.mock.calls[0][0]).toEqual(
      expect.objectContaining({ to: ['one@example.com'], subject: 'Hi Alice' }),
    );
    expect(sendMail.mock.calls[1][0]).toEqual(
      expect.objectContaining({ to: ['two@example.com'], subject: 'Hi Bob' }),
    );
    expect(result.entries[0]).toEqual({
      recipientIndex: 0,
      messageId: 'accepted-1',
      errorMessage: null,
    });
    expect(result.entries[1].messageId).toBeNull();
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(close).toHaveBeenCalledTimes(2);
  });
});
