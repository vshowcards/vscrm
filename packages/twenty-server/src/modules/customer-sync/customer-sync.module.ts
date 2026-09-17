import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { TokenModule } from 'src/engine/core-modules/auth/token/token.module';
import { KeyValuePairEntity } from 'src/engine/core-modules/key-value-pair/key-value-pair.entity';
import { UserWorkspaceEntity } from 'src/engine/core-modules/user-workspace/user-workspace.entity';
import { PermissionsModule } from 'src/engine/metadata-modules/permissions/permissions.module';
import { WorkspaceCacheStorageModule } from 'src/engine/workspace-cache-storage/workspace-cache-storage.module';

import { CustomerSyncConfig } from './customer-sync.config';
import { CustomerListAudienceService } from './customer-list-audience.service';
import { CustomerSyncController } from './customer-sync.controller';
import { CustomerSyncService } from './customer-sync.service';
import { CustomerSyncSourceService } from './customer-sync-source.service';
import { CustomerSyncStoreService } from './customer-sync-store.service';
import { CustomerSyncTargetService } from './customer-sync-target.service';

@Module({
  imports: [
    WorkspaceCacheStorageModule,
    TokenModule,
    PermissionsModule,
    TypeOrmModule.forFeature([KeyValuePairEntity, UserWorkspaceEntity]),
  ],
  controllers: [CustomerSyncController],
  providers: [
    CustomerListAudienceService,
    CustomerSyncConfig,
    CustomerSyncService,
    CustomerSyncSourceService,
    CustomerSyncStoreService,
    CustomerSyncTargetService,
  ],
})
export class CustomerSyncModule {}
