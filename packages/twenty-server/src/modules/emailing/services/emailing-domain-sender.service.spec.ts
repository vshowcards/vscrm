import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { EmailingDomainSenderService } from 'src/modules/emailing/services/emailing-domain-sender.service';
import { CampaignSmtpService } from 'src/modules/emailing/services/campaign-smtp.service';
import { MessageSuppressionService } from 'src/modules/emailing/services/message-suppression.service';
import { EmailingDomainDriverFactory } from 'src/engine/core-modules/emailing-domain/drivers/emailing-domain-driver.factory';
import { EmailingDomainEntity } from 'src/engine/core-modules/emailing-domain/emailing-domain.entity';
import { EmailingDomainStatus } from 'src/engine/core-modules/emailing-domain/drivers/types/emailing-domain-status.type';
import { EmailingDomainTenantStatus } from 'src/engine/core-modules/emailing-domain/drivers/types/emailing-domain-tenant-status.type';
import { MessageChannelEntity } from 'src/engine/metadata-modules/message-channel/entities/message-channel.entity';
import { getWorkspaceScopedRepositoryToken } from 'src/engine/twenty-orm/workspace-scoped-repository/get-workspace-scoped-repository-token.util';

describe('Campaign SMTP routing and suppression', () => {
  const domain = {
    domain: 'example.com',
    status: EmailingDomainStatus.VERIFIED,
    tenantStatus: EmailingDomainTenantStatus.ACTIVE,
  };
  const findDomain = jest.fn();
  const findApplicableSuppressions = jest.fn();
  const smtp = {
    findAccount: jest.fn(),
    sendEmail: jest.fn(),
    sendEmailBatch: jest.fn(),
  };
  const driver = { sendEmail: jest.fn(), sendEmailBatch: jest.fn() };
  let service: EmailingDomainSenderService;
  const content = {
    from: 'admin@example.com',
    to: ['one@example.com'],
    subject: 'Hello',
    text: 'Hello',
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    findDomain.mockResolvedValue(domain);
    findApplicableSuppressions.mockResolvedValue([]);
    smtp.findAccount.mockResolvedValue({ id: 'account' });
    smtp.sendEmailBatch.mockResolvedValue({
      entries: [
        { recipientIndex: 0, messageId: 'accepted', errorMessage: null },
      ],
    });
    const module = await Test.createTestingModule({
      providers: [
        EmailingDomainSenderService,
        {
          provide: getWorkspaceScopedRepositoryToken(EmailingDomainEntity),
          useValue: { findOne: findDomain },
        },
        {
          provide: getRepositoryToken(MessageChannelEntity),
          useValue: { findOne: jest.fn().mockResolvedValue(null) },
        },
        {
          provide: EmailingDomainDriverFactory,
          useValue: { getCurrentDriver: () => driver },
        },
        {
          provide: MessageSuppressionService,
          useValue: { findApplicableSuppressions },
        },
        { provide: CampaignSmtpService, useValue: smtp },
      ],
    }).compile();
    service = module.get(EmailingDomainSenderService);
  });

  it('keeps ordinary email on the existing domain driver', async () => {
    await service.sendEmail('workspace', 'domain', {
      ...content,
      sendKind: 'TRANSACTIONAL',
    });
    expect(driver.sendEmail).toHaveBeenCalledTimes(1);
    expect(smtp.findAccount).not.toHaveBeenCalled();
  });

  it('routes marketing tests through configured SMTP', async () => {
    await service.sendEmail('workspace', 'domain', {
      ...content,
      sendKind: 'MARKETING',
    });
    expect(smtp.findAccount).toHaveBeenCalledWith(
      'workspace',
      'admin@example.com',
    );
    expect(smtp.sendEmail).toHaveBeenCalledTimes(1);
    expect(driver.sendEmail).not.toHaveBeenCalled();
  });

  it('retains the domain driver when no SMTP account is configured', async () => {
    smtp.findAccount.mockResolvedValue(null);
    await service.sendEmail('workspace', 'domain', {
      ...content,
      sendKind: 'MARKETING',
    });
    expect(driver.sendEmail).toHaveBeenCalledTimes(1);
  });

  it('blocks a suppressed test recipient before SMTP', async () => {
    findApplicableSuppressions.mockResolvedValue([
      {
        emailAddress: 'one@example.com',
        reason: 'UNSUBSCRIBED',
        unsubscribeTopicId: null,
      },
    ]);
    await expect(
      service.sendEmail('workspace', 'domain', {
        ...content,
        sendKind: 'MARKETING',
      }),
    ).rejects.toThrow();
    expect(smtp.sendEmail).not.toHaveBeenCalled();
  });

  it('excludes opt-outs from batches and preserves original recipient indexes', async () => {
    findApplicableSuppressions.mockResolvedValue([
      {
        emailAddress: 'one@example.com',
        reason: 'UNSUBSCRIBED',
        unsubscribeTopicId: null,
      },
    ]);
    const result = await service.sendEmailBatch({
      workspaceId: 'workspace',
      emailingDomainId: 'domain',
      from: content.from,
      sendKind: 'MARKETING',
      template: { subject: 'Hi', text: 'Hello' },
      recipients: [
        { email: 'one@example.com', replacements: {} },
        { email: 'two@example.com', replacements: {} },
      ],
    });
    expect(smtp.sendEmailBatch.mock.calls[0][1].recipients).toEqual([
      { email: 'two@example.com', replacements: {} },
    ]);
    expect(result).toEqual({
      entries: [
        { recipientIndex: 1, messageId: 'accepted', errorMessage: null },
      ],
      suppressedRecipientIndexes: [0],
    });
  });

  it('preserves sender-domain and suspension checks', async () => {
    await expect(
      service.sendEmail('workspace', 'domain', {
        ...content,
        from: 'other@another.example',
        sendKind: 'MARKETING',
      }),
    ).rejects.toThrow();
    findDomain.mockResolvedValue({ ...domain, tenantStatus: 'SUSPENDED' });
    await expect(
      service.sendEmail('workspace', 'domain', {
        ...content,
        sendKind: 'MARKETING',
      }),
    ).rejects.toThrow();
    expect(smtp.sendEmail).not.toHaveBeenCalled();
  });
});
