// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../interfaces/IMetricVAMMFactory.sol";
import "../interfaces/ICentralizedVault.sol";
import "../interfaces/IMetricRegistry.sol";
import "./SpecializedMetricVAMM.sol";

/**
 * @title MetricVAMMFactory
 * @dev Factory contract for deploying and managing specialized MetricVAMM instances
 */
contract MetricVAMMFactory is IMetricVAMMFactory {
    address public owner;
    address public pendingOwner;
    bool public paused;

    // Core contracts
    ICentralizedVault public immutable centralVault;
    IMetricRegistry public immutable metricRegistry;

    // Factory state
    mapping(string => VAMMTemplate) public templates;
    mapping(string => address) public vammsByCategory;
    mapping(bytes32 => address) public vammsByMetric;
    mapping(address => VAMMInfo) public vammInfos;
    mapping(address => address[]) public vammsByCreator;

    // Arrays for iteration
    string[] public allTemplateNames;
    address[] public allVAMMs;
    string[] public allCategories;

    // Access control
    mapping(address => bool) public authorizedDeployers;
    
    // Deployment fees
    uint256 public deploymentFee = 0.1 ether;  // Fee for deploying new VAMM
    uint256 public customTemplateFee = 0.05 ether;  // Additional fee for custom template

    modifier onlyOwner() {
        require(msg.sender == owner, "MetricVAMMFactory: only owner");
        _;
    }

    modifier onlyAuthorizedDeployer() {
        require(
            msg.sender == owner || authorizedDeployers[msg.sender],
            "MetricVAMMFactory: not authorized"
        );
        _;
    }

    modifier whenNotPaused() {
        require(!paused, "MetricVAMMFactory: paused");
        _;
    }

    modifier validTemplate(string calldata templateName) {
        require(templates[templateName].isActive, "MetricVAMMFactory: invalid template");
        _;
    }

    modifier categoryNotExists(string calldata category) {
        require(vammsByCategory[category] == address(0), "MetricVAMMFactory: category exists");
        _;
    }

    constructor(
        address _centralVault,
        address _metricRegistry
    ) {
        // VALIDATION: Central vault address must be a valid deployed contract
        // FAILS: When _centralVault is zero address (0x0000...0000)
        // SUCCEEDS: When _centralVault points to deployed CentralizedVault contract
        // REASONING: Factory depends entirely on vault for authorizing new VAMMs and managing
        // collateral across the system. Zero address cannot hold contract code, so all
        // authorizeVAMM calls would fail. Without vault integration, deployed VAMMs cannot
        // function as they cannot reserve margin or manage user collateral.
        require(
            _centralVault != address(0), 
            "MetricVAMMFactory: Central vault address cannot be zero - must be valid CentralizedVault contract for VAMM authorization and collateral management"
        );
        
        // VALIDATION: Metric registry address must be a valid deployed contract
        // FAILS: When _metricRegistry is zero address (0x0000...0000)
        // SUCCEEDS: When _metricRegistry points to deployed MetricRegistry contract
        // REASONING: Factory validates metric existence and activity through registry before
        // allowing VAMM deployment. Zero address cannot provide metric validation, so all
        // VAMM deployments would fail metric checks. Without registry, system cannot verify
        // metric compliance with the 7 data integrity rules.
        require(
            _metricRegistry != address(0), 
            "MetricVAMMFactory: Metric registry address cannot be zero - must be valid MetricRegistry contract for metric validation and compliance"
        );

        centralVault = ICentralizedVault(_centralVault);
        metricRegistry = IMetricRegistry(_metricRegistry);
        owner = msg.sender;

        // Create default templates
        _createDefaultTemplates();
    }

    // === TEMPLATE MANAGEMENT ===

    function createTemplate(
        string calldata templateName,
        uint256 maxLeverage,
        uint256 tradingFeeRate,
        uint256 liquidationFeeRate,
        uint256 maintenanceMarginRatio,
        uint256 initialReserves,
        uint256 volumeScaleFactor,
        uint256 startPrice,
        string calldata description
    ) external override onlyOwner {
        // VALIDATION: Template name cannot be empty string
        // FAILS: When templateName is empty string ("")
        // SUCCEEDS: When templateName has any non-zero length content
        // REASONING: Empty template names create unnamed templates that cannot be referenced
        // or retrieved by users. This breaks the template system's usability and creates
        // confusion when listing available templates. Template names serve as unique identifiers.
        require(
            bytes(templateName).length > 0, 
            "MetricVAMMFactory: Template name cannot be empty - must provide identifying name for template retrieval and reference"
        );
        
        // VALIDATION: Template name must be unique (not already exist as active template)
        // FAILS: When a template with this name already exists and is active
        // SUCCEEDS: When template name is new or refers to inactive template
        // REASONING: Template names serve as unique keys in the templates mapping. Duplicate
        // active templates would overwrite existing configurations, potentially breaking
        // deployed VAMMs that depend on the original template parameters.
        require(
            !templates[templateName].isActive, 
            "MetricVAMMFactory: Template already exists with this name - cannot overwrite active template (deactivate first or choose different name)"
        );
        
        // VALIDATION: Maximum leverage must be within reasonable risk bounds (1x to 100x)
        // FAILS: When maxLeverage < 1 (sub-unity leverage) or > 100 (excessive risk)
        // SUCCEEDS: When maxLeverage is between 1 and 100 inclusive
        // REASONING: Leverage below 1x makes no sense mathematically and provides no trading
        // advantage. Leverage above 100x creates extreme liquidation risk and could destabilize
        // the entire system with small price movements. 100x is already very high risk.
        require(
            maxLeverage >= 1 && maxLeverage <= 100, 
            "MetricVAMMFactory: Maximum leverage out of bounds - must be between 1x (minimum) and 100x (maximum safe limit)"
        );
        
        // VALIDATION: Trading fee rate must not exceed 10% (1000 basis points) maximum
        // FAILS: When tradingFeeRate > 1000 basis points (10%)
        // SUCCEEDS: When tradingFeeRate <= 1000 basis points
        // REASONING: Trading fees above 10% would be prohibitively expensive and drive away
        // users. Excessive fees could also be used maliciously to extract value. 10% is
        // already very high compared to traditional trading fees (typically 0.1-1%).
        require(
            tradingFeeRate <= 1000, 
            "MetricVAMMFactory: Trading fee rate too high - maximum 1000 basis points (10%) to ensure reasonable trading costs"
        );
        
        // VALIDATION: Liquidation fee rate must not exceed 20% (2000 basis points) maximum
        // FAILS: When liquidationFeeRate > 2000 basis points (20%)
        // SUCCEEDS: When liquidationFeeRate <= 2000 basis points
        // REASONING: Liquidation fees above 20% would severely punish users who face margin
        // calls, potentially taking most of their remaining collateral. This creates unfair
        // penalty and could discourage legitimate trading. 20% provides adequate liquidation incentive.
        require(
            liquidationFeeRate <= 2000, 
            "MetricVAMMFactory: Liquidation fee rate too high - maximum 2000 basis points (20%) to prevent excessive liquidation penalties"
        );
        
        // VALIDATION: Maintenance margin ratio must be at least 1% (100 basis points) minimum
        // FAILS: When maintenanceMarginRatio < 100 basis points (1%)
        // SUCCEEDS: When maintenanceMarginRatio >= 100 basis points
        // REASONING: Maintenance margin below 1% provides insufficient buffer against losses
        // and could lead to system insolvency. Even small adverse price movements could trigger
        // mass liquidations, creating systemic risk. 1% minimum provides basic safety buffer.
        require(
            maintenanceMarginRatio >= 100, 
            "MetricVAMMFactory: Maintenance margin ratio too low - minimum 100 basis points (1%) required for liquidation safety buffer"
        );
        
        // VALIDATION: Initial virtual reserves must be greater than zero for AMM functionality
        // FAILS: When initialReserves = 0 (no liquidity)
        // SUCCEEDS: When initialReserves > 0 (provides initial AMM liquidity)
        // REASONING: AMM pricing depends on virtual reserves using constant product formula.
        // Zero reserves would break price calculation (division by zero) and prevent any
        // trading activity. Initial reserves bootstrap the AMM's ability to quote prices.
        require(
            initialReserves > 0, 
            "MetricVAMMFactory: Initial reserves must be greater than zero - required for AMM price calculation and trading functionality"
        );
        
        // VALIDATION: Volume scale factor must be greater than zero for dynamic reserve scaling
        // FAILS: When volumeScaleFactor = 0 (no scaling capability)
        // SUCCEEDS: When volumeScaleFactor > 0 (enables volume-based reserve adjustment)
        // REASONING: Volume scale factor determines how virtual reserves adjust based on
        // trading activity. Zero scaling factor would prevent reserves from growing with
        // volume, limiting the AMM's ability to handle larger trades efficiently.
        require(
            volumeScaleFactor > 0, 
            "MetricVAMMFactory: Volume scale factor must be greater than zero - required for dynamic reserve scaling based on trading volume"
        );
        
        require(
            startPrice > 0,
            "MetricVAMMFactory: Start price must be greater than zero"
        );

        templates[templateName] = VAMMTemplate({
            maxLeverage: maxLeverage,
            tradingFeeRate: tradingFeeRate,
            liquidationFeeRate: liquidationFeeRate,
            maintenanceMarginRatio: maintenanceMarginRatio,
            initialReserves: initialReserves,
            volumeScaleFactor: volumeScaleFactor,
            startPrice: startPrice,
            isActive: true,
            description: description
        });

        allTemplateNames.push(templateName);

        emit TemplateCreated(templateName, maxLeverage, tradingFeeRate);
    }

    function updateTemplate(string calldata templateName, bool isActive) external override onlyOwner {
        require(bytes(templateName).length > 0, "MetricVAMMFactory: empty name");
        
        VAMMTemplate storage template = templates[templateName];
        require(template.initialReserves > 0, "MetricVAMMFactory: template not found");
        
        template.isActive = isActive;

        emit TemplateUpdated(templateName, isActive);
    }

    // === VAMM DEPLOYMENT ===

    function deploySpecializedVAMM(
        string calldata category,
        bytes32[] calldata allowedMetrics,
        string calldata templateName
    ) external payable override 
        whenNotPaused 
        onlyAuthorizedDeployer 
        validTemplate(templateName)
        categoryNotExists(category)
        returns (address vammAddress) 
    {
        // VALIDATION: User must pay sufficient deployment fee to cover VAMM creation costs
        // FAILS: When msg.value < deploymentFee (insufficient payment)
        // SUCCEEDS: When msg.value >= deploymentFee (adequate payment for deployment)
        // REASONING: Deployment fees prevent spam creation of VAMMs and fund ongoing system
        // maintenance. Free deployments could lead to countless unused VAMMs cluttering
        // the system. Fees ensure only serious deployers create VAMMs while covering
        // gas costs and development expenses.
        require(
            msg.value >= deploymentFee, 
            "MetricVAMMFactory: Insufficient deployment fee - must pay minimum fee to cover VAMM creation and system maintenance costs"
        );
        
        // VALIDATION: Category name cannot be empty string for organizational purposes
        // FAILS: When category is empty string ("")
        // SUCCEEDS: When category has meaningful descriptive content
        // REASONING: Categories organize VAMMs by metric type (Weather, Economic, Population).
        // Empty categories create unclassified VAMMs that users cannot discover or understand.
        // Categories enable filtering, search, and logical grouping of related metrics.
        require(
            bytes(category).length > 0, 
            "MetricVAMMFactory: Category name cannot be empty - must specify meaningful category (e.g., 'Weather', 'Economic') for VAMM organization"
        );
        
        // VALIDATION: VAMM must support at least one metric to provide trading functionality
        // FAILS: When allowedMetrics array is empty (no tradeable metrics)
        // SUCCEEDS: When allowedMetrics contains at least one valid metric ID
        // REASONING: VAMMs without metrics cannot facilitate any trading activity. Empty
        // metric arrays create non-functional VAMMs that waste resources and confuse users.
        // At least one metric is required to justify VAMM existence.
        require(
            allowedMetrics.length > 0, 
            "MetricVAMMFactory: No metrics specified - VAMM must support at least one tradeable metric to provide functionality"
        );

        // Validate all metrics exist and are active
        for (uint256 i = 0; i < allowedMetrics.length; i++) {
            // VALIDATION: Each metric must be registered and active in the system
            // FAILS: When metric ID is not registered OR metric is deactivated
            // SUCCEEDS: When metric exists in registry and is currently active
            // REASONING: Inactive metrics cannot be traded or settled, making VAMM positions
            // unresolvable. Only active metrics ensure proper price discovery and settlement.
            // This prevents VAMMs from being created with invalid or deprecated metrics.
            require(
                metricRegistry.isMetricActive(allowedMetrics[i]),
                "MetricVAMMFactory: Specified metric is inactive or non-existent - all metrics must be registered and active in MetricRegistry for trading"
            );
        }

        VAMMTemplate memory template = templates[templateName];
        
        // Deploy new specialized VAMM
        SpecializedMetricVAMM newVAMM = new SpecializedMetricVAMM(
            address(centralVault),
            address(metricRegistry),
            address(this),
            category,
            allowedMetrics,
            template,
            template.startPrice
        );

        vammAddress = address(newVAMM);

        // Update factory state
        _registerVAMM(vammAddress, category, allowedMetrics, templateName, msg.sender);

        // Authorize VAMM in central vault
        centralVault.authorizeVAMM(vammAddress, category);

        emit VAMMDeployed(vammAddress, category, msg.sender, templateName, allowedMetrics);

        return vammAddress;
    }

    function deployCustomVAMM(
        string calldata category,
        bytes32[] calldata allowedMetrics,
        VAMMTemplate calldata customTemplate
    ) external payable override 
        whenNotPaused 
        onlyAuthorizedDeployer 
        categoryNotExists(category)
        returns (address vammAddress) 
    {
        // VALIDATION: User must pay both deployment fee and custom template fee
        // FAILS: When msg.value < (deploymentFee + customTemplateFee)
        // SUCCEEDS: When payment covers both base deployment and custom template premium
        // REASONING: Custom templates require additional validation and processing compared
        // to preset templates. The extra fee compensates for increased gas costs and
        // development effort to support flexible template parameters outside standard options.
        require(
            msg.value >= deploymentFee + customTemplateFee,
            "MetricVAMMFactory: Insufficient payment - must pay base deployment fee plus custom template premium for non-standard configurations"
        );
        
        // VALIDATION: Category name cannot be empty string for organizational purposes
        // FAILS: When category is empty string ("")
        // SUCCEEDS: When category has meaningful descriptive content
        // REASONING: Categories organize VAMMs by metric type for discovery and management.
        // Custom VAMMs especially need clear categorization since they have unique parameters
        // that users need to understand. Empty categories hinder user navigation.
        require(
            bytes(category).length > 0, 
            "MetricVAMMFactory: Category name cannot be empty - custom VAMMs require clear categorization for user discovery"
        );
        
        // VALIDATION: VAMM must support at least one metric for trading functionality
        // FAILS: When allowedMetrics array is empty (no tradeable metrics)
        // SUCCEEDS: When allowedMetrics contains at least one valid metric ID
        // REASONING: VAMMs without metrics cannot facilitate trading. Custom templates
        // still require actual metrics to trade. Empty arrays create non-functional VAMMs.
        require(
            allowedMetrics.length > 0, 
            "MetricVAMMFactory: No metrics specified - even custom VAMMs must support at least one tradeable metric"
        );
        
        // VALIDATION: Custom template must be marked as active for deployment use
        // FAILS: When customTemplate.isActive = false (disabled template)
        // SUCCEEDS: When customTemplate.isActive = true (enabled for deployment)
        // REASONING: Template activation serves as validation flag ensuring template parameters
        // have been properly configured. Inactive templates may have incomplete or invalid
        // settings that could break VAMM functionality.
        require(
            customTemplate.isActive, 
            "MetricVAMMFactory: Custom template is inactive - template must be marked active with validated parameters for deployment"
        );

        // Validate custom template parameters
        // VALIDATION: Custom leverage must stay within system safety bounds (1x to 100x)
        // FAILS: When leverage < 1 or > 100 (outside safe operating range)
        // SUCCEEDS: When leverage is between 1x and 100x inclusive
        // REASONING: Even custom templates cannot exceed fundamental system risk limits.
        // Extreme leverage threatens system stability regardless of template customization.
        require(
            customTemplate.maxLeverage >= 1 && customTemplate.maxLeverage <= 100,
            "MetricVAMMFactory: Custom template leverage out of bounds - even custom configurations must stay within 1x-100x safety limits"
        );
        
        // VALIDATION: Custom trading fees cannot exceed 10% maximum to remain competitive
        // FAILS: When tradingFeeRate > 1000 basis points (10%)
        // SUCCEEDS: When trading fees stay at or below 10%
        // REASONING: Custom templates cannot circumvent reasonable fee limits. Excessive
        // fees would harm user adoption and could be used to extract excessive value.
        require(
            customTemplate.tradingFeeRate <= 1000, 
            "MetricVAMMFactory: Custom template trading fee too high - maximum 1000 basis points (10%) even for custom configurations"
        );
        
        // VALIDATION: Custom reserves must be positive for AMM price calculation functionality
        // FAILS: When initialReserves = 0 (breaks AMM math)
        // SUCCEEDS: When initialReserves > 0 (enables price calculation)
        // REASONING: AMM pricing requires non-zero reserves regardless of template customization.
        // Zero reserves break constant product formula essential for price discovery.
        require(
            customTemplate.initialReserves > 0, 
            "MetricVAMMFactory: Custom template reserves invalid - AMM requires positive initial reserves for price calculation"
        );

        // Validate all metrics exist and are active
        for (uint256 i = 0; i < allowedMetrics.length; i++) {
            require(
                metricRegistry.isMetricActive(allowedMetrics[i]),
                "MetricVAMMFactory: inactive metric"
            );
        }

        // Deploy new specialized VAMM with custom template
        SpecializedMetricVAMM newVAMM = new SpecializedMetricVAMM(
            address(centralVault),
            address(metricRegistry),
            address(this),
            category,
            allowedMetrics,
            customTemplate,
            customTemplate.startPrice
        );

        vammAddress = address(newVAMM);

        // Update factory state
        _registerVAMM(vammAddress, category, allowedMetrics, "custom", msg.sender);

        // Authorize VAMM in central vault
        centralVault.authorizeVAMM(vammAddress, category);

        emit VAMMDeployed(vammAddress, category, msg.sender, "custom", allowedMetrics);

        return vammAddress;
    }

    // === VAMM MANAGEMENT ===

    function deactivateVAMM(address vammAddress, string calldata reason) external override onlyOwner {
        // VALIDATION: VAMM must be currently active before it can be deactivated
        // FAILS: When vammAddress is not registered OR VAMM is already deactivated
        // SUCCEEDS: When VAMM exists in the system and is currently active
        // REASONING: Cannot deactivate VAMMs that don't exist or are already inactive.
        // Attempting to deactivate inactive VAMMs would create inconsistent state and
        // potentially break tracking systems. Only active VAMMs should be subject to deactivation.
        require(
            vammInfos[vammAddress].isActive, 
            "MetricVAMMFactory: VAMM not active - cannot deactivate non-existent or already inactive VAMM (check VAMM address and current status)"
        );

        VAMMInfo storage info = vammInfos[vammAddress];
        info.isActive = false;

        // Remove from category mapping
        delete vammsByCategory[info.category];

        // Remove metrics mapping
        for (uint256 i = 0; i < info.allowedMetrics.length; i++) {
            delete vammsByMetric[info.allowedMetrics[i]];
        }

        // Deauthorize in central vault
        centralVault.deauthorizeVAMM(vammAddress, reason);

        emit VAMMDeactivated(vammAddress, reason);
    }

    function updateVAMMCategory(string calldata category, address newVAMM) external override onlyOwner {
        require(vammInfos[newVAMM].isActive, "MetricVAMMFactory: VAMM not active");
        require(bytes(category).length > 0, "MetricVAMMFactory: empty category");

        address oldVAMM = vammsByCategory[category];
        vammsByCategory[category] = newVAMM;

        emit CategoryUpdated(category, newVAMM, oldVAMM);
    }

    // === INTERNAL FUNCTIONS ===

    function _registerVAMM(
        address vammAddress,
        string calldata category,
        bytes32[] calldata allowedMetrics,
        string memory templateUsed,
        address creator
    ) internal {
        // Update factory mappings
        vammsByCategory[category] = vammAddress;
        allVAMMs.push(vammAddress);
        allCategories.push(category);
        vammsByCreator[creator].push(vammAddress);

        // Map metrics to this VAMM
        for (uint256 i = 0; i < allowedMetrics.length; i++) {
            vammsByMetric[allowedMetrics[i]] = vammAddress;
        }

        // Store VAMM info
        vammInfos[vammAddress] = VAMMInfo({
            vammAddress: vammAddress,
            category: category,
            allowedMetrics: allowedMetrics,
            templateUsed: templateUsed,
            creator: creator,
            deployedAt: block.timestamp,
            isActive: true
        });
    }

    function _createDefaultTemplates() internal {
        // Conservative template for stable metrics (economic indicators, population)
        templates["conservative"] = VAMMTemplate({
            maxLeverage: 20,
            tradingFeeRate: 50,           // 0.5%
            liquidationFeeRate: 500,      // 5%
            maintenanceMarginRatio: 500,  // 5%
            initialReserves: 10000 * 1e18,
            volumeScaleFactor: 1000,
            startPrice: 50 * 1e18, // Default start price
            isActive: true,
            description: "Conservative template for stable metrics with lower leverage and higher fees"
        });
        allTemplateNames.push("conservative");

        // Standard template for most metrics
        templates["standard"] = VAMMTemplate({
            maxLeverage: 50,
            tradingFeeRate: 30,           // 0.3%
            liquidationFeeRate: 500,      // 5%
            maintenanceMarginRatio: 500,  // 5%
            initialReserves: 10000 * 1e18,
            volumeScaleFactor: 1000,
            startPrice: 50 * 1e18, // Default start price
            isActive: true,
            description: "Standard template for most metrics with balanced parameters"
        });
        allTemplateNames.push("standard");

        // Aggressive template for volatile metrics (weather, sports)
        templates["aggressive"] = VAMMTemplate({
            maxLeverage: 100,
            tradingFeeRate: 20,           // 0.2%
            liquidationFeeRate: 500,      // 5%
            maintenanceMarginRatio: 800,  // 8%
            initialReserves: 50000 * 1e18,
            volumeScaleFactor: 500,
            startPrice: 50 * 1e18, // Default start price
            isActive: true,
            description: "Aggressive template for volatile metrics with high leverage and lower fees"
        });
        allTemplateNames.push("aggressive");

        // Prediction template for prediction markets
        templates["prediction"] = VAMMTemplate({
            maxLeverage: 10,
            tradingFeeRate: 20,           // 0.2%
            liquidationFeeRate: 300,      // 3%
            maintenanceMarginRatio: 300,  // 3%
            initialReserves: 20000 * 1e18,
            volumeScaleFactor: 2000,
            startPrice: 50 * 1e18, // Default start price
            isActive: true,
            description: "Prediction template for prediction markets with lower leverage"
        });
        allTemplateNames.push("prediction");
    }

    // === QUERY FUNCTIONS ===

    function getTemplate(string calldata templateName) external view override returns (VAMMTemplate memory) {
        return templates[templateName];
    }

    function getAllTemplates() external view override returns (string[] memory) {
        return allTemplateNames;
    }

    function getVAMMByCategory(string calldata category) external view override returns (address) {
        return vammsByCategory[category];
    }

    function getVAMMByMetric(bytes32 metricId) external view override returns (address) {
        return vammsByMetric[metricId];
    }

    function getVAMMInfo(address vammAddress) external view override returns (VAMMInfo memory) {
        return vammInfos[vammAddress];
    }

    function getAllVAMMs() external view override returns (address[] memory) {
        return allVAMMs;
    }

    function getVAMMsByCreator(address creator) external view override returns (address[] memory) {
        return vammsByCreator[creator];
    }

    function isVAMMDeployed(address vammAddress) external view override returns (bool) {
        return vammInfos[vammAddress].deployedAt > 0;
    }

    function getTotalVAMMs() external view override returns (uint256) {
        return allVAMMs.length;
    }

    function getActiveVAMMs() external view override returns (address[] memory) {
        uint256 activeCount = 0;
        
        // Count active VAMMs
        for (uint256 i = 0; i < allVAMMs.length; i++) {
            if (vammInfos[allVAMMs[i]].isActive) {
                activeCount++;
            }
        }

        // Build array of active VAMMs
        address[] memory activeVAMMs = new address[](activeCount);
        uint256 index = 0;
        
        for (uint256 i = 0; i < allVAMMs.length; i++) {
            if (vammInfos[allVAMMs[i]].isActive) {
                activeVAMMs[index] = allVAMMs[i];
                index++;
            }
        }

        return activeVAMMs;
    }

    function getCategoriesCount() external view override returns (uint256) {
        return allCategories.length;
    }

    function getAllCategories() external view override returns (string[] memory) {
        return allCategories;
    }

    // === ADMIN FUNCTIONS ===

    function setAuthorizedDeployer(address deployer, bool authorized) external onlyOwner {
        authorizedDeployers[deployer] = authorized;
    }

    function setDeploymentFee(uint256 newFee) external onlyOwner {
        deploymentFee = newFee;
    }

    function setCustomTemplateFee(uint256 newFee) external onlyOwner {
        customTemplateFee = newFee;
    }

    function pause() external onlyOwner {
        paused = true;
    }

    function unpause() external onlyOwner {
        paused = false;
    }

    function proposeOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "MetricVAMMFactory: invalid owner");
        pendingOwner = newOwner;
    }

    function acceptOwnership() external {
        require(msg.sender == pendingOwner, "MetricVAMMFactory: not pending owner");
        owner = pendingOwner;
        pendingOwner = address(0);
    }

    function withdrawFees(address recipient) external onlyOwner {
        require(recipient != address(0), "MetricVAMMFactory: invalid recipient");
        uint256 balance = address(this).balance;
        require(balance > 0, "MetricVAMMFactory: no fees to withdraw");
        
        (bool success, ) = recipient.call{value: balance}("");
        require(success, "MetricVAMMFactory: withdrawal failed");
    }

    // Accept ETH for deployment fees
    receive() external payable {}
} 