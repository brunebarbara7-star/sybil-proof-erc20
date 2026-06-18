// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../SybilProofToken.sol";

/// @notice Test harness that overrides _getBootstrapRegistryAddress() so that
///         refreshEligibilityContractFromRegistry() can be tested locally without
///         a live Redbelly node. Production code always uses SybilProofToken directly.
contract SybilProofTokenHarness is SybilProofToken {
    address private immutable _testRegistry;

    constructor(
        string memory name_,
        string memory symbol_,
        address eligibilityContract_,
        address testRegistry_
    ) SybilProofToken(name_, symbol_, eligibilityContract_) {
        _testRegistry = testRegistry_;
    }

    function _getBootstrapRegistryAddress() internal view override returns (address) {
        return _testRegistry;
    }
}
