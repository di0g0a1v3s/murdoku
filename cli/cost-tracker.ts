import type { LanguageModelUsage } from 'ai';

// Gemini 2.0 Flash pricing (USD per 1M tokens)
const INPUT_COST_PER_M = 0.1;
const OUTPUT_COST_PER_M = 0.4;

interface Entry {
  label: string;
  usage: LanguageModelUsage;
  cost: number;
}

const entries: Entry[] = [];

export function trackUsage(label: string, usage: LanguageModelUsage): void {
  const input = usage.inputTokens ?? 0;
  const output = usage.outputTokens ?? 0;
  const cost = (input / 1_000_000) * INPUT_COST_PER_M + (output / 1_000_000) * OUTPUT_COST_PER_M;
  entries.push({ label, usage, cost });
  console.log(
    `  💰 ${label}: ${input.toLocaleString()} in + ${output.toLocaleString()} out tokens → $${cost.toFixed(5)}`,
  );
}

export function printCostSummary(): void {
  if (entries.length === 0) {
    return;
  }

  const totalInput = entries.reduce((s, e) => s + (e.usage.inputTokens ?? 0), 0);
  const totalOutput = entries.reduce((s, e) => s + (e.usage.outputTokens ?? 0), 0);
  const totalCost = entries.reduce((s, e) => s + e.cost, 0);

  console.log('\n💸 LLM Cost Summary:');
  console.log('─'.repeat(50));
  for (const e of entries) {
    console.log(`  ${e.label.padEnd(30)} $${e.cost.toFixed(5)}`);
  }
  console.log('─'.repeat(50));
  console.log(
    `  ${'TOTAL'.padEnd(30)} $${totalCost.toFixed(5)}` +
      `  (${totalInput.toLocaleString()} in + ${totalOutput.toLocaleString()} out tokens)`,
  );
}

export function resetCosts(): void {
  entries.length = 0;
}
