// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ILayerZeroEndpointV2, MessagingFee, MessagingParams, MessagingReceipt, Origin} from "./bridge/ILayerZeroEndpointV2.sol";
import {LaunchFactory} from "./LaunchFactory.sol";
import {LaunchToken} from "./LaunchToken.sol";
import {NixPair} from "./NixPair.sol";

/// @title NixLaunchpad
/// @notice One signature deploys a fixed-supply omnichain token and seeds its NIX pair.
///         Supply is split across the three supported chains: 2% in each chain's pool
///         (6% in total) and the remaining 94% to the creator on the source chain.
///         `relay` sends a LayerZero message to each peer launchpad. Anyone can then
///         `finalizeRemote` there, which deploys the peer token and adds that chain's 2%.
///         Opening LP shares stay on this contract. The creator does not spend NIX.
contract NixLaunchpad is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant MAX_SUPPLY = 1_000_000_000_000 ether;
    uint256 public constant BPS_DENOMINATOR = 10_000;
    /// @dev 200 bps is 2% of supply, seeded on every supported chain.
    uint256 public constant LIQUIDITY_BPS = 200;
    uint256 public constant CHAIN_COUNT = 3;
    /// @dev NIX paired with one chain's 2% token reserve. Funded ahead of launches via `fundSeed`.
    uint256 public constant SEED_NIX = 100 ether;
    uint128 public constant LAUNCH_LZ_GAS = 350_000;

    IERC20 public immutable nix;
    ILayerZeroEndpointV2 public immutable endpoint;
    LaunchFactory public immutable factory;
    uint32 public immutable localEid;

    struct TokenLaunch {
        address token;
        address pair;
        address creator;
        string name;
        string symbol;
        /// @dev Shared cap for the whole launch. It is not the amount minted on this chain.
        ///      Source `totalSupply` is 94% plus this chain's 2%. Each other chain mints only its 2%.
        uint256 supply;
        uint64 createdAt;
        bool active;
    }

    struct RemoteChain {
        bytes32 peer;
        address endpoint;
        address factory;
        bool set;
    }

    struct Relay {
        bool sent;
        bytes32 guid;
        uint64 nonce;
        address predicted;
    }

    /// @dev Stored by `lzReceive`. `finalizeRemote` is the deploy, so the LayerZero message stays small.
    struct RemoteOrder {
        address creator;
        address sourceToken;
        address predicted;
        uint256 supply;
        uint256 liquidity;
        bool authorized;
        bool finalized;
        string name;
        string symbol;
    }

    TokenLaunch[] private _tokens;
    /// @dev One-based index of the creator's active launch. Zero means none.
    mapping(address creator => uint256 indexPlusOne) private _activeId;
    mapping(uint256 id => bool mirrored) public mirrored;
    mapping(uint32 eid => RemoteChain config) public remotes;
    uint32[] private _remoteEids;
    mapping(uint256 id => mapping(uint32 eid => Relay relay)) public relays;
    mapping(uint32 srcEid => mapping(uint256 srcId => RemoteOrder order)) private _orders;
    mapping(bytes32 guid => bool used) public executed;
    mapping(uint32 srcEid => mapping(bytes32 sender => mapping(uint64 nonce => bool used))) public inboundNonceUsed;

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
    event RemoteSet(uint32 indexed eid, address peer, address endpoint);
    event OmnichainRelayed(
        uint256 indexed id,
        uint32 indexed dstEid,
        bytes32 guid,
        uint64 nonce,
        address predicted,
        uint256 liquidity
    );
    event RemoteAuthorized(uint32 indexed srcEid, uint256 indexed srcId, address predicted, uint256 liquidity);
    event RemoteLaunchSeeded(
        uint32 indexed srcEid,
        uint256 indexed srcId,
        address token,
        address pair,
        uint256 liquidity,
        uint256 seedNix
    );

    error InvalidName();
    error InvalidSymbol();
    error InvalidSupply();
    error ActiveTokenExists(uint256 id);
    error NotCreator(address creator);
    error AlreadyRetired(uint256 id);
    error UnknownToken(uint256 id);
    error ZeroSeed();
    error InsufficientSeed(uint256 available, uint256 required);
    error InvalidEndpoint();
    error InvalidEid(uint32 eid);
    error InvalidPeer();
    error PeerAlreadySet(uint32 eid);
    error PeerNotSet(uint32 eid);
    error RemotesNotConfigured(uint256 configured, uint256 required);
    error OnlyEndpoint(address caller);
    error OnlyPeer(uint32 eid, bytes32 sender);
    error AlreadyExecuted(bytes32 guid);
    error NonceAlreadyUsed(uint32 srcEid, uint64 nonce);
    error AlreadyMirrored(uint256 id);
    error UnexpectedToken(address deployed, address predicted);
    error InsufficientFee(uint256 paid, uint256 required);
    error RefundFailed();
    error PeerMismatch(uint32 eid);
    error FactoryNotArmed();

    constructor(IERC20 nix_, address endpoint_, uint32 localEid_, address factory_, address initialOwner)
        Ownable(initialOwner)
    {
        if (endpoint_.code.length == 0 || factory_.code.length == 0) revert InvalidEndpoint();
        if (localEid_ == 0) revert InvalidEid(localEid_);
        nix = nix_;
        endpoint = ILayerZeroEndpointV2(endpoint_);
        factory = LaunchFactory(factory_);
        if (endpoint.eid() != localEid_) revert InvalidEid(localEid_);
        localEid = localEid_;
        endpoint.setDelegate(initialOwner);
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

    /// @notice Supported chains, the pool share on each, and the creator share on the source chain.
    function chainSlots() external view returns (uint256 slots, uint256 bpsPerChain, uint256 creatorBps) {
        slots = _remoteEids.length + 1;
        bpsPerChain = LIQUIDITY_BPS;
        uint256 totalBps = LIQUIDITY_BPS * slots;
        creatorBps = totalBps >= BPS_DENOMINATOR ? 0 : BPS_DENOMINATOR - totalBps;
    }

    function remoteEidAt(uint256 index) external view returns (uint32) {
        return _remoteEids[index];
    }

    function remoteOrder(uint32 srcEid, uint256 srcId)
        external
        view
        returns (
            address creator,
            address sourceToken,
            address predicted,
            uint256 supply,
            uint256 liquidity,
            bool authorized,
            bool finalized,
            string memory name,
            string memory symbol
        )
    {
        RemoteOrder storage order = _orders[srcEid][srcId];
        return (
            order.creator,
            order.sourceToken,
            order.predicted,
            order.supply,
            order.liquidity,
            order.authorized,
            order.finalized,
            order.name,
            order.symbol
        );
    }

    /// @notice Endpoint ids that still need `relay` for this launch.
    function pendingRemoteEids(uint256 id) external view returns (uint32[] memory eids) {
        if (id >= _tokens.length) revert UnknownToken(id);
        uint256 pending;
        uint256 count = _remoteEids.length;
        for (uint256 i = 0; i < count; i++) {
            if (!relays[id][_remoteEids[i]].sent) pending += 1;
        }
        eids = new uint32[](pending);
        uint256 cursor;
        for (uint256 i = 0; i < count; i++) {
            uint32 eid = _remoteEids[i];
            if (relays[id][eid].sent) continue;
            eids[cursor] = eid;
            cursor += 1;
        }
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

    /// @notice Registers one other chain. The first wiring is permanent. Call once per remote chain.
    function setRemote(uint32 eid, address peer, address remoteEndpoint, address remoteFactory) external onlyOwner {
        if (eid == 0 || eid == localEid) revert InvalidEid(eid);
        if (peer == address(0) || peer == address(this) || remoteEndpoint == address(0) || remoteFactory == address(0)) {
            revert InvalidPeer();
        }
        if (remotes[eid].set) revert PeerAlreadySet(eid);
        remotes[eid] = RemoteChain({
            peer: bytes32(uint256(uint160(peer))),
            endpoint: remoteEndpoint,
            factory: remoteFactory,
            set: true
        });
        _remoteEids.push(eid);
        emit RemoteSet(eid, peer, remoteEndpoint);
    }

    /// @notice The creator's current active launch, if they still have one.
    function activeLaunchOf(address creator) external view returns (bool active, uint256 id) {
        uint256 pointer = _activeId[creator];
        if (pointer == 0) return (false, 0);
        id = pointer - 1;
        active = _tokens[id].active;
    }

    /// @notice Deploys the source token, mints 94% to the caller, and seeds this chain's pair
    ///         with 2% plus `SEED_NIX`. The other 4% is minted later, 2% on each peer, and nowhere
    ///         is the shared cap minted a second time.
    function createToken(string calldata name_, string calldata symbol_, uint256 supply)
        external
        returns (uint256 id, address token, address pair)
    {
        _checkLaunch(name_, symbol_, supply);
        (uint256 creatorAmount, uint256 liquidityTokens) = _split(supply);
        LaunchToken created = LaunchToken(
            factory.deployToken(name_, symbol_, creatorAmount, liquidityTokens, msg.sender, address(endpoint), localEid)
        );
        _requireLocalMint(created, msg.sender, creatorAmount, liquidityTokens, supply);
        NixPair createdPair = NixPair(factory.deployPair(nix, IERC20(address(created))));
        id = _record(address(created), address(createdPair), name_, symbol_, supply, msg.sender, true, false);
        _seed(created, createdPair, liquidityTokens);
        token = address(created);
        pair = address(createdPair);
        emit TokenLaunched(id, msg.sender, token, pair);
        emit LaunchSeeded(id, creatorAmount, liquidityTokens, SEED_NIX, createdPair.priceX18());
    }

    /// @notice LayerZero fee to authorize every remote pool that has not been relayed yet.
    function quoteRelay(uint256 id) external view returns (uint256 nativeFee) {
        if (id >= _tokens.length) revert UnknownToken(id);
        uint256 count = _remoteEids.length;
        for (uint256 i = 0; i < count; i++) {
            uint32 eid = _remoteEids[i];
            if (relays[id][eid].sent) continue;
            MessagingFee memory fee = endpoint.quote(_relayParams(id, eid), address(this));
            if (fee.lzTokenFee != 0) revert InsufficientFee(0, fee.nativeFee);
            nativeFee += fee.nativeFee;
        }
    }

    /// @notice Pays LayerZero to authorize this launch on every peer launchpad. Anyone can call it.
    function relay(uint256 id) external payable nonReentrant returns (uint256 spent) {
        if (id >= _tokens.length) revert UnknownToken(id);
        if (mirrored[id]) revert AlreadyMirrored(id);
        uint256 count = _remoteEids.length;
        for (uint256 i = 0; i < count; i++) {
            uint32 eid = _remoteEids[i];
            if (relays[id][eid].sent) continue;
            address predicted = predictRemoteToken(id, eid);
            _linkSourcePeer(id, eid, predicted);
            MessagingParams memory params = _relayParams(id, eid);
            MessagingFee memory fee = endpoint.quote(params, address(this));
            if (fee.lzTokenFee != 0 || msg.value < spent + fee.nativeFee) {
                revert InsufficientFee(msg.value, spent + fee.nativeFee);
            }
            MessagingReceipt memory receipt = endpoint.send{value: fee.nativeFee}(params, msg.sender);
            spent += fee.nativeFee;
            relays[id][eid] = Relay({sent: true, guid: receipt.guid, nonce: receipt.nonce, predicted: predicted});
            emit OmnichainRelayed(id, eid, receipt.guid, receipt.nonce, predicted, _perChain(_tokens[id].supply));
        }
        uint256 refund = msg.value - spent;
        if (refund != 0) {
            (bool ok,) = msg.sender.call{value: refund}("");
            if (!ok) revert RefundFailed();
        }
    }

    /// @notice Address the peer launchpad will deploy for this launch. The source token's peer is this address.
    function predictRemoteToken(uint256 id, uint32 dstEid) public view returns (address) {
        if (id >= _tokens.length) revert UnknownToken(id);
        RemoteChain storage remote = remotes[dstEid];
        if (!remote.set) revert PeerNotSet(dstEid);
        TokenLaunch storage launch = _tokens[id];
        return factory.predictRemoteToken(
            remote.factory,
            keccak256(abi.encode(localEid, id)),
            launch.name,
            launch.symbol,
            _perChain(launch.supply),
            address(uint160(uint256(remote.peer))),
            remote.endpoint,
            dstEid
        );
    }

    function allowInitializePath(Origin calldata origin) external view returns (bool) {
        return origin.sender != bytes32(0) && remotes[origin.srcEid].set && remotes[origin.srcEid].peer == origin.sender;
    }

    function nextNonce(uint32, bytes32) external pure returns (uint64) {
        return 0;
    }

    /// @notice Records a peer launch. The deploy itself is `finalizeRemote`, after this chain holds `SEED_NIX`.
    function lzReceive(
        Origin calldata origin,
        bytes32 guid,
        bytes calldata message,
        address,
        bytes calldata
    ) external payable nonReentrant {
        if (msg.sender != address(endpoint)) revert OnlyEndpoint(msg.sender);
        RemoteChain storage remote = remotes[origin.srcEid];
        if (!remote.set || remote.peer != origin.sender) revert OnlyPeer(origin.srcEid, origin.sender);
        if (executed[guid]) revert AlreadyExecuted(guid);
        if (inboundNonceUsed[origin.srcEid][origin.sender][origin.nonce]) {
            revert NonceAlreadyUsed(origin.srcEid, origin.nonce);
        }

        executed[guid] = true;
        inboundNonceUsed[origin.srcEid][origin.sender][origin.nonce] = true;
        _authorize(origin.srcEid, message);
    }

    /// @notice Deploys the authorized peer token and seeds its NIX pair with that chain's 2%.
    ///         The new token's `totalSupply` is only that pool share. The shared cap stays on the source record.
    function finalizeRemote(uint32 srcEid, uint256 srcId) external nonReentrant returns (address token, address pair) {
        RemoteOrder storage order = _orders[srcEid][srcId];
        if (!order.authorized) revert UnknownToken(srcId);
        if (order.finalized) revert AlreadyMirrored(srcId);
        uint256 available = nix.balanceOf(address(this));
        if (available < SEED_NIX) revert InsufficientSeed(available, SEED_NIX);

        uint256 liquidity = _perChain(order.supply);
        if (liquidity != order.liquidity || liquidity >= order.supply) revert InvalidSupply();
        bytes32 salt = keccak256(abi.encode(srcEid, srcId));
        LaunchToken created = LaunchToken(
            factory.deployRemoteToken(salt, order.name, order.symbol, liquidity, address(endpoint), localEid)
        );
        if (created.totalSupply() != liquidity || created.balanceOf(address(this)) != liquidity) revert InvalidSupply();
        if (address(created) != order.predicted) revert UnexpectedToken(address(created), order.predicted);
        created.setPeer(srcEid, bytes32(uint256(uint160(order.sourceToken))));

        NixPair createdPair = NixPair(factory.deployPair(nix, IERC20(address(created))));
        _seed(created, createdPair, order.liquidity);
        order.finalized = true;
        _record(address(created), address(createdPair), order.name, order.symbol, order.supply, order.creator, false, true);
        token = address(created);
        pair = address(createdPair);
        emit RemoteLaunchSeeded(srcEid, srcId, token, pair, order.liquidity, SEED_NIX);
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

    function _checkLaunch(string calldata name_, string calldata symbol_, uint256 supply) internal view {
        _checkName(name_, symbol_);
        if (factory.launchpad() != address(this)) revert FactoryNotArmed();
        if (supply == 0 || supply > MAX_SUPPLY) revert InvalidSupply();
        uint256 slots = _remoteEids.length + 1;
        if (slots != CHAIN_COUNT) revert RemotesNotConfigured(slots, CHAIN_COUNT);
        uint256 available = nix.balanceOf(address(this));
        if (available < SEED_NIX) revert InsufficientSeed(available, SEED_NIX);
        uint256 pointer = _activeId[msg.sender];
        if (pointer != 0 && _tokens[pointer - 1].active) revert ActiveTokenExists(pointer - 1);
    }

    struct Incoming {
        uint256 srcId;
        string name;
        string symbol;
        uint256 supply;
        uint256 liquidity;
        address sourceToken;
        address creator;
        address predicted;
    }

    function _authorize(uint32 srcEid, bytes calldata message) internal {
        Incoming memory incoming = _decodeOrder(message);
        _storeOrder(srcEid, incoming);
    }

    function _decodeOrder(bytes calldata message) private pure returns (Incoming memory incoming) {
        (
            incoming.srcId,
            incoming.name,
            incoming.symbol,
            incoming.supply,
            incoming.liquidity,
            incoming.sourceToken,
            incoming.creator,
            incoming.predicted
        ) = abi.decode(message, (uint256, string, string, uint256, uint256, address, address, address));
    }

    function _storeOrder(uint32 srcEid, Incoming memory incoming) private {
        _checkName(incoming.name, incoming.symbol);
        if (incoming.supply == 0 || incoming.supply > MAX_SUPPLY || incoming.liquidity != _perChain(incoming.supply)) {
            revert InvalidSupply();
        }
        if (incoming.sourceToken == address(0) || incoming.creator == address(0) || incoming.predicted == address(0)) {
            revert InvalidPeer();
        }
        if (_orders[srcEid][incoming.srcId].authorized) revert AlreadyMirrored(incoming.srcId);

        RemoteOrder storage order = _orders[srcEid][incoming.srcId];
        order.creator = incoming.creator;
        order.sourceToken = incoming.sourceToken;
        order.predicted = incoming.predicted;
        order.supply = incoming.supply;
        order.liquidity = incoming.liquidity;
        order.authorized = true;
        order.name = incoming.name;
        order.symbol = incoming.symbol;
        emit RemoteAuthorized(srcEid, incoming.srcId, incoming.predicted, incoming.liquidity);
    }

    function _checkName(string memory name_, string memory symbol_) internal pure {
        uint256 nameLength = bytes(name_).length;
        uint256 symbolLength = bytes(symbol_).length;
        if (nameLength == 0 || nameLength > 32) revert InvalidName();
        if (symbolLength == 0 || symbolLength > 11) revert InvalidSymbol();
    }

    /// @dev A source launch mints the creator share plus one pool share, which is less than the cap.
    ///      A remote launch never reaches this helper with a creator balance.
    function _requireLocalMint(
        LaunchToken created,
        address creator,
        uint256 creatorAmount,
        uint256 liquidityTokens,
        uint256 supply
    ) internal view {
        if (created.totalSupply() != creatorAmount + liquidityTokens) revert InvalidSupply();
        if (created.balanceOf(creator) != creatorAmount) revert InvalidSupply();
        if (created.balanceOf(address(this)) != liquidityTokens) revert InvalidSupply();
        if (created.totalSupply() >= supply) revert InvalidSupply();
    }

    function _split(uint256 supply) internal pure returns (uint256 creatorAmount, uint256 liquidityTokens) {
        liquidityTokens = _perChain(supply);
        uint256 totalLiquidity = liquidityTokens * CHAIN_COUNT;
        if (totalLiquidity >= supply) revert InvalidSupply();
        creatorAmount = supply - totalLiquidity;
    }

    function _perChain(uint256 supply) internal pure returns (uint256 liquidityTokens) {
        liquidityTokens = supply * LIQUIDITY_BPS / BPS_DENOMINATOR;
        if (liquidityTokens == 0) revert InvalidSupply();
    }

    function _record(
        address token,
        address pair,
        string memory name_,
        string memory symbol_,
        uint256 supply,
        address creator,
        bool active,
        bool isMirror
    ) internal returns (uint256 id) {
        id = _tokens.length;
        _tokens.push(
            TokenLaunch({
                token: token,
                pair: pair,
                creator: creator,
                name: name_,
                symbol: symbol_,
                supply: supply,
                createdAt: uint64(block.timestamp),
                active: active
            })
        );
        mirrored[id] = isMirror;
        if (active) _activeId[creator] = id + 1;
    }

    function _seed(LaunchToken created, NixPair createdPair, uint256 liquidityTokens) internal {
        IERC20(address(created)).forceApprove(address(createdPair), liquidityTokens);
        nix.forceApprove(address(createdPair), SEED_NIX);
        createdPair.addLiquidity(SEED_NIX, liquidityTokens);
    }

    function _linkSourcePeer(uint256 id, uint32 eid, address predicted) internal {
        LaunchToken token = LaunchToken(_tokens[id].token);
        bytes32 peer = bytes32(uint256(uint160(predicted)));
        bytes32 current = token.peers(eid);
        if (current == bytes32(0)) {
            token.setPeer(eid, peer);
            return;
        }
        if (current != peer) revert PeerMismatch(eid);
    }

    function _relayParams(uint256 id, uint32 dstEid) internal view returns (MessagingParams memory) {
        TokenLaunch storage launch = _tokens[id];
        RemoteChain storage remote = remotes[dstEid];
        if (!remote.set) revert PeerNotSet(dstEid);
        uint256 liquidity = _perChain(launch.supply);
        address predicted = factory.predictRemoteToken(
            remote.factory,
            keccak256(abi.encode(localEid, id)),
            launch.name,
            launch.symbol,
            liquidity,
            address(uint160(uint256(remote.peer))),
            remote.endpoint,
            dstEid
        );
        return MessagingParams({
            dstEid: dstEid,
            receiver: remote.peer,
            message: abi.encode(id, launch.name, launch.symbol, launch.supply, liquidity, launch.token, launch.creator, predicted),
            options: abi.encodePacked(uint16(3), uint8(1), uint16(17), uint8(1), LAUNCH_LZ_GAS),
            payInLzToken: false
        });
    }

    function _transferOwnership(address newOwner) internal override {
        super._transferOwnership(newOwner);
        if (address(endpoint) != address(0)) endpoint.setDelegate(newOwner);
    }
}
