import type { CapabilityRecord, CapabilityRegistry } from './contracts.ts';
import { parseCapabilityRecord } from './validation.ts';

function capabilityKey(capability: CapabilityRecord): string {
  return `${capability.model_id}\u0000${capability.provider}\u0000${capability.revision}`;
}

export class InMemoryCapabilityRegistry implements CapabilityRegistry {
  readonly #capabilities = new Map<string, CapabilityRecord>();

  constructor(capabilities: readonly unknown[] = []) {
    for (const capability of capabilities) {
      this.upsert(capability);
    }
  }

  upsert(value: unknown): CapabilityRecord {
    const capability = parseCapabilityRecord(value);
    this.#capabilities.set(capabilityKey(capability), capability);
    return capability;
  }

  async list(): Promise<readonly CapabilityRecord[]> {
    return [...this.#capabilities.values()];
  }
}
