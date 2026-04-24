// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IFeeRegistry {
    function hypeUsdcRate6() external view returns (uint256);
    function maxGasFee6() external view returns (uint256);
    function gasEstimate() external view returns (uint256);
    function protocolFeeRecipient() external view returns (address);
    function getGasFeeConfig() external view returns (uint256 _hypeUsdcRate6, uint256 _maxGasFee6, uint256 _gasEstimate);
}

interface ICoreVaultFeeRegistry {
    function feeRegistry() external view returns (address);
}
