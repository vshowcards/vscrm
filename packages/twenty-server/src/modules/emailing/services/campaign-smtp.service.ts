import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { ConnectedAccountProvider } from 'twenty-shared/types';
import { Repository } from 'typeorm';
import { type Transporter } from 'nodemailer';

import {
  EmailingDomainDriverException,
  EmailingDomainDriverExceptionCode,
} from 'src/engine/core-modules/emailing-domain/drivers/exceptions/emailing-domain-driver.exception';
import { type EmailingDomainSendEmailRequest } from 'src/engine/core-modules/emailing-domain/drivers/types/emailing-domain-send-email-input.type';
import { type EmailingDomainSendEmailBatchRequest } from 'src/engine/core-modules/emailing-domain/drivers/types/emailing-domain-send-email-batch-request.type';
import { type EmailingDomainSendEmailBatchResult } from 'src/engine/core-modules/emailing-domain/drivers/types/emailing-domain-send-email-batch-result.type';
import { type EmailingDomainSendEmailResult } from 'src/engine/core-modules/emailing-domain/drivers/types/emailing-domain-send-email-result.type';
import { UnsubscribeHostnameStatus } from 'src/engine/core-modules/emailing-domain/drivers/types/unsubscribe-hostname-status.type';
import { type EmailingDomainEntity } from 'src/engine/core-modules/emailing-domain/emailing-domain.entity';
import { UnsubscribeContentService } from 'src/engine/core-modules/emailing-domain/services/unsubscribe-content.service';
import { UnsubscribeTokenService } from 'src/engine/core-modules/emailing-domain/services/unsubscribe-token.service';
import { applyReplacementTags } from 'src/engine/core-modules/emailing-domain/utils/apply-replacement-tags.util';
import { SecureHttpClientService } from 'src/engine/core-modules/secure-http-client/secure-http-client.service';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { ConnectedAccountEntity } from 'src/engine/metadata-modules/connected-account/entities/connected-account.entity';
import { SmtpClientProvider } from 'src/modules/messaging/message-import-manager/drivers/smtp/providers/smtp-client.provider';

@Injectable()
export class CampaignSmtpService {
  constructor(
    @InjectRepository(ConnectedAccountEntity)
    private readonly connectedAccountRepository: Repository<ConnectedAccountEntity>,
    private readonly smtpClientProvider: SmtpClientProvider,
    private readonly unsubscribeContentService: UnsubscribeContentService,
    private readonly unsubscribeTokenService: UnsubscribeTokenService,
    private readonly twentyConfigService: TwentyConfigService,
    private readonly secureHttpClientService: SecureHttpClientService,
  ) {}

  async findAccount(workspaceId: string, fromAddress: string) {
    const id = this.twentyConfigService.get(
      'CAMPAIGN_SMTP_CONNECTED_ACCOUNT_ID',
    );

    if (!id) return null;

    const account = await this.connectedAccountRepository.findOne({
      where: {
        id,
        workspaceId,
        provider: ConnectedAccountProvider.IMAP_SMTP_CALDAV,
      },
    });

    if (!account || !account.connectionParameters?.SMTP) {
      throw new EmailingDomainDriverException(
        'The configured campaign SMTP account is unavailable in this workspace',
        EmailingDomainDriverExceptionCode.CONFIGURATION_ERROR,
      );
    }

    // Never use credentials belonging to a different sender or workspace.
    return account.handle?.toLowerCase() === fromAddress.trim().toLowerCase()
      ? account
      : null;
  }

  async getUnsubscribeBaseUrl(domain: EmailingDomainEntity): Promise<string> {
    const configuredUrl = this.twentyConfigService.get(
      'CAMPAIGN_UNSUBSCRIBE_BASE_URL',
    );

    if (!configuredUrl) {
      if (
        domain.unsubscribeHostnameStatus === UnsubscribeHostnameStatus.ACTIVE &&
        domain.unsubscribeHostname
      ) {
        return `https://${domain.unsubscribeHostname}`;
      }
      return this.unsubscribeNotReady();
    }

    try {
      const url = new URL(configuredUrl);

      if (
        url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        url.pathname !== '/' ||
        url.search ||
        url.hash
      ) {
        return this.unsubscribeNotReady();
      }

      // A preview token proves the public route reaches this installation and
      // can decrypt its links. This endpoint never updates subscriptions.
      const token = this.unsubscribeTokenService.sign({
        workspaceId: domain.workspaceId,
        emailAddress: 'readiness@example.invalid',
        preview: true,
      });
      const response = await this.secureHttpClientService
        .getHttpClient({
          timeout: 5000,
          maxRedirects: 0,
          maxContentLength: 4096,
        })
        .get<{ challenge?: string }>(
          `${url.origin}/emailing/unsubscribe/verify`,
          { params: { t: token } },
        );

      if (
        response.data.challenge !==
        createHash('sha256').update(token).digest('hex')
      ) {
        return this.unsubscribeNotReady();
      }

      return url.origin;
    } catch {
      return this.unsubscribeNotReady();
    }
  }

  async sendEmail(
    account: ConnectedAccountEntity,
    input: EmailingDomainSendEmailRequest,
  ): Promise<EmailingDomainSendEmailResult> {
    const baseUrl = await this.getUnsubscribeBaseUrl(input.emailingDomain);
    return this.sendOne(account, input, baseUrl);
  }

  async sendEmailBatch(
    account: ConnectedAccountEntity,
    input: EmailingDomainSendEmailBatchRequest,
  ): Promise<EmailingDomainSendEmailBatchResult> {
    const baseUrl = await this.getUnsubscribeBaseUrl(input.emailingDomain);
    const entries: EmailingDomainSendEmailBatchResult['entries'] = [];

    // Keep accepted recipients out of whole-batch retries. SMTP cannot promise
    // exactly-once delivery after a lost acknowledgement; failures need review.
    for (const [recipientIndex, recipient] of input.recipients.entries()) {
      try {
        const result = await this.sendOne(
          account,
          {
            ...input,
            to: [recipient.email],
            subject: applyReplacementTags(
              input.template.subject,
              recipient.replacements,
            ),
            text: applyReplacementTags(
              input.template.text,
              recipient.replacements,
            ),
            html: input.template.html
              ? applyReplacementTags(
                  input.template.html,
                  recipient.replacements,
                )
              : undefined,
            headers: recipient.headers,
          },
          baseUrl,
        );
        entries.push({
          recipientIndex,
          messageId: result.messageId,
          errorMessage: null,
        });
      } catch {
        entries.push({
          recipientIndex,
          messageId: null,
          errorMessage:
            'SMTP send was not confirmed. Review provider logs before retrying.',
        });
      }
    }

    return { entries };
  }

  private async sendOne(
    account: ConnectedAccountEntity,
    input: EmailingDomainSendEmailRequest,
    baseUrl: string,
  ): Promise<EmailingDomainSendEmailResult> {
    const email = this.unsubscribeContentService.addTo(input, baseUrl);
    let client: Transporter | undefined;

    try {
      client = await this.smtpClientProvider.getClient(account.id, true);
      const result = await client.sendMail({
        from: email.from,
        to: email.to,
        cc: email.cc,
        bcc: email.bcc,
        replyTo: account.handle ?? undefined,
        subject: email.subject,
        text: email.text,
        html: email.html,
        attachments: email.attachments,
        headers: email.headers?.map(({ name, value }) => ({
          key: name,
          value,
        })),
      });

      if (
        !result.messageId ||
        result.rejected?.length ||
        !result.accepted?.length
      ) {
        throw new Error('SMTP did not accept the recipient');
      }

      return {
        messageId: result.messageId,
        deliveredRecipients: {
          to: email.to,
          cc: email.cc ?? [],
          bcc: email.bcc ?? [],
        },
      };
    } catch {
      // SMTP errors can contain connection details. Do not surface them in API responses.
      throw new EmailingDomainDriverException(
        'SMTP send was not confirmed. Review provider logs before retrying.',
        EmailingDomainDriverExceptionCode.CONFIGURATION_ERROR,
      );
    } finally {
      client?.close();
    }
  }

  private unsubscribeNotReady(): never {
    throw new EmailingDomainDriverException(
      'Campaign unsubscribe URL must use public HTTPS and reach this CRM installation',
      EmailingDomainDriverExceptionCode.UNSUBSCRIBE_NOT_READY,
    );
  }
}
