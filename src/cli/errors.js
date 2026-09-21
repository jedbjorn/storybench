// Exit codes: 0 success; 1 an operation was refused or failed; 2 invalid invocation (or a command this build lacks).
export const EXIT = Object.freeze({ OK: 0, FAILED: 1, USAGE: 2 });

export class CliError extends Error {
  constructor(message, { exitCode = EXIT.FAILED, hint = null } = {}) {
    super(message);
    this.exitCode = exitCode;
    this.hint = hint;
  }
}

export const usageError = (message, hint = "Run `storybench help` for usage.") => new CliError(message, { exitCode: EXIT.USAGE, hint });
