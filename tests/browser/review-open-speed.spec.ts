import {expect, test} from "@playwright/test";

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
});
