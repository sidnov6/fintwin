/** Resolve short answers against the question actually asked, not the whole reply. */
import type { FactKey } from '@fintwin/engine';
import type { Message } from '@fintwin/contracts';

export function lastQuestion(text: string): string {
  // Earlier observations often contain facts unrelated to the final question.
  const questions = text.split(/(?<=[.!?])\s+|\n+/).filter(sentence=>sentence.trim().endsWith('?'));
  return questions.at(-1)?.trim() ?? '';
}

export function askedFact(text: string): FactKey | undefined {
  const q = lastQuestion(text);
  const patterns: Array<[FactKey, RegExp]> = [
    ['retirement_spending_monthly', /(?:spend|spending|live on|budget|ausgeben|ausgaben|verfügung|verfuegung).*(?:retire|retirement|ruhestand|rente)|(?:retirement|ruhestand).*(?:spend|budget|ausgaben)/i],
    ['retirement_age', /(?:age|old|alter|wann).*(?:retire|stop working|rente|ruhestand)|retirement age/i],
    ['expected_pension_monthly', /pension|rentenanspruch|gesetzliche rente/i],
    ['income_protection', /cover|protection|disability|absicherung|berufsunfähig|berufsunfaehig/i],
    ['household', /(?:planning|plan).*yourself|partner\/family|(?:who|wer).*household|leben.*allein|allein.*planen/i],
    ['monthly_saving', /(?:save|invest|saving|investing).*(?:month|monat)|sparrate/i],
    ['income_net_monthly', /income|earn|take.home|einkommen|netto|verdienen/i],
    ['expenses_monthly', /spend|expenses|costs|ausgaben/i],
    ['mortgage_balance', /mortgage|hypothek|restschuld/i],
    ['other_debt', /debt|loans?|schulden|kredit/i],
    ['property_value', /property|own.*(?:house|home)|immobilie/i],
    ['investments_value', /portfolio|investments|brokerage|depot/i],
    ['cash_liquid', /cash|savings|bank|reserve|guthaben|notgroschen|tagesgeld/i],
    ['age', /how old|current age|wie alt|ihr alter/i],
    ['goal_primary', /goal|want to achieve|matters most|most important|ziel|wichtig/i],
  ];
  // A retirement total is a scenario allocation, never an extra pension account.
  if (/retirement assets|retirement capital|altersvorsorgekapital/i.test(q)) return undefined;
  return patterns.find(([, pattern]) => pattern.test(q))?.[0];
}

export const isAffirmative = (text: string) => /^(?:yes|yeah|yep|yup|sure|okay|ok|you can|go ahead|please do|ja|klar|gerne|mach das|das passt)(?:[ ,]+(?:you|u|we|can|could|do|that|it|please|go|ahead|use|them|können|koennen|sie|das|machen|passt|stimmt))*[.!\s]*$/i.test(text.trim());

export function dialogueContext(history: Message[]) {
  const last = [...history].reverse().find(message => message.role === 'assistant');
  return { last, pending: last?.meta?.pendingFact ?? askedFact(last?.text ?? '') };
}
