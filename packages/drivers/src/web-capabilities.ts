import fs from 'node:fs/promises';
import { chromium } from 'playwright';

export interface WebDriverCapabilities {
  chromium: boolean;
}

export async function getWebDriverCapabilities(): Promise<WebDriverCapabilities> {
  try {
    await fs.access(chromium.executablePath());
    return { chromium: true };
  } catch {
    return { chromium: false };
  }
}
