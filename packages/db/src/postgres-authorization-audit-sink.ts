import { randomUUID } from 'node:crypto';

import type { AuthorizationAuditSink } from '@yastroyka/auth';
import type { Sequelize } from 'sequelize';

export function createPostgresAuthorizationAuditSink(database: Sequelize): AuthorizationAuditSink {
  return {
    async record(decision): Promise<void> {
      await database.query(
        `
          INSERT INTO authorization_audit_events (
            id,
            actor_id,
            resource,
            action,
            permission_id,
            required_scope,
            risk_class,
            decision,
            reason,
            matched_rule_id
          )
          VALUES (
            $id,
            $actorId,
            $resource,
            $action,
            $permissionId,
            $requiredScope,
            $riskClass,
            'deny',
            $reason,
            $matchedRuleId
          );
        `,
        {
          bind: {
            id: randomUUID(),
            actorId: decision.actor_id,
            resource: decision.resource,
            action: decision.action,
            permissionId: decision.permission_id,
            requiredScope: decision.required_scope,
            riskClass: decision.risk_class,
            reason: decision.reason,
            matchedRuleId: decision.matched_rule_id,
          },
        },
      );
    },
  };
}
