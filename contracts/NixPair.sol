// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title NixPair
/// @notice Public NIX/token reserves used for AMM pricing and settlement.
/// @dev Reserves and the spot price are public. Traders encrypt the order size and the
///      minimum received amount, and IntentRegistry reveals them only when the solver fills.
contract NixPair {
    using SafeERC20 for IERC20;

    uint256 public constant PRICE_SCALE = 1e18;
    uint256 public constant MARK_WINDOW = 1 days;

    IERC20 public immutable nix;
    IERC20 public immutable token;

    uint256 public reserveNix;
    uint256 public reserveToken;
    uint256 public totalLiquidity;
    mapping(address provider => uint256 shares) public liquidityOf;

    /// @notice NIX per token, scaled by 1e18. Zero before the first deposit.
    uint256 public priceX18;
    uint256 public previousPriceX18;
    uint256 public launchPriceX18;
    /// @notice Price checkpoint used for the 24h move. It rolls forward on the first
    ///         liquidity change after MARK_WINDOW.
    uint256 public markPriceX18;
    uint256 public markTimestamp;
    uint256 public volumeNix;
    uint256 public volumeWindowNix;
    uint256 public volumeWindowStart;

    event LiquidityAdded(
        address indexed provider,
        uint256 nixAmount,
        uint256 tokenAmount,
        uint256 shares,
        uint256 priceX18
    );
    event LiquidityRemoved(
        address indexed provider,
        uint256 nixAmount,
        uint256 tokenAmount,
        uint256 shares,
        uint256 priceX18
    );
    event Swap(
        address indexed sender,
        address indexed recipient,
        address indexed tokenIn,
        uint256 amountIn,
        uint256 amountOut,
        uint256 priceX18
    );

    error ZeroAmount();
    error UnknownToken(address token);
    error InsufficientOutput(uint256 output, uint256 minimum);
    error InsufficientShares(uint256 requested, uint256 available);

    constructor(IERC20 nix_, IERC20 token_) {
        nix = nix_;
        token = token_;
        volumeWindowStart = block.timestamp;
    }

    /// @notice Adds both assets at the current ratio. The first deposit sets the price.
    ///         Later deposits pull only the amounts that preserve the reserve ratio.
    function addLiquidity(uint256 nixAmount, uint256 tokenAmount) external returns (uint256 shares) {
        (nixAmount, tokenAmount, shares) = _quoted(nixAmount, tokenAmount);
        nix.safeTransferFrom(msg.sender, address(this), nixAmount);
        token.safeTransferFrom(msg.sender, address(this), tokenAmount);

        reserveNix += nixAmount;
        reserveToken += tokenAmount;
        totalLiquidity += shares;
        liquidityOf[msg.sender] += shares;
        _updateMark(nixAmount);

        emit LiquidityAdded(msg.sender, nixAmount, tokenAmount, shares, priceX18);
    }

    /// @notice Burns the caller's public liquidity shares and returns both assets pro rata.
    function removeLiquidity(uint256 shares) external returns (uint256 nixOut, uint256 tokenOut) {
        uint256 owned = liquidityOf[msg.sender];
        if (shares == 0 || shares > owned) revert InsufficientShares(shares, owned);

        nixOut = shares * reserveNix / totalLiquidity;
        tokenOut = shares * reserveToken / totalLiquidity;
        if (nixOut == 0 || tokenOut == 0) revert ZeroAmount();

        liquidityOf[msg.sender] = owned - shares;
        totalLiquidity -= shares;
        reserveNix -= nixOut;
        reserveToken -= tokenOut;
        _updateMark(0);

        nix.safeTransfer(msg.sender, nixOut);
        token.safeTransfer(msg.sender, tokenOut);

        emit LiquidityRemoved(msg.sender, nixOut, tokenOut, shares, priceX18);
    }

    /// @notice Constant-product output for selling `amountIn` of `tokenIn`.
    function quoteSwap(address tokenIn, uint256 amountIn) external view returns (uint256 amountOut) {
        return _swapped(tokenIn, amountIn);
    }

    /// @notice Sells `tokenIn` for the other reserve asset and pays `recipient`.
    ///         `minOut` is enforced against the public reserves at execution.
    function swap(address tokenIn, uint256 amountIn, uint256 minOut, address recipient)
        external
        returns (uint256 amountOut)
    {
        if (recipient == address(0)) revert ZeroAmount();
        amountOut = _swapped(tokenIn, amountIn);
        if (amountOut < minOut) revert InsufficientOutput(amountOut, minOut);

        IERC20 input = IERC20(tokenIn);
        bool nixIn = tokenIn == address(nix);
        IERC20 output = nixIn ? token : nix;
        input.safeTransferFrom(msg.sender, address(this), amountIn);
        if (nixIn) {
            reserveNix += amountIn;
            reserveToken -= amountOut;
        } else {
            reserveToken += amountIn;
            reserveNix -= amountOut;
        }
        _updateMark(nixIn ? amountIn : amountOut);
        output.safeTransfer(recipient, amountOut);

        emit Swap(msg.sender, recipient, tokenIn, amountIn, amountOut, priceX18);
    }

    /// @notice Preview of `addLiquidity` using the public reserves. Deposit amounts are public.
    function quoteAdd(uint256 nixAmount, uint256 tokenAmount)
        external
        view
        returns (uint256 nixUsed, uint256 tokenUsed, uint256 shares)
    {
        return _quoted(nixAmount, tokenAmount);
    }

    function _quoted(uint256 nixAmount, uint256 tokenAmount)
        internal
        view
        returns (uint256 nixUsed, uint256 tokenUsed, uint256 shares)
    {
        if (nixAmount == 0 || tokenAmount == 0) revert ZeroAmount();
        if (totalLiquidity == 0) {
            shares = Math.sqrt(nixAmount * tokenAmount);
            if (shares == 0) revert ZeroAmount();
            return (nixAmount, tokenAmount, shares);
        }

        uint256 nixShares = nixAmount * totalLiquidity / reserveNix;
        uint256 tokenShares = tokenAmount * totalLiquidity / reserveToken;
        shares = nixShares < tokenShares ? nixShares : tokenShares;
        if (shares == 0) revert ZeroAmount();
        nixUsed = shares * reserveNix / totalLiquidity;
        tokenUsed = shares * reserveToken / totalLiquidity;
        if (nixUsed == 0 || tokenUsed == 0) revert ZeroAmount();
    }

    function _swapped(address tokenIn, uint256 amountIn) internal view returns (uint256 amountOut) {
        bool nixIn = tokenIn == address(nix);
        if (!nixIn && tokenIn != address(token)) revert UnknownToken(tokenIn);
        uint256 reserveIn = nixIn ? reserveNix : reserveToken;
        uint256 reserveOut = nixIn ? reserveToken : reserveNix;
        if (amountIn == 0 || reserveIn == 0 || reserveOut == 0) revert ZeroAmount();
        amountOut = reserveOut * amountIn / (reserveIn + amountIn);
        if (amountOut == 0) revert ZeroAmount();
    }

    function _updateMark(uint256 nixVolume) internal {
        if (block.timestamp >= volumeWindowStart + MARK_WINDOW) {
            volumeWindowNix = 0;
            volumeWindowStart = block.timestamp;
            if (priceX18 != 0) markPriceX18 = priceX18;
            markTimestamp = block.timestamp;
        }

        uint256 next = reserveToken == 0 ? 0 : reserveNix * PRICE_SCALE / reserveToken;
        if (launchPriceX18 == 0 && next != 0) {
            launchPriceX18 = next;
            markPriceX18 = next;
            markTimestamp = block.timestamp;
        }
        previousPriceX18 = priceX18 == 0 ? next : priceX18;
        priceX18 = next;
        volumeNix += nixVolume;
        volumeWindowNix += nixVolume;
    }
}
