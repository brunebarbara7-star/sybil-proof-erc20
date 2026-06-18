// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title SybilProofToken
 * @notice ERC-20 token that gates minting (and optionally transfers) behind
 *         Redbelly Network's on-chain KYC/sybil-resistance verification.
 *
 * Bootstrap Registry pattern
 * --------------------------
 * Redbelly deploys a single Bootstrap Registry at a fixed address on every
 * network (0xDAFEA492D9c6733ae3d56b7Ed1ADB60692c98Bc5). Calling
 * `getContractAddress("permission")` on it returns the current Permission
 * Contract for that chain. The Permission Contract exposes `isAllowed(address)`
 * which returns true when the wallet has completed KYC via the
 * IndividualOnboardingSDK and has been granted on-chain permission.
 *
 * The Permission Contract address is resolved once — either off-chain in the
 * deploy script or via `refreshEligibilityContractFromRegistry()` — and cached
 * in `eligibilityContract`. This avoids paying an extra cross-contract call on
 * every mint/transfer while still allowing the address to be updated if Redbelly
 * upgrades the Permission Contract.
 */

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

/**
 * @notice Redbelly Bootstrap Registry — fixed address on all Redbelly networks.
 *         Acts as a name registry: given a contract name string it returns the
 *         current deployed address for that contract on the calling chain.
 */
interface IBootstrapRegistry {
    function getContractAddress(string memory contractName) external view returns (address);
}

/**
 * @notice Redbelly Permission Contract — address resolved via Bootstrap Registry.
 *         Returns true for wallets that completed KYC via IndividualOnboardingSDK.
 */
interface IPermissionContract {
    function isAllowed(address _address) external view returns (bool);
}

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

contract SybilProofToken is ERC20, Ownable {
    // -----------------------------------------------------------------------
    // Custom errors
    // -----------------------------------------------------------------------

    /**
     * @notice Reverted when an address has not completed KYC via the
     *         IndividualOnboardingSDK or does not hold on-chain permission.
     */
    error NotKYCVerified(address user);

    // -----------------------------------------------------------------------
    // Events
    // -----------------------------------------------------------------------

    /// @notice Emitted when `eligibilityContract` is updated (directly or via refresh).
    event EligibilityContractUpdated(address indexed oldAddress, address indexed newAddress);

    /// @notice Emitted when the transfer gate is toggled.
    event TransferGateToggled(bool enabled);

    /// @notice Emitted after a successful mint.
    event TokensMinted(address indexed to, uint256 amount);

    // -----------------------------------------------------------------------
    // Constants
    // -----------------------------------------------------------------------

    /**
     * @notice Bootstrap Registry — same address on every Redbelly network.
     *         Call `getContractAddress("permission")` on this to get the
     *         chain-specific Permission Contract address.
     */
    address public constant BOOTSTRAP_REGISTRY = 0xDAFEA492D9c6733ae3d56b7Ed1ADB60692c98Bc5;

    // -----------------------------------------------------------------------
    // State
    // -----------------------------------------------------------------------

    /**
     * @notice Cached Permission Contract address, resolved from the Bootstrap
     *         Registry. Cached here so mint/transfer checks cost only one
     *         external call instead of two. Refresh via
     *         `refreshEligibilityContractFromRegistry()` when Redbelly upgrades
     *         the contract.
     */
    address public eligibilityContract;

    /**
     * @notice When true, both the sender and recipient of every regular transfer
     *         must pass `isAllowed()`. Mint and burn endpoints (address(0)) are
     *         always exempt from this gate — minting has its own mandatory check
     *         regardless of this flag.
     */
    bool public transferGateEnabled;

    // -----------------------------------------------------------------------
    // Constructor
    // -----------------------------------------------------------------------

    /**
     * @param name_                 ERC-20 token name.
     * @param symbol_               ERC-20 token symbol.
     * @param _eligibilityContract  Permission Contract address. Resolve this
     *                              off-chain before deploying by calling
     *                              `getContractAddress("permission")` on the
     *                              Bootstrap Registry (0xDAFEA492...).
     */
    constructor(
        string memory name_,
        string memory symbol_,
        address _eligibilityContract
    ) ERC20(name_, symbol_) Ownable(msg.sender) {
        eligibilityContract = _eligibilityContract;
        transferGateEnabled = false;
    }

    // -----------------------------------------------------------------------
    // Mint
    // -----------------------------------------------------------------------

    /**
     * @notice Self-service mint: any caller may mint `amount` tokens to themselves,
     *         provided they hold on-chain KYC permission via IndividualOnboardingSDK.
     *         Reverts with `NotKYCVerified` if `msg.sender` has not completed KYC.
     *
     * @param amount Token amount to mint (in wei, i.e. 18-decimal units).
     */
    function mint(uint256 amount) external {
        if (!IPermissionContract(eligibilityContract).isAllowed(msg.sender)) {
            revert NotKYCVerified(msg.sender);
        }
        _mint(msg.sender, amount);
        emit TokensMinted(msg.sender, amount);
    }

    // -----------------------------------------------------------------------
    // Burn
    // -----------------------------------------------------------------------

    /**
     * @notice Burn `amount` tokens from the caller's own balance.
     *         No KYC check — callers are free to destroy their own tokens.
     *         The transfer gate is also bypassed for burns (to == address(0)
     *         is skipped in `_update`).
     *
     * @param amount Token amount to burn.
     */
    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }

    // -----------------------------------------------------------------------
    // Transfer hook — OZ v5.x uses _update (replaces _beforeTokenTransfer)
    // -----------------------------------------------------------------------

    /**
     * @dev OpenZeppelin v5 unified hook called for every mint, burn, and transfer.
     *      When `transferGateEnabled` is true, both `from` and `to` must hold
     *      on-chain permission for a regular transfer. Mint (from == address(0))
     *      and burn (to == address(0)) skip this gate — the `mint()` function
     *      already enforces an explicit KYC check before calling `_mint`.
     *
     *      Gas note: the check is exactly two sequential `isAllowed()` external
     *      calls with no loops or additional storage reads, keeping the overhead
     *      well under 50 000 gas per transfer.
     */
    function _update(address from, address to, uint256 value) internal override {
        if (transferGateEnabled && from != address(0) && to != address(0)) {
            if (!IPermissionContract(eligibilityContract).isAllowed(from)) {
                revert NotKYCVerified(from);
            }
            if (!IPermissionContract(eligibilityContract).isAllowed(to)) {
                revert NotKYCVerified(to);
            }
        }
        super._update(from, to, value);
    }

    // -----------------------------------------------------------------------
    // Admin functions
    // -----------------------------------------------------------------------

    /**
     * @notice Directly set the cached Permission Contract address.
     *         Use when you already know the new address; for automatic
     *         resolution use `refreshEligibilityContractFromRegistry()`.
     *
     * @param _newAddress New Permission Contract address.
     */
    function setEligibilityContract(address _newAddress) external onlyOwner {
        address old = eligibilityContract;
        eligibilityContract = _newAddress;
        emit EligibilityContractUpdated(old, _newAddress);
    }

    /**
     * @notice Toggle whether regular transfers require KYC verification.
     *         Minting always requires KYC regardless of this flag.
     *
     * @param _enabled True to enforce KYC on transfers, false to allow freely.
     */
    function setTransferGateEnabled(bool _enabled) external onlyOwner {
        transferGateEnabled = _enabled;
        emit TransferGateToggled(_enabled);
    }

    /**
     * @notice Re-resolve the Permission Contract address from the Bootstrap
     *         Registry and update the local cache. Call this whenever Redbelly
     *         upgrades their Permission Contract.
     *
     *         The Bootstrap Registry at 0xDAFEA492D9c6733ae3d56b7Ed1ADB60692c98Bc5
     *         is a fixed address on all Redbelly networks. Calling
     *         `getContractAddress("permission")` on it returns the chain-specific
     *         Permission Contract backing `isAllowed()`.
     *
     *         Only emits `EligibilityContractUpdated` if the address actually changed,
     *         making it safe to call defensively.
     */
    function refreshEligibilityContractFromRegistry() external onlyOwner {
        address newAddress = IBootstrapRegistry(_getBootstrapRegistryAddress())
            .getContractAddress("permission");

        address old = eligibilityContract;
        if (newAddress != old) {
            eligibilityContract = newAddress;
            emit EligibilityContractUpdated(old, newAddress);
        }
    }

    // -----------------------------------------------------------------------
    // Internal helpers
    // -----------------------------------------------------------------------

    /**
     * @dev Returns the Bootstrap Registry address used by
     *      `refreshEligibilityContractFromRegistry()`. Virtual so test harnesses
     *      can substitute a mock without forking Redbelly Testnet.
     *      Production deployments always use the hardcoded BOOTSTRAP_REGISTRY constant.
     */
    function _getBootstrapRegistryAddress() internal view virtual returns (address) {
        return BOOTSTRAP_REGISTRY;
    }
}
