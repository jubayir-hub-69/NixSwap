// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {FHE, ebool, euint64, externalEuint64} from "@fhenixprotocol/cofhe-contracts/FHE.sol";

/// @title NixLaunch
/// @notice Sealed-bid token launch. Bids are `euint64` ciphertexts. The homomorphic
///         total and clearing price are published only after the bidding window.
///         Losing bids are never granted to the owner, other bidders, or the public.
/// @dev Clearing price is `basePrice + totalRaised / curveStep`. A bid is filled only
///      when its encrypted limit is at least that price. The filled payment is divided
///      by the price under encryption, so a losing bid stays a sealed ciphertext.
contract NixLaunch {
    using SafeERC20 for IERC20;

    uint256 public constant MAX_BIDDERS = 64;

    IERC20 public immutable paymentToken;
    IERC20 public immutable saleToken;
    uint64 public immutable tokensForSale;
    uint64 public immutable basePrice;
    uint64 public immutable curveStep;
    uint256 public immutable biddingEnd;

    struct Bid {
        euint64 amount;
        euint64 limitPrice;
        bool active;
    }

    mapping(address bidder => Bid bid) private _bids;
    address[] private _bidders;

    euint64 private _totalRaised;
    euint64 private _clearingPriceCt;
    mapping(address bidder => euint64 allocation) private _allocations;
    mapping(address bidder => bool claimed) private _claimed;

    bool public settled;
    bool public finalized;
    uint64 public revealedTotal;
    uint64 public clearingPrice;

    event BidCommitted(address indexed bidder);
    event LaunchSettled();
    event LaunchFinalized(uint64 totalRaised, uint64 clearingPrice);
    event AllocationClaimed(address indexed bidder, uint64 allocation);

    error InvalidSchedule();
    error InvalidCurve();
    error BiddingClosed();
    error BiddingStillActive();
    error BidderCapReached();
    error AlreadySettled();
    error NotSettled();
    error AlreadyFinalized();
    error NotFinalized();
    error NoBid();
    error AlreadyClaimed();
    error InvalidDecryptionProof(bytes32 ctHash);
    error InvalidClearingPrice();
    error InsufficientSaleInventory(uint256 requested, uint256 available);

    constructor(
        IERC20 paymentToken_,
        IERC20 saleToken_,
        uint64 tokensForSale_,
        uint64 basePrice_,
        uint64 curveStep_,
        uint256 biddingEnd_
    ) {
        if (biddingEnd_ <= block.timestamp || tokensForSale_ == 0) revert InvalidSchedule();
        if (basePrice_ == 0 || curveStep_ == 0) revert InvalidCurve();

        paymentToken = paymentToken_;
        saleToken = saleToken_;
        tokensForSale = tokensForSale_;
        basePrice = basePrice_;
        curveStep = curveStep_;
        biddingEnd = biddingEnd_;
    }

    function bidderCount() external view returns (uint256) {
        return _bidders.length;
    }

    /// @notice Total handle. It is uninitialized until `settleLaunch`, and not readable before then.
    function totalRaised() external view returns (euint64) {
        return _totalRaised;
    }

    function clearingPriceHandle() external view returns (euint64) {
        return _clearingPriceCt;
    }

    function bidOf(address bidder) external view returns (euint64 amount, euint64 limitPrice) {
        Bid storage bid = _bids[bidder];
        return (bid.amount, bid.limitPrice);
    }

    function allocationOf(address bidder) external view returns (euint64) {
        return _allocations[bidder];
    }

    /// @notice True if `account` was granted this bidder's amount or limit.
    ///         Public decryption is a separate path and is never enabled for bids.
    function canReadBid(address bidder, address account) external view returns (bool) {
        Bid storage bid = _bids[bidder];
        if (!bid.active) return false;
        return FHE.isAllowed(bid.amount, account) || FHE.isAllowed(bid.limitPrice, account);
    }

    /// @notice True if `account` was granted the homomorphic total.
    function canReadTotal(address account) external view returns (bool) {
        if (!FHE.isInitialized(_totalRaised)) return false;
        return FHE.isAllowed(_totalRaised, account);
    }

    /// @notice Commits an encrypted payment amount and an encrypted max unit price.
    ///         One proof covers both values, in that order. A second call replaces the bid.
    function submitBid(externalEuint64 encryptedAmount, externalEuint64 encryptedLimit, bytes calldata inputProof)
        external
    {
        if (block.timestamp >= biddingEnd || settled) revert BiddingClosed();

        externalEuint64[] memory batch = new externalEuint64[](2);
        batch[0] = encryptedAmount;
        batch[1] = encryptedLimit;
        euint64[] memory values = FHE.asEuint64s(batch, inputProof);

        if (!_bids[msg.sender].active) {
            if (_bidders.length == MAX_BIDDERS) revert BidderCapReached();
            _bidders.push(msg.sender);
        }

        // The contract can add these later. The bidder, the owner, and everyone else cannot.
        FHE.allowThis(values[0]);
        FHE.allowThis(values[1]);
        _bids[msg.sender] = Bid({amount: values[0], limitPrice: values[1], active: true});

        emit BidCommitted(msg.sender);
    }

    /// @notice After the window, sums every bid, derives the clearing price, and writes each
    ///         encrypted allocation. Only the total and the price become publicly decryptable.
    function settleLaunch() external {
        if (block.timestamp < biddingEnd) revert BiddingStillActive();
        if (settled) revert AlreadySettled();
        settled = true;

        euint64 total = FHE.asEuint64(uint256(0));
        uint256 n = _bidders.length;
        for (uint256 i = 0; i < n; ++i) {
            total = FHE.add(total, _bids[_bidders[i]].amount);
        }

        euint64 price = FHE.add(FHE.asEuint64(basePrice), FHE.div(total, FHE.asEuint64(curveStep)));
        _totalRaised = total;
        _clearingPriceCt = price;
        FHE.allowThis(total);
        FHE.allowThis(price);
        FHE.allowPublic(total);
        FHE.allowPublic(price);

        for (uint256 i = 0; i < n; ++i) {
            address bidder = _bidders[i];
            Bid storage bid = _bids[bidder];
            ebool wins = FHE.gte(bid.limitPrice, price);
            euint64 accepted = FHE.select(wins, bid.amount, FHE.asEuint64(uint256(0)));
            euint64 tokens = FHE.div(accepted, price);
            _allocations[bidder] = tokens;
            FHE.allowThis(tokens);
            FHE.allow(tokens, bidder);
        }

        emit LaunchSettled();
    }

    /// @notice Publishes the decrypted total and clearing price. Individual bids are not accepted here.
    function finalizeLaunch(
        uint64 decryptedTotal,
        bytes calldata totalProof,
        uint64 decryptedPrice,
        bytes calldata priceProof
    ) external {
        if (!settled) revert NotSettled();
        if (finalized) revert AlreadyFinalized();
        if (decryptedPrice == 0) revert InvalidClearingPrice();
        if (saleToken.balanceOf(address(this)) < tokensForSale) {
            revert InsufficientSaleInventory(tokensForSale, saleToken.balanceOf(address(this)));
        }

        if (!FHE.verifyDecryptResult(_totalRaised, decryptedTotal, totalProof)) {
            revert InvalidDecryptionProof(euint64.unwrap(_totalRaised));
        }
        if (!FHE.verifyDecryptResult(_clearingPriceCt, decryptedPrice, priceProof)) {
            revert InvalidDecryptionProof(euint64.unwrap(_clearingPriceCt));
        }

        FHE.publishDecryptResult(_totalRaised, decryptedTotal, totalProof);
        FHE.publishDecryptResult(_clearingPriceCt, decryptedPrice, priceProof);

        revealedTotal = decryptedTotal;
        clearingPrice = decryptedPrice;
        finalized = true;

        emit LaunchFinalized(decryptedTotal, decryptedPrice);
    }

    /// @notice Pays `allocation * clearingPrice` and sends the sale tokens.
    ///         A losing allocation is zero, so claiming it does not open the original bid.
    function claim(uint64 decryptedAllocation, bytes calldata allocationProof) external {
        if (!finalized) revert NotFinalized();
        if (_claimed[msg.sender]) revert AlreadyClaimed();
        euint64 allocation = _allocations[msg.sender];
        if (!FHE.isInitialized(allocation)) revert NoBid();
        if (!FHE.verifyDecryptResult(allocation, decryptedAllocation, allocationProof)) {
            revert InvalidDecryptionProof(euint64.unwrap(allocation));
        }

        _claimed[msg.sender] = true;
        FHE.publishDecryptResult(allocation, decryptedAllocation, allocationProof);

        if (decryptedAllocation != 0) {
            uint256 saleBalance = saleToken.balanceOf(address(this));
            if (saleBalance < decryptedAllocation) revert InsufficientSaleInventory(decryptedAllocation, saleBalance);
            uint256 payment = uint256(decryptedAllocation) * clearingPrice;
            paymentToken.safeTransferFrom(msg.sender, address(this), payment);
            saleToken.safeTransfer(msg.sender, decryptedAllocation);
        }

        emit AllocationClaimed(msg.sender, decryptedAllocation);
    }
}
