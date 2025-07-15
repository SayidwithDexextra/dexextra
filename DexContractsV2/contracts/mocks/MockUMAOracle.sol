// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title MockUMAOracle
 * @dev Mock implementation of UMA's OptimisticOracleV3 for testing
 */
contract MockUMAOracle {
    struct PriceRequest {
        address requester;
        bytes32 identifier;
        uint256 timestamp;
        bytes ancillaryData;
        address currency;
        uint256 reward;
        bool hasPrice;
        int256 price;
        uint256 finalFee;
    }
    
    mapping(bytes32 => PriceRequest) public requests;
    uint256 public finalFee = 1000e6; // 1000 USDC
    
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
    
    event PriceSettled(
        address indexed requester,
        bytes32 indexed identifier,
        uint256 timestamp,
        bytes ancillaryData,
        int256 price
    );
    
    function requestPrice(
        bytes32 identifier,
        uint256 timestamp,
        bytes memory ancillaryData,
        address currency,
        uint256 reward
    ) external returns (uint256) {
        bytes32 requestId = keccak256(abi.encodePacked(msg.sender, identifier, timestamp, ancillaryData));
        
        requests[requestId] = PriceRequest({
            requester: msg.sender,
            identifier: identifier,
            timestamp: timestamp,
            ancillaryData: ancillaryData,
            currency: currency,
            reward: reward,
            hasPrice: false,
            price: 0,
            finalFee: finalFee
        });
        
        emit PriceRequested(msg.sender, identifier, timestamp, ancillaryData, currency, reward, finalFee);
        return uint256(requestId);
    }
    
    function proposePrice(
        address requester,
        bytes32 identifier,
        uint256 timestamp,
        bytes memory ancillaryData,
        int256 proposedPrice
    ) external returns (uint256) {
        bytes32 requestId = keccak256(abi.encodePacked(requester, identifier, timestamp, ancillaryData));
        
        PriceRequest storage request = requests[requestId];
        require(request.requester == requester, "MockUMA: Invalid request");
        
        request.hasPrice = true;
        request.price = proposedPrice;
        
        emit PriceProposed(requester, msg.sender, identifier, timestamp, ancillaryData, proposedPrice);
        emit PriceSettled(requester, identifier, timestamp, ancillaryData, proposedPrice);
        
        return uint256(requestId);
    }
    
    function disputePrice(
        address requester,
        bytes32 identifier,
        uint256 timestamp,
        bytes memory ancillaryData
    ) external returns (uint256) {
        bytes32 requestId = keccak256(abi.encodePacked(requester, identifier, timestamp, ancillaryData));
        // For mock purposes, disputes are not implemented
        return uint256(requestId);
    }
    
    function settledPrice(
        bytes32 identifier,
        uint256 timestamp,
        bytes memory ancillaryData
    ) external view returns (bool hasPrice, int256 price, uint256 settlementTime) {
        bytes32 requestId = keccak256(abi.encodePacked(msg.sender, identifier, timestamp, ancillaryData));
        PriceRequest storage request = requests[requestId];
        
        return (request.hasPrice, request.price, block.timestamp);
    }
    
    function getCurrentFinalFee(address currency) external view returns (uint256) {
        return finalFee;
    }
    
    function stampAncillaryData(bytes memory ancillaryData, address requester) 
        external pure returns (bytes memory) {
        return abi.encodePacked(ancillaryData, ",requester:", requester);
    }
    
    // Helper functions for testing
    function setFinalFee(uint256 _finalFee) external {
        finalFee = _finalFee;
    }
    
    function setPrice(
        address requester,
        bytes32 identifier,
        uint256 timestamp,
        bytes memory ancillaryData,
        int256 price
    ) external {
        bytes32 requestId = keccak256(abi.encodePacked(requester, identifier, timestamp, ancillaryData));
        PriceRequest storage request = requests[requestId];
        
        request.hasPrice = true;
        request.price = price;
        
        emit PriceSettled(requester, identifier, timestamp, ancillaryData, price);
    }
} 