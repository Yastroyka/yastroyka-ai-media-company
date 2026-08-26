export {
  authorize,
  type AuthorizationAllowDecision,
  type AuthorizationDecision,
  type AuthorizationDenyDecision,
  type AuthorizationRequest,
} from './authorize.ts';

export { authorizeAndAudit, type AuthorizationAuditSink } from './authorization-audit.ts';

export {
  loadPolicyContract,
  PolicyContractError,
  RISK_CLASSES,
  type ActorPolicy,
  type DenyRule,
  type PermissionPolicy,
  type PolicyContractV2,
  type RiskClass,
} from './policy-contract.ts';

export {
  SecretReferenceError,
  validateSecretReference,
  withSecret,
  type SecretConsumer,
  type SecretProvider,
  type SecretReference,
} from './secret-provider.ts';

export {
  createEnvironmentSecretProvider,
  EnvironmentSecretProvider,
  SecretAccessError,
  type EnvironmentSecretBinding,
  type EnvironmentSecretProviderOptions,
} from './environment-secret-provider.ts';
