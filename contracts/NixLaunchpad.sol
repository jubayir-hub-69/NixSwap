// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {LaunchToken} from "./LaunchToken.sol";
import {NixPair} from "./NixPair.sol";

/// @title NixLaunchpad
/// @notice Anyone can deploy one active fixed-supply token and its public NIX pair.
///         Creating a token also seeds the pair: 2% of supply is paired with `SEED_NIX`
///         held by this contract, and the other 98% is minted to the creator.
///         The opening liquidity shares stay on this contract, so that seed cannot be pulled.
///         Retiring the active token frees the wallet to create another. Every launch
///         stays in the public list.
contract NixLaunchpad {
    using SafeERC20 for IERC20;

    uint256 public constant MAX_SUPPLY = 1_000_000_000_000 ether;
    uint256 public constant BPS_DENOMINATOR = 10_000;
    /// @dev 200 bps is 2% of the requested supply.
    uint256 public constant LIQUIDITY_BPS = 200;
    /// @dev NIX paired with the 2% token reserve. Funded ahead of launches via `fundSeed`.
    uint256 public constant SEED_NIX = 100 ether;

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
    event LaunchSeeded(
        uint256 indexed id,
        uint256 creatorAmount,
        uint256 liquidityTokens,
        uint256 seedNix,
        uint256 priceX18
    );
    event SeedFunded(address indexed funder, uint256 amount);
    event TokenRetired(uint256 indexed id, address indexed creator);

    error InvalidName();
    error InvalidSymbol();
    error InvalidSupply();
    error ActiveTokenExists(uint256 id);
    error NotCreator(address creator);
    error AlreadyRetired(uint256 id);
    error UnknownToken(uint256 id);
    error ZeroSeed();
    error InsufficientSeed(uint256 available, uint256 required);

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

    /// @notice NIX currently available for opening pools, and how many launches it covers.
    function seedCapacity() external view returns (uint256 seedNix, uint256 available, uint256 launchesRemaining) {
        seedNix = SEED_NIX;
        available = nix.balanceOf(address(this));
        launchesRemaining = available / SEED_NIX;
    }

    /// @notice Adds NIX that future launches use as the opening pool's base reserve.
    function fundSeed(uint256 amount) external {
        if (amount == 0) revert ZeroSeed();
        nix.safeTransferFrom(msg.sender, address(this), amount);
        emit SeedFunded(msg.sender, amount);
    }

    /// @notice The creator's current active launch, if they still have one.
    function activeLaunchOf(address creator) external view returns (bool active, uint256 id) {
        uint256 pointer = _activeId[creator];
        if (pointer == 0) return (false, 0);
        id = pointer - 1;
        active = _tokens[id].active;
    }

    /// @notice Deploys a fixed-supply token, mints 98% to the caller, and seeds its NIX pair
    ///         with the other 2% plus `SEED_NIX`. One transaction. Reverts while the caller
    ///         already has an active launch, or while this contract holds less than `SEED_NIX`.
    function createToken(string calldata name_, string calldata symbol_, uint256 supply)
        external
        returns (uint256 id, address token, address pair)
    {
        _checkLaunch(name_, symbol_, supply);
        (uint256 creatorAmount, uint256 liquidityTokens) = _split(supply);
        LaunchToken created = new LaunchToken(
            name_,
            symbol_,
            creatorAmount,
            liquidityTokens,
            msg.sender,
            address(this)
        );
        NixPair createdPair = new NixPair(nix, IERC20(address(created)));
        id = _record(address(created), address(createdPair), name_, symbol_, supply);
        _seed(created, createdPair, liquidityTokens);
        token = address(created);
        pair = address(createdPair);
        emit TokenLaunched(id, msg.sender, token, pair);
        emit LaunchSeeded(id, creatorAmount, liquidityTokens, SEED_NIX, createdPair.priceX18());
    }

    function _checkLaunch(string calldata name_, string calldata symbol_, uint256 supply) internal view {
        uint256 nameLength = bytes(name_).length;
        uint256 symbolLength = bytes(symbol_).length;
        if (nameLength == 0 || nameLength > 32) revert InvalidName();
        if (symbolLength == 0 || symbolLength > 11) revert InvalidSymbol();
        if (supply == 0 || supply > MAX_SUPPLY) revert InvalidSupply();
        uint256 available = nix.balanceOf(address(this));
        if (available < SEED_NIX) revert InsufficientSeed(available, SEED_NIX);
        uint256 pointer = _activeId[msg.sender];
        if (pointer != 0 && _tokens[pointer - 1].active) revert ActiveTokenExists(pointer - 1);
    }

    function _split(uint256 supply) internal pure returns (uint256 creatorAmount, uint256 liquidityTokens) {
        liquidityTokens = supply * LIQUIDITY_BPS / BPS_DENOMINATOR;
        creatorAmount = supply - liquidityTokens;
        if (liquidityTokens == 0 || creatorAmount == 0) revert InvalidSupply();
    }

    function _record(
        address token,
        address pair,
        string calldata name_,
        string calldata symbol_,
        uint256 supply
    ) internal returns (uint256 id) {
        id = _tokens.length;
        _tokens.push(
            TokenLaunch({
                token: token,
                pair: pair,
                creator: msg.sender,
                name: name_,
                symbol: symbol_,
                supply: supply,
                createdAt: uint64(block.timestamp),
                active: true
            })
        );
        _activeId[msg.sender] = id + 1;
    }

    function _seed(LaunchToken created, NixPair createdPair, uint256 liquidityTokens) internal {
        IERC20(address(created)).forceApprove(address(createdPair), liquidityTokens);
        nix.forceApprove(address(createdPair), SEED_NIX);
        createdPair.addLiquidity(SEED_NIX, liquidityTokens);
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
