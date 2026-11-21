// Capture the deployed preview at desktop and mobile sizes.
// Exit codes: 0 success, 75 temporary navigation/browser infrastructure failure,
// 1 script or rendering defect.
import { createRequire } from "node:module";
import { mkdirSync, readFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";

const startedAt = performance.now();
const timings = [];
function record(label, ms) {
  const line = `[capture] ${label}: ${(ms / 1000).toFixed(2)}s`;
  timings.push(line);
  console.log(line);
}
async function timed(label, fn) {
  const start = performance.now();
  try {
    return await fn();
  } finally {
    record(label, performance.now() - start);
  }
}

const url = process.env.CAPTURE_URL || `http://127.0.0.1:${process.env.PORT || 3000}/`;
const outDir = resolve(process.env.CAPTURE_DIR || join(process.env.RUNNER_TEMP || "/tmp", "capture"));
const projectDir = resolve(process.env.PROJECT_DIR || process.cwd());

if (outDir === projectDir || outDir.startsWith(projectDir + sep)) {
  console.error(`[capture] refusing to write inside the project: ${outDir}`);
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });

const runtime = join(process.env.HOME || "", ".local/share/omgithub-playwright");
let chromium;
try {
  const require = createRequire(join(runtime, "package.json"));
  ({ chromium } = require("playwright"));
} catch (error) {
  console.error(`[capture] playwright runtime unavailable: ${error.message}`);
  process.exit(75);
}

let launchOptions = {};
try {
  const configName = process.platform === "darwin" ? "metal.json" : "linux.json";
  const config = JSON.parse(readFileSync(join(runtime, configName), "utf8"));
  launchOptions = config.browser?.launchOptions || {};
  if (process.platform === "linux" && !process.env.DISPLAY) {
    try {
      process.env.DISPLAY = ":" + readFileSync(join(runtime, "display"), "utf8").trim();
    } catch {
      /* headless fallback below */
    }
  }
} catch (error) {
  console.error(`[capture] could not read browser config: ${error.message}`);
  process.exit(75);
}

const transientPattern =
  /(net::ERR_|ECONNREFUSED|ECONNRESET|ENOTFOUND|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION|ERR_TIMED_OUT|ERR_ABORTED|ERR_NETWORK_CHANGED|Target closed|browser has disconnected)/i;

const views = [
  { name: "desktop", width: 1440, height: 900, mobile: false },
  { name: "mobile", width: 390, height: 844, mobile: true },
];

let browser = null;
let defect = false;
let transientFailure = false;
const summary = [];

try {
  browser = await timed("browser launch", async () => {
    const wantedHeadless = process.env.CAPTURE_HEADLESS === "1" ? true : launchOptions.headless;
    try {
      return await chromium.launch({ ...launchOptions, headless: wantedHeadless });
    } catch (error) {
      if (wantedHeadless === true) throw error;
      console.warn(`[capture] headed launch failed (${error.message}); retrying headless`);
      return chromium.launch({ ...launchOptions, headless: true });
    }
  });

  for (const view of views) {
    const pageFailures = [];
    let context = null;
    try {
      context = await timed(`${view.name} context`, () =>
        browser.newContext({
          viewport: { width: view.width, height: view.height },
          deviceScaleFactor: view.mobile ? 2 : 1,
          hasTouch: view.mobile,
          isMobile: view.mobile,
        })
      );
      const page = await timed(`${view.name} page`, () => context.newPage());
      page.setDefaultTimeout(30000);

      page.on("pageerror", (error) => pageFailures.push({ kind: "pageerror", message: error.message }));
      page.on("console", (message) => {
        if (message.type() === "error") pageFailures.push({ kind: "console", message: message.text() });
      });
      page.on("response", (response) => {
        if (response.status() < 400) return;
        try {
          if (new URL(response.url()).origin === new URL(url).origin) {
            pageFailures.push({ kind: "http", message: `HTTP ${response.status()} ${response.url()}` });
          }
        } catch {
          /* ignore malformed URLs */
        }
      });

      let response;
      try {
        response = await timed(`${view.name} navigate`, () =>
          page.goto(url, { waitUntil: "load", timeout: 45000 })
        );
      } catch (error) {
        const transient = error.name === "TimeoutError" || transientPattern.test(error.message || "");
        throw Object.assign(new Error(`navigation failed: ${error.message}`), { transient });
      }
      if (!response) throw Object.assign(new Error("navigation returned no response"), { transient: true });
      if (!response.ok()) {
        const transient = response.status() >= 500 || [408, 429].includes(response.status());
        throw Object.assign(new Error(`HTTP ${response.status()} loading ${url}`), { transient });
      }

      let readyState;
      try {
        await timed(`${view.name} app ready`, () =>
          page.waitForFunction(
            () =>
              window.__READY__ === true ||
              !!document.querySelector("#loadError.on"),
            null,
            { timeout: 45000 }
          )
        );
        readyState = await page.evaluate(() => ({
          ready: window.__READY__ === true,
          loadError: (document.querySelector("#loadError")?.textContent || "").trim(),
        }));
      } catch (error) {
        throw Object.assign(new Error(`app did not become ready: ${error.message}`), { transient: true });
      }
      if (!readyState.ready) {
        throw Object.assign(
          new Error(`app reported a load error: ${readyState.loadError || "unknown"}`),
          { transient: false }
        );
      }

      await timed(`${view.name} canvas`, async () => {
        await page.waitForSelector("canvas", { state: "visible", timeout: 10000 });
        const size = await page.evaluate(() => {
          const canvas = document.querySelector("canvas");
          return canvas ? { w: canvas.width, h: canvas.height } : null;
        });
        if (!size || size.w < 10 || size.h < 10) {
          throw Object.assign(new Error("canvas has no drawable size"), { transient: false });
        }
      });

      await page.waitForTimeout(1400);
      await timed(`${view.name} screenshot`, () =>
        page.screenshot({
          path: join(outDir, `final-${view.name}.png`),
          fullPage: false,
          timeout: 30000,
        })
      );

      if (pageFailures.length) {
        const detail = pageFailures.map((f) => `  ${f.kind}: ${f.message}`).join("\n");
        const allTransient = pageFailures.every(
          (f) => f.kind !== "pageerror" && transientPattern.test(f.message)
        );
        throw Object.assign(new Error(`page reported errors:\n${detail}`), {
          transient: allTransient,
        });
      }

      summary.push(`${view.name} ${view.width}x${view.height} OK`);
    } catch (error) {
      const isDefect = error.transient === false;
      if (isDefect) defect = true;
      else transientFailure = true;
      const label = isDefect ? "DEFECT" : "TRANSIENT";
      summary.push(`${view.name} ${label}: ${error.message}`);
      console.error(`[capture] ${view.name} ${label}: ${error.message}`);
      if (context) {
        const page = context.pages()[0];
        if (page) {
          await page
            .screenshot({ path: join(outDir, `failed-${view.name}.png`) })
            .catch(() => {});
        }
      }
    } finally {
      await context?.close().catch(() => {});
    }
  }
} catch (error) {
  console.error(`[capture] fatal: ${error.message}`);
  transientFailure = true;
} finally {
  await browser?.close().catch(() => {
    transientFailure = true;
  });
}

record("total", performance.now() - startedAt);
console.log("[capture] summary:");
for (const line of summary) console.log(`  - ${line}`);
console.log(`[capture] output: ${outDir}`);

process.exitCode = defect ? 1 : transientFailure ? 75 : 0;
