// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {
    FHE,
    euint32,
    euint64,
    externalEuint32,
    externalEuint64,
    TASK_MANAGER_ADDRESS
} from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import {ITaskManager, UnsignedEncryptedInput, Utils} from "@fhenixprotocol/cofhe-contracts/ICofhe.sol";

/// @title IntentRegistry
/// @notice Unified encrypted intent layer. Amount, target chain, and limit stay
///         ciphertext handles. Decrypt access is granted with `FHE.allow` to one
///         whitelisted solver, and only while the intent window is still open.
/// @dev CoFHE ACL entries do not expire. This contract never grants them after
///      `expiresAt`, and it never grants the submitter, the public, or any
///      address other than the designated solver. `FHE.allowThis` lets the
///      registry reference the handles later without making them readable by users.
interface ISwapPair {
    function nix() external view returns (address);
    function token() external view returns (address);
    function quoteSwap(address tokenIn, uint256 amountIn) external view returns (uint256 amountOut);
    function swap(address tokenIn, uint256 amountIn, uint256 minOut, address recipient) external returns (uint256 amountOut);
}

contract IntentRegistry is Ownable {
    using SafeERC20 for IERC20;

    /// @dev Encrypted swap amounts use 6 decimals. Pool tokens use 18.
    uint256 public constant CONFIDENTIAL_TO_PUBLIC = 1e12;
    enum IntentType {
        SWAP,
        BRIDGE,
        TRADE,
        LAUNCH
    }

    /// @notice Longest allowed life of an intent, measured from submission.
    uint64 public constant MAX_WINDOW = 1 hours;

    struct EncryptedIntent {
        address user;
        IntentType intentType;
        euint64 amount;
        euint32 targetChain;
        euint64 limit;
        address solver;
        uint64 expiresAt;
        bool solverAuthorized;
        bool active;
    }

    mapping(address solver => bool allowed) private _solvers;
    struct SwapRoute {
        address tokenIn;
        address tokenOut;
    }

    mapping(uint256 intentId => EncryptedIntent intent) private _intents;
    mapping(uint256 intentId => SwapRoute route) private _routes;
    uint256 private _nextIntentId = 1;

    event SolverUpdated(address indexed solver, bool allowed);
    event IntentSubmitted(
        uint256 indexed intentId,
        address indexed user,
        IntentType intentType,
        address solver,
        uint64 expiresAt
    );
    event SolverAccessGranted(uint256 indexed intentId, address indexed solver);
    event SwapRouteRecorded(uint256 indexed intentId, address tokenIn, address tokenOut);
    event SwapFilled(
        uint256 indexed intentId,
        address indexed user,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut
    );

    error SolverNotWhitelisted(address solver);
    error InvalidRoute();
    error IntentWindowInvalid(uint64 expiresAt);
    error IntentNotFound(uint256 intentId);
    error IntentExpired(uint256 intentId);
    error SolverNotDesignated(address caller, address solver);
    error SolverAlreadyAuthorized(uint256 intentId);
    error IntentInactive(uint256 intentId);
    error IntentNotSwap(uint256 intentId);
    error InvalidDecryptionProof(bytes32 handle);
    error WrongChain(uint32 targetChain);
    error ZeroFill();
    error RouteMismatch(address pair);
    error LimitNotMet(uint256 output, uint256 minimum);

    constructor(address initialOwner) Ownable(initialOwner) {}

    function setSolver(address solver, bool allowed) external onlyOwner {
        if (solver == address(0)) revert SolverNotWhitelisted(solver);
        _solvers[solver] = allowed;
        emit SolverUpdated(solver, allowed);
    }

    function isSolver(address solver) external view returns (bool) {
        return _solvers[solver];
    }

    function intentCount() external view returns (uint256) {
        return _nextIntentId - 1;
    }

    /// @notice Stores one encrypted intent. `inputProof` is the single batch signature
    ///         over amount (`euint64`), target chain (`euint32`), then limit (`euint64`).
    ///         The designated solver must already be whitelisted. No decrypt grant is
    ///         created here.
    function submitIntent(
        IntentType intentType,
        externalEuint64 encryptedAmount,
        externalEuint32 encryptedTargetChain,
        externalEuint64 encryptedLimit,
        bytes calldata inputProof,
        address solver,
        uint64 expiresAt
    ) external returns (uint256 intentId) {
        return _submit(intentType, encryptedAmount, encryptedTargetChain, encryptedLimit, inputProof, solver, expiresAt);
    }

    /// @notice Same encrypted payload as `submitIntent`, plus the public token route.
    ///         Token addresses are public market metadata. Amount and limit stay ciphertext.
    function submitSwapIntent(
        address tokenIn,
        address tokenOut,
        IntentType intentType,
        externalEuint64 encryptedAmount,
        externalEuint32 encryptedTargetChain,
        externalEuint64 encryptedLimit,
        bytes calldata inputProof,
        address solver,
        uint64 expiresAt
    ) external returns (uint256 intentId) {
        if (tokenIn == address(0) || tokenOut == address(0) || tokenIn == tokenOut) revert InvalidRoute();
        intentId = _submit(
            intentType, encryptedAmount, encryptedTargetChain, encryptedLimit, inputProof, solver, expiresAt
        );
        _routes[intentId] = SwapRoute({tokenIn: tokenIn, tokenOut: tokenOut});
        emit SwapRouteRecorded(intentId, tokenIn, tokenOut);
    }

    /// @notice Public pair for an intent. Empty addresses mean the intent was not a routed swap.
    function swapRoute(uint256 intentId) external view returns (address tokenIn, address tokenOut) {
        if (_intents[intentId].user == address(0)) revert IntentNotFound(intentId);
        SwapRoute memory route = _routes[intentId];
        return (route.tokenIn, route.tokenOut);
    }

    function _submit(
        IntentType intentType,
        externalEuint64 encryptedAmount,
        externalEuint32 encryptedTargetChain,
        externalEuint64 encryptedLimit,
        bytes calldata inputProof,
        address solver,
        uint64 expiresAt
    ) internal returns (uint256 intentId) {
        if (!_solvers[solver]) revert SolverNotWhitelisted(solver);
        if (expiresAt <= block.timestamp || expiresAt > block.timestamp + MAX_WINDOW) {
            revert IntentWindowInvalid(expiresAt);
        }

        (euint64 amount, euint32 targetChain, euint64 limit) =
            _verifyIntent(encryptedAmount, encryptedTargetChain, encryptedLimit, inputProof);

        // The registry can keep using the handles. Nobody else can decrypt them yet.
        FHE.allowThis(amount);
        FHE.allowThis(targetChain);
        FHE.allowThis(limit);

        intentId = _nextIntentId++;
        _intents[intentId] = EncryptedIntent({
            user: msg.sender,
            intentType: intentType,
            amount: amount,
            targetChain: targetChain,
            limit: limit,
            solver: solver,
            expiresAt: expiresAt,
            solverAuthorized: false,
            active: true
        });

        emit IntentSubmitted(intentId, msg.sender, intentType, solver, expiresAt);
    }

    /// @notice Cleartext the solver passes into `fillSwap`. Proofs stay separate calldata.
    struct SwapCleartext {
        uint256 intentId;
        address pair;
        uint64 amount;
        uint64 limit;
        uint32 targetChain;
    }

    /// @notice Solver-only settlement. The proofs must decrypt this intent's ciphertexts.
    ///         `limit` is the minimum output, in confidential units. The public pool
    ///         transfer uses 18-decimal units. The intent is closed before tokens move.
    function fillSwap(
        SwapCleartext calldata order,
        bytes calldata amountProof,
        bytes calldata limitProof,
        bytes calldata chainProof
    ) external returns (uint256 amountOut) {
        _closeIntent(order, amountProof, limitProof, chainProof);
        uint256 amountIn;
        (amountIn, amountOut) = _takeSwap(order);
        SwapRoute memory route = _routes[order.intentId];
        emit SwapFilled(order.intentId, _intents[order.intentId].user, route.tokenIn, route.tokenOut, amountIn, amountOut);
    }

    function _closeIntent(
        SwapCleartext calldata order,
        bytes calldata amountProof,
        bytes calldata limitProof,
        bytes calldata chainProof
    ) internal {
        EncryptedIntent storage intent = _intents[order.intentId];
        if (intent.user == address(0)) revert IntentNotFound(order.intentId);
        if (!intent.active) revert IntentInactive(order.intentId);
        if (msg.sender != intent.solver) revert SolverNotDesignated(msg.sender, intent.solver);
        if (!_solvers[msg.sender]) revert SolverNotWhitelisted(msg.sender);
        if (block.timestamp > intent.expiresAt) revert IntentExpired(order.intentId);
        if (intent.intentType != IntentType.SWAP && intent.intentType != IntentType.TRADE) {
            revert IntentNotSwap(order.intentId);
        }
        _acceptProofs(intent, order, amountProof, limitProof, chainProof);
        intent.active = false;
    }

    function _acceptProofs(
        EncryptedIntent storage intent,
        SwapCleartext calldata order,
        bytes calldata amountProof,
        bytes calldata limitProof,
        bytes calldata chainProof
    ) internal {
        SwapRoute memory route = _routes[order.intentId];
        if (route.tokenIn == address(0) || route.tokenOut == address(0)) revert InvalidRoute();
        if (!_proof(intent.amount, order.amount, amountProof)) revert InvalidDecryptionProof(euint64.unwrap(intent.amount));
        if (!_proof(intent.limit, order.limit, limitProof)) revert InvalidDecryptionProof(euint64.unwrap(intent.limit));
        if (!_proof(intent.targetChain, order.targetChain, chainProof)) {
            revert InvalidDecryptionProof(euint32.unwrap(intent.targetChain));
        }
        if (uint256(order.targetChain) != block.chainid) revert WrongChain(order.targetChain);
        FHE.publishDecryptResult(intent.amount, order.amount, amountProof);
        FHE.publishDecryptResult(intent.limit, order.limit, limitProof);
        FHE.publishDecryptResult(intent.targetChain, order.targetChain, chainProof);
    }

    /// @dev Public amounts are the confidential 6-decimal values scaled to 18 decimals.
    function _takeSwap(SwapCleartext calldata order) internal returns (uint256 amountIn, uint256 amountOut) {
        SwapRoute memory route = _routes[order.intentId];
        amountIn = uint256(order.amount) * CONFIDENTIAL_TO_PUBLIC;
        uint256 minOut = uint256(order.limit) * CONFIDENTIAL_TO_PUBLIC;
        if (amountIn == 0 || minOut == 0) revert ZeroFill();
        amountOut = _swapMatched(order.pair, route.tokenIn, route.tokenOut, amountIn, minOut, _intents[order.intentId].user);
    }

    function _swapMatched(
        address pair,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minOut,
        address user
    ) internal returns (uint256 amountOut) {
        ISwapPair market = ISwapPair(pair);
        address base = market.nix();
        address quote = market.token();
        bool matched = (tokenIn == base && tokenOut == quote) || (tokenIn == quote && tokenOut == base);
        if (!matched) revert RouteMismatch(pair);
        uint256 expected = market.quoteSwap(tokenIn, amountIn);
        if (expected < minOut) revert LimitNotMet(expected, minOut);

        IERC20(tokenIn).safeTransferFrom(user, address(this), amountIn);
        IERC20(tokenIn).forceApprove(pair, amountIn);
        amountOut = market.swap(tokenIn, amountIn, minOut, user);
    }

    function _proof(euint64 handle, uint64 value, bytes calldata signature) internal view returns (bool) {
        return FHE.verifyDecryptResultSafe(handle, value, signature);
    }

    function _proof(euint32 handle, uint32 value, bytes calldata signature) internal view returns (bool) {
        return FHE.verifyDecryptResultSafe(handle, value, signature);
    }

    /// @notice Grants the designated solver decrypt access for this intent's ciphertexts.
    ///         Reverts once `expiresAt` has passed, so a late solver never receives `FHE.allow`.
    function grantSolverAccess(uint256 intentId) external {
        EncryptedIntent storage intent = _intents[intentId];
        if (!intent.active) revert IntentInactive(intentId);
        if (msg.sender != intent.solver) revert SolverNotDesignated(msg.sender, intent.solver);
        if (!_solvers[msg.sender]) revert SolverNotWhitelisted(msg.sender);
        if (block.timestamp > intent.expiresAt) revert IntentExpired(intentId);
        if (intent.solverAuthorized) revert SolverAlreadyAuthorized(intentId);

        FHE.allow(intent.amount, msg.sender);
        FHE.allow(intent.targetChain, msg.sender);
        FHE.allow(intent.limit, msg.sender);
        intent.solverAuthorized = true;

        emit SolverAccessGranted(intentId, msg.sender);
    }

    function getIntent(uint256 intentId) external view returns (EncryptedIntent memory) {
        EncryptedIntent memory intent = _intents[intentId];
        if (intent.user == address(0)) revert IntentNotFound(intentId);
        return intent;
    }

    /// @notice True only when `account` has ACL access to every encrypted field.
    function isIntentReadableBy(uint256 intentId, address account) external view returns (bool) {
        EncryptedIntent storage intent = _intents[intentId];
        if (intent.user == address(0)) revert IntentNotFound(intentId);
        return FHE.isAllowed(intent.amount, account) && FHE.isAllowed(intent.targetChain, account)
            && FHE.isAllowed(intent.limit, account);
    }

    function _verifyIntent(
        externalEuint64 encryptedAmount,
        externalEuint32 encryptedTargetChain,
        externalEuint64 encryptedLimit,
        bytes calldata inputProof
    ) internal returns (euint64 amount, euint32 targetChain, euint64 limit) {
        UnsignedEncryptedInput[] memory inputs = new UnsignedEncryptedInput[](3);
        inputs[0] = UnsignedEncryptedInput(uint256(externalEuint64.unwrap(encryptedAmount)), 0, Utils.EUINT64_TFHE);
        inputs[1] = UnsignedEncryptedInput(uint256(externalEuint32.unwrap(encryptedTargetChain)), 0, Utils.EUINT32_TFHE);
        inputs[2] = UnsignedEncryptedInput(uint256(externalEuint64.unwrap(encryptedLimit)), 0, Utils.EUINT64_TFHE);

        uint256[] memory handles =
            ITaskManager(TASK_MANAGER_ADDRESS).batchVerifyInputs(inputs, msg.sender, inputProof);

        amount = euint64.wrap(bytes32(handles[0]));
        targetChain = euint32.wrap(bytes32(handles[1]));
        limit = euint64.wrap(bytes32(handles[2]));
    }
}
