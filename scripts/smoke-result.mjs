/** A backup answering is recovery evidence, never proof the primary works. */
export function primarySmokeFailure(message, primary) {
  if (message?.meta?.origin !== 'live') return 'fallback_not_live';
  if (message.meta.fallbackFrom || message.meta.provider !== primary.provider || message.meta.model !== primary.model) return 'backup_not_primary';
  if (!message.text?.trim()) return 'empty_reply';
  return null;
}
