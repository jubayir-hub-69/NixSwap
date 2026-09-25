// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {FHE, ebool, euint64, externalEuint64} from "@fhenixprotocol/cofhe-contracts/FHE.sol";

/// @title NixPool
/// @notice Liquidity pool with a public reserve and encrypted per-provider shares.
/// @dev `totalReserve` is plaintext so anyone can check solvency. Each provider's
///      share balance is an `euint64` updated only with `FHE.add` and `FHE.sub`.
///      Shares use 6 decimals. `shareRate` converts them to the asset's base units.
///      A withdrawal amount is not plaintext in `withdrawLiquidity`. The public
///      reserve drops in `claimLiquidity`, after the burned share count is proven.
contract NixPool {
    using SafeERC20 for IERC20;

    uint8 public constant SHARE_DECIMALS = 6;

    IERC20 public immutable asset;
    uint256 public immutable shareRate;

    /// @notice Tokens held for liquidity providers. Visible so solvency can be checked.
    uint256 public totalReserve;

    struct Withdrawal {
        bytes32 claimId;
        address provider;
        bytes32 ctHash;
        bool claimed;
    }

    mapping(address provider => euint64 shares) private _shares;
    mapping(bytes32 claimId => Withdrawal withdrawal) private _withdrawals;
    mapping(address provider => bytes32[] claimIds) private _providerClaims;
    mapping(address provider => uint256 nonce) private _withdrawNonces;

    event LiquidityDeposited(address indexed provider, euint64 shares);
    event LiquidityWithdrawn(address indexed provider, bytes32 indexed claimId, euint64 burnedShares);
    event LiquidityClaimed(address indexed provider, bytes32 indexed claimId, euint64 burnedShares);

    error AmountTooSmallForSharePrecision();
    error UnauthorizedEncryptedAmount(euint64 value, address user);
    error ClaimNotFound(bytes32 claimId);
    error AlreadyClaimed(bytes32 claimId);
    error InvalidDecryptionProof(bytes32 ctHash);
    error InsufficientReserve(uint256 requested, uint256 available);

    constructor(IERC20 asset_) {
        asset = asset_;
        uint8 assetDecimals = _tryDecimals(address(asset_));
        shareRate = assetDecimals > SHARE_DECIMALS ? 10 ** (assetDecimals - SHARE_DECIMALS) : 1;
    }

    /// @notice Ciphertext handle for `provider`. Zero means they have never deposited.
    function liquidityOf(address provider) external view returns (euint64) {
        return _shares[provider];
    }

    /// @notice True when `account` is allowed to decrypt that provider's share handle.
    function isShareReadableBy(address provider, address account) external view returns (bool) {
        euint64 shares = _shares[provider];
        if (!FHE.isInitialized(shares)) return false;
        return FHE.isAllowed(shares, account);
    }

    /// @notice Pulls plaintext tokens, adds them to the public reserve, and mints encrypted shares.
    function depositLiquidity(uint256 amount) external {
        uint256 locked = amount - (amount % shareRate);
        if (locked == 0) revert AmountTooSmallForSharePrecision();

        uint64 minted = SafeCast.toUint64(locked / shareRate);
        asset.safeTransferFrom(msg.sender, address(this), locked);
        totalReserve += locked;

        euint64 mintedShares = FHE.asEuint64(minted);
        euint64 updated = FHE.add(_orZero(_shares[msg.sender]), mintedShares);
        _setShares(msg.sender, updated);

        emit LiquidityDeposited(msg.sender, updated);
    }

    /// @notice Burns up to `encryptedShares` from the caller using encrypted math.
    ///         The burned count stays a ciphertext. `claimLiquidity` returns the tokens.
    function withdrawLiquidity(externalEuint64 encryptedShares, bytes calldata inputProof)
        external
        returns (euint64 burned)
    {
        // The batch proof is verified against msg.sender inside `FHE.asEuint64`.
        return _withdraw(FHE.asEuint64(encryptedShares, inputProof));
    }

    /// @notice Contract-to-contract withdrawal. `shares` must already be granted to the caller.
    function withdrawLiquidity(euint64 shares) external returns (euint64 burned) {
        if (!FHE.isAllowed(shares, msg.sender)) revert UnauthorizedEncryptedAmount(shares, msg.sender);
        return _withdraw(shares);
    }

    /// @notice Proves the burned share count, then deducts that value from the public reserve
    ///         and returns the underlying tokens to the provider who withdrew.
    function claimLiquidity(bytes32 claimId, uint64 decryptedShares, bytes calldata decryptionProof) external {
        Withdrawal storage withdrawal = _withdrawals[claimId];
        if (withdrawal.provider == address(0)) revert ClaimNotFound(claimId);
        if (withdrawal.claimed) revert AlreadyClaimed(claimId);

        euint64 burned = FHE.wrapEuint64(withdrawal.ctHash);
        if (!FHE.verifyDecryptResult(burned, decryptedShares, decryptionProof)) {
            revert InvalidDecryptionProof(withdrawal.ctHash);
        }
        FHE.publishDecryptResult(burned, decryptedShares, decryptionProof);

        withdrawal.claimed = true;

        uint256 tokens = uint256(decryptedShares) * shareRate;
        if (tokens > totalReserve) revert InsufficientReserve(tokens, totalReserve);
        totalReserve -= tokens;
        if (tokens != 0) asset.safeTransfer(withdrawal.provider, tokens);

        emit LiquidityClaimed(withdrawal.provider, claimId, burned);
    }

    function getWithdrawal(bytes32 claimId) external view returns (Withdrawal memory) {
        Withdrawal memory withdrawal = _withdrawals[claimId];
        if (withdrawal.provider == address(0)) revert ClaimNotFound(claimId);
        return withdrawal;
    }

    /// @notice Unclaimed withdrawals for `provider`.
    function pendingWithdrawals(address provider) external view returns (Withdrawal[] memory) {
        bytes32[] storage ids = _providerClaims[provider];
        uint256 pending;
        uint256 length = ids.length;
        for (uint256 i = 0; i < length; ++i) {
            if (!_withdrawals[ids[i]].claimed) ++pending;
        }

        Withdrawal[] memory withdrawals = new Withdrawal[](pending);
        uint256 written;
        for (uint256 i = 0; i < length; ++i) {
            Withdrawal storage stored = _withdrawals[ids[i]];
            if (!stored.claimed) withdrawals[written++] = stored;
        }
        return withdrawals;
    }

    function _withdraw(euint64 shares) internal returns (euint64 burned) {
        burned = _debit(msg.sender, shares);
        FHE.allowThis(burned);
        FHE.allow(burned, msg.sender);

        bytes32 ctHash = euint64.unwrap(burned);
        uint256 nonce = _withdrawNonces[msg.sender]++;
        bytes32 claimId = keccak256(abi.encode(msg.sender, nonce, ctHash));
        _withdrawals[claimId] = Withdrawal({
            claimId: claimId,
            provider: msg.sender,
            ctHash: ctHash,
            claimed: false
        });
        _providerClaims[msg.sender].push(claimId);

        emit LiquidityWithdrawn(msg.sender, claimId, burned);
    }

    /// @dev Subtracts `amount`, or encrypted zero when the balance is smaller.
    function _debit(address provider, euint64 amount) internal returns (euint64 burned) {
        euint64 balance = _orZero(_shares[provider]);
        ebool enough = FHE.gte(balance, amount);
        burned = FHE.select(enough, amount, FHE.asEuint64(uint256(0)));
        _setShares(provider, FHE.sub(balance, burned));
    }

    function _setShares(address provider, euint64 updated) internal {
        FHE.allowThis(updated);
        FHE.allow(updated, provider);
        _shares[provider] = updated;
    }

    function _orZero(euint64 value) internal returns (euint64) {
        if (FHE.isInitialized(value)) return value;
        return FHE.asEuint64(uint256(0));
    }

    function _tryDecimals(address token) private view returns (uint8) {
        try IERC20Metadata(token).decimals() returns (uint8 assetDecimals) {
            return assetDecimals;
        } catch {
            return 18;
        }
    }
}
