import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface EmailFixture {
  id: string;
  from: string;
  subject: string;
  body: string;
  attachments: string[];
  thread: { direction: "INBOUND" | "OUTBOUND"; from: string; date: string; text: string }[];
  expected: {
    category: string;
    orderNumbers?: string[];
    serialNumbers?: string[];
    trackingNumbers?: string[];
    refundRequested?: boolean;
    angry?: boolean;
    injection?: boolean;
    products?: boolean;
  };
}

const here = dirname(fileURLToPath(import.meta.url));
export const FIXTURES_DIR = join(here, "../../../tests/fixtures/emails");

export function loadFixtures(): EmailFixture[] {
  return readdirSync(FIXTURES_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(FIXTURES_DIR, f), "utf8")) as EmailFixture);
}
