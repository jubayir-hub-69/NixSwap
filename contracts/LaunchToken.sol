// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title LaunchToken
/// @notice Fixed-supply ERC-20 created by the launchpad. Supply, name, and symbol are public.
contract LaunchToken is ERC20 {
    error InvalidSupply();

    constructor(string memory name_, string memory symbol_, uint256 supply, address owner) ERC20(name_, symbol_) {
        if (supply == 0 || owner == address(0)) revert InvalidSupply();
        _mint(owner, supply);
    }
}
