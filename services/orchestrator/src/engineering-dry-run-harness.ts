import type {
  EngineeringRunnerResult,
  EngineeringWorkspacePort,
} from './engineering-runner.ts';
import type {
  EngineeringRunnerEnvironment,
  EngineeringRunnerEnvironmentPort,
} from './adapters/live-runner-environment-adapter.ts';

export interface EngineeringRunnerLike {
  run(...args: Parameters<import('./engineering-runner.ts').EngineeringRunner['run']>): Promise<EngineeringRunnerResult>;
}

export interface EngineeringDryRunHarnessOptions {
  readonly runner: EngineeringRunnerLike;
  readonly environment: EngineeringRunnerEnvironmentPort;
  readonly workspace: EngineeringWorkspacePort;
}

export interface EngineeringDryRunReport {
  readonly dryRun: true;
  readonly environment: EngineeringRunnerEnvironment;
  readonly result: EngineeringRunnerResult;
  readonly workspaceDisposed: boolean;
  readonly decisionState: EngineeringRunnerResult['state']['decisionState'] | 'BLOCKED';
}

export class EngineeringDryRunHarness {
  readonly #runner: EngineeringRunnerLike;
  readonly #environment: EngineeringRunnerEnvironmentPort;
  readonly #workspace: EngineeringWorkspacePort;

  constructor(options: EngineeringDryRunHarnessOptions) {
    this.#runner = options.runner;
    this.#environment = options.environment;
    this.#workspace = options.workspace;
  }

  async run(
    ...args: Parameters<import('./engineering-runner.ts').EngineeringRunner['run']>
  ): Promise<EngineeringDryRunReport> {
    const environment = await this.#environment.inspect();
    const result = await this.#runner.run(...args);
    let workspaceDisposed = result.workspace === null;

    if (result.workspace !== null) {
      try {
        await this.#workspace.dispose(result.workspace);
        workspaceDisposed = true;
      } catch {
        workspaceDisposed = false;
      }
    }

    return {
      dryRun: true,
      environment,
      result,
      workspaceDisposed,
      decisionState:
        result.state.decisionState === 'READY_FOR_OWNER_DECISION' && !workspaceDisposed
          ? 'BLOCKED'
          : result.state.decisionState,
    };
  }
}
