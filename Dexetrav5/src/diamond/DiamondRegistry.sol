// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./interfaces/IDiamondLoupe.sol";
import "./interfaces/IERC173.sol";

interface IFacetRegistry {
    function getFacet(bytes4 selector) external view returns (address);
    function getAllSelectors() external view returns (bytes4[] memory);
    function selectorToFacet(bytes4) external view returns (address);
}

/**
 * @title DiamondRegistry
 * @notice Diamond proxy that looks up facets from a central FacetRegistry.
 *         Enables platform-wide facet upgrades without per-market transactions.
 * @dev No local facet storage - all lookups go to the immutable registry address.
 */
contract DiamondRegistry is IDiamondLoupe, IERC173 {
    
    address public immutable facetRegistry;
    address private _owner;
    
    error FunctionDoesNotExist();
    error NewOwnerIsZero();
    error NotOwner();
    error InitializationFailed();
    
    constructor(
        address _registry,
        address _contractOwner,
        address _init,
        bytes memory _calldata
    ) {
        facetRegistry = _registry;
        _owner = _contractOwner;
        emit OwnershipTransferred(address(0), _contractOwner);
        
        if (_init != address(0)) {
            (bool success, bytes memory error) = _init.delegatecall(_calldata);
            if (!success) {
                if (error.length > 0) {
                    assembly { revert(add(error, 32), mload(error)) }
                }
                revert InitializationFailed();
            }
        }
    }
    
    // ============ IDiamondLoupe Implementation ============
    
    function facets() external view override returns (Facet[] memory facets_) {
        bytes4[] memory sels = IFacetRegistry(facetRegistry).getAllSelectors();
        
        address[] memory uniqueFacets = new address[](sels.length);
        uint256 uniqueCount = 0;
        
        for (uint256 i = 0; i < sels.length; i++) {
            address f = IFacetRegistry(facetRegistry).selectorToFacet(sels[i]);
            if (f == address(0)) continue;
            
            bool found = false;
            for (uint256 j = 0; j < uniqueCount; j++) {
                if (uniqueFacets[j] == f) { found = true; break; }
            }
            if (!found) {
                uniqueFacets[uniqueCount] = f;
                uniqueCount++;
            }
        }
        
        facets_ = new Facet[](uniqueCount);
        for (uint256 i = 0; i < uniqueCount; i++) {
            facets_[i].facetAddress = uniqueFacets[i];
            facets_[i].functionSelectors = facetFunctionSelectors(uniqueFacets[i]);
        }
    }
    
    function facetFunctionSelectors(address _facet) public view override returns (bytes4[] memory) {
        bytes4[] memory allSels = IFacetRegistry(facetRegistry).getAllSelectors();
        bytes4[] memory temp = new bytes4[](allSels.length);
        uint256 count = 0;
        
        for (uint256 i = 0; i < allSels.length; i++) {
            if (IFacetRegistry(facetRegistry).selectorToFacet(allSels[i]) == _facet) {
                temp[count] = allSels[i];
                count++;
            }
        }
        
        bytes4[] memory result = new bytes4[](count);
        for (uint256 i = 0; i < count; i++) {
            result[i] = temp[i];
        }
        return result;
    }
    
    function facetAddresses() public view override returns (address[] memory) {
        Facet[] memory f = this.facets();
        address[] memory addrs = new address[](f.length);
        for (uint256 i = 0; i < f.length; i++) {
            addrs[i] = f[i].facetAddress;
        }
        return addrs;
    }
    
    function facetAddress(bytes4 _selector) external view override returns (address) {
        return IFacetRegistry(facetRegistry).getFacet(_selector);
    }
    
    // ============ IERC173 Ownership ============
    
    function owner() external view override returns (address) {
        return _owner;
    }
    
    function transferOwnership(address _newOwner) external override {
        if (msg.sender != _owner) revert NotOwner();
        if (_newOwner == address(0)) revert NewOwnerIsZero();
        emit OwnershipTransferred(_owner, _newOwner);
        _owner = _newOwner;
    }
    
    // ============ Fallback - Registry Lookup ============
    
    fallback() external payable {
        address facet = IFacetRegistry(facetRegistry).getFacet(msg.sig);
        if (facet == address(0)) revert FunctionDoesNotExist();
        
        assembly {
            calldatacopy(0, 0, calldatasize())
            let result := delegatecall(gas(), facet, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            switch result
            case 0 { revert(0, returndatasize()) }
            default { return(0, returndatasize()) }
        }
    }
    
    receive() external payable {}
}
