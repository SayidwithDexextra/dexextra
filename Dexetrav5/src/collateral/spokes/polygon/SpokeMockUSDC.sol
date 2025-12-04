// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title SpokeMockUSDC
 * @dev Mock USDC token for spoke chains (e.g., Arbitrum/Polygon) mirroring MockUSDC behavior
 * @notice 6 decimals to match real USDC
 */
contract SpokeMockUSDC is ERC20, ERC20Permit, Ownable {
    uint8 private constant DECIMALS = 6;

    event Mint(address indexed to, uint256 amount);
    event Burn(address indexed from, uint256 amount);

    constructor(address initialOwner)
        ERC20("Mock USD Coin", "USDC")
        ERC20Permit("Mock USD Coin")
        Ownable(initialOwner)
    {
        _mint(initialOwner, 1_000_000_000 * 10**DECIMALS); // 1B initial supply
    }

    function decimals() public pure override returns (uint8) {
        return DECIMALS;
    }

    function mint(address to, uint256 amount) external onlyOwner {
        require(to != address(0), "MockUSDC: mint to zero address");
        require(amount > 0, "MockUSDC: mint amount must be greater than 0");
        _mint(to, amount);
        emit Mint(to, amount);
    }

    function burnFrom(address from, uint256 amount) external {
        require(from != address(0), "MockUSDC: burn from zero address");
        require(amount > 0, "MockUSDC: burn amount must be greater than 0");
        uint256 currentAllowance = allowance(from, msg.sender);
        require(currentAllowance >= amount, "MockUSDC: burn amount exceeds allowance");
        _approve(from, msg.sender, currentAllowance - amount);
        _burn(from, amount);
        emit Burn(from, amount);
    }

    function burn(uint256 amount) external {
        require(amount > 0, "MockUSDC: burn amount must be greater than 0");
        _burn(msg.sender, amount);
        emit Burn(msg.sender, amount);
    }

    function faucet(uint256 amount) external {
        require(amount > 0, "MockUSDC: faucet amount must be greater than 0");
        _mint(msg.sender, amount);
        emit Mint(msg.sender, amount);
    }
}





