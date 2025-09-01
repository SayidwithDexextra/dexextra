export class PNLLogger {
  static colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    dim: '\x1b[2m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    white: '\x1b[37m'
  };

  static logPosition(message: string, position: any): void {
    const timestamp = new Date().toISOString();
    const coloredTimestamp = `${PNLLogger.colors.dim}${timestamp}${PNLLogger.colors.reset}`;
    const coloredMessage = `${PNLLogger.colors.blue}📊 ${message}${PNLLogger.colors.reset}`;
    
    console.log(`${coloredTimestamp} ${coloredMessage}`);
    
    if (position) {
      console.log(`  👤 Trader:`, position.trader);
      console.log(`  📈 Side:`, position.side === 0 || position.side === 'buy' ? 'LONG' : 'SHORT');
      console.log(`  🔢 Quantity:`, position.quantity);
      console.log(`  💰 Avg Price:`, position.avgPrice);
      console.log(`  🏦 Collateral:`, position.collateral);
      console.log(`  📊 Metric:`, position.metricId);
    }
  }

  logPosition(message: string, position: any): void {
    PNLLogger.logPosition(message, position);
  }

  static logPNL(message: string, pnlData: any): void {
    const timestamp = new Date().toISOString();
    const coloredTimestamp = `${PNLLogger.colors.dim}${timestamp}${PNLLogger.colors.reset}`;
    
    // Color based on PNL value
    let coloredMessage: string;
    if (pnlData.totalPNL > 0) {
      coloredMessage = `${PNLLogger.colors.green}📈 ${message}${PNLLogger.colors.reset}`;
    } else if (pnlData.totalPNL < 0) {
      coloredMessage = `${PNLLogger.colors.red}📉 ${message}${PNLLogger.colors.reset}`;
    } else {
      coloredMessage = `${PNLLogger.colors.yellow}📊 ${message}${PNLLogger.colors.reset}`;
    }
    
    console.log(`${coloredTimestamp} ${coloredMessage}`);
    
    if (pnlData) {
      console.log(`  👤 Trader:`, pnlData.trader);
      console.log(`  💵 Total PNL:`, `$${pnlData.totalPNL.toFixed(2)}`);
      console.log(`  📊 Current Price:`, `$${pnlData.currentPrice.toFixed(2)}`);
      console.log(`  🔢 Position Count:`, pnlData.positionCount);
      
      if (pnlData.positions && pnlData.positions.length > 0) {
        console.log(`  📋 Positions:`);
        pnlData.positions.forEach((pos: any, index: number) => {
          console.log(`    ${index + 1}. ${pos.side} ${pos.quantity} @ $${pos.avgPrice} → PNL: $${pos.pnl.toFixed(2)}`);
        });
      }
    }
  }

  logPNL(message: string, pnlData: any): void {
    PNLLogger.logPNL(message, pnlData);
  }

  static logMarketPrice(message: string, priceData: any): void {
    const timestamp = new Date().toISOString();
    const coloredTimestamp = `${PNLLogger.colors.dim}${timestamp}${PNLLogger.colors.reset}`;
    const coloredMessage = `${PNLLogger.colors.cyan}💰 ${message}${PNLLogger.colors.reset}`;
    
    console.log(`${coloredTimestamp} ${coloredMessage}`);
    
    if (priceData) {
      console.log(`  📊 Current Price:`, `$${priceData.currentPrice.toFixed(2)}`);
      console.log(`  📈 Last Price:`, priceData.lastPrice ? `$${priceData.lastPrice.toFixed(2)}` : 'N/A');
      console.log(`  📊 Volume:`, priceData.volume || 'N/A');
      console.log(`  📊 Metric:`, priceData.metricId);
    }
  }

  logMarketPrice(message: string, priceData: any): void {
    PNLLogger.logMarketPrice(message, priceData);
  }

  static logTradeExecution(message: string, trade: any): void {
    const timestamp = new Date().toISOString();
    const coloredTimestamp = `${PNLLogger.colors.dim}${timestamp}${PNLLogger.colors.reset}`;
    const coloredMessage = `${PNLLogger.colors.magenta}⚡ ${message}${PNLLogger.colors.reset}`;
    
    console.log(`${coloredTimestamp} ${coloredMessage}`);
    
    if (trade) {
      console.log(`  🆔 Trade ID:`, trade.tradeId);
      console.log(`  👤 Buyer:`, trade.buyerAddress);
      console.log(`  👤 Seller:`, trade.sellerAddress);
      console.log(`  🔢 Quantity:`, trade.quantity);
      console.log(`  💰 Price:`, `$${trade.price}`);
      console.log(`  💵 Value:`, `$${(parseFloat(trade.quantity) * parseFloat(trade.price)).toFixed(2)}`);
    }
  }

  logTradeExecution(message: string, trade: any): void {
    PNLLogger.logTradeExecution(message, trade);
  }

  static log(message: string, data?: any): void {
    const timestamp = new Date().toISOString();
    const coloredTimestamp = `${PNLLogger.colors.dim}${timestamp}${PNLLogger.colors.reset}`;
    const coloredMessage = `${PNLLogger.colors.white}📝 ${message}${PNLLogger.colors.reset}`;
    
    if (data) {
      console.log(`${coloredTimestamp} ${coloredMessage}`, 
        JSON.stringify(data, PNLLogger.replacer, 2));
    } else {
      console.log(`${coloredTimestamp} ${coloredMessage}`);
    }
  }

  log(message: string, data?: any): void {
    PNLLogger.log(message, data);
  }

  private static replacer(key: string, value: any): any {
    if (typeof value === 'bigint') {
      return value.toString();
    }
    return value;
  }
}







