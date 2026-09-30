// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {LaunchToken} from "./LaunchToken.sol";
import {NixPair} from "./NixPair.sol";

/// @title LaunchFactory
/// @notice Deploys launch tokens and pairs for one launchpad. The token bytecode lives here so
///         the launchpad stays within the contract size limit. Remote addresses are CREATE2.
contract LaunchFactory {
    address public launchpad;

    error OnlyLaunchpad(address caller);
    error LaunchpadAlreadySet();
    error InvalidLaunchpad();

    function setLaunchpad(address launchpad_) external {
        if (launchpad != address(0)) revert LaunchpadAlreadySet();
        if (launchpad_.code.length == 0) revert InvalidLaunchpad();
        launchpad = launchpad_;
    }

    function deployToken(
        string memory name_,
        string memory symbol_,
        uint256 creatorAmount,
        uint256 liquidityAmount,
        address creator,
        address endpoint,
        uint32 localEid
    ) external returns (address) {
        _onlyLaunchpad();
        return address(
            new LaunchToken(name_, symbol_, creatorAmount, liquidityAmount, creator, launchpad, endpoint, localEid)
        );
    }

    function deployRemoteToken(
        bytes32 salt,
        string memory name_,
        string memory symbol_,
        uint256 liquidityAmount,
        address endpoint,
        uint32 localEid
    ) external returns (address) {
        _onlyLaunchpad();
        return address(
            new LaunchToken{salt: salt}(name_, symbol_, 0, liquidityAmount, address(0), launchpad, endpoint, localEid)
        );
    }

    /// @notice CREATE2 address of a remote token. `deployer` is that chain's factory.
    function predictRemoteToken(
        address deployer,
        bytes32 salt,
        string memory name_,
        string memory symbol_,
        uint256 liquidityAmount,
        address remoteLaunchpad,
        address endpoint,
        uint32 localEid
    ) external pure returns (address) {
        bytes memory bytecode = abi.encodePacked(
            type(LaunchToken).creationCode,
            abi.encode(name_, symbol_, uint256(0), liquidityAmount, address(0), remoteLaunchpad, endpoint, localEid)
        );
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), deployer, salt, keccak256(bytecode))))));
    }

    function deployPair(IERC20 nix, IERC20 token) external returns (address) {
        _onlyLaunchpad();
        return address(new NixPair(nix, token));
    }

    function _onlyLaunchpad() internal view {
        if (msg.sender != launchpad) revert OnlyLaunchpad(msg.sender);
    }
}
