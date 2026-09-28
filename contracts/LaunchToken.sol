// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title LaunchToken
/// @notice Fixed-supply ERC-20 created by the launchpad. The factory chooses how the
///         supply is split between the creator and the opening pool.
contract LaunchToken is ERC20 {
    error InvalidSupply();

    constructor(
        string memory name_,
        string memory symbol_,
        uint256 creatorAmount,
        uint256 liquidityAmount,
        address creator,
        address launchpad
    ) ERC20(name_, symbol_) {
        if (creatorAmount == 0 || liquidityAmount == 0 || creator == address(0) || launchpad == address(0)) {
            revert InvalidSupply();
        }
        _mint(creator, creatorAmount);
        _mint(launchpad, liquidityAmount);
    }
}
