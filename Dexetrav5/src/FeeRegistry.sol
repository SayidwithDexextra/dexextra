// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title FeeRegistry
 * @dev Centralized fee configuration for all markets. New markets read from this
 *      registry during configuration instead of using hardcoded values.
 * @notice Single source of truth for platform-wide fee parameters
 */
contract FeeRegistry {
    // ============ State Variables ============
    
    address public admin;
    
    // Maker/taker fee structure (in basis points)
    uint256 public takerFeeBps;      // e.g., 7 = 0.07%
    uint256 public makerFeeBps;      // e.g., 3 = 0.03%
    
    // Protocol fee recipient and share
    address public protocolFeeRecipient;
    uint256 public protocolFeeShareBps;  // e.g., 8000 = 80% of fees go to protocol
    
    // Legacy symmetric fee (for backward compatibility)
    uint256 public legacyTradingFeeBps;  // e.g., 10 = 0.10%
    
    // ============ Events ============
    
    event FeeStructureUpdated(
        uint256 takerFeeBps,
        uint256 makerFeeBps,
        address protocolFeeRecipient,
        uint256 protocolFeeShareBps
    );
    
    event LegacyFeeUpdated(uint256 legacyTradingFeeBps);
    
    event AdminUpdated(address indexed oldAdmin, address indexed newAdmin);
    
    // ============ Custom Errors ============
    
    error OnlyAdmin();
    error ZeroAddress();
    error FeeTooHigh();
    error ShareTooHigh();
    
    // ============ Modifiers ============
    
    modifier onlyAdmin() {
        if (msg.sender != admin) revert OnlyAdmin();
        _;
    }
    
    // ============ Constructor ============
    
    constructor(
        address _admin,
        uint256 _takerFeeBps,
        uint256 _makerFeeBps,
        address _protocolFeeRecipient,
        uint256 _protocolFeeShareBps
    ) {
        if (_admin == address(0)) revert ZeroAddress();
        if (_protocolFeeRecipient == address(0)) revert ZeroAddress();
        if (_takerFeeBps > 500) revert FeeTooHigh();      // Max 5%
        if (_makerFeeBps > 500) revert FeeTooHigh();      // Max 5%
        if (_protocolFeeShareBps > 10000) revert ShareTooHigh();
        
        admin = _admin;
        takerFeeBps = _takerFeeBps;
        makerFeeBps = _makerFeeBps;
        protocolFeeRecipient = _protocolFeeRecipient;
        protocolFeeShareBps = _protocolFeeShareBps;
        legacyTradingFeeBps = 10; // Default 0.10%
        
        emit FeeStructureUpdated(_takerFeeBps, _makerFeeBps, _protocolFeeRecipient, _protocolFeeShareBps);
    }
    
    // ============ Admin Functions ============
    
    /**
     * @dev Update the fee structure. All new markets will use these values.
     * @param _takerFeeBps Taker fee in basis points (max 500 = 5%)
     * @param _makerFeeBps Maker fee in basis points (max 500 = 5%)
     * @param _protocolFeeRecipient Address receiving protocol's share of fees
     * @param _protocolFeeShareBps Protocol's share of total fees (max 10000 = 100%)
     */
    function updateFeeStructure(
        uint256 _takerFeeBps,
        uint256 _makerFeeBps,
        address _protocolFeeRecipient,
        uint256 _protocolFeeShareBps
    ) external onlyAdmin {
        if (_protocolFeeRecipient == address(0)) revert ZeroAddress();
        if (_takerFeeBps > 500) revert FeeTooHigh();
        if (_makerFeeBps > 500) revert FeeTooHigh();
        if (_protocolFeeShareBps > 10000) revert ShareTooHigh();
        
        takerFeeBps = _takerFeeBps;
        makerFeeBps = _makerFeeBps;
        protocolFeeRecipient = _protocolFeeRecipient;
        protocolFeeShareBps = _protocolFeeShareBps;
        
        emit FeeStructureUpdated(_takerFeeBps, _makerFeeBps, _protocolFeeRecipient, _protocolFeeShareBps);
    }
    
    /**
     * @dev Update just the protocol fee recipient (convenience function)
     * @param _protocolFeeRecipient New protocol fee recipient address
     */
    function updateProtocolFeeRecipient(address _protocolFeeRecipient) external onlyAdmin {
        if (_protocolFeeRecipient == address(0)) revert ZeroAddress();
        protocolFeeRecipient = _protocolFeeRecipient;
        emit FeeStructureUpdated(takerFeeBps, makerFeeBps, _protocolFeeRecipient, protocolFeeShareBps);
    }
    
    /**
     * @dev Update legacy trading fee for backward compatibility
     * @param _legacyTradingFeeBps Legacy symmetric fee in basis points
     */
    function updateLegacyFee(uint256 _legacyTradingFeeBps) external onlyAdmin {
        if (_legacyTradingFeeBps > 1000) revert FeeTooHigh(); // Max 10%
        legacyTradingFeeBps = _legacyTradingFeeBps;
        emit LegacyFeeUpdated(_legacyTradingFeeBps);
    }
    
    /**
     * @dev Transfer admin role to a new address
     * @param newAdmin New admin address
     */
    function updateAdmin(address newAdmin) external onlyAdmin {
        if (newAdmin == address(0)) revert ZeroAddress();
        address oldAdmin = admin;
        admin = newAdmin;
        emit AdminUpdated(oldAdmin, newAdmin);
    }
    
    // ============ View Functions ============
    
    /**
     * @dev Get the complete fee structure in a single call
     * @return _takerFeeBps Taker fee in basis points
     * @return _makerFeeBps Maker fee in basis points
     * @return _protocolFeeRecipient Protocol fee recipient address
     * @return _protocolFeeShareBps Protocol's share of fees in basis points
     */
    function getFeeStructure() external view returns (
        uint256 _takerFeeBps,
        uint256 _makerFeeBps,
        address _protocolFeeRecipient,
        uint256 _protocolFeeShareBps
    ) {
        return (takerFeeBps, makerFeeBps, protocolFeeRecipient, protocolFeeShareBps);
    }
    
    /**
     * @dev Get all fee parameters including legacy fee
     * @return _takerFeeBps Taker fee in basis points
     * @return _makerFeeBps Maker fee in basis points
     * @return _protocolFeeRecipient Protocol fee recipient address
     * @return _protocolFeeShareBps Protocol's share of fees in basis points
     * @return _legacyTradingFeeBps Legacy symmetric trading fee
     */
    function getAllFeeParameters() external view returns (
        uint256 _takerFeeBps,
        uint256 _makerFeeBps,
        address _protocolFeeRecipient,
        uint256 _protocolFeeShareBps,
        uint256 _legacyTradingFeeBps
    ) {
        return (takerFeeBps, makerFeeBps, protocolFeeRecipient, protocolFeeShareBps, legacyTradingFeeBps);
    }
}
