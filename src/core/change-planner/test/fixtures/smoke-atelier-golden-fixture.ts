import { readFileSync } from 'node:fs';
import path from 'node:path';

import { normalizeTextForLineMetrics } from '../../validators/text-line-normalization';

const GOLDEN_BASELINE_FIXTURE_PATH = path.resolve(
  process.cwd(),
  'src/core/change-planner/test/fixtures/smoke-atelier-index.html',
);

/** ADR-032 golden baseline: 36-line smoke-atelier index.html (pinned, LF-normalized). */
export function loadSmokeAtelierGoldenBaseline(): string {
  return normalizeTextForLineMetrics(readFileSync(GOLDEN_BASELINE_FIXTURE_PATH, 'utf8'));
}

/** Smallest valid accessibility patch: attribute-only edits on 8 existing lines. */
export function buildGoldenAccessibilityHtml(baseline: string): string {
  return baseline
    .replace(
      '<section class="counter-section">',
      '<section class="counter-section" aria-labelledby="counter-heading">',
    )
    .replace('<h2>Interactive Counter</h2>', '<h2 id="counter-heading">Interactive Counter</h2>')
    .replace(
      '<span id="counter-value">0</span>',
      '<span id="counter-value" aria-live="polite">0</span>',
    )
    .replace(
      '<button id="increment-counter" aria-label="Increment counter">Increment</button>',
      '<button id="increment-counter" type="button" aria-label="Increment counter">Increment</button>',
    )
    .replace(
      '<button id="reset-counter" aria-label="Reset counter to zero">Reset</button>',
      '<button id="reset-counter" type="button" aria-label="Reset counter to zero">Reset</button>',
    )
    .replace(
      '<section class="quote-section">',
      '<section class="quote-section" aria-labelledby="quote-heading">',
    )
    .replace('<h2>Inspirational Quote</h2>', '<h2 id="quote-heading">Inspirational Quote</h2>')
    .replace(
      '<button id="next-quote" aria-label="Show next quote">Next Quote</button>',
      '<button id="next-quote" type="button" aria-label="Show next quote">Next Quote</button>',
    );
}
