// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ILayerZeroEndpointV2, MessagingFee, MessagingParams, MessagingReceipt, Origin} from "../bridge/ILayerZeroEndpointV2.sol";

interface INixBridgeReceiver {
    function lzReceive(
        Origin calldata origin,
        bytes32 guid,
        bytes calldata message,
        address executor,
        bytes calldata extraData
    ) external payable;
}

/// @notice Test double for the endpoint. Production deploys use the live LayerZero endpoint.
contract MockLayerZeroEndpoint is ILayerZeroEndpointV2 {
    uint256 public constant NATIVE_FEE = 0.001 ether;

    uint32 public immutable eid;
    address public delegate;
    uint64 public outboundNonce;

    struct SentMessage {
        address sender;
        uint32 dstEid;
        bytes32 receiver;
        bytes32 guid;
        uint64 nonce;
        bytes message;
    }

    bytes public lastOptions;
    bytes public lastMessage;
    bytes32 public lastReceiver;
    uint32 public lastDstEid;
    address public lastSender;
    address public lastRefund;
    bytes32 public lastGuid;
    SentMessage[] private _sent;

    constructor(uint32 eid_) {
        eid = eid_;
    }

    function quote(MessagingParams calldata, address) external pure returns (MessagingFee memory) {
        return MessagingFee({nativeFee: NATIVE_FEE, lzTokenFee: 0});
    }

    function send(MessagingParams calldata params, address refundAddress)
        external
        payable
        returns (MessagingReceipt memory)
    {
        if (msg.value < NATIVE_FEE) revert("mock fee");
        outboundNonce += 1;
        bytes32 guid = keccak256(abi.encode(msg.sender, outboundNonce, params.dstEid, params.receiver, params.message));
        lastDstEid = params.dstEid;
        lastReceiver = params.receiver;
        lastOptions = params.options;
        lastMessage = params.message;
        lastSender = msg.sender;
        lastRefund = refundAddress;
        lastGuid = guid;
        _sent.push(
            SentMessage({
                sender: msg.sender,
                dstEid: params.dstEid,
                receiver: params.receiver,
                guid: guid,
                nonce: outboundNonce,
                message: params.message
            })
        );
        return MessagingReceipt({guid: guid, nonce: outboundNonce, fee: MessagingFee({nativeFee: NATIVE_FEE, lzTokenFee: 0})});
    }

    function sentCount() external view returns (uint256) {
        return _sent.length;
    }

    function sentMessage(uint256 index)
        external
        view
        returns (address sender, uint32 dstEid, bytes32 receiver, bytes32 guid, uint64 nonce, bytes memory message)
    {
        SentMessage storage item = _sent[index];
        return (item.sender, item.dstEid, item.receiver, item.guid, item.nonce, item.message);
    }

    function setDelegate(address delegate_) external {
        delegate = delegate_;
    }

    function inboundPayloadHash(address, uint32, bytes32, uint64) external pure returns (bytes32) {
        return bytes32(0);
    }

    function lzReceive(Origin calldata, address, bytes32, bytes calldata, bytes calldata) external payable {}

    function deliver(
        address oapp,
        uint32 srcEid,
        address sender,
        bytes32 guid,
        uint64 nonce,
        bytes calldata message
    ) external {
        INixBridgeReceiver(oapp).lzReceive(
            Origin({srcEid: srcEid, sender: bytes32(uint256(uint160(sender))), nonce: nonce}),
            guid,
            message,
            msg.sender,
            ""
        );
    }
}
