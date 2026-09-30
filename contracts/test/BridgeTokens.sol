// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {NixBridge} from "../NixBridge.sol";

contract TestERC20 is ERC20 {
    uint8 private immutable _decimals;

    constructor(string memory name_, string memory symbol_, uint8 decimals_) ERC20(name_, symbol_) {
        _decimals = decimals_;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }
}

/// @notice Takes a 1% fee from the sender so the bridge receives less than the approved amount.
contract FeeOnTransferERC20 is ERC20 {
    constructor() ERC20("Fee Token", "FEE") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        uint256 fee = amount / 100;
        _spendAllowance(from, _msgSender(), amount);
        _transfer(from, to, amount - fee);
        return true;
    }
}

contract ReenteringERC20 is ERC20 {
    address public bridge;
    bytes public payload;
    uint256 public attacks;

    constructor() ERC20("Reentrant", "REENT") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setAttack(address bridge_, bytes calldata payload_) external {
        bridge = bridge_;
        payload = payload_;
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        if (bridge != address(0) && payload.length != 0) {
            attacks += 1;
            address target = bridge;
            bytes memory data = payload;
            bridge = address(0);
            (bool ok,) = target.call(data);
            if (ok) revert("reentered");
        }
        return super.transfer(to, amount);
    }
}

contract RejectingSender {
    constructor() payable {}

    function approveAndSend(
        address token,
        address bridge,
        uint32 dstEid,
        bytes32 tokenId,
        uint256 amount,
        address recipient
    ) external payable {
        IERC20(token).approve(bridge, amount);
        NixBridge(payable(bridge)).send{value: msg.value}(dstEid, tokenId, amount, recipient);
    }
}
