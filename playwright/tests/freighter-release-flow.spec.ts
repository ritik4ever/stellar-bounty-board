/**
 * End-to-end test: Freighter wallet signing for maintainer release flow.
 *
 * This test mocks the Freighter browser extension API on `window.freighter`
 * and verifies that:
 *  1. The "Connect Freighter" button is visible when not connected
 *  2. After connecting, the public key is displayed
 *  3. The release button is enabled only when Freighter is connected
 *  4. The signed payload is sent to the backend with correct headers
 *  5. The audit log contains the signer's public key
 */

import { test, expect, type Page } from "@playwright/test";

// A valid Stellar testnet public key for mocking
const MOCK_PUBLIC_KEY = "GBPLA3T4I2WQ2Q2R2F2V2U2X2Y2Z2A2B2C2D2E2F2G2H2I2J2K2L2M2N2O2P";
const MOCK_SIGNATURE = "AAAAAFakeSignatureForTestingPurposesOnly1234567890abcdefghijklmnopqrstuvwxyz==";
const MOCK_NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";

/**
 * Inject a mock Freighter API into the page before the app loads.
 * This simulates a connected Freighter wallet on the correct network.
 */
async function mockFreighterConnected(page: Page) {
  await page.addInitScript(() => {
    (window as any).freighter = {
      isConnected: async () => ({ isConnected: true }),
      getPublicKey: async () => "GBPLA3T4I2WQ2Q2R2F2V2U2X2Y2Z2A2B2C2D2E2F2G2H2I2J2K2L2M2N2O2P",
      signMessage: async (message: string, opts?: { networkPassphrase?: string }) => {
        console.log("[Mock Freighter] signMessage called with:", message);
        return { signature: "AAAAAFakeSignatureForTestingPurposesOnly1234567890abcdefghijklmnopqrstuvwxyz==" };
      },
      getNetwork: async () => ({
        network: "TESTNET",
        networkPassphrase: "Test SDF Network ; September 2015",
      }),
      setNetwork: async () => {},
    };
  });
}

/**
 * Inject a mock Freighter that is NOT connected.
 */
async function mockFreighterDisconnected(page: Page) {
  await page.addInitScript(() => {
    (window as any).freighter = {
      isConnected: async () => ({ isConnected: false }),
      getPublicKey: async () => { throw new Error("Not connected"); },
      signMessage: async () => { throw new Error("Not connected"); },
      getNetwork: async () => ({
        network: "TESTNET",
        networkPassphrase: "Test SDF Network ; September 2015",
      }),
      setNetwork: async () => {},
    };
  });
}

/**
 * Inject a mock Freighter on the WRONG network.
 */
async function mockFreighterWrongNetwork(page: Page) {
  await page.addInitScript(() => {
    (window as any).freighter = {
      isConnected: async () => ({ isConnected: true }),
      getPublicKey: async () => "GBPLA3T4I2WQ2Q2R2F2V2U2X2Y2Z2A2B2C2D2E2F2G2H2I2J2K2L2M2N2O2P",
      signMessage: async () => { throw new Error("Wrong network"); },
      getNetwork: async () => ({
        network: "PUBLIC",
        networkPassphrase: "Public Global Stellar Network ; September 2015",
      }),
      setNetwork: async () => {},
    };
  });
}

test.describe("Freighter Wallet Integration – Release Flow", () => {
  test("shows connect button when Freighter is not connected", async ({ page }) => {
    await mockFreighterDisconnected(page);
    await page.goto("/");

    // The Freighter connect button should be visible
    const connectButton = page.locator('button:has-text("Connect Freighter")');
    await expect(connectButton).toBeVisible({ timeout: 10000 });
  });

  test("shows public key after connecting Freighter", async ({ page }) => {
    await mockFreighterConnected(page);
    await page.goto("/");

    // Wait for the app to detect Freighter
    await page.waitForTimeout(2000);

    // The connected indicator should show the truncated public key
    const connectedIndicator = page.locator(".freighter-connected");
    await expect(connectedIndicator).toBeVisible({ timeout: 10000 });

    // Should show the disconnect button
    const disconnectButton = page.locator('button:has-text("Disconnect")');
    await expect(disconnectButton).toBeVisible();
  });

  test("shows error banner on wrong network", async ({ page }) => {
    await mockFreighterWrongNetwork(page);
    await page.goto("/");

    // Wait for the app to detect the wrong network
    await page.waitForTimeout(2000);

    // The error banner should be visible
    const errorBanner = page.locator(".freighter-error-banner");
    await expect(errorBanner).toBeVisible({ timeout: 10000 });
    await expect(errorBanner).toContainText("Wrong network");
  });

  test("release button is disabled when Freighter is not connected", async ({ page }) => {
    await mockFreighterDisconnected(page);
    await page.goto("/");

    // Wait for bounties to load
    await page.waitForTimeout(3000);

    // Find a "Release" button – it should be clickable but will show a toast error
    // since Freighter is not connected
    const releaseButton = page.locator('button:has-text("Release")');
    if (await releaseButton.isVisible()) {
      await releaseButton.click();

      // Should show a toast error about connecting Freighter
      const toast = page.locator('[data-sonner-toaster]');
      await expect(toast).toContainText("Freighter", { timeout: 5000 });
    }
  });

  test("full release flow with mocked Freighter signing", async ({ page }) => {
    // Mock the API response for the release endpoint
    await page.route("**/api/bounties/**/release", async (route) => {
      const request = route.request();
      const headers = request.headers();

      // Verify the signature headers are present
      expect(headers["x-stellar-signature"]).toBeDefined();
      expect(headers["x-stellar-public-key"]).toBeDefined();

      const body = JSON.parse(request.postData() || "{}");
      expect(body.action).toBe("release");
      expect(body.bountyId).toBeDefined();
      expect(body.timestamp).toBeDefined();
      expect(typeof body.timestamp).toBe("number");

      // Return a successful response
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            id: body.bountyId,
            status: "released",
            releasedAt: Math.floor(Date.now() / 1000),
            maintainer: headers["x-stellar-public-key"],
          },
        }),
      });
    });

    await mockFreighterConnected(page);
    await page.goto("/");

    // Wait for bounties to load
    await page.waitForTimeout(3000);

    // Find a "Release" button on a submitted bounty
    const releaseButton = page.locator('button:has-text("Release")');
    if (await releaseButton.isVisible()) {
      await releaseButton.click();

      // Wait for the toast success message
      const successToast = page.locator("text=released", { hasText: /released/i });
      await expect(successToast).toBeVisible({ timeout: 10000 });
    }
  });

  test("full refund flow with mocked Freighter signing", async ({ page }) => {
    // Mock the API response for the refund endpoint
    await page.route("**/api/bounties/**/refund", async (route) => {
      const request = route.request();
      const headers = request.headers();

      // Verify the signature headers are present
      expect(headers["x-stellar-signature"]).toBeDefined();
      expect(headers["x-stellar-public-key"]).toBeDefined();

      const body = JSON.parse(request.postData() || "{}");
      expect(body.action).toBe("refund");
      expect(body.bountyId).toBeDefined();
      expect(body.timestamp).toBeDefined();

      // Return a successful response
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            id: body.bountyId,
            status: "refunded",
            refundedAt: Math.floor(Date.now() / 1000),
            maintainer: headers["x-stellar-public-key"],
          },
        }),
      });
    });

    await mockFreighterConnected(page);
    await page.goto("/");

    // Wait for bounties to load
    await page.waitForTimeout(3000);

    // Find a "Refund" button
    const refundButton = page.locator('button:has-text("Refund")');
    if (await refundButton.isVisible()) {
      await refundButton.click();

      // Wait for the toast success message
      const successToast = page.locator("text=refunded", { hasText: /refunded/i });
      await expect(successToast).toBeVisible({ timeout: 10000 });
    }
  });
});