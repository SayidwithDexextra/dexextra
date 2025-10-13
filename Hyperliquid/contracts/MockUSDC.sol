// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MockUSDC
 * @dev Mock USDC token for testing purposes with unlimited minting capability
 * This contract simulates USDC functionality for the Hyperliquid orderbook protocol
 */
contract MockUSDC is ERC20, Ownable {
    uint8 private _decimals;
    
    /**
     * @dev Constructor that sets the token name, symbol, and decimals
     * @param initialOwner The initial owner of the contract
     */
    constructor(address initialOwner) 
        ERC20("Mock USDC", "mUSDC") 
        Ownable(initialOwner)
    {
        _decimals = 6; // USDC has 6 decimals
    }
    
    /**
     * @dev Returns the number of decimals used to get its user representation
     * @return The number of decimals (6 for USDC)
     */
    function decimals() public view virtual override returns (uint8) {
        return _decimals;
    }
    
    /**
     * @dev Mints tokens to a specified address
     * @param to The address to mint tokens to
     * @param amount The amount of tokens to mint (in wei, considering decimals)
     */
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
    
    /**
     * @dev Mints tokens to multiple addresses in a single transaction
     * @param recipients Array of addresses to mint tokens to
     * @param amounts Array of amounts corresponding to each recipient
     */
    function mintBatch(address[] calldata recipients, uint256[] calldata amounts) external onlyOwner {
        require(recipients.length == amounts.length, "MockUSDC: arrays length mismatch");
        
        for (uint256 i = 0; i < recipients.length; i++) {
            _mint(recipients[i], amounts[i]);
        }
    }
    
    /**
     * @dev Allows anyone to mint tokens for testing purposes
     * @param amount The amount of tokens to mint to the caller
     * Note: This is for testing only and should not be used in production
     */
    function faucet(uint256 amount) external {
        require(amount <= 1000000 * 10**_decimals, "MockUSDC: faucet limit exceeded"); // Max 1M USDC per call
        _mint(msg.sender, amount);
    }
    
    /**
     * @dev Burns tokens from the caller's balance
     * @param amount The amount of tokens to burn
     */
    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }
    
    /**
     * @dev Burns tokens from a specified address (requires allowance)
     * @param from The address to burn tokens from
     * @param amount The amount of tokens to burn
     */
    function burnFrom(address from, uint256 amount) external {
        _spendAllowance(from, msg.sender, amount);
        _burn(from, amount);
    }
    
    /**
     * @dev Emergency function to pause/unpause transfers (for testing scenarios)
     */
    bool private _paused;
    
    function setPaused(bool pausedState) external onlyOwner {
        _paused = pausedState;
    }
    
    function paused() external view returns (bool) {
        return _paused;
    }
    
    /**
     * @dev Override transfer to include pause functionality
     */
    function _update(address from, address to, uint256 value) internal virtual override {
        require(!_paused || from == address(0) || to == address(0), "MockUSDC: transfers paused");
        super._update(from, to, value);
    }
}
