// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/diamond/libraries/OrderBookStorage.sol";
import "../src/diamond/facets/OBOrderPlacementFacet.sol";
import "../src/diamond/facets/OBTradeExecutionFacet.sol";
import "../src/diamond/facets/OBLiquidationFacet.sol";
import "../src/diamond/Diamond.sol";
import "../src/diamond/facets/DiamondCutFacet.sol";
import "../src/diamond/facets/DiamondLoupeFacet.sol";
import "../src/diamond/interfaces/IDiamondCut.sol";

contract MockVault {
    mapping(address => uint256) public collateral;
    mapping(address => mapping(bytes32 => int256)) public positions;
    mapping(bytes32 => uint256) public markPrices;
    
    function setCollateral(address user, uint256 amount) external {
        collateral[user] = amount;
    }
    
    function getAvailableCollateral(address user) external view returns (uint256) {
        return collateral[user];
    }
    
    function marketSettled(bytes32) external pure returns (bool) {
        return false;
    }
    
    function reserveMargin(address, bytes32, bytes32, uint256) external {}
    function unreserveMargin(address, bytes32) external {}
    function releaseExcessMargin(address, bytes32, uint256) external {}
    
    function getPositionSummary(address user, bytes32 marketId) external view returns (int256, uint256, uint256) {
        return (positions[user][marketId], 1000000, 0);
    }
    
    function updatePositionWithMargin(address, bytes32, int256, uint256, uint256) external {}
    function updatePositionWithLiquidation(address, bytes32, int256, uint256, address) external {}
    function setUnderLiquidation(address, bytes32, bool) external {}
    function deductFees(address, uint256, address) external {}
    function updateMarkPrice(bytes32 marketId, uint256 price) external {
        markPrices[marketId] = price;
    }
    
    function getUsersWithPositionsInMarket(bytes32) external pure returns (address[] memory) {
        return new address[](0);
    }
    
    function isLiquidatable(address, bytes32) external pure returns (bool) {
        return false;
    }
}

contract OrderBookOptimizationTest is Test {
    Diamond public diamond;
    OBOrderPlacementFacet public placementFacet;
    OBTradeExecutionFacet public executionFacet;
    OBLiquidationFacet public liquidationFacet;
    MockVault public vault;
    
    address public owner;
    address public trader1;
    address public trader2;
    address public trader3;
    
    bytes32 public marketId = keccak256("TEST_MARKET");
    
    function setUp() public {
        owner = address(this);
        trader1 = address(0x1001);
        trader2 = address(0x1002);
        trader3 = address(0x1003);
        
        vault = new MockVault();
        vault.setCollateral(trader1, 1000000 * 1e6);
        vault.setCollateral(trader2, 1000000 * 1e6);
        vault.setCollateral(trader3, 1000000 * 1e6);
        
        DiamondCutFacet cutFacet = new DiamondCutFacet();
        diamond = new Diamond(owner, address(cutFacet));
        
        placementFacet = new OBOrderPlacementFacet();
        executionFacet = new OBTradeExecutionFacet();
        liquidationFacet = new OBLiquidationFacet();
        
        _addFacet(address(placementFacet), _getPlacementSelectors());
        _addFacet(address(executionFacet), _getExecutionSelectors());
        _addFacet(address(liquidationFacet), _getLiquidationSelectors());
        
        _initializeOrderBook();
    }
    
    function _addFacet(address facetAddress, bytes4[] memory selectors) internal {
        IDiamondCut.FacetCut[] memory cut = new IDiamondCut.FacetCut[](1);
        cut[0] = IDiamondCut.FacetCut({
            facetAddress: facetAddress,
            action: IDiamondCut.FacetCutAction.Add,
            functionSelectors: selectors
        });
        IDiamondCut(address(diamond)).diamondCut(cut, address(0), "");
    }
    
    function _getPlacementSelectors() internal pure returns (bytes4[] memory) {
        bytes4[] memory selectors = new bytes4[](15);
        selectors[0] = OBOrderPlacementFacet.placeLimitOrder.selector;
        selectors[1] = OBOrderPlacementFacet.placeMarginLimitOrder.selector;
        selectors[2] = OBOrderPlacementFacet.placeMarketOrder.selector;
        selectors[3] = OBOrderPlacementFacet.placeMarginMarketOrder.selector;
        selectors[4] = OBOrderPlacementFacet.cancelOrder.selector;
        selectors[5] = OBOrderPlacementFacet.modifyOrder.selector;
        selectors[6] = OBOrderPlacementFacet.initializePriceLinkedLists.selector;
        selectors[7] = OBOrderPlacementFacet.getBuyPrices.selector;
        selectors[8] = OBOrderPlacementFacet.getSellPrices.selector;
        selectors[9] = OBOrderPlacementFacet.getBuyLevelExists.selector;
        selectors[10] = OBOrderPlacementFacet.getSellLevelExists.selector;
        selectors[11] = OBOrderPlacementFacet.placeLimitOrderBy.selector;
        selectors[12] = OBOrderPlacementFacet.placeMarginLimitOrderBy.selector;
        selectors[13] = OBOrderPlacementFacet.cancelOrderBy.selector;
        selectors[14] = OBOrderPlacementFacet.adminCancelOrder.selector;
        return selectors;
    }
    
    function _getExecutionSelectors() internal pure returns (bytes4[] memory) {
        bytes4[] memory selectors = new bytes4[](2);
        selectors[0] = OBTradeExecutionFacet.obExecuteTrade.selector;
        selectors[1] = OBTradeExecutionFacet.obExecuteTradeBatch.selector;
        return selectors;
    }
    
    function _getLiquidationSelectors() internal pure returns (bytes4[] memory) {
        bytes4[] memory selectors = new bytes4[](3);
        selectors[0] = OBLiquidationFacet.pokeLiquidations.selector;
        selectors[1] = OBLiquidationFacet.onMarkPriceUpdate.selector;
        selectors[2] = OBLiquidationFacet.liquidateDirect.selector;
        return selectors;
    }
    
    function _initializeOrderBook() internal {
        OrderBookStorage.State storage s = OrderBookStorage.state();
        s.vault = ICoreVault(address(vault));
        s.marketId = marketId;
        s.marginRequirementBps = 10000;
        s.leverageEnabled = true;
        s.maxSlippageBps = 500;
    }
    
    function testPriceLinkedListInsertion() public {
        OBOrderPlacementFacet ob = OBOrderPlacementFacet(address(diamond));
        
        vm.prank(trader1);
        ob.placeMarginLimitOrder(100e6, 1e18, true);
        
        vm.prank(trader2);
        ob.placeMarginLimitOrder(95e6, 1e18, true);
        
        vm.prank(trader3);
        ob.placeMarginLimitOrder(105e6, 1e18, true);
        
        uint256[] memory buyPrices = ob.getBuyPrices();
        assertEq(buyPrices.length, 3, "Should have 3 buy price levels");
    }
    
    function testPriceLinkedListRemoval() public {
        OBOrderPlacementFacet ob = OBOrderPlacementFacet(address(diamond));
        
        vm.prank(trader1);
        uint256 orderId1 = ob.placeMarginLimitOrder(100e6, 1e18, true);
        
        vm.prank(trader2);
        ob.placeMarginLimitOrder(95e6, 1e18, true);
        
        vm.prank(trader1);
        ob.cancelOrder(orderId1);
        
        uint256[] memory buyPrices = ob.getBuyPrices();
        assertEq(buyPrices.length, 1, "Should have 1 buy price level after cancellation");
    }
    
    function testDoublyLinkedOrderRemoval() public {
        OBOrderPlacementFacet ob = OBOrderPlacementFacet(address(diamond));
        
        vm.prank(trader1);
        uint256 orderId1 = ob.placeMarginLimitOrder(100e6, 1e18, true);
        
        vm.prank(trader2);
        uint256 orderId2 = ob.placeMarginLimitOrder(100e6, 1e18, true);
        
        vm.prank(trader3);
        ob.placeMarginLimitOrder(100e6, 1e18, true);
        
        vm.prank(trader2);
        ob.cancelOrder(orderId2);
        
        assertTrue(ob.getBuyLevelExists(100e6), "Buy level should still exist");
    }
    
    function testUserOrderIndexing() public {
        OBOrderPlacementFacet ob = OBOrderPlacementFacet(address(diamond));
        
        vm.startPrank(trader1);
        uint256 orderId1 = ob.placeMarginLimitOrder(100e6, 1e18, true);
        uint256 orderId2 = ob.placeMarginLimitOrder(95e6, 1e18, true);
        uint256 orderId3 = ob.placeMarginLimitOrder(90e6, 1e18, true);
        
        ob.cancelOrder(orderId2);
        
        ob.cancelOrder(orderId1);
        ob.cancelOrder(orderId3);
        vm.stopPrank();
    }
    
    function testBatchTradeExecution() public {
        OBOrderPlacementFacet ob = OBOrderPlacementFacet(address(diamond));
        
        vm.prank(trader1);
        ob.placeMarginLimitOrder(100e6, 1e18, false);
        vm.prank(trader2);
        ob.placeMarginLimitOrder(100e6, 1e18, false);
        vm.prank(trader3);
        ob.placeMarginLimitOrder(100e6, 1e18, false);
        
        vm.prank(trader1);
        ob.placeMarginLimitOrder(100e6, 3e18, true);
    }
    
    function testInitializePriceLinkedLists() public {
        OBOrderPlacementFacet ob = OBOrderPlacementFacet(address(diamond));
        
        uint256[] memory sortedBuyPrices = new uint256[](3);
        sortedBuyPrices[0] = 105e6;
        sortedBuyPrices[1] = 100e6;
        sortedBuyPrices[2] = 95e6;
        
        uint256[] memory sortedSellPrices = new uint256[](3);
        sortedSellPrices[0] = 110e6;
        sortedSellPrices[1] = 115e6;
        sortedSellPrices[2] = 120e6;
        
        ob.initializePriceLinkedLists(sortedBuyPrices, sortedSellPrices);
    }
    
    function testGasBenchmarkOrderPlacement() public {
        OBOrderPlacementFacet ob = OBOrderPlacementFacet(address(diamond));
        
        for (uint256 i = 0; i < 10; i++) {
            vm.prank(trader1);
            ob.placeMarginLimitOrder(100e6 - i * 1e6, 1e18, true);
        }
        
        uint256 gasBefore = gasleft();
        vm.prank(trader2);
        ob.placeMarginLimitOrder(90e6, 1e18, true);
        uint256 gasUsed = gasBefore - gasleft();
        
        emit log_named_uint("Gas used for order placement with 10 existing levels", gasUsed);
        
        assertTrue(gasUsed < 500000, "Order placement should be gas efficient");
    }
    
    function testGasBenchmarkOrderCancellation() public {
        OBOrderPlacementFacet ob = OBOrderPlacementFacet(address(diamond));
        
        uint256[] memory orderIds = new uint256[](20);
        for (uint256 i = 0; i < 20; i++) {
            vm.prank(trader1);
            orderIds[i] = ob.placeMarginLimitOrder(100e6, 1e18, true);
        }
        
        uint256 middleOrderId = orderIds[10];
        
        uint256 gasBefore = gasleft();
        vm.prank(trader1);
        ob.cancelOrder(middleOrderId);
        uint256 gasUsed = gasBefore - gasleft();
        
        emit log_named_uint("Gas used for cancelling order from middle of 20-order queue", gasUsed);
        
        assertTrue(gasUsed < 100000, "Order cancellation should be O(1)");
    }
    
    function testGasBenchmarkPriceNavigation() public {
        OBOrderPlacementFacet ob = OBOrderPlacementFacet(address(diamond));
        
        for (uint256 i = 0; i < 50; i++) {
            vm.prank(trader1);
            ob.placeMarginLimitOrder((100e6 + i * 1e6), 1e18, false);
        }
        
        uint256 gasBefore = gasleft();
        vm.prank(trader2);
        ob.placeMarginLimitOrder(150e6, 1e18, true);
        uint256 gasUsed = gasBefore - gasleft();
        
        emit log_named_uint("Gas used for matching across 50 price levels", gasUsed);
    }
    
    function testSelfCrossNetting() public {
        OBOrderPlacementFacet ob = OBOrderPlacementFacet(address(diamond));
        
        vm.prank(trader1);
        ob.placeMarginLimitOrder(100e6, 1e18, false);
        
        vm.prank(trader1);
        ob.placeMarginLimitOrder(100e6, 1e18, true);
    }
    
    function testEmptyBookHandling() public {
        OBOrderPlacementFacet ob = OBOrderPlacementFacet(address(diamond));
        
        uint256[] memory buyPrices = ob.getBuyPrices();
        uint256[] memory sellPrices = ob.getSellPrices();
        
        assertEq(buyPrices.length, 0, "Empty book should have no buy prices");
        assertEq(sellPrices.length, 0, "Empty book should have no sell prices");
    }
    
    function testSingleOrderBook() public {
        OBOrderPlacementFacet ob = OBOrderPlacementFacet(address(diamond));
        
        vm.prank(trader1);
        uint256 orderId = ob.placeMarginLimitOrder(100e6, 1e18, true);
        
        uint256[] memory buyPrices = ob.getBuyPrices();
        assertEq(buyPrices.length, 1, "Should have single buy price");
        
        vm.prank(trader1);
        ob.cancelOrder(orderId);
        
        buyPrices = ob.getBuyPrices();
        assertEq(buyPrices.length, 0, "Should have no buy prices after cancellation");
    }
}
