import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Query,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';

import { type Request } from 'express';

import { JwtAuthGuard } from 'src/engine/guards/jwt-auth.guard';
import { CustomPermissionGuard } from 'src/engine/guards/custom-permission.guard';
import { WorkspaceAuthGuard } from 'src/engine/guards/workspace-auth.guard';

import { CustomerSyncService } from './customer-sync.service';

@Controller('app/customer-sync')
@UseGuards(JwtAuthGuard, WorkspaceAuthGuard, CustomPermissionGuard)
export class CustomerSyncController {
  constructor(private readonly sync: CustomerSyncService) {}

  private async context(request: Request) {
    if (!request.workspace || !request.user) throw new ForbiddenException();
    await this.sync.authorize(request.workspace.id, request.user.id);

    return { workspaceId: request.workspace.id, userId: request.user.id };
  }

  @Get()
  async status(@Req() request: Request) {
    const { workspaceId } = await this.context(request);

    return this.sync.status(workspaceId);
  }

  @Get('summary')
  async summary(@Req() request: Request) {
    const { workspaceId } = await this.context(request);
    return this.sync.status(workspaceId, true);
  }

  @Get('runs/:runId/results')
  async results(
    @Req() request: Request,
    @Param('runId') runId: string,
    @Query('page') page = '0',
    @Query('exceptionsOnly') exceptionsOnly = 'false',
  ) {
    const { workspaceId } = await this.context(request);
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        runId,
      ) ||
      !/^(0|[1-9]\d{0,5})$/.test(page) ||
      !['true', 'false'].includes(exceptionsOnly)
    )
      throw new BadRequestException();
    return this.sync.resultsPage(
      workspaceId,
      runId,
      Number(page),
      exceptionsOnly === 'true',
    );
  }

  @Post('initialize')
  async initialize(@Req() request: Request) {
    const { workspaceId } = await this.context(request);

    return this.sync.initialize(workspaceId);
  }

  @Post('runs')
  async start(@Req() request: Request, @Body() body: unknown) {
    const { workspaceId, userId } = await this.context(request);

    if (!body || typeof body !== 'object' || !('mode' in body))
      throw new BadRequestException();
    const { mode } = body;

    if (
      mode !== 'preview' &&
      mode !== 'member' &&
      mode !== 'incremental' &&
      mode !== 'full' &&
      mode !== 'retry'
    )
      throw new BadRequestException();
    const memberId = 'memberId' in body ? body.memberId : undefined;

    if (
      mode === 'member' &&
      (typeof memberId !== 'number' ||
        !Number.isSafeInteger(memberId) ||
        memberId < 1)
    )
      throw new BadRequestException('A positive Member ID is required.');

    return this.sync.start(
      workspaceId,
      userId,
      mode,
      typeof memberId === 'number' ? [memberId] : undefined,
    );
  }

  @Post('schedule')
  async pause(@Req() request: Request, @Body() body: unknown) {
    const { workspaceId, userId } = await this.context(request);

    if (
      !body ||
      typeof body !== 'object' ||
      !('paused' in body) ||
      typeof body.paused !== 'boolean'
    )
      throw new BadRequestException();

    return this.sync.pause(workspaceId, userId, body.paused);
  }
}
