import { Test } from '@nestjs/testing';
import { createHash } from 'crypto';
import { type Request } from 'express';

import { UnsubscribeController } from 'src/modules/emailing/controllers/unsubscribe.controller';
import { UnsubscribeTokenService } from 'src/engine/core-modules/emailing-domain/services/unsubscribe-token.service';
import { MessageSuppressionService } from 'src/modules/emailing/services/message-suppression.service';
import { ThrottlerService } from 'src/engine/core-modules/throttler/throttler.service';

describe('Public unsubscribe readiness (no mail or data writes)', () => {
  const verify = jest.fn();
  const unsubscribeFromEverything = jest.fn();
  const tokenBucketThrottleOrThrow = jest.fn();
  let controller: UnsubscribeController;
  const request = { ip: '203.0.113.1' } as Request;

  beforeEach(async () => {
    jest.resetAllMocks();
    const module = await Test.createTestingModule({
      controllers: [UnsubscribeController],
      providers: [
        { provide: UnsubscribeTokenService, useValue: { verify } },
        {
          provide: MessageSuppressionService,
          useValue: { unsubscribeFromEverything },
        },
        { provide: ThrottlerService, useValue: { tokenBucketThrottleOrThrow } },
      ],
    }).compile();
    controller = module.get(UnsubscribeController);
  });

  it('proves token verification without updating subscriptions', async () => {
    verify.mockReturnValue({ payload: { preview: true }, isExpired: false });
    expect(
      await controller.verifyPublicEndpoint('preview-token', request),
    ).toEqual({
      challenge: createHash('sha256').update('preview-token').digest('hex'),
    });
    expect(unsubscribeFromEverything).not.toHaveBeenCalled();
    expect(tokenBucketThrottleOrThrow).toHaveBeenCalled();
  });

  it.each([
    null,
    { payload: {}, isExpired: false },
    { payload: { preview: true }, isExpired: true },
  ])(
    'rejects invalid, non-preview or expired tokens (%j)',
    async (verification) => {
      verify.mockReturnValue(verification);
      await expect(
        controller.verifyPublicEndpoint('preview-token', request),
      ).rejects.toThrow();
      expect(unsubscribeFromEverything).not.toHaveBeenCalled();
    },
  );
});
