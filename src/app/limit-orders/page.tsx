'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
// Removed keccak256, toBytes imports - metricId passed as string directly
import { useLimitOrders } from '@/hooks/useLimitOrders';

interface LimitOrderFormData {
  metricId: string;
  collateralAmount: string;
  isLong: boolean;
  leverage: string;
  triggerPrice: string;
  orderType: number;
  expiry: string;
}

export default function LimitOrdersPage() {
  const [formData, setFormData] = useState<LimitOrderFormData>({
    metricId: 'BTCUSD',
    collateralAmount: '100',
    isLong: true,
    leverage: '5',
    triggerPrice: '50000',
    orderType: 0, // LIMIT
    expiry: ''
  });

  const {
    orders,
    isLoading,
    error,
    createOrder,
    cancelOrder,
    refreshOrders
  } = useLimitOrders();

  // Set default expiry to 1 day from now
  useEffect(() => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    setFormData(prev => ({
      ...prev,
      expiry: Math.floor(tomorrow.getTime() / 1000).toString()
    }));
  }, []);

  const handleInputChange = (field: keyof LimitOrderFormData, value: string | boolean | number) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      await createOrder({
        metricId: formData.metricId, // Pass string directly, useLimitOrders converts to bytes32
        collateralAmount: BigInt(Math.floor(parseFloat(formData.collateralAmount) * 1e6)), // Convert to USDC wei (6 decimals)
        isLong: formData.isLong,
        leverage: BigInt(formData.leverage),
        triggerPrice: BigInt(Math.floor(parseFloat(formData.triggerPrice) * 1e18)), // Convert to wei
        orderType: formData.orderType,
        expiry: BigInt(formData.expiry)
      });

      // Reset form after successful submission
      setFormData(prev => ({
        ...prev,
        collateralAmount: '100',
        triggerPrice: '50000'
      }));
    } catch (error) {
      console.error('Failed to create limit order:', error);
    }
  };

  const handleCancelOrder = async (orderHash: string) => {
    try {
      await cancelOrder(orderHash);
    } catch (error) {
      console.error('Failed to cancel order:', error);
    }
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Limit Orders</h1>
        <Button onClick={refreshOrders} disabled={isLoading}>
          {isLoading ? 'Loading...' : 'Refresh'}
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Create Order Form */}
        <Card>
          <CardHeader>
            <CardTitle>Create Limit Order</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <Label htmlFor="metricId">Metric ID</Label>
                <Input
                  id="metricId"
                  value={formData.metricId}
                  onChange={(e) => handleInputChange('metricId', e.target.value)}
                  placeholder="e.g., BTCUSD"
                />
              </div>

              <div>
                <Label htmlFor="collateralAmount">Collateral Amount (USDC)</Label>
                <Input
                  id="collateralAmount"
                  type="number"
                  value={formData.collateralAmount}
                  onChange={(e) => handleInputChange('collateralAmount', e.target.value)}
                  placeholder="100"
                />
              </div>

              <div>
                <Label>Position Type</Label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant={formData.isLong ? 'default' : 'outline'}
                    onClick={() => handleInputChange('isLong', true)}
                  >
                    Long
                  </Button>
                  <Button
                    type="button"
                    variant={!formData.isLong ? 'default' : 'outline'}
                    onClick={() => handleInputChange('isLong', false)}
                  >
                    Short
                  </Button>
                </div>
              </div>

              <div>
                <Label htmlFor="leverage">Leverage</Label>
                <Input
                  id="leverage"
                  type="number"
                  value={formData.leverage}
                  onChange={(e) => handleInputChange('leverage', e.target.value)}
                  placeholder="5"
                  min="1"
                  max="100"
                />
              </div>

              <div>
                <Label htmlFor="triggerPrice">Trigger Price (USD)</Label>
                <Input
                  id="triggerPrice"
                  type="number"
                  value={formData.triggerPrice}
                  onChange={(e) => handleInputChange('triggerPrice', e.target.value)}
                  placeholder="50000"
                />
              </div>

              <div>
                <Label htmlFor="orderType">Order Type</Label>
                <select
                  id="orderType"
                  value={formData.orderType}
                  onChange={(e) => handleInputChange('orderType', parseInt(e.target.value))}
                  className="w-full p-2 border rounded"
                >
                  <option value={0}>Limit</option>
                  <option value={1}>Market If Touched</option>
                  <option value={2}>Stop Loss</option>
                  <option value={3}>Take Profit</option>
                </select>
              </div>

              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? 'Creating...' : 'Create Order'}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Orders List */}
        <Card>
          <CardHeader>
            <CardTitle>Your Orders</CardTitle>
          </CardHeader>
          <CardContent>
            {error && (
              <div className="text-red-500 mb-4">
                Error: {error}
              </div>
            )}

            {orders.length === 0 ? (
              <p className="text-gray-500">No limit orders found.</p>
            ) : (
              <div className="space-y-4">
                {orders.map((order, index) => (
                  <div
                    key={`${order.orderHash}-${index}`}
                    className="border rounded p-4 space-y-2"
                  >
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="font-medium">
                          {order.isLong ? 'Long' : 'Short'} • {order.leverage}x leverage
                        </p>
                        <p className="text-sm text-gray-600">
                          Collateral: {(Number(order.collateralAmount) / 1e6).toFixed(2)} USDC
                        </p>
                        <p className="text-sm text-gray-600">
                          Trigger: ${(Number(order.triggerPrice) / 1e18).toFixed(2)}
                        </p>
                      </div>
                      <div className="flex flex-col gap-2">
                        <span className={`px-2 py-1 rounded text-xs ${
                          order.isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                        }`}>
                          {order.isActive ? 'Active' : 'Inactive'}
                        </span>
                        {order.isActive && (
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => handleCancelOrder(order.orderHash)}
                          >
                            Cancel
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
} 