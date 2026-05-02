'use client';

import React from 'react';
import { StepProps, TIME_IN_FORCE_OPTIONS } from '../types';
import styles from '../MarketWizard.module.css';

export default function Step3SettlementConfig({ formData, updateFormData, onNext, errors }: StepProps) {
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onNext();
  };

  const calculateDataRequestWindowHours = () => {
    if (!formData.dataRequestWindow) return 0;
    return Math.floor(parseInt(formData.dataRequestWindow) / 3600);
  };

  const formatSettlementDate = () => {
    if (!formData.settlementDate) return 'Not set';
    const date = new Date(parseInt(formData.settlementDate) * 1000);
    return date.toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });
  };

  return (
    <form onSubmit={handleSubmit} className={styles.formSection}>
      <div className={styles.stepHeader}>
        <div className={styles.stepNumber}>03.</div>
        <h1 className={styles.pageTitle}>Settlement Configuration</h1>
      </div>

      {/* Settlement Timeline Info (read-only) */}
      <div className={styles.fieldRow}>
        <div>
          <div className={styles.fieldLabel}>Settlement Timeline</div>
          <div className={styles.fieldDescription}>
            All markets settle 1 year from creation. Trading ends 1 week before settlement to allow time for data collection and oracle resolution.
          </div>
        </div>
        <div className={styles.fieldInput}>
          <div className={styles.inputLabel}>SETTLEMENT DATE</div>
          <div className={styles.fixedValue}>
            {formatSettlementDate()}
          </div>
          <div className={styles.helpText}>
            Fixed 1-year settlement period for all markets
          </div>
        </div>
      </div>

      {/* Data Request Window */}
      <div className={styles.fieldRow}>
        <div>
          <div className={styles.fieldLabel}>Data Request Window</div>
          <div className={styles.fieldDescription}>
            How long before settlement date that oracle data can be requested. Longer windows provide more time for disputes but delay final settlement.
          </div>
        </div>
        <div className={styles.fieldInput}>
          <div className={styles.inputLabel}>REQUEST WINDOW (HOURS) (*)</div>
          <select
            value={calculateDataRequestWindowHours()}
            onChange={(e) => updateFormData({ dataRequestWindow: (parseInt(e.target.value) * 3600).toString() })}
            className={`${styles.input} ${errors.dataRequestWindow ? styles.inputError : ''}`}
          >
            <option value="">Select window</option>
            <option value="1">1 hour</option>
            <option value="6">6 hours</option>
            <option value="12">12 hours</option>
            <option value="24">24 hours (1 day)</option>
            <option value="48">48 hours (2 days)</option>
            <option value="72">72 hours (3 days)</option>
            <option value="168">168 hours (1 week)</option>
          </select>
          {errors.dataRequestWindow && <div className={styles.errorText}>{errors.dataRequestWindow}</div>}
          <div className={styles.helpText}>
            Longer windows allow more time for oracle disputes but delay settlement
          </div>
        </div>
      </div>

      {/* Oracle Provider */}
      <div className={styles.fieldRow}>
        <div>
          <div className={styles.fieldLabel}>Oracle Provider</div>
          <div className={styles.fieldDescription}>
            The UMA Oracle Manager address that will provide settlement data for this market. This should be the deployed UMAOracleManager contract address.
          </div>
        </div>
        <div className={styles.fieldInput}>
          <div className={styles.inputLabel}>ORACLE MANAGER ADDRESS (*)</div>
          <input
            type="text"
            value={formData.oracleProvider}
            onChange={(e) => updateFormData({ oracleProvider: e.target.value })}
            placeholder="0x..."
            className={`${styles.input} ${errors.oracleProvider ? styles.inputError : ''}`}
          />
          {errors.oracleProvider && <div className={styles.errorText}>{errors.oracleProvider}</div>}
          <div className={styles.helpText}>
            Address of the UMA Oracle Manager contract for this deployment
          </div>
        </div>
      </div>

      {/* Auto Settlement */}
      <div className={styles.fieldRow}>
        <div>
          <div className={styles.fieldLabel}>Auto Settlement</div>
          <div className={styles.fieldDescription}>
            Whether the market should automatically settle when oracle data becomes available, or require manual triggering by authorized users.
          </div>
        </div>
        <div className={styles.fieldInput}>
          <div className={styles.inputLabel}>AUTO SETTLEMENT</div>
          <div className={styles.checkboxWrapper}>
            <input
              type="checkbox"
              id="autoSettle"
              checked={formData.autoSettle}
              onChange={(e) => updateFormData({ autoSettle: e.target.checked })}
              className={styles.checkbox}
            />
            <label htmlFor="autoSettle" className={styles.checkboxLabel}>
              Automatically settle when oracle data is available
            </label>
          </div>
          <div className={styles.helpText}>
            {formData.autoSettle 
              ? 'Market will settle automatically when UMA oracle resolves' 
              : 'Manual settlement trigger required after oracle resolution'
            }
          </div>
        </div>
      </div>

      {/* Initial Order Section */}
      <div className={styles.sectionDivider}>
        <h3 className={styles.sectionTitle}>Initial Order (Optional)</h3>
        <p className={styles.sectionDescription}>
          Place an initial order to bootstrap liquidity in your market
        </p>
      </div>

      {/* Enable Initial Order */}
      <div className={styles.fieldRow}>
        <div>
          <div className={styles.fieldLabel}>Initial Order</div>
          <div className={styles.fieldDescription}>
            Place an initial buy or sell order when the market is created to provide initial liquidity and price discovery.
          </div>
        </div>
        <div className={styles.fieldInput}>
          <div className={styles.inputLabel}>ENABLE INITIAL ORDER</div>
          <div className={styles.checkboxWrapper}>
            <input
              type="checkbox"
              id="enableInitialOrder"
              checked={formData.initialOrder.enabled}
              onChange={(e) => updateFormData({ 
                initialOrder: { ...formData.initialOrder, enabled: e.target.checked }
              })}
              className={styles.checkbox}
            />
            <label htmlFor="enableInitialOrder" className={styles.checkboxLabel}>
              Place initial order upon market creation
            </label>
          </div>
          <div className={styles.helpText}>
            Recommended to provide initial liquidity and price reference
          </div>
        </div>
      </div>

      {/* Initial Order Configuration (shown when enabled) */}
      {formData.initialOrder.enabled && (
        <>
          <div className={styles.fieldRow}>
            <div>
              <div className={styles.fieldLabel}>Order Side</div>
              <div className={styles.fieldDescription}>
                Whether the initial order should be a buy order (bidding) or sell order (offering).
              </div>
            </div>
            <div className={styles.fieldInput}>
              <div className={styles.inputLabel}>ORDER SIDE (*)</div>
              <div className={styles.radioGroup}>
                <div className={styles.radioOption}>
                  <input
                    type="radio"
                    id="orderSideBuy"
                    name="orderSide"
                    value="BUY"
                    checked={formData.initialOrder.side === 'BUY'}
                    onChange={(e) => updateFormData({ 
                      initialOrder: { ...formData.initialOrder, side: e.target.value as 'BUY' | 'SELL' }
                    })}
                    className={styles.radio}
                  />
                  <label htmlFor="orderSideBuy" className={styles.radioLabel}>
                    BUY (Bidding)
                  </label>
                </div>
                <div className={styles.radioOption}>
                  <input
                    type="radio"
                    id="orderSideSell"
                    name="orderSide"
                    value="SELL"
                    checked={formData.initialOrder.side === 'SELL'}
                    onChange={(e) => updateFormData({ 
                      initialOrder: { ...formData.initialOrder, side: e.target.value as 'BUY' | 'SELL' }
                    })}
                    className={styles.radio}
                  />
                  <label htmlFor="orderSideSell" className={styles.radioLabel}>
                    SELL (Offering)
                  </label>
                </div>
              </div>
            </div>
          </div>

          <div className={styles.fieldRow}>
            <div>
              <div className={styles.fieldLabel}>Order Quantity</div>
              <div className={styles.fieldDescription}>
                Amount of the metric to trade in the initial order. Must be at least the minimum order size configured in step 2.
              </div>
            </div>
            <div className={styles.fieldInput}>
              <div className={styles.inputLabel}>QUANTITY (*)</div>
              <input
                type="text"
                value={formData.initialOrder.quantity}
                onChange={(e) => updateFormData({ 
                  initialOrder: { ...formData.initialOrder, quantity: e.target.value }
                })}
                placeholder="10.0"
                className={`${styles.input} ${errors['initialOrder.quantity'] ? styles.inputError : ''}`}
              />
              {errors['initialOrder.quantity'] && <div className={styles.errorText}>{errors['initialOrder.quantity']}</div>}
              <div className={styles.helpText}>
                Must be at least {formData.minimumOrderSize || '1'} (minimum order size)
              </div>
            </div>
          </div>

          <div className={styles.fieldRow}>
            <div>
              <div className={styles.fieldLabel}>Order Price</div>
              <div className={styles.fieldDescription}>
                Price per unit for the initial order. Must be a multiple of the tick size configured in step 2.
              </div>
            </div>
            <div className={styles.fieldInput}>
              <div className={styles.inputLabel}>PRICE (*)</div>
              <input
                type="text"
                value={formData.initialOrder.price}
                onChange={(e) => updateFormData({ 
                  initialOrder: { ...formData.initialOrder, price: e.target.value }
                })}
                placeholder="100.00"
                className={`${styles.input} ${errors['initialOrder.price'] ? styles.inputError : ''}`}
              />
              {errors['initialOrder.price'] && <div className={styles.errorText}>{errors['initialOrder.price']}</div>}
              <div className={styles.helpText}>
                Must be a multiple of 0.01 (tick size is fixed)
              </div>
            </div>
          </div>

          <div className={styles.fieldRow}>
            <div>
              <div className={styles.fieldLabel}>Time in Force</div>
              <div className={styles.fieldDescription}>
                How long the initial order should remain active in the orderbook.
              </div>
            </div>
            <div className={styles.fieldInput}>
              <div className={styles.inputLabel}>TIME IN FORCE (*)</div>
              <select
                value={formData.initialOrder.timeInForce}
                onChange={(e) => updateFormData({ 
                  initialOrder: { ...formData.initialOrder, timeInForce: e.target.value as any }
                })}
                className={`${styles.input}`}
              >
                {TIME_IN_FORCE_OPTIONS.map(option => (
                  <option key={option.value} value={option.value}>
                    {option.label} - {option.description}
                  </option>
                ))}
              </select>
              <div className={styles.helpText}>
                GTC (Good Till Cancelled) is recommended for initial orders
              </div>
            </div>
          </div>

          {/* GTD Expiry Time (shown when GTD is selected) */}
          {formData.initialOrder.timeInForce === 'GTD' && (
            <div className={styles.fieldRow}>
              <div>
                <div className={styles.fieldLabel}>Expiry Time</div>
                <div className={styles.fieldDescription}>
                  When the initial order should expire (for GTD orders only). Must be before trading end date.
                </div>
              </div>
              <div className={styles.fieldInput}>
                <div className={styles.inputLabel}>EXPIRY TIME (*)</div>
                <input
                  type="datetime-local"
                  value={formatDateForInput(formData.initialOrder.expiryTime)}
                  onChange={(e) => {
                    const timestamp = e.target.value ? Math.floor(new Date(e.target.value).getTime() / 1000).toString() : '';
                    updateFormData({ 
                      initialOrder: { ...formData.initialOrder, expiryTime: timestamp }
                    });
                  }}
                  className={`${styles.input} ${errors['initialOrder.expiryTime'] ? styles.inputError : ''}`}
                />
                {errors['initialOrder.expiryTime'] && <div className={styles.errorText}>{errors['initialOrder.expiryTime']}</div>}
                <div className={styles.helpText}>
                  Order will be cancelled at this time if not filled
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </form>
  );
}
