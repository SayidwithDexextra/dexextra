// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title GlobalSessionRegistry
 * @notice Centralized registry for "sign once, trade many" sessions shared across all markets (diamonds).
 *         OrderBook facets call chargeSession(...) before executing, which enforces expiry, relayer allowlist,
 *         method allowlist, and per-trade/per-session budget constraints globally.
 */
contract GlobalSessionRegistry is EIP712, Ownable {
    constructor(address initialOwner) EIP712("DexetraMeta", "1") Ownable(initialOwner) {}

    // Allowlist of markets (diamonds) that can charge sessions
    mapping(address => bool) public allowedOrderbook;

    // Per-trader nonce to protect SessionPermit from replay
    mapping(address => uint256) public metaNonce;

    // Session state shared across all markets
    struct Session {
        address trader;
        // Merkle root of allowed relayer EOAs for this session
        bytes32 relayerSetRoot;
        uint256 expiry;
        uint256 maxNotionalPerTrade;
        uint256 maxNotionalPerSession;
        uint256 sessionNotionalUsed;
        bytes32 methodsBitmap;
        bool revoked;
    }
    mapping(bytes32 => Session) public sessions;

    event SessionCreated(bytes32 indexed sessionId, address indexed trader, bytes32 relayerSetRoot, uint256 expiry);
    event SessionRevoked(bytes32 indexed sessionId, address indexed trader);
    event SessionCharged(bytes32 indexed sessionId, uint256 notionalUsed, uint256 newSessionTotalUsed, uint8 methodBit);
    event OrderbookAllowed(address indexed orderbook, bool allowed);

    // EIP-712 typed data
    struct SessionPermit {
        address trader;
        // Merkle root of allowed relayer EOAs for this session
        bytes32 relayerSetRoot;
        uint256 expiry;
        uint256 maxNotionalPerTrade;
        uint256 maxNotionalPerSession;
        bytes32 methodsBitmap;
        bytes32 sessionSalt;
        bytes32[] allowedMarkets; // presently unused for enforcement; kept for forward-compat and hashing parity
        uint256 nonce;
    }
    bytes32 private constant TYPEHASH_SESSION_PERMIT =
        keccak256("SessionPermit(address trader,bytes32 relayerSetRoot,uint256 expiry,uint256 maxNotionalPerTrade,uint256 maxNotionalPerSession,bytes32 methodsBitmap,bytes32 sessionSalt,bytes32[] allowedMarkets,uint256 nonce)");

    function setAllowedOrderbook(address orderbook, bool allowed) external onlyOwner {
        allowedOrderbook[orderbook] = allowed;
        emit OrderbookAllowed(orderbook, allowed);
    }

    function _sessionId(address trader, bytes32 relayerSetRoot, bytes32 sessionSalt) internal pure returns (bytes32) {
        return keccak256(abi.encode(trader, relayerSetRoot, sessionSalt));
    }

    function _hashArray(bytes32[] memory arr) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(arr));
    }

    function createSession(SessionPermit calldata p, bytes calldata signature) external returns (bytes32 sessionId) {
        require(block.timestamp <= p.expiry, "session: expired");
        // Verify EIP-712 signature
        bytes32 structHash = keccak256(
            abi.encode(
                TYPEHASH_SESSION_PERMIT,
                p.trader,
                p.relayerSetRoot,
                p.expiry,
                p.maxNotionalPerTrade,
                p.maxNotionalPerSession,
                p.methodsBitmap,
                p.sessionSalt,
                _hashArray(p.allowedMarkets),
                p.nonce
            )
        );
        bytes32 digest = _hashTypedDataV4(structHash);
        address signer = ECDSA.recover(digest, signature);
        require(signer == p.trader, "session: bad sig");

        // Nonce
        require(p.nonce == metaNonce[p.trader], "session: bad nonce");
        unchecked {
            metaNonce[p.trader] = p.nonce + 1;
        }

        // Create or replace if expired/revoked
        sessionId = _sessionId(p.trader, p.relayerSetRoot, p.sessionSalt);
        Session storage s = sessions[sessionId];
        if (s.trader != address(0)) {
            require(s.revoked || block.timestamp > s.expiry, "session: exists");
        }
        s.trader = p.trader;
        s.relayerSetRoot = p.relayerSetRoot;
        s.expiry = p.expiry;
        s.maxNotionalPerTrade = p.maxNotionalPerTrade;
        s.maxNotionalPerSession = p.maxNotionalPerSession;
        s.sessionNotionalUsed = 0;
        s.methodsBitmap = p.methodsBitmap;
        s.revoked = false;
        emit SessionCreated(sessionId, p.trader, p.relayerSetRoot, p.expiry);
    }

    function revokeSession(bytes32 sessionId, bytes32[] calldata relayerProof) external {
        Session storage s = sessions[sessionId];
        require(s.trader != address(0), "session: unknown");
        if (msg.sender != s.trader) {
            // Allow any relayer in the set to revoke (gasless UX); trader can always revoke without proof.
            require(isRelayerAllowed(sessionId, msg.sender, relayerProof), "session: not auth");
        }
        s.revoked = true;
        emit SessionRevoked(sessionId, s.trader);
    }

    function _leafForRelayer(address relayer) internal pure returns (bytes32) {
        // Leaf = keccak256(abi.encodePacked(relayer))
        return keccak256(abi.encodePacked(relayer));
    }

    function isRelayerAllowed(bytes32 sessionId, address relayer, bytes32[] calldata relayerProof) public view returns (bool) {
        Session storage s = sessions[sessionId];
        if (s.trader == address(0)) return false;
        return MerkleProof.verify(relayerProof, s.relayerSetRoot, _leafForRelayer(relayer));
    }

    /**
     * @notice Enforce session constraints and charge usage. Callable only by allowed markets (diamonds).
     * @param sessionId session identifier
     * @param trader expected trader for this session
     * @param methodBit method bit used for allowlisting
     * @param notional trade notional used for budget checks
     */
    function chargeSession(
        bytes32 sessionId,
        address trader,
        uint8 methodBit,
        uint256 notional,
        address relayer,
        bytes32[] calldata relayerProof
    ) external {
        require(allowedOrderbook[msg.sender], "session: caller not allowed");
        Session storage s = sessions[sessionId];
        require(s.trader != address(0), "session: unknown");
        require(!s.revoked, "session: revoked");
        require(block.timestamp <= s.expiry, "session: expired");
        require(trader == s.trader, "session: bad trader");
        require(isRelayerAllowed(sessionId, relayer, relayerProof), "session: bad relayer");
        require((uint256(s.methodsBitmap) & (uint256(1) << methodBit)) != 0, "session: method denied");
        if (s.maxNotionalPerTrade > 0) {
            require(notional <= s.maxNotionalPerTrade, "session: trade cap");
        }
        if (s.maxNotionalPerSession > 0) {
            require(s.sessionNotionalUsed + notional <= s.maxNotionalPerSession, "session: session cap");
        }
        if (notional > 0) {
            unchecked {
                s.sessionNotionalUsed += notional;
            }
        }
        emit SessionCharged(sessionId, notional, s.sessionNotionalUsed, methodBit);
    }
}









