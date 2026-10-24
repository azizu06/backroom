export const operatorActions = {
  status: ['Refresh demo links', 'Current host state, approval and payment links.'],
  health: ['Check dependencies', 'Same read-only probes as demo:health --live; no inference.'],
  preflight: ['Run preflight', 'Six bounded read-only checks from demo:preflight.'],
  reset: ['Reset company', 'Fresh owned database and seeded gateway setup. Existing links expire; reload the office.'],
  core: ['Run core scenarios', 'Offline synthetic collections, inbox traps and payables. Separate from the live office.'],
  eval: ['Run scripted eval', 'Offline answer-key evaluation with software authenticators and fake transports.'],
  metrics: ['Run offline metrics', 'Fresh offline replay metrics; historical receipts remain labeled.'],
  scoreboard: ['Run agent scoreboard', 'Offline agent evaluation; records gaps as well as passes.'],
  burst_plan: ['Preview month burst', '25 synthetic companies; generates inputs without inference.'],
  burst: ['Run small GX10 burst', 'One company, one item, one worker. Local models only; requires host opt-in and LLM ON.'],
  warm: ['Warm GX10 model', 'One local token on the configured model. Requires host opt-in and LLM ON.'],
  llm_on: ['Enable models', 'Allows model work through the existing global switch. Providers may incur costs.'],
  llm_off: ['Turn models OFF', 'Aborts model work through the existing global switch. Code policy remains active.'],
} as const;
export type OperatorAction = keyof typeof operatorActions;
export function isOperatorAction(value: string): value is OperatorAction { return Object.hasOwn(operatorActions, value); }
