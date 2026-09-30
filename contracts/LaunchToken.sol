// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ILayerZeroEndpointV2, MessagingFee, MessagingParams, MessagingReceipt, Origin} from "./bridge/ILayerZeroEndpointV2.sol";

/// @title LaunchToken
/// @notice Omnichain fungible token created by the launchpad. The source chain mints the
///         creator share and the local pool. Each other chain mints only its own pool share.
///         A bridge send burns here and the peer token mints the same amount on arrival.
contract LaunchToken is ERC20, ReentrancyGuard {
    uint128 public constant LZ_RECEIVE_GAS = 200_000;

    ILayerZeroEndpointV2 public immutable endpoint;
    address public immutable launchpad;
    uint32 public immutable localEid;

    mapping(uint32 eid => bytes32 peer) public peers;
    mapping(bytes32 guid => bool used) public executed;
    mapping(uint32 srcEid => mapping(bytes32 sender => mapping(uint64 nonce => bool used))) public inboundNonceUsed;

    event PeerSet(uint32 indexed eid, bytes32 peer);
    event OftSent(bytes32 indexed guid, uint32 indexed dstEid, uint64 nonce, address indexed sender, address recipient, uint256 amount);
    event OftReceived(bytes32 indexed guid, uint32 indexed srcEid, uint64 nonce, address recipient, uint256 amount);

    error InvalidSupply();
    error OnlyLaunchpad(address caller);
    error OnlyEndpoint(address caller);
    error OnlyPeer(uint32 eid, bytes32 sender);
    error InvalidEid(uint32 eid);
    error InvalidPeer();
    error PeerNotSet(uint32 eid);
    error PeerAlreadySet(uint32 eid);
    error InvalidRecipient();
    error ZeroAmount();
    error InsufficientFee(uint256 paid, uint256 required);
    error RefundFailed();
    error AlreadyExecuted(bytes32 guid);
    error NonceAlreadyUsed(uint32 srcEid, uint64 nonce);
    error InvalidMessage();

    constructor(
        string memory name_,
        string memory symbol_,
        uint256 creatorAmount,
        uint256 liquidityAmount,
        address creator,
        address launchpad_,
        address endpoint_,
        uint32 localEid_
    ) ERC20(name_, symbol_) {
        if (liquidityAmount == 0 || launchpad_ == address(0) || endpoint_ == address(0) || localEid_ == 0) {
            revert InvalidSupply();
        }
        if (creatorAmount != 0 && creator == address(0)) revert InvalidSupply();
        launchpad = launchpad_;
        endpoint = ILayerZeroEndpointV2(endpoint_);
        localEid = localEid_;
        if (creatorAmount != 0) _mint(creator, creatorAmount);
        _mint(launchpad_, liquidityAmount);
    }

    /// @notice One peer per endpoint id. The launchpad sets it once, to the token deployed on that chain.
    function setPeer(uint32 eid, bytes32 peer) external {
        if (msg.sender != launchpad) revert OnlyLaunchpad(msg.sender);
        if (eid == 0 || eid == localEid) revert InvalidEid(eid);
        if (peer == bytes32(0) || uint256(peer) > type(uint160).max) revert InvalidPeer();
        if (peers[eid] != bytes32(0)) revert PeerAlreadySet(eid);
        peers[eid] = peer;
        emit PeerSet(eid, peer);
    }

    function quoteSend(uint32 dstEid, address recipient, uint256 amount) external view returns (uint256 nativeFee) {
        MessagingParams memory params = _outbound(dstEid, recipient, amount);
        MessagingFee memory fee = endpoint.quote(params, address(this));
        if (fee.lzTokenFee != 0) revert InsufficientFee(0, fee.nativeFee);
        return fee.nativeFee;
    }

    /// @notice Burns `amount` from the caller and asks the peer token to mint it to `recipient`.
    function send(uint32 dstEid, address recipient, uint256 amount)
        external
        payable
        nonReentrant
        returns (bytes32 guid)
    {
        MessagingParams memory params = _outbound(dstEid, recipient, amount);
        _burn(msg.sender, amount);

        MessagingFee memory fee = endpoint.quote(params, address(this));
        if (fee.lzTokenFee != 0 || msg.value < fee.nativeFee) revert InsufficientFee(msg.value, fee.nativeFee);
        MessagingReceipt memory receipt = endpoint.send{value: fee.nativeFee}(params, msg.sender);
        guid = receipt.guid;

        uint256 refund = msg.value - fee.nativeFee;
        if (refund != 0) {
            (bool ok,) = msg.sender.call{value: refund}("");
            if (!ok) revert RefundFailed();
        }
        emit OftSent(guid, dstEid, receipt.nonce, msg.sender, recipient, amount);
    }

    function allowInitializePath(Origin calldata origin) external view returns (bool) {
        return origin.sender != bytes32(0) && peers[origin.srcEid] == origin.sender;
    }

    /// @notice Unordered delivery. A failed mint does not block the next nonce, and each nonce still lands once.
    function nextNonce(uint32, bytes32) external pure returns (uint64) {
        return 0;
    }

    function lzReceive(
        Origin calldata origin,
        bytes32 guid,
        bytes calldata message,
        address,
        bytes calldata
    ) external payable nonReentrant {
        if (msg.sender != address(endpoint)) revert OnlyEndpoint(msg.sender);
        bytes32 peer = peers[origin.srcEid];
        if (peer == bytes32(0) || peer != origin.sender) revert OnlyPeer(origin.srcEid, origin.sender);
        if (executed[guid]) revert AlreadyExecuted(guid);
        if (inboundNonceUsed[origin.srcEid][origin.sender][origin.nonce]) revert NonceAlreadyUsed(origin.srcEid, origin.nonce);
        if (message.length != 64) revert InvalidMessage();

        (address recipient, uint256 amount) = abi.decode(message, (address, uint256));
        if (recipient == address(0) || recipient == address(this)) revert InvalidRecipient();
        if (amount == 0) revert ZeroAmount();

        executed[guid] = true;
        inboundNonceUsed[origin.srcEid][origin.sender][origin.nonce] = true;
        _mint(recipient, amount);
        emit OftReceived(guid, origin.srcEid, origin.nonce, recipient, amount);
    }

    function _outbound(uint32 dstEid, address recipient, uint256 amount) internal view returns (MessagingParams memory) {
        if (dstEid == 0 || dstEid == localEid) revert InvalidEid(dstEid);
        bytes32 peer = peers[dstEid];
        if (peer == bytes32(0)) revert PeerNotSet(dstEid);
        if (recipient == address(0) || recipient == address(this)) revert InvalidRecipient();
        if (amount == 0) revert ZeroAmount();
        return MessagingParams({
            dstEid: dstEid,
            receiver: peer,
            message: abi.encode(recipient, amount),
            options: abi.encodePacked(uint16(3), uint8(1), uint16(17), uint8(1), LZ_RECEIVE_GAS),
            payInLzToken: false
        });
    }
}
