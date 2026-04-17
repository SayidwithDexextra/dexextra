// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./diamond/Diamond.sol";
import "./diamond/interfaces/IDiamondCut.sol";
import "./CoreVault.sol";

interface IOBAdminFacet {
    function updateTradingParameters(uint256 _marginRequirementBps, uint256 _tradingFee, address _feeRecipient) external;
    function enableLeverage(uint256 _maxLeverage, uint256 _marginRequirementBps) external;
    function disableLeverage() external;
    function setLeverageController(address _newController) external;
}

interface IOBViewFacet {
    function getLeverageInfo() external view returns (bool enabled, uint256 maxLev, uint256 marginReq, address controller);
}

interface IOptimisticOracleV3 {
    function requestPrice(
        bytes32 identifier,
        uint256 timestamp,
        bytes memory ancillaryData,
        address currency,
        uint256 reward
    ) external returns (bytes32 requestId);
    
    function settleRequest(bytes32 requestId) external;
    function getPrice(bytes32 requestId) external view returns (int256);
}

interface IPriceOracle {
    function getPrice(bytes32 identifier) external view returns (uint256 price, uint256 timestamp);
    function requestPriceUpdate(bytes32 identifier, string memory metricUrl) external;
}

error OnlyAdmin();
error MarketCreationRestricted();
error InvalidMarketSymbol();
error InvalidMetricUrl();
error InvalidSettlementDate();
error ZeroAddress();
error InvalidInput();
error MarketIdCollision();
error MarketNotFound();
error NotAuthorized();
error OracleNotConfigured();
error SettlementNotReady();
error UmaRequestMissing();
error MarketAlreadySettledErr();
error InvalidOraclePrice();
error InvalidFinalPrice();
error InvalidMarginRequirement();
error TradingFeeTooHigh();
error InvalidLeverage();
error MarginTooLowForLeverage();
error RewardMustBePositive();
error ReasonRequired();
error UseCreateMarketDiamond();

/**
 * @title FuturesMarketFactory (Legacy)
 * @dev Factory contract for creating custom futures markets with dedicated OrderBooks
 * @notice This is a legacy version without bond manager support
 */
contract FuturesMarketFactory {
    CoreVault immutable vault;
    address admin;
    address feeRecipient;
    
    uint256 defaultMarginRequirementBps = 10000;
    uint256 defaultTradingFee = 10;
    bool defaultLeverageEnabled = false;
    
    mapping(bytes32 => address) internal marketToOrderBook;
    mapping(address => bytes32) internal orderBookToMarket;
    mapping(bytes32 => bool) internal marketExists;
    mapping(bytes32 => address) internal marketCreators;
    mapping(bytes32 => string) internal marketSymbols;
    mapping(bytes32 => string) internal marketMetricUrls;
    mapping(bytes32 => uint256) internal marketSettlementDates;
    mapping(bytes32 => address) internal marketOracles;
    mapping(bytes32 => bytes32) internal umaRequestIds;
    mapping(bytes32 => bool) internal marketSettled;
    
    IOptimisticOracleV3 internal umaOracle;
    IPriceOracle internal defaultOracle;
    address internal oracleAdmin;
    uint256 internal defaultOracleReward = 10 * 10**6;
    
    bytes32[] internal allMarkets;
    
    uint256 internal marketCreationFee = 100 * 10**6;
    bool internal publicMarketCreation = true;
    
    event FuturesMarketCreated(
        address indexed orderBook,
        bytes32 indexed marketId,
        string marketSymbol,
        address indexed creator,
        uint256 creationFee,
        string metricUrl,
        uint256 settlementDate,
        uint256 startPrice
    );
    event MarketSettled(bytes32 indexed marketId, uint256 finalPrice, address indexed settler);
    
    modifier onlyAdmin() {
        if (msg.sender != admin) revert OnlyAdmin();
        _;
    }
    
    modifier canCreateMarket() {
        if (!(publicMarketCreation || msg.sender == admin)) revert MarketCreationRestricted();
        _;
    }
    
    modifier validMarketSymbol(string memory symbol) {
        uint256 len = bytes(symbol).length;
        if (len == 0 || len > 64) revert InvalidMarketSymbol();
        _;
    }
    
    modifier validMetricUrl(string memory url) {
        uint256 len = bytes(url).length;
        if (len == 0 || len > 256) revert InvalidMetricUrl();
        _;
    }
    
    modifier validSettlementDate(uint256 settlementDate) {
        if (settlementDate <= block.timestamp || settlementDate > block.timestamp + 365 days) revert InvalidSettlementDate();
        _;
    }
    
    constructor(
        address _vault,
        address _admin,
        address _feeRecipient
    ) {
        if (_vault == address(0) || _admin == address(0) || _feeRecipient == address(0)) revert ZeroAddress();
        
        vault = CoreVault(_vault);
        admin = _admin;
        feeRecipient = _feeRecipient;
    }
    
    function createFuturesMarket(
        string memory,
        string memory,
        uint256,
        uint256,
        string memory,
        string[] memory,
        uint256,
        uint256
    ) external pure returns (address, bytes32) {
        revert UseCreateMarketDiamond();
    }

    function createFuturesMarketDiamond(
        string memory marketSymbol,
        string memory metricUrl,
        uint256 settlementDate,
        uint256 startPrice,
        string memory dataSource,
        string[] memory tags,
        address diamondOwner,
        IDiamondCut.FacetCut[] memory cut,
        address initFacet,
        bytes memory
    ) external 
        canCreateMarket
        validMarketSymbol(marketSymbol)
        validMetricUrl(metricUrl)
        validSettlementDate(settlementDate)
        returns (address orderBook, bytes32 marketId) 
    {
        if (startPrice == 0) revert InvalidOraclePrice();
        if (bytes(dataSource).length == 0) revert InvalidInput();
        if (tags.length > 10) revert InvalidInput();
        if (diamondOwner == address(0)) revert ZeroAddress();

        if (marketCreationFee > 0 && msg.sender != admin) {
            vault.deductFees(msg.sender, marketCreationFee, feeRecipient);
        }

        marketId = keccak256(abi.encodePacked(marketSymbol, metricUrl, msg.sender, block.timestamp, block.number));
        if (marketExists[marketId]) revert MarketIdCollision();

        if (initFacet == address(0)) revert ZeroAddress();
        bytes4 initSel = bytes4(keccak256("obInitialize(address,bytes32,address)"));
        bytes memory initData = abi.encodeWithSelector(initSel, address(vault), marketId, feeRecipient);
        Diamond diamond = new Diamond(diamondOwner, cut, initFacet, initData);
        orderBook = address(diamond);

        vault.registerOrderBook(orderBook);
        vault.assignMarketToOrderBook(marketId, orderBook);

        marketToOrderBook[marketId] = orderBook;
        orderBookToMarket[orderBook] = marketId;
        marketExists[marketId] = true;
        marketCreators[marketId] = msg.sender;
        marketSymbols[marketId] = marketSymbol;
        allMarkets.push(marketId);
        marketMetricUrls[marketId] = metricUrl;
        marketSettlementDates[marketId] = settlementDate;

        vault.updateMarkPrice(marketId, startPrice);

        emit FuturesMarketCreated(orderBook, marketId, marketSymbol, msg.sender, marketCreationFee, metricUrl, settlementDate, startPrice);
        return (orderBook, marketId);
    }
    
    function deactivateFuturesMarket(address orderBook) external {
        if (orderBook == address(0)) revert ZeroAddress();
        
        bytes32 marketId = orderBookToMarket[orderBook];
        if (marketId == bytes32(0)) revert MarketNotFound();
        
        if (!(msg.sender == admin || msg.sender == marketCreators[marketId])) revert NotAuthorized();
        
        vault.deregisterOrderBook(orderBook);
        
        delete marketToOrderBook[marketId];
        delete orderBookToMarket[orderBook];
        marketExists[marketId] = false;
        
        uint256 mLen = allMarkets.length;
        for (uint256 i = 0; i < mLen; ) {
            if (allMarkets[i] == marketId) {
                allMarkets[i] = allMarkets[allMarkets.length - 1];
                allMarkets.pop();
                break;
            }
            unchecked { ++i; }
        }
    }
    
    function configureOracles(
        address _umaOracle,
        address _defaultOracle,
        address _oracleAdmin
    ) external onlyAdmin {
        umaOracle = IOptimisticOracleV3(_umaOracle);
        defaultOracle = IPriceOracle(_defaultOracle);
        oracleAdmin = _oracleAdmin;
    }
    
    function assignCustomOracle(bytes32 marketId, address oracle) external {
        if (!marketExists[marketId]) revert MarketNotFound();
        if (!(msg.sender == marketCreators[marketId] || msg.sender == admin)) revert NotAuthorized();
        
        marketOracles[marketId] = oracle;
    }
    
    function requestUMASettlement(bytes32 marketId) external {
        if (!marketExists[marketId]) revert MarketNotFound();
        if (marketSettled[marketId]) revert MarketAlreadySettledErr();
        if (block.timestamp < marketSettlementDates[marketId]) revert SettlementNotReady();
        if (address(umaOracle) == address(0)) revert OracleNotConfigured();
        
        bytes memory ancillaryData = abi.encodePacked(
            "URL:", marketMetricUrls[marketId],
            ",SYM:", marketSymbols[marketId],
            ",T:", marketSettlementDates[marketId]
        );
        
        bytes32 requestId = umaOracle.requestPrice(
            marketId,
            marketSettlementDates[marketId],
            ancillaryData,
            address(vault.collateralToken()),
            defaultOracleReward
        );
        
        umaRequestIds[marketId] = requestId;
    }
    
    function settleMarketWithUMA(bytes32 marketId) external {
        if (!marketExists[marketId]) revert MarketNotFound();
        if (marketSettled[marketId]) revert MarketAlreadySettledErr();
        if (umaRequestIds[marketId] == bytes32(0)) revert UmaRequestMissing();
        
        int256 oraclePrice = umaOracle.getPrice(umaRequestIds[marketId]);
        if (oraclePrice <= 0) revert InvalidOraclePrice();
        
        uint256 finalPrice = uint256(oraclePrice);
        _settleMarket(marketId, finalPrice);
        
        emit MarketSettled(marketId, finalPrice, msg.sender);
    }
    
    function manualSettle(bytes32 marketId, uint256 finalPrice) external {
        if (!(msg.sender == oracleAdmin || msg.sender == admin)) revert NotAuthorized();
        if (!marketExists[marketId]) revert MarketNotFound();
        if (marketSettled[marketId]) revert MarketAlreadySettledErr();
        if (block.timestamp < marketSettlementDates[marketId]) revert SettlementNotReady();
        if (finalPrice == 0) revert InvalidFinalPrice();
        
        _settleMarket(marketId, finalPrice);
        
        emit MarketSettled(marketId, finalPrice, msg.sender);
    }
    
    function _settleMarket(bytes32 marketId, uint256 finalPrice) internal {
        marketSettled[marketId] = true;
        vault.updateMarkPrice(marketId, finalPrice);
    }
    
    function updateDefaultParameters(
        uint256 marginRequirementBps,
        uint256 tradingFee
    ) external onlyAdmin {
        if (marginRequirementBps < 1000 || marginRequirementBps > 10000) revert InvalidMarginRequirement();
        if (tradingFee > 1000) revert TradingFeeTooHigh();
        
        defaultMarginRequirementBps = marginRequirementBps;
        defaultTradingFee = tradingFee;
    }
    
    function updateMarketCreationFee(uint256 newFee) external onlyAdmin {
        marketCreationFee = newFee;
    }
    
    function togglePublicMarketCreation(bool enabled) external onlyAdmin {
        publicMarketCreation = enabled;
    }
    
    function updateAdmin(address newAdmin) external onlyAdmin {
        if (newAdmin == address(0)) revert ZeroAddress();
        admin = newAdmin;
    }
    
    function updateFeeRecipient(address newFeeRecipient) external onlyAdmin {
        if (newFeeRecipient == address(0)) revert ZeroAddress();
        feeRecipient = newFeeRecipient;
    }
    
    function getOrderBookForMarket(bytes32 marketId) external view returns (address) {
        return marketToOrderBook[marketId];
    }
    
    function getAllMarkets() external view returns (bytes32[] memory) {
        return allMarkets;
    }
    
    function getDefaultParameters() external view returns (uint256 marginRequirement, uint256 fee) {
        return (defaultMarginRequirementBps, defaultTradingFee);
    }
    
    function getMarketSymbol(bytes32 marketId) external view returns (string memory) {
        return marketSymbols[marketId];
    }
    
    function getMarketsReadyForSettlement() external view returns (bytes32[] memory) {
        uint256 mLen = allMarkets.length;
        uint256 count = 0;
        for (uint256 i = 0; i < mLen; ) {
            bytes32 mid = allMarkets[i];
            if (!marketSettled[mid] && block.timestamp >= marketSettlementDates[mid]) {
                count++;
            }
            unchecked { ++i; }
        }
        
        bytes32[] memory ready = new bytes32[](count);
        uint256 index = 0;
        
        for (uint256 i = 0; i < mLen; ) {
            bytes32 mid = allMarkets[i];
            if (!marketSettled[mid] && block.timestamp >= marketSettlementDates[mid]) {
                ready[index] = mid;
                unchecked { ++index; }
            }
            unchecked { ++i; }
        }
        
        return ready;
    }
    
    function setOracleReward(uint256 rewardAmount) external onlyAdmin {
        if (rewardAmount == 0) revert RewardMustBePositive();
        defaultOracleReward = rewardAmount;
    }
    
    function updateOracleAdmin(address newOracleAdmin) external onlyAdmin {
        if (newOracleAdmin == address(0)) revert ZeroAddress();
        oracleAdmin = newOracleAdmin;
    }
    
    function requestPriceUpdate(bytes32 marketId) external {
        if (!marketExists[marketId]) revert MarketNotFound();
        if (address(defaultOracle) == address(0)) revert OracleNotConfigured();
        
        defaultOracle.requestPriceUpdate(marketId, marketMetricUrls[marketId]);
    }
    
    function getCurrentOraclePrice(bytes32 marketId) external view returns (uint256 price, uint256 timestamp) {
        if (!marketExists[marketId]) revert MarketNotFound();
        
        if (marketOracles[marketId] != address(0)) {
            return IPriceOracle(marketOracles[marketId]).getPrice(marketId);
        }
        
        if (address(defaultOracle) != address(0)) {
            return defaultOracle.getPrice(marketId);
        }
        
        return (vault.marketMarkPrices(marketId), block.timestamp);
    }
    
    function getMarketOracleConfig(bytes32 marketId) external view returns (
        address customOracle,
        bytes32 umaRequestId,
        bool hasUmaRequest
    ) {
        return (
            marketOracles[marketId],
            umaRequestIds[marketId],
            umaRequestIds[marketId] != bytes32(0)
        );
    }
    
    function batchUpdatePrices(bytes32[] memory marketIds, uint256[] memory prices) external {
        if (!(msg.sender == oracleAdmin || msg.sender == admin)) revert NotAuthorized();
        if (marketIds.length != prices.length) revert InvalidInput();
        
        uint256 len = marketIds.length;
        for (uint256 i = 0; i < len; ) {
            bytes32 mid = marketIds[i];
            if (marketExists[mid] && !marketSettled[mid]) {
                vault.updateMarkPrice(mid, prices[i]);
            }
            unchecked { ++i; }
        }
    }
    
    function emergencyPriceUpdate(
        bytes32 marketId,
        uint256 emergencyPrice,
        string memory reason
    ) external onlyAdmin {
        if (!marketExists[marketId]) revert MarketNotFound();
        if (emergencyPrice == 0) revert InvalidOraclePrice();
        if (bytes(reason).length == 0) revert ReasonRequired();
        
        vault.updateMarkPrice(marketId, emergencyPrice);
    }

    function enableMarketLeverage(
        bytes32 marketId,
        uint256 maxLeverage,
        uint256 marginRequirementBps
    ) external onlyAdmin {
        if (!marketExists[marketId]) revert MarketNotFound();
        if (!(maxLeverage > 1 && maxLeverage <= 100)) revert InvalidLeverage();
        if (!(marginRequirementBps >= 100 && marginRequirementBps <= 10000)) revert InvalidMarginRequirement();
        if (marginRequirementBps > (10000 / maxLeverage)) revert MarginTooLowForLeverage();
        
        address orderBookAddress = marketToOrderBook[marketId];
        IOBAdminFacet(orderBookAddress).enableLeverage(maxLeverage, marginRequirementBps);
    }

    function disableMarketLeverage(bytes32 marketId) external onlyAdmin {
        if (!marketExists[marketId]) revert MarketNotFound();
        
        address orderBookAddress = marketToOrderBook[marketId];
        IOBAdminFacet(orderBookAddress).disableLeverage();
    }

    function setMarketLeverageController(
        bytes32 marketId,
        address controller
    ) external onlyAdmin {
        if (!marketExists[marketId]) revert MarketNotFound();
        if (controller == address(0)) revert ZeroAddress();
        
        address orderBookAddress = marketToOrderBook[marketId];
        IOBAdminFacet(orderBookAddress).setLeverageController(controller);
    }

    function getMarketLeverageInfo(bytes32 marketId) external view returns (
        bool enabled,
        uint256 maxLeverage,
        uint256 marginRequirement,
        address controller
    ) {
        if (!marketExists[marketId]) revert MarketNotFound();
        
        address orderBookAddress = marketToOrderBook[marketId];
        return IOBViewFacet(orderBookAddress).getLeverageInfo();
    }

    function updateDefaultLeverageSettings(
        uint256 _defaultMarginRequirementBps,
        bool _defaultLeverageEnabled
    ) external onlyAdmin {
        if (_defaultMarginRequirementBps < 1000 || _defaultMarginRequirementBps > 10000) revert InvalidMarginRequirement();
        
        defaultMarginRequirementBps = _defaultMarginRequirementBps;
        defaultLeverageEnabled = _defaultLeverageEnabled;
    }
}
