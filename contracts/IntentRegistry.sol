// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
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
contract IntentRegistry is Ownable {
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
    mapping(uint256 intentId => EncryptedIntent intent) private _intents;
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

    error SolverNotWhitelisted(address solver);
    error IntentWindowInvalid(uint64 expiresAt);
    error IntentNotFound(uint256 intentId);
    error IntentExpired(uint256 intentId);
    error SolverNotDesignated(address caller, address solver);
    error SolverAlreadyAuthorized(uint256 intentId);
    error IntentInactive(uint256 intentId);

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
