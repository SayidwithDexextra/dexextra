import { Contract, JsonRpcProvider, getAddress } from 'ethers';

export type ObOrder = {
  orderId: bigint;
  trader: string;
  price: bigint;
  amount: bigint;
  isBuy: boolean;
  timestamp: bigint;
  nextOrderId: bigint;
  marginRequired: bigint;
  isMarginOrder: boolean;
};

const OB_VIEW_ABI = [
  'function getUserOrders(address user) view returns (uint256[] orderIds)',
  'function getOrder(uint256 orderId) view returns (uint256 orderId_, address trader, uint256 price, uint256 amount, bool isBuy, uint256 timestamp, uint256 nextOrderId, uint256 marginRequired, bool isMarginOrder)',
  'function bestBid() view returns (uint256)',
  'function bestAsk() view returns (uint256)',
] as const;

function isHexAddress(addr: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(addr);
}

export class OrderbookChainReader {
  readonly provider: JsonRpcProvider;
  constructor(rpcUrl: string) {
    this.provider = new JsonRpcProvider(rpcUrl);
  }

  async getChainId(): Promise<number> {
    const net = await this.provider.getNetwork();
    return Number(net.chainId);
  }

  private contract(orderBook: string): Contract {
    if (!isHexAddress(orderBook)) throw new Error(`Invalid orderBook address: ${orderBook}`);
    return new Contract(getAddress(orderBook), OB_VIEW_ABI as any, this.provider);
  }

  async getUserOpenOrders(orderBook: string, trader: string): Promise<ObOrder[]> {
    const c = this.contract(orderBook);
    const ids: bigint[] = await c.getUserOrders(getAddress(trader));
    if (!ids || ids.length === 0) return [];
    const out: ObOrder[] = [];
    for (const id of ids) {
      try {
        const r = await c.getOrder(id);
        const order: ObOrder = {
          orderId: BigInt(r[0]),
          trader: String(r[1]),
          price: BigInt(r[2]),
          amount: BigInt(r[3]),
          isBuy: Boolean(r[4]),
          timestamp: BigInt(r[5]),
          nextOrderId: BigInt(r[6]),
          marginRequired: BigInt(r[7]),
          isMarginOrder: Boolean(r[8]),
        };
        // Cancelled/filled orders are deleted; getOrder then returns trader=0x0
        if (order.trader && order.trader !== '0x0000000000000000000000000000000000000000') {
          out.push(order);
        }
      } catch {
        // ignore per-order read errors; continue
      }
    }
    return out;
  }

  async bestBidAsk(orderBook: string): Promise<{ bestBid: bigint; bestAsk: bigint }> {
    const c = this.contract(orderBook);
    const [bid, ask] = await Promise.all([c.bestBid(), c.bestAsk()]);
    return { bestBid: BigInt(bid), bestAsk: BigInt(ask) };
  }
}




