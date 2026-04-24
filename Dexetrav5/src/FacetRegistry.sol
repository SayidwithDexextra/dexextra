// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title FacetRegistry
 * @notice Central registry for Diamond facet addresses. All DiamondRegistry contracts
 *         look up facets from here, enabling platform-wide upgrades with a single transaction.
 */
contract FacetRegistry {
    address public admin;
    uint256 public version;
    
    mapping(bytes4 => address) public selectorToFacet;
    bytes4[] public selectors;
    mapping(bytes4 => bool) public selectorExists;
    
    // Centralized FeeRegistry address - all markets read from here
    address public feeRegistry;
    
    event FacetsUpdated(uint256 indexed version, uint256 selectorCount);
    event FacetRegistered(address indexed facet, uint256 selectorCount);
    event AdminUpdated(address indexed oldAdmin, address indexed newAdmin);
    event FeeRegistryUpdated(address indexed oldFeeRegistry, address indexed newFeeRegistry);
    
    error OnlyAdmin();
    error ArrayLengthMismatch();
    error ZeroAddress();
    
    modifier onlyAdmin() {
        if (msg.sender != admin) revert OnlyAdmin();
        _;
    }
    
    constructor(address _admin) {
        if (_admin == address(0)) revert ZeroAddress();
        admin = _admin;
    }
    
    /**
     * @notice Bulk register/update selector-to-facet mappings
     * @param _selectors Array of function selectors
     * @param _facets Array of facet addresses (parallel to selectors)
     */
    function updateFacets(
        bytes4[] calldata _selectors,
        address[] calldata _facets
    ) external onlyAdmin {
        if (_selectors.length != _facets.length) revert ArrayLengthMismatch();
        
        for (uint256 i = 0; i < _selectors.length; i++) {
            selectorToFacet[_selectors[i]] = _facets[i];
            
            if (!selectorExists[_selectors[i]]) {
                selectors.push(_selectors[i]);
                selectorExists[_selectors[i]] = true;
            }
        }
        
        version++;
        emit FacetsUpdated(version, _selectors.length);
    }
    
    /**
     * @notice Register a single facet with all its selectors
     * @param _facet Facet contract address
     * @param _selectors Array of selectors this facet handles
     */
    function registerFacet(
        address _facet,
        bytes4[] calldata _selectors
    ) external onlyAdmin {
        if (_facet == address(0)) revert ZeroAddress();
        
        for (uint256 i = 0; i < _selectors.length; i++) {
            selectorToFacet[_selectors[i]] = _facet;
            
            if (!selectorExists[_selectors[i]]) {
                selectors.push(_selectors[i]);
                selectorExists[_selectors[i]] = true;
            }
        }
        
        version++;
        emit FacetRegistered(_facet, _selectors.length);
    }
    
    /**
     * @notice Remove selectors (set facet to zero address)
     * @param _selectors Selectors to remove
     */
    function removeSelectors(bytes4[] calldata _selectors) external onlyAdmin {
        for (uint256 i = 0; i < _selectors.length; i++) {
            selectorToFacet[_selectors[i]] = address(0);
        }
        version++;
    }
    
    /**
     * @notice Transfer admin role
     * @param _newAdmin New admin address
     */
    function updateAdmin(address _newAdmin) external onlyAdmin {
        if (_newAdmin == address(0)) revert ZeroAddress();
        emit AdminUpdated(admin, _newAdmin);
        admin = _newAdmin;
    }
    
    /**
     * @notice Set the global FeeRegistry address (all markets read from here)
     * @param _feeRegistry FeeRegistry contract address
     */
    function setFeeRegistry(address _feeRegistry) external onlyAdmin {
        address old = feeRegistry;
        feeRegistry = _feeRegistry;
        emit FeeRegistryUpdated(old, _feeRegistry);
    }
    
    /**
     * @notice Get facet address for a selector (called by Diamond fallback)
     * @param _selector Function selector
     * @return Facet address (or zero if not registered)
     */
    function getFacet(bytes4 _selector) external view returns (address) {
        return selectorToFacet[_selector];
    }
    
    /**
     * @notice Get all registered selectors
     * @return Array of all selectors
     */
    function getAllSelectors() external view returns (bytes4[] memory) {
        return selectors;
    }
    
    /**
     * @notice Get total selector count
     * @return Number of registered selectors
     */
    function selectorCount() external view returns (uint256) {
        return selectors.length;
    }
    
    /**
     * @notice Get selectors for a specific facet
     * @param _facet Facet address to query
     * @return Array of selectors handled by this facet
     */
    function getSelectorsForFacet(address _facet) external view returns (bytes4[] memory) {
        uint256 count = 0;
        for (uint256 i = 0; i < selectors.length; i++) {
            if (selectorToFacet[selectors[i]] == _facet) count++;
        }
        
        bytes4[] memory result = new bytes4[](count);
        uint256 idx = 0;
        for (uint256 i = 0; i < selectors.length; i++) {
            if (selectorToFacet[selectors[i]] == _facet) {
                result[idx] = selectors[i];
                idx++;
            }
        }
        return result;
    }
}
