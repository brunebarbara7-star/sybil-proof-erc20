// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Test double for the Redbelly Bootstrap Registry.
///         Maps contract name strings to addresses that tests can control via setContractAddress().
contract MockBootstrapRegistry {
    mapping(string => address) private _contracts;

    function getContractAddress(string memory contractName) external view returns (address) {
        return _contracts[contractName];
    }

    function setContractAddress(string memory name, address addr) external {
        _contracts[name] = addr;
    }
}
