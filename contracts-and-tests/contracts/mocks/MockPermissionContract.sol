// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Test double for the Redbelly Permission Contract.
///         Stores a per-address allowed flag that tests can flip via setAllowed().
contract MockPermissionContract {
    mapping(address => bool) private _allowed;

    function isAllowed(address _address) external view returns (bool) {
        return _allowed[_address];
    }

    function setAllowed(address user, bool allowed) external {
        _allowed[user] = allowed;
    }
}
