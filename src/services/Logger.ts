export class Logger {
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

  static log(message: string, data?: any): void {
    const timestamp = new Date().toISOString();
    const coloredTimestamp = `${Logger.colors.dim}${timestamp}${Logger.colors.reset}`;
    const coloredMessage = `${Logger.colors.cyan}${message}${Logger.colors.reset}`;
    
    if (data) {
      console.log(`${coloredTimestamp} ${coloredMessage}`, 
        JSON.stringify(data, Logger.replacer, 2));
    } else {
      console.log(`${coloredTimestamp} ${coloredMessage}`);
    }
  }

  log(message: string, data?: any): void {
    Logger.log(message, data);
  }

  static error(message: string, error?: any): void {
    const timestamp = new Date().toISOString();
    const coloredTimestamp = `${Logger.colors.dim}${timestamp}${Logger.colors.reset}`;
    const coloredMessage = `${Logger.colors.red}❌ ${message}${Logger.colors.reset}`;
    
    if (error) {
      console.error(`${coloredTimestamp} ${coloredMessage}`, error);
    } else {
      console.error(`${coloredTimestamp} ${coloredMessage}`);
    }
  }

  static success(message: string, data?: any): void {
    const timestamp = new Date().toISOString();
    const coloredTimestamp = `${Logger.colors.dim}${timestamp}${Logger.colors.reset}`;
    const coloredMessage = `${Logger.colors.green}✅ ${message}${Logger.colors.reset}`;
    
    if (data) {
      console.log(`${coloredTimestamp} ${coloredMessage}`, 
        JSON.stringify(data, Logger.replacer, 2));
    } else {
      console.log(`${coloredTimestamp} ${coloredMessage}`);
    }
  }

  static warning(message: string, data?: any): void {
    const timestamp = new Date().toISOString();
    const coloredTimestamp = `${Logger.colors.dim}${timestamp}${Logger.colors.reset}`;
    const coloredMessage = `${Logger.colors.yellow}⚠️  ${message}${Logger.colors.reset}`;
    
    if (data) {
      console.log(`${coloredTimestamp} ${coloredMessage}`, 
        JSON.stringify(data, Logger.replacer, 2));
    } else {
      console.log(`${coloredTimestamp} ${coloredMessage}`);
    }
  }

  static info(message: string, data?: any): void {
    const timestamp = new Date().toISOString();
    const coloredTimestamp = `${Logger.colors.dim}${timestamp}${Logger.colors.reset}`;
    const coloredMessage = `${Logger.colors.blue}ℹ️  ${message}${Logger.colors.reset}`;
    
    if (data) {
      console.log(`${coloredTimestamp} ${coloredMessage}`, 
        JSON.stringify(data, Logger.replacer, 2));
    } else {
      console.log(`${coloredTimestamp} ${coloredMessage}`);
    }
  }

  private static replacer(key: string, value: any): any {
    if (typeof value === 'bigint') {
      return value.toString();
    }
    return value;
  }
}







