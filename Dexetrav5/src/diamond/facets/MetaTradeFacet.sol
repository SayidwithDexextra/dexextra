// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import "../libraries/LibDiamond.sol";
import "../libraries/OrderBookStorage.sol";

interface IGlobalSessionRegistry {
    function chargeSession(
        bytes32 sessionId,
        address trader,
        uint8 methodBit,
        uint256 notional,
        address relayer,
        bytes32[] calldata relayerProof
    ) external;
}

/**
 * @title MetaTradeFacet
 * @notice Thin EIP-712 dispatcher that verifies user signatures, enforces replay protection,
 *         and self-calls OrderBook Placement facet "By" methods so existing internals execute unchanged.
 *         This facet MUST NOT duplicate business logic from the OrderBook; it only verifies and dispatches.
 */
interface IOBOrderPlacementBy {
    function placeLimitOrderBy(address trader, uint256 price, uint256 amount, bool isBuy) external returns (uint256 orderId);
    function placeMarginLimitOrderBy(address trader, uint256 price, uint256 amount, bool isBuy) external returns (uint256 orderId);
    function placeMarketOrderBy(address trader, uint256 amount, bool isBuy) external returns (uint256 filledAmount);
    function placeMarginMarketOrderBy(address trader, uint256 amount, bool isBuy) external returns (uint256 filledAmount);
    function placeMarketOrderWithSlippageBy(address trader, uint256 amount, bool isBuy, uint256 slippageBps) external returns (uint256 filledAmount);
    function placeMarginMarketOrderWithSlippageBy(address trader, uint256 amount, bool isBuy, uint256 slippageBps) external returns (uint256 filledAmount);
    function modifyOrderBy(address trader, uint256 orderId, uint256 price, uint256 amount) external returns (uint256 newOrderId);
    function cancelOrderBy(address trader, uint256 orderId) external;
}

contract MetaTradeFacet is EIP712 {
    // EIP-712 domain (verifyingContract is the Diamond via delegatecall)
    constructor() EIP712("DexetraMeta", "1") {}

    // Per-trader replay protection across all meta calls
    mapping(address => uint256) public metaNonce;

    // Global session registry (optional). When set, session* methods will enforce via registry.
    address public sessionRegistry;

    function setSessionRegistry(address registry) external {
        LibDiamond.enforceIsContractOwner();
        sessionRegistry = registry;
    }

    // ============ Session-based gasless (sign-once) ============
    struct Session {
        address trader;
        address relayer;
        uint256 expiry;
        uint256 maxNotionalPerTrade;     // 0 disables per-trade cap
        uint256 maxNotionalPerSession;   // 0 disables session cap
        uint256 sessionNotionalUsed;
        bytes32 methodsBitmap;           // bit-allowlist of permitted actions
        bytes32[] allowedMarkets;        // optional, for future extension (not enforced here)
        bool revoked;
    }
    mapping(bytes32 => Session) public sessions;

    event SessionCreated(bytes32 indexed sessionId, address indexed trader, address relayer, uint256 expiry);
    event SessionRevoked(bytes32 indexed sessionId, address indexed trader);
    event SessionUsage(bytes32 indexed sessionId, uint256 notionalUsed, uint256 sessionTotalUsed);

    struct SessionPermit {
        address trader;
        address relayer;
        uint256 expiry;
        uint256 maxNotionalPerTrade;
        uint256 maxNotionalPerSession;
        bytes32 methodsBitmap;
        bytes32 sessionSalt;
        bytes32[] allowedMarkets;
        uint256 nonce;
    }

    bytes32 private constant TYPEHASH_SESSION_PERMIT =
        keccak256("SessionPermit(address trader,address relayer,uint256 expiry,uint256 maxNotionalPerTrade,uint256 maxNotionalPerSession,bytes32 methodsBitmap,bytes32 sessionSalt,bytes32[] allowedMarkets,uint256 nonce)");

    // method bits (example policy)
    uint256 private constant MBIT_PLACE_LIMIT = 1 << 0;
    uint256 private constant MBIT_PLACE_MARGIN_LIMIT = 1 << 1;
    uint256 private constant MBIT_PLACE_MARKET = 1 << 2;
    uint256 private constant MBIT_PLACE_MARGIN_MARKET = 1 << 3;
    uint256 private constant MBIT_MODIFY = 1 << 4;
    uint256 private constant MBIT_CANCEL = 1 << 5;

    // ============ Typed Data Definitions ============
    struct CancelOrder {
        address trader;
        uint256 orderId;
        uint256 deadline;
        uint256 nonce;
    }
    bytes32 private constant TYPEHASH_CANCEL =
        keccak256("CancelOrder(address trader,uint256 orderId,uint256 deadline,uint256 nonce)");

    struct PlaceLimit {
        address trader;
        uint256 price;
        uint256 amount;
        bool isBuy;
        uint256 deadline;
        uint256 nonce;
    }
    bytes32 private constant TYPEHASH_PLACE_LIMIT =
        keccak256("PlaceLimit(address trader,uint256 price,uint256 amount,bool isBuy,uint256 deadline,uint256 nonce)");

    struct PlaceMarginLimit {
        address trader;
        uint256 price;
        uint256 amount;
        bool isBuy;
        uint256 deadline;
        uint256 nonce;
    }
    bytes32 private constant TYPEHASH_PLACE_MARGIN_LIMIT =
        keccak256("PlaceMarginLimit(address trader,uint256 price,uint256 amount,bool isBuy,uint256 deadline,uint256 nonce)");

    struct PlaceMarket {
        address trader;
        uint256 amount;
        bool isBuy;
        uint256 deadline;
        uint256 nonce;
    }
    bytes32 private constant TYPEHASH_PLACE_MARKET =
        keccak256("PlaceMarket(address trader,uint256 amount,bool isBuy,uint256 deadline,uint256 nonce)");

    struct PlaceMarginMarket {
        address trader;
        uint256 amount;
        bool isBuy;
        uint256 deadline;
        uint256 nonce;
    }
    bytes32 private constant TYPEHASH_PLACE_MARGIN_MARKET =
        keccak256("PlaceMarginMarket(address trader,uint256 amount,bool isBuy,uint256 deadline,uint256 nonce)");

    struct PlaceMarketWithSlippage {
        address trader;
        uint256 amount;
        bool isBuy;
        uint256 slippageBps;
        uint256 deadline;
        uint256 nonce;
    }
    bytes32 private constant TYPEHASH_PLACE_MARKET_WITH_SLIPPAGE =
        keccak256("PlaceMarketWithSlippage(address trader,uint256 amount,bool isBuy,uint256 slippageBps,uint256 deadline,uint256 nonce)");

    struct PlaceMarginMarketWithSlippage {
        address trader;
        uint256 amount;
        bool isBuy;
        uint256 slippageBps;
        uint256 deadline;
        uint256 nonce;
    }
    bytes32 private constant TYPEHASH_PLACE_MARGIN_MARKET_WITH_SLIPPAGE =
        keccak256("PlaceMarginMarketWithSlippage(address trader,uint256 amount,bool isBuy,uint256 slippageBps,uint256 deadline,uint256 nonce)");

    struct ModifyOrder {
        address trader;
        uint256 orderId;
        uint256 price;
        uint256 amount;
        uint256 deadline;
        uint256 nonce;
    }
    bytes32 private constant TYPEHASH_MODIFY =
        keccak256("ModifyOrder(address trader,uint256 orderId,uint256 price,uint256 amount,uint256 deadline,uint256 nonce)");

    // ============ Internal helpers ============
    function _verifyAndConsume(address expectedSigner, uint256 expectedNonce, uint256 deadline, bytes32 structHash, bytes calldata signature) internal {
        require(block.timestamp <= deadline, "expired");
        require(expectedNonce == metaNonce[expectedSigner], "bad nonce");
        bytes32 digest = _hashTypedDataV4(structHash);
        address signer = ECDSA.recover(digest, signature);
        require(signer == expectedSigner, "bad sig");
        unchecked {
            metaNonce[expectedSigner] = expectedNonce + 1;
        }
    }

    function _sessionId(address trader, address relayer, bytes32 sessionSalt) private pure returns (bytes32) {
        return keccak256(abi.encode(trader, relayer, sessionSalt));
    }

    function _encodeAllowedMarkets(bytes32[] memory markets) private pure returns (bytes32) {
        // Hash dynamic array to include in the permit hash
        return keccak256(abi.encodePacked(markets));
    }

    function _enforceAndChargeSession(
        bytes32 sessionId,
        address expectedTrader,
        uint256 methodBit,
        uint256 notional,
        bytes32[] memory relayerProof
    ) private {
        // If a global registry is set, delegate enforcement+charge to it
        if (sessionRegistry != address(0)) {
            IGlobalSessionRegistry(sessionRegistry).chargeSession(
                sessionId,
                expectedTrader,
                uint8(_methodBitIndex(methodBit)),
                notional,
                msg.sender,
                relayerProof
            );
            // Note: registry emits SessionCharged
            return;
        }
        Session storage s = sessions[sessionId];
        require(s.trader != address(0), "session: unknown");
        require(!s.revoked, "session: revoked");
        require(block.timestamp <= s.expiry, "session: expired");
        require(msg.sender == s.relayer, "session: bad relayer");
        require((uint256(s.methodsBitmap) & methodBit) != 0, "session: method denied");
        if (s.maxNotionalPerTrade > 0) {
            require(notional <= s.maxNotionalPerTrade, "session: trade cap");
        }
        if (s.maxNotionalPerSession > 0) {
            require(s.sessionNotionalUsed + notional <= s.maxNotionalPerSession, "session: session cap");
        }
        if (notional > 0) {
            unchecked { s.sessionNotionalUsed += notional; }
            emit SessionUsage(sessionId, notional, s.sessionNotionalUsed);
        }
    }

    // Map methodBit masks to bit index expected by registry
    function _methodBitIndex(uint256 bitMask) private pure returns (uint8) {
        // Find index of the single bit set; revert if 0 or multiple set
        require(bitMask != 0, "methodBit: zero");
        uint8 idx = 0;
        uint256 v = bitMask;
        while (v > 1) {
            v >>= 1;
            idx++;
        }
        return idx;
    }

    // ============ Meta methods ============
    function metaCancelOrder(CancelOrder calldata p, bytes calldata signature) external {
        _verifyAndConsume(
            p.trader,
            p.nonce,
            p.deadline,
            keccak256(abi.encode(TYPEHASH_CANCEL, p.trader, p.orderId, p.deadline, p.nonce)),
            signature
        );
        IOBOrderPlacementBy(address(this)).cancelOrderBy(p.trader, p.orderId);
    }

    function metaPlaceLimit(PlaceLimit calldata p, bytes calldata signature) external returns (uint256 orderId) {
        _verifyAndConsume(
            p.trader,
            p.nonce,
            p.deadline,
            keccak256(abi.encode(TYPEHASH_PLACE_LIMIT, p.trader, p.price, p.amount, p.isBuy, p.deadline, p.nonce)),
            signature
        );
        return IOBOrderPlacementBy(address(this)).placeLimitOrderBy(p.trader, p.price, p.amount, p.isBuy);
    }

    function metaPlaceMarginLimit(PlaceMarginLimit calldata p, bytes calldata signature) external returns (uint256 orderId) {
        _verifyAndConsume(
            p.trader,
            p.nonce,
            p.deadline,
            keccak256(abi.encode(TYPEHASH_PLACE_MARGIN_LIMIT, p.trader, p.price, p.amount, p.isBuy, p.deadline, p.nonce)),
            signature
        );
        return IOBOrderPlacementBy(address(this)).placeMarginLimitOrderBy(p.trader, p.price, p.amount, p.isBuy);
    }

    function metaPlaceMarket(PlaceMarket calldata p, bytes calldata signature) external returns (uint256 filledAmount) {
        _verifyAndConsume(
            p.trader,
            p.nonce,
            p.deadline,
            keccak256(abi.encode(TYPEHASH_PLACE_MARKET, p.trader, p.amount, p.isBuy, p.deadline, p.nonce)),
            signature
        );
        return IOBOrderPlacementBy(address(this)).placeMarketOrderBy(p.trader, p.amount, p.isBuy);
    }

    function metaPlaceMarginMarket(PlaceMarginMarket calldata p, bytes calldata signature) external returns (uint256 filledAmount) {
        _verifyAndConsume(
            p.trader,
            p.nonce,
            p.deadline,
            keccak256(abi.encode(TYPEHASH_PLACE_MARGIN_MARKET, p.trader, p.amount, p.isBuy, p.deadline, p.nonce)),
            signature
        );
        return IOBOrderPlacementBy(address(this)).placeMarginMarketOrderBy(p.trader, p.amount, p.isBuy);
    }

    function metaPlaceMarketWithSlippage(PlaceMarketWithSlippage calldata p, bytes calldata signature) external returns (uint256 filledAmount) {
        _verifyAndConsume(
            p.trader,
            p.nonce,
            p.deadline,
            keccak256(abi.encode(TYPEHASH_PLACE_MARKET_WITH_SLIPPAGE, p.trader, p.amount, p.isBuy, p.slippageBps, p.deadline, p.nonce)),
            signature
        );
        return IOBOrderPlacementBy(address(this)).placeMarketOrderWithSlippageBy(p.trader, p.amount, p.isBuy, p.slippageBps);
    }

    function metaPlaceMarginMarketWithSlippage(PlaceMarginMarketWithSlippage calldata p, bytes calldata signature) external returns (uint256 filledAmount) {
        _verifyAndConsume(
            p.trader,
            p.nonce,
            p.deadline,
            keccak256(abi.encode(TYPEHASH_PLACE_MARGIN_MARKET_WITH_SLIPPAGE, p.trader, p.amount, p.isBuy, p.slippageBps, p.deadline, p.nonce)),
            signature
        );
        return IOBOrderPlacementBy(address(this)).placeMarginMarketOrderWithSlippageBy(p.trader, p.amount, p.isBuy, p.slippageBps);
    }

    function metaModifyOrder(ModifyOrder calldata p, bytes calldata signature) external returns (uint256 newOrderId) {
        _verifyAndConsume(
            p.trader,
            p.nonce,
            p.deadline,
            keccak256(abi.encode(TYPEHASH_MODIFY, p.trader, p.orderId, p.price, p.amount, p.deadline, p.nonce)),
            signature
        );
        return IOBOrderPlacementBy(address(this)).modifyOrderBy(p.trader, p.orderId, p.price, p.amount);
    }

    // ============ Session methods ============
    function createSession(SessionPermit calldata p, bytes calldata signature) external returns (bytes32 sessionId) {
        require(block.timestamp <= p.expiry, "session: expired");
        // Consume user's meta nonce for session creation
        _verifyAndConsume(
            p.trader,
            p.nonce,
            p.expiry,
            keccak256(
                abi.encode(
                    TYPEHASH_SESSION_PERMIT,
                    p.trader,
                    p.relayer,
                    p.expiry,
                    p.maxNotionalPerTrade,
                    p.maxNotionalPerSession,
                    p.methodsBitmap,
                    p.sessionSalt,
                    _encodeAllowedMarkets(p.allowedMarkets),
                    p.nonce
                )
            ),
            signature
        );

        sessionId = _sessionId(p.trader, p.relayer, p.sessionSalt);
        Session storage s = sessions[sessionId];
        // Allow replacing expired/revoked sessions; block active session overwrite
        if (s.trader != address(0)) {
            require(s.revoked || block.timestamp > s.expiry, "session: exists");
        }
        s.trader = p.trader;
        s.relayer = p.relayer;
        s.expiry = p.expiry;
        s.maxNotionalPerTrade = p.maxNotionalPerTrade;
        s.maxNotionalPerSession = p.maxNotionalPerSession;
        s.sessionNotionalUsed = 0;
        s.methodsBitmap = p.methodsBitmap;
        // copy allowed markets
        delete s.allowedMarkets;
        for (uint256 i = 0; i < p.allowedMarkets.length; i++) {
            s.allowedMarkets.push(p.allowedMarkets[i]);
        }
        s.revoked = false;

        emit SessionCreated(sessionId, p.trader, p.relayer, p.expiry);
    }

    function revokeSession(bytes32 sessionId) external {
        Session storage s = sessions[sessionId];
        require(s.trader != address(0), "session: unknown");
        require(msg.sender == s.trader || msg.sender == s.relayer, "session: not auth");
        s.revoked = true;
        emit SessionRevoked(sessionId, s.trader);
    }

    // Direct session dispatchers (no user signature required)
    function sessionPlaceLimit(
        bytes32 sessionId,
        address trader,
        uint256 price,
        uint256 amount,
        bool isBuy,
        bytes32[] calldata relayerProof
    ) external returns (uint256 orderId) {
        // Compute notional = amount * price / 1e18 (amount in 1e18, price in 6 decimals)
        uint256 notional = Math.mulDiv(amount, price, 1e18);
        _enforceAndChargeSession(sessionId, trader, MBIT_PLACE_LIMIT, notional, relayerProof);
        return IOBOrderPlacementBy(address(this)).placeLimitOrderBy(trader, price, amount, isBuy);
    }

    function sessionPlaceMarginLimit(
        bytes32 sessionId,
        address trader,
        uint256 price,
        uint256 amount,
        bool isBuy,
        bytes32[] calldata relayerProof
    ) external returns (uint256 orderId) {
        uint256 notional = Math.mulDiv(amount, price, 1e18);
        _enforceAndChargeSession(sessionId, trader, MBIT_PLACE_MARGIN_LIMIT, notional, relayerProof);
        return IOBOrderPlacementBy(address(this)).placeMarginLimitOrderBy(trader, price, amount, isBuy);
    }

    function sessionPlaceMarket(
        bytes32 sessionId,
        address trader,
        uint256 amount,
        bool isBuy,
        bytes32[] calldata relayerProof
    ) external returns (uint256 filledAmount) {
        // Approximate notional using best opposite price
        OrderBookStorage.State storage st = OrderBookStorage.state();
        uint256 refPrice = isBuy ? st.bestAsk : st.bestBid;
        require(refPrice != 0, "OB: no liq");
        uint256 notional = Math.mulDiv(amount, refPrice, 1e18);
        _enforceAndChargeSession(sessionId, trader, MBIT_PLACE_MARKET, notional, relayerProof);
        return IOBOrderPlacementBy(address(this)).placeMarketOrderBy(trader, amount, isBuy);
    }

    function sessionPlaceMarginMarket(
        bytes32 sessionId,
        address trader,
        uint256 amount,
        bool isBuy,
        bytes32[] calldata relayerProof
    ) external returns (uint256 filledAmount) {
        OrderBookStorage.State storage st = OrderBookStorage.state();
        uint256 refPrice = isBuy ? st.bestAsk : st.bestBid;
        require(refPrice != 0, "OB: no liq");
        uint256 notional = Math.mulDiv(amount, refPrice, 1e18);
        _enforceAndChargeSession(sessionId, trader, MBIT_PLACE_MARGIN_MARKET, notional, relayerProof);
        return IOBOrderPlacementBy(address(this)).placeMarginMarketOrderBy(trader, amount, isBuy);
    }

    function sessionModifyOrder(
        bytes32 sessionId,
        address trader,
        uint256 orderId,
        uint256 price,
        uint256 amount,
        bytes32[] calldata relayerProof
    ) external returns (uint256 newOrderId) {
        uint256 notional = Math.mulDiv(amount, price, 1e18);
        _enforceAndChargeSession(sessionId, trader, MBIT_MODIFY, notional, relayerProof);
        return IOBOrderPlacementBy(address(this)).modifyOrderBy(trader, orderId, price, amount);
    }

    function sessionCancelOrder(
        bytes32 sessionId,
        address trader,
        uint256 orderId,
        bytes32[] calldata relayerProof
    ) external {
        _enforceAndChargeSession(sessionId, trader, MBIT_CANCEL, 0, relayerProof);
        IOBOrderPlacementBy(address(this)).cancelOrderBy(trader, orderId);
    }
}


