export class OrderLogger {
  private static colors = {
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

  static logOrderSubmission(message: string, order?: any): void {
    const timestamp = new Date().toISOString();
    const coloredTimestamp = `${OrderLogger.colors.dim}${timestamp}${OrderLogger.colors.reset}`;
    const coloredMessage = `${OrderLogger.colors.blue}📤 ${message}${OrderLogger.colors.reset}`;
    
    console.log(`${coloredTimestamp} ${coloredMessage}`);
    
    if (order) {
      const orderData = {
        orderId: order.orderId,
        trader: order.trader,
        side: order.side === 0 ? 'BUY' : 'SELL',
        type: order.orderType === 0 ? 'MARKET' : 'LIMIT',
        quantity: typeof order.quantity === 'bigint' ? order.quantity.toString() : order.quantity,
        price: typeof order.price === 'bigint' ? order.price.toString() : order.price,
        metricId: order.metricId
      };
      
      console.log(`  📋 Order Details:`, JSON.stringify(orderData, OrderLogger.replacer, 2));
    }
  }

  logOrderSubmission(message: string, order?: any): void {
    OrderLogger.logOrderSubmission(message, order);
  }

  static logOrderResult(message: string, result: any): void {
    const timestamp = new Date().toISOString();
    const coloredTimestamp = `${OrderLogger.colors.dim}${timestamp}${OrderLogger.colors.reset}`;
    
    if (result.success === false || result.error) {
      const coloredMessage = `${OrderLogger.colors.red}❌ ${message}${OrderLogger.colors.reset}`;
      console.log(`${coloredTimestamp} ${coloredMessage}`);
      console.log(`  🔍 Error:`, result.error || 'Unknown error');
    } else {
      const coloredMessage = `${OrderLogger.colors.green}✅ ${message}${OrderLogger.colors.reset}`;
      console.log(`${coloredTimestamp} ${coloredMessage}`);
      
      if (result.orderId) {
        console.log(`  🆔 Order ID:`, result.orderId);
      }
      
      if (result.status) {
        console.log(`  📊 Status:`, result.status);
      }
      
      if (result.matches && result.matches.length > 0) {
        console.log(`  🎯 Matches:`, result.matches.length);
      }
    }
  }

  logOrderResult(message: string, result: any): void {
    OrderLogger.logOrderResult(message, result);
  }

  static logMatches(message: string, matches: any[]): void {
    const timestamp = new Date().toISOString();
    const coloredTimestamp = `${OrderLogger.colors.dim}${timestamp}${OrderLogger.colors.reset}`;
    const coloredMessage = `${OrderLogger.colors.magenta}🎯 ${message}${OrderLogger.colors.reset}`;
    
    console.log(`${coloredTimestamp} ${coloredMessage}`);
    
    matches.forEach((match, index) => {
      console.log(`  Match ${index + 1}:`, {
        tradeId: match.tradeId,
        quantity: typeof match.quantity === 'bigint' ? match.quantity.toString() : match.quantity,
        price: typeof match.price === 'bigint' ? match.price.toString() : match.price,
        buyOrderId: match.buyOrderId,
        sellOrderId: match.sellOrderId
      });
    });
  }

  logMatches(message: string, matches: any[]): void {
    OrderLogger.logMatches(message, matches);
  }

  static logOrderBook(message: string, orderBook: any): void {
    const timestamp = new Date().toISOString();
    const coloredTimestamp = `${OrderLogger.colors.dim}${timestamp}${OrderLogger.colors.reset}`;
    const coloredMessage = `${OrderLogger.colors.cyan}📊 ${message}${OrderLogger.colors.reset}`;
    
    console.log(`${coloredTimestamp} ${coloredMessage}`);
    
    if (orderBook) {
      console.log(`  📈 Buy Orders:`, orderBook.buyOrders?.length || 0);
      console.log(`  📉 Sell Orders:`, orderBook.sellOrders?.length || 0);
      console.log(`  🕒 Last Update:`, orderBook.lastUpdateTime || 'N/A');
      
      if (orderBook.bestBid && orderBook.bestAsk) {
        console.log(`  💰 Best Bid:`, typeof orderBook.bestBid === 'bigint' ? orderBook.bestBid.toString() : orderBook.bestBid);
        console.log(`  💰 Best Ask:`, typeof orderBook.bestAsk === 'bigint' ? orderBook.bestAsk.toString() : orderBook.bestAsk);
      }
    }
  }

  logOrderBook(message: string, orderBook: any): void {
    OrderLogger.logOrderBook(message, orderBook);
  }

  static log(message: string, data?: any): void {
    const timestamp = new Date().toISOString();
    const coloredTimestamp = `${OrderLogger.colors.dim}${timestamp}${OrderLogger.colors.reset}`;
    const coloredMessage = `${OrderLogger.colors.white}📝 ${message}${OrderLogger.colors.reset}`;
    
    if (data) {
      console.log(`${coloredTimestamp} ${coloredMessage}`, 
        JSON.stringify(data, OrderLogger.replacer, 2));
    } else {
      console.log(`${coloredTimestamp} ${coloredMessage}`);
    }
  }

  log(message: string, data?: any): void {
    OrderLogger.log(message, data);
  }

  private static replacer(key: string, value: any): any {
    if (typeof value === 'bigint') {
      return value.toString();
    }
    return value;
  }
}







