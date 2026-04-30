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
    
    // Gas fee configuration (charged to takers to reimburse relayer gas costs)
    uint256 public hypeUsdcRate6;   // HYPE price in USDC (6 decimals), e.g., 25_000000 = $25 per HYPE
    uint256 public maxGasFee6;      // Cap on gas fee in USDC (6 decimals), e.g., 1_000000 = $1 max
    uint256 public gasEstimate;     // Estimated gas units per trade, e.g., 2_000_000 for ~2x actual
    uint256 public gasPriceWei;     // Fixed gas price in wei (0 = use tx.gasprice), e.g., 100_000_000 = 0.1 gwei
    
    // ============ Events ============
    
    event FeeStructureUpdated(
        uint256 takerFeeBps,
        uint256 makerFeeBps,
        address protocolFeeRecipient,
        uint256 protocolFeeShareBps
    );
    
    event LegacyFeeUpdated(uint256 legacyTradingFeeBps);
    
    event GasFeeConfigUpdated(uint256 hypeUsdcRate6, uint256 maxGasFee6, uint256 gasEstimate, uint256 gasPriceWei);
    
    event AdminUpdated(address indexed oldAdmin, address indexed newAdmin);
    
    // Centralized gas fee event - emitted from FeeRegistry so webhooks only need to watch one address
    event GasFeeCharged(address indexed market, address indexed trader, uint256 gasFee6, bool isMaker);
    
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
        gasEstimate = 2_000_000;  // Default ~2x typical trade gas (~1M actual)
        
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
    
    /**
     * @dev Update gas fee configuration (charged to takers for relayer reimbursement)
     * @param _hypeUsdcRate6 HYPE price in USDC (6 decimals). Set to 0 to disable gas fees.
     * @param _maxGasFee6 Maximum gas fee in USDC (6 decimals)
     * @param _gasEstimate Estimated gas units per trade (e.g., 800_000 for typical trade)
     * @param _gasPriceWei Fixed gas price in wei (0 = use tx.gasprice), e.g., 100_000_000 = 0.1 gwei
     */
    function updateGasFeeConfig(uint256 _hypeUsdcRate6, uint256 _maxGasFee6, uint256 _gasEstimate, uint256 _gasPriceWei) external onlyAdmin {
        if (_hypeUsdcRate6 > 1000_000000) revert FeeTooHigh(); // Max $1000/HYPE
        if (_maxGasFee6 > 10_000000) revert FeeTooHigh();      // Max $10 gas fee
        if (_gasEstimate > 50_000_000) revert FeeTooHigh();    // Max 50M gas units
        if (_gasPriceWei > 100_000_000_000) revert FeeTooHigh(); // Max 100 gwei
        hypeUsdcRate6 = _hypeUsdcRate6;
        maxGasFee6 = _maxGasFee6;
        gasEstimate = _gasEstimate;
        gasPriceWei = _gasPriceWei;
        emit GasFeeConfigUpdated(_hypeUsdcRate6, _maxGasFee6, _gasEstimate, _gasPriceWei);
    }
    
    // ============ View Functions ============
    
    /**
     * @dev Emit a centralized GasFeeCharged event. Called by order book facets after charging gas fees.
     *      This allows webhooks to watch a single address (FeeRegistry) instead of every market.
     * @param market The market/order book address where the fee was charged
     * @param trader The trader who paid the gas fee
     * @param gasFee6 The gas fee amount in USDC (6 decimals)
     * @param isMaker True if this is a maker (order placement), false if taker (trade execution)
     */
    function emitGasFee(address market, address trader, uint256 gasFee6, bool isMaker) external {
        emit GasFeeCharged(market, trader, gasFee6, isMaker);
    }
    
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
    
    /**
     * @dev Get gas fee configuration
     * @return _hypeUsdcRate6 HYPE price in USDC (6 decimals)
     * @return _maxGasFee6 Maximum gas fee in USDC (6 decimals)
     * @return _gasEstimate Estimated gas units per trade
     * @return _gasPriceWei Fixed gas price in wei (0 = use tx.gasprice)
     */
    function getGasFeeConfig() external view returns (
        uint256 _hypeUsdcRate6,
        uint256 _maxGasFee6,
        uint256 _gasEstimate,
        uint256 _gasPriceWei
    ) {
        return (hypeUsdcRate6, maxGasFee6, gasEstimate, gasPriceWei);
    }
}
