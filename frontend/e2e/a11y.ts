import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

/** Fails the test on any WCAG 2.1 A/AA violation axe can detect on the page. */
export async function expectAccessible(page: Page) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  // Readable failure: rule, impact, and the first offending element of each.
  const summary = violations.map(
    (v) => `${v.id} (${v.impact}): ${v.help} -> ${v.nodes[0]?.target.join(" ")}`,
  );
  expect(summary).toEqual([]);
}
