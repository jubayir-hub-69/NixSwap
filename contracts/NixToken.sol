// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Nonces} from "@openzeppelin/contracts/utils/Nonces.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {
    FHE,
    ebool,
    euint64,
    externalEuint64
} from "@fhenixprotocol/cofhe-contracts/FHE.sol";

/// @title NixToken
/// @notice Dual-mode token: a public OpenZeppelin ERC-20 balance plus an FHERC20-style
///         confidential balance stored as `euint64`. Public tokens move into
///         `CONFIDENTIAL_POOL` on shield and back out on a verified unshield claim.
/// @dev Confidential amounts are ciphertext handles. Insufficient confidential
///      spends move encrypted zero instead of reverting, so a revert cannot reveal
///      whether a balance was large enough. Viewing a private balance requires an
///      onchain ACL grant (via this contract) and an offchain CoFHE ACP signature.
contract NixToken is ERC20, Ownable, EIP712, Nonces {
    /// @notice Custodies the public tokens that back every confidential balance.
    address public constant CONFIDENTIAL_POOL = address(0x1011000000000000000000000000000000000000);

    /// @notice Confidential balances use 6 decimals. `euint64` cannot safely track 18.
    uint8 public constant CONFIDENTIAL_DECIMALS = 6;

    /// @notice Public base units represented by one confidential unit (1e12 for 18/6).
    uint256 public constant CONVERSION_RATE = 10 ** (18 - CONFIDENTIAL_DECIMALS);

    /// @dev Binds a signature to the holder's current ciphertext, not to a plaintext amount.
    bytes32 private constant BALANCE_VIEW_PERMIT_TYPEHASH = keccak256(
        "BalanceViewPermit(address holder,address viewer,bytes32 balanceHandle,uint256 nonce,uint256 deadline)"
    );

    /// @notice One pending or settled unshield. `decryptedAmount` stays 0 until claim.
    struct Claim {
        bytes32 claimId;
        address to;
        bytes32 ctHash;
        uint64 decryptedAmount;
        bool claimed;
    }

    mapping(address account => euint64 balance) private _confidentialBalances;
    mapping(bytes32 claimId => Claim claim) private _claims;
    mapping(address account => bytes32[] claimIds) private _userClaimIds;
    mapping(address account => uint256 nonce) private _unshieldNonces;

    /// @dev Set only around the internal pool transfer so users cannot move the backing directly.
    uint256 private _poolMove;

    event TokensShielded(address indexed account, uint256 amount);
    event TokensUnshielded(address indexed account, bytes32 indexed claimId, euint64 amount);
    event UnshieldedTokensClaimed(address indexed account, bytes32 indexed claimId, euint64 amount);
    event ConfidentialTransfer(address indexed from, address indexed to, euint64 amount);
    event BalanceViewPermitUsed(address indexed holder, address indexed viewer, bytes32 balanceHandle);

    error AmountTooSmallForConfidentialPrecision();
    error UnauthorizedEncryptedAmount(euint64 value, address user);
    error ClaimNotFound(bytes32 claimId);
    error AlreadyClaimed(bytes32 claimId);
    error InvalidDecryptionProof(bytes32 ctHash);
    error PoolIsNotDirectlyTransferable();
    error PermitExpired(uint256 deadline);
    error InvalidViewer();
    error InvalidPermitSignature();
    error NoConfidentialBalance(address holder);
    error BalanceHandleMismatch(bytes32 currentHandle, bytes32 signedHandle);

    constructor(string memory name_, string memory symbol_, address initialOwner)
        ERC20(name_, symbol_)
        Ownable(initialOwner)
        EIP712(name_, "1")
    {}

    /// @notice Mints public ERC-20 units. Holders shield them to open a confidential balance.
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    function confidentialDecimals() external pure returns (uint8) {
        return CONFIDENTIAL_DECIMALS;
    }

    /// @notice Ciphertext handle for `account`. Zero means the account has never held a confidential balance.
    ///         Decrypt it offchain with a CoFHE ACP after the holder has been granted ACL access.
    function confidentialBalanceOf(address account) external view returns (euint64) {
        return _confidentialBalances[account];
    }

    /// @notice Public aggregate of confidential units, equal to the pool balance divided by the rate.
    function confidentialTotalSupply() external view returns (uint256) {
        return balanceOf(CONFIDENTIAL_POOL) / CONVERSION_RATE;
    }

    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    /// @notice EIP-712 digest a holder signs to let `viewer` decrypt the holder's current confidential balance.
    function balanceViewPermitHash(
        address holder,
        address viewer,
        bytes32 balanceHandle,
        uint256 nonce,
        uint256 deadline
    ) external view returns (bytes32) {
        return _hashBalanceViewPermit(holder, viewer, balanceHandle, nonce, deadline);
    }

    /// @notice Moves public tokens into the pool and credits the same value as an encrypted balance.
    ///         Dust below one confidential unit stays public. The public amount is visible; the
    ///         resulting balance is stored only as an `euint64` handle.
    function shield(uint256 amount) external {
        uint256 amountToShield = amount - (amount % CONVERSION_RATE);
        if (amountToShield == 0) revert AmountTooSmallForConfidentialPrecision();

        uint64 confidentialUnits = SafeCast.toUint64(amountToShield / CONVERSION_RATE);

        _movePool(msg.sender, CONFIDENTIAL_POOL, amountToShield);
        _credit(msg.sender, FHE.asEuint64(confidentialUnits));

        emit TokensShielded(msg.sender, amountToShield);
    }

    /// @notice Burns up to `encryptedAmount` from the caller's confidential balance and opens a claim.
    ///         The amount stays encrypted. `claimUnshielded` is what releases public tokens.
    function unshield(externalEuint64 encryptedAmount, bytes calldata inputProof) external returns (euint64 burned) {
        euint64 amount = FHE.asEuint64(encryptedAmount, inputProof);
        return _unshield(amount);
    }

    /// @notice Contract-to-contract unshield. `amount` must already be ACL-granted to the caller.
    function unshield(euint64 amount) external returns (euint64 burned) {
        if (!FHE.isAllowed(amount, msg.sender)) revert UnauthorizedEncryptedAmount(amount, msg.sender);
        return _unshield(amount);
    }

    /// @notice Verifies a Teecryptor decryption of a burned confidential amount and pays the public tokens.
    function claimUnshielded(bytes32 claimId, uint64 decryptedAmount, bytes calldata decryptionProof) external {
        Claim storage claim = _claims[claimId];
        if (claim.to == address(0)) revert ClaimNotFound(claimId);
        if (claim.claimed) revert AlreadyClaimed(claimId);

        euint64 burned = FHE.wrapEuint64(claim.ctHash);
        if (!FHE.verifyDecryptResult(burned, decryptedAmount, decryptionProof)) {
            revert InvalidDecryptionProof(claim.ctHash);
        }
        FHE.publishDecryptResult(burned, decryptedAmount, decryptionProof);

        claim.claimed = true;
        claim.decryptedAmount = decryptedAmount;

        uint256 amountPublic = uint256(decryptedAmount) * CONVERSION_RATE;
        if (amountPublic != 0) {
            _movePool(CONFIDENTIAL_POOL, claim.to, amountPublic);
        }

        emit UnshieldedTokensClaimed(claim.to, claimId, burned);
    }

    /// @notice Confidential transfer of an encrypted user input. The plaintext amount is not an argument.
    function confidentialTransfer(address to, externalEuint64 encryptedAmount, bytes calldata inputProof)
        external
        returns (euint64 transferred)
    {
        euint64 amount = FHE.asEuint64(encryptedAmount, inputProof);
        return _confidentialTransfer(msg.sender, to, amount);
    }

    /// @notice Confidential transfer of an existing ciphertext the caller is allowed to use.
    function confidentialTransfer(address to, euint64 amount) external returns (euint64 transferred) {
        if (!FHE.isAllowed(amount, msg.sender)) revert UnauthorizedEncryptedAmount(amount, msg.sender);
        return _confidentialTransfer(msg.sender, to, amount);
    }

    /// @notice Accepts a holder's EIP-712 signature and grants `viewer` ACL access to that balance handle.
    ///         The viewer still decrypts offchain with a CoFHE ACP (`decryptForView`). The permit never
    ///         contains or reveals the plaintext balance.
    function permitBalanceView(
        address holder,
        address viewer,
        bytes32 balanceHandle,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external returns (euint64 balance) {
        if (block.timestamp > deadline) revert PermitExpired(deadline);
        if (viewer == address(0)) revert InvalidViewer();

        balance = _confidentialBalances[holder];
        bytes32 currentHandle = euint64.unwrap(balance);
        if (currentHandle == bytes32(0)) revert NoConfidentialBalance(holder);
        if (currentHandle != balanceHandle) revert BalanceHandleMismatch(currentHandle, balanceHandle);

        bytes32 digest = _hashBalanceViewPermit(holder, viewer, balanceHandle, _useNonce(holder), deadline);
        address signer = ECDSA.recover(digest, v, r, s);
        if (signer != holder) revert InvalidPermitSignature();

        FHE.allowThis(balance);
        FHE.allow(balance, viewer);

        emit BalanceViewPermitUsed(holder, viewer, balanceHandle);
    }

    function getClaim(bytes32 claimId) external view returns (Claim memory) {
        Claim memory claim = _claims[claimId];
        if (claim.to == address(0)) revert ClaimNotFound(claimId);
        return claim;
    }

    /// @notice Pending unshield claims for `user`. Claimed entries are omitted.
    function getUserClaims(address user) external view returns (Claim[] memory) {
        bytes32[] storage ids = _userClaimIds[user];
        uint256 pending;
        uint256 length = ids.length;
        for (uint256 i = 0; i < length; ++i) {
            if (!_claims[ids[i]].claimed) ++pending;
        }

        Claim[] memory claims = new Claim[](pending);
        uint256 written;
        for (uint256 i = 0; i < length; ++i) {
            Claim storage stored = _claims[ids[i]];
            if (!stored.claimed) claims[written++] = stored;
        }
        return claims;
    }

    function _unshield(euint64 amount) internal returns (euint64 burned) {
        burned = _debit(msg.sender, amount);
        FHE.allowPublic(burned);
        FHE.allowThis(burned);
        FHE.allow(burned, msg.sender);

        bytes32 ctHash = euint64.unwrap(burned);
        uint256 nonce = _unshieldNonces[msg.sender]++;
        bytes32 claimId = keccak256(abi.encode(msg.sender, nonce, ctHash));

        _claims[claimId] = Claim({
            claimId: claimId,
            to: msg.sender,
            ctHash: ctHash,
            decryptedAmount: 0,
            claimed: false
        });
        _userClaimIds[msg.sender].push(claimId);

        emit TokensUnshielded(msg.sender, claimId, burned);
    }

    function _confidentialTransfer(address from, address to, euint64 amount) internal returns (euint64 transferred) {
        if (to == address(0) || to == CONFIDENTIAL_POOL) revert ERC20InvalidReceiver(to);

        transferred = _debit(from, amount);
        _credit(to, transferred);

        FHE.allow(transferred, from);
        FHE.allow(transferred, to);
        FHE.allowThis(transferred);
        FHE.allowTransient(transferred, msg.sender);

        emit ConfidentialTransfer(from, to, transferred);
    }

    /// @dev Transfers `transferred` or encrypted zero. Never reverts on an insufficient balance.
    function _debit(address account, euint64 amount) internal returns (euint64 transferred) {
        euint64 balance = _orZero(_confidentialBalances[account]);
        ebool enough = FHE.gte(balance, amount);
        transferred = FHE.select(enough, amount, FHE.asEuint64(uint256(0)));
        _setBalance(account, FHE.sub(balance, transferred));
    }

    function _credit(address account, euint64 amount) internal {
        euint64 balance = _orZero(_confidentialBalances[account]);
        _setBalance(account, FHE.add(balance, amount));
    }

    function _setBalance(address account, euint64 newBalance) internal {
        FHE.allowThis(newBalance);
        FHE.allow(newBalance, account);
        _confidentialBalances[account] = newBalance;
    }

    function _orZero(euint64 value) internal returns (euint64) {
        if (FHE.isInitialized(value)) return value;
        return FHE.asEuint64(uint256(0));
    }

    function _movePool(address from, address to, uint256 amount) internal {
        _poolMove = 1;
        _transfer(from, to, amount);
        _poolMove = 0;
    }

    function _update(address from, address to, uint256 value) internal override {
        if (
            _poolMove == 0 && from != address(0) && to != address(0)
                && (from == CONFIDENTIAL_POOL || to == CONFIDENTIAL_POOL)
        ) {
            revert PoolIsNotDirectlyTransferable();
        }
        super._update(from, to, value);
    }

    function _hashBalanceViewPermit(
        address holder,
        address viewer,
        bytes32 balanceHandle,
        uint256 nonce,
        uint256 deadline
    ) internal view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(abi.encode(BALANCE_VIEW_PERMIT_TYPEHASH, holder, viewer, balanceHandle, nonce, deadline))
        );
    }
}
