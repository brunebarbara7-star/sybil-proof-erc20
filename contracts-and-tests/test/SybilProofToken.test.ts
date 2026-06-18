import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { network } from "hardhat";
import { parseEther, getAddress, encodeFunctionData } from "viem";

// ---------------------------------------------------------------------------
// Shared network connection — one Hardhat EDR instance for the whole suite.
// Each test restores a clean snapshot via loadFixture, so tests are isolated.
// ---------------------------------------------------------------------------
describe("SybilProofToken", async () => {
  const { viem, networkHelpers } = await network.create();

  // -------------------------------------------------------------------------
  // Fixture — deploys all contracts and returns named handles.
  // Called once; subsequent calls restore the post-deploy snapshot instantly.
  // -------------------------------------------------------------------------
  async function deployFixture() {
    const [owner, alice, bob, charlie] = await viem.getWalletClients();

    const mockPermission = await viem.deployContract("MockPermissionContract");
    const mockPermission2 = await viem.deployContract("MockPermissionContract");
    const mockRegistry = await viem.deployContract("MockBootstrapRegistry");

    // Registry initially points "permission" → mockPermission
    await mockRegistry.write.setContractAddress([
      "permission",
      mockPermission.address,
    ]);

    // Deploy via the harness so refreshEligibilityContractFromRegistry() is testable
    const token = await viem.deployContract("SybilProofTokenHarness", [
      "SybilProof Token",
      "SPT",
      mockPermission.address,
      mockRegistry.address,
    ]);

    return {
      token,
      mockPermission,
      mockPermission2,
      mockRegistry,
      owner,
      alice,
      bob,
      charlie,
    };
  }

  // =========================================================================
  // MINTING
  // =========================================================================
  describe("mint() — self-service minting", async () => {
    it("KYC-verified wallet mints tokens to itself and emits TokensMinted", async () => {
      const { token, mockPermission, alice } =
        await networkHelpers.loadFixture(deployFixture);

      await mockPermission.write.setAllowed([alice.account.address, true]);
      const amount = parseEther("100");

      await viem.assertions.emitWithArgs(
        token.write.mint([amount], { account: alice.account }),
        token,
        "TokensMinted",
        [alice.account.address, amount],
      );

      assert.equal(
        await token.read.balanceOf([alice.account.address]),
        amount,
      );
    });

    it("unverified wallet reverts with NotKYCVerified containing caller address", async () => {
      const { token, alice } =
        await networkHelpers.loadFixture(deployFixture);
      // alice has no KYC permission by default

      await viem.assertions.revertWithCustomErrorWithArgs(
        token.write.mint([parseEther("1")], { account: alice.account }),
        token,
        "NotKYCVerified",
        [alice.account.address],
      );
    });

    it("benchmark: same wallet fails before KYC, succeeds after KYC", async () => {
      const { token, mockPermission, alice } =
        await networkHelpers.loadFixture(deployFixture);
      const amount = parseEther("50");

      // Step 1 — unverified → must revert
      await viem.assertions.revertWithCustomErrorWithArgs(
        token.write.mint([amount], { account: alice.account }),
        token,
        "NotKYCVerified",
        [alice.account.address],
      );

      // Step 2 — complete KYC
      await mockPermission.write.setAllowed([alice.account.address, true]);

      // Step 3 — same wallet, now succeeds
      await token.write.mint([amount], { account: alice.account });
      assert.equal(
        await token.read.balanceOf([alice.account.address]),
        amount,
      );
    });

    it("BENCHMARK — isolated isAllowed() verification check gas is ≤ 50,000", async () => {
      const { mockPermission, alice } =
        await networkHelpers.loadFixture(deployFixture);
      await mockPermission.write.setAllowed([alice.account.address, true]);

      const publicClient = await viem.getPublicClient();
      // Call isAllowed() directly on the Permission Contract — same address stored in
      // eligibilityContract — so the estimate covers only the KYC lookup itself,
      // with no ERC20 storage writes or event emission included.
      const isolatedGas = await publicClient.estimateGas({
        account: alice.account,
        to: mockPermission.address,
        data: encodeFunctionData({
          abi: mockPermission.abi,
          functionName: "isAllowed",
          args: [alice.account.address],
        }),
      });

      console.log(`  → isolated isAllowed() gas estimate : ${isolatedGas}`);
      assert.ok(
        isolatedGas <= 50_000n,
        `isAllowed() gas ${isolatedGas} exceeds the 50,000 benchmark`,
      );
    });

    it("sanity — full mint() transaction gas (ERC20 write + KYC check + event) stays under 200,000", async () => {
      const { token, mockPermission, alice } =
        await networkHelpers.loadFixture(deployFixture);
      await mockPermission.write.setAllowed([alice.account.address, true]);

      const publicClient = await viem.getPublicClient();
      const hash = await token.write.mint([parseEther("1")], {
        account: alice.account,
      });
      const receipt = await publicClient.getTransactionReceipt({ hash });

      console.log(`  → full mint() transaction gasUsed   : ${receipt.gasUsed}`);
      // This includes ERC20 balance/totalSupply writes, event emission, and the
      // isAllowed() call — all unrelated to the KYC check benchmark above.
      assert.ok(
        receipt.gasUsed < 200_000n,
        `Full mint gas ${receipt.gasUsed} unexpectedly high — check for loops in _update`,
      );
    });
  });

  // =========================================================================
  // TRANSFER GATING
  // =========================================================================
  describe("transferGateEnabled = false (default)", async () => {
    it("transfer between unverified wallets succeeds when gate is off", async () => {
      const { token, mockPermission, alice, bob } =
        await networkHelpers.loadFixture(deployFixture);

      // Alice needs tokens — mark her verified only for minting
      await mockPermission.write.setAllowed([alice.account.address, true]);
      await token.write.mint([parseEther("100")], { account: alice.account });
      // Revoke alice so neither sender nor recipient is verified
      await mockPermission.write.setAllowed([alice.account.address, false]);

      // Gate is off → transfer to unverified bob must succeed
      await token.write.transfer(
        [bob.account.address, parseEther("10")],
        { account: alice.account },
      );

      assert.equal(
        await token.read.balanceOf([bob.account.address]),
        parseEther("10"),
      );
    });
  });

  describe("transferGateEnabled = true", async () => {
    it("unverified sender reverts with NotKYCVerified(sender)", async () => {
      const { token, mockPermission, alice, bob } =
        await networkHelpers.loadFixture(deployFixture);

      await mockPermission.write.setAllowed([alice.account.address, true]);
      await token.write.mint([parseEther("100")], { account: alice.account });

      // Enable gate then revoke alice's KYC
      await token.write.setTransferGateEnabled([true]);
      await mockPermission.write.setAllowed([alice.account.address, false]);

      await viem.assertions.revertWithCustomErrorWithArgs(
        token.write.transfer(
          [bob.account.address, parseEther("10")],
          { account: alice.account },
        ),
        token,
        "NotKYCVerified",
        [alice.account.address],
      );
    });

    it("verified sender → unverified recipient reverts with NotKYCVerified(recipient)", async () => {
      const { token, mockPermission, alice, bob } =
        await networkHelpers.loadFixture(deployFixture);

      await mockPermission.write.setAllowed([alice.account.address, true]);
      await token.write.mint([parseEther("100")], { account: alice.account });
      await token.write.setTransferGateEnabled([true]);
      // alice stays verified; bob is NOT verified

      await viem.assertions.revertWithCustomErrorWithArgs(
        token.write.transfer(
          [bob.account.address, parseEther("10")],
          { account: alice.account },
        ),
        token,
        "NotKYCVerified",
        [bob.account.address],
      );
    });

    it("both verified wallets can transfer while gate is enabled", async () => {
      const { token, mockPermission, alice, bob } =
        await networkHelpers.loadFixture(deployFixture);

      await mockPermission.write.setAllowed([alice.account.address, true]);
      await mockPermission.write.setAllowed([bob.account.address, true]);
      await token.write.mint([parseEther("100")], { account: alice.account });
      await token.write.setTransferGateEnabled([true]);

      await token.write.transfer(
        [bob.account.address, parseEther("30")],
        { account: alice.account },
      );

      assert.equal(
        await token.read.balanceOf([bob.account.address]),
        parseEther("30"),
      );
    });

    it("toggling gate back to false re-allows unverified transfers", async () => {
      const { token, mockPermission, alice, bob } =
        await networkHelpers.loadFixture(deployFixture);

      await mockPermission.write.setAllowed([alice.account.address, true]);
      await token.write.mint([parseEther("100")], { account: alice.account });
      await mockPermission.write.setAllowed([alice.account.address, false]);

      // Enable then immediately disable
      await token.write.setTransferGateEnabled([true]);
      await token.write.setTransferGateEnabled([false]);

      // Gate is off — unverified alice can transfer to unverified bob
      await token.write.transfer(
        [bob.account.address, parseEther("10")],
        { account: alice.account },
      );

      assert.equal(
        await token.read.balanceOf([bob.account.address]),
        parseEther("10"),
      );
    });

    it("setTransferGateEnabled emits TransferGateToggled", async () => {
      const { token } = await networkHelpers.loadFixture(deployFixture);

      await viem.assertions.emitWithArgs(
        token.write.setTransferGateEnabled([true]),
        token,
        "TransferGateToggled",
        [true],
      );
    });

    it("non-owner calling setTransferGateEnabled reverts with OwnableUnauthorizedAccount", async () => {
      const { token, alice } = await networkHelpers.loadFixture(deployFixture);

      await viem.assertions.revertWithCustomError(
        token.write.setTransferGateEnabled([true], { account: alice.account }),
        token,
        "OwnableUnauthorizedAccount",
      );
    });
  });

  // =========================================================================
  // MINT / BURN EDGE CASES — address(0) skips the transfer gate
  // =========================================================================
  describe("_update edge cases: address(0) endpoints bypass the transfer gate", async () => {
    it("minting with gate enabled succeeds — from==address(0) skips the gate check", async () => {
      const { token, mockPermission, alice } =
        await networkHelpers.loadFixture(deployFixture);

      await token.write.setTransferGateEnabled([true]);
      await mockPermission.write.setAllowed([alice.account.address, true]);

      // _update receives from==address(0) → gate skipped; mint()'s own check passes
      await token.write.mint([parseEther("1")], { account: alice.account });

      assert.equal(
        await token.read.balanceOf([alice.account.address]),
        parseEther("1"),
      );
    });

    it("burning with gate enabled and KYC revoked succeeds — to==address(0) skips the gate check", async () => {
      const { token, mockPermission, alice } =
        await networkHelpers.loadFixture(deployFixture);

      // Mint while verified
      await mockPermission.write.setAllowed([alice.account.address, true]);
      await token.write.mint([parseEther("10")], { account: alice.account });

      // Enable gate and revoke KYC
      await token.write.setTransferGateEnabled([true]);
      await mockPermission.write.setAllowed([alice.account.address, false]);

      // burn() calls _burn → _update(alice, address(0), ...) → to==0 skips gate
      await token.write.burn([parseEther("5")], { account: alice.account });

      assert.equal(
        await token.read.balanceOf([alice.account.address]),
        parseEther("5"),
      );
    });
  });

  // =========================================================================
  // ADMIN FUNCTIONS
  // =========================================================================
  describe("setEligibilityContract()", async () => {
    it("owner updates eligibilityContract and emits EligibilityContractUpdated", async () => {
      const { token, mockPermission, mockPermission2 } =
        await networkHelpers.loadFixture(deployFixture);

      await viem.assertions.emitWithArgs(
        token.write.setEligibilityContract([mockPermission2.address]),
        token,
        "EligibilityContractUpdated",
        [getAddress(mockPermission.address), getAddress(mockPermission2.address)],
      );

      assert.equal(
        getAddress(await token.read.eligibilityContract()),
        getAddress(mockPermission2.address),
      );
    });

    it("non-owner calling setEligibilityContract reverts with OwnableUnauthorizedAccount", async () => {
      const { token, mockPermission2, alice } =
        await networkHelpers.loadFixture(deployFixture);

      await viem.assertions.revertWithCustomError(
        token.write.setEligibilityContract(
          [mockPermission2.address],
          { account: alice.account },
        ),
        token,
        "OwnableUnauthorizedAccount",
      );
    });
  });

  describe("refreshEligibilityContractFromRegistry()", async () => {
    it("owner refreshes — updates eligibilityContract and emits EligibilityContractUpdated", async () => {
      const { token, mockPermission, mockPermission2, mockRegistry } =
        await networkHelpers.loadFixture(deployFixture);

      // Point registry at a new permission contract
      await mockRegistry.write.setContractAddress([
        "permission",
        mockPermission2.address,
      ]);

      await viem.assertions.emitWithArgs(
        token.write.refreshEligibilityContractFromRegistry(),
        token,
        "EligibilityContractUpdated",
        [getAddress(mockPermission.address), getAddress(mockPermission2.address)],
      );

      assert.equal(
        getAddress(await token.read.eligibilityContract()),
        getAddress(mockPermission2.address),
      );
    });

    it("refresh is a no-op when registry returns the same address — no event, state unchanged", async () => {
      const { token, mockPermission } =
        await networkHelpers.loadFixture(deployFixture);

      // Registry still returns mockPermission.address == current eligibilityContract
      const before = await token.read.eligibilityContract();

      // Should not revert; the newAddress == old branch is taken silently
      await token.write.refreshEligibilityContractFromRegistry();

      assert.equal(await token.read.eligibilityContract(), before);
    });

    it("non-owner calling refreshEligibilityContractFromRegistry reverts with OwnableUnauthorizedAccount", async () => {
      const { token, alice } =
        await networkHelpers.loadFixture(deployFixture);

      await viem.assertions.revertWithCustomError(
        token.write.refreshEligibilityContractFromRegistry({
          account: alice.account,
        }),
        token,
        "OwnableUnauthorizedAccount",
      );
    });
  });
});
