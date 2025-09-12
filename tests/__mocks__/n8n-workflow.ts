export class UnexpectedError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = 'UnexpectedError';
  }
}

export const LoggerProxy = {
  debug: (..._args: unknown[]) => {},
  info: (..._args: unknown[]) => {},
  warn: (..._args: unknown[]) => {},
  error: (..._args: unknown[]) => {},
};
