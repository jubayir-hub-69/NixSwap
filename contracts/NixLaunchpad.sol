// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {LaunchToken} from "./LaunchToken.sol";
import {NixPair} from "./NixPair.sol";

/// @title NixLaunchpad
/// @notice Anyone can deploy one active fixed-supply token and its public NIX pair.
///         Retiring the active token frees the wallet to create another. Every launch
///         stays in the public list.
contract NixLaunchpad {
    uint256 public constant MAX_SUPPLY = 1_000_000_000_000 ether;

    IERC20 public immutable nix;

    struct TokenLaunch {
        address token;
        address pair;
        address creator;
        string name;
        string symbol;
        uint256 supply;
        uint64 createdAt;
        bool active;
    }

    TokenLaunch[] private _tokens;
    /// @dev One-based index of the creator's active launch. Zero means none.
    mapping(address creator => uint256 indexPlusOne) private _activeId;

    event TokenLaunched(uint256 indexed id, address indexed creator, address token, address pair);
    event TokenRetired(uint256 indexed id, address indexed creator);

    error InvalidName();
    error InvalidSymbol();
    error InvalidSupply();
    error ActiveTokenExists(uint256 id);
    error NotCreator(address creator);
    error AlreadyRetired(uint256 id);
    error UnknownToken(uint256 id);

    constructor(IERC20 nix_) {
        nix = nix_;
    }

    function tokenCount() external view returns (uint256) {
        return _tokens.length;
    }

    function allTokens() external view returns (TokenLaunch[] memory) {
        return _tokens;
    }

    function tokenInfo(uint256 id) external view returns (TokenLaunch memory) {
        if (id >= _tokens.length) revert UnknownToken(id);
        return _tokens[id];
    }

    /// @notice The creator's current active launch, if they still have one.
    function activeLaunchOf(address creator) external view returns (bool active, uint256 id) {
        uint256 pointer = _activeId[creator];
        if (pointer == 0) return (false, 0);
        id = pointer - 1;
        active = _tokens[id].active;
    }

    /// @notice Deploys a fixed-supply token to the caller and a public NIX pair.
    ///         Reverts while the caller already has an active launch.
    function createToken(string calldata name_, string calldata symbol_, uint256 supply)
        external
        returns (uint256 id, address token, address pair)
    {
        uint256 nameLength = bytes(name_).length;
        uint256 symbolLength = bytes(symbol_).length;
        if (nameLength == 0 || nameLength > 32) revert InvalidName();
        if (symbolLength == 0 || symbolLength > 11) revert InvalidSymbol();
        if (supply == 0 || supply > MAX_SUPPLY) revert InvalidSupply();

        uint256 pointer = _activeId[msg.sender];
        if (pointer != 0 && _tokens[pointer - 1].active) revert ActiveTokenExists(pointer - 1);

        LaunchToken created = new LaunchToken(name_, symbol_, supply, msg.sender);
        NixPair createdPair = new NixPair(nix, IERC20(address(created)));

        id = _tokens.length;
        _tokens.push(
            TokenLaunch({
                token: address(created),
                pair: address(createdPair),
                creator: msg.sender,
                name: name_,
                symbol: symbol_,
                supply: supply,
                createdAt: uint64(block.timestamp),
                active: true
            })
        );
        _activeId[msg.sender] = id + 1;

        token = address(created);
        pair = address(createdPair);
        emit TokenLaunched(id, msg.sender, token, pair);
    }

    /// @notice Closes the caller's active launch so they can create a different token.
    ///         The token and its pair remain in the public list.
    function retire(uint256 id) external {
        if (id >= _tokens.length) revert UnknownToken(id);
        TokenLaunch storage launch = _tokens[id];
        if (launch.creator != msg.sender) revert NotCreator(launch.creator);
        if (!launch.active) revert AlreadyRetired(id);
        launch.active = false;
        if (_activeId[msg.sender] == id + 1) _activeId[msg.sender] = 0;
        emit TokenRetired(id, msg.sender);
    }
}
