// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./diamond/Diamond.sol";
import "./diamond/interfaces/IDiamondCut.sol";
import "./CoreVault.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
// OrderBook (Diamond) admin/view minimal interfaces
interface IOBAdminFacet {
    function updateTradingParameters(uint256 _marginRequirementBps, uint256 _tradingFee, address _feeRecipient) external;
    function enableLeverage(uint256 _maxLeverage, uint256 _marginRequirementBps) external;
    function disableLeverage() external;
    function setLeverageController(address _newController) external;
}

interface IOBViewFacet {
    function getLeverageInfo() external view returns (bool enabled, uint256 maxLev, uint256 marginReq, address controller);
}

// UMA Oracle interface
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

// Generic Oracle interface  
interface IPriceOracle {
    function getPrice(bytes32 identifier) external view returns (uint256 price, uint256 timestamp);
    function requestPriceUpdate(bytes32 identifier, string memory metricUrl) external;
}

// Market bond manager hook (deployed separately)
interface IMarketBondManager {
    function onMarketCreate(bytes32 marketId, address creator) external;
    function onMarketDeactivate(bytes32 marketId, address orderBook, address caller) external;
}

// ============ Custom Errors (reduce bytecode vs long revert strings) ============
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
error MetaExpired();
error BadSignature();
error BadNonce();

/**
 * @title FuturesMarketFactory
 * @dev Factory contract for creating custom futures markets with dedicated OrderBooks (Diamond)
 * @notice Allows users to create and trade custom metric futures with margin support
 */
contract FuturesMarketFactory is EIP712 {
    // EIP-712 domain defaults (overridable via redeploy)
    // NOTE: Update domain name to align with new deployment/clients
    string private constant EIP712_NAME = "DexeteraFactory";
    string private constant EIP712_VERSION = "1";

    // EIP-712 type hash for meta-create
    bytes32 private constant TYPEHASH_META_CREATE =
        keccak256(
            "MetaCreate(string marketSymbol,string metricUrl,uint256 settlementDate,uint256 startPrice,string dataSource,bytes32 tagsHash,address diamondOwner,bytes32 cutHash,address initFacet,address creator,uint256 nonce,uint256 deadline)"
        );

    // ============ State Variables ============
    
    CoreVault public vault;
    address admin;
    address feeRecipient;
    address public bondManager;
    mapping(address => uint256) public metaCreateNonce;
    
    // Default trading parameters - Conservative defaults (1:1 margin, no leverage)
    uint256 defaultMarginRequirementBps = 10000; // 100% margin requirement (1:1)
    uint256 defaultTradingFee = 10; // 0.1%
    bool defaultLeverageEnabled = false; // Leverage disabled by default
    
    // Futures market tracking
    mapping(bytes32 => address) internal marketToOrderBook;
    mapping(address => bytes32) internal orderBookToMarket;
    mapping(bytes32 => bool) internal marketExists;
    mapping(bytes32 => address) internal marketCreators; // Track who created each market
    mapping(bytes32 => string) internal marketSymbols; // Store market symbols
    // removed: userCreatedMarkets tracking to reduce bytecode size
    
    // Enhanced market metadata
    mapping(bytes32 => string) internal marketMetricUrls; // Single source of truth URL for each market
    mapping(bytes32 => uint256) internal marketSettlementDates; // Settlement end date (timestamp)
    // removed: start prices, creation timestamps, data sources, tags, type flags to reduce bytecode
    
    // Oracle integration
    mapping(bytes32 => address) internal marketOracles; // Custom oracle per market
    mapping(bytes32 => bytes32) internal umaRequestIds; // UMA request IDs for settlement
    mapping(bytes32 => bool) internal marketSettled; // Settlement status
    // removed: finalSettlementPrices mapping to reduce bytecode
    
    // Global oracle settings
    IOptimisticOracleV3 internal umaOracle;
    IPriceOracle internal defaultOracle;
    address internal oracleAdmin;
    uint256 internal defaultOracleReward = 10 * 10**6; // 10 USDC reward for UMA requests
    // UMA currency used for requests (e.g., USDC); must be set explicitly since CoreVault doesn't expose the token
    address internal umaCurrency;
    
    // removed: allOrderBooks tracking to reduce bytecode
    bytes32[] internal allMarkets;
    
    // Market creation settings
    uint256 internal marketCreationFee = 100 * 10**6; // 100 USDC fee to create market
    bool internal publicMarketCreation = true; // Allow anyone to create markets

    // ============ Internal Helpers ============

    function _hashTags(string[] memory tags) internal pure returns (bytes32) {
        // Packed hashing to mirror client-side ethers.solidityPacked(['string', ...], tags)
        bytes memory packed;
        uint256 len = tags.length;
        for (uint256 i = 0; i < len; ) {
            packed = abi.encodePacked(packed, tags[i]);
            unchecked { ++i; }
        }
        return keccak256(packed);
    }

    function _hashFacetCuts(IDiamondCut.FacetCut[] memory cut) internal pure returns (bytes32) {
        uint256 len = cut.length;
        bytes32[] memory perCut = new bytes32[](len);
        for (uint256 i = 0; i < len; ) {
            perCut[i] = keccak256(
                abi.encode(
                    cut[i].facetAddress,
                    cut[i].action,
                    keccak256(abi.encodePacked(cut[i].functionSelectors))
                )
            );
            unchecked { ++i; }
        }
        return keccak256(abi.encodePacked(perCut));
    }

    
    // ============ Events ============
    
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
    // Admin/config events removed to reduce bytecode size
    
    // Oracle and settlement events
    // Auxiliary oracle events removed to reduce bytecode size
    event MarketSettled(bytes32 indexed marketId, uint256 finalPrice, address indexed settler);
    // Auxiliary oracle events removed to reduce bytecode size
    
    // ============ Modifiers ============
    
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
    
    // ============ Constructor ============
    
    constructor(
        address _vault,
        address _admin,
        address _feeRecipient
    ) EIP712(EIP712_NAME, EIP712_VERSION) {
        if (_vault == address(0) || _admin == address(0) || _feeRecipient == address(0)) revert ZeroAddress();
        
        vault = CoreVault(_vault);
        admin = _admin;
        feeRecipient = _feeRecipient;
    }

    /**
     * @dev Expose the EIP-712 domain components to help clients verify they are hashing
     *      with the exact on-chain domain. This does not change any state.
     */
    function eip712DomainInfo()
        external
        view
        returns (
            string memory name,
            string memory version,
            uint256 chainId,
            address verifyingContract,
            bytes32 domainSeparator
        )
    {
        return (
            EIP712_NAME,
            EIP712_VERSION,
            block.chainid,
            address(this),
            _domainSeparatorV4()
        );
    }

    /**
     * @dev Debug helpers to mirror internal hashing for meta-create.
     *      These are view-only and safe to call off-chain to confirm
     *      client-side hashes match contract-side hashes.
     */
    function computeTagsHash(string[] calldata tags) external pure returns (bytes32) {
        return _hashTags(tags);
    }

    function computeCutHash(IDiamondCut.FacetCut[] calldata cut) external pure returns (bytes32) {
        return _hashFacetCuts(cut);
    }

    function computeStructHash(
        string calldata marketSymbol,
        string calldata metricUrl,
        uint256 settlementDate,
        uint256 startPrice,
        string calldata dataSource,
        bytes32 tagsHash,
        address diamondOwner,
        bytes32 cutHash,
        address initFacet,
        address creator,
        uint256 nonce,
        uint256 deadline
    ) external pure returns (bytes32) {
        return keccak256(
            abi.encode(
                TYPEHASH_META_CREATE,
                keccak256(bytes(marketSymbol)),
                keccak256(bytes(metricUrl)),
                settlementDate,
                startPrice,
                keccak256(bytes(dataSource)),
                tagsHash,
                diamondOwner,
                cutHash,
                initFacet,
                creator,
                nonce,
                deadline
            )
        );
    }
    
    // ============ Futures Market Creation ============
    
    /**
     * @dev Deprecated: use createFuturesMarketDiamond. Kept for backward compatibility.
     */
    function createFuturesMarket(
        string memory /*marketSymbol*/,
        string memory /*metricUrl*/,
        uint256 /*settlementDate*/,
        uint256 /*startPrice*/,
        string memory /*dataSource*/,
        string[] memory /*tags*/,
        uint256 /*marginRequirementBps*/,
        uint256 /*tradingFee*/
    ) external pure returns (address /*orderBook*/, bytes32 /*marketId*/) {
        // Deprecated: Factory no longer deploys EIP-1167 OrderBooks
        revert UseCreateMarketDiamond();
    }

    /**
     * @dev Create a new futures market using Diamond proxy pattern.
     * @param marketSymbol Human-readable market symbol
     * @param metricUrl Source-of-truth URL
     * @param settlementDate Settlement timestamp
     * @param startPrice Initial mark price (6 decimals)
     * @param dataSource Data source descriptor
     * @param tags Discovery tags
     * @param diamondOwner Owner of the Diamond (admin)
     * @param cut Initial facet cut describing facets and selectors
     * @param initFacet Address to run initialization delegatecall (e.g., OrderBookInitFacet)
     */
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
        bytes memory /*initCalldata*/
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

        // Bond requirement enforced by an external manager contract.
        // Use InvalidInput() to avoid introducing new custom errors (bytecode size).
        address bm = bondManager;
        if (bm == address(0)) revert InvalidInput();
        IMarketBondManager(bm).onMarketCreate(marketId, msg.sender);

        // Deploy Diamond with factory-computed initializer that includes the computed marketId
        if (initFacet == address(0)) revert ZeroAddress();
        bytes4 initSel = bytes4(keccak256("obInitialize(address,bytes32,address)"));
        bytes memory initData = abi.encodeWithSelector(initSel, address(vault), marketId, feeRecipient);
        Diamond diamond = new Diamond(diamondOwner, cut, initFacet, initData);
        orderBook = address(diamond);

        // Register with vault and assign market
        vault.registerOrderBook(orderBook);
        vault.assignMarketToOrderBook(marketId, orderBook);
        
        // Update tracking and metadata
        marketToOrderBook[marketId] = orderBook;
        orderBookToMarket[orderBook] = marketId;
        marketExists[marketId] = true;
        marketCreators[marketId] = msg.sender;
        marketSymbols[marketId] = marketSymbol;
        allMarkets.push(marketId);
        marketMetricUrls[marketId] = metricUrl;
        marketSettlementDates[marketId] = settlementDate;
        // metadata writes removed for bytecode reduction (startPrice, creationTs, dataSource, tags)

        vault.updateMarkPrice(marketId, startPrice);
        
        emit FuturesMarketCreated(orderBook, marketId, marketSymbol, msg.sender, marketCreationFee, metricUrl, settlementDate, startPrice);
        return (orderBook, marketId);
    }

    /**
     * @dev Gasless meta-create entrypoint (relayer pays gas; creator signs EIP-712)
     */
    function metaCreateFuturesMarketDiamond(
        string memory marketSymbol,
        string memory metricUrl,
        uint256 settlementDate,
        uint256 startPrice,
        string memory dataSource,
        string[] memory tags,
        address diamondOwner,
        IDiamondCut.FacetCut[] memory cut,
        address initFacet,
        address creator,
        uint256 nonce,
        uint256 deadline,
        bytes calldata signature
    ) external returns (address orderBook, bytes32 marketId) {
        uint256 symLen = bytes(marketSymbol).length;
        if (symLen == 0 || symLen > 64) revert InvalidMarketSymbol();
        uint256 urlLen = bytes(metricUrl).length;
        if (urlLen == 0 || urlLen > 256) revert InvalidMetricUrl();
        if (settlementDate <= block.timestamp || settlementDate > block.timestamp + 365 days) revert InvalidSettlementDate();
        if (startPrice == 0) revert InvalidOraclePrice();
        if (bytes(dataSource).length == 0) revert InvalidInput();
        if (tags.length > 10) revert InvalidInput();
        if (diamondOwner == address(0) || initFacet == address(0) || creator == address(0)) revert ZeroAddress();
        if (block.timestamp > deadline) revert MetaExpired();
        if (nonce != metaCreateNonce[creator]) revert BadNonce();

        bytes32 tagsHash = _hashTags(tags);
        bytes32 cutHash = _hashFacetCuts(cut);
        bytes32 structHash = keccak256(
            abi.encode(
                TYPEHASH_META_CREATE,
                keccak256(bytes(marketSymbol)),
                keccak256(bytes(metricUrl)),
                settlementDate,
                startPrice,
                keccak256(bytes(dataSource)),
                tagsHash,
                diamondOwner,
                cutHash,
                initFacet,
                creator,
                nonce,
                deadline
            )
        );

        address signer = ECDSA.recover(_hashTypedDataV4(structHash), signature);
        if (signer != creator) revert BadSignature();
        if (!(publicMarketCreation || creator == admin)) revert MarketCreationRestricted();

        // Increment nonce to prevent replay before external calls
        metaCreateNonce[creator] = nonce + 1;

        if (marketCreationFee > 0 && creator != admin) {
            vault.deductFees(creator, marketCreationFee, feeRecipient);
        }

        marketId = keccak256(abi.encodePacked(marketSymbol, metricUrl, creator, block.timestamp, block.number));
        if (marketExists[marketId]) revert MarketIdCollision();

        // Bond requirement enforced by an external manager contract.
        address bm = bondManager;
        if (bm == address(0)) revert InvalidInput();
        IMarketBondManager(bm).onMarketCreate(marketId, creator);

        // Deploy Diamond with initializer identical to direct create
        bytes4 initSel = bytes4(keccak256("obInitialize(address,bytes32,address)"));
        bytes memory initData = abi.encodeWithSelector(initSel, address(vault), marketId, feeRecipient);
        Diamond diamond = new Diamond(diamondOwner, cut, initFacet, initData);
        orderBook = address(diamond);

        vault.registerOrderBook(orderBook);
        vault.assignMarketToOrderBook(marketId, orderBook);

        // Track metadata and emit using logical creator (not relayer)
        marketToOrderBook[marketId] = orderBook;
        orderBookToMarket[orderBook] = marketId;
        marketExists[marketId] = true;
        marketCreators[marketId] = creator;
        marketSymbols[marketId] = marketSymbol;
        allMarkets.push(marketId);
        marketMetricUrls[marketId] = metricUrl;
        marketSettlementDates[marketId] = settlementDate;

        vault.updateMarkPrice(marketId, startPrice);
        
        emit FuturesMarketCreated(orderBook, marketId, marketSymbol, creator, marketCreationFee, metricUrl, settlementDate, startPrice);
        return (orderBook, marketId);
    }
    
    /**
     * @dev Deactivate a futures market (emergency function or by creator)
     * @param orderBook Address of the OrderBook to deactivate
     */
    function deactivateFuturesMarket(address orderBook) external {
        if (orderBook == address(0)) revert ZeroAddress();
        
        bytes32 marketId = orderBookToMarket[orderBook];
        if (marketId == bytes32(0)) revert MarketNotFound();
        
        // Only admin or market creator can deactivate
        if (!(msg.sender == admin || msg.sender == marketCreators[marketId])) revert NotAuthorized();

        // Enforce deactivation safety + bond refund in the external manager.
        address bm = bondManager;
        if (bm == address(0)) revert InvalidInput();
        IMarketBondManager(bm).onMarketDeactivate(marketId, orderBook, msg.sender);

        // Cease all future trading by settling the market in CoreVault.
        // OrderBook placement routes enforce: require(!vault.marketSettled(marketId), ...)
        if (!vault.marketSettled(marketId)) {
            uint256 finalPrice = vault.getMarkPrice(marketId);
            if (finalPrice == 0) revert InvalidOraclePrice();
            vault.settleMarket(marketId, finalPrice);
        }
        
        // Deregister from vault
        vault.deregisterOrderBook(orderBook);
        
        // Update tracking
        delete marketToOrderBook[marketId];
        delete orderBookToMarket[orderBook];
        marketExists[marketId] = false;
        
        // Remove from arrays (only markets retained)
        uint256 mLen = allMarkets.length;
        for (uint256 i = 0; i < mLen; ) {
            if (allMarkets[i] == marketId) {
                allMarkets[i] = allMarkets[allMarkets.length - 1];
                allMarkets.pop();
                break;
            }
            unchecked { ++i; }
        }
        
        // event omitted to reduce bytecode size
    }

    /**
     * @dev Update the CoreVault reference for new markets. Admin-only.
     */
    function updateVault(address newVault) external onlyAdmin {
        if (newVault == address(0)) revert ZeroAddress();
        vault = CoreVault(newVault);
    }
    
    // ============ Oracle Integration Functions ============
    
    /**
     * @dev Configure oracle settings
     * @param _umaOracle UMA Optimistic Oracle V3 address
     * @param _defaultOracle Default price oracle address
     * @param _oracleAdmin Oracle admin address
     */
    function configureOracles(
        address _umaOracle,
        address _defaultOracle,
        address _oracleAdmin
    ) external onlyAdmin {
        umaOracle = IOptimisticOracleV3(_umaOracle);
        defaultOracle = IPriceOracle(_defaultOracle);
        oracleAdmin = _oracleAdmin;
        
        // event omitted to reduce bytecode size
    }
    
    /**
     * @dev Configure UMA reward currency (e.g., USDC) used in UMA requests
     * @param _currency ERC20 token address accepted by UMA
     */
    function setUmaCurrency(address _currency) external onlyAdmin {
        if (_currency == address(0)) revert ZeroAddress();
        umaCurrency = _currency;
    }
    
    /**
     * @dev Assign custom oracle to a market
     * @param marketId Market identifier
     * @param oracle Custom oracle address
     */
    function assignCustomOracle(bytes32 marketId, address oracle) external {
        if (!marketExists[marketId]) revert MarketNotFound();
        if (!(msg.sender == marketCreators[marketId] || msg.sender == admin)) revert NotAuthorized();
        
        marketOracles[marketId] = oracle;
        // event omitted to reduce bytecode size
    }
    
    /**
     * @dev Request settlement via UMA oracle
     * @param marketId Market identifier
     */
    function requestUMASettlement(bytes32 marketId) external {
        if (!marketExists[marketId]) revert MarketNotFound();
        if (marketSettled[marketId]) revert MarketAlreadySettledErr();
        if (block.timestamp < marketSettlementDates[marketId]) revert SettlementNotReady();
        if (address(umaOracle) == address(0)) revert OracleNotConfigured();
        if (umaCurrency == address(0)) revert OracleNotConfigured();
        
        // Create UMA request
        bytes memory ancillaryData = abi.encodePacked(
            "URL:", marketMetricUrls[marketId],
            ",SYM:", marketSymbols[marketId],
            ",T:", marketSettlementDates[marketId]
        );
        
        bytes32 requestId = umaOracle.requestPrice(
            marketId, // Use marketId as identifier
            marketSettlementDates[marketId],
            ancillaryData,
            umaCurrency,
            defaultOracleReward
        );
        
        umaRequestIds[marketId] = requestId;
        // event omitted to reduce bytecode size
    }
    
    /**
     * @dev Settle market with UMA oracle result
     * @param marketId Market identifier
     */
    function settleMarketWithUMA(bytes32 marketId) external {
        if (!marketExists[marketId]) revert MarketNotFound();
        if (marketSettled[marketId]) revert MarketAlreadySettledErr();
        if (umaRequestIds[marketId] == bytes32(0)) revert UmaRequestMissing();
        
        // Get price from UMA oracle
        int256 oraclePrice = umaOracle.getPrice(umaRequestIds[marketId]);
        if (oraclePrice <= 0) revert InvalidOraclePrice();
        
        uint256 finalPrice = uint256(oraclePrice);
        
        // Settle the market
        _settleMarket(marketId, finalPrice);
        
        emit MarketSettled(marketId, finalPrice, msg.sender);
    }
    
    /**
     * @dev Manual settlement by oracle admin
     * @param marketId Market identifier
     * @param finalPrice Final settlement price
     */
    function manualSettle(bytes32 marketId, uint256 finalPrice) external {
        if (!(msg.sender == oracleAdmin || msg.sender == admin)) revert NotAuthorized();
        if (!marketExists[marketId]) revert MarketNotFound();
        if (marketSettled[marketId]) revert MarketAlreadySettledErr();
        if (block.timestamp < marketSettlementDates[marketId]) revert SettlementNotReady();
        if (finalPrice == 0) revert InvalidFinalPrice();
        
        _settleMarket(marketId, finalPrice);
        
        emit MarketSettled(marketId, finalPrice, msg.sender);
    }
    
    /**
     * @dev Internal function to settle a market
     * @param marketId Market identifier
     * @param finalPrice Final settlement price
     */
    function _settleMarket(bytes32 marketId, uint256 finalPrice) internal {
        marketSettled[marketId] = true;
        
        // Update final mark price in vault
        vault.updateMarkPrice(marketId, finalPrice);
        
        // TODO: Implement position settlement logic
        // This would calculate P&L for all positions and settle them
    }
    
    // ============ Administrative Functions ============
    
    /**
     * @dev Update default trading parameters for new OrderBooks
     * @param marginRequirementBps Default margin requirement in basis points
     * @param tradingFee Default trading fee in basis points
     */
    function updateDefaultParameters(
        uint256 marginRequirementBps,
        uint256 tradingFee
    ) external onlyAdmin {
        if (marginRequirementBps < 1000 || marginRequirementBps > 10000) revert InvalidMarginRequirement();
        if (tradingFee > 1000) revert TradingFeeTooHigh();
        
        defaultMarginRequirementBps = marginRequirementBps;
        defaultTradingFee = tradingFee;
        
        // event omitted to reduce bytecode size
    }
    
    /**
     * @dev Update market creation fee
     * @param newFee New market creation fee in USDC
     */
    function updateMarketCreationFee(uint256 newFee) external onlyAdmin {
        marketCreationFee = newFee;
        // event omitted to reduce bytecode size
    }
    
    /**
     * @dev Toggle public market creation
     * @param enabled Whether public market creation is enabled
     */
    function togglePublicMarketCreation(bool enabled) external onlyAdmin {
        publicMarketCreation = enabled;
        // event omitted to reduce bytecode size
    }
    
    /**
     * @dev Update admin address
     * @param newAdmin New admin address
     */
    function updateAdmin(address newAdmin) external onlyAdmin {
        if (newAdmin == address(0)) revert ZeroAddress();
        
        admin = newAdmin;
        // event omitted to reduce bytecode size
    }
    
    /**
     * @dev Update fee recipient address
     * @param newFeeRecipient New fee recipient address
     */
    function updateFeeRecipient(address newFeeRecipient) external onlyAdmin {
        if (newFeeRecipient == address(0)) revert ZeroAddress();
        
        feeRecipient = newFeeRecipient;
        // event omitted to reduce bytecode size
    }

    /**
     * @dev Configure bond manager contract. Admin-only.
     *      Setting to address(0) effectively disables market creation (bond required).
     */
    function setBondManager(address newBondManager) external onlyAdmin {
        bondManager = newBondManager;
        // event omitted to reduce bytecode size
    }
    
    // ============ View Functions ============
    
    /**
     * @dev Get OrderBook address for a market
     * @param marketId Market identifier
     * @return OrderBook address (address(0) if not found)
     */
    function getOrderBookForMarket(bytes32 marketId) external view returns (address) {
        return marketToOrderBook[marketId];
    }
    
    /**
     * @dev Get all market IDs
     * @return Array of market IDs
     */
    function getAllMarkets() external view returns (bytes32[] memory) {
        return allMarkets;
    }
    
    /**
     * @dev Get default trading parameters
     * @return marginRequirement Default margin requirement in basis points
     * @return fee Default trading fee in basis points
     */
    function getDefaultParameters() external view returns (uint256 marginRequirement, uint256 fee) {
        return (defaultMarginRequirementBps, defaultTradingFee);
    }
    
    /**
     * @dev Get market symbol
     * @param marketId Market identifier
     * @return Market symbol string
     */
    function getMarketSymbol(bytes32 marketId) external view returns (string memory) {
        return marketSymbols[marketId];
    }
    
    /**
     * @dev Get current price from market's oracle
     * @param marketId Market identifier
     * @return price Current price
     * @return timestamp Price timestamp
     */
    function getCurrentOraclePrice(bytes32 marketId) external view returns (uint256 price, uint256 timestamp) {
        if (!marketExists[marketId]) revert MarketNotFound();
        
        // Try custom oracle first
        if (marketOracles[marketId] != address(0)) {
            return IPriceOracle(marketOracles[marketId]).getPrice(marketId);
        }
        
        // Fall back to default oracle
        if (address(defaultOracle) != address(0)) {
            return defaultOracle.getPrice(marketId);
        }
        
        // Return vault mark price as fallback
        return (vault.getMarkPrice(marketId), block.timestamp);
    }
    
    /**
     * @dev Get oracle configuration for a market
     * @param marketId Market identifier
     * @return customOracle Custom oracle address (address(0) if none)
     * @return umaRequestId UMA request ID (bytes32(0) if none)
     * @return hasUmaRequest Whether market has pending UMA request
     */
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
    
    // ============ Robust Oracle Management Functions ============
    
    /**
     * @dev Set oracle reward amount for UMA requests
     * @param rewardAmount New reward amount in USDC
     */
    function setOracleReward(uint256 rewardAmount) external onlyAdmin {
        if (rewardAmount == 0) revert RewardMustBePositive();
        defaultOracleReward = rewardAmount;
    }
    
    /**
     * @dev Update oracle admin
     * @param newOracleAdmin New oracle admin address
     */
    function updateOracleAdmin(address newOracleAdmin) external onlyAdmin {
        if (newOracleAdmin == address(0)) revert ZeroAddress();
        oracleAdmin = newOracleAdmin;
    }
    
    /**
     * @dev Force price update for a market using default oracle
     * @param marketId Market identifier
     */
    function requestPriceUpdate(bytes32 marketId) external {
        if (!marketExists[marketId]) revert MarketNotFound();
        if (address(defaultOracle) == address(0)) revert OracleNotConfigured();
        
        defaultOracle.requestPriceUpdate(marketId, marketMetricUrls[marketId]);
    }
    
    /**
     * @dev Update multiple market prices via oracle admin
     * @param marketIds Array of market identifiers
     * @param prices Array of new prices
     */
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
    
    /**
     * @dev Emergency oracle intervention - update price directly
     * @param marketId Market identifier
     * @param emergencyPrice Emergency price to set
     * @param reason Reason for emergency intervention
     */
    function emergencyPriceUpdate(
        bytes32 marketId,
        uint256 emergencyPrice,
        string memory reason
    ) external onlyAdmin {
        if (!marketExists[marketId]) revert MarketNotFound();
        if (emergencyPrice == 0) revert InvalidOraclePrice();
        if (bytes(reason).length == 0) revert ReasonRequired();
        
        vault.updateMarkPrice(marketId, emergencyPrice);
        // event omitted to reduce bytecode size
    }

    // ============ Leverage Management Functions ============

    /**
     * @dev Enable leverage for a specific market
     * @param marketId Market identifier
     * @param maxLeverage Maximum leverage allowed (e.g., 10 for 10x)
     * @param marginRequirementBps New margin requirement in basis points
     */
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
        IOBAdminFacet obAdmin = IOBAdminFacet(orderBookAddress);
        // Enable leverage on the Diamond OB via admin facet
        obAdmin.enableLeverage(maxLeverage, marginRequirementBps);
        // event omitted to reduce bytecode size
    }

    /**
     * @dev Disable leverage for a specific market (revert to 1:1 margin)
     * @param marketId Market identifier
     */
    function disableMarketLeverage(bytes32 marketId) external onlyAdmin {
        if (!marketExists[marketId]) revert MarketNotFound();
        
        address orderBookAddress = marketToOrderBook[marketId];
        IOBAdminFacet obAdmin = IOBAdminFacet(orderBookAddress);
        obAdmin.disableLeverage();
        // event omitted to reduce bytecode size
    }

    /**
     * @dev Set leverage controller for a specific market
     * @param marketId Market identifier
     * @param controller New leverage controller address
     */
    function setMarketLeverageController(
        bytes32 marketId,
        address controller
    ) external onlyAdmin {
        if (!marketExists[marketId]) revert MarketNotFound();
        if (controller == address(0)) revert ZeroAddress();
        
        address orderBookAddress = marketToOrderBook[marketId];
        IOBAdminFacet obAdmin = IOBAdminFacet(orderBookAddress);
        obAdmin.setLeverageController(controller);
        // event omitted to reduce bytecode size
    }

    /**
     * @dev Get leverage information for a market
     * @param marketId Market identifier
     * @return enabled Whether leverage is enabled
     * @return maxLeverage Maximum leverage allowed
     * @return marginRequirement Current margin requirement in basis points
     * @return controller Current leverage controller
     */
    function getMarketLeverageInfo(bytes32 marketId) external view returns (
        bool enabled,
        uint256 maxLeverage,
        uint256 marginRequirement,
        address controller
    ) {
        if (!marketExists[marketId]) revert MarketNotFound();
        
        address orderBookAddress = marketToOrderBook[marketId];
        IOBViewFacet obView = IOBViewFacet(orderBookAddress);
        return obView.getLeverageInfo();
    }

    /**
     * @dev Update default leverage settings for new markets
     * @param _defaultMarginRequirementBps New default margin requirement
     * @param _defaultLeverageEnabled Whether leverage should be enabled by default for new markets
     */
    function updateDefaultLeverageSettings(
        uint256 _defaultMarginRequirementBps,
        bool _defaultLeverageEnabled
    ) external onlyAdmin {
        if (_defaultMarginRequirementBps < 1000 || _defaultMarginRequirementBps > 10000) revert InvalidMarginRequirement();
        
        defaultMarginRequirementBps = _defaultMarginRequirementBps;
        defaultLeverageEnabled = _defaultLeverageEnabled;
        // event omitted to reduce bytecode size
    }
}
