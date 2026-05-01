/**
 * Purpose: Resolves durable publication targets from the registry so worker publication flows can publish to the correct delivery scopes for a version's namespace and tenant.
 * Governing docs:
 * - docs/service-architecture.md
 * - docs/domain-model.md
 * - docs/persistence-model.md
 * External references:
 * - https://www.prisma.io/docs/orm/prisma-client/queries/filtering-and-sorting
 * Tests:
 * - apps/workers/test/publication-worker-runtime.test.mjs
 */

import { createRegistryPrismaClient, type RegistryPrismaClient } from './prisma-client.js';
import type {
  PublicationTargetRecord,
  PublicationTargetStore
} from './publication-target-store.js';

export class PrismaPublicationTargetStore implements PublicationTargetStore {
  constructor(
    private readonly options: {
      prisma?: RegistryPrismaClient;
    } = {}
  ) {}

  private get prisma() {
    return this.options.prisma ?? createRegistryPrismaClient();
  }

  async listPublicationTargets(versionId: string): Promise<PublicationTargetRecord[]> {
    const version = await this.prisma.assetVersion.findUnique({
      where: { id: versionId },
      select: {
        asset: {
          select: {
            serviceNamespaceId: true,
            tenantScopeId: true
          }
        }
      }
    });

    if (!version) {
      return [];
    }

    const deliveryScopes = await this.prisma.deliveryScope.findMany({
      where: {
        serviceNamespaceId: version.asset.serviceNamespaceId,
        ...(version.asset.tenantScopeId
          ? {
              OR: [
                { tenantScopeId: null },
                { tenantScopeId: version.asset.tenantScopeId }
              ]
            }
          : { tenantScopeId: null })
      },
      orderBy: [{ scopeKey: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        scopeKey: true
      }
    });

    return deliveryScopes.map((deliveryScope) => ({
      deliveryScopeId: deliveryScope.id,
      scopeKey: deliveryScope.scopeKey
    }));
  }
}

