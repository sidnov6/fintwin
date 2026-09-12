export class AppError extends Error {
  constructor(public code: string, public status = 422, message = code) { super(message); }
}
export function publicError(error: unknown): { error: string; code: string; status: number } {
  if (error instanceof AppError) return { error: error.message, code: error.code, status: error.status };
  return { error: 'The service could not complete this request. Your saved information is safe. Please retry.', code: 'service_unavailable', status: 503 };
}
