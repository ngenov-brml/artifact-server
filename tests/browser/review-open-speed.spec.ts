import {expect, test, type Route} from "@playwright/test";

import {publishNew} from "../support/publishing.js";
import {
  localLogin,
  startBrowserFixture,
  stopBrowserFixture,
  type BrowserFixture,
} from "./browser-fixture.js";

const onePage = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>Open speed</title></head>
  <body><p id="painted">artifact painted</p></body>
</html>`;

async function openOneFileReview(
  fixture: BrowserFixture,
  idempotencyKey: string,
): Promise<string> {
  const published = await publishNew(fixture.server, fixture.installation, {
    accessSetting: "account_required",
    content: onePage,
    idempotencyKey,
    mediaType: "text/html; charset=utf-8",
    name: "Open speed",
    path: "index.html",
  });
  await localLogin(fixture);
  return `${fixture.server.baseUrl}/review?project=prj_default&artifact=${published.body.artifact.id}&version=${published.body.version.id}`;
}

function paintedText(fixture: BrowserFixture) {
  return fixture.page
    .frameLocator(".as-artifact-frame")
    .frameLocator("iframe")
    .locator("#painted");
}

const notReleased = (): void => {};

/** Hold every matching request until the returned release function runs. */
async function holdRequests(
  fixture: BrowserFixture,
  url: RegExp,
): Promise<() => void> {
  let release = notReleased;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  await fixture.page.route(url, async (route: Route) => {
    await released;
    await route.continue();
  });
  return release;
}

test.describe("Review open speed", () => {
  test("a one-file artifact opens without a preview lease", async ({browser}) => {
    const fixture = await startBrowserFixture(browser);
    try {
      const reviewUrl = await openOneFileReview(fixture, "open-speed-no-lease");
      const leaseRequests: string[] = [];
      fixture.page.on("request", (request) => {
        if (request.url().includes("/preview-leases")) leaseRequests.push(request.url());
      });

      await fixture.page.goto(reviewUrl);

      await expect(paintedText(fixture)).toHaveText("artifact painted");
      expect(leaseRequests).toEqual([]);
    } finally {
      await stopBrowserFixture(fixture);
    }
  });

  test("projects load in the same wave as the session", async ({browser}) => {
    const fixture = await startBrowserFixture(browser);
    try {
      const reviewUrl = await openOneFileReview(fixture, "open-speed-boot-wave");
      const release = await holdRequests(fixture, /\/api\/v1\/session$/u);
      try {
        const projects = fixture.page.waitForRequest(/\/api\/v1\/projects$/u, {timeout: 5_000});
        await fixture.page.goto(reviewUrl, {waitUntil: "commit"});
        await projects;
      } finally {
        release();
      }
      await expect(paintedText(fixture)).toHaveText("artifact painted");
    } finally {
      await stopBrowserFixture(fixture);
    }
  });

  test("the artifact shows while the version list is still loading", async ({browser}) => {
    const fixture = await startBrowserFixture(browser);
    try {
      const reviewUrl = await openOneFileReview(fixture, "open-speed-version-list");
      const release = await holdRequests(fixture, /\/api\/v1\/artifacts\/[^/]+\/versions\?/u);
      try {
        await fixture.page.goto(reviewUrl);
        await expect(paintedText(fixture)).toHaveText("artifact painted");
      } finally {
        release();
      }
    } finally {
      await stopBrowserFixture(fixture);
    }
  });

  test("the review frame loads while the artifact HTML is still loading", async ({browser}) => {
    const fixture = await startBrowserFixture(browser);
    try {
      const reviewUrl = await openOneFileReview(fixture, "open-speed-frame-early");
      const release = await holdRequests(fixture, /\/versions\/[^/]+\/file\?/u);
      try {
        const frame = fixture.page.waitForRequest(/\/review-frame$/u, {timeout: 5_000});
        await fixture.page.goto(reviewUrl, {waitUntil: "commit"});
        await frame;
      } finally {
        release();
      }
      await expect(paintedText(fixture)).toHaveText("artifact painted");
    } finally {
      await stopBrowserFixture(fixture);
    }
  });
});
