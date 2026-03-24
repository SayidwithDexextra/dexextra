const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  magenta: '\x1b[35m',
  blue: '\x1b[34m',
  white: '\x1b[37m',
  bgCyan: '\x1b[46m',
  bgMagenta: '\x1b[45m',
  bgBlue: '\x1b[44m',
  bgGreen: '\x1b[42m',
  bgRed: '\x1b[41m',
  bgYellow: '\x1b[43m',
} as const;

export { C };

export function shortAddr(a: string | undefined | null): string {
  if (!a || a.length < 10) return a || '';
  return `${a.slice(0, 6)}...${a.slice(-4)}`;
}

export function shortTx(hash: string | undefined | null): string {
  if (!hash || hash.length < 12) return hash || '';
  return `${hash.slice(0, 10)}...${hash.slice(-4)}`;
}

const STATUS_ICON: Record<string, string> = {
  start: `${C.yellow}\u25B6${C.reset}`,
  success: `${C.green}\u2714${C.reset}`,
  error: `${C.red}\u2718${C.reset}`,
};

const LANE_TAG: Record<string, string> = {
  A: `${C.bgCyan}${C.bold}${C.white} LANE A ${C.reset}`,
  B: `${C.bgMagenta}${C.bold}${C.white} LANE B ${C.reset}`,
};

export function laneLog(
  lane: 'A' | 'B',
  step: string,
  status: 'start' | 'success' | 'error',
  detail?: string,
) {
  const tag = LANE_TAG[lane];
  const icon = STATUS_ICON[status] || ' ';
  const statusColor = status === 'start' ? C.yellow : status === 'success' ? C.green : C.red;
  const extra = detail ? `  ${C.dim}${detail}${C.reset}` : '';
  console.log(`${tag} ${icon} ${statusColor}${step}${C.reset}${extra}`);
}

export function phaseHeader(title: string, subtitle?: string) {
  const line = `${C.bold}${C.white}${'═'.repeat(72)}${C.reset}`;
  const sub = subtitle ? `  ${C.dim}${subtitle}${C.reset}` : '';
  console.log('');
  console.log(line);
  console.log(`${C.bold}${C.white}  ${title}${C.reset}${sub}`);
  console.log(line);
}

export function phaseSubheader(text: string) {
  console.log(`${C.dim}${'─'.repeat(72)}${C.reset}`);
  if (text) console.log(`  ${C.bold}${C.blue}${text}${C.reset}`);
}

export function phaseDivider() {
  console.log(`${C.dim}${'─'.repeat(72)}${C.reset}`);
}

export function laneOverview(
  parallel: boolean,
  laneA: { signer: string; tasks: string },
  laneB?: { signer: string; tasks: string },
) {
  console.log(
    `  ${C.bold}Mode:${C.reset} ${parallel
      ? `${C.green}Parallel (2 signers)${C.reset}`
      : `${C.yellow}Sequential (1 signer)${C.reset}`}`,
  );
  console.log(`${LANE_TAG.A} ${C.cyan}Diamond Owner${C.reset}  ${C.dim}${laneA.signer}${C.reset}`);
  console.log(`${C.dim}         ${laneA.tasks}${C.reset}`);
  if (parallel && laneB) {
    console.log(`${LANE_TAG.B} ${C.magenta}Vault Admin${C.reset}    ${C.dim}${laneB.signer}${C.reset}`);
    console.log(`${C.dim}         ${laneB.tasks}${C.reset}`);
  }
  phaseDivider();
  console.log('');
}

export function phaseSummary(
  laneAResult: PromiseSettledResult<any>,
  laneBResult: PromiseSettledResult<any>,
  elapsedMs: number,
) {
  const elapsed = (elapsedMs / 1000).toFixed(1);
  console.log('');
  phaseDivider();
  const aOk = laneAResult.status === 'fulfilled';
  const bOk = laneBResult.status === 'fulfilled';
  console.log(
    `${LANE_TAG.A} ${aOk
      ? `${C.green}${C.bold}DONE${C.reset}`
      : `${C.red}${C.bold}FAILED${C.reset}  ${C.dim}${(laneAResult as PromiseRejectedResult).reason?.message || ''}${C.reset}`}`,
  );
  console.log(
    `${LANE_TAG.B} ${bOk
      ? `${C.green}${C.bold}DONE${C.reset}`
      : `${C.red}${C.bold}FAILED${C.reset}  ${C.dim}${(laneBResult as PromiseRejectedResult).reason?.message || ''}${C.reset}`}`,
  );
  console.log(`  ${C.bold}${C.white}Completed in ${elapsed}s${C.reset}`);
  console.log(`${C.bold}${C.white}${'═'.repeat(72)}${C.reset}\n`);
}

export function stepLog(
  step: string,
  status: 'start' | 'success' | 'error',
  detail?: string,
) {
  const icon = STATUS_ICON[status] || ' ';
  const statusColor = status === 'start' ? C.yellow : status === 'success' ? C.green : C.red;
  const extra = detail ? `  ${C.dim}${detail}${C.reset}` : '';
  console.log(`  ${icon} ${statusColor}${step}${C.reset}${extra}`);
}

export function phaseFooter(label: string, elapsedMs: number, ok: boolean) {
  const elapsed = (elapsedMs / 1000).toFixed(1);
  phaseDivider();
  const statusBadge = ok
    ? `${C.bgGreen}${C.bold}${C.white} OK ${C.reset}`
    : `${C.bgRed}${C.bold}${C.white} FAIL ${C.reset}`;
  console.log(`  ${statusBadge} ${C.bold}${C.white}${label}${C.reset}  ${C.dim}${elapsed}s${C.reset}`);
  console.log(`${C.bold}${C.white}${'═'.repeat(72)}${C.reset}\n`);
}
