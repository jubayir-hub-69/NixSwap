// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ILayerZeroEndpointV2, MessagingFee, MessagingParams, MessagingReceipt, Origin} from "./bridge/ILayerZeroEndpointV2.sol";

/// @title NixBridge
/// @notice Lock-and-release bridge for allowlisted ERC-20s across LayerZero V2 pathways.
/// @dev The wallet transaction authorizes a send. A release is authorized only when the immutable
///      LayerZero endpoint calls `lzReceive` with a peer that was registered for that source endpoint id.
///      The contract never mints. It pays the exact locked amount from tokens already escrowed on the
///      destination. The owner cannot withdraw escrowed tokens. Unordered delivery is intentional:
///      one underfunded message does not block later messages, and each LayerZero nonce can execute once.
contract NixBridge is Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice Stable id for NIX. The same id is registered on every chain against that chain's NixToken.
    bytes32 public constant NIX_TOKEN_ID = keccak256("NIX");

    uint256 public constant PEER_DELAY = 1 days;
    uint256 public constant WITHDRAW_DELAY = 2 days;
    uint128 public constant MIN_LZ_RECEIVE_GAS = 200_000;
    uint128 public constant MAX_LZ_RECEIVE_GAS = 1_000_000;

    struct TokenConfig {
        address token;
        uint8 decimals;
        bool enabled;
    }

    struct Limit {
        uint256 capacity;
        uint256 refillPerSecond;
        uint256 remaining;
        uint256 updatedAt;
    }

    struct SurplusWithdrawal {
        address to;
        uint256 amount;
        uint256 readyAt;
        bool pending;
    }

    ILayerZeroEndpointV2 public immutable endpoint;
    uint32 public immutable localEid;
    uint128 public lzReceiveGas = 250_000;

    mapping(bytes32 tokenId => TokenConfig config) private _tokens;
    mapping(address token => bytes32 tokenId) public tokenIdOf;
    bytes32[] private _tokenIds;

    /// @notice Tokens the bridge is allowed to pay out. Deposits and locked sends increase it.
    mapping(bytes32 tokenId => uint256 balance) public accounted;

    mapping(uint32 eid => bytes32 peer) public peers;
    mapping(uint32 eid => bytes32 peer) public pendingPeer;
    mapping(uint32 eid => uint256 readyAt) public peerReadyAt;
    mapping(uint32 eid => bool queued) public peerQueued;

    mapping(bytes32 tokenId => mapping(uint32 eid => Limit limit)) private _outbound;
    mapping(bytes32 tokenId => mapping(uint32 eid => Limit limit)) private _inbound;

    mapping(bytes32 guid => bool used) public executed;
    mapping(uint32 srcEid => mapping(bytes32 sender => mapping(uint64 nonce => bool used))) public inboundNonceUsed;

    mapping(bytes32 tokenId => SurplusWithdrawal withdrawal) public surplusWithdrawals;
    mapping(bytes32 tokenId => uint256 amount) public surplusReserved;

    event BridgeSent(
        bytes32 indexed guid,
        uint32 indexed dstEid,
        bytes32 indexed tokenId,
        uint64 nonce,
        address sender,
        address recipient,
        uint256 amount,
        uint8 decimals
    );
    event BridgeReceived(
        bytes32 indexed guid,
        uint32 indexed srcEid,
        bytes32 indexed tokenId,
        uint64 nonce,
        address recipient,
        uint256 amount
    );
    event TokenRegistered(bytes32 indexed tokenId, address indexed token, uint8 decimals);
    event TokenEnabled(bytes32 indexed tokenId, bool enabled);
    event PeerSet(uint32 indexed eid, bytes32 peer);
    event PeerQueued(uint32 indexed eid, bytes32 peer, uint256 readyAt);
    event PeerCancelled(uint32 indexed eid);
    event LiquidityDeposited(bytes32 indexed tokenId, address indexed from, uint256 amount);
    event RateLimitSet(bytes32 indexed tokenId, uint32 indexed eid, bool inbound, uint256 capacity, uint256 refillPerSecond);
    event SurplusQueued(bytes32 indexed tokenId, address indexed to, uint256 amount, uint256 readyAt);
    event SurplusWithdrawn(bytes32 indexed tokenId, address indexed to, uint256 amount);
    event SurplusCancelled(bytes32 indexed tokenId);
    event UntrackedSwept(address indexed token, address indexed to, uint256 amount);
    event NativeSwept(address indexed to, uint256 amount);
    event LzReceiveGasSet(uint128 gasLimit);

    error OnlyEndpoint(address caller);
    error OnlyPeer(uint32 eid, bytes32 sender);
    error InvalidEndpoint();
    error InvalidEid(uint32 eid);
    error PeerNotSet(uint32 eid);
    error PeerAlreadySet(uint32 eid);
    error InvalidPeer();
    error NoPendingPeer(uint32 eid);
    error PeerTimelock(uint256 readyAt);
    error InvalidRecipient();
    error InvalidToken();
    error TokenAlreadyRegistered(bytes32 tokenId);
    error TokenDisabled(bytes32 tokenId);
    error ZeroAmount();
    error InsufficientFee(uint256 paid, uint256 required);
    error RefundFailed();
    error InsufficientLiquidity(uint256 available, uint256 required);
    error RateLimitUnset(uint32 eid);
    error RateLimitExceeded(uint256 available, uint256 required);
    error DecimalMismatch(uint8 localDecimals, uint8 messageDecimals);
    error AlreadyExecuted(bytes32 guid);
    error NonceAlreadyUsed(uint32 srcEid, uint64 nonce);
    error InvalidMessage();
    error ExactAmountRequired(uint256 expected, uint256 actual);
    error AmountExceedsSurplus(uint256 available, uint256 requested);
    error WithdrawalPending(bytes32 tokenId);
    error NoPendingWithdrawal(bytes32 tokenId);
    error WithdrawTimelock(uint256 readyAt);
    error InvalidGas(uint128 gasLimit);

    constructor(address endpoint_, uint32 localEid_, address initialOwner) Ownable(initialOwner) {
        if (endpoint_.code.length == 0) revert InvalidEndpoint();
        if (localEid_ == 0) revert InvalidEid(localEid_);
        endpoint = ILayerZeroEndpointV2(endpoint_);
        if (endpoint.eid() != localEid_) revert InvalidEid(localEid_);
        localEid = localEid_;
        endpoint.setDelegate(initialOwner);
    }

    function tokenCount() external view returns (uint256) {
        return _tokenIds.length;
    }

    function tokenIdAt(uint256 index) external view returns (bytes32) {
        if (index >= _tokenIds.length) revert InvalidToken();
        return _tokenIds[index];
    }

    function tokenConfig(bytes32 tokenId) external view returns (address token, uint8 decimals, bool enabled) {
        TokenConfig storage config = _tokens[tokenId];
        return (config.token, config.decimals, config.enabled);
    }

    function rateLimit(bytes32 tokenId, uint32 remoteEid, bool inbound)
        external
        view
        returns (uint256 capacity, uint256 refillPerSecond, uint256 available)
    {
        Limit storage limit = inbound ? _inbound[tokenId][remoteEid] : _outbound[tokenId][remoteEid];
        return (limit.capacity, limit.refillPerSecond, _available(limit));
    }

    /// @notice Tokens held by this contract above the escrow book and any queued surplus withdrawal.
    function surplus(bytes32 tokenId) public view returns (uint256) {
        TokenConfig storage config = _tokens[tokenId];
        if (config.token == address(0)) revert InvalidToken();
        uint256 balance = IERC20(config.token).balanceOf(address(this));
        uint256 reserved = accounted[tokenId] + surplusReserved[tokenId];
        if (balance <= reserved) return 0;
        return balance - reserved;
    }

    function quoteSend(uint32 dstEid, bytes32 tokenId, uint256 amount, address recipient)
        external
        view
        returns (uint256 nativeFee)
    {
        (MessagingParams memory params,) = _outboundMessage(dstEid, tokenId, amount, recipient);
        _requireOutboundCapacity(tokenId, dstEid, amount);
        MessagingFee memory fee = endpoint.quote(params, address(this));
        if (fee.lzTokenFee != 0) revert InsufficientFee(0, fee.nativeFee);
        return fee.nativeFee;
    }

    /// @notice Locks exactly `amount` and asks LayerZero to instruct `dstEid` to pay `recipient`.
    function send(uint32 dstEid, bytes32 tokenId, uint256 amount, address recipient)
        external
        payable
        whenNotPaused
        nonReentrant
        returns (bytes32 guid)
    {
        (MessagingParams memory params, uint8 decimals_) = _outboundMessage(dstEid, tokenId, amount, recipient);
        _requireOutboundCapacity(tokenId, dstEid, amount);

        uint256 received = _pull(_tokens[tokenId].token, msg.sender, amount);
        if (received != amount) revert ExactAmountRequired(amount, received);

        _consumeOutbound(tokenId, dstEid, amount);
        accounted[tokenId] += amount;
        guid = _dispatch(params, decimals_, tokenId, recipient, amount);
    }

    /// @notice Adds release liquidity. The tokens join the escrow book and leave only through `lzReceive`.
    function deposit(bytes32 tokenId, uint256 amount) external nonReentrant returns (uint256 received) {
        TokenConfig storage config = _tokens[tokenId];
        if (config.token == address(0)) revert InvalidToken();
        if (amount == 0) revert ZeroAmount();
        received = _pull(config.token, msg.sender, amount);
        if (received != amount) revert ExactAmountRequired(amount, received);
        accounted[tokenId] += amount;
        emit LiquidityDeposited(tokenId, msg.sender, amount);
    }

    function allowInitializePath(Origin calldata origin) external view returns (bool) {
        return origin.sender != bytes32(0) && peers[origin.srcEid] == origin.sender;
    }

    /// @notice Returns zero so one failed delivery cannot stall the pathway. Nonces are still consumed once.
    function nextNonce(uint32, bytes32) external pure returns (uint64) {
        return 0;
    }

    function lzReceive(
        Origin calldata origin,
        bytes32 guid,
        bytes calldata message,
        address /* executor */,
        bytes calldata /* extraData */
    ) external payable whenNotPaused nonReentrant {
        if (msg.sender != address(endpoint)) revert OnlyEndpoint(msg.sender);
        _release(origin, guid, message);
    }

    function registerToken(bytes32 tokenId, address token) external onlyOwner {
        if (tokenId == bytes32(0) || token.code.length == 0) revert InvalidToken();
        if (_tokens[tokenId].token != address(0) || tokenIdOf[token] != bytes32(0)) {
            revert TokenAlreadyRegistered(tokenId);
        }
        uint8 decimals_ = IERC20Metadata(token).decimals();
        if (decimals_ == 0 || decimals_ > 18) revert InvalidToken();

        _tokens[tokenId] = TokenConfig({token: token, decimals: decimals_, enabled: true});
        tokenIdOf[token] = tokenId;
        _tokenIds.push(tokenId);
        emit TokenRegistered(tokenId, token, decimals_);
    }

    /// @notice Disabling blocks new sends. Verified messages already in flight can still be released.
    function setTokenEnabled(bytes32 tokenId, bool enabled) external onlyOwner {
        if (_tokens[tokenId].token == address(0)) revert InvalidToken();
        _tokens[tokenId].enabled = enabled;
        emit TokenEnabled(tokenId, enabled);
    }

    function setPeer(uint32 eid, bytes32 peer) external onlyOwner {
        _validateEid(eid);
        _validatePeer(peer);
        if (peers[eid] != bytes32(0)) revert PeerAlreadySet(eid);
        peers[eid] = peer;
        emit PeerSet(eid, peer);
    }

    function queuePeer(uint32 eid, bytes32 peer) external onlyOwner {
        _validateEid(eid);
        if (peer != bytes32(0)) _validatePeer(peer);
        if (peers[eid] == peer) revert InvalidPeer();
        pendingPeer[eid] = peer;
        peerReadyAt[eid] = block.timestamp + PEER_DELAY;
        peerQueued[eid] = true;
        emit PeerQueued(eid, peer, peerReadyAt[eid]);
    }

    function applyPeer(uint32 eid) external {
        if (!peerQueued[eid]) revert NoPendingPeer(eid);
        if (block.timestamp < peerReadyAt[eid]) revert PeerTimelock(peerReadyAt[eid]);
        peers[eid] = pendingPeer[eid];
        peerQueued[eid] = false;
        pendingPeer[eid] = bytes32(0);
        peerReadyAt[eid] = 0;
        emit PeerSet(eid, peers[eid]);
    }

    function cancelPeer(uint32 eid) external onlyOwner {
        if (!peerQueued[eid]) revert NoPendingPeer(eid);
        peerQueued[eid] = false;
        pendingPeer[eid] = bytes32(0);
        peerReadyAt[eid] = 0;
        emit PeerCancelled(eid);
    }

    function setRateLimit(bytes32 tokenId, uint32 remoteEid, bool inbound, uint256 capacity, uint256 refillPerSecond)
        external
        onlyOwner
    {
        if (_tokens[tokenId].token == address(0)) revert InvalidToken();
        _validateEid(remoteEid);
        if (capacity == 0 || refillPerSecond == 0) revert RateLimitUnset(remoteEid);
        Limit storage limit = inbound ? _inbound[tokenId][remoteEid] : _outbound[tokenId][remoteEid];
        limit.capacity = capacity;
        limit.refillPerSecond = refillPerSecond;
        limit.remaining = capacity;
        limit.updatedAt = block.timestamp;
        emit RateLimitSet(tokenId, remoteEid, inbound, capacity, refillPerSecond);
    }

    function setLzReceiveGas(uint128 gasLimit) external onlyOwner {
        if (gasLimit < MIN_LZ_RECEIVE_GAS || gasLimit > MAX_LZ_RECEIVE_GAS) revert InvalidGas(gasLimit);
        lzReceiveGas = gasLimit;
        emit LzReceiveGasSet(gasLimit);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Starts a timelocked recovery of tokens that were sent here outside deposit and send.
    function queueSurplusWithdraw(bytes32 tokenId, address to, uint256 amount) external onlyOwner {
        if (_tokens[tokenId].token == address(0)) revert InvalidToken();
        if (to == address(0) || to == address(this)) revert InvalidRecipient();
        if (amount == 0) revert ZeroAmount();
        if (surplusWithdrawals[tokenId].pending) revert WithdrawalPending(tokenId);
        uint256 available = surplus(tokenId);
        if (amount > available) revert AmountExceedsSurplus(available, amount);

        surplusReserved[tokenId] = amount;
        surplusWithdrawals[tokenId] = SurplusWithdrawal({
            to: to,
            amount: amount,
            readyAt: block.timestamp + WITHDRAW_DELAY,
            pending: true
        });
        emit SurplusQueued(tokenId, to, amount, block.timestamp + WITHDRAW_DELAY);
    }

    function executeSurplusWithdraw(bytes32 tokenId) external nonReentrant {
        SurplusWithdrawal memory job = surplusWithdrawals[tokenId];
        if (!job.pending) revert NoPendingWithdrawal(tokenId);
        if (block.timestamp < job.readyAt) revert WithdrawTimelock(job.readyAt);
        TokenConfig storage config = _tokens[tokenId];
        if (config.token == address(0)) revert InvalidToken();

        surplusWithdrawals[tokenId].pending = false;
        surplusReserved[tokenId] = 0;
        IERC20(config.token).safeTransfer(job.to, job.amount);
        emit SurplusWithdrawn(tokenId, job.to, job.amount);
    }

    function cancelSurplusWithdraw(bytes32 tokenId) external onlyOwner {
        if (!surplusWithdrawals[tokenId].pending) revert NoPendingWithdrawal(tokenId);
        surplusWithdrawals[tokenId].pending = false;
        surplusReserved[tokenId] = 0;
        emit SurplusCancelled(tokenId);
    }

    /// @notice Recovers an unregistered token. Registered escrow cannot be moved through this function.
    function sweepUntracked(address token, address to, uint256 amount) external onlyOwner nonReentrant {
        if (token.code.length == 0 || tokenIdOf[token] != bytes32(0)) revert InvalidToken();
        if (to == address(0) || to == address(this)) revert InvalidRecipient();
        if (amount == 0) revert ZeroAmount();
        IERC20(token).safeTransfer(to, amount);
        emit UntrackedSwept(token, to, amount);
    }

    function sweepNative(address payable to) external onlyOwner nonReentrant {
        if (to == address(0)) revert InvalidRecipient();
        uint256 balance = address(this).balance;
        if (balance == 0) revert ZeroAmount();
        (bool ok,) = to.call{value: balance}("");
        if (!ok) revert RefundFailed();
        emit NativeSwept(to, balance);
    }

    function _transferOwnership(address newOwner) internal override {
        super._transferOwnership(newOwner);
        // Ownable sets the owner before this constructor assigns `endpoint`.
        if (address(endpoint) != address(0)) {
            endpoint.setDelegate(newOwner);
        }
    }

    function _outboundMessage(uint32 dstEid, bytes32 tokenId, uint256 amount, address recipient)
        internal
        view
        returns (MessagingParams memory params, uint8 decimals_)
    {
        _validateEid(dstEid);
        bytes32 peer = peers[dstEid];
        if (peer == bytes32(0)) revert PeerNotSet(dstEid);

        TokenConfig storage config = _tokens[tokenId];
        if (config.token == address(0)) revert InvalidToken();
        if (!config.enabled) revert TokenDisabled(tokenId);
        if (recipient == address(0) || recipient == address(this)) revert InvalidRecipient();
        if (amount == 0) revert ZeroAmount();

        decimals_ = config.decimals;
        params = MessagingParams({
            dstEid: dstEid,
            receiver: peer,
            message: abi.encode(tokenId, recipient, amount, decimals_),
            options: _lzOptions(),
            payInLzToken: false
        });
    }

    function _dispatch(
        MessagingParams memory params,
        uint8 decimals_,
        bytes32 tokenId,
        address recipient,
        uint256 amount
    ) internal returns (bytes32 guid) {
        MessagingFee memory fee = endpoint.quote(params, address(this));
        if (fee.lzTokenFee != 0 || msg.value < fee.nativeFee) revert InsufficientFee(msg.value, fee.nativeFee);

        MessagingReceipt memory receipt = endpoint.send{value: fee.nativeFee}(params, msg.sender);
        guid = receipt.guid;

        uint256 refund = msg.value - fee.nativeFee;
        if (refund != 0) {
            (bool ok,) = msg.sender.call{value: refund}("");
            if (!ok) revert RefundFailed();
        }

        emit BridgeSent(guid, params.dstEid, tokenId, receipt.nonce, msg.sender, recipient, amount, decimals_);
    }

    function _release(Origin calldata origin, bytes32 guid, bytes calldata message) internal {
        bytes32 peer = peers[origin.srcEid];
        if (peer == bytes32(0) || peer != origin.sender) revert OnlyPeer(origin.srcEid, origin.sender);
        if (executed[guid]) revert AlreadyExecuted(guid);
        if (_nonceUsed(origin)) revert NonceAlreadyUsed(origin.srcEid, origin.nonce);
        if (message.length != 128) revert InvalidMessage();
        _pay(origin, guid, message);
    }

    function _pay(Origin calldata origin, bytes32 guid, bytes calldata message) internal {
        (bytes32 tokenId, address recipient, uint256 amount, uint8 decimals_) =
            abi.decode(message, (bytes32, address, uint256, uint8));
        _validateRelease(tokenId, recipient, amount, decimals_);
        _consumeInbound(tokenId, origin.srcEid, amount);
        _markAndTransfer(origin, guid, tokenId, recipient, amount);
    }

    function _validateRelease(bytes32 tokenId, address recipient, uint256 amount, uint8 decimals_) internal view {
        TokenConfig storage config = _tokens[tokenId];
        if (config.token == address(0)) revert InvalidToken();
        if (decimals_ != config.decimals) revert DecimalMismatch(config.decimals, decimals_);
        if (recipient == address(0) || recipient == address(this)) revert InvalidRecipient();
        if (amount == 0) revert ZeroAmount();
        if (accounted[tokenId] < amount) revert InsufficientLiquidity(accounted[tokenId], amount);
        uint256 balance = IERC20(config.token).balanceOf(address(this));
        if (balance < amount) revert InsufficientLiquidity(balance, amount);
    }

    function _markAndTransfer(
        Origin calldata origin,
        bytes32 guid,
        bytes32 tokenId,
        address recipient,
        uint256 amount
    ) internal {
        executed[guid] = true;
        _markNonce(origin);
        accounted[tokenId] -= amount;

        address token = _tokens[tokenId].token;
        uint256 beforeBalance = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransfer(recipient, amount);
        uint256 spent = beforeBalance - IERC20(token).balanceOf(address(this));
        if (spent != amount) revert ExactAmountRequired(amount, spent);

        emit BridgeReceived(guid, origin.srcEid, tokenId, origin.nonce, recipient, amount);
    }

    function _nonceUsed(Origin calldata origin) internal view returns (bool) {
        return inboundNonceUsed[origin.srcEid][origin.sender][origin.nonce];
    }

    function _markNonce(Origin calldata origin) internal {
        inboundNonceUsed[origin.srcEid][origin.sender][origin.nonce] = true;
    }

    function _consumeOutbound(bytes32 tokenId, uint32 dstEid, uint256 amount) internal {
        _consume(_outbound[tokenId][dstEid], dstEid, amount);
    }

    function _consumeInbound(bytes32 tokenId, uint32 srcEid, uint256 amount) internal {
        _consume(_inbound[tokenId][srcEid], srcEid, amount);
    }

    function _requireOutboundCapacity(bytes32 tokenId, uint32 dstEid, uint256 amount) internal view {
        Limit storage limit = _outbound[tokenId][dstEid];
        if (limit.capacity == 0) revert RateLimitUnset(dstEid);
        uint256 available = _available(limit);
        if (amount > available) revert RateLimitExceeded(available, amount);
    }

    function _lzOptions() internal view returns (bytes memory) {
        return abi.encodePacked(uint16(3), uint8(1), uint16(17), uint8(1), uint128(lzReceiveGas));
    }

    function _pull(address token, address from, uint256 amount) internal returns (uint256 received) {
        uint256 beforeBalance = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransferFrom(from, address(this), amount);
        uint256 afterBalance = IERC20(token).balanceOf(address(this));
        if (afterBalance <= beforeBalance) return 0;
        received = afterBalance - beforeBalance;
    }

    function _consume(Limit storage limit, uint32 eid, uint256 amount) internal {
        if (limit.capacity == 0) revert RateLimitUnset(eid);
        uint256 available = _available(limit);
        if (amount > available) revert RateLimitExceeded(available, amount);
        limit.remaining = available - amount;
        limit.updatedAt = block.timestamp;
    }

    function _available(Limit storage limit) internal view returns (uint256) {
        if (limit.capacity == 0 || limit.updatedAt == 0) return 0;
        if (limit.remaining >= limit.capacity) return limit.capacity;
        uint256 elapsed = block.timestamp - limit.updatedAt;
        if (limit.refillPerSecond == 0 || elapsed == 0) return limit.remaining;
        if (elapsed > type(uint256).max / limit.refillPerSecond) return limit.capacity;
        uint256 room = limit.capacity - limit.remaining;
        uint256 added = elapsed * limit.refillPerSecond;
        if (added >= room) return limit.capacity;
        return limit.remaining + added;
    }

    function _validateEid(uint32 eid) internal view {
        if (eid == 0 || eid == localEid) revert InvalidEid(eid);
    }

    function _validatePeer(bytes32 peer) internal pure {
        if (peer == bytes32(0) || uint256(peer) > type(uint160).max) revert InvalidPeer();
    }
}
