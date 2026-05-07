export class AgentPackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentPackError";
  }
}

export function assertCondition(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new AgentPackError(message);
  }
}
