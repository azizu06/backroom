export const operatorActions = {
  status: ['Refresh host links', 'Current host state, approval and payment links.'],
  health: ['Check dependencies', 'Same read-only probes as the live health check; no inference. A successful Nessie sandbox read verifies the bank status without paying.'],
  preflight: ['Run preflight', 'Six bounded read-only checks before a call.'],
  reset: ['Reset company', 'Fresh owned database and seeded gateway setup. Existing links expire; reload the office.'],
  core: ['Run core scenarios', 'Offline collections, inbox traps and payables scenarios. Separate from the live office.'],
  eval: ['Run scripted eval', 'Offline answer-key evaluation with software authenticators and local transports.'],
  metrics: ['Run offline metrics', 'Fresh offline replay metrics; historical receipts remain labeled.'],
  scoreboard: ['Run agent scoreboard', 'Offline agent evaluation; records gaps as well as passes.'],
  burst_plan: ['Plan month burst', '25 generated companies; builds inputs without inference.'],
  burst: ['Run small GX10 burst', 'One company, one item, one worker. Local models only; requires host opt-in and LLM ON.'],
  warm: ['Warm GX10 model', 'One local token on the configured model. Requires host opt-in and LLM ON.'],
  llm_on: ['Enable models', 'Allows model work through the existing global switch. Providers may incur costs.'],
  llm_off: ['Turn models OFF', 'Aborts model work through the existing global switch. Code policy remains active.'],
  x402_simulated: ['Pay vendor with x402 · OFFLINE', 'Approved $1,250.00 Acme Supply invoice through PayablesSeat. Vendor and facilitator run in this process: no keys or chain.'],
  x402_testnet: ['Pay vendor with x402 · TESTNET', 'Approved $0.01 Acme Supply invoice in worthless Base Sepolia test USDC. Host opt-in (X402_LIVE=1) and macOS Keychain signer only; once per host process.'],
  x402_blocked: ['Try blocked x402 invoice · OFFLINE', '$2,450.00 Acme Supply invoice over the $2,000 Payables limit. Policy holds it with zero signing and zero vendor requests.'],
} as const;
export type OperatorAction = keyof typeof operatorActions;
export function isOperatorAction(value: string): value is OperatorAction { return Object.hasOwn(operatorActions, value); }
