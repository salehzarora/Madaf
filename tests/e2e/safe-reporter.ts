import type { Reporter, TestCase, TestResult, FullResult, TestError } from '@playwright/test/reporter';
import { writeFileSync } from 'node:fs';

/** No raw errors, attachments, steps, URLs, cookies or credentials in CI artifacts. */
export default class SafeReporter implements Reporter {
  private results: { scenario: string; status: string; duration_ms: number }[] = [];
  onError(error: TestError) {
    console.error('Browser runner setup failed; details kept in the ignored run directory.');
    writeFileSync(`${process.env.MADAF_E2E_RUN_ROOT}/runner-failure.json`, JSON.stringify(error), { mode: 0o600 });
  }
  onTestEnd(test: TestCase, result: TestResult) {
    this.results.push({ scenario: test.title, status: result.status, duration_ms: result.duration });
    console.log(`${result.status.toUpperCase()}: ${test.title} (${result.duration}ms)`);
    // Full failure details stay in the ignored local directory for diagnosis.
    if (result.errors.length) writeFileSync(`${process.env.MADAF_E2E_RUN_ROOT}/failure-${this.results.length}.json`, JSON.stringify(result.errors), { mode: 0o600 });
  }
  onEnd(result: FullResult) {
    writeFileSync('.e2e/browser-summary.json', JSON.stringify({ status: result.status, duration_ms: result.duration, results: this.results }, null, 2));
  }
}
