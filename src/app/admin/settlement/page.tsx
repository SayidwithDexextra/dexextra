'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';

interface SettlementStatus {
  success: boolean;
  processor_status: {
    isRunning: boolean;
    isProcessing: boolean;
  };
  environment: {
    supabase_url: boolean;
    service_role_key: boolean;
    settlement_private_key: boolean;
    rpc_url: boolean;
    chain_id: string;
  };
  endpoints: Record<string, string>;
}

interface PendingTradesStatus {
  success: boolean;
  summary: Record<string, number>;
  pending_trades: Array<{
    id: string;
    match_id: number;
    market_id: string;
    settlement_status: string;
    trade_price: string;
    trade_quantity: string;
    buy_trader_wallet_address: string;
    sell_trader_wallet_address: string;
    matched_at: string;
    settlement_attempts: number;
  }>;
  pending_count: number;
}

export default function SettlementAdminPage() {
  const [status, setStatus] = useState<SettlementStatus | null>(null);
  const [pendingTrades, setPendingTrades] = useState<PendingTradesStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string>('');
  const [messageType, setMessageType] = useState<'success' | 'error' | 'info'>('info');

  const showMessage = (msg: string, type: 'success' | 'error' | 'info' = 'info') => {
    setMessage(msg);
    setMessageType(type);
    setTimeout(() => setMessage(''), 5000);
  };

  const fetchStatus = async () => {
    try {
      const response = await fetch('/api/admin/settlement/process');
      const data = await response.json();
      setStatus(data);
    } catch (error) {
      console.error('Error fetching status:', error);
      showMessage('Failed to fetch settlement status', 'error');
    }
  };

  const fetchPendingTrades = async () => {
    try {
      const response = await fetch('/api/admin/settlement/force-pending');
      const data = await response.json();
      setPendingTrades(data);
    } catch (error) {
      console.error('Error fetching pending trades:', error);
      showMessage('Failed to fetch pending trades', 'error');
    }
  };

  const forcePending = async (marketId?: string) => {
    setLoading(true);
    try {
      const response = await fetch('/api/admin/settlement/force-pending', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          marketId,
          force: !marketId // If no marketId, force all trades
        })
      });
      
      const data = await response.json();
      
      if (data.success) {
        showMessage(`Successfully updated ${data.processed} trades to PENDING status`, 'success');
        await fetchPendingTrades();
      } else {
        showMessage(data.error || 'Failed to update trades', 'error');
      }
    } catch (error) {
      console.error('Error forcing pending:', error);
      showMessage('Failed to force pending status', 'error');
    } finally {
      setLoading(false);
    }
  };

  const processSettlement = async (dryRun = false) => {
    setLoading(true);
    try {
      const response = await fetch('/api/admin/settlement/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun })
      });
      
      const data = await response.json();
      
      if (data.success) {
        showMessage(
          dryRun 
            ? 'Dry run completed - check server logs for details'
            : 'Settlement processing triggered successfully',
          'success'
        );
        await fetchStatus();
        await fetchPendingTrades();
      } else {
        showMessage(data.error || 'Settlement processing failed', 'error');
      }
    } catch (error) {
      console.error('Error processing settlement:', error);
      showMessage('Failed to process settlement', 'error');
    } finally {
      setLoading(false);
    }
  };

  const startProcessor = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/admin/settlement/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intervalMs: 30000 })
      });
      
      const data = await response.json();
      
      if (data.success) {
        showMessage('Settlement processor started successfully', 'success');
        await fetchStatus();
      } else {
        showMessage(data.message || 'Failed to start processor', 'error');
      }
    } catch (error) {
      console.error('Error starting processor:', error);
      showMessage('Failed to start settlement processor', 'error');
    } finally {
      setLoading(false);
    }
  };

  const stopProcessor = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/admin/settlement/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      
      const data = await response.json();
      
      if (data.success) {
        showMessage('Settlement processor stopped successfully', 'success');
        await fetchStatus();
      } else {
        showMessage(data.message || 'Failed to stop processor', 'error');
      }
    } catch (error) {
      console.error('Error stopping processor:', error);
      showMessage('Failed to stop settlement processor', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    fetchPendingTrades();
    
    // Refresh every 10 seconds
    const interval = setInterval(() => {
      fetchStatus();
      fetchPendingTrades();
    }, 10000);

    return () => clearInterval(interval);
  }, []);

  const getStatusBadge = (isRunning: boolean, isProcessing: boolean) => {
    if (isProcessing) return <Badge variant="default" className="bg-yellow-500">Processing</Badge>;
    if (isRunning) return <Badge variant="default" className="bg-green-500">Running</Badge>;
    return <Badge variant="secondary">Stopped</Badge>;
  };

  const getEnvStatusBadge = (value: boolean | string) => {
    if (typeof value === 'boolean') {
      return value 
        ? <Badge variant="default" className="bg-green-500 text-xs">✓</Badge>
        : <Badge variant="destructive" className="text-xs">✗</Badge>;
    }
    return <Badge variant="outline" className="text-xs">{value}</Badge>;
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">Settlement Administration</h1>
        <div className="flex gap-2">
          <Button 
            onClick={() => fetchStatus()} 
            variant="outline" 
            size="sm"
            disabled={loading}
          >
            Refresh
          </Button>
        </div>
      </div>

      {message && (
        <Alert className={messageType === 'error' ? 'border-red-500' : messageType === 'success' ? 'border-green-500' : 'border-blue-500'}>
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      )}

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="trades">Pending Trades</TabsTrigger>
          <TabsTrigger value="processor">Processor Control</TabsTrigger>
          <TabsTrigger value="environment">Environment</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Processor Status</CardTitle>
              </CardHeader>
              <CardContent>
                {status ? (
                  <div className="space-y-2">
                    {getStatusBadge(status.processor_status.isRunning, status.processor_status.isProcessing)}
                    <div className="text-xs text-muted-foreground">
                      Running: {status.processor_status.isRunning ? 'Yes' : 'No'}<br/>
                      Processing: {status.processor_status.isProcessing ? 'Yes' : 'No'}
                    </div>
                  </div>
                ) : (
                  <div>Loading...</div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Trade Status Summary</CardTitle>
              </CardHeader>
              <CardContent>
                {pendingTrades ? (
                  <div className="space-y-1">
                    {Object.entries(pendingTrades.summary).map(([status, count]) => (
                      <div key={status} className="flex justify-between text-xs">
                        <span className="capitalize">{status.toLowerCase()}</span>
                        <Badge variant="outline" className="text-xs">{count}</Badge>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div>Loading...</div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Quick Actions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Button 
                  onClick={() => processSettlement(true)} 
                  variant="outline" 
                  size="sm" 
                  className="w-full"
                  disabled={loading}
                >
                  Dry Run Settlement
                </Button>
                <Button 
                  onClick={() => processSettlement(false)} 
                  variant="default" 
                  size="sm" 
                  className="w-full"
                  disabled={loading}
                >
                  🔗 Push to Blockchain
                </Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="trades" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex justify-between items-center">
                <CardTitle>Pending Trades ({pendingTrades?.pending_count || 0})</CardTitle>
                <div className="flex gap-2">
                  <Button 
                    onClick={() => forcePending()} 
                    variant="outline" 
                    size="sm"
                    disabled={loading}
                  >
                    Force All to Pending
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {pendingTrades?.pending_trades && pendingTrades.pending_trades.length > 0 ? (
                <div className="space-y-2">
                  {pendingTrades.pending_trades.map((trade) => (
                    <div key={trade.id} className="border rounded p-3 space-y-2">
                      <div className="flex justify-between items-start">
                        <div>
                          <div className="font-mono text-sm">Match ID: {trade.match_id}</div>
                          <div className="text-xs text-muted-foreground">
                            {trade.trade_quantity} @ ${trade.trade_price}
                          </div>
                        </div>
                        <Badge variant={trade.settlement_status === 'PENDING' ? 'default' : 'secondary'}>
                          {trade.settlement_status}
                        </Badge>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div>
                          <span className="text-muted-foreground">Buyer:</span><br/>
                          <span className="font-mono">{trade.buy_trader_wallet_address.slice(0, 8)}...</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Seller:</span><br/>
                          <span className="font-mono">{trade.sell_trader_wallet_address.slice(0, 8)}...</span>
                        </div>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Attempts: {trade.settlement_attempts} | 
                        Matched: {new Date(trade.matched_at).toLocaleString()}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center text-muted-foreground py-8">
                  No pending trades found
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="processor" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Settlement Processor Control</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-4">
                <Button 
                  onClick={startProcessor} 
                  variant="default"
                  disabled={loading || status?.processor_status.isRunning}
                >
                  Start Processor
                </Button>
                <Button 
                  onClick={stopProcessor} 
                  variant="destructive"
                  disabled={loading || !status?.processor_status.isRunning}
                >
                  Stop Processor
                </Button>
              </div>
              
              <Separator />
              
              <div className="space-y-2">
                <h4 className="font-semibold">Manual Processing</h4>
                <div className="flex gap-2">
                  <Button 
                    onClick={() => processSettlement(true)} 
                    variant="outline"
                    disabled={loading}
                  >
                    Dry Run
                  </Button>
                  <Button 
                    onClick={() => processSettlement(false)} 
                    variant="default"
                    disabled={loading}
                  >
                    🔗 Live Processing
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Dry run will simulate the process without sending transactions. 
                  Live processing will send real blockchain transactions.
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="environment" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Environment Configuration</CardTitle>
            </CardHeader>
            <CardContent>
              {status ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="flex justify-between items-center">
                      <span className="text-sm">Supabase URL</span>
                      {getEnvStatusBadge(status.environment.supabase_url)}
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm">Service Role Key</span>
                      {getEnvStatusBadge(status.environment.service_role_key)}
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm">Settlement Private Key</span>
                      {getEnvStatusBadge(status.environment.settlement_private_key)}
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm">RPC URL</span>
                      {getEnvStatusBadge(status.environment.rpc_url)}
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm">Chain ID</span>
                      {getEnvStatusBadge(status.environment.chain_id)}
                    </div>
                  </div>
                  
                  <Separator />
                  
                  <div className="space-y-2">
                    <h4 className="font-semibold text-sm">Available Endpoints</h4>
                    <div className="space-y-1">
                      {Object.entries(status.endpoints).map(([name, endpoint]) => (
                        <div key={name} className="flex justify-between text-xs font-mono">
                          <span>{name}</span>
                          <span className="text-muted-foreground">{endpoint}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div>Loading...</div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}





