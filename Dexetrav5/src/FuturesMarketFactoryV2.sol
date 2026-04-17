// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./diamond/Diamond.sol";
import "./diamond/DiamondRegistry.sol";
import "./diamond/interfaces/IDiamondCut.sol";
import "./CoreVault.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

interface IMarketBondManager {
    function onMarketCreate(bytes32 marketId, address creator) external;
    function onMarketDeactivate(bytes32 marketId, address orderBook, address caller) external;
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
error InvalidOraclePrice();
error MetaExpired();
error BadSignature();
error BadNonce();

/**
 * @title FuturesMarketFactoryV2
 * @dev Streamlined factory for creating futures markets using DiamondRegistry (auto-upgrades)
 */
contract FuturesMarketFactoryV2 is EIP712 {
    string private constant EIP712_NAME = "DexeteraFactory";
    string private constant EIP712_VERSION = "1";

    bytes32 private constant TYPEHASH_META_CREATE =
        keccak256(
            "MetaCreate(string marketSymbol,string metricUrl,uint256 settlementDate,uint256 startPrice,string dataSource,bytes32 tagsHash,address diamondOwner,bytes32 cutHash,address initFacet,address creator,uint256 nonce,uint256 deadline)"
        );

    // V2 typehash - no cutHash or initFacet (uses FacetRegistry)
    bytes32 private constant TYPEHASH_META_CREATE_V2 =
        keccak256(
            "MetaCreateV2(string marketSymbol,string metricUrl,uint256 settlementDate,uint256 startPrice,string dataSource,bytes32 tagsHash,address diamondOwner,address creator,uint256 nonce,uint256 deadline)"
        );

    CoreVault public vault;
    address public admin;
    address public feeRecipient;
    address public bondManager;
    address public facetRegistry;
    address public initFacetAddress;
    
    mapping(address => uint256) public metaCreateNonce;
    mapping(bytes32 => address) public marketToOrderBook;
    mapping(address => bytes32) public orderBookToMarket;
    mapping(bytes32 => bool) public marketExists;
    mapping(bytes32 => address) public marketCreators;
    mapping(bytes32 => string) public marketSymbols;
    mapping(bytes32 => string) public marketMetricUrls;
    mapping(bytes32 => uint256) public marketSettlementDates;
    
    bytes32[] internal allMarkets;
    uint256 public marketCreationFee = 100 * 10**6;
    bool public publicMarketCreation = true;
    
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
    ) EIP712(EIP712_NAME, EIP712_VERSION) {
        if (_vault == address(0) || _admin == address(0) || _feeRecipient == address(0)) revert ZeroAddress();
        vault = CoreVault(_vault);
        admin = _admin;
        feeRecipient = _feeRecipient;
    }
    
    function _hashTags(string[] memory tags) internal pure returns (bytes32) {
        bytes memory packed;
        for (uint256 i = 0; i < tags.length; ) {
            packed = abi.encodePacked(packed, tags[i]);
            unchecked { ++i; }
        }
        return keccak256(packed);
    }

    function _hashCut(IDiamondCut.FacetCut[] memory cut) internal pure returns (bytes32) {
        bytes32[] memory perCut = new bytes32[](cut.length);
        for (uint256 i = 0; i < cut.length; ) {
            bytes32 selHash = keccak256(abi.encodePacked(cut[i].functionSelectors));
            perCut[i] = keccak256(abi.encode(cut[i].facetAddress, cut[i].action, selHash));
            unchecked { ++i; }
        }
        return keccak256(abi.encodePacked(perCut));
    }

    function computeTagsHash(string[] calldata tags) external pure returns (bytes32) {
        return _hashTags(tags);
    }

    function computeCutHash(IDiamondCut.FacetCut[] calldata cut) external pure returns (bytes32) {
        return _hashCut(cut);
    }

    function eip712DomainInfo() external view returns (
        string memory name, string memory version, uint256 chainId, address verifyingContract, bytes32 domainSeparator
    ) {
        return (EIP712_NAME, EIP712_VERSION, block.chainid, address(this), _domainSeparatorV4());
    }

    /**
     * @dev Create market using Diamond with explicit facet cuts (V1 flow)
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

        address bm = bondManager;
        if (bm == address(0)) revert InvalidInput();
        IMarketBondManager(bm).onMarketCreate(marketId, msg.sender);

        if (initFacet == address(0)) revert ZeroAddress();
        bytes4 initSel = bytes4(keccak256("obInitialize(address,bytes32,address)"));
        bytes memory initData = abi.encodeWithSelector(initSel, address(vault), marketId, feeRecipient);
        Diamond diamond = new Diamond(diamondOwner, cut, initFacet, initData);
        orderBook = address(diamond);

        _registerMarket(orderBook, marketId, marketSymbol, metricUrl, settlementDate, startPrice);
        return (orderBook, marketId);
    }

    /**
     * @dev Meta-create for gasless market creation (V1 Diamond flow)
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
        bytes memory signature
    ) external 
        validMarketSymbol(marketSymbol)
        validMetricUrl(metricUrl)
        validSettlementDate(settlementDate)
        returns (address orderBook, bytes32 marketId) 
    {
        if (block.timestamp > deadline) revert MetaExpired();
        if (metaCreateNonce[creator] != nonce) revert BadNonce();
        if (startPrice == 0) revert InvalidOraclePrice();
        if (bytes(dataSource).length == 0) revert InvalidInput();
        if (tags.length > 10) revert InvalidInput();
        if (diamondOwner == address(0) || initFacet == address(0)) revert ZeroAddress();

        bytes32 tagsHash = _hashTags(tags);
        bytes32 cutHash = _hashCut(cut);
        bytes32 structHash = keccak256(abi.encode(
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
        ));
        bytes32 digest = _hashTypedDataV4(structHash);
        address signer = ECDSA.recover(digest, signature);
        if (signer != creator) revert BadSignature();

        metaCreateNonce[creator] = nonce + 1;

        if (marketCreationFee > 0) {
            vault.deductFees(creator, marketCreationFee, feeRecipient);
        }

        marketId = keccak256(abi.encodePacked(marketSymbol, metricUrl, creator, block.timestamp, block.number));
        if (marketExists[marketId]) revert MarketIdCollision();

        address bm = bondManager;
        if (bm == address(0)) revert InvalidInput();
        IMarketBondManager(bm).onMarketCreate(marketId, creator);

        bytes4 initSel = bytes4(keccak256("obInitialize(address,bytes32,address)"));
        bytes memory initData = abi.encodeWithSelector(initSel, address(vault), marketId, feeRecipient);
        Diamond diamond = new Diamond(diamondOwner, cut, initFacet, initData);
        orderBook = address(diamond);

        _registerMarket(orderBook, marketId, marketSymbol, metricUrl, settlementDate, startPrice);
        marketCreators[marketId] = creator;
        return (orderBook, marketId);
    }

    /**
     * @dev V2: Create market using DiamondRegistry (auto-upgrades via FacetRegistry)
     */
    function createFuturesMarketV2(
        string memory marketSymbol,
        string memory metricUrl,
        uint256 settlementDate,
        uint256 startPrice,
        string memory dataSource,
        string[] memory tags,
        address diamondOwner
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
        if (facetRegistry == address(0) || initFacetAddress == address(0)) revert InvalidInput();

        if (marketCreationFee > 0 && msg.sender != admin) {
            vault.deductFees(msg.sender, marketCreationFee, feeRecipient);
        }
        
        marketId = keccak256(abi.encodePacked(marketSymbol, metricUrl, msg.sender, block.timestamp, block.number));
        if (marketExists[marketId]) revert MarketIdCollision();

        address bm = bondManager;
        if (bm == address(0)) revert InvalidInput();
        IMarketBondManager(bm).onMarketCreate(marketId, msg.sender);

        bytes4 initSel = bytes4(keccak256("obInitialize(address,bytes32,address)"));
        bytes memory initData = abi.encodeWithSelector(initSel, address(vault), marketId, feeRecipient);
        
        DiamondRegistry diamond = new DiamondRegistry(facetRegistry, diamondOwner, initFacetAddress, initData);
        orderBook = address(diamond);

        _registerMarket(orderBook, marketId, marketSymbol, metricUrl, settlementDate, startPrice);
        return (orderBook, marketId);
    }

    /**
     * @dev V2 Meta-create: Gasless market creation using DiamondRegistry (auto-upgrades)
     * No facet cuts required - uses centralized FacetRegistry
     */
    function metaCreateFuturesMarketV2(
        string memory marketSymbol,
        string memory metricUrl,
        uint256 settlementDate,
        uint256 startPrice,
        string memory dataSource,
        string[] memory tags,
        address diamondOwner,
        address creator,
        uint256 nonce,
        uint256 deadline,
        bytes memory signature
    ) external 
        validMarketSymbol(marketSymbol)
        validMetricUrl(metricUrl)
        validSettlementDate(settlementDate)
        returns (address orderBook, bytes32 marketId) 
    {
        if (block.timestamp > deadline) revert MetaExpired();
        if (metaCreateNonce[creator] != nonce) revert BadNonce();
        if (startPrice == 0) revert InvalidOraclePrice();
        if (bytes(dataSource).length == 0) revert InvalidInput();
        if (tags.length > 10) revert InvalidInput();
        if (diamondOwner == address(0)) revert ZeroAddress();
        if (facetRegistry == address(0) || initFacetAddress == address(0)) revert InvalidInput();

        bytes32 tagsHash = _hashTags(tags);
        bytes32 structHash = keccak256(abi.encode(
            TYPEHASH_META_CREATE_V2,
            keccak256(bytes(marketSymbol)),
            keccak256(bytes(metricUrl)),
            settlementDate,
            startPrice,
            keccak256(bytes(dataSource)),
            tagsHash,
            diamondOwner,
            creator,
            nonce,
            deadline
        ));
        bytes32 digest = _hashTypedDataV4(structHash);
        address signer = ECDSA.recover(digest, signature);
        if (signer != creator) revert BadSignature();

        metaCreateNonce[creator] = nonce + 1;

        if (marketCreationFee > 0) {
            vault.deductFees(creator, marketCreationFee, feeRecipient);
        }

        marketId = keccak256(abi.encodePacked(marketSymbol, metricUrl, creator, block.timestamp, block.number));
        if (marketExists[marketId]) revert MarketIdCollision();

        address bm = bondManager;
        if (bm == address(0)) revert InvalidInput();
        IMarketBondManager(bm).onMarketCreate(marketId, creator);

        bytes4 initSel = bytes4(keccak256("obInitialize(address,bytes32,address)"));
        bytes memory initData = abi.encodeWithSelector(initSel, address(vault), marketId, feeRecipient);
        
        DiamondRegistry diamond = new DiamondRegistry(facetRegistry, diamondOwner, initFacetAddress, initData);
        orderBook = address(diamond);

        _registerMarket(orderBook, marketId, marketSymbol, metricUrl, settlementDate, startPrice);
        marketCreators[marketId] = creator;
        return (orderBook, marketId);
    }

    function _registerMarket(
        address orderBook,
        bytes32 marketId,
        string memory marketSymbol,
        string memory metricUrl,
        uint256 settlementDate,
        uint256 startPrice
    ) internal {
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
    }

    function deactivateFuturesMarket(address orderBook) external {
        if (orderBook == address(0)) revert ZeroAddress();
        bytes32 marketId = orderBookToMarket[orderBook];
        if (marketId == bytes32(0)) revert MarketNotFound();
        if (!(msg.sender == admin || msg.sender == marketCreators[marketId])) revert NotAuthorized();
        
        address bm = bondManager;
        if (bm != address(0)) {
            IMarketBondManager(bm).onMarketDeactivate(marketId, orderBook, msg.sender);
        }
        
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

    // Admin functions
    function updateMarketCreationFee(uint256 newFee) external onlyAdmin { marketCreationFee = newFee; }
    function togglePublicMarketCreation(bool enabled) external onlyAdmin { publicMarketCreation = enabled; }
    function updateAdmin(address newAdmin) external onlyAdmin { if (newAdmin == address(0)) revert ZeroAddress(); admin = newAdmin; }
    function updateFeeRecipient(address newFeeRecipient) external onlyAdmin { if (newFeeRecipient == address(0)) revert ZeroAddress(); feeRecipient = newFeeRecipient; }
    function setBondManager(address newBondManager) external onlyAdmin { bondManager = newBondManager; }
    function setFacetRegistry(address _facetRegistry) external onlyAdmin { if (_facetRegistry == address(0)) revert ZeroAddress(); facetRegistry = _facetRegistry; }
    function setInitFacet(address _initFacet) external onlyAdmin { if (_initFacet == address(0)) revert ZeroAddress(); initFacetAddress = _initFacet; }
    function setVault(address _vault) external onlyAdmin { if (_vault == address(0)) revert ZeroAddress(); vault = CoreVault(_vault); }

    // View functions
    function getOrderBookForMarket(bytes32 marketId) external view returns (address) { return marketToOrderBook[marketId]; }
    function getAllMarkets() external view returns (bytes32[] memory) { return allMarkets; }
    function getMarketSymbol(bytes32 marketId) external view returns (string memory) { return marketSymbols[marketId]; }
}
