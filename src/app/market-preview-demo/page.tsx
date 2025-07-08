import MarketPreviewModalDemo from '@/components/MarketPreviewModal/MarketPreviewModalDemo';

export default function MarketPreviewDemoPage() {
  return (
    <div style={{ 
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    }}>
      <MarketPreviewModalDemo />
    </div>
  );
} 