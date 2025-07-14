# LogIndex Fix Summary

## 🔧 Issue Fixed

### **Problem**: Log Index Always Evaluating to Zero

Your `logIndex` was always 0, causing duplicate key violations in the database because multiple events in the same transaction would all have `logIndex = 0`, violating the unique constraint `(transaction_hash, log_index)`.

### **Root Causes**:
1. **Ethers v6 Compatibility**: Code was using `log.logIndex` but ethers v6 uses `log.index`
2. **Automatic Fallback to 0**: Multiple places were defaulting to 0 when logIndex was undefined
3. **Inconsistent Property Access**: Mixed usage of `log.logIndex` vs `log.index`

## 🛠️ Technical Changes Made

### **Files Modified**:
- `src/services/eventListener.ts` - Fixed logIndex extraction in both event formatting functions

### **Before (Broken)**:
```typescript
// Multiple places in the code
logIndex: log.logIndex ?? 0, // Always defaulted to 0 if undefined

// And in real-time event processing
if (eventLog.logIndex === null || eventLog.logIndex === undefined) {
  console.warn('Log index is null/undefined, setting to 0:', eventLog.logIndex)
  eventLog.logIndex = 0  // ❌ Always set to 0
}
```

### **After (Fixed)**:
```typescript
// Proper ethers v6 compatible extraction
let logIndex = log.logIndex;
if (logIndex === null || logIndex === undefined) {
  logIndex = log.index; // ethers v6 uses .index instead of .logIndex
}

if (logIndex === null || logIndex === undefined) {
  console.error('❌ Critical: No valid logIndex found for event');
  return null; // Skip event instead of using 0
}

const baseEvent = {
  // ... other properties
  logIndex: logIndex, // ✅ Use actual logIndex from blockchain
}
```

## 🎯 Key Improvements

### 1. **Proper Ethers v6 Support**
- ✅ Tries `log.logIndex` first (for compatibility)  
- ✅ Falls back to `log.index` (ethers v6 standard)
- ✅ Only proceeds if valid logIndex is found

### 2. **Enhanced Error Handling**
- ✅ Logs detailed diagnostics when logIndex is missing
- ✅ Skips events with invalid logIndex instead of using 0
- ✅ Prevents database constraint violations

### 3. **Better Debugging**
- ✅ Detailed logging shows logIndex extraction process
- ✅ Reports which property was used (`logIndex` vs `index`)
- ✅ Identifies problematic events before they cause issues

## 🧪 How to Verify the Fix

### 1. **Run the Test Script**
```bash
# Set your RPC URL and run the test
export RPC_URL="your-rpc-endpoint-here"
node scripts/test-logindex-fix.js
```

This will show you:
- Current logIndex extraction from recent blockchain events
- Whether `log.logIndex` or `log.index` is being used
- Examples of transactions with multiple events (showing unique logIndex values)

### 2. **Check Event Listener Logs**
After restarting your event listener, look for these logs:
```
✅ Fixed logIndex from .index property: 5
📡 New PositionOpened event: 0x123...abc:5  // Note the ":5" instead of ":0"
```

### 3. **Database Verification**
Query your database to see unique logIndex values:
```sql
SELECT 
  transaction_hash, 
  log_index, 
  event_type,
  COUNT(*) 
FROM contract_events 
WHERE created_at > NOW() - INTERVAL '1 hour'
GROUP BY transaction_hash, log_index, event_type
HAVING COUNT(*) > 1;
```

This should return **zero rows** (no duplicates).

### 4. **Monitor for Duplicate Errors**
Watch your logs for this error - it should **stop occurring**:
```
"duplicate key value violates unique constraint \"contract_events_transaction_hash_log_index_key\""
```

## 📊 Expected Results

### **Before Fix**:
- All events had `logIndex = 0`
- Multiple events per transaction caused duplicate key errors
- Database storage failures
- Missing transaction data

### **After Fix**:
- Events have proper logIndex values (0, 1, 2, 3, etc.)
- No duplicate key violations
- All events stored successfully
- Complete transaction history

## 🚨 If Issues Persist

If you still see logIndex = 0 for all events:

1. **Check ethers version**: Ensure you're using ethers v6
2. **Verify RPC provider**: Some providers might not return logIndex properly
3. **Check event structure**: Run the test script to see actual log structure
4. **Enable debug logging**: Look for the diagnostic messages in the fixed code

## 📈 Impact

This fix ensures:
- ✅ **Unique Event Storage**: No more duplicate key violations
- ✅ **Complete Event History**: All blockchain events are properly stored
- ✅ **Correct Transaction Tables**: Full transaction data without missing events
- ✅ **Better Debugging**: Clear logs show what's happening with logIndex extraction 