// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockUSDC
 * @dev Mock USDC token with unlimited minting capabilities for testing
 * @notice This contract allows ANY address to mint unlimited tokens - FOR TESTING ONLY!
 * @dev DO NOT USE IN PRODUCTION - This contract has no access controls
 */
contract MockUSDC is ERC20 {
    uint8 private _decimals;

    /**
     * @dev Constructor sets up the token with USDC-like properties
     */
    constructor() ERC20("Mock USD Coin", "USDC") {
        _decimals = 6; // USDC uses 6 decimals
    }

    /**
     * @dev Returns the number of decimals used for token amounts
     * @return The number of decimals (6 for USDC compatibility)
     */
    function decimals() public view virtual override returns (uint8) {
        return _decimals;
    }

    /**
     * @dev Allows anyone to mint unlimited tokens to any address
     * @param to The address to mint tokens to
     * @param amount The amount of tokens to mint (in token units, not wei)
     * @notice NO ACCESS CONTROL - Anyone can call this function
     */
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    /**
     * @dev Allows anyone to mint tokens to themselves
     * @param amount The amount of tokens to mint to msg.sender
     */
    function mintToSelf(uint256 amount) external {
        _mint(msg.sender, amount);
    }

    /**
     * @dev Convenience function to mint a standard amount (1000 USDC)
     * @param to The address to mint tokens to
     */
    function mintStandard(address to) external {
        _mint(to, 1000 * 10**_decimals); // 1000 USDC
    }

    /**
     * @dev Convenience function to mint 1000 USDC to caller
     */
    function faucet() external {
        _mint(msg.sender, 1000 * 10**_decimals); // 1000 USDC
    }

    /**
     * @dev Convenience function to mint a large amount (1M USDC)
     * @param to The address to mint tokens to
     */
    function mintLarge(address to) external {
        _mint(to, 1000000 * 10**_decimals); // 1M USDC
    }

    /**
     * @dev Allows anyone to burn their own tokens
     * @param amount The amount of tokens to burn
     */
    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }

    /**
     * @dev Allows anyone to burn tokens from any address (with allowance)
     * @param from The address to burn tokens from
     * @param amount The amount of tokens to burn
     */
    function burnFrom(address from, uint256 amount) external {
        uint256 currentAllowance = allowance(from, msg.sender);
        require(currentAllowance >= amount, "MockUSDC: burn amount exceeds allowance");
        
        _approve(from, msg.sender, currentAllowance - amount);
        _burn(from, amount);
    }

    /**
     * @dev Batch mint to multiple addresses
     * @param recipients Array of addresses to mint to
     * @param amounts Array of amounts to mint (must match recipients length)
     */
    function batchMint(address[] calldata recipients, uint256[] calldata amounts) external {
        require(recipients.length == amounts.length, "MockUSDC: arrays length mismatch");
        
        for (uint256 i = 0; i < recipients.length; i++) {
            _mint(recipients[i], amounts[i]);
        }
    }

    /**
     * @dev Mint equal amounts to multiple addresses
     * @param recipients Array of addresses to mint to
     * @param amount Amount to mint to each address
     */
    function batchMintEqual(address[] calldata recipients, uint256 amount) external {
        for (uint256 i = 0; i < recipients.length; i++) {
            _mint(recipients[i], amount);
        }
    }

    /**
     * @dev Emergency function to mint maximum possible amount
     * @param to Address to mint to
     * @notice Mints type(uint256).max tokens - use with extreme caution!
     */
    function mintMax(address to) external {
        _mint(to, type(uint256).max);
    }

    /**
     * @dev Get formatted balance (useful for frontend display)
     * @param account Address to check balance for
     * @return Formatted balance as a string with proper decimals
     */
    function getFormattedBalance(address account) external view returns (string memory) {
        uint256 balance = balanceOf(account);
        uint256 wholePart = balance / (10**_decimals);
        uint256 fractionalPart = balance % (10**_decimals);
        
        return string(abi.encodePacked(
            _toString(wholePart),
            ".",
            _padZeros(fractionalPart, _decimals)
        ));
    }

    /**
     * @dev Airdrop tokens to a list of addresses (equal amounts)
     * @param recipients List of addresses to airdrop to
     * @param amountPerRecipient Amount to give each recipient
     */
    function airdrop(address[] calldata recipients, uint256 amountPerRecipient) external {
        for (uint256 i = 0; i < recipients.length; i++) {
            _mint(recipients[i], amountPerRecipient);
        }
    }

    // Internal helper functions

    /**
     * @dev Convert uint256 to string
     */
    function _toString(uint256 value) internal pure returns (string memory) {
        if (value == 0) {
            return "0";
        }
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) {
            digits++;
            temp /= 10;
        }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits -= 1;
            buffer[digits] = bytes1(uint8(48 + uint256(value % 10)));
            value /= 10;
        }
        return string(buffer);
    }

    /**
     * @dev Pad zeros to fractional part
     */
    function _padZeros(uint256 value, uint8 targetDecimals) internal pure returns (string memory) {
        string memory valueStr = _toString(value);
        bytes memory valueBytes = bytes(valueStr);
        bytes memory result = new bytes(targetDecimals);
        
        // Fill with leading zeros
        for (uint256 i = 0; i < targetDecimals - valueBytes.length; i++) {
            result[i] = "0";
        }
        
        // Copy actual value
        for (uint256 i = 0; i < valueBytes.length; i++) {
            result[targetDecimals - valueBytes.length + i] = valueBytes[i];
        }
        
        return string(result);
    }

    // View functions for testing and debugging

    /**
     * @dev Get total supply in human readable format
     */
    function totalSupplyFormatted() external view returns (string memory) {
        return _toString(totalSupply()); // Using _toString function
    }

    /**
     * @dev Check if address has sufficient balance
     * @param account Address to check
     * @param amount Amount to check against
     * @return Whether account has sufficient balance
     */
    function hasSufficientBalance(address account, uint256 amount) external view returns (bool) {
        return balanceOf(account) >= amount;
    }

    /**
     * @dev Get balance in smallest unit (wei equivalent for USDC)
     * @param account Address to check
     * @return Balance in smallest unit
     */
    function balanceOfRaw(address account) external view returns (uint256) {
        return balanceOf(account);
    }

    /**
     * @dev Convert human readable amount to raw amount
     * @param humanAmount Amount in human readable format (e.g., 100 for 100 USDC)
     * @return Raw amount with proper decimals
     */
    function toRawAmount(uint256 humanAmount) external view returns (uint256) {
        return humanAmount * (10**_decimals);
    }

    /**
     * @dev Convert raw amount to human readable amount
     * @param rawAmount Raw amount with decimals
     * @return Human readable amount
     */
    function toHumanAmount(uint256 rawAmount) external view returns (uint256) {
        return rawAmount / (10**_decimals);
    }

    // Events for better tracking (optional)
    event MassAirdrop(address indexed sender, uint256 recipientCount, uint256 totalAmount);
    event FaucetUsed(address indexed user, uint256 amount);

    /**
     * @dev Enhanced faucet with event
     */
    function faucetWithEvent() external {
        uint256 amount = 1000 * 10**_decimals;
        _mint(msg.sender, amount);
        emit FaucetUsed(msg.sender, amount);
    }

    /**
     * @dev Enhanced airdrop with event
     */
    function airdropWithEvent(address[] calldata recipients, uint256 amountPerRecipient) external {
        uint256 totalAmount = 0;
        for (uint256 i = 0; i < recipients.length; i++) {
            _mint(recipients[i], amountPerRecipient);
            totalAmount += amountPerRecipient;
        }
        emit MassAirdrop(msg.sender, recipients.length, totalAmount);
    }
}
