export interface SmartContractEvent {
  transactionHash: string;
  blockNumber: number;
  blockHash: string;
  logIndex: number;
  contractAddress: string;
  timestamp: Date;
  chainId: number;
  eventType: string;
  [key: string]: any;
}



