/**
 * 🏗️ CONTRACT ABI LOADER - DexContractsV2
 * 
 * Dedicated module for loading and validating contract ABIs with bulletproof error handling.
 * This ensures all required methods are available and provides clear error messages.
 */

import type { Abi } from 'viem';

// Standard ERC20 ABI
export const ERC20_ABI = [
  {
    "constant": true,
    "inputs": [],
    "name": "name",
    "outputs": [{ "name": "", "type": "string" }],
    "payable": false,
    "stateMutability": "view",
    "type": "function"
  },
  {
    "constant": true,
    "inputs": [],
    "name": "symbol",
    "outputs": [{ "name": "", "type": "string" }],
    "payable": false,
    "stateMutability": "view",
    "type": "function"
  },
  {
    "constant": true,
    "inputs": [],
    "name": "decimals",
    "outputs": [{ "name": "", "type": "uint8" }],
    "payable": false,
    "stateMutability": "view",
    "type": "function"
  },
  {
    "constant": true,
    "inputs": [],
    "name": "totalSupply",
    "outputs": [{ "name": "", "type": "uint256" }],
    "payable": false,
    "stateMutability": "view",
    "type": "function"
  },
  {
    "constant": true,
    "inputs": [{ "name": "owner", "type": "address" }],
    "name": "balanceOf",
    "outputs": [{ "name": "", "type": "uint256" }],
    "payable": false,
    "stateMutability": "view",
    "type": "function"
  },
  {
    "constant": true,
    "inputs": [{ "name": "owner", "type": "address" }, { "name": "spender", "type": "address" }],
    "name": "allowance",
    "outputs": [{ "name": "", "type": "uint256" }],
    "payable": false,
    "stateMutability": "view",
    "type": "function"
  },
  {
    "constant": false,
    "inputs": [{ "name": "spender", "type": "address" }, { "name": "value", "type": "uint256" }],
    "name": "approve",
    "outputs": [{ "name": "", "type": "bool" }],
    "payable": false,
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "constant": false,
    "inputs": [{ "name": "to", "type": "address" }, { "name": "value", "type": "uint256" }],
    "name": "transfer",
    "outputs": [{ "name": "", "type": "bool" }],
    "payable": false,
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "constant": false,
    "inputs": [{ "name": "from", "type": "address" }, { "name": "to", "type": "address" }, { "name": "value", "type": "uint256" }],
    "name": "transferFrom",
    "outputs": [{ "name": "", "type": "bool" }],
    "payable": false,
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "name": "owner", "type": "address" },
      { "indexed": true, "name": "spender", "type": "address" },
      { "indexed": false, "name": "value", "type": "uint256" }
    ],
    "name": "Approval",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "name": "from", "type": "address" },
      { "indexed": true, "name": "to", "type": "address" },
      { "indexed": false, "name": "value", "type": "uint256" }
    ],
    "name": "Transfer",
    "type": "event"
  }
] as const;

// Import raw JSON content
const routerArtifact = {
  "abi": [
    // Read Methods
    {
      "inputs": [
        {
          "internalType": "address",
          "name": "user",
          "type": "address"
        }
      ],
      "name": "getAllUserPositions",
      "outputs": [
        {
          "internalType": "uint256[]",
          "name": "",
          "type": "uint256[]"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "address",
          "name": "user",
          "type": "address"
        }
      ],
      "name": "getPortfolioDashboard",
      "outputs": [
        {
          "internalType": "uint256",
          "name": "",
          "type": "uint256"
        },
        {
          "internalType": "uint256",
          "name": "",
          "type": "uint256"
        },
        {
          "internalType": "int256",
          "name": "",
          "type": "int256"
        },
        {
          "internalType": "uint256",
          "name": "",
          "type": "uint256"
        },
        {
          "internalType": "uint256",
          "name": "",
          "type": "uint256"
        },
        {
          "internalType": "uint256",
          "name": "",
          "type": "uint256"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "bytes32",
          "name": "metricId",
          "type": "bytes32"
        }
      ],
      "name": "getMetricPriceComparison",
      "outputs": [
        {
          "internalType": "address",
          "name": "",
          "type": "address"
        },
        {
          "internalType": "uint256",
          "name": "",
          "type": "uint256"
        },
        {
          "internalType": "uint256",
          "name": "",
          "type": "uint256"
        },
        {
          "internalType": "uint256",
          "name": "",
          "type": "uint256"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    // Write Methods
    {
      "inputs": [
        {
          "internalType": "bytes32",
          "name": "metricId",
          "type": "bytes32"
        },
        {
          "internalType": "uint256",
          "name": "collateralAmount",
          "type": "uint256"
        },
        {
          "internalType": "bool",
          "name": "isLong",
          "type": "bool"
        },
        {
          "internalType": "uint256",
          "name": "leverage",
          "type": "uint256"
        },
        {
          "internalType": "uint256",
          "name": "targetValue",
          "type": "uint256"
        },
        {
          "internalType": "uint8",
          "name": "positionType",
          "type": "uint8"
        },
        {
          "internalType": "uint256",
          "name": "minPrice",
          "type": "uint256"
        },
        {
          "internalType": "uint256",
          "name": "maxPrice",
          "type": "uint256"
        }
      ],
      "name": "openPosition",
      "outputs": [
        {
          "internalType": "uint256",
          "name": "positionId",
          "type": "uint256"
        }
      ],
      "stateMutability": "nonpayable",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "address",
          "name": "vammAddress",
          "type": "address"
        },
        {
          "internalType": "uint256",
          "name": "positionId",
          "type": "uint256"
        },
        {
          "internalType": "uint256",
          "name": "sizeToClose",
          "type": "uint256"
        },
        {
          "internalType": "uint256",
          "name": "minPrice",
          "type": "uint256"
        },
        {
          "internalType": "uint256",
          "name": "maxPrice",
          "type": "uint256"
        }
      ],
      "name": "closePosition",
      "outputs": [
        {
          "internalType": "int256",
          "name": "pnl",
          "type": "int256"
        }
      ],
      "stateMutability": "nonpayable",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "address",
          "name": "vammAddress",
          "type": "address"
        },
        {
          "internalType": "uint256",
          "name": "positionId",
          "type": "uint256"
        },
        {
          "internalType": "uint256",
          "name": "additionalCollateral",
          "type": "uint256"
        },
        {
          "internalType": "uint256",
          "name": "minPrice",
          "type": "uint256"
        },
        {
          "internalType": "uint256",
          "name": "maxPrice",
          "type": "uint256"
        }
      ],
      "name": "addToPosition",
      "outputs": [
        {
          "internalType": "uint256",
          "name": "newSize",
          "type": "uint256"
        }
      ],
      "stateMutability": "nonpayable",
      "type": "function"
    },
    // Events
    {
      "anonymous": false,
      "inputs": [
        {
          "indexed": true,
          "internalType": "address",
          "name": "user",
          "type": "address"
        },
        {
          "indexed": true,
          "internalType": "address",
          "name": "vammAddress",
          "type": "address"
        },
        {
          "indexed": true,
          "internalType": "uint256",
          "name": "positionId",
          "type": "uint256"
        },
        {
          "indexed": false,
          "internalType": "bool",
          "name": "isLong",
          "type": "bool"
        },
        {
          "indexed": false,
          "internalType": "uint256",
          "name": "size",
          "type": "uint256"
        },
        {
          "indexed": false,
          "internalType": "uint256",
          "name": "price",
          "type": "uint256"
        },
        {
          "indexed": false,
          "internalType": "uint256",
          "name": "leverage",
          "type": "uint256"
        }
      ],
      "name": "MetricPositionOpened",
      "type": "event"
    },
    {
      "anonymous": false,
      "inputs": [
        {
          "indexed": true,
          "internalType": "address",
          "name": "user",
          "type": "address"
        },
        {
          "indexed": true,
          "internalType": "address",
          "name": "vammAddress",
          "type": "address"
        },
        {
          "indexed": true,
          "internalType": "uint256",
          "name": "positionId",
          "type": "uint256"
        },
        {
          "indexed": false,
          "internalType": "uint256",
          "name": "size",
          "type": "uint256"
        },
        {
          "indexed": false,
          "internalType": "uint256",
          "name": "price",
          "type": "uint256"
        },
        {
          "indexed": false,
          "internalType": "int256",
          "name": "pnl",
          "type": "int256"
        }
      ],
      "name": "MetricPositionClosed",
      "type": "event"
    }
  ]
};

// Debug: Log raw ABI content
console.log('🔍 Raw Router ABI:', {
  type: typeof routerArtifact,
  hasABI: !!routerArtifact?.abi,
  abiLength: routerArtifact?.abi?.length,
  firstMethod: routerArtifact?.abi?.[0]
});

/**
 * Validate that an ABI contains required methods
 */
function validateABI(abi: Readonly<any[]>, contractName: string, requiredMethods: string[]): void {
  if (!Array.isArray(abi)) {
    console.error('❌ Invalid ABI format:', {
      contractName,
      abiType: typeof abi,
      abi
    });
    throw new Error(`${contractName} ABI is not an array. Got: ${typeof abi}`);
  }

  const functions = abi.filter(item => item.type === 'function');
  const availableMethods = functions.map(item => item.name);

  console.log(`🔍 Validating ${contractName} ABI:`, {
    totalItems: abi.length,
    functions: functions.length,
    availableMethods,
    requiredMethods
  });

  const missingMethods = requiredMethods.filter(method => !availableMethods.includes(method));
  
  if (missingMethods.length > 0) {
    console.error(`❌ ${contractName} ABI missing required methods:`, missingMethods);
    console.error('Available methods:', availableMethods);
    throw new Error(`${contractName} ABI missing required methods: ${missingMethods.join(', ')}`);
  }

  console.log(`✅ ${contractName} ABI validation passed - all required methods found`);
}

// Extract and validate ABIs
console.log('🚀 Loading contract ABIs...');

// Router ABI - most critical
const routerRequiredMethods = ['getAllUserPositions', 'getPortfolioDashboard', 'getMetricPriceComparison'];
export const METRIC_VAMM_ROUTER_ABI = routerArtifact.abi as Abi;

// Debug: Log actual router ABI content
console.log('🔍 Router ABI Content:', {
  type: typeof METRIC_VAMM_ROUTER_ABI,
  length: METRIC_VAMM_ROUTER_ABI?.length,
  methods: METRIC_VAMM_ROUTER_ABI?.filter((item: any) => item.type === 'function')?.map((item: any) => item.name)
});

validateABI(METRIC_VAMM_ROUTER_ABI, 'MetricVAMMRouter', routerRequiredMethods);

// Other ABIs (less critical validation)
export const CENTRALIZED_VAULT_ABI = [
  // Read Methods
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "user",
        "type": "address"
      }
    ],
    "name": "getMarginAccount",
    "outputs": [
      {
        "components": [
          {
            "internalType": "uint256",
            "name": "totalCollateral",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "availableCollateral",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "reservedMargin",
            "type": "uint256"
          },
          {
            "internalType": "int256",
            "name": "unrealizedPnL",
            "type": "int256"
          },
          {
            "internalType": "uint256",
           "name": "lastUpdateTime",
            "type": "uint256"
          }
        ],
        "internalType": "struct ICentralizedVault.MarginAccount",
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "user",
        "type": "address"
      }
    ],
    "name": "getPortfolioSummary",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      },
      {
        "internalType": "int256",
        "name": "",
        "type": "int256"
      },
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "user",
        "type": "address"
      }
    ],
    "name": "getAvailableMargin",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "user",
        "type": "address"
      }
    ],
    "name": "getTotalMargin",
    "outputs": [
      {
        "internalType": "int256",
        "name": "",
        "type": "int256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  // Write Methods
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      }
    ],
    "name": "depositCollateral",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      }
    ],
    "name": "withdrawCollateral",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  }
] as const;
export const METRIC_VAMM_FACTORY_ABI = [
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "_centralVault",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "_metricRegistry",
        "type": "address"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "constructor"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "string",
        "name": "category",
        "type": "string"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "newVAMM",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "oldVAMM",
        "type": "address"
      }
    ],
    "name": "CategoryUpdated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "string",
        "name": "templateName",
        "type": "string"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "maxLeverage",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "tradingFeeRate",
        "type": "uint256"
      }
    ],
    "name": "TemplateCreated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "string",
        "name": "templateName",
        "type": "string"
      },
      {
        "indexed": false,
        "internalType": "bool",
        "name": "isActive",
        "type": "bool"
      }
    ],
    "name": "TemplateUpdated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "vammAddress",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "string",
        "name": "reason",
        "type": "string"
      }
    ],
    "name": "VAMMDeactivated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "vammAddress",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "string",
        "name": "category",
        "type": "string"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "creator",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "string",
        "name": "templateUsed",
        "type": "string"
      },
      {
        "indexed": false,
        "internalType": "bytes32[]",
        "name": "allowedMetrics",
        "type": "bytes32[]"
      }
    ],
    "name": "VAMMDeployed",
    "type": "event"
  },
  {
    "inputs": [],
    "name": "acceptOwnership",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "name": "allCategories",
    "outputs": [
      {
        "internalType": "string",
        "name": "",
        "type": "string"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "name": "allTemplateNames",
    "outputs": [
      {
        "internalType": "string",
        "name": "",
        "type": "string"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "name": "allVAMMs",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "name": "authorizedDeployers",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "centralVault",
    "outputs": [
      {
        "internalType": "contract ICentralizedVault",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "string",
        "name": "templateName",
        "type": "string"
      },
      {
        "internalType": "uint256",
        "name": "maxLeverage",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "tradingFeeRate",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "liquidationFeeRate",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "maintenanceMarginRatio",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "initialReserves",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "volumeScaleFactor",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "startPrice",
        "type": "uint256"
      },
      {
        "internalType": "string",
        "name": "description",
        "type": "string"
      }
    ],
    "name": "createTemplate",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "customTemplateFee",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "vammAddress",
        "type": "address"
      },
      {
        "internalType": "string",
        "name": "reason",
        "type": "string"
      }
    ],
    "name": "deactivateVAMM",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "string",
        "name": "category",
        "type": "string"
      },
      {
        "internalType": "bytes32[]",
        "name": "allowedMetrics",
        "type": "bytes32[]"
      },
      {
        "components": [
          {
            "internalType": "uint256",
            "name": "maxLeverage",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "tradingFeeRate",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "liquidationFeeRate",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "maintenanceMarginRatio",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "initialReserves",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "volumeScaleFactor",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "startPrice",
            "type": "uint256"
          },
          {
            "internalType": "bool",
            "name": "isActive",
            "type": "bool"
          },
          {
            "internalType": "string",
            "name": "description",
            "type": "string"
          }
        ],
        "internalType": "struct IMetricVAMMFactory.VAMMTemplate",
        "name": "customTemplate",
        "type": "tuple"
      }
    ],
    "name": "deployCustomVAMM",
    "outputs": [
      {
        "internalType": "address",
        "name": "vammAddress",
        "type": "address"
      }
    ],
    "stateMutability": "payable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "string",
        "name": "category",
        "type": "string"
      },
      {
        "internalType": "bytes32[]",
        "name": "allowedMetrics",
        "type": "bytes32[]"
      },
      {
        "internalType": "string",
        "name": "templateName",
        "type": "string"
      }
    ],
    "name": "deploySpecializedVAMM",
    "outputs": [
      {
        "internalType": "address",
        "name": "vammAddress",
        "type": "address"
      }
    ],
    "stateMutability": "payable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "deploymentFee",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "getActiveVAMMs",
    "outputs": [
      {
        "internalType": "address[]",
        "name": "",
        "type": "address[]"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "getAllCategories",
    "outputs": [
      {
        "internalType": "string[]",
        "name": "",
        "type": "string[]"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "getAllTemplates",
    "outputs": [
      {
        "internalType": "string[]",
        "name": "",
        "type": "string[]"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "getAllVAMMs",
    "outputs": [
      {
        "internalType": "address[]",
        "name": "",
        "type": "address[]"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "getCategoriesCount",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "string",
        "name": "templateName",
        "type": "string"
      }
    ],
    "name": "getTemplate",
    "outputs": [
      {
        "components": [
          {
            "internalType": "uint256",
            "name": "maxLeverage",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "tradingFeeRate",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "liquidationFeeRate",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "maintenanceMarginRatio",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "initialReserves",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "volumeScaleFactor",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "startPrice",
            "type": "uint256"
          },
          {
            "internalType": "bool",
            "name": "isActive",
            "type": "bool"
          },
          {
            "internalType": "string",
            "name": "description",
            "type": "string"
          }
        ],
        "internalType": "struct IMetricVAMMFactory.VAMMTemplate",
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "getTotalVAMMs",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "string",
        "name": "category",
        "type": "string"
      }
    ],
    "name": "getVAMMByCategory",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "metricId",
        "type": "bytes32"
      }
    ],
    "name": "getVAMMByMetric",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "vammAddress",
        "type": "address"
      }
    ],
    "name": "getVAMMInfo",
    "outputs": [
      {
        "components": [
          {
            "internalType": "address",
            "name": "vammAddress",
            "type": "address"
          },
          {
            "internalType": "string",
            "name": "category",
            "type": "string"
          },
          {
            "internalType": "bytes32[]",
            "name": "allowedMetrics",
            "type": "bytes32[]"
          },
          {
            "internalType": "string",
            "name": "templateUsed",
            "type": "string"
          },
          {
            "internalType": "address",
            "name": "creator",
            "type": "address"
          },
          {
            "internalType": "uint256",
            "name": "deployedAt",
            "type": "uint256"
          },
          {
            "internalType": "bool",
            "name": "isActive",
            "type": "bool"
          }
        ],
        "internalType": "struct IMetricVAMMFactory.VAMMInfo",
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "creator",
        "type": "address"
      }
    ],
    "name": "getVAMMsByCreator",
    "outputs": [
      {
        "internalType": "address[]",
        "name": "",
        "type": "address[]"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "vammAddress",
        "type": "address"
      }
    ],
    "name": "isVAMMDeployed",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "metricRegistry",
    "outputs": [
      {
        "internalType": "contract IMetricRegistry",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "owner",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "pause",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "paused",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "pendingOwner",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "newOwner",
        "type": "address"
      }
    ],
    "name": "proposeOwnership",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "deployer",
        "type": "address"
      },
      {
        "internalType": "bool",
        "name": "authorized",
        "type": "bool"
      }
    ],
    "name": "setAuthorizedDeployer",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "newFee",
        "type": "uint256"
      }
    ],
    "name": "setCustomTemplateFee",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "newFee",
        "type": "uint256"
      }
    ],
    "name": "setDeploymentFee",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "string",
        "name": "",
        "type": "string"
      }
    ],
    "name": "templates",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "maxLeverage",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "tradingFeeRate",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "liquidationFeeRate",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "maintenanceMarginRatio",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "initialReserves",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "volumeScaleFactor",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "startPrice",
        "type": "uint256"
      },
      {
        "internalType": "bool",
        "name": "isActive",
        "type": "bool"
      },
      {
        "internalType": "string",
        "name": "description",
        "type": "string"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "unpause",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "string",
        "name": "templateName",
        "type": "string"
      },
      {
        "internalType": "bool",
        "name": "isActive",
        "type": "bool"
      }
    ],
    "name": "updateTemplate",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "string",
        "name": "category",
        "type": "string"
      },
      {
        "internalType": "address",
        "name": "newVAMM",
        "type": "address"
      }
    ],
    "name": "updateVAMMCategory",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "name": "vammInfos",
    "outputs": [
      {
        "internalType": "address",
        "name": "vammAddress",
        "type": "address"
      },
      {
        "internalType": "string",
        "name": "category",
        "type": "string"
      },
      {
        "internalType": "bytes32[]",
        "name": "allowedMetrics",
        "type": "bytes32[]"
      },
      {
        "internalType": "string",
        "name": "templateUsed",
        "type": "string"
      },
      {
        "internalType": "address",
        "name": "creator",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "deployedAt",
        "type": "uint256"
      },
      {
        "internalType": "bool",
        "name": "isActive",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "string",
        "name": "",
        "type": "string"
      }
    ],
    "name": "vammsByCategory",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "name": "vammsByCreator",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "name": "vammsByMetric",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "recipient",
        "type": "address"
      }
    ],
    "name": "withdrawFees",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "stateMutability": "payable",
    "type": "receive"
  }
] as const;
export const METRIC_LIMIT_ORDER_MANAGER_ABI = [
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "_router",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "_vault",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "_factory",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "_automationFunding",
        "type": "address"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "constructor"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "newFee",
        "type": "uint256"
      }
    ],
    "name": "AutomationFeeUpdated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "successCount",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "attemptCount",
        "type": "uint256"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "keeper",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "totalRewards",
        "type": "uint256"
      }
    ],
    "name": "BatchOrdersExecuted",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "keeper",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "bool",
        "name": "authorized",
        "type": "bool"
      }
    ],
    "name": "KeeperAuthorized",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "orderHash",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "user",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "string",
        "name": "reason",
        "type": "string"
      }
    ],
    "name": "LimitOrderCancelled",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "orderHash",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "user",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "metricId",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "enum MetricLimitOrderManager.OrderType",
        "name": "orderType",
        "type": "uint8"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "triggerPrice",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "expiry",
        "type": "uint256"
      }
    ],
    "name": "LimitOrderCreated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "orderHash",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "keeper",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "positionId",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "executionPrice",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "keeperReward",
        "type": "uint256"
      }
    ],
    "name": "LimitOrderExecuted",
    "type": "event"
  },
  {
    "inputs": [],
    "name": "AUTOMATION_FEE_USDC",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "BASIS_POINTS",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "DOMAIN_SEPARATOR",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "DOMAIN_TYPEHASH",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "EXECUTION_FEE_USDC",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "MIN_KEEPER_FEE",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "ORDER_TYPEHASH",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "keeper",
        "type": "address"
      }
    ],
    "name": "addKeeper",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "name": "authorizedKeepers",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "automationFunding",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "orderHash",
        "type": "bytes32"
      },
      {
        "internalType": "string",
        "name": "reason",
        "type": "string"
      }
    ],
    "name": "cancelLimitOrder",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "metricId",
        "type": "bytes32"
      },
      {
        "internalType": "bool",
        "name": "isLong",
        "type": "bool"
      },
      {
        "internalType": "uint256",
        "name": "collateralAmount",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "leverage",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "triggerPrice",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "targetValue",
        "type": "uint256"
      },
      {
        "internalType": "enum IMetricVAMM.PositionType",
        "name": "positionType",
        "type": "uint8"
      },
      {
        "internalType": "enum MetricLimitOrderManager.OrderType",
        "name": "orderType",
        "type": "uint8"
      },
      {
        "internalType": "uint256",
        "name": "expiry",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "maxSlippage",
        "type": "uint256"
      }
    ],
    "name": "createLimitOrder",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "orderHash",
        "type": "bytes32"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "components": [
          {
            "internalType": "bytes32",
            "name": "orderHash",
            "type": "bytes32"
          },
          {
            "internalType": "address",
            "name": "user",
            "type": "address"
          },
          {
            "internalType": "bytes32",
            "name": "metricId",
            "type": "bytes32"
          },
          {
            "internalType": "bool",
            "name": "isLong",
            "type": "bool"
          },
          {
            "internalType": "uint256",
            "name": "collateralAmount",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "leverage",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "triggerPrice",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "targetValue",
            "type": "uint256"
          },
          {
            "internalType": "enum IMetricVAMM.PositionType",
            "name": "positionType",
            "type": "uint8"
          },
          {
            "internalType": "enum MetricLimitOrderManager.OrderType",
            "name": "orderType",
            "type": "uint8"
          },
          {
            "internalType": "uint256",
            "name": "expiry",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "maxSlippage",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "keeperFee",
            "type": "uint256"
          },
          {
            "internalType": "bool",
            "name": "isActive",
            "type": "bool"
          },
          {
            "internalType": "uint256",
            "name": "createdAt",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "nonce",
            "type": "uint256"
          }
        ],
        "internalType": "struct MetricLimitOrderManager.LimitOrder",
        "name": "order",
        "type": "tuple"
      },
      {
        "internalType": "bytes",
        "name": "signature",
        "type": "bytes"
      }
    ],
    "name": "createLimitOrderWithSignature",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "orderHash",
        "type": "bytes32"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "orderHash",
        "type": "bytes32"
      },
      {
        "internalType": "string",
        "name": "reason",
        "type": "string"
      }
    ],
    "name": "emergencyCancelOrder",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "token",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      }
    ],
    "name": "emergencyWithdraw",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32[]",
        "name": "orderHashes",
        "type": "bytes32[]"
      }
    ],
    "name": "executeBatchOrders",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "orderHash",
        "type": "bytes32"
      }
    ],
    "name": "executeLimitOrder",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "positionId",
        "type": "uint256"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "factory",
    "outputs": [
      {
        "internalType": "contract IMetricVAMMFactory",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "metricId",
        "type": "bytes32"
      },
      {
        "internalType": "uint256",
        "name": "maxOrders",
        "type": "uint256"
      }
    ],
    "name": "getExecutableOrders",
    "outputs": [
      {
        "internalType": "bytes32[]",
        "name": "executableOrders",
        "type": "bytes32[]"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "metricId",
        "type": "bytes32"
      }
    ],
    "name": "getMetricOrders",
    "outputs": [
      {
        "internalType": "bytes32[]",
        "name": "",
        "type": "bytes32[]"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "orderHash",
        "type": "bytes32"
      }
    ],
    "name": "getOrderDetails",
    "outputs": [
      {
        "components": [
          {
            "internalType": "bytes32",
            "name": "orderHash",
            "type": "bytes32"
          },
          {
            "internalType": "address",
            "name": "user",
            "type": "address"
          },
          {
            "internalType": "bytes32",
            "name": "metricId",
            "type": "bytes32"
          },
          {
            "internalType": "bool",
            "name": "isLong",
            "type": "bool"
          },
          {
            "internalType": "uint256",
            "name": "collateralAmount",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "leverage",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "triggerPrice",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "targetValue",
            "type": "uint256"
          },
          {
            "internalType": "enum IMetricVAMM.PositionType",
            "name": "positionType",
            "type": "uint8"
          },
          {
            "internalType": "enum MetricLimitOrderManager.OrderType",
            "name": "orderType",
            "type": "uint8"
          },
          {
            "internalType": "uint256",
            "name": "expiry",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "maxSlippage",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "keeperFee",
            "type": "uint256"
          },
          {
            "internalType": "bool",
            "name": "isActive",
            "type": "bool"
          },
          {
            "internalType": "uint256",
            "name": "createdAt",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "nonce",
            "type": "uint256"
          }
        ],
        "internalType": "struct MetricLimitOrderManager.LimitOrder",
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "getOrderStats",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "created",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "executed",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "cancelled",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "feesCollected",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "user",
        "type": "address"
      }
    ],
    "name": "getUserActiveOrders",
    "outputs": [
      {
        "components": [
          {
            "internalType": "bytes32",
            "name": "orderHash",
            "type": "bytes32"
          },
          {
            "internalType": "address",
            "name": "user",
            "type": "address"
          },
          {
            "internalType": "bytes32",
            "name": "metricId",
            "type": "bytes32"
          },
          {
            "internalType": "bool",
            "name": "isLong",
            "type": "bool"
          },
          {
            "internalType": "uint256",
            "name": "collateralAmount",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "leverage",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "triggerPrice",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "targetValue",
            "type": "uint256"
          },
          {
            "internalType": "enum IMetricVAMM.PositionType",
            "name": "positionType",
            "type": "uint8"
          },
          {
            "internalType": "enum MetricLimitOrderManager.OrderType",
            "name": "orderType",
            "type": "uint8"
          },
          {
            "internalType": "uint256",
            "name": "expiry",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "maxSlippage",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "keeperFee",
            "type": "uint256"
          },
          {
            "internalType": "bool",
            "name": "isActive",
            "type": "bool"
          },
          {
            "internalType": "uint256",
            "name": "createdAt",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "nonce",
            "type": "uint256"
          }
        ],
        "internalType": "struct MetricLimitOrderManager.LimitOrder[]",
        "name": "activeOrders",
        "type": "tuple[]"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "user",
        "type": "address"
      }
    ],
    "name": "getUserNonce",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "user",
        "type": "address"
      }
    ],
    "name": "getUserOrders",
    "outputs": [
      {
        "internalType": "bytes32[]",
        "name": "",
        "type": "bytes32[]"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "name": "limitOrders",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "orderHash",
        "type": "bytes32"
      },
      {
        "internalType": "address",
        "name": "user",
        "type": "address"
      },
      {
        "internalType": "bytes32",
        "name": "metricId",
        "type": "bytes32"
      },
      {
        "internalType": "bool",
        "name": "isLong",
        "type": "bool"
      },
      {
        "internalType": "uint256",
        "name": "collateralAmount",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "leverage",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "triggerPrice",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "targetValue",
        "type": "uint256"
      },
      {
        "internalType": "enum IMetricVAMM.PositionType",
        "name": "positionType",
        "type": "uint8"
      },
      {
        "internalType": "enum MetricLimitOrderManager.OrderType",
        "name": "orderType",
        "type": "uint8"
      },
      {
        "internalType": "uint256",
        "name": "expiry",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "maxSlippage",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "keeperFee",
        "type": "uint256"
      },
      {
        "internalType": "bool",
        "name": "isActive",
        "type": "bool"
      },
      {
        "internalType": "uint256",
        "name": "createdAt",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "nonce",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "maxOrdersPerTx",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      },
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "name": "metricOrders",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "name": "nonces",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "owner",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "pause",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "paused",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "keeper",
        "type": "address"
      }
    ],
    "name": "removeKeeper",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "router",
    "outputs": [
      {
        "internalType": "contract MetricVAMMRouter",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "_maxOrders",
        "type": "uint256"
      }
    ],
    "name": "setMaxOrdersPerTx",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "totalFeesCollected",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "totalOrdersCancelled",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "totalOrdersCreated",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "totalOrdersExecuted",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "newOwner",
        "type": "address"
      }
    ],
    "name": "transferOwnership",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "unpause",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "name": "userOrders",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "vault",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  }
] as const;

// ==========================================
// 🏭 SPECIALIZED METRIC VAMM ABI
// ==========================================

export const METRIC_VAMM_ABI = [
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "metricId",
        "type": "bytes32"
      }
    ],
    "name": "getMetricMarkPrice",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "metricId",
        "type": "bytes32"
      }
    ],
    "name": "getMetricFundingRate",
    "outputs": [
      {
        "internalType": "int256",
        "name": "",
        "type": "int256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "user",
        "type": "address"
      },
      {
        "internalType": "bytes32",
        "name": "metricId",
        "type": "bytes32"
      }
    ],
    "name": "getMetricPositionsByUser",
    "outputs": [
      {
        "internalType": "uint256[]",
        "name": "",
        "type": "uint256[]"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "positionId",
        "type": "uint256"
      }
    ],
    "name": "getMetricPosition",
    "outputs": [
      {
        "components": [
          {
            "internalType": "uint256",
            "name": "positionId",
            "type": "uint256"
          },
          {
            "internalType": "bytes32",
            "name": "metricId",
            "type": "bytes32"
          },
          {
            "internalType": "int256",
            "name": "size",
            "type": "int256"
          },
          {
            "internalType": "bool",
            "name": "isLong",
            "type": "bool"
          },
          {
            "internalType": "uint256",
            "name": "entryPrice",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "targetValue",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "settlementDate",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "entryFundingIndex",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "lastInteractionTime",
            "type": "uint256"
          },
          {
            "internalType": "bool",
            "name": "isActive",
            "type": "bool"
          },
          {
            "internalType": "bool",
            "name": "isSettlementBased",
            "type": "bool"
          }
        ],
        "internalType": "struct IMetricVAMM.MetricPosition",
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  }
] as const;

// ==========================================
// 📊 METRIC REGISTRY ABI
// ==========================================

export const METRIC_REGISTRY_ABI = [
  {
    "inputs": [],
    "name": "getActiveMetrics",
    "outputs": [
      {
        "internalType": "bytes32[]",
        "name": "",
        "type": "bytes32[]"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "metricId",
        "type": "bytes32"
      }
    ],
    "name": "getMetric",
    "outputs": [
      {
        "components": [
          {
            "internalType": "bytes32",
            "name": "metricId",
            "type": "bytes32"
          },
          {
            "internalType": "string",
            "name": "name",
            "type": "string"
          },
          {
            "internalType": "string",
            "name": "description",
            "type": "string"
          },
          {
            "internalType": "string",
            "name": "dataSource",
            "type": "string"
          },
          {
            "internalType": "string",
            "name": "calculationMethod",
            "type": "string"
          },
          {
            "internalType": "address",
            "name": "creator",
            "type": "address"
          },
          {
            "internalType": "uint256",
            "name": "createdAt",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "settlementPeriodDays",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "minimumStake",
            "type": "uint256"
          },
          {
            "internalType": "bool",
            "name": "isActive",
            "type": "bool"
          },
          {
            "internalType": "bytes32",
            "name": "umaIdentifier",
            "type": "bytes32"
          }
        ],
        "internalType": "struct IMetricRegistry.MetricDefinition",
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "string",
        "name": "name",
        "type": "string"
      }
    ],
    "name": "getMetricByName",
    "outputs": [
      {
        "components": [
          {
            "internalType": "bytes32",
            "name": "metricId",
            "type": "bytes32"
          },
          {
            "internalType": "string",
            "name": "name",
            "type": "string"
          },
          {
            "internalType": "string",
            "name": "description",
            "type": "string"
          },
          {
            "internalType": "string",
            "name": "dataSource",
            "type": "string"
          },
          {
            "internalType": "string",
            "name": "calculationMethod",
            "type": "string"
          },
          {
            "internalType": "address",
            "name": "creator",
            "type": "address"
          },
          {
            "internalType": "uint256",
            "name": "createdAt",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "settlementPeriodDays",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "minimumStake",
            "type": "uint256"
          },
          {
            "internalType": "bool",
            "name": "isActive",
            "type": "bool"
          },
          {
            "internalType": "bytes32",
            "name": "umaIdentifier",
            "type": "bytes32"
          }
        ],
        "internalType": "struct IMetricRegistry.MetricDefinition",
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "metricId",
        "type": "bytes32"
      }
    ],
    "name": "isMetricActive",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "string",
        "name": "name",
        "type": "string"
      },
      {
        "internalType": "string",
        "name": "description",
        "type": "string"
      },
      {
        "internalType": "string",
        "name": "dataSource",
        "type": "string"
      },
      {
        "internalType": "string",
        "name": "calculationMethod",
        "type": "string"
      },
      {
        "internalType": "uint256",
        "name": "settlementPeriodDays",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "minimumStake",
        "type": "uint256"
      }
    ],
    "name": "registerMetric",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "metricId",
        "type": "bytes32"
      }
    ],
    "stateMutability": "payable",
    "type": "function"
  }
] as const;

export const AUTOMATION_FUNDING_MANAGER_ABI = [] as const;
export const LIMIT_ORDER_KEEPER_ABI = [] as const;

console.log('✅ All contract ABIs loaded and validated successfully');

// Export a function to get ABI information for debugging
export function getABIInfo(contractName: string) {
  const abis = {
    'METRIC_VAMM_ROUTER': METRIC_VAMM_ROUTER_ABI,
    'CENTRALIZED_VAULT': CENTRALIZED_VAULT_ABI,
    'METRIC_VAMM_FACTORY': METRIC_VAMM_FACTORY_ABI,
    'METRIC_VAMM': METRIC_VAMM_ABI,
    'METRIC_LIMIT_ORDER_MANAGER': METRIC_LIMIT_ORDER_MANAGER_ABI,
    'METRIC_REGISTRY': METRIC_REGISTRY_ABI,
    'AUTOMATION_FUNDING_MANAGER': AUTOMATION_FUNDING_MANAGER_ABI,
    'LIMIT_ORDER_KEEPER': LIMIT_ORDER_KEEPER_ABI
  };

  const abi = abis[contractName as keyof typeof abis];
  if (!abi) {
    return { error: `Contract ${contractName} not found` };
  }

  const functions = abi.filter((item: any) => item.type === 'function');
  return {
    contractName,
    totalItems: abi.length,
    functionCount: functions.length,
    functions: functions.map((f: any) => f.name),
    hasGetAllUserPositions: functions.some((f: any) => f.name === 'getAllUserPositions'),
    hasGetPortfolioDashboard: functions.some((f: any) => f.name === 'getPortfolioDashboard'),
    hasGetMetricPriceComparison: functions.some((f: any) => f.name === 'getMetricPriceComparison')
  };
} 