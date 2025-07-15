// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/**
 * @title IOptimisticOracleV3
 * @dev Interface for UMA's OptimisticOracleV3 contract
 */
interface IOptimisticOracleV3 {
    struct Request {
        address requester;
        bytes32 identifier;
        uint256 timestamp;
        bytes ancillaryData;
        IERC20 currency;
        uint256 reward;
        uint256 finalFee;
    }

    struct Assertion {
        bytes32 assertionId;
        address asserter;
        uint256 assertionTime;
        bool settled;
        IERC20 currency;
        uint256 expirationTime;
        bool truthfulnessReward;
        int256 settlementResolution;
    }

    // Events
    event PriceRequested(
        address indexed requester,
        bytes32 indexed identifier,
        uint256 timestamp,
        bytes ancillaryData,
        address currency,
        uint256 reward,
        uint256 finalFee
    );

    event PriceProposed(
        address indexed requester,
        address indexed proposer,
        bytes32 indexed identifier,
        uint256 timestamp,
        bytes ancillaryData,
        int256 proposedPrice
    );

    event PriceDisputed(
        address indexed requester,
        address indexed proposer,
        address indexed disputer,
        bytes32 identifier,
        uint256 timestamp,
        bytes ancillaryData
    );

    event PriceSettled(
        address indexed requester,
        bytes32 indexed identifier,
        uint256 timestamp,
        bytes ancillaryData,
        int256 price
    );

    // Request functions
    function requestPrice(
        bytes32 identifier,
        uint256 timestamp,
        bytes memory ancillaryData,
        IERC20 currency,
        uint256 reward
    ) external returns (uint256);

    function proposePrice(
        address requester,
        bytes32 identifier,
        uint256 timestamp,
        bytes memory ancillaryData,
        int256 proposedPrice
    ) external returns (uint256);

    function disputePrice(
        address requester,
        bytes32 identifier,
        uint256 timestamp,
        bytes memory ancillaryData
    ) external returns (uint256);

    // Query functions
    function getRequest(
        address requester,
        bytes32 identifier,
        uint256 timestamp,
        bytes memory ancillaryData
    ) external view returns (Request memory);

    function settledPrice(
        bytes32 identifier,
        uint256 timestamp,
        bytes memory ancillaryData
    ) external view returns (bool hasPrice, int256 price, uint256 settlementTime);

    function getCurrentFinalFee(IERC20 currency) external view returns (uint256);
    
    function stampAncillaryData(bytes memory ancillaryData, address requester) 
        external view returns (bytes memory);
} 